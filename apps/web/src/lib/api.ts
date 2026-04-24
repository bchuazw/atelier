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
  createProject: (name: string, seed_url?: string) =>
    request<ProjectDTO>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, seed_url }),
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
