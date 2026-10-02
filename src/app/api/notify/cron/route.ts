import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { pushText } from '@/lib/line'
import { formatTime, nowTW, todayTW, parseDateTW } from '@/lib/date'
import { format, addDays } from 'date-fns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 提醒排程端點 - 由 Vercel Cron Job 每 15 分鐘呼叫一次
 * vercel.json: { "path": "/api/notify/cron", "schedule": "* /15 * * * *" }
 *
 * 24h 提醒：每晚 20:00～20:14 統一對明天所有預約發送（避免半夜擾民）
 * 1h  提醒：每次執行時，對 1 小時後 ±7 分鐘內的預約發送
 */
export async function GET(req: NextRequest) {
  // 驗證 Cron Secret 防止未授權呼叫
  // 支援 1. Vercel 原生 Cron Header (Authorization: Bearer <CRON_SECRET>)
  //      2. 自訂 Header (x-cron-secret)
  //      3. Query parameter (?secret=)
  const authHeader = req.headers.get('authorization')
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null
  const headerSecret = req.headers.get('x-cron-secret')
  const querySecret = req.nextUrl.searchParams.get('secret')

  const secret = bearerSecret ?? headerSecret ?? querySecret
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowTW()
  const salonName = process.env.SALON_NAME ?? '理髮店'

  let sent24h = 0
  let sent1h = 0
  let errors = 0

  try {
    // ── 24h 提醒：僅在每晚 20:00～20:14（台灣時間）執行 ──────────────────
    if (now.getHours() === 20) {
      const tomorrowDate = format(addDays(parseDateTW(todayTW()), 1), 'yyyy-MM-dd')

      const { data: appts24h } = await supabaseAdmin
        .from('appointments')
        .select('*, customer:customers(line_uid, display_name), stylist:stylists(name), service:services(name)')
        .eq('date', tomorrowDate)
        .eq('reminder_24h_sent', false)
        .in('status', ['pending', 'confirmed'])
        .limit(100)

      for (const apt of appts24h ?? []) {
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
    }

    // ── 1h 提醒：每次執行，±7 分鐘窗口（適配 15 分鐘 cron 間隔） ─────────
    const todayDate = todayTW()
    const targetMin = now.getHours() * 60 + now.getMinutes() + 60
    const windowStart = targetMin - 7
    const windowEnd = targetMin + 7

    const toHHMM = (mins: number): string => {
      const h = Math.floor(mins / 60) % 24
      const m = mins % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    const { data: appts1h } = await supabaseAdmin
      .from('appointments')
      .select('*, customer:customers(line_uid, display_name), stylist:stylists(name)')
      .eq('date', todayDate)
      .eq('reminder_1h_sent', false)
      .in('status', ['pending', 'confirmed'])
      .gte('start_time', `${toHHMM(windowStart)}:00`)
      .lte('start_time', `${toHHMM(windowEnd)}:59`)
      .limit(50)

    for (const apt of appts1h ?? []) {
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
