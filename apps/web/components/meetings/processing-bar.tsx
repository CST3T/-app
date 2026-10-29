'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  Radio,
  RefreshCw,
  Wifi,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { MEETING_STATUS_META } from '@/lib/format'
import { ApiError, ERROR_HINT } from '@/lib/api/client'
import { useProcessMeeting } from '@/lib/api/hooks'
import { Badge, Button, ProgressBar } from '@/components/ui/primitives'
import { Tooltip } from '@/components/ui/overlay'
import type { Meeting, MeetingDetail } from '@/lib/api/types'
import type { MeetingStreamState } from '@/lib/hooks/use-meeting-events'

/**
 * FE-06 顶部状态条：
 * 上传进度与 AI 处理进度分开呈现；处理进度由 SSE 驱动，
 * 断线时显示降级提示并自动退避重连，失败给出明确重试入口。
 */
export function ProcessingBar({
  meeting,
  stream,
  canProcess,
  onRefetch,
}: {
  meeting: Meeting
  stream: MeetingStreamState
  canProcess: boolean
  onRefetch: () => void
}) {
  const retry = useProcessMeeting(meeting.id)

  // SSE 推送的状态优先于接口快照，避免刚打开页面时进度回退
  const status = stream.status ?? meeting.status
  const progress =
    stream.status === null ? meeting.progress : Math.max(meeting.progress, stream.progress)
  const isLive = status === 'transcribing' || status === 'summarizing'
  const meta = MEETING_STATUS_META[status]
  const failure = stream.error ?? meeting.error ?? null

  // SSE done → 拉一次聚合详情拿摘要与待办
  React.useEffect(() => {
    if (stream.doneAt) onRefetch()
  }, [stream.doneAt, onRefetch])

  const handleRetry = (fromStage?: 'transcribing' | 'summarizing') => {
    retry.mutate(
      { from_stage: fromStage },
      {
        onSuccess: () => {
          toast.success(fromStage === 'summarizing' ? '已从摘要阶段重试' : '已重新开始处理')
          onRefetch()
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'STATE_CONFLICT') {
            toast.warning('该会议正在处理中，请等待当前任务结束')
          } else {
            toast.error(err.message)
          }
        },
      },
    )
  }

  if (status === 'done' && !failure) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-status-done/25 bg-status-done/8 px-3.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-2 text-[13px] text-status-done">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="whitespace-nowrap font-medium">处理已完成</span>
          <span className="truncate text-muted-foreground">转写与摘要均已生成</span>
        </div>
        {canProcess && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() => handleRetry('summarizing')}
            loading={retry.isPending}
            title="重新生成摘要会创建新版本，不覆盖历史"
          >
            <RefreshCw className="size-3.5" />
            重新生成摘要
          </Button>
        )}
      </div>
    )
  }

  if (status === 'failed' || failure) {
    return (
      <div className="rounded-lg border border-status-failed/30 bg-status-failed/8 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-failed" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-status-failed">
                {failure?.stage === 'summarizing' ? '摘要生成失败' : '转写失败'}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {failure?.message ?? meta.hint}
                <span className="ml-1 text-muted-foreground/70">
                  {failure?.stage === 'summarizing'
                    ? '（转写结果已保留，重试不会重复转写）'
                    : '（已完成分段不会重做）'}
                </span>
              </p>
            </div>
          </div>
          {canProcess && failure?.retryable !== false && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                handleRetry(
                  failure?.stage === 'transcribing' || failure?.stage === 'summarizing'
                    ? failure.stage
                    : undefined,
                )
              }
              loading={retry.isPending}
            >
              <RefreshCw className="size-3.5" />
              重试
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/60 bg-surface/60 px-3.5 py-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isLive ? (
            <Loader2 className="size-3.5 animate-spin text-status-transcribing" />
          ) : (
            <Radio className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-[13px] font-medium">{meta.label}</span>
          <span className="hidden text-[12px] text-muted-foreground sm:inline">{meta.hint}</span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionIndicator connected={stream.connected} reconnecting={stream.reconnecting} />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
        </div>
      </div>
      <ProgressBar value={progress} />
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
        <Stage label="转写" done={progress >= 70} active={status === 'transcribing'} />
        <span className="h-px flex-1 bg-border/70" />
        <Stage label="摘要" done={progress >= 100} active={status === 'summarizing'} />
      </div>
    </div>
  )
}

function Stage({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1',
        done && 'text-status-done',
        active && 'text-status-transcribing',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          done ? 'bg-status-done' : active ? 'animate-pulse bg-status-transcribing' : 'bg-border',
        )}
      />
      {label}
    </span>
  )
}

function ConnectionIndicator({ connected, reconnecting }: { connected: boolean; reconnecting: boolean }) {
  if (connected) {
    return (
      <Tooltip content="SSE 已连接，进度实时推送">
        <Badge tone="success" className="gap-1">
          <Wifi className="size-2.5" />
          实时
        </Badge>
      </Tooltip>
    )
  }
  if (reconnecting) {
    return (
      <Tooltip content="连接中断，正在指数退避重连；重连后自动恢复到最新进度">
        <Badge tone="info" className="gap-1">
          <Loader2 className="size-2.5 animate-spin" />
          重连中
        </Badge>
      </Tooltip>
    )
  }
  return (
    <Tooltip content="未建立实时连接">
      <Badge tone="neutral" className="gap-1">
        <CloudOff className="size-2.5" />
        离线
      </Badge>
    </Tooltip>
  )
}

/** 供详情页复用的派生状态：是否处于处理中（决定是否订阅 SSE） */
export function isProcessingStatus(status: Meeting['status'] | null) {
  return status === 'uploaded' || status === 'transcribing' || status === 'summarizing'
}

export type { MeetingDetail }
