import type { webhook } from '@line/bot-sdk'
import { handleTextMessage } from './text-handler'
import { handlePostback } from './postback-handler'

export async function handleLineEvent(event: webhook.Event): Promise<void> {
  try {
    switch (event.type) {
      case 'message':
        if (event.message.type === 'text') {
          await handleTextMessage(event)
        }
        break
      case 'postback':
        await handlePostback(event)
        break
      case 'follow':
        await handleFollow(event)
        break
      case 'unfollow':
        // 客人封鎖/取消追蹤，可記錄 log
        console.log(`[bot] User unfollowed: ${event.source?.userId}`)
        break
      default:
        break
    }
  } catch (err) {
    console.error('[bot/handler] Error:', err)
  }
}

async function handleFollow(event: webhook.FollowEvent): Promise<void> {
  const { replyToken, source } = event
  if (!replyToken || source?.type !== 'user') return

  const { replyMessage } = await import('@/lib/line')
  const salonName = process.env.SALON_NAME ?? '我們的理髮店'

  await replyMessage(replyToken, [
    {
      type: 'text',
      text: `歡迎加入 ${salonName} ✂️\n\n您可以透過下方選單：\n📅 立即預約\n🗓️ 查看我的預約\n❌ 取消預約\n\n如有任何問題，歡迎直接傳訊息給我們！`,
    },
  ])
}
