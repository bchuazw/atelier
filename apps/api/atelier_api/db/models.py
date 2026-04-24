from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def uuid_str() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.utcnow().isoformat()


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "project"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String, nullable=False)
    seed_url: Mapped[str | None] = mapped_column(String, nullable=True)
    seed_repo: Mapped[str | None] = mapped_column(String, nullable=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    working_node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)

    nodes: Mapped[list[Node]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Node(Base):
    __tablename__ = "node"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("node.id"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String, nullable=False)  # seed|variant|feedback|critic|pipeline|live|code
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_path: Mapped[str | None] = mapped_column(String, nullable=True)
    build_path: Mapped[str | None] = mapped_column(String, nullable=True)
    build_status: Mapped[str] = mapped_column(String, default="ready")  # pending|building|ready|error
    thumbnail_path: Mapped[str | None] = mapped_column(String, nullable=True)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    reasoning: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    position_x: Mapped[float] = mapped_column(default=0.0)
    position_y: Mapped[float] = mapped_column(default=0.0)
    pinned: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String, default="user")
    model_used: Mapped[str | None] = mapped_column(String, nullable=True)
    token_usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)

    project: Mapped[Project] = relationship(back_populates="nodes")


class Edge(Base):
    __tablename__ = "edge"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    from_node_id: Mapped[str] = mapped_column(ForeignKey("node.id", ondelete="CASCADE"))
    to_node_id: Mapped[str] = mapped_column(ForeignKey("node.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String, nullable=False)  # prompt|feedback|refine|fork|merge
    prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reasoning: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)


class FeedbackItem(Base):
    __tablename__ = "feedback_item"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String, default="user")
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed_intent: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    target_node_id: Mapped[str | None] = mapped_column(ForeignKey("node.id"), nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
