"""请求解析与权限守卫（与 mock 的错误文案保持一致）。"""

from __future__ import annotations

from fastapi import Request
from starlette.datastructures import UploadFile

from .errors import forbidden, not_found, unauthorized
from .security import user_id_from_token
from .store import find_meeting, get_user, role_of


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def optional_user(request: Request) -> dict | None:
    token = _bearer_token(request)
    user_id = user_id_from_token(token) if token else None
    return get_user(user_id)


def require_user(request: Request, message: str = "登录已过期，请重新登录") -> dict:
    user = optional_user(request)
    if not user:
        raise unauthorized(message)
    return user


def guard_meeting(request: Request, meeting_id: str) -> tuple[dict, dict, str]:
    user = require_user(request)
    meeting = find_meeting(meeting_id)
    if not meeting:
        raise not_found("会议不存在或已被删除")
    role = role_of(meeting["workspace_id"], user["id"])
    if not role:
        raise forbidden("你不在该工作区中")
    return meeting, user, role


async def read_json(request: Request) -> dict:
    """容错读取 JSON：空 body / 非法 JSON 一律返回空 dict。"""
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def form_str(form, key: str) -> str:
    value = form.get(key)
    return value if isinstance(value, str) else ""


def form_file(form, key: str) -> UploadFile | None:
    value = form.get(key)
    return value if isinstance(value, UploadFile) else None


def meeting_role_or_default(value) -> str:
    from .store import MEETING_ROLES

    return value if value in MEETING_ROLES else "participant"
