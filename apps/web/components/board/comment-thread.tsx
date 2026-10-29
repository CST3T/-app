'use client'

import * as React from 'react'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import {
  Button,
  EmptyState,
  ErrorState,
  Separator,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives'
import { useComments, useCreateComment, useDeleteComment } from '@/lib/api/hooks'
import { formatRelative } from '@/lib/format'

export function CommentThread({
  meetingId,
  canComment,
  currentUserId,
}: {
  meetingId: string
  canComment: boolean
  currentUserId?: string | null
}): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useComments(meetingId)
  const createComment = useCreateComment(meetingId)
  const deleteComment = useDeleteComment(meetingId)
  const [content, setContent] = React.useState('')

  const comments = data ?? []

  const submit = () => {
    const text = content.trim()
    if (!text || !canComment) return
    createComment.mutate(
      { content: text, target_type: 'meeting', target_id: meetingId },
      {
        onSuccess: () => {
          toast.success('评论已发送')
          setContent('')
        },
        onError: (err) => toast.error(err.message || '发送失败，请重试'),
      },
    )
  }

  const remove = (id: string) => {
    deleteComment.mutate(id, {
      onSuccess: () => toast.success('评论已删除'),
      onError: (err) => toast.error(err.message || '删除失败，请重试'),
    })
  }

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-3/4" />
        </div>
      ) : isError ? (
        <ErrorState
          title="评论加载失败"
          message={(error as Error | null)?.message}
          onRetry={() => void refetch()}
        />
      ) : comments.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-5" />}
          title="还没有评论"
          description="说点什么，记录会议中的想法与补充"
        />
      ) : (
        <ul className="space-y-1">
          {comments.map((comment, index) => (
            <li key={comment.id}>
              <div className="group flex gap-3 py-2.5">
                <Avatar name={comment.user_name} src={comment.user_avatar_url ?? undefined} className="size-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{comment.user_name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelative(comment.created_at)}
                    </span>
                    {currentUserId && comment.user_id === currentUserId && (
                      <button
                        type="button"
                        aria-label="删除评论"
                        onClick={() => remove(comment.id)}
                        disabled={deleteComment.isPending}
                        className={cn(
                          'ml-auto rounded p-1 text-muted-foreground/60 transition-colors hover:bg-surface-hover hover:text-status-failed',
                          'disabled:pointer-events-none disabled:opacity-50',
                        )}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">
                    {comment.content}
                  </p>
                </div>
              </div>
              {index < comments.length - 1 && <Separator className="my-1" />}
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <div className="space-y-2 rounded-xl border border-border/60 bg-surface/40 p-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="写下评论…（Enter 发送，Shift + Enter 换行）"
            className="min-h-[64px] resize-none bg-transparent"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              loading={createComment.isPending}
              disabled={!content.trim()}
              onClick={submit}
            >
              <Send className="size-3.5" />
              发送
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border/70 px-3 py-2.5 text-center text-xs text-muted-foreground">
          当前角色仅可查看
        </p>
      )}
    </div>
  )
}
