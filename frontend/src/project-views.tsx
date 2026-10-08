import { useState } from "react";
import type { API } from "./api-types";
import { request, useResource } from "./api";
import type { Dataset, Page, Project, Run } from "./api";
import { Json, Load, Pager } from "./ui";
import { link, navigate } from "./utils";
export function Projects({ offset }: { offset: number }) {
  const state = useResource<Page<Project>>(`/projects?offset=${offset}`);
  return (
    <>
      <h1>Projects</h1>
      <p className="muted">
        Explore experiments, inspect failures, and compare agent versions.
      </p>
      <Load state={state}>
        {(page) => (
          <>
            {!page.items.length && (
              <p className="notice">
                No projects yet. Run <code>benchwarden seed-ci</code> or the
                scoring demo to get started.
              </p>
            )}
            <div className="cards">
              {page.items.map((project) => (
                <a
                  className="card"
                  key={project.id}
                  href={link(`/projects/${project.id}`)}
                >
                  <h2>{project.name}</h2>
                  <p>{project.description || "Evaluation workspace"}</p>
                  <span>Open project →</span>
                </a>
              ))}
            </div>
            <Pager page={page} path="/" />
          </>
        )}
      </Load>
    </>
  );
}
export function Overview({ id, offset }: { id: string; offset: number }) {
  const state = useResource<Project>(`/projects/${id}`);
  const agents = useResource<Page<API["AgentConfigurationResponse"]>>(
    `/projects/${id}/agent-configurations?offset=${offset}`,
  );
  return (
    <Load state={state}>
      {(project) => (
        <>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
          <div className="cards">
            <a className="card" href={link(`/projects/${id}/datasets`)}>
              <h2>Datasets</h2>
              <p>Browse inputs and expectations. Start an evaluation.</p>
            </a>
            <a className="card" href={link(`/projects/${id}/runs`)}>
              <h2>Evaluation runs</h2>
              <p>Inspect outcomes, compare versions, and replay failures.</p>
            </a>
          </div>
          <h2>Agent configurations</h2>
          <Load state={agents}>
            {(page) => (
              <>
                <p>
                  Showing {page.items.length} of {page.total}. Use a
                  configuration UUID to create a run.
                </p>
                {page.items.map((agent) => (
                  <article className="panel" key={agent.id}>
                    <strong>{agent.name}</strong> · {agent.provider} /{" "}
                    {agent.model_name}
                    <p>
                      <code>{agent.id}</code>
                    </p>
                  </article>
                ))}
                <Pager page={page} path={`/projects/${id}`} />
              </>
            )}
          </Load>
        </>
      )}
    </Load>
  );
}
export function Datasets({ id, offset }: { id: string; offset: number }) {
  const state = useResource<Page<Dataset>>(
    `/projects/${id}/datasets?offset=${offset}`,
  );
  return (
    <>
      <h1>Datasets</h1>
      <a href={link(`/projects/${id}`)}>Back to project</a>
      <Load state={state}>
        {(page) => (
          <>
            {!page.items.length && <p>No datasets yet.</p>}
            <div className="cards">
              {page.items.map((dataset) => (
                <a
                  key={dataset.id}
                  className="card"
                  href={link(`/datasets/${dataset.id}`)}
                >
                  <h2>{dataset.name}</h2>
                  <p>{dataset.description || "Evaluation cases"}</p>
                </a>
              ))}
            </div>
            <Pager page={page} path={`/projects/${id}/datasets`} />
          </>
        )}
      </Load>
    </>
  );
}
export function DatasetView({ id, offset }: { id: string; offset: number }) {
  const state = useResource<Dataset>(`/datasets/${id}`);
  const cases = useResource<Page<API["TestCaseResponse"]>>(
    `/datasets/${id}/test-cases?offset=${offset}`,
  );
  const [agent, setAgent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function start(project: string) {
    setBusy(true);
    setError("");
    try {
      const run = await request<Run>("/runs", {
        project_id: project,
        dataset_id: id,
        agent_configuration_id: agent,
      });
      navigate(`/runs/${run.id}`);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Load state={state}>
      {(dataset) => (
        <>
          <h1>{dataset.name}</h1>
          <a href={link(`/projects/${dataset.project_id}`)}>
            Back to project and configurations
          </a>
          <p>{dataset.description}</p>
          <form
            className="panel controls"
            onSubmit={(event) => {
              event.preventDefault();
              void start(dataset.project_id);
            }}
          >
            <label>
              Agent configuration UUID
              <input
                required
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              />
            </label>
            <button disabled={busy}>
              {busy ? "Creating…" : "Create evaluation run"}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          <h2>Test cases</h2>
          <Load state={cases}>
            {(page) => (
              <>
                {!page.items.length && <p>No test cases in this dataset.</p>}
                {page.items.map((test) => (
                  <details className="panel" key={test.id}>
                    <summary>{test.name}</summary>
                    <h3>Input</h3>
                    <Json data={test.input} />
                    <h3>Expected output</h3>
                    <Json data={test.expected_output} />
                    <h3>Scoring expectations</h3>
                    <Json data={test.expectations} />
                  </details>
                ))}
                <Pager page={page} path={`/datasets/${id}`} />
              </>
            )}
          </Load>
        </>
      )}
    </Load>
  );
}
