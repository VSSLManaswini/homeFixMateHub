import { supabase, type ProviderInsert, type ProviderRow } from '../lib/supabase'

export type Provider = {
  id: string
  userId: string | null
  name: string
  service: string
  quote: string
  contact: string
  bookings: number
  rating: number
  ratingCount: number
  createdAt: string
}

export type ProviderFilters = {
  query: string
  service: string
  maxPrice: number | null
  minRating: number | null
  sortBy: 'newest' | 'price-asc' | 'price-desc' | 'rating' | 'bookings'
}

export const defaultProviderFilters: ProviderFilters = {
  query: '',
  service: 'all',
  maxPrice: null,
  minRating: null,
  sortBy: 'newest',
}

type ProviderInput = {
  name: string
  service: string
  quote: string
  contact: string
  userId?: string
}

function mapRow(row: ProviderRow, viewerUserId?: string | null): Provider {
  const isOwner = Boolean(viewerUserId && row.user_id === viewerUserId)
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    service: row.service,
    quote: row.quote,
    // Contact stays private on browse; unlocked on bookings after 10% deposit
    contact: isOwner ? row.contact : '',
    bookings: row.bookings,
    rating: Number(row.rating ?? 4.5),
    ratingCount: Number(row.rating_count ?? 0),
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

export function parseQuoteAmount(quote: string): number {
  const n = Number(String(quote).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function filterProviders(providers: Provider[], filters: ProviderFilters): Provider[] {
  const q = filters.query.trim().toLowerCase()

  let rows = providers.filter((provider) => {
    if (filters.service !== 'all' && provider.service !== filters.service) return false

    if (q) {
      const haystack = `${provider.name} ${provider.service} ${provider.contact}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }

    const price = parseQuoteAmount(provider.quote)
    if (filters.maxPrice != null && price > filters.maxPrice) return false

    if (filters.minRating != null && provider.rating < filters.minRating) return false

    return true
  })

  rows = [...rows].sort((a, b) => {
    switch (filters.sortBy) {
      case 'price-asc':
        return parseQuoteAmount(a.quote) - parseQuoteAmount(b.quote)
      case 'price-desc':
        return parseQuoteAmount(b.quote) - parseQuoteAmount(a.quote)
      case 'rating':
        return b.rating - a.rating || b.ratingCount - a.ratingCount
      case 'bookings':
        return b.bookings - a.bookings
      case 'newest':
      default:
        return +new Date(b.createdAt) - +new Date(a.createdAt)
    }
  })

  return rows
}

export async function fetchProviders(): Promise<Provider[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(formatSupabaseError(error))
  return ((data ?? []) as ProviderRow[]).map((row) => mapRow(row, user?.id))
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
    rating: 4.5,
    rating_count: 0,
  }

  const { data, error } = await supabase.from('providers').insert(payload).select('*').single()

  if (error) {
    // Retry without rating columns if migration not applied yet
    if (String(error.message).toLowerCase().includes('rating')) {
      const legacyPayload = {
        user_id: user.id,
        name: input.name,
        service: input.service,
        quote: input.quote,
        contact: input.contact,
        bookings: 0,
      }
      const legacy = await supabase.from('providers').insert(legacyPayload).select('*').single()
      if (legacy.error) throw new Error(formatSupabaseError(legacy.error))
      return mapRow(legacy.data as ProviderRow, user.id)
    }
    throw new Error(
      `${formatSupabaseError(error)}. If this keeps failing, run supabase/fix-empty-providers.sql and disable Confirm email.`,
    )
  }

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

  return mapRow(verified as ProviderRow, user.id)
}

export function totalBookings(providers: Provider[]): number {
  return providers.reduce((sum, p) => sum + p.bookings, 0)
}
