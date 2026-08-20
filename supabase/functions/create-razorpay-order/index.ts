import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import {
  amountToPaise,
  assertCanCreateOrder,
  isPaymentKind,
  razorpayAuthHeader,
  requireEnv,
  rupeesForKind,
  type BookingPaymentRow,
  type PaymentKind,
} from "../_shared/razorpay.ts"
import { createServiceClient, requireUserId } from "../_shared/supabase.ts"

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
        "id, customer_id, status, payment_status, deposit_amount, remaining_amount, provider_completed, customer_completed, razorpay_order_id, razorpay_deposit_payment_id, razorpay_remaining_payment_id",
      )
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) throw bookingError
    if (!booking) return jsonResponse({ error: "Booking not found" }, 404)

    const row = booking as BookingPaymentRow
    if (row.customer_id !== userId) {
      return jsonResponse({ error: "Not allowed" }, 403)
    }

    assertCanCreateOrder(row, kind as PaymentKind)

    const keyId = requireEnv("RAZORPAY_KEY_ID")
    const keySecret = requireEnv("RAZORPAY_KEY_SECRET")
    const amount = amountToPaise(rupeesForKind(row, kind as PaymentKind))
    const receipt = `hf_${kind[0]}_${bookingId.replace(/-/g, "").slice(0, 20)}`

    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: razorpayAuthHeader(keyId, keySecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        notes: {
          booking_id: bookingId,
          kind,
        },
      }),
    })

    const orderJson = await orderRes.json()
    if (!orderRes.ok) {
      const message =
        typeof orderJson?.error?.description === "string"
          ? orderJson.error.description
          : "Could not create Razorpay order"
      return jsonResponse({ error: message }, 502)
    }

    const orderId = orderJson.id as string
    const { error: updateError } = await admin
      .from("bookings")
      .update({ razorpay_order_id: orderId })
      .eq("id", bookingId)

    if (updateError) throw updateError

    return jsonResponse({
      keyId,
      orderId,
      amount,
      currency: "INR",
      bookingId,
      kind,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create order"
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
