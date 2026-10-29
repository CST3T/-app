'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { SfxProvider } from '@/components/ui/sfx'

/** 是否启用 MSW：默认开启（后端未就绪时前端可独立跑通全链路） */
const USE_MOCK = process.env.NEXT_PUBLIC_API_MOCKING !== 'off'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // 401/403/404/409 不重试，避免无意义请求
          if (error instanceof ApiError && [401, 403, 404, 409, 422].includes(error.status)) {
            return false
          }
          return failureCount < 2
        },
      },
      mutations: { retry: 0 },
    },
  })
}

function MockBoot({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!USE_MOCK)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!USE_MOCK) return
    let cancelled = false
    ;(async () => {
      // 旧版本可能残留 PWA 的 /sw.js 注册，会与 MSW 抢占根作用域，先清理
      await clearLegacyPwaWorker()
      const { worker } = await import('@/mocks/browser')
      // 不等待 start 的 Promise（生产构建下可能迟迟不 resolve），
      // 改为探测一个 Mock 独有的接口：一旦被拦截（返回 401 而非 404）就说明 SW 已生效
      void worker.start({
        onUnhandledRequest: 'bypass',
        quiet: true,
        serviceWorker: { url: '/mockServiceWorker.js' },
      })

      const ok = await waitForMock(20_000)
      if (cancelled) return
      if (ok) setReady(true)
      else setFailed(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium">本地 Mock 服务启动失败</p>
        <p className="text-xs text-muted-foreground">请刷新页面重试；若仍失败，请确认浏览器未禁用 Service Worker。</p>
        <button
          type="button"
          data-sound="primary"
          onClick={() => window.location.reload()}
          className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          刷新页面
        </button>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          正在启动本地 Mock 服务…
        </div>
      </div>
    )
  }

  return <>{children}</>
}

/** 清理历史版本遗留的 PWA Service Worker（与 MSW 冲突时会导致接口全部 404） */
async function clearLegacyPwaWorker() {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  const pwaRegs = registrations.filter((reg) =>
    [reg.active, reg.waiting, reg.installing].some((w) => w?.scriptURL.endsWith('/sw.js')),
  )
  if (pwaRegs.length === 0) return
  await Promise.all(pwaRegs.map((reg) => reg.unregister()))
  if (
    navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js') &&
    sessionStorage.getItem('minutes:pwa-cleared') !== '1'
  ) {
    sessionStorage.setItem('minutes:pwa-cleared', '1')
    window.location.reload()
  }
}

/** 轮询 Mock 独有接口，直到请求被 Service Worker 接管（返回非 404） */
async function waitForMock(timeout: number) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/v1/me', { cache: 'no-store', headers: { Accept: 'application/json' } })
      if (res.status !== 404) return true
    } catch {
      // SW 切换瞬间可能抛错，继续重试
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
        <MockBoot>
          <SfxProvider>
            {children}
            <Toaster
              position="top-right"
              closeButton
              toastOptions={{
                classNames: {
                  toast:
                    'panel border-border/70 bg-card text-card-foreground shadow-lg shadow-black/20',
                },
              }}
            />
          </SfxProvider>
        </MockBoot>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
