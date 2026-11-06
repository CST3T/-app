"""内存存储与领域规则。

演示版把数据放在进程内存，重启即恢复种子；真实部署可平移到 PostgreSQL（见项目开发文档 3.x）。
所有字段名与 packages/contracts/openapi.yaml / apps/web/mocks/data.ts 保持一致。
"""

from __future__ import annotations

import math
import secrets
from datetime import date, datetime, timedelta, timezone
from functools import cmp_to_key

from .seed import build_seed

WRITE_ROLES = ("owner", "admin", "member")
MEETING_ROLES = ("host", "recorder", "participant", "observer")
ROLES = ("owner", "admin", "member", "viewer")

db: dict = build_seed()


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


def iso_after(hours: int) -> str:
    return (
        (datetime.now(timezone.utc) + timedelta(hours=hours))
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def find_meeting(meeting_id: str) -> dict | None:
    return next(
        (m for m in db["meetings"] if m["id"] == meeting_id and not m["deleted_at"]),
        None,
    )


def find_workspace(workspace_id: str) -> dict | None:
    return next((w for w in db["workspaces"] if w["id"] == workspace_id), None)


def get_user(user_id: str | None) -> dict | None:
    if not user_id:
        return None
    return next((u for u in db["users"] if u["id"] == user_id), None)


def member_of(workspace_id: str, user_id: str) -> dict | None:
    return next(
        (m for m in db["workspace_members"].get(workspace_id, []) if m["user_id"] == user_id),
        None,
    )


def role_of(workspace_id: str, user_id: str) -> str | None:
    member = member_of(workspace_id, user_id)
    return member["role"] if member else None


def can_write(workspace_id: str, user_id: str) -> bool:
    return role_of(workspace_id, user_id) in WRITE_ROLES


def can_admin(workspace_id: str, user_id: str) -> bool:
    return role_of(workspace_id, user_id) in ("owner", "admin")


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "avatar_url": user.get("avatar_url"),
    }


def workspace_view(workspace: dict, user_id: str) -> dict:
    return {
        **workspace,
        "role": role_of(workspace["id"], user_id) or workspace["role"],
        "member_count": len(db["workspace_members"].get(workspace["id"], [])),
        "meeting_count": len(
            [m for m in db["meetings"] if m["workspace_id"] == workspace["id"] and not m["deleted_at"]]
        ),
    }


def latest_summary(meeting_id: str) -> dict | None:
    versions = [s for s in db["summaries"] if s["meeting_id"] == meeting_id]
    return max(versions, key=lambda s: s["version"]) if versions else None


def meeting_permissions(role: str) -> dict:
    writable = role in WRITE_ROLES
    return {
        "can_edit": writable,
        "can_delete": role in ("owner", "admin"),
        "can_process": writable,
        "can_comment": writable,
        "can_share": writable,
        "can_manage_participants": writable,
        "can_manage_attachments": writable,
    }


def build_meeting_detail(meeting: dict, role: str) -> dict:
    meeting_id = meeting["id"]
    summary = latest_summary(meeting_id)
    action_items = [a for a in db["action_items"] if a["meeting_id"] == meeting_id]
    attachments = sorted(
        [a for a in db["attachments"] if a["meeting_id"] == meeting_id],
        key=lambda a: a["created_at"],
        reverse=True,
    )
    segments = [s for s in db["transcript_segments"] if s["meeting_id"] == meeting_id]
    # meeting 对象里带上播放地址：前端详情页从 detail.meeting 读取
    # 延迟导入：storage 顶部反向依赖 store.db，顶层导入会形成循环依赖
    from .storage import audio_url_for

    meeting = {**meeting, "audio_url": audio_url_for(meeting)}
    return {
        "meeting": meeting,
        "summary": summary,
        "action_items": action_items,
        "participants": db["meeting_participants"].get(meeting_id, []),
        "attachments": attachments,
        "permissions": meeting_permissions(role),
        "counts": {
            "segments": len(segments),
            "action_items": len(action_items),
            "comments": len([c for c in db["comments"] if c["target_id"] == meeting_id]),
            "attachments": len(attachments),
        },
    }


# ------------------------------------------------------------------ #
# 工作区待办聚合                                                        #
# ------------------------------------------------------------------ #

def overdue_days_of(item: dict) -> int:
    if not item.get("due_date") or item.get("status") == "done":
        return 0
    deadline = datetime.fromisoformat(f"{item['due_date']}T23:59:59")
    diff = (datetime.now() - deadline).total_seconds()
    if diff <= 0:
        return 0
    return math.ceil(diff / 86_400)


def _todo_cmp(a: dict, b: dict) -> int:
    if (a["status"] == "done") != (b["status"] == "done"):
        return 1 if a["status"] == "done" else -1
    if a["is_overdue"] != b["is_overdue"]:
        return -1 if a["is_overdue"] else 1
    if a["due_date"] != b["due_date"]:
        if a["due_date"] is None:
            return 1
        if b["due_date"] is None:
            return -1
        return -1 if a["due_date"] < b["due_date"] else 1
    return 0


def build_workspace_todos(workspace_id: str) -> list[dict]:
    meetings = {
        m["id"]: m
        for m in db["meetings"]
        if m["workspace_id"] == workspace_id and not m["deleted_at"]
    }
    items: list[dict] = []
    for item in db["action_items"]:
        meeting = meetings.get(item["meeting_id"])
        if not meeting:
            continue
        overdue_days = overdue_days_of(item)
        items.append(
            {
                "id": item["id"],
                "meeting_id": item["meeting_id"],
                "meeting_title": meeting["title"],
                "meeting_started_at": meeting["started_at"],
                "owner_id": item["owner_id"],
                "owner_name": item["owner_name"],
                "title": item["title"],
                "status": item["status"],
                "priority": item["priority"],
                "due_date": item["due_date"],
                "is_overdue": overdue_days > 0,
                "overdue_days": overdue_days,
                "reminder_sent_at": db["todo_reminders"].get(item["id"]),
            }
        )
    return sorted(items, key=cmp_to_key(_todo_cmp))


def group_workspace_todos(items: list[dict]) -> list[dict]:
    groups: dict[str, dict] = {}
    for item in items:
        key = item["owner_id"] or "unassigned"
        group = groups.setdefault(
            key,
            {"owner_id": item["owner_id"], "owner_name": item["owner_name"], "items": []},
        )
        group["items"].append(item)

    def sort_key(group: dict):
        overdue = len([i for i in group["items"] if i["is_overdue"]])
        return (-overdue, group["owner_name"] or "未分配")

    return sorted(groups.values(), key=sort_key)


def workspace_todo_response(workspace_id: str, writable: bool) -> dict:
    items = build_workspace_todos(workspace_id)
    open_items = [i for i in items if i["status"] != "done"]
    overdue_items = [i for i in items if i["is_overdue"]]
    return {
        "groups": group_workspace_todos(items),
        "summary": {
            "total": len(items),
            "open": len(open_items),
            "overdue": len(overdue_items),
            "overdue_people": len({i["owner_id"] or "unassigned" for i in overdue_items}),
            "reminded": len([i for i in items if i["reminder_sent_at"]]),
        },
        "permissions": {"can_update": writable, "can_remind": writable},
        "generated_at": now_iso(),
    }


def audit(workspace_id: str, actor: dict, action: str, target: str) -> None:
    db["audit_logs"].insert(
        0,
        {
            "id": new_id("ad"),
            "workspace_id": workspace_id,
            "actor_id": actor["id"],
            "actor_name": actor["name"],
            "action": action,
            "target": target,
            "created_at": now_iso(),
        },
    )


IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif")
AUDIO_EXTS = (".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac")
VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv")
DOC_EXTS = (".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".pptx", ".ppt", ".zip")


def attachment_kind_of(file_name: str, mime: str | None) -> str:
    mime = (mime or "").lower()
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("video/"):
        return "video"
    ext = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext in IMAGE_EXTS:
        return "image"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in DOC_EXTS:
        return "doc"
    return "other"


def due_in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()
