# Razorpay setup for HomeFix

Project ref: `uesntwsunwuvyhgprbpv`

## Required Edge Function secrets

Do **not** put `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` in any `VITE_` env var.

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxx
supabase secrets set RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxx
```

Optional:

- `SITE_URL` — fallback public app URL for Payment Link callback (use the live app with Supabase env vars set, e.g. `https://home-fix-mate-hub.vercel.app`).
  Do **not** point this at a Vercel preview that is missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (e.g. an unconfigured `homefix-kappa` deploy).
  The app also sends the current browser origin as `return_url` when creating links, so this is a backup.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (usually auto-injected)

## Frontend (Vercel / `.env.local`)

```bash
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
```

Payment Links work without the publishable key (Edge Functions use server secrets). Keep
`VITE_RAZORPAY_KEY_ID` set for Checkout fallback.

**Never** set this (ignored by the app; mock pay path is permanently disabled):

```bash
VITE_MOCK_PAYMENTS=true
```

Pay buttons never call `pay_booking_*` RPCs. Only `apply_razorpay_booking_payment`
(via verify Edge Function or webhook after a real captured payment) updates
`payment_status`.

Run `supabase/revoke-client-pay-rpcs.sql` so authenticated clients cannot invoke
`pay_booking_deposit` / `pay_booking_remaining` even from an old frontend build.

## If Razorpay’s page says “Transaction Successful”

That exact text is from **Razorpay’s hosted checkout / payment-link UI**, not HomeFix.
Test mode can show their success screen after a simulated pay (e.g. `success@razorpay`).
HomeFix must still show the booking as unpaid until verify/webhook marks
`deposit_paid` / `fully_paid`. After return, the app shows **Checking payment…** and
only a green confirmation when the booking row updates from the server.

## Webhook URL

In Razorpay Dashboard → Settings → Webhooks → Add:

```
https://uesntwsunwuvyhgprbpv.supabase.co/functions/v1/razorpay-webhook
```

- Active events: `payment.captured` and `payment_link.paid`
- Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`

## Deploy functions

```bash
supabase link --project-ref uesntwsunwuvyhgprbpv
supabase functions deploy create-razorpay-payment-link
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook
```

## SQL

Run `supabase/razorpay-payments.sql` in the SQL Editor (adds payment link columns +
`apply_razorpay_booking_payment`).

Also run `supabase/revoke-client-pay-rpcs.sql` so browsers cannot call
`pay_booking_deposit` / `pay_booking_remaining` directly.

## Customer flow

1. Provider accepts booking → customer taps **Pay deposit (10%) — opens Razorpay link**.
2. App creates a Payment Link, opens it, and shows **Copy / Open payment link**.
3. Customer pays on Razorpay → redirect back to the app with signed query params →
   `verify-razorpay-payment` confirms the link (webhook is a backup) → contacts unlock.
4. After both confirm completion → same for remaining 90%.

## If Razorpay shows “payment could not be completed”

That exact text is from **Razorpay’s hosted page**, not HomeFix UI. Check:

1. Razorpay Dashboard is in the same mode as your keys (**Test** vs **Live**).
2. Use [Razorpay test cards / UPI](https://razorpay.com/docs/payments/payments/test-card-upi-details/) in Test mode — real cards often fail.
3. Payment methods (UPI/Cards) enabled under Razorpay → Account & Settings → Payment Methods.
4. Webhook includes **`payment.captured`** and **`payment_link.paid`**, and `RAZORPAY_WEBHOOK_SECRET` matches the dashboard secret.
