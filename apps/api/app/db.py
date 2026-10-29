"""数据库与外部依赖连接层（数据与平台）。

当前 v0.2 的业务读写仍由 `store.py` 的内存结构承担；本模块负责三件事：

1. 提供 SQLAlchemy engine / session，供生产化后替换 `store.py` 的 Repository 使用
2. 提供 `/ready` 所需的依赖探测（PostgreSQL / Redis / 对象存储），只做 TCP 连通性，
   不在未接依赖时把进程拖垮
3. 统一读取连接串，避免各处重复解析环境变量
"""

from __future__ import annotations

import os
import socket
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_DATABASE_URL = "postgresql+psycopg://minutes:minutes@localhost:5432/minutes"


def database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


@lru_cache(maxsize=1)
def get_engine():
    """进程级 engine。pool_pre_ping 避免长连接被中间件断开后报错。"""
    return create_engine(database_url(), pool_pre_ping=True, pool_size=5, max_overflow=10)


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def db_ping() -> tuple[bool, str]:
    """真实执行 SELECT 1，确认库可用（不只是端口通）。"""
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001 - 探测需要吞掉所有异常并上报原因
        return False, f"{type(exc).__name__}: {exc}"


def _tcp_ping(url: str, default_port: int, timeout: float = 1.0) -> tuple[bool, str]:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or default_port
    except Exception as exc:  # noqa: BLE001
        return False, f"invalid url: {exc}"
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"{host}:{port}"
    except OSError as exc:
        return False, f"{host}:{port} unreachable ({exc.__class__.__name__})"


def redis_ping() -> tuple[bool, str]:
    if not os.getenv("REDIS_URL"):
        return False, "REDIS_URL not configured"
    return _tcp_ping(os.environ["REDIS_URL"], 6379)


def storage_ping() -> tuple[bool, str]:
    """对象存储：配置了 S3_ENDPOINT 就探 TCP；否则确认本地落盘目录可写。"""
    endpoint = os.getenv("S3_ENDPOINT")
    if endpoint:
        return _tcp_ping(endpoint, 9000)
    root = Path(os.getenv("MINUTES_STORAGE_DIR", Path(__file__).resolve().parent.parent / "storage"))
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe = root / ".ready-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True, str(root)
    except OSError as exc:
        return False, f"{root} not writable ({exc.__class__.__name__})"


def check_database_and_redis() -> tuple[bool, str]:
    ok, detail = db_ping()
    return ok, detail
