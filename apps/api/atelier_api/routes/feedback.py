"""Feedback decomposition (AutoReason-style).

User pastes a long message — often boss/stakeholder feedback covering many
changes at once. Instead of trying to apply it all in one shot, we split
the request into atomic, reviewable items. The user approves (or edits)
the list, then asks Atelier to apply the approved items. Applying is a
regular fork call with a compound prompt composed on the frontend.

Endpoints:
- POST /nodes/{node_id}/feedback/analyze — takes {message, model},
  returns {items: [{id, area, change, rationale}]}

We *don't* expose an "/apply" route because apply is just a normal
/fork with a composed prompt; the frontend can call /fork directly.
This keeps the analysis step visible + auditable in the UI, and the
apply step reuses existing infrastructure.
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

router = APIRouter(tags=["feedback"])


FEEDBACK_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are Atelier's feedback analyzer. A user has been given stakeholder feedback — "
            "often multiple changes bundled into one paragraph — and needs it broken down into "
            "small, atomic, reviewable change items so they can be applied one by one (or together) "
            "by a separate rewrite step.\n\n"
            "Given (a) the CURRENT HTML of the variant being changed and (b) the stakeholder "
            "MESSAGE, produce a JSON array of change items. Each item has:\n"
            '- area: short tag, one of "typography", "palette", "layout", "copy", "imagery", '
            '  "cta", "spacing", "contrast", "motion", "structure", "other"\n'
            '- change: short directive (8-20 words) of what specifically to change\n'
            '- rationale: 1-2 sentences explaining why the reviewer likely wants this, what problem '
            '  it solves, or what principle it reflects. Write as if advising the user.\n\n'
            "Rules:\n"
            "1. Decompose thoroughly: if the message says 'make it warmer and punchier, with better "
            "hierarchy', output three items (warmer palette, punchier voice/CTA, stronger hierarchy).\n"
            "2. Don't invent asks that aren't in the message. If the message is vague ('more modern'), "
            "emit 1-2 interpretation items and mark them clearly (e.g., 'modernize typography with a "
            "geometric sans' with a rationale noting the interpretation).\n"
            "3. Don't repeat items. Merge near-duplicates.\n"
            "4. Aim for 3-8 items, up to 12 if the message really is long.\n"
            "5. Return strict JSON — array of objects — no prose, no fences. "
            'Example: [{"area":"palette","change":"shift to warm amber/terracotta tones","rationale":"Reviewer asked for \\"warmer\\" — amber plus terracotta reads inviting without losing professionalism."}].'
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


class FeedbackAnalyzeIn(BaseModel):
    message: str = Field(..., min_length=5, max_length=6000)
    model: str = "sonnet"


class FeedbackItem(BaseModel):
    id: str
    area: str
    change: str
    rationale: str


class FeedbackAnalyzeOut(BaseModel):
    items: list[FeedbackItem]
    model_used: str
    token_usage: dict


def _parse_items(text: str) -> list[dict]:
    """Tolerant JSON array extraction."""
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
        area = (it.get("area") or "other").strip().lower()
        change = (it.get("change") or "").strip()
        rationale = (it.get("rationale") or "").strip()
        if not change:
            continue
        out.append(
            {
                "id": str(uuid.uuid4())[:8],
                "area": area,
                "change": change,
                "rationale": rationale,
            }
        )
    return out


@router.post("/nodes/{node_id}/feedback/analyze", response_model=FeedbackAnalyzeOut)
async def analyze_feedback(
    node_id: str,
    body: FeedbackAnalyzeIn,
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

    # Project context flows into the analysis too so suggestions respect brand notes.
    project = await session.get(Project, node.project_id)
    context_text = (project.settings or {}).get("context") if project else None
    context_block = (
        f"PROJECT CONTEXT (respect these brand / audience notes):\n{context_text.strip()}\n\n"
        if context_text and context_text.strip()
        else ""
    )

    user_msg = (
        f"{context_block}"
        f"STAKEHOLDER MESSAGE:\n{body.message.strip()}\n\n"
        f"CURRENT HTML (truncated if long):\n```html\n{html[:30000]}\n```\n\n"
        "Return the JSON array of atomic change items now."
    )

    resp = await claude_provider.call(
        system=FEEDBACK_SYSTEM,
        user=user_msg,
        model=body.model,
        max_tokens=2048,
    )
    items = _parse_items(resp.text)
    return FeedbackAnalyzeOut(
        items=[FeedbackItem(**it) for it in items],
        model_used=resp.model,
        token_usage=resp.usage_dict,
    )
