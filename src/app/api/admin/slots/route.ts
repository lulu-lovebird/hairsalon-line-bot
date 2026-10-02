import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseDateTW } from '@/lib/date'
import { verifyAdminRequest } from '@/lib/jwt'

export const runtime = 'nodejs'

/**
 * GET /api/admin/slots
 *   ?type=template&day_of_week=1   → 取特定星期的模板時段
 *   ?type=override&date=2024-10-01 → 取特定日期的覆蓋時段
 *   (無 type)                      → 全部模板 + 指定日期覆蓋（舊行為相容）
 */
export async function GET(req: NextRequest) {
  if (!verifyAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type')
  const date = searchParams.get('date')
  const dayOfWeek = searchParams.get('day_of_week')

  if (type === 'template') {
    let query = supabaseAdmin
      .from('slot_templates')
      .select('*')
      .order('start_time')

    if (dayOfWeek !== null) {
      query = query.eq('day_of_week', Number(dayOfWeek))
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ templates: data })
  }

  if (type === 'override') {
    if (!date) return NextResponse.json({ error: 'Missing date' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('slot_overrides')
      .select('*')
      .eq('date', date)
      .order('start_time')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ overrides: data })
  }

  // 舊行為相容：返回全部模板 + 指定日期覆蓋
  const { data: templates } = await supabaseAdmin
    .from('slot_templates')
    .select('*')
    .order('day_of_week')
    .order('start_time')

  let overrides = null
  if (date) {
    const res = await supabaseAdmin
      .from('slot_overrides')
      .select('*')
      .eq('date', date)
      .order('start_time')
    overrides = res.data
  }

  return NextResponse.json({ templates, overrides })
}

/**
 * POST /api/admin/slots
 *   body.type = 'override' → upsert slot_overrides
 *   body.type = 'template' → upsert slot_templates（未來擴充）
 */
export async function POST(req: NextRequest) {
  if (!verifyAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    type?: 'override' | 'template' | 'close_day'
    date?: string
    day_of_week?: number
    start_time: string
    duration_min?: number
    max_capacity?: number
    is_open?: boolean
    note?: string
  }

  const { type, ...rest } = body

  if (!type || type === 'override') {
    if (!rest.date) return NextResponse.json({ error: 'Missing date' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('slot_overrides')
      .upsert(rest, { onConflict: 'date,start_time' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ override: data }, { status: 201 })
  }

  // 批量關閉整天：type = 'close_day'
  if (type === 'close_day') {
    const body2 = body as unknown as { type: string; date: string }
    if (!body2.date) return NextResponse.json({ error: 'Missing date' }, { status: 400 })

    // 取得當天所有模板時段
    const d = parseDateTW(body2.date)
    const dayOfWeek = d.getUTCDay()
    const { data: templates } = await supabaseAdmin
      .from('slot_templates')
      .select('start_time, duration_min, max_capacity')
      .eq('day_of_week', dayOfWeek)
      .eq('is_open', true)

    if (!templates || templates.length === 0) {
      return NextResponse.json({ closed: 0 })
    }

    const rows = templates.map((t: { start_time: string; duration_min: number; max_capacity: number }) => ({
      date: body2.date,
      start_time: t.start_time,
      duration_min: t.duration_min,
      max_capacity: t.max_capacity,
      is_open: false,
    }))

    const { error } = await supabaseAdmin
      .from('slot_overrides')
      .upsert(rows, { onConflict: 'date,start_time' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ closed: rows.length })
  }

  return NextResponse.json({ error: 'Unsupported type' }, { status: 400 })
}

/**
 * PATCH /api/admin/slots
 *   body.type = 'override' → 更新指定 override
 */
export async function PATCH(req: NextRequest) {
  if (!verifyAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    type: 'override' | 'template'
    id: string
  } & Record<string, unknown>

  const { type, id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const table = type === 'template' ? 'slot_templates' : 'slot_overrides'

  const { data, error } = await supabaseAdmin
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ slot: data })
}
