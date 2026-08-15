import {
  formatLedgerAmount,
  formatPaymentWhen,
  paymentLedgerTotals,
  type PaymentLedgerEntry,
} from '../data/paymentHistory'

type PaymentHistoryPanelProps = {
  title: string
  subtitle: string
  entries: PaymentLedgerEntry[]
  emptyNote: string
}

export function PaymentHistoryPanel({ title, subtitle, entries, emptyNote }: PaymentHistoryPanelProps) {
  const total = paymentLedgerTotals(entries)

  return (
    <div className="payment-history">
      <div className="booking-history-head">
        <div>
          <h4 className="payment-history-title">{title}</h4>
          <p className="form-note" style={{ margin: '0.2rem 0 0' }}>
            {subtitle}
          </p>
        </div>
        {entries.length > 0 && (
          <span className="bookings-pill">Total {formatLedgerAmount(total)}</span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="form-note">{emptyNote}</p>
      ) : (
        <ul className="payment-history-list">
          {entries.map((entry) => (
            <li key={entry.id} className="payment-history-item">
              <div>
                <strong>{entry.title}</strong>
                <p>{entry.detail}</p>
                <span className="notif-time">
                  {entry.invoiceRef} · {formatPaymentWhen(entry.at)}
                </span>
              </div>
              <span className="payment-history-amount">{formatLedgerAmount(entry.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
