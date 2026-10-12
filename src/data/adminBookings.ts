import { supabase } from '../lib/supabase'

export type AdminBookingRow = {
  bookingId: string
  providerId: string
  providerName: string
  customerId: string
  status: string
  bookingType: string
  scheduledAt: string | null
  paymentStatus: string
  payoutStatus: string
  quoteAmount: number
  jobAddress: string
  refundRequested: boolean
  refundHandledAt: string | null
  workStartedAt: string | null
  customerCompleted: boolean
  createdAt: string
}

type ListRow = {
  booking_id: string
  provider_id: string
  provider_name: string
  customer_id: string
  status: string
  booking_type: string
  scheduled_at: string | null
  payment_status: string
  payout_status: string
  quote_amount: number | string
  job_address: string | null
  refund_requested?: boolean
  refund_handled_at?: string | null
  work_started_at?: string | null
  customer_completed?: boolean
  created_at: string
}

export async function fetchAdminBookings(limit = 80): Promise<AdminBookingRow[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('list_admin_bookings', { p_limit: limit })
  if (error) throw new Error(error.message)
  return ((data as ListRow[]) ?? []).map((row) => ({
    bookingId: row.booking_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    customerId: row.customer_id,
    status: row.status,
    bookingType: row.booking_type,
    scheduledAt: row.scheduled_at,
    paymentStatus: row.payment_status,
    payoutStatus: row.payout_status,
    quoteAmount: Number(row.quote_amount) || 0,
    jobAddress: row.job_address ?? '',
    refundRequested: Boolean(row.refund_requested),
    refundHandledAt: row.refund_handled_at ?? null,
    workStartedAt: row.work_started_at ?? null,
    customerCompleted: Boolean(row.customer_completed),
    createdAt: row.created_at,
  }))
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function downloadAdminBookingsCsv(rows: AdminBookingRow[]): void {
  const header = [
    'booking_id',
    'provider_name',
    'status',
    'booking_type',
    'payment_status',
    'payout_status',
    'quote_amount',
    'work_started_at',
    'customer_completed',
    'refund_requested',
    'refund_handled_at',
    'job_address',
    'created_at',
  ]
  const lines = [
    header.join(','),
    ...rows.map((row) =>
      [
        csvCell(row.bookingId),
        csvCell(row.providerName),
        csvCell(row.status),
        csvCell(row.bookingType),
        csvCell(row.paymentStatus),
        csvCell(row.payoutStatus),
        csvCell(row.quoteAmount),
        csvCell(row.workStartedAt ?? ''),
        csvCell(row.customerCompleted),
        csvCell(row.refundRequested),
        csvCell(row.refundHandledAt ?? ''),
        csvCell(row.jobAddress),
        csvCell(row.createdAt),
      ].join(','),
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `homefix-bookings-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export async function markBookingRefundHandled(bookingId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('mark_booking_refund_handled', { p_booking_id: bookingId })
  if (error) throw new Error(error.message)
}
