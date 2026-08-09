type FooterProps = {
  onGetStarted: () => void
}

export function FooterCta({ onGetStarted }: FooterProps) {
  return (
    <section className="cta-strip">
      <div className="container">
        <div className="inner">
          <div>
            <h2>Make HomeFix your default for home help</h2>
            <p>
              One platform for household, maintenance, repair, and personal services — designed to grow with millions of users and providers.
            </p>
          </div>
          <div className="hero-ctas">
            <button type="button" className="btn btn-ghost" onClick={onGetStarted}>
              Get started
            </button>
            <a className="btn btn-ghost" href="#features">
              View platform features
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container inner">
        <p>© {new Date().getFullYear()} HomeFix. All-in-one home & local services.</p>
        <p>Dark & light modes · Mobile & web ready · Categories extend via admin</p>
      </div>
    </footer>
  )
}
