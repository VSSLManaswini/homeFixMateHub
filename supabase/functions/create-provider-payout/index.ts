import { jsonResponse, optionsResponse } from "../_shared/cors.ts"
import { processBookingPayout } from "../_shared/providerPayout.ts"
import { createUserClient, requireUserId } from "../_shared/supabase.ts"

function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!serviceKey) return false
  const auth = req.headers.get("Authorization")?.trim() ?? ""
  return auth === `Bearer ${serviceKey}`
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse()
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  try {
    const serviceCall = isServiceRoleRequest(req)
    let authHeader: string | null = null

    if (!serviceCall) {
      const user = await requireUserId(req)
      authHeader = user.authHeader
      const userClient = createUserClient(authHeader)
      const { data: isAdmin, error: adminError } = await userClient.rpc("is_app_admin")
      if (adminError) throw adminError
      if (!isAdmin) {
        return jsonResponse({ error: "Only admins can retry provider payouts" }, 403)
      }
    }

    const body = await req.json().catch(() => ({}))
    const bookingId = typeof body.booking_id === "string" ? body.booking_id.trim() : ""
    if (!bookingId) return jsonResponse({ error: "booking_id is required" }, 400)

    // Admin retry: re-queue failed → pending via RPC (is_app_admin gated).
    if (!serviceCall && authHeader) {
      const userClient = createUserClient(authHeader)
      const { error: queueError } = await userClient.rpc("queue_booking_payout", {
        p_booking_id: bookingId,
      })
      if (queueError) {
        return jsonResponse({ error: queueError.message }, 400)
      }
    }

    const result = await processBookingPayout(bookingId)
    // pending with profile error is a soft failure (200); API / config failures → 502
    const httpStatus =
      result.ok || result.payoutStatus === "pending" ? 200 : result.error ? 502 : 200
    return jsonResponse(result, httpStatus)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create provider payout"
    const status =
      message === "Unauthorized" || message === "Missing authorization"
        ? 401
        : message.includes("Only admins")
          ? 403
          : message.includes("not configured")
            ? 500
            : 400
    return jsonResponse({ error: message }, status)
  }
})
