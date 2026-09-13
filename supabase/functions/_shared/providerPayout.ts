import {
  amountToPaise,
  razorpayAuthHeader,
  requireEnv,
} from "./razorpay.ts"
import { createServiceClient } from "./supabase.ts"

type PayoutProfileRow = {
  user_id: string
  payout_method: "upi" | "bank"
  upi_id: string
  account_holder_name: string
  bank_name: string
  account_number: string
  ifsc: string
}

function isCompleteProfile(profile: PayoutProfileRow | null): profile is PayoutProfileRow {
  if (!profile) return false
  if (!profile.account_holder_name?.trim()) return false
  if (profile.payout_method === "upi") {
    return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(profile.upi_id.trim())
  }
  const ifsc = profile.ifsc.replace(/\s+/g, "").toUpperCase()
  const account = profile.account_number.replace(/\s+/g, "")
  return (
    Boolean(profile.bank_name.trim()) &&
    /^\d{9,18}$/.test(account) &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)
  )
}

async function razorpayJson(
  path: string,
  init: RequestInit & { keyId: string; keySecret: string },
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: razorpayAuthHeader(init.keyId, init.keySecret),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

function razorpayErrorMessage(json: Record<string, unknown>, fallback: string): string {
  const err = json.error as { description?: string; code?: string; reason?: string } | undefined
  const parts = [err?.description, err?.reason, err?.code].filter(Boolean)
  if (parts.length) return parts.join(" — ")
  return fallback
}

/**
 * Create a RazorpayX payout for a fully_paid booking with payout pending/failed.
 * Idempotent when already paid or razorpay_payout_id exists.
 */
export async function processBookingPayout(bookingId: string): Promise<{
  ok: boolean
  alreadyPaid?: boolean
  payoutId?: string | null
  payoutStatus?: string
  error?: string
}> {
  const admin = createServiceClient()
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select(
      "id, provider_id, payment_status, payout_status, remaining_amount, razorpay_payout_id, payout_error",
    )
    .eq("id", bookingId)
    .maybeSingle()

  if (bookingError) throw bookingError
  if (!booking) return { ok: false, error: "Booking not found" }

  if (booking.payment_status !== "fully_paid") {
    return { ok: false, error: "Booking must be fully paid before payout" }
  }

  if (booking.payout_status === "paid" && booking.razorpay_payout_id) {
    return {
      ok: true,
      alreadyPaid: true,
      payoutId: booking.razorpay_payout_id,
      payoutStatus: "paid",
    }
  }

  if (booking.razorpay_payout_id && booking.payout_status !== "failed") {
    // Payout id exists but status not paid — treat as success for idempotency
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "paid",
      p_razorpay_payout_id: booking.razorpay_payout_id,
      p_error: null,
    })
    return {
      ok: true,
      alreadyPaid: true,
      payoutId: booking.razorpay_payout_id,
      payoutStatus: "paid",
    }
  }

  const { data: provider, error: providerError } = await admin
    .from("providers")
    .select("id, user_id, name")
    .eq("id", booking.provider_id)
    .maybeSingle()

  if (providerError) throw providerError
  if (!provider?.user_id) {
    const message = "Provider owner missing for payout"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const { data: profile, error: profileError } = await admin
    .from("provider_payout_profiles")
    .select(
      "user_id, payout_method, upi_id, account_holder_name, bank_name, account_number, ifsc",
    )
    .eq("user_id", provider.user_id)
    .maybeSingle()

  if (profileError) throw profileError

  if (!isCompleteProfile(profile as PayoutProfileRow | null)) {
    const message = "Provider must add complete UPI or bank payout details"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "pending",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "pending" }
  }

  let accountNumber: string
  try {
    accountNumber = requireEnv("RAZORPAY_ACCOUNT_NUMBER")
  } catch {
    const message =
      "RAZORPAY_ACCOUNT_NUMBER is not configured (RazorpayX current account / Lite customer id)"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const keyId = requireEnv("RAZORPAY_KEY_ID")
  const keySecret = requireEnv("RAZORPAY_KEY_SECRET")

  let amountPaise: number
  try {
    amountPaise = amountToPaise(booking.remaining_amount)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payout amount"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const contactName = profile.account_holder_name.trim().slice(0, 50) || provider.name || "Provider"
  const contactRes = await razorpayJson("/contacts", {
    method: "POST",
    keyId,
    keySecret,
    body: JSON.stringify({
      name: contactName,
      type: "vendor",
      reference_id: `hf_prov_${provider.user_id.replace(/-/g, "").slice(0, 32)}`,
      notes: {
        provider_user_id: provider.user_id,
        booking_id: bookingId,
      },
    }),
  })

  if (!contactRes.ok) {
    const message = razorpayErrorMessage(
      contactRes.json,
      "RazorpayX contact create failed — enable Payouts / RazorpayX in Live dashboard",
    )
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const contactId = typeof contactRes.json.id === "string" ? contactRes.json.id : ""
  if (!contactId) {
    const message = "RazorpayX contact create returned no id"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const fundBody =
    profile.payout_method === "upi"
      ? {
          contact_id: contactId,
          account_type: "vpa",
          vpa: { address: profile.upi_id.trim() },
        }
      : {
          contact_id: contactId,
          account_type: "bank_account",
          bank_account: {
            name: contactName,
            ifsc: profile.ifsc.replace(/\s+/g, "").toUpperCase(),
            account_number: profile.account_number.replace(/\s+/g, ""),
          },
        }

  const fundRes = await razorpayJson("/fund_accounts", {
    method: "POST",
    keyId,
    keySecret,
    body: JSON.stringify(fundBody),
  })

  if (!fundRes.ok) {
    const message = razorpayErrorMessage(fundRes.json, "RazorpayX fund account create failed")
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const fundAccountId = typeof fundRes.json.id === "string" ? fundRes.json.id : ""
  if (!fundAccountId) {
    const message = "RazorpayX fund account create returned no id"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const mode = profile.payout_method === "upi" ? "UPI" : "IMPS"
  const referenceId = `hf_po_${bookingId.replace(/-/g, "").slice(0, 32)}`
  const idempotencyKey = bookingId

  const payoutRes = await razorpayJson("/payouts", {
    method: "POST",
    keyId,
    keySecret,
    headers: { "X-Payout-Idempotency": idempotencyKey },
    body: JSON.stringify({
      account_number: accountNumber,
      fund_account_id: fundAccountId,
      amount: amountPaise,
      currency: "INR",
      mode,
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: "HomeFix provider 90%",
      notes: {
        booking_id: bookingId,
        provider_user_id: provider.user_id,
      },
    }),
  })

  if (!payoutRes.ok) {
    const message = razorpayErrorMessage(
      payoutRes.json,
      "RazorpayX payout failed — check Payouts product access and account balance",
    )
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const payoutId = typeof payoutRes.json.id === "string" ? payoutRes.json.id : ""
  if (!payoutId) {
    const message = "RazorpayX payout returned no id"
    await admin.rpc("mark_booking_payout_result", {
      p_booking_id: bookingId,
      p_status: "failed",
      p_razorpay_payout_id: null,
      p_error: message,
    })
    return { ok: false, error: message, payoutStatus: "failed" }
  }

  const { error: markError } = await admin.rpc("mark_booking_payout_result", {
    p_booking_id: bookingId,
    p_status: "paid",
    p_razorpay_payout_id: payoutId,
    p_error: null,
  })
  if (markError) throw markError

  return { ok: true, payoutId, payoutStatus: "paid" }
}

/** Fire-and-forget or await call into create-provider-payout (same project). */
export async function invokeProviderPayout(bookingId: string, awaitResult = false): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL")?.trim()
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!base || !key || !bookingId) return

  const run = fetch(`${base}/functions/v1/create-provider-payout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ booking_id: bookingId }),
  }).catch((err) => {
    console.error("invokeProviderPayout failed", bookingId, err)
  })

  if (awaitResult) await run
}
