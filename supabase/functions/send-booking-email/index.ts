import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import {
  buildTransactionalEmail,
  extractEmail,
  inferBookingEmailEvent,
  isBookingEmailEvent,
  type BookingEmailEvent,
  type EmailParty,
} from "../_shared/bookingEmail.ts"
import { createServiceClient, createUserClient } from "../_shared/supabase.ts"

type BookingRow = {
  id: string
  provider_id: string
  customer_id: string
  status: string
  booking_type: string
  scheduled_at: string | null
  quote_amount: number | string
  deposit_amount: number | string
  remaining_amount: number | string
  payment_status: string
  customer_contact: string
}

function num(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

async function authorize(req: Request, booking: BookingRow): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? ""
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return true

  if (!authHeader.startsWith("Bearer ")) return false
  const userClient = createUserClient(authHeader)
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) return false
  if (data.user.id === booking.customer_id) return true

  const admin = createServiceClient()
  const { data: provider } = await admin
    .from("providers")
    .select("user_id")
    .eq("id", booking.provider_id)
    .maybeSingle()
  return provider?.user_id === data.user.id
}

async function userEmail(userId: string): Promise<string | null> {
  const admin = createServiceClient()
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error) return null
  const email = data.user?.email?.trim()
  return email || null
}

async function alreadySent(bookingId: string, event: BookingEmailEvent, recipient: string): Promise<boolean> {
  const admin = createServiceClient()
  const { data, error } = await admin
    .from("booking_email_log")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("event", event)
    .eq("recipient", recipient.toLowerCase())
    .maybeSingle()
  if (error) return false
  return Boolean(data)
}

async function markSent(bookingId: string, event: BookingEmailEvent, recipient: string): Promise<void> {
  const admin = createServiceClient()
  const { error } = await admin.from("booking_email_log").insert({
    booking_id: bookingId,
    event,
    recipient: recipient.toLowerCase(),
  })
  if (error && !error.message.toLowerCase().includes("duplicate")) {
    console.error("booking_email_log insert", error.message)
  }
}

async function sendResend(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim()
  const from = Deno.env.get("EMAIL_FROM")?.trim() || "HomeFix <onboarding@resend.dev>"
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set" }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  })
  const json = (await res.json().catch(() => ({}))) as { message?: string; name?: string }
  if (!res.ok) {
    return { ok: false, error: json.message || json.name || `Resend HTTP ${res.status}` }
  }
  return { ok: true }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse()
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  try {
    const body = await req.json()
    const bookingId = typeof body.booking_id === "string" ? body.booking_id.trim() : ""
    if (!bookingId) return jsonResponse({ error: "booking_id is required" }, 400)

    const admin = createServiceClient()
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select(
        "id, provider_id, customer_id, status, booking_type, scheduled_at, quote_amount, deposit_amount, remaining_amount, payment_status, customer_contact",
      )
      .eq("id", bookingId)
      .maybeSingle()

    if (bookingError) throw bookingError
    if (!booking) return jsonResponse({ error: "Booking not found" }, 404)
    const row = booking as BookingRow

    const allowed = await authorize(req, row)
    if (!allowed) return jsonResponse({ error: "Unauthorized" }, 401)

    const event: BookingEmailEvent | null = isBookingEmailEvent(body.event)
      ? body.event
      : inferBookingEmailEvent(row)
    if (!event) return jsonResponse({ ok: true, skipped: true, reason: "no_event" })

    const { data: provider } = await admin
      .from("providers")
      .select("user_id, name, service, contact")
      .eq("id", row.provider_id)
      .maybeSingle()

    const providerName = provider?.name?.trim() || "Provider"
    const service = provider?.service?.trim() || "Home service"
    const customerEmail = (await userEmail(row.customer_id)) || extractEmail(row.customer_contact)
    const providerEmail =
      (provider?.user_id ? await userEmail(provider.user_id) : null) || extractEmail(provider?.contact)

    const whenLabel =
      row.booking_type === "scheduled" && row.scheduled_at
        ? new Date(row.scheduled_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "Instant"

    const parties: { party: EmailParty; email: string | null }[] = [
      { party: "customer", email: customerEmail },
      { party: "provider", email: providerEmail },
    ]

    const results: Array<{ party: EmailParty; to: string | null; status: string; error?: string }> = []

    for (const item of parties) {
      if (!item.email) {
        results.push({ party: item.party, to: null, status: "skipped_no_email" })
        continue
      }
      if (await alreadySent(bookingId, event, item.email)) {
        results.push({ party: item.party, to: item.email, status: "already_sent" })
        continue
      }
      const message = buildTransactionalEmail({
        event,
        toParty: item.party,
        bookingId: row.id,
        service,
        providerName,
        customerName: "Customer",
        quoteAmount: num(row.quote_amount),
        depositAmount: num(row.deposit_amount),
        remainingAmount: num(row.remaining_amount),
        whenLabel,
      })
      const sent = await sendResend(item.email, message.subject, message.text)
      if (sent.ok) {
        await markSent(bookingId, event, item.email)
        results.push({ party: item.party, to: item.email, status: "sent" })
      } else {
        results.push({ party: item.party, to: item.email, status: "error", error: sent.error })
      }
    }

    return jsonResponse({ ok: true, event, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send booking email"
    return jsonResponse({ error: message }, 400)
  }
})
