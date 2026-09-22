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
