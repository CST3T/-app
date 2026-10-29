/**
 * 由 packages/contracts/openapi.yaml 生成的类型（v0.1 冻结版）。
 * 约定：所有枚举值与后端一一对应，前端不允许自造词。
 * 重新生成：make gen（当前为手写映射，字段与契约保持同步）
 */

/* ------------------------------------------------------------------ */
/* 枚举                                                                */
/* ------------------------------------------------------------------ */

/** 会议处理状态机：uploaded → transcribing → summarizing → done / failed */
export const MEETING_STATUSES = [
  'uploaded',
  'transcribing',
  'summarizing',
  'done',
  'failed',
] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/** 会议身份：描述该成员在这场会议里的职责，与工作区角色相互独立 */
export const MEETING_ROLES = ['host', 'recorder', 'participant', 'observer'] as const
export type MeetingRole = (typeof MEETING_ROLES)[number]

/** 会议资料分类，由 mime 与扩展名推导，用于决定预览方式 */
export const ATTACHMENT_KINDS = ['image', 'audio', 'video', 'doc', 'other'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const ACTION_STATUSES = ['todo', 'in_progress', 'done'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

export type Plan = 'free' | 'team'

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'SUMMARY_SCHEMA_INVALID',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/* ------------------------------------------------------------------ */
/* 统一响应信封                                                        */
/* ------------------------------------------------------------------ */

export interface ApiSuccess<T> {
  data: T
  request_id: string
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown> | null
  }
  request_id: string
}

/* ------------------------------------------------------------------ */
/* 实体                                                                */
/* ------------------------------------------------------------------ */

export interface User {
  id: string
  email: string
  name: string
  phone?: string | null
  avatar_url?: string | null
}

export interface Workspace {
  id: string
  name: string
  owner_id: string
  plan: Plan
  role: Role
  member_count: number
  meeting_count: number
  created_at: string
}

export interface WorkspaceMember {
  user_id: string
  email: string
  name: string
  phone?: string | null
  avatar_url?: string | null
  role: Role
  joined_at: string
}

/** 人员库（可被调用来添加成员的候选人） */
export interface MemberCandidate {
  user_id: string
  name: string
  phone: string
  email: string
  avatar_url?: string | null
  in_workspace: boolean
}

export interface AddWorkspaceMemberRequest {
  name: string
  phone: string
  email?: string
  role: Role
}

export interface Meeting {
  id: string
  workspace_id: string
  created_by: string
  title: string
  status: MeetingStatus
  progress: number
  audio_key: string | null
  audio_url: string | null
  audio_bytes: number | null
  duration_sec: number | null
  language: string
  started_at: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  error?: MeetingError | null
  /** 当前登录用户在该会议上的可用动作（由后端下发，前端不自行推导） */
  permissions?: MeetingPermissions
}

export interface MeetingError {
  code: ErrorCode
  message: string
  stage: 'transcribing' | 'summarizing' | null
  retryable: boolean
}

export interface MeetingPermissions {
  can_edit: boolean
  can_delete: boolean
  can_process: boolean
  can_comment: boolean
  can_share: boolean
  /** 是否可新增/移除参会成员、修改成员的会议身份 */
  can_manage_participants: boolean
  /** 是否可上传会议资料 */
  can_manage_attachments: boolean
}

/** 会议参会成员（会议身份与工作区角色解耦） */
export interface MeetingParticipant {
  user_id: string
  name: string
  email: string
  avatar_url?: string | null
  meeting_role: MeetingRole
  /** 创建者自动成为主持人且不可被移除 */
  is_creator: boolean
  joined_at: string
}

/** 会议资料：图片 / 音频 / 视频 / 文档，成员可共享 */
export interface MeetingAttachment {
  id: string
  meeting_id: string
  uploader_id: string
  uploader_name: string
  file_name: string
  mime_type: string
  size_bytes: number
  kind: AttachmentKind
  /** 内容地址（Mock 环境为 /api/v1/attachments/{id}/content） */
  url: string | null
  created_at: string
}

/** GET /meetings/{id} 的聚合返回 */
export interface MeetingDetail {
  meeting: Meeting
  summary: Summary | null
  action_items: ActionItem[]
  participants: MeetingParticipant[]
  attachments: MeetingAttachment[]
  permissions: MeetingPermissions
  counts: {
    segments: number
    action_items: number
    comments: number
    attachments: number
  }
}

export interface TranscriptSegment {
  id: string
  meeting_id: string
  seq: number
  start_ms: number
  end_ms: number
  speaker: string | null
  content: string
}

export interface SummaryContent {
  topics: string[]
  key_points: string[]
  decisions: string[]
  risks: string[]
  action_items: Array<{ title: string; owner?: string | null; due_date?: string | null }>
}

export interface Summary {
  id: string
  meeting_id: string
  model: string
  version: number
  content: SummaryContent
  status: 'ok' | 'schema_invalid' | 'degraded'
  created_at: string
}

export interface ActionItem {
  id: string
  meeting_id: string
  meeting_title?: string
  owner_id: string | null
  owner_name: string | null
  title: string
  status: ActionStatus
  priority: Priority
  due_date: string | null
  created_at: string
  updated_at: string
}

export interface Comment {
  id: string
  target_type: 'meeting' | 'action_item'
  target_id: string
  user_id: string
  user_name: string
  user_avatar_url?: string | null
  content: string
  created_at: string
}

export interface ShareLink {
  id: string
  meeting_id: string
  token: string
  scope: 'read' | 'read_transcript'
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface PublicShare {
  meeting: Pick<Meeting, 'id' | 'title' | 'duration_sec' | 'language' | 'started_at' | 'status'>
  summary: Summary | null
  transcript: TranscriptSegment[]
  action_items: ActionItem[]
  workspace_name: string
  expires_at: string | null
}

export interface AuditLog {
  id: string
  workspace_id: string
  actor_id: string
  actor_name: string
  action: string
  target: string
  created_at: string
}

export interface SearchHit {
  meeting_id: string
  meeting_title: string
  started_at: string
  source_type: 'title' | 'transcript' | 'summary' | 'action_item'
  snippet: string
  score: number
  start_ms?: number | null
}

export interface SearchResponse {
  query: string
  mode: 'keyword' | 'semantic' | 'hybrid'
  hits: SearchHit[]
  took_ms: number
}

/* ------------------------------------------------------------------ */
/* 请求体                                                              */
/* ------------------------------------------------------------------ */

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest extends LoginRequest {
  name: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
}

export interface MeResponse {
  user: User
  workspaces: Workspace[]
}

export interface CreateMeetingRequest {
  title: string
  started_at: string
  language: string
  /** 创建时一并邀请的参会成员与其会议身份 */
  participants?: Array<{ user_id: string; meeting_role: MeetingRole }>
}

export interface AddParticipantRequest {
  user_id: string
  meeting_role?: MeetingRole
}

export interface UpdateParticipantRequest {
  meeting_role: MeetingRole
}

export interface UpdateMeetingRequest {
  title?: string
  started_at?: string
  language?: string
}

export interface ListMeetingsQuery {
  status?: MeetingStatus | 'all'
  q?: string
  cursor?: string | null
  limit?: number
}

export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
  total: number
}

export interface ProcessResponse {
  meeting_id: string
  status: MeetingStatus
  progress: number
  job_id: string
}

export interface CreateActionItemRequest {
  title: string
  owner_id?: string | null
  priority?: Priority
  due_date?: string | null
  status?: ActionStatus
}

export interface UpdateActionItemRequest {
  title?: string
  owner_id?: string | null
  priority?: Priority
  due_date?: string | null
  status?: ActionStatus
}

/** 工作区级待办（跨会议聚合），供左侧「待办处理 / 待办提醒」使用 */
export interface WorkspaceTodo {
  id: string
  meeting_id: string
  meeting_title: string
  meeting_started_at: string
  owner_id: string | null
  owner_name: string | null
  title: string
  status: ActionStatus
  priority: Priority
  due_date: string | null
  /** 已过截止日且未完成 */
  is_overdue: boolean
  /** 逾期天数，未逾期为 0 */
  overdue_days: number
  reminder_sent_at: string | null
}

export interface WorkspaceTodoGroup {
  owner_id: string | null
  owner_name: string | null
  items: WorkspaceTodo[]
}

export interface WorkspaceTodosResponse {
  groups: WorkspaceTodoGroup[]
  summary: {
    total: number
    open: number
    overdue: number
    overdue_people: number
    reminded: number
  }
  permissions: {
    can_update: boolean
    can_remind: boolean
  }
  generated_at: string
}

export interface TodoReminderResult {
  todo_id: string
  owner_id: string | null
  owner_name: string | null
  reminded_at: string
  message: string
}

export interface CreateShareLinkRequest {
  scope?: 'read' | 'read_transcript'
  expires_in_hours?: number | null
}

/* ------------------------------------------------------------------ */
/* SSE 事件                                                            */
/* ------------------------------------------------------------------ */

export type SseEvent =
  | { event: 'status'; data: { status: MeetingStatus; progress: number } }
  | { event: 'progress'; data: { status: MeetingStatus; progress: number } }
  | { event: 'error'; data: { status: 'failed'; code: ErrorCode; message: string; stage: string | null; retryable: boolean } }
  | { event: 'done'; data: { status: 'done'; meeting_id: string } }
  | { event: 'ping'; data: { ts: string } }
