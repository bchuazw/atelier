// Compute "what changed" between two variant HTML documents — a designer's
// diff lens, not a generic text diff. We focus on the four properties
// designers actually look for when comparing variants:
//
//   1. Typography  — font-family, font-size, font-weight, line-height, letter-spacing
//   2. Palette     — background-color, color, border-color (and the `background` shorthand
//                    so gradients aren't missed)
//   3. Spacing     — padding, margin, gap
//   4. Effects     — box-shadow, border-radius, opacity
//
// We parse every `<style>` block in each document, walk all selectors, and
// emit a flat list of {selector, property, before, after} rows. The viewer
// renders this as a sidebar.

type StyleRule = {
  selector: string;
  decls: Record<string, string>;
};

const TRACKED_PROPS = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background",
  "background-color",
  "border-color",
  "border",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "box-shadow",
  "border-radius",
  "opacity",
  "text-transform",
  "text-align",
  "display",
]);

const CATEGORY_BY_PROP: Record<string, "typography" | "palette" | "spacing" | "effects" | "layout"> = {
  "font-family": "typography",
  "font-size": "typography",
  "font-weight": "typography",
  "line-height": "typography",
  "letter-spacing": "typography",
  "text-transform": "typography",
  "text-align": "typography",
  color: "palette",
  background: "palette",
  "background-color": "palette",
  "border-color": "palette",
  border: "palette",
  padding: "spacing",
  "padding-top": "spacing",
  "padding-right": "spacing",
  "padding-bottom": "spacing",
  "padding-left": "spacing",
  margin: "spacing",
  "margin-top": "spacing",
  "margin-right": "spacing",
  "margin-bottom": "spacing",
  "margin-left": "spacing",
  gap: "spacing",
  "box-shadow": "effects",
  "border-radius": "effects",
  opacity: "effects",
  display: "layout",
};

export type StyleDiff = {
  selector: string;
  property: string;
  before: string | null;
  after: string | null;
  category: "typography" | "palette" | "spacing" | "effects" | "layout" | "structure" | "copy";
};

/** Parse every `<style>` tag in a document and return the rules merged
 *  in source order — last declaration wins per selector. */
function parseStyles(html: string): StyleRule[] {
  const styleBlocks: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) styleBlocks.push(m[1]);

  const merged = new Map<string, Record<string, string>>();
  for (const block of styleBlocks) {
    // Strip comments
    const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
    // Match `selector { decls }` chunks
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    let r: RegExpExecArray | null;
    while ((r = ruleRe.exec(clean)) !== null) {
      const selector = r[1].trim();
      if (!selector || selector.startsWith("@")) continue;
      // Split selector list on commas
      for (const sel of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
        const decls: Record<string, string> = merged.get(sel) ?? {};
        for (const declStr of r[2].split(";")) {
          const idx = declStr.indexOf(":");
          if (idx < 0) continue;
          const prop = declStr.slice(0, idx).trim().toLowerCase();
          const val = declStr.slice(idx + 1).trim();
          if (!prop || !val) continue;
          if (!TRACKED_PROPS.has(prop)) continue;
          decls[prop] = val;
        }
        merged.set(sel, decls);
      }
    }
  }
  return Array.from(merged.entries()).map(([selector, decls]) => ({ selector, decls }));
}

/**
 * Walk the DOM body of an HTML string and produce a "signature" set —
 * one entry per visible structural element using `tag.classes#id` shape.
 * Used to detect added / removed nav links, sections, cards, etc.
 *
 * Uses DOMParser so we get real tree semantics (CSS doesn't capture
 * structural changes — adding a 4th nav link doesn't show up in any
 * `.nav a` rule, the rule already exists). Fails open on parse errors.
 */
function elementSignatures(html: string): { sig: string; text: string }[] {
  const out: { sig: string; text: string }[] = [];
  if (typeof DOMParser === "undefined") return out;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return out;
  }
  const body = doc.body;
  if (!body) return out;

  // Skip non-visual elements (script/style). Skip <head>. Walk <body>.
  const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);

  function walk(el: Element) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    const classes = el.classList.length
      ? "." + Array.from(el.classList).slice(0, 3).join(".")
      : "";
    const id = el.id ? `#${el.id}` : "";
    // Short text snippet so the user can tell "Apply" link from "Sign in"
    // when they share the same selector.
    const text = (el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    const sig = `${tag}${id}${classes}`;
    out.push({ sig, text });
    for (const child of Array.from(el.children)) walk(child);
  }
  for (const child of Array.from(body.children)) walk(child);
  return out;
}

/** Compare structural signatures between two HTML strings. Returns
 *  diffs marked with category `"structure"`. */
function computeStructureDiff(beforeHtml: string, afterHtml: string): StyleDiff[] {
  const before = elementSignatures(beforeHtml);
  const after = elementSignatures(afterHtml);

  // Bag-count comparison: a tag-class signature can repeat (e.g. nav links).
  // We use a multiset so adding a 4th nav link counts as a real change.
  const beforeCounts = new Map<string, number>();
  const afterCounts = new Map<string, number>();
  const beforeSamples = new Map<string, string>();
  const afterSamples = new Map<string, string>();

  for (const e of before) {
    beforeCounts.set(e.sig, (beforeCounts.get(e.sig) ?? 0) + 1);
    if (!beforeSamples.has(e.sig) && e.text) beforeSamples.set(e.sig, e.text);
  }
  for (const e of after) {
    afterCounts.set(e.sig, (afterCounts.get(e.sig) ?? 0) + 1);
    if (!afterSamples.has(e.sig) && e.text) afterSamples.set(e.sig, e.text);
  }

  const allSigs = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
  const out: StyleDiff[] = [];
  for (const sig of allSigs) {
    const b = beforeCounts.get(sig) ?? 0;
    const a = afterCounts.get(sig) ?? 0;
    if (b === a) continue;
    // Decorate the value with a sample text snippet so users see "what
    // got added" instead of just an opaque selector.
    const sample = afterSamples.get(sig) || beforeSamples.get(sig) || "";
    const fmt = (count: number) => (count === 0 ? "—" : `${count}`);
    out.push({
      selector: sample ? `${sig} · "${sample}"` : sig,
      property: a === 0 ? "removed" : b === 0 ? "added" : "count",
      before: fmt(b),
      after: fmt(a),
      category: "structure",
    });
  }
  // Sort: added first, then removed, then count changes; alphabetical within each.
  const groupOrder: Record<string, number> = { added: 0, removed: 1, count: 2 };
  out.sort(
    (x, y) =>
      (groupOrder[x.property] ?? 9) - (groupOrder[y.property] ?? 9) ||
      x.selector.localeCompare(y.selector)
  );
  return out;
}

/**
 * Walk the body of an HTML string and pull every block of user-visible
 * copy — headings, paragraphs, button/link/list-item text, plus
 * `[role="button"]` for non-button CTAs. Marketers care about the words
 * on the page, not the divs around them.
 *
 * Each entry is `{ sig, text }` where:
 *   - sig  = element tag (or "role-button" for ARIA buttons)
 *   - text = collapsed innerText, trimmed, capped at 200 chars (ellipsis)
 *
 * Returns [] when DOMParser is unavailable or the body is missing.
 */
export function extractCopyBlocks(html: string): { sig: string; text: string }[] {
  const out: { sig: string; text: string }[] = [];
  if (typeof DOMParser === "undefined") return out;
  if (!html || !html.trim()) return out;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return out;
  }
  const body = doc.body;
  if (!body) return out;

  const TEXT_TAGS = ["h1", "h2", "h3", "p", "button", "a", "li"];
  // Selector pulls in role="button" too so ARIA-only CTAs don't slip past.
  const selector = TEXT_TAGS.join(",") + ',[role="button"]';
  let nodes: Element[];
  try {
    nodes = Array.from(body.querySelectorAll(selector));
  } catch {
    return out;
  }

  for (const el of nodes) {
    const tag = el.tagName.toLowerCase();
    // Filter out non-visual containers entirely. We never look inside
    // <script>/<style>/<link>, so they shouldn't surface text either.
    if (tag === "script" || tag === "style" || tag === "link" || tag === "noscript") continue;
    let sig: string;
    if (TEXT_TAGS.includes(tag)) {
      sig = tag;
    } else if (el.getAttribute("role") === "button") {
      sig = "role-button";
    } else {
      continue;
    }
    let text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length > 200) text = text.slice(0, 199) + "…";
    out.push({ sig, text });
  }
  return out;
}

/**
 * Diff the user-visible copy between two HTML strings. Alignment strategy:
 *   - Group blocks by `sig` (tag) on each side, preserving document order.
 *   - For each tag, walk the two ordered lists side by side. If both texts
 *     are identical → no diff. If they differ → "rewrote". When one side
 *     runs out → "added" or "removed".
 *
 * This means reordering paragraphs within the same tag is treated as
 * rewrites at each ordinal slot; we accept that trade-off because reliable
 * fuzzy matching is overkill for a marketer's eyeball scan, and identical
 * strings at different positions still register as "no diff" pairs.
 *
 * Caps at 50 entries; remaining changes collapse into a single sentinel
 * row so one giant page doesn't drown the panel.
 */
export function computeCopyDiff(beforeHtml: string, afterHtml: string): StyleDiff[] {
  const beforeBlocks = extractCopyBlocks(beforeHtml);
  const afterBlocks = extractCopyBlocks(afterHtml);
  if (beforeBlocks.length === 0 && afterBlocks.length === 0) return [];

  // Bucket each side by sig so we can align ordinally per-tag.
  const bucket = (blocks: { sig: string; text: string }[]) => {
    const m = new Map<string, string[]>();
    for (const b of blocks) {
      const arr = m.get(b.sig) ?? [];
      arr.push(b.text);
      m.set(b.sig, arr);
    }
    return m;
  };
  const beforeBy = bucket(beforeBlocks);
  const afterBy = bucket(afterBlocks);

  const allSigs = new Set([...beforeBy.keys(), ...afterBy.keys()]);
  // Stable, marketer-friendly order: headlines first, CTAs near top.
  const sigOrder: Record<string, number> = {
    h1: 0,
    h2: 1,
    h3: 2,
    p: 3,
    li: 4,
    button: 5,
    "role-button": 6,
    a: 7,
  };
  const sortedSigs = Array.from(allSigs).sort(
    (x, y) => (sigOrder[x] ?? 99) - (sigOrder[y] ?? 99) || x.localeCompare(y)
  );

  const out: StyleDiff[] = [];
  const MAX = 50;

  // First pass: identical pairs are skipped. Otherwise, emit added/
  // removed/rewrote entries indexed by their ordinal within the tag.
  for (const sig of sortedSigs) {
    const beforeList = beforeBy.get(sig) ?? [];
    const afterList = afterBy.get(sig) ?? [];
    const len = Math.max(beforeList.length, afterList.length);
    for (let i = 0; i < len; i++) {
      const b = i < beforeList.length ? beforeList[i] : null;
      const a = i < afterList.length ? afterList[i] : null;
      if (b !== null && a !== null && b === a) continue;
      const ord = len > 1 ? `[${i}]` : "";
      const selector = `${sig}${ord}`;
      let property: "added" | "removed" | "rewrote";
      if (b === null) property = "added";
      else if (a === null) property = "removed";
      else property = "rewrote";
      out.push({
        selector,
        property,
        before: b,
        after: a,
        category: "copy",
      });
    }
  }

  if (out.length <= MAX) return out;
  const head = out.slice(0, MAX);
  const remaining = out.length - MAX;
  head.push({
    selector: "…",
    property: "more",
    before: null,
    after: `…and ${remaining} more copy change${remaining === 1 ? "" : "s"}`,
    category: "copy",
  });
  return head;
}

/** Compute a flat list of property-level diffs between two HTML strings. */
export function computeStyleDiff(beforeHtml: string, afterHtml: string): StyleDiff[] {
  const beforeRules = parseStyles(beforeHtml);
  const afterRules = parseStyles(afterHtml);

  const beforeBySel = new Map(beforeRules.map((r) => [r.selector, r.decls]));
  const afterBySel = new Map(afterRules.map((r) => [r.selector, r.decls]));

  const allSelectors = new Set([...beforeBySel.keys(), ...afterBySel.keys()]);
  const out: StyleDiff[] = [];

  for (const sel of allSelectors) {
    const a = beforeBySel.get(sel) ?? {};
    const b = afterBySel.get(sel) ?? {};
    const props = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const prop of props) {
      const beforeVal = a[prop] ?? null;
      const afterVal = b[prop] ?? null;
      if (beforeVal === afterVal) continue;
      out.push({
        selector: sel,
        property: prop,
        before: beforeVal,
        after: afterVal,
        category: CATEGORY_BY_PROP[prop] ?? "layout",
      });
    }
  }

  // Append copy diffs (headline/CTA/body text changes) — the most
  // user-facing thing in any redesign, and what marketers scan for first.
  out.push(...computeCopyDiff(beforeHtml, afterHtml));

  // Append structural diffs (added/removed elements) so the lens
  // catches "the headline now has a 3-line copy block" and "a 4th
  // nav link appeared" cases that no CSS rule would surface.
  out.push(...computeStructureDiff(beforeHtml, afterHtml));

  // Sort: copy changes lead (most user-facing), then structure, then
  // typography → palette → spacing → effects → layout. Preserve
  // intra-category order (don't blow away the copy/structure sort).
  const order: Record<StyleDiff["category"], number> = {
    copy: 0,
    structure: 1,
    typography: 2,
    palette: 3,
    spacing: 4,
    effects: 5,
    layout: 6,
  };
  out.sort((x, y) => {
    const d = order[x.category] - order[y.category];
    if (d !== 0) return d;
    // Keep copy + structure entries in the order their producers emitted.
    if (x.category === "copy" || x.category === "structure") return 0;
    return x.selector.localeCompare(y.selector);
  });
  return out;
}

/** Best-effort: extract all hex / rgb colors found in a value so the UI
 *  can render swatches. */
export function extractColors(value: string | null | undefined): string[] {
  if (!value) return [];
  const colors: string[] = [];
  const reHex = /#[0-9a-fA-F]{3,8}\b/g;
  const reRgb = /rgba?\([^)]+\)/g;
  let m: RegExpExecArray | null;
  while ((m = reHex.exec(value)) !== null) colors.push(m[0]);
  while ((m = reRgb.exec(value)) !== null) colors.push(m[0]);
  return colors;
}
