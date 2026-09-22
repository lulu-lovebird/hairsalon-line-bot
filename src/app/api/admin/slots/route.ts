import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

// GET 時段模板 + 某日覆蓋
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const date = searchParams.get('date')

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

// POST 新增時段覆蓋（特定日期）
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    date: string
    start_time: string
    duration_min?: number
    max_capacity?: number
    is_open?: boolean
    note?: string
  }

  const { data, error } = await supabaseAdmin
    .from('slot_overrides')
    .upsert(body, { onConflict: 'date,start_time' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ override: data }, { status: 201 })
}

// PATCH 更新模板
export async function PATCH(req: NextRequest) {
  const body = await req.json() as { id: string; type: 'template' | 'override' } & Record<string, unknown>
  const { id, type, ...updates } = body

  if (!id || !type) return NextResponse.json({ error: 'Missing id or type' }, { status: 400 })

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
