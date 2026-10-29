"""统一错误类型：抛出后由 main.py 的异常处理器转成契约错误信封。"""

from __future__ import annotations


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def unauthorized(message: str = "登录已过期，请重新登录") -> ApiError:
    return ApiError(401, "UNAUTHORIZED", message)


def forbidden(message: str = "当前角色没有该操作权限") -> ApiError:
    return ApiError(403, "FORBIDDEN", message)


def not_found(message: str = "资源不存在或已被删除") -> ApiError:
    return ApiError(404, "NOT_FOUND", message)


def validation(message: str, details: dict | None = None) -> ApiError:
    return ApiError(400, "VALIDATION_ERROR", message, details)


def conflict(message: str = "任务正在处理中，请勿重复提交", code: str = "STATE_CONFLICT") -> ApiError:
    return ApiError(409, code, message)
