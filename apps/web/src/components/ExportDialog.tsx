import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  Copy,
  Check,
  Download,
  ExternalLink,
  FileCode,
  Image as ImageIcon,
  Globe,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";

type ExportData = {
  node_id: string;
  title: string | null;
  summary: string | null;
  html: string;
  html_size_bytes: number;
  media_assets: { relative_path: string; public_url: string; size_bytes: number }[];
  sandbox_url: string;
  lineage: { id: string; title: string | null; type: string; model_used: string | null }[];
};

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function relativeTime(iso: string): string {
  // Server returns naive UTC ISO strings (no Z suffix) — append Z so
  // `new Date()` doesn't interpret it as local time and produce a wrong
  // delta when the user's timezone isn't UTC.
  const stamp = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  const t = new Date(stamp).getTime();
  if (Number.isNaN(t)) return "just now";
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

type PublishedState = { slug: string; public_url: string; published_at: string };

export default function ExportDialog() {
  const { exportDialogOpen, exportNodeId, closeExport, nodes } = useUI();
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Publish-to-URL (beta) — separate state so a publish failure doesn't
  // wipe the export view, and a publish-in-flight doesn't block the
  // existing Copy/Download path.
  const [published, setPublished] = useState<PublishedState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const node = nodes.find((n) => n.id === exportNodeId) || null;

  useEffect(() => {
    if (!exportDialogOpen || !exportNodeId) {
      setData(null);
      setLoading(false);
      setError(null);
      setCopied(false);
      setPublished(null);
      setPublishing(false);
      setPublishError(null);
      setUrlCopied(false);
      return;
    }
    setLoading(true);
    setError(null);
    // Earlier this fell through to literal "undefined/nodes/<id>/export" when
    // VITE_API_BASE was not set, because operator precedence consumed the
    // ?? fallback before the concatenation rather than after — Vite then
    // returned its SPA index.html and JSON.parse choked on `<!doctype`.
    const base =
      (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") || "/api/v1";
    fetch(`${base}/nodes/${exportNodeId}/export`)
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then(setData)
      .catch((e: any) => setError(e?.message || "Export failed"))
      .finally(() => setLoading(false));
    // Fetch existing published state in parallel — if the user already
    // published this variant we want to surface the URL immediately
    // instead of making them click "Publish" again.
    api
      .getPublishedState(exportNodeId)
      .then((state) => setPublished(state))
      .catch(() => {
        // Ignore — published state is best-effort. If the API is down the
        // export view above will surface that error path; if the network
        // recovers the user can still click Publish to retry.
      });
  }, [exportDialogOpen, exportNodeId]);

  if (!exportDialogOpen || !node) return null;

  async function copyHtml() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e: any) {
      setError("Clipboard copy failed (browser permission?). Use Download instead.");
    }
  }

  function downloadHtml() {
    if (!data) return;
    const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = (data.title || "atelier-variant").replace(/[^a-z0-9-_]+/gi, "-");
    a.download = `${safeTitle}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadZip() {
    if (!exportNodeId) return;
    const base =
      (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") || "/api/v1";
    // Use a regular anchor so the browser handles the Content-Disposition.
    const a = document.createElement("a");
    a.href = `${base}/nodes/${exportNodeId}/export/zip`;
    a.click();
  }

  async function publish() {
    if (!exportNodeId) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await api.publishNode(exportNodeId);
      setPublished(result);
    } catch (e: any) {
      // Most likely cause locally: the sandbox-server (which serves the
      // published URL) isn't running. The publish itself succeeded API-side
      // — surface the message so the user can act on it.
      setPublishError(e?.message || "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function copyPublishedUrl() {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(published.public_url);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1800);
    } catch {
      setPublishError("Clipboard copy failed (browser permission?).");
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4 atelier-dialog-backdrop">
      <div className="atelier-dialog-panel w-full max-w-3xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="text-base font-medium">Export this variant</h2>
              <p className="text-[11px] text-zinc-500">
                Copy the HTML into Cursor / VS Code, or download it as a file.
                Media assets (if any) are listed below so you can grab them too.
              </p>
            </div>
          </div>
          <button onClick={closeExport} className="text-zinc-500 hover:text-zinc-900" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[12px] flex items-center gap-2 text-zinc-500 flex-wrap">
            <span>Variant:</span>
            <span className="text-amber-600 font-medium">{node.title || "Untitled"}</span>
            {node.model_used && (
              <span className="font-mono text-[10px] text-zinc-400">· {node.model_used}</span>
            )}
            {data && (
              <span className="text-zinc-400">· {humanBytes(data.html_size_bytes)} of HTML</span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading export…</span>
            </div>
          ) : error ? (
            <div className="text-xs text-rose-500 bg-rose-50 border border-rose-300 rounded px-3 py-2">
              {error}
            </div>
          ) : data ? (
            <>
              {/* Publish-to-URL (beta) — sits above the existing
                  Copy/Download section because for marketing users this
                  is the primary action; export is the fallback. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-amber-600" />
                    <span className="text-[12px] font-medium text-zinc-800">
                      Publish to a public URL
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
                      beta
                    </span>
                  </div>
                  {published && (
                    <span className="text-[11px] text-zinc-500">
                      published {relativeTime(published.published_at)}
                    </span>
                  )}
                </div>

                {published ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <code
                        className="flex-1 min-w-0 truncate font-mono text-[11px] bg-white border border-zinc-200 rounded px-2 py-1.5 text-zinc-700"
                        title={published.public_url}
                      >
                        {published.public_url}
                      </code>
                      <button
                        onClick={copyPublishedUrl}
                        className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded bg-white border border-zinc-300 hover:border-zinc-500 text-zinc-700"
                        title="Copy URL"
                      >
                        {urlCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {urlCopied ? "Copied" : "Copy"}
                      </button>
                      <a
                        href={published.public_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded bg-white border border-zinc-300 hover:border-zinc-500 text-zinc-700"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </a>
                      <button
                        onClick={publish}
                        disabled={publishing}
                        className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50"
                        title="Re-publish — overwrites the existing URL with the latest variant content"
                      >
                        {publishing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Re-publish
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Paste this URL into your marketing tool. Re-publishing overwrites the same URL with the current variant — no analytics, A/B routing, or auth yet.
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={publish}
                      disabled={publishing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50"
                    >
                      {publishing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Globe className="w-4 h-4" />
                      )}
                      {publishing ? "Publishing…" : "Publish to a public URL"}
                    </button>
                    <span className="text-[11px] text-zinc-500">
                      Get a stable link you can paste into a marketing tool.
                    </span>
                  </div>
                )}

                {publishError && (
                  <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                    {publishError}
                  </div>
                )}
              </div>

              {/* HTML code block */}
              <div className="relative">
                <pre className="bg-white border border-zinc-200 rounded-lg p-3 text-[11px] font-mono leading-snug max-h-[340px] overflow-auto text-zinc-800 whitespace-pre-wrap">
                  {data.html.slice(0, 8000)}
                  {data.html.length > 8000 && (
                    <span className="text-zinc-400 italic">
                      {"\n\n… "}{humanBytes(data.html.length - 8000)} more — use Copy or Download to get the full document
                    </span>
                  )}
                </pre>
              </div>

              {/* Media assets (if any) */}
              {data.media_assets.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Referenced assets ({data.media_assets.length})
                  </div>
                  <div className="space-y-1">
                    {data.media_assets.map((a) => (
                      <div
                        key={a.relative_path}
                        className="flex items-center justify-between px-3 py-1.5 bg-white border border-zinc-200 rounded text-[12px]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ImageIcon className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                          <span className="font-mono text-zinc-700 truncate">{a.relative_path}</span>
                          <span className="text-zinc-400 text-[10px] flex-shrink-0">
                            {humanBytes(a.size_bytes)}
                          </span>
                        </div>
                        <a
                          href={a.public_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-600 hover:text-amber-700 flex-shrink-0"
                          title="Open in new tab"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Paste the HTML into your editor. These asset URLs are publicly reachable — download them, or replace references with your own media.
                  </p>
                </div>
              )}

              {/* Lineage breadcrumb */}
              {data.lineage.length > 1 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Lineage
                  </div>
                  <div className="flex items-center gap-1 flex-wrap text-[11px]">
                    {data.lineage.map((l, i) => (
                      <span key={l.id} className="flex items-center gap-1">
                        <span
                          className={clsx(
                            "px-1.5 py-0.5 rounded border",
                            i === data.lineage.length - 1
                              ? "bg-amber-100 border-amber-300 text-amber-700"
                              : "bg-white border-zinc-200 text-zinc-500"
                          )}
                        >
                          {l.title || l.type}
                        </span>
                        {i < data.lineage.length - 1 && <span className="text-zinc-300">→</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-white/60">
          <a
            href={data?.sandbox_url}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              "text-[12px] flex items-center gap-1.5",
              data?.sandbox_url ? "text-amber-600 hover:text-amber-700" : "text-zinc-400 cursor-not-allowed"
            )}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open rendered page in new tab
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={closeExport}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
            >
              Close
            </button>
            <button
              onClick={downloadHtml}
              disabled={!data}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-white border border-zinc-300 hover:border-zinc-500 text-zinc-700 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> .html
            </button>
            {data && data.media_assets.length > 0 && (
              <button
                onClick={downloadZip}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-white border border-zinc-300 hover:border-zinc-500 text-zinc-700"
                title="Download the full tree (HTML + media assets) as a zip"
              >
                <Download className="w-4 h-4" /> .zip ({data.media_assets.length + 1} files)
              </button>
            )}
            <button
              onClick={copyHtml}
              disabled={!data}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy HTML"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
