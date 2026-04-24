"""Critic agents — theme-driven suggestions for improving a variant.

User specifies a theme (e.g., "premium luxury", "playful consumer app",
"brutalist editorial") and optionally filters to certain aspects. A
critic agent analyzes the current HTML against the target theme and
returns specific, actionable suggestions grouped by category.

Like feedback analysis: we return a reviewable checklist; apply is a
separate /fork call with the approved items composed into a prompt.

Endpoint:
- POST /nodes/{node_id}/critics/analyze — takes {theme, aspects?, model},
  returns {critics: [{id, category, suggestion, rationale, severity}]}
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.db.models import Node, Project
from atelier_api.db.session import get_session
from atelier_api.providers import claude as claude_provider
from atelier_api.routes.media import _ensure_parent_materialized

log = logging.getLogger(__name__)

router = APIRouter(tags=["critics"])


CRITICS_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are Atelier's design critic. The user has a target theme/feel in mind for a landing "
            "page and has asked for concrete, actionable improvement suggestions. You review the "
            "current HTML and emit a short list of specific changes that would push it closer to the "
            "target theme.\n\n"
            "Given (a) the CURRENT HTML and (b) the target THEME (and optionally a list of ASPECTS "
            "to focus on), produce a JSON array of suggestions. Each item has:\n"
            '- category: one of "typography", "palette", "layout", "copy", "imagery", "cta", '
            '  "spacing", "contrast", "motion"\n'
            '- suggestion: a specific, concrete change (10-25 words). Reference elements or styles '
            '  the current page has (e.g., "the green accent", "the centered hero", "the nav CTA").\n'
            '- rationale: 1-2 sentences linking the suggestion to the target theme. Explain the '
            '  principle at play.\n'
            '- severity: "high" (blocks the theme), "medium" (worth doing), "low" (nice-to-have).\n\n'
            "Rules:\n"
            "1. Be SPECIFIC and grounded in what the HTML actually contains. Do not suggest changes "
            "to elements that don't exist.\n"
            "2. Keep suggestions independent — don't nest (e.g., 'change palette AND font' → split).\n"
            "3. Cover multiple categories unless the user filtered. Aim for 4-8 items total.\n"
            "4. Prefer concrete alternatives ('swap Inter for Canela Deck') over vague advice ('use "
            "a more refined font').\n"
            "5. Return strict JSON — array of objects — no prose, no fences.\n"
            'Example: [{"category":"typography","suggestion":"Swap Inter for a modern serif like '
            'Canela Deck in the H1, italics for emphasis, letter-spacing -0.02em.","rationale":"Luxury '
            'brands read serif first. The italics trigger editorial, not startup.","severity":"high"}]'
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


class CriticsAnalyzeIn(BaseModel):
    theme: str = Field(..., min_length=2, max_length=300)
    aspects: list[str] | None = None
    model: str = "sonnet"


class CriticItem(BaseModel):
    id: str
    category: str
    suggestion: str
    rationale: str
    severity: str = "medium"


class CriticsAnalyzeOut(BaseModel):
    critics: list[CriticItem]
    model_used: str
    token_usage: dict


def _parse_critics(text: str) -> list[dict]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip())
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        arr = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if not m:
            return []
        try:
            arr = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(arr, list):
        return []
    out = []
    for it in arr:
        if not isinstance(it, dict):
            continue
        cat = (it.get("category") or "other").strip().lower()
        sug = (it.get("suggestion") or "").strip()
        rat = (it.get("rationale") or "").strip()
        sev = (it.get("severity") or "medium").strip().lower()
        if sev not in ("low", "medium", "high"):
            sev = "medium"
        if not sug:
            continue
        out.append(
            {
                "id": str(uuid.uuid4())[:8],
                "category": cat,
                "suggestion": sug,
                "rationale": rat,
                "severity": sev,
            }
        )
    return out


@router.post("/nodes/{node_id}/critics/analyze", response_model=CriticsAnalyzeOut)
async def analyze_critics(
    node_id: str,
    body: CriticsAnalyzeIn,
    session: AsyncSession = Depends(get_session),
):
    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        node_dir = await _ensure_parent_materialized(node)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    html = (node_dir / "index.html").read_text(encoding="utf-8")

    project = await session.get(Project, node.project_id)
    context_text = (project.settings or {}).get("context") if project else None
    context_block = (
        f"PROJECT CONTEXT (respect these brand / audience notes):\n{context_text.strip()}\n\n"
        if context_text and context_text.strip()
        else ""
    )
    aspects_block = (
        f"FOCUS ONLY ON THESE CATEGORIES: {', '.join(body.aspects)}\n\n"
        if body.aspects
        else ""
    )

    user_msg = (
        f"{context_block}"
        f"TARGET THEME: {body.theme.strip()}\n\n"
        f"{aspects_block}"
        f"CURRENT HTML (truncated if long):\n```html\n{html[:30000]}\n```\n\n"
        "Return the JSON array of suggestions now."
    )

    resp = await claude_provider.call(
        system=CRITICS_SYSTEM,
        user=user_msg,
        model=body.model,
        max_tokens=2048,
    )
    items = _parse_critics(resp.text)
    return CriticsAnalyzeOut(
        critics=[CriticItem(**it) for it in items],
        model_used=resp.model,
        token_usage=resp.usage_dict,
    )
