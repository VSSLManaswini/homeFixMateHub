export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head">
          <h2>Built for customers and providers</h2>
          <p>Everything needed to discover, book, deliver, and get paid — with admin tools that scale categories and commissions.</p>
        </div>

        <div className="feature-bands">
          <article className="feature-band">
            <div>
              <h3>For households</h3>
              <p>Register with phone, email, Google, or Apple. Discover by location, then filter by service, price, rating, availability, and distance.</p>
              <ul className="feature-list">
                <li>Provider profiles with photos, experience, certifications, pricing, and reviews</li>
                <li>Instant or scheduled booking, live arrival tracking, in-app chat and calling</li>
                <li>Secure payments via UPI, cards, wallets, or cash — plus history, invoices, and favorites</li>
                <li>Offers, coupons, referrals, and multi-language support</li>
              </ul>
            </div>
          </article>

          <article className="feature-band">
            <div>
              <h3>For verified providers</h3>
              <p>Complete KYC, manage services and availability, accept jobs, navigate routes, and track earnings with clear payouts.</p>
              <ul className="feature-list">
                <li>Service, pricing, and calendar controls in one dashboard</li>
                <li>Accept or reject bookings with customer messaging built in</li>
                <li>Ratings, feedback, and withdrawal management</li>
              </ul>
            </div>
          </article>

          <article className="feature-band">
            <div>
              <h3>Admin control plane</h3>
              <p>Approve providers, add categories, set commissions, resolve disputes, and run campaigns without shipping a new app.</p>
              <ul className="feature-list">
                <li>User and provider management with verification workflows</li>
                <li>Analytics, promotions, and push notifications</li>
                <li>Extensible categories for any future local service</li>
              </ul>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
