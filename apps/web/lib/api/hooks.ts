'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { request, upload } from './client'
import type {
  ActionItem,
  AddParticipantRequest,
  AddWorkspaceMemberRequest,
  AuditLog,
  Comment,
  CreateActionItemRequest,
  CursorPage,
  Meeting,
  MeetingAttachment,
  MeetingDetail,
  MeetingParticipant,
  MeetingRole,
  MemberCandidate,
  MeResponse,
  ProcessResponse,
  PublicShare,
  Role,
  SearchResponse,
  ShareLink,
  Summary,
  TodoReminderResult,
  TranscriptSegment,
  UpdateActionItemRequest,
  UpdateParticipantRequest,
  Workspace,
  WorkspaceMember,
  WorkspaceTodosResponse,
} from './types'

/* ------------------------------------------------------------------ */
/* Query Keys                                                          */
/* ------------------------------------------------------------------ */

export const qk = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  members: (wid: string) => ['workspaces', wid, 'members'] as const,
  audit: (wid: string) => ['workspaces', wid, 'audit'] as const,
  todos: (wid: string) => ['workspaces', wid, 'todos'] as const,
  directory: (wid: string) => ['workspaces', wid, 'directory'] as const,
  meetings: (wid: string, filters: Record<string, unknown>) => ['meetings', wid, filters] as const,
  meeting: (id: string) => ['meeting', id] as const,
  transcript: (id: string) => ['meeting', id, 'transcript'] as const,
  summary: (id: string) => ['meeting', id, 'summary'] as const,
  actionItems: (id: string) => ['meeting', id, 'action-items'] as const,
  comments: (id: string) => ['meeting', id, 'comments'] as const,
  shareLinks: (id: string) => ['meeting', id, 'share-links'] as const,
  search: (wid: string, q: string, mode: string) => ['search', wid, q, mode] as const,
  publicShare: (token: string) => ['public-share', token] as const,
}

/* ------------------------------------------------------------------ */
/* 认证与工作区                                                        */
/* ------------------------------------------------------------------ */

export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => request<MeResponse>('/me'),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  })
}

export function useWorkspace(wid: string) {
  return useQuery({
    queryKey: ['workspaces', wid],
    queryFn: () => request<Workspace>(`/workspaces/${wid}`),
    enabled: Boolean(wid),
  })
}

export function useMembers(wid: string, enabled = true) {
  return useQuery({
    queryKey: qk.members(wid),
    queryFn: () => request<WorkspaceMember[]>(`/workspaces/${wid}/members`),
    enabled: Boolean(wid) && enabled,
  })
}

export function useAuditLogs(wid: string, enabled = true) {
  return useQuery({
    queryKey: qk.audit(wid),
    queryFn: () => request<AuditLog[]>(`/workspaces/${wid}/audit-logs`),
    enabled: Boolean(wid) && enabled,
  })
}

/** 工作区级待办聚合：跨会议、按负责人分组 + 逾期摘要 */
export function useWorkspaceTodos(wid: string, enabled = true) {
  return useQuery({
    queryKey: qk.todos(wid),
    queryFn: () => request<WorkspaceTodosResponse>(`/workspaces/${wid}/todos`),
    enabled: Boolean(wid) && enabled,
    staleTime: 15_000,
  })
}

/** 给逾期待办的负责人发送提醒消息 */
export function useRemindTodo(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (todoId: string) =>
      request<TodoReminderResult>(`/workspaces/${wid}/todos/${todoId}/remind`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.todos(wid) }),
  })
}

/** 在待办页直接推进状态（复用会议内待办的 PATCH 接口） */
export function useUpdateWorkspaceTodo(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { itemId: string; meetingId: string; status: ActionItem['status'] }) =>
      request<ActionItem>(`/action-items/${vars.itemId}`, {
        method: 'PATCH',
        body: { status: vars.status },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.todos(wid) })
      qc.invalidateQueries({ queryKey: qk.actionItems(vars.meetingId) })
      qc.invalidateQueries({ queryKey: qk.meeting(vars.meetingId) })
    },
  })
}

export function useInviteMember(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddWorkspaceMemberRequest) =>
      request<WorkspaceMember>(`/workspaces/${wid}/members`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(wid) })
      qc.invalidateQueries({ queryKey: qk.audit(wid) })
      qc.invalidateQueries({ queryKey: qk.directory(wid) })
    },
  })
}

/** 人员库：可被调用来加入工作区的候选人（管理员可见） */
export function useMemberDirectory(wid: string, enabled = true) {
  return useQuery({
    queryKey: qk.directory(wid),
    queryFn: () => request<MemberCandidate[]>(`/workspaces/${wid}/member-directory`),
    enabled: Boolean(wid) && enabled,
    staleTime: 30_000,
  })
}

export function useUpdateMemberRole(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: Role }) =>
      request<WorkspaceMember>(`/workspaces/${wid}/members/${uid}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(wid) }),
  })
}

export function useRemoveMember(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uid: string) =>
      request<void>(`/workspaces/${wid}/members/${uid}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(wid) })
      qc.invalidateQueries({ queryKey: qk.audit(wid) })
      qc.invalidateQueries({ queryKey: qk.directory(wid) })
    },
  })
}

/* ------------------------------------------------------------------ */
/* 会议                                                                */
/* ------------------------------------------------------------------ */

export function useMeetings(
  wid: string,
  filters: { status?: string; q?: string; limit?: number } = {},
) {
  const status = filters.status ?? 'all'
  const q = filters.q ?? ''
  return useQuery({
    queryKey: qk.meetings(wid, { status, q, limit: filters.limit ?? 20 }),
    queryFn: () =>
      request<CursorPage<Meeting>>(`/workspaces/${wid}/meetings`, {
        query: { status, q, limit: filters.limit ?? 20 },
      }),
    enabled: Boolean(wid),
    placeholderData: (prev) => prev,
  })
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: qk.meeting(id),
    queryFn: () => request<MeetingDetail>(`/meetings/${id}`),
    enabled: Boolean(id),
  })
}

export function useTranscript(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.transcript(id),
    queryFn: () => request<TranscriptSegment[]>(`/meetings/${id}/transcript`),
    enabled: Boolean(id) && enabled,
  })
}

export function useSummary(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.summary(id),
    queryFn: () => request<{ latest: Summary; history: Summary[] }>(`/meetings/${id}/summary`),
    enabled: Boolean(id) && enabled,
    retry: false,
  })
}

export function useActionItems(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.actionItems(id),
    queryFn: () => request<ActionItem[]>(`/meetings/${id}/action-items`),
    enabled: Boolean(id) && enabled,
  })
}

export function useComments(id: string) {
  return useQuery({
    queryKey: qk.comments(id),
    queryFn: () => request<Comment[]>(`/meetings/${id}/comments`),
    enabled: Boolean(id),
  })
}

export function useShareLinks(id: string) {
  return useQuery({
    queryKey: qk.shareLinks(id),
    queryFn: () => request<ShareLink[]>(`/meetings/${id}/share-links`),
    enabled: Boolean(id),
  })
}

export function useSearch(wid: string, q: string, mode: 'keyword' | 'semantic' | 'hybrid' = 'hybrid') {
  return useQuery({
    queryKey: qk.search(wid, q, mode),
    queryFn: () => request<SearchResponse>(`/workspaces/${wid}/search`, { query: { q, mode } }),
    enabled: Boolean(wid) && q.trim().length > 0,
    placeholderData: (prev) => prev,
  })
}

export function usePublicShare(token: string) {
  return useQuery({
    queryKey: qk.publicShare(token),
    queryFn: () => request<PublicShare>(`/public/shares/${token}`, { auth: false }),
    enabled: Boolean(token),
    retry: false,
  })
}

/* ------------------------------------------------------------------ */
/* 变更                                                                */
/* ------------------------------------------------------------------ */

/** 创建会议 + 上传音频（XHR 带进度，可取消） */
export function useCreateMeeting(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      title: string
      startedAt: string
      language: string
      file: File
      participants?: Array<{ user_id: string; meeting_role: MeetingRole }>
      onProgress?: (percent: number) => void
      signal?: AbortSignal
      idempotencyKey?: string
    }) => {
      const form = new FormData()
      form.append('title', input.title)
      form.append('started_at', input.startedAt)
      form.append('language', input.language)
      form.append('participants', JSON.stringify(input.participants ?? []))
      form.append('audio', input.file)
      return upload<ProcessResponse & { id: string }>(`/workspaces/${wid}/meetings`, form, {
        onProgress: input.onProgress,
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings', wid] }),
  })
}

export function useUpdateMeeting(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title?: string; started_at?: string; language?: string }) =>
      request<Meeting>(`/meetings/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.meeting(id) })
      qc.invalidateQueries({ queryKey: ['meetings'] })
    },
  })
}

export function useDeleteMeeting(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/meetings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings', wid] }),
  })
}

export function useProcessMeeting(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: { from_stage?: 'transcribing' | 'summarizing' }) =>
      request<ProcessResponse>(`/meetings/${id}/${body?.from_stage ? 'retry' : 'process'}`, {
        method: 'POST',
        body: body ?? {},
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.meeting(id) }),
  })
}

export function useRegenerateSummary(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<ProcessResponse>(`/meetings/${id}/summary/regenerate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.meeting(id) }),
  })
}

/* ----------------------- 参会成员 / 会议资料 ----------------------- */

/** 细节数据里已包含成员与资料，这里只刷新详情本身 */
function useRefreshDetail(meetingId: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: qk.meeting(meetingId), exact: true })
}

export function useAddParticipant(meetingId: string) {
  const refresh = useRefreshDetail(meetingId)
  return useMutation({
    mutationFn: (body: AddParticipantRequest) =>
      request<MeetingParticipant>(`/meetings/${meetingId}/participants`, {
        method: 'POST',
        body,
      }),
    onSuccess: refresh,
  })
}

export function useUpdateParticipantRole(meetingId: string) {
  const refresh = useRefreshDetail(meetingId)
  return useMutation({
    mutationFn: ({ userId, ...body }: UpdateParticipantRequest & { userId: string }) =>
      request<MeetingParticipant>(`/meetings/${meetingId}/participants/${userId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: refresh,
  })
}

export function useRemoveParticipant(meetingId: string) {
  const refresh = useRefreshDetail(meetingId)
  return useMutation({
    mutationFn: (userId: string) =>
      request<void>(`/meetings/${meetingId}/participants/${userId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
}

/** 上传会议资料（XHR 带进度，可取消） */
export function useUploadAttachment(meetingId: string) {
  const refresh = useRefreshDetail(meetingId)
  return useMutation({
    mutationFn: async (input: {
      file: File
      onProgress?: (percent: number) => void
      signal?: AbortSignal
    }) => {
      const form = new FormData()
      form.append('file', input.file)
      return upload<MeetingAttachment>(`/meetings/${meetingId}/attachments`, form, {
        onProgress: input.onProgress,
        signal: input.signal,
      })
    },
    onSuccess: refresh,
  })
}

export function useDeleteAttachment(meetingId: string) {
  const refresh = useRefreshDetail(meetingId)
  return useMutation({
    mutationFn: (attachmentId: string) =>
      request<void>(`/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
}

/* --------------------------- 待办 --------------------------- */

export function useCreateActionItem(meetingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateActionItemRequest) =>
      request<ActionItem>(`/meetings/${meetingId}/action-items`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.actionItems(meetingId) })
      qc.invalidateQueries({ queryKey: qk.meeting(meetingId) })
    },
  })
}

/** 待办更新：乐观更新，拖拽改状态时零等待 */
export function useUpdateActionItem(meetingId: string) {
  const qc = useQueryClient()
  return useMutation<
    ActionItem,
    Error,
    { itemId: string } & UpdateActionItemRequest,
    { previous?: ActionItem[] }
  >({
    mutationFn: ({ itemId, ...body }) =>
      request<ActionItem>(`/action-items/${itemId}`, { method: 'PATCH', body }),
    onMutate: async ({ itemId, ...body }) => {
      await qc.cancelQueries({ queryKey: qk.actionItems(meetingId) })
      const previous = qc.getQueryData<ActionItem[]>(qk.actionItems(meetingId))
      qc.setQueryData<ActionItem[]>(qk.actionItems(meetingId), (old) =>
        (old ?? []).map((item) => (item.id === itemId ? { ...item, ...body } : item)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.actionItems(meetingId), ctx.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.actionItems(meetingId) })
      qc.invalidateQueries({ queryKey: qk.meeting(meetingId) })
    },
  })
}

export function useDeleteActionItem(meetingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => request<void>(`/action-items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.actionItems(meetingId) })
      qc.invalidateQueries({ queryKey: qk.meeting(meetingId) })
    },
  })
}

/* --------------------------- 评论 --------------------------- */

export function useCreateComment(meetingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { content: string; target_type?: 'meeting' | 'action_item'; target_id?: string }) =>
      request<Comment>(`/meetings/${meetingId}/comments`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.comments(meetingId) }),
  })
}

export function useDeleteComment(meetingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.comments(meetingId) }),
  })
}

/* --------------------------- 分享 --------------------------- */

export function useCreateShareLink(meetingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { scope?: 'read' | 'read_transcript'; expires_in_hours?: number | null }) =>
      request<ShareLink>(`/meetings/${meetingId}/share-links`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.shareLinks(meetingId) }),
  })
}

export function useRevokeShareLink(meetingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/share-links/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.shareLinks(meetingId) }),
  })
}

export type { UseMutationOptions }
