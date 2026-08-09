import { useMemo, useState, type FormEvent } from 'react'
import { serviceOptions } from '../data/categories'
import {
  addProvider,
  loadProviders,
  totalBookings,
  type Provider,
} from '../data/providers'

export type Role = 'provider' | 'receiver' | null

type RoleGateProps = {
  role: Role
  onRoleChange: (role: Role) => void
}

type FormState = {
  name: string
  service: string
  quote: string
  contact: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

const emptyForm: FormState = {
  name: '',
  service: serviceOptions[0] ?? '',
  quote: '',
  contact: '',
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.name.trim()) errors.name = 'Enter your full name'
  if (!form.service.trim()) errors.service = 'Select a service'
  if (!form.quote.trim()) errors.quote = 'Add your starting quote'
  else if (Number.isNaN(Number(form.quote)) || Number(form.quote) <= 0) {
    errors.quote = 'Enter a valid amount'
  }
  const phone = form.contact.replace(/\s+/g, '')
  if (!phone) errors.contact = 'Enter a contact number'
  else if (!/^\+?\d{10,15}$/.test(phone)) {
    errors.contact = 'Use a valid phone number'
  }
  return errors
}

export function RoleGate({ role, onRoleChange }: RoleGateProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [providers, setProviders] = useState<Provider[]>(() => loadProviders())
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const bookingTotal = useMemo(() => totalBookings(providers), [providers])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const provider = addProvider({
      name: form.name.trim(),
      service: form.service,
      quote: `₹${Number(form.quote).toLocaleString('en-IN')}`,
      contact: form.contact.trim(),
    })
    setProviders(loadProviders())
    setJustAdded(provider.id)
    setForm(emptyForm)
  }

  return (
    <section className="section role-section" id="get-started">
      <div className="container">
        <div className="section-head">
          <h2>How will you use HomeFix?</h2>
          <p>Choose your role to continue — book trusted help, or list your services for nearby customers.</p>
        </div>

        <div className="role-grid" role="group" aria-label="Choose your role">
          <button
            type="button"
            className={`role-card ${role === 'receiver' ? 'active' : ''}`}
            onClick={() => onRoleChange('receiver')}
            aria-pressed={role === 'receiver'}
          >
            <span className="role-kicker">I need help</span>
            <h3>Service receiver</h3>
            <p>Search by location, compare ratings and price, then book instantly or schedule for later.</p>
          </button>

          <button
            type="button"
            className={`role-card ${role === 'provider' ? 'active' : ''}`}
            onClick={() => onRoleChange('provider')}
            aria-pressed={role === 'provider'}
          >
            <span className="role-kicker">I offer services</span>
            <h3>Service provider</h3>
            <p>Share your details, set your quote, and start accepting bookings from verified customers.</p>
          </button>
        </div>

        {role === 'receiver' && (
          <div className="receiver-panel">
            <h3 className="panel-title">Find a provider near you</h3>
            <p className="panel-sub">
              Browse categories, filter by price and rating, then book with secure UPI, card, wallet, or cash.
            </p>
            <div className="form-actions">
              <a className="btn btn-primary" href="#categories">
                Browse categories
              </a>
              <a className="btn btn-secondary" href="#how-it-works">
                See how booking works
              </a>
            </div>
            <div className="stats-row">
              <div className="stat">
                <strong>19+</strong>
                <span>Service categories</span>
              </div>
              <div className="stat">
                <strong>Live</strong>
                <span>Arrival tracking</span>
              </div>
              <div className="stat">
                <strong>Secure</strong>
                <span>In-app pay & chat</span>
              </div>
            </div>
          </div>
        )}

        {role === 'provider' && (
          <div className="provider-panel">
            <h3 className="panel-title">List your service</h3>
            <p className="panel-sub">
              Add your name, service, quote, and contact. New providers start with zero bookings — your total updates as jobs complete.
            </p>

            <form onSubmit={handleSubmit} noValidate>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="provider-name">Full name</label>
                  <input
                    id="provider-name"
                    name="name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Priya Sharma"
                  />
                  {errors.name && <span className="field-error">{errors.name}</span>}
                </div>

                <div className="field">
                  <label htmlFor="provider-service">Service you provide</label>
                  <select
                    id="provider-service"
                    name="service"
                    value={form.service}
                    onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                  >
                    {serviceOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {errors.service && <span className="field-error">{errors.service}</span>}
                </div>

                <div className="field">
                  <label htmlFor="provider-quote">Starting quote (₹)</label>
                  <input
                    id="provider-quote"
                    name="quote"
                    inputMode="numeric"
                    value={form.quote}
                    onChange={(e) => setForm((f) => ({ ...f, quote: e.target.value }))}
                    placeholder="e.g. 499"
                  />
                  {errors.quote && <span className="field-error">{errors.quote}</span>}
                </div>

                <div className="field">
                  <label htmlFor="provider-contact">Contact number</label>
                  <input
                    id="provider-contact"
                    name="contact"
                    autoComplete="tel"
                    value={form.contact}
                    onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                    placeholder="e.g. +919876543210"
                  />
                  {errors.contact && <span className="field-error">{errors.contact}</span>}
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  Save provider profile
                </button>
                <p className="form-note">KYC verification and payouts come next in onboarding.</p>
              </div>
            </form>

            {justAdded && (
              <div className="success-banner" role="status">
                Profile saved. You can keep adding providers or switch roles anytime.
              </div>
            )}

            <div className="stats-row">
              <div className="stat">
                <strong>{providers.length}</strong>
                <span>Providers listed</span>
              </div>
              <div className="stat">
                <strong>{bookingTotal}</strong>
                <span>Total bookings done</span>
              </div>
              <div className="stat">
                <strong>0</strong>
                <span>Pending KYC</span>
              </div>
            </div>

            {providers.length > 0 && (
              <div className="provider-list" aria-live="polite">
                {providers.map((provider) => (
                  <article key={provider.id} className="provider-item">
                    <div>
                      <h4>{provider.name}</h4>
                      <p>
                        {provider.service} · from {provider.quote} · {provider.contact}
                      </p>
                    </div>
                    <span className="bookings-pill">
                      {provider.bookings} booking{provider.bookings === 1 ? '' : 's'}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
