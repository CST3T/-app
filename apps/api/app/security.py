"""演示版鉴权：PBKDF2 口令 + PyJWT（access / refresh 双 token）。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

import jwt

SECRET = os.getenv("MINUTES_JWT_SECRET", "minutes-dev-secret-change-me-please-override-in-prod")
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
