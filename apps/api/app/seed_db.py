"""演示种子数据入库（DB-02）。

数据来源是 `app.seed.build_seed()`，与前端 Mock、内存存储完全同源；
写入目标为 DATABASE_URL 指向的 PostgreSQL。

用法：
    python -m app.seed_db            # 库里已有用户则跳过
    python -m app.seed_db --reset    # 先按外键顺序清空再写入

设计说明：
- 只建「结构与关系」，字段缺失的展示用字段（role/ counts / user_name）不入库
- 时间字符串统一转 timestamptz；due_date 转 date
"""

from __future__ import annotations

import sys
from datetime import date, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import get_engine
from .models import (
    ActionItem,
    AuditLog,
    Comment,
    Embedding,
    Meeting,
    MeetingAttachment,
    MeetingParticipant,
    ShareLink,
    Summary,
    TodoReminder,
    TranscriptSegment,
    User,
    Workspace,
    WorkspaceMember,
)
from .seed import build_seed


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _clear(session: Session) -> None:
    # 子表优先，避免外键冲突
    for model in (
        Embedding,
        TodoReminder,
        Comment,
        ShareLink,
        AuditLog,
        MeetingAttachment,
        MeetingParticipant,
        TranscriptSegment,
        Summary,
        ActionItem,
        Meeting,
        WorkspaceMember,
        Workspace,
        User,
    ):
        session.execute(delete(model))


def seed_database(reset: bool = False) -> dict[str, int]:
    data = build_seed()
    counts: dict[str, int] = {}

    with Session(get_engine()) as session:
        existing = session.scalar(select(User.id).limit(1))
        if existing and not reset:
            return {"skipped": 1}
        if reset:
            _clear(session)

        session.add_all(
            User(
                id=u["id"],
                email=u["email"],
                password_hash=u["password_hash"],
                name=u["name"],
                phone=u.get("phone"),
                avatar_url=u.get("avatar_url"),
            )
            for u in data["users"]
        )
        session.flush()

        for ws in data["workspaces"]:
            session.add(
                Workspace(
                    id=ws["id"],
                    name=ws["name"],
                    owner_id=ws["owner_id"],
                    plan=ws["plan"],
                    created_at=_ts(ws["created_at"]),
                )
            )
        session.flush()

        for ws_id, members in data["workspace_members"].items():
            session.add_all(
                WorkspaceMember(
                    workspace_id=ws_id,
                    user_id=m["user_id"],
                    role=m["role"],
                    joined_at=_ts(m["joined_at"]),
                )
                for m in members
            )
        session.flush()

        for m in data["meetings"]:
            session.add(
                Meeting(
                    id=m["id"],
                    workspace_id=m["workspace_id"],
                    created_by=m["created_by"],
                    title=m["title"],
                    status=m["status"],
                    progress=m["progress"],
                    audio_key=m.get("audio_key"),
                    audio_bytes=m.get("audio_bytes"),
                    duration_sec=m.get("duration_sec"),
                    language=m.get("language") or "zh",
                    started_at=_ts(m.get("started_at")),
                    created_at=_ts(m.get("created_at")),
                    updated_at=_ts(m.get("updated_at")),
                    error=m.get("error"),
                )
            )
        session.flush()

        for mid, people in data["meeting_participants"].items():
            session.add_all(
                MeetingParticipant(
                    id=f"{mid}_{p['user_id']}",
                    meeting_id=mid,
                    user_id=p["user_id"],
                    meeting_role=p["meeting_role"],
                    created_at=_ts(p["joined_at"]),
                )
                for p in people
            )

        session.add_all(
            TranscriptSegment(
                id=s["id"],
                meeting_id=s["meeting_id"],
                seq=s["seq"],
                start_ms=s["start_ms"],
                end_ms=s["end_ms"],
                speaker=s.get("speaker"),
                content=s["content"],
            )
            for s in data["transcript_segments"]
        )

        session.add_all(
            Summary(
                id=s["id"],
                meeting_id=s["meeting_id"],
                model=s["model"],
                version=s["version"],
                content=s["content"],
                status=s["status"],
                created_at=_ts(s["created_at"]),
            )
            for s in data["summaries"]
        )

        session.add_all(
            ActionItem(
                id=a["id"],
                meeting_id=a["meeting_id"],
                owner_id=a.get("owner_id"),
                title=a["title"],
                status=a["status"],
                priority=a["priority"],
                due_date=_date(a.get("due_date")),
                created_at=_ts(a.get("created_at")),
                updated_at=_ts(a.get("updated_at")),
            )
            for a in data["action_items"]
        )

        session.add_all(
            Comment(
                id=c["id"],
                target_type=c["target_type"],
                target_id=c["target_id"],
                user_id=c["user_id"],
                content=c["content"],
                created_at=_ts(c["created_at"]),
            )
            for c in data["comments"]
        )

        session.add_all(
            MeetingAttachment(
                id=a["id"],
                meeting_id=a["meeting_id"],
                uploader_id=a["uploader_id"],
                kind=a["kind"],
                file_name=a["file_name"],
                content_type=a["mime_type"],
                size_bytes=a["size_bytes"],
                object_key=f"attachments/{a['id']}/{a['file_name']}",
                created_at=_ts(a["created_at"]),
            )
            for a in data["attachments"]
        )

        session.add_all(
            ShareLink(
                id=s["id"],
                meeting_id=s["meeting_id"],
                token=s["token"],
                scope=s["scope"],
                expires_at=_ts(s.get("expires_at")),
                revoked_at=_ts(s.get("revoked_at")),
                created_at=_ts(s["created_at"]),
            )
            for s in data["share_links"]
        )

        session.add_all(
            AuditLog(
                id=a["id"],
                workspace_id=a["workspace_id"],
                actor_id=a["actor_id"],
                action=a["action"],
                target=a["target"],
                created_at=_ts(a["created_at"]),
            )
            for a in data["audit_logs"]
        )

        session.commit()
        counts = {
            "users": len(data["users"]),
            "workspaces": len(data["workspaces"]),
            "meetings": len(data["meetings"]),
            "transcript_segments": len(data["transcript_segments"]),
            "summaries": len(data["summaries"]),
            "action_items": len(data["action_items"]),
            "attachments": len(data["attachments"]),
            "audit_logs": len(data["audit_logs"]),
        }
    return counts


def main() -> None:
    reset = "--reset" in sys.argv
    result = seed_database(reset=reset)
    print(result)


if __name__ == "__main__":
    main()
