import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyAdminRequest } from '@/lib/jwt'
import { todayTW, parseDateTW } from '@/lib/date'
import { format, subDays, startOfMonth } from 'date-fns'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!verifyAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const period = searchParams.get('period') ?? 'week'  // 'day' | 'week' | 'month'

  const today = todayTW()
  const todayDateObj = parseDateTW(today)
  let startDate: string

  if (period === 'day') {
    startDate = today
  } else if (period === 'month') {
    startDate = format(startOfMonth(todayDateObj), 'yyyy-MM-dd')
  } else {
    // week: last 7 days
    startDate = format(subDays(todayDateObj, 7), 'yyyy-MM-dd')
  }

  const endDate = today

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
