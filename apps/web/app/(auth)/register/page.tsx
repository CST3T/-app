﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Activity, AlertTriangle, FileText, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { Button, FieldError, Input, Label } from '@/components/ui/primitives'
import { Wordmark, LogoMark } from '@/components/brand/logo'
import { ApiError, request } from '@/lib/api/client'
import { session } from '@/lib/api/session'
import type { AuthTokens } from '@/lib/api/types'

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
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

export default function RegisterPage() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function validate() {
    const nextErrors: FieldErrors = {}
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) nextErrors.name = '请输入姓名'
    if (!trimmedEmail) nextErrors.email = '请输入邮箱'
    else if (!EMAIL_RE.test(trimmedEmail)) nextErrors.email = '邮箱格式不正确'
    if (!password) nextErrors.password = '请输入密码'
    else if (password.length < 8) nextErrors.password = '密码至少 8 位'
    if (!confirmPassword) nextErrors.confirmPassword = '请再次输入密码'
    else if (confirmPassword !== password) nextErrors.confirmPassword = '两次输入的密码不一致'

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return

    setSubmitting(true)
    try {
      const data = await request<AuthTokens>('/auth/register', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password },
        auth: false,
      })
      session.save(data)
      toast.success('注册成功，正在进入工作区')
      router.push('/workspaces')
    } catch (error) {
      if (error instanceof ApiError) {
        // 后端 400 的 details 里带字段级错误时，映射到对应输入框
        const mapped: FieldErrors = {}
        const details = error.details
        if (details) {
          for (const key of ['name', 'email', 'password'] as const) {
            const value = details[key]
            if (typeof value === 'string') mapped[key] = value
          }
        }
        const hasFieldErrors = Object.keys(mapped).length > 0
        setErrors((prev) => ({ ...prev, ...mapped }))
        if (!hasFieldErrors || error.code !== 'VALIDATION_ERROR') {
          setFormError(error.message)
        }
      } else {
        setFormError('网络异常，请检查连接后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <section className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <Wordmark />
          </div>

          <div className="panel p-6 shadow-sm sm:p-7">
            <h2 className="text-xl font-semibold tracking-tight">创建账号</h2>
            <p className="mt-1 text-sm text-muted-foreground">注册后从空白状态开始，创建自己的工作区，数据与他人完全隔离</p>

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
                <Label htmlFor="name">姓名</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="你的名字"
                  value={name}
                  aria-invalid={Boolean(errors.name)}
                  onChange={(event) => {
                    setName(event.target.value)
                    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                  }}
                />
                <FieldError message={errors.name} />
              </div>

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
                  autoComplete="new-password"
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

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">确认密码</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  aria-invalid={Boolean(errors.confirmPassword)}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    if (errors.confirmPassword) {
                      setErrors((prev) => ({ ...prev, confirmPassword: undefined }))
                    }
                  }}
                />
                <FieldError message={errors.confirmPassword} />
              </div>

              <Button type="submit" size="lg" className="w-full" loading={submitting}>
                {submitting ? '注册中…' : '注册'}
              </Button>
            </form>
          </div>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            已有账号？
            <Link href="/login" className="ml-1 text-primary hover:underline">
              去登录
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
      <div className="pointer-events-none absolute -right-24 top-1/3 size-[420px] rounded-full bg-accent/12 blur-[120px] animate-float-orb" />

      <div className="relative">
        <Wordmark markClassName="size-11" />
      </div>

      <div className="relative space-y-8">
        <div className="space-y-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-primary">AI 会议纪要</p>
          <h1 className="text-[38px] font-semibold leading-[1.3] tracking-tight">
            开会议，最好
            <span className="text-glow bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              会记N
            </span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            把一场会议从「录音文件」变成「可执行的结论」，让讨论的产出不再只留在记忆里。
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
