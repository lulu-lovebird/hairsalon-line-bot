'use client'

import { useAdminAuth } from '@/lib/admin-auth'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import type { AdminProfile } from '@/lib/admin-auth'

const AdminContext = createContext<AdminProfile | null>(null)

export function useAdmin(): AdminProfile {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used within AdminLayout')
  return ctx
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = useAdminAuth()

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">✂️</div>
          <p className="text-gray-400 text-sm">載入中...</p>
        </div>
      </div>
    )
  }

  if (auth.status === 'unauthorized') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-lg font-bold text-gray-800 mb-2">無法進入管理後台</h1>
          <p className="text-sm text-gray-500">{auth.reason}</p>
        </div>
      </div>
    )
  }

  return (
    <AdminContext.Provider value={auth.admin}>
      <div className="min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="text-center text-xs text-gray-300 py-4 px-4">
          Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting
        </footer>
      </div>
    </AdminContext.Provider>
  )
}
