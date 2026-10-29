import type {
  ActionItem,
  AuditLog,
  Comment,
  Meeting,
  MeetingAttachment,
  MeetingDetail,
  MeetingParticipant,
  ShareLink,
  Summary,
  TranscriptSegment,
  User,
  Workspace,
  WorkspaceMember,
} from '@/lib/api/types'

/* ------------------------------------------------------------------ */
/* 演示数据（对应 DB-02：1 工作区 / 3 场会议，可重复导入）              */
/* ------------------------------------------------------------------ */

export const DEMO_PASSWORD = 'minutes2026'

/** 演示用相对日期：以「今天」为基准，保证逾期数量与演示效果不随真实日期漂移 */
function dueIn(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const users: Array<User & { password: string }> = [
  { id: 'u_lin', email: 'demo@minutes.dev', name: '林知远', phone: '13800138001', password: DEMO_PASSWORD, avatar_url: null },
  { id: 'u_chen', email: 'chen@minutes.dev', name: '陈慕', phone: '13800138002', password: DEMO_PASSWORD, avatar_url: null },
  { id: 'u_wang', email: 'wang@minutes.dev', name: '王砚', phone: '13800138003', password: DEMO_PASSWORD, avatar_url: null },
  { id: 'u_zhao', email: 'zhao@minutes.dev', name: '赵时', phone: '13800138004', password: DEMO_PASSWORD, avatar_url: null },
  { id: 'u_sun', email: 'sun@minutes.dev', name: '孙澄', phone: '13800138005', password: DEMO_PASSWORD, avatar_url: null },
  { id: 'u_qian', email: 'qian@minutes.dev', name: '钱屿', phone: '13800138006', password: DEMO_PASSWORD, avatar_url: null },
]

export const workspaces: Workspace[] = [
  {
    id: 'ws_demo',
    name: '产品研发中心',
    owner_id: 'u_lin',
    plan: 'team',
    role: 'owner',
    member_count: 4,
    meeting_count: 3,
    created_at: '2026-08-01T02:00:00Z',
  },
  {
    id: 'ws_lab',
    name: 'AI 实验室',
    owner_id: 'u_chen',
    plan: 'free',
    role: 'member',
    member_count: 3,
    meeting_count: 1,
    created_at: '2026-09-12T06:30:00Z',
  },
]

export const workspaceMembers: Record<string, WorkspaceMember[]> = {
  ws_demo: [
    { user_id: 'u_lin', email: 'demo@minutes.dev', name: '林知远', phone: '13800138001', role: 'owner', joined_at: '2026-08-01T02:00:00Z' },
    { user_id: 'u_chen', email: 'chen@minutes.dev', name: '陈慕', phone: '13800138002', role: 'admin', joined_at: '2026-08-02T03:10:00Z' },
    { user_id: 'u_wang', email: 'wang@minutes.dev', name: '王砚', phone: '13800138003', role: 'member', joined_at: '2026-08-05T07:20:00Z' },
    { user_id: 'u_zhao', email: 'zhao@minutes.dev', name: '赵时', phone: '13800138004', role: 'viewer', joined_at: '2026-09-01T01:00:00Z' },
  ],
  ws_lab: [
    { user_id: 'u_chen', email: 'chen@minutes.dev', name: '陈慕', phone: '13800138002', role: 'owner', joined_at: '2026-09-12T06:30:00Z' },
    { user_id: 'u_lin', email: 'demo@minutes.dev', name: '林知远', phone: '13800138001', role: 'member', joined_at: '2026-09-12T06:31:00Z' },
    { user_id: 'u_wang', email: 'wang@minutes.dev', name: '王砚', phone: '13800138003', role: 'viewer', joined_at: '2026-09-20T02:00:00Z' },
  ],
}

/* ------------------------------ 会议 ------------------------------ */

export const meetings: Meeting[] = [
  {
    id: 'mtg_01JABCWEEKLY',
    workspace_id: 'ws_demo',
    created_by: 'u_lin',
    title: '产品周会 · Q4 首个迭代',
    status: 'done',
    progress: 100,
    audio_key: 'ws_demo/mtg_01JABCWEEKLY/original.m4a',
    audio_url: null,
    audio_bytes: 18_452_480,
    duration_sec: 2712,
    language: 'zh',
    started_at: '2026-10-20T02:00:00Z',
    created_at: '2026-10-20T02:46:00Z',
    updated_at: '2026-10-20T02:52:00Z',
    deleted_at: null,
    error: null,
  },
  {
    id: 'mtg_01JABCAPI',
    workspace_id: 'ws_demo',
    created_by: 'u_chen',
    title: '跨团队接口对齐会',
    status: 'done',
    progress: 100,
    audio_key: 'ws_demo/mtg_01JABCAPI/original.mp3',
    audio_url: null,
    audio_bytes: 11_204_608,
    duration_sec: 1860,
    language: 'zh',
    started_at: '2026-10-22T07:00:00Z',
    created_at: '2026-10-22T07:33:00Z',
    updated_at: '2026-10-22T07:39:00Z',
    deleted_at: null,
    error: null,
  },
  {
    id: 'mtg_01JABCFAILED',
    workspace_id: 'ws_demo',
    created_by: 'u_wang',
    title: '增长实验复盘',
    status: 'failed',
    progress: 62,
    audio_key: 'ws_demo/mtg_01JABCFAILED/original.m4a',
    audio_url: null,
    audio_bytes: 24_117_248,
    duration_sec: 2405,
    language: 'zh',
    started_at: '2026-10-24T09:30:00Z',
    created_at: '2026-10-24T10:12:00Z',
    updated_at: '2026-10-24T10:19:00Z',
    deleted_at: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: '摘要服务超时（LLM 响应超过 60s）',
      stage: 'summarizing',
      retryable: true,
    },
  },
]

/* --------------------------- 转写分段 --------------------------- */

function seg(
  meetingId: string,
  seq: number,
  startMs: number,
  endMs: number,
  speaker: string | null,
  content: string,
): TranscriptSegment {
  return {
    id: `${meetingId}_s${String(seq).padStart(3, '0')}`,
    meeting_id: meetingId,
    seq,
    start_ms: startMs,
    end_ms: endMs,
    speaker,
    content,
  }
}

export const transcriptSegments: TranscriptSegment[] = [
  seg('mtg_01JABCWEEKLY', 1, 0, 18400, '林知远', '大家早，今天周会控制在 45 分钟。先过一下上个迭代的完成度，然后定新迭代的范围。'),
  seg('mtg_01JABCWEEKLY', 2, 18400, 46200, '陈慕', '上个迭代一共排了 14 个需求，交付 11 个，3 个顺延。顺延的里面两个是依赖后端接口，一个是设计稿改版。'),
  seg('mtg_01JABCWEEKLY', 3, 46200, 78500, '林知远', '顺延的三个我们不要塞进新迭代，先把新迭代的目标定清楚。这个季度的核心目标是「会议纪要闭环可用」，也就是上传到待办能跑通。'),
  seg('mtg_01JABCWEEKLY', 4, 78500, 112000, '王砚', '那前端这块我建议先把上传和进度做扎实。现在最大的体验问题是长音频上传到 100% 之后界面没反馈，用户不知道还在处理。'),
  seg('mtg_01JABCWEEKLY', 5, 112000, 148600, '林知远', '同意。进度要分两段：上传进度和 AI 处理进度，AI 处理走 SSE 推送，断线要能恢复。这个作为 P0。'),
  seg('mtg_01JABCWEEKLY', 6, 148600, 181000, '陈慕', '后端我这边接口契约这周冻结，先给 mock，前端不用等我。转写和摘要我会做成两个独立阶段，失败可以单独重试。'),
  seg('mtg_01JABCWEEKLY', 7, 181000, 214500, '赵时', '从测试角度我关注两件事：一是失败态有没有明确的重试入口，二是权限矩阵。上次演示 viewer 账号能看到删除按钮，这个必须修。'),
  seg('mtg_01JABCWEEKLY', 8, 214500, 248000, '林知远', '权限这块前端不要自己写判断，全部用接口下发的 permissions 字段。后端也会补权限矩阵的自动化测试。'),
  seg('mtg_01JABCWEEKLY', 9, 248000, 279000, '王砚', '待办看板我想做成三列拖拽，待办、进行中、完成。AI 提取出来的负责人和截止时间要能直接改，不能是黑盒。'),
  seg('mtg_01JABCWEEKLY', 10, 279000, 312400, '陈慕', '摘要我会做成结构化 JSON，主题、结论、风险、待办四块。如果模型返回不合法，就降级成纯文本加一个重试按钮。'),
  seg('mtg_01JABCWEEKLY', 11, 312400, 345000, '林知远', '分享链接要做成可撤销、可设过期，不需要登录就能看。这条对销售同事很重要。'),
  seg('mtg_01JABCWEEKLY', 12, 345000, 372000, '赵时', '我补一个验收标准：空状态、错误态、加载态三态齐全，不然不能标记完成。'),
  seg('mtg_01JABCWEEKLY', 13, 372000, 405000, '林知远', '行，那就这么定。下周一之前把上传链路和 SSF 进度跑通，周三一起过看板。散会。'),

  seg('mtg_01JABCAPI', 1, 0, 22100, '陈慕', '今天主要对齐三件事：会议创建接口的字段、音频上传的方式、还有错误码。'),
  seg('mtg_01JABCAPI', 2, 22100, 51600, '王砚', '上传我倾向 multipart 直接传，不要前端先传对象存储再回调，多一步就多一个失败点。'),
  seg('mtg_01JABCAPI', 3, 51600, 84300, '陈慕', '可以。但文件大小和时长要在服务端再校验一次，前端校验只是体验优化。超限返回 VALIDATION_ERROR，字段级提示。'),
  seg('mtg_01JABCAPI', 4, 84300, 118000, '林知远', '创建接口返回 202 加 job_id，前端拿到就订阅 events，不要轮询。'),
  seg('mtg_01JABCAPI', 5, 118000, 152000, '陈慕', 'events 我用 SSE，事件类型有 progress、error、done，另外每 15 秒发一个 ping 保活。'),
  seg('mtg_01JABCAPI', 6, 152000, 189400, '王砚', '断线重连前端会自己退避重试，但重连之后要能直接拿到最新状态，不能从零开始。'),
  seg('mtg_01JABCAPI', 7, 189400, 223000, '陈慕', '这个没问题，重新连上来我先推一条 status 事件带当前 progress。'),
  seg('mtg_01JABCAPI', 8, 223000, 258000, '赵时', '错误码我想在契约里写死一张表，前端按码做分支，不要按 message 文案匹配。'),
  seg('mtg_01JABCAPI', 9, 258000, 291000, '林知远', '对，message 是给人看的，code 是给程序看的。这条写进规范。'),
  seg('mtg_01JABCAPI', 10, 291000, 322000, '陈慕', '那我今天把 OpenAPI 更新一版，前端明天就能基于 mock 开工。'),

  seg('mtg_01JABCFAILED', 1, 0, 24600, '王砚', '复盘一下上周的三组实验：新用户引导、价格页改版、还有分享入口前置。'),
  seg('mtg_01JABCFAILED', 2, 24600, 58400, '赵时', '引导那一组注册转化提升了 8.2%，但次日留存没变化，说明进来的人质量没提升。'),
  seg('mtg_01JABCFAILED', 3, 58400, 92700, '林知远', '价格页改版那组数据我看过了，转化掉了 3 个点，我建议直接回滚，别再投入了。'),
  seg('mtg_01JABCFAILED', 4, 92700, 129000, '王砚', '分享入口前置的效果最好，分享率翻了一倍，但分享出去的页面没有登录引导，转化断层。'),
  seg('mtg_01JABCFAILED', 5, 129000, 165400, '赵时', '那下一轮实验我建议就补这个断层，在公开分享页加一个轻量的注册引导。'),
]

/* ----------------------------- 摘要 ----------------------------- */

export const summaries: Summary[] = [
  {
    id: 'sum_weekly_v2',
    meeting_id: 'mtg_01JABCWEEKLY',
    model: 'mock-llm-v1',
    version: 2,
    status: 'ok',
    created_at: '2026-10-20T02:52:00Z',
    content: {
      topics: ['上迭代交付复盘', 'Q4 迭代目标', '上传与进度体验', '待办看板', '分享与权限'],
      key_points: [
        '上迭代 14 个需求交付 11 个，3 个顺延（2 个依赖后端接口、1 个设计改版）',
        '本季度核心目标锁定「会议纪要闭环可用」：上传 → 转写 → 摘要 → 待办全链路打通',
        '进度拆成上传进度与 AI 处理进度两段，AI 处理走 SSE 推送，断线可恢复',
        '待办看板采用三列拖拽，AI 提取的负责人与截止时间允许人工修改',
        '权限判断统一使用接口下发的 permissions 字段，前端不自行推导角色',
      ],
      decisions: [
        '顺延需求不并入新迭代，先保证新迭代目标清晰',
        '上传方式定为 multipart 直传，不做前端先传对象存储再回调',
        '摘要采用结构化 JSON（主题/结论/风险/待办），非法结构降级为纯文本 + 重试',
        '分享链接支持撤销与过期，无需登录只读访问',
      ],
      risks: [
        '长音频处理耗时长，用户容易误以为卡住 —— 需靠进度与阶段文案缓解',
        'LLM 返回结构不合法会导致摘要流程失败 —— 需 Schema 校验 + 降级',
        '权限判断散落在组件里会造成越权入口 —— 必须统一走 permissions',
      ],
      action_items: [
        { title: '上传与 SSE 进度联调完成', owner: '王砚', due_date: dueIn(2) },
        { title: '接口契约冻结并输出 mock', owner: '陈慕', due_date: dueIn(-3) },
        { title: '待办看板三列拖拽实现', owner: '王砚', due_date: dueIn(2) },
        { title: '权限矩阵自动化测试补齐', owner: '陈慕', due_date: dueIn(3) },
      ],
    },
  },
  {
    id: 'sum_weekly_v1',
    meeting_id: 'mtg_01JABCWEEKLY',
    model: 'mock-llm-v1',
    version: 1,
    status: 'ok',
    created_at: '2026-10-20T02:48:00Z',
    content: {
      topics: ['迭代复盘'],
      key_points: ['上个迭代 14 个需求交付 11 个，3 个顺延。'],
      decisions: ['顺延需求不并入新迭代。'],
      risks: ['长音频处理耗时长。'],
      action_items: [{ title: '上传与 SSA 进度联调完成', owner: '王砚', due_date: dueIn(2) }],
    },
  },
  {
    id: 'sum_api_v1',
    meeting_id: 'mtg_01JABCAPI',
    model: 'mock-llm-v1',
    version: 1,
    status: 'ok',
    created_at: '2026-10-22T07:39:00Z',
    content: {
      topics: ['会议创建接口字段', '音频上传方式', '错误码规范', 'SSE 事件协议'],
      key_points: [
        '上传采用 multipart 直传，服务端二次校验大小与时长',
        '创建接口返回 202 + job_id，前端订阅 events 而非轮询',
        'SSE 事件类型：progress / error / done，另有 15 秒 ping 保活',
        '前端断线后指数退避重连，重连即收到当前 status 与 progress',
      ],
      decisions: [
        '超限统一返回 VALIDATION_ERROR，前端做字段级提示且不清空表单',
        '错误码在契约中固化，前端按 code 分支，不匹配 message 文案',
        'OpenAPI 当日更新一版，前端基于 mock 并行开工',
      ],
      risks: [
        '若前端自行推导权限会出现越权入口',
        'Reconnect 时若状态不同步，进度条会回退造成误解',
      ],
      action_items: [
        { title: '更新 OpenAPI 并合入主干', owner: '陈慕', due_date: dueIn(-5) },
        { title: '前端接入 events 并实现退避重连', owner: '王砚', due_date: dueIn(-1) },
      ],
    },
  },
]

/* ---------------------------- 待办项 ---------------------------- */

export const actionItems: ActionItem[] = [
  {
    id: 'ai_upload_sse',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_wang',
    owner_name: '王砚',
    title: '上传链路与 SSE 进度联调完成',
    status: 'in_progress',
    priority: 'high',
    due_date: dueIn(2),
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-24T06:10:00Z',
  },
  {
    id: 'ai_contract',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_chen',
    owner_name: '陈慕',
    title: '接口契约冻结并输出 mock server',
    status: 'done',
    priority: 'high',
    due_date: dueIn(-3),
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-23T09:00:00Z',
  },
  {
    id: 'ai_board',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_wang',
    owner_name: '王砚',
    title: '待办看板三列拖拽实现',
    status: 'todo',
    priority: 'medium',
    due_date: dueIn(2),
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-20T02:52:00Z',
  },
  {
    id: 'ai_policy',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_chen',
    owner_name: '陈慕',
    title: '权限矩阵自动化测试补齐',
    status: 'todo',
    priority: 'high',
    due_date: dueIn(3),
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-20T02:52:00Z',
  },
  {
    id: 'ai_tristate',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_zhao',
    owner_name: '赵时',
    title: '三态（空/错/加载）走查清单产出',
    status: 'todo',
    priority: 'low',
    due_date: null,
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-20T02:52:00Z',
  },
  {
    id: 'ai_openapi',
    meeting_id: 'mtg_01JABCAPI',
    owner_id: 'u_chen',
    owner_name: '陈慕',
    title: '更新 OpenAPI 并合入主干',
    status: 'done',
    priority: 'high',
    due_date: dueIn(-5),
    created_at: '2026-10-22T07:39:00Z',
    updated_at: '2026-10-22T09:20:00Z',
  },
  {
    id: 'ai_reconnect',
    meeting_id: 'mtg_01JABCAPI',
    owner_id: 'u_wang',
    owner_name: '王砚',
    title: '前端接入 events 并实现指数退避重连',
    status: 'in_progress',
    priority: 'high',
    due_date: dueIn(-1),
    created_at: '2026-10-22T07:39:00Z',
    updated_at: '2026-10-25T01:40:00Z',
  },
  {
    id: 'ai_errorcode',
    meeting_id: 'mtg_01JABCAPI',
    owner_id: 'u_zhao',
    owner_name: '赵时',
    title: '错误码分支的场景用例（按 code 而非 message）',
    status: 'todo',
    priority: 'medium',
    due_date: dueIn(4),
    created_at: '2026-10-22T07:39:00Z',
    updated_at: '2026-10-22T07:39:00Z',
  },
  {
    id: 'ai_rollback',
    meeting_id: 'mtg_01JABCFAILED',
    owner_id: 'u_wang',
    owner_name: '王砚',
    title: '回滚价格页改版实验',
    status: 'todo',
    priority: 'high',
    due_date: dueIn(2),
    created_at: '2026-10-24T10:12:00Z',
    updated_at: '2026-10-24T10:12:00Z',
  },
  {
    id: 'ai_sharecta',
    meeting_id: 'mtg_01JABCFAILED',
    owner_id: 'u_zhao',
    owner_name: '赵时',
    title: '公开分享页补充注册引导 CTA',
    status: 'todo',
    priority: 'medium',
    due_date: dueIn(7),
    created_at: '2026-10-24T10:12:00Z',
    updated_at: '2026-10-24T10:12:00Z',
  },
  {
    id: 'ai_template',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_zhao',
    owner_name: '赵时',
    title: '会议纪要模板走查并归档到知识库',
    status: 'todo',
    priority: 'medium',
    due_date: dueIn(-2),
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-20T02:52:00Z',
  },
  {
    id: 'ai_archive',
    meeting_id: 'mtg_01JABCWEEKLY',
    owner_id: 'u_lin',
    owner_name: '林知远',
    title: '本周周会纪要归档并同步给干系人',
    status: 'todo',
    priority: 'low',
    due_date: dueIn(-1),
    created_at: '2026-10-20T02:52:00Z',
    updated_at: '2026-10-20T02:52:00Z',
  },
]

/* ----------------------------- 评论 ----------------------------- */

export const comments: Comment[] = [
  {
    id: 'cm_1',
    target_type: 'meeting',
    target_id: 'mtg_01JABCWEEKLY',
    user_id: 'u_chen',
    user_name: '陈慕',
    content: '契约这周冻结，前端不用等我，先按 mock 开工就行。',
    created_at: '2026-10-20T03:10:00Z',
  },
  {
    id: 'cm_2',
    target_type: 'meeting',
    target_id: 'mtg_01JABCWEEKLY',
    user_id: 'u_zhao',
    user_name: '赵时',
    content: '补充一条验收：viewer 账号必须看不到任何写操作入口。',
    created_at: '2026-10-20T05:42:00Z',
  },
  {
    id: 'cm_3',
    target_type: 'action_item',
    target_id: 'ai_upload_sse',
    user_id: 'u_lin',
    user_name: '林知远',
    content: '断线重连这块记得在演示脚本里演一下，这是加分项。',
    created_at: '2026-10-24T07:05:00Z',
  },
]

/* --------------------------- 参会成员 --------------------------- */

/** 会议身份与工作区角色解耦：同一人在不同会议里可以是主持人或旁听 */
export const meetingParticipants: Record<string, MeetingParticipant[]> = {
  mtg_01JABCWEEKLY: [
    {
      user_id: 'u_lin',
      name: '林知远',
      email: 'demo@minutes.dev',
      avatar_url: null,
      meeting_role: 'host',
      is_creator: true,
      joined_at: '2026-10-20T02:00:00Z',
    },
    {
      user_id: 'u_chen',
      name: '陈慕',
      email: 'chen@minutes.dev',
      avatar_url: null,
      meeting_role: 'recorder',
      is_creator: false,
      joined_at: '2026-10-20T02:00:00Z',
    },
    {
      user_id: 'u_wang',
      name: '王砚',
      email: 'wang@minutes.dev',
      avatar_url: null,
      meeting_role: 'participant',
      is_creator: false,
      joined_at: '2026-10-20T02:00:00Z',
    },
    {
      user_id: 'u_zhao',
      name: '赵时',
      email: 'zhao@minutes.dev',
      avatar_url: null,
      meeting_role: 'observer',
      is_creator: false,
      joined_at: '2026-10-20T02:00:00Z',
    },
  ],
  mtg_01JABCAPI: [
    {
      user_id: 'u_chen',
      name: '陈慕',
      email: 'chen@minutes.dev',
      avatar_url: null,
      meeting_role: 'host',
      is_creator: true,
      joined_at: '2026-10-22T07:00:00Z',
    },
    {
      user_id: 'u_wang',
      name: '王砚',
      email: 'wang@minutes.dev',
      avatar_url: null,
      meeting_role: 'recorder',
      is_creator: false,
      joined_at: '2026-10-22T07:00:00Z',
    },
    {
      user_id: 'u_lin',
      name: '林知远',
      email: 'demo@minutes.dev',
      avatar_url: null,
      meeting_role: 'participant',
      is_creator: false,
      joined_at: '2026-10-22T07:05:00Z',
    },
  ],
  mtg_01JABCFAILED: [
    {
      user_id: 'u_wang',
      name: '王砚',
      email: 'wang@minutes.dev',
      avatar_url: null,
      meeting_role: 'host',
      is_creator: true,
      joined_at: '2026-10-24T09:30:00Z',
    },
    {
      user_id: 'u_zhao',
      name: '赵时',
      email: 'zhao@minutes.dev',
      avatar_url: null,
      meeting_role: 'participant',
      is_creator: false,
      joined_at: '2026-10-24T09:30:00Z',
    },
  ],
}

/* ---------------------------- 会议资料 ---------------------------- */

export const attachments: MeetingAttachment[] = [
  {
    id: 'att_board',
    meeting_id: 'mtg_01JABCWEEKLY',
    uploader_id: 'u_chen',
    uploader_name: '陈慕',
    file_name: '迭代排期白板.png',
    mime_type: 'image/png',
    size_bytes: 486_912,
    kind: 'image',
    url: '/api/v1/attachments/att_board/content',
    created_at: '2026-10-20T02:30:00Z',
  },
  {
    id: 'att_contract',
    meeting_id: 'mtg_01JABCWEEKLY',
    uploader_id: 'u_chen',
    uploader_name: '陈慕',
    file_name: '接口契约 v0.1.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2_284_560,
    kind: 'doc',
    url: '/api/v1/attachments/att_contract/content',
    created_at: '2026-10-20T02:34:00Z',
  },
  {
    id: 'att_voice',
    meeting_id: 'mtg_01JABCWEEKLY',
    uploader_id: 'u_wang',
    uploader_name: '王砚',
    file_name: '白板讨论片段.wav',
    mime_type: 'audio/wav',
    size_bytes: 88_200,
    kind: 'audio',
    url: '/api/v1/attachments/att_voice/content',
    created_at: '2026-10-20T02:40:00Z',
  },
  {
    id: 'att_api_doc',
    meeting_id: 'mtg_01JABCAPI',
    uploader_id: 'u_wang',
    uploader_name: '王砚',
    file_name: 'SSE 事件协议.md',
    mime_type: 'text/markdown',
    size_bytes: 12_480,
    kind: 'doc',
    url: '/api/v1/attachments/att_api_doc/content',
    created_at: '2026-10-22T07:20:00Z',
  },
]

/* --------------------------- 分享链接 --------------------------- */

export const shareLinks: ShareLink[] = [
  {
    id: 'sl_1',
    meeting_id: 'mtg_01JABCWEEKLY',
    token: 'shr_demo_weekly_2026',
    scope: 'read_transcript',
    expires_at: '2026-11-20T02:00:00Z',
    revoked_at: null,
    created_at: '2026-10-20T03:00:00Z',
  },
]

/* ---------------------------- 审计 ----------------------------- */

export const auditLogs: AuditLog[] = [
  {
    id: 'ad_1',
    workspace_id: 'ws_demo',
    actor_id: 'u_lin',
    actor_name: '林知远',
    action: 'workspace.create',
    target: 'ws_demo',
    created_at: '2026-08-01T02:00:00Z',
  },
  {
    id: 'ad_2',
    workspace_id: 'ws_demo',
    actor_id: 'u_lin',
    actor_name: '林知远',
    action: 'member.invite',
    target: 'chen@minutes.dev · admin',
    created_at: '2026-08-02T03:10:00Z',
  },
  {
    id: 'ad_3',
    workspace_id: 'ws_demo',
    actor_id: 'u_chen',
    actor_name: '陈慕',
    action: 'meeting.create',
    target: 'mtg_01JABCAPI · 跨团队接口对齐会',
    created_at: '2026-10-22T07:00:00Z',
  },
  {
    id: 'ad_4',
    workspace_id: 'ws_demo',
    actor_id: 'u_lin',
    actor_name: '林知远',
    action: 'share.create',
    target: 'mtg_01JABCWEEKLY · 7 天内有效',
    created_at: '2026-10-20T03:00:00Z',
  },
  {
    id: 'ad_5',
    workspace_id: 'ws_demo',
    actor_id: 'u_wang',
    actor_name: '王砚',
    action: 'meeting.retry',
    target: 'mtg_01JABCFAILED · 从 summarizing 恢复',
    created_at: '2026-10-24T10:26:00Z',
  },
]

/* ------------------------------------------------------------------ */
/* 可变内存库                                                          */
/* ------------------------------------------------------------------ */

export const db = {
  users,
  workspaces: structuredClone(workspaces),
  workspaceMembers: structuredClone(workspaceMembers),
  meetings: structuredClone(meetings),
  transcriptSegments: structuredClone(transcriptSegments),
  summaries: structuredClone(summaries),
  actionItems: structuredClone(actionItems),
  comments: structuredClone(comments),
  shareLinks: structuredClone(shareLinks),
  auditLogs: structuredClone(auditLogs),
  meetingParticipants: structuredClone(meetingParticipants),
  attachments: structuredClone(attachments),
  /** 待办逾期提醒记录：action_item_id → 最近一次提醒时间 */
  todoReminders: {} as Record<string, string>,
  /** 上传文件的原始字节（浏览器内 File 无法持久化，仅存活于当前会话） */
  attachmentFiles: {} as Record<string, File | Blob>,
}

export function findMeeting(id: string) {
  return db.meetings.find((m) => m.id === id && !m.deleted_at)
}

export function findWorkspace(id: string) {
  return db.workspaces.find((w) => w.id === id)
}

export function buildMeetingDetail(meeting: Meeting, role: string): MeetingDetail {
  const summary =
    db.summaries
      .filter((s) => s.meeting_id === meeting.id)
      .sort((a, b) => b.version - a.version)[0] ?? null

  const canWrite = role === 'owner' || role === 'admin' || role === 'member'

  return {
    meeting,
    summary,
    action_items: db.actionItems.filter((a) => a.meeting_id === meeting.id),
    participants: db.meetingParticipants[meeting.id] ?? [],
    attachments: db.attachments
      .filter((a) => a.meeting_id === meeting.id)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    permissions: {
      can_edit: canWrite,
      can_delete: role === 'owner' || role === 'admin',
      can_process: canWrite,
      can_comment: canWrite,
      can_share: canWrite,
      can_manage_participants: canWrite,
      can_manage_attachments: canWrite,
    },
    counts: {
      segments: db.transcriptSegments.filter((s) => s.meeting_id === meeting.id).length,
      action_items: db.actionItems.filter((a) => a.meeting_id === meeting.id).length,
      comments: db.comments.filter((c) => c.target_id === meeting.id).length,
      attachments: db.attachments.filter((a) => a.meeting_id === meeting.id).length,
    },
  }
}
