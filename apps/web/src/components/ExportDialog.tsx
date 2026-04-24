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

export default function ExportDialog() {
  const { exportDialogOpen, exportNodeId, closeExport, nodes } = useUI();
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const node = nodes.find((n) => n.id === exportNodeId) || null;

  useEffect(() => {
    if (!exportDialogOpen || !exportNodeId) {
      setData(null);
      setLoading(false);
      setError(null);
      setCopied(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(
      (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") +
        `/nodes/${exportNodeId}/export` ||
        `/api/v1/nodes/${exportNodeId}/export`
    )
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then(setData)
      .catch((e: any) => setError(e?.message || "Export failed"))
      .finally(() => setLoading(false));
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
          <button onClick={closeExport} className="text-zinc-500 hover:text-zinc-900">
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
              <Download className="w-4 h-4" /> Download .html
            </button>
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
