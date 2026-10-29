'use client'

import * as React from 'react'
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMs } from '@/lib/format'
import { Button } from '@/components/ui/primitives'
import { Tooltip } from '@/components/ui/overlay'

/**
 * FE-04 播放器。
 * 使用原生 <audio> 而不是波形库：MVP 阶段音频来自 10 分钟签名 URL，
 * 无波形也能满足「点击转写跳转到对应位置」的核心联动。
 * 保留 Wavesurfer 依赖，后续接签名 URL 时可替换为波形视图而不改调用方。
 */
export function AudioPlayer({
  src,
  title,
  durationSec,
  currentMs,
  onSeek,
  onTimeChange,
  className,
  compact = false,
}: {
  src: string | null
  title: string
  durationSec: number | null
  currentMs?: number
  onSeek?: (ms: number) => void
  onTimeChange?: (ms: number, playing: boolean) => void
  className?: string
  compact?: boolean
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [current, setCurrent] = React.useState(0)
  const [duration, setDuration] = React.useState((durationSec ?? 0) * 1000)
  const [muted, setMuted] = React.useState(false)
  const [rate, setRate] = React.useState(1)
  const [unavailable, setUnavailable] = React.useState(!src)

  /* 外部（转写分段点击）驱动 seek */
  React.useEffect(() => {
    if (currentMs === undefined) return
    const audio = audioRef.current
    if (audio) {
      const target = currentMs / 1000
      if (Math.abs(audio.currentTime - target) > 0.4) audio.currentTime = target
    }
    setCurrent(currentMs)
  }, [currentMs])

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate])

  const toggle = React.useCallback(() => {
    const audio = audioRef.current
    if (!audio || unavailable) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }, [unavailable])

  const seekBy = (deltaMs: number) => {
    const audio = audioRef.current
    const next = Math.max(0, Math.min(current + deltaMs, duration || deltaMs))
    if (audio) audio.currentTime = next / 1000
    setCurrent(next)
    onSeek?.(next)
  }

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    const next = ratio * duration
    const audio = audioRef.current
    if (audio) audio.currentTime = next / 1000
    setCurrent(next)
    onSeek?.(next)
  }

  const percent = duration ? (current / duration) * 100 : 0

  return (
    <div className={cn('panel overflow-hidden', className)}>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration * 1000)}
          onTimeUpdate={(e) => {
            const ms = e.currentTarget.currentTime * 1000
            setCurrent(ms)
            onTimeChange?.(ms, !e.currentTarget.paused)
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setUnavailable(true)}
        />
      )}

      <div className={cn('flex items-center gap-3', compact ? 'px-3 py-2.5' : 'px-4 py-3.5')}>
        <Button
          size="icon"
          variant="default"
          onClick={toggle}
          disabled={unavailable}
          aria-label={playing ? '暂停' : '播放'}
          className={cn('shrink-0 rounded-full', playing && 'animate-pulse-ring')}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </Button>

        {!compact && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip content="后退 15 秒">
              <Button variant="ghost" size="icon-sm" onClick={() => seekBy(-15_000)} disabled={unavailable}>
                <SkipBack className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="前进 15 秒">
              <Button variant="ghost" size="icon-sm" onClick={() => seekBy(15_000)} disabled={unavailable}>
                <SkipForward className="size-3.5" />
              </Button>
            </Tooltip>
          </div>
        )}

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatMs(current)}
        </span>

        <div
          role="slider"
          tabIndex={unavailable ? -1 : 0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          onClick={handleSeek}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seekBy(5000)
            if (e.key === 'ArrowLeft') seekBy(-5000)
          }}
          className={cn(
            'group relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted',
            unavailable && 'cursor-not-allowed opacity-50',
          )}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent"
            style={{ width: `${percent}%` }}
          />
          <div
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100"
            style={{ left: `${percent}%` }}
          />
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatMs(duration)}
        </span>

        {!compact && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" onClick={() => setRate(rate === 1 ? 1.5 : 1)}>
              <span className="text-[11px] font-semibold tabular-nums">{rate}×</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                const next = !muted
                setMuted(next)
                if (audioRef.current) audioRef.current.muted = next
              }}
              aria-label={muted ? '取消静音' : '静音'}
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>

      {unavailable && (
        <div className="border-t border-border/60 bg-status-uploaded/5 px-4 py-2 text-[11px] text-muted-foreground">
          音频地址不可用（演示数据未附带真实录音），转写联动仍可查看。真实环境中播放器使用 10
          分钟签名 URL，过期后自动续签。
        </div>
      )}
      {!unavailable && !compact && (
        <div className="truncate border-t border-border/60 px-4 py-1.5 text-[11px] text-muted-foreground">
          {title}
        </div>
      )}
    </div>
  )
}
