'use client'

import type { AuthTokens, MeResponse, User } from './types'

const ACCESS_KEY = 'minutes.access_token'
const REFRESH_KEY = 'minutes.refresh_token'
const USER_KEY = 'minutes.user'

/**
 * 演示版会话存储。
 * 生产方案：access_token 放内存 + refresh_token 走 httpOnly Cookie；
 * 这里为让前端可脱离后端独立跑通，统一落 localStorage。
 */
export const session = {
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(ACCESS_KEY)
  },
  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(REFRESH_KEY)
  },
  getUser(): User | null {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as User
    } catch {
      return null
    }
  },
  save(tokens: Pick<AuthTokens, 'access_token' | 'refresh_token'>, user?: User | MeResponse['user']) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ACCESS_KEY, tokens.access_token)
    window.localStorage.setItem(REFRESH_KEY, tokens.refresh_token)
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user))
  },
  saveUser(user: User) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(USER_KEY, JSON.stringify(user))
  },
  clear() {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(ACCESS_KEY)
    window.localStorage.removeItem(REFRESH_KEY)
    window.localStorage.removeItem(USER_KEY)
  },
}

export function isAuthenticated() {
  return Boolean(session.getAccessToken())
}
