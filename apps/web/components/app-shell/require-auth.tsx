'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { session } from '@/lib/api/session'
import { useMe } from '@/lib/api/hooks'
import { ErrorState, LoadingState } from '@/components/ui/primitives'
import { AppShell } from '@/components/app-shell/app-shell'

/** 需要登录的布局：未登录跳登录页；工作区不存在则给出明确空/错态 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const authed = typeof window !== 'undefined' && Boolean(session.getAccessToken())

  useEffect(() => {
    if (!authed) router.replace('/login')
  }, [authed, router])

  if (!authed) return <LoadingState label="正在校验登录状态…" />
  return <>{children}</>
}

export function WorkspaceShell({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
  const { data, isLoading, isError, error, refetch } = useMe()
  const router = useRouter()

  useEffect(() => {
    if (data && !data.workspaces.some((w) => w.id === workspaceId)) {
      router.replace('/workspaces')
    }
  }, [data, workspaceId, router])

  if (isLoading) return <LoadingState label="正在加载工作区…" />

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState
          title="工作区加载失败"
          message={(error as Error)?.message}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return <AppShell workspaceId={workspaceId}>{children}</AppShell>
}
