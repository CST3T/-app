from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

from ..api_utils import (
    form_file,
    form_str,
    guard_meeting,
    meeting_role_or_default,
    read_json,
    require_user,
)
from ..errors import ApiError, forbidden, not_found, validation
from ..http import empty, ok
from ..pipeline import enqueue_job, retry_job, sse_frame, subscribe, unsubscribe
from .. import repository
from ..store import (
    attachment_kind_of,
    audit,
    build_meeting_detail,
    can_admin,
    can_write,
    db,
    find_meeting,
    new_id,
    now_iso,
    role_of,
)
from ..storage import attachment_bytes, attachment_url_for, audio_url_for, delete_attachment_file, save_attachment, save_audio

router = APIRouter()

MAX_AUDIO_BYTES = 200 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

_idempotency: dict[str, dict] = {}


# --------------------------------------------------------------------- #
# 会议列表 / 创建                                                       #
# --------------------------------------------------------------------- #

@router.get("/workspaces/{wid}/meetings")
async def list_meetings(wid: str, request: Request):
    user = require_user(request, "请先登录")
    role = role_of(wid, user["id"])
    if not role:
        raise forbidden("你不在该工作区中")

    status = request.query_params.get("status")
    keyword = (request.query_params.get("q") or "").strip().lower()
    try:
        limit = int(request.query_params.get("limit") or 20)
    except ValueError:
        limit = 20
    limit = max(1, limit)

    items = [m for m in db["meetings"] if m["workspace_id"] == wid and not m["deleted_at"]]
    if status and status != "all":
        items = [m for m in items if m["status"] == status]
    if keyword:
        items = [m for m in items if keyword in m["title"].lower()]
    items.sort(key=lambda m: m["started_at"], reverse=True)

    total = len(items)
    page = items[:limit]
    return ok(
        {
            "items": [
                {**m, "permissions": build_meeting_detail(m, role)["permissions"]}
                for m in page
            ],
            "next_cursor": str(limit) if len(items) > limit else None,
            "total": total,
        }
    )


def _parse_invites(raw: str) -> list[dict]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []

    invites = []
    for item in parsed:
        if not isinstance(item, dict) or not isinstance(item.get("user_id"), str):
            continue
        invites.append(
            {
                "user_id": item["user_id"],
                "meeting_role": meeting_role_or_default(item.get("meeting_role")),
            }
        )
    return invites


@router.post("/workspaces/{wid}/meetings")
async def create_meeting(wid: str, request: Request):
    user = require_user(request, "请先登录")
    if not can_write(wid, user["id"]):
        raise forbidden("当前角色不能创建会议")

    idempotency_key = request.headers.get("Idempotency-Key")
    cache_key = f"{wid}:{idempotency_key}" if idempotency_key else None
    if cache_key and cache_key in _idempotency:
        return ok(_idempotency[cache_key], 202)

    title = ""
    started_at = now_iso()
    language = "zh"
    invites_raw = ""
    audio = None

    content_type = request.headers.get("Content-Type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        title = form_str(form, "title")
        started_at = form_str(form, "started_at") or started_at
        language = form_str(form, "language") or "zh"
        invites_raw = form_str(form, "participants")
        audio = form_file(form, "audio")
    else:
        body = await read_json(request)
        title = str(body.get("title") or "")
        started_at = str(body.get("started_at") or started_at)
        language = str(body.get("language") or "zh")
        invites_raw = body.get("participants") or ""
        if not isinstance(invites_raw, str):
            invites_raw = json.dumps(invites_raw, ensure_ascii=False)
        audio = None  # 纯 JSON 无文件；由下方统一校验

    if not title.strip():
        raise validation("请填写会议标题", {"title": "不能为空"})
    if audio is None:
        raise validation("请上传录音文件", {"audio": "不能为空"})

    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise validation("文件超过 200MB 上限", {"audio": "文件过大"})

    meeting_id = new_id("mtg")
    ext = audio.filename.rsplit(".", 1)[-1] if audio.filename and "." in audio.filename else "m4a"
    meeting = {
        "id": meeting_id,
        "workspace_id": wid,
        "created_by": user["id"],
        "title": title,
        "status": "uploaded",
        "progress": 0,
        "audio_key": f"{wid}/{meeting_id}/original.{ext}",
        "audio_url": None,
        "audio_bytes": len(audio_bytes),
        "duration_sec": None,
        "language": language,
        "started_at": started_at,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "deleted_at": None,
        "error": None,
    }
    db["meetings"].insert(0, meeting)
    save_audio(meeting, audio_bytes)

    roster = [
        {
            "user_id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "avatar_url": user.get("avatar_url"),
            "meeting_role": "host",
            "is_creator": True,
            "joined_at": meeting["created_at"],
        }
    ]
    for invite in _parse_invites(invites_raw):
        if invite["user_id"] == user["id"]:
            continue
        member = next(
            (
                m
                for m in db["workspace_members"].get(wid, [])
                if m["user_id"] == invite["user_id"]
            ),
            None,
        )
        if not member:
            continue
        if any(p["user_id"] == member["user_id"] for p in roster):
            continue
        role = invite["meeting_role"]
        roster.append(
            {
                "user_id": member["user_id"],
                "name": member["name"],
                "email": member["email"],
                "avatar_url": member.get("avatar_url"),
                "meeting_role": "participant" if role == "host" else role,
                "is_creator": False,
                "joined_at": meeting["created_at"],
            }
        )
    db["meeting_participants"][meeting_id] = roster

    audit(wid, user, "meeting.create", f"{meeting_id} · {title}（{len(roster)} 位参会）")

    job_id = enqueue_job(meeting_id, "transcribing")
    payload = {
        "id": meeting_id,
        "meeting_id": meeting_id,
        "status": "uploaded",
        "progress": 0,
        "job_id": job_id or "job_unknown",
    }
    if cache_key:
        if len(_idempotency) > 500:
            _idempotency.clear()
        _idempotency[cache_key] = payload
    return ok(payload, 202)


# --------------------------------------------------------------------- #
# 会议详情 / 编辑 / 删除                                                #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, request: Request):
    meeting, _user, role = guard_meeting(request, meeting_id)
    # 处理中的会议由 Worker 推进，读前先按库刷新，避免看到滞后的状态/进度
    if repository.mode() == "postgres" and meeting["status"] in ("transcribing", "summarizing"):
        await asyncio.to_thread(repository.refresh_meeting, meeting["id"])
    detail = build_meeting_detail(meeting, role)
    detail["audio_url"] = audio_url_for(meeting)
    return ok(detail)


@router.patch("/meetings/{meeting_id}")
async def update_meeting(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能编辑会议")

    body = await read_json(request)
    if body.get("title") is not None:
        if not str(body["title"]).strip():
            raise validation("标题不能为空", {"title": "不能为空"})
        meeting["title"] = body["title"]
    if body.get("started_at") is not None:
        meeting["started_at"] = body["started_at"]
    if body.get("language") is not None:
        meeting["language"] = body["language"]
    meeting["updated_at"] = now_iso()
    return ok(meeting)


@router.delete("/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_admin(meeting["workspace_id"], user["id"]):
        raise forbidden("仅管理员及以上可删除会议")
    meeting["deleted_at"] = now_iso()
    audit(meeting["workspace_id"], user, "meeting.delete", f"{meeting['id']} · {meeting['title']}")
    return empty()


@router.post("/meetings/{meeting_id}/audio")
async def replace_audio(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    form = await request.form()
    audio = form_file(form, "audio")
    if audio is None:
        raise validation("请上传音频文件", {"audio": "不能为空"})

    data = await audio.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise validation("文件超过 200MB 上限", {"audio": "文件过大"})
    ext = audio.filename.rsplit(".", 1)[-1] if audio.filename and "." in audio.filename else "m4a"
    meeting["audio_key"] = f"{meeting['workspace_id']}/{meeting['id']}/original.{ext}"
    meeting["audio_bytes"] = len(data)
    save_audio(meeting, data)
    return ok(meeting, 201)


@router.post("/meetings/{meeting_id}/process")
async def process_meeting(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能触发处理")
    if meeting["status"] in ("transcribing", "summarizing"):
        raise ApiError(409, "STATE_CONFLICT", "该会议正在处理中，请勿重复提交")

    job_id = enqueue_job(meeting_id, "transcribing")
    return ok(
        {
            "meeting_id": meeting_id,
            "status": "transcribing",
            "progress": 2,
            "job_id": job_id or "job_unknown",
        },
        202,
    )


@router.post("/meetings/{meeting_id}/retry")
async def retry_meeting(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能重试")
    body = await read_json(request)
    from_stage = body.get("from_stage")
    if meeting["status"] in ("transcribing", "summarizing"):
        raise ApiError(409, "STATE_CONFLICT", "该会议正在处理中")

    job_id = retry_job(meeting_id, from_stage if from_stage in ("transcribing", "summarizing") else None)
    audit(
        meeting["workspace_id"],
        user,
        "meeting.retry",
        f"{meeting_id} · 从 {from_stage or '断点'} 恢复",
    )
    return ok(
        {
            "meeting_id": meeting_id,
            "status": meeting["status"],
            "progress": meeting["progress"],
            "job_id": job_id or "job_unknown",
        },
        202,
    )


# --------------------------------------------------------------------- #
# SSE 进度流                                                            #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}/events")
async def meeting_events(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)

    async def stream():
        queue: asyncio.Queue = asyncio.Queue()
        subscribe(meeting_id, queue)
        last_status = meeting["status"]
        last_progress = meeting["progress"]
        try:
            if repository.mode() == "postgres" and last_status in ("transcribing", "summarizing"):
                await asyncio.to_thread(repository.refresh_meeting, meeting_id)
                last_status = meeting["status"]
                last_progress = meeting["progress"]
            yield sse_frame(
                "status",
                {"status": last_status, "progress": last_progress},
            )
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=5)
                except asyncio.TimeoutError:
                    # 兜底：Pub/Sub 偶发丢事件时，按库对齐一次，保证前端最终能看到终态
                    if repository.mode() == "postgres" and last_status in (
                        "transcribing",
                        "summarizing",
                    ):
                        await asyncio.to_thread(repository.refresh_meeting, meeting_id)
                    if meeting["status"] != last_status:
                        last_status = meeting["status"]
                        last_progress = meeting["progress"]
                        if last_status == "done":
                            yield sse_frame("done", {"status": "done", "meeting_id": meeting_id})
                            continue
                        if last_status == "failed":
                            error = meeting.get("error") or {}
                            yield sse_frame(
                                "error",
                                {
                                    "status": "failed",
                                    "code": error.get("code"),
                                    "message": error.get("message"),
                                    "stage": error.get("stage"),
                                    "retryable": error.get("retryable", True),
                                },
                            )
                            continue
                        yield sse_frame(
                            "status", {"status": last_status, "progress": last_progress}
                        )
                        continue
                    if meeting["progress"] != last_progress:
                        last_progress = meeting["progress"]
                        yield sse_frame(
                            "progress", {"status": last_status, "progress": last_progress}
                        )
                        continue
                    yield sse_frame("ping", {"ts": now_iso()})
                    continue
                last_status = data.get("status", last_status)
                last_progress = data.get("progress", last_progress)
                yield sse_frame(event, data)
        finally:
            unsubscribe(meeting_id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# --------------------------------------------------------------------- #
# 转写 / 摘要                                                           #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}/transcript")
async def transcript(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    segments = sorted(
        [s for s in db["transcript_segments"] if s["meeting_id"] == meeting["id"]],
        key=lambda s: s["seq"],
    )
    return ok(segments)


@router.get("/meetings/{meeting_id}/summary")
async def summary(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    versions = sorted(
        [s for s in db["summaries"] if s["meeting_id"] == meeting["id"]],
        key=lambda s: s["version"],
        reverse=True,
    )
    if not versions:
        raise not_found("该会议还没有摘要")
    return ok({"latest": versions[0], "history": versions})


@router.post("/meetings/{meeting_id}/summary/regenerate")
async def regenerate_summary(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能重新生成摘要")
    if meeting["status"] in ("transcribing", "summarizing"):
        raise ApiError(409, "STATE_CONFLICT", "该会议正在处理中")
    job_id = enqueue_job(meeting_id, "summarizing")
    return ok(
        {
            "meeting_id": meeting_id,
            "status": "summarizing",
            "progress": 70,
            "job_id": job_id or "job_unknown",
        },
        202,
    )


# --------------------------------------------------------------------- #
# 参会成员                                                              #
# --------------------------------------------------------------------- #

def _apply_meeting_role(roster: list[dict], target: dict, role: str) -> dict:
    if role == "host":
        for participant in roster:
            if participant["user_id"] != target["user_id"] and participant["meeting_role"] == "host":
                participant["meeting_role"] = "participant"
    target["meeting_role"] = role
    return target


@router.get("/meetings/{meeting_id}/participants")
async def list_participants(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    return ok(db["meeting_participants"].get(meeting["id"], []))


@router.post("/meetings/{meeting_id}/participants")
async def add_participant(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能管理参会成员")

    body = await read_json(request)
    user_id = body.get("user_id")
    member = next(
        (
            m
            for m in db["workspace_members"].get(meeting["workspace_id"], [])
            if m["user_id"] == user_id
        ),
        None,
    )
    if not member:
        raise validation("该成员不在当前工作区中", {"user_id": "无效成员"})

    next_role = meeting_role_or_default(body.get("meeting_role"))
    roster = db["meeting_participants"].setdefault(meeting_id, [])
    existing = next((p for p in roster if p["user_id"] == member["user_id"]), None)
    if existing:
        return ok(_apply_meeting_role(roster, existing, next_role))

    participant = {
        "user_id": member["user_id"],
        "name": member["name"],
        "email": member["email"],
        "avatar_url": member.get("avatar_url"),
        "meeting_role": next_role,
        "is_creator": False,
        "joined_at": now_iso(),
    }
    roster.append(participant)
    _apply_meeting_role(roster, participant, next_role)
    audit(
        meeting["workspace_id"],
        user,
        "meeting.participant.add",
        f"{meeting_id} · {member['name']}（{next_role}）",
    )
    return ok(participant, 201)


@router.patch("/meetings/{meeting_id}/participants/{uid}")
async def update_participant(meeting_id: str, uid: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能修改会议身份")

    roster = db["meeting_participants"].get(meeting_id, [])
    participant = next((p for p in roster if p["user_id"] == uid), None)
    if not participant:
        raise not_found("该成员不在会议中")

    body = await read_json(request)
    role = body.get("meeting_role")
    if role not in ("host", "recorder", "participant", "observer"):
        raise validation("会议身份不合法")
    if participant.get("is_creator") and role != "host":
        raise ApiError(409, "STATE_CONFLICT", "会议创建者必须是主持人")
    return ok(_apply_meeting_role(roster, participant, role))


@router.delete("/meetings/{meeting_id}/participants/{uid}")
async def remove_participant(meeting_id: str, uid: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能移除参会成员")

    roster = db["meeting_participants"].get(meeting_id, [])
    participant = next((p for p in roster if p["user_id"] == uid), None)
    if not participant:
        raise not_found("该成员不在会议中")
    if participant.get("is_creator"):
        raise ApiError(409, "STATE_CONFLICT", "会议创建者不能被移除")

    db["meeting_participants"][meeting_id] = [
        p for p in roster if p["user_id"] != participant["user_id"]
    ]
    audit(
        meeting["workspace_id"],
        user,
        "meeting.participant.remove",
        f"{meeting_id} · {participant['name']}",
    )
    return empty()


# --------------------------------------------------------------------- #
# 会议资料                                                              #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}/attachments")
async def list_attachments(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    items = sorted(
        [a for a in db["attachments"] if a["meeting_id"] == meeting["id"]],
        key=lambda a: a["created_at"],
        reverse=True,
    )
    return ok([{**a, "url": attachment_url_for(a)} for a in items])


@router.post("/meetings/{meeting_id}/attachments")
async def upload_attachment(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能上传会议资料")

    form = await request.form()
    upload = form_file(form, "file")
    if upload is None:
        raise validation("请选择要共享的文件", {"file": "不能为空"})

    data = await upload.read()
    if not data:
        raise validation("请选择要共享的文件", {"file": "不能为空"})
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise validation("单个文件超过 50MB 上限", {"file": "文件过大"})

    attachment_id = new_id("att")
    file_name = upload.filename or "未命名文件"
    mime = upload.content_type or "application/octet-stream"
    attachment = {
        "id": attachment_id,
        "meeting_id": meeting["id"],
        "uploader_id": user["id"],
        "uploader_name": user["name"],
        "file_name": file_name,
        "mime_type": mime,
        "size_bytes": len(data),
        "kind": attachment_kind_of(file_name, mime),
        "url": f"/api/v1/attachments/{attachment_id}/content",
        "created_at": now_iso(),
    }
    save_attachment(attachment_id, data, mime)

    db["attachments"].append(attachment)
    audit(
        meeting["workspace_id"],
        user,
        "meeting.attachment.upload",
        f"{meeting_id} · {file_name}",
    )
    return ok({**attachment, "url": attachment_url_for(attachment)}, 201)


@router.get("/attachments/{attachment_id}/content")
async def attachment_content(attachment_id: str):
    meta = next((a for a in db["attachments"] if a["id"] == attachment_id), None)
    if not meta:
        raise not_found("资料不存在")
    data, media_type = attachment_bytes(meta)
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/attachments/{attachment_id}")
async def delete_attachment(attachment_id: str, request: Request):
    user = require_user(request, "请先登录")
    meta = next((a for a in db["attachments"] if a["id"] == attachment_id), None)
    if not meta:
        raise not_found("资料不存在")

    meeting = find_meeting(meta["meeting_id"])
    is_admin = can_admin(meeting["workspace_id"], user["id"]) if meeting else False
    if meta["uploader_id"] != user["id"] and not is_admin:
        raise forbidden("只能删除自己上传的资料")

    db["attachments"] = [a for a in db["attachments"] if a["id"] != attachment_id]
    delete_attachment_file(attachment_id)
    return empty()
