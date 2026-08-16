import {
  formatBookingWhen,
  formatMoney,
  paymentStatusLabel,
  type Booking,
  type BookingStatus,
  type PaymentStatus,
} from './bookings'

/**
 * In-app email draft helpers for booking status copy / mailto.
 * Real delivery (Resend / SMTP / edge functions) is intentionally deferred.
 */

export type BookingEmailRole = 'customer' | 'provider'

export type BookingEmailEvent =
  | 'booking_requested'
  | 'booking_accepted'
  | 'booking_rejected'
  | 'deposit_paid'
  | 'job_completed'
  | 'fully_paid'
  | 'cancelled'

export type BookingEmailDraft = {
  event: BookingEmailEvent
  subject: string
  body: string
  /** Mailto recipient if an email was found on the other party’s contact string. */
  toEmail: string | null
  /** True when contacts are phones/text only — user should paste into their mail app. */
  needsManualPaste: boolean
}

export type BookingEmailContext = {
  role: BookingEmailRole
  /** Optional display names when known (bookings often only have phone contacts). */
  customerName?: string
  providerName?: string
  /** Override recipient email; otherwise parsed from contact fields. */
  toEmail?: string | null
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

export function shortBookingId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

export function extractEmail(contact: string | null | undefined): string | null {
  if (!contact) return null
  const match = contact.match(EMAIL_RE)
  return match ? match[0] : null
}

export function resolveBookingEmailEvent(
  booking: Pick<Booking, 'status' | 'paymentStatus'>,
): BookingEmailEvent | null {
  const { status, paymentStatus } = booking
  if (status === 'rejected') return 'booking_rejected'
  if (status === 'cancelled') return 'cancelled'
  if (paymentStatus === 'fully_paid') return 'fully_paid'
  if (status === 'completed' && paymentStatus === 'deposit_paid') return 'job_completed'
  if (paymentStatus === 'deposit_paid') return 'deposit_paid'
  if (status === 'accepted') return 'booking_accepted'
  if (status === 'pending') return 'booking_requested'
  return null
}

function statusLine(status: BookingStatus, paymentStatus: PaymentStatus): string {
  const booking = status.charAt(0).toUpperCase() + status.slice(1)
  return `Status: ${booking} · Payment: ${paymentStatusLabel(paymentStatus)}`
}

function partyNames(booking: Booking, ctx: BookingEmailContext) {
  const providerName = ctx.providerName?.trim() || booking.provider?.name?.trim() || 'Provider'
  const customerName = ctx.customerName?.trim() || 'Customer'
  const service = booking.provider?.service?.trim() || 'Home service'
  return { providerName, customerName, service }
}

function otherPartyEmail(booking: Booking, ctx: BookingEmailContext): string | null {
  if (ctx.toEmail) return extractEmail(ctx.toEmail) ?? ctx.toEmail
  if (ctx.role === 'customer') {
    return extractEmail(booking.provider?.contact)
  }
  return extractEmail(booking.customerContact)
}

function commonFooter(booking: Booking): string {
  return [
    '',
    `Booking ID: ${shortBookingId(booking.id)}`,
    statusLine(booking.status, booking.paymentStatus),
    `When: ${formatBookingWhen(booking)}`,
    '',
    '— Sent via HomeFix (draft only; paste or open in your email app)',
  ].join('\n')
}

function amountsBlock(booking: Booking): string {
  return [
    `Quote: ${formatMoney(booking.quoteAmount)}`,
    `Deposit (10% to HomeFix): ${formatMoney(booking.depositAmount)}`,
    `Remaining (90%): ${formatMoney(booking.remainingAmount)}`,
  ].join('\n')
}

export function buildBookingEmailDraft(
  booking: Booking,
  ctx: BookingEmailContext,
): BookingEmailDraft | null {
  const event = resolveBookingEmailEvent(booking)
  if (!event) return null

  const { providerName, customerName, service } = partyNames(booking, ctx)
  const ref = shortBookingId(booking.id)
  const toEmail = otherPartyEmail(booking, ctx)
  const footer = commonFooter(booking)
  const amounts = amountsBlock(booking)

  let subject = ''
  let body = ''

  if (ctx.role === 'customer') {
    switch (event) {
      case 'booking_requested':
        subject = `HomeFix booking request · ${service} · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `I’ve requested a booking for ${service} on HomeFix.`,
          `Please accept when you can so I can pay the 10% deposit and unlock contact details.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'booking_accepted':
        subject = `HomeFix booking accepted · ${service} · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `Thanks for accepting my ${service} booking on HomeFix.`,
          `I’ll pay the 10% deposit to HomeFix next so we can share phone numbers.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'booking_rejected':
        subject = `HomeFix booking declined · ${service} · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `I saw that booking #${ref} for ${service} was declined.`,
          `No worries — I’ll look for another time or provider on HomeFix.`,
          footer,
        ].join('\n')
        break
      case 'deposit_paid':
        subject = `HomeFix deposit paid · contacts unlocked · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `I’ve paid the 10% deposit (${formatMoney(booking.depositAmount)}) to HomeFix for ${service}.`,
          `Contacts should now be unlocked on both sides — feel free to call when ready.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'job_completed':
        subject = `HomeFix job completed · awaiting final payment · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `We’ve both confirmed the ${service} job is done.`,
          `I’ll pay the remaining ${formatMoney(booking.remainingAmount)} to HomeFix shortly.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'fully_paid':
        subject = `HomeFix thank you · fully paid · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `Thanks for the ${service} — I’ve paid in full to HomeFix.`,
          `Quote ${formatMoney(booking.quoteAmount)} (your 90% share: ${formatMoney(booking.remainingAmount)}).`,
          '',
          'Appreciate your help!',
          footer,
        ].join('\n')
        break
      case 'cancelled':
        subject = `HomeFix booking cancelled · ${service} · #${ref}`
        body = [
          `Hi ${providerName},`,
          '',
          `I’ve cancelled booking #${ref} for ${service} on HomeFix.`,
          footer,
        ].join('\n')
        break
    }
  } else {
    switch (event) {
      case 'booking_requested':
        subject = `HomeFix new booking request · ${service} · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `Thanks for requesting ${service} with ${providerName} on HomeFix.`,
          `I’ll review and accept soon so you can pay the 10% deposit.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'booking_accepted':
        subject = `HomeFix booking accepted · ${service} · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `I’ve accepted your ${service} booking on HomeFix.`,
          `Please pay the 10% deposit (${formatMoney(booking.depositAmount)}) to HomeFix to unlock phone numbers.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'booking_rejected':
        subject = `HomeFix booking declined · ${service} · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `I’m unable to take booking #${ref} for ${service} right now.`,
          `Sorry for the inconvenience — please try another slot or provider on HomeFix.`,
          footer,
        ].join('\n')
        break
      case 'deposit_paid':
        subject = `HomeFix deposit received · contacts unlocked · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `HomeFix shows your 10% deposit is paid for ${service}.`,
          `Contacts are unlocked — I’ll reach out on the number on the booking.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'job_completed':
        subject = `HomeFix job completed · awaiting final payment · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `We’ve both confirmed the ${service} job is complete.`,
          `Please pay the remaining ${formatMoney(booking.remainingAmount)} to HomeFix to finish up.`,
          '',
          amounts,
          footer,
        ].join('\n')
        break
      case 'fully_paid':
        subject = `HomeFix thank you · payment complete · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `Thanks for paying in full for ${service} via HomeFix.`,
          `Glad we could help — you’re welcome to leave a review in the app.`,
          footer,
        ].join('\n')
        break
      case 'cancelled':
        subject = `HomeFix booking cancelled · ${service} · #${ref}`
        body = [
          `Hi ${customerName},`,
          '',
          `Booking #${ref} for ${service} is cancelled on HomeFix.`,
          footer,
        ].join('\n')
        break
    }
  }

  return {
    event,
    subject,
    body,
    toEmail,
    needsManualPaste: !toEmail,
  }
}

export function buildMailtoUrl(draft: Pick<BookingEmailDraft, 'subject' | 'body' | 'toEmail'>): string {
  const subject = encodeURIComponent(draft.subject)
  const body = encodeURIComponent(draft.body)
  const to = draft.toEmail ? encodeURIComponent(draft.toEmail) : ''
  return `mailto:${to}?subject=${subject}&body=${body}`
}

/** Clipboard text: subject + blank line + body. */
export function formatDraftForClipboard(draft: Pick<BookingEmailDraft, 'subject' | 'body'>): string {
  return `Subject: ${draft.subject}\n\n${draft.body}`
}

export async function copyBookingEmail(
  draft: Pick<BookingEmailDraft, 'subject' | 'body'>,
): Promise<void> {
  const text = formatDraftForClipboard(draft)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback for older environments
  if (typeof document === 'undefined') {
    throw new Error('Clipboard is not available')
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(area)
  if (!ok) throw new Error('Could not copy email draft')
}

export type BookingEmailActionResult =
  | { ok: true; mode: 'copied' | 'mailto'; message: string }
  | { ok: false; message: string }

/**
 * Prefer mailto when an email is known; otherwise copy subject+body.
 * Always copies when `preferCopy` is true.
 */
export async function shareBookingEmailDraft(
  booking: Booking,
  ctx: BookingEmailContext,
  options?: { preferCopy?: boolean },
): Promise<BookingEmailActionResult> {
  const draft = buildBookingEmailDraft(booking, ctx)
  if (!draft) {
    return { ok: false, message: 'No email draft for this booking status.' }
  }

  const preferCopy = options?.preferCopy ?? false

  if (!preferCopy && draft.toEmail) {
    try {
      window.location.href = buildMailtoUrl(draft)
      return { ok: true, mode: 'mailto', message: 'Opening mail app…' }
    } catch {
      // Fall through to copy
    }
  }

  try {
    await copyBookingEmail(draft)
    const hint = draft.needsManualPaste
      ? 'Copied. Paste into your email app (no email on file).'
      : 'Copied status email.'
    return { ok: true, mode: 'copied', message: hint }
  } catch {
    return { ok: false, message: 'Could not copy email draft.' }
  }
}
