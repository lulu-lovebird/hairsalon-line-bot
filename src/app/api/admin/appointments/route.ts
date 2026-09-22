import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const date = searchParams.get('date')
  const status = searchParams.get('status')
  const stylistId = searchParams.get('stylist_id')

  let query = supabaseAdmin
    .from('appointments')
    .select('*, customer:customers(*), stylist:stylists(*), service:services(*)')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (date) query = query.eq('date', date)
  if (status) query = query.eq('status', status)
  if (stylistId) query = query.eq('stylist_id', stylistId)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ appointments: data })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { id: string } & Record<string, unknown>
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ appointment: data })
}
