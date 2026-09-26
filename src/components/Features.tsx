export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head">
          <h2>Built for customers and providers</h2>
          <p>
            Discover listings, book, pay HomeFix in two steps, and manage jobs from one dashboard — with admin tools for
            categories, KYC, and payouts.
          </p>
        </div>

        <div className="feature-bands">
          <article className="feature-band">
            <div>
              <h3>For households</h3>
              <p>
                Sign in with email, Google, or phone OTP. Browse by service, price, rating, availability, and verified
                listings, then book instant or scheduled jobs.
              </p>
              <ul className="feature-list">
                <li>Quotes, reviews, favorites, and a verified-provider filter</li>
                <li>10% deposit to unlock contacts, then 90% after both sides confirm the job</li>
                <li>UPI and cards via Razorpay, plus payment history and printable receipts</li>
                <li>In-app (and optional browser) alerts for booking and payment updates</li>
              </ul>
            </div>
          </article>

          <article className="feature-band">
            <div>
              <h3>For verified providers</h3>
              <p>
                Submit national ID for KYC, set availability, accept jobs, and save UPI or bank details for your 90%
                share.
              </p>
              <ul className="feature-list">
                <li>Listings, incoming bookings, and dual job-complete confirmation</li>
                <li>Earnings and payout status on the provider dashboard</li>
                <li>Ratings after the customer pays in full</li>
              </ul>
            </div>
          </article>

          <article className="feature-band">
            <div>
              <h3>Admin control plane</h3>
              <p>Verify KYC, activate or hide listings, manage categories, and record manual provider payouts.</p>
              <ul className="feature-list">
                <li>Provider verification and booking stats</li>
                <li>Platform 10% vs provider 90% pipeline on the Payouts tab</li>
                <li>Add service categories without shipping a new app</li>
              </ul>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
