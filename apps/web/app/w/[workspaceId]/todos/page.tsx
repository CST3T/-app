'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlarmClock,
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Inbox,
  ListTodo,
  RefreshCw,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useRemindTodo,
  useUpdateWorkspaceTodo,
  useWorkspaceTodos,
} from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import type { WorkspaceTodo } from '@/lib/api/types'
import { ACTION_STATUS_META, PRIORITY_META, formatDate, formatMeetingTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives'

type Scope = 'all' | 'open' | 'overdue' | 'done'

const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '待处理' },
  { value: 'overdue', label: '已逾期' },
  { value: 'done', label: '已完成' },
]

const PRIORITY_TONE = {
  high: 'danger',
  medium: 'info',
  low: 'neutral',
} as const

/** 待办处理 / 待办提醒：按人汇总跨会议事项，逾期可发送提醒 */
export default function TodosPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [scope, setScope] = useState<Scope>('all')
  const [remindingAll, setRemindingAll] = useState(false)

  const { data, isLoading, isError, error, refetch, isFetching } =
    useWorkspaceTodos(workspaceId)
  const remindTodo = useRemindTodo(workspaceId)
  const updateTodo = useUpdateWorkspaceTodo(workspaceId)

  const groups = data?.groups ?? []
  const summary = data?.summary
  const canRemind = data?.permissions.can_remind ?? false
  const canUpdate = data?.permissions.can_update ?? false

  /** 逾期且尚未提醒的条目，用于「一键提醒」 */
  const pendingReminders = useMemo(
    () =>
      groups
        .flatMap((group) => group.items)
        .filter((item) => item.is_overdue && !item.reminder_sent_at && item.owner_id),
    [groups],
  )

  const visibleGroups = useMemo(() => {
    const matches = (item: WorkspaceTodo) => {
      if (scope === 'open') return item.status !== 'done'
      if (scope === 'overdue') return item.is_overdue
      if (scope === 'done') return item.status === 'done'
      return true
    }
    return groups
      .map((group) => ({ ...group, items: group.items.filter(matches) }))
      .filter((group) => group.items.length > 0)
  }, [groups, scope])

  async function handleRemind(item: WorkspaceTodo) {
    try {
      const result = await remindTodo.mutateAsync(item.id)
      toast.success(result.message)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提醒发送失败，请稍后重试')
    }
  }

  async function handleRemindAll() {
    if (pendingReminders.length === 0) {
      toast.info('逾期待办都已提醒过了')
      return
    }
    setRemindingAll(true)
    try {
      const results = await Promise.all(pendingReminders.map((item) => remindTodo.mutateAsync(item.id)))
      const people = new Set(results.map((result) => result.owner_name)).size
      toast.success(`已向 ${people} 位成员发送 ${results.length} 条逾期提醒`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '批量提醒失败，请稍后重试')
    } finally {
      setRemindingAll(false)
    }
  }

  async function handleComplete(item: WorkspaceTodo) {
    try {
      await updateTodo.mutateAsync({ itemId: item.id, meetingId: item.meeting_id, status: 'done' })
      toast.success(`已标记完成：${item.title}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '状态更新失败，请稍后重试')
    }
  }

  const subtitle = isLoading
    ? '正在加载待办…'
    : isError
      ? '待办加载失败'
      : `${summary?.open ?? 0} 项待处理 · ${summary?.overdue ?? 0} 项已逾期`

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <header className="relative flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">待办处理</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
            {subtitle}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => void refetch()}
          loading={isFetching && !isLoading}
        >
          <RefreshCw className="size-4" />
          刷新
        </Button>
        <span className="hairline-glow pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-50" />
      </header>

      {isLoading ? (
        <TodosSkeleton />
      ) : isError ? (
        <ErrorState
          title="待办加载失败"
          message={error instanceof Error ? error.message : undefined}
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {/* 概览 */}
          <div className="mt-1 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatCard
              label="待处理"
              value={summary?.open ?? 0}
              hint="未完成的事项"
              icon={<ListTodo className="size-4" />}
              tone="primary"
            />
            <StatCard
              label="已逾期"
              value={summary?.overdue ?? 0}
              hint="超过截止时间"
              icon={<AlarmClock className="size-4" />}
              tone="danger"
            />
            <StatCard
              label="涉及成员"
              value={summary?.overdue_people ?? 0}
              hint="有逾期事项的人"
              icon={<Users className="size-4" />}
              tone="info"
            />
            <StatCard
              label="已提醒"
              value={summary?.reminded ?? 0}
              hint="已发送提醒的条目"
              icon={<BellRing className="size-4" />}
              tone="success"
            />
          </div>

          {/* 逾期提醒条 */}
          {(summary?.overdue ?? 0) > 0 && (
            <section className="panel relative mt-3 flex flex-col gap-3 overflow-hidden border-status-failed/35 bg-status-failed/5 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-status-failed/30 bg-status-failed/12 text-status-failed">
                  <AlertTriangle className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {summary?.overdue} 项待办已逾期，涉及 {summary?.overdue_people} 位成员
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    提醒会以站内消息的形式发送给对应负责人，并在会议审计日志中留痕
                  </p>
                </div>
              </div>
              {canRemind && (
                <Button
                  size="sm"
                  data-sound="primary"
                  className="w-full shrink-0 sm:w-auto"
                  loading={remindingAll}
                  disabled={pendingReminders.length === 0}
                  onClick={() => void handleRemindAll()}
                >
                  <BellRing className="size-3.5" />
                  {pendingReminders.length === 0
                    ? '逾期均已提醒'
                    : `一键提醒 ${pendingReminders.length} 项`}
                </Button>
              )}
            </section>
          )}

          {/* 范围筛选 */}
          <div
            role="group"
            aria-label="按状态筛选待办"
            className="scroll-thin mt-4 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap"
          >
            {SCOPES.map((option) => {
              const active = scope === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(option.value)}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    active
                      ? 'border-primary/40 bg-primary/12 font-medium text-primary shadow-[0_0_20px_-10px_hsl(var(--glow)/0.9)]'
                      : 'border-border/70 bg-surface/40 text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {/* 按人分组 */}
          {visibleGroups.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={<Inbox className="size-5" />}
              title={groups.length === 0 ? '还没有待办' : '当前筛选下没有待办'}
              description={
                groups.length === 0
                  ? '会议摘要生成后会自动拆出待办，也可以在看板里手动补充。'
                  : '换个范围再看看，或回到「全部」查看所有事项。'
              }
              action={
                groups.length === 0 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/w/${workspaceId}/meetings`}>去会议列表</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setScope('all')}>
                    查看全部
                  </Button>
                )
              }
            />
          ) : (
            <div className="mt-3 space-y-3">
              {visibleGroups.map((group) => {
                const openCount = group.items.filter((item) => item.status !== 'done').length
                const overdueCount = group.items.filter((item) => item.is_overdue).length
                return (
                  <section key={group.owner_id ?? 'unassigned'} className="panel overflow-hidden">
                    <div className="flex items-center gap-3 border-b border-border/60 bg-surface/30 px-4 py-3">
                      <Avatar name={group.owner_name ?? '未分配'} className="size-9" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {group.owner_name ?? '未分配负责人'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {group.items.length} 项事项 · {openCount} 项待处理
                        </p>
                      </div>
                      {overdueCount > 0 && (
                        <Badge tone="danger">
                          <AlarmClock className="size-3" />
                          逾期 {overdueCount}
                        </Badge>
                      )}
                    </div>

                    <ul className="space-y-2 p-3">
                      {group.items.map((item) => {
                        const overdue = item.is_overdue
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              'rounded-lg border p-3 transition-colors',
                              overdue
                                ? 'border-status-failed/25 bg-status-failed/[0.06]'
                                : 'border-border/50 bg-surface/40 hover:border-primary/25',
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium leading-5">{item.title}</span>
                                  <Badge tone={PRIORITY_TONE[item.priority]}>
                                    {PRIORITY_META[item.priority].label}优先级
                                  </Badge>
                                  {item.status === 'done' && (
                                    <Badge tone="success">
                                      <CheckCircle2 className="size-3" />
                                      {ACTION_STATUS_META[item.status].label}
                                    </Badge>
                                  )}
                                  {item.status === 'in_progress' && (
                                    <Badge tone="process">{ACTION_STATUS_META[item.status].label}</Badge>
                                  )}
                                </div>

                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                  <Link
                                    href={`/w/${workspaceId}/meetings/${item.meeting_id}`}
                                    className="inline-flex min-w-0 items-center gap-1 hover:text-primary"
                                  >
                                    <ListTodo className="size-3.5 shrink-0" />
                                    <span className="max-w-[16rem] truncate">{item.meeting_title}</span>
                                  </Link>
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                    <CalendarClock className="size-3.5" />
                                    会议 {formatMeetingTime(item.meeting_started_at)}
                                  </span>
                                  <span
                                    className={cn(
                                      'inline-flex items-center gap-1 whitespace-nowrap',
                                      overdue && 'font-medium text-status-failed',
                                    )}
                                  >
                                    <AlarmClock className="size-3.5" />
                                    截止{' '}
                                    {item.due_date
                                      ? formatDate(item.due_date, 'M月d日')
                                      : '未设置'}
                                    {overdue && ` · 逾期 ${item.overdue_days} 天`}
                                  </span>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-1.5">
                                {item.reminder_sent_at && (
                                  <Badge tone="info">
                                    <BellRing className="size-3" />
                                    已提醒 {formatDate(item.reminder_sent_at, 'HH:mm')}
                                  </Badge>
                                )}
                                {canRemind && overdue && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    loading={
                                      remindTodo.isPending && remindTodo.variables === item.id
                                    }
                                    onClick={() => void handleRemind(item)}
                                  >
                                    <BellRing className="size-3.5" />
                                    提醒
                                  </Button>
                                )}
                                {canUpdate && item.status !== 'done' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    loading={
                                      updateTodo.isPending &&
                                      updateTodo.variables?.itemId === item.id
                                    }
                                    onClick={() => void handleComplete(item)}
                                  >
                                    <CheckCircle2 className="size-3.5" />
                                    完成
                                  </Button>
                                )}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string
  value: number
  hint: string
  icon: React.ReactNode
  tone: 'primary' | 'danger' | 'info' | 'success'
}) {
  const toneClass = {
    primary: 'border-primary/25 bg-primary/8 text-primary',
    danger: 'border-status-failed/25 bg-status-failed/8 text-status-failed',
    info: 'border-status-transcribing/25 bg-status-transcribing/8 text-status-transcribing',
    success: 'border-status-done/25 bg-status-done/8 text-status-done',
  }[tone]

  return (
    <div className="panel flex items-center gap-3 p-3.5">
      <span
        className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border', toneClass)}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {label}
          <span className="hidden sm:inline"> · {hint}</span>
        </p>
      </div>
    </div>
  )
}

function TodosSkeleton() {
  return (
    <div className="mt-1 space-y-3" aria-hidden>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="panel flex items-center gap-3 p-3.5">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="panel p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}
