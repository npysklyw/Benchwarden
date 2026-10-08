# Dashboard and failure replay

The React dashboard uses small project, run/comparison, and trace view modules,
shared semantic UI components, and a typed fetch adapter. Hash routes avoid server
rewrite requirements. The existing `/api` development proxy connects to FastAPI.
No new frontend runtime dependencies or component framework are required.

## Workflow

1. Open Projects, then a project to find datasets, configurations, and runs.
2. Browse a dataset and expand a case to inspect its input and expectations.
3. Copy a configuration UUID from the project page, create a pending run from the
   dataset page, then select **Execute run**. Execution automatically scores eligible cases.
4. Inspect metrics and case results. Execution (`completed` / `error`) is independent
   of evaluation (`passed` / `failed` / `not_scored`). Filter the current results page
   and follow a trace link. Pagination never implicitly loads all records.
5. Supply baseline and candidate UUIDs to compare compatible runs. Comparison
   displays backend-derived metrics, absolute and relative deltas, and classified
   cases. Incompatible comparisons display an error instead of misleading metrics.
6. On a failed or errored trace, choose **Replay this case**, review the explanation,
   and confirm. A success link opens the newly recorded one-case run, including
   any repeat failure. A replay trace links back to its immediate original result.

Routes are `#/`, `#/projects/:id`, `#/projects/:id/datasets`, `#/datasets/:id`,
`#/projects/:id/runs`, `#/runs/:id`, `#/compare/:baseline/:candidate`, and
`#/results/:id`. List pagination uses `?offset=20` inside the hash.

Missing metrics display **Unavailable**, not zero. Summary numbers use six
significant digits for readability; full precision remains available in the API
and trace JSON. Rates in run summaries are percentages. Comparison rate values
and absolute rate deltas use fractions; its relative-change column is percent.
Scrollable tables are keyboard focusable; mobile layouts stack controls and metric
cards. Native links, labels, disclosures, focus outlines, and a skip control are used.

## Replay semantics

`POST /results/{result_id}/replay` accepts an empty JSON object and returns HTTP 201
with the new RunDetail. Unknown fields are rejected. Missing IDs return 404;
malformed IDs/bodies return 422; successful results, unfinished parent runs,
pending cases, missing snapshots, or unsupported scorer versions return 409.

Replay creates a new pending EvaluationRun and exactly one pending CaseResult,
commits them, then calls the existing synchronous EvaluationService. The source
result, run, events, tool calls, and scores are never written. Two replay requests
create two distinct runs. Execution failures remain persisted and inspectable.
Duplicate execution protection still applies to each new run independently.
Concurrent replay requests use separate sessions and new run identities; they do
not serialize by writing the source. PostgreSQL tests verify simultaneous replays
of both scoring failures and execution errors, including unchanged source records.

Migration `38a719bc62df`, following `2c2af13af5e5`, adds:

- Nullable JSONB `evaluation_runs.configuration_snapshot`, containing sanitized
  provider, model, system prompt, and parameters for newly created runs.
- Nullable, indexed `case_results.replay_of`, a self-referencing UUID foreign key
  with restrictive deletion. Dataset, configuration, project, and case constraints
  remain intact. A replay keeps the original dataset and test-case identities.

The new run copies historical configuration, pricing, and scorer version. The
new result copies historical input and expectations, with lineage to the immediate
source result (which may itself be a replay). Execution recognizes the one-case
replay and uses its input snapshot rather than the current TestCase input.
Original ordinary runs retain full-dataset validation. Trace persistence, execution
transitions, scoring, and per-case transactions are reused unchanged.

```mermaid
flowchart LR
    A[Finished failed or errored result] --> B{Historical snapshots available?}
    B -->|No| C[409 conflict]
    B -->|Yes| D[Create and commit new one-case run]
    D --> E[Existing execution service]
    E --> F[Persist ordered trace and outcome]
    F --> G[Score eligible completed case]
    G --> H[New result links to source via replay_of]
```

Existing rows are not backfilled or reinterpreted. Runs predating configuration
snapshots are deliberately ineligible for replay: their exact historical
configuration cannot be proved. Create a fresh run after migration. Downgrade
removes only these new columns/index/foreign key; it preserves all execution and
scoring rows, but necessarily discards replay lineage and configuration snapshots.
Reapplying does not reconstruct that lost metadata.

Only observable, sanitized data is rendered. Configuration secrets are excluded
from snapshots. Errors use the existing fixed provider/tool messages. The browser
does not echo unknown error-response bodies. Redaction is conservative; replay
uses the sanitized snapshot, not any removed sensitive original values. Semantic
fake-provider behavior is deterministic; UUIDs, timestamps, and latency are new.
Provider/tool implementation code is not archived, so exact reproduction across
future implementation changes is not promised.

## API and generated types

New endpoints are the replay operation above and paginated
`GET /projects/{project_id}/runs?limit=20&offset=0` (limit 1–100). Existing result
responses add nullable `replay_of`. Other existing routes remain compatible.
Result lists eager-load scores in one extra query, preventing per-row queries.
Existing services provide metrics, result detail, scoring, and comparison.

From `backend/`, with the development dependencies installed:

```bash
python scripts/generate_api_types.py
python scripts/generate_api_types.py --check
```

The script reads `app.openapi()` without starting a server or connecting to a
database. It sorts schema/property names and emits stable LF TypeScript into
`frontend/src/api-types.ts`. The file is intentionally tracked. It covers the
OpenAPI schema constructs used by this application; unsupported types become
`unknown`, never `any`. View adapters reference those generated schemas rather
than duplicating large contracts. CI checks that the committed output is current.
The dashboard's **API schema** link opens the proxied OpenAPI document.

## Local startup

From the repository root, Docker users can run:

```bash
docker compose --env-file .env.example up --build
docker compose --env-file .env.example exec backend python -m benchwarden.demo --scoring --execute
```

Open `http://localhost:5173`. See README for installing Python 3.12 and Node 22
dependencies. With local PostgreSQL, start the backend from `backend/`:

```powershell
. .\.venv\Scripts\Activate.ps1
$env:BENCHWARDEN_DATABASE_URL = 'postgresql+psycopg://benchwarden:benchwarden@localhost:5432/benchwarden'
python -m alembic upgrade head
python -m benchwarden.demo --scoring --execute
python -m uvicorn benchwarden.main:app --host 127.0.0.1 --port 8000
```

Bash equivalent:

```bash
source .venv/bin/activate
export BENCHWARDEN_DATABASE_URL='postgresql+psycopg://benchwarden:benchwarden@localhost:5432/benchwarden'
python -m alembic upgrade head
python -m benchwarden.demo --scoring --execute
python -m uvicorn benchwarden.main:app --host 127.0.0.1 --port 8000
```

In another terminal, from `frontend/`, run `npm ci` then `npm run dev`. The shown
credentials are fictional local defaults. Existing databases can use their own
connection settings. The demo intentionally includes failures suitable for replay.

## Limits

This is a local, synchronous, fake-provider dashboard. No authentication, workers,
real providers, LLM judges, or production hosting configuration were added.
Configuration/dataset editing remains API-only. Case filtering is explicitly
page-local; comparison includes at most the existing synchronous run limit of
1,000 cases. Refresh running runs manually. Replays reproduce failures without
applying repairs or changing original expectations. Comparison against a full run
may report unmatched cases; regression gates continue rejecting unequal case sets.
Durable recovery after process loss remains deferred. Production serving must
provide an `/api` reverse proxy; Vite preview alone is not a production API proxy.

## Verification

On 2026-09-28, the full backend suite passed **231 tests**, including CLI/gates,
the PostgreSQL API workflow, populated migrations, concurrent replay, historical
snapshot drift, and source immutability. Two existing Starlette/httpx/AnyIO
deprecation warnings remain. The frontend suite passed **9 tests**, including
loading/empty/error states, filtering, comparison, replay confirmation/cancel,
and navigation. ESLint, TypeScript, Vite production build, Ruff, strict mypy,
Alembic round-trip/drift, and generated-contract checks passed.

Backend commands, from `backend/` with the virtual environment activated and
`BENCHWARDEN_TEST_DATABASE_URL` set to a disposable PostgreSQL database:

```bash
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m mypy
python scripts/generate_api_types.py --check
```

The generated-type check was repeated without changes. For a **disposable**
database selected by `BENCHWARDEN_DATABASE_URL` (downgrade to base removes tables):

```bash
python -m alembic upgrade head
python -m alembic downgrade base
python -m alembic upgrade head
python -m alembic check
```

Frontend commands, from `frontend/`:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

These commands also work in PowerShell after activating `.venv/Scripts/Activate.ps1`
and assigning database URLs using `$env:BENCHWARDEN_TEST_DATABASE_URL` and
`$env:BENCHWARDEN_DATABASE_URL`. Compose was validated from the root with
`docker compose --env-file .env.example config --quiet`; workflow syntax was
checked with `actionlint -shellcheck=` (ShellCheck was unavailable).

A separate live HTTP smoke test against temporary PostgreSQL 17 created a project,
dataset, two cases and two configurations, executed/scored baseline and candidate,
verified metrics and regression classifications, inspected ordered events/tool calls,
and replayed a failure into a distinct one-case run while comparing the original
result before and after. No external model calls or API keys were used. Docker
Engine was not required; full Compose runtime verification remains environment-dependent.
