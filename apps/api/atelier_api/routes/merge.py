"""Node merging — take TWO variants and synthesize a new one.

User story: drag variant A onto variant B on the canvas. B is the base
(target); selected aspects from A (typography / palette / layout / copy)
get lifted and applied onto B. Result is a new variant child with a
solid "merge" edge from the target and a dashed "contribution" edge
from the source, so the canvas shows the two-parent lineage visually.

Why Opus: synthesis is harder than either pure generation or pure
editing — model has to identify what defines each aspect in both docs
and apply them without breaking the other party's structure. Default
is opus; caller can override.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import time
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from atelier_api import jobs
from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import SessionLocal
from atelier_api.providers import claude as claude_provider
from atelier_api.routes.fork import FORK_SYSTEM, _parse_llm_output
from atelier_api.routes.media import _ensure_parent_materialized
from atelier_api.sandbox.mutator import apply_html_override, clone_tree
from atelier_api.storage import storage

log = logging.getLogger(__name__)

router = APIRouter(tags=["merge"])


ASPECT_HINTS = {
    "typography": (
        "Font family (including any @import url(...) declarations), weight, letter-spacing, "
        "line-height, italic treatments, heading scale ratios."
    ),
    "palette": (
        "Color palette — background, surface, text, accent, CTA, border colors. "
        "Gradients, overlays, shadow tints. Preserve semantic roles."
    ),
    "layout": (
        "Hero and section placement, grid / flex structure, alignment "
        "(centered vs asymmetric split), visual composition blocks, "
        "max-widths and spacing rhythm. Copy textual content is NOT part of layout."
    ),
    "copy": (
        "Visible text content — headlines, subheadlines, CTAs, body paragraphs, "
        "nav link labels. Do NOT import layout or typography as part of copy."
    ),
    "all": "Everything non-structural that makes the SOURCE feel different from TARGET.",
}


MERGE_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are Atelier's merge engine. You receive TWO complete HTML variants of the same "
            "landing page and a list of ASPECTS. Your job is to produce a NEW HTML document that "
            "starts from the TARGET and imports the listed aspects (and only those aspects) from "
            "the SOURCE.\n\n"
            "Rules:\n"
            "1. Return a COMPLETE HTML document (<!DOCTYPE html>, <html>, <head>, <body>).\n"
            "2. Preserve TARGET's content and structure for any aspect NOT in the list. Examples:\n"
            '   - aspects=["typography"] → keep TARGET\'s layout, palette, copy, and structure; '
            "only lift fonts/weights/letter-spacing/@import declarations from SOURCE.\n"
            '   - aspects=["layout"] → keep TARGET\'s typography, palette, and copy; adopt '
            "SOURCE's hero placement, grid/flex structure, alignment.\n"
            "3. When a style needs inclusion (e.g., a Google Fonts @import), bring it in as a new "
            '<style data-atelier-merge> block inside <head>. Do not edit the TARGET\'s existing '
            "style blocks unless unavoidable.\n"
            "4. Keep relative asset paths intact (anything under assets/... must stay as-is). Do "
            "NOT introduce new media/hero-*.jpeg references unless already present.\n"
            "5. Remove any <base> tag from <head>.\n"
            "6. After the HTML, write exactly `---META---` on a NEW line then a JSON object: "
            '{"title": "3-5 word descriptor", "summary": "one sentence describing what was '
            'merged", "reasoning": "2-3 sentences explaining which SOURCE qualities were lifted '
            'and what of TARGET was preserved"}.\n\n'
            "Output format (literal):\n"
            "<!DOCTYPE html>\n<html ...>\n...merged document...\n</html>\n---META---\n"
            '{"title": ..., "summary": ..., "reasoning": ...}\n'
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


class MergeIn(BaseModel):
    source_id: str
    aspects: list[str] = Field(default_factory=lambda: ["all"])
    model: str = "opus"
    user_note: str | None = Field(None, max_length=1000)


class MergeJobOut(BaseModel):
    job_id: str
    stream_url: str


class MergeChildOut(BaseModel):
    node_id: str
    primary_edge_id: str
    contribution_edge_id: str
    title: str | None
    summary: str | None
    build_status: str
    sandbox_url: str | None
    model_used: str
    token_usage: dict


def _child_out(
    new_node: Node,
    primary_edge: Edge,
    contribution_edge: Edge,
) -> MergeChildOut:
    return MergeChildOut(
        node_id=new_node.id,
        primary_edge_id=primary_edge.id,
        contribution_edge_id=contribution_edge.id,
        title=new_node.title,
        summary=new_node.summary,
        build_status=new_node.build_status,
        sandbox_url=storage.variant_url(new_node.id) if new_node.build_status == "ready" else None,
        model_used=new_node.model_used or "",
        token_usage=new_node.token_usage or {},
    )


async def _run_merge_job_bg(job_id: str, target_id: str, body: MergeIn) -> None:
    try:
        async with SessionLocal() as session:
            target = await session.get(Node, target_id)
            source = await session.get(Node, body.source_id)
            if not target or not source:
                await jobs.emit(
                    job_id, "error",
                    {"message": "Target or source node not found", "stage": "lookup"},
                )
                await jobs.emit(job_id, "done", {"ok": False})
                return
            if target.project_id != source.project_id:
                await jobs.emit(
                    job_id, "error",
                    {"message": "Cannot merge nodes from different projects.", "stage": "lookup"},
                )
                await jobs.emit(job_id, "done", {"ok": False})
                return

            # Rehydrate both (ephemeral Render disk might have evicted one).
            try:
                target_dir = await _ensure_parent_materialized(target)
                source_dir = await _ensure_parent_materialized(source)
            except FileNotFoundError as e:
                await jobs.emit(job_id, "error", {"message": str(e), "stage": "rehydrate"})
                await jobs.emit(job_id, "done", {"ok": False})
                return

            target.build_path = str(target_dir)
            source.build_path = str(source_dir)

            target_html = (target_dir / "index.html").read_text(encoding="utf-8")
            source_html = (source_dir / "index.html").read_text(encoding="utf-8")

            project = await session.get(Project, target.project_id)
            context_text = (project.settings or {}).get("context") if project else None

            await jobs.emit(
                job_id, "merging",
                {
                    "model": body.model,
                    "aspects": body.aspects,
                    "target_title": target.title or "target",
                    "source_title": source.title or "source",
                },
            )

            # Build the merge prompt.
            aspect_explainers = "\n".join(
                f"- {a}: {ASPECT_HINTS.get(a, ASPECT_HINTS['all'])}" for a in body.aspects
            )
            context_block = (
                f"PROJECT CONTEXT (respect these brand / audience notes):\n{context_text.strip()}\n\n"
                if context_text and context_text.strip()
                else ""
            )
            note_block = (
                f"ADDITIONAL USER NOTE:\n{body.user_note.strip()}\n\n"
                if body.user_note and body.user_note.strip()
                else ""
            )
            merge_user = (
                f"{context_block}"
                f"ASPECTS TO IMPORT FROM SOURCE INTO TARGET:\n{aspect_explainers}\n\n"
                f"{note_block}"
                f"TARGET (base — keep its structure and non-listed aspects):\n"
                f"```html\n{target_html[:30000]}\n```\n\n"
                f"SOURCE (contributor — lift the listed aspects from here):\n"
                f"```html\n{source_html[:30000]}\n```\n\n"
                "Produce the merged HTML document followed by ---META--- and the JSON meta."
            )

            started = time.time()
            resp = await claude_provider.call(
                system=MERGE_SYSTEM,
                user=merge_user,
                model=body.model,
                max_tokens=12000,
            )
            new_html, meta = _parse_llm_output(resp.text)
            await jobs.emit(
                job_id, "merged",
                {
                    "title": meta.get("title"),
                    "summary": meta.get("summary"),
                    "elapsed_ms": int((time.time() - started) * 1000),
                    "token_usage": resp.usage_dict,
                },
            )

            # Materialize the new variant (target tree as base + rewritten index.html).
            new_node = Node(
                project_id=target.project_id,
                parent_id=target.id,
                type="variant",
                title=meta.get("title") or "Merged variant",
                summary=meta.get("summary") or "Merged from two parents.",
                reasoning={
                    "source_id": source.id,
                    "source_title": source.title,
                    "target_id": target.id,
                    "target_title": target.title,
                    "aspects": body.aspects,
                    "user_note": body.user_note,
                    "rewriter_reasoning": meta.get("reasoning"),
                    "merge": True,
                },
                created_by="agent",
                model_used=resp.model,
                token_usage=resp.usage_dict,
                position_x=(target.position_x + source.position_x) / 2.0 + 60.0,
                position_y=max(target.position_y, source.position_y) + 260.0,
                build_status="building",
            )
            session.add(new_node)
            await session.flush()

            variant_dir = settings.assets_path / "variants" / new_node.id
            await jobs.emit(job_id, "uploading", {"node_id": new_node.id})
            upload_started = time.time()
            try:
                clone_tree(Path(target.build_path), variant_dir)
                apply_html_override(variant_dir, new_html)
                new_node.artifact_path = str(variant_dir)
                new_node.build_path = str(variant_dir)
                await storage.upload_variant_tree(new_node.id, variant_dir)
                new_node.build_status = "ready"
            except Exception as e:
                new_node.build_status = "error"
                new_node.summary = f"merge build failed: {e}"
                await session.commit()
                await jobs.emit(job_id, "error", {"message": str(e), "stage": "build"})
                await jobs.emit(job_id, "done", {"ok": False})
                return

            # Two edges: primary (target → child, "merge") + contribution (source → child).
            primary_edge = Edge(
                from_node_id=target.id,
                to_node_id=new_node.id,
                type="merge",
                prompt_text=f"[merge] {', '.join(body.aspects)} from {source.title or 'source'}",
                reasoning={"aspects": body.aspects, "role": "target"},
            )
            contribution_edge = Edge(
                from_node_id=source.id,
                to_node_id=new_node.id,
                type="contribution",
                prompt_text=f"[contribution] {', '.join(body.aspects)} into {target.title or 'target'}",
                reasoning={"aspects": body.aspects, "role": "source"},
            )
            session.add(primary_edge)
            session.add(contribution_edge)
            await session.flush()
            await session.commit()

            await jobs.emit(
                job_id, "uploaded",
                {"elapsed_ms": int((time.time() - upload_started) * 1000)},
            )

            child = _child_out(new_node, primary_edge, contribution_edge)
            await jobs.emit(job_id, "node-ready", child.model_dump())
            await jobs.emit(job_id, "done", {"ok": True})
    except Exception as e:  # pragma: no cover — defensive
        log.exception("merge job crashed")
        await jobs.emit(job_id, "error", {"message": f"Unexpected: {e}", "stage": "task"})
        await jobs.emit(job_id, "done", {"ok": False})
    finally:
        await jobs.retire(job_id)


@router.post("/nodes/{target_id}/merge/jobs", response_model=MergeJobOut)
async def enqueue_merge_job(target_id: str, body: MergeIn):
    if target_id == body.source_id:
        raise HTTPException(status_code=400, detail="target and source must differ")
    job_id = jobs.new_job_id()
    jobs.register_job(job_id)
    await jobs.emit(
        job_id, "job-started",
        {"target_id": target_id, "source_id": body.source_id, "aspects": body.aspects},
    )
    asyncio.create_task(_run_merge_job_bg(job_id, target_id, body))
    return MergeJobOut(job_id=job_id, stream_url=f"/api/v1/merge/jobs/{job_id}/stream")


_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


@router.get("/merge/jobs/{job_id}/stream")
async def stream_merge_job(job_id: str, request: Request):
    q = jobs.get_queue(job_id)
    if q is None:
        raise HTTPException(status_code=404, detail="Unknown or retired job_id")

    async def event_source() -> AsyncIterator[bytes]:
        yield b": connected\n\n"
        while True:
            if await request.is_disconnected():
                return
            try:
                payload = await asyncio.wait_for(q.get(), timeout=15.0)
            except asyncio.TimeoutError:
                yield b": ping\n\n"
                continue
            yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
            if payload.get("type") == "done":
                return

    return StreamingResponse(event_source(), headers=_SSE_HEADERS)
