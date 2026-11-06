'use client'

import * as React from 'react'
import { Check, Download, FileText, Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Badge,
  Button,
  ErrorState,
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
import { API_BASE } from '@/lib/api/client'
import { session } from '@/lib/api/session'
import type { ApiErrorBody } from '@/lib/api/types'

type DocScope = 'summary' | 'transcript'

const SCOPE_META: Record<DocScope, { label: string; description: string }> = {
  summary: { label: 'AI 纪要', description: '由 AI 把摘要与要点整理成结构化纪要文档' },
  transcript: { label: '纪要 + 完整转写稿', description: '纪要正文后附完整转写稿，便于存档查阅' },
}

export function ShareDialog({
  meetingId,
  canShare,
  meetingTitle,
  trigger,
}: {
  meetingId: string
  canShare: boolean
  meetingTitle?: string
  trigger?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [scope, setScope] = React.useState<DocScope>('transcript')
  const [status, setStatus] = React.useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = React.useState<string | null>(null)
  const [savedName, setSavedName] = React.useState<string | null>(null)

  const generate = async () => {
    setStatus('working')
    setMessage(null)
    try {
      const token = session.getAccessToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE}/meetings/${meetingId}/share-document`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ include_transcript: scope === 'transcript' }),
      })
      if (!res.ok) {
        let detail = `生成失败（HTTP ${res.status}）`
        try {
          const payload = (await res.json()) as ApiErrorBody
          detail = payload?.error?.message ?? detail
        } catch {
          /* ignore */
        }
        throw new Error(detail)
      }

      const blob = await res.blob()
      const safeTitle = (meetingTitle || '会议').replace(/[\\/:*?"<>|]/g, '_')
      const fileName = `${safeTitle}-会议纪要.docx`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)

      setSavedName(fileName)
      setStatus('done')
      toast.success('文档已生成并开始下载')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '生成失败，请稍后重试')
    }
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
          setStatus('idle')
          setMessage(null)
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

      <DialogContent
        title="分享会议"
        description="由 AI 把会议内容整理成 Word 文档，生成后直接保存到本地"
      >
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border/60 bg-surface/40 p-3">
            <div className="space-y-1">
              <Label htmlFor="share-doc-scope">文档内容</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as DocScope)}>
                <SelectTrigger id="share-doc-scope" className="h-8 text-xs">
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

            <Button size="sm" className="w-full" disabled={status === 'working'} onClick={() => void generate()}>
              {status === 'working' ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  AI 正在撰写文档，约需 10~30 秒…
                </>
              ) : (
                <>
                  <FileText className="size-3.5" />
                  生成 Word 文档并保存
                </>
              )}
            </Button>
          </div>

          {status === 'done' && savedName && (
            <div className="space-y-1.5 rounded-xl border border-status-done/30 bg-status-done/5 p-3 animate-fade-up">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-status-done">
                <Check className="size-3.5" />
                文档已保存到浏览器下载目录
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs">
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{savedName}</span>
              </p>
            </div>
          )}

          {status === 'error' && (
            <ErrorState
              title="文档生成失败"
              message={message ?? undefined}
              onRetry={() => void generate()}
              className="py-4"
            />
          )}

          <Separator />

          <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium uppercase tracking-wide">
              <Badge tone="info">AI</Badge>
              文档说明
            </p>
            {status === 'working' ? (
              <Skeleton className="h-4 w-3/4" />
            ) : (
              <p>
                文档包含会议总览、讨论要点、结论决议与后续行动；选择「纪要 +
                完整转写稿」时还会附加逐段转写内容。生成结果基于本会议的转写与摘要数据。
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
