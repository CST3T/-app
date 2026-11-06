'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import {
  Check,
  ChevronsUpDown,
  LayoutGrid,
  ListTodo,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { session } from '@/lib/api/session'
import { useMe, useWorkspaceTodos } from '@/lib/api/hooks'
import { ROLE_META } from '@/lib/format'
import { Avatar } from '@/components/ui/avatar'
import { Wordmark, LogoMark } from '@/components/brand/logo'
import { Button } from '@/components/ui/primitives'
import { SoundToggle } from '@/components/ui/sfx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipProvider,
} from '@/components/ui/overlay'
import type { Role, Workspace } from '@/lib/api/types'

const NAV = [
  { key: 'meetings', label: '会议', icon: LayoutGrid, href: (w: string) => `/w/${w}/meetings` },
  { key: 'todos', label: '待办', icon: ListTodo, href: (w: string) => `/w/${w}/todos` },
  { key: 'search', label: '搜索', icon: Search, href: (w: string) => `/w/${w}/search` },
  { key: 'members', label: '成员', icon: Users, href: (w: string) => `/w/${w}/settings/members` },
  { key: 'audit', label: '审计', icon: ShieldCheck, href: (w: string) => `/w/${w}/settings/audit` },
]

/** 审计页仅 Admin+ 可见 —— 与权限矩阵保持一致，越权入口直接隐藏 */
const AUDIT_ROLES: Role[] = ['owner', 'admin']
/** 成员管理页 Member+ 可看，游客隐藏 */
const MEMBER_ROLES: Role[] = ['owner', 'admin', 'member']

export function AppShell({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: me } = useMe()
  const { data: todos } = useWorkspaceTodos(workspaceId)
  const overdueCount = todos?.summary.overdue ?? 0
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const workspace = me?.workspaces.find((w) => w.id === workspaceId)
  const role: Role = workspace?.role ?? 'member'

  const visibleNav = NAV.filter((item) => {
    if (item.key === 'audit') return AUDIT_ROLES.includes(role)
    if (item.key === 'members') return MEMBER_ROLES.includes(role)
    return true
  })

  const onLogout = () => {
    session.clear()
    router.push('/login')
  }

  return (
    <TooltipProvider>
      <div className="relative min-h-dvh">
        <div className="desktop-sky" aria-hidden="true" />
        <div className="relative z-10 flex min-h-dvh lg:p-6">
          <div className="window-glass relative flex min-h-dvh w-full flex-col overflow-hidden lg:h-[calc(100dvh-3rem)] lg:min-h-[calc(100dvh-3rem)] lg:flex-row lg:rounded-2xl">
        {/* ------------------------ 桌面侧边栏 ------------------------ */}
        <aside className="relative hidden h-full w-[252px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.02] px-3 py-4 lg:flex">
          <span className="hairline-glow pointer-events-none absolute inset-y-0 right-0 w-px opacity-50" />

          <Link href={`/w/${workspaceId}/meetings`} className="mb-4 px-1.5">
            <Wordmark />
          </Link>

          <WorkspaceSwitcher current={workspace} workspaces={me?.workspaces ?? []} />

          <nav className="mt-5 flex-1 space-y-1">
            {visibleNav.map((item) => {
              const href = item.href(workspaceId)
              const active = pathname.startsWith(href)
              const Icon = item.icon
              return (
                <Link
                  key={item.key}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13.5px] transition-all duration-200',
                    active
                      ? 'bg-primary/10 font-medium text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]'
                      : 'text-muted-foreground hover:bg-surface-hover/70 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'absolute left-0.5 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary))] transition-opacity',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon className="size-4" />
                  {item.label}
                  {item.key === 'todos' && overdueCount > 0 && (
                    <span
                      className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full border border-status-failed/30 bg-status-failed/15 px-1 text-[10px] font-semibold tabular-nums text-status-failed"
                      aria-label={`${overdueCount} 项逾期待办`}
                    >
                      {overdueCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="space-y-2 border-t border-border/60 pt-3">
            <Button asChild size="sm" className="w-full" data-sound="primary">
              <Link href={`/w/${workspaceId}/meetings/new`}>
                <Plus className="size-4" />
                创建会议
              </Link>
            </Button>
            <div className="flex items-center gap-1">
              <UserMenu
                name={me?.user.name ?? '—'}
                email={me?.user.email ?? ''}
                role={role}
                onLogout={onLogout}
              />
              {mounted && <SoundToggle />}
              {mounted && <ThemeToggle />}
            </div>
          </div>
        </aside>

        {/* -------------------------- 主内容区 -------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 移动端顶栏 */}
          <header className="sticky top-0 z-30 flex h-[52px] items-center justify-between gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur-xl lg:hidden">
            <Link href={`/w/${workspaceId}/meetings`} className="flex items-center gap-2">
              <LogoMark className="size-7" />
              <span className="text-sm font-semibold">会记</span>
            </Link>
            <div className="flex items-center gap-0.5">
              <WorkspaceSwitcher current={workspace} workspaces={me?.workspaces ?? []} compact />
              {mounted && <SoundToggle />}
              {mounted && <ThemeToggle />}
            </div>
          </header>

          <main className="scroll-thin min-w-0 flex-1 pb-4 pl-[68px] lg:overflow-y-auto lg:pl-0">{children}</main>

          {/* 移动端左侧导航栏：搜索 / 成员 / 新建 收在页面左侧 */}
          <nav className="fixed left-0 top-[52px] bottom-0 z-30 flex w-[68px] flex-col items-center gap-1 border-r border-border/60 bg-card/55 py-3 backdrop-blur-xl lg:hidden">
            {visibleNav.map((item) => {
              const href = item.href(workspaceId)
              const active = pathname.startsWith(href)
              const Icon = item.icon
              return (
                <Link
                  key={item.key}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex w-[52px] flex-col items-center gap-1 rounded-lg py-2 text-[10px] transition-colors',
                    active
                      ? 'bg-primary/12 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)]'
                      : 'text-muted-foreground hover:bg-surface-hover/70 hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px]" />
                  {item.label}
                  {item.key === 'todos' && overdueCount > 0 && (
                    <span
                      className="absolute right-1.5 top-1 inline-flex min-w-[15px] items-center justify-center rounded-full bg-status-failed px-1 text-[9px] font-semibold leading-[15px] tabular-nums text-white"
                      aria-label={`${overdueCount} 项逾期待办`}
                    >
                      {overdueCount}
                    </span>
                  )}
                </Link>
              )
            })}

            <Link
              href={`/w/${workspaceId}/meetings/new`}
              data-sound="primary"
              className="mt-1 flex w-[52px] flex-col items-center gap-1 rounded-xl bg-primary py-2 text-[10px] font-medium text-primary-foreground shadow-[0_0_22px_-8px_hsl(var(--glow)/0.9)]"
            >
              <Plus className="size-[18px]" />
              新建
            </Link>
          </nav>
        </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

function WorkspaceSwitcher({
  current,
  workspaces,
  compact = false,
}: {
  current?: Workspace
  workspaces: Workspace[]
  compact?: boolean
}) {
  const router = useRouter()
  const active = current ?? workspaces[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-border/60 bg-surface/60 px-2.5 py-2 text-left transition-colors hover:bg-surface-hover',
            compact && 'w-auto border-0 bg-transparent px-1.5 py-1 hover:bg-surface-hover',
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[11px] font-semibold text-accent">
            {active?.name.slice(0, 1) ?? '—'}
          </span>
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{active?.name ?? '选择工作区'}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {active ? ROLE_META[active.role].label : '—'}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>切换工作区</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => router.push(`/w/${w.id}/meetings`)}>
            <span className="flex size-5 items-center justify-center rounded bg-accent/15 text-[10px] font-semibold text-accent">
              {w.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            <span className="text-[11px] text-muted-foreground">{ROLE_META[w.role].label}</span>
            {active?.id === w.id && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/workspaces')}>
          <Settings className="size-3.5" />
          全部工作区
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({
  name,
  email,
  role,
  onLogout,
}: {
  name: string
  email: string
  role: Role
  onLogout: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover">
          <Avatar name={name} className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {ROLE_META[role].label}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>当前账号</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <p className="truncate text-xs font-medium">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="size-3.5" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Tooltip content={dark ? '切换到亮色' : '切换到深色'}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="切换主题"
        onClick={() => setTheme(dark ? 'light' : 'dark')}
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
    </Tooltip>
  )
}
