'use client'

import * as React from 'react'
import { MessageSquare, Search, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMs } from '@/lib/format'
import { EmptyState, ErrorState, Input, Skeleton } from '@/components/ui/primitives'
import { Avatar } from '@/components/ui/avatar'
import { useTranscript } from '@/lib/api/hooks'
import type { MeetingStatus, TranscriptSegment } from '@/lib/api/types'

/**
 * FE-04 转写面板：时间戳分段 + 点击跳转 + 播放高亮。
 *
 * - 点击某段 → onSeek(start_ms)，播放器 seek 到对应位置
 * - 播放中自动高亮当前段（由 activeMs 驱动），并可选自动滚动到可视区
 * - speaker 为空时展示「未标注」，并允许手动标注（对应 MVP 降级方案）
 */
export function TranscriptPanel({
  meetingId,
  status,
  activeMs,
  onSeek,
  className,
  canEditSpeaker = false,
}: {
  meetingId: string
  status: MeetingStatus
  activeMs?: number
  onSeek?: (ms: number) => void
  className?: string
  canEditSpeaker?: boolean
}) {
  const { data, isLoading, isError, error, refetch } = useTranscript(meetingId, status === 'done' || status === 'summarizing')
  const [query, setQuery] = React.useState('')
  const [speakerOverrides, setSpeakerOverrides] = React.useState<Record<string, string>>({})
  const [autoScroll, setAutoScroll] = React.useState(true)
  const listRef = React.useRef<HTMLDivElement | null>(null)

  const segments = data ?? []

  const filtered = React.useMemo(() => {
    if (!query.trim()) return segments
    const q = query.trim().toLowerCase()
    return segments.filter((s) => s.content.toLowerCase().includes(q))
  }, [segments, query])

  const activeSeq = React.useMemo(() => {
    if (activeMs === undefined) return null
    const hit = segments.find((s) => activeMs >= s.start_ms && activeMs < s.end_ms)
    return hit?.seq ?? null
  }, [activeMs, segments])

  /* 播放时把当前段滚到可视区中部 */
  React.useEffect(() => {
    if (!autoScroll || activeSeq === null) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seq="${activeSeq}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeSeq, autoScroll])

  if (isLoading) {
    return (
      <div className={cn('space-y-3 p-4', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className={cn('h-4', i % 3 === 0 ? 'w-11/12' : i % 3 === 1 ? 'w-4/5' : 'w-full')} />
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className={cn('p-4', className)}>
        <ErrorState
          title="转写稿加载失败"
          message={(error as Error)?.message}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  if (segments.length === 0) {
    const waiting = status === 'uploaded' || status === 'transcribing'
    return (
      <div className={cn('p-4', className)}>
        <EmptyState
          icon={<MessageSquare className="size-5" />}
          title={waiting ? '转写尚未开始' : '没有转写内容'}
          description={
            waiting
              ? '处理完成后转写分段会出现在这里，点击任意分段即可跳转到录音对应位置。'
              : status === 'failed'
                ? '本次处理失败，转写稿未生成。可从断点重试。'
                : '该会议没有可用的转写稿。'
          }
        />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="在转写中查找…"
            className="h-8 border-0 bg-surface pl-8 text-xs focus-visible:ring-0"
          />
        </div>
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          className={cn(
            'shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors',
            autoScroll ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-surface-hover',
          )}
        >
          跟随播放
        </button>
      </div>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            没有匹配「{query}」的分段
          </p>
        )}
        {filtered.map((segment) => (
          <SegmentRow
            key={segment.id}
            segment={segment}
            active={segment.seq === activeSeq}
            query={query}
            canEditSpeaker={canEditSpeaker}
            speaker={speakerOverrides[segment.id] ?? segment.speaker}
            onSpeakerChange={(value) =>
              setSpeakerOverrides((prev) => ({ ...prev, [segment.id]: value }))
            }
            onSeek={onSeek}
          />
        ))}
      </div>
    </div>
  )
}

function SegmentRow({
  segment,
  active,
  query,
  speaker,
  canEditSpeaker,
  onSpeakerChange,
  onSeek,
}: {
  segment: TranscriptSegment
  active: boolean
  query: string
  speaker: string | null
  canEditSpeaker: boolean
  onSpeakerChange: (value: string) => void
  onSeek?: (ms: number) => void
}) {
  return (
    <div
      data-seq={segment.seq}
      className={cn(
        'group relative rounded-lg px-2.5 py-2 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-surface-hover/70',
      )}
    >
      <button
        type="button"
        onClick={() => onSeek?.(segment.start_ms)}
        className="absolute right-2 top-2 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/70 opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground group-hover:opacity-100"
        title="跳转到此处"
      >
        {formatMs(segment.start_ms)}
      </button>

      <div className="mb-1 flex items-center gap-1.5 pr-12">
        {speaker ? (
          <>
            <Avatar name={speaker} className="size-4 text-[9px]" />
            <span className="text-[11px] font-medium text-muted-foreground">{speaker}</span>
          </>
        ) : (
          <button
            type="button"
            disabled={!canEditSpeaker}
            onClick={() => {
              if (!canEditSpeaker) return
              const value = window.prompt('标注发言人姓名（MVP 阶段做人工标注）')
              if (value?.trim()) onSpeakerChange(value.trim())
            }}
            className={cn(
              'flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground/80',
              canEditSpeaker && 'hover:bg-surface-hover hover:text-foreground',
            )}
            title={canEditSpeaker ? '点击手动标注发言人' : '该会议未开启说话人分离'}
          >
            <UserRound className="size-3" />
            未标注
          </button>
        )}
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
          {formatMs(segment.start_ms)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSeek?.(segment.start_ms)}
        className="block w-full text-left text-[13px] leading-relaxed text-foreground/90"
      >
        <Highlight text={segment.content} query={query} />
      </button>
    </div>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const q = query.trim()
  const lower = text.toLowerCase()
  const index = lower.indexOf(q.toLowerCase())
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {text.slice(index, index + q.length)}
      </mark>
      {text.slice(index + q.length)}
    </>
  )
}
