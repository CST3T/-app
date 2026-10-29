import { format, formatDistanceToNow, isThisYear, isToday, isYesterday, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type {
  ActionStatus,
  AttachmentKind,
  MeetingRole,
  MeetingStatus,
  Priority,
  Role,
} from './api/types'

/** 毫秒 → mm:ss（用于转写分段与播放器） */
export function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 秒 → 可读时长 */
export function formatDuration(sec: number | null | undefined) {
  if (!sec && sec !== 0) return '--'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return '--'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** 会议时间：今天 14:30 / 昨天 14:30 / 10月24日 14:30 / 2025年10月24日 */
export function formatMeetingTime(iso: string) {
  const date = parseISO(iso)
  const time = format(date, 'HH:mm')
  if (isToday(date)) return `今天 ${time}`
  if (isYesterday(date)) return `昨天 ${time}`
  if (isThisYear(date)) return format(date, 'M月d日 HH:mm', { locale: zhCN })
  return format(date, 'yyyy年M月d日 HH:mm', { locale: zhCN })
}

export function formatRelative(iso: string) {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: zhCN })
}

export function formatDate(iso: string | null | undefined, pattern = 'yyyy-MM-dd') {
  if (!iso) return '--'
  return format(parseISO(iso), pattern, { locale: zhCN })
}

/* ------------------------------------------------------------------ */
/* 语义字典：状态 / 优先级 / 角色 —— 文案与后端枚举严格一一对应          */
/* ------------------------------------------------------------------ */

export const MEETING_STATUS_META: Record<
  MeetingStatus,
  { label: string; tone: 'neutral' | 'info' | 'process' | 'success' | 'danger'; hint: string }
> = {
  uploaded: { label: '已上传', tone: 'neutral', hint: '已入队，等待开始转写' },
  transcribing: { label: '转写中', tone: 'info', hint: '正在把录音转成文字' },
  summarizing: { label: '摘要中', tone: 'process', hint: '正在生成结构化摘要与待办' },
  done: { label: '已完成', tone: 'success', hint: '转写与摘要均已完成' },
  failed: { label: '处理失败', tone: 'danger', hint: '可重试，已完成阶段不会重复处理' },
}

export const ACTION_STATUS_META: Record<ActionStatus, { label: string; columnHint: string }> = {
  todo: { label: '待办', columnHint: '还没开始' },
  in_progress: { label: '进行中', columnHint: '正在推进' },
  done: { label: '完成', columnHint: '已交付' },
}

export const PRIORITY_META: Record<Priority, { label: string }> = {
  high: { label: '高' },
  medium: { label: '中' },
  low: { label: '低' },
}

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  owner: { label: '所有者', description: '全部权限，可转让所有权与删除工作区' },
  admin: { label: '管理员', description: '可管理成员、删除会议、查看审计' },
  member: { label: '成员', description: '可创建会议、上传音频、编辑摘要与待办' },
  viewer: { label: '访客', description: '只读，可查看与评论' },
}

/** 会议身份：一场会议内的职责划分，与工作区角色独立 */
export const MEETING_ROLE_META: Record<
  MeetingRole,
  { label: string; hint: string; tone: 'primary' | 'info' | 'neutral' | 'process' }
> = {
  host: { label: '主持人', hint: '掌控议程与结论', tone: 'primary' },
  recorder: { label: '记录员', hint: '负责整理纪要与待办', tone: 'info' },
  participant: { label: '参会人', hint: '参与讨论与评论', tone: 'neutral' },
  observer: { label: '旁听', hint: '只读，不参与讨论', tone: 'process' },
}

/** 会议资料上传限制：单文件 50MB，图片/音频/视频/文档均可 */
export const ATTACHMENT_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxMB: 50,
  accept: 'image/*,audio/*,video/mp4,.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.pptx,.ppt,.zip',
  acceptText: '图片、音频、视频、PDF / Office / 文本 / 压缩包',
}

export const ATTACHMENT_KIND_META: Record<
  AttachmentKind,
  { label: string; tone: 'primary' | 'info' | 'process' | 'success' | 'neutral' }
> = {
  image: { label: '图片', tone: 'success' },
  audio: { label: '音频', tone: 'primary' },
  video: { label: '视频', tone: 'process' },
  doc: { label: '文档', tone: 'info' },
  other: { label: '其他', tone: 'neutral' },
}

/** 由 mime / 扩展名推导资料分类，决定预览方式 */
export function attachmentKindOf(file: { name: string; type: string }): AttachmentKind {
  const mime = file.type.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'].includes(ext)) return 'image'
  if (['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'].includes(ext)) return 'audio'
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'video'
  if (['.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.xlsx', '.xls', '.pptx', '.ppt', '.zip'].includes(ext)) {
    return 'doc'
  }
  return 'other'
}

export function validateAttachment(
  file: File,
): { ok: true; kind: AttachmentKind } | { ok: false; message: string } {
  if (file.size === 0) return { ok: false, message: '文件为空，请重新选择' }
  if (file.size > ATTACHMENT_LIMITS.maxBytes) {
    return {
      ok: false,
      message: `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超出 ${ATTACHMENT_LIMITS.maxMB}MB 上限`,
    }
  }
  return { ok: true, kind: attachmentKindOf(file) }
}

/** 音视频格式与体积校验（MVP：30 分钟 / 200MB） */
export const UPLOAD_LIMITS = {
  maxBytes: 200 * 1024 * 1024,
  maxDurationSec: 30 * 60,
  maxMB: 200,
  accept: '.mp3,.m4a,.wav,.aac,.ogg,.flac,.webm,.mp4',
  mimeTypes: [
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'audio/webm',
    'video/mp4',
  ],
}

export function validateAudioFile(file: File): { ok: true } | { ok: false; message: string } {
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
  const extOk = UPLOAD_LIMITS.accept.split(',').includes(ext)
  const mimeOk = file.type ? UPLOAD_LIMITS.mimeTypes.includes(file.type) : false
  if (!extOk && !mimeOk) {
    return { ok: false, message: `不支持的格式（${ext || file.type || '未知'}），请上传 ${UPLOAD_LIMITS.accept}` }
  }
  if (file.size > UPLOAD_LIMITS.maxBytes) {
    return {
      ok: false,
      message: `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超出 ${UPLOAD_LIMITS.maxMB}MB 上限`,
    }
  }
  if (file.size === 0) {
    return { ok: false, message: '文件为空，请重新选择' }
  }
  return { ok: true }
}

/** 读取本地音频时长（秒），失败返回 null（不阻塞上传） */
export function probeAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null)
    const url = URL.createObjectURL(file)
    const el = document.createElement('audio')
    const cleanup = (value: number | null) => {
      URL.revokeObjectURL(url)
      el.remove()
      resolve(value)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => cleanup(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => cleanup(null)
    el.src = url
  })
}
