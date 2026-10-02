import type { messagingApi } from '@line/bot-sdk'
import { formatDateZH, formatTime } from '@/lib/date'
import type { AppointmentDetail, StylistRow, ServiceRow } from '@/types'

// ============================================================
// Flex Message / Quick Reply 模板工廠
// ============================================================

/**
 * 預約確認 Flex Bubble（Stateless：所有資料直接帶在 postback.data）
 * LINE postback data 上限 300 字元，此結構約 150~180 字元，安全範圍內。
 */
export function buildBookingConfirmFlex(params: {
  date: string
  startTime: string
  stylistId: string | null
  stylistName: string
  serviceId: string
  serviceName: string
  durationMin: number
}): messagingApi.FlexMessage {
  const { date, startTime, stylistId, stylistName, serviceId, serviceName, durationMin } = params
  const dateLabel = formatDateZH(date)
  const timeLabel = formatTime(startTime)

  const confirmData = [
    'action=BOOKING_CONFIRM',
    `date=${date}`,
    `start_time=${startTime}`,
    `stylist_id=${stylistId ?? 'any'}`,
    `stylist_name=${encodeURIComponent(stylistName)}`,
    `service_id=${serviceId}`,
    `service_name=${encodeURIComponent(serviceName)}`,
    `duration=${durationMin}`,
  ].join('&')

  return {
    type: 'flex',
    altText: `確認預約：${dateLabel} ${timeLabel}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2D5016',
        contents: [
          {
            type: 'text',
            text: '✂️ 預約確認',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          buildInfoRow('📅 日期', dateLabel),
          buildInfoRow('🕐 時間', timeLabel),
          buildInfoRow('💇 設計師', stylistName),
          buildInfoRow('✂️ 服務', serviceName),
          buildInfoRow('⏱️ 時長', `約 ${durationMin} 分鐘`),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#2D5016',
            action: {
              type: 'postback',
              label: '✅ 確認預約',
              data: confirmData,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❌ 取消',
              data: 'action=BOOKING_CANCEL_FLOW',
            },
          },
        ],
      },
    },
  }
}

/** 預約成功 Flex Bubble */
export function buildBookingSuccessFlex(apt: AppointmentDetail): messagingApi.FlexMessage {
  const dateLabel = formatDateZH(apt.date)
  const timeLabel = formatTime(apt.start_time)
  const stylistName = apt.stylist?.name ?? '不限設計師'
  const serviceName = apt.service?.name ?? '未指定'
  const salonName = process.env.SALON_NAME ?? '理髮店'
  const salonAddress = process.env.SALON_ADDRESS ?? ''

  return {
    type: 'flex',
    altText: `預約成功！編號 ${apt.code}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2D5016',
        contents: [
          {
            type: 'text',
            text: '🎉 預約成功！',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          buildInfoRow('📋 編號', apt.code),
          buildInfoRow('📅 日期', dateLabel),
          buildInfoRow('🕐 時間', timeLabel),
          buildInfoRow('💇 設計師', stylistName),
          buildInfoRow('✂️ 服務', serviceName),
          ...(salonAddress ? [buildInfoRow('📍 地址', salonAddress)] : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `感謝您預約 ${salonName}，我們期待為您服務！`,
            size: 'xs',
            color: '#888888',
            wrap: true,
            align: 'center',
          },
        ],
      },
    },
  }
}

/** 取消成功訊息 */
export function buildCancelSuccessText(apt: {
  code: string
  date: string
  start_time: string
}): string {
  return `✅ 預約已取消\n\n編號：${apt.code}\n日期：${formatDateZH(apt.date)}\n時間：${formatTime(apt.start_time)}\n\n如需重新預約，請輸入「立即預約」。`
}

/**
 * 選設計師 Quick Reply items
 * Quick Reply 上限 13 個，「不限設計師」佔 1 個，設計師最多 12 個。
 */
export function buildStylistQuickReplies(
  stylists: Pick<StylistRow, 'id' | 'name'>[],
  date: string,
  startTime: string,
): messagingApi.QuickReplyItem[] {
  const capped = stylists.slice(0, 12)

  const items: messagingApi.QuickReplyItem[] = capped.map((s) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `💇 ${s.name}`.substring(0, 20),
      data: `action=BOOKING_SELECT_SERVICE&date=${date}&start_time=${startTime}&stylist_id=${s.id}&stylist_name=${encodeURIComponent(s.name)}`,
      displayText: `選擇 ${s.name}`,
    },
  }))

  items.unshift({
    type: 'action',
    action: {
      type: 'postback',
      label: '🎲 不限設計師',
      data: `action=BOOKING_SELECT_SERVICE&date=${date}&start_time=${startTime}&stylist_id=any&stylist_name=${encodeURIComponent('不限設計師')}`,
      displayText: '不限設計師',
    },
  })

  return items
}

/**
 * 選服務 Quick Reply items
 * 上限 13 個。
 */
export function buildServiceQuickReplies(
  services: Pick<ServiceRow, 'id' | 'name' | 'duration_min'>[],
  date: string,
  startTime: string,
  stylistId: string,
  stylistName: string,
): messagingApi.QuickReplyItem[] {
  return services.slice(0, 13).map((svc) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `✂️ ${svc.name}`.substring(0, 20),
      data: `action=BOOKING_CONFIRM_PREVIEW&date=${date}&start_time=${startTime}&stylist_id=${stylistId}&stylist_name=${encodeURIComponent(stylistName)}&service_id=${svc.id}&service_name=${encodeURIComponent(svc.name)}&duration=${svc.duration_min}`,
      displayText: svc.name,
    },
  }))
}

/** 取消預約 Quick Reply items（列出有效預約，上限 13 個） */
export function buildCancelQuickReplies(
  appointments: Array<{ id: string; code: string; date: string; start_time: string }>,
): messagingApi.QuickReplyItem[] {
  return appointments.slice(0, 13).map((apt) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: `${apt.date} ${formatTime(apt.start_time)}`.substring(0, 20),
      data: `action=CANCEL_CONFIRM&appointment_id=${apt.id}&code=${apt.code}`,
      displayText: `取消 ${apt.code}`,
    },
  }))
}

// ============================================================
// 內部工具
// ============================================================

function buildInfoRow(label: string, value: string): messagingApi.FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: '#555555',
        flex: 3,
      },
      {
        type: 'text',
        text: value,
        size: 'sm',
        color: '#111111',
        flex: 5,
        wrap: true,
      },
    ],
  }
}
