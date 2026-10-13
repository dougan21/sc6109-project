import type {
  AgentsView,
  Batch,
  Info,
  Intent,
  Metrics,
  StateEvent,
} from "../types";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    text: string,
  ) {
    super(text);
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "API_UNAVAILABLE",
      "Relayer is unavailable. Start the backend or check the local proxy.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      result.error?.code || "API_ERROR",
      result.error?.message || `HTTP ${response.status}`,
    );
  return result as T;
}
const query = (runId: string, offset: number) =>
  `?limit=25&offset=${offset}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}`;
export const api = {
  info: () => request<Info>("/info"),
  health: () =>
    request<{
      status: string;
      mode: string;
      coordinator?: { lastError?: string };
    }>("/health"),
  agents: (owner: string) =>
    request<AgentsView & { owner: string }>(
      `/agents?owner=${encodeURIComponent(owner)}`,
    ),
  intents: (runId: string, offset: number) =>
    request<{ intents: Intent[] }>(`/intents${query(runId, offset)}`),
  intent: (id: string) =>
    request<{ intent: Intent; events: StateEvent[] }>(
      `/intents/${encodeURIComponent(id)}`,
    ),
  batches: (runId: string, offset: number) =>
    request<{ batches: Batch[] }>(`/batches${query(runId, offset)}`),
  batch: (id: string) =>
    request<{ batch: Batch }>(`/batches/${encodeURIComponent(id)}`),
  metrics: (runId: string) =>
    request<Metrics>(
      `/metrics?runId=${encodeURIComponent(runId || "default")}`,
    ),
};
