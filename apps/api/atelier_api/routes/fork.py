from __future__ import annotations

import asyncio
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import get_session
from atelier_api.llm import client as llm
from atelier_api.storage import storage

router = APIRouter(prefix="/nodes", tags=["fork"])

SHOOTOUT_MODELS = ["haiku", "sonnet", "opus"]

FORK_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are Atelier, a frontend-design iteration engine. Given an HTML document "
            "(the 'parent' variant) and a short user instruction, produce a modified HTML "
            "document that applies the instruction as a visible design change.\n\n"
            "Rules:\n"
            "1. Return a COMPLETE HTML document including <!DOCTYPE html>, <html>, <head>, <body>.\n"
            "2. Preserve all existing <script> tags, <link rel=\"stylesheet\">, <img>, and <base> exactly; only change what the instruction asks for, or visual CSS that realises the instruction.\n"
            "3. Prefer adding a <style data-atelier-change> block inside <head> with rules that override existing styles, rather than editing existing CSS files.\n"
            "4. Keep relative asset paths intact (anything under assets/... must stay as-is).\n"
            "5. Do NOT introduce external fonts, frameworks, or CDN links the document doesn't already use.\n"
            "6. After the HTML, on a NEW line, write exactly `---META---` then a short JSON object "
            '{"title": "3-5 word descriptor", "summary": "one sentence what changed", "reasoning": "2-3 sentences why this achieves the goal"}.\n\n'
            "Output format (literal, no other commentary):\n"
            "<!DOCTYPE html>\n<html ...>\n...full document...\n</html>\n---META---\n{\"title\": ..., \"summary\": ..., \"reasoning\": ...}\n"
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


class ForkIn(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    n: int = Field(1, ge=1, le=3)
    model: str | None = "sonnet"  # 'opus' | 'sonnet' | 'haiku' | or a full model id
    shootout: bool = False  # when true, fans out 1 variant per model (haiku+sonnet+opus) ignoring n/model


class ForkChildOut(BaseModel):
    node_id: str
    edge_id: str
    title: str | None
    summary: str | None
    build_status: str
    sandbox_url: str | None
    model_used: str
    token_usage: dict


def _parse_llm_output(text: str) -> tuple[str, dict]:
    marker = "---META---"
    meta: dict = {}
    if marker in text:
        html_part, meta_part = text.rsplit(marker, 1)
        # Extract the first {...} block from meta_part.
        m = re.search(r"\{.*\}", meta_part, re.DOTALL)
        if m:
            import json

            try:
                meta = json.loads(m.group(0))
            except Exception:
                meta = {}
        html = html_part.strip()
    else:
        html = text.strip()
    # Strip ```html fences if present.
    html = re.sub(r"^```(?:html)?\s*", "", html)
    html = re.sub(r"\s*```\s*$", "", html)
    return html, meta


async def _generate_one(
    parent_html: str,
    prompt: str,
    model_choice: str,
    context: str | None = None,
) -> tuple[str, dict, llm.LlmResponse]:
    context_block = (
        f"USER CONTEXT (project preferences, audience, brand notes — respect these):\n{context.strip()}\n\n"
        if context and context.strip()
        else ""
    )
    user_msg = (
        f"{context_block}INSTRUCTION:\n{prompt}\n\nPARENT_HTML (truncated if long):\n```html\n{parent_html[:60000]}\n```\n\n"
        "Now produce the modified HTML document followed by ---META--- and the JSON meta."
    )
    resp = await llm.call(system=FORK_SYSTEM, user=user_msg, model=model_choice, max_tokens=8192)
    html, meta = _parse_llm_output(resp.text)
    return html, meta, resp


@router.post("/{parent_id}/fork", response_model=list[ForkChildOut])
async def fork_node(parent_id: str, body: ForkIn, session: AsyncSession = Depends(get_session)):
    parent = await session.get(Node, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent node not found")
    if not parent.build_path:
        raise HTTPException(status_code=400, detail="Parent has no artifact to fork from. Re-seed the project.")

    parent_index = Path(parent.build_path) / "index.html"
    if not parent_index.exists():
        raise HTTPException(status_code=500, detail=f"Parent index.html missing at {parent_index}")
    parent_html = parent_index.read_text(encoding="utf-8")

    # Load project for context (user-provided preferences that flavor every generation).
    project = await session.get(Project, parent.project_id)
    context_text = (project.settings or {}).get("context") if project else None

    # Resolve which models to run. Shootout = one variant per model, overriding n + model.
    if body.shootout:
        models_to_run = list(SHOOTOUT_MODELS)
    else:
        models_to_run = [body.model or "sonnet"] * body.n

    generations = await asyncio.gather(
        *[_generate_one(parent_html, body.prompt, m, context=context_text) for m in models_to_run],
        return_exceptions=True,
    )

    results: list[ForkChildOut] = []
    # Spread children horizontally below the parent.
    count = len(models_to_run)
    base_x = parent.position_x - (count - 1) * 220.0
    for i, gen in enumerate(generations):
        if isinstance(gen, Exception):
            continue
        html, meta, resp = gen

        # Prefix model name onto the title in shootout mode so siblings are distinguishable.
        raw_title = meta.get("title")
        if body.shootout and raw_title:
            display_title = f"[{models_to_run[i].upper()}] {raw_title}"
        else:
            display_title = raw_title

        node = Node(
            project_id=parent.project_id,
            parent_id=parent.id,
            type="variant",
            title=display_title,
            summary=meta.get("summary"),
            reasoning={
                "prompt": body.prompt,
                "reasoning": meta.get("reasoning", ""),
                "shootout": body.shootout,
                "model_key": models_to_run[i],
            },
            created_by="agent",
            model_used=resp.model,
            token_usage=resp.usage_dict,
            position_x=base_x + i * 440.0,
            position_y=parent.position_y + 260.0,
            build_status="building",
        )
        session.add(node)
        await session.flush()

        # Write the variant to disk by cloning the parent and replacing index.html.
        variant_dir = settings.assets_path / "variants" / node.id
        from atelier_api.sandbox.mutator import apply_html_override, clone_tree

        try:
            clone_tree(Path(parent.build_path), variant_dir)
            apply_html_override(variant_dir, html)
            node.artifact_path = str(variant_dir)
            node.build_path = str(variant_dir)
            await storage.upload_variant_tree(node.id, variant_dir)
            node.build_status = "ready"
        except Exception as e:
            node.build_status = "error"
            node.summary = f"{node.summary or ''}\n[build error: {e}]"

        edge = Edge(
            from_node_id=parent.id,
            to_node_id=node.id,
            type="prompt",
            prompt_text=body.prompt,
        )
        session.add(edge)
        await session.flush()

        results.append(
            ForkChildOut(
                node_id=node.id,
                edge_id=edge.id,
                title=node.title,
                summary=node.summary,
                build_status=node.build_status,
                sandbox_url=storage.variant_url(node.id) if node.build_status == "ready" else None,
                model_used=node.model_used or "",
                token_usage=node.token_usage or {},
            )
        )

    if not results:
        raise HTTPException(status_code=502, detail="All generations failed. Check API key and model availability.")

    await session.commit()
    return results
