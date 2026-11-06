'use client'

import * as React from 'react'
import {
  FileArchive,
  FileText,
  ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Trash2,
  UploadCloud,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { resolveMediaUrl } from '@/lib/api/client'
import { Avatar } from '@/components/ui/avatar'
import { Badge, Button, EmptyState, ProgressBar } from '@/components/ui/primitives'
import { useDeleteAttachment, useUploadAttachment } from '@/lib/api/hooks'
import {
  ATTACHMENT_KIND_META,
  ATTACHMENT_LIMITS,
  formatBytes,
  formatRelative,
  validateAttachment,
} from '@/lib/format'
import type { AttachmentKind, MeetingAttachment } from '@/lib/api/types'

interface UploadTask {
  key: string
  name: string
  percent: number
  error: string | null
}

/** 详情页「资料」Tab：成员共享的图片 / 音频 / 视频 / 文档 */
export function AttachmentPanel({
  meetingId,
  attachments,
  canUpload,
  canManage,
  currentUserId,
}: {
  meetingId: string
  attachments: MeetingAttachment[]
  canUpload: boolean
  canManage: boolean
  currentUserId: string | null
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const upload = useUploadAttachment(meetingId)
  const remove = useDeleteAttachment(meetingId)
  const [dragging, setDragging] = React.useState(false)
  const [tasks, setTasks] = React.useState<UploadTask[]>([])

  const patchTask = (key: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  }

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      const validity = validateAttachment(file)
      if (!validity.ok) {
        toast.error(`${file.name}：${validity.message}`)
        continue
      }
      const key = `${file.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      setTasks((prev) => [...prev, { key, name: file.name, percent: 0, error: null }])
      try {
        await upload.mutateAsync({
          file,
          onProgress: (percent) => patchTask(key, { percent }),
        })
        patchTask(key, { percent: 100 })
        toast.success(`已共享 ${file.name}`)
        // 成功的任务 1.2s 后自动隐藏
        setTimeout(() => setTasks((prev) => prev.filter((t) => t.key !== key)), 1200)
      } catch (error) {
        const message = error instanceof Error ? error.message : '上传失败'
        patchTask(key, { error: message })
        toast.error(`${file.name} 上传失败：${message}`)
      }
    }
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (picked.length > 0) void uploadFiles(picked)
  }

  const onDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!canUpload) return
    const dropped = Array.from(event.dataTransfer.files ?? [])
    if (dropped.length > 0) void uploadFiles(dropped)
  }

  const handleDelete = (attachment: MeetingAttachment) => {
    remove.mutate(attachment.id, {
      onSuccess: () => toast.success('资料已删除'),
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">会议资料</p>
          <Badge tone="neutral">{attachments.length}</Badge>
        </div>
        {canUpload && (
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Paperclip className="size-3.5" />
            共享文件
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_LIMITS.accept}
        onChange={onPick}
        className="hidden"
      />

      {canUpload && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null
            if (next && e.currentTarget.contains(next)) return
            setDragging(false)
          }}
          onDrop={onDrop}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            dragging
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border/70 bg-surface/30 text-muted-foreground hover:border-border hover:bg-surface-hover/50',
          )}
        >
          <UploadCloud className="size-4 shrink-0" />
          拖拽文件到这里，或点击共享（{ATTACHMENT_LIMITS.acceptText}，单个 ≤{' '}
          {ATTACHMENT_LIMITS.maxMB}MB）
        </button>
      )}

      {tasks.length > 0 && (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.key} className="rounded-lg border border-border/60 bg-surface/40 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                {task.error ? (
                  <X className="size-3.5 shrink-0 text-status-failed" />
                ) : task.percent >= 100 ? (
                  <Paperclip className="size-3.5 shrink-0 text-status-done" />
                ) : (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate">{task.name}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {task.error ? '失败' : `${task.percent}%`}
                </span>
              </div>
              {task.error ? (
                <p className="mt-1 text-[11px] text-status-failed">{task.error}</p>
              ) : (
                <ProgressBar value={task.percent} className="mt-1.5" />
              )}
            </li>
          ))}
        </ul>
      )}

      {attachments.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="size-5" />}
          title="还没有共享资料"
          description={
            canUpload ? '上传会议相关的图片、录音或文档，供所有参会成员查看' : '这场会议还没有共享资料'
          }
        />
      ) : (
        <ul className="grid gap-2.5">
          {attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              canDelete={canManage || attachment.uploader_id === currentUserId}
              deleting={remove.isPending && remove.variables === attachment.id}
              onDelete={() => handleDelete(attachment)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

const KIND_ICON: Record<AttachmentKind, typeof FileText> = {
  image: ImageIcon,
  audio: Music,
  video: Video,
  doc: FileText,
  other: FileArchive,
}

function AttachmentCard({
  attachment,
  canDelete,
  deleting,
  onDelete,
}: {
  attachment: MeetingAttachment
  canDelete: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const meta = ATTACHMENT_KIND_META[attachment.kind]
  const Icon = KIND_ICON[attachment.kind]
  const url = resolveMediaUrl(attachment.url)

  return (
    <li className="group overflow-hidden rounded-lg border border-border/60 bg-card/50">
      {attachment.kind === 'image' && url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block aspect-[16/10] overflow-hidden bg-surface"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={attachment.file_name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </a>
      )}

      {attachment.kind === 'video' && url && (
        <video src={url} controls preload="metadata" className="w-full bg-black/40" />
      )}

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {attachment.kind !== 'image' && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{attachment.file_name}</p>
            <Badge tone={meta.tone} className="shrink-0">
              {meta.label}
            </Badge>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Avatar name={attachment.uploader_name} className="size-3.5" />
            <span className="truncate">{attachment.uploader_name}</span>
            <span className="shrink-0">· {formatBytes(attachment.size_bytes)}</span>
            <span className="shrink-0">· {formatRelative(attachment.created_at)}</span>
          </p>

          {attachment.kind === 'audio' && url && (
            <audio src={url} controls preload="metadata" className="mt-2 h-8 w-full" />
          )}

          {url && (attachment.kind === 'doc' || attachment.kind === 'other') && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              打开 / 下载
            </a>
          )}
        </div>

        {canDelete && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`删除 ${attachment.file_name}`}
            loading={deleting}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  )
}
