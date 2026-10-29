'use client'

import { session } from './session'
import type { ApiErrorBody, ApiSuccess, ErrorCode } from './types'

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1'

/** 契约错误码 → 前端处理策略（与文档 1.6 错误码表一一对应） */
export class ApiError extends Error {
  code: ErrorCode
  status: number
  requestId: string
  details: Record<string, unknown> | null

  constructor(params: {
    code: ErrorCode
    message: string
    status: number
    requestId?: string
    details?: Record<string, unknown> | null
  }) {
    super(params.message)
    this.name = 'ApiError'
    this.code = params.code
    this.status = params.status
    this.requestId = params.requestId ?? 'req_local'
    this.details = params.details ?? null
  }

  /** 401：先刷新，失败跳登录 */
  get isAuthError() {
    return this.status === 401 || this.code === 'UNAUTHORIZED'
  }
}

export const ERROR_HINT: Record<ErrorCode, string> = {
  VALIDATION_ERROR: '请检查填写的内容',
  UNAUTHORIZED: '登录已过期，请重新登录',
  FORBIDDEN: '当前角色没有该操作权限',
  NOT_FOUND: '资源不存在或已被删除',
  STATE_CONFLICT: '任务正在处理中，请勿重复提交',
  SUMMARY_SCHEMA_INVALID: 'AI 返回结构不合法，可基于转写稿重试',
  RATE_LIMITED: '请求过于频繁，请稍后重试',
  INTERNAL_ERROR: '服务异常，请稍后重试',
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** multipart 时直接传 FormData */
  formData?: FormData
  auth?: boolean
  query?: Record<string, string | number | boolean | null | undefined>
}

let refreshPromise: Promise<boolean> | null = null

/** 刷新 token；并发请求只发一次 */
async function refreshToken(): Promise<boolean> {
  const rt = session.getRefreshToken()
  if (!rt) return false
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      })
      if (!res.ok) return false
      const json = (await res.json()) as ApiSuccess<{ access_token: string; refresh_token: string }>
      session.save(json.data)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, formData, auth = true, query, headers, ...rest } = options

  const finalHeaders = new Headers(headers)
  if (!formData && body !== undefined) finalHeaders.set('Content-Type', 'application/json')
  if (auth) {
    const token = session.getAccessToken()
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`)
  }

  const doFetch = () =>
    fetch(buildUrl(path, query), {
      ...rest,
      headers: finalHeaders,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })

  let res = await doFetch()

  // 401 → 刷新一次 → 重放原请求
  if (res.status === 401 && auth) {
    const refreshed = await refreshToken()
    if (refreshed) {
      const token = session.getAccessToken()
      if (token) finalHeaders.set('Authorization', `Bearer ${token}`)
      res = await doFetch()
    }
  }

  if (res.status === 204) return undefined as T

  let payload: unknown = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const errBody = payload as ApiErrorBody | null
    const error = new ApiError({
      code: errBody?.error?.code ?? 'INTERNAL_ERROR',
      message: errBody?.error?.message ?? `请求失败（HTTP ${res.status}）`,
      status: res.status,
      requestId: errBody?.request_id,
      details: errBody?.error?.details ?? null,
    })

    if (error.isAuthError) {
      session.clear()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        const next = encodeURIComponent(window.location.pathname + window.location.search)
        window.location.href = `/login?next=${next}`
      }
    }
    throw error
  }

  const success = payload as ApiSuccess<T>
  if (success && typeof success === 'object' && 'data' in success) return success.data
  return payload as T
}

/**
 * 带上传进度的请求（fetch 不支持进度，必须用 XHR —— 见开发规范「前端约定」）。
 */
export function upload<T>(
  path: string,
  formData: FormData,
  opts: {
    onProgress?: (percent: number) => void
    signal?: AbortSignal
    idempotencyKey?: string
    method?: 'POST' | 'PATCH' | 'PUT'
  } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(opts.method ?? 'POST', `${API_BASE}${path}`)
    const token = session.getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (opts.idempotencyKey) xhr.setRequestHeader('Idempotency-Key', opts.idempotencyKey)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      let payload: unknown = null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        payload = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const success = payload as ApiSuccess<T>
        resolve(success && 'data' in success ? success.data : (payload as T))
        return
      }
      const errBody = payload as ApiErrorBody | null
      reject(
        new ApiError({
          code: errBody?.error?.code ?? 'INTERNAL_ERROR',
          message: errBody?.error?.message ?? `上传失败（HTTP ${xhr.status}）`,
          status: xhr.status,
          requestId: errBody?.request_id,
          details: errBody?.error?.details ?? null,
        }),
      )
    }

    xhr.onerror = () =>
      reject(new ApiError({ code: 'INTERNAL_ERROR', message: '网络异常，上传中断', status: 0 }))
    xhr.ontimeout = () =>
      reject(new ApiError({ code: 'RATE_LIMITED', message: '上传超时，请重试', status: 0 }))
    xhr.onabort = () =>
      reject(new ApiError({ code: 'VALIDATION_ERROR', message: '已取消上传', status: 0 }))

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort()
        return
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(formData)
  })
}
