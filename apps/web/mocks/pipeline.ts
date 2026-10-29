import { db, findMeeting } from './data'
import type { ActionItem, Summary, TranscriptSegment } from '@/lib/api/types'

/* ------------------------------------------------------------------ */
/* Worker 模拟：状态机 uploaded → transcribing → summarizing → done     */
/* 前端不发轮询、不等后端，也能演示「进度推进 / 失败 / 断点重试」        */
/* ------------------------------------------------------------------ */

type Listener = (event: SseMessage) => void

export interface SseMessage {
  event: 'status' | 'progress' | 'error' | 'done' | 'ping'
  data: Record<string, unknown>
}

const listeners = new Map<string, Set<Listener>>()

export function subscribe(meetingId: string, listener: Listener) {
  if (!listeners.has(meetingId)) listeners.set(meetingId, new Set())
  listeners.get(meetingId)!.add(listener)
  return () => {
    listeners.get(meetingId)?.delete(listener)
    if (listeners.get(meetingId)?.size === 0) listeners.delete(meetingId)
  }
}

function emit(meetingId: string, message: SseMessage) {
  listeners.get(meetingId)?.forEach((fn) => fn(message))
}

interface Job {
  meetingId: string
  startedAt: number
  fromStage: 'transcribing' | 'summarizing'
  /** 演示失败开关：true 时在 summarizing 阶段抛错，用于演「失败重试」 */
  failAt?: 'summarizing' | null
}

const jobs = new Map<string, Job>()
let timer: ReturnType<typeof setInterval> | null = null

const TRANSCRIBE_MS = 9000
const SUMMARIZE_MS = 6000

/** 演示用：标题里带「超时」或「失败」的会议会在摘要阶段模拟失败 */
function shouldFail(title: string) {
  return /失败|超时|fail/i.test(title)
}

export function enqueueJob(
  meetingId: string,
  fromStage: 'transcribing' | 'summarizing' = 'transcribing',
  opts: { simulateFailure?: boolean } = {},
) {
  const meeting = findMeeting(meetingId)
  if (!meeting) return null

  const failAt =
    (opts.simulateFailure ?? shouldFail(meeting.title)) && fromStage === 'transcribing'
      ? 'summarizing'
      : null

  jobs.set(meetingId, { meetingId, startedAt: Date.now(), fromStage, failAt })

  meeting.status = fromStage
  meeting.progress = fromStage === 'transcribing' ? 2 : 70
  meeting.error = null
  meeting.updated_at = new Date().toISOString()

  if (!timer) timer = setInterval(tick, 500)
  tick()

  return `job_${meetingId.slice(-6)}_${Date.now().toString(36)}`
}

/** 断点重试：已完成阶段不重做 */
export function retryJob(meetingId: string, fromStage?: 'transcribing' | 'summarizing') {
  const meeting = findMeeting(meetingId)
  if (!meeting) return null
  const stage = fromStage ?? (meeting.error?.stage === 'summarizing' ? 'summarizing' : 'transcribing')
  return enqueueJob(meetingId, stage)
}

function tick() {
  const now = Date.now()
  jobs.forEach((job, meetingId) => {
    const meeting = findMeeting(meetingId)
    if (!meeting) {
      jobs.delete(meetingId)
      return
    }

    const elapsed = now - job.startedAt

    // ---------- 阶段一：转写 ----------
    if (meeting.status === 'transcribing') {
      const ratio = Math.min(elapsed / TRANSCRIBE_MS, 1)
      const progress = Math.round(2 + ratio * 68) // 2 → 70
      meeting.progress = progress
      emit(meetingId, { event: 'progress', data: { status: 'transcribing', progress } })

      if (ratio >= 1) {
        writeTranscript(meetingId)

        if (job.failAt === 'summarizing') {
          meeting.status = 'failed'
          meeting.progress = 70
          meeting.error = {
            code: 'INTERNAL_ERROR',
            message: '摘要服务超时（LLM 响应超过 60s），转写结果已保留',
            stage: 'summarizing',
            retryable: true,
          }
          meeting.updated_at = new Date().toISOString()
          jobs.delete(meetingId)
          emit(meetingId, {
            event: 'error',
            data: {
              status: 'failed',
              code: 'INTERNAL_ERROR',
              message: meeting.error.message,
              stage: 'summarizing',
              retryable: true,
            },
          })
          return
        }

        meeting.status = 'summarizing'
        meeting.progress = 70
        job.startedAt = now
        emit(meetingId, { event: 'status', data: { status: 'summarizing', progress: 70 } })
      }
      return
    }

    // ---------- 阶段二：摘要 ----------
    if (meeting.status === 'summarizing') {
      const ratio = Math.min(elapsed / SUMMARIZE_MS, 1)
      const progress = Math.round(70 + ratio * 30) // 70 → 100
      meeting.progress = progress
      emit(meetingId, { event: 'progress', data: { status: 'summarizing', progress } })

      if (ratio >= 1) {
        writeSummary(meetingId)
        meeting.status = 'done'
        meeting.progress = 100
        meeting.error = null
        meeting.updated_at = new Date().toISOString()
        jobs.delete(meetingId)
        emit(meetingId, { event: 'done', data: { status: 'done', meeting_id: meetingId } })
      }
    }
  })

  if (jobs.size === 0 && timer) {
    clearInterval(timer)
    timer = null
  }
}

/* ------------------------------------------------------------------ */
/* 转写与摘要写库（幂等：先删后插，靠 (meeting_id, seq) 唯一键保证）      */
/* ------------------------------------------------------------------ */

const TRANSCRIPT_TEMPLATE: Array<[number, number, string | null, string]> = [
  [0, 21000, '林知远', '好，人到齐了，我们开始。今天先把上次的遗留问题过一遍，然后讨论新的方案。'],
  [21000, 48500, '陈慕', '上次遗留的两个问题，第一个接口超时已经修了，第二个数据不一致还在查，怀疑是并发写入没加锁。'],
  [48500, 80200, '王砚', '前端这边我加了一层重试和本地缓存，用户侧基本感觉不到抖动，但错误提示还是不够明确。'],
  [80200, 116000, '赵时', '从测试角度，我建议把这类偶发问题都补上可观测性，日志里要带 request_id，不然排查全靠猜。'],
  [116000, 152400, '林知远', '同意。那这次的目标就定成「把稳定性做扎实」，先不加新功能。'],
  [152400, 189000, '陈慕', '我这边提一个方案：关键写操作加分布式锁，失败直接返回 409，让前端提示用户稍后重试。'],
  [189000, 224600, '王砚', '409 前端已经有处理逻辑了，会提示当前状态并且不重复提交。'],
  [224600, 258000, '赵时', '那我补一组并发场景的用例，压测的时候一起跑。'],
  [258000, 292400, '林知远', '好，那就这么定。下周这个时间再对一次结果。'],
]

function writeTranscript(meetingId: string) {
  db.transcriptSegments = db.transcriptSegments.filter((s) => s.meeting_id !== meetingId)
  const segments: TranscriptSegment[] = TRANSCRIPT_TEMPLATE.map(([start, end, speaker, content], index) => ({
    id: `${meetingId}_s${String(index + 1).padStart(3, '0')}`,
    meeting_id: meetingId,
    seq: index + 1,
    start_ms: start,
    end_ms: end,
    speaker,
    content,
  }))
  db.transcriptSegments.push(...segments)

  const meeting = findMeeting(meetingId)
  if (meeting) meeting.duration_sec = segments[segments.length - 1].end_ms / 1000
}

function writeSummary(meetingId: string) {
  const existing = db.summaries.filter((s) => s.meeting_id === meetingId)
  const version = existing.length + 1

  const content: Summary['content'] = {
    topics: ['上期遗留问题', '稳定性方案', '并发与锁', '可观测性'],
    key_points: [
      '上期两个遗留问题：接口超时已修复，数据不一致仍在排查（疑似并发写入未加锁）',
      '前端已加入重试与本地缓存，用户侧感知不明显，但错误提示需要更明确',
      '本次迭代目标锁定「稳定性」，暂不引入新功能',
    ],
    decisions: [
      '关键写操作引入分布式锁，冲突返回 409 STATE_CONFLICT',
      '日志统一结构化，必须携带 request_id 便于排查',
    ],
    risks: [
      '分布式锁若超时设置不合理会造成长时间阻塞',
      '缺少并发压测会导致问题在线上才暴露',
    ],
    action_items: [
      { title: '关键写操作加分布式锁', owner: '陈慕', due_date: null },
      { title: '补并发场景用例并纳入压测', owner: '赵时', due_date: null },
    ],
  }

  db.summaries.push({
    id: `sum_${meetingId}_v${version}`,
    meeting_id: meetingId,
    model: 'mock-llm-v1',
    version,
    status: 'ok',
    content,
    created_at: new Date().toISOString(),
  })

  // 摘要里的待办落到看板
  content.action_items.forEach((item, index) => {
    const owner = db.users.find((u) => u.name === item.owner)
    db.actionItems.push({
      id: `ai_gen_${meetingId}_${index}`,
      meeting_id: meetingId,
      owner_id: owner?.id ?? null,
      owner_name: owner?.name ?? null,
      title: item.title,
      status: 'todo',
      priority: 'medium',
      due_date: item.due_date ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies ActionItem)
  })
}
