import { useEffect, useState } from "react";
import type { API } from "./api-types";
export type Project = API["ProjectResponse"];
export type Dataset = API["DatasetResponse"];
export type Run = API["RunDetail"];
export type Result = API["CaseResultResponse"];
export type Trace = API["ResultDetail"];
export type Metrics = API["RunMetrics"];
export type Comparison = API["RunComparison"];
export type Page<T> = Omit<API["Page_ProjectResponse_"], "items"> & {
  items: T[];
};

export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      404: "Resource not found.",
      409: "Incompatible records or current state. Historical snapshots and finished executions are required.",
      422: "Invalid identifier or request. Check the selected records.",
    };
    throw new Error(
      messages[response.status] ?? "The service is unavailable. Please retry.",
    );
  }
  return response.json() as Promise<T>;
}
export function useResource<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    request<T>(path, undefined, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({
            error:
              error instanceof Error && error.message.startsWith("Incompatible")
                ? error.message
                : "Could not load this resource. Check the backend and retry.",
          });
      },
    );
    return () => controller.abort();
  }, [path]);
  return state;
}
