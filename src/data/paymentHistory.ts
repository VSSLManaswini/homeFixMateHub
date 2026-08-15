import { formatMoney, type Booking } from './bookings'

export type PaymentLedgerKind = 'deposit' | 'remaining' | 'provider_credit'

export type PaymentLedgerEntry = {
  id: string
  bookingId: string
  kind: PaymentLedgerKind
  title: string
  detail: string
  amount: number
  at: string | null
  invoiceRef: string
}

function invoiceRef(bookingId: string, kind: PaymentLedgerKind): string {
  const short = bookingId.replace(/-/g, '').slice(0, 8).toUpperCase()
  const code = kind === 'deposit' ? 'D10' : kind === 'remaining' ? 'R90' : 'C90'
  return `HF-${short}-${code}`
}

function sortByDateDesc(a: PaymentLedgerEntry, b: PaymentLedgerEntry): number {
  const atA = a.at ? +new Date(a.at) : 0
  const atB = b.at ? +new Date(b.at) : 0
  return atB - atA
}

/** Customer-facing: money paid to HomeFix (10% then 90%). */
export function buildCustomerPaymentLedger(bookings: Booking[]): PaymentLedgerEntry[] {
  const rows: PaymentLedgerEntry[] = []

  for (const booking of bookings) {
    const providerName = booking.provider?.name ?? 'Provider'
    const service = booking.provider?.service ?? 'Service'

    if (booking.paymentStatus === 'deposit_paid' || booking.paymentStatus === 'fully_paid') {
      rows.push({
        id: `${booking.id}-deposit`,
        bookingId: booking.id,
        kind: 'deposit',
        title: '10% deposit to HomeFix',
        detail: `${providerName} · ${service}`,
        amount: booking.depositAmount,
        at: booking.depositPaidAt,
        invoiceRef: invoiceRef(booking.id, 'deposit'),
      })
    }

    if (booking.paymentStatus === 'fully_paid') {
      rows.push({
        id: `${booking.id}-remaining`,
        bookingId: booking.id,
        kind: 'remaining',
        title: '90% final payment to HomeFix',
        detail: `${providerName} · ${service} (credited to provider)`,
        amount: booking.remainingAmount,
        at: booking.remainingPaidAt,
        invoiceRef: invoiceRef(booking.id, 'remaining'),
      })
    }
  }

  return rows.sort(sortByDateDesc)
}

/** Provider-facing: 90% credits after customer pays HomeFix in full. */
export function buildProviderPaymentLedger(bookings: Booking[]): PaymentLedgerEntry[] {
  const rows: PaymentLedgerEntry[] = []

  for (const booking of bookings) {
    if (booking.payoutStatus !== 'paid' && booking.paymentStatus !== 'fully_paid') continue

    const service = booking.provider?.service ?? 'Service'
    rows.push({
      id: `${booking.id}-credit`,
      bookingId: booking.id,
      kind: 'provider_credit',
      title: '90% credited by HomeFix',
      detail: `${service} · booking ${booking.id.slice(0, 8)}…`,
      amount: booking.remainingAmount,
      at: booking.remainingPaidAt ?? booking.createdAt,
      invoiceRef: invoiceRef(booking.id, 'provider_credit'),
    })
  }

  return rows.sort(sortByDateDesc)
}

export function paymentLedgerTotals(entries: PaymentLedgerEntry[]) {
  return entries.reduce((sum, row) => sum + row.amount, 0)
}

export function formatPaymentWhen(iso: string | null): string {
  if (!iso) return 'Recorded'
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatLedgerAmount(amount: number): string {
  return formatMoney(amount)
}
