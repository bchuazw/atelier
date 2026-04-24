// Local dev: Vite dev server proxies /api → :8000 (see vite.config.ts).
// Hosted: set VITE_API_BASE=https://<api-host>/api/v1 at build time so the
// static frontend talks to the deployed backend directly.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") || "/api/v1";

export type Position = { x: number; y: number };

export type NodeDTO = {
  id: string;
  parent_id: string | null;
  type: "seed" | "variant" | "feedback" | "critic" | "pipeline" | "live" | "code";
  title: string | null;
  summary: string | null;
  build_status: "pending" | "building" | "ready" | "error";
  model_used: string | null;
  position: Position;
  sandbox_url: string | null;
  created_at: string;
  is_checkpoint?: boolean;
};

export type EdgeDTO = {
  id: string;
  from: string;
  to: string;
  type: string;
  prompt_text: string | null;
};

export type ProjectDTO = {
  id: string;
  name: string;
  seed_url: string | null;
  working_node_id: string | null;
  created_at?: string;
  context?: string;
  active_checkpoint_id?: string | null;
  archived_count?: number;
  total_count?: number;
};

export type TreeDTO = {
  project: ProjectDTO;
  nodes: NodeDTO[];
  edges: EdgeDTO[];
};

export type ForkChildDTO = {
  node_id: string;
  edge_id: string;
  title: string | null;
  summary: string | null;
  build_status: string;
  sandbox_url: string | null;
  model_used: string;
  token_usage: Record<string, number>;
};

export type MediaChildDTO = {
  node_id: string;
  edge_id: string;
  title: string | null;
  summary: string | null;
  build_status: string;
  sandbox_url: string | null;
  image_prompt: string;
  media_url: string;
  media_is_mock: boolean;
  model_used: string;
  token_usage: Record<string, unknown>;
};

export type MediaJobDTO = { job_id: string; stream_url: string };

export type MediaEventType =
  | "job-started"
  | "drafting-prompt"
  | "prompt-drafted"
  | "node-allocated"
  | "rendering-media"
  | "media-rendered"
  | "rewriting-html"
  | "html-rewritten"
  | "uploading"
  | "uploaded"
  | "node-ready"
  | "error"
  | "done";

export type MediaEvent = { type: MediaEventType; ts: number; data: Record<string, any> };

export type MergeChildDTO = {
  node_id: string;
  primary_edge_id: string;
  contribution_edge_id: string;
  title: string | null;
  summary: string | null;
  build_status: string;
  sandbox_url: string | null;
  model_used: string;
  token_usage: Record<string, unknown>;
};

export type MergeEventType =
  | "job-started"
  | "merging"
  | "merged"
  | "uploading"
  | "uploaded"
  | "node-ready"
  | "error"
  | "done";

export type MergeEvent = { type: MergeEventType; ts: number; data: Record<string, any> };

export type StyleAspect = "typography" | "palette" | "layout" | "copy" | "all";

export type ModelId = "haiku" | "sonnet" | "opus";

export type FeedbackItemDTO = {
  id: string;
  area: string;
  change: string;
  rationale: string;
};

export type FeedbackAnalyzeDTO = {
  items: FeedbackItemDTO[];
  model_used: string;
  token_usage: Record<string, number>;
};

export type CriticItemDTO = {
  id: string;
  category: string;
  suggestion: string;
  rationale: string;
  severity: "low" | "medium" | "high";
};

export type CriticsAnalyzeDTO = {
  critics: CriticItemDTO[];
  model_used: string;
  token_usage: Record<string, number>;
};

export type TemplateManifestEntry = {
  id: string;
  name: string;
  tagline: string;
  file: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => request<ProjectDTO[]>("/projects"),
  createProject: (
    body: { name: string; seed_url?: string; seed_html?: string } | string,
    seed_url?: string
  ) =>
    request<ProjectDTO>("/projects", {
      method: "POST",
      body: JSON.stringify(
        typeof body === "string" ? { name: body, seed_url } : body
      ),
    }),
  getTree: (projectId: string, includeArchived = false) =>
    request<TreeDTO>(
      `/projects/${projectId}/tree${includeArchived ? "?include_archived=true" : ""}`
    ),
  deleteProject: (projectId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}`, { method: "DELETE" }),
  patchProject: (
    projectId: string,
    body: { context?: string; active_checkpoint_id?: string; clear_checkpoint?: boolean }
  ) =>
    request<{ ok: boolean; context: string; active_checkpoint_id: string | null }>(
      `/projects/${projectId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  fork: (
    parentId: string,
    prompt: string,
    model = "sonnet",
    n = 1,
    shootout = false
  ) =>
    request<ForkChildDTO[]>(`/nodes/${parentId}/fork`, {
      method: "POST",
      body: JSON.stringify({ prompt, model, n, shootout }),
    }),
  enqueueForkJob: (parentId: string, body: { prompt: string; model?: ModelId }) =>
    request<MediaJobDTO>(`/nodes/${parentId}/fork/jobs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generateMedia: (
    parentId: string,
    body: {
      kind: "image" | "video";
      user_intent?: string;
      image_model?: string;
      video_model?: string;
      aspect?: string;
    }
  ) =>
    request<MediaChildDTO>(`/nodes/${parentId}/media`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Async streaming path — enqueues a job and returns the SSE stream URL.
  enqueueMediaJob: (
    parentId: string,
    body: {
      kind: "image" | "video";
      user_intent?: string;
      image_model?: string;
      video_model?: string;
      aspect?: string;
    }
  ) =>
    request<MediaJobDTO>(`/nodes/${parentId}/media/jobs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Merge: take two variants and synthesize a new one. `target_id` is the
  // base (non-listed aspects preserved); `source_id` contributes the listed
  // aspects. Default model = opus.
  enqueueMergeJob: (
    targetId: string,
    body: { source_id: string; aspects: StyleAspect[]; model?: string; user_note?: string }
  ) =>
    request<MediaJobDTO>(`/nodes/${targetId}/merge/jobs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  feedbackAnalyze: (nodeId: string, body: { message: string; model?: ModelId }) =>
    request<FeedbackAnalyzeDTO>(`/nodes/${nodeId}/feedback/analyze`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  criticsAnalyze: (
    nodeId: string,
    body: { theme: string; aspects?: string[]; model?: ModelId }
  ) =>
    request<CriticsAnalyzeDTO>(`/nodes/${nodeId}/critics/analyze`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchNode: (nodeId: string, body: Partial<{ position_x: number; position_y: number; title: string }>) =>
    request<{ ok: boolean }>(`/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getAncestors: (nodeId: string) =>
    request<{ chain: { id: string; title: string | null; type: string }[] }>(`/nodes/${nodeId}/ancestors`),
  setApiKey: (api_key: string) =>
    request<{ ok: boolean }>("/settings/api-key", {
      method: "POST",
      body: JSON.stringify({ api_key }),
    }),
  getStatus: () =>
    request<{ has_api_key: boolean; sandbox_url: string; models_available: Record<string, string> }>(
      "/settings/status"
    ),
};

/**
 * Subscribe to an SSE job stream. Generic over event payload type;
 * MediaEvent and MergeEvent are the two concrete shapes.
 * Returns a cleanup function that closes the EventSource.
 */
export function subscribeToJob<TChild = MediaChildDTO>(
  streamUrl: string,
  onEvent: (ev: { type: string; ts: number; data: any }) => void,
  onFinal?: (result: { ok: boolean; child?: TChild; error?: string }) => void
): () => void {
  const absolute =
    streamUrl.startsWith("http") || !import.meta.env.VITE_API_BASE
      ? streamUrl
      : new URL(streamUrl, import.meta.env.VITE_API_BASE).toString();

  const es = new EventSource(absolute);
  let finalResult: { ok: boolean; child?: TChild; error?: string } = { ok: false };
  let finalized = false;

  es.onmessage = (raw) => {
    try {
      const ev = JSON.parse(raw.data);
      onEvent(ev);
      if (ev.type === "node-ready") {
        finalResult = { ok: true, child: ev.data as TChild };
      } else if (ev.type === "error") {
        finalResult = { ok: false, error: ev.data?.message ?? "unknown error" };
      } else if (ev.type === "done") {
        finalized = true;
        es.close();
        onFinal?.(finalResult);
      }
    } catch (err) {
      console.error("SSE parse error", err, raw.data);
    }
  };
  es.onerror = () => {
    if (finalized) return;
    finalized = true;
    es.close();
    if (!finalResult.error) finalResult = { ok: false, error: "SSE connection error" };
    onFinal?.(finalResult);
  };
  return () => {
    if (!finalized) {
      finalized = true;
      es.close();
    }
  };
}

// Legacy alias kept for MediaDialog — typed specifically for Media.
export function subscribeToMediaJob(
  streamUrl: string,
  onEvent: (ev: MediaEvent) => void,
  onFinal?: (result: { ok: boolean; child?: MediaChildDTO; error?: string }) => void
): () => void {
  // streamUrl from the API is like "/api/v1/media/jobs/<id>/stream".
  // In local dev the Vite proxy forwards /api/*; in hosted mode we need the
  // absolute URL prefixed with VITE_API_BASE's origin.
  const absolute =
    streamUrl.startsWith("http") || !import.meta.env.VITE_API_BASE
      ? streamUrl
      : new URL(streamUrl, import.meta.env.VITE_API_BASE).toString();

  const es = new EventSource(absolute);
  let finalResult: { ok: boolean; child?: MediaChildDTO; error?: string } = { ok: false };
  let finalized = false;

  es.onmessage = (raw) => {
    try {
      const ev = JSON.parse(raw.data) as MediaEvent;
      onEvent(ev);
      if (ev.type === "node-ready") {
        finalResult = { ok: true, child: ev.data as unknown as MediaChildDTO };
      } else if (ev.type === "error") {
        finalResult = { ok: false, error: (ev.data as any)?.message ?? "unknown error" };
      } else if (ev.type === "done") {
        finalized = true;
        es.close();
        onFinal?.(finalResult);
      }
    } catch (err) {
      console.error("SSE parse error", err, raw.data);
    }
  };
  es.onerror = () => {
    if (finalized) return;
    finalized = true;
    es.close();
    if (!finalResult.error) finalResult = { ok: false, error: "SSE connection error" };
    onFinal?.(finalResult);
  };
  return () => {
    if (!finalized) {
      finalized = true;
      es.close();
    }
  };
}
