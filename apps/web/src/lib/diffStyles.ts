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
  category: "typography" | "palette" | "spacing" | "effects" | "layout";
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

  // Sort: by category (typography first → palette → spacing → effects → layout),
  // then by selector for stability.
  const order: Record<StyleDiff["category"], number> = {
    typography: 0,
    palette: 1,
    spacing: 2,
    effects: 3,
    layout: 4,
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
