import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getFutureDates } from '@/lib/date'
import type { SlotTemplateRow, SlotOverrideRow, AvailableSlot } from '@/types'

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

  // 取得未來預約計數（聚合）
  const { data: bookingCounts } = await supabaseAdmin
    .from('appointments')
    .select('date, start_time, stylist_id')
    .in('date', dates)
    .in('status', ['pending', 'confirmed'])

  const slots: AvailableSlot[] = []

  for (const date of dates) {
    const dayOfWeek = new Date(date).getDay()

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

      // 計算此時段已被預約幾位
      const booked = ((bookingCounts ?? []) as Array<{ date: string; start_time: string; stylist_id: string | null }>)
        .filter((b) => {
          if (b.date !== date) return false
          if (b.start_time !== startTime) return false
          if (stylistId && b.stylist_id !== stylistId) return false
          return true
        }).length

      const availableCount = slotConfig.max_capacity - booked
      if (availableCount <= 0) continue

      slots.push({
        date,
        start_time: startTime,
        duration_min: slotConfig.duration_min,
        available_count: availableCount,
        stylists: [],  // Phase 2: populate with available stylists
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
