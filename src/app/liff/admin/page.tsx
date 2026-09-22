'use client'

import { useEffect, useState } from 'react'

// LIFF Admin Dashboard - Phase 4 will implement full UI
// This is the entry page placeholder
export default function AdminPage() {
  const [status, setStatus] = useState<'loading' | 'unauthorized' | 'ready'>('loading')
  const [adminName, setAdminName] = useState('')

  useEffect(() => {
    initLiff()
  }, [])

  async function initLiff() {
    try {
      // Dynamic import to avoid SSR issues
      const liff = (await import('@line/liff')).default
      const liffId = process.env.NEXT_PUBLIC_LIFF_ADMIN_ID ?? ''
      await liff.init({ liffId })

      if (!liff.isLoggedIn()) {
        liff.login()
        return
      }

      const profile = await liff.getProfile()
      const idToken = liff.getIDToken()

      // 驗證管理員身份
      const res = await fetch('/api/admin/auth/liff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      })

      if (!res.ok) {
        setStatus('unauthorized')
        return
      }

      setAdminName(profile.displayName)
      setStatus('ready')
    } catch (err) {
      console.error('[LIFF Admin] Init error:', err)
      setStatus('unauthorized')
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">✂️</div>
          <p className="text-gray-500">載入中...</p>
        </div>
      </div>
    )
  }

  if (status === 'unauthorized') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <div className="text-4xl mb-4">🚫</div>
          <h1 className="text-xl font-bold mb-2">沒有管理員權限</h1>
          <p className="text-gray-500 text-sm">請聯絡系統管理員</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-xl">✂️</span>
            </div>
            <div>
              <h1 className="font-bold text-gray-900">理髮店管理後台</h1>
              <p className="text-sm text-gray-500">歡迎，{adminName}</p>
            </div>
          </div>
        </div>

        {/* Quick Nav */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { emoji: '📅', label: '預約管理', href: '/liff/admin/appointments' },
            { emoji: '💈', label: '設計師管理', href: '/liff/admin/stylists' },
            { emoji: '🕐', label: '時段管理', href: '/liff/admin/slots' },
            { emoji: '✂️', label: '服務項目', href: '/liff/admin/services' },
            { emoji: '👥', label: '客人管理', href: '/liff/admin/customers' },
            { emoji: '📊', label: '數據報表', href: '/liff/admin/reports' },
          ].map(({ emoji, label, href }) => (
            <a
              key={href}
              href={href}
              className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-2 text-center"
            >
              <span className="text-3xl">{emoji}</span>
              <span className="text-sm font-medium text-gray-700">{label}</span>
            </a>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          理髮店預約系統 v0.1.0 · Phase 1
        </p>
      </div>
    </div>
  )
}
