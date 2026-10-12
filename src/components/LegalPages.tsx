import { useEffect, useState } from 'react'

export type LegalDoc = 'terms' | 'privacy' | 'refunds'

const titles: Record<LegalDoc, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy',
  refunds: 'Payments & refunds',
}

function LegalBody({ doc }: { doc: LegalDoc }) {
  if (doc === 'privacy') {
    return (
      <>
        <p>
          HomeFix stores your account (email, Google, or phone if SMS OTP is enabled), listings, bookings, KYC ID
          details for admin review, payout UPI/bank details, and payment status from Razorpay.
        </p>
        <p>
          Provider phone and job address are shown to the other party only after the customer pays the 10% deposit to
          HomeFix. KYC numbers are never shown on public listings.
        </p>
        <p>We do not sell your data. Hosting is on Vercel and Supabase; card/UPI data is handled by Razorpay, not HomeFix.</p>
      </>
    )
  }
  if (doc === 'refunds') {
    return (
      <>
        <p>
          Customers pay HomeFix in two steps: 10% after the provider accepts, then 90% after both sides confirm the job.
          HomeFix keeps the 10%. The 90% is owed to the provider.
        </p>
        <p>
          Automatic bank payouts (RazorpayX) are not available on an individual Razorpay account. Admins record those
          transfers manually (Path B) after checking UPI/bank details on the provider profile.
        </p>
        <p>
          Deposit refunds after a paid cancel are requested in the app. An admin refunds the Razorpay payment in the
          Razorpay Dashboard, then marks the request handled. Refunds are not instant.
        </p>
      </>
    )
  }
  return (
    <>
      <p>
        HomeFix is a marketplace: customers book independent providers. HomeFix is not the employer of providers and
        does not guarantee workmanship beyond the booking, KYC, and payment flow described in the app.
      </p>
      <p>
        Sign in with email or Google. Phone OTP is in the product but SMS delivery needs a paid SMS provider (Twilio or
        similar) before it works in production.
      </p>
      <p>
        Do not use HomeFix for illegal work. Listings may be deactivated by admin. National ID is required before a
        listing can be marked verified.
      </p>
    </>
  )
}

export function LegalPages() {
  const [doc, setDoc] = useState<LegalDoc | null>(null)

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.replace('#', '')
      if (hash === 'terms' || hash === 'privacy' || hash === 'refunds') setDoc(hash)
      else setDoc(null)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  if (!doc) return null

  return (
    <div
      className="legal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-title"
      onClick={() => {
        window.location.hash = 'top'
      }}
    >
      <article className="legal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="booking-history-head">
          <h2 id="legal-title">{titles[doc]}</h2>
          <a className="btn btn-secondary btn-small" href="#top">
            Close
          </a>
        </div>
        <LegalBody doc={doc} />
      </article>
    </div>
  )
}
