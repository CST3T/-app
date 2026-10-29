﻿﻿﻿﻿﻿﻿﻿﻿﻿'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Activity, AlertTriangle, FileText, ListChecks, Sparkles, Wand2 } from 'lucide-react'
import { Button, FieldError, Input, Label, LoadingState } from '@/components/ui/primitives'
import { LogoMark, Wordmark } from '@/components/brand/logo'
import { ApiError, request } from '@/lib/api/client'
import { session } from '@/lib/api/session'
import type { AuthTokens, MeResponse } from '@/lib/api/types'

const DEMO_EMAIL = 'demo@minutes.dev'
const DEMO_PASSWORD = 'minutes2026'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SELLING_POINTS = [
  {
    icon: Activity,
    title: '异步转写进度实时可见',
    description: '任务排队与阶段进度实时推送，失败可从断点重试',
  },
  {
    icon: FileText,
    title: '结构化摘要与版本',
    description: '要点、决策、风险分栏呈现，每次重新生成都保留版本',
  },
  {
    icon: ListChecks,
    title: '待办看板与只读分享',
    description: '从摘要直接拆出待办并跟进，一键生成只读分享链接',
  },
]

interface FieldErrors {
  email?: string
  password?: string
}

/** 登录页：useSearchParams 需要 Suspense 边界，故拆成外层壳 + 内层视图 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState label="正在加载登录页…" className="min-h-dvh" />}>
      <LoginView />
    </Suspense>
  )
}

function LoginView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const targetPath = next && next.startsWith('/') ? next : null

  /** 只有一个工作区时直接进会议列表，多工作区才展示选择页 */
  const resolveLanding = async () => {
    if (targetPath) return targetPath
    try {
      const me = await request<MeResponse>('/me')
      if (me.workspaces.length === 1) return `/w/${me.workspaces[0].id}/meetings`
      return '/workspaces'
    } catch {
      return '/workspaces'
    }
  }

  // 已有会话直接进入目标页，避免重复登录
  useEffect(() => {
    if (!session.getAccessToken()) return
    void resolveLanding().then((path) => router.replace(path))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, targetPath])

  function validate() {
    const nextErrors: FieldErrors = {}
    const trimmed = email.trim()
    if (!trimmed) nextErrors.email = '请输入邮箱'
    else if (!EMAIL_RE.test(trimmed)) nextErrors.email = '邮箱格式不正确'
    if (!password) nextErrors.password = '请输入密码'
    else if (password.length < 8) nextErrors.password = '密码至少 8 位'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return

    setSubmitting(true)
    try {
      const data = await request<AuthTokens>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
        auth: false,
      })
      session.save(data)
      router.push(await resolveLanding())
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : '网络异常，请检查连接后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  function fillDemoAccount() {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    setErrors({})
    setFormError(null)
  }

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="tech-grid pointer-events-none absolute inset-0 opacity-60" />
      <BrandPanel />

      <section className="relative flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <Wordmark />
            <p className="mt-3 text-sm font-medium tracking-tight text-muted-foreground">
              开会议，最好
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text font-semibold text-transparent">
                会记N
              </span>
            </p>
          </div>

          <div className="panel relative overflow-hidden p-6 shadow-sm sm:p-7">
            <span className="hairline-glow pointer-events-none absolute inset-x-6 top-0 h-px" />
            <span className="mb-2.5 hidden w-fit items-center gap-1 whitespace-nowrap rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-[10px] font-medium tracking-[0.14em] text-primary sm:inline-flex">
              <Sparkles className="size-3" />
              开会议，最好会记N
            </span>
            <h2 className="text-xl font-semibold tracking-tight">登录</h2>
            <p className="mt-1 text-sm text-muted-foreground">使用邮箱与密码进入你的工作区</p>

            {formError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-status-failed/30 bg-status-failed/10 px-3 py-2 text-sm text-status-failed"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form noValidate onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  aria-invalid={Boolean(errors.email)}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
                  }}
                />
                <FieldError message={errors.email} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="至少 8 位"
                  value={password}
                  aria-invalid={Boolean(errors.password)}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
                  }}
                />
                <FieldError message={errors.password} />
              </div>

              <Button type="submit" size="lg" className="w-full" loading={submitting}>
                {submitting ? '登录中…' : '登录'}
              </Button>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-surface/60 px-3 py-2">
              <Button type="button" variant="outline" size="sm" onClick={fillDemoAccount}>
                <Wand2 className="size-3.5" />
                填入演示账号
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {DEMO_EMAIL} / {DEMO_PASSWORD}
              </span>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            还没有账号？
            <Link href="/register" className="ml-1 text-primary hover:underline">
              创建账号
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}

function BrandPanel() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border/50 p-12 lg:flex">
      <div className="tech-grid pointer-events-none absolute inset-0 opacity-80" />
      <div className="pointer-events-none absolute -left-24 top-1/4 size-[460px] rounded-full bg-primary/12 blur-[120px] animate-float-orb" />
      <div className="pointer-events-none absolute -right-20 bottom-0 size-[380px] rounded-full bg-accent/12 blur-[120px] animate-float-orb" />

      <div className="relative">
        <Wordmark markClassName="size-11" />
      </div>

      <div className="relative space-y-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.24em] text-primary">
          <span className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
          AI 会议纪要
        </span>

        <div className="space-y-4">
          <h1 className="text-[40px] font-semibold leading-[1.28] tracking-tight">
            开会议，最好
            <span className="text-glow bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              会记N
            </span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            上传录音 → 自动转写 → 结构化摘要 → 提取待办。
            把一场会议从「录音文件」变成「可执行的结论」。
          </p>
        </div>

        <ul className="space-y-3">
          {SELLING_POINTS.map(({ icon: Icon, title, description }) => (
            <li
              key={title}
              className="flex gap-3 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative flex items-center gap-2 text-xs text-muted-foreground/70">
        <LogoMark className="size-5 rounded-md" />
        演示环境 · 数据由本地 Mock 生成，无需真实后端即可体验全流程
      </p>
    </section>
  )
}
