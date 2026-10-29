'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ScrollText, ShieldAlert } from 'lucide-react'
import { useAuditLogs, useMe } from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import { formatDate, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives'

/** 已知动作 → 中文标签；未收录的动作原样展示（前端不臆造） */
const ACTION_LABEL: Record<string, string> = {
  'workspace.create': '创建工作区',
  'workspace.update': '更新工作区',
  'member.invite': '邀请成员',
  'member.update': '修改成员角色',
  'member.remove': '移除成员',
  'meeting.create': '创建会议',
  'meeting.delete': '删除会议',
  'meeting.retry': '重试处理',
  'share.create': '创建分享',
  'share.revoke': '撤销分享',
}

const actionLabel = (action: string) => ACTION_LABEL[action] ?? action

export default function AuditPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: me, isPending: mePending } = useMe()

  const role = me?.workspaces.find((w) => w.id === workspaceId)?.role
  // 审计日志仅 owner/admin 可见；非管理员不发起请求
  const isAdmin = role === 'owner' || role === 'admin'

  const { data: logs, isPending, isError, error, refetch } = useAuditLogs(workspaceId, isAdmin)
  const [filter, setFilter] = useState<string>('all')

  const actions = useMemo(() => {
    const set = new Set<string>()
    ;(logs ?? []).forEach((log) => set.add(log.action))
    return Array.from(set)
  }, [logs])

  const visible = useMemo(
    () =>
      (logs ?? [])
        .filter((log) => filter === 'all' || log.action === filter)
        .slice()
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [logs, filter],
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">审计日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          记录成员进出、会议删除、分享创建/撤销等操作
        </p>
      </header>

      {mePending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="panel flex items-center gap-3 p-4">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          ))}
        </div>
      ) : !isAdmin ? (
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title="仅管理员及以上可查看审计日志"
          description="请联系工作区管理员获取权限。"
        />
      ) : isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="panel flex items-center gap-3 p-4">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={(error as ApiError)?.status === 403 ? '仅管理员及以上可查看' : '审计日志加载失败'}
          message={(error as Error)?.message}
          onRetry={() => refetch()}
        />
      ) : !logs || logs.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-5" />}
          title="暂无审计记录"
          description="成员发生关键操作后，记录会显示在这里。"
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              全部
            </FilterChip>
            {actions.map((action) => (
              <FilterChip
                key={action}
                active={filter === action}
                onClick={() => setFilter(action)}
              >
                {actionLabel(action)}
              </FilterChip>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-5" />}
              title="该类型暂无记录"
              description="切换其他动作类型查看。"
            />
          ) : (
            <ul className="space-y-2">
              {visible.map((log) => (
                <li key={log.id} className="panel panel-hover flex items-start gap-3 p-4">
                  <Avatar name={log.actor_name} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{log.actor_name}</span>
                      <Badge tone="neutral">{actionLabel(log.action)}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{log.target}</p>
                  </div>
                  <time
                    className="shrink-0 pt-0.5 text-xs text-muted-foreground"
                    dateTime={log.created_at}
                    title={formatDate(log.created_at, 'yyyy-MM-dd HH:mm:ss')}
                  >
                    {formatRelative(log.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-primary/40 bg-primary/12 font-medium text-primary'
          : 'border-border/70 text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
