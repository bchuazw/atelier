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
  // Set by the fork SSE path; surfaced on the variant card so users can
  // see what concretely changed + which Genspark references the variant
  // was grounded against.
  reasoning?: {
    prompt?: string;
    reasoning?: string;
    references?: { url: string; title?: string }[];
    changes?: string[];
  } | null;
  // Per-variant Anthropic token usage. Used by the card to render a
  // "~$0.012" cost pill so users see what each fork cost without doing
  // mental math against the session total.
  token_usage?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_creation?: number;
  } | null;
};

export type EdgeDTO = {
  id: string;
  from: string;
  to: string;
  type: string;
  prompt_text: string | null;
};

// Discriminator for the input control rendered in ContextPanel + how the
// fork prompt frames each constraint. Legacy pins persisted before this
// field existed parse as `kind: "text"` (server default), so older projects
// keep working without migration.
export type StylePinKind = "color" | "dimension" | "enum" | "font" | "text";
export type StylePin = {
  prop: string;
  value: string;
  // Optional on the wire so older saved pins (no `kind`) still validate;
  // the server fills in `"text"` when missing.
  kind?: StylePinKind;
  // When true, the prompt escalates to "ABSOLUTE / NON-NEGOTIABLE" language
  // and (for color pins) the server runs a one-shot validation re-prompt if
  // the exact value didn't make it into the generated HTML.
  strict?: boolean;
};

export type ProjectDTO = {
  id: string;
  name: string;
  seed_url: string | null;
  working_node_id: string | null;
  created_at?: string;
  context?: string;
  // Structured design constraints injected into every fork prompt as
  // hard "must honor" rules. Lives next to free-form context so users
  // can lock typography / palette / spacing without rewriting them in
  // prose every time.
  style_pins?: StylePin[];
  active_checkpoint_id?: string | null;
  archived_count?: number;
  total_count?: number;
  node_count?: number;
  last_activity?: string | null;
  // Lifetime project cost (USD cents) and optional soft cap. The TopBar
  // shows the running total; ContextPanel sets the cap; the fork endpoints
  // refuse to run when total >= cap. Cents (integer) on the wire so the
  // client never deals with floats. `total_cost_cents` is always present
  // (0 for projects with only a seed); `cost_cap_cents` is null when unset.
  total_cost_cents?: number;
  cost_cap_cents?: number | null;
  // Soft-archive flag. Server returns `false` for legacy projects with no
  // `archived` key in settings. The default `listProjects()` call hides
  // archived rows; pass `includeArchived=true` to fetch them too.
  archived?: boolean;
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

export type CriticReferenceDTO = {
  url: string;
  title: string;
};

export type CriticsAnalyzeDTO = {
  critics: CriticItemDTO[];
  model_used: string;
  token_usage: Record<string, number>;
  grounded?: boolean;
  references?: CriticReferenceDTO[];
};

export type TemplateManifestEntry = {
  id: string;
  name: string;
  tagline: string;
  file: string;
  // One-word vibe tag (e.g. "Premium", "Playful"). Added in Cycle 7 after
  // new users couldn't tell at a glance which template mapped to which
  // aesthetic ambition — templates.json now ships this field.
  vibe?: string;
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
  listProjects: (includeArchived = false) =>
    request<ProjectDTO[]>(
      `/projects${includeArchived ? "?include_archived=true" : ""}`
    ),
  createProject: (
    body:
      | {
          name: string;
          seed_url?: string;
          seed_html?: string;
          // Optional Brand Kit pins, pre-loaded from the New Project dialog.
          // When omitted (the existing fast path), no pins are saved.
          style_pins?: StylePin[];
        }
      | string,
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
    body: {
      context?: string;
      active_checkpoint_id?: string;
      clear_checkpoint?: boolean;
      name?: string;
      style_pins?: StylePin[];
      // USD cents. 0 (or omitted) clears the cap; positive sets it.
      cost_cap_cents?: number | null;
      // Soft-archive toggle. true hides from default recent list; false
      // restores. Persisted in project.settings["archived"].
      archived?: boolean;
    }
  ) =>
    request<{
      ok: boolean;
      name: string;
      context: string;
      style_pins?: StylePin[];
      active_checkpoint_id: string | null;
      cost_cap_cents?: number | null;
      archived?: boolean;
    }>(
      `/projects/${projectId}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  archiveProject: (projectId: string, archived: boolean) =>
    api.patchProject(projectId, { archived }),
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
  enqueueForkJob: (
    parentId: string,
    body: {
      prompt: string;
      model?: ModelId;
      // Optional grounding references — pass these through when applying
      // a Genspark-grounded critique so the new variant card can render
      // "based on aesop.com / awwwards.com" citation chips.
      references?: { url: string; title?: string }[];
    }
  ) =>
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
    body: { theme: string; aspects?: string[]; model?: ModelId; use_grounding?: boolean }
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
  deleteNode: (nodeId: string) =>
    request<{ ok: boolean; deleted: number }>(`/nodes/${nodeId}`, { method: "DELETE" }),
  getAncestors: (nodeId: string) =>
    request<{ chain: { id: string; title: string | null; type: string }[] }>(`/nodes/${nodeId}/ancestors`),
  // Publish-to-URL (beta) — give a variant a stable public-ish URL the
  // user can paste into marketing tools. POST publishes (or re-publishes,
  // overwriting); GET returns the current published metadata or throws on
  // 404 ("never published"). See `routes/nodes.py` for the slug scheme.
  publishNode: (nodeId: string) =>
    request<{ slug: string; public_url: string; published_at: string }>(
      `/nodes/${nodeId}/publish`,
      { method: "POST" }
    ),
  // Componentize-to-React export. One-shot Sonnet rewrite of the variant
  // HTML into a multi-file React + Tailwind project. Typical latency 15-25s,
  // so callers should render a clear "Claude is rewriting…" status.
  exportReact: (nodeId: string) =>
    request<{
      files: Record<string, string>;
      model_used: string;
      token_usage: Record<string, number>;
      cost_cents: number;
    }>(`/nodes/${nodeId}/export/react`, { method: "POST" }),
  getPublishedState: async (nodeId: string) => {
    // The API returns 200 with `{published: false}` when a node has never
    // been published (changed from a 404 that polluted prod console
    // logs). Older deployments may still return 404 — keep that branch
    // for backwards compat. Resolve to null when unpublished so callers
    // can branch cleanly on `state == null`.
    const base =
      (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") || "/api/v1";
    const res = await fetch(`${base}/nodes/${nodeId}/publish`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const body = (await res.json()) as {
      published?: boolean;
      slug: string | null;
      public_url: string | null;
      published_at: string | null;
    };
    if (body.published === false || !body.slug || !body.public_url) return null;
    return {
      slug: body.slug,
      public_url: body.public_url,
      published_at: body.published_at ?? "",
    };
  },
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
      // Forward token usage from any event into the session-usage tally.
      // The backend emits `html-rewritten` (fork), `media-rendered` (hero),
      // `merge-rewritten` (merge) with token_usage payloads.
      if (ev?.data?.token_usage && typeof ev.data.token_usage === "object") {
        const u = ev.data.token_usage as Record<string, number>;
        // Lazy import to avoid circular dep at module load.
        import("./store").then(({ useUI }) => {
          useUI.getState().addUsage({
            input: u.input,
            output: u.output,
            cache_read: u.cache_read,
            cache_creation: u.cache_creation,
          });
        });
      }
      if (ev.type === "node-ready") {
        finalResult = { ok: true, child: ev.data as TChild };
      } else if (ev.type === "cost-capped") {
        // Soft cost cap was hit on the SSE fork path. Surface the
        // persistent banner instead of routing this through the generic
        // error toast — the user needs an explicit jump-to-cap-input
        // affordance, not a transient red strip. We mark the result with
        // a sentinel `cost-capped` so onFinal callers can choose to
        // suppress their own error UI (the banner replaces it).
        const data = ev.data as { total_cost_cents?: number; cost_cap_cents?: number };
        if (
          typeof data?.total_cost_cents === "number" &&
          typeof data?.cost_cap_cents === "number"
        ) {
          import("./store").then(({ useUI }) => {
            useUI.getState().showCostCapBanner({
              total_cost_cents: data.total_cost_cents!,
              cost_cap_cents: data.cost_cap_cents!,
            });
          });
        }
        finalResult = { ok: false, error: "cost-capped" };
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
