import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import {
  isPaymentKind,
  requireEnv,
  verifyPaymentSignature,
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
    const orderId =
      typeof body.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : ""
    const paymentId =
      typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : ""
    const signature =
      typeof body.razorpay_signature === "string" ? body.razorpay_signature.trim() : ""

    if (!bookingId || !isPaymentKind(kind) || !orderId || !paymentId || !signature) {
      return jsonResponse(
        {
          error:
            "booking_id, kind, razorpay_order_id, razorpay_payment_id, and razorpay_signature are required",
        },
        400,
      )
    }

    const admin = createServiceClient()
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select(
        "id, customer_id, payment_status, razorpay_order_id, razorpay_deposit_payment_id, razorpay_remaining_payment_id",
      )
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) throw bookingError
    if (!booking) return jsonResponse({ error: "Booking not found" }, 404)
    if (booking.customer_id !== userId) {
      return jsonResponse({ error: "Not allowed" }, 403)
    }

    // Idempotent short-circuit before signature (same customer, already paid)
    if (kind === "deposit" && booking.payment_status !== "unpaid") {
      if (!booking.razorpay_deposit_payment_id && paymentId) {
        await admin.rpc("apply_razorpay_booking_payment", {
          p_booking_id: bookingId,
          p_kind: kind,
          p_razorpay_order_id: orderId,
          p_razorpay_payment_id: paymentId,
        })
      }
      return jsonResponse({ ok: true, bookingId, kind, alreadyPaid: true })
    }
    if (kind === "remaining" && booking.payment_status === "fully_paid") {
      if (!booking.razorpay_remaining_payment_id && paymentId) {
        await admin.rpc("apply_razorpay_booking_payment", {
          p_booking_id: bookingId,
          p_kind: kind,
          p_razorpay_order_id: orderId,
          p_razorpay_payment_id: paymentId,
        })
      }
      return jsonResponse({ ok: true, bookingId, kind, alreadyPaid: true })
    }

    if (booking.razorpay_order_id && booking.razorpay_order_id !== orderId) {
      return jsonResponse({ error: "Order id does not match this booking" }, 400)
    }

    const keySecret = requireEnv("RAZORPAY_KEY_SECRET")
    const valid = await verifyPaymentSignature({
      orderId,
      paymentId,
      signature,
      keySecret,
    })
    if (!valid) return jsonResponse({ error: "Invalid payment signature" }, 400)

    const { data, error } = await admin.rpc("apply_razorpay_booking_payment", {
      p_booking_id: bookingId,
      p_kind: kind as PaymentKind,
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
    })

    if (error) throw error

    return jsonResponse({
      ok: true,
      bookingId,
      kind,
      paymentStatus: data?.payment_status ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify payment"
    const status =
      message === "Unauthorized" || message === "Missing authorization"
        ? 401
        : message.includes("Invalid") ||
            message.includes("only due") ||
            message.includes("confirm") ||
            message.includes("deposit first")
          ? 400
          : 500
    return jsonResponse({ error: message }, status)
  }
})
