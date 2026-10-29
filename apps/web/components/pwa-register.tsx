'use client'

import { useEffect } from 'react'

/**
 * PWA：仅在生产构建注册 Service Worker。
 * 开发模式下 SW 缓存会干扰 HMR 与 MSW，因此跳过。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    // Mock 演示模式：MSW 需要独占根作用域，不能同时注册 PWA 的 /sw.js
    if (process.env.NEXT_PUBLIC_API_MOCKING !== 'off') return

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* 注册失败不影响主流程 */
      })
    }

    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
