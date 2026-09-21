# Booking email (optional, unused for payments)

HomeFix does **not** send email for purchases or payments.
Deposit and remaining pay use **in-app notifications** (and optional browser alerts).

The `send-booking-email` function and Resend are **not required**.
In-app **Email draft** buttons remain a manual copy/mailto helper only.

Payment alerts:

- Customer: new booking accepted (existing), deposit recorded, payment complete
- Provider: new request (existing), 10% deposit paid / contacts unlocked, 90% received / payout pending

Run `supabase/notify-on-payment.sql` if those payment notifications are not in the database yet.
