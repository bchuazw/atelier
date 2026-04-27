"""Pure-Python port of the TypeScript StyleDiff engine.

The web app's `apps/web/src/lib/diffStyles.ts` computes a designer-friendly
"what changed" between two variant HTML documents. We re-implement the same
algorithm here so the MCP server can return structured diffs to agents
instead of just pointing them at the canvas UI.

Strategy:
  - <style> blocks are extracted with regex (matches the TS source: it does
    the same thing). CSS doesn't have nested constructs we care about here
    once @media / @supports are stripped, so a regex is both simpler and
    more faithful to the reference impl than dragging in `tinycss2`.
  - HTML element walking uses `html.parser.HTMLParser` from the stdlib —
    enough to recover tag/class/id signatures and the visible text inside
    h1/h2/h3/p/button/a/li for copy diffs. No DOM tree is required because
    we never need parent/child relationships, only an in-order stream of
    open tags and their text content.

Output shape mirrors the TS `StyleDiff` type 1:1 so the MCP response is
consistent with what an agent might also see in the diff lens UI.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Iterable, Literal, TypedDict


# ── Types + constants ──────────────────────────────────────────────────

Category = Literal[
    "copy",
    "tokens",
    "structure",
    "typography",
    "palette",
    "spacing",
    "effects",
    "layout",
]


class StyleDiff(TypedDict):
    """Single property-level difference between two variants.

    Mirrors the TS `StyleDiff` type. `before`/`after` are nullable so we
    can represent added (before=None) and removed (after=None) entries.
    """

    selector: str
    property: str
    before: str | None
    after: str | None
    category: Category


# Properties we surface in the resolved-value diff. Anything outside this
# set is ignored at parse time so the noise floor stays low.
TRACKED_PROPS: set[str] = {
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
}


CATEGORY_BY_PROP: dict[str, Category] = {
    "font-family": "typography",
    "font-size": "typography",
    "font-weight": "typography",
    "line-height": "typography",
    "letter-spacing": "typography",
    "text-transform": "typography",
    "text-align": "typography",
    "color": "palette",
    "background": "palette",
    "background-color": "palette",
    "border-color": "palette",
    "border": "palette",
    "padding": "spacing",
    "padding-top": "spacing",
    "padding-right": "spacing",
    "padding-bottom": "spacing",
    "padding-left": "spacing",
    "margin": "spacing",
    "margin-top": "spacing",
    "margin-right": "spacing",
    "margin-bottom": "spacing",
    "margin-left": "spacing",
    "gap": "spacing",
    "box-shadow": "effects",
    "border-radius": "effects",
    "opacity": "effects",
    "display": "layout",
}


# Regex matching every `<style>...</style>` block. DOTALL so newlines
# inside the body match.
_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>(.*?)</style>", re.IGNORECASE | re.DOTALL)
# Regex matching `selector { decls }` chunks. Mirrors the TS impl —
# importantly, this does NOT recurse, so nested @media / @supports rules
# end up captured as junk selectors and are then skipped because they
# start with "@". This is a deliberate parity limitation.
_RULE_RE = re.compile(r"([^{}]+)\{([^}]*)\}")
_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_VAR_REF_RE = re.compile(r"var\(\s*(--[\w-]+)")


# ── CSS parsing ────────────────────────────────────────────────────────


def _iter_style_blocks(html: str) -> Iterable[str]:
    """Yield the inner text of every `<style>` tag in the document."""
    if not html:
        return
    for m in _STYLE_BLOCK_RE.finditer(html):
        yield m.group(1)


def _iter_rules(block: str) -> Iterable[tuple[str, str]]:
    """Yield (selector, decls_str) tuples from a single `<style>` body.

    Comments are stripped first so `/* ... */` inside a rule body doesn't
    confuse the brace-matching regex.
    """
    clean = _COMMENT_RE.sub("", block)
    for m in _RULE_RE.finditer(clean):
        yield m.group(1).strip(), m.group(2)


def parse_styles(html: str) -> dict[str, dict[str, str]]:
    """Parse every `<style>` block and return selector → {prop: value}.

    Last declaration wins per (selector, property) — matches CSS cascade
    semantics for declarations of equal specificity, and matches the TS
    impl. Only declarations whose property is in `TRACKED_PROPS` are kept.
    """
    merged: dict[str, dict[str, str]] = {}
    for block in _iter_style_blocks(html):
        for selector, decls_str in _iter_rules(block):
            if not selector or selector.startswith("@"):
                # Skip @media / @supports etc. — same parity limitation
                # as the TS implementation.
                continue
            for sel in (s.strip() for s in selector.split(",")):
                if not sel:
                    continue
                bucket = merged.setdefault(sel, {})
                for decl in decls_str.split(";"):
                    idx = decl.find(":")
                    if idx < 0:
                        continue
                    prop = decl[:idx].strip().lower()
                    val = decl[idx + 1 :].strip()
                    if not prop or not val:
                        continue
                    if prop not in TRACKED_PROPS:
                        continue
                    bucket[prop] = val
    return merged


def extract_token_declarations(html: str) -> dict[str, dict[str, str]]:
    """Pull every `--*` custom-property declaration from the document.

    Returns a map keyed by `selector::--name` so the same token declared
    in two selectors stays distinct. Each value is `{selector, name, value}`.

    We re-parse `<style>` blocks here instead of piggy-backing on
    `parse_styles` because that function drops anything outside
    `TRACKED_PROPS` to keep the resolved-value diff focused.
    """
    out: dict[str, dict[str, str]] = {}
    if not html:
        return out
    for block in _iter_style_blocks(html):
        for selector, decls_str in _iter_rules(block):
            if not selector or selector.startswith("@"):
                continue
            for sel in (s.strip() for s in selector.split(",")):
                if not sel:
                    continue
                for decl in decls_str.split(";"):
                    idx = decl.find(":")
                    if idx < 0:
                        continue
                    # Tokens are case-sensitive — don't lowercase here.
                    prop = decl[:idx].strip()
                    val = decl[idx + 1 :].strip()
                    if not prop.startswith("--") or not val:
                        continue
                    out[f"{sel}::{prop}"] = {
                        "selector": sel,
                        "name": prop,
                        "value": val,
                    }
    return out


def compute_token_diff(
    before_tokens: dict[str, dict[str, str]],
    after_tokens: dict[str, dict[str, str]],
) -> list[StyleDiff]:
    """Diff two token maps. One entry per (selector, --name) that changed."""
    out: list[StyleDiff] = []
    all_keys = set(before_tokens.keys()) | set(after_tokens.keys())
    for key in all_keys:
        b = before_tokens.get(key)
        a = after_tokens.get(key)
        before_val = b["value"] if b else None
        after_val = a["value"] if a else None
        if before_val == after_val:
            continue
        meta = b if b is not None else a
        assert meta is not None  # one of them is non-None by construction
        out.append(
            {
                "selector": meta["selector"],
                "property": meta["name"],
                "before": before_val,
                "after": after_val,
                "category": "tokens",
            }
        )
    out.sort(key=lambda d: (d["selector"], d["property"]))
    return out


# ── HTML walking (copy + structure) ────────────────────────────────────


_WS_RE = re.compile(r"\s+")
_SKIP_TAGS = {"script", "style", "noscript", "template", "link"}
_TEXT_TAGS = {"h1", "h2", "h3", "p", "button", "a", "li"}
# Void elements never have a close tag — we finalize them on starttag.
_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


class _ElementCollector(HTMLParser):
    """Walk the body and record one entry per opened (non-skipped) element.

    Each entry is `{tag, sig, role, text}` where:
      - sig  = `tag#id.cls1.cls2.cls3` (first 3 classes, mirrors TS .slice(0,3))
      - text = collapsed-whitespace inner text up to the matching close tag

    We emit in document order (open-tag order) by writing the entry's
    skeleton at `handle_starttag` and back-filling `text` at the matching
    `handle_endtag`. Text inside a child accumulates into every ancestor's
    buffer so `text` mirrors the TS `el.textContent` semantics.

    Skips: <head>, <script>, <style>, <noscript>, <template>, <link>.
    Void elements are emitted with empty text (matches DOM behavior).
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        # Stack of open elements; each frame holds the index into `elements`
        # plus a list[str] text accumulator.
        self._stack: list[dict[str, object]] = []
        # Output: one record per opened element, in DOCUMENT (start-tag) order.
        self.elements: list[dict[str, str | None]] = []
        # Depth counter for suppress regions (head + skip tags). While > 0,
        # element + text capture is silenced.
        self._suppress_depth = 0
        self._in_body = False

    def _push_element(self, tag: str, attrs: list[tuple[str, str | None]]) -> dict[str, object] | None:
        """Record a new element and return its stack frame, or None if
        we're outside the body / inside a suppressed region."""
        if not self._in_body or self._suppress_depth > 0:
            return None
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        cls = attr_map.get("class", "").split()
        elem_id = attr_map.get("id", "")
        role = attr_map.get("role", "") or None
        id_part = f"#{elem_id}" if elem_id else ""
        cls_part = ("." + ".".join(cls[:3])) if cls else ""
        sig = f"{tag}{id_part}{cls_part}"
        # Reserve the slot so iteration order matches document order.
        idx = len(self.elements)
        self.elements.append(
            {"tag": tag, "sig": sig, "role": role, "text": ""}
        )
        frame: dict[str, object] = {
            "tag": tag,
            "idx": idx,
            "text": [],  # list[str] accumulator
        }
        return frame

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "body":
            self._in_body = True
            return
        if tag == "head":
            self._suppress_depth += 1
            return
        if tag in _SKIP_TAGS:
            self._suppress_depth += 1
            return
        if tag in _VOID_TAGS:
            # Void: record but don't push onto stack — they have no body
            # and html.parser may or may not emit a close event for them.
            self._push_element(tag, attrs)
            return
        frame = self._push_element(tag, attrs)
        if frame is not None:
            self._stack.append(frame)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # XHTML-style self-closing tags (<br/>, <img/>). Treat as void.
        tag = tag.lower()
        if tag == "head":
            return  # implausible but defensive
        if tag in _SKIP_TAGS:
            return
        self._push_element(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "body":
            self._in_body = False
            return
        if tag == "head":
            if self._suppress_depth > 0:
                self._suppress_depth -= 1
            return
        if tag in _SKIP_TAGS:
            if self._suppress_depth > 0:
                self._suppress_depth -= 1
            return
        if tag in _VOID_TAGS:
            return  # already finalized at start
        # Walk down the stack until we find the matching open tag. This
        # is forgiving for unbalanced markup (a stray </p> doesn't blow
        # us up; mismatched tags just close their nearest ancestor).
        for i in range(len(self._stack) - 1, -1, -1):
            if self._stack[i]["tag"] == tag:
                frame = self._stack.pop(i)
                idx = frame["idx"]  # type: ignore[index]
                text_parts = frame["text"]  # type: ignore[index]
                text = "".join(text_parts).strip()  # type: ignore[arg-type]
                text = _WS_RE.sub(" ", text)
                # Update the previously-reserved record in place.
                self.elements[idx]["text"] = text  # type: ignore[index]
                # Bubble text up so ancestor.textContent reads correctly.
                if self._stack:
                    parent = self._stack[-1]
                    parent["text"].append(" " + text)  # type: ignore[union-attr]
                # Anything left ABOVE this frame on the stack is implicit
                # close (unbalanced). html.parser will keep going.
                return

    def handle_data(self, data: str) -> None:
        if not self._in_body or self._suppress_depth > 0:
            return
        if not self._stack:
            return
        # Append raw text to the innermost open element. Whitespace is
        # collapsed at close time.
        self._stack[-1]["text"].append(data)  # type: ignore[union-attr]


def _walk_elements(html: str) -> list[dict[str, str | None]]:
    """Parse an HTML document and return per-element records.

    Each record: `{tag, sig, role, text}`. Records are emitted in close
    order (post-order), but for our diffs ordering only matters within a
    bucket, so we re-sort or re-bucket as needed downstream.
    """
    if not html or not html.strip():
        return []
    parser = _ElementCollector()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        # html.parser is fairly forgiving but we fail open on any
        # unexpected error to match the TS impl's try/catch.
        return []
    return parser.elements


def extract_copy_blocks(html: str) -> list[dict[str, str]]:
    """Return [{sig, text}] for every visible copy element.

    Mirrors the TS `extractCopyBlocks`: pulls h1/h2/h3/p/button/a/li
    plus any `[role="button"]` element. Text is collapsed-whitespace,
    trimmed, and capped at 200 chars (with ellipsis).
    """
    out: list[dict[str, str]] = []
    for el in _walk_elements(html):
        tag = el["tag"]
        text = el["text"] or ""
        if tag in _SKIP_TAGS:
            continue
        if tag in _TEXT_TAGS:
            sig = tag
        elif el.get("role") == "button":
            sig = "role-button"
        else:
            continue
        if not text:
            continue
        if len(text) > 200:
            text = text[:199] + "…"
        out.append({"sig": sig, "text": text})  # type: ignore[dict-item]
    # Post-order from the parser is "innermost-closed first". For copy
    # diffing we want document order roughly, but the per-tag bucketing
    # below preserves emission order within a tag, and h1/p/etc. don't
    # nest, so this is fine for the same-tag ordinal pairing strategy
    # the TS impl uses.
    return out


def compute_copy_diff(before_html: str, after_html: str) -> list[StyleDiff]:
    """Diff visible copy between two documents.

    Algorithm (matches TS):
      1. Bucket each side by tag, preserving doc order.
      2. For each tag, walk both lists in parallel. Identical → skip.
         Different → "rewrote". One side empty → "added" / "removed".
      3. Cap at 50 entries; collapse the rest into a single sentinel row.
    """
    before_blocks = extract_copy_blocks(before_html)
    after_blocks = extract_copy_blocks(after_html)
    if not before_blocks and not after_blocks:
        return []

    def bucket(blocks: list[dict[str, str]]) -> dict[str, list[str]]:
        m: dict[str, list[str]] = {}
        for b in blocks:
            m.setdefault(b["sig"], []).append(b["text"])
        return m

    before_by = bucket(before_blocks)
    after_by = bucket(after_blocks)

    sig_order = {
        "h1": 0,
        "h2": 1,
        "h3": 2,
        "p": 3,
        "li": 4,
        "button": 5,
        "role-button": 6,
        "a": 7,
    }
    all_sigs = set(before_by.keys()) | set(after_by.keys())
    sorted_sigs = sorted(all_sigs, key=lambda s: (sig_order.get(s, 99), s))

    out: list[StyleDiff] = []
    MAX = 50
    for sig in sorted_sigs:
        before_list = before_by.get(sig, [])
        after_list = after_by.get(sig, [])
        length = max(len(before_list), len(after_list))
        for i in range(length):
            b: str | None = before_list[i] if i < len(before_list) else None
            a: str | None = after_list[i] if i < len(after_list) else None
            if b is not None and a is not None and b == a:
                continue
            ord_part = f"[{i}]" if length > 1 else ""
            selector = f"{sig}{ord_part}"
            if b is None:
                prop = "added"
            elif a is None:
                prop = "removed"
            else:
                prop = "rewrote"
            out.append(
                {
                    "selector": selector,
                    "property": prop,
                    "before": b,
                    "after": a,
                    "category": "copy",
                }
            )

    if len(out) <= MAX:
        return out
    head = out[:MAX]
    remaining = len(out) - MAX
    head.append(
        {
            "selector": "…",
            "property": "more",
            "before": None,
            "after": (
                f"…and {remaining} more copy change"
                + ("" if remaining == 1 else "s")
            ),
            "category": "copy",
        }
    )
    return head


def compute_structure_diff(before_html: str, after_html: str) -> list[StyleDiff]:
    """Compare element-signature multisets between two documents."""
    before = _walk_elements(before_html)
    after = _walk_elements(after_html)

    before_counts: dict[str, int] = {}
    after_counts: dict[str, int] = {}
    before_samples: dict[str, str] = {}
    after_samples: dict[str, str] = {}

    for e in before:
        sig = e["sig"] or ""
        before_counts[sig] = before_counts.get(sig, 0) + 1
        if sig not in before_samples and e["text"]:
            before_samples[sig] = (e["text"] or "")[:40]
    for e in after:
        sig = e["sig"] or ""
        after_counts[sig] = after_counts.get(sig, 0) + 1
        if sig not in after_samples and e["text"]:
            after_samples[sig] = (e["text"] or "")[:40]

    all_sigs = set(before_counts.keys()) | set(after_counts.keys())
    out: list[StyleDiff] = []
    for sig in all_sigs:
        b = before_counts.get(sig, 0)
        a = after_counts.get(sig, 0)
        if b == a:
            continue
        sample = after_samples.get(sig) or before_samples.get(sig) or ""
        prop = "removed" if a == 0 else "added" if b == 0 else "count"
        selector = f'{sig} · "{sample}"' if sample else sig
        out.append(
            {
                "selector": selector,
                "property": prop,
                "before": "—" if b == 0 else str(b),
                "after": "—" if a == 0 else str(a),
                "category": "structure",
            }
        )
    group_order = {"added": 0, "removed": 1, "count": 2}
    out.sort(key=lambda d: (group_order.get(d["property"], 9), d["selector"]))
    return out


# ── Orchestrator ───────────────────────────────────────────────────────


def _consumes_changed_token(value: str | None, changed_token_names: set[str]) -> bool:
    """True if `value` references any `var(--name)` whose token changed."""
    if not value or not changed_token_names:
        return False
    for m in _VAR_REF_RE.finditer(value):
        if m.group(1) in changed_token_names:
            return True
    return False


def compute_style_diff(before_html: str, after_html: str) -> list[StyleDiff]:
    """Top-level orchestrator. Mirrors TS `computeStyleDiff`.

    Pipeline:
      1. Parse <style> blocks on both sides into selector → decls.
      2. Token pass: pull `--*` declarations, diff them. Build the set
         of changed token names so we can suppress redundant
         consumer-side rules that only changed because they reference a
         changed token.
      3. Resolved-value pass: for every (selector, prop) in either side,
         emit a diff if values differ AND neither side references a
         changed token.
      4. Append copy + structure diffs.
      5. Sort: copy → tokens → structure → typography → palette →
         spacing → effects → layout. Within copy/structure preserve
         producer order; otherwise alphabetical by selector.
    """
    before_by_sel = parse_styles(before_html)
    after_by_sel = parse_styles(after_html)

    before_tokens = extract_token_declarations(before_html)
    after_tokens = extract_token_declarations(after_html)
    token_diffs = compute_token_diff(before_tokens, after_tokens)
    changed_token_names = {d["property"] for d in token_diffs}

    out: list[StyleDiff] = []
    all_selectors = set(before_by_sel.keys()) | set(after_by_sel.keys())
    for sel in all_selectors:
        a = before_by_sel.get(sel, {})
        b = after_by_sel.get(sel, {})
        props = set(a.keys()) | set(b.keys())
        for prop in props:
            before_val = a.get(prop)
            after_val = b.get(prop)
            if before_val == after_val:
                continue
            if _consumes_changed_token(
                before_val, changed_token_names
            ) or _consumes_changed_token(after_val, changed_token_names):
                continue
            out.append(
                {
                    "selector": sel,
                    "property": prop,
                    "before": before_val,
                    "after": after_val,
                    "category": CATEGORY_BY_PROP.get(prop, "layout"),
                }
            )

    out.extend(token_diffs)
    out.extend(compute_copy_diff(before_html, after_html))
    out.extend(compute_structure_diff(before_html, after_html))

    order: dict[Category, int] = {
        "copy": 0,
        "tokens": 1,
        "structure": 2,
        "typography": 3,
        "palette": 4,
        "spacing": 5,
        "effects": 6,
        "layout": 7,
    }

    # Stable sort: preserve producer order inside copy/structure (where
    # ordinal alignment matters for readability), otherwise alphabetical
    # by selector within each category bucket.
    def sort_key(d: StyleDiff) -> tuple[int, str]:
        cat = d["category"]
        if cat in ("copy", "structure"):
            # Empty string → all entries in this category compare equal,
            # so Python's stable sort preserves their producer order.
            return (order[cat], "")
        return (order[cat], d["selector"])

    out.sort(key=sort_key)
    return out


def summarize(diff: list[StyleDiff]) -> dict[str, int]:
    """Bucket counts by category — convenience for the MCP tool response.

    Always includes every category key (zero-filled) so consumers can
    rely on a stable shape.
    """
    out: dict[str, int] = {
        "copy": 0,
        "tokens": 0,
        "structure": 0,
        "typography": 0,
        "palette": 0,
        "spacing": 0,
        "effects": 0,
        "layout": 0,
    }
    for d in diff:
        out[d["category"]] = out.get(d["category"], 0) + 1
    return out
