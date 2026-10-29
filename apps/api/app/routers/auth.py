from __future__ import annotations

from fastapi import APIRouter, Request

from ..api_utils import read_json, require_user
from ..errors import ApiError, unauthorized, validation
from ..http import ok
from ..security import create_tokens, decode_refresh, hash_password, verify_password
from ..store import db, get_user, new_id, now_iso, public_user, role_of, workspace_view

router = APIRouter()


@router.post("/auth/register")
async def register(request: Request):
    body = await read_json(request)
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    name = str(body.get("name") or "").strip()

    if any(u["email"] == email for u in db["users"]):
        raise validation("该邮箱已注册", {"email": "该邮箱已注册"})
    if len(password) < 8:
        raise validation("密码至少 8 位", {"password": "密码至少 8 位"})
    if not name:
        raise validation("请填写姓名", {"name": "不能为空"})

    user = {
        "id": new_id("u"),
        "email": email,
        "name": name,
        "phone": None,
        "password_hash": hash_password(password),
        "avatar_url": None,
    }
    db["users"].append(user)

    demo = db["workspace_members"].setdefault("ws_demo", [])
    demo.append(
        {
            "user_id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "phone": None,
            "avatar_url": None,
            "role": "member",
            "joined_at": now_iso(),
        }
    )
    return ok(create_tokens(user["id"]), 201)


@router.post("/auth/login")
async def login(request: Request):
    body = await read_json(request)
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    user = next((u for u in db["users"] if u["email"] == email), None)
    if not user or not verify_password(password, user.get("password_hash")):
        raise unauthorized("邮箱或密码不正确")
    user["last_login_at"] = now_iso()
    return ok(create_tokens(user["id"]))


@router.post("/auth/refresh")
async def refresh(request: Request):
    body = await read_json(request)
    token = str(body.get("refresh_token") or "")
    user_id = decode_refresh(token)
    if not user_id or not get_user(user_id):
        raise ApiError(401, "UNAUTHORIZED", "刷新凭证无效")
    return ok(create_tokens(user_id))


@router.get("/me")
async def me(request: Request):
    user = require_user(request)
    workspaces = [w for w in db["workspaces"] if role_of(w["id"], user["id"])]
    return ok(
        {
            "user": public_user(user),
            "workspaces": [workspace_view(w, user["id"]) for w in workspaces],
        }
    )
