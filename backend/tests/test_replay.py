from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from conftest import alembic_config
from sqlalchemy import delete, event, inspect, select, text
from sqlalchemy.orm import Session

from benchwarden.api.schemas import ResultDetail
from benchwarden.application.ci_seed import seed_ci
from benchwarden.application.evaluations import EvaluationService, create_run
from benchwarden.application.replay import replay_result
from benchwarden.persistence.models import (
    AgentConfiguration,
    CaseResult,
    EvaluationDataset,
    EvaluationRun,
    ExecutionEvent,
    Project,
    ScoringResult,
    ToolCall,
)
from benchwarden.persistence.models import TestCase as Case

pytestmark = pytest.mark.integration


def experiment(session, *, error=False, regression=True):
    seed = seed_ci(session, regression=regression)
    if error:
        case = session.scalar(select(Case).where(Case.dataset_id == seed.dataset_id))
        case.input = {"scenario": "timeout"}
        session.commit()
    run = create_run(session, seed.project_id, seed.candidate_config_id, seed.dataset_id)
    EvaluationService(session).execute(run.id)
    result = session.scalar(
        select(CaseResult)
        .where(CaseResult.run_id == run.id)
        .order_by(CaseResult.created_at, CaseResult.id)
    )
    if error:
        result = session.scalar(
            select(CaseResult).where(CaseResult.run_id == run.id, CaseResult.status == "error")
        )
    return seed, run, result


@pytest.mark.parametrize("error", [False, True])
def test_replay_snapshots_lineage_and_immutability(session, client, error):
    seed, run, original = experiment(session, error=error)
    before = ResultDetail.model_validate(original).model_dump(mode="json")
    run_before = (run.status, run.started_at, run.finished_at, run.updated_at)
    snapshot = deepcopy(run.configuration_snapshot)
    # Direct database edits simulate drift outside the guarded CRUD API.
    agent = session.get(AgentConfiguration, seed.candidate_config_id)
    agent.parameters = {"fake_variant": "standard"}
    case = session.get(Case, original.test_case_id)
    case.input = {"scenario": "unknown_tool"}
    case.expectations = []
    session.commit()
    ids = []
    for _ in range(2):
        response = client.post(f"/results/{original.id}/replay", json={})
        assert response.status_code == 201, response.text
        replay_id = response.json()["id"]
        ids.append(replay_id)
        result = client.get(f"/runs/{replay_id}/results").json()["items"][0]
        assert result["replay_of"] == str(original.id)
        assert result["input_snapshot"] == before["input_snapshot"]
        assert result["expectations_snapshot"] == before["expectations_snapshot"]
        assert result["status"] == before["status"]
        assert result["evaluation_outcome"] == before["evaluation_outcome"]
        detail = client.get(f"/results/{result['id']}").json()
        assert [event["sequence"] for event in detail["events"]] == list(
            range(len(detail["events"]))
        )
        replay_run = session.get(EvaluationRun, UUID(replay_id))
        assert replay_run.configuration_snapshot == snapshot
        assert replay_run.pricing_snapshot == run.pricing_snapshot
    assert ids[0] != ids[1]
    session.expire_all()
    assert ResultDetail.model_validate(original).model_dump(mode="json") == before
    assert (run.status, run.started_at, run.finished_at, run.updated_at) == run_before


def test_replay_rejects_missing_invalid_success_pending_and_legacy(session, client):
    assert client.post(f"/results/{uuid4()}/replay", json={"input": {}}).status_code == 422
    assert client.post(f"/results/{uuid4()}/replay", json={}).status_code == 404
    assert client.post("/results/invalid/replay", json={}).status_code == 422
    seed, run, result = experiment(session, regression=False)
    assert client.post(f"/results/{result.id}/replay", json={}).status_code == 409
    pending = create_run(session, seed.project_id, seed.candidate_config_id, seed.dataset_id)
    assert client.post(f"/results/{pending.case_results[0].id}/replay", json={}).status_code == 409
    _, run, result = experiment(session)
    run.configuration_snapshot = None
    session.commit()
    assert client.post(f"/results/{result.id}/replay", json={}).status_code == 409


def test_dashboard_queries_paginate_and_replay_chain(session, client):
    seed, run, original = experiment(session)
    response = client.get(f"/projects/{seed.project_id}/runs?limit=1")
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert client.get(f"/projects/{seed.project_id}/runs?limit=101").status_code == 422
    assert client.get(f"/projects/{uuid4()}/runs").status_code == 404
    replay = replay_result(session, original.id)
    child = replay.case_results[0]
    second = replay_result(session, child.id)
    assert second.case_results[0].replay_of == child.id
    assert client.get(f"/runs/{run.id}/compare/{replay.id}").json()["identical_case_set"] is False


def test_replay_sanitizes_configuration_and_observations(session, client):
    seed = seed_ci(session, regression=True)
    agent = session.get(AgentConfiguration, seed.candidate_config_id)
    agent.parameters = {"fake_variant": "wrong_answer", "api_key": "private-value"}
    agent.system_prompt = "<think>internal reasoning</think>Help fictional customers."
    session.commit()
    run = create_run(session, seed.project_id, seed.candidate_config_id, seed.dataset_id)
    EvaluationService(session).execute(run.id)
    replay = replay_result(session, run.case_results[0].id)
    body = client.get(f"/results/{replay.case_results[0].id}").text
    assert "private-value" not in body
    assert "internal reasoning" not in body
    assert "api_key" not in str(replay.configuration_snapshot)


def test_populated_replay_migration(database_engine):
    with database_engine.connect() as connection:
        transaction = connection.begin()
        try:
            with Session(
                connection, join_transaction_mode="create_savepoint", expire_on_commit=False
            ) as session:
                _, _, source = experiment(session)
                replay = replay_result(session, source.id)
                replay_id = replay.id
                original = connection.execute(
                    text("SELECT id, response, input_snapshot FROM case_results WHERE id=:id"),
                    {"id": source.id},
                ).one()
            config = alembic_config(connection)
            command.downgrade(config, "2c2af13af5e5")
            assert "replay_of" not in {
                c["name"] for c in inspect(connection).get_columns("case_results")
            }
            command.upgrade(config, "head")
            assert (
                connection.execute(
                    text("SELECT id, response, input_snapshot FROM case_results WHERE id=:id"),
                    {"id": source.id},
                ).one()
                == original
            )
            assert (
                connection.scalar(
                    text("SELECT configuration_snapshot FROM evaluation_runs WHERE id=:id"),
                    {"id": replay_id},
                )
                is None
            )
            command.check(config)
        finally:
            transaction.rollback()


def test_postgresql_dashboard_api_end_to_end(client):
    project = client.post("/projects", json={"name": "Dashboard smoke"}).json()
    dataset = client.post(f"/projects/{project['id']}/datasets", json={"name": "Smoke"}).json()
    case = client.post(
        f"/datasets/{dataset['id']}/test-cases",
        json={
            "name": "Text",
            "input": {"scenario": "text_only"},
            "expected_output": "expected",
            "expectations": [
                {
                    "name": "answer",
                    "type": "exact_output",
                    "expected": "Your fictional support request is complete.",
                }
            ],
        },
    )
    assert case.status_code == 201
    runs = []
    for variant in ("standard", "wrong_answer"):
        agent = client.post(
            f"/projects/{project['id']}/agent-configurations",
            json={
                "name": variant,
                "parameters": {"fake_variant": variant},
            },
        ).json()
        run = client.post(
            "/runs",
            json={
                "project_id": project["id"],
                "agent_configuration_id": agent["id"],
                "dataset_id": dataset["id"],
            },
        ).json()
        runs.append(run["id"])
        assert client.post(f"/runs/{run['id']}/execute").status_code == 200
        metrics = client.get(f"/runs/{run['id']}/metrics")
        assert metrics.status_code == 200
        assert metrics.json()["pass_rate"] == (1 if variant == "standard" else 0)
        assert metrics.json()["completed_executions"] == 1
        scored = client.post(f"/runs/{run['id']}/score")
        assert scored.status_code == 200
        assert scored.json() == metrics.json()
    comparison = client.get(f"/runs/{runs[0]}/compare/{runs[1]}").json()
    assert comparison["cases"][0]["classification"] == "regressed"
    result = client.get(f"/runs/{runs[1]}/results").json()["items"][0]
    original = client.get(f"/results/{result['id']}").json()
    assert original["events"] and original["scoring_results"]
    replay = client.post(f"/results/{result['id']}/replay", json={}).json()
    child = client.get(f"/runs/{replay['id']}/results").json()["items"][0]
    assert child["replay_of"] == result["id"]
    assert client.get(f"/results/{result['id']}").json() == original


def test_results_page_has_bounded_queries(session, client):
    _, run, _ = experiment(session)
    run_id = run.id
    session.expunge_all()
    queries = []

    def capture(connection, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)

    bind = session.get_bind()
    event.listen(bind, "before_cursor_execute", capture)
    try:
        response = client.get(f"/runs/{run_id}/results")
        assert response.status_code == 200
        assert len(response.json()["items"]) == 2
        assert len(queries) <= 4
    finally:
        event.remove(bind, "before_cursor_execute", capture)


@pytest.mark.parametrize("error", [False, True])
def test_concurrent_replays_preserve_source(database_engine, error):
    with Session(database_engine, expire_on_commit=False) as session:
        seed, source_run, source = experiment(session, error=error)
        source_id, run_id = source.id, source_run.id
        before = ResultDetail.model_validate(source).model_dump(mode="json")
        run_before = {
            column.name: deepcopy(getattr(source_run, column.name))
            for column in EvaluationRun.__table__.columns
        }
    barrier = Barrier(2)

    def replay():
        with Session(database_engine, expire_on_commit=False) as session:
            barrier.wait(timeout=10)
            return replay_result(session, source_id).id

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(replay) for _ in range(2)]
            ids = [future.result(timeout=20) for future in futures]
        assert len({run_id, *ids}) == 3
        with Session(database_engine) as verify:
            for replay_id in ids:
                run = verify.get(EvaluationRun, replay_id)
                assert len(run.case_results) == 1
                child = run.case_results[0]
                assert child.replay_of == source_id
                assert child.status.value == before["status"]
                assert child.evaluation_outcome == before["evaluation_outcome"]
                assert child.events and child.finished_at is not None
                assert child.input_snapshot == before["input_snapshot"]
                assert child.expectations_snapshot == before["expectations_snapshot"]
                assert run.configuration_snapshot == run_before["configuration_snapshot"]
                assert run.pricing_snapshot == run_before["pricing_snapshot"]
            original = verify.get(CaseResult, source_id)
            assert ResultDetail.model_validate(original).model_dump(mode="json") == before
            original_run = verify.get(EvaluationRun, run_id)
            assert {
                column.name: getattr(original_run, column.name)
                for column in EvaluationRun.__table__.columns
            } == run_before
    finally:
        with Session(database_engine) as cleanup:
            run_ids = select(EvaluationRun.id).where(EvaluationRun.project_id == seed.project_id)
            result_ids = select(CaseResult.id).where(CaseResult.run_id.in_(run_ids))
            for model in (ExecutionEvent, ToolCall, ScoringResult):
                cleanup.execute(delete(model).where(model.case_result_id.in_(result_ids)))
            cleanup.execute(
                delete(CaseResult).where(
                    CaseResult.run_id.in_(run_ids), CaseResult.replay_of.is_not(None)
                )
            )
            cleanup.execute(delete(CaseResult).where(CaseResult.run_id.in_(run_ids)))
            cleanup.execute(
                delete(EvaluationRun).where(EvaluationRun.project_id == seed.project_id)
            )
            cleanup.execute(delete(Case).where(Case.dataset_id == seed.dataset_id))
            cleanup.execute(
                delete(EvaluationDataset).where(EvaluationDataset.id == seed.dataset_id)
            )
            cleanup.execute(
                delete(AgentConfiguration).where(AgentConfiguration.project_id == seed.project_id)
            )
            cleanup.execute(delete(Project).where(Project.id == seed.project_id))
            cleanup.commit()
