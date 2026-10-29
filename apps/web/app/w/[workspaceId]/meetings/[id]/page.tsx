'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarClock,
  FileAudio,
  Globe2,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Share2,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatBytes, formatDuration, formatMeetingTime } from '@/lib/format'
import { ApiError } from '@/lib/api/client'
import {
  useDeleteMeeting,
  useMe,
  useMeeting,
  useMembers,
  useUpdateMeeting,
} from '@/lib/api/hooks'
import { useMeetingEvents } from '@/lib/hooks/use-meeting-events'
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Label,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlay'
import { AudioPlayer } from '@/components/meetings/audio-player'
import { TranscriptPanel } from '@/components/meetings/transcript-panel'
import { SummaryPanel } from '@/components/meetings/summary-panel'
import { ShareDialog } from '@/components/meetings/share-dialog'
import { ProcessingBar, isProcessingStatus } from '@/components/meetings/processing-bar'
import { ActionBoard } from '@/components/board/action-board'
import { CommentThread } from '@/components/board/comment-thread'
import { ParticipantPanel } from '@/components/meetings/participant-panel'
import { AttachmentPanel } from '@/components/meetings/attachment-panel'

/** useSearchParams 必须被 Suspense 边界包裹，否则构建期报错 */
export default function MeetingDetailPage() {
  return (
    <React.Suspense fallback={<DetailSkeleton />}>
      <MeetingDetailContent />
    </React.Suspense>
  )
}

function MeetingDetailContent() {
  const params = useParams<{ workspaceId: string; id: string }>()
  const workspaceId = params.workspaceId
  const meetingId = params.id

  const { data, isLoading, isError, error, refetch } = useMeeting(meetingId)
  const { data: me } = useMe()
  const { data: members } = useMembers(workspaceId)
  const queryClient = useQueryClient()
  const [playedMs, setPlayedMs] = React.useState<number | undefined>()
  const [seekTo, setSeekTo] = React.useState<number | undefined>()
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const meeting = data?.meeting
  const permissions = data?.permissions
  /** SSE 只在处理中订阅；done/failed 时断开，避免无意义的常驻连接 */
  const processing = isProcessingStatus(meeting?.status ?? null)

  const stream = useMeetingEvents({
    meetingId,
    enabled: Boolean(meeting) && processing,
    onDone: () => {
      toast.success('处理完成，摘要与待办已生成')
      // 摘要/转写/待办此前可能是 404 或空，必须整体失效后重取
      void queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] })
    },
  })

  // 搜索页带 ?t= 跳转过来时定位到对应时间点
  const searchParams = useSearchParams()
  const initialMs = searchParams.get('t')
  React.useEffect(() => {
    if (initialMs && Number.isFinite(Number(initialMs))) setSeekTo(Number(initialMs))
  }, [initialMs])

  /** 转写分段点击 → 驱动播放器 seek；同时记录当前播放位置用于高亮 */
  const handleSeek = React.useCallback((ms: number) => {
    setSeekTo(ms)
    setPlayedMs(ms)
  }, [])

  if (isLoading) return <DetailSkeleton />
  if (isError) {
    const apiError = error as ApiError
    return (
      <div className="p-6">
        <ErrorState
          title={apiError?.status === 404 ? '会议不存在或已删除' : '会议加载失败'}
          message={
            apiError?.status === 404
              ? '该会议可能已被删除，或你没有访问权限。'
              : apiError?.message
          }
          requestId={apiError?.requestId}
          onRetry={apiError?.status === 404 ? undefined : () => refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button asChild variant="outline" size="sm">
            <Link href={`/w/${workspaceId}/meetings`}>
              <ArrowLeft className="size-3.5" />
              返回会议列表
            </Link>
          </Button>
        </div>
      </div>
    )
  }
  if (!meeting || !data) return null

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">
      {/* --------------------------- 页头 --------------------------- */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href={`/w/${workspaceId}/meetings`} className="transition-colors hover:text-foreground">
            会议
          </Link>
          <span>/</span>
          <span className="truncate text-foreground/80">{meeting.title}</span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{meeting.title}</h1>
              <StatusBadge status={stream.status ?? meeting.status} />
              {processing && <Badge tone="info">处理中</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" />
                {formatMeetingTime(meeting.started_at)}
              </span>
              <span className="flex items-center gap-1">
                <FileAudio className="size-3.5" />
                {formatDuration(meeting.duration_sec)} · {formatBytes(meeting.audio_bytes)}
              </span>
              <span className="flex items-center gap-1">
                <Globe2 className="size-3.5" />
                {languageLabel(meeting.language)}
              </span>
              <span className="flex items-center gap-1">
                <ListTodo className="size-3.5" />
                {data.counts.action_items} 条待办
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="size-3.5" />
                {data.counts.comments} 条评论
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-3.5" />
                {data.participants.length} 位参会
              </span>
              <span className="flex items-center gap-1">
                <Paperclip className="size-3.5" />
                {data.counts.attachments} 份资料
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {permissions?.can_edit && (
              <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
                <PenLine className="size-3.5" />
                编辑
              </Button>
            )}
            <ShareDialog
              meetingId={meetingId}
              canShare={Boolean(permissions?.can_share)}
              trigger={
                <Button variant="outline" size="sm">
                  <Share2 className="size-3.5" />
                  分享
                </Button>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="更多操作">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    void navigator.clipboard.writeText(`${window.location.origin}/w/${workspaceId}/meetings/${meetingId}`)
                    toast.success('会议链接已复制')
                  }}
                >
                  复制会议链接
                </DropdownMenuItem>
                {permissions?.can_delete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-status-failed"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="size-3.5" />
                      删除会议
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {permissions?.can_delete && (
              <DeleteMeetingDialog
                workspaceId={workspaceId}
                meetingId={meetingId}
                title={meeting.title}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
              />
            )}
          </div>
        </div>
      </div>

      {/* ------------------------- SSE 状态条 ------------------------- */}
      <div className="mb-4">
        <ProcessingBar
          meeting={meeting}
          stream={stream}
          canProcess={Boolean(permissions?.can_process)}
          onRefetch={() => void refetch()}
        />
      </div>

      {/* ------------------------ 主内容两栏 ------------------------ */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        {/* 左：播放器 + 转写 */}
        <div className="flex min-w-0 flex-col gap-3">
          <AudioPlayer
            src={meeting.audio_url}
            title={`${meeting.title} · 原始录音`}
            durationSec={meeting.duration_sec}
            currentMs={seekTo}
            onTimeChange={(ms) => setPlayedMs(ms)}
            onSeek={(ms) => setPlayedMs(ms)}
          />
          <Card className="flex min-h-[420px] flex-col overflow-hidden p-0 lg:h-[calc(100dvh-16rem)]">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
              <h2 className="text-sm font-semibold">转写稿</h2>
              <span className="text-[11px] text-muted-foreground">
                点击任意分段跳转播放 · {data.counts.segments} 段
              </span>
            </div>
            <TranscriptPanel
              meetingId={meetingId}
              status={stream.status ?? meeting.status}
              activeMs={playedMs}
              onSeek={handleSeek}
              canEditSpeaker={Boolean(permissions?.can_edit)}
              className="min-h-0 flex-1"
            />
          </Card>
        </div>

        {/* 右：摘要 / 待办 / 评论 / 成员 / 资料 */}
        <div className="min-w-0">
          <Tabs defaultValue="summary">
            <TabsList className="w-full">
              <TabsTrigger value="summary" className="flex-1 px-1.5 text-[13px]">
                摘要
              </TabsTrigger>
              <TabsTrigger value="board" className="flex-1 px-1.5 text-[13px]">
                看板
                <Badge tone="neutral" className="ml-0.5 px-1.5 py-0">
                  {data.counts.action_items}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="comments" className="flex-1 px-1.5 text-[13px]">
                评论
              </TabsTrigger>
              <TabsTrigger value="members" className="flex-1 px-1.5 text-[13px]">
                成员
              </TabsTrigger>
              <TabsTrigger value="files" className="flex-1 px-1.5 text-[13px]">
                资料
                {data.counts.attachments > 0 && (
                  <Badge tone="neutral" className="ml-0.5 px-1.5 py-0">
                    {data.counts.attachments}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              <SummaryPanel
                meetingId={meetingId}
                canEdit={Boolean(permissions?.can_edit)}
                status={stream.status ?? meeting.status}
              />
            </TabsContent>

            <TabsContent value="board">
              <ActionBoard
                meetingId={meetingId}
                workspaceId={workspaceId}
                canEdit={Boolean(permissions?.can_edit)}
                members={(members ?? []).map((m) => ({
                  user_id: m.user_id,
                  name: m.name,
                  email: m.email,
                }))}
              />
            </TabsContent>

            <TabsContent value="comments">
              <CommentThread
                meetingId={meetingId}
                canComment={Boolean(permissions?.can_comment)}
                currentUserId={me?.user.id}
              />
            </TabsContent>

            <TabsContent value="members">
              <ParticipantPanel
                meetingId={meetingId}
                workspaceId={workspaceId}
                participants={data.participants}
                canManage={Boolean(permissions?.can_manage_participants)}
              />
            </TabsContent>

            <TabsContent value="files">
              <AttachmentPanel
                meetingId={meetingId}
                attachments={data.attachments}
                canUpload={Boolean(permissions?.can_manage_attachments)}
                canManage={Boolean(permissions?.can_manage_attachments)}
                currentUserId={me?.user.id ?? null}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {renameOpen && (
        <RenameDialog
          meetingId={meetingId}
          title={meeting.title}
          startedAt={meeting.started_at}
          language={meeting.language}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function languageLabel(code: string) {
  const map: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語' }
  return map[code] ?? code
}

function RenameDialog({
  meetingId,
  title,
  startedAt,
  language,
  onClose,
}: {
  meetingId: string
  title: string
  startedAt: string
  language: string
  onClose: () => void
}) {
  const update = useUpdateMeeting(meetingId)
  const [value, setValue] = React.useState(title)
  const [when, setWhen] = React.useState(toLocalInput(startedAt))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="编辑会议" description="修改标题与开始时间，不会重新触发处理。">
        <div className="space-y-3">
          <div>
            <Label htmlFor="title">标题</Label>
            <Input id="title" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="started">开始时间</Label>
            <Input
              id="started"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              size="sm"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    title: value.trim() || title,
                    started_at: when ? new Date(when).toISOString() : startedAt,
                    language,
                  },
                  {
                    onSuccess: () => {
                      toast.success('已保存')
                      onClose()
                    },
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function toLocalInput(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 删除确认弹窗：必须放在下拉菜单之外，否则菜单关闭时弹窗会被一起卸载 */
function DeleteMeetingDialog({
  workspaceId,
  meetingId,
  title,
  open,
  onOpenChange,
}: {
  workspaceId: string
  meetingId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const del = useDeleteMeeting(workspaceId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="删除这场会议？"
        description={`「${title}」将被软删除，录音走异步清理，90 天后彻底移除。`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={del.isPending}
            onClick={() =>
              del.mutate(meetingId, {
                onSuccess: () => {
                  toast.success('会议已删除')
                  onOpenChange(false)
                  router.push(`/w/${workspaceId}/meetings`)
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-7 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <Skeleton className="mt-4 h-14 w-full" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-[420px] w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  )
}
