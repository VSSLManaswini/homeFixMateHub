import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    lower.includes('your_project_ref') ||
    lower.includes('your_anon_public_key') ||
    lower.includes('xxxx.supabase') ||
    lower.includes('eyjhbgcioi...') ||
    lower.endsWith('...')
  )
}

export const isSupabaseConfigured = Boolean(
  url &&
    anonKey &&
    url.startsWith('https://') &&
    url.includes('.supabase.co') &&
    anonKey.length > 40 &&
    !looksLikePlaceholder(url) &&
    !looksLikePlaceholder(anonKey),
)

export type ProviderRow = {
  id: string
  user_id: string
  name: string
  service: string
  quote: string
  contact: string
  bookings: number
  created_at: string
}

export type ProviderInsert = {
  user_id: string
  name: string
  service: string
  quote: string
  contact: string
  bookings?: number
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null
