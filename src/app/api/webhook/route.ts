import { NextRequest, NextResponse } from 'next/server'
import { webhook } from '@line/bot-sdk'
import { verifyLineSignature } from '@/lib/line'
import { handleLineEvent } from '@/lib/bot/handler'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-line-signature') ?? ''
  const bodyText = await req.text()

  if (!verifyLineSignature(bodyText, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const body = JSON.parse(bodyText) as webhook.CallbackRequest

  // 並行處理所有事件（不等待，直接回 200 給 LINE）
  Promise.all(body.events.map((event: webhook.Event) => handleLineEvent(event))).catch(
    (err) => console.error('[webhook] Error handling events:', err)
  )

  return NextResponse.json({ ok: true })
}

// LINE webhook 驗證用
export async function GET() {
  return NextResponse.json({ status: 'LINE webhook is running' })
}
