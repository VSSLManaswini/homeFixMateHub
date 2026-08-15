import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  bookingErrorMessage,
  fetchProviderIncomingBookings,
  formatMoney,
  type Booking,
} from '../data/bookings'
import { type Provider } from '../data/providers'
import { serviceOptions } from '../data/categories'
import { ProviderIncomingBookings } from './BookingPanel'

type DashboardTab = 'overview' | 'listings' | 'bookings' | 'add'

type FormState = {
  name: string
  service: string
  quote: string
  contact: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

type ProviderDashboardProps = {
  user: User
  /** Changes when the auth session is restored/refreshed — triggers a bookings reload */
  sessionKey: string
  providers: Provider[]
  form: FormState
  errors: FormErrors
  submitting: boolean
  submitError: string | null
  justAdded: string | null
  onFormChange: (next: FormState) => void
  onSubmit: (event: FormEvent) => void
  onRefreshProviders: () => Promise<void>
  onSignOut: () => Promise<void>
}

export function ProviderDashboard({
  user,
  sessionKey,
  providers,
  form,
  errors,
  submitting,
  submitError,
  justAdded,
  onFormChange,
  onSubmit,
  onRefreshProviders,
  onSignOut,
}: ProviderDashboardProps) {
  const [tab, setTab] = useState<DashboardTab>('overview')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [bookingsError, setBookingsError] = useState<string | null>(null)

  const myListings = useMemo(
    () => providers.filter((p) => p.userId === user.id),
    [providers, user.id],
  )

  const loadBookings = useCallback(async () => {
    setLoadingBookings(true)
    setBookingsError(null)
    try {
      const rows = await fetchProviderIncomingBookings(user.id)
      setBookings(rows)
    } catch (err) {
      setBookingsError(bookingErrorMessage(err, 'Could not load bookings. Tap Refresh or sign in again.'))
    } finally {
      setLoadingBookings(false)
    }
  }, [user.id])

  useEffect(() => {
    void loadBookings()
  }, [loadBookings, sessionKey, justAdded])

  useEffect(() => {
    if (tab === 'bookings' || tab === 'overview') {
      void loadBookings()
    }
  }, [tab, loadBookings])

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void loadBookings()
    }
    const onFocus = () => void loadBookings()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [loadBookings])

  const refreshAll = async () => {
    await onRefreshProviders()
    await loadBookings()
  }

  const pendingCount = bookings.filter((b) => b.status === 'pending').length
  const acceptedCount = bookings.filter((b) => b.status === 'accepted' || b.status === 'completed').length
  const rejectedCount = bookings.filter((b) => b.status === 'rejected').length

  const pendingEarnings = useMemo(() => {
    return bookings
      .filter(
        (b) =>
          b.status === 'pending' ||
          (b.status === 'accepted' && b.paymentStatus !== 'fully_paid') ||
          (b.status === 'completed' && b.paymentStatus !== 'fully_paid'),
      )
      .reduce((sum, booking) => sum + booking.remainingAmount, 0)
  }, [bookings])

  const paidOutEarnings = useMemo(() => {
    return bookings
      .filter((b) => b.payoutStatus === 'paid')
      .reduce((sum, booking) => sum + booking.remainingAmount, 0)
  }, [bookings])

  const platformFeesCollected = useMemo(() => {
    return bookings
      .filter((b) => b.paymentStatus === 'deposit_paid' || b.paymentStatus === 'fully_paid')
      .reduce((sum, booking) => sum + booking.platformFeeAmount, 0)
  }, [bookings])

  const awaitingPayout = useMemo(() => {
    return bookings
      .filter((b) => b.status === 'completed' && b.paymentStatus === 'deposit_paid')
      .reduce((sum, booking) => sum + booking.remainingAmount, 0)
  }, [bookings])

  const avgRating =
    myListings.length === 0
      ? 0
      : myListings.reduce((sum, p) => sum + p.rating, 0) / myListings.length

  const tabs: { id: DashboardTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'listings', label: `Listings (${myListings.length})` },
    { id: 'bookings', label: `Bookings (${pendingCount})` },
    { id: 'add', label: 'Add listing' },
  ]

  return (
    <div className="provider-dashboard">
      <div className="account-bar">
        <div>
          <p className="dashboard-kicker">Provider dashboard</p>
          <p>
            Signed in as <strong>{user.email ?? user.phone ?? 'provider'}</strong>
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>

      <div className="dashboard-tabs" role="tablist" aria-label="Provider dashboard sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`dashboard-tab ${tab === item.id ? 'active' : ''}`}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {bookingsError && (
        <p className="field-error auth-message" role="alert">
          {bookingsError}{' '}
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void loadBookings()}>
            Retry
          </button>
        </p>
      )}

      {tab === 'overview' && (
        <div className="dashboard-panel">
          <div className="stats-row dashboard-stats">
            <div className="stat">
              <strong>{myListings.length}</strong>
              <span>Active listings</span>
            </div>
            <div className="stat">
              <strong>{pendingCount}</strong>
              <span>Pending requests</span>
            </div>
            <div className="stat">
              <strong>{acceptedCount}</strong>
              <span>Accepted jobs</span>
            </div>
            <div className="stat">
              <strong>{avgRating ? avgRating.toFixed(1) : '—'}</strong>
              <span>Avg rating</span>
            </div>
          </div>

          <div className="earnings-grid">
            <article className="earnings-card">
              <p className="earnings-label">Paid out by HomeFix (90%)</p>
              <p className="earnings-value">{formatMoney(paidOutEarnings)}</p>
              <p className="form-note">
                After both confirm completion and the customer pays HomeFix in full, you are credited 90%. HomeFix
                keeps 10% ({formatMoney(platformFeesCollected)} collected so far).
              </p>
            </article>
            <article className="earnings-card muted">
              <p className="earnings-label">Still in pipeline (90%)</p>
              <p className="earnings-value">{formatMoney(pendingEarnings)}</p>
              <p className="form-note">
                Awaiting customer final payment: {formatMoney(awaitingPayout)} · {pendingCount} open · {rejectedCount}{' '}
                rejected
              </p>
            </article>
          </div>

          <div className="dashboard-actions">
            <button type="button" className="btn btn-primary" onClick={() => setTab('bookings')}>
              Review incoming bookings
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setTab('add')}>
              Add a new listing
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void refreshAll()}>
              Refresh data
            </button>
          </div>

          {loadingBookings && <p className="form-note">Updating booking stats…</p>}
        </div>
      )}

      {tab === 'listings' && (
        <div className="dashboard-panel">
          <div className="booking-history-head">
            <h3 className="panel-title">My listings</h3>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void onRefreshProviders()}>
              Refresh
            </button>
          </div>
          {myListings.length === 0 ? (
            <p className="form-note">
              No listings yet. Use <strong>Add listing</strong> to publish your first service.
            </p>
          ) : (
            <div className="provider-list">
              {myListings.map((provider) => (
                <article key={provider.id} className="provider-item">
                  <div>
                    <h4>{provider.name}</h4>
                    <p>
                      {provider.service} · from {provider.quote} · {provider.contact}
                    </p>
                    <p className="provider-meta">
                      ★ {provider.rating.toFixed(1)}
                      {provider.ratingCount > 0 ? ` (${provider.ratingCount})` : ''} · {provider.bookings} booking
                      {provider.bookings === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="bookings-pill">
                    {provider.bookings} done
                  </span>
                </article>
              ))}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => setTab('add')}>
              Add listing
            </button>
          </div>
        </div>
      )}

      {tab === 'bookings' && (
        <div className="dashboard-panel">
          <ProviderIncomingBookings
            user={user}
            sessionKey={sessionKey}
            onProvidersRefresh={async () => {
              await onRefreshProviders()
              await loadBookings()
            }}
          />
        </div>
      )}

      {tab === 'add' && (
        <div className="dashboard-panel">
          <h3 className="panel-title">Add a service listing</h3>
          <p className="panel-sub">
            Publish a service with your quote and contact. Receivers can discover and book it immediately.
          </p>

          <form onSubmit={onSubmit} noValidate>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="provider-name">Full name</label>
                <input
                  id="provider-name"
                  name="name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => onFormChange({ ...form, name: e.target.value })}
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
                  onChange={(e) => onFormChange({ ...form, service: e.target.value })}
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
                  onChange={(e) => onFormChange({ ...form, quote: e.target.value })}
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
                  onChange={(e) => onFormChange({ ...form, contact: e.target.value })}
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
              <p className="form-note">Saved to Supabase for receivers to discover.</p>
            </div>
          </form>

          {justAdded && (
            <div className="success-banner" role="status">
              Saved to database (id: {justAdded.slice(0, 8)}…). Open Listings to see it.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
