import type { webhook, messagingApi } from '@line/bot-sdk'
import { replyMessage, replyWithQuickReply } from '@/lib/line'
import { supabaseAdmin } from '@/lib/supabase'
import { todayTW, nowTW, nowTWHHMM, parseDateTW } from '@/lib/date'
import { generateAppointmentCode, getNextSequence } from '@/lib/appointment-code'
import {
  buildStylistQuickReplies,
  buildServiceQuickReplies,
  buildBookingConfirmFlex,
  buildBookingSuccessFlex,
  buildCancelSuccessText,
} from '@/lib/bot/messages'
import type { AppointmentDetail, StylistRow, ServiceRow } from '@/types'

// ============================================================
// Postback data format（全 Stateless，無伺服器端暫存）：
//   action=BOOKING_SELECT_STYLIST&date=2024-10-01
//   action=BOOKING_SELECT_SERVICE&date=...&start_time=...&stylist_id=...&stylist_name=...
//   action=BOOKING_CONFIRM_PREVIEW&date=...&start_time=...&stylist_id=...&stylist_name=...&service_id=...&service_name=...&duration=30
//   action=BOOKING_CONFIRM&date=...&start_time=...&stylist_id=...&stylist_name=...&service_id=...&service_name=...&duration=30
//   action=BOOKING_CANCEL_FLOW
//   action=CANCEL_CONFIRM&appointment_id=...&code=...
// ============================================================

export async function handlePostback(event: webhook.PostbackEvent): Promise<void> {
  const { replyToken, postback, source } = event
  if (!replyToken) return
  if (!source || source.type !== 'user') return

  const lineUid = (source as { userId: string }).userId
  const params = new URLSearchParams(postback.data)
  const action = params.get('action')

  switch (action) {
    case 'BOOKING_SELECT_STYLIST':
      await handleSelectStylist(replyToken, params)
      break

    case 'BOOKING_SELECT_SERVICE':
      await handleSelectService(replyToken, params)
      break

    case 'BOOKING_CONFIRM_PREVIEW':
      await handleConfirmPreview(replyToken, params)
      break

    case 'BOOKING_CONFIRM':
      await handleBookingConfirm(replyToken, lineUid, params)
      break

    case 'BOOKING_CANCEL_FLOW':
      await replyMessage(replyToken, [
        { type: 'text', text: '已取消預約流程。如需重新預約，請輸入「立即預約」。' },
      ])
      break

    case 'BOOKING_SELECT_TIME_GROUP':
      await handleSelectTimeGroup(replyToken, params)
      break

    case 'CANCEL_CONFIRM':
      await handleCancelConfirm(replyToken, lineUid, params)
      break

    default:
      await replyMessage(replyToken, [{ type: 'text', text: '未知操作，請重試。' }])
  }
}

// ============================================================
// Step 1: Datetime Picker 回傳日期 → 列出有排班的設計師
// ============================================================
async function handleSelectStylist(
  replyToken: string,
  params: URLSearchParams,
): Promise<void> {
  const date = params.get('date')

  if (!date) {
    await replyMessage(replyToken, [{ type: 'text', text: '日期格式有誤，請重新選擇。' }])
    return
  }

  const today = todayTW()
  if (date < today) {
    await replyMessage(replyToken, [{ type: 'text', text: '不可選擇過去的日期，請重新選擇。' }])
    return
  }

  // 使用 parseDateTW 避免 getDay() UTC 位移
  const dayOfWeek = parseDateTW(date).getUTCDay()

  const { data: stylists } = await supabaseAdmin
    .from('stylists')
    .select('id, name')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const { data: schedules } = await supabaseAdmin
    .from('stylist_schedules')
    .select('stylist_id')
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  const availableStylistIds = new Set(
    (schedules ?? []).map((s: { stylist_id: string }) => s.stylist_id),
  )
  const availableStylists = (
    (stylists ?? []) as Pick<StylistRow, 'id' | 'name'>[]
  ).filter((s) => availableStylistIds.has(s.id))

  if (availableStylists.length === 0) {
    await replyMessage(replyToken, [
      { type: 'text', text: `😢 ${date} 當天沒有設計師排班，請選擇其他日期。` },
    ])
    return
  }

  const items = buildStylistQuickReplies(availableStylists, date, '')

  await replyWithQuickReply(replyToken, `📅 已選擇 ${date}\n\n請選擇設計師：`, items)
}

// ============================================================
// Step 2: 選設計師 → 列出可用服務
// ============================================================
async function handleSelectService(
  replyToken: string,
  params: URLSearchParams,
): Promise<void> {
  const date = params.get('date')
  const startTime = params.get('start_time') ?? ''
  const stylistId = params.get('stylist_id')
  const stylistName = decodeURIComponent(params.get('stylist_name') ?? '')

  if (!date || !stylistId) {
    await replyMessage(replyToken, [{ type: 'text', text: '資料遺失，請重新開始預約流程。' }])
    return
  }

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, name, duration_min')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (!services || services.length === 0) {
    await replyMessage(replyToken, [
      { type: 'text', text: '目前沒有可用的服務項目，請稍後再試。' },
    ])
    return
  }

  const items = buildServiceQuickReplies(
    services as Pick<ServiceRow, 'id' | 'name' | 'duration_min'>[],
    date,
    startTime,
    stylistId,
    stylistName,
  )

  const stylistLabel =
    stylistName === '不限設計師' ? '不限設計師' : `設計師：${stylistName}`
  await replyWithQuickReply(replyToken, `${stylistLabel}\n\n請選擇服務項目：`, items)
}

// ============================================================
// Step 3: 選服務 → 選時段 or 顯示確認 Flex Card
// ============================================================
async function handleConfirmPreview(
  replyToken: string,
  params: URLSearchParams,
): Promise<void> {
  const date = params.get('date')
  const startTime = params.get('start_time') ?? ''
  const stylistId = params.get('stylist_id')
  const stylistName = decodeURIComponent(params.get('stylist_name') ?? '')
  const serviceId = params.get('service_id')
  const serviceName = decodeURIComponent(params.get('service_name') ?? '')
  const durationMin = parseInt(params.get('duration') ?? '30', 10)

  if (!date || !stylistId || !serviceId) {
    await replyMessage(replyToken, [{ type: 'text', text: '資料遺失，請重新開始預約流程。' }])
    return
  }

  // 尚未選時段 → 呈現可用時段清單
  if (!startTime) {
    await promptSelectTime(
      replyToken,
      date,
      stylistId,
      stylistName,
      serviceId,
      serviceName,
      durationMin,
    )
    return
  }

  // 驗證時段是否仍有空位
  const resolvedStylistId = stylistId === 'any' ? null : stylistId
  const available = await checkSlotAvailable(date, startTime, resolvedStylistId, durationMin)
  if (!available) {
    await replyMessage(replyToken, [{ type: 'text', text: '😢 此時段已額滿，請重新選擇時間。' }])
    return
  }

  const flex = buildBookingConfirmFlex({
    date,
    startTime,
    stylistId: resolvedStylistId,
    stylistName,
    serviceId,
    serviceName,
    durationMin,
  })

  await replyMessage(replyToken, [flex])
}

// ============================================================
// Step 4: 確認預約 → 寫入 DB（Stateless，直接從 params 取資料）
// ============================================================
async function handleBookingConfirm(
  replyToken: string,
  lineUid: string,
  params: URLSearchParams,
): Promise<void> {
  const date = params.get('date')
  const startTime = params.get('start_time')
  const stylistIdRaw = params.get('stylist_id')
  const stylistName = decodeURIComponent(params.get('stylist_name') ?? '')
  const serviceId = params.get('service_id')
  const serviceName = decodeURIComponent(params.get('service_name') ?? '')
  const durationMin = parseInt(params.get('duration') ?? '30', 10)

  if (!date || !startTime || !stylistIdRaw || !serviceId) {
    await replyMessage(replyToken, [{ type: 'text', text: '預約資料不完整，請重新開始。' }])
    return
  }

  const stylistId = stylistIdRaw === 'any' ? null : stylistIdRaw

  // 防競態：再次確認時段有空位
  const available = await checkSlotAvailable(date, startTime, stylistId, durationMin)
  if (!available) {
    await replyMessage(replyToken, [
      { type: 'text', text: '😢 非常抱歉，剛才有其他人搶先預約了此時段，請重新選擇時間。' },
    ])
    return
  }

  // 取得客人 ID（若不存在則自動建立）
  let { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('line_uid', lineUid)
    .single()

  if (!customer) {
    // 客人尚未發送過文字訊息就直接點按確認按鈕，自動補建資料
    try {
      const { lineClient } = await import('@/lib/line')
      const profile = await lineClient.getProfile(lineUid)
      const { data: created } = await supabaseAdmin
        .from('customers')
        .insert({ line_uid: lineUid, display_name: profile.displayName, picture_url: profile.pictureUrl ?? null })
        .select('id')
        .single()
      customer = created
    } catch {
      // getProfile 失敗時回側錯
    }
  }

  if (!customer) {
    await replyMessage(replyToken, [{ type: 'text', text: '客人資料異常，請重試。' }])
    return
  }

  // 產生預約編號
  const sequence = await getNextSequence(supabaseAdmin, date)
  const code = generateAppointmentCode(date, sequence)

  // 寫入預約
  const { data: newApt, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      code,
      customer_id: (customer as { id: string }).id,
      stylist_id: stylistId,
      service_id: serviceId,
      date,
      start_time: startTime,
      duration_min: durationMin,
      status: 'confirmed',
    })
    .select('*, stylist:stylists(*), service:services(*), customer:customers(*)')
    .single()

  if (error || !newApt) {
    console.error('[postback] Insert appointment error:', error)
    await replyMessage(replyToken, [{ type: 'text', text: '預約寫入失敗，請稍後再試。' }])
    return
  }

  // 建立 AppointmentDetail 型別安全結構
  const aptDetail: AppointmentDetail = {
    ...(newApt as AppointmentDetail),
    stylist: (newApt as { stylist: StylistRow | null }).stylist,
    service: (newApt as { service: ServiceRow | null }).service,
    customer: (newApt as { customer: AppointmentDetail['customer'] }).customer,
  }

  const flex = buildBookingSuccessFlex(aptDetail)
  await replyMessage(replyToken, [flex])
}

// ============================================================
// 取消流程：確認取消
// ============================================================
async function handleCancelConfirm(
  replyToken: string,
  lineUid: string,
  params: URLSearchParams,
): Promise<void> {
  const appointmentId = params.get('appointment_id')

  if (!appointmentId) {
    await replyMessage(replyToken, [{ type: 'text', text: '資料遺失，請重試。' }])
    return
  }

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('line_uid', lineUid)
    .single()

  if (!customer) {
    await replyMessage(replyToken, [{ type: 'text', text: '找不到您的資料，請重試。' }])
    return
  }

  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, code, date, start_time, customer_id, status')
    .eq('id', appointmentId)
    .single()

  if (!apt) {
    await replyMessage(replyToken, [{ type: 'text', text: '找不到此預約，請重試。' }])
    return
  }

  const aptRow = apt as {
    id: string
    code: string
    date: string
    start_time: string
    customer_id: string
    status: string
  }

  if (aptRow.customer_id !== (customer as { id: string }).id) {
    await replyMessage(replyToken, [{ type: 'text', text: '此預約不屬於您的帳號。' }])
    return
  }

  if (!['pending', 'confirmed'].includes(aptRow.status)) {
    await replyMessage(replyToken, [{ type: 'text', text: '此預約已無法取消。' }])
    return
  }

  const { error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'cancelled', cancelled_by: 'customer' })
    .eq('id', appointmentId)

  if (error) {
    console.error('[postback] Cancel appointment error:', error)
    await replyMessage(replyToken, [{ type: 'text', text: '取消失敗，請稍後再試。' }])
    return
  }

  const text = buildCancelSuccessText(aptRow)
  await replyMessage(replyToken, [{ type: 'text', text }])
}

// ============================================================
// 工具函式
// ============================================================

/**
 * 檢查時段是否仍有空位。
 *
 * 雙重防護邏輯（不論是否指定設計師都必須同時通過）：
 *   1. 全店總量防護：date+startTime 區間內的重疊預約總數 < maxCapacity
 *   2. 設計師個人防護（指定設計師時）：該設計師在 [start, end) 無時間衝突
 */
async function checkSlotAvailable(
  date: string,
  startTime: string,
  stylistId: string | null,
  durationMin: number,
): Promise<boolean> {
  // ── 取得 max_capacity（override 優先）──────────────────────
  const { data: override } = await supabaseAdmin
    .from('slot_overrides')
    .select('max_capacity, is_open')
    .eq('date', date)
    .eq('start_time', startTime)
    .maybeSingle()

  let maxCapacity: number
  if (override) {
    const o = override as { max_capacity: number; is_open: boolean }
    if (!o.is_open) return false
    maxCapacity = o.max_capacity
  } else {
    const dayOfWeek = parseDateTW(date).getUTCDay()
    const { data: template } = await supabaseAdmin
      .from('slot_templates')
      .select('max_capacity, is_open')
      .eq('day_of_week', dayOfWeek)
      .eq('start_time', startTime)
      .maybeSingle()

    if (!template) return false
    const t = template as { max_capacity: number; is_open: boolean }
    if (!t.is_open) return false
    maxCapacity = t.max_capacity
  }

  const newStart = timeToMinutes(startTime)
  const newEnd = newStart + durationMin

  // ── 防護 1：全店總量（時長重疊計數）──────────────────────────
  // 取出同一天所有有效預約，計算與 [newStart, newEnd) 有時間交集的筆數
  const { data: allBooked } = await supabaseAdmin
    .from('appointments')
    .select('start_time, duration_min')
    .eq('date', date)
    .in('status', ['pending', 'confirmed'])

  const storeOverlapCount = (allBooked ?? []).filter((appt) => {
    const row = appt as { start_time: string; duration_min: number }
    const existStart = timeToMinutes(row.start_time)
    const existEnd = existStart + row.duration_min
    return newStart < existEnd && newEnd > existStart
  }).length

  if (storeOverlapCount >= maxCapacity) return false

  // ── 防護 2：指定設計師個人衝突檢查 ───────────────────────────
  if (stylistId) {
    const { data: stylistBooked } = await supabaseAdmin
      .from('appointments')
      .select('start_time, duration_min')
      .eq('date', date)
      .eq('stylist_id', stylistId)
      .in('status', ['pending', 'confirmed'])

    for (const appt of stylistBooked ?? []) {
      const row = appt as { start_time: string; duration_min: number }
      const existStart = timeToMinutes(row.start_time)
      const existEnd = existStart + row.duration_min
      if (newStart < existEnd && newEnd > existStart) return false
    }
  }

  return true
}

/** HH:MM:SS or HH:MM → 分鐘數 */
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/**
 * 使用者選擇上午/下午後，送出對應時段的 Quick Reply
 */
async function handleSelectTimeGroup(
  replyToken: string,
  params: URLSearchParams,
): Promise<void> {
  const group = params.get('group') as 'morning' | 'afternoon' | null
  const date = params.get('date')
  const stylistId = params.get('stylist_id') ?? ''
  const stylistName = decodeURIComponent(params.get('stylist_name') ?? '')
  const serviceId = params.get('service_id') ?? ''
  const serviceName = decodeURIComponent(params.get('service_name') ?? '')
  const durationMin = parseInt(params.get('duration') ?? '30', 10)

  if (!group || !date) {
    await replyMessage(replyToken, [{ type: 'text', text: '資料遺失，請重新開始預約流程。' }])
    return
  }

  // 重新查詢可用時段（與 promptSelectTime 相同邏輯）
  await promptSelectTime(
    replyToken, date, stylistId, stylistName, serviceId, serviceName, durationMin, group,
  )
}

/**
 * 查詢當日可用時段並以 Quick Reply 呈現。
 * - ≤ 13 個：直接送出全部
 * - > 13 個：先送上午/下午兩個選項，使用者點擊後再送對應時段清單
 */
async function promptSelectTime(
  replyToken: string,
  date: string,
  stylistId: string,
  stylistName: string,
  serviceId: string,
  serviceName: string,
  durationMin: number,
  group?: 'morning' | 'afternoon',
): Promise<void> {
  const dayOfWeek = parseDateTW(date).getUTCDay()
  const today = todayTW()
  const isToday = date === today

  // 當日目前時間（僅在 date === today 時過濾已過時段）
  const nowHHMM = isToday ? nowTWHHMM() : '00:00'

  const { data: templates } = await supabaseAdmin
    .from('slot_templates')
    .select('start_time, max_capacity, is_open')
    .eq('day_of_week', dayOfWeek)
    .eq('is_open', true)
    .order('start_time', { ascending: true })

  const { data: overrides } = await supabaseAdmin
    .from('slot_overrides')
    .select('start_time, max_capacity, is_open')
    .eq('date', date)

  const slotMap = new Map<string, { max_capacity: number; is_open: boolean }>()
  for (const t of templates ?? []) {
    const row = t as { start_time: string; max_capacity: number; is_open: boolean }
    slotMap.set(row.start_time, { max_capacity: row.max_capacity, is_open: row.is_open })
  }
  for (const o of overrides ?? []) {
    const row = o as { start_time: string; max_capacity: number; is_open: boolean }
    slotMap.set(row.start_time, { max_capacity: row.max_capacity, is_open: row.is_open })
  }

  // 取得已預約數
  const { data: booked } = await supabaseAdmin
    .from('appointments')
    .select('start_time')
    .eq('date', date)
    .in('status', ['pending', 'confirmed'])

  const bookedCounts = new Map<string, number>()
  for (const b of booked ?? []) {
    const t = (b as { start_time: string }).start_time
    bookedCounts.set(t, (bookedCounts.get(t) ?? 0) + 1)
  }

  // 過濾：開放、未滿、且（非今天 or 時段尚未過去）
  const availableSlots = Array.from(slotMap.entries())
    .filter(([startTime, config]) => {
      if (!config.is_open) return false
      if ((bookedCounts.get(startTime) ?? 0) >= config.max_capacity) return false
      // 今天：過濾掉已過的時段（加 30 分鐘緩衝，避免太趕）
      if (isToday && startTime.substring(0, 5) <= nowHHMM) return false
      return true
    })
    .map(([startTime]) => startTime)
    .sort()

  if (availableSlots.length === 0) {
    await replyMessage(replyToken, [
      { type: 'text', text: `😢 ${date} 當天已無可用時段，請選擇其他日期。` },
    ])
    return
  }

  // 若指定了 group（第二階段），直接過濾對應時段送出
  const buildSlotItem = (startTime: string): messagingApi.QuickReplyItem => ({
    type: 'action',
    action: {
      type: 'postback',
      label: startTime.substring(0, 5),
      data: `action=BOOKING_CONFIRM_PREVIEW&date=${date}&start_time=${startTime}&stylist_id=${stylistId}&stylist_name=${encodeURIComponent(stylistName)}&service_id=${serviceId}&service_name=${encodeURIComponent(serviceName)}&duration=${durationMin}`,
      displayText: `選擇 ${startTime.substring(0, 5)}`,
    },
  })

  if (group) {
    const filtered = group === 'morning'
      ? availableSlots.filter((t) => t.substring(0, 2) < '12')
      : availableSlots.filter((t) => t.substring(0, 2) >= '12')

    if (filtered.length === 0) {
      await replyMessage(replyToken, [{ type: 'text', text: '此時段區間已無可用時段，請選擇其他區間。' }])
      return
    }

    await replyWithQuickReply(
      replyToken,
      `請選擇 ${date} ${group === 'morning' ? '🌅 上午' : '🌆 下午'}的時段：`,
      filtered.slice(0, 13).map(buildSlotItem),
    )
    return
  }

  // ≤ 13 個：直接一次送出
  if (availableSlots.length <= 13) {
    await replyWithQuickReply(
      replyToken,
      `請選擇 ${date} 的可用時段：`,
      availableSlots.map(buildSlotItem),
    )
    return
  }

  // > 13 個：兩階段選擇（先選上午/下午，再送對應時段清單）
  // 此處送出「上午/下午選擇」Quick Reply，讓使用者點擊後觸發另一個 postback
  // 為維持 stateless，直接把分段時段 label 壓在 Quick Reply 內（各最多 13 個）
  const morning = availableSlots.filter((t) => t.substring(0, 2) < '12')
  const afternoon = availableSlots.filter((t) => t.substring(0, 2) >= '12')

  // 先告知使用者有多少時段，並請選上午或下午
  const groupItems: messagingApi.QuickReplyItem[] = []
  if (morning.length > 0) {
    groupItems.push({
      type: 'action',
      action: {
        type: 'postback',
        label: `🌅 上午（${morning.length} 個）`,
        data: `action=BOOKING_SELECT_TIME_GROUP&group=morning&date=${date}&stylist_id=${stylistId}&stylist_name=${encodeURIComponent(stylistName)}&service_id=${serviceId}&service_name=${encodeURIComponent(serviceName)}&duration=${durationMin}`,
        displayText: '選擇上午時段',
      },
    })
  }
  if (afternoon.length > 0) {
    groupItems.push({
      type: 'action',
      action: {
        type: 'postback',
        label: `🌆 下午（${afternoon.length} 個）`,
        data: `action=BOOKING_SELECT_TIME_GROUP&group=afternoon&date=${date}&stylist_id=${stylistId}&stylist_name=${encodeURIComponent(stylistName)}&service_id=${serviceId}&service_name=${encodeURIComponent(serviceName)}&duration=${durationMin}`,
        displayText: '選擇下午時段',
      },
    })
  }

  await replyWithQuickReply(
    replyToken,
    `${date} 有 ${availableSlots.length} 個可用時段，請先選擇時段區間：`,
    groupItems,
  )
}
