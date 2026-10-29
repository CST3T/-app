"""进程内限流：按 key 记录失败次数，用于登录/注册防爆破。

单进程演示足够；生产化换成 Redis（INCR + EXPIRE）即可，接口不变。
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict


class AttemptLimiter:
    """滑动窗口计数器：窗口内失败次数达到上限即拒绝，直到最早一条过期。"""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> list[float]:
        keep = [ts for ts in self._hits.get(key, []) if now - ts < self.window]
        if keep:
            self._hits[key] = keep
        else:
            self._hits.pop(key, None)
        return keep

    def retry_after(self, key: str) -> int:
        """返回 0 表示放行；否则返回建议等待秒数。"""
        with self._lock:
            now = time.monotonic()
            hits = self._prune(key, now)
            if len(hits) < self.limit:
                return 0
            return max(1, int(self.window - (now - hits[0])) + 1)

    def record(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(key, now)
            self._hits[key].append(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def reset_all(self) -> None:
        with self._lock:
            self._hits.clear()


def client_key(request, suffix: str = "") -> str:
    """优先取反代转发头，其次取直连 IP；suffix 通常放邮箱等业务维度。"""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    host = forwarded or (request.client.host if request.client else "unknown")
    return f"{host}|{suffix}".lower()


# 登录：同一 IP + 邮箱 5 次失败 / 5 分钟；注册：同一 IP 5 次 / 10 分钟
login_limiter = AttemptLimiter(limit=5, window_seconds=300)
register_limiter = AttemptLimiter(limit=5, window_seconds=600)


def reset_limiters() -> None:
    login_limiter.reset_all()
    register_limiter.reset_all()
