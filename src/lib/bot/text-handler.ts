import type { webhook } from '@line/bot-sdk'
import { replyMessage, replyWithQuickReply } from '@/lib/line'
import { supabaseAdmin } from '@/lib/supabase'
import { todayTW, formatDateZH, formatTime } from '@/lib/date'
import { format, addDays, parseISO } from 'date-fns'
import { buildCancelQuickReplies } from '@/lib/bot/messages'
import type { CustomerRow } from '@/types'

export async function handleTextMessage(event: webhook.MessageEvent): Promise<void> {
  if (event.message.type !== 'text') return
  const { replyToken, source, message } = event
  if (!source || source.type !== 'user') return
  if (!replyToken) return

  const lineUid = (source as { userId: string }).userId
  const text = (message as { text: string }).text.trim()

  // 確保客人資料存在（upsert）
  await upsertCustomer(lineUid)

  // 指令路由
  if (text === '預約' || text === '立即預約' || text === '預約理髮') {
    await startBookingFlow(replyToken, lineUid)
    return
  }

  if (text === '我的預約' || text === '查看預約') {
    await showMyAppointments(replyToken, lineUid)
    return
  }

  if (text === '取消預約') {
    await startCancelFlow(replyToken, lineUid)
    return
  }

  // 預設回應
  await replyWithQuickReply(replyToken, '您好！請問需要什麼服務呢？', [
    {
      type: 'action',
      action: { type: 'message', label: '📅 立即預約', text: '立即預約' },
    },
    {
      type: 'action',
      action: { type: 'message', label: '🗓️ 我的預約', text: '我的預約' },
    },
    {
      type: 'action',
      action: { type: 'message', label: '❌ 取消預約', text: '取消預約' },
    },
  ])
}

async function upsertCustomer(lineUid: string): Promise<CustomerRow | null> {
  // 先查詢是否存在
  const { data: existing } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('line_uid', lineUid)
    .single()

  if (existing) return existing as CustomerRow

  // 呼叫 LINE API 取得 profile
  try {
    const { lineClient } = await import('@/lib/line')
    const profile = await lineClient.getProfile(lineUid)

    const { data } = await supabaseAdmin
      .from('customers')
      .insert({
        line_uid: lineUid,
        display_name: profile.displayName,
        picture_url: profile.pictureUrl ?? null,
      })
      .select()
      .single()

    return data as CustomerRow | null
  } catch {
    return null
  }
}

async function startBookingFlow(replyToken: string, _lineUid: string): Promise<void> {
  const today = todayTW()
  // 開放未來 30 天內預約，統一以 parseDateTW 為基準避免 UTC 跨日
  const max = format(addDays(parseISO(today), 30), 'yyyy-MM-dd')

  await replyMessage(replyToken, [
    { type: 'text', text: '📅 請選擇預約日期：' },
    {
      type: 'template',
      altText: '請選擇預約日期',
      template: {
        type: 'buttons',
        text: '請選擇希望預約的日期（30 天內）',
        actions: [
          {
            type: 'datetimepicker',
            label: '選擇日期',
            data: 'action=BOOKING_SELECT_STYLIST',
            mode: 'date',
            initial: today,
            min: today,
            max,
          },
        ],
      },
    },
  ])
}

async function showMyAppointments(replyToken: string, lineUid: string): Promise<void> {
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('line_uid', lineUid)
    .single()

  if (!customer) {
    await replyMessage(replyToken, [{ type: 'text', text: '找不到您的預約紀錄，請先進行預約！' }])
    return
  }

  const today = todayTW()  // UTC+8 台灣時區，修正原本使用 UTC 的 bug
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('*, stylist:stylists(name), service:services(name)')
    .eq('customer_id', customer.id)
    .gte('date', today)
    .in('status', ['pending', 'confirmed'])
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (!appointments || appointments.length === 0) {
    await replyMessage(replyToken, [{ type: 'text', text: '您目前沒有有效的預約。\n\n輸入「立即預約」來預約理髮服務！' }])
    return
  }

  const lines = appointments.map((apt: Record<string, unknown>) => {
    const stylistName = (apt.stylist as { name?: string } | null)?.name ?? '不限'
    const serviceName = (apt.service as { name?: string } | null)?.name ?? '未指定'
    const time = String(apt.start_time).substring(0, 5)
    return `📌 ${formatDateZH(String(apt.date))} ${time}\n   設計師：${stylistName}\n   服務：${serviceName}\n   狀態：${statusLabel(String(apt.status))}\n   編號：${String(apt.code)}`
  })

  await replyMessage(replyToken, [{
    type: 'text',
    text: `📋 您的預約（共 ${appointments.length} 筆）：\n\n${lines.join('\n\n')}`,
  }])
}

async function startCancelFlow(replyToken: string, lineUid: string): Promise<void> {
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('line_uid', lineUid)
    .single()

  if (!customer) {
    await replyMessage(replyToken, [{ type: 'text', text: '找不到您的預約紀錄。' }])
    return
  }

  const today = todayTW()
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('id, code, date, start_time')
    .eq('customer_id', customer.id)
    .gte('date', today)
    .in('status', ['pending', 'confirmed'])
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(10)

  if (!appointments || appointments.length === 0) {
    await replyMessage(replyToken, [{ type: 'text', text: '您目前沒有有效的預約可以取消。' }])
    return
  }

  const items = buildCancelQuickReplies(
    appointments as Array<{ id: string; code: string; date: string; start_time: string }>,
  )

  await replyWithQuickReply(
    replyToken,
    `您有 ${appointments.length} 筆有效預約，請選擇要取消的項目：`,
    items,
  )
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '待確認',
    confirmed: '已確認',
    arrived: '已到店',
    no_show: '未到店',
    cancelled: '已取消',
  }
  return labels[status] ?? status
}
