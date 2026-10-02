'use client'

import { useEffect, useState } from 'react'
import { useAdmin } from '@/app/liff/admin/layout'
import { adminFetch } from '@/lib/admin-auth'
import Link from 'next/link'
import type { StylistRow } from '@/types'

export default function StylistsPage() {
  useAdmin()
  const [stylists, setStylists] = useState<StylistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { fetchStylists() }, [])

  async function fetchStylists() {
    setLoading(true)
    try {
      const res = await adminFetch('/api/admin/stylists')
      const data = await res.json() as { stylists: StylistRow[] }
      setStylists(data.stylists ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(stylist: StylistRow) {
    setUpdatingId(stylist.id)
    try {
      await adminFetch('/api/admin/stylists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: stylist.id, is_active: !stylist.is_active }),
      })
      await fetchStylists()
    } finally {
      setUpdatingId(null)
    }
  }

  async function addStylist() {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await adminFetch('/api/admin/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), sort_order: stylists.length }),
      })
      setNewName('')
      setShowAdd(false)
      await fetchStylists()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link href="/liff/admin" className="text-gray-400 hover:text-gray-600 text-xl">‹</Link>
            <h1 className="font-bold text-gray-900 text-lg">💈 設計師管理</h1>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="text-sm text-green-700 font-medium bg-green-50 px-3 py-1.5 rounded-lg"
          >
            + 新增
          </button>
        </div>

        {showAdd && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
            <label className="text-xs text-gray-500 mb-1 block">設計師姓名</label>
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="輸入姓名..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              />
              <button
                onClick={addStylist}
                disabled={adding || !newName.trim()}
                className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-40"
              >
                {adding ? '...' : '新增'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-10 text-gray-400">載入中...</div>
        ) : (
          <div className="space-y-3">
            {stylists.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {s.avatar_url ? (
                    <img src={s.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-xl">💇</div>
                  )}
                  <div>
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <p className={`text-xs ${s.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                      {s.is_active ? '接單中' : '已暫停'}
                    </p>
                  </div>
                </div>
                <button
                  disabled={updatingId === s.id}
                  onClick={() => toggleActive(s)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity disabled:opacity-40 ${
                    s.is_active
                      ? 'bg-red-50 text-red-600 border border-red-200'
                      : 'bg-green-50 text-green-700 border border-green-200'
                  }`}
                >
                  {updatingId === s.id ? '...' : s.is_active ? '暫停接單' : '恢復接單'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
