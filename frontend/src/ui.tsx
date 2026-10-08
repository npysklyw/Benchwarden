import type { ReactNode } from "react";
import type { Page } from "./api";
import { label, link } from "./utils";
export function Json({ data }: { data: unknown }) {
  return <pre>{JSON.stringify(data, null, 2) ?? "Unavailable"}</pre>;
}
export function Status({ children }: { children: string }) {
  return <span className={`badge ${children}`}>{label(children)}</span>;
}
export function Load<T>({
  state,
  children,
}: {
  state: { data?: T; error?: string };
  children: (data: T) => ReactNode;
}) {
  if (state.error)
    return (
      <div role="alert" className="notice">
        {state.error}{" "}
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  if (!state.data) return <p role="status">Loading…</p>;
  return children(state.data);
}
export function Pager({ page, path }: { page: Page<unknown>; path: string }) {
  return (
    <nav aria-label="Pagination" className="pagination">
      <span>
        {page.total === 0
          ? "No records"
          : `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} of ${page.total}`}
      </span>
      {page.offset > 0 && (
        <a
          href={link(`${path}?offset=${Math.max(0, page.offset - page.limit)}`)}
        >
          Previous
        </a>
      )}
      {page.offset + page.limit < page.total && (
        <a href={link(`${path}?offset=${page.offset + page.limit}`)}>Next</a>
      )}
    </nav>
  );
}
