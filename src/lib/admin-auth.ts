'use client'

import { useEffect, useState, useCallback } from 'react'

export type AdminProfile = {
  line_uid: string
  display_name: string
  picture_url: string | null
  token: string
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthorized'; reason: string }
  | { status: 'ready'; admin: AdminProfile }

/** 發送帶有 Admin Bearer Token 的 Fetch 請求 */
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('admin_token') : null
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

/** LIFF 初始化 + 管理員身份驗證 hook */
export function useAdminAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const init = useCallback(async () => {
    try {
      const liff = (await import('@line/liff')).default
      const liffId = process.env.NEXT_PUBLIC_LIFF_ADMIN_ID ?? ''

      if (!liffId) {
        setState({ status: 'unauthorized', reason: 'LIFF ID 未設定' })
        return
      }

      await liff.init({ liffId })

      if (!liff.isLoggedIn()) {
        liff.login()
        return
      }

      const [profile, idToken] = await Promise.all([
        liff.getProfile(),
        Promise.resolve(liff.getIDToken()),
      ])

      if (!idToken) {
        setState({ status: 'unauthorized', reason: '無法取得 ID Token' })
        return
      }

      const res = await fetch('/api/admin/auth/liff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      })

      if (res.status === 403) {
        setState({ status: 'unauthorized', reason: '您沒有管理員權限' })
        return
      }

      if (!res.ok) {
        setState({ status: 'unauthorized', reason: '驗證失敗，請重試' })
        return
      }

      const data = await res.json() as { admin: Omit<AdminProfile, 'token'>; token: string }
      if (!data.token) {
        setState({ status: 'unauthorized', reason: '未取得授權 Token' })
        return
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('admin_token', data.token)
      }

      setState({
        status: 'ready',
        admin: {
          ...data.admin,
          token: data.token,
          picture_url: profile.pictureUrl ?? null,
        },
      })
    } catch (err) {
      console.error('[useAdminAuth]', err)
      setState({ status: 'unauthorized', reason: '初始化失敗' })
    }
  }, [])

  useEffect(() => {
    init()
  }, [init])

  return state
}
