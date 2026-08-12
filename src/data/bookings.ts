import { supabase } from '../lib/supabase'
import type { Provider } from './providers'

export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled'
export type BookingType = 'instant' | 'scheduled'

export type Booking = {
  id: string
  providerId: string
  customerId: string
  status: BookingStatus
  bookingType: BookingType
  scheduledAt: string | null
  notes: string
  createdAt: string
  provider?: Pick<Provider, 'id' | 'name' | 'service' | 'quote' | 'contact' | 'bookings'>
}

export type BookingRow = {
  id: string
  provider_id: string
  customer_id: string
  status: BookingStatus
  booking_type: BookingType
  scheduled_at: string | null
  notes: string
  created_at: string
  providers?: {
    id: string
    name: string
    service: string
    quote: string
    contact: string
    bookings: number
  } | null
}

type CreateBookingInput = {
  providerId: string
  customerId: string
  bookingType: BookingType
  scheduledAt?: string | null
  notes?: string
}

function mapRow(row: BookingRow): Booking {
  return {
    id: row.id,
    providerId: row.provider_id,
    customerId: row.customer_id,
    status: row.status,
    bookingType: row.booking_type,
    scheduledAt: row.scheduled_at,
    notes: row.notes,
    createdAt: row.created_at,
    provider: row.providers
      ? {
          id: row.providers.id,
          name: row.providers.name,
          service: row.providers.service,
          quote: row.providers.quote,
          contact: row.providers.contact,
          bookings: row.providers.bookings,
        }
      : undefined,
  }
}

const selectWithProvider = `
  id,
  provider_id,
  customer_id,
  status,
  booking_type,
  scheduled_at,
  notes,
  created_at,
  providers (
    id,
    name,
    service,
    quote,
    contact,
    bookings
  )
`

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')

  const payload = {
    provider_id: input.providerId,
    customer_id: input.customerId,
    booking_type: input.bookingType,
    scheduled_at: input.bookingType === 'scheduled' ? input.scheduledAt ?? null : null,
    notes: input.notes?.trim() ?? '',
    status: 'pending' as const,
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert(payload)
    .select(selectWithProvider)
    .single()

  if (error) throw error
  return mapRow(data as unknown as BookingRow)
}

export async function fetchMyCustomerBookings(customerId: string): Promise<Booking[]> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('bookings')
    .select(selectWithProvider)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as unknown as BookingRow[]).map(mapRow)
}

export async function fetchProviderIncomingBookings(providerUserId: string): Promise<Booking[]> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data: myProviders, error: providersError } = await supabase
    .from('providers')
    .select('id')
    .eq('user_id', providerUserId)

  if (providersError) throw providersError
  const ids = (myProviders ?? []).map((p) => p.id as string)
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('bookings')
    .select(selectWithProvider)
    .in('provider_id', ids)
    .order('created_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as unknown as BookingRow[]).map(mapRow)
}

export async function acceptBooking(bookingId: string): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('accept_booking', { p_booking_id: bookingId })
  if (error) throw error

  const row = data as BookingRow
  return mapRow({
    ...row,
    providers: null,
  })
}

export async function updateBookingStatus(
  bookingId: string,
  status: Extract<BookingStatus, 'rejected' | 'cancelled' | 'completed'>,
): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', bookingId)
    .select(selectWithProvider)
    .single()

  if (error) throw error
  return mapRow(data as unknown as BookingRow)
}

export function formatBookingWhen(booking: Booking): string {
  if (booking.bookingType === 'scheduled' && booking.scheduledAt) {
    return new Date(booking.scheduledAt).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }
  return 'Instant'
}
