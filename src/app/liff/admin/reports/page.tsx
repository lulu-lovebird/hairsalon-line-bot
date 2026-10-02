'use client'

import { useEffect, useState } from 'react'
import { useAdmin } from '@/app/liff/admin/layout'
import { adminFetch } from '@/lib/admin-auth'
import Link from 'next/link'

type ReportData = {
  period: 'day' | 'week' | 'month'
  date_range: { start: string; end: string }
  total: number
  by_status: Record<string, number>
  by_stylist: Array<{ name: string; count: number }>
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待確認',
  confirmed: '已確認',
  arrived: '已到店',
  no_show: '未到店',
  cancelled: '已取消',
}

export default function ReportsPage() {
  useAdmin()
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  async function fetchReport() {
    setLoading(true)
    try {
      const res = await adminFetch(`/api/admin/reports?period=${period}`)
      if (res.ok) {
        const json = await res.json() as ReportData
        setData(json)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Link href="/liff/admin" className="text-gray-400 hover:text-gray-600 text-xl">‹</Link>
          <h1 className="font-bold text-gray-900 text-lg">📊 數據報表</h1>
        </div>

        {/* 期間切換 */}
        <div className="bg-white rounded-2xl p-2 mb-4 shadow-sm flex gap-1">
          {(['day', 'week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 text-xs py-2 rounded-xl font-medium transition-colors ${
                period === p
                  ? 'bg-green-600 text-white'
                  : 'bg-transparent text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p === 'day' ? '今日' : p === 'week' ? '近 7 天' : '本月'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">計算數據中...</div>
        ) : !data ? (
          <div className="text-center py-12 text-gray-400">暫無統計資料</div>
        ) : (
          <div className="space-y-4">
            {/* 總預約數卡片 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
              <p className="text-xs text-gray-400 mb-1">
                {data.date_range.start} ~ {data.date_range.end}
              </p>
              <h2 className="text-4xl font-extrabold text-gray-900 my-1">{data.total}</h2>
              <p className="text-xs text-gray-500 font-medium">總預約人次</p>
            </div>

            {/* 狀態分佈 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm font-bold text-gray-800 mb-3">預約狀態分佈</h3>
              <div className="space-y-2">
                {Object.entries(STATUS_LABELS).map(([key, label]) => {
                  const count = data.by_status[key] ?? 0
                  const pct = data.total > 0 ? Math.round((count / data.total) * 100) : 0
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>{label}</span>
                        <span className="font-semibold text-gray-900">
                          {count} 次 ({pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-green-600 h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 設計師排行 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm font-bold text-gray-800 mb-3">設計師接單排行</h3>
              {data.by_stylist.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">區間內尚無接單記錄</p>
              ) : (
                <div className="space-y-2">
                  {data.by_stylist
                    .sort((a, b) => b.count - a.count)
                    .map((item, idx) => (
                      <div
                        key={item.name}
                        className="flex items-center justify-between p-2 rounded-xl bg-gray-50 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs ${
                              idx === 0
                                ? 'bg-yellow-100 text-yellow-700'
                                : idx === 1
                                ? 'bg-gray-200 text-gray-700'
                                : idx === 2
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-gray-100 text-gray-400'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <span className="font-medium text-gray-900">{item.name}</span>
                        </div>
                        <span className="font-bold text-green-700">{item.count} 筆</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
