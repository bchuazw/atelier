from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import get_session
from atelier_api.sandbox.fetcher import fetch_page, save_html_as_seed
from atelier_api.storage import storage

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateProjectIn(BaseModel):
    name: str
    seed_url: str | None = None
    seed_html: str | None = None  # paste-HTML alternative to seed_url


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


class ProjectPatchIn(BaseModel):
    # Any field provided is updated; omitted fields are left alone.
    context: str | None = None
    active_checkpoint_id: str | None = None
    clear_checkpoint: bool | None = None
    name: str | None = None  # rename the project (validated in route)
    style_pins: list[StylePin] | None = None  # full replace when provided


@router.post("", response_model=ProjectOut)
async def create_project(body: CreateProjectIn, session: AsyncSession = Depends(get_session)):
    if body.seed_url and body.seed_html:
        raise HTTPException(
            status_code=400,
            detail="Provide either seed_url OR seed_html, not both.",
        )
    project = Project(name=body.name, seed_url=body.seed_url)
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
async def list_projects(session: AsyncSession = Depends(get_session)):
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

    out: list[ProjectOut] = []
    for p in rows:
        node_count, last_activity = meta_by_id.get(p.id, (0, None))
        out.append(
            ProjectOut(
                id=p.id,
                name=p.name,
                seed_url=p.seed_url,
                working_node_id=p.working_node_id,
                created_at=p.created_at,
                node_count=node_count,
                last_activity=last_activity or p.created_at,
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
