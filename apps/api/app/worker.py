"""独立 Worker：从 Redis 队列取任务，推进会议处理流水线并写库、广播进度。

启动：`python -m app.worker`（容器里由 compose 的 `worker` 服务托管）

可靠性约定：
- 取任务用 `BLMOVE` 原子移入 processing 列表，执行成功才删除；进程崩溃时任务
  留在 processing，下次启动自动回灌（`queue.requeue_processing`）
- 异常按 `MINUTES_JOB_MAX_ATTEMPTS` 重试，超过上限进死信 `minutes:jobs:dead`
- 每单开始前重新从 PostgreSQL 水合，保证看到 API 刚写入的新会议
- 每步事件先落库再发 Pub/Sub，API 收到终态事件时能读到完整结果
- `/dev/reset` 会自增重置代号，Worker 发现代号变化立即丢弃当前任务
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys

from . import pipeline, queue, repository
from .logging import configure_logging
from .store import find_meeting

MAX_ATTEMPTS = int(os.getenv("MINUTES_JOB_MAX_ATTEMPTS", "3") or "3")

logger = logging.getLogger("minutes.worker")

_stop = False
_generation = ""


class StaleJob(Exception):
    """数据已重置，当前任务作废。"""


def _guard() -> None:
    if queue.generation() != _generation:
        raise StaleJob()


def _flush() -> None:
    _guard()
    repository.flush(force=True)


def _publish(meeting_id: str, event: str, data: dict) -> None:
    """状态类事件先落库再广播，API 随后刷新即可读到最新数据。"""
    _guard()
    if event != "progress":
        repository.flush(force=True)
    queue.publish(meeting_id, event, data)


def _process(raw: str) -> None:
    global _generation

    try:
        payload = json.loads(raw)
    except ValueError:
        queue.dead_letter(raw, {}, 0, "payload 不是合法 JSON")
        return

    meeting_id = str(payload.get("meeting_id") or "")
    from_stage = payload.get("from_stage") or "transcribing"
    attempts = int(payload.get("attempts") or 0)
    _generation = queue.generation()

    try:
        # 每单重新水合：API 可能刚创建了会议或更新了状态
        if not repository.load_all():
            raise RuntimeError("数据库为空，无法水合会议")
        meeting = find_meeting(meeting_id)
        if meeting is None:
            raise RuntimeError(f"会议不存在或已删除：{meeting_id}")
        if meeting["status"] not in ("transcribing", "summarizing"):
            # 重置后残留的重复任务：会议已是终态，直接丢弃
            queue.ack(raw)
            logger.info("跳过重复任务：%s（当前状态 %s）", meeting_id, meeting["status"])
            return

        pipeline.reset()
        pipeline.run_job(meeting_id, from_stage, flush=_flush)
        queue.ack(raw)
        logger.info("任务完成：%s（从 %s 起）", meeting_id, from_stage)
    except StaleJob:
        queue.ack(raw)
        logger.info("检测到数据重置，丢弃过期任务：%s", meeting_id)
    except Exception as exc:  # noqa: BLE001 - 坏任务不能拖垮 Worker
        logger.exception("任务失败：%s", meeting_id)
        attempts += 1
        error = f"{type(exc).__name__}: {exc}"
        if attempts >= MAX_ATTEMPTS:
            queue.dead_letter(raw, {**payload, "attempts": attempts}, attempts, error)
            logger.error("任务进入死信：%s（第 %s 次失败）", meeting_id, attempts)
        else:
            queue.retry(raw, {**payload, "attempts": attempts})
            logger.warning("任务稍后重试：%s（第 %s 次失败）", meeting_id, attempts)


def _handle_stop(_signum, _frame) -> None:
    global _stop
    _stop = True


def main() -> int:
    configure_logging()

    if not repository.enabled():
        logger.error("Worker 需要 DATABASE_URL（PostgreSQL），当前未配置")
        return 2
    if not os.getenv("REDIS_URL") or not queue.available():
        logger.error("Worker 需要可用的 Redis（REDIS_URL）")
        return 2

    if repository.init() != "postgres":
        logger.error("PostgreSQL 不可用，Worker 退出")
        return 2

    pipeline.set_publisher(_publish)
    moved = queue.requeue_processing()
    if moved:
        logger.warning("已回灌上次未完成的任务 %s 个", moved)

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    logger.info("Worker 已启动：待执行任务 %s 个", queue.depth())
    while not _stop:
        raw = queue.claim(timeout=2)
        if raw is None:
            continue
        _process(raw)
    logger.info("Worker 收到停止信号，退出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
