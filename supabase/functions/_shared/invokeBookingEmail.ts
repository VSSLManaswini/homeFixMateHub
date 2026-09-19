export async function invokeBookingEmail(bookingId: string, event?: string): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL")?.trim()
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!base || !key || !bookingId) return

  const body: Record<string, string> = { booking_id: bookingId }
  if (event) body.event = event

  void fetch(`${base}/functions/v1/send-booking-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.error("invokeBookingEmail failed", bookingId, err)
  })
}
