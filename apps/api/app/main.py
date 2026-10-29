"""会记 Minutes API —— FastAPI 入口。

契约：packages/contracts/openapi.yaml
行为基准：apps/web/mocks/handlers.ts（前端关掉 Mock 即可直接联调）

启动：
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import os
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import http
from .errors import ApiError
from .logging import access_logger, configure_logging, elapsed_ms
from .pipeline import reset as reset_pipeline
from .routers import auth, collaboration, meetings, workspaces
from .seed import build_seed
from .store import db

configure_logging()

app = FastAPI(
    title="会记 Minutes API",
    version="0.1.0",
    description="AI 会议纪要服务：认证、工作区、会议、待办、搜索、分享、审计、SSE 进度。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-Id"],
    max_age=600,
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = http.new_request_id()
    http.set_request_id(request_id)
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    if not request.url.path.startswith(("/api/v1/dev",)):
        access_logger().info(
            "%s %s -> %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": elapsed_ms(started),
            },
        )
    return response


@app.exception_handler(ApiError)
async def handle_api_error(_request: Request, exc: ApiError):
    return http.error_response(exc.status, exc.code, exc.message, exc.details)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, exc: RequestValidationError):
    return http.error_response(400, "VALIDATION_ERROR", "请求参数不合法", {"errors": exc.errors()})


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(_request: Request, exc: StarletteHTTPException):
    code = "NOT_FOUND" if exc.status_code == 404 else "INTERNAL_ERROR"
    message = str(exc.detail) if exc.detail else "请求失败"
    return http.error_response(exc.status_code, code, message)


@app.exception_handler(Exception)
async def handle_unexpected_error(_request: Request, exc: Exception):
    return http.error_response(500, "INTERNAL_ERROR", "服务异常，请稍后重试")


API_PREFIX = "/api/v1"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(workspaces.router, prefix=API_PREFIX)
app.include_router(meetings.router, prefix=API_PREFIX)
app.include_router(collaboration.router, prefix=API_PREFIX)


@app.post("/api/v1/dev/reset")
async def dev_reset():
    """恢复种子数据，仅用于本地演示与 E2E 测试隔离。

    默认关闭（生产安全），本地演示/E2E 需显式设置 MINUTES_ENABLE_RESET=1。
    """
    if os.getenv("MINUTES_ENABLE_RESET", "0").lower() not in ("1", "true", "yes", "on"):
        return http.error_response(404, "NOT_FOUND", "Not Found")
    db.clear()
    db.update(build_seed())
    reset_pipeline()
    return http.ok({"status": "reset"})


@app.get("/api/v1/health")
async def health():
    return http.ok({"status": "ok", "mock": False})


@app.get("/api/v1/ready")
async def ready():
    """就绪探针：检查 PostgreSQL / Redis / 文件存储，任一不可用返回 503。

    本地纯内存模式（未配 DATABASE_URL/REDIS_URL）下数据库与 Redis 会标记为
    configured=false，只要文件存储可用即返回 200，避免开发机误报。
    """
    from . import db as dbi

    checks: dict[str, dict] = {}

    if os.getenv("DATABASE_URL"):
        ok, detail = dbi.db_ping()
        checks["database"] = {"configured": True, "ok": ok, "detail": detail}
    else:
        checks["database"] = {"configured": False, "ok": True, "detail": "memory store"}

    ok, detail = dbi.redis_ping()
    checks["redis"] = {"configured": bool(os.getenv("REDIS_URL")), "ok": ok or not os.getenv("REDIS_URL"), "detail": detail}

    ok, detail = dbi.storage_ping()
    checks["storage"] = {"configured": True, "ok": ok, "detail": detail}

    all_ok = all(item["ok"] for item in checks.values())
    if all_ok:
        return http.ok({"status": "ready", "checks": checks})
    return http.error_response(503, "DEPENDENCY_UNAVAILABLE", "依赖未就绪", {"checks": checks})


@app.get("/health")
async def health_root():
    return http.ok({"status": "ok", "mock": False})


@app.get("/")
async def root():
    return http.ok(
        {
            "service": "会记 Minutes API",
            "version": "0.1.0",
            "workspaces": len(db["workspaces"]),
            "meetings": len(db["meetings"]),
            "docs": "/docs",
        }
    )
