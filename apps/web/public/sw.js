/*
 * Service Worker（PWA 离线可打开）
 * 策略：
 *  - 导航请求：network-first，断网回退到缓存的 shell / offline.html
 *  - 静态资源：stale-while-revalidate
 *  - /api/ 与 mockServiceWorker：不缓存，直连
 */
const VERSION = 'minutes-v1'
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.includes('mockServiceWorker')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {})
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || caches.match('/offline.html')
        }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return response
        })
        .catch(() => cached)
      // stale-while-revalidate：先给缓存，同时后台更新
      return cached || network
    }),
  )
})
