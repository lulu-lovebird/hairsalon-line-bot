'use client'

import { useAdmin } from '@/app/liff/admin/layout'
import Link from 'next/link'

const NAV_ITEMS = [
  { emoji: '📅', label: '預約管理', href: '/liff/admin/appointments' },
  { emoji: '💈', label: '設計師管理', href: '/liff/admin/stylists' },
  { emoji: '🕐', label: '時段管理', href: '/liff/admin/slots' },
  { emoji: '✂️', label: '服務項目', href: '/liff/admin/services' },
  { emoji: '👥', label: '客人管理', href: '/liff/admin/customers' },
  { emoji: '📊', label: '數據報表', href: '/liff/admin/reports' },
]

export default function AdminPage() {
  const admin = useAdmin()

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm flex items-center gap-3">
          {admin.picture_url ? (
            <img src={admin.picture_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-xl">✂️</div>
          )}
          <div>
            <h1 className="font-bold text-gray-900">理髮店管理後台</h1>
            <p className="text-sm text-gray-500">歡迎，{admin.display_name}</p>
          </div>
        </div>

        {/* Nav Grid */}
        <div className="grid grid-cols-2 gap-3">
          {NAV_ITEMS.map(({ emoji, label, href }) => (
            <Link
              key={href}
              href={href}
              className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md active:scale-95 transition-all flex flex-col items-center gap-2 text-center"
            >
              <span className="text-3xl">{emoji}</span>
              <span className="text-sm font-medium text-gray-700">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
