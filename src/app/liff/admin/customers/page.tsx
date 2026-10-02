'use client'

import { useEffect, useState } from 'react'
import { useAdmin } from '@/app/liff/admin/layout'
import { adminFetch } from '@/lib/admin-auth'
import Link from 'next/link'
import type { CustomerRow } from '@/types'

export default function CustomersPage() {
  useAdmin()
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchCustomers() }, [])

  async function fetchCustomers() {
    setLoading(true)
    try {
      const res = await adminFetch('/api/admin/customers')
      const data = await res.json() as { customers: CustomerRow[] }
      setCustomers(data.customers ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function saveNote(id: string) {
    setSaving(true)
    try {
      await adminFetch('/api/admin/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes: noteText }),
      })
      setEditingId(null)
      await fetchCustomers()
    } finally {
      setSaving(false)
    }
  }

  const filtered = customers.filter((c) =>
    c.display_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/liff/admin" className="text-gray-400 hover:text-gray-600 text-xl">‹</Link>
          <h1 className="font-bold text-gray-900 text-lg">👥 客人管理</h1>
        </div>

        {/* 搜尋 */}
        <div className="bg-white rounded-2xl p-3 mb-4 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋客人姓名..."
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
          />
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">載入中...</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => (
              <div key={c.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  {c.picture_url ? (
                    <img src={c.picture_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-xl">👤</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{c.display_name}</p>
                    <p className="text-xs text-gray-400">加入：{c.created_at.slice(0, 10)}</p>
                  </div>
                </div>

                {editingId === c.id ? (
                  <div className="mt-2">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={3}
                      placeholder="店家備註（偏好、注意事項）"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => saveNote(c.id)}
                        disabled={saving}
                        className="flex-1 text-sm py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-40"
                      >
                        {saving ? '儲存中...' : '儲存'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex-1 text-sm py-1.5 rounded-lg bg-gray-100 text-gray-600"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1">
                    {c.notes ? (
                      <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2">{c.notes}</p>
                    ) : (
                      <p className="text-xs text-gray-300">尚無備註</p>
                    )}
                    <button
                      onClick={() => { setEditingId(c.id); setNoteText(c.notes ?? '') }}
                      className="text-xs text-green-600 mt-1"
                    >
                      ✏️ 編輯備註
                    </button>
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                <div className="text-3xl mb-2">🔍</div>
                <p className="text-sm">找不到符合的客人</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
