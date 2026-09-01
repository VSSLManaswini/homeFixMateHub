import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import {
  isPaymentKind,
  requireEnv,
  verifyWebhookSignature,
  type PaymentKind,
} from "../_shared/razorpay.ts"
import { createServiceClient } from "../_shared/supabase.ts"

type Notes = Record<string, string> | null | undefined

type RazorpayWebhookPayload = {
  event?: string
  payload?: {
    payment?: {
      entity?: {
        id?: string
        order_id?: string
        status?: string
        notes?: Notes
      }
    }
    payment_link?: {
      entity?: {
        id?: string
        status?: string
        notes?: Notes
        order_id?: string
      }
    }
  }
}

function notesBookingKind(notes: Notes): { bookingId: string; kind: PaymentKind | null } {
  const bookingId = typeof notes?.booking_id === "string" ? notes.booking_id.trim() : ""
  const kindRaw = notes?.kind
  return {
    bookingId,
    kind: isPaymentKind(kindRaw) ? kindRaw : null,
  }
}

function inferKindFromPaymentStatus(paymentStatus: string | null | undefined): PaymentKind | null {
  if (paymentStatus === "unpaid") return "deposit"
  if (paymentStatus === "deposit_paid") return "remaining"
  return null
}

async function applyPayment(params: {
  bookingId: string
  kind: PaymentKind
  orderId: string
  paymentId: string
}): Promise<{ alreadyPaid: boolean }> {
  const admin = createServiceClient()
  const { error } = await admin.rpc("apply_razorpay_booking_payment", {
    p_booking_id: params.bookingId,
    p_kind: params.kind,
    p_razorpay_order_id: params.orderId,
    p_razorpay_payment_id: params.paymentId,
  })

  if (error) {
    const msg = error.message ?? ""
    if (
      msg.includes("already paid") ||
      msg.includes("Deposit already paid") ||
      msg.includes("Pay the 10%")
    ) {
      return { alreadyPaid: true }
    }
    throw error
  }

  return { alreadyPaid: false }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse()
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  try {
    const rawBody = await req.text()
    const signature = req.headers.get("x-razorpay-signature")?.trim() ?? ""
    if (!signature) return jsonResponse({ error: "Missing signature" }, 400)

    const webhookSecret = requireEnv("RAZORPAY_WEBHOOK_SECRET")
    const valid = await verifyWebhookSignature({
      body: rawBody,
      signature,
      webhookSecret,
    })
    if (!valid) return jsonResponse({ error: "Invalid webhook signature" }, 400)

    const payload = JSON.parse(rawBody) as RazorpayWebhookPayload
    const event = payload.event ?? ""

    if (event !== "payment.captured" && event !== "payment_link.paid") {
      return jsonResponse({ ok: true, ignored: true, event: event || null })
    }

    const paymentEntity = payload.payload?.payment?.entity
    const linkEntity = payload.payload?.payment_link?.entity

    // Never mark paid on failed/created/cancelled entities (defense in depth).
    const paymentStatus = paymentEntity?.status?.trim().toLowerCase() ?? ""
    if (
      paymentStatus &&
      paymentStatus !== "captured" &&
      paymentStatus !== "authorized"
    ) {
      return jsonResponse({
        ok: true,
        ignored: true,
        reason: `payment status is ${paymentStatus}`,
        event,
      })
    }
    const linkStatus = linkEntity?.status?.trim().toLowerCase() ?? ""
    if (event === "payment_link.paid" && linkStatus && linkStatus !== "paid") {
      return jsonResponse({
        ok: true,
        ignored: true,
        reason: `payment_link status is ${linkStatus}`,
        event,
      })
    }

    const paymentId = paymentEntity?.id?.trim() ?? ""
    const orderId =
      paymentEntity?.order_id?.trim() ||
      linkEntity?.order_id?.trim() ||
      ""
    const paymentLinkId = linkEntity?.id?.trim() ?? ""

    // Prefer payment notes; fall back to payment_link notes (Payment Links API)
    const fromPayment = notesBookingKind(paymentEntity?.notes)
    const fromLink = notesBookingKind(linkEntity?.notes)
    let bookingId = fromPayment.bookingId || fromLink.bookingId
    let kind = fromPayment.kind || fromLink.kind

    // Fallback: resolve booking by stored payment_link_id / order_id when notes are missing
    if ((!bookingId || !kind) && (paymentLinkId || orderId)) {
      const admin = createServiceClient()
      let query = admin
        .from("bookings")
        .select("id, payment_status, razorpay_payment_link_id, razorpay_order_id")
        .limit(1)

      if (paymentLinkId) {
        query = query.eq("razorpay_payment_link_id", paymentLinkId)
      } else {
        query = query.eq("razorpay_order_id", orderId)
      }

      const { data: row, error } = await query.maybeSingle()
      if (error) throw error
      if (row?.id) {
        bookingId = bookingId || row.id
        kind = kind || inferKindFromPaymentStatus(row.payment_status)
      }
    }

    if (!bookingId || !kind || !paymentId) {
      return jsonResponse({ error: "Missing booking_id/kind/payment id in webhook" }, 400)
    }

    const result = await applyPayment({
      bookingId,
      kind,
      orderId,
      paymentId,
    })

    return jsonResponse({
      ok: true,
      bookingId,
      kind,
      paymentId,
      event,
      alreadyPaid: result.alreadyPaid,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook handling failed"
    const status = message.includes("not configured") ? 500 : 400
    return jsonResponse({ error: message }, status)
  }
})
