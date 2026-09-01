import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { bookingErrorMessage } from './bookings'

export type RazorpayPaymentKind = 'deposit' | 'remaining'

export type PaymentLinkResult = {
  shortUrl: string
  paymentLinkId: string
  amount: number
  currency: string
  bookingId: string
  kind: RazorpayPaymentKind
  expireBy?: number
}

type CreateOrderResponse = {
  keyId: string
  orderId: string
  amount: number
  currency: string
  bookingId: string
  kind: RazorpayPaymentKind
}

type RazorpayCheckoutSuccess = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayCheckoutOptions = {
  key: string
  amount: number
  currency: string
  order_id: string
  name: string
  description: string
  handler: (response: RazorpayCheckoutSuccess) => void
  modal?: { ondismiss?: () => void }
}

type RazorpayInstance = {
  open: () => void
  on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance
  }
}

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

function razorpayKeyId(): string {
  return (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined)?.trim() ?? ''
}

/**
 * Mock / skip-Razorpay pay path is permanently disabled.
 * Bookings must only move to deposit_paid / fully_paid via verified Razorpay capture
 * (verify-razorpay-payment Edge Function or razorpay-webhook).
 */
export function mockPaymentsEnabled(): boolean {
  return false
}

const PAID_STATUSES = new Set(['deposit_paid', 'fully_paid'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll booking.payment_status until it reflects a verified capture (or timeout).
 * Never treat UI/Razorpay redirect copy as proof of payment.
 */
export async function waitForBookingPaymentCapture(
  bookingId: string,
  kind: RazorpayPaymentKind,
  options?: { attempts?: number; intervalMs?: number },
): Promise<{ paid: boolean; paymentStatus: string | null }> {
  const attempts = options?.attempts ?? 12
  const intervalMs = options?.intervalMs ?? 1500
  let paymentStatus: string | null = null

  for (let i = 0; i < attempts; i++) {
    if (!supabase || !isSupabaseConfigured) {
      return { paid: false, paymentStatus: null }
    }
    const { data, error } = await supabase
      .from('bookings')
      .select('payment_status')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw error
    paymentStatus = typeof data?.payment_status === 'string' ? data.payment_status : null
    if (kind === 'deposit' && paymentStatus && PAID_STATUSES.has(paymentStatus)) {
      return { paid: true, paymentStatus }
    }
    if (kind === 'remaining' && paymentStatus === 'fully_paid') {
      return { paid: true, paymentStatus }
    }
    if (i < attempts - 1) await sleep(intervalMs)
  }

  return { paid: false, paymentStatus }
}

/** Razorpay payment-link callback statuses that mean the customer did not pay. */
export function isUnpaidPaymentLinkStatus(status: string): boolean {
  const s = status.trim().toLowerCase()
  return (
    !s ||
    s === 'created' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'expired' ||
    s === 'failed' ||
    s === 'pending'
  )
}

export function razorpayConfigured(): boolean {
  return Boolean(razorpayKeyId())
}

/** Payment Links only need Supabase + Edge Functions (not the publishable key). */
export function paymentLinksReady(): boolean {
  return isSupabaseConfigured && !mockPaymentsEnabled()
}

let scriptPromise: Promise<void> | null = null

function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout is only available in the browser'))
  }
  if (window.Razorpay) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Failed to load Razorpay checkout script'))
    }
    document.body.appendChild(script)
  })

  return scriptPromise
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('Supabase is not configured')
  }

  const { data, error } = await supabase.functions.invoke(name, { body })
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
    const msg = error.message || ''
    if (
      msg.includes('Failed to send') ||
      msg.includes('not found') ||
      msg.includes('FunctionsRelayError') ||
      msg.includes('FunctionsFetchError')
    ) {
      throw new Error('Razorpay not configured')
    }
    throw new Error(msg || 'Razorpay not configured')
  }

  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    throw new Error((data as { error: string }).error)
  }

  return data as T
}

function openCheckout(order: CreateOrderResponse): Promise<RazorpayCheckoutSuccess> {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error('Razorpay checkout failed to load'))
      return
    }

    const description =
      order.kind === 'deposit' ? 'HomeFix 10% deposit' : 'HomeFix remaining 90%'

    let settled = false
    const rzp = new window.Razorpay({
      key: order.keyId || razorpayKeyId(),
      amount: order.amount,
      currency: order.currency || 'INR',
      order_id: order.orderId,
      name: 'HomeFix',
      description,
      handler: (response) => {
        settled = true
        resolve(response)
      },
      modal: {
        ondismiss: () => {
          if (!settled) reject(new Error('Payment cancelled'))
        },
      },
    })

    rzp.on('payment.failed', (response) => {
      settled = true
      reject(new Error(response.error?.description || 'Payment failed'))
    })

    rzp.open()
  })
}

/**
 * Create a short-lived Razorpay Payment Link for deposit or remaining.
 * Does NOT mark the booking paid — webhook / verify does that after real payment.
 */
export async function createRazorpayPaymentLink(
  bookingId: string,
  kind: RazorpayPaymentKind,
): Promise<PaymentLinkResult> {
  if (mockPaymentsEnabled()) {
    throw new Error('Mock payments are disabled; use Razorpay payment links')
  }
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured')
  }

  let result: PaymentLinkResult
  try {
    result = await invokeFunction<PaymentLinkResult>('create-razorpay-payment-link', {
      booking_id: bookingId,
      kind,
      // So Razorpay redirects back to this deployment (not a stale SITE_URL secret).
      return_url: typeof window !== 'undefined' ? window.location.origin : undefined,
    })
  } catch (err) {
    const msg = bookingErrorMessage(err, 'Razorpay not configured')
    if (msg.toLowerCase().includes('not configured') || msg.includes('Failed to send')) {
      throw new Error('Razorpay not configured')
    }
    throw new Error(msg)
  }

  if (!result?.shortUrl || !result?.paymentLinkId) {
    throw new Error('Razorpay not configured')
  }

  return result
}

/**
 * After Razorpay Payment Link redirects back, confirm signature + mark booking paid.
 * Does not rely solely on the webhook (which may lag or miss notes).
 */
export async function confirmRazorpayPaymentLinkReturn(params: {
  bookingId?: string
  kind?: RazorpayPaymentKind
  razorpayPaymentId: string
  razorpayPaymentLinkId: string
  razorpayPaymentLinkReferenceId: string
  razorpayPaymentLinkStatus: string
  razorpaySignature: string
}): Promise<{
  ok: boolean
  bookingId?: string
  kind?: RazorpayPaymentKind
  paymentStatus?: string | null
  razorpayPaymentStatus?: string | null
}> {
  // Hard require identifiers that prove a completed link payment (not just a redirect).
  if (
    !params.razorpayPaymentId?.trim() ||
    !params.razorpayPaymentLinkId?.trim() ||
    !params.razorpaySignature?.trim() ||
    params.razorpayPaymentLinkStatus.trim().toLowerCase() !== 'paid'
  ) {
    throw new Error(
      'Incomplete Razorpay return — payment_id, paid link status, and signature are required before confirming',
    )
  }

  const body: Record<string, unknown> = {
    razorpay_payment_id: params.razorpayPaymentId,
    razorpay_payment_link_id: params.razorpayPaymentLinkId,
    razorpay_payment_link_reference_id: params.razorpayPaymentLinkReferenceId,
    razorpay_payment_link_status: params.razorpayPaymentLinkStatus,
    razorpay_signature: params.razorpaySignature,
  }
  if (params.bookingId) body.booking_id = params.bookingId
  if (params.kind) body.kind = params.kind

  return await invokeFunction('verify-razorpay-payment', body)
}

/**
 * Prefer Payment Links. Falls back to Checkout only when VITE_RAZORPAY_KEY_ID is set
 * and the payment-link function is unavailable.
 * Checkout path still requires a real payment before verify marks paid.
 */
export async function payBookingWithRazorpay(
  bookingId: string,
  kind: RazorpayPaymentKind,
): Promise<PaymentLinkResult | { mode: 'checkout' }> {
  if (mockPaymentsEnabled()) {
    throw new Error('Mock payments are disabled; use Razorpay payment links')
  }

  try {
    return await createRazorpayPaymentLink(bookingId, kind)
  } catch (linkErr) {
    const linkMsg = bookingErrorMessage(linkErr, '')
    // If the function is missing / not configured and Checkout key exists, fall back.
    const canFallbackCheckout =
      razorpayConfigured() &&
      (linkMsg === 'Razorpay not configured' ||
        linkMsg.toLowerCase().includes('not found') ||
        linkMsg.toLowerCase().includes('failed to send'))

    if (!canFallbackCheckout) throw linkErr
  }

  if (!razorpayConfigured()) {
    throw new Error('Razorpay not configured')
  }

  try {
    await loadRazorpayScript()
  } catch {
    throw new Error('Razorpay not configured')
  }

  let order: CreateOrderResponse
  try {
    order = await invokeFunction<CreateOrderResponse>('create-razorpay-order', {
      booking_id: bookingId,
      kind,
    })
  } catch (err) {
    const msg = bookingErrorMessage(err, 'Razorpay not configured')
    if (msg.toLowerCase().includes('not configured') || msg.includes('Failed to send')) {
      throw new Error('Razorpay not configured')
    }
    throw new Error(msg)
  }

  if (!order?.orderId || !order?.amount) {
    throw new Error('Razorpay not configured')
  }

  const checkout = await openCheckout({
    ...order,
    keyId: order.keyId || razorpayKeyId(),
  })

  await invokeFunction('verify-razorpay-payment', {
    booking_id: bookingId,
    kind,
    razorpay_order_id: checkout.razorpay_order_id,
    razorpay_payment_id: checkout.razorpay_payment_id,
    razorpay_signature: checkout.razorpay_signature,
  })

  return { mode: 'checkout' }
}

export function paymentActionErrorMessage(err: unknown, fallback: string): string {
  const msg = bookingErrorMessage(err, fallback)
  if (msg === 'Payment cancelled') {
    return 'Payment cancelled. Your booking is still unpaid — open the payment link again when you are ready.'
  }
  if (/not paid|not captured|not authorized|cancelled|canceled|expired|failed/i.test(msg)) {
    return msg
  }
  if (msg === 'Razorpay not configured') {
    return 'Razorpay not configured. Deploy create-razorpay-payment-link and set Edge secrets (see supabase/RAZORPAY_SETUP.md).'
  }
  return msg
}

export function isPaymentLinkResult(
  value: PaymentLinkResult | { mode: 'checkout' },
): value is PaymentLinkResult {
  return 'shortUrl' in value && typeof value.shortUrl === 'string'
}
