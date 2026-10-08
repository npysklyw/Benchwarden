"""One-case executions with lineage; never update their historical source."""

from copy import deepcopy
from uuid import UUID

from sqlalchemy.orm import Session

from benchwarden.application.evaluations import (
    EvaluationService,
    ExecutionConflict,
    require,
)
from benchwarden.domain.status import CaseStatus, RunStatus
from benchwarden.persistence.models import CaseResult, EvaluationRun
from benchwarden.scoring.expectations import VERSION


def replay_result(session: Session, result_id: UUID) -> EvaluationRun:
    original = require(session, CaseResult, result_id)
    source = require(session, EvaluationRun, original.run_id)
    if source.status not in (RunStatus.COMPLETED, RunStatus.FAILED) or (
        original.status != CaseStatus.ERROR and original.evaluation_outcome != "failed"
    ):
        raise ExecutionConflict(
            "Only failed evaluations or execution errors in finished runs can replay"
        )
    if (
        source.configuration_snapshot is None
        or original.expectations_snapshot is None
        or source.scoring_version != VERSION
    ):
        raise ExecutionConflict(
            "Historical snapshots are unavailable or unsupported; create a new run"
        )
    run = EvaluationRun(
        project_id=source.project_id,
        agent_configuration_id=source.agent_configuration_id,
        dataset_id=source.dataset_id,
        scoring_version=source.scoring_version,
        pricing_snapshot=deepcopy(source.pricing_snapshot),
        configuration_snapshot=deepcopy(source.configuration_snapshot),
    )
    session.add(run)
    session.flush()
    session.add(
        CaseResult(
            run_id=run.id,
            dataset_id=source.dataset_id,
            test_case_id=original.test_case_id,
            replay_of=original.id,
            input_snapshot=deepcopy(original.input_snapshot),
            expectations_snapshot=deepcopy(original.expectations_snapshot),
            provider=original.provider,
            model_name=original.model_name,
        )
    )
    session.commit()
    return EvaluationService(session).execute(run.id)
