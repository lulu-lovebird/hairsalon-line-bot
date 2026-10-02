'use client'

import { useEffect, useState } from 'react'
import { useAdmin } from '@/app/liff/admin/layout'
import { adminFetch } from '@/lib/admin-auth'
import Link from 'next/link'
import type { ServiceRow } from '@/types'

export default function ServicesPage() {
  useAdmin()
  const [services, setServices] = useState<ServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', duration_min: 30, price: '' })
  const [adding, setAdding] = useState(false)

  useEffect(() => { fetchServices() }, [])

  async function fetchServices() {
    setLoading(true)
    try {
      const res = await adminFetch('/api/admin/services')
      const data = await res.json() as { services: ServiceRow[] }
      setServices(data.services ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(svc: ServiceRow) {
    setUpdatingId(svc.id)
    try {
      await adminFetch('/api/admin/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: svc.id, is_active: !svc.is_active }),
      })
      await fetchServices()
    } finally {
      setUpdatingId(null)
    }
  }

  async function addService() {
    if (!form.name.trim()) return
    setAdding(true)
    try {
      await adminFetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          duration_min: form.duration_min,
          price: form.price ? Number(form.price) : null,
          sort_order: services.length,
        }),
      })
      setForm({ name: '', duration_min: 30, price: '' })
      setShowAdd(false)
      await fetchServices()
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
            <h1 className="font-bold text-gray-900 text-lg">✂️ 服務項目</h1>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="text-sm text-green-700 font-medium bg-green-50 px-3 py-1.5 rounded-lg"
          >
            + 新增
          </button>
        </div>

        {showAdd && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-4 space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">服務名稱</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例：一般剪髮"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">時長（分鐘）</label>
                <input
                  type="number"
                  value={form.duration_min}
                  onChange={(e) => setForm((f) => ({ ...f, duration_min: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">價格（選填）</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="NT$"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
            </div>
            <button
              onClick={addService}
              disabled={adding || !form.name.trim()}
              className="w-full bg-green-600 text-white text-sm py-2 rounded-lg disabled:opacity-40"
            >
              {adding ? '新增中...' : '新增服務'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-10 text-gray-400">載入中...</div>
        ) : (
          <div className="space-y-3">
            {services.map((svc) => (
              <div key={svc.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
                <div>
                  <p className={`font-medium ${svc.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                    {svc.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {svc.duration_min} 分鐘
                    {svc.price != null ? ` · NT$${svc.price}` : ''}
                  </p>
                </div>
                <button
                  disabled={updatingId === svc.id}
                  onClick={() => toggleActive(svc)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 ${
                    svc.is_active
                      ? 'bg-red-50 text-red-600 border border-red-200'
                      : 'bg-green-50 text-green-700 border border-green-200'
                  }`}
                >
                  {updatingId === svc.id ? '...' : svc.is_active ? '停用' : '啟用'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
