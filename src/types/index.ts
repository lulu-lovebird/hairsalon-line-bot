// ============================================================
// 理髮店預約系統 共用型別定義
// ============================================================

export type StylistRow = {
  id: string
  name: string
  line_uid: string | null
  avatar_url: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type StylistScheduleRow = {
  id: string
  stylist_id: string
  day_of_week: number  // 0=Sun, 1=Mon ... 6=Sat
  start_time: string   // HH:MM:SS
  end_time: string
  is_active: boolean
}

export type ServiceRow = {
  id: string
  name: string
  duration_min: number
  price: number | null
  description: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type SlotTemplateRow = {
  id: string
  day_of_week: number
  start_time: string
  duration_min: number
  max_capacity: number
  is_open: boolean
  created_at: string
}

export type SlotOverrideRow = {
  id: string
  date: string          // YYYY-MM-DD
  start_time: string    // HH:MM:SS
  duration_min: number
  max_capacity: number
  is_open: boolean
  note: string | null
  created_at: string
}

export type CustomerRow = {
  id: string
  line_uid: string
  display_name: string
  picture_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'arrived' | 'no_show' | 'cancelled'

export type AppointmentRow = {
  id: string
  code: string
  customer_id: string
  stylist_id: string | null
  service_id: string | null
  date: string           // YYYY-MM-DD
  start_time: string     // HH:MM:SS
  duration_min: number
  status: AppointmentStatus
  cancel_reason: string | null
  cancelled_by: 'customer' | 'admin' | null
  reminder_24h_sent: boolean
  reminder_1h_sent: boolean
  notes: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
}

// 預約 with joins（常用）
export type AppointmentDetail = AppointmentRow & {
  customer: CustomerRow | null
  stylist: StylistRow | null
  service: ServiceRow | null
}

// 可預約時段（給前台查詢用）
export type AvailableSlot = {
  date: string
  start_time: string
  duration_min: number
  available_count: number  // 剩餘可預約名額
  stylists: Array<{
    id: string
    name: string
    avatar_url: string | null
  }>
}

// LIFF 登入後的使用者資訊
export type LiffProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
  statusMessage?: string
}

// Admin JWT Payload
export type AdminTokenPayload = {
  line_uid: string
  display_name: string
  role: 'admin'
  iat: number
  exp: number
}
