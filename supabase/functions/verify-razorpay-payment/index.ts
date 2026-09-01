import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import {
  isPaymentKind,
  razorpayAuthHeader,
  requireEnv,
  verifyPaymentLinkSignature,
  verifyPaymentSignature,
  type PaymentKind,
} from "../_shared/razorpay.ts"
import { createServiceClient, requireUserId } from "../_shared/supabase.ts"

function inferKindFromPaymentStatus(paymentStatus: string | null | undefined): PaymentKind | null {
  if (paymentStatus === "unpaid") return "deposit"
  if (paymentStatus === "deposit_paid") return "remaining"
  return null
}

const PAID_PAYMENT_STATUSES = new Set(["captured", "authorized"])

async function assertRazorpayPaymentSettled(params: {
  paymentId: string
  keyId: string
  keySecret: string
}): Promise<{ status: string; orderId: string | null }> {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${params.paymentId}`, {
    headers: { Authorization: razorpayAuthHeader(params.keyId, params.keySecret) },
  })
  const json = await res.json()
  if (!res.ok) {
    const message =
      typeof json?.error?.description === "string"
        ? json.error.description
        : "Could not fetch Razorpay payment"
    throw new Error(message)
  }
  const status = typeof json.status === "string" ? json.status : ""
  if (!PAID_PAYMENT_STATUSES.has(status)) {
    throw new Error(
      `Razorpay payment is "${status || "unknown"}", not captured/authorized — booking not marked paid`,
    )
  }
  const orderId = typeof json.order_id === "string" ? json.order_id : null
  return { status, orderId }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse()
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  try {
    const { userId } = await requireUserId(req)
    const body = await req.json()

    const paymentLinkId =
      typeof body.razorpay_payment_link_id === "string" ? body.razorpay_payment_link_id.trim() : ""

    // --- Payment Link callback confirmation (preferred path after hosted pay) ---
    if (paymentLinkId) {
      const paymentId =
        typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : ""
      const referenceId =
        typeof body.razorpay_payment_link_reference_id === "string"
          ? body.razorpay_payment_link_reference_id.trim()
          : ""
      const linkStatus =
        typeof body.razorpay_payment_link_status === "string"
          ? body.razorpay_payment_link_status.trim()
          : ""
      const signature =
        typeof body.razorpay_signature === "string" ? body.razorpay_signature.trim() : ""
      const bookingIdHint =
        typeof body.booking_id === "string" ? body.booking_id.trim() : ""
      const kindHint = isPaymentKind(body.kind) ? (body.kind as PaymentKind) : null

      if (!paymentId || !signature || !linkStatus) {
        return jsonResponse(
          {
            error:
              "razorpay_payment_id, razorpay_payment_link_status, and razorpay_signature are required",
          },
          400,
        )
      }

      if (linkStatus.toLowerCase() !== "paid") {
        return jsonResponse(
          {
            error: `Payment link status is "${linkStatus}", not paid`,
            paymentLinkStatus: linkStatus,
          },
          400,
        )
      }

      const keyId = requireEnv("RAZORPAY_KEY_ID")
      const keySecret = requireEnv("RAZORPAY_KEY_SECRET")
      const valid = await verifyPaymentLinkSignature({
        paymentLinkId,
        paymentLinkReferenceId: referenceId,
        paymentLinkStatus: linkStatus,
        paymentId,
        signature,
        keySecret,
      })
      if (!valid) return jsonResponse({ error: "Invalid payment link signature" }, 400)

      const admin = createServiceClient()
      let bookingQuery = admin
        .from("bookings")
        .select(
          "id, customer_id, payment_status, razorpay_order_id, razorpay_payment_link_id, razorpay_deposit_payment_id, razorpay_remaining_payment_id",
        )
        .limit(1)

      if (bookingIdHint) {
        bookingQuery = bookingQuery.eq("id", bookingIdHint)
      } else {
        bookingQuery = bookingQuery.eq("razorpay_payment_link_id", paymentLinkId)
      }

      const { data: booking, error: bookingError } = await bookingQuery.maybeSingle()
      if (bookingError) throw bookingError
      if (!booking) return jsonResponse({ error: "Booking not found for payment link" }, 404)
      if (booking.customer_id !== userId) {
        return jsonResponse({ error: "Not allowed" }, 403)
      }

      const kind =
        kindHint ||
        inferKindFromPaymentStatus(booking.payment_status) ||
        (booking.payment_status === "fully_paid" ? "remaining" : null)

      if (!kind) {
        return jsonResponse({ error: "Could not determine payment kind for booking" }, 400)
      }

      // Confirm with Razorpay that the link is fully paid
      const linkRes = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
        headers: { Authorization: razorpayAuthHeader(keyId, keySecret) },
      })
      const linkJson = await linkRes.json()
      if (!linkRes.ok) {
        const message =
          typeof linkJson?.error?.description === "string"
            ? linkJson.error.description
            : "Could not fetch Razorpay payment link"
        return jsonResponse({ error: message }, 502)
      }

      const remoteStatus = typeof linkJson.status === "string" ? linkJson.status : ""
      if (remoteStatus !== "paid") {
        return jsonResponse(
          { error: `Razorpay payment link is "${remoteStatus || "unknown"}", not paid` },
          400,
        )
      }

      // Also require the specific payment to be captured/authorized
      const settled = await assertRazorpayPaymentSettled({ paymentId, keyId, keySecret })

      const orderId =
        settled.orderId ||
        (typeof linkJson.order_id === "string" && linkJson.order_id) ||
        booking.razorpay_order_id ||
        ""

      // Idempotent short-circuit
      if (kind === "deposit" && booking.payment_status !== "unpaid") {
        return jsonResponse({ ok: true, bookingId: booking.id, kind, alreadyPaid: true })
      }
      if (kind === "remaining" && booking.payment_status === "fully_paid") {
        return jsonResponse({ ok: true, bookingId: booking.id, kind, alreadyPaid: true })
      }

      const { data, error } = await admin.rpc("apply_razorpay_booking_payment", {
        p_booking_id: booking.id,
        p_kind: kind,
        p_razorpay_order_id: orderId,
        p_razorpay_payment_id: paymentId,
      })
      if (error) throw error

      return jsonResponse({
        ok: true,
        bookingId: booking.id,
        kind,
        paymentStatus: data?.payment_status ?? null,
        razorpayPaymentStatus: settled.status,
        mode: "payment_link",
      })
    }

    // --- Standard Checkout verify path ---
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

    const keyId = requireEnv("RAZORPAY_KEY_ID")
    const keySecret = requireEnv("RAZORPAY_KEY_SECRET")
    const valid = await verifyPaymentSignature({
      orderId,
      paymentId,
      signature,
      keySecret,
    })
    if (!valid) return jsonResponse({ error: "Invalid payment signature" }, 400)

    const settled = await assertRazorpayPaymentSettled({ paymentId, keyId, keySecret })

    const { data, error } = await admin.rpc("apply_razorpay_booking_payment", {
      p_booking_id: bookingId,
      p_kind: kind as PaymentKind,
      p_razorpay_order_id: orderId || settled.orderId || "",
      p_razorpay_payment_id: paymentId,
    })

    if (error) throw error

    return jsonResponse({
      ok: true,
      bookingId,
      kind,
      paymentStatus: data?.payment_status ?? null,
      razorpayPaymentStatus: settled.status,
      mode: "checkout",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify payment"
    const status =
      message === "Unauthorized" || message === "Missing authorization"
        ? 401
        : message.includes("Invalid") ||
            message.includes("only due") ||
            message.includes("confirm") ||
            message.includes("deposit first") ||
            message.includes("not paid") ||
            message.includes("not captured") ||
            message.includes("status is")
          ? 400
          : 500
    return jsonResponse({ error: message }, status)
  }
})
