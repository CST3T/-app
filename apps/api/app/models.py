"""SQLAlchemy 模型（14 张表），与《项目开发文档》1.4 一一对应。

职责边界：v0.2 业务读写仍走 `store.py` 内存结构；本文件是数据库的唯一结构来源，
Alembic 迁移直接基于 `Base.metadata`，生产化时 Repository 复用同一套模型。

约定：
- 主键用业务前缀字符串（u_lin / mtg_01JABCAPI），与前端契约一致，不做自增
- 时间统一 timestamptz（UTC）
- 软删除只用于 meetings.deleted_at
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


def _ts():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    created_at = _ts()


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    plan: Mapped[str] = mapped_column(String(16), nullable=False, server_default="free")
    created_at = _ts()


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # owner/admin/member/viewer
    joined_at = _ts()


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="uploaded")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    audio_key: Mapped[str | None] = mapped_column(Text)
    audio_bytes: Mapped[int | None] = mapped_column(BigInteger)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(8), nullable=False, server_default="zh")
    started_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    created_at = _ts()
    updated_at = _ts()
    deleted_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[dict | None] = mapped_column(JSONB)

    __table_args__ = (
        Index("ix_meetings_workspace_created", "workspace_id", "created_at"),
        Index("ix_meetings_workspace_deleted", "workspace_id", "deleted_at"),
    )


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    meeting_role: Mapped[str] = mapped_column(String(16), nullable=False, server_default="participant")
    added_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at = _ts()

    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_meeting_participant"),
        Index(
            "uq_meeting_host",
            "meeting_id",
            unique=True,
            postgresql_where=text("meeting_role = 'host'"),
        ),
    )


class MeetingAttachment(Base):
    __tablename__ = "meeting_attachments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    uploader_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # image/audio/video/doc
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at = _ts()

    __table_args__ = (Index("ix_attachments_meeting", "meeting_id"),)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[str | None] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (UniqueConstraint("meeting_id", "seq", name="uq_transcript_seq"),)


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="ok")
    created_at = _ts()

    __table_args__ = (UniqueConstraint("meeting_id", "version", name="uq_summary_version"),)


class ActionItem(Base):
    __tablename__ = "action_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="todo")
    priority: Mapped[str] = mapped_column(String(8), nullable=False, server_default="medium")
    due_date: Mapped[object | None] = mapped_column(Date)
    created_at = _ts()
    updated_at = _ts()

    __table_args__ = (
        Index("ix_action_items_meeting", "meeting_id"),
        Index("ix_action_items_owner_status", "owner_id", "status"),
        Index("ix_action_items_due", "due_date"),
    )


class TodoReminder(Base):
    __tablename__ = "todo_reminders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    todo_id: Mapped[str] = mapped_column(
        ForeignKey("action_items.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    reminded_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False, server_default="inapp")
    created_at = _ts()


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)  # meeting / action_item
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at = _ts()

    __table_args__ = (Index("ix_comments_target", "target_type", "target_id"),)


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, server_default="read_transcript")
    expires_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    created_at = _ts()


class Embedding(Base):
    __tablename__ = "embeddings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)  # transcript/summary/action_item
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536), nullable=False)

    __table_args__ = (Index("ix_embeddings_meeting", "meeting_id"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at = _ts()

    __table_args__ = (Index("ix_audit_workspace_created", "workspace_id", "created_at"),)
