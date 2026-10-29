'use client'

import * as React from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { Tooltip } from '@/components/ui/overlay'

const STORAGE_KEY = 'minutes:sound'

const SfxContext = React.createContext<{ enabled: boolean; toggle: () => void }>({
  enabled: true,
  toggle: () => {},
})

/** 合成一段极短的「电子轻触」音，避免引入音频资源文件 */
function playClick(volume: number) {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = sharedContext(Ctor)
    void ctx.resume()

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1180, now)
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.075)

    filter.type = 'lowpass'
    filter.frequency.value = 4200

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.1)
  } catch {
    // 浏览器不支持或上下文被限制时静默降级
  }
}

let cachedCtx: AudioContext | null = null
function sharedContext(Ctor: typeof AudioContext) {
  if (!cachedCtx || cachedCtx.state === 'closed') cachedCtx = new Ctor()
  return cachedCtx
}

/** 全局按键音效：任意 button / link / tab / 菜单项点击都会给出反馈 */
export function SfxProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = React.useState(true)

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'off') setEnabled(false)
  }, [])

  React.useEffect(() => {
    if (!enabled) return

    const onPointerUp = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const control = target.closest<HTMLElement>(
        'button, a, [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="button"]',
      )
      if (!control) return
      if (control.getAttribute('aria-disabled') === 'true') return
      if ((control as HTMLButtonElement).disabled) return
      playClick(control.dataset.sound === 'primary' ? 0.075 : 0.045)
    }

    document.addEventListener('pointerup', onPointerUp, true)
    return () => document.removeEventListener('pointerup', onPointerUp, true)
  }, [enabled])

  const toggle = React.useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      if (next) playClick(0.05)
      return next
    })
  }, [])

  const value = React.useMemo(() => ({ enabled, toggle }), [enabled, toggle])

  return <SfxContext.Provider value={value}>{children}</SfxContext.Provider>
}

export function useSfx() {
  return React.useContext(SfxContext)
}

export function SoundToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useSfx()
  return (
    <Tooltip content={enabled ? '关闭按键音效' : '开启按键音效'}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={enabled ? '关闭按键音效' : '开启按键音效'}
        aria-pressed={enabled}
        className={className}
        onClick={toggle}
      >
        {enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
      </Button>
    </Tooltip>
  )
}
