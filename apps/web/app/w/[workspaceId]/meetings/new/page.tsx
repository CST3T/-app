'use client'

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  FileAudio,
  Loader2,
  ShieldAlert,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCreateMeeting, useMe, useMembers } from '@/lib/api/hooks'
import { ApiError, ERROR_HINT } from '@/lib/api/client'
import type { MeetingRole, MeetingStatus, Role } from '@/lib/api/types'
import { ParticipantPicker } from '@/components/meetings/participant-picker'
import {
  MEETING_STATUS_META,
  UPLOAD_LIMITS,
  formatBytes,
  formatDuration,
  probeAudioDuration,
  validateAudioFile,
} from '@/lib/format'
import { cn, idempotencyKey } from '@/lib/utils'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldError,
  Input,
  Label,
  LoadingState,
  ProgressBar,
  Separator,
} from '@/components/ui/primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlay'

const WRITE_ROLES: Role[] = ['owner', 'admin', 'member']
const FLOW_STAGES: MeetingStatus[] = ['uploaded', 'transcribing', 'summarizing']
const LANGUAGES = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]
const MAX_MINUTES = UPLOAD_LIMITS.maxDurationSec / 60

export default function NewMeetingPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: me } = useMe()
  const role = me?.workspaces.find((w) => w.id === workspaceId)?.role

  if (!role) return <LoadingState label="正在读取工作区权限…" />

  if (!WRITE_ROLES.includes(role)) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title="当前角色没有创建权限"
          description="你是该工作区的只读访客，无法上传录音。如需创建会议，请联系管理员调整角色。"
          action={
            <Button asChild variant="outline">
              <Link href={`/w/${workspaceId}/meetings`}>返回会议列表</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return <CreateMeetingForm workspaceId={workspaceId} />
}

function CreateMeetingForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const create = useCreateMeeting(workspaceId)
  const { data: me } = useMe()
  const { data: members = [] } = useMembers(workspaceId)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const idemRef = useRef<string | null>(null)
  const probeSeq = useRef(0)

  const [title, setTitle] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [language, setLanguage] = useState('zh')
  const [participants, setParticipants] = useState<
    Array<{ user_id: string; meeting_role: MeetingRole }>
  >([])
  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [probing, setProbing] = useState(false)
  const [dragging, setDragging] = useState(false)

  const [titleError, setTitleError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [topError, setTopError] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)

  const pending = create.isPending

  // 默认开始时间取当前时刻；放在挂载后赋值，避免服务端与客户端渲染不一致
  useEffect(() => {
    setStartedAt(toDateTimeLocal(new Date()))
  }, [])

  const acceptFile = async (picked: File) => {
    if (pending) return

    const validity = validateAudioFile(picked)
    if (!validity.ok) {
      setFileError(validity.message)
      toast.error(validity.message)
      return
    }

    const seq = ++probeSeq.current
    setFileError(null)
    setFile(picked)
    setDuration(null)
    idemRef.current = null
    setProbing(true)

    const seconds = await probeAudioDuration(picked)
    // 期间用户又换了文件，丢弃这次结果
    if (seq !== probeSeq.current) return
    setProbing(false)

    if (seconds === null) return // 读不到时长不阻塞上传，仅展示「时长未知」

    if (seconds > UPLOAD_LIMITS.maxDurationSec) {
      const message = `音频超过 ${MAX_MINUTES} 分钟上限`
      setFile(null)
      setDuration(null)
      setFileError(message)
      toast.error(message)
      return
    }
    setDuration(seconds)
  }

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    if (picked) void acceptFile(picked)
    // 清空 value，允许再次选择同一个文件
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) void acceptFile(dropped)
  }

  const removeFile = () => {
    if (pending) return
    probeSeq.current += 1
    setFile(null)
    setDuration(null)
    setFileError(null)
    setProbing(false)
    idemRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const cancelUpload = () => {
    abortRef.current?.abort()
  }

  const handleSubmitError = (err: unknown) => {
    if (!(err instanceof ApiError)) {
      const message = err instanceof Error ? err.message : '上传失败，请稍后重试'
      setTopError(message)
      toast.error(message)
      return
    }

    if (err.code === 'VALIDATION_ERROR') {
      const details = err.details ?? {}
      const titleHint = typeof details.title === 'string' ? details.title : null
      const audioHint = typeof details.audio === 'string' ? details.audio : null
      if (titleHint) setTitleError(titleHint)
      if (audioHint) setFileError(audioHint)
      const message = titleHint || audioHint ? '请检查标红的字段后重试' : err.message || ERROR_HINT.VALIDATION_ERROR
      if (!titleHint && !audioHint) setTopError(err.message || ERROR_HINT.VALIDATION_ERROR)
      toast.error(message)
      return
    }

    const hint =
      err.code === 'RATE_LIMITED'
        ? `${ERROR_HINT.RATE_LIMITED}（可能已触达上传配额）`
        : ERROR_HINT[err.code] ?? err.message
    setTopError(hint)
    toast.error(hint)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return

    setTopError(null)
    let invalid = false
    if (!title.trim()) {
      setTitleError('请填写会议标题')
      invalid = true
    }
    const selectedFile = file
    if (!selectedFile) {
      setFileError('请上传录音文件')
      invalid = true
    }
    if (invalid || !selectedFile) return

    if (probing) {
      setFileError('正在读取音频时长，请稍候再提交')
      return
    }

    const started = new Date(startedAt)
    if (Number.isNaN(started.getTime())) {
      setTopError('开始时间格式不正确，请重新选择')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setPercent(0)
    // 同一次提交沿用同一幂等键，网络中断后重试不会重复创建会议
    if (!idemRef.current) idemRef.current = idempotencyKey()

    try {
      const result = await create.mutateAsync({
        title: title.trim(),
        startedAt: started.toISOString(),
        language,
        file: selectedFile,
        participants: participants.filter((p) => p.user_id !== me?.user.id),
        onProgress: setPercent,
        signal: controller.signal,
        idempotencyKey: idemRef.current,
      })
      toast.success('已上传，正在后台转写')
      router.push(`/w/${workspaceId}/meetings/${result.id}`)
    } catch (err) {
      if (controller.signal.aborted) {
        toast('已取消上传')
        setPercent(0)
        return
      }
      handleSubmitError(err)
    } finally {
      abortRef.current = null
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/w/${workspaceId}/meetings`}>
          <ChevronLeft className="size-4" />
          返回会议列表
        </Link>
      </Button>

      <header className="mb-5 mt-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">创建会议</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          上传会议录音，系统会在后台完成转写、摘要与待办提取。
        </p>
      </header>

      {topError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-status-failed/30 bg-status-failed/5 p-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-failed" />
          <p className="min-w-0 flex-1 text-sm text-foreground/90">{topError}</p>
          <button
            type="button"
            onClick={() => setTopError(null)}
            aria-label="关闭提示"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card className="p-5 sm:p-6">
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-title">会议标题</Label>
              <Input
                id="meeting-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (titleError) setTitleError(null)
                }}
                placeholder="例如：产品周会 · Q4 迭代对齐"
                disabled={pending}
                aria-invalid={Boolean(titleError)}
                className="h-10"
              />
              <FieldError message={titleError} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="meeting-started-at">开始时间</Label>
                <Input
                  id="meeting-started-at"
                  type="datetime-local"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                  disabled={pending}
                  className="h-10 [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="meeting-language">转写语言</Label>
                <Select value={language} onValueChange={setLanguage} disabled={pending}>
                  <SelectTrigger id="meeting-language" className="h-10">
                    <SelectValue placeholder="选择语言" />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <ParticipantPicker
                creator={me?.user ? { name: me.user.name, email: me.user.email } : null}
                members={members.filter((m) => m.user_id !== me?.user.id)}
                value={participants}
                onChange={setParticipants}
                disabled={pending}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                会议身份与工作区角色相互独立：主持人掌控议程，记录员负责整理纪要与待办，旁听成员只读。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="meeting-audio">录音文件</Label>
              <input
                ref={fileInputRef}
                id="meeting-audio"
                type="file"
                accept={UPLOAD_LIMITS.accept}
                onChange={onFileInputChange}
                className="hidden"
                disabled={pending}
              />

              {file ? (
                <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/50 p-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <FileAudio className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(file.size)} ·{' '}
                      {probing ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" />
                          正在读取时长…
                        </span>
                      ) : duration !== null ? (
                        formatDuration(duration)
                      ) : (
                        '时长未知'
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="移除文件"
                    onClick={removeFile}
                    disabled={pending}
                    className="size-9"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!pending) setDragging(true)
                  }}
                  onDragLeave={(e) => {
                    // 在子元素间移动也会触发 dragleave，用 relatedTarget 过滤掉内部元素
                    const next = e.relatedTarget as Node | null
                    if (next && e.currentTarget.contains(next)) return
                    setDragging(false)
                  }}
                  onDrop={onDrop}
                  className={cn(
                    'flex min-h-[176px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60',
                    dragging
                      ? 'border-primary bg-primary/10'
                      : 'border-border/80 bg-surface/40 hover:border-border hover:bg-surface-hover/60',
                  )}
                >
                  <span
                    className={cn(
                      'mb-1 flex size-11 items-center justify-center rounded-full transition-colors',
                      dragging ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <UploadCloud className="size-5" />
                  </span>
                  <span className="text-sm font-medium">拖拽音频到这里，或点击选择</span>
                  <span className="text-xs text-muted-foreground">
                    支持 {UPLOAD_LIMITS.accept}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    单个文件 ≤ {UPLOAD_LIMITS.maxMB}MB · 时长 ≤ {MAX_MINUTES} 分钟
                  </span>
                </button>
              )}
              <FieldError message={fileError} />
            </div>

            {pending && (
              <div className="space-y-2 rounded-lg border border-border/70 bg-surface/50 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {percent < 100 ? '正在上传音频…' : '上传完成，等待后台处理…'}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">{percent}%</span>
                </div>
                <ProgressBar value={percent} />
              </div>
            )}

            <Separator />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {pending && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelUpload}
                  className="h-10 sm:mr-auto"
                >
                  <X className="size-4" />
                  取消上传
                </Button>
              )}
              <Button type="submit" loading={pending} className="h-10 px-5">
                {pending ? '上传中…' : '创建并上传'}
              </Button>
            </div>
          </form>
        </Card>

        <FlowCard />
      </div>
    </div>
  )
}

/** 处理流程与上传限制说明 */
function FlowCard() {
  return (
    <Card className="lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle>处理流程说明</CardTitle>
      </CardHeader>

      <ol className="space-y-3">
        {FLOW_STAGES.map((status, index) => {
          const meta = MEETING_STATUS_META[status]
          return (
            <li key={status} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{meta.label}</p>
                <p className="text-xs text-muted-foreground">{meta.hint}</p>
              </div>
            </li>
          )
        })}

        <li className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-status-done/12 text-status-done">
            <CheckCircle2 className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{MEETING_STATUS_META.done.label}</p>
            <p className="text-xs text-muted-foreground">{MEETING_STATUS_META.done.hint}</p>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-status-failed/12 text-status-failed">
            <XCircle className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{MEETING_STATUS_META.failed.label}</p>
            <p className="text-xs text-muted-foreground">{MEETING_STATUS_META.failed.hint}</p>
          </div>
        </li>
      </ol>

      <Separator className="my-4" />

      <p className="text-xs leading-5 text-muted-foreground">
        失败可断点重试，已完成阶段不重复处理。转写结果会被保留，重试会从失败阶段继续。
      </p>

      <Separator className="my-4" />

      <dl className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">支持格式</dt>
          <dd className="max-w-[60%] text-right text-foreground/80">{UPLOAD_LIMITS.accept}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">单个文件上限</dt>
          <dd className="text-foreground/80">{UPLOAD_LIMITS.maxMB} MB</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">音频时长上限</dt>
          <dd className="text-foreground/80">{MAX_MINUTES} 分钟</dd>
        </div>
      </dl>
    </Card>
  )
}

/** Date → datetime-local 需要的本地时间字符串（不带时区） */
function toDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
