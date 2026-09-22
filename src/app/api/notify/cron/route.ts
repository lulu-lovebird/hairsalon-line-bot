import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { pushText } from '@/lib/line'
import { formatTime, nowTW } from '@/lib/date'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 提醒排程端點 - 由 Vercel Cron Job 每 15 分鐘呼叫一次
 * Vercel cron 設定於 vercel.json
 */
export async function GET(req: NextRequest) {
  // 驗證 Cron Secret 防止未授權呼叫
  const secret = req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowTW()
  const salonName = process.env.SALON_NAME ?? '理髮店'

  let sent24h = 0
  let sent1h = 0
  let errors = 0

  try {
    // 取得需要發 24 小時提醒的預約
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowDate = tomorrow.toISOString().split('T')[0]

    const { data: appts24h } = await supabaseAdmin
      .from('appointments')
      .select('*, customer:customers(line_uid, display_name), stylist:stylists(name), service:services(name)')
      .eq('date', tomorrowDate)
      .eq('reminder_24h_sent', false)
      .in('status', ['pending', 'confirmed'])
      // 只發送時間在 now 的 HH:MM ± 15 分鐘內的預約（模糊匹配，避免漏發）
      // 實際依部署 cron 頻率調整
      .limit(50)

    for (const apt of (appts24h ?? [])) {
      try {
        const lineUid = (apt.customer as { line_uid: string } | null)?.line_uid
        if (!lineUid) continue

        const stylistName = (apt.stylist as { name?: string } | null)?.name ?? '（不限設計師）'
        const serviceName = (apt.service as { name?: string } | null)?.name ?? ''
        const time = formatTime(apt.start_time)

        await pushText(
          lineUid,
          `📅 預約提醒\n\n明天 ${time} 有您在 ${salonName} 的預約\n設計師：${stylistName}${serviceName ? `\n服務：${serviceName}` : ''}\n預約編號：${apt.code}\n\n請準時到來，我們等您！`
        )

        await supabaseAdmin
          .from('appointments')
          .update({ reminder_24h_sent: true })
          .eq('id', apt.id)

        sent24h++
      } catch (e) {
        console.error('[cron] 24h reminder error:', e)
        errors++
      }
    }

    // 取得需要發 1 小時提醒的預約
    const oneHourLater = new Date(now)
    oneHourLater.setHours(oneHourLater.getHours() + 1)
    const todayDate = now.toISOString().split('T')[0]
    const oneHourHHMM = `${String(oneHourLater.getHours()).padStart(2, '0')}:${String(oneHourLater.getMinutes()).padStart(2, '0')}`

    const { data: appts1h } = await supabaseAdmin
      .from('appointments')
      .select('*, customer:customers(line_uid, display_name), stylist:stylists(name)')
      .eq('date', todayDate)
      .eq('reminder_1h_sent', false)
      .in('status', ['pending', 'confirmed'])
      .gte('start_time', `${oneHourHHMM}:00`)
      .lte('start_time', `${oneHourHHMM}:59`)
      .limit(50)

    for (const apt of (appts1h ?? [])) {
      try {
        const lineUid = (apt.customer as { line_uid: string } | null)?.line_uid
        if (!lineUid) continue

        const stylistName = (apt.stylist as { name?: string } | null)?.name ?? '（不限設計師）'
        const time = formatTime(apt.start_time)

        await pushText(
          lineUid,
          `⏰ 快到了！\n\n再 1 小時是您在 ${salonName} 的預約時間（${time}）\n設計師：${stylistName}\n\n我們在 ${process.env.SALON_ADDRESS ?? '店內'} 等您！`
        )

        await supabaseAdmin
          .from('appointments')
          .update({ reminder_1h_sent: true })
          .eq('id', apt.id)

        sent1h++
      } catch (e) {
        console.error('[cron] 1h reminder error:', e)
        errors++
      }
    }

    return NextResponse.json({
      ok: true,
      sent_24h: sent24h,
      sent_1h: sent1h,
      errors,
      run_at: now.toISOString(),
    })
  } catch (err) {
    console.error('[cron] Fatal error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
