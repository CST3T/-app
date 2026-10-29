'use client'

import * as React from 'react'
import { Check, Copy, Link2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Separator,
  Skeleton,
} from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlay'
import { useCreateShareLink, useRevokeShareLink, useShareLinks } from '@/lib/api/hooks'
import type { ShareLink } from '@/lib/api/types'
import { formatDate } from '@/lib/format'

const SCOPE_META: Record<ShareLink['scope'], { label: string; description: string }> = {
  read: { label: '仅摘要', description: '只读查看摘要与待办' },
  read_transcript: { label: '摘要 + 转写稿', description: '只读查看摘要、待办与完整转写稿' },
}

const EXPIRES_OPTIONS: Array<{ value: string; label: string; hours: number | null }> = [
  { value: 'never', label: '永不', hours: null },
  { value: '24', label: '24 小时', hours: 24 },
  { value: '168', label: '7 天', hours: 168 },
  { value: '720', label: '30 天', hours: 720 },
]

function linkStatus(link: ShareLink): { label: string; tone: 'success' | 'neutral' | 'danger' } {
  if (link.revoked_at) return { label: '已撤销', tone: 'danger' }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { label: '已过期', tone: 'neutral' }
  }
  return { label: '有效', tone: 'success' }
}

export function ShareDialog({
  meetingId,
  canShare,
  trigger,
}: {
  meetingId: string
  canShare: boolean
  trigger?: React.ReactNode
}): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useShareLinks(meetingId)
  const createLink = useCreateShareLink(meetingId)
  const revokeLink = useRevokeShareLink(meetingId)

  const [open, setOpen] = React.useState(false)
  const [scope, setScope] = React.useState<ShareLink['scope']>('read_transcript')
  const [expires, setExpires] = React.useState('never')
  const [created, setCreated] = React.useState<ShareLink | null>(null)
  const [pendingRevokeId, setPendingRevokeId] = React.useState<string | null>(null)
  const [origin, setOrigin] = React.useState('')

  // 服务端渲染阶段拿不到 window，挂载后再取 origin，避免 hydration 不一致
  React.useEffect(() => setOrigin(window.location.origin), [])

  const links = data ?? []
  const urlOf = (token: string) => `${origin}/s/${token}`

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(urlOf(token))
      toast.success('链接已复制')
    } catch {
      toast.error('复制失败，请手动选择链接')
    }
  }

  const create = () => {
    const hours = EXPIRES_OPTIONS.find((o) => o.value === expires)?.hours ?? null
    createLink.mutate(
      { scope, expires_in_hours: hours },
      {
        onSuccess: (link) => {
          setCreated(link)
          toast.success('分享链接已创建')
        },
        onError: (err) => toast.error(err.message || '创建失败，请重试'),
      },
    )
  }

  const revoke = (id: string) => {
    revokeLink.mutate(id, {
      onSuccess: () => {
        setPendingRevokeId(null)
        toast.success('分享链接已撤销')
      },
      onError: (err) => toast.error(err.message || '撤销失败，请重试'),
    })
  }

  if (!canShare) {
    if (trigger) {
      return (
        <span
          aria-disabled="true"
          title="当前角色没有分享权限"
          className="inline-flex cursor-not-allowed opacity-60 [&_*]:pointer-events-none"
        >
          {trigger}
        </span>
      )
    }
    return (
      <Button variant="outline" size="sm" disabled title="当前角色没有分享权限">
        <Share2 className="size-3.5" />
        分享
      </Button>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setCreated(null)
          setPendingRevokeId(null)
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Share2 className="size-3.5" />
            分享
          </Button>
        )}
      </DialogTrigger>

      <DialogContent title="分享会议" description="只读分享，无需登录即可查看">
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border/60 bg-surface/40 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="share-scope">作用域</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as ShareLink['scope'])}>
                  <SelectTrigger id="share-scope" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_META).map(([value, meta]) => (
                      <SelectItem key={value} value={value}>
                        {meta.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{SCOPE_META[scope].description}</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="share-expires">有效期</Label>
                <Select value={expires} onValueChange={setExpires}>
                  <SelectTrigger id="share-expires" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRES_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">到期后链接自动失效</p>
              </div>
            </div>

            <Button size="sm" loading={createLink.isPending} onClick={create}>
              <Link2 className="size-3.5" />
              创建链接
            </Button>
          </div>

          {created && (
            <div className="space-y-1.5 rounded-xl border border-status-done/30 bg-status-done/5 p-3 animate-fade-up">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-status-done">
                <Check className="size-3.5" />
                链接已创建
              </div>
              <div className="flex gap-2">
                <Input readOnly value={urlOf(created.token)} className="font-mono text-xs" />
                <Button variant="secondary" size="sm" onClick={() => void copy(created.token)}>
                  <Copy className="size-3.5" />
                  复制
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              已有链接
            </p>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : isError ? (
              <ErrorState
                title="分享链接加载失败"
                message={(error as Error | null)?.message}
                onRetry={() => void refetch()}
                className="py-6"
              />
            ) : links.length === 0 ? (
              <EmptyState
                icon={<Link2 className="size-5" />}
                title="还没有创建分享链接"
                description="创建只读链接，对方无需登录即可查看。"
                className="px-4 py-8"
              />
            ) : (
              <ul className="space-y-2">
                {links.map((link) => {
                  const status = linkStatus(link)
                  const active = status.label === '有效'
                  return (
                    <li
                      key={link.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-2"
                    >
                      <code className="font-mono text-xs text-foreground">
                        {link.token.slice(0, 8)}…
                      </code>
                      <Badge tone="neutral">{SCOPE_META[link.scope].label}</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {link.expires_at
                          ? `${formatDate(link.expires_at, 'yyyy-MM-dd HH:mm')} 过期`
                          : '永不过期'}
                      </span>
                      <Badge tone={status.tone}>{status.label}</Badge>

                      <div className="ml-auto flex items-center gap-1">
                        {pendingRevokeId === link.id ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingRevokeId(null)}
                            >
                              取消
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              loading={revokeLink.isPending}
                              onClick={() => revoke(link.id)}
                            >
                              确认撤销
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="复制链接"
                              onClick={() => void copy(link.token)}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                            {active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn('text-muted-foreground hover:text-status-failed')}
                                onClick={() => setPendingRevokeId(link.id)}
                              >
                                撤销
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
