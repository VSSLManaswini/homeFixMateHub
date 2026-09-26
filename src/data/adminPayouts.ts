import { supabase } from '../lib/supabase'
import type { PayoutStatus } from './bookings'

export type BookingPayoutRow = {
  bookingId: string
  providerId: string
  providerName: string
  providerUserId: string | null
  remainingAmount: number
  paymentStatus: string
  payoutStatus: PayoutStatus
  payoutError: string | null
  razorpayPayoutId: string | null
  remainingPaidAt: string | null
  payoutAt: string | null
  createdAt: string
  payoutDestination: string
}

type ListRow = {
  booking_id: string
  provider_id: string
  provider_name: string
  provider_user_id: string | null
  remaining_amount: number | string
  payment_status: string
  payout_status: PayoutStatus
  payout_error: string | null
  razorpay_payout_id: string | null
  remaining_paid_at: string | null
  payout_at: string | null
  created_at: string
  payout_destination?: string | null
}

function mapRow(row: ListRow): BookingPayoutRow {
  return {
    bookingId: row.booking_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerUserId: row.provider_user_id,
    remainingAmount: Number(row.remaining_amount) || 0,
    paymentStatus: row.payment_status,
    payoutStatus: row.payout_status,
    payoutError: row.payout_error,
    razorpayPayoutId: row.razorpay_payout_id,
    remainingPaidAt: row.remaining_paid_at,
    payoutAt: row.payout_at,
    createdAt: row.created_at,
    payoutDestination: row.payout_destination ?? '',
  }
}

export async function fetchAdminBookingPayouts(limit = 50): Promise<BookingPayoutRow[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('list_booking_payouts', { p_limit: limit })
  if (error) throw new Error(error.message)
  return ((data as ListRow[]) ?? []).map(mapRow)
}

export type RetryPayoutResult = {
  ok?: boolean
  alreadyPaid?: boolean
  payoutId?: string | null
  payoutStatus?: string
  error?: string
}

export async function retryProviderPayout(bookingId: string): Promise<RetryPayoutResult> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.functions.invoke('create-provider-payout', {
    body: { booking_id: bookingId, retry: true },
  })

  if (error) {
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        const payload = (await context.json()) as { error?: string }
        if (payload?.error) throw new Error(payload.error)
      } catch (inner) {
        if (inner instanceof Error && inner.message && !inner.message.includes('JSON')) {
          throw inner
        }
      }
    }
    throw new Error(error.message || 'Could not retry payout')
  }

  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    const result = data as RetryPayoutResult
    if (!result.ok) throw new Error(result.error || 'Payout retry failed')
  }

  return (data ?? {}) as RetryPayoutResult
}

export async function markProviderPayoutManualPaid(bookingId: string, note = ''): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('mark_booking_payout_manual_paid', {
    p_booking_id: bookingId,
    p_note: note,
  })
  if (error) throw new Error(error.message)
}

export type AdminPlatformSummary = {
  bookingsTotal: number
  fullyPaidCount: number
  depositPaidOpen: number
  platformFeesCollected: number
  payoutsPendingAmount: number
  payoutsPaidAmount: number
}

function csvCell(value: string | number): string {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function downloadPayoutsCsv(rows: BookingPayoutRow[]): void {
  const header = [
    'booking_id',
    'provider_name',
    'amount',
    'payout_status',
    'pay_to',
    'remaining_paid_at',
    'payout_at',
    'payout_error',
  ]
  const lines = [
    header.join(','),
    ...rows.map((row) =>
      [
        csvCell(row.bookingId),
        csvCell(row.providerName),
        csvCell(row.remainingAmount),
        csvCell(row.payoutStatus),
        csvCell(row.payoutDestination),
        csvCell(row.remainingPaidAt ?? ''),
        csvCell(row.payoutAt ?? ''),
        csvCell(row.payoutError ?? ''),
      ].join(','),
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `homefix-payouts-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export async function fetchAdminPlatformSummary(): Promise<AdminPlatformSummary> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('get_admin_platform_summary')
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return {
    bookingsTotal: Number(row?.bookings_total ?? 0),
    fullyPaidCount: Number(row?.fully_paid_count ?? 0),
    depositPaidOpen: Number(row?.deposit_paid_open ?? 0),
    platformFeesCollected: Number(row?.platform_fees_collected ?? 0),
    payoutsPendingAmount: Number(row?.payouts_pending_amount ?? 0),
    payoutsPaidAmount: Number(row?.payouts_paid_amount ?? 0),
  }
}
