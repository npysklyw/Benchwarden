import { useState } from "react";
import type { API } from "./api-types";
import { request, useResource } from "./api";
import type { Comparison, Metrics, Page, Result, Run } from "./api";
import { Load, Pager, Status } from "./ui";
import { label, link, navigate, short, value, percent } from "./utils";
function CompareForm({ baseline = "" }: { baseline?: string }) {
  const [old, setOld] = useState(baseline),
    [candidate, setCandidate] = useState("");
  return (
    <form
      className="panel controls"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(
          `/compare/${encodeURIComponent(old)}/${encodeURIComponent(candidate)}`,
        );
      }}
    >
      <label>
        Baseline run UUID
        <input value={old} required onChange={(e) => setOld(e.target.value)} />
      </label>
      <label>
        Candidate run UUID
        <input
          value={candidate}
          required
          onChange={(e) => setCandidate(e.target.value)}
        />
      </label>
      <button>Compare runs</button>
    </form>
  );
}
export function Runs({ id, offset }: { id: string; offset: number }) {
  const state = useResource<Page<API["EvaluationRunResponse"]>>(
    `/projects/${id}/runs?offset=${offset}`,
  );
  return (
    <>
      <h1>Evaluation runs</h1>
      <a href={link(`/projects/${id}`)}>Back to project</a>
      <CompareForm />
      <Load state={state}>
        {(page) => (
          <>
            {!page.items.length && (
              <p>No runs yet. Open a dataset to create one.</p>
            )}
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Scrollable data table"
            >
              <table>
                <caption>Recorded executions</caption>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Execution</th>
                    <th>Created</th>
                    <th>Dataset</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <a href={link(`/runs/${run.id}`)}>{short(run.id)}</a>
                      </td>
                      <td>
                        <Status>{run.status}</Status>
                      </td>
                      <td>{new Date(run.created_at).toLocaleString()}</td>
                      <td>
                        <a href={link(`/datasets/${run.dataset_id}`)}>
                          {short(run.dataset_id)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} path={`/projects/${id}/runs`} />
          </>
        )}
      </Load>
    </>
  );
}
function MetricGrid({ metrics }: { metrics: Metrics }) {
  const rates = new Set([
    "pass_rate",
    "end_to_end_success_rate",
    "evaluation_coverage",
  ]);
  const keys: (keyof Metrics)[] = [
    "total_cases",
    "completed_executions",
    "execution_errors",
    "passed_cases",
    "failed_cases",
    "unscored_cases",
    "scoreable_cases",
    "evaluation_coverage",
    "pass_rate",
    "end_to_end_success_rate",
    "median_latency_ms",
    "p95_latency_ms",
    "total_tokens",
    "estimated_cost_usd",
  ];
  return (
    <>
      <dl className="metrics">
        {keys.map((key) => (
          <div key={key}>
            <dt>{key === "pass_rate" ? "Scoreable pass rate" : label(key)}</dt>
            <dd>
              {rates.has(key)
                ? percent(metrics[key] as number | null)
                : value(metrics[key])}
            </dd>
          </div>
        ))}
      </dl>
      <h2>Failure categories</h2>
      {Object.keys(metrics.failure_category_counts).length ? (
        <ul>
          {Object.entries(metrics.failure_category_counts).map(
            ([key, count]) => (
              <li key={key}>
                {label(key)}: {count}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p>No recorded failures.</p>
      )}
    </>
  );
}
function ResultTable({ page }: { page: Page<Result> }) {
  const [filter, setFilter] = useState("all");
  const filtered = page.items.filter(
    (row) =>
      filter === "all" ||
      (filter === "error"
        ? row.status === "error"
        : row.evaluation_outcome === filter),
  );
  return (
    <>
      <label className="filter">
        Filter this page
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All cases</option>
          <option value="failed">Scoring failures</option>
          <option value="error">Execution errors</option>
          <option value="passed">Passed</option>
          <option value="not_scored">Not scored</option>
        </select>
      </label>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Scrollable data table"
      >
        <table>
          <caption>Case results</caption>
          <thead>
            <tr>
              <th>Case / trace</th>
              <th>Execution</th>
              <th>Evaluation</th>
              <th>Latency (ms)</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((result) => (
              <tr key={result.id}>
                <td>
                  <a href={link(`/results/${result.id}`)}>
                    {short(result.test_case_id)} · Inspect trace
                  </a>
                  {result.replay_of && <small>Replay</small>}
                </td>
                <td>
                  <Status>{result.status}</Status>
                </td>
                <td>
                  <Status>{result.evaluation_outcome}</Status>
                </td>
                <td>{value(result.latency_ms)}</td>
                <td>{value(result.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p>No cases match this page’s filter.</p>}
    </>
  );
}
export function RunView({ id, offset }: { id: string; offset: number }) {
  const state = useResource<Run>(`/runs/${id}`),
    metrics = useResource<Metrics>(`/runs/${id}/metrics`),
    results = useResource<Page<Result>>(`/runs/${id}/results?offset=${offset}`);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function execute() {
    setBusy(true);
    setError("");
    try {
      await request(`/runs/${id}/execute`, {});
      window.location.reload();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Load state={state}>
      {(run) => (
        <>
          <h1>Run {short(id)}</h1>
          <a href={link(`/projects/${run.project_id}/runs`)}>
            All project runs
          </a>
          <p className="identifier">{id}</p>
          <p>
            Execution: <Status>{run.status}</Status>
          </p>
          <p>Evaluation outcomes are reported separately below.</p>
          {run.status === "pending" && (
            <button disabled={busy} onClick={() => void execute()}>
              {busy ? "Executing…" : "Execute run"}
            </button>
          )}
          {run.status === "running" && (
            <p>
              Execution in progress.{" "}
              <button onClick={() => window.location.reload()}>Refresh</button>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Load state={metrics}>{(data) => <MetricGrid metrics={data} />}</Load>
          <h2>Results and traces</h2>
          <p>Open a failed or errored result to replay it.</p>
          <Load state={results}>
            {(page) => (
              <>
                <ResultTable page={page} />
                <Pager page={page} path={`/runs/${id}`} />
              </>
            )}
          </Load>
          <h2>Compare this run</h2>
          <CompareForm baseline={id} />
        </>
      )}
    </Load>
  );
}
export function CompareView({
  baseline,
  candidate,
}: {
  baseline: string;
  candidate: string;
}) {
  const state = useResource<Comparison>(
    `/runs/${baseline}/compare/${candidate}`,
  );
  return (
    <>
      <h1>Run comparison</h1>
      <div className="controls">
        <a href={link(`/runs/${baseline}`)}>Baseline {short(baseline)}</a>
        <a href={link(`/runs/${candidate}`)}>Candidate {short(candidate)}</a>
      </div>
      <Load state={state}>
        {(comparison) => (
          <>
            {!comparison.identical_case_set && (
              <p className="notice">
                Case sets differ. Unmatched cases are identified below; gates
                require identical sets.
              </p>
            )}
            {comparison.pricing_changed && (
              <p className="notice">
                Pricing changed. Cost differences include pricing effects.
              </p>
            )}
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Scrollable data table"
            >
              <table>
                <caption>Metrics and deltas</caption>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Baseline</th>
                    <th>Candidate</th>
                    <th>Absolute delta</th>
                    <th>Relative delta (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(comparison.deltas).map(([key, delta]) => (
                    <tr key={key}>
                      <th>{label(key)}</th>
                      <td>
                        {value(comparison.baseline[key as keyof Metrics])}
                      </td>
                      <td>
                        {value(comparison.candidate[key as keyof Metrics])}
                      </td>
                      <td>{value(delta.absolute)}</td>
                      <td>{value(delta.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h2>Case changes</h2>
            {(["regressed", "improved", "unchanged", "unmatched"] as const).map(
              (kind) => (
                <section key={kind}>
                  <h3>
                    {label(kind)} (
                    {
                      comparison.cases.filter(
                        (item) => item.classification === kind,
                      ).length
                    }
                    )
                  </h3>
                  <ul>
                    {comparison.cases
                      .filter((item) => item.classification === kind)
                      .map((item) => (
                        <li key={item.test_case_id}>
                          {short(item.test_case_id)} ·{" "}
                          {item.baseline_result_id && (
                            <a
                              href={link(`/results/${item.baseline_result_id}`)}
                            >
                              Baseline trace
                            </a>
                          )}{" "}
                          {item.candidate_result_id && (
                            <a
                              href={link(
                                `/results/${item.candidate_result_id}`,
                              )}
                            >
                              Candidate trace
                            </a>
                          )}
                        </li>
                      ))}
                  </ul>
                </section>
              ),
            )}
          </>
        )}
      </Load>
    </>
  );
}
