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
supabase functions deploy create-provider-payout
```

## SQL

Run `supabase/razorpay-payments.sql` in the SQL Editor (adds payment link columns +
`apply_razorpay_booking_payment`).

Also run `supabase/revoke-client-pay-rpcs.sql` so browsers cannot call
`pay_booking_deposit` / `pay_booking_remaining` directly.

Run `supabase/provider-payouts.sql` for real provider payouts (payout columns,
`payout_status=pending` after remaining payment, admin list/retry RPCs).

## Provider payouts (RazorpayX)

After the customer pays the remaining 90%, Edge Functions call
`create-provider-payout`, which creates a RazorpayX **Contact → Fund Account → Payout**
for `remaining_amount` to the provider’s saved UPI or bank profile.

### Extra secret

```bash
supabase secrets set RAZORPAY_ACCOUNT_NUMBER=YOUR_RAZORPAYX_ACCOUNT_NUMBER --project-ref uesntwsunwuvyhgprbpv
```

- Use your **RazorpayX Current Account** number, or the **Lite / customer identifier**
  shown in RazorpayX → Account & Settings when paying from Lite balance.
- Without this secret, payouts fail with a clear `payout_error` and stay retryable.

### Dashboard prerequisites (Live)

1. Toggle **Live** in [Razorpay Dashboard](https://dashboard.razorpay.com/).
2. Activate **RazorpayX / Payouts** (Business banking / X). Payment collection keys alone
   are not enough — Contacts / Fund Accounts / Payouts APIs require Payouts product access.
3. Complete any RazorpayX KYC and fund the payout account (or enable queue-on-low-balance).
4. Allowlist Edge Function egress IPs if RazorpayX requires IP allowlisting for payouts
   (see RazorpayX docs). Supabase Edge IPs change; prefer dashboard guidance for serverless.
5. Redeploy `create-provider-payout`, `verify-razorpay-payment`, and `razorpay-webhook`
   after setting `RAZORPAY_ACCOUNT_NUMBER`.

### Behaviour

| Step | Result |
|------|--------|
| Remaining payment applied | `payment_status=fully_paid`, `payout_status=pending` (not `paid`) |
| Provider missing UPI/bank | stays `pending`, `payout_error` explains missing profile |
| RazorpayX success | `payout_status=paid`, `razorpay_payout_id` set |
| API / product error | `payout_status=failed`, message stored; Admin → Payouts → Retry |

Admin UI: **Admin → Payouts** lists pending/failed/paid rows.

### Path B — individual accounts (no RazorpayX)

RazorpayX / API Payouts requires a **registered business**. On an individual merchant account, keep collecting 10%/90% via Payment Links, then pay providers yourself:

1. Provider saves UPI or bank under **Payout**.
2. Customer pays remaining 90% → booking is `fully_paid`, payout `pending`.
3. Admin → **Payouts** → copy **Pay to** destination → send that amount from your bank/UPI.
4. Tap **Mark paid (manual)** (optional UTR/note). Do **not** rely on **Retry RazorpayX** until X is approved.

### Test with a small remaining payment

1. Provider saves complete UPI (or bank) under **Payout**.
2. Complete a booking (accept → deposit → both confirm → remaining).
3. Pay a small remaining amount (Live: real UPI; keep amounts low for smoke tests).
4. Confirm booking flips to `fully_paid` / `payout_status=pending` then `paid`
   (or `failed` with a readable error if X is not enabled).
5. If automatic X payout failed, use **Mark paid (manual)** after you transferred the money, or **Retry RazorpayX** only when X is enabled.

## Customer flow

1. Provider accepts booking → customer taps **Pay deposit (10%) — opens Razorpay link**.
2. App creates a Payment Link, opens it, and shows **Copy / Open payment link**.
3. Customer pays on Razorpay → redirect back to the app with signed query params →
   `verify-razorpay-payment` confirms the link (webhook is a backup) → contacts unlock.
4. After both confirm completion → same for remaining 90%.

## If Razorpay / PhonePe / GPay shows “something went wrong”

That text is from **Razorpay or the UPI app**, not HomeFix. HomeFix only creates the Payment Link;
capture still happens on Razorpay.

### Most common cause: Test keys + real PhonePe/GPay

If Edge secrets / `VITE_RAZORPAY_KEY_ID` start with **`rzp_test_`**:

- Opening **real PhonePe / GPay / BHIM** against a Test merchant almost always fails
  (“something went wrong”) and **no money moves**.
- That is expected Razorpay Test behaviour — not a HomeFix booking bug.

**Test path (no real money):**

1. Keep `rzp_test_` Key ID + Secret in Edge secrets and matching `VITE_RAZORPAY_KEY_ID`.
2. On the Razorpay hosted page, choose **UPI** → enter test VPA **`success@razorpay`**
   (see [test card / UPI details](https://razorpay.com/docs/payments/payments/test-card-upi-details/)).
3. Or use Razorpay test cards from the same docs.
4. Confirm booking flips to `deposit_paid` / `fully_paid` only after verify/webhook
   (UI shows “Checking payment…” first).

**Live path (real PhonePe / GPay):**

1. Complete Razorpay **business KYC** and activate **UPI** under
   Account & Settings → Payment Methods (Live).
2. Switch Dashboard to **Live**, create Live Key ID + Secret.
3. Update secrets (and Vercel / `.env.local`):

   ```bash
   supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
   supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxx
   ```

   Set `VITE_RAZORPAY_KEY_ID=rzp_live_xxxxxxxx` and redeploy the frontend.
4. Point the webhook at the same URL but under the **Live** webhook settings;
   refresh `RAZORPAY_WEBHOOK_SECRET`.
5. Ensure `SITE_URL` / browser origin is **https** (production), not a broken preview.
6. Redeploy functions after secret changes if needed, then pay with real UPI apps.

### Other checks

1. Dashboard mode matches keys (**Test** vs **Live**).
2. Amount ≥ ₹1.00 (100 paise). Payment Links enable `upi`, `card`, `netbanking` explicitly.
3. Do **not** use `upi_link: true` in Test (Razorpay rejects UPI-only links in Test mode).
4. Webhook includes **`payment.captured`** and **`payment_link.paid`**, and
   `RAZORPAY_WEBHOOK_SECRET` matches the dashboard secret for that mode.

## Switch Test to Live checklist

### Automated / CLI

1. Confirm Live Key ID + Key Secret exist locally (gitignored `rzp-key.csv` / `IMPData.txt`). Key ID must start with `rzp_live_`.
2. Set Edge secrets (do not echo values):
   `supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... SITE_URL=https://home-fix-mate-hub.vercel.app --project-ref uesntwsunwuvyhgprbpv`
3. Set frontend `VITE_RAZORPAY_KEY_ID` to the Live Key ID in `.env.local` and on Vercel Production for **both** `vadali/home-fix-mate-hub` and `vadali/homefix`.
4. Redeploy Razorpay functions (`create-razorpay-order`, `create-razorpay-payment-link`, `verify-razorpay-payment`, `razorpay-webhook`).
5. Redeploy both Vercel projects to Production so the client bundle embeds `rzp_live_...`.

### Razorpay Dashboard (Live mode) — manual

1. Open https://dashboard.razorpay.com/ and toggle **Live** (top bar; not Test).
2. Complete **KYC / activation** if Live payments are blocked (Account & Settings / Activation).
3. **API Keys**: Account & Settings -> API Keys -> Live keys (`rzp_live_...`).
4. Enable **UPI** (and other methods) under Live payment methods / Payment Products.
5. **Live webhook** (Test webhook secret will not validate Live events):
   - Account & Settings -> Webhooks (ensure Live mode)
   - URL: `https://uesntwsunwuvyhgprbpv.supabase.co/functions/v1/razorpay-webhook`
   - Events: `payment.captured`, `payment_link.paid`
   - Copy the new Live webhook secret, then:
     `supabase secrets set RAZORPAY_WEBHOOK_SECRET=... --project-ref uesntwsunwuvyhgprbpv`
6. Smoke-test a small real payment on https://home-fix-mate-hub.vercel.app.

### Verify without printing secrets

- `VITE_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_ID` start with `rzp_live_` (logging first 12 chars is OK).
- `supabase secrets list` shows recent `updated_at` for `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `SITE_URL`, and (after you paste it) `RAZORPAY_WEBHOOK_SECRET`.