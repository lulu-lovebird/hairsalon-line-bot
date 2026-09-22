import * as line from '@line/bot-sdk'
import type { messagingApi, webhook } from '@line/bot-sdk'

const channelSecret = process.env.LINE_CHANNEL_SECRET ?? ''
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ''

if (!channelSecret || !channelAccessToken) {
  console.warn('[line.ts] LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN not set')
}

export const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken,
})

/**
 * 驗證 LINE Webhook 簽名
 */
export function verifyLineSignature(body: string, signature: string): boolean {
  return line.validateSignature(body, channelSecret, signature)
}

/**
 * 推播文字訊息給單一使用者
 */
export async function pushText(to: string, text: string): Promise<void> {
  await lineClient.pushMessage({ to, messages: [{ type: 'text', text }] })
}

/**
 * 推播 Flex Message
 */
export async function pushFlex(
  to: string,
  altText: string,
  contents: messagingApi.FlexContainer
): Promise<void> {
  await lineClient.pushMessage({
    to,
    messages: [{ type: 'flex', altText, contents }],
  })
}

/**
 * 回覆訊息（Webhook reply）
 */
export async function replyMessage(
  replyToken: string,
  messages: messagingApi.Message[]
): Promise<void> {
  await lineClient.replyMessage({ replyToken, messages })
}

/**
 * 以 Quick Reply 方式回覆
 */
export async function replyWithQuickReply(
  replyToken: string,
  text: string,
  items: messagingApi.QuickReplyItem[]
): Promise<void> {
  await replyMessage(replyToken, [{
    type: 'text',
    text,
    quickReply: { items },
  }])
}

// Re-export webhook types for use in other modules
export type { webhook, messagingApi }
