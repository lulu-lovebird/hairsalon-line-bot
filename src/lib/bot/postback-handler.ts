import type { webhook } from '@line/bot-sdk'
import { replyMessage } from '@/lib/line'

// Postback data format: action=BOOKING_SELECT_DATE&date=2024-10-01
export async function handlePostback(event: webhook.PostbackEvent): Promise<void> {
  const { replyToken, postback } = event
  if (!replyToken) return

  const params = new URLSearchParams(postback.data)
  const action = params.get('action')

  switch (action) {
    // Phase 2 will implement each step
    case 'BOOKING_SELECT_DATE':
    case 'BOOKING_SELECT_STYLIST':
    case 'BOOKING_SELECT_TIME':
    case 'BOOKING_SELECT_SERVICE':
    case 'BOOKING_CONFIRM':
    case 'CANCEL_SELECT':
    case 'CANCEL_CONFIRM':
      await replyMessage(replyToken, [{ type: 'text', text: '此功能正在建置中，請稍候！' }])
      break
    default:
      await replyMessage(replyToken, [{ type: 'text', text: '未知操作，請重試。' }])
  }
}
