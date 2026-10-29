import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 生成请求级幂等键（上传/处理接口用） */
export function idempotencyKey(prefix = 'idem') {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** 防抖 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
