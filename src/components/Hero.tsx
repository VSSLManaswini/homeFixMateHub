type HeroProps = {
  onGetStarted: () => void
}

export function Hero({ onGetStarted }: HeroProps) {
  return (
    <section className="hero" id="top" aria-label="HomeFix introduction">
      <div className="hero-media" role="img" aria-label="Modern home interior" />
      <div className="hero-content">
        <p className="hero-brand">HomeFix</p>
        <h1>Trusted local services, booked in minutes.</h1>
        <p className="lede">
          Find, compare, and book verified providers for every home need — from plumbing to personal care.
        </p>
        <div className="hero-ctas">
          <button type="button" className="btn btn-primary" onClick={onGetStarted}>
            Get started
          </button>
          <a className="btn btn-ghost" href="#categories">
            Explore categories
          </a>
        </div>
      </div>
    </section>
  )
}
