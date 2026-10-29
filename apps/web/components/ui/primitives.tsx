'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MEETING_STATUS_META } from '@/lib/format'
import type { MeetingStatus } from '@/lib/api/types'

/* ----------------------------- Button ----------------------------- */

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_0_24px_-8px_hsl(var(--glow)/0.85)] hover:bg-primary/92 hover:shadow-[0_0_30px_-6px_hsl(var(--glow)/0.9)]',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-surface-hover',
        outline:
          'border border-border bg-surface/40 text-foreground backdrop-blur-sm hover:border-primary/50 hover:bg-primary/8 hover:text-primary hover:shadow-[0_0_22px_-10px_hsl(var(--glow)/0.9)]',
        ghost: 'hover:bg-surface-hover/80 hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-[0_0_22px_-9px_hsl(var(--destructive)/0.9)] hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6 text-base',
        icon: 'size-9',
        'icon-sm': 'size-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

/* ------------------------------ Badge ----------------------------- */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors',
  {
    variants: {
      tone: {
        neutral: 'border-border/70 bg-muted/60 text-muted-foreground',
        info: 'border-status-transcribing/30 bg-status-transcribing/12 text-status-transcribing',
        process: 'border-status-summarizing/30 bg-status-summarizing/12 text-status-summarizing',
        success: 'border-status-done/30 bg-status-done/12 text-status-done',
        danger: 'border-status-failed/30 bg-status-failed/12 text-status-failed',
        primary: 'border-primary/30 bg-primary/12 text-primary',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

/** 会议状态徽标：文案与后端枚举一一对应 */
export function StatusBadge({ status, showDot = true, className }: { status: MeetingStatus; showDot?: boolean; className?: string }) {
  const meta = MEETING_STATUS_META[status]
  const isLive = status === 'transcribing' || status === 'summarizing'
  return (
    <Badge tone={meta.tone} className={cn('gap-1.5', className)} title={meta.hint}>
      {showDot && (
        <span
          className={cn(
            'size-1.5 rounded-full bg-current',
            isLive && 'animate-pulse',
          )}
        />
      )}
      {meta.label}
    </Badge>
  )
}

/* ------------------------- Input / Textarea ----------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-lg border border-input bg-surface/60 px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[72px] w-full rounded-lg border border-input bg-surface/60 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs font-medium uppercase tracking-wide text-muted-foreground', className)}
      {...props}
    />
  )
}

/** 字段级校验提示容器（配合 VALIDATION_ERROR 使用） */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-status-failed">{message}</p>
}

/* ------------------------------ Card ------------------------------ */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('panel p-5 shadow-sm', className)} {...props} />
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex items-start justify-between gap-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold tracking-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}

/* --------------------------- Skeleton ----------------------------- */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} {...props} />
}

/* --------------------------- Separator ---------------------------- */

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-px w-full bg-border/70', className)} {...props} />
}

/* ---------------------------- Progress ---------------------------- */

export function ProgressBar({
  value,
  className,
  showTrack = true,
}: {
  value: number
  className?: string
  showTrack?: boolean
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full', showTrack && 'bg-muted', className)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

/* ----------------------- 三态：空 / 错 / 载 ----------------------- */

export function LoadingState({ label = '加载中…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground', className)}>
      <Loader2 className="size-5 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({
  title = '出了点问题',
  message,
  requestId,
  onRetry,
  className,
}: {
  title?: string
  message?: string
  requestId?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-status-failed/30 bg-status-failed/5 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-status-failed/12 text-status-failed">
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {message && <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p>}
        {requestId && (
          <p className="font-mono text-[11px] text-muted-foreground/70">request_id: {requestId}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          重试
        </Button>
      )}
    </div>
  )
}
