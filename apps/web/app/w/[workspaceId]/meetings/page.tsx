'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  Clock,
  Copy,
  HardDrive,
  Inbox,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDeleteMeeting, useMe, useMeeting, useMeetings, useProcessMeeting } from '@/lib/api/hooks'
import { ApiError, ERROR_HINT } from '@/lib/api/client'
import {
  MEETING_STATUSES,
  type Meeting,
  type MeetingStatus,
  type Role,
} from '@/lib/api/types'
import { MEETING_STATUS_META, formatBytes, formatDuration, formatMeetingTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  ProgressBar,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/overlay'

/** 与权限矩阵保持一致：访客只读，任何写入口都不出现 */
const WRITE_ROLES: Role[] = ['owner', 'admin', 'member']

const STATUS_FILTERS: Array<{ value: MeetingStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  ...MEETING_STATUSES.map((status) => ({
    value: status,
    label: MEETING_STATUS_META[status].label,
  })),
]

export default function MeetingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<MeetingStatus | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [q, setQ] = useState('')

  // 输入 300ms 后才写入查询参数，避免每次按键都打接口
  useEffect(() => {
    const timer = setTimeout(() => setQ(keyword.trim()), 300)
    return () => clearTimeout(timer)
  }, [keyword])

  const { data: me } = useMe()
  const role = me?.workspaces.find((w) => w.id === workspaceId)?.role
  const canCreate = Boolean(role && WRITE_ROLES.includes(role))
  const canDelete = role === 'owner' || role === 'admin'

  const { data, isLoading, isError, error, refetch } = useMeetings(workspaceId, {
    status,
    q,
    limit: 50,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const isFiltered = status !== 'all' || q.length > 0
  const processing = items.some((m) => m.status === 'transcribing' || m.status === 'summarizing')

  // 有会议在后台处理时轻量刷新列表，让卡片进度前进；全部结束后自动停止
  useEffect(() => {
    if (!processing) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['meetings', workspaceId] })
    }, 5000)
    return () => clearInterval(timer)
  }, [processing, queryClient, workspaceId])

  const resetFilters = () => {
    setStatus('all')
    setKeyword('')
    setQ('')
  }

  const subtitle = isLoading
    ? '正在加载会议…'
    : isError
      ? '会议列表加载失败'
      : isFiltered
        ? `筛选出 ${total} 场会议`
        : `共 ${total} 场会议`

  const apiError = error instanceof ApiError ? error : null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <header className="relative flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">会议</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
            {subtitle}
          </p>
        </div>
        {canCreate && (
          <Button asChild className="h-10" data-sound="primary">
            <Link href={`/w/${workspaceId}/meetings/new`}>
              <Plus className="size-4" />
              创建会议
            </Link>
          </Button>
        )}
        <span className="hairline-glow pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-50" />
      </header>

      {/* 筛选：状态 chip 横向滚动 + 关键词搜索 */}
      <div className="mt-5 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="group"
          aria-label="按状态筛选"
          className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0"
        >
          {STATUS_FILTERS.map((filter) => {
            const active = status === filter.value
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(filter.value)}
                className={cn(
                  'inline-flex h-10 shrink-0 items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  active
                    ? 'border-primary/40 bg-primary/12 font-medium text-primary shadow-[0_0_20px_-10px_hsl(var(--glow)/0.9)]'
                    : 'border-border/70 bg-surface/40 text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {filter.label}
              </button>
            )
          })}
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索会议标题…"
            aria-label="搜索会议标题"
            className="h-10 pl-9 pr-9"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              aria-label="清除关键词"
              className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <MeetingGridSkeleton />
        ) : isError ? (
          <ErrorState
            title="会议列表加载失败"
            message={error instanceof Error ? error.message : undefined}
            requestId={apiError?.requestId}
            onRetry={() => void refetch()}
          />
        ) : items.length === 0 ? (
          isFiltered ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title="没有匹配的会议"
              description="换个关键词，或把状态筛选切回「全部」再试试。"
              action={
                <Button variant="outline" onClick={resetFilters}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Inbox className="size-5" />}
              title="还没有会议"
              description="创建第一场会议，上传录音后会自动转写并生成结构化摘要。"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href={`/w/${workspaceId}/meetings/new`}>
                      <Plus className="size-4" />
                      创建会议
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {items.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                workspaceId={workspaceId}
                canProcess={canCreate}
                canDelete={canDelete && (meeting.permissions?.can_delete ?? true)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 会议卡片                                                            */
/* ------------------------------------------------------------------ */

function MeetingCard({
  meeting,
  workspaceId,
  canProcess,
  canDelete,
}: {
  meeting: Meeting
  workspaceId: string
  canProcess: boolean
  canDelete: boolean
}) {
  const meta = MEETING_STATUS_META[meeting.status]
  const isProcessing = meeting.status === 'transcribing' || meeting.status === 'summarizing'
  const isFailed = meeting.status === 'failed'
  const failedStage = meeting.error?.stage ?? null
  // 接口下发的 permissions 优先于角色推导，避免越权入口
  const allowRetry = canProcess && (meeting.permissions?.can_process ?? true)

  const retry = useProcessMeeting(meeting.id)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const onRetry = async () => {
    try {
      await retry.mutateAsync(failedStage ? { from_stage: failedStage } : {})
      toast.success('已重新加入处理队列')
    } catch (err) {
      toast.error(
        err instanceof ApiError ? ERROR_HINT[err.code] ?? err.message : '重试失败，请稍后再试',
      )
    }
  }

  const copyLink = () => {
    void navigator.clipboard.writeText(`${window.location.origin}/w/${workspaceId}/meetings/${meeting.id}`)
    toast.success('会议链接已复制')
  }

  return (
    <article className="panel panel-hover group relative flex flex-col gap-3 p-4 animate-fade-up sm:p-5">
      <div className="flex items-start justify-between gap-3">
        {/* 链接用 after 覆盖整卡，其余按钮统一抬到 z-10，避免按钮嵌套在链接里 */}
        <Link
          href={`/w/${workspaceId}/meetings/${meeting.id}`}
          className="min-w-0 rounded-md after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="line-clamp-2 text-sm font-medium leading-6 transition-colors group-hover:text-primary">
            {meeting.title}
          </span>
        </Link>
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <StatusBadge status={meeting.status} />
          {canDelete && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`复制会议链接：${meeting.title}`}
                title="复制会议链接"
                className="text-muted-foreground"
                onClick={copyLink}
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`删除会议：${meeting.title}`}
                className="gap-1 text-status-failed hover:bg-status-failed/10"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                删除
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3.5" />
          {formatMeetingTime(meeting.started_at)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" />
          {formatDuration(meeting.duration_sec)}
        </span>
        <span className="inline-flex items-center gap-1">
          <HardDrive className="size-3.5" />
          {formatBytes(meeting.audio_bytes)}
        </span>
      </div>

      {meeting.status === 'done' && <MeetingCounts meetingId={meeting.id} />}

      {isProcessing && (
        <div className="space-y-1.5">
          <ProgressBar value={meeting.progress} />
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{meta.hint}</span>
            <span className="shrink-0 tabular-nums">{meeting.progress}%</span>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="rounded-lg border border-status-failed/25 bg-status-failed/5 p-2.5">
          <p className="line-clamp-2 text-xs text-foreground/80">
            {meeting.error?.message ?? meta.hint}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">
              {failedStage
                ? `失败阶段：${MEETING_STATUS_META[failedStage].label}`
                : meta.hint}
            </span>
            {allowRetry && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={retry.isPending}
                onClick={() => void onRetry()}
                className="relative z-10 shrink-0"
              >
                <RefreshCw className="size-3.5" />
                重试
              </Button>
            )}
          </div>
        </div>
      )}

      {canDelete && (
        <DeleteMeetingDialog
          workspaceId={workspaceId}
          meetingId={meeting.id}
          title={meeting.title}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </article>
  )
}

/** 删除确认弹窗：必须放在下拉菜单之外，否则菜单关闭时弹窗会被一起卸载 */
function DeleteMeetingDialog({
  workspaceId,
  meetingId,
  title,
  open,
  onOpenChange,
}: {
  workspaceId: string
  meetingId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const del = useDeleteMeeting(workspaceId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="删除这场会议？"
        description={`「${title}」将被软删除，录音走异步清理，90 天后彻底移除。`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={del.isPending}
            onClick={() =>
              del.mutate(meetingId, {
                onSuccess: () => {
                  toast.success('会议已删除')
                  onOpenChange(false)
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 列表接口不带数量，已完成的会议按需补一次详情，用于展示转写/待办条数 */
function MeetingCounts({ meetingId }: { meetingId: string }) {
  const { data } = useMeeting(meetingId)
  if (!data) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <ScrollText className="size-3.5" />
        {data.counts.segments} 段转写
      </span>
      <span className="inline-flex items-center gap-1">
        <ListChecks className="size-3.5" />
        {data.counts.action_items} 条待办
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 骨架屏                                                              */
/* ------------------------------------------------------------------ */

function MeetingGridSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="panel flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-14" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  )
}
