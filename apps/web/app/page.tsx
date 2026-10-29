'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { session } from '@/lib/api/session'

/** 根路由：已登录进第一个工作区，未登录去登录页 */
export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const token = session.getAccessToken()
    router.replace(token ? '/workspaces' : '/login')
  }, [router])

  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
      正在进入…
    </div>
  )
}
