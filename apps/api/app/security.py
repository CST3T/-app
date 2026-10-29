"""演示版鉴权：PBKDF2 口令 + PyJWT（access / refresh 双 token）。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

import jwt

_DEV_FALLBACK = "minutes-dev-secret-change-me-please-override-in-prod"
_INSECURE_SECRETS = {
    _DEV_FALLBACK,
    "change-me-to-a-32-plus-char-secret",
    "secret",
    "changeme",
}
_MIN_SECRET_LEN = 24


def _resolve_secret() -> str:
    """强制显式配置 JWT 密钥：缺失、过短或使用示例值即拒绝启动。

    本地单测/演示可用 MINUTES_ALLOW_INSECURE_JWT=1 显式放行（会退回进程内固定值）。
    """
    raw = (os.getenv("MINUTES_JWT_SECRET") or "").strip()
    if raw and len(raw) >= _MIN_SECRET_LEN and raw not in _INSECURE_SECRETS:
        return raw
    allow_insecure = (os.getenv("MINUTES_ALLOW_INSECURE_JWT") or "").strip().lower()
    if allow_insecure in ("1", "true", "yes", "on"):
        return raw or _DEV_FALLBACK
    if not raw:
        raise RuntimeError(
            "MINUTES_JWT_SECRET 未配置：请设置至少 24 位的随机密钥"
            "（生成：openssl rand -hex 32）。本地演示可设 MINUTES_ALLOW_INSECURE_JWT=1。"
        )
    if len(raw) < _MIN_SECRET_LEN:
        raise RuntimeError(
            f"MINUTES_JWT_SECRET 过短（当前 {len(raw)} 位，至少 {_MIN_SECRET_LEN} 位），拒绝启动"
        )
    raise RuntimeError("MINUTES_JWT_SECRET 使用了示例/默认值，拒绝启动；请换成随机密钥")


SECRET = _resolve_secret()
ALGORITHM = "HS256"
ACCESS_TTL = int(os.getenv("MINUTES_ACCESS_TTL", "3600"))
REFRESH_TTL = int(os.getenv("MINUTES_REFRESH_TTL", str(30 * 24 * 3600)))
PBKDF2_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algorithm, iterations, salt, expected = stored.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        int(iterations),
    )
    return hmac.compare_digest(digest.hex(), expected)


def _encode(user_id: str, token_type: str, ttl: int) -> str:
    now = int(time.time())
    payload = {"sub": user_id, "typ": token_type, "iat": now, "exp": now + ttl}
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)


def create_tokens(user_id: str) -> dict:
    return {
        "access_token": _encode(user_id, "access", ACCESS_TTL),
        "refresh_token": _encode(user_id, "refresh", REFRESH_TTL),
        "token_type": "bearer",
        "expires_in": ACCESS_TTL,
    }


def user_id_from_token(token: str, expected_type: str = "access") -> str | None:
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != expected_type:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


def decode_refresh(token: str) -> str | None:
    return user_id_from_token(token, "refresh")


def base64_token(length: int = 12) -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(length)).decode().rstrip("=")
