import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const period = searchParams.get('period') ?? 'week'  // 'day' | 'week' | 'month'

  const now = new Date()
  let startDate: string

  if (period === 'day') {
    startDate = now.toISOString().split('T')[0]
  } else if (period === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    startDate = firstDay.toISOString().split('T')[0]
  } else {
    // week: last 7 days
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    startDate = weekAgo.toISOString().split('T')[0]
  }

  const endDate = now.toISOString().split('T')[0]

  // 各狀態計數
  const { data: statusCounts } = await supabaseAdmin
    .from('appointments')
    .select('status')
    .gte('date', startDate)
    .lte('date', endDate)

  const counts: Record<string, number> = {}
  for (const { status } of (statusCounts ?? [])) {
    counts[status] = (counts[status] ?? 0) + 1
  }

  // 各設計師接單量
  const { data: stylistData } = await supabaseAdmin
    .from('appointments')
    .select('stylist_id, stylist:stylists(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .neq('status', 'cancelled')

  const stylistCounts: Record<string, { name: string; count: number }> = {}
  for (const item of (stylistData ?? [])) {
    const sid = item.stylist_id ?? 'unassigned'
    const name = (item.stylist as { name?: string } | null)?.name ?? '未指定'
    if (!stylistCounts[sid]) stylistCounts[sid] = { name, count: 0 }
    stylistCounts[sid].count++
  }

  return NextResponse.json({
    period,
    date_range: { start: startDate, end: endDate },
    total: statusCounts?.length ?? 0,
    by_status: counts,
    by_stylist: Object.values(stylistCounts),
  })
}
