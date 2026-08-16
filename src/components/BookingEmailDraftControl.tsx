import { useState } from 'react'
import type { Booking } from '../data/bookings'
import {
  buildBookingEmailDraft,
  shareBookingEmailDraft,
  type BookingEmailRole,
} from '../data/bookingEmails'

type BookingEmailDraftControlProps = {
  booking: Booking
  role: BookingEmailRole
  customerName?: string
  onFlash?: (message: string) => void
}

export function BookingEmailDraftControl({
  booking,
  role,
  customerName,
  onFlash,
}: BookingEmailDraftControlProps) {
  const [busy, setBusy] = useState(false)
  const [localFlash, setLocalFlash] = useState<string | null>(null)

  const draft = buildBookingEmailDraft(booking, {
    role,
    customerName,
    providerName: booking.provider?.name,
  })
  if (!draft) return null

  const flash = (message: string) => {
    onFlash?.(message)
    setLocalFlash(message)
    window.setTimeout(() => setLocalFlash((current) => (current === message ? null : current)), 2200)
  }

  const run = async (preferCopy: boolean) => {
    setBusy(true)
    try {
      const result = await shareBookingEmailDraft(
        booking,
        {
          role,
          customerName,
          providerName: booking.provider?.name,
        },
        { preferCopy },
      )
      flash(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="email-draft-control">
      <div className="email-draft-actions">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={busy}
          onClick={() => void run(false)}
          title={
            draft.toEmail
              ? `Open mail app to ${draft.toEmail}`
              : 'Copy draft — paste into your email app'
          }
        >
          Email draft
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={busy}
          onClick={() => void run(true)}
          title="Copy subject and body"
        >
          Copy status email
        </button>
      </div>
      {!onFlash && localFlash && (
        <p className="email-draft-flash" role="status">
          {localFlash}
        </p>
      )}
      {draft.needsManualPaste && (
        <p className="form-note email-draft-hint">
          No email on this booking — paste into your email app. HomeFix does not send mail yet.
        </p>
      )}
    </div>
  )
}
