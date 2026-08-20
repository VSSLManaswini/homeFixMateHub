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

- `SITE_URL` — public app URL for Payment Link callback redirect (e.g. `https://your-app.vercel.app`)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (usually auto-injected)

## Frontend (Vercel / `.env.local`)

```bash
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
```

Payment Links work without the publishable key (Edge Functions use server secrets). Keep
`VITE_RAZORPAY_KEY_ID` set for Checkout fallback.

**Never** set this on production:

```bash
VITE_MOCK_PAYMENTS=true
```

If `VITE_MOCK_PAYMENTS=true`, Pay buttons call `pay_booking_*` RPCs and mark paid instantly with no Razorpay link.

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

## Customer flow

1. Provider accepts booking → customer taps **Pay deposit (10%) — opens Razorpay link**.
2. App creates a Payment Link, opens it, and shows **Copy / Open payment link**.
3. Customer pays on Razorpay → webhook marks deposit paid → contacts unlock.
4. After both confirm completion → same for remaining 90%.
