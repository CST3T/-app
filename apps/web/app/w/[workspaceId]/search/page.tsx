'use client'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { FileSearch, Search as SearchIcon, X } from 'lucide-react'
import { useSearch } from '@/lib/api/hooks'
import type { SearchHit } from '@/lib/api/types'
import { formatMeetingTime } from '@/lib/format'
import { ERROR_HINT, ApiError } from '@/lib/api/client'
import { Badge, Button, EmptyState, ErrorState, Input, LoadingState, ProgressBar, Skeleton } from '@/components/ui/primitives'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay'

type SearchMode = 'keyword' | 'semantic' | 'hybrid'
type BadgeTone = 'neutral' | 'info' | 'process' | 'success' | 'danger' | 'primary'

const SOURCE_META: Record<SearchHit['source_type'], { label: string; tone: BadgeTone }> = {
  title: { label: '标题', tone: 'primary' },
  transcript: { label: '转写', tone: 'info' },
  summary: { label: '摘要', tone: 'process' },
  action_item: { label: '待办', tone: 'success' },
}

const MODES: Array<{ value: SearchMode; label: string }> = [
  { value: 'keyword', label: '关键词' },
  { value: 'semantic', label: '语义' },
  { value: 'hybrid', label: '混合' },
]

const EXAMPLES = ['上传进度', 'SSE 断线重连', '权限矩阵']

export default function SearchPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  // useSearchParams 需要 Suspense 边界，内层组件负责读取 URL
  return (
    <Suspense fallback={<LoadingState label="正在加载搜索…" />}>
      <SearchView workspaceId={String(workspaceId)} />
    </Suspense>
  )
}

function SearchView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlQuery = searchParams?.get('q') ?? ''
  const rawMode = searchParams?.get('mode')
  const mode: SearchMode = MODES.some((m) => m.value === rawMode) ? (rawMode as SearchMode) : 'hybrid'

  const [input, setInput] = useState(urlQuery)
  // 记录「由本页写入 URL」的值，避免回流时覆盖正在输入的文本
  const lastApplied = useRef(urlQuery)

  // URL 变化（点击示例 / 前进后退）时回填输入框
  useEffect(() => {
    if (urlQuery !== lastApplied.current) {
      lastApplied.current = urlQuery
      setInput(urlQuery)
    }
  }, [urlQuery])

  // 输入防抖后同步到 URL，URL 作为唯一数据源
  useEffect(() => {
    if (input.trim() === urlQuery) return
    const timer = setTimeout(() => {
      const next = input.trim()
      const sp = new URLSearchParams(searchParams?.toString() ?? '')
      if (next) sp.set('q', next)
      else sp.delete('q')
      lastApplied.current = next
      router.replace(`/w/${workspaceId}/search?${sp.toString()}`, { scroll: false })
    }, 320)
    return () => clearTimeout(timer)
  }, [input, urlQuery, searchParams, router, workspaceId])

  const { data, isPending, isFetching, isError, error, refetch } = useSearch(
    workspaceId,
    urlQuery,
    mode,
  )

  const switchMode = (next: string) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    if (next === 'hybrid') sp.delete('mode')
    else sp.set('mode', next)
    router.replace(`/w/${workspaceId}/search?${sp.toString()}`, { scroll: false })
  }

  const clearQuery = () => {
    setInput('')
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    sp.delete('q')
    lastApplied.current = ''
    router.replace(`/w/${workspaceId}/search?${sp.toString()}`, { scroll: false })
  }

  const hasQuery = urlQuery.trim().length > 0
  const hits = data?.hits ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">搜索</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          跨会议标题、转写、摘要与待办检索，按相关度排序。
        </p>
      </header>

      {/* 搜索框 */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="搜索会议内容、待办或结论…"
          aria-label="搜索"
          enterKeyHint="search"
          className="h-12 pl-10 pr-10 text-base"
        />
        {input && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="清空搜索"
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* 模式切换 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Tabs value={mode} onValueChange={switchMode}>
          <TabsList>
            {MODES.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {mode === 'semantic' && (
          <p className="text-xs text-muted-foreground">例如：上次讨论 onboarding 埋点是哪场会？</p>
        )}
      </div>

      {/* 统计信息 */}
      <div className="mt-5 flex min-h-5 items-center justify-between text-xs text-muted-foreground">
        {hasQuery && data ? (
          <>
            <span>
              共 {hits.length} 条结果 · 用时 {data.took_ms} ms
            </span>
            {isFetching && <span>更新中…</span>}
          </>
        ) : (
          <span />
        )}
      </div>

      <div className="mt-3">
        {!hasQuery ? (
          <EmptyState
            title="搜索全部会议内容"
            description="输入关键词试试，或者从下面的示例开始。"
            icon={<FileSearch className="size-5" />}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {EXAMPLES.map((example) => (
                  <Button
                    key={example}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setInput(example)
                      const sp = new URLSearchParams(searchParams?.toString() ?? '')
                      sp.set('q', example)
                      lastApplied.current = example
                      router.replace(`/w/${workspaceId}/search?${sp.toString()}`, { scroll: false })
                    }}
                  >
                    {example}
                  </Button>
                ))}
              </div>
            }
          />
        ) : isPending || (isFetching && !data) ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="panel space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-3 w-20" />
                </div>
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="搜索失败"
            message={
              error instanceof ApiError
                ? error.message || ERROR_HINT[error.code]
                : (error as Error)?.message
            }
            requestId={error instanceof ApiError ? error.requestId : undefined}
            onRetry={() => refetch()}
          />
        ) : hits.length === 0 ? (
          <EmptyState
            title="没有找到相关结果"
            description={`没有与「${urlQuery}」匹配的内容，换个关键词或切换检索模式试试。`}
            icon={<SearchIcon className="size-5" />}
            action={
              <Button variant="outline" size="sm" onClick={clearQuery}>
                清空搜索
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {hits.map((hit) => {
              const meta = SOURCE_META[hit.source_type]
              const href =
                hit.start_ms != null
                  ? `/w/${workspaceId}/meetings/${hit.meeting_id}?t=${hit.start_ms}`
                  : `/w/${workspaceId}/meetings/${hit.meeting_id}`
              return (
                <li key={`${hit.meeting_id}-${hit.source_type}-${hit.start_ms ?? 0}-${hit.snippet.slice(0, 12)}`}>
                  <Link
                    href={href}
                    className="panel panel-hover block animate-fade-up p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {hit.meeting_title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatMeetingTime(hit.started_at)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {hit.snippet}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        相关度 {hit.score.toFixed(2)}
                      </span>
                      <ProgressBar
                        value={Math.min(100, Math.max(0, hit.score * 100))}
                        className="h-1 w-24"
                      />
                      {hit.start_ms != null && (
                        <span className="ml-auto text-[11px] text-accent">跳转到该片段</span>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
