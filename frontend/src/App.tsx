import { useEffect, useSyncExternalStore } from "react";
import { Projects, Overview, Datasets, DatasetView } from "./project-views";
import { Runs, RunView, CompareView } from "./run-views";
import { TraceView } from "./trace-view";
const subscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
function Route({ route }: { route: string }) {
  const [path, query] = route.split("?"),
    parts = path.split("/").filter(Boolean);
  const offset = Math.max(
    0,
    Number(new URLSearchParams(query).get("offset")) || 0,
  );
  if (!parts.length) return <Projects offset={offset} />;
  if (parts[0] === "projects" && parts[1]) {
    if (parts[2] === "datasets")
      return <Datasets id={parts[1]} offset={offset} />;
    if (parts[2] === "runs") return <Runs id={parts[1]} offset={offset} />;
    return <Overview id={parts[1]} offset={offset} />;
  }
  if (parts[0] === "datasets" && parts[1])
    return <DatasetView id={parts[1]} offset={offset} />;
  if (parts[0] === "runs" && parts[1])
    return <RunView id={parts[1]} offset={offset} />;
  if (parts[0] === "results" && parts[1]) return <TraceView id={parts[1]} />;
  if (parts[0] === "compare" && parts[1] && parts[2])
    return <CompareView baseline={parts[1]} candidate={parts[2]} />;
  return (
    <>
      <h1>Page not found</h1>
      <a href="#/">Return to projects</a>
    </>
  );
}
export default function App() {
  const route = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1) || "/",
  );
  useEffect(() => {
    document.getElementById("main")?.focus();
  }, [route]);
  return (
    <>
      <button
        className="skip"
        onClick={() => document.getElementById("main")?.focus()}
      >
        Skip to content
      </button>
      <header>
        <a className="brand" href="#/">
          Benchwarden
        </a>
        <span>Agent evaluation & reliability</span>
        <nav aria-label="Main">
          <a href="#/">Projects</a>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            API schema
          </a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Route key={route} route={route} />
      </main>
      <footer>
        Offline deterministic evaluation · Execution and scoring remain separate
      </footer>
    </>
  );
}
