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

from . import asr
from . import llm
from . import queue as job_queue
from . import repository
from . import storage
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
                try:
                    write_transcript(meeting_id)
                except Exception as exc:  # 真实 ASR 失败：标记 failed，用户可原地重试
                    logger.warning("transcribe failed meeting=%s: %s", meeting_id, exc)
                    message = str(exc) if isinstance(exc, asr.AsrError) else "语音识别失败，请稍后重试"
                    meeting["status"] = "failed"
                    meeting["progress"] = 2
                    meeting["error"] = {
                        "code": "INTERNAL_ERROR",
                        "message": message,
                        "stage": "transcribing",
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
                            "stage": "transcribing",
                            "retryable": True,
                        },
                    )
                    continue

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
                try:
                    write_summary(meeting_id)
                except Exception as exc:  # LLM 失败：标记 failed，转写结果已保留，可原地重试
                    logger.warning("summarize failed meeting=%s: %s", meeting_id, exc)
                    message = str(exc) if isinstance(exc, llm.LlmError) else "生成摘要失败，请稍后重试"
                    meeting["status"] = "failed"
                    meeting["progress"] = 70
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
    """转写阶段：配置了 ASR_PROVIDER=aliyun 时真实识别音频，否则写内置演示模板。"""
    meeting = find_meeting(meeting_id)
    segments: list[dict]

    if meeting is not None and asr.enabled():
        audio = storage.audio_bytes(meeting)
        if audio is None:
            raise asr.AsrError("找不到原始音频文件，无法进行语音识别")
        segments = asr.transcribe(audio[0], audio[1], meeting.get("language") or "zh")
        logger.info("asr done meeting=%s segments=%d", meeting_id, len(segments))
    else:
        segments = [
            {"start_ms": start, "end_ms": end, "speaker": speaker, "content": content}
            for start, end, speaker, content in TRANSCRIPT_TEMPLATE
        ]

    _save_segments(meeting_id, segments)
    if meeting is not None and segments:
        meeting["duration_sec"] = segments[-1]["end_ms"] / 1000


def _save_segments(meeting_id: str, segments: list[dict]) -> None:
    db["transcript_segments"] = [
        s for s in db["transcript_segments"] if s["meeting_id"] != meeting_id
    ]
    db["transcript_segments"].extend(
        {
            "id": f"{meeting_id}_s{index + 1:03d}",
            "meeting_id": meeting_id,
            "seq": index + 1,
            "start_ms": segment["start_ms"],
            "end_ms": segment["end_ms"],
            "speaker": segment["speaker"],
            "content": segment["content"],
        }
        for index, segment in enumerate(segments)
    )


def _transcript_text(meeting_id: str) -> str:
    """把转写分段拼成带说话人的纯文本，供 LLM 阅读。"""
    segs = sorted(
        (s for s in db["transcript_segments"] if s["meeting_id"] == meeting_id),
        key=lambda s: s.get("seq", 0),
    )
    lines: list[str] = []
    for s in segs:
        content = (s.get("content") or "").strip()
        if not content:
            continue
        speaker = (s.get("speaker") or "").strip()
        lines.append(f"{speaker}：{content}" if speaker else content)
    return "\n".join(lines)


# 纯本地抽取式摘要（无 LLM Key 或云端不可用时使用）：只从真实转写文本中
# 拆分句子、按关键词归类，绝不生成转写中不存在的内容。
_SENT_SPLIT_RE = re.compile(r"[。！？!?；;\n]+")
_DECISION_HINTS = ("决定", "确定", "就这么定", "同意", "通过", "批准", "达成一致", "敲定", "确认")
_RISK_HINTS = ("风险", "隐患", "担心", "可能", "阻塞", "待确认", "不确定", "延期", "来不及", "故障")
_ACTION_HINTS = (
    "需要", "负责", "跟进", "完成", "落实", "安排", "排期", "尽快", "推进", "对接",
    "修改", "修复", "补上", "补充", "准备", "输出", "明天", "后天", "下周", "本周", "月底前", "之前",
)
_TOPIC_SPLIT_RE = re.compile(r"[\s/／、，,和与及\-:：·|]+")


def _split_sentences(text: str) -> list[str]:
    """按句末标点切句，去重并过滤过短/过长的句子。"""
    result: list[str] = []
    seen: set[str] = set()
    for part in _SENT_SPLIT_RE.split(text):
        sentence = part.strip(" 　,，、:：")
        if 4 <= len(sentence) <= 80 and sentence not in seen:
            seen.add(sentence)
            result.append(sentence)
    return result


def _derive_topics(title: str | None, sentences: list[str]) -> list[str]:
    """议题优先取会议标题切词，其次取像议题的短句。"""
    topics: list[str] = []
    if title:
        for piece in _TOPIC_SPLIT_RE.split(title):
            piece = piece.strip()
            if 2 <= len(piece) <= 12 and piece not in topics:
                topics.append(piece)
    for sentence in sentences:
        if len(sentence) <= 12 and not any(h in sentence for h in _ACTION_HINTS + _RISK_HINTS):
            if sentence not in topics:
                topics.append(sentence)
        if len(topics) >= 4:
            break
    return topics[:4] or ["会议要点"]


def _offline_summary_content(meeting_id: str, title: str | None) -> dict:
    """无云端 LLM 时基于真实转写的兜底摘要。"""
    segs = sorted(
        (s for s in db["transcript_segments"] if s["meeting_id"] == meeting_id),
        key=lambda s: s.get("seq", 0),
    )
    spoken: list[tuple[str, str | None]] = []
    for seg in segs:
        speaker = (seg.get("speaker") or "").strip() or None
        for sentence in _split_sentences(seg.get("content") or ""):
            spoken.append((sentence, speaker))

    if not spoken:
        return {
            "topics": [],
            "key_points": ["未识别到有效语音内容，请检查录音质量后重新生成摘要"],
            "decisions": [],
            "risks": [],
            "action_items": [],
        }

    topics = _derive_topics(title, [s for s, _ in spoken])
    key_points: list[str] = []
    decisions: list[str] = []
    risks: list[str] = []
    action_items: list[dict] = []
    for sentence, speaker in spoken:
        if any(h in sentence for h in _DECISION_HINTS):
            decisions.append(sentence)
        elif any(h in sentence for h in _ACTION_HINTS):
            action_items.append({"title": sentence, "owner": speaker, "due_date": None})
        elif any(h in sentence for h in _RISK_HINTS):
            risks.append(sentence)
        else:
            key_points.append(sentence)

    if not key_points:
        key_points = [s for s, _ in spoken][:3]

    return {
        "topics": topics,
        "key_points": key_points[:6],
        "decisions": decisions[:4],
        "risks": risks[:4],
        "action_items": action_items[:5],
    }


def write_summary(meeting_id: str) -> None:
    existing = [s for s in db["summaries"] if s["meeting_id"] == meeting_id]
    version = len(existing) + 1
    meeting = find_meeting(meeting_id)
    title = (meeting or {}).get("title")

    if llm.enabled():
        try:
            content, model = llm.summarize(_transcript_text(meeting_id), title)
            logger.info("llm summary done meeting=%s model=%s", meeting_id, model)
        except llm.LlmError as exc:
            # 云端不可用（断网 / Key 失效 / 超时）时回退本地摘要，保证整场不失败
            logger.warning("llm unavailable, fallback to local summary meeting=%s: %s", meeting_id, exc)
            content = _offline_summary_content(meeting_id, title)
            model = "local-extractive-v1"
    else:
        content = _offline_summary_content(meeting_id, title)
        model = "local-extractive-v1"

    db["summaries"].append(
        {
            "id": f"sum_{meeting_id}_v{version}",
            "meeting_id": meeting_id,
            "model": model,
            "version": version,
            "status": "ok",
            "content": content,
            "created_at": now_iso(),
        }
    )

    for index, item in enumerate(content["action_items"]):
        owner_name = item["owner"]
        owner = next((u for u in db["users"] if u["name"] == owner_name), None)
        db["action_items"].append(
            {
                "id": f"ai_gen_{meeting_id}_{index}",
                "meeting_id": meeting_id,
                "owner_id": owner["id"] if owner else None,
                "owner_name": owner["name"] if owner else owner_name,
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
