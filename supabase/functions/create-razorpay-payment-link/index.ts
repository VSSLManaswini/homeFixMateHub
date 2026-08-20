import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import {
  amountToPaise,
  assertCanCreateOrder,
  isPaymentKind,
  razorpayAuthHeader,
  requireEnv,
  rupeesForKind,
  sanitizeReturnUrl,
  type BookingPaymentRow,
  type PaymentKind,
} from "../_shared/razorpay.ts"
import { createServiceClient, requireUserId } from "../_shared/supabase.ts"

const LINK_TTL_SECONDS = 60 * 60 // 1 hour

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse()
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  try {
    const { userId } = await requireUserId(req)
    const body = await req.json()
    const bookingId = typeof body.booking_id === "string" ? body.booking_id.trim() : ""
    const kind = body.kind

    if (!bookingId || !isPaymentKind(kind)) {
      return jsonResponse({ error: "booking_id and kind (deposit|remaining) are required" }, 400)
    }

    const admin = createServiceClient()
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select(
        "id, customer_id, status, payment_status, deposit_amount, remaining_amount, provider_completed, customer_completed, razorpay_order_id, razorpay_deposit_payment_id, razorpay_remaining_payment_id, customer_contact",
      )
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) throw bookingError
    if (!booking) return jsonResponse({ error: "Booking not found" }, 404)

    const row = booking as BookingPaymentRow & { customer_contact?: string | null }
    if (row.customer_id !== userId) {
      return jsonResponse({ error: "Not allowed" }, 403)
    }

    assertCanCreateOrder(row, kind as PaymentKind)

    const keyId = requireEnv("RAZORPAY_KEY_ID")
    const keySecret = requireEnv("RAZORPAY_KEY_SECRET")
    const amount = amountToPaise(rupeesForKind(row, kind as PaymentKind))
    const description =
      kind === "deposit" ? "HomeFix 10% deposit" : "HomeFix remaining 90%"
    const referenceId = `hf_${kind[0]}_${bookingId.replace(/-/g, "").slice(0, 18)}_${Date.now()
      .toString(36)
      .slice(-6)}`
    const expireBy = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS

    // Prefer the browser origin the customer is actually on (avoids stale SITE_URL).
    const returnBase =
      sanitizeReturnUrl(body.return_url) || sanitizeReturnUrl(Deno.env.get("SITE_URL"))
    const callbackUrl = returnBase
      ? `${returnBase}/?payment=return&booking_id=${encodeURIComponent(bookingId)}&kind=${kind}`
      : undefined

    const contactDigits = (row.customer_contact ?? "").replace(/\D/g, "")
    const customerPayload: Record<string, string> = {}
    if (contactDigits.length >= 10) {
      customerPayload.contact = contactDigits.slice(-10)
    }

    const linkBody: Record<string, unknown> = {
      amount,
      currency: "INR",
      accept_partial: false,
      expire_by: expireBy,
      reference_id: referenceId,
      description,
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: {
        booking_id: bookingId,
        kind,
      },
    }

    if (Object.keys(customerPayload).length > 0) {
      linkBody.customer = customerPayload
    }
    if (callbackUrl) {
      linkBody.callback_url = callbackUrl
      linkBody.callback_method = "get"
    }

    const linkRes = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: razorpayAuthHeader(keyId, keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(linkBody),
    })

    const linkJson = await linkRes.json()
    if (!linkRes.ok) {
      const message =
        typeof linkJson?.error?.description === "string"
          ? linkJson.error.description
          : "Could not create Razorpay payment link"
      return jsonResponse({ error: message }, 502)
    }

    const paymentLinkId = typeof linkJson.id === "string" ? linkJson.id : ""
    const shortUrl = typeof linkJson.short_url === "string" ? linkJson.short_url : ""
    const orderId = typeof linkJson.order_id === "string" ? linkJson.order_id : null

    if (!paymentLinkId || !shortUrl) {
      return jsonResponse({ error: "Razorpay payment link response missing id/url" }, 502)
    }

    const updatePayload: Record<string, string | null> = {
      razorpay_payment_link_id: paymentLinkId,
      razorpay_payment_link_url: shortUrl,
    }
    if (orderId) updatePayload.razorpay_order_id = orderId

    const { error: updateError } = await admin.from("bookings").update(updatePayload).eq("id", bookingId)
    if (updateError) throw updateError

    return jsonResponse({
      shortUrl,
      paymentLinkId,
      amount,
      currency: "INR",
      bookingId,
      kind,
      expireBy,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create payment link"
    const status =
      message === "Unauthorized" || message === "Missing authorization"
        ? 401
        : message.includes("only due") ||
            message.includes("already paid") ||
            message.includes("confirm") ||
            message.includes("deposit first")
          ? 400
          : 500
    return jsonResponse({ error: message }, status)
  }
})
