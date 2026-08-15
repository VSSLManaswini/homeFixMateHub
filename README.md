# HomeFix

All-in-one home & local services landing page with Supabase auth and provider storage.

## Run locally

```bash
npm install
cp .env.example .env.local
npm.cmd run dev
```

Fill `.env.local` with your Supabase project URL and anon key (see below).

## Supabase setup

1. Create a free project at [https://supabase.com](https://supabase.com)
2. Open **Project Settings → API** and copy:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` `public` key → `VITE_SUPABASE_ANON_KEY`
3. Open **SQL Editor**, paste `supabase/schema.sql`, and run it  
   (If you already ran the older providers-only schema, run `supabase/bookings.sql` instead.)  
   If receivers cannot see listings, also run `supabase/fix-provider-visibility.sql`.  
   If the providers table stays empty, run `supabase/fix-empty-providers.sql`.
4. **Authentication → Providers → Email**: turn **OFF** “Confirm email” while developing  
   (Required — otherwise signup has no session and provider profiles will not save.)
5. Restart the dev server

### Google (Gmail) sign-in

1. Supabase → **Authentication → Providers → Google** → Enable
2. Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
3. Authorized redirect URI (from Supabase Google provider screen), typically:
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
4. Paste Client ID + Client Secret into Supabase Google settings → Save
5. Supabase → **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173` (local) or your Vercel URL
   - Redirect URLs: add `http://localhost:5173/**` and `https://home-fix-mate-hub.vercel.app/**`

### Phone OTP (Twilio)

HomeFix already has the Phone OTP UI. You must enable Phone in Supabase and connect Twilio (or another SMS provider) so codes can be delivered.

#### 1. Create a Twilio account
1. Go to [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio) and sign up
2. Verify your email and phone
3. Open the [Twilio Console](https://console.twilio.com)

#### 2. Get Account SID and Auth Token
On the Twilio Console home page, copy:
- **Account SID** (starts with `AC…`)
- **Auth Token** (click to reveal)

#### 3. Create a Messaging Service (for Twilio SMS)
1. Twilio Console → **Messaging** → **Services** → **Create Messaging Service**
2. Name it `HomeFix OTP` → create
3. **Add Senders** → **Add a Sender** → **Phone Number**
4. Buy/select a number that can send SMS (trial accounts can send only to verified numbers)
5. Finish setup, then copy the **Messaging Service SID** (starts with `MG…`)

#### 3b. Or use Twilio Verify (alternative)
1. Twilio Console → **Verify** → **Services** → **Create**
2. Name it `HomeFix Verify`
3. Copy the **Service SID** (starts with `VA…`)
4. In Supabase Phone settings, choose **Twilio Verify** and paste this SID instead of Messaging Service SID

#### 4. Enable Phone in Supabase
1. Supabase → **Authentication → Providers → Phone**
2. Enable **Phone**
3. Choose provider: **Twilio** (or **Twilio Verify**)
4. Paste:
   - Account SID
   - Auth Token
   - Message Service SID (`MG…`) **or** Verify Service SID (`VA…`)
5. Optional: customize OTP expiry / SMS template
6. **Save**

#### 5. Trial account tip (Twilio)
If Twilio is on trial, verify the destination phone first:
**Phone Numbers → Manage → Verified Caller IDs** → add your mobile.

#### 6. Test in HomeFix
1. Restart `npm.cmd run dev` if needed
2. **Get started → Service provider → Phone OTP**
3. Enter mobile as `+91XXXXXXXXXX` (or 10-digit Indian number)
4. **Send OTP** → enter the 6-digit SMS code → **Verify OTP**

India note: SMS may require TRAI DLT compliance for production traffic. Use Twilio trial + verified numbers while developing.

Without Google/Phone providers enabled in Supabase, those buttons will show an error from Supabase — email/password still works.

## Browse filters (step 2)

Receivers can search and filter providers by service, max price, min rating, and sort order in the Service receiver panel.

If ratings are missing in the database, run `supabase/add-provider-rating.sql` once.

## Provider dashboard (step 3)

Signed-in providers get a dashboard with Overview, Listings, Incoming bookings, Add listing, and estimated earnings.

## Reviews & completion

- Providers can **Mark completed** on accepted bookings
- Receivers can leave a **rating + comment** on completed jobs
- Provider star ratings update from reviews (run `supabase/reviews.sql`)

Add the same two env vars in **Vercel → Project → Settings → Environment Variables**, then redeploy.

Also add your Vercel URL to Supabase redirect URLs (see Google section above).

Live site: https://home-fix-mate-hub.vercel.app/

## Scripts

- `npm run dev` / `npm.cmd run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview the production build

## Key files

- Auth UI (Google / phone OTP / email): `src/components/AuthPanel.tsx`
- Booking flow (receiver + provider): `src/components/BookingPanel.tsx`
- Auth helpers: `src/hooks/useAuth.ts`
- Provider onboarding: `src/components/RoleGate.tsx`
- Bookings API: `src/data/bookings.ts`
- Supabase client: `src/lib/supabase.ts`
- DB schema: `supabase/schema.sql` / `supabase/bookings.sql`
