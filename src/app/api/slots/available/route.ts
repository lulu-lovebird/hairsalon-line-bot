import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getFutureDates, parseDateTW } from '@/lib/date'
import type { SlotTemplateRow, SlotOverrideRow, AvailableSlot, StylistRow } from '@/types'

export const runtime = 'nodejs'

/**
 * GET /api/slots/available
 * Query params:
 *   - stylist_id?: string  (optional, filter by stylist)
 *   - days?: number        (default 14, how many days ahead)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const stylistId = searchParams.get('stylist_id') ?? null
  const days = parseInt(searchParams.get('days') ?? '14', 10)

  const dates = getFutureDates(days)

  // 取得時段模板
  const { data: templates } = await supabaseAdmin
    .from('slot_templates')
    .select('*')
    .eq('is_open', true)

  // 取得特定日期覆蓋
  const { data: overrides } = await supabaseAdmin
    .from('slot_overrides')
    .select('*')
    .in('date', dates)

  // 取得未來預約計數（聚合），加入 duration_min 以支援時長重疊判定
  const { data: bookingCounts } = await supabaseAdmin
    .from('appointments')
    .select('date, start_time, duration_min, stylist_id')
    .in('date', dates)
    .in('status', ['pending', 'confirmed'])

  // 取得所有有效設計師及排班
  const { data: allStylists } = await supabaseAdmin
    .from('stylists')
    .select('id, name, avatar_url')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const { data: allSchedules } = await supabaseAdmin
    .from('stylist_schedules')
    .select('stylist_id, day_of_week, start_time, end_time')
    .eq('is_active', true)

  // 建立 dayOfWeek → stylist[] 的 map
  const stylistsByDow = new Map<number, Array<Pick<StylistRow, 'id' | 'name' | 'avatar_url'>>>()
  for (const schedule of allSchedules ?? []) {
    const s = schedule as { stylist_id: string; day_of_week: number; start_time: string; end_time: string }
    const stylist = (allStylists as Pick<StylistRow, 'id' | 'name' | 'avatar_url'>[] ?? []).find(
      (st) => st.id === s.stylist_id,
    )
    if (!stylist) continue
    const list = stylistsByDow.get(s.day_of_week) ?? []
    // 同一設計師可能有多個 schedule row，避免重複加入
    if (!list.find((item) => item.id === stylist.id)) {
      list.push({ ...stylist, _schedStart: s.start_time, _schedEnd: s.end_time } as Pick<StylistRow, 'id' | 'name' | 'avatar_url'>)
    }
    stylistsByDow.set(s.day_of_week, list)
  }

  const slots: AvailableSlot[] = []

  for (const date of dates) {
    const dayOfWeek = parseDateTW(date).getUTCDay()

    // 決定此日期的有效時段（override 優先）
    const dayTemplates = (templates as SlotTemplateRow[] ?? []).filter(
      (t) => t.day_of_week === dayOfWeek
    )
    const dayOverrides = (overrides as SlotOverrideRow[] ?? []).filter(
      (o) => o.date === date
    )

    // 建立時段 map（start_time → 設定）
    const slotMap = new Map<string, { duration_min: number; max_capacity: number; is_open: boolean }>()
    for (const t of dayTemplates) {
      slotMap.set(t.start_time, {
        duration_min: t.duration_min,
        max_capacity: t.max_capacity,
        is_open: t.is_open,
      })
    }
    // Override 覆蓋模板
    for (const o of dayOverrides) {
      slotMap.set(o.start_time, {
        duration_min: o.duration_min,
        max_capacity: o.max_capacity,
        is_open: o.is_open,
      })
    }

    for (const [startTime, slotConfig] of slotMap.entries()) {
      if (!slotConfig.is_open) continue

      // 計算此時段已被預約幾位（用時長重疊判定）
      const slotStartMin = timeToMin(startTime)
      const slotEndMin = slotStartMin + slotConfig.duration_min

      const allBookings = ((bookingCounts ?? []) as Array<{
        date: string
        start_time: string
        duration_min: number
        stylist_id: string | null
      }>).filter((b) => {
        if (b.date !== date) return false
        if (stylistId && b.stylist_id !== stylistId) return false
        // 時長重疊判定
        const bStart = timeToMin(b.start_time)
        const bEnd = bStart + b.duration_min
        return slotStartMin < bEnd && slotEndMin > bStart
      })

      const availableCount = slotConfig.max_capacity - allBookings.length
      if (availableCount <= 0) continue

      // 已有預約的設計師 ID set（用於從可用設計師清單中剥除）
      const bookedStylistIds = new Set(
        allBookings.map((b) => b.stylist_id).filter((id): id is string => id !== null),
      )

      // 過濾出當天在排班時間內、且未被預約、且符合 stylistId 篩選的設計師
      const dowStylists = stylistsByDow.get(dayOfWeek) ?? []
      const availableStylists = dowStylists.filter((s) => {
        if (stylistId && s.id !== stylistId) return false
        // 設計師已有重疊預約 → 從可用清單中剥除
        if (bookedStylistIds.has(s.id)) return false
        // 確認設計師排班時間涵蓋此時段
        const sched = s as Pick<StylistRow, 'id' | 'name' | 'avatar_url'> & { _schedStart?: string; _schedEnd?: string }
        if (sched._schedStart && sched._schedEnd) {
          if (startTime < sched._schedStart || startTime >= sched._schedEnd) return false
        }
        return true
      }).map(({ id, name, avatar_url }) => ({ id, name, avatar_url }))

      slots.push({
        date,
        start_time: startTime,
        duration_min: slotConfig.duration_min,
        available_count: availableCount,
        stylists: availableStylists,
      })
    }
  }

  // 排序：日期 ASC, 時間 ASC
  slots.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.start_time.localeCompare(b.start_time)
  })

  return NextResponse.json({ slots })
}

/** HH:MM:SS or HH:MM → 分鐘數 */
function timeToMin(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}
