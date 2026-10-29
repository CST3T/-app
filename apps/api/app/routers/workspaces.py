from __future__ import annotations

import re

from fastapi import APIRouter, Request

from ..api_utils import optional_user, read_json, require_user
from ..errors import ApiError, forbidden, not_found, validation
from ..http import empty, ok
from ..store import (
    audit,
    can_admin,
    can_write,
    db,
    find_meeting,
    find_workspace,
    member_of,
    new_id,
    now_iso,
    overdue_days_of,
    role_of,
    workspace_todo_response,
    workspace_view,
)

router = APIRouter()

PHONE_RE = re.compile(r"^1[3-9]\d{9}$")


@router.get("/workspaces")
async def list_workspaces(request: Request):
    user = require_user(request, "请先登录")
    return ok(
        [
            workspace_view(w, user["id"])
            for w in db["workspaces"]
            if role_of(w["id"], user["id"])
        ]
    )


@router.post("/workspaces")
async def create_workspace(request: Request):
    user = require_user(request, "请先登录")
    body = await read_json(request)
    name = str(body.get("name") or "").strip()
    if not name:
        raise validation("请填写工作区名称", {"name": "不能为空"})

    workspace = {
        "id": new_id("ws"),
        "name": name,
        "owner_id": user["id"],
        "plan": "free",
        "role": "owner",
        "member_count": 1,
        "meeting_count": 0,
        "created_at": now_iso(),
    }
    db["workspaces"].append(workspace)
    db["workspace_members"][workspace["id"]] = [
        {
            "user_id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "phone": user.get("phone"),
            "avatar_url": user.get("avatar_url"),
            "role": "owner",
            "joined_at": now_iso(),
        }
    ]
    return ok(workspace, 201)


@router.get("/workspaces/{wid}")
async def get_workspace(wid: str, request: Request):
    user = optional_user(request)
    workspace = find_workspace(wid)
    if not user or not workspace:
        raise not_found("工作区不存在")
    if not role_of(wid, user["id"]):
        raise forbidden("你不在该工作区中")
    return ok(workspace_view(workspace, user["id"]))


@router.patch("/workspaces/{wid}")
async def update_workspace(wid: str, request: Request):
    user = optional_user(request)
    if not user or not can_admin(wid, user["id"]):
        raise forbidden("需要管理员及以上权限")
    workspace = find_workspace(wid)
    if not workspace:
        raise not_found("工作区不存在")

    body = await read_json(request)
    if body.get("name") is not None:
        workspace["name"] = body["name"]
    if body.get("plan") is not None:
        workspace["plan"] = body["plan"]
    return ok(workspace_view(workspace, user["id"]))


@router.get("/workspaces/{wid}/members")
async def list_members(wid: str, request: Request):
    user = optional_user(request)
    if not user or not role_of(wid, user["id"]):
        raise forbidden("你不在该工作区中")
    return ok(db["workspace_members"].get(wid, []))


@router.get("/workspaces/{wid}/member-directory")
async def member_directory(wid: str, request: Request):
    user = optional_user(request)
    if not user or not can_admin(wid, user["id"]):
        raise forbidden("需要管理员及以上权限")
    members = db["workspace_members"].get(wid, [])
    candidates = [
        {
            "user_id": u["id"],
            "name": u["name"],
            "phone": u.get("phone") or "",
            "email": u["email"],
            "avatar_url": u.get("avatar_url"),
            "in_workspace": any(
                m["user_id"] == u["id"] or m.get("phone") == u.get("phone") for m in members
            ),
        }
        for u in db["users"]
    ]
    return ok(candidates)


@router.post("/workspaces/{wid}/members")
async def add_member(wid: str, request: Request):
    user = optional_user(request)
    if not user or not can_admin(wid, user["id"]):
        raise forbidden("需要管理员及以上权限")

    body = await read_json(request)
    name = str(body.get("name") or "").strip()
    phone = str(body.get("phone") or "").strip()
    email = str(body.get("email") or "").strip() or None

    if not name:
        raise validation("请填写成员姓名", {"name": "请填写成员姓名"})
    if not PHONE_RE.match(phone):
        raise validation("请输入 11 位手机号", {"phone": "请输入正确的 11 位手机号"})
    if email and "@" not in email:
        raise validation("请输入正确的邮箱", {"email": "邮箱格式不正确"})

    members = db["workspace_members"].setdefault(wid, [])
    if any(m.get("phone") == phone for m in members):
        raise ApiError(409, "STATE_CONFLICT", "该手机号对应的成员已在工作区中")
    if email and any(m.get("email") == email for m in members):
        raise ApiError(409, "STATE_CONFLICT", "该成员已在工作区中")

    known = next(
        (u for u in db["users"] if u.get("phone") == phone or (email and u["email"] == email)),
        None,
    )
    member = {
        "user_id": known["id"] if known else new_id("u_invite"),
        "email": email or (known["email"] if known else ""),
        "name": name,
        "phone": phone,
        "avatar_url": known.get("avatar_url") if known else None,
        "role": body.get("role") or "member",
        "joined_at": now_iso(),
    }
    members.append(member)
    audit(wid, user, "member.invite", f"{name} · {phone} · {member['role']}")
    return ok(member, 201)


@router.patch("/workspaces/{wid}/members/{uid}")
async def update_member(wid: str, uid: str, request: Request):
    user = optional_user(request)
    if not user or not can_admin(wid, user["id"]):
        raise forbidden("需要管理员及以上权限")
    member = member_of(wid, uid)
    if not member:
        raise not_found("成员不存在")
    if member["role"] == "owner":
        raise forbidden("不能修改所有者的角色")
    body = await read_json(request)
    if body.get("role") is not None:
        member["role"] = body["role"]
    return ok(member)


@router.delete("/workspaces/{wid}/members/{uid}")
async def remove_member(wid: str, uid: str, request: Request):
    user = optional_user(request)
    if not user or not can_admin(wid, user["id"]):
        raise forbidden("需要管理员及以上权限")
    member = member_of(wid, uid)
    if member and member["role"] == "owner":
        raise forbidden("不能移除所有者")
    db["workspace_members"][wid] = [
        m for m in db["workspace_members"].get(wid, []) if m["user_id"] != uid
    ]
    if member:
        audit(wid, user, "member.remove", f"{member['name']} · {member.get('phone') or member['email']}")
    return empty()


@router.get("/workspaces/{wid}/audit-logs")
async def audit_logs(wid: str, request: Request):
    user = optional_user(request)
    if not user or not can_admin(wid, user["id"]):
        raise forbidden("仅管理员及以上可查看审计日志")
    logs = sorted(
        [a for a in db["audit_logs"] if a["workspace_id"] == wid],
        key=lambda a: a["created_at"],
        reverse=True,
    )
    return ok(logs)


@router.get("/workspaces/{wid}/todos")
async def workspace_todos(wid: str, request: Request):
    user = require_user(request, "请先登录")
    if not role_of(wid, user["id"]):
        raise forbidden("你不在该工作区中")
    return ok(workspace_todo_response(wid, can_write(wid, user["id"])))


@router.post("/workspaces/{wid}/todos/{todo_id}/remind")
async def remind_todo(wid: str, todo_id: str, request: Request):
    user = require_user(request, "请先登录")
    if not can_write(wid, user["id"]):
        raise forbidden("当前角色不能发送提醒")

    item = next((a for a in db["action_items"] if a["id"] == todo_id), None)
    if not item:
        raise not_found("待办不存在或已被删除")
    meeting = find_meeting(item["meeting_id"])
    if not meeting or meeting["workspace_id"] != wid:
        raise forbidden("该待办不属于当前工作区")
    if not item.get("owner_id") or not item.get("owner_name"):
        raise ApiError(400, "NO_OWNER", "该待办还没有负责人，无法发送提醒")
    if not overdue_days_of(item):
        raise ApiError(400, "NOT_OVERDUE", "该待办尚未逾期，暂不需要提醒")

    reminded_at = now_iso()
    db["todo_reminders"][item["id"]] = reminded_at
    db.setdefault("todo_reminder_actors", {})[item["id"]] = user["id"]
    audit(wid, user, "todo.remind", f"{item['id']} · {item['owner_name']} · {item['title']}")
    return ok(
        {
            "todo_id": item["id"],
            "owner_id": item["owner_id"],
            "owner_name": item["owner_name"],
            "reminded_at": reminded_at,
            "message": f"已向 {item['owner_name']} 发送逾期提醒：{item['title']}",
        }
    )
