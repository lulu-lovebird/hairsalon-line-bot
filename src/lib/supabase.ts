import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY)')
}

/** 前台用 Supabase client（anon key，受 RLS 限制） */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** 後台/伺服器端用 Supabase client（service role，繞過 RLS） */
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey,  // fallback to anon in dev
  { auth: { persistSession: false } }
)
