"""PostgreSQL 仓储：内存快照与关系表之间的水合 / 落库（写穿）。

业务代码仍读写 `store.db`（接口与前端契约零改动），本模块负责把这份快照与
PostgreSQL（`models.py` 的 14 张表）保持一致：

- 启动：库里有数据则以库为准水合内存；库为空则把种子快照写入库
- 运行：写请求成功后标记脏，后台任务把整份快照同步回库；进程退出前强制落库
- 降级：未配置 DATABASE_URL 或连接失败时保持纯内存模式，不影响单测与本地演示

实现取舍：
- 数据量小（<300 行），每次落库在单事务内「按外键顺序清表 + 批量重建」，
  换取零差集逻辑；后续量级上来再换增量 upsert
- 只建结构与关系：owner_name / uploader_name / actor_name / url / is_creator 等
  展示字段由关联表与用户表推导，不单独入库
- 被邀请但尚无账号的成员以占位账号（password_hash="!"）入库，避免外键失败
"""

from __future__ import annotations

import copy
import logging
import os
import threading
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import localstore, storage, store
from .db import db_ping, get_engine
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
from .seed_db import clear_all

logger = logging.getLogger("minutes.repository")

SHADOW_PASSWORD = "!"  # 占位账号标记：被邀请但还没有真实密码，无法登录

_mode = "memory"
_dirty = False
_lock = threading.Lock()


# --------------------------------------------------------------------- #
# 开关与状态                                                             #
# --------------------------------------------------------------------- #

def enabled() -> bool:
    """配置了 DATABASE_URL 且未被显式关闭时启用（单测设 MINUTES_STORE_BACKEND=memory）。"""
    if not os.getenv("DATABASE_URL"):
        return False
    return os.getenv("MINUTES_STORE_BACKEND", "postgres").lower() != "memory"


def mode() -> str:
    return _mode


def mark_dirty() -> None:
    global _dirty
    _dirty = True


def pending() -> bool:
    return _dirty and _mode in ("postgres", "local")


def _init_local() -> str:
    """免安装版：从本地 JSON 快照恢复；没有快照就把当前种子数据写一份。"""
    global _mode
    try:
        data = localstore.load()
    except Exception as exc:  # noqa: BLE001 - 快照损坏时宁可回到种子也不能让服务起不来
        logger.warning("本地快照不可用，本次退回内存存储：%s", exc)
        _mode = "memory"
        return _mode

    if data is None:
        try:
            localstore.save(store.db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("本地快照初始化写入失败，本次退回内存存储：%s", exc)
            _mode = "memory"
            return _mode
    else:
        store.db.clear()
        store.db.update(data)
        logger.info(
            "已从本地快照恢复：%s 个用户 / %s 场会议",
            len(store.db.get("users", [])),
            len(store.db.get("meetings", [])),
        )

    _mode = "local"
    return _mode


def init() -> str:
    """启动入口：决定本次进程的存储模式，并完成水合或种子入库。"""
    global _mode
    if not enabled():
        if localstore.enabled():
            return _init_local()
        _mode = "memory"
        return _mode

    ok, detail = db_ping()
    if not ok:
        logger.warning("PostgreSQL 不可用，本次退回内存存储：%s", detail)
        _mode = "memory"
        return _mode

    try:
        loaded = load_all()
        if loaded:
            logger.info(
                "已从 PostgreSQL 水合：%s 个工作区 / %s 场会议",
                len(store.db["workspaces"]),
                len(store.db["meetings"]),
            )
        else:
            save_all()
            logger.info("PostgreSQL 为空，已写入种子数据")
    except Exception as exc:  # noqa: BLE001 - 起不来时宁可降级也不能让服务崩掉
        logger.warning("PostgreSQL 初始化失败，本次退回内存存储：%s", exc)
        store.db.clear()
        store.db.update(build_seed())
        _mode = "memory"
        return _mode

    _mode = "postgres"
    return _mode


def flush(force: bool = False) -> bool:
    """把当前内存快照落库（PostgreSQL 或本地 JSON）；失败保留脏标记等下一轮重试。"""
    global _dirty
    if _mode not in ("postgres", "local"):
        return False
    if not (_dirty or force):
        return False

    _dirty = False
    try:
        if _mode == "local":
            localstore.save(store.db)
        else:
            save_all()
        return True
    except Exception as exc:  # noqa: BLE001
        _dirty = True
        logger.warning("落盘失败，稍后重试：%s", exc)
        return False


# --------------------------------------------------------------------- #
# 序列化工具                                                             #
# --------------------------------------------------------------------- #

def _dt(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _iso(value) -> str | None:
    moment = _dt(value)
    if moment is None:
        return None
    return (
        moment.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return date.fromisoformat(str(value))


# --------------------------------------------------------------------- #
# 落库                                                                  #
# --------------------------------------------------------------------- #

def save_all() -> None:
    """单事务重建：清表后按快照批量写入（数据量小，换取实现简单）。"""
    data = copy.deepcopy(dict(store.db))
    with _lock, Session(get_engine()) as session:
        clear_all(session)
        _insert_all(session, data)
        session.commit()


def _insert_all(session: Session, data: dict) -> None:
    users = [dict(u) for u in data["users"]]
    known_ids = {u["id"] for u in users}
    taken_emails = {u["email"] for u in users}

    # 被邀请但还没有账号的成员：用占位账号落库，保证外键成立
    shadows: dict[str, dict] = {}
    for members in data["workspace_members"].values():
        for member in members:
            if member["user_id"] not in known_ids:
                shadows.setdefault(member["user_id"], dict(member))
    for people in data["meeting_participants"].values():
        for person in people:
            if person["user_id"] not in known_ids:
                shadows.setdefault(person["user_id"], dict(person))

    session.add_all(
        User(
            id=u["id"],
            email=u["email"],
            password_hash=u["password_hash"],
            name=u["name"],
            phone=u.get("phone"),
            avatar_url=u.get("avatar_url"),
        )
        for u in users
    )

    shadow_rows = []
    for uid, info in shadows.items():
        email = info.get("email") or f"{uid}@invite.local"
        if email in taken_emails:
            email = f"{uid}@invite.local"
        taken_emails.add(email)
        shadow_rows.append(
            User(
                id=uid,
                email=email,
                password_hash=SHADOW_PASSWORD,
                name=info.get("name") or uid,
                phone=info.get("phone"),
                avatar_url=info.get("avatar_url"),
            )
        )
    session.add_all(shadow_rows)
    session.flush()

    for ws in data["workspaces"]:
        session.add(
            Workspace(
                id=ws["id"],
                name=ws["name"],
                owner_id=ws["owner_id"],
                plan=ws.get("plan") or "free",
                created_at=_dt(ws.get("created_at")),
            )
        )
    session.flush()

    for ws_id, members in data["workspace_members"].items():
        session.add_all(
            WorkspaceMember(
                workspace_id=ws_id,
                user_id=m["user_id"],
                role=m["role"],
                joined_at=_dt(m.get("joined_at")),
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
                started_at=_dt(m.get("started_at")),
                created_at=_dt(m.get("created_at")),
                updated_at=_dt(m.get("updated_at")),
                deleted_at=_dt(m.get("deleted_at")),
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
                meeting_role=p.get("meeting_role") or "participant",
                created_at=_dt(p.get("joined_at")),
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
            status=s.get("status") or "ok",
            created_at=_dt(s.get("created_at")),
        )
        for s in data["summaries"]
    )

    session.add_all(
        ActionItem(
            id=a["id"],
            meeting_id=a["meeting_id"],
            owner_id=a.get("owner_id"),
            title=a["title"],
            status=a.get("status") or "todo",
            priority=a.get("priority") or "medium",
            due_date=_date(a.get("due_date")),
            created_at=_dt(a.get("created_at")),
            updated_at=_dt(a.get("updated_at")),
        )
        for a in data["action_items"]
    )

    # 待办提醒：内存里只存时间与操作者，落库补全所属工作区
    meetings = {m["id"]: m for m in data["meetings"]}
    items = {a["id"]: a for a in data["action_items"]}
    actors = data.get("todo_reminder_actors") or {}
    for todo_id, reminded_at in (data.get("todo_reminders") or {}).items():
        item = items.get(todo_id)
        meeting = meetings.get(item["meeting_id"]) if item else None
        if not meeting:
            continue
        reminded_by = actors.get(todo_id) or meeting["created_by"]
        session.add(
            TodoReminder(
                id=f"tr_{todo_id}",
                todo_id=todo_id,
                workspace_id=meeting["workspace_id"],
                reminded_by=reminded_by,
                channel="inapp",
                created_at=_dt(reminded_at),
            )
        )

    session.add_all(
        Comment(
            id=c["id"],
            target_type=c["target_type"],
            target_id=c["target_id"],
            user_id=c["user_id"],
            content=c["content"],
            created_at=_dt(c.get("created_at")),
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
            content_type=a.get("mime_type") or "application/octet-stream",
            size_bytes=a["size_bytes"],
            object_key=f"attachments/{a['id']}",
            created_at=_dt(a.get("created_at")),
        )
        for a in data["attachments"]
    )

    session.add_all(
        ShareLink(
            id=s["id"],
            meeting_id=s["meeting_id"],
            token=s["token"],
            scope=s.get("scope") or "read_transcript",
            expires_at=_dt(s.get("expires_at")),
            revoked_at=_dt(s.get("revoked_at")),
            created_at=_dt(s.get("created_at")),
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
            created_at=_dt(a.get("created_at")),
        )
        for a in data["audit_logs"]
    )

    session.add_all(
        Embedding(
            id=e["id"],
            meeting_id=e["meeting_id"],
            source_type=e["source_type"],
            source_id=e["source_id"],
            chunk_text=e["chunk_text"],
            embedding=e["embedding"],
        )
        for e in data.get("embeddings") or []
    )


# --------------------------------------------------------------------- #
# 水合                                                                  #
# --------------------------------------------------------------------- #

def load_all() -> bool:
    """从关系表重建内存快照；库里没有用户时返回 False（交由调用方写种子）。"""
    with Session(get_engine()) as session:
        users = list(session.scalars(select(User)))
        if not users:
            return False

        real_users = [u for u in users if u.password_hash != SHADOW_PASSWORD]
        shadows = {u.id: u for u in users if u.password_hash == SHADOW_PASSWORD}
        user_map = {u.id: u for u in real_users}
        profile = {**shadows, **user_map}

        members_rows = list(
            session.scalars(select(WorkspaceMember).order_by(WorkspaceMember.joined_at))
        )
        meetings_rows = list(session.scalars(select(Meeting).order_by(Meeting.created_at)))
        participants_rows = list(
            session.scalars(
                select(MeetingParticipant).order_by(MeetingParticipant.created_at)
            )
        )
        segments_rows = list(
            session.scalars(
                select(TranscriptSegment).order_by(
                    TranscriptSegment.meeting_id, TranscriptSegment.seq
                )
            )
        )
        summary_rows = list(
            session.scalars(
                select(Summary).order_by(Summary.meeting_id, Summary.version)
            )
        )
        item_rows = list(session.scalars(select(ActionItem).order_by(ActionItem.created_at)))
        reminder_rows = list(session.scalars(select(TodoReminder)))
        comment_rows = list(session.scalars(select(Comment).order_by(Comment.created_at)))
        attachment_rows = list(
            session.scalars(
                select(MeetingAttachment).order_by(MeetingAttachment.created_at)
            )
        )
        share_rows = list(session.scalars(select(ShareLink).order_by(ShareLink.created_at)))
        audit_rows = list(session.scalars(select(AuditLog).order_by(AuditLog.created_at)))
        embedding_rows = list(session.scalars(select(Embedding)))
        workspace_rows = list(session.scalars(select(Workspace).order_by(Workspace.created_at)))

    creator_of = {m.id: m.created_by for m in meetings_rows}

    workspace_members: dict[str, list[dict]] = {}
    for row in members_rows:
        person = profile.get(row.user_id)
        workspace_members.setdefault(row.workspace_id, []).append(
            {
                "user_id": row.user_id,
                "email": person.email if person else "",
                "name": person.name if person else row.user_id,
                "phone": person.phone if person else None,
                "avatar_url": person.avatar_url if person else None,
                "role": row.role,
                "joined_at": _iso(row.joined_at),
            }
        )

    meeting_participants: dict[str, list[dict]] = {}
    for row in participants_rows:
        person = profile.get(row.user_id)
        meeting_participants.setdefault(row.meeting_id, []).append(
            {
                "user_id": row.user_id,
                "name": person.name if person else row.user_id,
                "email": person.email if person else "",
                "avatar_url": person.avatar_url if person else None,
                "meeting_role": row.meeting_role,
                "is_creator": row.user_id == creator_of.get(row.meeting_id),
                "joined_at": _iso(row.created_at),
            }
        )

    meetings = [
        {
            "id": m.id,
            "workspace_id": m.workspace_id,
            "created_by": m.created_by,
            "title": m.title,
            "status": m.status,
            "progress": m.progress,
            "audio_key": m.audio_key,
            "audio_url": None,
            "audio_bytes": m.audio_bytes,
            "duration_sec": m.duration_sec,
            "language": m.language,
            "started_at": _iso(m.started_at),
            "created_at": _iso(m.created_at),
            "updated_at": _iso(m.updated_at),
            "deleted_at": _iso(m.deleted_at),
            "error": m.error,
        }
        for m in meetings_rows
    ]

    action_items = [
        {
            "id": a.id,
            "meeting_id": a.meeting_id,
            "owner_id": a.owner_id,
            "owner_name": user_map[a.owner_id].name if a.owner_id in user_map else None,
            "title": a.title,
            "status": a.status,
            "priority": a.priority,
            "due_date": a.due_date.isoformat() if a.due_date else None,
            "created_at": _iso(a.created_at),
            "updated_at": _iso(a.updated_at),
        }
        for a in item_rows
    ]

    attachments = [
        {
            "id": a.id,
            "meeting_id": a.meeting_id,
            "uploader_id": a.uploader_id,
            "uploader_name": user_map[a.uploader_id].name if a.uploader_id in user_map else None,
            "file_name": a.file_name,
            "mime_type": a.content_type,
            "size_bytes": a.size_bytes,
            "kind": a.kind,
            "url": f"/api/v1/attachments/{a.id}/content",
            "created_at": _iso(a.created_at),
        }
        for a in attachment_rows
    ]

    data = {
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "phone": u.phone,
                "password_hash": u.password_hash,
                "avatar_url": u.avatar_url,
            }
            for u in real_users
        ],
        "workspaces": [
            {
                "id": w.id,
                "name": w.name,
                "owner_id": w.owner_id,
                "plan": w.plan,
                "created_at": _iso(w.created_at),
            }
            for w in workspace_rows
        ],
        "workspace_members": workspace_members,
        "meetings": meetings,
        "meeting_participants": meeting_participants,
        "attachments": attachments,
        "transcript_segments": [
            {
                "id": s.id,
                "meeting_id": s.meeting_id,
                "seq": s.seq,
                "start_ms": s.start_ms,
                "end_ms": s.end_ms,
                "speaker": s.speaker,
                "content": s.content,
            }
            for s in segments_rows
        ],
        "summaries": [
            {
                "id": s.id,
                "meeting_id": s.meeting_id,
                "model": s.model,
                "version": s.version,
                "status": s.status,
                "content": s.content,
                "created_at": _iso(s.created_at),
            }
            for s in summary_rows
        ],
        "action_items": action_items,
        "todo_reminders": {
            r.todo_id: _iso(r.created_at) for r in reminder_rows
        },
        "todo_reminder_actors": {
            r.todo_id: r.reminded_by for r in reminder_rows
        },
        "comments": [
            {
                "id": c.id,
                "target_type": c.target_type,
                "target_id": c.target_id,
                "user_id": c.user_id,
                "user_name": user_map[c.user_id].name if c.user_id in user_map else None,
                "user_avatar_url": user_map[c.user_id].avatar_url
                if c.user_id in user_map
                else None,
                "content": c.content,
                "created_at": _iso(c.created_at),
            }
            for c in comment_rows
        ],
        "share_links": [
            {
                "id": s.id,
                "meeting_id": s.meeting_id,
                "token": s.token,
                "scope": s.scope,
                "expires_at": _iso(s.expires_at),
                "revoked_at": _iso(s.revoked_at),
                "created_at": _iso(s.created_at),
            }
            for s in share_rows
        ],
        "audit_logs": [
            {
                "id": a.id,
                "workspace_id": a.workspace_id,
                "actor_id": a.actor_id,
                "actor_name": user_map[a.actor_id].name if a.actor_id in user_map else None,
                "action": a.action,
                "target": a.target,
                "created_at": _iso(a.created_at),
            }
            for a in audit_rows
        ],
        "embeddings": [
            {
                "id": e.id,
                "meeting_id": e.meeting_id,
                "source_type": e.source_type,
                "source_id": e.source_id,
                "chunk_text": e.chunk_text,
                "embedding": list(e.embedding),
            }
            for e in embedding_rows
        ],
        "attachment_files": {},
        "audio_files": {},
    }

    # 未启用对象存储时，附件/音频落在本地目录，按确定性路径回填指针
    for meta in data["attachments"]:
        path = storage.ATTACHMENT_DIR / meta["id"]
        if path.exists():
            data["attachment_files"][meta["id"]] = str(path)
    for meeting in data["meetings"]:
        key = meeting.get("audio_key")
        if not key:
            continue
        ext = key.rsplit(".", 1)[-1] if "." in key else "m4a"
        path = storage.AUDIO_DIR / f"{meeting['id']}.{ext}"
        if path.exists():
            data["audio_files"][meeting["id"]] = str(path)

    store.db.clear()
    store.db.update(data)
    return True


def refresh_meeting(meeting_id: str) -> bool:
    """从库刷新单场会议的状态、转写、摘要与待办。

    Worker 是独立进程，它写完数据库后 API 的内存快照还是旧的；收到终态事件时
    用本函数把这一场会议替换成库里的最新版本，避免详情页读到过期数据。
    """
    if _mode != "postgres":
        return False

    try:
        with Session(get_engine()) as session:
            row = session.get(Meeting, meeting_id)
            if row is None:
                return False
            segments = list(
                session.scalars(
                    select(TranscriptSegment)
                    .where(TranscriptSegment.meeting_id == meeting_id)
                    .order_by(TranscriptSegment.seq)
                )
            )
            summaries = list(
                session.scalars(
                    select(Summary)
                    .where(Summary.meeting_id == meeting_id)
                    .order_by(Summary.version)
                )
            )
            items = list(
                session.scalars(
                    select(ActionItem)
                    .where(ActionItem.meeting_id == meeting_id)
                    .order_by(ActionItem.created_at)
                )
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("刷新会议 %s 失败：%s", meeting_id, exc)
        return False

    meeting = next((m for m in store.db["meetings"] if m["id"] == meeting_id), None)
    if meeting is None:
        return False

    meeting.update(
        {
            "status": row.status,
            "progress": row.progress,
            "duration_sec": row.duration_sec,
            "audio_key": row.audio_key,
            "audio_bytes": row.audio_bytes,
            "updated_at": _iso(row.updated_at),
            "deleted_at": _iso(row.deleted_at),
            "error": row.error,
        }
    )

    store.db["transcript_segments"] = [
        s for s in store.db["transcript_segments"] if s["meeting_id"] != meeting_id
    ] + [
        {
            "id": s.id,
            "meeting_id": s.meeting_id,
            "seq": s.seq,
            "start_ms": s.start_ms,
            "end_ms": s.end_ms,
            "speaker": s.speaker,
            "content": s.content,
        }
        for s in segments
    ]

    store.db["summaries"] = [
        s for s in store.db["summaries"] if s["meeting_id"] != meeting_id
    ] + [
        {
            "id": s.id,
            "meeting_id": s.meeting_id,
            "model": s.model,
            "version": s.version,
            "status": s.status,
            "content": s.content,
            "created_at": _iso(s.created_at),
        }
        for s in summaries
    ]

    users = {u["id"]: u for u in store.db["users"]}
    store.db["action_items"] = [
        a for a in store.db["action_items"] if a["meeting_id"] != meeting_id
    ] + [
        {
            "id": a.id,
            "meeting_id": a.meeting_id,
            "owner_id": a.owner_id,
            "owner_name": users[a.owner_id]["name"] if a.owner_id in users else None,
            "title": a.title,
            "status": a.status,
            "priority": a.priority,
            "due_date": a.due_date.isoformat() if a.due_date else None,
            "created_at": _iso(a.created_at),
            "updated_at": _iso(a.updated_at),
        }
        for a in items
    ]
    return True
