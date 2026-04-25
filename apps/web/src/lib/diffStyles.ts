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
  category: "typography" | "palette" | "spacing" | "effects" | "layout" | "structure";
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

  // Append structural diffs (added/removed elements) so the lens
  // catches "the headline now has a 3-line copy block" and "a 4th
  // nav link appeared" cases that no CSS rule would surface.
  out.push(...computeStructureDiff(beforeHtml, afterHtml));

  // Sort: structure changes get the most attention so they go first,
  // then typography → palette → spacing → effects → layout.
  const order: Record<StyleDiff["category"], number> = {
    structure: 0,
    typography: 1,
    palette: 2,
    spacing: 3,
    effects: 4,
    layout: 5,
  };
  out.sort((x, y) => order[x.category] - order[y.category] || x.selector.localeCompare(y.selector));
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
