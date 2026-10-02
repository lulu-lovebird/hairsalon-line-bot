'use client'

import { useEffect, useState } from 'react'
import { useAdmin } from '@/app/liff/admin/layout'
import { adminFetch } from '@/lib/admin-auth'
import Link from 'next/link'
import { todayTW, formatDateZH, formatTime, parseDateTW } from '@/lib/date'
import type { SlotTemplateRow, SlotOverrideRow } from '@/types'
import { format, addDays } from 'date-fns'

type SlotDisplay = {
  start_time: string
  duration_min: number
  max_capacity: number
  is_open: boolean
  is_override: boolean
  override_id?: string
}

export default function SlotsPage() {
  useAdmin()
  const [date, setDate] = useState(todayTW())
  const [slots, setSlots] = useState<SlotDisplay[]>([])
  const [loading, setLoading] = useState(false)
  const [updatingTime, setUpdatingTime] = useState<string | null>(null)

  useEffect(() => { fetchSlots() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSlots() {
    setLoading(true)
    try {
      const dayOfWeek = parseDateTW(date).getUTCDay()
      const [tmplRes, overRes] = await Promise.all([
        adminFetch(`/api/admin/slots?type=template&day_of_week=${dayOfWeek}`),
        adminFetch(`/api/admin/slots?type=override&date=${date}`),
      ])
      const tmplData = await tmplRes.json() as { templates: SlotTemplateRow[] }
      const overData = await overRes.json() as { overrides: SlotOverrideRow[] }

      const templates = tmplData.templates ?? []
      const overrides = overData.overrides ?? []

      const map = new Map<string, SlotDisplay>()
      for (const t of templates) {
        map.set(t.start_time, {
          start_time: t.start_time,
          duration_min: t.duration_min,
          max_capacity: t.max_capacity,
          is_open: t.is_open,
          is_override: false,
        })
      }
      for (const o of overrides) {
        map.set(o.start_time, {
          start_time: o.start_time,
          duration_min: o.duration_min,
          max_capacity: o.max_capacity,
          is_open: o.is_open,
          is_override: true,
          override_id: o.id,
        })
      }

      setSlots(Array.from(map.values()).sort((a, b) => a.start_time.localeCompare(b.start_time)))
    } finally {
      setLoading(false)
    }
  }

  async function toggleSlot(slot: SlotDisplay) {
    setUpdatingTime(slot.start_time)
    try {
      if (slot.is_override && slot.override_id) {
        // 更新現有 override
        await adminFetch('/api/admin/slots', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'override', id: slot.override_id, is_open: !slot.is_open }),
        })
      } else {
        // 建立新 override
        await adminFetch('/api/admin/slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'override',
            date,
            start_time: slot.start_time,
            duration_min: slot.duration_min,
            max_capacity: slot.max_capacity,
            is_open: !slot.is_open,
          }),
        })
      }
      await fetchSlots()
    } finally {
      setUpdatingTime(null)
    }
  }

  // 快速操作：單次 API 批量封閉整天
  async function closeAllDay() {
    setLoading(true)
    try {
      await adminFetch('/api/admin/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'close_day', date }),
      })
      await fetchSlots()
    } finally {
      setLoading(false)
    }
  }

  // 快捷：選下一週每天
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    format(addDays(parseDateTW(todayTW()), i), 'yyyy-MM-dd')
  )

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/liff/admin" className="text-gray-400 hover:text-gray-600 text-xl">‹</Link>
          <h1 className="font-bold text-gray-900 text-lg">🕐 時段管理</h1>
        </div>

        {/* 日期選擇 */}
        <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
          <label className="text-xs text-gray-500 mb-2 block">選擇日期</label>
          <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
            {weekDates.map((d) => (
              <button
                key={d}
                onClick={() => setDate(d)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium ${
                  d === date ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {d.slice(5)}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          <p className="text-xs text-gray-400 mt-1">{formatDateZH(date)}</p>
        </div>

        {/* 快速操作 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={closeAllDay}
            className="flex-1 text-xs py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 font-medium"
          >
            🔒 封閉整天
          </button>
        </div>

        {/* 時段列表 */}
        {loading ? (
          <div className="text-center py-10 text-gray-400">載入中...</div>
        ) : slots.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p className="text-sm">此日期無設定時段</p>
          </div>
        ) : (
          <div className="space-y-2">
            {slots.map((slot) => (
              <div
                key={slot.start_time}
                className={`bg-white rounded-xl p-3 shadow-sm flex items-center justify-between ${
                  !slot.is_open ? 'opacity-50' : ''
                }`}
              >
                <div>
                  <span className="font-mono font-medium text-gray-900">
                    {formatTime(slot.start_time)}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    {slot.duration_min}分 · {slot.max_capacity}位
                  </span>
                  {slot.is_override && (
                    <span className="ml-2 text-xs text-orange-500">已覆蓋</span>
                  )}
                </div>
                <button
                  disabled={updatingTime === slot.start_time}
                  onClick={() => toggleSlot(slot)}
                  className={`text-xs px-3 py-1 rounded-lg font-medium disabled:opacity-40 ${
                    slot.is_open
                      ? 'bg-red-50 text-red-600 border border-red-200'
                      : 'bg-green-50 text-green-700 border border-green-200'
                  }`}
                >
                  {updatingTime === slot.start_time ? '...' : slot.is_open ? '關閉' : '開放'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
