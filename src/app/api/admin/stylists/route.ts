import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('stylists')
    .select('*, stylist_schedules(*)')
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stylists: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name: string
    line_uid?: string
    avatar_url?: string
    sort_order?: number
  }

  const { data, error } = await supabaseAdmin
    .from('stylists')
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stylist: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { id: string } & Record<string, unknown>
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('stylists')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stylist: data })
}
