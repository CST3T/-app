'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/lib/api/client'
import { session } from '@/lib/api/session'
import type { ErrorCode, MeetingStatus } from '@/lib/api/types'

export interface MeetingStreamState {
  status: MeetingStatus | null
  progress: number
  /** SSE 连接是否存活（用于展示「实时」指示器） */
  connected: boolean
  /** 是否正在退避重连 */
  reconnecting: boolean
  error: { code: ErrorCode; message: string; stage: string | null; retryable: boolean } | null
  /** 收到 done 事件的时间戳，用于触发一次聚合详情刷新 */
  doneAt: number | null
}

const INITIAL: MeetingStreamState = {
  status: null,
  progress: 0,
  connected: false,
  reconnecting: false,
  error: null,
  doneAt: null,
}

interface Options {
  meetingId: string
  /** 仅在处理中时连接；未知状态时也可开启，服务端会先推一条 status */
  enabled: boolean
  onDone?: (meetingId: string) => void
  onFailed?: (payload: MeetingStreamState['error']) => void
}

/**
 * FE-06：基于 fetch + ReadableStream 的 SSE 客户端。
 *
 * 为什么不用原生 EventSource：
 *  1. EventSource 不能自定义 Header，契约要求 `Authorization: Bearer`；
 *  2. 需要精细控制退避策略与手动重连。
 *
 * 断线重连：指数退避 1s → 2s → 4s → … 上限 15s，重连后服务端会先推 status，
 * 因此刷新页面/断网恢复都能直接回到最新进度。
 */
export function useMeetingEvents({ meetingId, enabled, onDone, onFailed }: Options) {
  const [state, setState] = useState<MeetingStreamState>(INITIAL)

  const abortRef = useRef<AbortController | null>(null)
  const retryRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)
  const onDoneRef = useRef(onDone)
  const onFailedRef = useRef(onFailed)

  onDoneRef.current = onDone
  onFailedRef.current = onFailed

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const connect = useCallback(async () => {
    if (stoppedRef.current) return
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = session.getAccessToken()
      const res = await fetch(`${API_BASE}/meetings/${meetingId}/events`, {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        cache: 'no-store',
      })

      if (!res.ok || !res.body) throw new Error(`SSE 连接失败：HTTP ${res.status}`)

      retryRef.current = 0
      setState((prev) => ({ ...prev, connected: true, reconnecting: false }))

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE 以空行分隔事件帧
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const lines = frame.split('\n')
          let eventName = 'message'
          let dataLine = ''
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
          }
          if (!dataLine) continue

          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(dataLine)
          } catch {
            continue
          }
          handleEvent(eventName, payload)
        }
      }

      // 流自然结束：若非主动关闭，则视为断线
      if (!stoppedRef.current) throw new Error('连接已中断')
    } catch (err) {
      if (controller.signal.aborted || stoppedRef.current) return
      setState((prev) => ({ ...prev, connected: false, reconnecting: true }))
      scheduleReconnect()
    }
  }, [meetingId])

  function handleEvent(eventName: string, payload: Record<string, unknown>) {
    if (eventName === 'ping') return

    if (eventName === 'status' || eventName === 'progress') {
      setState((prev) => ({
        ...prev,
        status: (payload.status as MeetingStatus) ?? prev.status,
        progress: typeof payload.progress === 'number' ? payload.progress : prev.progress,
        error: null,
      }))
      return
    }

    if (eventName === 'error') {
      const failure = {
        code: payload.code as ErrorCode,
        message: String(payload.message ?? '处理失败'),
        stage: (payload.stage as string | null) ?? null,
        retryable: Boolean(payload.retryable ?? true),
      }
      setState((prev) => ({ ...prev, status: 'failed', error: failure, connected: true }))
      onFailedRef.current?.(failure)
      return
    }

    if (eventName === 'done') {
      setState((prev) => ({
        ...prev,
        status: 'done',
        progress: 100,
        error: null,
        doneAt: Date.now(),
      }))
      onDoneRef.current?.(String(payload.meeting_id ?? meetingId))
    }
  }

  function scheduleReconnect() {
    const attempt = retryRef.current++
    const delay = Math.min(1000 * 2 ** attempt, 15_000)
    clearTimer()
    timerRef.current = setTimeout(() => {
      void connect()
    }, delay)
  }

  const reconnectNow = useCallback(() => {
    clearTimer()
    retryRef.current = 0
    void connect()
  }, [connect])

  useEffect(() => {
    stoppedRef.current = !enabled
    if (!enabled) {
      setState(INITIAL)
      return
    }
    retryRef.current = 0
    void connect()

    return () => {
      stoppedRef.current = true
      clearTimer()
      abortRef.current?.abort()
    }
  }, [meetingId, enabled, connect])

  return { ...state, reconnectNow }
}
