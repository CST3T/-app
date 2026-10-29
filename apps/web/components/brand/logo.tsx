import * as React from 'react'
import { cn } from '@/lib/utils'

/** 项目标志：圆角霓虹底 + 声波柱，呼应「会议录音 → 纪要」 */
export function LogoMark({ className }: { className?: string }) {
  // 同页多处渲染同一标志时，渐变 id 必须唯一，否则后出现的实例会引用到隐藏副本里的渐变而失效
  const gradientId = `logo-bars-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <span
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-xl border border-primary/40 bg-primary/15 shadow-[0_0_20px_-8px_hsl(var(--primary)/0.85)]',
        className,
      )}
    >
      <span className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/5 to-accent/30" />
      <svg viewBox="0 0 32 32" aria-hidden className="relative size-[76%]">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#2bb8dd" />
            <stop offset="100%" stopColor="#8f7bff" />
          </linearGradient>
        </defs>
        <g fill={`url(#${gradientId})`}>
          <rect x="3" y="12.5" width="4" height="7" rx="2" />
          <rect x="8.8" y="8.5" width="4" height="15" rx="2" />
          <rect x="14.6" y="4.5" width="4" height="23" rx="2" />
          <rect x="20.4" y="9" width="4" height="14" rx="2" />
          <rect x="26.2" y="13" width="4" height="6" rx="2" />
        </g>
        <circle cx="26.4" cy="26.4" r="2.6" fill="#2bb8dd" />
      </svg>
    </span>
  )
}

export function Wordmark({
  className,
  markClassName,
  compact = false,
}: {
  className?: string
  markClassName?: string
  compact?: boolean
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className={cn('size-9', markClassName)} />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">会记 Minutes</span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            AI Meeting Notes
          </span>
        </span>
      )}
    </span>
  )
}
