"""响应信封与 request_id。

与 packages/contracts/openapi.yaml 一致：
  成功 { data, request_id }
  失败 { error: { code, message, details }, request_id }
"""

from __future__ import annotations

import uuid
from contextvars import ContextVar

from fastapi import Request
from fastapi.responses import JSONResponse, Response

_request_id: ContextVar[str] = ContextVar("request_id", default="req_local")


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"


def set_request_id(rid: str) -> None:
    _request_id.set(rid)


def current_request_id() -> str:
    return _request_id.get()


def ok(data, status: int = 200) -> JSONResponse:
    return JSONResponse(
        {"data": data, "request_id": current_request_id()},
        status_code=status,
    )


def empty(status: int = 204) -> Response:
    return Response(status_code=status)


def error_response(
    status: int, code: str, message: str, details: dict | None = None
) -> JSONResponse:
    return JSONResponse(
        {
            "error": {"code": code, "message": message, "details": details},
            "request_id": current_request_id(),
        },
        status_code=status,
    )


def request_id_of(request: Request) -> str:
    return getattr(request.state, "request_id", current_request_id())
