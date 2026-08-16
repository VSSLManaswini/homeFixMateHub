import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  createProvider,
  fetchProviders,
  totalBookings,
  type Provider,
} from '../data/providers'
import { checkIsAppAdmin } from '../data/categories'
import { AuthPanel } from './AuthPanel'
import { AdminPanel } from './AdminPanel'
import { ReceiverBookingPanel } from './BookingPanel'
import { ProviderDashboard } from './ProviderDashboard'
import { useAuth } from '../hooks/useAuth'
import { useCategories } from '../hooks/useCategories'
import { isSupabaseConfigured } from '../lib/supabase'

export type Role = 'provider' | 'receiver' | 'admin' | null

type RoleGateProps = {
  role: Role
  onRoleChange: (role: Role) => void
}

type FormState = {
  name: string
  service: string
  quote: string
  contact: string
  preferredHours: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

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
    session,
    loading: authLoading,
    signIn,
    signUp,
    signInWithGoogle,
    sendPhoneOtp,
    verifyPhoneOtp,
    signOut,
    configured,
  } = useAuth()
  const { serviceOptions, activeCategories, refresh: refreshCategories } = useCategories()
  const [form, setForm] = useState<FormState>({
    name: '',
    service: '',
    quote: '',
    contact: '',
    preferredHours: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [providers, setProviders] = useState<Provider[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  const authActions = {
    signIn,
    signUp,
    signInWithGoogle,
    sendPhoneOtp,
    verifyPhoneOtp,
    signOut,
  }

  const bookingTotal = useMemo(() => totalBookings(providers), [providers])

  useEffect(() => {
    if (!form.service && serviceOptions[0]) {
      setForm((current) => ({ ...current, service: serviceOptions[0] }))
    }
  }, [serviceOptions, form.service])

  useEffect(() => {
    let active = true
    if (!user) {
      setIsAdmin(false)
      if (role === 'admin') onRoleChange(null)
      return
    }
    void checkIsAppAdmin().then((ok) => {
      if (!active) return
      setIsAdmin(ok)
      if (!ok && role === 'admin') onRoleChange(null)
    })
    return () => {
      active = false
    }
  }, [user?.id, role, onRoleChange])

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
        preferredHours: form.preferredHours.trim(),
        availabilityStatus: 'available',
      })
      await refreshProviders()
      setJustAdded(provider.id)
      setForm({
        name: '',
        service: serviceOptions[0] ?? '',
        quote: '',
        contact: '',
        preferredHours: '',
      })
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

          {user && isAdmin && (
            <button
              type="button"
              className={`role-card ${role === 'admin' ? 'active' : ''}`}
              onClick={() => onRoleChange('admin')}
              aria-pressed={role === 'admin'}
            >
              <span className="role-kicker">Platform</span>
              <h3>Admin</h3>
              <p>Manage service categories for HomeFix. Only visible to authorized admins.</p>
            </button>
          )}
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
                <strong>{activeCategories.length}</strong>
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
            <h3 className="panel-title">Provider workspace</h3>
            <p className="panel-sub">
              Sign in to manage listings, accept bookings, and track estimated earnings.
            </p>

            {authLoading ? (
              <p className="form-note">Checking your session…</p>
            ) : !configured ? (
              <div className="setup-banner" role="status">
                <strong>Email signup needs real Supabase keys.</strong>
                Open <code>.env.local</code> and paste Project URL + anon key from Supabase → Project Settings → API.
              </div>
            ) : !user ? (
              <AuthPanel {...authActions} />
            ) : (
              <ProviderDashboard
                user={user}
                sessionKey={session?.access_token ?? ''}
                providers={providers}
                form={form}
                errors={errors}
                submitting={submitting}
                submitError={submitError}
                justAdded={justAdded}
                onFormChange={setForm}
                onSubmit={handleSubmit}
                onRefreshProviders={refreshProviders}
                onSignOut={signOut}
              />
            )}
          </div>
        )}

        {role === 'admin' && user && isAdmin && (
          <div className="provider-panel">
            <AdminPanel
              user={user}
              onCategoriesChanged={async () => {
                await refreshCategories(false)
              }}
              onProvidersChanged={refreshProviders}
              onSignOut={signOut}
            />
          </div>
        )}
      </div>
    </section>
  )
}
