import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * POST /api/admin/auth/liff
 * Body: { id_token: string }
 *
 * 驗證 LIFF idToken，確認是管理員後回傳 session token
 */
export async function POST(req: NextRequest) {
  try {
    const { id_token } = await req.json() as { id_token: string }

    if (!id_token) {
      return NextResponse.json({ error: 'Missing id_token' }, { status: 400 })
    }

    // 向 LINE 驗證 idToken
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token,
        client_id: process.env.LINE_CHANNEL_ID ?? '',
      }),
    })

    if (!verifyRes.ok) {
      return NextResponse.json({ error: 'Invalid LIFF token' }, { status: 401 })
    }

    const profile = await verifyRes.json() as { sub: string; name: string; picture?: string }
    const lineUid = profile.sub

    // 確認是管理員
    const adminIds = (process.env.ADMIN_LINE_IDS ?? '').split(',').map((s) => s.trim())
    if (!adminIds.includes(lineUid)) {
      return NextResponse.json({ error: '您沒有管理員權限' }, { status: 403 })
    }

    // 回傳管理員資訊（Phase 4 再換為 signed JWT）
    return NextResponse.json({
      ok: true,
      admin: {
        line_uid: lineUid,
        display_name: profile.name,
        picture_url: profile.picture ?? null,
      },
    })
  } catch (err) {
    console.error('[admin/auth/liff]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
