export type PaymentKind = "deposit" | "remaining"

export function isPaymentKind(value: unknown): value is PaymentKind {
  return value === "deposit" || value === "remaining"
}

export function amountToPaise(rupees: number | string | null | undefined): number {
  const n = Number(rupees)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Invalid payment amount")
  }
  return Math.round(n * 100)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return out === 0
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function verifyPaymentSignature(params: {
  orderId: string
  paymentId: string
  signature: string
  keySecret: string
}): Promise<boolean> {
  const expected = await hmacSha256Hex(
    params.keySecret,
    `${params.orderId}|${params.paymentId}`,
  )
  return timingSafeEqual(expected, params.signature)
}

/** Payment Link callback signature (GET redirect after pay). */
export async function verifyPaymentLinkSignature(params: {
  paymentLinkId: string
  paymentLinkReferenceId: string
  paymentLinkStatus: string
  paymentId: string
  signature: string
  keySecret: string
}): Promise<boolean> {
  const expected = await hmacSha256Hex(
    params.keySecret,
    `${params.paymentLinkId}|${params.paymentLinkReferenceId}|${params.paymentLinkStatus}|${params.paymentId}`,
  )
  return timingSafeEqual(expected, params.signature)
}

export async function verifyWebhookSignature(params: {
  body: string
  signature: string
  webhookSecret: string
}): Promise<boolean> {
  const expected = await hmacSha256Hex(params.webhookSecret, params.body)
  return timingSafeEqual(expected, params.signature)
}

export function sanitizeReturnUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim().replace(/\/$/, "")
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    // Disallow credentials / fragments in callback base
    if (url.username || url.password) return undefined
    return `${url.protocol}//${url.host}`
  } catch {
    return undefined
  }
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function razorpayAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`
}

export type BookingPaymentRow = {
  id: string
  customer_id: string
  status: string
  payment_status: string
  deposit_amount: number | string
  remaining_amount: number | string
  provider_completed: boolean
  customer_completed: boolean
  razorpay_order_id: string | null
  razorpay_deposit_payment_id: string | null
  razorpay_remaining_payment_id: string | null
}

export function assertCanCreateOrder(booking: BookingPaymentRow, kind: PaymentKind): void {
  if (kind === "deposit") {
    if (booking.status !== "accepted") {
      throw new Error("Deposit is only due after the provider accepts")
    }
    if (booking.payment_status !== "unpaid") {
      throw new Error("Deposit already paid")
    }
    return
  }

  if (!(booking.provider_completed && booking.customer_completed)) {
    throw new Error("Both provider and customer must confirm the job is completed first")
  }
  if (booking.status !== "completed") {
    throw new Error("Final payment is only due after both sides confirm completion")
  }
  if (booking.payment_status !== "deposit_paid") {
    throw new Error("Pay the 10% deposit first")
  }
}

export function rupeesForKind(booking: BookingPaymentRow, kind: PaymentKind): number {
  return kind === "deposit" ? Number(booking.deposit_amount) : Number(booking.remaining_amount)
}
