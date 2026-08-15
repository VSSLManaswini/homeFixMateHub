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
  rating?: number
  rating_count?: number
  is_verified?: boolean
  verified_at?: string | null
  created_at: string
}

export type ProviderInsert = {
  user_id: string
  name: string
  service: string
  quote: string
  contact: string
  bookings?: number
  rating?: number
  rating_count?: number
  is_verified?: boolean
}

export type ProviderKycRow = {
  user_id: string
  id_type: 'aadhaar' | 'pan' | 'voter' | 'passport' | 'driving_licence' | 'other'
  id_number: string
  id_holder_name: string
  status: 'submitted' | 'verified' | 'rejected'
  rejection_reason: string
  submitted_at: string
  reviewed_at: string | null
  created_at?: string
  updated_at: string
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null
