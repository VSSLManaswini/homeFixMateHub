# Transactional booking email (Resend)

HomeFix sends status emails via Edge Function `send-booking-email`.
In-app **Email draft** buttons still work as a fallback.

## 1. Resend

1. Create an account at https://resend.com
2. Create an API key
3. For tests you can send **to your own inbox** using `from: HomeFix <onboarding@resend.dev>`
4. For production, verify a domain and use e.g. `HomeFix <bookings@mail.yourdomain.com>`

## 2. Supabase secrets

```powershell
cd C:\Users\DELL\Projects\homefix
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set EMAIL_FROM="HomeFix <onboarding@resend.dev>"
```

Do **not** put Resend keys in `VITE_` env vars.

## 3. SQL

Run `supabase/booking-emails.sql` in the SQL Editor (creates `booking_email_log`).

## 4. Deploy

```powershell
supabase functions deploy send-booking-email --no-verify-jwt
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook --no-verify-jwt
```

## 5. When emails fire

| Event | Trigger |
|--------|---------|
| `booking_requested` | Customer creates a booking |
| `booking_accepted` | Provider accepts |
| `booking_rejected` / `cancelled` | Status update |
| `deposit_paid` | Razorpay verify / webhook |
| `job_completed` | Both confirm complete |
| `fully_paid` | Razorpay remaining pay |

Sends to **customer and provider** when an email exists on their Auth user or listing/contact string. Phone-only accounts are skipped (use the in-app draft). Duplicate sends are blocked by `booking_email_log`.

## 6. Test

1. Use accounts that signed up with **email** (Google/email), not phone-only.
2. Create a booking → check Resend **Logs** and inboxes.
3. If `RESEND_API_KEY` is missing, the function returns `error` on each recipient and the booking still succeeds.
