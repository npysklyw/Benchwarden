import { useState } from "react";
import { request, useResource } from "./api";
import type { Run, Trace } from "./api";
import { Json, Load, Status } from "./ui";
import { label, link, short, value } from "./utils";
function Replay({ result }: { result: Trace }) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState<string>();
  async function replay() {
    setBusy(true);
    setError("");
    try {
      const run = await request<Run>(`/results/${result.id}/replay`, {});
      setCreated(run.id);
      setConfirm(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (result.status !== "error" && result.evaluation_outcome !== "failed")
    return null;
  return (
    <section className="panel">
      <h2>Replay failure</h2>
      <p>
        Create a new one-case execution from historical snapshots. The original
        stays unchanged. Older results without configuration snapshots are
        ineligible.
      </p>
      {!confirm && (
        <button
          onClick={() => {
            setConfirm(true);
            setCreated(undefined);
          }}
        >
          Replay this case
        </button>
      )}
      {confirm && (
        <div role="group" aria-label="Confirm replay">
          <p>Replay this case using the offline fake provider?</p>
          <button disabled={busy} onClick={() => void replay()}>
            {busy ? "Replaying…" : "Confirm replay"}
          </button>{" "}
          <button disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
      {created && (
        <p role="status">
          Replay recorded.{" "}
          <a href={link(`/runs/${created}`)}>Inspect replay run</a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function TraceView({ id }: { id: string }) {
  const state = useResource<Trace>(`/results/${id}`);
  return (
    <Load state={state}>
      {(result) => (
        <>
          <h1>Case trace {short(id)}</h1>
          <a href={link(`/runs/${result.run_id}`)}>Back to run</a>
          <p>
            Execution: <Status>{result.status}</Status> · Evaluation:{" "}
            <Status>{result.evaluation_outcome}</Status>
          </p>
          {result.replay_of && (
            <p>
              Replay of{" "}
              <a href={link(`/results/${result.replay_of}`)}>
                {result.replay_of}
              </a>
            </p>
          )}
          <p>
            Provider: {value(result.provider)} / {value(result.model_name)} ·
            Latency: {value(result.latency_ms)} ms · Tokens:{" "}
            {value(result.total_tokens)}
          </p>
          {result.error && (
            <p className="notice">
              {result.error_type}: {result.error}
            </p>
          )}
          <Replay result={result} />
          <h2>Input snapshot</h2>
          <Json data={result.input_snapshot} />
          <h2>Final output</h2>
          <Json data={result.response} />
          <h2>Observable execution events</h2>
          <p className="muted">
            Ordered requests, responses, validation, and tool activity. No
            hidden reasoning is recorded.
          </p>
          {!result.events.length && <p>No events recorded yet.</p>}
          <ol className="timeline">
            {[...result.events]
              .sort((a, b) => a.sequence - b.sequence)
              .map((event) => (
                <li key={event.id}>
                  <details className="panel">
                    <summary>
                      {event.sequence + 1}. {label(event.kind)}
                    </summary>
                    <p>
                      {event.started_at} · {value(event.latency_ms)} ms
                    </p>
                    <p>
                      Input tokens: {value(event.input_tokens)} · Output tokens:{" "}
                      {value(event.output_tokens)} · Total:{" "}
                      {value(event.total_tokens)}
                    </p>
                    <Json data={event.payload} />
                  </details>
                </li>
              ))}
          </ol>
          <h2>Tool calls</h2>
          {result.tool_calls.map((tool) => (
            <details className="panel" key={tool.id}>
              <summary>
                {tool.sequence + 1}. {tool.name} · Arguments{" "}
                {tool.arguments_validated ? "validated" : "not validated"}
              </summary>
              <Json
                data={{
                  arguments: tool.arguments,
                  result: tool.output,
                  error: tool.error,
                  latency_ms: tool.latency_ms,
                }}
              />
            </details>
          ))}
          {!result.tool_calls.length && <p>No tool calls recorded.</p>}
          <h2>Scorer verdicts</h2>
          {result.scoring_results.map((score) => (
            <article className="panel" key={score.id}>
              <h3>
                {score.scorer_name}{" "}
                <Status>{score.passed ? "passed" : "failed"}</Status>
              </h3>
              <p>
                {score.scorer_type} v{score.scorer_version} · Score{" "}
                {score.value}
              </p>
              <p>{score.explanation}</p>
              <Json
                data={{ expected: score.expected, observed: score.observed }}
              />
            </article>
          ))}
          {!result.scoring_results.length && (
            <p>This result has not been scored.</p>
          )}
        </>
      )}
    </Load>
  );
}
