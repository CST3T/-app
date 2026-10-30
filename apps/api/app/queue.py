"""Redis 任务队列与进度广播（未配置 Redis 时由调用方退化为进程内执行）。

三个键各司其职：

- `minutes:jobs`：待执行任务（LPUSH 入队，Worker 从右侧取，保持先进先出）
- `minutes:jobs:processing`：正在执行的任务。Worker 用 `BLMOVE` 原子地移入，
  执行完再删除；进程崩溃时任务留在该列表里，下次启动自动回灌，做到「重启不丢」
- `minutes:jobs:dead`：重试超过上限的任务连同错误信息落死信，便于人工排查
- `minutes:events:{meeting_id}`：Worker 发布进度 / 状态 / 错误，API 订阅后转发给 SSE

另有 `minutes:reset:generation`：`/dev/reset` 时自增，Worker 每步校验代号，
发现代号变化即丢弃当前任务，避免重置后又被旧任务把数据写回去。
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time

import redis

QUEUE_KEY = "minutes:jobs"
PROCESSING_KEY = "minutes:jobs:processing"
DEAD_KEY = "minutes:jobs:dead"
EVENT_PREFIX = "minutes:events:"
GENERATION_KEY = "minutes:reset:generation"

logger = logging.getLogger("minutes.queue")

_client: redis.Redis | None = None
_listener_client: redis.Redis | None = None
_lock = threading.Lock()


def url() -> str:
    return os.getenv("REDIS_URL", "")


def _conn() -> redis.Redis:
    global _client
    with _lock:
        if _client is None:
            _client = redis.Redis.from_url(
                url(),
                decode_responses=True,
                socket_timeout=5,
                socket_connect_timeout=2,
            )
        return _client


def available() -> bool:
    if not url():
        return False
    try:
        return bool(_conn().ping())
    except Exception as exc:  # noqa: BLE001 - 依赖不可用只降级，不影响主流程
        logger.warning("Redis 不可用，本次退回进程内执行：%s", exc)
        return False


def reset_client() -> None:
    """仅供测试/重置使用：丢弃单例，下次按最新 REDIS_URL 重建。"""
    global _client, _listener_client
    with _lock:
        _client = None
        _listener_client = None


def _subscriber_conn() -> redis.Redis:
    """订阅专用长连接：不能带 socket_timeout，否则空闲 5s 就被判读超时并重连。"""
    global _listener_client
    with _lock:
        if _listener_client is None:
            _listener_client = redis.Redis.from_url(
                url(),
                decode_responses=True,
                socket_timeout=None,
                socket_keepalive=True,
                health_check_interval=30,
            )
        return _listener_client


# --------------------------------------------------------------------- #
# 任务                                                                  #
# --------------------------------------------------------------------- #

def enqueue(payload: dict) -> bool:
    try:
        _conn().lpush(QUEUE_KEY, json.dumps(payload, ensure_ascii=False))
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("入队失败：%s", exc)
        return False


def claim(timeout: int = 2) -> str | None:
    """取一个任务并暂存到 processing；超时返回 None。"""
    try:
        return _conn().blmove(QUEUE_KEY, PROCESSING_KEY, timeout, "RIGHT", "LEFT")
    except Exception as exc:  # noqa: BLE001
        logger.warning("取任务失败：%s", exc)
        return None


def ack(raw: str) -> None:
    try:
        _conn().lrem(PROCESSING_KEY, 1, raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("确认任务失败：%s", exc)


def retry(raw: str, payload: dict) -> None:
    """重试：移出 processing 并重新入队（payload 已带新的 attempts）。"""
    try:
        pipe = _conn().pipeline()
        pipe.lrem(PROCESSING_KEY, 1, raw)
        pipe.lpush(QUEUE_KEY, json.dumps(payload, ensure_ascii=False))
        pipe.execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("重试入队失败：%s", exc)


def dead_letter(raw: str, payload: dict, attempts: int, error: str) -> bool:
    try:
        pipe = _conn().pipeline()
        pipe.lrem(PROCESSING_KEY, 1, raw)
        pipe.lpush(
            DEAD_KEY,
            json.dumps(
                {
                    "payload": payload,
                    "attempts": attempts,
                    "error": error,
                    "failed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
                ensure_ascii=False,
            ),
        )
        pipe.execute()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("死信写入失败：%s", exc)
        return False


def requeue_processing() -> int:
    """Worker 启动时回灌 processing 里残留的任务（上次异常退出留下的）。"""
    moved = 0
    try:
        while _conn().lmove(PROCESSING_KEY, QUEUE_KEY, "RIGHT", "LEFT"):
            moved += 1
    except Exception as exc:  # noqa: BLE001
        logger.warning("回灌任务失败：%s", exc)
    return moved


def purge() -> None:
    """清空待执行与处理中队列（死信保留作为排查记录）。"""
    if not url():
        return
    try:
        _conn().delete(QUEUE_KEY, PROCESSING_KEY)
    except Exception as exc:  # noqa: BLE001
        logger.warning("清空队列失败：%s", exc)


def depth() -> int:
    try:
        return int(_conn().llen(QUEUE_KEY))
    except Exception:  # noqa: BLE001
        return 0


# --------------------------------------------------------------------- #
# 广播                                                                  #
# --------------------------------------------------------------------- #

def publish(meeting_id: str, event: str, data: dict) -> None:
    try:
        _conn().publish(
            f"{EVENT_PREFIX}{meeting_id}",
            json.dumps({"event": event, "data": data}, ensure_ascii=False),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("事件广播失败：%s", exc)


def start_event_listener(on_event) -> bool:
    """API 侧订阅所有会议事件频道，收到后回调 on_event(meeting_id, event, data)。"""
    if not url():
        return False

    def run() -> None:
        while True:
            pubsub = None
            try:
                pubsub = _subscriber_conn().pubsub()
                pubsub.psubscribe(f"{EVENT_PREFIX}*")
                for message in pubsub.listen():
                    if message.get("type") != "pmessage":
                        continue
                    channel = str(message.get("channel") or "")
                    meeting_id = channel[len(EVENT_PREFIX):]
                    try:
                        payload = json.loads(message["data"])
                    except (TypeError, ValueError):
                        continue
                    on_event(meeting_id, payload.get("event"), payload.get("data") or {})
            except Exception as exc:  # noqa: BLE001
                logger.warning("事件订阅中断，2s 后重连：%s", exc)
                time.sleep(2)
            finally:
                if pubsub is not None:
                    try:
                        pubsub.close()
                    except Exception:  # noqa: BLE001
                        pass

    threading.Thread(target=run, name="minutes-event-listener", daemon=True).start()
    return True


# --------------------------------------------------------------------- #
# 重置代号                                                              #
# --------------------------------------------------------------------- #

def generation() -> str:
    if not url():
        return "0"
    try:
        return _conn().get(GENERATION_KEY) or "0"
    except Exception:  # noqa: BLE001
        return "0"


def bump_generation() -> None:
    if not url():
        return
    try:
        _conn().incr(GENERATION_KEY)
    except Exception as exc:  # noqa: BLE001
        logger.warning("重置代号自增失败：%s", exc)


__all__ = [
    "ack",
    "available",
    "bump_generation",
    "claim",
    "dead_letter",
    "depth",
    "enqueue",
    "generation",
    "publish",
    "purge",
    "requeue_processing",
    "reset_client",
    "retry",
    "start_event_listener",
]
