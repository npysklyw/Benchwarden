import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";

const record = {
  id: "project-id",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const project = {
  ...record,
  name: "Fictional support",
  description: "Offline evaluations",
};
const dataset = {
  ...record,
  id: "dataset-id",
  project_id: project.id,
  name: "Support cases",
  description: "",
  schema_version: 1,
};
const run = {
  ...record,
  id: "run-id",
  project_id: project.id,
  dataset_id: dataset.id,
  status: "completed",
};
const metrics = {
  total_cases: 2,
  completed_executions: 1,
  execution_errors: 1,
  passed_cases: 0,
  failed_cases: 1,
  unscored_cases: 1,
  scoreable_cases: 1,
  evaluation_coverage: 0.5,
  pass_rate: 0,
  end_to_end_success_rate: 0,
  median_latency_ms: 2,
  p95_latency_ms: 3,
  total_tokens: null,
  estimated_cost_usd: null,
  failure_category_counts: { provider_timeout: 1 },
};
const result = {
  ...record,
  id: "result-id",
  run_id: run.id,
  dataset_id: dataset.id,
  test_case_id: "case-one",
  status: "completed",
  evaluation_outcome: "failed",
  replay_of: null,
  latency_ms: 2,
  total_tokens: 18,
  provider: "fake",
  model_name: "deterministic-v1",
  input_snapshot: { scenario: "text_only" },
  response: "Incorrect answer",
  error: null,
  tool_calls: [],
  scoring_results: [],
  events: [
    {
      ...record,
      id: "event-two",
      sequence: 1,
      kind: "model_response",
      payload: { text: "Incorrect answer" },
      latency_ms: 2,
      input_tokens: 12,
      output_tokens: 6,
      total_tokens: 18,
    },
    {
      ...record,
      id: "event-one",
      sequence: 0,
      kind: "model_request",
      payload: { input: "Hello" },
      latency_ms: 0,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    },
  ],
};
const page = (items: unknown[], total = items.length) => ({
  items,
  total,
  limit: 20,
  offset: 0,
});
let routes: Record<string, unknown>;
let fetcher: ReturnType<typeof vi.fn>;
function response(data: unknown, status = 200) {
  return {
    ok: status === 200 || status === 201,
    status,
    json: async () => data,
  };
}
async function goto(path: string) {
  await act(async () => {
    window.location.hash = path;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => {
  window.location.hash = "/";
  routes = {
    "/api/projects?offset=0": page([project]),
    "/api/projects/project-id": project,
    "/api/projects/project-id/agent-configurations?offset=0": page([]),
    "/api/projects/project-id/datasets?offset=0": page([dataset]),
    "/api/datasets/dataset-id": dataset,
    "/api/datasets/dataset-id/test-cases?offset=0": page([
      {
        ...record,
        name: "Text case",
        input: { scenario: "text_only" },
        expected_output: "Hello",
        expectations: [],
      },
    ]),
    "/api/projects/project-id/runs?offset=0": page([run]),
    "/api/runs/run-id": run,
    "/api/runs/run-id/metrics": metrics,
    "/api/runs/run-id/results?offset=0": page([
      result,
      {
        ...result,
        id: "error-id",
        test_case_id: "case-two",
        status: "error",
        evaluation_outcome: "not_scored",
      },
    ]),
    "/api/results/result-id": result,
  };
  fetcher = vi.fn(async (url: string) =>
    response(routes[url], routes[url] ? 200 : 404),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

test("navigates projects, overview, datasets, cases and runs", async () => {
  render(<App />);
  const projectLink = await screen.findByRole("link", {
    name: /Fictional support/,
  });
  expect(projectLink).toHaveAttribute("href", "#/projects/project-id");
  await goto("/projects/project-id");
  expect(
    await screen.findByRole("heading", { name: "Fictional support" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Datasets/ })).toHaveAttribute(
    "href",
    "#/projects/project-id/datasets",
  );
  await goto("/projects/project-id/datasets");
  expect(
    await screen.findByRole("link", { name: /Support cases/ }),
  ).toHaveAttribute("href", "#/datasets/dataset-id");
  await goto("/datasets/dataset-id");
  expect(await screen.findByText("Text case")).toBeInTheDocument();
  await goto("/projects/project-id/runs");
  expect(await screen.findByRole("link", { name: "run-id" })).toHaveAttribute(
    "href",
    "#/runs/run-id",
  );
});

test("loading and empty states", async () => {
  let finish: (data: unknown) => void = () => {};
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<App />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  await act(async () => finish(response(page([]))));
  expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
});

test("API errors never echo server credentials or provider internals", async () => {
  fetcher.mockResolvedValue(
    response(
      { detail: "postgresql://user:secret@host/db hidden reasoning" },
      500,
    ),
  );
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
  expect(document.body).not.toHaveTextContent("secret@host");
  expect(document.body).not.toHaveTextContent("hidden reasoning");
});

test("renders separate statuses, metric denominators, missing values and filters", async () => {
  await goto("/runs/run-id");
  render(<App />);
  expect(await screen.findByText("Scoreable pass rate")).toBeInTheDocument();
  expect(screen.getByText("50.0%")).toBeInTheDocument();
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  const table = screen.getByRole("table", { name: "Case results" });
  expect(within(table).getByText("completed")).toBeInTheDocument();
  expect(within(table).getByText("failed")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter this page"), {
    target: { value: "error" },
  });
  expect(within(table).queryByText("completed")).not.toBeInTheDocument();
  expect(within(table).getByText("error")).toBeInTheDocument();
  expect(within(table).getByRole("link")).toHaveAttribute(
    "href",
    "#/results/error-id",
  );
});

test("orders trace events and confirms a new replay without changing the original route", async () => {
  routes["/api/results/result-id/replay"] = { ...run, id: "replay-run" };
  await goto("/results/result-id");
  render(<App />);
  expect(await screen.findByText("1. model request")).toBeInTheDocument();
  const summaries = [...document.querySelectorAll(".timeline summary")].map(
    (node) => node.textContent,
  );
  expect(summaries).toEqual(["1. model request", "2. model response"]);
  fireEvent.click(screen.getByRole("button", { name: "Replay this case" }));
  expect(fetcher).not.toHaveBeenCalledWith(
    "/api/results/result-id/replay",
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("group", { name: "Confirm replay" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Replay this case" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm replay" }));
  expect(
    await screen.findByRole("link", { name: "Inspect replay run" }),
  ).toHaveAttribute("href", "#/runs/replay-run");
  expect(window.location.hash).toBe("#/results/result-id");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/results/result-id/replay",
    expect.objectContaining({ method: "POST", body: "{}" }),
  );
});

test("replay errors are visible and successful results have no replay action", async () => {
  await goto("/results/result-id");
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Replay this case" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm replay" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Resource not found",
  );
  routes["/api/results/success"] = {
    ...result,
    id: "success",
    evaluation_outcome: "passed",
  };
  await goto("/results/success");
  await screen.findByText("passed");
  expect(
    screen.queryByRole("button", { name: "Replay this case" }),
  ).not.toBeInTheDocument();
});

test("compatible comparison shows deltas and all classifications", async () => {
  routes["/api/runs/base/compare/candidate"] = {
    baseline: metrics,
    candidate: metrics,
    identical_case_set: false,
    pricing_changed: false,
    deltas: {
      total_tokens: { absolute: null, percent: null },
      execution_errors: { absolute: "0", percent: "0" },
    },
    cases: ["regressed", "improved", "unchanged", "unmatched"].map(
      (classification, index) => ({
        test_case_id: `case-${index}`,
        classification,
        baseline_result_id: "old",
        candidate_result_id: "new",
      }),
    ),
  };
  await goto("/compare/base/candidate");
  render(<App />);
  expect(await screen.findByText(/Case sets differ/)).toBeInTheDocument();
  for (const kind of ["regressed", "improved", "unchanged", "unmatched"])
    expect(
      screen.getByRole("heading", { name: `${kind} (1)` }),
    ).toBeInTheDocument();
  expect(
    screen.getByRole("columnheader", { name: "Relative delta (%)" }),
  ).toBeInTheDocument();
});

test("incompatible comparisons display conflict without metrics", async () => {
  fetcher.mockResolvedValue(response({}, 409));
  await goto("/compare/base/unrelated");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Incompatible");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("creates a pending run from a dataset", async () => {
  routes["/api/runs"] = run;
  await goto("/datasets/dataset-id");
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Agent configuration UUID"), {
    target: { value: "agent-id" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create evaluation run" }),
  );
  await waitFor(() => expect(window.location.hash).toBe("#/runs/run-id"));
  expect(fetcher).toHaveBeenCalledWith(
    "/api/runs",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        project_id: "project-id",
        dataset_id: "dataset-id",
        agent_configuration_id: "agent-id",
      }),
    }),
  );
});
