import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Monitor,
  Tablet,
  Smartphone,
  Columns,
  Layers,
  SplitSquareHorizontal,
  Microscope,
  ExternalLink,
} from "lucide-react";
import clsx from "clsx";
import { useUI } from "@/lib/store";
import { computeStyleDiff, extractColors, type StyleDiff } from "@/lib/diffStyles";

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORT_WIDTH: Record<Viewport, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

// Each iframe renders its page at the chosen viewport width + this height
// (most landing pages fit in 2000px; we give headroom and let users scroll
// inside the iframe if needed).
const IFRAME_HEIGHT = 2000;

type Mode = "side" | "split" | "overlay";

export default function BeforeAfterViewer() {
  const { nodes, compare, viewerOpen, closeViewer, setCompareA, setCompareB } = useUI();
  const [divider, setDivider] = useState(50); // only used in split mode
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [mode, setMode] = useState<Mode>("side");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<StyleDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 1200, h: 800 });

  const nodeA = useMemo(() => nodes.find((n) => n.id === compare.a), [nodes, compare.a]);
  const nodeB = useMemo(() => nodes.find((n) => n.id === compare.b), [nodes, compare.b]);

  // Diff lens: fetch both variant HTMLs and compute style deltas. Triggered
  // on demand (showDiff toggle) so we don't pay the round-trip when users
  // are just visually comparing in side-by-side mode.
  useEffect(() => {
    if (!showDiff) return;
    if (!nodeA?.sandbox_url || !nodeB?.sandbox_url) return;
    let cancelled = false;
    setDiffLoading(true);
    Promise.all([
      fetch(nodeA.sandbox_url).then((r) => r.text()),
      fetch(nodeB.sandbox_url).then((r) => r.text()),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setDiff(computeStyleDiff(a, b));
      })
      .catch(() => {
        if (!cancelled) setDiff([]);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showDiff, nodeA?.sandbox_url, nodeB?.sandbox_url]);

  useEffect(() => {
    if (!viewerOpen) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeViewer();
      if (e.key === " " && !spaceHeld) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.key === "1") setViewport("desktop");
      if (e.key === "2") setViewport("tablet");
      if (e.key === "3") setViewport("mobile");
      const k = e.key.toLowerCase();
      if (k === "s") setMode("side");
      if (k === "d") setMode("split"); // D for divider
      if (k === "o") setMode("overlay");
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [viewerOpen, spaceHeld, closeViewer]);

  useLayoutEffect(() => {
    if (!viewerOpen) return;
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStageSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [viewerOpen]);

  if (!viewerOpen) return null;

  const onDividerDrag = (e: React.MouseEvent) => {
    const start = e.clientX;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startPct = divider;
    const handle = (ev: MouseEvent) => {
      const delta = ev.clientX - start;
      const pct = Math.max(5, Math.min(95, startPct + (delta / rect.width) * 100));
      setDivider(pct);
    };
    const release = () => {
      window.removeEventListener("mousemove", handle);
      window.removeEventListener("mouseup", release);
    };
    window.addEventListener("mousemove", handle);
    window.addEventListener("mouseup", release);
  };

  const widthPx = VIEWPORT_WIDTH[viewport];

  // Compute the scale for side-by-side: we want both pages to fit the stage
  // without cropping, with a small gap between them. Height is also bounded
  // so the iframe's rendered height doesn't exceed the stage.
  const GAP_PX = 24;
  const PAD_PX = 32;
  const availableW = Math.max(200, stageSize.w - PAD_PX);
  const availableH = Math.max(300, stageSize.h - PAD_PX);
  const sideScale = Math.min(
    (availableW - GAP_PX) / 2 / widthPx,
    availableH / IFRAME_HEIGHT,
    1
  );
  const scaledW = Math.round(widthPx * sideScale);
  const scaledH = Math.round(IFRAME_HEIGHT * sideScale);

  // For split / overlay modes we use a single centered panel. Its height
  // is capped at 900px or the available stage height, whichever is smaller.
  const panelW = widthPx;
  const panelH = Math.min(900, availableH);

  const COMMON_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-pointer-lock";

  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-zinc-200">
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={closeViewer}
            className="flex items-center gap-1 text-zinc-500 hover:text-zinc-900"
          >
            <X className="w-4 h-4" /> Close
          </button>
          <span className="text-zinc-300">|</span>
          <div className="flex items-center gap-2">
            <span className="text-cyan-600 font-medium">A:</span>
            <span className="text-zinc-800 truncate max-w-[200px]">{nodeA?.title || "none"}</span>
            <button
              className="text-[10px] text-zinc-500 hover:text-zinc-700"
              onClick={() => setCompareA(null)}
            >
              unpin
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-cyan-600 font-medium">B:</span>
            <span className="text-zinc-800 truncate max-w-[200px]">{nodeB?.title || "none"}</span>
            <button
              className="text-[10px] text-zinc-500 hover:text-zinc-700"
              onClick={() => setCompareB(null)}
            >
              unpin
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-0.5 bg-zinc-100 rounded-md p-0.5">
            <ModeButton
              active={mode === "side"}
              onClick={() => setMode("side")}
              title="Side by side — both pages full, scaled to fit (S)"
            >
              <Columns className="w-4 h-4" />
              <span className="text-[11px] font-medium">Side by side</span>
            </ModeButton>
            <ModeButton
              active={mode === "split"}
              onClick={() => setMode("split")}
              title="Split with draggable divider — pixel-align two renders (D)"
            >
              <SplitSquareHorizontal className="w-4 h-4" />
              <span className="text-[11px] font-medium">Split</span>
            </ModeButton>
            <ModeButton
              active={mode === "overlay"}
              onClick={() => setMode("overlay")}
              title="Overlay — B fades over A (O)"
            >
              <Layers className="w-4 h-4" />
              <span className="text-[11px] font-medium">Overlay</span>
            </ModeButton>
          </div>

          <span className="text-zinc-300">|</span>

          {/* Viewport toggle */}
          <VPButton active={viewport === "desktop"} onClick={() => setViewport("desktop")} title="Desktop (1)">
            <Monitor className="w-4 h-4" />
          </VPButton>
          <VPButton active={viewport === "tablet"} onClick={() => setViewport("tablet")} title="Tablet (2)">
            <Tablet className="w-4 h-4" />
          </VPButton>
          <VPButton active={viewport === "mobile"} onClick={() => setViewport("mobile")} title="Mobile (3)">
            <Smartphone className="w-4 h-4" />
          </VPButton>

          <span className="text-zinc-300">|</span>

          {/* Diff lens — exposes the typography / palette / spacing /
              effects deltas as a side panel. Toggleable so users can keep
              the visual side-by-side full-width when they want it. */}
          <button
            onClick={() => setShowDiff((v) => !v)}
            title="Diff lens — show what CSS properties changed between A and B"
            className={clsx(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition",
              showDiff
                ? "bg-cyan-500 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            )}
          >
            <Microscope className="w-4 h-4" />
            Diff lens
          </button>
        </div>
      </div>

      {/* Stage + optional diff sidebar */}
      <div className="flex-1 flex overflow-hidden">
      <div ref={stageRef} className="flex-1 overflow-auto bg-zinc-100">
        {mode === "side" && (
          <div className="min-h-full flex items-start justify-center p-4 gap-6">
            <PagePanel
              label="A"
              title={nodeA?.title || "none"}
              src={nodeA?.sandbox_url}
              widthPx={widthPx}
              heightPx={IFRAME_HEIGHT}
              scale={sideScale}
              scaledW={scaledW}
              scaledH={scaledH}
              sandbox={COMMON_IFRAME_SANDBOX}
            />
            <PagePanel
              label="B"
              title={nodeB?.title || "none"}
              src={nodeB?.sandbox_url}
              widthPx={widthPx}
              heightPx={IFRAME_HEIGHT}
              scale={sideScale}
              scaledW={scaledW}
              scaledH={scaledH}
              sandbox={COMMON_IFRAME_SANDBOX}
            />
          </div>
        )}

        {mode === "split" && (
          <div className="min-h-full flex items-center justify-center p-4">
            <div
              ref={containerRef}
              className="relative bg-white shadow-2xl"
              style={{ width: panelW, height: panelH }}
            >
              {spaceHeld ? (
                <iframe
                  src={nodeA?.sandbox_url || "about:blank"}
                  className="absolute inset-0 w-full h-full bg-white"
                  sandbox={COMMON_IFRAME_SANDBOX}
                  title="A"
                />
              ) : (
                <>
                  <div
                    className="absolute top-0 left-0 h-full overflow-hidden border-r border-zinc-200"
                    style={{ width: `${divider}%` }}
                  >
                    <iframe
                      src={nodeA?.sandbox_url || "about:blank"}
                      className="bg-white"
                      style={{ width: `${panelW}px`, height: "100%" }}
                      sandbox={COMMON_IFRAME_SANDBOX}
                      title="A"
                    />
                  </div>
                  <div
                    className="absolute top-0 right-0 h-full overflow-hidden"
                    style={{ width: `${100 - divider}%` }}
                  >
                    <iframe
                      src={nodeB?.sandbox_url || "about:blank"}
                      className="bg-white"
                      style={{
                        width: `${panelW}px`,
                        height: "100%",
                        marginLeft: `-${(divider / 100) * panelW}px`,
                      }}
                      sandbox={COMMON_IFRAME_SANDBOX}
                      title="B"
                    />
                  </div>
                </>
              )}

              {!spaceHeld && (
                <div
                  className="absolute top-0 bottom-0 w-1 bg-cyan-400/80 hover:bg-cyan-300 cursor-ew-resize z-10"
                  style={{ left: `calc(${divider}% - 2px)` }}
                  onMouseDown={onDividerDrag}
                >
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 w-6 h-12 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-lg font-bold">
                    ⋮⋮
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "overlay" && (
          <div className="min-h-full flex items-center justify-center p-4">
            <div
              ref={containerRef}
              className="relative bg-white shadow-2xl"
              style={{ width: panelW, height: panelH }}
            >
              <iframe
                src={nodeA?.sandbox_url || "about:blank"}
                className="absolute inset-0 w-full h-full bg-white"
                sandbox={COMMON_IFRAME_SANDBOX}
                title="A-under"
              />
              <div
                className="absolute top-0 left-0 h-full overflow-hidden"
                style={{ width: `${divider}%` }}
              >
                <iframe
                  src={nodeB?.sandbox_url || "about:blank"}
                  className="bg-white"
                  style={{ width: `${panelW}px`, height: "100%" }}
                  sandbox={COMMON_IFRAME_SANDBOX}
                  title="B-over"
                />
              </div>
              <div
                className="absolute top-0 bottom-0 w-1 bg-cyan-400/80 hover:bg-cyan-300 cursor-ew-resize z-10"
                style={{ left: `calc(${divider}% - 2px)` }}
                onMouseDown={onDividerDrag}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 w-6 h-12 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-lg font-bold">
                  ⋮⋮
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {showDiff && <DiffPanel diff={diff} loading={diffLoading} nodeATitle={nodeA?.title || "A"} nodeBTitle={nodeB?.title || "B"} />}
      </div>

      {/* Bottom status */}
      <div className="px-4 py-1.5 bg-stone-50 border-t border-zinc-200 text-[11px] text-zinc-500 flex items-center justify-between">
        <div>
          {mode === "side" && (
            <>
              Both pages scaled to fit. Press <kbd className="px-1 bg-zinc-100 rounded">D</kbd> for split, <kbd className="px-1 bg-zinc-100 rounded">O</kbd> for overlay.
            </>
          )}
          {mode === "split" && (
            <>
              Drag the divider to compare. Hold <kbd className="px-1 bg-zinc-100 rounded">Space</kbd> to flip A fullscreen. Press <kbd className="px-1 bg-zinc-100 rounded">S</kbd> for side-by-side.
            </>
          )}
          {mode === "overlay" && (
            <>
              Drag the divider to reveal A under B. Press <kbd className="px-1 bg-zinc-100 rounded">S</kbd> for side-by-side.
            </>
          )}{" "}
          <kbd className="px-1 bg-zinc-100 rounded">1/2/3</kbd> for viewports.
        </div>
        <div className="font-mono">
          {viewport} · {widthPx}px
          {mode === "side" && <> · scale {(sideScale * 100).toFixed(0)}%</>}
          {(mode === "split" || mode === "overlay") && <> · divider {Math.round(divider)}%</>}
        </div>
      </div>
    </div>
  );
}

function PagePanel({
  label,
  title,
  src,
  widthPx,
  heightPx,
  scale,
  scaledW,
  scaledH,
  sandbox,
}: {
  label: "A" | "B";
  title: string;
  src: string | null | undefined;
  widthPx: number;
  heightPx: number;
  scale: number;
  scaledW: number;
  scaledH: number;
  sandbox: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 flex-shrink-0">
      <div className="flex items-center gap-2 text-[12px]">
        <span
          className={clsx(
            "inline-flex items-center justify-center w-5 h-5 rounded-full text-white font-bold text-[10px]",
            "bg-cyan-500"
          )}
        >
          {label}
        </span>
        <span className="text-zinc-800 font-medium truncate max-w-[300px]">{title}</span>
      </div>
      <div
        className="bg-white shadow-2xl overflow-hidden border border-zinc-200"
        style={{ width: scaledW, height: scaledH }}
      >
        <iframe
          src={src || "about:blank"}
          sandbox={sandbox}
          title={label}
          style={{
            width: `${widthPx}px`,
            height: `${heightPx}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: 0,
            background: "white",
          }}
        />
      </div>
    </div>
  );
}

function ModeButton({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "flex items-center gap-1 px-2 py-1 rounded transition",
        active ? "bg-white text-cyan-700 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
      )}
    >
      {children}
    </button>
  );
}

function VPButton({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "p-1.5 rounded",
        active ? "bg-cyan-500 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
      )}
    >
      {children}
    </button>
  );
}

const CATEGORY_LABEL: Record<StyleDiff["category"], string> = {
  copy: "Copy",
  tokens: "Tokens",
  structure: "Structure",
  typography: "Typography",
  palette: "Palette",
  spacing: "Spacing",
  effects: "Effects",
  layout: "Layout",
};

const CATEGORY_TONE: Record<StyleDiff["category"], string> = {
  copy: "bg-sky-50 border-sky-300 text-sky-700",
  tokens: "bg-indigo-50 border-indigo-200 text-indigo-800",
  structure: "bg-emerald-50 border-emerald-200 text-emerald-800",
  typography: "bg-amber-50 border-amber-200 text-amber-800",
  palette: "bg-rose-50 border-rose-200 text-rose-800",
  spacing: "bg-cyan-50 border-cyan-200 text-cyan-800",
  effects: "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800",
  layout: "bg-zinc-50 border-zinc-200 text-zinc-700",
};

function DiffPanel({
  diff,
  loading,
  nodeATitle,
  nodeBTitle,
}: {
  diff: StyleDiff[];
  loading: boolean;
  nodeATitle: string;
  nodeBTitle: string;
}) {
  // Group rows by category for the rendered list.
  const grouped = useMemo(() => {
    const map = new Map<StyleDiff["category"], StyleDiff[]>();
    for (const d of diff) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return Array.from(map.entries());
  }, [diff]);

  return (
    <div className="w-[360px] flex-shrink-0 bg-white border-l border-zinc-200 overflow-y-auto">
      <div className="px-4 py-3 border-b border-zinc-200 sticky top-0 bg-white z-10">
        <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          What changed
        </div>
        <div className="text-[12px] text-zinc-700 mt-0.5">
          <span className="font-medium">{nodeATitle}</span>
          <span className="text-zinc-400 mx-1">→</span>
          <span className="font-medium">{nodeBTitle}</span>
        </div>
      </div>
      {loading ? (
        <div className="p-4 text-[12px] text-zinc-500">Computing diff…</div>
      ) : diff.length === 0 ? (
        <div className="p-4 text-[12px] text-zinc-500">
          Nothing changed between A and B. (We diff copy, structure,
          typography, palette, spacing, effects, and a few layout props.)
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {grouped.map(([cat, rows]) => (
            <div key={cat}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
                {CATEGORY_LABEL[cat]} · {rows.length}
              </div>
              <div className="space-y-1.5">
                {rows.map((d, i) => (
                  <DiffRow key={`${d.selector}|${d.property}|${i}`} d={d} cat={cat} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffRow({ d, cat }: { d: StyleDiff; cat: StyleDiff["category"] }) {
  const beforeColors = extractColors(d.before);
  const afterColors = extractColors(d.after);
  // Render swatches for palette diffs and for token diffs whose values
  // resolve to a color literal (e.g. `--brand: #c87050 → #3b5d3a`).
  const showSwatches =
    (cat === "palette" || cat === "tokens") &&
    (beforeColors.length > 0 || afterColors.length > 0);

  // Copy diffs render differently: full text in legible prose (no
  // monospace, no truncation), stacked before → after with strikethrough
  // on the removed side. Marketers scan the words, not selectors.
  if (cat === "copy") {
    return <CopyDiffRow d={d} />;
  }

  return (
    <div
      className={clsx(
        "rounded border px-2 py-1.5 text-[11px]",
        CATEGORY_TONE[cat]
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <code className="font-mono text-[10px] truncate" title={d.selector}>
          {d.selector}
        </code>
        <span className="text-[9px] uppercase tracking-wider opacity-70 flex-shrink-0">
          {d.property}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {showSwatches &&
            beforeColors.slice(0, 2).map((c, i) => (
              <span
                key={`b-${i}`}
                className="inline-block w-3 h-3 rounded border border-zinc-300 flex-shrink-0"
                style={{ background: c }}
                title={c}
              />
            ))}
          <span className="font-mono text-[10px] truncate text-zinc-500">{d.before ?? "—"}</span>
        </div>
        <span className="text-zinc-400">→</span>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {showSwatches &&
            afterColors.slice(0, 2).map((c, i) => (
              <span
                key={`a-${i}`}
                className="inline-block w-3 h-3 rounded border border-zinc-300 flex-shrink-0"
                style={{ background: c }}
                title={c}
              />
            ))}
          <span className="font-mono text-[10px] truncate font-medium">{d.after ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

/** Render a single Copy-category diff. "rewrote" stacks before above
 *  after (strikethrough + dim, then bold); "added" / "removed" show one
 *  side only. The "more" sentinel collapses to a dim italic line. */
function CopyDiffRow({ d }: { d: StyleDiff }) {
  const tone = CATEGORY_TONE.copy;

  if (d.property === "more") {
    return (
      <div className={clsx("rounded border px-2 py-1.5 text-[11px] italic opacity-80", tone)}>
        {d.after ?? "…and more copy changes"}
      </div>
    );
  }

  const labelMap: Record<string, string> = {
    added: "added",
    removed: "removed",
    rewrote: "rewrote",
  };
  const label = labelMap[d.property] ?? d.property;

  return (
    <div className={clsx("rounded border px-2 py-1.5 text-[12px] leading-snug", tone)}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <code className="font-mono text-[10px] opacity-70 truncate" title={d.selector}>
          {d.selector}
        </code>
        <span className="text-[9px] uppercase tracking-wider opacity-70 flex-shrink-0">
          {label}
        </span>
      </div>
      {d.property === "rewrote" ? (
        <div className="space-y-1">
          <div className="line-through opacity-60 break-words">{d.before ?? ""}</div>
          <div className="font-medium break-words">{d.after ?? ""}</div>
        </div>
      ) : d.property === "added" ? (
        <div className="font-medium break-words">{d.after ?? ""}</div>
      ) : (
        <div className="line-through opacity-60 break-words">{d.before ?? ""}</div>
      )}
    </div>
  );
}
