import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { serviceOptions } from '../data/categories'
import {
  createProvider,
  fetchProviders,
  totalBookings,
  type Provider,
} from '../data/providers'
import { AuthPanel } from './AuthPanel'
import { ProviderIncomingBookings, ReceiverBookingPanel } from './BookingPanel'
import { useAuth } from '../hooks/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

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
  const {
    user,
    loading: authLoading,
    signIn,
    signUp,
    signInWithGoogle,
    sendPhoneOtp,
    verifyPhoneOtp,
    signOut,
    configured,
  } = useAuth()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [providers, setProviders] = useState<Provider[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const authActions = {
    signIn,
    signUp,
    signInWithGoogle,
    sendPhoneOtp,
    verifyPhoneOtp,
    signOut,
  }

  const bookingTotal = useMemo(() => totalBookings(providers), [providers])
  const myProviderCount = useMemo(
    () => (user ? providers.filter((p) => p.userId === user.id).length : 0),
    [providers, user],
  )

  const refreshProviders = async () => {
    if (!configured) return
    setListLoading(true)
    setListError(null)
    try {
      const rows = await fetchProviders()
      setProviders(rows)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load providers')
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => {
    void refreshProviders()
  }, [configured, role])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitError(null)
    setJustAdded(null)

    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    if (!user) {
      setSubmitError('Sign in before saving a provider profile.')
      return
    }

    setSubmitting(true)
    try {
      const provider = await createProvider({
        name: form.name.trim(),
        service: form.service,
        quote: `₹${Number(form.quote).toLocaleString('en-IN')}`,
        contact: form.contact.trim(),
      })
      await refreshProviders()
      setJustAdded(provider.id)
      setForm(emptyForm)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save provider')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="section role-section" id="get-started">
      <div className="container">
        <div className="section-head">
          <h2>How will you use HomeFix?</h2>
          <p>Choose your role to continue — book trusted help, or list your services for nearby customers.</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="setup-banner" role="status">
            Supabase is not configured yet. Add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then run the SQL in{' '}
            <code>supabase/schema.sql</code> (or <code>supabase/bookings.sql</code> if providers already exist).
          </div>
        )}

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
            <div className="stats-row">
              <div className="stat">
                <strong>{providers.length}</strong>
                <span>Providers online</span>
              </div>
              <div className="stat">
                <strong>{bookingTotal}</strong>
                <span>Bookings completed</span>
              </div>
              <div className="stat">
                <strong>19+</strong>
                <span>Service categories</span>
              </div>
            </div>

            {listLoading && <p className="form-note">Loading providers…</p>}
            {listError && <p className="field-error">{listError}</p>}

            <ReceiverBookingPanel
              user={user}
              authLoading={authLoading}
              configured={configured}
              providers={providers}
              auth={authActions}
              onProvidersRefresh={refreshProviders}
            />
          </div>
        )}

        {role === 'provider' && (
          <div className="provider-panel">
            <h3 className="panel-title">List your service</h3>
            <p className="panel-sub">
              Sign in, then add your name, service, quote, and contact. Accepting jobs increases your bookings count.
            </p>

            {authLoading ? (
              <p className="form-note">Checking your session…</p>
            ) : !configured ? (
              <div className="setup-banner" role="status">
                <strong>Email signup needs real Supabase keys.</strong>
                <ol className="setup-steps">
                  <li>
                    Open your project at{' '}
                    <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
                      supabase.com/dashboard
                    </a>
                  </li>
                  <li>
                    Go to <strong>Project Settings → API</strong> and copy the Project URL and <code>anon</code> public
                    key
                  </li>
                  <li>
                    Put them in <code>.env.local</code>, then restart <code>npm.cmd run dev</code>
                  </li>
                  <li>
                    Run <code>supabase/schema.sql</code> (or <code>supabase/bookings.sql</code> if upgrading)
                  </li>
                </ol>
              </div>
            ) : !user ? (
              <AuthPanel {...authActions} />
            ) : (
              <>
                <div className="account-bar">
                  <p>
                    Signed in as <strong>{user.email ?? user.phone ?? 'provider'}</strong>
                  </p>
                  <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>

                <p className="form-note">
                  Connected to{' '}
                  <code>{(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace('https://', '') ?? 'Supabase'}</code>
                  . A successful save must show up in Table Editor → <code>providers</code>
                  {supabase ? '' : ' (Supabase client missing)'}.
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

                  {submitError && <p className="field-error auth-message">{submitError}</p>}

                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                      {submitting ? 'Saving…' : 'Save provider profile'}
                    </button>
                    <p className="form-note">Saved to Supabase for all users to discover.</p>
                  </div>
                </form>

                {justAdded && (
                  <div className="success-banner" role="status">
                    Profile saved to the cloud. Receivers can now book you.
                  </div>
                )}

                <ProviderIncomingBookings user={user} onProvidersRefresh={refreshProviders} />
              </>
            )}

            <div className="stats-row">
              <div className="stat">
                <strong>{myProviderCount || providers.length}</strong>
                <span>{user ? 'Your listings' : 'Providers listed'}</span>
              </div>
              <div className="stat">
                <strong>{bookingTotal}</strong>
                <span>Total bookings done</span>
              </div>
              <div className="stat">
                <strong>{user ? 'Live' : 'Auth'}</strong>
                <span>{user ? 'Cloud synced' : 'Sign in to publish'}</span>
              </div>
            </div>

            {listLoading && <p className="form-note">Loading providers…</p>}
            {listError && <p className="field-error">{listError}</p>}
          </div>
        )}
      </div>
    </section>
  )
}
