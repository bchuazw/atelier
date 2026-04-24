import { useEffect, useMemo, useRef, useState } from "react";
import { X, Monitor, Tablet, Smartphone, FlipHorizontal } from "lucide-react";
import clsx from "clsx";
import { useUI } from "@/lib/store";

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORT_WIDTH: Record<Viewport, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

export default function BeforeAfterViewer() {
  const { nodes, compare, viewerOpen, closeViewer, setCompareA, setCompareB } = useUI();
  const [divider, setDivider] = useState(50); // 0–100 %
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [overlayMode, setOverlayMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const nodeA = useMemo(() => nodes.find((n) => n.id === compare.a), [nodes, compare.a]);
  const nodeB = useMemo(() => nodes.find((n) => n.id === compare.b), [nodes, compare.b]);

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
      if (e.key.toLowerCase() === "o") setOverlayMode((v) => !v);
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
          <span className="text-zinc-400">|</span>
          <div className="flex items-center gap-2">
            <span className="text-cyan-300 font-medium">A:</span>
            <span className="text-zinc-800">{nodeA?.title || "none"}</span>
            <button
              className="text-[10px] text-zinc-500 hover:text-zinc-700"
              onClick={() => setCompareA(null)}
            >
              unpin
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-cyan-300 font-medium">B:</span>
            <span className="text-zinc-800">{nodeB?.title || "none"}</span>
            <button
              className="text-[10px] text-zinc-500 hover:text-zinc-700"
              onClick={() => setCompareB(null)}
            >
              unpin
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <VPButton active={viewport === "desktop"} onClick={() => setViewport("desktop")}>
            <Monitor className="w-4 h-4" />
          </VPButton>
          <VPButton active={viewport === "tablet"} onClick={() => setViewport("tablet")}>
            <Tablet className="w-4 h-4" />
          </VPButton>
          <VPButton active={viewport === "mobile"} onClick={() => setViewport("mobile")}>
            <Smartphone className="w-4 h-4" />
          </VPButton>
          <div className="w-2" />
          <VPButton active={overlayMode} onClick={() => setOverlayMode((v) => !v)} title="Toggle overlay mode (O)">
            <FlipHorizontal className="w-4 h-4" />
          </VPButton>
        </div>
      </div>

      {/* Viewport */}
      <div className="flex-1 flex items-center justify-center overflow-auto bg-white p-4">
        <div
          ref={containerRef}
          className="relative bg-stone-50 shadow-2xl"
          style={{ width: widthPx, height: "min(900px, calc(100vh - 120px))" }}
        >
          {spaceHeld ? (
            // Fullscreen single-panel flip mode: hold Space to see only A (release to compare)
            <iframe
              src={nodeA?.sandbox_url || "about:blank"}
              className="absolute inset-0 w-full h-full bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
              title="A"
            />
          ) : overlayMode ? (
            <>
              <iframe
                src={nodeA?.sandbox_url || "about:blank"}
                className="absolute inset-0 w-full h-full bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
                title="A-under"
              />
              <div
                className="absolute top-0 left-0 h-full overflow-hidden"
                style={{ width: `${divider}%` }}
              >
                <iframe
                  src={nodeB?.sandbox_url || "about:blank"}
                  className="bg-white"
                  style={{ width: `${widthPx}px`, height: "100%" }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
                  title="B-over"
                />
              </div>
            </>
          ) : (
            <>
              <div
                className="absolute top-0 left-0 h-full overflow-hidden border-r border-zinc-200"
                style={{ width: `${divider}%` }}
              >
                <iframe
                  src={nodeA?.sandbox_url || "about:blank"}
                  className="bg-white"
                  style={{ width: `${widthPx}px`, height: "100%" }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
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
                    width: `${widthPx}px`,
                    height: "100%",
                    marginLeft: `-${(divider / 100) * widthPx}px`,
                  }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
                  title="B"
                />
              </div>
            </>
          )}

          {/* Divider handle */}
          {!spaceHeld && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-amber-400/80 hover:bg-amber-300 cursor-ew-resize z-10"
              style={{ left: `calc(${divider}% - 2px)` }}
              onMouseDown={onDividerDrag}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 w-6 h-12 rounded-full bg-amber-400 text-black flex items-center justify-center shadow-lg">
                ⋮⋮
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom status */}
      <div className="px-4 py-1.5 bg-stone-50 border-t border-zinc-200 text-[11px] text-zinc-500 flex items-center justify-between">
        <div>
          Hold <kbd className="px-1 bg-zinc-100 rounded">Space</kbd> to flip A fullscreen.
          Press <kbd className="px-1 bg-zinc-100 rounded">O</kbd> for overlay mode.
          Press <kbd className="px-1 bg-zinc-100 rounded">1/2/3</kbd> for viewports.
        </div>
        <div>
          {widthPx}px — divider {Math.round(divider)}%
        </div>
      </div>
    </div>
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
        active ? "bg-amber-500 text-black" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
      )}
    >
      {children}
    </button>
  );
}
