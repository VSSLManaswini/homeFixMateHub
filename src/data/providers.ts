import { supabase, type ProviderInsert, type ProviderRow } from '../lib/supabase'

export type Provider = {
  id: string
  userId: string | null
  name: string
  service: string
  quote: string
  contact: string
  bookings: number
  createdAt: string
}

type ProviderInput = {
  name: string
  service: string
  quote: string
  contact: string
  userId?: string
}

function mapRow(row: ProviderRow): Provider {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    service: row.service,
    quote: row.quote,
    contact: row.contact,
    bookings: row.bookings,
    createdAt: row.created_at,
  }
}

function formatSupabaseError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(error.hint)
  if (error.code) parts.push(`(${error.code})`)
  return parts.filter(Boolean).join(' — ')
}

export async function fetchProviders(): Promise<Provider[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(formatSupabaseError(error))
  return ((data ?? []) as ProviderRow[]).map(mapRow)
}

export async function createProvider(input: ProviderInput): Promise<Provider> {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw new Error(formatSupabaseError(userError))
  if (!user) {
    throw new Error(
      'No active session. Turn off Confirm email in Supabase Auth settings (or confirm your email), then sign in again.',
    )
  }

  const payload: ProviderInsert = {
    user_id: user.id,
    name: input.name,
    service: input.service,
    quote: input.quote,
    contact: input.contact,
    bookings: 0,
  }

  const { data, error } = await supabase.from('providers').insert(payload).select('*').single()

  if (error) {
    throw new Error(
      `${formatSupabaseError(error)}. If this keeps failing, run supabase/fix-empty-providers.sql and disable Confirm email.`,
    )
  }

  // Verify the row is actually readable back from the database
  const { data: verified, error: verifyError } = await supabase
    .from('providers')
    .select('*')
    .eq('id', (data as ProviderRow).id)
    .maybeSingle()

  if (verifyError) throw new Error(formatSupabaseError(verifyError))
  if (!verified) {
    throw new Error(
      'Saved locally but not readable from the database. Run supabase/fix-empty-providers.sql in the SQL Editor.',
    )
  }

  return mapRow(verified as ProviderRow)
}

export function totalBookings(providers: Provider[]): number {
  return providers.reduce((sum, p) => sum + p.bookings, 0)
}
