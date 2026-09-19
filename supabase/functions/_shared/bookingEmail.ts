export type BookingEmailEvent =
  | "booking_requested"
  | "booking_accepted"
  | "booking_rejected"
  | "deposit_paid"
  | "job_completed"
  | "fully_paid"
  | "cancelled"

export function isBookingEmailEvent(value: unknown): value is BookingEmailEvent {
  return (
    value === "booking_requested" ||
    value === "booking_accepted" ||
    value === "booking_rejected" ||
    value === "deposit_paid" ||
    value === "job_completed" ||
    value === "fully_paid" ||
    value === "cancelled"
  )
}

export function inferBookingEmailEvent(row: {
  status: string
  payment_status: string
}): BookingEmailEvent | null {
  const { status, payment_status } = row
  if (status === "rejected") return "booking_rejected"
  if (status === "cancelled") return "cancelled"
  if (payment_status === "fully_paid") return "fully_paid"
  if (status === "completed" && payment_status === "deposit_paid") return "job_completed"
  if (payment_status === "deposit_paid") return "deposit_paid"
  if (status === "accepted") return "booking_accepted"
  if (status === "pending") return "booking_requested"
  return null
}

export function inferEventFromChange(
  previous: { status: string; payment_status: string } | null,
  next: { status: string; payment_status: string },
): BookingEmailEvent | null {
  if (!previous) {
    return next.status === "pending" ? "booking_requested" : inferBookingEmailEvent(next)
  }
  if (previous.status !== next.status) {
    if (next.status === "accepted") return "booking_accepted"
    if (next.status === "rejected") return "booking_rejected"
    if (next.status === "cancelled") return "cancelled"
    if (next.status === "completed" && next.payment_status === "deposit_paid") return "job_completed"
  }
  if (previous.payment_status !== next.payment_status) {
    if (next.payment_status === "deposit_paid") return "deposit_paid"
    if (next.payment_status === "fully_paid") return "fully_paid"
  }
  if (
    next.status === "completed" &&
    next.payment_status === "deposit_paid" &&
    previous.status !== "completed"
  ) {
    return "job_completed"
  }
  return null
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

export function extractEmail(contact: string | null | undefined): string | null {
  if (!contact) return null
  const match = contact.match(EMAIL_RE)
  return match ? match[0] : null
}

export function shortBookingId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase()
}

export function formatMoneyInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`
}

export type EmailParty = "customer" | "provider"

export function buildTransactionalEmail(input: {
  event: BookingEmailEvent
  toParty: EmailParty
  bookingId: string
  service: string
  providerName: string
  customerName: string
  quoteAmount: number
  depositAmount: number
  remainingAmount: number
  whenLabel: string
}): { subject: string; text: string } {
  const ref = shortBookingId(input.bookingId)
  const amounts = [
    `Quote: ${formatMoneyInr(input.quoteAmount)}`,
    `Deposit (10% to HomeFix): ${formatMoneyInr(input.depositAmount)}`,
    `Remaining (90%): ${formatMoneyInr(input.remainingAmount)}`,
  ].join("\n")
  const footer = [
    "",
    `Booking ID: ${ref}`,
    `When: ${input.whenLabel}`,
    "",
    "— HomeFix",
  ].join("\n")

  if (input.toParty === "provider") {
    switch (input.event) {
      case "booking_requested":
        return {
          subject: `HomeFix new booking request · ${input.service} · #${ref}`,
          text: [
            `Hi ${input.providerName},`,
            "",
            `You have a new ${input.service} booking request from ${input.customerName}.`,
            "Open your provider dashboard → Bookings to accept or reject.",
            "",
            amounts,
            footer,
          ].join("\n"),
        }
      case "booking_accepted":
        return {
          subject: `HomeFix booking accepted · ${input.service} · #${ref}`,
          text: [
            `Hi ${input.providerName},`,
            "",
            `You accepted ${input.customerName}'s ${input.service} booking.`,
            "They will pay the 10% deposit to HomeFix next so contacts can unlock.",
            "",
            amounts,
            footer,
          ].join("\n"),
        }
      case "booking_rejected":
        return {
          subject: `HomeFix booking declined · ${input.service} · #${ref}`,
          text: [`Hi ${input.providerName},`, "", `Booking #${ref} for ${input.service} was declined.`, footer].join(
            "\n",
          ),
        }
      case "deposit_paid":
        return {
          subject: `HomeFix deposit paid · contacts unlocked · #${ref}`,
          text: [
            `Hi ${input.providerName},`,
            "",
            `${input.customerName} paid the 10% deposit (${formatMoneyInr(input.depositAmount)}) for ${input.service}.`,
            "Contacts are unlocked — you can call from the booking card.",
            "",
            amounts,
            footer,
          ].join("\n"),
        }
      case "job_completed":
        return {
          subject: `HomeFix job completed · awaiting final payment · #${ref}`,
          text: [
            `Hi ${input.providerName},`,
            "",
            `Both sides confirmed the ${input.service} job is done.`,
            `${input.customerName} will pay the remaining ${formatMoneyInr(input.remainingAmount)} to HomeFix.`,
            "",
            amounts,
            footer,
          ].join("\n"),
        }
      case "fully_paid":
        return {
          subject: `HomeFix fully paid · ${input.service} · #${ref}`,
          text: [
            `Hi ${input.providerName},`,
            "",
            `${input.customerName} paid in full for ${input.service}.`,
            `Your 90% share (${formatMoneyInr(input.remainingAmount)}) is queued for payout.`,
            footer,
          ].join("\n"),
        }
      case "cancelled":
        return {
          subject: `HomeFix booking cancelled · ${input.service} · #${ref}`,
          text: [`Hi ${input.providerName},`, "", `Booking #${ref} for ${input.service} was cancelled.`, footer].join(
            "\n",
          ),
        }
    }
  }

  switch (input.event) {
    case "booking_requested":
      return {
        subject: `HomeFix booking request sent · ${input.service} · #${ref}`,
        text: [
          `Hi ${input.customerName},`,
          "",
          `Your ${input.service} request with ${input.providerName} is in. They’ll accept or decline in Bookings.`,
          "",
          amounts,
          footer,
        ].join("\n"),
      }
    case "booking_accepted":
      return {
        subject: `HomeFix booking accepted · pay 10% deposit · #${ref}`,
        text: [
          `Hi ${input.customerName},`,
          "",
          `${input.providerName} accepted your ${input.service} booking.`,
          `Pay the 10% deposit (${formatMoneyInr(input.depositAmount)}) to HomeFix to unlock phone numbers.`,
          "",
          amounts,
          footer,
        ].join("\n"),
      }
    case "booking_rejected":
      return {
        subject: `HomeFix booking declined · ${input.service} · #${ref}`,
        text: [
          `Hi ${input.customerName},`,
          "",
          `${input.providerName} cannot take booking #${ref} for ${input.service} right now.`,
          "Please try another slot or provider on HomeFix.",
          footer,
        ].join("\n"),
      }
    case "deposit_paid":
      return {
        subject: `HomeFix deposit received · contacts unlocked · #${ref}`,
        text: [
          `Hi ${input.customerName},`,
          "",
          `Your 10% deposit is recorded for ${input.service}. Contacts are unlocked.`,
          "",
          amounts,
          footer,
        ].join("\n"),
      }
    case "job_completed":
      return {
        subject: `HomeFix job completed · pay remaining 90% · #${ref}`,
        text: [
          `Hi ${input.customerName},`,
          "",
          `Both sides confirmed the ${input.service} job is complete.`,
          `Pay the remaining ${formatMoneyInr(input.remainingAmount)} to HomeFix to finish.`,
          "",
          amounts,
          footer,
        ].join("\n"),
      }
    case "fully_paid":
      return {
        subject: `HomeFix payment complete · ${input.service} · #${ref}`,
        text: [
          `Hi ${input.customerName},`,
          "",
          `Thanks for paying in full for ${input.service} via HomeFix.`,
          "You’re welcome to leave a review in the app.",
          footer,
        ].join("\n"),
      }
    case "cancelled":
      return {
        subject: `HomeFix booking cancelled · ${input.service} · #${ref}`,
        text: [`Hi ${input.customerName},`, "", `Booking #${ref} for ${input.service} is cancelled.`, footer].join("\n"),
      }
  }
}
