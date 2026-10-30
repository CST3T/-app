"""处理流水线：uploaded → transcribing → summarizing → done / failed。

与 apps/web/mocks/pipeline.ts 行为一致：
- 转写 9s（2% → 70%），摘要 6s（70% → 100%）
- 标题包含「失败 / 超时 / fail」时在摘要阶段模拟一次失败，用于演示断点重试
- 通过内存队列向 SSE 订阅者推送 status / progress / error / done

两种执行方式：
- 有 PostgreSQL + Redis 时，任务投递给独立 Worker（`app/worker.py`），事件走
  Redis Pub/Sub 再回到 API 的 SSE，进程重启不影响任务
- 缺任一依赖（单测、本地纯内存）时退化为进程内 asyncio 任务，行为不变
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections import defaultdict
from typing import Callable

from . import queue as job_queue
from . import repository
from .store import db, find_meeting, now_iso

logger = logging.getLogger("minutes.pipeline")

SCALE = float(os.getenv("MINUTES_PIPELINE_SCALE", "1") or "1")
TRANSCRIBE_SECONDS = 9.0 / SCALE
SUMMARIZE_SECONDS = 6.0 / SCALE
TICK_SECONDS = 0.5 / SCALE

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
_subscriber_loops: dict[int, asyncio.AbstractEventLoop] = {}
_jobs: dict[str, dict] = {}
_task: asyncio.Task | None = None
_publisher: Callable[[str, str, dict], None] | None = None


def set_publisher(publisher: Callable[[str, str, dict], None] | None) -> None:
    """Worker 用它把事件发到 Redis Pub/Sub；API 进程不设置（只转发本地订阅者）。"""
    global _publisher
    _publisher = publisher


def subscribe(meeting_id: str, queue: asyncio.Queue) -> None:
    _subscribers[meeting_id].add(queue)
    try:
        _subscriber_loops[id(queue)] = asyncio.get_running_loop()
    except RuntimeError:  # 没有事件循环（脚本调用）时按同步写入处理
        pass


def unsubscribe(meeting_id: str, queue: asyncio.Queue) -> None:
    subscribers = _subscribers.get(meeting_id)
    if subscribers:
        subscribers.discard(queue)
        if not subscribers:
            _subscribers.pop(meeting_id, None)
    _subscriber_loops.pop(id(queue), None)


def reset() -> None:
    """清空任务与订阅（仅供 dev reset / 测试隔离）。"""
    _jobs.clear()
    _subscribers.clear()
    _subscriber_loops.clear()


def emit(meeting_id: str, event: str, data: dict) -> None:
    """本地 SSE 订阅者 + 跨进程广播各发一份。

    事件可能来自其他线程（Redis 订阅线程），所以统一走 call_soon_threadsafe。
    """
    for queue in list(_subscribers.get(meeting_id, set())):
        loop = _subscriber_loops.get(id(queue))
        try:
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(queue.put_nowait, (event, data))
            else:
                queue.put_nowait((event, data))
        except Exception:  # noqa: BLE001 - 连接已断开的订阅者直接跳过
            continue
    if _publisher is not None:
        _publisher(meeting_id, event, data)


def _should_fail(title: str) -> bool:
    return bool(re.search(r"失败|超时|fail", title, re.IGNORECASE))


def _job_id(meeting_id: str) -> str:
    stamp = format(int(time.time() * 1000), "x")
    return f"job_{meeting_id[-6:]}_{stamp}"


def _ensure_task() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_run())


def prepare_job(meeting_id: str, from_stage: str = "transcribing") -> str | None:
    """把会议置为处理中并登记任务，返回 job_id；不负责调度。"""
    meeting = find_meeting(meeting_id)
    if not meeting:
        return None

    fail_at = "summarizing" if (_should_fail(meeting["title"]) and from_stage == "transcribing") else None
    _jobs[meeting_id] = {
        "started_at": time.monotonic(),
        "from_stage": from_stage,
        "fail_at": fail_at,
    }

    meeting["status"] = from_stage
    meeting["progress"] = 2 if from_stage == "transcribing" else 70
    meeting["error"] = None
    meeting["updated_at"] = now_iso()
    repository.mark_dirty()
    return _job_id(meeting_id)


def _dispatch(meeting_id: str, from_stage: str, job_id: str) -> bool:
    """PostgreSQL 与 Redis 都就绪时交给独立 Worker，否则留在本进程推进。"""
    if repository.mode() != "postgres" or not job_queue.available():
        return False
    try:
        # 先落库再入队，保证 Worker 取到任务时会议行已经存在
        repository.flush(force=True)
        if not job_queue.enqueue(
            {
                "meeting_id": meeting_id,
                "from_stage": from_stage,
                "job_id": job_id,
                "attempts": 0,
            }
        ):
            return False
    except Exception as exc:  # noqa: BLE001
        logger.warning("投递任务失败，改由本进程执行：%s", exc)
        return False
    # 已交给 Worker，本进程不再 tick 这场会议，避免两边同时推进
    _jobs.pop(meeting_id, None)
    return True


def enqueue_job(meeting_id: str, from_stage: str = "transcribing") -> str | None:
    job_id = prepare_job(meeting_id, from_stage)
    if job_id is None:
        return None

    if _dispatch(meeting_id, from_stage, job_id):
        return job_id

    _ensure_task()
    _tick(time.monotonic())
    return job_id


def run_job(meeting_id: str, from_stage: str, flush=None) -> str | None:
    """Worker 专用：同步推进到终态，期间定期落库（flush 由调用方注入）。"""
    job_id = prepare_job(meeting_id, from_stage)
    if job_id is None:
        return None

    last_flush = time.monotonic()
    while meeting_id in _jobs:
        _tick(time.monotonic())
        now = time.monotonic()
        if flush is not None and now - last_flush >= 1.0:
            flush()
            last_flush = now
        time.sleep(TICK_SECONDS)
    if flush is not None:
        flush()
    return job_id


def resume_incomplete() -> None:
    """进程重启后，把仍处于处理中的会议重新入队，避免状态永远卡住。"""
    for meeting in list(db["meetings"]):
        if meeting.get("deleted_at"):
            continue
        if meeting["status"] in ("transcribing", "summarizing"):
            enqueue_job(meeting["id"], meeting["status"])


def retry_job(meeting_id: str, from_stage: str | None = None) -> str | None:
    meeting = find_meeting(meeting_id)
    if not meeting:
        return None
    error = meeting.get("error") or {}
    stage = from_stage or ("summarizing" if error.get("stage") == "summarizing" else "transcribing")
    return enqueue_job(meeting_id, stage)


async def _run() -> None:
    global _task
    while _jobs:
        await asyncio.sleep(TICK_SECONDS)
        _tick(time.monotonic())
    _task = None


def _tick(now: float) -> None:
    for meeting_id, job in list(_jobs.items()):
        meeting = find_meeting(meeting_id)
        if not meeting:
            _jobs.pop(meeting_id, None)
            continue

        elapsed = now - job["started_at"]

        if meeting["status"] == "transcribing":
            ratio = min(elapsed / TRANSCRIBE_SECONDS, 1)
            progress = round(2 + ratio * 68)
            meeting["progress"] = progress
            emit(meeting_id, "progress", {"status": "transcribing", "progress": progress})

            if ratio >= 1:
                write_transcript(meeting_id)
                if job["fail_at"] == "summarizing":
                    meeting["status"] = "failed"
                    meeting["progress"] = 70
                    message = "摘要服务超时（LLM 响应超过 60s），转写结果已保留"
                    meeting["error"] = {
                        "code": "INTERNAL_ERROR",
                        "message": message,
                        "stage": "summarizing",
                        "retryable": True,
                    }
                    meeting["updated_at"] = now_iso()
                    repository.mark_dirty()
                    _jobs.pop(meeting_id, None)
                    emit(
                        meeting_id,
                        "error",
                        {
                            "status": "failed",
                            "code": "INTERNAL_ERROR",
                            "message": message,
                            "stage": "summarizing",
                            "retryable": True,
                        },
                    )
                    continue

                meeting["status"] = "summarizing"
                meeting["progress"] = 70
                meeting["updated_at"] = now_iso()
                job["started_at"] = now
                repository.mark_dirty()
                emit(meeting_id, "status", {"status": "summarizing", "progress": 70})
            continue

        if meeting["status"] == "summarizing":
            ratio = min(elapsed / SUMMARIZE_SECONDS, 1)
            progress = round(70 + ratio * 30)
            meeting["progress"] = progress
            emit(meeting_id, "progress", {"status": "summarizing", "progress": progress})

            if ratio >= 1:
                write_summary(meeting_id)
                meeting["status"] = "done"
                meeting["progress"] = 100
                meeting["error"] = None
                meeting["updated_at"] = now_iso()
                repository.mark_dirty()
                _jobs.pop(meeting_id, None)
                emit(meeting_id, "done", {"status": "done", "meeting_id": meeting_id})


TRANSCRIPT_TEMPLATE: list[tuple[int, int, str | None, str]] = [
    (0, 21000, "林知远", "好，人到齐了，我们开始。今天先把上次的遗留问题过一遍，然后讨论新的方案。"),
    (21000, 48500, "陈慕", "上次遗留的两个问题，第一个接口超时已经修了，第二个数据不一致还在查，怀疑是并发写入没加锁。"),
    (48500, 80200, "王砚", "前端这边我加了一层重试和本地缓存，用户侧基本感觉不到抖动，但错误提示还是不够明确。"),
    (80200, 116000, "赵时", "从测试角度，我建议把这类偶发问题都补上可观测性，日志里要带 request_id，不然排查全靠猜。"),
    (116000, 152400, "林知远", "同意。那这次的目标就定成「把稳定性做扎实」，先不加新功能。"),
    (152400, 189000, "陈慕", "我这边提一个方案：关键写操作加分布式锁，失败直接返回 409，让前端提示用户稍后重试。"),
    (189000, 224600, "王砚", "409 前端已经有处理逻辑了，会提示当前状态并且不重复提交。"),
    (224600, 258000, "赵时", "那我补一组并发场景的用例，压测的时候一起跑。"),
    (258000, 292400, "林知远", "好，那就这么定。下周这个时间再对一次结果。"),
]


def write_transcript(meeting_id: str) -> None:
    db["transcript_segments"] = [
        s for s in db["transcript_segments"] if s["meeting_id"] != meeting_id
    ]
    segments = []
    for index, (start, end, speaker, content) in enumerate(TRANSCRIPT_TEMPLATE):
        segments.append(
            {
                "id": f"{meeting_id}_s{index + 1:03d}",
                "meeting_id": meeting_id,
                "seq": index + 1,
                "start_ms": start,
                "end_ms": end,
                "speaker": speaker,
                "content": content,
            }
        )
    db["transcript_segments"].extend(segments)

    meeting = find_meeting(meeting_id)
    if meeting and segments:
        meeting["duration_sec"] = segments[-1]["end_ms"] / 1000


def write_summary(meeting_id: str) -> None:
    existing = [s for s in db["summaries"] if s["meeting_id"] == meeting_id]
    version = len(existing) + 1

    content = {
        "topics": ["上期遗留问题", "稳定性方案", "并发与锁", "可观测性"],
        "key_points": [
            "上期两个遗留问题：接口超时已修复，数据不一致仍在排查（疑似并发写入未加锁）",
            "前端已加入重试与本地缓存，用户侧感知不明显，但错误提示需要更明确",
            "本次迭代目标锁定「稳定性」，暂不引入新功能",
        ],
        "decisions": [
            "关键写操作引入分布式锁，冲突返回 409 STATE_CONFLICT",
            "日志统一结构化，必须携带 request_id 便于排查",
        ],
        "risks": [
            "分布式锁若超时设置不合理会造成长时间阻塞",
            "缺少并发压测会导致问题在线上才暴露",
        ],
        "action_items": [
            {"title": "关键写操作加分布式锁", "owner": "陈慕", "due_date": None},
            {"title": "补并发场景用例并纳入压测", "owner": "赵时", "due_date": None},
        ],
    }

    db["summaries"].append(
        {
            "id": f"sum_{meeting_id}_v{version}",
            "meeting_id": meeting_id,
            "model": "mock-llm-v1",
            "version": version,
            "status": "ok",
            "content": content,
            "created_at": now_iso(),
        }
    )

    for index, item in enumerate(content["action_items"]):
        owner = next((u for u in db["users"] if u["name"] == item["owner"]), None)
        db["action_items"].append(
            {
                "id": f"ai_gen_{meeting_id}_{index}",
                "meeting_id": meeting_id,
                "owner_id": owner["id"] if owner else None,
                "owner_name": owner["name"] if owner else None,
                "title": item["title"],
                "status": "todo",
                "priority": "medium",
                "due_date": item["due_date"],
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
        )


def sse_frame(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


__all__ = [
    "emit",
    "enqueue_job",
    "prepare_job",
    "reset",
    "resume_incomplete",
    "retry_job",
    "run_job",
    "set_publisher",
    "subscribe",
    "unsubscribe",
    "sse_frame",
]
