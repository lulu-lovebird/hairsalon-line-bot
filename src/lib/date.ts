import { format, addDays, startOfDay, parseISO } from 'date-fns'

/** 台灣時區 (+08:00) */
export const TZ_TAIPEI = 'Asia/Taipei'

/** 取得台灣現在日期字串 YYYY-MM-DD */
export function todayTW(): string {
  const now = new Date()
  const twDate = new Date(now.toLocaleString('en-US', { timeZone: TZ_TAIPEI }))
  return format(twDate, 'yyyy-MM-dd')
}

/** 取得台灣現在 Date 物件 */
export function nowTW(): Date {
  const now = new Date()
  return new Date(now.toLocaleString('en-US', { timeZone: TZ_TAIPEI }))
}

/** 格式化日期為繁體中文顯示 */
export function formatDateZH(dateStr: string): string {
  const d = parseISO(dateStr)
  const days = ['日', '一', '二', '三', '四', '五', '六']
  const dow = days[d.getDay()]
  return `${dateStr}（週${dow}）`
}

/** 格式化時間 HH:MM:SS → HH:MM */
export function formatTime(timeStr: string): string {
  return timeStr.substring(0, 5)
}

/**
 * 安全解析 YYYY-MM-DD 字串為 Date（UTC 正午，避免時區位移影響 getDay()）
 * new Date('2024-10-01') 在 Node.js 解析為 UTC 00:00，getDay() 可能差一天
 */
export function parseDateTW(dateStr: string): Date {
  // 解析為 UTC 正午，不受本地時區影響
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

/** 取得台灣現在時間的 HH:MM 字串，供時段過濾使用 */
export function nowTWHHMM(): string {
  const now = nowTW()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 產生未來 N 天的日期清單 */
export function getFutureDates(days: number, startFromTomorrow = true): string[] {
  const result: string[] = []
  const today = nowTW()
  const start = startFromTomorrow ? 1 : 0
  for (let i = start; i <= days; i++) {
    const d = addDays(startOfDay(today), i)
    result.push(format(d, 'yyyy-MM-dd'))
  }
  return result
}
