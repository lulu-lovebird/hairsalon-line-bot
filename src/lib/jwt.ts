import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import type { AdminTokenPayload } from '@/types'

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return Buffer.from(base64, 'base64').toString('utf8')
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.LINE_CHANNEL_SECRET || process.env.CRON_SECRET || ''
  if (!secret) {
    throw new Error('Missing secret for JWT signing (JWT_SECRET, LINE_CHANNEL_SECRET, or CRON_SECRET)')
  }
  return secret
}

/** 簽發管理員 JWT (有效期 24 小時) */
export function signAdminToken(user: { line_uid: string; display_name: string }): string {
  const secret = getJwtSecret()
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload: AdminTokenPayload = {
    line_uid: user.line_uid,
    display_name: user.display_name,
    role: 'admin',
    iat: now,
    exp: now + 24 * 60 * 60, // 24h
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const data = `${encodedHeader}.${encodedPayload}`

  const signature = createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${data}.${signature}`
}

/** 驗證 JWT 並回傳 Payload */
export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [encodedHeader, encodedPayload, signature] = parts
    const data = `${encodedHeader}.${encodedPayload}`
    const secret = getJwtSecret()

    const expectedSignature = createHmac('sha256', secret)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminTokenPayload
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return null
    }

    if (payload.role !== 'admin') {
      return null
    }

    return payload
  } catch {
    return null
  }
}

/** 從 NextRequest 提取 Authorization: Bearer <token> 並驗證管理員身份 */
export function verifyAdminRequest(req: NextRequest): AdminTokenPayload | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.substring(7).trim()
  return verifyAdminToken(token)
}
