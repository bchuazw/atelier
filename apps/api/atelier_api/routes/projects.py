from __future__ import annotations

import json
import logging
import re
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import get_session
from atelier_api.llm import client as llm
from atelier_api.pricing import cost_cents_for_usage, project_total_cost_cents
from atelier_api.sandbox.fetcher import USER_AGENT, fetch_page, save_html_as_seed
from atelier_api.storage import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


StylePinKind = Literal["color", "dimension", "enum", "font", "text"]


class StylePin(BaseModel):
    """A single structured design constraint the user wants every fork to
    honor. Stored in project.settings.style_pins; injected into every fork +
    critic prompt as a short bullet list.

      - prop:   the design property being pinned ("h1 weight", "primary color")
      - value:  the value to honor ("800", "#c87050", "1.25 ratio")
      - kind:   typed schema discriminator. Drives the input control in the UI
                and (for `color`) enables a post-generation validation pass.
                Absent on legacy pins -> treated as "text".
      - strict: when true, the prompt language escalates from "honor" to
                "MUST / ABSOLUTE", and a single re-prompt round triggers if
                a checkable pin (currently: color hex) is missing from the
                generated HTML. Defaults False so existing pins behave the
                same as before."""

    prop: str
    value: str
    kind: StylePinKind = "text"
    strict: bool = False


class CreateProjectIn(BaseModel):
    # Server-side input bounds — earlier the API trusted the client
    # entirely, so direct POSTs with empty/whitespace/5000-char names
    # all returned 200. An adversarial QA pass found this; tightening to
    # 1-200 chars after strip (matches the in-route check on PATCH name).
    name: str = Field(..., min_length=1, max_length=200)
    seed_url: str | None = Field(default=None, max_length=2048)
    seed_html: str | None = Field(default=None, max_length=500_000)  # paste-HTML alternative to seed_url
    # Optional Brand Kit pins pre-loaded from the New Project dialog. Stored
    # in project.settings["style_pins"] using the same shape patch_project
    # writes, so the rest of the pipeline (fork prompt builder, ContextPanel,
    # validator) sees no schema difference between project-create and patch.
    style_pins: list[StylePin] | None = None
    # Per-visitor workspace tag. Single-tenant deployments share one DB so
    # without this every visitor saw every other visitor's projects (a beta
    # tester said the dashboard "reads as a debug environment"). The client
    # generates a UUID on first load, stores it in localStorage, and sends
    # it on every project-create. Persisted into project.settings so the
    # `list_projects` endpoint can filter on it. Optional for backwards
    # compatibility — legacy projects without the tag still appear in
    # everyone's list (no orphans).
    workspace_id: str | None = Field(default=None, max_length=128)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        # Pydantic's `strip_whitespace=True` doesn't re-check min_length
        # against the stripped value, so a whitespace-only name slipped
        # through. Explicit strip + non-empty check.
        v = v.strip()
        if not v:
            raise ValueError("name must contain non-whitespace characters")
        return v


class ProjectOut(BaseModel):
    id: str
    name: str
    seed_url: str | None
    working_node_id: str | None
    created_at: str
    # Lightweight metadata for the recent-projects list — populated only by
    # `list_projects` (the per-project `tree` endpoint already returns the
    # full node graph so it doesn't need them).
    node_count: int = 0
    last_activity: str | None = None  # ISO string; defaults to created_at
    # Soft-archive flag, persisted in `project.settings["archived"]`. Default
    # false (legacy projects without the key parse as not-archived). The
    # default `list_projects` response hides archived rows; pass
    # `?include_archived=true` to see them.
    archived: bool = False


class ProjectPatchIn(BaseModel):
    # Any field provided is updated; omitted fields are left alone.
    context: str | None = None
    active_checkpoint_id: str | None = None
    clear_checkpoint: bool | None = None
    name: str | None = None  # rename the project (validated in route)
    style_pins: list[StylePin] | None = None  # full replace when provided
    # Soft cap on lifetime project spend, in USD cents. When set and the
    # rollup reaches this value, fork attempts fail fast with HTTP 402 (or
    # an SSE `cost-capped` event). 0 disables the cap (treated as "unset"),
    # negative is rejected. Persisted in `project.settings["cost_cap_cents"]`.
    cost_cap_cents: int | None = None
    # Soft-archive toggle. When true the project is hidden from the default
    # recent-projects list; when false it's restored. Persisted in
    # `project.settings["archived"]`. Legacy projects with no key behave as
    # archived=false.
    archived: bool | None = None
    # Re-tag the project to a different workspace code. Used by the
    # "Adopt this project" recovery flow when a user opens a deep-linked
    # project that belongs to another workspace, and by the "Move to
    # workspace" flow if we add cross-workspace moves later. Empty string
    # ("") clears the tag, making the project untagged (only reachable
    # via direct URL). Trust model: cookie-based, no auth — anyone with
    # the project URL can already edit, so re-tagging is the same blast
    # radius. Real auth (Future Improvement #1) tightens this.
    workspace_id: str | None = Field(default=None, max_length=128)


@router.post("", response_model=ProjectOut)
async def create_project(body: CreateProjectIn, session: AsyncSession = Depends(get_session)):
    if body.seed_url and body.seed_html:
        raise HTTPException(
            status_code=400,
            detail="Provide either seed_url OR seed_html, not both.",
        )
    project = Project(name=body.name, seed_url=body.seed_url)
    # Pre-load Brand Kit pins from the New Project dialog into
    # project.settings["style_pins"], using the same shape + validation
    # patch_project writes (filter blanks, cap at 12, preserve kind+strict).
    # JSON schema is unchanged: this is the same key the ContextPanel reads
    # and the fork prompt builder injects — the dialog now just primes it on
    # create so users don't have to re-type their brand on every fork.
    if body.style_pins:
        cleaned_pins = [
            {
                "prop": p.prop.strip(),
                "value": p.value.strip(),
                "kind": p.kind,
                "strict": p.strict,
            }
            for p in body.style_pins
            if p.prop.strip() and p.value.strip()
        ][:12]
        if cleaned_pins:
            project.settings = {**(project.settings or {}), "style_pins": cleaned_pins}
    # Tag this project with the visitor's workspace_id (when provided). The
    # `list_projects` filter respects it so each visitor only sees their own
    # projects + legacy untagged ones. Stored under settings.workspace_id.
    ws_id = (body.workspace_id or "").strip()
    if ws_id:
        project.settings = {**(project.settings or {}), "workspace_id": ws_id}
    session.add(project)
    await session.flush()

    # Seed node (always create one; seed empty if no source).
    seed_summary = (
        f"Original: {body.seed_url}"
        if body.seed_url
        else (f"Pasted HTML ({len(body.seed_html)} chars)" if body.seed_html else "Blank seed")
    )
    seed = Node(
        project_id=project.id,
        type="seed",
        title="Seed",
        summary=seed_summary,
        position_x=0.0,
        position_y=0.0,
        created_by="user",
    )
    session.add(seed)
    await session.flush()

    if body.seed_url or body.seed_html:
        variant_dir = settings.assets_path / "variants" / seed.id
        try:
            if body.seed_html:
                index_path = await save_html_as_seed(body.seed_html, variant_dir)
            else:
                index_path = await fetch_page(body.seed_url, variant_dir)  # type: ignore[arg-type]
            seed.artifact_path = str(variant_dir)
            seed.build_path = str(index_path.parent)
            await storage.upload_variant_tree(seed.id, variant_dir)
            seed.build_status = "ready"
        except Exception as e:
            seed.build_status = "error"
            seed.summary = f"Seed prep failed: {e}"

    project.working_node_id = seed.id
    await session.commit()
    await session.refresh(project)

    return ProjectOut(
        id=project.id,
        name=project.name,
        seed_url=project.seed_url,
        working_node_id=project.working_node_id,
        created_at=project.created_at,
    )


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    include_archived: bool = False,
    workspace: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import func as sql_func

    rows = (await session.execute(select(Project).order_by(Project.created_at.desc()))).scalars().all()

    # Attach per-project node_count + last_activity in one batched query so
    # the recent-projects panel can show useful metadata without N+1 calls.
    if rows:
        ids = [p.id for p in rows]
        meta = (
            await session.execute(
                select(Node.project_id, sql_func.count(Node.id), sql_func.max(Node.created_at))
                .where(Node.project_id.in_(ids))
                .group_by(Node.project_id)
            )
        ).all()
        meta_by_id = {row[0]: (int(row[1]), row[2]) for row in meta}
    else:
        meta_by_id = {}

    ws_filter = (workspace or "").strip() or None
    out: list[ProjectOut] = []
    for p in rows:
        node_count, last_activity = meta_by_id.get(p.id, (0, None))
        # Legacy projects without the `archived` settings key default to
        # not-archived — they keep showing up exactly as before.
        archived = bool((p.settings or {}).get("archived", False))
        if archived and not include_archived:
            continue
        # Workspace filter: if `?workspace=<id>` was provided, only return
        # projects whose tag matches exactly. Pre-commercial behaviour also
        # returned untagged legacy projects to every workspace — that was
        # a hackathon-era convenience that leaked other users' work into
        # every fresh signup's recents list. Now strict: untagged projects
        # are accessible by direct URL only and never appear in any
        # workspace's listing. Admin/MCP callers omit the param entirely
        # and still see everything.
        if ws_filter is not None:
            project_ws = (p.settings or {}).get("workspace_id")
            if project_ws != ws_filter:
                continue
        out.append(
            ProjectOut(
                id=p.id,
                name=p.name,
                seed_url=p.seed_url,
                working_node_id=p.working_node_id,
                created_at=p.created_at,
                node_count=node_count,
                last_activity=last_activity or p.created_at,
                archived=archived,
            )
        )
    return out


@router.get("/{project_id}/tree")
async def get_tree(
    project_id: str,
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    all_nodes = (
        (await session.execute(select(Node).where(Node.project_id == project_id))).scalars().all()
    )

    proj_settings = project.settings or {}
    checkpoint_id = proj_settings.get("active_checkpoint_id")

    # When a checkpoint is active, the tree collapses to the subtree rooted at that
    # node. Older siblings/ancestors are "archived" (still in DB, hidden from default
    # tree loads for perf + focus). Callers can pass ?include_archived=true to see
    # everything regardless.
    total_count = len(all_nodes)
    filtered_by_checkpoint: list[Node] = all_nodes
    if checkpoint_id:
        by_id = {n.id: n for n in all_nodes}
        if checkpoint_id in by_id:
            children_of: dict[str, list[Node]] = {}
            for n in all_nodes:
                if n.parent_id:
                    children_of.setdefault(n.parent_id, []).append(n)
            visible: list[Node] = []
            stack = [checkpoint_id]
            seen: set[str] = set()
            while stack:
                nid = stack.pop()
                if nid in seen:
                    continue
                seen.add(nid)
                node = by_id.get(nid)
                if node is None:
                    continue
                visible.append(node)
                for child in children_of.get(nid, []):
                    stack.append(child.id)
            filtered_by_checkpoint = visible
        # If checkpoint node was deleted, silently fall back to showing everything.

    nodes = all_nodes if include_archived else filtered_by_checkpoint
    # archived_count reflects what would be hidden under the checkpoint — stable
    # across include_archived=true/false so the UI can always show "N archived".
    archived_count = total_count - len(filtered_by_checkpoint)

    node_ids = [n.id for n in nodes]
    visible_id_set = set(node_ids)
    edges: list[Edge] = []
    if node_ids:
        raw_edges = (
            (
                await session.execute(
                    select(Edge).where(Edge.from_node_id.in_(node_ids) | Edge.to_node_id.in_(node_ids))
                )
            )
            .scalars()
            .all()
        )
        # Only surface edges whose BOTH endpoints are visible (so archived parents don't dangle).
        edges = [e for e in raw_edges if e.from_node_id in visible_id_set and e.to_node_id in visible_id_set]

    # Lifetime project cost, summed across every node's token_usage with the
    # node's actual model id. Cents (integer) on the wire so the client never
    # rounds floats. Always computed across `all_nodes`, not the visible
    # subset — a checkpoint hides nodes from the canvas but their cost still
    # counts against the project's lifetime spend.
    total_cost_cents = project_total_cost_cents(all_nodes, project=project)
    # Soft cap stored as int cents in project.settings, or null when unset.
    raw_cap = proj_settings.get("cost_cap_cents")
    cost_cap_cents: int | None = int(raw_cap) if isinstance(raw_cap, (int, float)) and raw_cap > 0 else None

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "seed_url": project.seed_url,
            "working_node_id": project.working_node_id,
            "context": proj_settings.get("context", ""),
            "style_pins": proj_settings.get("style_pins", []),
            "active_checkpoint_id": checkpoint_id,
            "archived_count": archived_count,
            "total_count": total_count,
            "total_cost_cents": total_cost_cents,
            "cost_cap_cents": cost_cap_cents,
        },
        "nodes": [
            {
                "id": n.id,
                "parent_id": n.parent_id,
                "type": n.type,
                "title": n.title,
                "summary": n.summary,
                "build_status": n.build_status,
                "model_used": n.model_used,
                "position": {"x": n.position_x, "y": n.position_y},
                "sandbox_url": storage.variant_url(n.id) if n.build_status == "ready" else None,
                "created_at": n.created_at,
                "is_checkpoint": bool(checkpoint_id) and n.id == checkpoint_id,
                # Slim subset of n.reasoning for the variant card —
                # `references` (Genspark grounding) + `changes` (the diffs
                # the rewriter declared) + `prompt` (so Re-run can use it
                # without a separate fetch). Heavy fields like the full
                # rewriter reasoning stay server-side.
                "reasoning": (
                    {
                        "prompt": (n.reasoning or {}).get("prompt"),
                        "references": (n.reasoning or {}).get("references", []) or [],
                        "changes": (n.reasoning or {}).get("changes", []) or [],
                    }
                    if n.reasoning
                    else None
                ),
                # Per-variant token usage so the card can show "this fork
                # cost ~$0.012". Only returned when present (seed nodes
                # have no usage).
                "token_usage": n.token_usage,
            }
            for n in nodes
        ],
        "edges": [
            {
                "id": e.id,
                "from": e.from_node_id,
                "to": e.to_node_id,
                "type": e.type,
                "prompt_text": e.prompt_text,
            }
            for e in edges
        ],
    }


@router.patch("/{project_id}")
async def patch_project(
    project_id: str,
    body: ProjectPatchIn,
    session: AsyncSession = Depends(get_session),
):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Rebuild settings dict (SQLAlchemy dirty-tracking on JSON columns needs a new object).
    current = dict(project.settings or {})
    if body.context is not None:
        current["context"] = body.context
    if body.clear_checkpoint:
        current.pop("active_checkpoint_id", None)
    elif body.active_checkpoint_id is not None:
        # Validate the node belongs to this project before pinning it.
        node = await session.get(Node, body.active_checkpoint_id)
        if not node or node.project_id != project_id:
            raise HTTPException(status_code=400, detail="Checkpoint node not in this project")
        current["active_checkpoint_id"] = body.active_checkpoint_id
    if body.style_pins is not None:
        # Filter empty/blank pins; cap at 12 to keep the prompt short.
        # Persist `kind` + `strict` so the fork prompt builder + validator
        # can pick them up. Legacy pins without `kind` keep working because
        # StylePin defaults `kind="text"` on parse.
        cleaned = [
            {
                "prop": p.prop.strip(),
                "value": p.value.strip(),
                "kind": p.kind,
                "strict": p.strict,
            }
            for p in body.style_pins
            if p.prop.strip() and p.value.strip()
        ][:12]
        current["style_pins"] = cleaned
    if body.cost_cap_cents is not None:
        # 0 (or negative) clears the cap; positive ints set/replace it.
        if body.cost_cap_cents <= 0:
            current.pop("cost_cap_cents", None)
        else:
            current["cost_cap_cents"] = int(body.cost_cap_cents)
    if body.archived is not None:
        # Soft-archive flag. Stored under `archived` so the list endpoint can
        # filter without a schema migration. False removes the key (so the
        # JSON stays clean and legacy/restored projects look identical).
        if body.archived:
            current["archived"] = True
        else:
            current.pop("archived", None)
    if body.workspace_id is not None:
        # Re-tag to a different workspace. Empty string clears the tag
        # (untagged → only reachable via direct URL). Trim + length guard
        # mirrors CreateProjectIn so a user can't sneak a 5MB string in.
        new_ws = body.workspace_id.strip()
        if len(new_ws) > 128:
            raise HTTPException(status_code=400, detail="Workspace code must be ≤128 chars.")
        if new_ws:
            current["workspace_id"] = new_ws
        else:
            current.pop("workspace_id", None)
    project.settings = current
    if body.name is not None:
        new_name = body.name.strip()
        if not new_name or len(new_name) > 200:
            raise HTTPException(status_code=400, detail="Project name must be 1–200 characters.")
        project.name = new_name
    await session.commit()
    return {
        "ok": True,
        "name": project.name,
        "context": current.get("context", ""),
        "style_pins": current.get("style_pins", []),
        "active_checkpoint_id": current.get("active_checkpoint_id"),
        "cost_cap_cents": current.get("cost_cap_cents"),
        "archived": bool(current.get("archived", False)),
    }


@router.delete("/{project_id}")
async def delete_project(project_id: str, session: AsyncSession = Depends(get_session)):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Gather node ids before the cascade delete so we can clean up storage.
    node_ids = [
        nid
        for (nid,) in (
            await session.execute(select(Node.id).where(Node.project_id == project_id))
        ).all()
    ]

    # Break the self-referencing parent_id chain so the project cascade
    # (which deletes all nodes at once) doesn't hit a FK violation in
    # environments where the Node.parent_id FK lacks ON DELETE CASCADE /
    # SET NULL (older databases created before the model was fixed).
    from sqlalchemy import update as sql_update

    await session.execute(
        sql_update(Node).where(Node.project_id == project_id).values(parent_id=None)
    )
    await session.flush()

    await session.delete(project)
    await session.commit()

    # Best-effort storage cleanup. Failures don't roll back the DB delete —
    # at worst we leave orphaned objects that are easy to GC later.
    cleaned = 0
    failed: list[str] = []
    for nid in node_ids:
        try:
            await storage.delete_variant_tree(nid)
            cleaned += 1
        except Exception as e:  # pragma: no cover — defensive
            failed.append(f"{nid}: {e}")
    return {"ok": True, "node_count": len(node_ids), "storage_cleaned": cleaned, "storage_failed": failed}


# ---------------------------------------------------------------------------
# /projects/extract-design
#
# "Match an existing site": fetch a URL, hand the HTML to Claude, and get back
# (a) a one-line summary of the visual style, (b) a starter list of Style Pins
# the user can promote into the new project's Brand Kit, and (c) a seed HTML
# scaffold the user will then prompt-fork from. This collapses the prior
# "screenshot the target site, hand-craft a 16KB seed" workflow into one click.
#
# Deliberately stateless this round: returns the structured payload but does
# NOT bind it to a project. The dialog stages the seed_html + style_pins into
# the existing CreateProjectIn flow on Submit. Cost-event persistence ties
# in once the project is actually created in a future ticket.
# ---------------------------------------------------------------------------


class ExtractDesignIn(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError("url must start with http:// or https://")
        return v


# System prompt for the extraction step. Cache-flagged because it's static
# across calls — once a few users have hit the endpoint we get the cached
# input rate on every subsequent extraction.
EXTRACT_DESIGN_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are a senior brand/web design lead. Given the raw HTML of a real website, "
            "extract its visual identity and produce a starter scaffold the user can fork from.\n\n"
            "Output a SINGLE JSON object (no prose, no markdown fences) with EXACTLY these keys:\n"
            "  - summary: ONE sentence capturing the visual style (palette mood + typography + tone). "
            "Example: \"Warm minimal wellness — cream backgrounds, brass accents, Playfair serif headings.\"\n"
            "  - style_pins: an array of 4-8 design constraints. Each entry is "
            "{prop, value, kind, strict?}. `kind` is one of \"color\" | \"font\" | \"dimension\" | "
            "\"enum\" | \"text\". Set strict=true on the 1-2 MOST defining tokens (the signature "
            "primary color, the signature heading font); leave strict off for the rest. Always include "
            "at least one color pin and at least one font pin when the source HTML supports it.\n"
            "  - seed_html_scaffold: a self-contained HTML document (300-800 lines is plenty) that "
            "uses the detected tokens — same nav/header pattern as the source, a generic content area "
            "(hero, two or three feature blocks, footer) the user will customize via prompt-fork. "
            "Inline all CSS in a single <style> block. Do NOT copy proprietary copy verbatim — write "
            "neutral placeholder copy in the same tone. Use system-safe font fallbacks alongside the "
            "detected fonts. No external script tags. No analytics. Force <meta charset=\"utf-8\">.\n\n"
            "Rules:\n"
            "1. Color values must be hex (#rrggbb or #rgb). Convert rgb()/named CSS colors to hex.\n"
            "2. Font values are the family name only (e.g. \"Playfair Display\"), no quotes/weights.\n"
            "3. Pin `prop` strings are short and human-readable: \"primary color\", \"heading font\", "
            "\"body font\", \"accent color\", \"background color\", \"tone of voice\".\n"
            "4. The seed_html_scaffold must be valid, self-contained HTML5. <!DOCTYPE html> required.\n"
            "5. Return ONLY the JSON object. No leading/trailing prose. No code fences. Start with `{` "
            "and end with `}`."
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


def _parse_extract_design_json(text: str) -> dict:
    """Strict parse for the extract-design response. Strips a single
    ```json``` fence if the model added one (mirrors `_parse_react_export_json`
    in routes/nodes.py). Validates the four expected keys + that there's at
    least one color pin and one font pin so downstream consumers can rely on
    the shape."""
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("Top-level JSON must be an object")
    for key in ("summary", "style_pins", "seed_html_scaffold"):
        if key not in payload:
            raise ValueError(f"Missing required key: {key}")
    if not isinstance(payload["summary"], str) or not payload["summary"].strip():
        raise ValueError("`summary` must be a non-empty string")
    pins = payload["style_pins"]
    if not isinstance(pins, list) or not pins:
        raise ValueError("`style_pins` must be a non-empty array")
    cleaned_pins: list[dict] = []
    for p in pins:
        if not isinstance(p, dict):
            raise ValueError("Each style pin must be an object")
        prop = (p.get("prop") or "").strip()
        value = (p.get("value") or "").strip()
        kind = p.get("kind") or "text"
        if not prop or not value:
            continue
        if kind not in ("color", "dimension", "enum", "font", "text"):
            kind = "text"
        cleaned_pins.append(
            {
                "prop": prop,
                "value": value,
                "kind": kind,
                "strict": bool(p.get("strict", False)),
            }
        )
    if not any(p["kind"] == "color" for p in cleaned_pins):
        raise ValueError("Need at least one color pin")
    if not any(p["kind"] == "font" for p in cleaned_pins):
        raise ValueError("Need at least one font pin")
    if not isinstance(payload["seed_html_scaffold"], str) or "<html" not in payload["seed_html_scaffold"].lower():
        raise ValueError("`seed_html_scaffold` must be a valid HTML document")
    payload["style_pins"] = cleaned_pins[:12]
    return payload


@router.post("/extract-design")
async def extract_design(body: ExtractDesignIn):
    """Fetch a URL, ask Claude for design tokens + a seed HTML scaffold.

    Stateless: doesn't write to the DB. The client stages the returned
    `seed_html` + `style_pins` into the existing create-project payload so
    the new project is born with the extracted brand pre-loaded.
    """
    # Step 1: fetch the source HTML. We use plain httpx (not the asset-rewriting
    # `fetch_page`) because we only need the markup for analysis — the seed
    # scaffold is generated fresh, so we never copy assets out of the source.
    try:
        async with httpx.AsyncClient(
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=True,
        ) as client:
            r = await client.get(body.url)
            if r.status_code >= 400:
                raise HTTPException(
                    status_code=400,
                    detail=f"Source URL returned {r.status_code}. Check the URL and try again.",
                )
            # Prefer UTF-8 first, mirroring _decode_response in fetcher.py.
            try:
                html = r.content.decode("utf-8")
            except UnicodeDecodeError:
                html = r.text
    except HTTPException:
        raise
    except httpx.RequestError as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {e}")
    except Exception as e:  # pragma: no cover — defensive
        raise HTTPException(status_code=500, detail=f"Fetch failed: {e}")

    if not html.strip():
        raise HTTPException(
            status_code=400,
            detail="Source returned an empty document. The site may be a JS-heavy SPA that "
            "renders client-side — try a static URL or use the Paste HTML mode.",
        )

    # Truncate at the same 60K char budget the React-export and fork prompts
    # use. The model only needs structure + colors + typography; the tail of
    # a long document rarely changes the visual read.
    truncated = html[:60000]
    user_msg = (
        f"Extract the visual identity of this site and produce a starter scaffold. "
        f"Source URL: {body.url}\n\n"
        f"```html\n{truncated}\n```\n\n"
        "Return JSON only."
    )

    # Step 2: call Sonnet. The seed_html_scaffold alone runs 300-800 lines of
    # HTML (~4-8K tokens), so max_tokens=2000 truncated mid-string and produced
    # "Unterminated string" parse failures even on simple sites like example.com.
    # 12000 gives plenty of headroom; cold extraction stays around 25-45s.
    try:
        resp = await llm.call(
            system=EXTRACT_DESIGN_SYSTEM,
            user=user_msg,
            model="sonnet",
            max_tokens=12000,
        )
    except Exception as e:  # pragma: no cover — Anthropic upstream failure
        raise HTTPException(status_code=500, detail=f"LLM call failed: {e}")

    # Single-shot parse → one corrective re-prompt before giving up. Same
    # pattern as `_generate_react_files` in routes/nodes.py.
    parse_error: Exception | None = None
    try:
        parsed = _parse_extract_design_json(resp.text)
    except (json.JSONDecodeError, ValueError) as e:
        parse_error = e
        retry_msg = (
            "Your previous response was not valid JSON for the design-extraction schema. "
            f"Error: {e}\n\nFirst 400 chars of what you sent:\n{resp.text[:400]}\n\n"
            "Re-output ONE JSON object only with keys: summary, style_pins, seed_html_scaffold. "
            "No prose, no markdown fences. Start with `{` and end with `}`. Make sure style_pins "
            "includes at least one color pin and at least one font pin."
        )
        try:
            resp_retry = await llm.call(
                system=EXTRACT_DESIGN_SYSTEM,
                user=retry_msg,
                model="sonnet",
                max_tokens=12000,
            )
            parsed = _parse_extract_design_json(resp_retry.text)
            # Aggregate retry tokens into the original response so the cost
            # number we return reflects what the user actually owes.
            base = dict(resp.usage_dict or {})
            extra = resp_retry.usage_dict or {}
            for k in ("input", "output", "cache_read", "cache_creation"):
                base[k] = (base.get(k) or 0) + (extra.get(k) or 0)
            resp = resp_retry
            # Use the merged usage for cost calculation. We can't mutate the
            # dataclass property, so we keep a local instead.
            usage_for_cost = base
        except (json.JSONDecodeError, ValueError) as e2:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Model returned invalid JSON twice for design extraction. "
                    f"First: {parse_error}. Retry: {e2}. Try a different URL or use Paste HTML."
                ),
            )
        except Exception as e2:  # pragma: no cover — Anthropic upstream on retry
            raise HTTPException(
                status_code=502,
                detail=(
                    f"First call returned invalid JSON ({parse_error}); "
                    f"corrective retry failed: {e2}."
                ),
            )
    else:
        usage_for_cost = resp.usage_dict

    cost_cents = cost_cents_for_usage(usage_for_cost, resp.model)

    return {
        "summary": parsed["summary"],
        "style_pins": parsed["style_pins"],
        "seed_html": parsed["seed_html_scaffold"],
        "model_used": resp.model,
        "token_usage": usage_for_cost,
        "cost_cents": cost_cents,
    }
