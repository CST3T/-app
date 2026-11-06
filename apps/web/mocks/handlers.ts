import { http, HttpResponse, delay } from 'msw'
import {
  buildMeetingDetail,
  db,
  DEMO_PASSWORD,
  findMeeting,
  findWorkspace,
} from './data'
import { enqueueJob, retryJob, subscribe, type SseMessage } from './pipeline'
import { attachmentKindOf } from '@/lib/format'
import type {
  ActionItem,
  AddWorkspaceMemberRequest,
  Comment,
  MemberCandidate,
  Meeting,
  MeetingAttachment,
  MeetingParticipant,
  MeetingRole,
  MeetingStatus,
  Priority,
  Role,
  ShareLink,
  Summary,
  TodoReminderResult,
  TranscriptSegment,
  WorkspaceTodo,
  WorkspaceTodoGroup,
  WorkspaceTodosResponse,
} from '@/lib/api/types'

const BASE = '/api/v1'

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

let requestSeq = 0
const nextRequestId = () => `req_mock_${(++requestSeq).toString(36).padStart(4, '0')}`

function ok<T>(data: T, status = 200) {
  return HttpResponse.json({ data, request_id: nextRequestId() }, { status })
}

function fail(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
) {
  return HttpResponse.json(
    { error: { code, message, details: details ?? null }, request_id: nextRequestId() },
    { status },
  )
}

function currentUser(request: Request) {
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  // token 形如 mock.access.{userId}
  const userId = token.split('.')[2]
  return db.users.find((u) => u.id === userId) ?? null
}

function roleOf(workspaceId: string, userId: string): Role | null {
  const member = db.workspaceMembers[workspaceId]?.find((m) => m.user_id === userId)
  return member?.role ?? null
}

const WRITE_ROLES: Role[] = ['owner', 'admin', 'member']

function canWrite(workspaceId: string, userId: string) {
  const role = roleOf(workspaceId, userId)
  return role !== null && WRITE_ROLES.includes(role)
}

function canAdmin(workspaceId: string, userId: string) {
  const role = roleOf(workspaceId, userId)
  return role === 'owner' || role === 'admin'
}

/** 校验登录 + 会议归属，返回 { meeting, user, role } 或错误响应 */
function guardMeeting(request: Request, meetingId: string) {
  const user = currentUser(request)
  if (!user) return { error: fail(401, 'UNAUTHORIZED', '登录已过期，请重新登录') } as const
  const meeting = findMeeting(meetingId)
  if (!meeting) return { error: fail(404, 'NOT_FOUND', '会议不存在或已被删除') } as const
  const role = roleOf(meeting.workspace_id, user.id)
  if (!role) return { error: fail(403, 'FORBIDDEN', '你不在该工作区中') } as const
  return { meeting, user, role } as const
}

/** 截止日按当天 23:59:59 计算，返回逾期天数（0 表示未逾期） */
const DAY_MS = 86_400_000
function overdueDaysOf(item: Pick<ActionItem, 'due_date' | 'status'>) {
  if (!item.due_date || item.status === 'done') return 0
  const deadline = +new Date(`${item.due_date}T23:59:59`)
  const diff = Date.now() - deadline
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS)
}

/** 把待办聚合成工作区视角的条目（带上会议标题与会议时间） */
function buildWorkspaceTodos(workspaceId: string): WorkspaceTodo[] {
  const meetings = db.meetings.filter((m) => m.workspace_id === workspaceId && !m.deleted_at)
  const meetingMap = new Map(meetings.map((m) => [m.id, m]))

  return db.actionItems
    .filter((item) => meetingMap.has(item.meeting_id))
    .map((item) => {
      const meeting = meetingMap.get(item.meeting_id)!
      const overdueDays = overdueDaysOf(item)
      return {
        id: item.id,
        meeting_id: item.meeting_id,
        meeting_title: meeting.title,
        meeting_started_at: meeting.started_at,
        owner_id: item.owner_id,
        owner_name: item.owner_name,
        title: item.title,
        status: item.status,
        priority: item.priority,
        due_date: item.due_date,
        is_overdue: overdueDays > 0,
        overdue_days: overdueDays,
        reminder_sent_at: db.todoReminders[item.id] ?? null,
      }
    })
    .sort((a, b) => {
      if (a.status === 'done' !== (b.status === 'done')) return a.status === 'done' ? 1 : -1
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date < b.due_date ? -1 : 1
      }
      return 0
    })
}

/** 按负责人分组，逾期多的人排前面 */
function groupWorkspaceTodos(items: WorkspaceTodo[]): WorkspaceTodoGroup[] {
  const groups = new Map<string, WorkspaceTodoGroup>()
  for (const item of items) {
    const key = item.owner_id ?? 'unassigned'
    const group = groups.get(key) ?? {
      owner_id: item.owner_id,
      owner_name: item.owner_name,
      items: [],
    }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => {
    const overdueA = a.items.filter((i) => i.is_overdue).length
    const overdueB = b.items.filter((i) => i.is_overdue).length
    if (overdueA !== overdueB) return overdueB - overdueA
    return (a.owner_name ?? '未分配').localeCompare(b.owner_name ?? '未分配', 'zh-CN')
  })
}

function workspaceTodoResponse(workspaceId: string, canWrite: boolean): WorkspaceTodosResponse {
  const items = buildWorkspaceTodos(workspaceId)
  const openItems = items.filter((item) => item.status !== 'done')
  const overdueItems = items.filter((item) => item.is_overdue)
  return {
    groups: groupWorkspaceTodos(items),
    summary: {
      total: items.length,
      open: openItems.length,
      overdue: overdueItems.length,
      overdue_people: new Set(overdueItems.map((item) => item.owner_id ?? 'unassigned')).size,
      reminded: items.filter((item) => item.reminder_sent_at).length,
    },
    permissions: { can_update: canWrite, can_remind: canWrite },
    generated_at: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------ */
/* 认证                                                                */
/* ------------------------------------------------------------------ */

const authHandlers = [
  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string; name: string }
    if (db.users.some((u) => u.email === body.email)) {
      return fail(400, 'VALIDATION_ERROR', '该邮箱已注册', { email: '该邮箱已注册' })
    }
    if (body.password.length < 8) {
      return fail(400, 'VALIDATION_ERROR', '密码至少 8 位', { password: '密码至少 8 位' })
    }
    const user = {
      id: `u_${Date.now().toString(36)}`,
      email: body.email,
      name: body.name,
      password: body.password,
      avatar_url: null,
    }
    db.users.push(user)
    // 新用户不属于任何工作区，进入后工作区列表为空，由用户自行创建
    return ok(
      {
        access_token: `mock.access.${user.id}`,
        refresh_token: `mock.refresh.${user.id}`,
        token_type: 'bearer',
        expires_in: 3600,
      },
      201,
    )
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    await delay(400)
    const body = (await request.json()) as { email: string; password: string }
    const user = db.users.find((u) => u.email === body.email)
    if (!user || user.password !== body.password) {
      // 统一错误码，不区分「用户不存在 / 密码错误」
      return fail(401, 'UNAUTHORIZED', '邮箱或密码不正确')
    }
    return ok({
      access_token: `mock.access.${user.id}`,
      refresh_token: `mock.refresh.${user.id}`,
      token_type: 'bearer',
      expires_in: 3600,
    })
  }),

  http.post(`${BASE}/auth/refresh`, async ({ request }) => {
    const body = (await request.json()) as { refresh_token: string }
    const userId = body.refresh_token?.split('.')[2]
    const user = db.users.find((u) => u.id === userId)
    if (!user) return fail(401, 'UNAUTHORIZED', '刷新凭证无效')
    return ok({
      access_token: `mock.access.${user.id}`,
      refresh_token: `mock.refresh.${user.id}`,
      token_type: 'bearer',
      expires_in: 3600,
    })
  }),

  http.get(`${BASE}/me`, async ({ request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '登录已过期，请重新登录')
    const workspaces = db.workspaces.filter((w) =>
      db.workspaceMembers[w.id]?.some((m) => m.user_id === user.id),
    )
    return ok({
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url },
      workspaces: workspaces.map((w) => ({
        ...w,
        role: roleOf(w.id, user.id) ?? w.role,
        member_count: db.workspaceMembers[w.id]?.length ?? 0,
        meeting_count: db.meetings.filter((m) => m.workspace_id === w.id && !m.deleted_at).length,
      })),
    })
  }),
]

/* ------------------------------------------------------------------ */
/* 工作区与成员                                                        */
/* ------------------------------------------------------------------ */

const workspaceHandlers = [
  http.get(`${BASE}/workspaces`, async ({ request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    return ok(db.workspaces.filter((w) => roleOf(w.id, user.id)))
  }),

  http.post(`${BASE}/workspaces`, async ({ request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    const body = (await request.json()) as { name: string }
    if (!body.name?.trim()) {
      return fail(400, 'VALIDATION_ERROR', '请填写工作区名称', { name: '不能为空' })
    }
    const workspace = {
      id: `ws_${Date.now().toString(36)}`,
      name: body.name,
      owner_id: user.id,
      plan: 'free' as const,
      role: 'owner' as Role,
      member_count: 1,
      meeting_count: 0,
      created_at: new Date().toISOString(),
    }
    db.workspaces.push(workspace)
    db.workspaceMembers[workspace.id] = [
      {
        user_id: user.id,
        email: user.email,
        name: user.name,
        role: 'owner',
        joined_at: new Date().toISOString(),
      },
    ]
    return ok(workspace, 201)
  }),

  http.get(`${BASE}/workspaces/:wid`, ({ params, request }) => {
    const user = currentUser(request)
    const workspace = findWorkspace(String(params.wid))
    if (!user || !workspace) return fail(404, 'NOT_FOUND', '工作区不存在')
    if (!roleOf(workspace.id, user.id)) return fail(403, 'FORBIDDEN', '你不在该工作区中')
    return ok({
      ...workspace,
      role: roleOf(workspace.id, user.id),
      member_count: db.workspaceMembers[workspace.id]?.length ?? 0,
      meeting_count: db.meetings.filter((m) => m.workspace_id === workspace.id && !m.deleted_at).length,
    })
  }),

  http.patch(`${BASE}/workspaces/:wid`, async ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !canAdmin(wid, user.id)) return fail(403, 'FORBIDDEN', '需要管理员及以上权限')
    const workspace = findWorkspace(wid)
    if (!workspace) return fail(404, 'NOT_FOUND', '工作区不存在')
    const body = (await request.json()) as { name?: string; plan?: 'free' | 'team' }
    if (body.name !== undefined) workspace.name = body.name
    if (body.plan !== undefined) workspace.plan = body.plan
    return ok(workspace)
  }),

  http.get(`${BASE}/workspaces/:wid/members`, ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !roleOf(wid, user.id)) return fail(403, 'FORBIDDEN', '你不在该工作区中')
    return ok(db.workspaceMembers[wid] ?? [])
  }),

  http.get(`${BASE}/workspaces/:wid/member-directory`, ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !canAdmin(wid, user.id)) return fail(403, 'FORBIDDEN', '需要管理员及以上权限')
    const members = db.workspaceMembers[wid] ?? []
    const candidates: MemberCandidate[] = db.users.map((u) => ({
      user_id: u.id,
      name: u.name,
      phone: u.phone ?? '',
      email: u.email,
      avatar_url: u.avatar_url ?? null,
      in_workspace: members.some((m) => m.user_id === u.id || m.phone === u.phone),
    }))
    return ok(candidates)
  }),

  http.post(`${BASE}/workspaces/:wid/members`, async ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !canAdmin(wid, user.id)) return fail(403, 'FORBIDDEN', '需要管理员及以上权限')
    const body = (await request.json()) as AddWorkspaceMemberRequest
    const name = body.name?.trim() ?? ''
    const phone = body.phone?.trim() ?? ''
    const email = body.email?.trim() || undefined

    if (!name) {
      return fail(400, 'VALIDATION_ERROR', '请填写成员姓名', { name: '请填写成员姓名' })
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return fail(400, 'VALIDATION_ERROR', '请输入 11 位手机号', {
        phone: '请输入正确的 11 位手机号',
      })
    }
    if (email && !email.includes('@')) {
      return fail(400, 'VALIDATION_ERROR', '请输入正确的邮箱', { email: '邮箱格式不正确' })
    }

    const members = db.workspaceMembers[wid] ?? []
    if (members.some((m) => m.phone === phone)) {
      return fail(409, 'STATE_CONFLICT', '该手机号对应的成员已在工作区中')
    }
    if (email && members.some((m) => m.email === email)) {
      return fail(409, 'STATE_CONFLICT', '该成员已在工作区中')
    }

    const known = db.users.find((u) => u.phone === phone || (email && u.email === email))
    const member = {
      user_id: known?.id ?? `u_invite_${Date.now().toString(36)}`,
      email: email ?? known?.email ?? '',
      name,
      phone,
      avatar_url: known?.avatar_url ?? null,
      role: body.role ?? ('member' as Role),
      joined_at: new Date().toISOString(),
    }
    members.push(member)
    db.workspaceMembers[wid] = members
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: wid,
      actor_id: user.id,
      actor_name: user.name,
      action: 'member.invite',
      target: `${name} · ${phone} · ${member.role}`,
      created_at: new Date().toISOString(),
    })
    return ok(member, 201)
  }),

  http.patch(`${BASE}/workspaces/:wid/members/:uid`, async ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    const uid = String(params.uid)
    if (!user || !canAdmin(wid, user.id)) return fail(403, 'FORBIDDEN', '需要管理员及以上权限')
    const member = db.workspaceMembers[wid]?.find((m) => m.user_id === uid)
    if (!member) return fail(404, 'NOT_FOUND', '成员不存在')
    if (member.role === 'owner') return fail(403, 'FORBIDDEN', '不能修改所有者的角色')
    const body = (await request.json()) as { role: Role }
    member.role = body.role
    return ok(member)
  }),

  http.delete(`${BASE}/workspaces/:wid/members/:uid`, ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    const uid = String(params.uid)
    if (!user || !canAdmin(wid, user.id)) return fail(403, 'FORBIDDEN', '需要管理员及以上权限')
    const member = db.workspaceMembers[wid]?.find((m) => m.user_id === uid)
    if (member?.role === 'owner') return fail(403, 'FORBIDDEN', '不能移除所有者')
    db.workspaceMembers[wid] = (db.workspaceMembers[wid] ?? []).filter((m) => m.user_id !== uid)
    if (member) {
      db.auditLogs.unshift({
        id: `ad_${Date.now().toString(36)}`,
        workspace_id: wid,
        actor_id: user.id,
        actor_name: user.name,
        action: 'member.remove',
        target: `${member.name} · ${member.phone ?? member.email}`,
        created_at: new Date().toISOString(),
      })
    }
    return new HttpResponse(null, { status: 204 })
  }),
]

/* ------------------------------------------------------------------ */
/* 工作区待办（跨会议聚合 + 逾期提醒）                                 */
/* ------------------------------------------------------------------ */

const workspaceTodoHandlers = [
  http.get(`${BASE}/workspaces/:wid/todos`, ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    if (!roleOf(wid, user.id)) return fail(403, 'FORBIDDEN', '你不在该工作区中')
    return ok(workspaceTodoResponse(wid, canWrite(wid, user.id)))
  }),

  http.post(`${BASE}/workspaces/:wid/todos/:todoId/remind`, async ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    const todoId = String(params.todoId)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    if (!canWrite(wid, user.id)) return fail(403, 'FORBIDDEN', '当前角色不能发送提醒')

    const item = db.actionItems.find((a) => a.id === todoId)
    if (!item) return fail(404, 'NOT_FOUND', '待办不存在或已被删除')
    const meeting = findMeeting(item.meeting_id)
    if (!meeting || meeting.workspace_id !== wid) {
      return fail(403, 'FORBIDDEN', '该待办不属于当前工作区')
    }
    if (!item.owner_id || !item.owner_name) {
      return fail(400, 'NO_OWNER', '该待办还没有负责人，无法发送提醒')
    }
    if (!overdueDaysOf(item)) {
      return fail(400, 'NOT_OVERDUE', '该待办尚未逾期，暂不需要提醒')
    }

    const remindedAt = new Date().toISOString()
    db.todoReminders[item.id] = remindedAt
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: wid,
      actor_id: user.id,
      actor_name: user.name,
      action: 'todo.remind',
      target: `${item.id} · ${item.owner_name} · ${item.title}`,
      created_at: remindedAt,
    })

    const result: TodoReminderResult = {
      todo_id: item.id,
      owner_id: item.owner_id,
      owner_name: item.owner_name,
      reminded_at: remindedAt,
      message: `已向 ${item.owner_name} 发送逾期提醒：${item.title}`,
    }
    return ok(result)
  }),
]

/* ------------------------------------------------------------------ */
/* 会议                                                                */
/* ------------------------------------------------------------------ */

const meetingHandlers = [
  http.get(`${BASE}/workspaces/:wid/meetings`, ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !roleOf(wid, user.id)) return fail(403, 'FORBIDDEN', '你不在该工作区中')

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const q = url.searchParams.get('q')?.trim().toLowerCase()
    const limit = Number(url.searchParams.get('limit') ?? 20)

    let items = db.meetings.filter((m) => m.workspace_id === wid && !m.deleted_at)
    if (status && status !== 'all') items = items.filter((m) => m.status === status)
    if (q) items = items.filter((m) => m.title.toLowerCase().includes(q))
    items = items.sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at))

    const total = items.length
    return ok({
      items: items.slice(0, limit).map((m) => ({ ...m, permissions: buildMeetingDetail(m, roleOf(wid, user.id)!).permissions })),
      next_cursor: items.length > limit ? String(limit) : null,
      total,
    })
  }),

  http.post(`${BASE}/workspaces/:wid/meetings`, async ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    if (!canWrite(wid, user.id)) return fail(403, 'FORBIDDEN', '当前角色不能创建会议')

    let title = ''
    let startedAt = new Date().toISOString()
    let language = 'zh'
    let audio: File | null = null
    let participantsRaw = ''

    const contentType = request.headers.get('Content-Type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      title = String(form.get('title') ?? '')
      startedAt = String(form.get('started_at') ?? startedAt)
      language = String(form.get('language') ?? 'zh')
      participantsRaw = String(form.get('participants') ?? '')
      const raw = form.get('audio')
      if (raw instanceof File && raw.size > 0) audio = raw
    } else {
      const body = (await request.json()) as Record<string, string>
      title = body.title ?? ''
      startedAt = body.started_at ?? startedAt
      language = body.language ?? 'zh'
      participantsRaw = body.participants ?? ''
    }

    if (!title.trim()) return fail(400, 'VALIDATION_ERROR', '请填写会议标题', { title: '不能为空' })
    if (!audio) return fail(400, 'VALIDATION_ERROR', '请上传录音文件', { audio: '不能为空' })
    if (audio.size > 200 * 1024 * 1024) {
      return fail(400, 'VALIDATION_ERROR', '文件超过 200MB 上限', { audio: '文件过大' })
    }

    const id = `mtg_${Date.now().toString(36)}`
    const meeting: Meeting = {
      id,
      workspace_id: wid,
      created_by: user.id,
      title,
      status: 'uploaded',
      progress: 0,
      audio_key: `${wid}/${id}/original.${audio.name.split('.').pop() ?? 'm4a'}`,
      audio_url: null,
      audio_bytes: audio.size,
      duration_sec: null,
      language,
      started_at: startedAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      error: null,
    }
    db.meetings.unshift(meeting)

    // 创建者自动成为主持人；随创建提交的成员按各自会议身份入列
    const roster: MeetingParticipant[] = [
      {
        user_id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url ?? null,
        meeting_role: 'host',
        is_creator: true,
        joined_at: meeting.created_at,
      },
    ]
    for (const invite of parseParticipantInvites(participantsRaw)) {
      if (invite.user_id === user.id) continue
      const member = db.workspaceMembers[wid]?.find((m) => m.user_id === invite.user_id)
      if (!member) continue
      if (roster.some((p) => p.user_id === member.user_id)) continue
      roster.push({
        user_id: member.user_id,
        name: member.name,
        email: member.email,
        avatar_url: member.avatar_url ?? null,
        meeting_role: invite.meeting_role === 'host' ? 'participant' : invite.meeting_role,
        is_creator: false,
        joined_at: meeting.created_at,
      })
    }
    db.meetingParticipants[id] = roster

    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: wid,
      actor_id: user.id,
      actor_name: user.name,
      action: 'meeting.create',
      target: `${id} · ${title}（${roster.length} 位参会）`,
      created_at: new Date().toISOString(),
    })

    const jobId = enqueueJob(id, 'transcribing')
    meeting.status = 'transcribing'
    meeting.progress = 2

    return ok(
      {
        id,
        meeting_id: id,
        status: 'uploaded' as MeetingStatus,
        progress: 0,
        job_id: jobId ?? 'job_unknown',
      },
      202,
    )
  }),

  http.get(`${BASE}/meetings/:id`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    return ok(buildMeetingDetail(guarded.meeting, guarded.role))
  }),

  http.patch(`${BASE}/meetings/:id`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能编辑会议')
    }
    const body = (await request.json()) as Partial<Meeting>
    if (body.title !== undefined) {
      if (!body.title.trim()) return fail(400, 'VALIDATION_ERROR', '标题不能为空', { title: '不能为空' })
      guarded.meeting.title = body.title
    }
    if (body.started_at !== undefined) guarded.meeting.started_at = body.started_at
    if (body.language !== undefined) guarded.meeting.language = body.language
    guarded.meeting.updated_at = new Date().toISOString()
    return ok(guarded.meeting)
  }),

  http.delete(`${BASE}/meetings/:id`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canAdmin(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '仅管理员及以上可删除会议')
    }
    guarded.meeting.deleted_at = new Date().toISOString()
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: guarded.meeting.workspace_id,
      actor_id: guarded.user.id,
      actor_name: guarded.user.name,
      action: 'meeting.delete',
      target: `${guarded.meeting.id} · ${guarded.meeting.title}`,
      created_at: new Date().toISOString(),
    })
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(`${BASE}/meetings/:id/audio`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    const form = await request.formData()
    const audio = form.get('audio')
    if (!(audio instanceof File)) return fail(400, 'VALIDATION_ERROR', '请上传音频文件')
    guarded.meeting.audio_key = `${guarded.meeting.workspace_id}/${guarded.meeting.id}/original.${audio.name.split('.').pop()}`
    guarded.meeting.audio_bytes = audio.size
    return ok(guarded.meeting, 201)
  }),

  /* ------------------------ 参会成员 ------------------------ */

  http.get(`${BASE}/meetings/:id/participants`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    return ok(db.meetingParticipants[guarded.meeting.id] ?? [])
  }),

  http.post(`${BASE}/meetings/:id/participants`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能管理参会成员')
    }
    const body = (await request.json()) as { user_id?: string; meeting_role?: MeetingRole }
    const member = db.workspaceMembers[guarded.meeting.workspace_id]?.find(
      (m) => m.user_id === body.user_id,
    )
    if (!member) {
      return fail(400, 'VALIDATION_ERROR', '该成员不在当前工作区中', { user_id: '无效成员' })
    }
    const nextRole: MeetingRole =
      body.meeting_role && MEETING_ROLE_VALUES.includes(body.meeting_role)
        ? body.meeting_role
        : 'participant'

    const roster = (db.meetingParticipants[guarded.meeting.id] ??= [])
    const existing = roster.find((p) => p.user_id === member.user_id)
    if (existing) {
      // 重复添加视为更新会议身份
      return ok(applyMeetingRole(roster, existing, nextRole))
    }

    const participant: MeetingParticipant = {
      user_id: member.user_id,
      name: member.name,
      email: member.email,
      avatar_url: member.avatar_url ?? null,
      meeting_role: nextRole,
      is_creator: false,
      joined_at: new Date().toISOString(),
    }
    roster.push(participant)
    applyMeetingRole(roster, participant, nextRole)

    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: guarded.meeting.workspace_id,
      actor_id: guarded.user.id,
      actor_name: guarded.user.name,
      action: 'meeting.participant.add',
      target: `${guarded.meeting.id} · ${member.name}（${nextRole}）`,
      created_at: new Date().toISOString(),
    })
    return ok(participant, 201)
  }),

  http.patch(`${BASE}/meetings/:id/participants/:uid`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能修改会议身份')
    }
    const roster = db.meetingParticipants[guarded.meeting.id] ?? []
    const participant = roster.find((p) => p.user_id === String(params.uid))
    if (!participant) return fail(404, 'NOT_FOUND', '该成员不在会议中')
    const body = (await request.json()) as { meeting_role?: MeetingRole }
    if (!body.meeting_role || !MEETING_ROLE_VALUES.includes(body.meeting_role)) {
      return fail(400, 'VALIDATION_ERROR', '会议身份不合法')
    }
    if (participant.is_creator && body.meeting_role !== 'host') {
      return fail(409, 'STATE_CONFLICT', '会议创建者必须是主持人')
    }
    return ok(applyMeetingRole(roster, participant, body.meeting_role))
  }),

  http.delete(`${BASE}/meetings/:id/participants/:uid`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能移除参会成员')
    }
    const roster = db.meetingParticipants[guarded.meeting.id] ?? []
    const participant = roster.find((p) => p.user_id === String(params.uid))
    if (!participant) return fail(404, 'NOT_FOUND', '该成员不在会议中')
    if (participant.is_creator) return fail(409, 'STATE_CONFLICT', '会议创建者不能被移除')
    db.meetingParticipants[guarded.meeting.id] = roster.filter(
      (p) => p.user_id !== participant.user_id,
    )
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: guarded.meeting.workspace_id,
      actor_id: guarded.user.id,
      actor_name: guarded.user.name,
      action: 'meeting.participant.remove',
      target: `${guarded.meeting.id} · ${participant.name}`,
      created_at: new Date().toISOString(),
    })
    return new HttpResponse(null, { status: 204 })
  }),

  /* ------------------------ 会议资料 ------------------------ */

  http.get(`${BASE}/meetings/:id/attachments`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    return ok(
      db.attachments
        .filter((a) => a.meeting_id === guarded.meeting.id)
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    )
  }),

  http.post(`${BASE}/meetings/:id/attachments`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能上传会议资料')
    }
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, 'VALIDATION_ERROR', '请选择要共享的文件', { file: '不能为空' })
    }
    if (file.size > 50 * 1024 * 1024) {
      return fail(400, 'VALIDATION_ERROR', '单个文件超过 50MB 上限', { file: '文件过大' })
    }

    const id = `att_${Date.now().toString(36)}`
    db.attachmentFiles[id] = file
    const attachment: MeetingAttachment = {
      id,
      meeting_id: guarded.meeting.id,
      uploader_id: guarded.user.id,
      uploader_name: guarded.user.name,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      kind: attachmentKindOf(file),
      url: `${BASE}/attachments/${id}/content`,
      created_at: new Date().toISOString(),
    }
    db.attachments.push(attachment)
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: guarded.meeting.workspace_id,
      actor_id: guarded.user.id,
      actor_name: guarded.user.name,
      action: 'meeting.attachment.upload',
      target: `${guarded.meeting.id} · ${file.name}`,
      created_at: new Date().toISOString(),
    })
    return ok(attachment, 201)
  }),

  // 资料内容：上传的原始字节优先，种子数据按类型生成占位内容便于预览
  http.get(`${BASE}/attachments/:aid/content`, ({ params }) => {
    const id = String(params.aid)
    const meta = db.attachments.find((a) => a.id === id)
    if (!meta) return new HttpResponse(null, { status: 404 })

    const stored = db.attachmentFiles[id]
    if (stored) {
      return new HttpResponse(stored, {
        headers: { 'Content-Type': meta.mime_type, 'Cache-Control': 'no-store' },
      })
    }
    if (meta.kind === 'image') {
      return new HttpResponse(demoImageSvg(meta.file_name), {
        headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    if (meta.kind === 'audio') {
      return new HttpResponse(demoToneWav(), {
        headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
      })
    }
    if (meta.kind === 'doc') {
      return new HttpResponse(
        `演示环境占位文件\n\n文件名：${meta.file_name}\n上传者：${meta.uploader_name}\n\n真实环境会返回对象存储的签名下载地址。`,
        { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
      )
    }
    return new HttpResponse(null, { status: 404 })
  }),

  http.delete(`${BASE}/attachments/:aid`, ({ params, request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    const attachment = db.attachments.find((a) => a.id === String(params.aid))
    if (!attachment) return fail(404, 'NOT_FOUND', '资料不存在')
    const meeting = findMeeting(attachment.meeting_id)
    const isAdmin = meeting ? canAdmin(meeting.workspace_id, user.id) : false
    if (attachment.uploader_id !== user.id && !isAdmin) {
      return fail(403, 'FORBIDDEN', '只能删除自己上传的资料')
    }
    db.attachments = db.attachments.filter((a) => a.id !== attachment.id)
    delete db.attachmentFiles[attachment.id]
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(`${BASE}/meetings/:id/process`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能触发处理')
    }
    if (guarded.meeting.status === 'transcribing' || guarded.meeting.status === 'summarizing') {
      return fail(409, 'STATE_CONFLICT', '该会议正在处理中，请勿重复提交')
    }
    const jobId = enqueueJob(guarded.meeting.id, 'transcribing')
    return ok(
      {
        meeting_id: guarded.meeting.id,
        status: 'transcribing' as MeetingStatus,
        progress: 2,
        job_id: jobId ?? 'job_unknown',
      },
      202,
    )
  }),

  http.post(`${BASE}/meetings/:id/retry`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能重试')
    }
    const body = (await request
      .json()
      .catch(() => ({}))) as { from_stage?: 'transcribing' | 'summarizing' }
    if (guarded.meeting.status === 'transcribing' || guarded.meeting.status === 'summarizing') {
      return fail(409, 'STATE_CONFLICT', '该会议正在处理中')
    }
    const jobId = retryJob(guarded.meeting.id, body.from_stage)
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: guarded.meeting.workspace_id,
      actor_id: guarded.user.id,
      actor_name: guarded.user.name,
      action: 'meeting.retry',
      target: `${guarded.meeting.id} · 从 ${body.from_stage ?? '断点'} 恢复`,
      created_at: new Date().toISOString(),
    })
    return ok(
      {
        meeting_id: guarded.meeting.id,
        status: guarded.meeting.status,
        progress: guarded.meeting.progress,
        job_id: jobId ?? 'job_unknown',
      },
      202,
    )
  }),

  /* ---------------------------- SSE ---------------------------- */
  http.get(`${BASE}/meetings/:id/events`, ({ params, request }) => {
    const meetingId = String(params.id)
    const guarded = guardMeeting(request, meetingId)
    if ('error' in guarded) return guarded.error

    const encoder = new TextEncoder()
    let unsubscribe: (() => void) | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let keepAlive: ReturnType<typeof setInterval> | null = null

    const stream = new ReadableStream({
      start(controller) {
        const send = (message: SseMessage) => {
          try {
            controller.enqueue(
              encoder.encode(`event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`),
            )
          } catch {
            /* 流已关闭 */
          }
        }

        // 订阅后先推一条当前状态 —— 断线重连即恢复到最新进度
        send({
          event: 'status',
          data: { status: guarded.meeting.status, progress: guarded.meeting.progress },
        })

        unsubscribe = subscribe(meetingId, send)

        // 保活心跳，避免中间层断连
        pingTimer = setInterval(() => send({ event: 'ping', data: { ts: new Date().toISOString() } }), 15000)

        // SSE 也需要响应客户端断开
        keepAlive = setInterval(() => {
          if (request.signal.aborted) cleanup()
        }, 500)

        void keepAlive

        request.signal.addEventListener('abort', cleanup)
      },
      cancel() {
        /* 由 request.signal 处理 */
      },
    })

    function cleanup() {
      unsubscribe?.()
      if (pingTimer) clearInterval(pingTimer)
      if (keepAlive) clearInterval(keepAlive)
      try {
        stream // no-op
      } catch {
        /* ignore */
      }
    }

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }),

  http.get(`${BASE}/meetings/:id/transcript`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    const segments = db.transcriptSegments
      .filter((s) => s.meeting_id === guarded.meeting.id)
      .sort((a, b) => a.seq - b.seq)
    return ok(segments)
  }),

  http.get(`${BASE}/meetings/:id/summary`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    const versions = db.summaries
      .filter((s) => s.meeting_id === guarded.meeting.id)
      .sort((a, b) => b.version - a.version)
    if (versions.length === 0) return fail(404, 'NOT_FOUND', '该会议还没有摘要')
    return ok({ latest: versions[0], history: versions })
  }),

  http.post(`${BASE}/meetings/:id/summary/regenerate`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能重新生成摘要')
    }
    if (guarded.meeting.status === 'transcribing' || guarded.meeting.status === 'summarizing') {
      return fail(409, 'STATE_CONFLICT', '该会议正在处理中')
    }
    const jobId = enqueueJob(guarded.meeting.id, 'summarizing')
    return ok(
      {
        meeting_id: guarded.meeting.id,
        status: 'summarizing' as MeetingStatus,
        progress: 70,
        job_id: jobId ?? 'job_unknown',
      },
      202,
    )
  }),
]

/* ------------------------------------------------------------------ */
/* 待办 / 评论 / 搜索 / 分享 / 审计                                     */
/* ------------------------------------------------------------------ */

const collaborationHandlers = [
  http.get(`${BASE}/meetings/:id/action-items`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const owner = url.searchParams.get('owner_id')
    let items = db.actionItems.filter((a) => a.meeting_id === guarded.meeting.id)
    if (status && status !== 'all') items = items.filter((a) => a.status === status)
    if (owner) items = items.filter((a) => a.owner_id === owner)
    return ok(items)
  }),

  http.post(`${BASE}/meetings/:id/action-items`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能新增待办')
    }
    const body = (await request.json()) as Partial<ActionItem>
    if (!body.title?.trim()) return fail(400, 'VALIDATION_ERROR', '请填写待办内容', { title: '不能为空' })
    const owner = db.users.find((u) => u.id === body.owner_id)
    const item: ActionItem = {
      id: `ai_${Date.now().toString(36)}`,
      meeting_id: guarded.meeting.id,
      owner_id: body.owner_id ?? null,
      owner_name: owner?.name ?? null,
      title: body.title,
      status: body.status ?? 'todo',
      priority: (body.priority ?? 'medium') as Priority,
      due_date: body.due_date ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    db.actionItems.push(item)
    return ok(item, 201)
  }),

  http.patch(`${BASE}/action-items/:itemId`, async ({ params, request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    const item = db.actionItems.find((a) => a.id === String(params.itemId))
    if (!item) return fail(404, 'NOT_FOUND', '待办不存在')
    const meeting = findMeeting(item.meeting_id)
    if (!meeting || !canWrite(meeting.workspace_id, user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能编辑待办')
    }
    const body = (await request.json()) as Partial<ActionItem>
    Object.assign(item, {
      title: body.title ?? item.title,
      status: body.status ?? item.status,
      priority: body.priority ?? item.priority,
      due_date: body.due_date !== undefined ? body.due_date : item.due_date,
      owner_id: body.owner_id !== undefined ? body.owner_id : item.owner_id,
    })
    if (body.owner_id !== undefined) {
      item.owner_name = db.users.find((u) => u.id === body.owner_id)?.name ?? null
    }
    item.updated_at = new Date().toISOString()
    return ok(item)
  }),

  http.delete(`${BASE}/action-items/:itemId`, ({ params, request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    const item = db.actionItems.find((a) => a.id === String(params.itemId))
    if (!item) return fail(404, 'NOT_FOUND', '待办不存在')
    const meeting = findMeeting(item.meeting_id)
    if (!meeting || !canWrite(meeting.workspace_id, user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能删除待办')
    }
    db.actionItems = db.actionItems.filter((a) => a.id !== item.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${BASE}/meetings/:id/comments`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    return ok(
      db.comments
        .filter((c) => c.target_id === guarded.meeting.id)
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    )
  }),

  http.post(`${BASE}/meetings/:id/comments`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能评论')
    }
    const body = (await request.json()) as { content: string; target_type?: 'meeting' | 'action_item'; target_id?: string }
    if (!body.content?.trim()) return fail(400, 'VALIDATION_ERROR', '评论不能为空')
    const comment: Comment = {
      id: `cm_${Date.now().toString(36)}`,
      target_type: body.target_type ?? 'meeting',
      target_id: body.target_id ?? guarded.meeting.id,
      user_id: guarded.user.id,
      user_name: guarded.user.name,
      user_avatar_url: guarded.user.avatar_url,
      content: body.content.trim(),
      created_at: new Date().toISOString(),
    }
    db.comments.push(comment)
    return ok(comment, 201)
  }),

  http.delete(`${BASE}/comments/:id`, ({ params, request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    const comment = db.comments.find((c) => c.id === String(params.id))
    if (!comment) return fail(404, 'NOT_FOUND', '评论不存在')
    const meeting = findMeeting(comment.target_id) ?? findMeeting(
      db.actionItems.find((a) => a.id === comment.target_id)?.meeting_id ?? '',
    )
    const isAdmin = meeting ? canAdmin(meeting.workspace_id, user.id) : false
    if (comment.user_id !== user.id && !isAdmin) {
      return fail(403, 'FORBIDDEN', '只能删除自己的评论')
    }
    db.comments = db.comments.filter((c) => c.id !== comment.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${BASE}/workspaces/:wid/search`, async ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !roleOf(wid, user.id)) return fail(403, 'FORBIDDEN', '你不在该工作区中')
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const mode = (url.searchParams.get('mode') ?? 'hybrid') as 'keyword' | 'semantic' | 'hybrid'

    await delay(320)
    if (!q) return ok({ query: '', mode, hits: [], took_ms: 0 })

    const meetingIds = db.meetings
      .filter((m) => m.workspace_id === wid && !m.deleted_at)
      .map((m) => m.id)

    const hits: Array<{
      meeting_id: string
      meeting_title: string
      started_at: string
      source_type: 'title' | 'transcript' | 'summary' | 'action_item'
      snippet: string
      score: number
      start_ms?: number | null
    }> = []

    db.meetings
      .filter((m) => meetingIds.includes(m.id) && m.title.toLowerCase().includes(q))
      .forEach((m) =>
        hits.push({
          meeting_id: m.id,
          meeting_title: m.title,
          started_at: m.started_at,
          source_type: 'title',
          snippet: m.title,
          score: 0.98,
        }),
      )

    db.transcriptSegments
      .filter((s) => meetingIds.includes(s.meeting_id) && s.content.toLowerCase().includes(q))
      .forEach((s) => {
        const meeting = db.meetings.find((m) => m.id === s.meeting_id)!
        hits.push({
          meeting_id: s.meeting_id,
          meeting_title: meeting.title,
          started_at: meeting.started_at,
          source_type: 'transcript',
          snippet: highlight(s.content, q),
          score: 0.86,
          start_ms: s.start_ms,
        })
      })

    db.summaries
      .filter((s) => meetingIds.includes(s.meeting_id))
      .forEach((s) => {
        const pool = [
          ...s.content.topics,
          ...s.content.key_points,
          ...s.content.decisions,
          ...s.content.risks,
        ]
        pool
          .filter((line) => line.toLowerCase().includes(q))
          .forEach((line) => {
            const meeting = db.meetings.find((m) => m.id === s.meeting_id)!
            hits.push({
              meeting_id: s.meeting_id,
              meeting_title: meeting.title,
              started_at: meeting.started_at,
              source_type: 'summary',
              snippet: highlight(line, q),
              score: 0.78,
            })
          })
      })

    db.actionItems
      .filter((a) => meetingIds.includes(a.meeting_id) && a.title.toLowerCase().includes(q))
      .forEach((a) => {
        const meeting = db.meetings.find((m) => m.id === a.meeting_id)!
        hits.push({
          meeting_id: a.meeting_id,
          meeting_title: meeting.title,
          started_at: meeting.started_at,
          source_type: 'action_item',
          snippet: highlight(a.title, q),
          score: 0.74,
        })
      })

    return ok({
      query: q,
      mode,
      hits: hits.sort((a, b) => b.score - a.score).slice(0, 30),
      took_ms: 12 + Math.round(Math.random() * 60),
    })
  }),

  http.get(`${BASE}/meetings/:id/share-links`, ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    return ok(db.shareLinks.filter((s) => s.meeting_id === guarded.meeting.id))
  }),

  http.post(`${BASE}/meetings/:id/share-links`, async ({ params, request }) => {
    const guarded = guardMeeting(request, String(params.id))
    if ('error' in guarded) return guarded.error
    if (!canWrite(guarded.meeting.workspace_id, guarded.user.id)) {
      return fail(403, 'FORBIDDEN', '当前角色不能创建分享链接')
    }
    const body = (await request.json().catch(() => ({}))) as {
      scope?: 'read' | 'read_transcript'
      expires_in_hours?: number | null
    }
    const link: ShareLink = {
      id: `sl_${Date.now().toString(36)}`,
      meeting_id: guarded.meeting.id,
      token: `shr_${Math.random().toString(36).slice(2, 12)}`,
      scope: body.scope ?? 'read_transcript',
      expires_at:
        body.expires_in_hours === null || body.expires_in_hours === undefined
          ? null
          : new Date(Date.now() + body.expires_in_hours * 3600_000).toISOString(),
      revoked_at: null,
      created_at: new Date().toISOString(),
    }
    db.shareLinks.push(link)
    db.auditLogs.unshift({
      id: `ad_${Date.now().toString(36)}`,
      workspace_id: guarded.meeting.workspace_id,
      actor_id: guarded.user.id,
      actor_name: guarded.user.name,
      action: 'share.create',
      target: `${guarded.meeting.id} · ${link.scope}`,
      created_at: new Date().toISOString(),
    })
    return ok(link, 201)
  }),

  http.delete(`${BASE}/share-links/:id`, ({ params, request }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'UNAUTHORIZED', '请先登录')
    const link = db.shareLinks.find((s) => s.id === String(params.id))
    if (!link) return fail(404, 'NOT_FOUND', '分享链接不存在')
    const meeting = findMeeting(link.meeting_id)
    if (!meeting || !canAdmin(meeting.workspace_id, user.id)) {
      return fail(403, 'FORBIDDEN', '仅管理员及以上可撤销分享')
    }
    link.revoked_at = new Date().toISOString()
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${BASE}/public/shares/:token`, ({ params }) => {
    const link = db.shareLinks.find((s) => s.token === String(params.token))
    if (!link) return fail(404, 'NOT_FOUND', '分享链接不存在')
    if (link.revoked_at) return fail(410 as never, 'NOT_FOUND', '分享链接已被撤销')
    if (link.expires_at && +new Date(link.expires_at) < Date.now()) {
      return fail(410 as never, 'NOT_FOUND', '分享链接已过期')
    }
    const meeting = findMeeting(link.meeting_id)
    if (!meeting) return fail(404, 'NOT_FOUND', '会议不存在')
    const summary =
      db.summaries.filter((s) => s.meeting_id === meeting.id).sort((a, b) => b.version - a.version)[0] ??
      null
    return ok({
      meeting: {
        id: meeting.id,
        title: meeting.title,
        duration_sec: meeting.duration_sec,
        language: meeting.language,
        started_at: meeting.started_at,
        status: meeting.status,
      },
      summary,
      transcript:
        link.scope === 'read_transcript'
          ? db.transcriptSegments.filter((s) => s.meeting_id === meeting.id).sort((a, b) => a.seq - b.seq)
          : [],
      action_items: db.actionItems.filter((a) => a.meeting_id === meeting.id),
      workspace_name: findWorkspace(meeting.workspace_id)?.name ?? '共享工作区',
      expires_at: link.expires_at,
    })
  }),

  http.get(`${BASE}/workspaces/:wid/audit-logs`, ({ params, request }) => {
    const user = currentUser(request)
    const wid = String(params.wid)
    if (!user || !canAdmin(wid, user.id)) return fail(403, 'FORBIDDEN', '仅管理员及以上可查看审计日志')
    return ok(
      db.auditLogs
        .filter((a) => a.workspace_id === wid)
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    )
  }),

  http.get(`${BASE}/health`, () => ok({ status: 'ok', mock: true })),
]

const MEETING_ROLE_VALUES: MeetingRole[] = ['host', 'recorder', 'participant', 'observer']

/** 创建会议时表单里以 JSON 字符串提交参会成员与其会议身份 */
function parseParticipantInvites(
  raw: string,
): Array<{ user_id: string; meeting_role: MeetingRole }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is { user_id: string; meeting_role?: MeetingRole } =>
          Boolean(item) && typeof (item as { user_id?: unknown }).user_id === 'string',
      )
      .map((item) => ({
        user_id: item.user_id,
        meeting_role:
          item.meeting_role && MEETING_ROLE_VALUES.includes(item.meeting_role)
            ? item.meeting_role
            : 'participant',
      }))
  } catch {
    return []
  }
}

/** 一场会议只保留一位主持人：设置新主持人时原主持人降级为参会人 */
function applyMeetingRole(
  roster: MeetingParticipant[],
  target: MeetingParticipant,
  role: MeetingRole,
): MeetingParticipant {
  if (role === 'host') {
    roster.forEach((p) => {
      if (p.user_id !== target.user_id && p.meeting_role === 'host') {
        p.meeting_role = 'participant'
      }
    })
  }
  target.meeting_role = role
  return target
}

/** 种子图片资料没有真实文件时，生成一张同尺寸占位图便于演示预览 */
function demoImageSvg(fileName: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400" role="img" aria-label="${fileName.replace(
    /[<>&"]/g,
    '',
  )}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2333"/><stop offset="1" stop-color="#2b3550"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <g stroke="#4d5b7d" stroke-opacity="0.3" stroke-width="1">
    ${[100, 200, 300].map((y) => `<line x1="0" y1="${y}" x2="640" y2="${y}"/>`).join('')}
    ${[160, 320, 480].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="400"/>`).join('')}
  </g>
  <rect x="80" y="76" width="200" height="110" rx="14" fill="#6f8cff" fill-opacity="0.28" stroke="#8aa2ff"/>
  <rect x="300" y="116" width="200" height="110" rx="14" fill="#4fd1b5" fill-opacity="0.2" stroke="#63d9c0"/>
  <rect x="176" y="228" width="260" height="92" rx="14" fill="#f5b544" fill-opacity="0.16" stroke="#f0bd63"/>
</svg>`
}

/** 种子音频资料没有真实文件时，生成一段 1.2s 的轻提示音 */
function demoToneWav(seconds = 1.2, freq = 320) {
  const rate = 8000
  const samples = Math.floor(rate * seconds)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate
    const env = Math.max(0, Math.min(1, t / 0.05, (seconds - t) / 0.2))
    const value = Math.sin(2 * Math.PI * freq * t) * 0.18 * env
    view.setInt16(44 + i * 2, Math.round(value * 0x7fff), true)
  }
  return buffer
}

function highlight(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query)
  if (index < 0) return text
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + query.length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** 演示数据的密码提示（登录页展示用） */
void DEMO_PASSWORD

export const handlers = [
  ...authHandlers,
  ...workspaceHandlers,
  ...workspaceTodoHandlers,
  ...meetingHandlers,
  ...collaborationHandlers,
]

/** 供测试与调试使用：重置内存库 */
export { db as mockDb }
export type { Summary, TranscriptSegment }
