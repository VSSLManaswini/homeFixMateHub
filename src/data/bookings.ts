import { supabase } from '../lib/supabase'
import { parseQuoteAmount, type Provider } from './providers'

export type BookingStatus = 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled'
export type BookingType = 'instant' | 'scheduled'
export type PaymentStatus = 'unpaid' | 'deposit_paid' | 'fully_paid'
export type PayoutStatus = 'not_due' | 'pending' | 'paid'

export type Booking = {
  id: string
  providerId: string
  customerId: string
  status: BookingStatus
  bookingType: BookingType
  scheduledAt: string | null
  notes: string
  createdAt: string
  quoteAmount: number
  platformFeeAmount: number
  depositAmount: number
  remainingAmount: number
  paymentStatus: PaymentStatus
  payoutStatus: PayoutStatus
  customerContact: string
  providerCompleted: boolean
  customerCompleted: boolean
  provider?: Pick<Provider, 'id' | 'name' | 'service' | 'quote' | 'bookings' | 'contact'>
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
  quote_amount?: number | string
  platform_fee_amount?: number | string
  deposit_amount?: number | string
  remaining_amount?: number | string
  payment_status?: PaymentStatus
  payout_status?: PayoutStatus
  customer_contact?: string
  provider_completed?: boolean
  customer_completed?: boolean
  providers?: {
    id: string
    name: string
    service: string
    quote: string
    bookings: number
    contact?: string
  } | null
}

type CreateBookingInput = {
  providerId: string
  customerId: string
  bookingType: BookingType
  scheduledAt?: string | null
  notes?: string
  quoteText: string
  customerContact: string
}

const PLATFORM_FEE_RATE = 0.1

export function splitQuote(quoteText: string) {
  const quoteAmount = parseQuoteAmount(quoteText)
  const depositAmount = Math.round(quoteAmount * PLATFORM_FEE_RATE)
  const remainingAmount = Math.max(quoteAmount - depositAmount, 0)
  return {
    quoteAmount,
    platformFeeAmount: depositAmount,
    depositAmount,
    remainingAmount,
  }
}

function num(value: number | string | undefined, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function contactsUnlocked(booking: Pick<Booking, 'paymentStatus'>): boolean {
  return booking.paymentStatus === 'deposit_paid' || booking.paymentStatus === 'fully_paid'
}

function mapRow(row: BookingRow): Booking {
  const paymentStatus = row.payment_status ?? 'unpaid'
  const unlocked = paymentStatus === 'deposit_paid' || paymentStatus === 'fully_paid'
  return {
    id: row.id,
    providerId: row.provider_id,
    customerId: row.customer_id,
    status: row.status,
    bookingType: row.booking_type,
    scheduledAt: row.scheduled_at,
    notes: row.notes,
    createdAt: row.created_at,
    quoteAmount: num(row.quote_amount),
    platformFeeAmount: num(row.platform_fee_amount),
    depositAmount: num(row.deposit_amount),
    remainingAmount: num(row.remaining_amount),
    paymentStatus,
    payoutStatus: row.payout_status ?? 'not_due',
    customerContact: unlocked ? (row.customer_contact ?? '') : '',
    providerCompleted: Boolean(row.provider_completed),
    customerCompleted: Boolean(row.customer_completed),
    provider: row.providers
      ? {
          id: row.providers.id,
          name: row.providers.name,
          service: row.providers.service,
          quote: row.providers.quote,
          bookings: row.providers.bookings,
          contact: unlocked ? (row.providers.contact ?? '') : '',
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
  quote_amount,
  platform_fee_amount,
  deposit_amount,
  remaining_amount,
  payment_status,
  payout_status,
  customer_contact,
  provider_completed,
  customer_completed,
  providers (
    id,
    name,
    service,
    quote,
    bookings,
    contact
  )
`

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')

  const amounts = splitQuote(input.quoteText)
  const contact = input.customerContact.replace(/\s+/g, '')
  if (!/^\+?\d{10,15}$/.test(contact)) {
    throw new Error('Enter a valid contact number so the provider can reach you after deposit.')
  }

  const payload = {
    provider_id: input.providerId,
    customer_id: input.customerId,
    booking_type: input.bookingType,
    scheduled_at: input.bookingType === 'scheduled' ? input.scheduledAt ?? null : null,
    notes: input.notes?.trim() ?? '',
    status: 'pending' as const,
    quote_amount: amounts.quoteAmount,
    platform_fee_amount: amounts.platformFeeAmount,
    deposit_amount: amounts.depositAmount,
    remaining_amount: amounts.remainingAmount,
    payment_status: 'unpaid' as const,
    payout_status: 'not_due' as const,
    customer_contact: contact,
    provider_completed: false,
    customer_completed: false,
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
  status: Extract<BookingStatus, 'rejected' | 'cancelled'>,
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

export async function confirmJobComplete(bookingId: string): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('confirm_job_complete', { p_booking_id: bookingId })
  if (error) throw error
  return mapRow({ ...(data as BookingRow), providers: null })
}

export async function payBookingDeposit(bookingId: string): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('pay_booking_deposit', { p_booking_id: bookingId })
  if (error) throw error
  return mapRow({ ...(data as BookingRow), providers: null })
}

export async function payBookingRemaining(bookingId: string): Promise<Booking> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('pay_booking_remaining', { p_booking_id: bookingId })
  if (error) throw error
  return mapRow({ ...(data as BookingRow), providers: null })
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

export function formatMoney(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

export function paymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case 'deposit_paid':
      return '10% with HomeFix'
    case 'fully_paid':
      return 'Fully paid to HomeFix'
    default:
      return 'Awaiting deposit to HomeFix'
  }
}

export function payoutStatusLabel(status: PayoutStatus): string {
  switch (status) {
    case 'pending':
      return 'HomeFix payout pending'
    case 'paid':
      return 'HomeFix credited you 90%'
    default:
      return 'Payout not due yet'
  }
}
