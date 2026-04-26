from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select, func

from atelier_api import jobs
from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import SessionLocal, get_session
from atelier_api.layout import next_child_position
from atelier_api.llm import client as llm
from atelier_api.pricing import project_total_cost_cents
from atelier_api.storage import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/nodes", tags=["fork"])

SHOOTOUT_MODELS = ["haiku", "sonnet", "opus"]

FORK_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are Atelier, a frontend-design iteration engine. Given an HTML document "
            "(the 'parent' variant) and a short user instruction, produce a modified HTML "
            "document that applies the instruction as a visible, MEASURABLE design change.\n\n"
            "Rules:\n"
            "1. Return a COMPLETE HTML document including <!DOCTYPE html>, <html>, <head>, <body>.\n"
            "2. Preserve all existing <script> tags, <link rel=\"stylesheet\">, <img>, and <base> exactly; only change what the instruction asks for, or visual CSS that realises the instruction.\n"
            "3. Prefer adding a <style data-atelier-change> block inside <head> with rules that override existing styles, rather than editing existing CSS files.\n"
            "4. Keep relative asset paths intact (anything under assets/... must stay as-is).\n"
            "5. Do NOT introduce external fonts, frameworks, or CDN links the document doesn't already use.\n"
            "6. **Make the change SUBSTANTIAL.** A user looking at the parent and the new variant side by side must see at least 3 distinct, measurable differences. If the instruction is 'bolder headline', that means font-weight up to at least 800 AND a 25%+ font-size bump AND tighter letter-spacing — not a 100→500 weight nudge alone. If it's 'warmer palette', shift hue across at least background + accent + text-secondary, not just one swatch. **A diff that's 95% identical to the parent is a FAILURE.** Push the design hard in the requested direction; cosmetic micro-changes are useless for design iteration.\n"
            "7. After the HTML, on a NEW line, write exactly `---META---` then a short JSON object "
            '{"title": "2-4 word headline (no commas, no full sentences, like a chapter heading)", '
            '"summary": "one sentence what changed", "reasoning": "2-3 sentences why this achieves the goal", '
            '"changes": ["concrete change 1 with numbers (e.g. h1 font-weight 600 -> 900)", "concrete change 2", "concrete change 3"]}.\n'
            'Title examples that work: "Editorial Serif Hero", "Bolder Headline", "Calmer Spacing".\n'
            'Title examples to avoid: "Bolder headline, larger CTA" (has comma), '
            '"Made the headline shorter and bolder" (full sentence, too long).\n'
            'The `changes` array must list at least 3 concrete deltas with numeric values where possible. '
            'If you can\'t list 3 substantial changes, your variant isn\'t different enough — push harder.\n\n'
            "Output format (literal, no other commentary):\n"
            "<!DOCTYPE html>\n<html ...>\n...full document...\n</html>\n---META---\n{\"title\": ..., \"summary\": ..., \"reasoning\": ..., \"changes\": [...]}\n"
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


def _build_pins_block(style_pins: list[dict] | None) -> str:
    """Render style pins into a prompt fragment. Strict pins escalate to
    "ABSOLUTE / NON-NEGOTIABLE" language and are listed in their own section
    above the soft pins so the model can't gloss over them."""
    if not style_pins:
        return ""
    strict_lines: list[str] = []
    soft_lines: list[str] = []
    for p in style_pins:
        if not (p.get("prop") and p.get("value")):
            continue
        line = f"- {p['prop']}: {p['value']}"
        if p.get("strict"):
            strict_lines.append(line)
        else:
            soft_lines.append(line)
    blocks: list[str] = []
    if strict_lines:
        blocks.append(
            "STRICT STYLE PINS — ABSOLUTE, NON-NEGOTIABLE. The output MUST contain these "
            "EXACT values verbatim. They override the user's instruction if they conflict. "
            "Do NOT round, approximate, rename, or substitute. If a pin is `primary color: "
            "#3b5d3a`, that exact hex MUST appear in the rendered CSS:\n"
            + "\n".join(strict_lines)
        )
    if soft_lines:
        blocks.append(
            "STYLE PINS — hard constraints. Every variant MUST honor these exact values, "
            "no matter what the instruction asks for. If they conflict with the "
            "instruction, the pins win:\n"
            + "\n".join(soft_lines)
        )
    return "\n\n".join(blocks) + "\n\n"


def _strict_color_pins_violated(html: str, style_pins: list[dict] | None) -> list[dict]:
    """Return the subset of strict color pins whose value is missing from the
    HTML. Only `kind == "color"` + `strict == True` pins are checked: those are
    the ones with a match reliable enough to be worth a re-prompt round.
    Other kinds (dimension/enum/font/text) are too noisy to validate this way
    and are left to the prompt's MUST language.

    Match is regex-based (not substring) so a 3-char hex like `#abc` doesn't
    spuriously satisfy a check against an HTML containing `#abcdef`. The
    trailing `(?![0-9a-f])` lookahead enforces a real boundary."""
    if not style_pins:
        return []
    import re

    violations: list[dict] = []
    lowered = html.lower()
    for p in style_pins:
        if p.get("kind") != "color" or not p.get("strict"):
            continue
        val = (p.get("value") or "").strip().lower()
        if not val:
            continue
        # Tolerate an absent leading '#' on the pin's stored value.
        candidates = {val, val if val.startswith("#") else f"#{val}"}
        if not any(re.search(rf"{re.escape(c)}(?![0-9a-f])", lowered) for c in candidates):
            violations.append(p)
    return violations


async def _project_cost_status(
    session: AsyncSession, project_id: str
) -> tuple[int, int | None]:
    """Return (total_cost_cents, cost_cap_cents) for the project. Cap is None
    when unset. Used by both fork paths to gate before hitting the LLM.

    Sums across ALL nodes (not just visible-under-checkpoint) because the cap
    is about lifetime spend, not what's currently rendered."""
    nodes = (
        (await session.execute(select(Node).where(Node.project_id == project_id))).scalars().all()
    )
    project = await session.get(Project, project_id)
    # Pass the project so prior React-export spend (stored under
    # `settings.cost_events` because that route doesn't persist a Node) gets
    # folded into the cap check.
    total = project_total_cost_cents(nodes, project=project)
    raw_cap = (project.settings or {}).get("cost_cap_cents") if project else None
    cap = int(raw_cap) if isinstance(raw_cap, (int, float)) and raw_cap > 0 else None
    return total, cap


async def _generate_one(
    parent_html: str,
    prompt: str,
    model_choice: str,
    context: str | None = None,
    style_pins: list[dict] | None = None,
) -> tuple[str, dict, llm.LlmResponse]:
    context_block = (
        f"USER CONTEXT (project preferences, audience, brand notes — respect these):\n{context.strip()}\n\n"
        if context and context.strip()
        else ""
    )
    pins_block = _build_pins_block(style_pins)
    user_msg = (
        f"{context_block}{pins_block}INSTRUCTION:\n{prompt}\n\nPARENT_HTML (truncated if long):\n```html\n{parent_html[:60000]}\n```\n\n"
        "Now produce the modified HTML document followed by ---META--- and the JSON meta."
    )
    resp = await llm.call(system=FORK_SYSTEM, user=user_msg, model=model_choice, max_tokens=8192)
    html, meta = _parse_llm_output(resp.text)

    # One-shot strict-pin validation. If a strict color pin's hex didn't make
    # it into the generated HTML, re-prompt once with an explicit correction
    # message. We deliberately cap this at a single retry: the goal is to
    # catch the "Sonnet ignored my brand color" case, not loop forever.
    violations = _strict_color_pins_violated(html, style_pins)
    if violations:
        violation_lines = "\n".join(
            f"- {p['prop']}: {p['value']} (this exact hex was missing from your output)"
            for p in violations
        )
        retry_msg = (
            f"{context_block}{pins_block}INSTRUCTION:\n{prompt}\n\n"
            "YOUR PREVIOUS ATTEMPT VIOLATED THESE STRICT PINS:\n"
            f"{violation_lines}\n\n"
            "Re-output the HTML document, this time using the EXACT hex values above "
            "wherever the corresponding design property appears. Do not approximate or "
            "substitute.\n\n"
            f"PARENT_HTML (truncated if long):\n```html\n{parent_html[:60000]}\n```\n\n"
            "Now produce the corrected HTML document followed by ---META--- and the JSON meta."
        )
        try:
            resp_retry = await llm.call(
                system=FORK_SYSTEM, user=retry_msg, model=model_choice, max_tokens=8192
            )
            html_retry, meta_retry = _parse_llm_output(resp_retry.text)
            # Only adopt the retry if it actually fixes the violation; otherwise
            # keep the original so the user at least sees a complete page.
            if not _strict_color_pins_violated(html_retry, style_pins):
                html, meta, resp = html_retry, meta_retry, resp_retry
        except Exception:
            log.exception("strict-pin re-prompt failed; keeping original generation")

    return html, meta, resp


@router.post("/{parent_id}/fork", response_model=list[ForkChildOut])
async def fork_node(parent_id: str, body: ForkIn, session: AsyncSession = Depends(get_session)):
    parent = await session.get(Node, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent node not found")
    if not parent.build_path:
        raise HTTPException(status_code=400, detail="Parent has no artifact to fork from. Re-seed the project.")

    # Rehydrate from Supabase if the parent's files were evicted between deploys
    # (Render web services have ephemeral disk).
    from atelier_api.routes.media import _ensure_parent_materialized
    try:
        parent_dir = await _ensure_parent_materialized(parent)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    parent.build_path = str(parent_dir)
    parent_html = (parent_dir / "index.html").read_text(encoding="utf-8")

    # Load project for context (user-provided preferences that flavor every generation).
    project = await session.get(Project, parent.project_id)
    context_text = (project.settings or {}).get("context") if project else None
    style_pins = (project.settings or {}).get("style_pins") if project else None

    # Resolve which models to run. Shootout = one variant per model, overriding n + model.
    if body.shootout:
        models_to_run = list(SHOOTOUT_MODELS)
    else:
        models_to_run = [body.model or "sonnet"] * body.n

    # Soft cost cap. If lifetime spend already met the user's cap, refuse the
    # fork BEFORE we issue any LLM call — Karim's "runaway fan" guard. Seed
    # creation is unaffected (only fork attempts pass through this path).
    total_cents, cap_cents = await _project_cost_status(session, parent.project_id)
    if cap_cents is not None and total_cents >= cap_cents:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Project cost cap reached (${cap_cents / 100:.2f}). "
                "Raise the cap in Project Context to continue."
            ),
        )

    generations = await asyncio.gather(
        *[
            _generate_one(parent_html, body.prompt, m, context=context_text, style_pins=style_pins)
            for m in models_to_run
        ],
        return_exceptions=True,
    )

    results: list[ForkChildOut] = []
    # Existing siblings already determine where the new fan should start so
    # we don't overlap them. Then spread *this batch* horizontally around
    # that anchor. (Sync path is rarely used; SSE path uses next_child_position.)
    existing_siblings_q = await session.execute(
        select(func.count()).select_from(Node).where(Node.parent_id == parent.id)
    )
    existing_siblings = int(existing_siblings_q.scalar() or 0)
    from atelier_api.layout import CHILD_X_STEP

    count = len(models_to_run)
    base_x = parent.position_x + existing_siblings * CHILD_X_STEP - (count - 1) * (CHILD_X_STEP / 2)
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
                # Concrete diffs Claude declared (added in the variance-
                # tightened system prompt). Used by VariantNode to show
                # "what actually changed" chips on the card.
                "changes": meta.get("changes", []),
            },
            created_by="agent",
            model_used=resp.model,
            token_usage=resp.usage_dict,
            position_x=base_x + i * CHILD_X_STEP,
            position_y=parent.position_y + 290.0,
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


# ─── Async/SSE path ──────────────────────────────────────────────────────────
#
# Used by the Feedback + Critics "Apply" flows so users see live progress
# instead of a 30-40s blank spinner. n=1 only (shootouts stay on the sync
# endpoint).


class ForkReference(BaseModel):
    """Link the user/AI considered when composing the prompt — surfaced as
    citation chips on the resulting variant card so users can audit
    'where did this idea come from'."""

    url: str
    title: str | None = None


class ForkJobIn(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    model: str | None = "sonnet"
    # Optional: when the prompt was composed from a Genspark-grounded
    # critic apply, attach the source URLs so the new variant's card can
    # display "based on aesop.com / awwwards.com" provenance chips.
    references: list[ForkReference] | None = None


class ForkJobOut(BaseModel):
    job_id: str
    stream_url: str


async def _run_fork_job_bg(job_id: str, parent_id: str, body: ForkJobIn) -> None:
    try:
        async with SessionLocal() as session:
            parent = await session.get(Node, parent_id)
            if not parent:
                await jobs.emit(job_id, "error", {"message": "Parent not found", "stage": "lookup"})
                await jobs.emit(job_id, "done", {"ok": False})
                return
            if not parent.build_path:
                await jobs.emit(
                    job_id, "error",
                    {"message": "Parent has no artifact to fork from.", "stage": "lookup"},
                )
                await jobs.emit(job_id, "done", {"ok": False})
                return

            from atelier_api.routes.media import _ensure_parent_materialized
            try:
                parent_dir = await _ensure_parent_materialized(parent)
            except FileNotFoundError as e:
                await jobs.emit(job_id, "error", {"message": str(e), "stage": "rehydrate"})
                await jobs.emit(job_id, "done", {"ok": False})
                return

            parent.build_path = str(parent_dir)
            parent_html = (parent_dir / "index.html").read_text(encoding="utf-8")

            project = await session.get(Project, parent.project_id)
            context_text = (project.settings or {}).get("context") if project else None
            style_pins = (project.settings or {}).get("style_pins") if project else None

            # Soft cost cap (SSE path). Same gate as the sync `/fork` endpoint
            # but emits a `cost-capped` event instead of raising HTTP 402, so
            # the UI can show a polished message rather than a stream error.
            total_cents, cap_cents = await _project_cost_status(session, parent.project_id)
            if cap_cents is not None and total_cents >= cap_cents:
                await jobs.emit(
                    job_id,
                    "cost-capped",
                    {
                        "total_cost_cents": total_cents,
                        "cost_cap_cents": cap_cents,
                        "message": (
                            f"Project cost cap reached (${cap_cents / 100:.2f}). "
                            "Raise the cap in Project Context to continue."
                        ),
                    },
                )
                await jobs.emit(job_id, "done", {"ok": False})
                return

            model_choice = body.model or "sonnet"
            await jobs.emit(job_id, "rewriting-html", {"model": model_choice})
            started = time.time()
            try:
                html, meta, resp = await _generate_one(
                    parent_html,
                    body.prompt,
                    model_choice,
                    context=context_text,
                    style_pins=style_pins,
                )
            except Exception as e:
                log.exception("fork job generation failed")
                await jobs.emit(job_id, "error", {"message": f"LLM call failed: {e}", "stage": "generate"})
                await jobs.emit(job_id, "done", {"ok": False})
                return
            await jobs.emit(
                job_id,
                "html-rewritten",
                {
                    "title": meta.get("title"),
                    "summary": meta.get("summary"),
                    "elapsed_ms": int((time.time() - started) * 1000),
                    "token_usage": resp.usage_dict,
                },
            )

            # Materialize + edge — `next_child_position` counts existing
            # siblings of `parent` and fans the new child out so it doesn't
            # land on top of an earlier fork.
            child_x, child_y = await next_child_position(session, parent)
            node = Node(
                project_id=parent.project_id,
                parent_id=parent.id,
                type="variant",
                title=meta.get("title"),
                summary=meta.get("summary"),
                reasoning={
                    "prompt": body.prompt,
                    "reasoning": meta.get("reasoning", ""),
                    "model_key": model_choice,
                    # Preserve optional Genspark grounding references — the
                    # variant card uses them to render citation chips so
                    # users can audit "this came from Aesop / Awwwards".
                    "references": (
                        [r.model_dump() for r in body.references]
                        if body.references
                        else []
                    ),
                    # Concrete diffs from the Claude rewrite (added in the
                    # variance-tightened system prompt). Surfaced on the
                    # variant card so users see what actually changed.
                    "changes": meta.get("changes", []),
                },
                created_by="agent",
                model_used=resp.model,
                token_usage=resp.usage_dict,
                position_x=child_x,
                position_y=child_y,
                build_status="building",
            )
            session.add(node)
            await session.flush()

            variant_dir = settings.assets_path / "variants" / node.id
            await jobs.emit(job_id, "uploading", {"node_id": node.id})
            upload_started = time.time()
            try:
                from atelier_api.sandbox.mutator import apply_html_override, clone_tree

                clone_tree(Path(parent.build_path), variant_dir)
                apply_html_override(variant_dir, html)
                node.artifact_path = str(variant_dir)
                node.build_path = str(variant_dir)
                await storage.upload_variant_tree(node.id, variant_dir)
                node.build_status = "ready"
            except Exception as e:
                node.build_status = "error"
                node.summary = f"build failed: {e}"
                await session.commit()
                await jobs.emit(job_id, "error", {"message": str(e), "stage": "build"})
                await jobs.emit(job_id, "done", {"ok": False})
                return

            edge = Edge(
                from_node_id=parent.id,
                to_node_id=node.id,
                type="prompt",
                prompt_text=body.prompt,
            )
            session.add(edge)
            await session.flush()
            await session.commit()
            await jobs.emit(
                job_id, "uploaded",
                {"elapsed_ms": int((time.time() - upload_started) * 1000)},
            )

            child = ForkChildOut(
                node_id=node.id,
                edge_id=edge.id,
                title=node.title,
                summary=node.summary,
                build_status=node.build_status,
                sandbox_url=storage.variant_url(node.id) if node.build_status == "ready" else None,
                model_used=node.model_used or "",
                token_usage=node.token_usage or {},
            )
            await jobs.emit(job_id, "node-ready", child.model_dump())
            await jobs.emit(job_id, "done", {"ok": True})
    except Exception as e:
        log.exception("fork job crashed")
        await jobs.emit(job_id, "error", {"message": f"Unexpected: {e}", "stage": "task"})
        await jobs.emit(job_id, "done", {"ok": False})
    finally:
        await jobs.retire(job_id)


@router.post("/{parent_id}/fork/jobs", response_model=ForkJobOut)
async def enqueue_fork_job(parent_id: str, body: ForkJobIn):
    job_id = jobs.new_job_id()
    jobs.register_job(job_id)
    await jobs.emit(job_id, "job-started", {"parent_id": parent_id, "model": body.model})
    asyncio.create_task(_run_fork_job_bg(job_id, parent_id, body))
    return ForkJobOut(job_id=job_id, stream_url=f"/api/v1/fork/jobs/{job_id}/stream")


_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


# Sibling router — not prefixed with /nodes, so the stream path is
# /api/v1/fork/jobs/{id}/stream (same shape as media + merge).
stream_router = APIRouter(tags=["fork-stream"])


@stream_router.get("/fork/jobs/{job_id}/stream")
async def stream_fork_job(job_id: str, request: Request):
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
