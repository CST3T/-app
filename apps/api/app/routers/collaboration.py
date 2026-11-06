from __future__ import annotations

import asyncio
import random
import secrets
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import Response

from .. import llm
from ..api_utils import guard_meeting, read_json, require_user
from ..docgen import build_docx
from ..errors import ApiError, forbidden, not_found, validation
from ..http import empty, ok
from ..store import (
    audit,
    can_admin,
    can_write,
    db,
    find_meeting,
    find_workspace,
    new_id,
    now_iso,
    role_of,
)

router = APIRouter()


# --------------------------------------------------------------------- #
# 待办                                                                  #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}/action-items")
async def list_action_items(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    status = request.query_params.get("status")
    owner_id = request.query_params.get("owner_id")

    items = [a for a in db["action_items"] if a["meeting_id"] == meeting["id"]]
    if status and status != "all":
        items = [a for a in items if a["status"] == status]
    if owner_id:
        items = [a for a in items if a["owner_id"] == owner_id]
    return ok(items)


@router.post("/meetings/{meeting_id}/action-items")
async def create_action_item(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能新增待办")

    body = await read_json(request)
    title = str(body.get("title") or "")
    if not title.strip():
        raise validation("请填写待办内容", {"title": "不能为空"})

    owner_id = body.get("owner_id")
    owner = next((u for u in db["users"] if u["id"] == owner_id), None)
    item = {
        "id": new_id("ai"),
        "meeting_id": meeting["id"],
        "owner_id": owner_id,
        "owner_name": owner["name"] if owner else None,
        "title": title,
        "status": body.get("status") or "todo",
        "priority": body.get("priority") or "medium",
        "due_date": body.get("due_date"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    db["action_items"].append(item)
    return ok(item, 201)


@router.patch("/action-items/{item_id}")
async def update_action_item(item_id: str, request: Request):
    user = require_user(request, "请先登录")
    item = next((a for a in db["action_items"] if a["id"] == item_id), None)
    if not item:
        raise not_found("待办不存在")
    meeting = find_meeting(item["meeting_id"])
    if not meeting or not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能编辑待办")

    body = await read_json(request)
    if body.get("title") is not None:
        item["title"] = body["title"]
    if body.get("status") is not None:
        item["status"] = body["status"]
    if body.get("priority") is not None:
        item["priority"] = body["priority"]
    if "due_date" in body:
        item["due_date"] = body["due_date"]
    if "owner_id" in body:
        item["owner_id"] = body["owner_id"]
        owner = next((u for u in db["users"] if u["id"] == body["owner_id"]), None)
        item["owner_name"] = owner["name"] if owner else None
    item["updated_at"] = now_iso()
    return ok(item)


@router.delete("/action-items/{item_id}")
async def delete_action_item(item_id: str, request: Request):
    user = require_user(request, "请先登录")
    item = next((a for a in db["action_items"] if a["id"] == item_id), None)
    if not item:
        raise not_found("待办不存在")
    meeting = find_meeting(item["meeting_id"])
    if not meeting or not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能删除待办")
    db["action_items"] = [a for a in db["action_items"] if a["id"] != item_id]
    return empty()


# --------------------------------------------------------------------- #
# 评论                                                                  #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}/comments")
async def list_comments(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    comments = sorted(
        [c for c in db["comments"] if c["target_id"] == meeting["id"]],
        key=lambda c: c["created_at"],
    )
    return ok(comments)


@router.post("/meetings/{meeting_id}/comments")
async def create_comment(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能评论")

    body = await read_json(request)
    content = str(body.get("content") or "").strip()
    if not content:
        raise validation("评论不能为空")

    comment = {
        "id": new_id("cm"),
        "target_type": body.get("target_type") or "meeting",
        "target_id": body.get("target_id") or meeting["id"],
        "user_id": user["id"],
        "user_name": user["name"],
        "user_avatar_url": user.get("avatar_url"),
        "content": content,
        "created_at": now_iso(),
    }
    db["comments"].append(comment)
    return ok(comment, 201)


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, request: Request):
    user = require_user(request, "请先登录")
    comment = next((c for c in db["comments"] if c["id"] == comment_id), None)
    if not comment:
        raise not_found("评论不存在")

    meeting = find_meeting(comment["target_id"])
    if not meeting:
        item = next((a for a in db["action_items"] if a["id"] == comment["target_id"]), None)
        meeting = find_meeting(item["meeting_id"]) if item else None
    is_admin = can_admin(meeting["workspace_id"], user["id"]) if meeting else False
    if comment["user_id"] != user["id"] and not is_admin:
        raise forbidden("只能删除自己的评论")

    db["comments"] = [c for c in db["comments"] if c["id"] != comment_id]
    return empty()


# --------------------------------------------------------------------- #
# 搜索                                                                  #
# --------------------------------------------------------------------- #

def _highlight(text: str, query: str) -> str:
    index = text.lower().find(query)
    if index < 0:
        return text
    start = max(0, index - 24)
    end = min(len(text), index + len(query) + 40)
    return f"{'…' if start > 0 else ''}{text[start:end]}{'…' if end < len(text) else ''}"


@router.get("/workspaces/{wid}/search")
async def search(wid: str, request: Request):
    user = require_user(request, "请先登录")
    if not role_of(wid, user["id"]):
        raise forbidden("你不在该工作区中")

    query = (request.query_params.get("q") or "").strip().lower()
    mode = request.query_params.get("mode") or "hybrid"
    if not query:
        return ok({"query": "", "mode": mode, "hits": [], "took_ms": 0})

    meetings = [
        m for m in db["meetings"] if m["workspace_id"] == wid and not m["deleted_at"]
    ]
    meeting_map = {m["id"]: m for m in meetings}
    hits: list[dict] = []

    for meeting in meetings:
        if query in meeting["title"].lower():
            hits.append(
                {
                    "meeting_id": meeting["id"],
                    "meeting_title": meeting["title"],
                    "started_at": meeting["started_at"],
                    "source_type": "title",
                    "snippet": meeting["title"],
                    "score": 0.98,
                }
            )

    for segment in db["transcript_segments"]:
        meeting = meeting_map.get(segment["meeting_id"])
        if not meeting or query not in segment["content"].lower():
            continue
        hits.append(
            {
                "meeting_id": segment["meeting_id"],
                "meeting_title": meeting["title"],
                "started_at": meeting["started_at"],
                "source_type": "transcript",
                "snippet": _highlight(segment["content"], query),
                "score": 0.86,
                "start_ms": segment["start_ms"],
            }
        )

    for summary in db["summaries"]:
        meeting = meeting_map.get(summary["meeting_id"])
        if not meeting:
            continue
        pool = (
            summary["content"]["topics"]
            + summary["content"]["key_points"]
            + summary["content"]["decisions"]
            + summary["content"]["risks"]
        )
        for line in pool:
            if query in line.lower():
                hits.append(
                    {
                        "meeting_id": summary["meeting_id"],
                        "meeting_title": meeting["title"],
                        "started_at": meeting["started_at"],
                        "source_type": "summary",
                        "snippet": _highlight(line, query),
                        "score": 0.78,
                    }
                )

    for item in db["action_items"]:
        meeting = meeting_map.get(item["meeting_id"])
        if not meeting or query not in item["title"].lower():
            continue
        hits.append(
            {
                "meeting_id": item["meeting_id"],
                "meeting_title": meeting["title"],
                "started_at": meeting["started_at"],
                "source_type": "action_item",
                "snippet": _highlight(item["title"], query),
                "score": 0.74,
            }
        )

    hits.sort(key=lambda h: h["score"], reverse=True)
    return ok(
        {
            "query": query,
            "mode": mode,
            "hits": hits[:30],
            "took_ms": 12 + random.randint(0, 60),
        }
    )


# --------------------------------------------------------------------- #
# 分享                                                                  #
# --------------------------------------------------------------------- #

@router.get("/meetings/{meeting_id}/share-links")
async def list_share_links(meeting_id: str, request: Request):
    meeting, _user, _role = guard_meeting(request, meeting_id)
    return ok([s for s in db["share_links"] if s["meeting_id"] == meeting["id"]])


@router.post("/meetings/{meeting_id}/share-links")
async def create_share_link(meeting_id: str, request: Request):
    meeting, user, _role = guard_meeting(request, meeting_id)
    if not can_write(meeting["workspace_id"], user["id"]):
        raise forbidden("当前角色不能创建分享链接")

    body = await read_json(request)
    scope = body.get("scope") or "read_transcript"
    expires_in = body.get("expires_in_hours")
    link = {
        "id": new_id("sl"),
        "meeting_id": meeting["id"],
        "token": f"shr_{secrets.token_urlsafe(8)}",
        "scope": scope,
        "expires_at": None if expires_in is None else _iso_after_hours(expires_in),
        "revoked_at": None,
        "created_at": now_iso(),
    }
    db["share_links"].append(link)
    audit(meeting["workspace_id"], user, "share.create", f"{meeting_id} · {scope}")
    return ok(link, 201)


def _iso_after_hours(hours: float) -> str:
    from datetime import datetime, timedelta, timezone

    moment = datetime.now(timezone.utc) + timedelta(hours=float(hours))
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@router.delete("/share-links/{link_id}")
async def revoke_share_link(link_id: str, request: Request):
    user = require_user(request, "请先登录")
    link = next((s for s in db["share_links"] if s["id"] == link_id), None)
    if not link:
        raise not_found("分享链接不存在")
    meeting = find_meeting(link["meeting_id"])
    if not meeting or not can_admin(meeting["workspace_id"], user["id"]):
        raise forbidden("仅管理员及以上可撤销分享")
    link["revoked_at"] = now_iso()
    return empty()


@router.get("/public/shares/{token}")
async def public_share(token: str):
    link = next((s for s in db["share_links"] if s["token"] == token), None)
    if not link:
        raise not_found("分享链接不存在")
    if link["revoked_at"]:
        raise ApiError(410, "NOT_FOUND", "分享链接已被撤销")
    if link["expires_at"] and link["expires_at"] < now_iso():
        raise ApiError(410, "NOT_FOUND", "分享链接已过期")

    meeting = find_meeting(link["meeting_id"])
    if not meeting:
        raise not_found("会议不存在")

    versions = sorted(
        [s for s in db["summaries"] if s["meeting_id"] == meeting["id"]],
        key=lambda s: s["version"],
        reverse=True,
    )
    transcript = []
    if link["scope"] == "read_transcript":
        transcript = sorted(
            [s for s in db["transcript_segments"] if s["meeting_id"] == meeting["id"]],
            key=lambda s: s["seq"],
        )
    workspace = find_workspace(meeting["workspace_id"])
    return ok(
        {
            "meeting": {
                "id": meeting["id"],
                "title": meeting["title"],
                "duration_sec": meeting["duration_sec"],
                "language": meeting["language"],
                "started_at": meeting["started_at"],
                "status": meeting["status"],
            },
            "summary": versions[0] if versions else None,
            "transcript": transcript,
            "action_items": [a for a in db["action_items"] if a["meeting_id"] == meeting["id"]],
            "workspace_name": workspace["name"] if workspace else "共享工作区",
            "expires_at": link["expires_at"],
        }
    )


# --------------------------------------------------------------------- #
# AI 会议文档（分享 → 生成 Word 文档，可直接保存）                        #
# --------------------------------------------------------------------- #

def _format_ms(ms: int) -> str:
    seconds = max(0, int((ms or 0) / 1000))
    minutes, sec = divmod(seconds, 60)
    return f"{minutes:02d}:{sec:02d}"


def _latest_summary_content(meeting_id: str) -> dict | None:
    versions = sorted(
        [s for s in db["summaries"] if s["meeting_id"] == meeting_id],
        key=lambda s: s["version"],
        reverse=True,
    )
    return versions[0]["content"] if versions else None


def _meeting_segments(meeting_id: str) -> list[dict]:
    return sorted(
        [s for s in db["transcript_segments"] if s["meeting_id"] == meeting_id],
        key=lambda s: s["seq"],
    )


def _transcript_text(segments: list[dict]) -> str:
    lines = []
    for segment in segments:
        speaker = segment.get("speaker") or "发言人"
        lines.append(f"[{_format_ms(segment.get('start_ms') or 0)}] {speaker}：{segment['content']}")
    return "\n".join(lines)


def _fallback_document(meeting: dict, summary: dict | None, segments: list[dict]) -> dict:
    """未配置 LLM 或调用失败时，用已有摘要 + 转写稿拼一份结构化文档。"""
    sections: list[dict] = []
    if summary:
        if summary.get("topics"):
            sections.append({"heading": "议题", "paragraphs": [], "bullets": summary["topics"]})
        if summary.get("key_points"):
            sections.append({"heading": "讨论要点", "paragraphs": [], "bullets": summary["key_points"]})
        if summary.get("decisions"):
            sections.append({"heading": "结论与决议", "paragraphs": [], "bullets": summary["decisions"]})
        if summary.get("risks"):
            sections.append({"heading": "风险与待确认", "paragraphs": [], "bullets": summary["risks"]})
        items = summary.get("action_items") or []
        if items:
            bullets = []
            for item in items:
                owner = item.get("owner") or "未指定"
                due = f"（{item['due_date']}）" if item.get("due_date") else ""
                bullets.append(f"{item['title']} —— 责任人：{owner}{due}")
            sections.append({"heading": "后续行动", "paragraphs": [], "bullets": bullets})
    if segments:
        preview = [
            f"[{_format_ms(s.get('start_ms') or 0)}] {s.get('speaker') or '发言人'}：{s['content']}"
            for s in segments[:80]
        ]
        sections.append({"heading": "转写摘录", "paragraphs": [], "bullets": preview})
    if not sections:
        raise ApiError(409, "STATE_CONFLICT", "该会议还没有可用的转写或摘要内容，请等待处理完成")
    return {
        "title": meeting["title"],
        "overview": f"本纪要由「会记 Minutes」根据会议「{meeting['title']}」的转写与摘要内容整理。",
        "sections": sections,
    }


@router.post("/meetings/{meeting_id}/share-document")
async def share_document(meeting_id: str, request: Request):
    """把会议内容用 AI 整理成 Word 文档，浏览器直接下载保存。"""
    meeting, user, _role = guard_meeting(request, meeting_id)
    body = await read_json(request)
    include_transcript = bool(body.get("include_transcript"))

    summary = _latest_summary_content(meeting_id)
    segments = _meeting_segments(meeting_id)
    if not segments and not summary:
        raise ApiError(409, "STATE_CONFLICT", "该会议还没有可用的转写或摘要内容，请等待处理完成")

    doc = None
    if llm.enabled():
        try:
            doc, _model = await asyncio.to_thread(
                llm.compose_document,
                _transcript_text(segments),
                meeting["title"],
                summary,
            )
        except llm.LlmError:
            doc = None
    if doc is None:
        doc = _fallback_document(meeting, summary, segments)

    blocks: list[tuple[str, str]] = [("title", doc["title"]), ("meta", f"整理人：{user['name']} · 由 AI 根据会议内容生成")]
    if doc.get("overview"):
        blocks.append(("h2", "会议总览"))
        blocks.append(("p", doc["overview"]))
    for index, section in enumerate(doc["sections"], start=1):
        blocks.append(("h2", f"{index}. {section['heading']}"))
        for paragraph in section.get("paragraphs", []):
            blocks.append(("p", paragraph))
        for bullet in section.get("bullets", []):
            blocks.append(("bullet", bullet))
    if include_transcript and segments:
        blocks.append(("pb", ""))
        blocks.append(("h2", "附录：完整转写稿"))
        for segment in segments:
            speaker = segment.get("speaker") or "发言人"
            blocks.append(
                ("p", f"[{_format_ms(segment.get('start_ms') or 0)}] {speaker}：{segment['content']}")
            )

    data = build_docx(blocks)
    audit(meeting["workspace_id"], user, "share.document", f"{meeting_id} · AI 文档")
    filename = quote(f"{meeting['title']}-会议纪要.docx")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "Cache-Control": "no-store",
        },
    )
