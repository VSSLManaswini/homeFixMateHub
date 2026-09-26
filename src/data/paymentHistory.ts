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
    if (booking.paymentStatus !== 'fully_paid') continue

    const service = booking.provider?.service ?? 'Service'
    const statusNote =
      booking.payoutStatus === 'paid'
        ? 'paid out'
        : booking.payoutStatus === 'failed'
          ? 'payout failed'
          : 'payout pending'
    rows.push({
      id: `${booking.id}-credit`,
      bookingId: booking.id,
      kind: 'provider_credit',
      title:
        booking.payoutStatus === 'paid'
          ? '90% paid out by HomeFix'
          : booking.payoutStatus === 'failed'
            ? '90% payout failed'
            : '90% payout pending',
      detail: `${service} · booking ${booking.id.slice(0, 8)}… · ${statusNote}`,
      amount: booking.remainingAmount,
      at: booking.payoutAt ?? booking.remainingPaidAt ?? booking.createdAt,
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Opens a printable HomeFix receipt (not a GST tax invoice). */
export function printPaymentReceipt(entry: PaymentLedgerEntry): void {
  const when = formatPaymentWhen(entry.at)
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(entry.invoiceRef)}</title>
  <style>
    body { font-family: Georgia, serif; color: #132019; margin: 2rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
    .muted { color: #6b7f73; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
    td { padding: 0.4rem 0; vertical-align: top; }
    .amount { font-size: 1.35rem; font-weight: 700; }
    hr { border: none; border-top: 1px solid #d7efe5; margin: 1.25rem 0; }
  </style>
</head>
<body>
  <h1>HomeFix</h1>
  <p class="muted">Payment receipt · ${escapeHtml(entry.invoiceRef)}</p>
  <hr />
  <table>
    <tr><td>Description</td><td>${escapeHtml(entry.title)}</td></tr>
    <tr><td>Detail</td><td>${escapeHtml(entry.detail)}</td></tr>
    <tr><td>Paid</td><td>${escapeHtml(when)}</td></tr>
    <tr><td>Amount</td><td class="amount">${escapeHtml(formatLedgerAmount(entry.amount))}</td></tr>
  </table>
  <hr />
  <p class="muted">This is a HomeFix payment receipt for money paid to the platform. It is not a GST tax invoice.</p>
  <script>window.onload = function () { window.print(); }</script>
</body>
</html>`

  const popup = window.open('', '_blank', 'width=720,height=800')
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
}
