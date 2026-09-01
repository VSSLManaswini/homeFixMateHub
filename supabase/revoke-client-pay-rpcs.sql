-- Prevent authenticated clients from marking bookings paid without Razorpay.
-- Payments must go through apply_razorpay_booking_payment (service_role only)
-- via verify-razorpay-payment or razorpay-webhook after capture.

revoke all on function public.pay_booking_deposit(uuid) from public;
revoke all on function public.pay_booking_deposit(uuid) from authenticated;
revoke all on function public.pay_booking_remaining(uuid) from public;
revoke all on function public.pay_booking_remaining(uuid) from authenticated;

-- Keep service_role able to call them if needed for admin tooling / migrations.
grant execute on function public.pay_booking_deposit(uuid) to service_role;
grant execute on function public.pay_booking_remaining(uuid) to service_role;
