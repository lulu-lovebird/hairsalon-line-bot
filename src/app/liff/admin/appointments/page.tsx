'use client'

import { useEffect, useState } from 'react'
import { useAdmin } from '@/app/liff/admin/layout'
import { adminFetch } from '@/lib/admin-auth'
import Link from 'next/link'
import { todayTW, formatDateZH, formatTime } from '@/lib/date'
import type { AppointmentDetail, AppointmentStatus } from '@/types'

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: '待確認',
  confirmed: '已確認',
  arrived: '已到店',
  no_show: '未到店',
  cancelled: '已取消',
}

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  arrived: 'bg-green-100 text-green-700',
  no_show: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

const NEXT_STATUSES: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['arrived', 'no_show', 'cancelled'],
  arrived: ['confirmed'],    // 手滑重置
  no_show: ['confirmed'],   // 手滑重置
}

export default function AppointmentsPage() {
  useAdmin() // 確保在 auth layout 內
  const [date, setDate] = useState(todayTW())
  const [appointments, setAppointments] = useState<AppointmentDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    fetchAppointments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function fetchAppointments() {
    setLoading(true)
    try {
      const res = await adminFetch(`/api/admin/appointments?date=${date}`)
      const data = await res.json() as { appointments: AppointmentDetail[] }
      setAppointments(data.appointments ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(id: string, status: AppointmentStatus) {
    setUpdatingId(id)
    try {
      const body: Record<string, unknown> = { id, status }
      if (status === 'cancelled') body.cancelled_by = 'admin'
      await adminFetch('/api/admin/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await fetchAppointments()
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Link href="/liff/admin" className="text-gray-400 hover:text-gray-600 text-xl">‹</Link>
          <h1 className="font-bold text-gray-900 text-lg">📅 預約管理</h1>
        </div>

        {/* Date Picker */}
        <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
          <label className="text-xs text-gray-500 mb-1 block">選擇日期</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          <p className="text-xs text-gray-400 mt-1">{formatDateZH(date)}</p>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-10 text-gray-400">載入中...</div>
        ) : appointments.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm">當日無預約</p>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((apt) => (
              <div key={apt.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs text-gray-400">{apt.code}</p>
                    <p className="font-bold text-gray-900">{formatTime(apt.start_time)}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[apt.status]}`}>
                    {STATUS_LABELS[apt.status]}
                  </span>
                </div>
                <div className="text-sm text-gray-600 space-y-0.5">
                  <p>👤 {apt.customer?.display_name ?? '—'}</p>
                  <p>💇 {apt.stylist?.name ?? '不限設計師'}</p>
                  <p>✂️ {apt.service?.name ?? '未指定'}</p>
                </div>
                {/* 狀態操作按鈕 */}
                  {NEXT_STATUSES[apt.status] && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {NEXT_STATUSES[apt.status]!.map((next) => (
                      <button
                        key={next}
                        disabled={updatingId === apt.id}
                        onClick={() => updateStatus(apt.id, next)}
                        className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-opacity ${
                          next === 'cancelled'
                            ? 'bg-red-50 text-red-600 border border-red-200'
                            : next === 'confirmed'
                            ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                            : 'bg-green-50 text-green-700 border border-green-200'
                        } disabled:opacity-40`}
                      >
                        {updatingId === apt.id ? '更新中...' : STATUS_LABELS[next]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
