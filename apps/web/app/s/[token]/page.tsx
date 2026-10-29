'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, AudioLines, CalendarClock, FileText, Languages, Timer } from 'lucide-react'
import { usePublicShare } from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import type { ActionItem, PublicShare, SummaryContent } from '@/lib/api/types'
import { ACTION_STATUSES } from '@/lib/api/types'
import {
  ACTION_STATUS_META,
  PRIORITY_META,
  formatDate,
  formatDuration,
  formatMeetingTime,
  formatMs,
} from '@/lib/format'
import { Badge, Button, EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/ui/primitives'

const LANGUAGE_LABEL: Record<string, string> = {
  zh: '中文',
  en: '英语',
  ja: '日语',
}

const STATUS_TONE: Record<ActionItem['status'], 'neutral' | 'info' | 'success'> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>()
  const { data, isPending, isError, error, refetch } = usePublicShare(String(token))

  return (
    <div className="flex min-h-dvh flex-col">
      {/* 只读分享导航条 */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[900px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <AudioLines className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">会记 Minutes</span>
          </Link>
          <Badge tone="neutral">只读分享</Badge>
          <div className="ml-auto flex items-center gap-3">
            {data?.expires_at && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                有效期至 {formatDate(data.expires_at)}
              </span>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/login">了解更多 / 登录</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {isPending ? (
          <LoadingState label="正在加载分享内容…" />
        ) : isError ? (
          <ShareError error={error} onRetry={() => refetch()} />
        ) : data ? (
          <ShareBody share={data} />
        ) : null}
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        由 会记 Minutes 生成 · 只读视图
      </footer>
    </div>
  )
}

function ShareError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : 0

  if (status === 404) {
    return (
      <EmptyState
        icon={<FileText className="size-5" />}
        title="分享链接不存在或已被删除"
        description="请与分享者确认链接是否正确。"
      />
    )
  }

  if (status === 410) {
    return (
      <EmptyState
        icon={<FileText className="size-5" />}
        title="分享链接已过期或已被撤销"
        description="该链接已失效，请联系分享者重新生成。"
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft className="size-3.5" />
              返回首页
            </Link>
          </Button>
        }
      />
    )
  }

  return (
    <ErrorState
      title="分享内容加载失败"
      message={(error as Error)?.message}
      requestId={error instanceof ApiError ? error.requestId : undefined}
      onRetry={onRetry}
    />
  )
}

function ShareBody({ share }: { share: PublicShare }) {
  const { meeting, summary, action_items, transcript, workspace_name } = share

  return (
    <div className="space-y-6">
      {/* 会议头部 */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{workspace_name}</p>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">
          {meeting.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            {formatMeetingTime(meeting.started_at)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Timer className="size-3.5" />
            {formatDuration(meeting.duration_sec)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Languages className="size-3.5" />
            {LANGUAGE_LABEL[meeting.language] ?? meeting.language}
          </span>
          <StatusBadge status={meeting.status} />
        </div>
      </div>

      <Section title="会议摘要">
        {summary ? (
          <SummaryBlock content={summary.content} />
        ) : (
          <p className="text-sm text-muted-foreground">该会议暂无摘要。</p>
        )}
      </Section>

      <Section title="待办事项">
        {action_items.length === 0 ? (
          <p className="text-sm text-muted-foreground">本次会议没有提取到待办。</p>
        ) : (
          <ActionItemList items={action_items} />
        )}
      </Section>

      <Section title="转写稿">
        {transcript.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-surface/40 px-4 py-6 text-center text-sm text-muted-foreground">
            该分享未包含转写稿
          </div>
        ) : (
          <ol className="space-y-4">
            {transcript.map((seg) => (
              <li key={seg.id} className="flex gap-3">
                <span className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatMs(seg.start_ms)}
                </span>
                <div className="min-w-0 flex-1">
                  {seg.speaker && <p className="text-xs font-medium text-primary">{seg.speaker}</p>}
                  <p className="text-sm leading-relaxed text-foreground/90">{seg.content}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="mb-4 text-base font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function SummaryBlock({ content }: { content: SummaryContent }) {
  return (
    <div className="space-y-5">
      {content.topics.length > 0 && (
        <div>
          <SectionLabel>主题</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {content.topics.map((topic) => (
              <Badge key={topic} tone="primary">
                {topic}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <BulletList title="关键结论" items={content.key_points} />
      <BulletList title="决策" items={content.decisions} />
      <BulletList title="风险" items={content.risks} />
      {content.action_items.length > 0 && (
        <div>
          <SectionLabel>待办概览</SectionLabel>
          <ul className="space-y-2">
            {content.action_items.map((item, index) => (
              <li
                key={`${item.title}-${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">{item.title}</span>
                {item.owner && <span className="text-xs text-muted-foreground">{item.owner}</span>}
                {item.due_date && (
                  <span className="text-xs text-muted-foreground">截止 {formatDate(item.due_date)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2 text-sm leading-relaxed">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  )
}

function ActionItemList({ items }: { items: ActionItem[] }) {
  return (
    <div className="space-y-5">
      {ACTION_STATUSES.map((status) => {
        const group = items.filter((item) => item.status === status)
        if (group.length === 0) return null
        return (
          <div key={status}>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={STATUS_TONE[status]}>{ACTION_STATUS_META[status].label}</Badge>
              <span className="text-xs text-muted-foreground">{group.length} 项</span>
            </div>
            <ul className="space-y-2">
              {group.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">{item.title}</span>
                  {item.owner_name && (
                    <span className="text-xs text-muted-foreground">{item.owner_name}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    优先级 {PRIORITY_META[item.priority].label}
                  </span>
                  {item.due_date && (
                    <span className="text-xs text-muted-foreground">
                      截止 {formatDate(item.due_date)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
