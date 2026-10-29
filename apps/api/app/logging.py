"""结构化日志。

默认 human-readable（本地开发好读），生产设 MINUTES_LOG_FORMAT=json 输出单行 JSON，
便于 Loki / ELK / CloudWatch 直接采集。所有日志自动带当前请求的 request_id。
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone

from .http import current_request_id as get_request_id


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": get_request_id(),
        }
        for key in ("method", "path", "status", "duration_ms", "meeting_id", "user_id"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        rid = get_request_id()
        return f"{base} [{rid}]" if rid else base


def configure_logging() -> None:
    level = os.getenv("MINUTES_LOG_LEVEL", "INFO").upper()
    fmt = os.getenv("MINUTES_LOG_FORMAT", "text").lower()
    handler = logging.StreamHandler()
    handler.setFormatter(
        JsonFormatter()
        if fmt == "json"
        else TextFormatter("%(asctime)s %(levelname)s %(name)s - %(message)s")
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).disabled = True


def access_logger():
    return logging.getLogger("minutes.access")


def elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
