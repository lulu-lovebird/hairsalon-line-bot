/**
 * 產生人類可讀預約編號，格式：HS-YYYYMMDD-XXX
 * 例：HS-20241001-042
 */
export function generateAppointmentCode(date: string, sequence: number): string {
  const datePart = date.replace(/-/g, '')
  const seq = String(sequence).padStart(3, '0')
  return `HS-${datePart}-${seq}`
}

/**
 * 取得今日的預約序號（計算當天已有幾筆預約後 +1）
 */
export async function getNextSequence(
  supabaseAdmin: ReturnType<typeof import('./supabase').supabaseAdmin['from']> extends never
    ? never
    : import('@supabase/supabase-js').SupabaseClient,
  date: string
): Promise<number> {
  const { count } = await supabaseAdmin
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('date', date)

  return (count ?? 0) + 1
}
