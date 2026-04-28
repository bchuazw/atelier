"""Plain-English summary of a structured Style Diff.

The web client (and MCP server) already compute a `StyleDiff[]` between two
variants — typography/palette/spacing/etc property changes plus copy and
structural deltas. Raw the diff can run hundreds of entries which is great
for tooling but useless for "what actually changed?" The endpoint here
takes that diff and returns:

  - `summary`: ONE sentence designers will recognise (e.g.
    "Warmer palette, larger headline, tighter spacing — softer overall feel.")
  - `bullets`: 3-6 concrete change descriptions in plain English

Uses Haiku (~$0.001 per call) so it's cheap enough to run on every Compare
view without a confirmation step. Cached per (a_id, b_id) pair on the
client; the backend itself is stateless to keep the route simple.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from atelier_api.llm import client as llm
from atelier_api.pricing import cost_cents_for_usage


router = APIRouter(prefix="/diff", tags=["diff"])


# Whitelist mirrors the StyleDiff `category` enum on both web (TS) and MCP
# (Python) sides — keeping it explicit here means a typo'd category from
# a stale client doesn't silently produce garbage prompts.
DiffCategory = Literal[
    "copy",
    "tokens",
    "structure",
    "typography",
    "palette",
    "spacing",
    "effects",
    "layout",
]


class StyleDiffEntry(BaseModel):
    """One property-level diff. Matches the StyleDiff TS type 1:1."""

    selector: str = Field(..., max_length=512)
    property: str = Field(..., max_length=128)
    before: str | None = Field(default=None, max_length=2048)
    after: str | None = Field(default=None, max_length=2048)
    category: DiffCategory


class DiffSummarizeIn(BaseModel):
    diff: list[StyleDiffEntry] = Field(..., max_length=2000)
    # Optional labels so the summary can name the variants ("Card Grid →
    # Editorial Spread" reads better than "A → B"). Optional because some
    # callers (MCP agents) might not have human titles handy.
    a_title: str | None = Field(default=None, max_length=200)
    b_title: str | None = Field(default=None, max_length=200)


class DiffSummarizeOut(BaseModel):
    summary: str
    bullets: list[str]
    model_used: str
    cost_cents: int
    # Per-category counts so the UI can show "20 copy / 79 typography / …"
    # next to the summary without the client having to recount.
    category_counts: dict[str, int]


SYSTEM_PROMPT = (
    "You are a senior product designer reading a structured diff between two "
    "versions of a landing page. Translate the diff into plain English so a "
    "non-technical stakeholder understands what changed and why it matters.\n\n"
    "Output JSON with EXACTLY two keys:\n"
    "  summary: ONE sentence (~15-25 words) capturing the overall direction "
    "of the change — palette mood, typography weight, spacing density, copy "
    "tone, layout shift. NO category words like 'typography' or 'palette' — "
    "describe the FEEL.\n"
    "  bullets: an array of 3-6 short bullets (each ≤120 chars) listing the "
    "concrete changes a designer would point to. Group related items into a "
    "single bullet (e.g. 'Headline grew from 32px to 48px and switched to a "
    "serif' beats two separate bullets). Skip noise like rounding-pixel "
    "adjustments under 2px.\n\n"
    "Rules:\n"
    "1. Return ONLY the JSON object. No prose, no markdown fences. Start "
    "with `{` and end with `}`.\n"
    "2. Never invent changes that aren't in the diff. If two variants are "
    "essentially identical, say so in summary and return ONE bullet.\n"
    "3. Speak the user's language: 'softer cream tone', not 'palette[primary] "
    "rgb(245,235,210)'.\n"
)


@router.post("/summarize", response_model=DiffSummarizeOut)
async def summarize_diff(body: DiffSummarizeIn) -> DiffSummarizeOut:
    if not body.diff:
        raise HTTPException(
            status_code=400,
            detail="`diff` is empty — nothing to summarize.",
        )

    # Per-category counts are computed locally so we can return them even
    # if the LLM call fails for any reason.
    counts: dict[str, int] = {}
    for entry in body.diff:
        counts[entry.category] = counts.get(entry.category, 0) + 1

    # Build a compact text representation of the diff. We send all entries
    # but truncate before/after values so a single overflowing CSS gradient
    # can't blow the context window. Sorted by category so the prompt
    # always presents related changes together (better summaries).
    label_a = body.a_title or "A"
    label_b = body.b_title or "B"
    sorted_diff = sorted(body.diff, key=lambda e: (e.category, e.selector, e.property))

    def _truncate(v: str | None, limit: int = 80) -> str:
        if v is None:
            return "—"
        v = v.strip().replace("\n", " ")
        return v if len(v) <= limit else v[:limit] + "…"

    diff_lines = [
        f"[{e.category}] {e.selector} {{ {e.property}: "
        f"{_truncate(e.before)} → {_truncate(e.after)} }}"
        for e in sorted_diff
    ]
    user_msg = (
        f"Comparing {label_a} → {label_b}.\n\n"
        f"Total changes: {len(body.diff)} "
        f"(by category: {', '.join(f'{k}={v}' for k, v in sorted(counts.items()))}).\n\n"
        f"```\n" + "\n".join(diff_lines) + "\n```\n\n"
        "Return JSON only."
    )

    try:
        resp = await llm.call(
            system=SYSTEM_PROMPT,
            user=user_msg,
            model="haiku",
            max_tokens=600,
        )
    except Exception as e:  # pragma: no cover — Anthropic upstream
        raise HTTPException(status_code=500, detail=f"LLM call failed: {e}")

    # Parse the JSON response. Single-shot: if Haiku returned non-JSON we
    # surface a clear 502 so the client can fall back to "no summary
    # available" instead of crashing on a malformed payload.
    import json
    import re

    text = resp.text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Diff summary returned invalid JSON: {e}. First 200 chars: {text[:200]}",
        )

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Top-level summary JSON must be an object")
    summary = (parsed.get("summary") or "").strip()
    bullets_raw = parsed.get("bullets") or []
    if not summary:
        raise HTTPException(status_code=502, detail="Diff summary missing `summary` field")
    if not isinstance(bullets_raw, list):
        raise HTTPException(status_code=502, detail="Diff summary `bullets` must be an array")
    bullets = [str(b).strip() for b in bullets_raw if str(b).strip()][:8]

    cost_cents = cost_cents_for_usage(resp.usage_dict, resp.model)

    return DiffSummarizeOut(
        summary=summary,
        bullets=bullets,
        model_used=resp.model,
        cost_cents=cost_cents,
        category_counts=counts,
    )
