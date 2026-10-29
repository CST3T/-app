'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Building2, LogOut, Moon, Plus, Sun } from 'lucide-react'
import { qk, useMe } from '@/lib/api/hooks'
import { ApiError, request } from '@/lib/api/client'
import { session } from '@/lib/api/session'
import { ROLE_META, formatDate } from '@/lib/format'
import { Avatar } from '@/components/ui/avatar'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FieldError,
  Input,
  Label,
  LoadingState,
} from '@/components/ui/primitives'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/overlay'
import { Wordmark } from '@/components/brand/logo'
import type { Plan, Workspace } from '@/lib/api/types'

const ROLE_TONE = {
  owner: 'primary',
  admin: 'info',
  member: 'process',
  viewer: 'neutral',
} as const

const PLAN_LABEL: Record<Plan, string> = {
  free: '免费版',
  team: '团队版',
}

/** 工作区选择页：不套 AppShell，作为登录后的入口 */
export default function WorkspacesPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const authed = typeof window !== 'undefined' && Boolean(session.getAccessToken())
  const { data, isPending, isError, error, refetch } = useMe({ enabled: authed })

  useEffect(() => {
    if (!authed) router.replace('/login')
  }, [authed, router])

  function handleLogout() {
    session.clear()
    queryClient.clear()
    router.replace('/login')
  }

  if (!authed || isPending) {
    return <LoadingState label="正在加载工作区…" className="min-h-dvh" />
  }

  if (isError) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl items-center px-5">
        <ErrorState
          title="工作区加载失败"
          message={error instanceof ApiError ? error.message : (error as Error)?.message}
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => refetch()}
          className="w-full"
        />
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-5">
          <div className="flex items-center gap-2.5">
            <Wordmark />
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <div className="flex items-center gap-2">
              <Avatar name={data.user.name} src={data.user.avatar_url} className="size-8" />
              <div className="hidden min-w-0 sm:block">
                <p className="max-w-[14rem] truncate text-xs font-medium">{data.user.name}</p>
                <p className="max-w-[14rem] truncate text-[11px] text-muted-foreground">
                  {data.user.email}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="退出登录">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">退出登录</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">选择工作区</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              每个工作区独立存放会议、成员与分享链接
            </p>
          </div>
          <NewWorkspaceDialog
            trigger={
              <Button size="sm">
                <Plus className="size-4" />
                新建工作区
              </Button>
            }
          />
        </div>

        {data.workspaces.length === 0 ? (
          <EmptyState
            title="还没有工作区"
            description="创建一个工作区，开始上传会议录音并生成纪要。"
            icon={<Building2 className="size-5" />}
            action={
              <NewWorkspaceDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <Plus className="size-4" />
                    新建工作区
                  </Button>
                }
              />
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.workspaces.map((workspace) => (
              <WorkspaceCard key={workspace.id} workspace={workspace} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const roleMeta = ROLE_META[workspace.role]

  return (
    <Link
      href={`/w/${workspace.id}/meetings`}
      className="panel panel-hover group block p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-base font-semibold text-accent">
          {workspace.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{workspace.name}</h2>
            <Badge tone={ROLE_TONE[workspace.role]}>{roleMeta.label}</Badge>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{roleMeta.description}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
        <div>
          <p className="text-sm font-semibold">{workspace.member_count}</p>
          <p className="text-[11px] text-muted-foreground">成员</p>
        </div>
        <div>
          <p className="text-sm font-semibold">{workspace.meeting_count}</p>
          <p className="text-[11px] text-muted-foreground">会议</p>
        </div>
        <div>
          <p className="text-sm font-semibold">{PLAN_LABEL[workspace.plan]}</p>
          <p className="text-[11px] text-muted-foreground">计划</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>创建于 {formatDate(workspace.created_at)}</span>
        <span className="flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
          进入
          <ArrowRight className="size-3" />
        </span>
      </div>
    </Link>
  )
}

function NewWorkspaceDialog({ trigger }: { trigger: React.ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const createWorkspace = useMutation({
    mutationFn: (workspaceName: string) =>
      request<Workspace>('/workspaces', { method: 'POST', body: { name: workspaceName } }),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: qk.me })
      setOpen(false)
      toast.success(`工作区「${workspace.name}」已创建`)
      router.push(`/w/${workspace.id}/meetings`)
    },
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setName('')
      setFieldError(null)
      setFormError(null)
      createWorkspace.reset()
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldError(null)
    setFormError(null)

    const trimmed = name.trim()
    if (!trimmed) {
      setFieldError('请填写工作区名称')
      return
    }

    try {
      await createWorkspace.mutateAsync(trimmed)
    } catch (error) {
      if (error instanceof ApiError) {
        const nameError = error.details?.name
        if (typeof nameError === 'string') setFieldError(nameError)
        else setFormError(error.message)
      } else {
        setFormError('网络异常，请稍后重试')
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="新建工作区"
        description="工作区用于隔离不同团队或项目的会议数据，创建后你将成为所有者"
      >
        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">工作区名称</Label>
            <Input
              id="workspace-name"
              autoFocus
              placeholder="例如：产品研发中心"
              value={name}
              aria-invalid={Boolean(fieldError)}
              onChange={(event) => {
                setName(event.target.value)
                if (fieldError) setFieldError(null)
              }}
            />
            <FieldError message={fieldError} />
          </div>

          {formError && (
            <p className="rounded-lg border border-status-failed/30 bg-status-failed/10 px-3 py-2 text-xs text-status-failed">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" loading={createWorkspace.isPending}>
              创建工作区
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // 避免服务端与客户端主题不一致导致的水合告警
  if (!mounted) return <span className="size-8" />

  const dark = resolvedTheme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="切换主题"
      title={dark ? '切换到亮色' : '切换到深色'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
