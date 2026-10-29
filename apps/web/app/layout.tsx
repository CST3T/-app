import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'
import { ServiceWorkerRegistrar } from '@/components/pwa-register'

export const metadata: Metadata = {
  title: {
    default: '会记 Minutes · AI 会议纪要',
    template: '%s · 会记 Minutes',
  },
  description: '上传会议录音，自动转写、结构化摘要、提取待办并跟进闭环。',
  applicationName: '会记 Minutes',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: '会记 Minutes' },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#12151c' },
    { media: '(prefers-color-scheme: light)', color: '#f5f6f8' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
