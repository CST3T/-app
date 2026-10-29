'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Check,
  Gavel,
  Hash,
  History,
  Lightbulb,
  ListTodo,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/overlay'
import { useRegenerateSummary, useSummary } from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import type { MeetingStatus } from '@/lib/api/types'
import { MEETING_STATUS_META, formatDate } from '@/lib/format'

export function SummaryPanel({
  meetingId,
  canEdit,
  status,
}: {
  meetingId: string
  canEdit: boolean
  status: MeetingStatus
}): React.JSX.Element {
  // 转写阶段还没有摘要，先不发请求，避免必然的 404
  const pending = status === 'uploaded' || status === 'transcribing'
  const { data, isLoading, isError, error, refetch } = useSummary(meetingId, !pending)
  const regenerate = useRegenerateSummary(meetingId)

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const runRegenerate = (closeDialog = false) => {
    regenerate.mutate(undefined, {
      onSuccess: () => {
        toast.success('已开始重新生成摘要')
        setSelectedId(null)
        if (closeDialog) setConfirmOpen(false)
      },
      onError: (err) => toast.error(err.message || '重新生成失败，请重试'),
    })
  }

  if (pending) {
    const meta = MEETING_STATUS_META[status]
    return (
      <EmptyState
        icon={<Sparkles className="size-5" />}
        title="摘要将在转写完成后自动生成"
        description={`当前阶段：${meta.label} · ${meta.hint}`}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    )
  }

  const notFound = error instanceof ApiError && error.status === 404

  if (isError && !notFound) {
    return (
      <ErrorState
        title="摘要加载失败"
        message={(error as Error | null)?.message}
        onRetry={() => void refetch()}
      />
    )
  }

  if (notFound || !data) {
    return (
      <EmptyState
        icon={<Sparkles className="size-5" />}
        title="还没有摘要"
        description={
          canEdit ? '可基于现有转写稿生成一版结构化摘要。' : '摘要尚未生成，请联系管理员重新生成。'
        }
        action={
          canEdit ? (
            <Button size="sm" loading={regenerate.isPending} onClick={() => runRegenerate()}>
              <RefreshCw className="size-3.5" />
              重新生成摘要
            </Button>
          ) : undefined
        }
      />
    )
  }

  const { latest, history } = data
  const summary = history.find((s) => s.id === selectedId) ?? latest
  const viewingHistory = summary.id !== latest.id

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">会议摘要</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{summary.model}</span>
            <span aria-hidden>·</span>
            <Badge tone="primary">v{summary.version}</Badge>
            <span>生成于 {formatDate(summary.created_at, 'yyyy-MM-dd HH:mm')}</span>
            {summary.status !== 'ok' && (
              <Badge tone="danger">
                {summary.status === 'schema_invalid' ? '结构不合法' : '降级结果'}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              loading={regenerate.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <RefreshCw className="size-3.5" />
              重新生成
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <History className="size-3.5" />
                版本历史
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>历史版本</DropdownMenuLabel>
              {history.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={() => setSelectedId(entry.id)}>
                  <span className="flex-1">v{entry.version}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(entry.created_at, 'MM-dd HH:mm')}
                  </span>
                  {entry.id === summary.id && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {viewingHistory && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs animate-fade-up">
          <span className="text-foreground">正在查看历史版本 v{summary.version}</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSelectedId(null)}>
            返回最新
          </Button>
        </div>
      )}

      {/* 右侧栏宽度有限，摘要块统一单列纵向堆叠，保证可读行宽 */}
      <div className="flex flex-col gap-3">
        <SummarySection
          icon={<Hash className="size-3.5" />}
          title="主题"
          empty="本次会议未提取到主题"
          isEmpty={summary.content.topics.length === 0}
        >
          <div className="flex flex-wrap gap-1.5">
            {summary.content.topics.map((topic, i) => (
              <Badge key={`${topic}-${i}`} tone="info">
                {topic}
              </Badge>
            ))}
          </div>
        </SummarySection>

        <SummarySection
          icon={<Lightbulb className="size-3.5" />}
          title="关键结论"
          empty="本次会议未提取到关键结论"
          isEmpty={summary.content.key_points.length === 0}
        >
          <BulletList items={summary.content.key_points} />
        </SummarySection>

        <SummarySection
          icon={<Gavel className="size-3.5" />}
          title="已定决策"
          empty="本次会议没有形成决策"
          isEmpty={summary.content.decisions.length === 0}
        >
          <BulletList items={summary.content.decisions} />
        </SummarySection>

        <SummarySection
          icon={<AlertTriangle className="size-3.5" />}
          title="风险"
          empty="未识别到风险"
          isEmpty={summary.content.risks.length === 0}
        >
          <BulletList items={summary.content.risks} tone="danger" />
        </SummarySection>

        <SummarySection
          icon={<ListTodo className="size-3.5" />}
          title="待办概览"
          empty="未提取到待办"
          isEmpty={summary.content.action_items.length === 0}
        >
          <ul className="space-y-1.5">
            {summary.content.action_items.map((item, i) => (
              <li
                key={`${item.title}-${i}`}
                className="flex items-start justify-between gap-3 rounded-lg bg-surface/60 px-2.5 py-2"
              >
                <span className="min-w-0 break-words text-sm leading-snug">{item.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {[item.owner, item.due_date ? formatDate(item.due_date) : null]
                    .filter(Boolean)
                    .join(' · ') || '未指派'}
                </span>
              </li>
            ))}
          </ul>
        </SummarySection>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="重新生成摘要"
          description="将基于现有转写稿重新生成一版摘要，当前版本会保留在版本历史中。"
          className="max-w-sm"
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button loading={regenerate.isPending} onClick={() => runRegenerate(true)}>
              确认重新生成
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ----------------------------- 区块 ----------------------------- */

function SummarySection({
  icon,
  title,
  children,
  empty,
  isEmpty,
  className,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  empty: string
  isEmpty: boolean
  className?: string
}) {
  return (
    <Card className={cn('space-y-3', className)}>
      <CardHeader className="mb-0 items-center">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
      </CardHeader>
      {isEmpty ? <p className="text-xs text-muted-foreground">{empty}</p> : children}
    </Card>
  )
}

function BulletList({ items, tone }: { items: string[]; tone?: 'danger' }) {
  return (
    <ul className="space-y-1.5">
      {items.map((line, i) => (
        <li key={`${line}-${i}`} className="flex gap-2 text-sm leading-relaxed">
          <span
            className={cn(
              'mt-1.5 size-1 shrink-0 rounded-full bg-primary/70',
              tone === 'danger' && 'bg-status-failed',
            )}
          />
          <span className="min-w-0 break-words text-foreground/90">{line}</span>
        </li>
      ))}
    </ul>
  )
}
