import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  acceptBooking,
  createBooking,
  fetchMyCustomerBookings,
  fetchProviderIncomingBookings,
  formatBookingWhen,
  updateBookingStatus,
  type Booking,
  type BookingType,
} from '../data/bookings'
import {
  defaultProviderFilters,
  filterProviders,
  type Provider,
  type ProviderFilters,
} from '../data/providers'
import { serviceOptions } from '../data/categories'
import { AuthPanel } from './AuthPanel'

type AuthActions = {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  sendPhoneOtp: (phone: string) => Promise<void>
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>
  signOut: () => Promise<void>
}

type ReceiverBookingsProps = {
  user: User | null
  authLoading: boolean
  configured: boolean
  providers: Provider[]
  auth: AuthActions
  onProvidersRefresh: () => Promise<void>
}

type ProviderBookingsProps = {
  user: User
  onProvidersRefresh: () => Promise<void>
}

function statusLabel(status: Booking['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function ReceiverBookingPanel({
  user,
  authLoading,
  configured,
  providers,
  auth,
  onProvidersRefresh,
}: ReceiverBookingsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bookingType, setBookingType] = useState<BookingType>('instant')
  const [scheduledAt, setScheduledAt] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [myBookings, setMyBookings] = useState<Booking[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [filters, setFilters] = useState<ProviderFilters>(defaultProviderFilters)

  const filteredProviders = useMemo(() => filterProviders(providers, filters), [providers, filters])
  const selected = filteredProviders.find((p) => p.id === selectedId) ?? providers.find((p) => p.id === selectedId) ?? null

  const updateFilter = <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setSelectedId(null)
  }

  const refreshMyBookings = async () => {
    if (!user) {
      setMyBookings([])
      return
    }
    setLoadingBookings(true)
    try {
      setMyBookings(await fetchMyCustomerBookings(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your bookings')
    } finally {
      setLoadingBookings(false)
    }
  }

  useEffect(() => {
    void refreshMyBookings()
  }, [user?.id])

  const handleBook = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    if (!user) {
      setError('Sign in to place a booking.')
      return
    }
    if (!selected) {
      setError('Choose a provider first.')
      return
    }
    if (selected.userId && selected.userId === user.id) {
      setError('You cannot book your own listing.')
      return
    }
    if (bookingType === 'scheduled' && !scheduledAt) {
      setError('Pick a date and time for a scheduled booking.')
      return
    }

    setBusy(true)
    try {
      await createBooking({
        providerId: selected.id,
        customerId: user.id,
        bookingType,
        scheduledAt: bookingType === 'scheduled' ? new Date(scheduledAt).toISOString() : null,
        notes,
      })
      setInfo(`Booking request sent to ${selected.name}.`)
      setNotes('')
      setScheduledAt('')
      setBookingType('instant')
      setSelectedId(null)
      await refreshMyBookings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create booking')
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async (bookingId: string) => {
    setError(null)
    try {
      await updateBookingStatus(bookingId, 'cancelled')
      await refreshMyBookings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel booking')
    }
  }

  return (
    <div className="booking-block">
      <h3 className="panel-title">Book a provider</h3>
      <p className="panel-sub">
        Browse all live listings below. Sign in only when you are ready to send a booking request.
      </p>

      {authLoading ? (
        <p className="form-note">Checking your session…</p>
      ) : !configured ? (
        <p className="form-note">Connect Supabase to enable bookings.</p>
      ) : !user ? (
        <AuthPanel {...auth} />
      ) : (
        <div className="account-bar">
          <p>
            Signed in as <strong>{user.email ?? user.phone ?? 'customer'}</strong>
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </div>
      )}

      <div className="browse-filters">
        <div className="field">
          <label htmlFor="filter-query">Search</label>
          <input
            id="filter-query"
            value={filters.query}
            onChange={(e) => updateFilter('query', e.target.value)}
            placeholder="Name, service, or phone"
          />
        </div>
        <div className="field">
          <label htmlFor="filter-service">Service</label>
          <select
            id="filter-service"
            value={filters.service}
            onChange={(e) => updateFilter('service', e.target.value)}
          >
            <option value="all">All services</option>
            {serviceOptions.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-price">Max price (₹)</label>
          <input
            id="filter-price"
            inputMode="numeric"
            value={filters.maxPrice ?? ''}
            onChange={(e) => {
              const raw = e.target.value.trim()
              updateFilter('maxPrice', raw === '' ? null : Number(raw))
            }}
            placeholder="e.g. 1000"
          />
        </div>
        <div className="field">
          <label htmlFor="filter-rating">Min rating</label>
          <select
            id="filter-rating"
            value={filters.minRating ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              updateFilter('minRating', raw === '' ? null : Number(raw))
            }}
          >
            <option value="">Any</option>
            <option value="4.5">4.5+</option>
            <option value="4">4.0+</option>
            <option value="3.5">3.5+</option>
            <option value="3">3.0+</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-sort">Sort by</label>
          <select
            id="filter-sort"
            value={filters.sortBy}
            onChange={(e) => updateFilter('sortBy', e.target.value as ProviderFilters['sortBy'])}
          >
            <option value="newest">Newest</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="rating">Top rated</option>
            <option value="bookings">Most bookings</option>
          </select>
        </div>
      </div>

      <div className="booking-history-head" style={{ marginTop: '1.25rem' }}>
        <h4>
          Available providers ({filteredProviders.length}
          {filteredProviders.length !== providers.length ? ` of ${providers.length}` : ''})
        </h4>
        <div className="provider-item-actions" style={{ flexDirection: 'row' }}>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setFilters(defaultProviderFilters)}
          >
            Clear filters
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void onProvidersRefresh()}>
            Refresh
          </button>
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="form-note">
          No providers found yet. If you already added listings, run{' '}
          <code>supabase/fix-provider-visibility.sql</code> in the Supabase SQL Editor, then click Refresh.
        </p>
      ) : filteredProviders.length === 0 ? (
        <p className="form-note">No providers match these filters. Try clearing filters or widening price/rating.</p>
      ) : (
        <div className="provider-list">
          {filteredProviders.map((provider) => (
            <article
              key={provider.id}
              className={`provider-item selectable ${selectedId === provider.id ? 'selected' : ''}`}
            >
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
              <div className="provider-item-actions">
                <span className="bookings-pill">
                  ★ {provider.rating.toFixed(1)}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => {
                    if (!user) {
                      setError('Sign in above first, then tap Book again.')
                      setSelectedId(null)
                      return
                    }
                    setSelectedId(provider.id)
                    setError(null)
                    setInfo(null)
                  }}
                >
                  {selectedId === provider.id ? 'Selected' : 'Book'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {user && selected && (
        <form className="booking-form" onSubmit={handleBook} noValidate>
          <h4 className="booking-form-title">Request: {selected.name}</h4>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="booking-type">Booking type</label>
              <select
                id="booking-type"
                value={bookingType}
                onChange={(e) => setBookingType(e.target.value as BookingType)}
              >
                <option value="instant">Instant</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>
            {bookingType === 'scheduled' && (
              <div className="field">
                <label htmlFor="booking-when">Date & time</label>
                <input
                  id="booking-when"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="field full">
              <label htmlFor="booking-notes">Notes (optional)</label>
              <textarea
                id="booking-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe the issue, address landmark, preferred time window…"
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send booking request'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setSelectedId(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {user && (
        <div className="booking-history">
          <div className="booking-history-head">
            <h4>Your bookings</h4>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void refreshMyBookings()}>
              Refresh
            </button>
          </div>
          {loadingBookings && <p className="form-note">Loading bookings…</p>}
          {!loadingBookings && myBookings.length === 0 && <p className="form-note">No bookings yet.</p>}
          <div className="booking-list">
            {myBookings.map((booking) => (
              <article key={booking.id} className="booking-item">
                <div>
                  <h4>{booking.provider?.name ?? 'Provider'}</h4>
                  <p>
                    {booking.provider?.service ?? 'Service'} · {formatBookingWhen(booking)} ·{' '}
                    <span className={`status-pill status-${booking.status}`}>
                      {statusLabel(booking.status)}
                    </span>
                  </p>
                  {booking.notes && <p className="booking-notes">{booking.notes}</p>}
                </div>
                {booking.status === 'pending' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => void handleCancel(booking.id)}
                  >
                    Cancel
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {error && <p className="field-error auth-message">{error}</p>}
      {info && (
        <p className="success-banner auth-message" role="status">
          {info}
        </p>
      )}
    </div>
  )
}

export function ProviderIncomingBookings({ user, onProvidersRefresh }: ProviderBookingsProps) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      setBookings(await fetchProviderIncomingBookings(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load incoming bookings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [user.id])

  const handleAccept = async (bookingId: string) => {
    setBusyId(bookingId)
    setError(null)
    try {
      await acceptBooking(bookingId)
      await refresh()
      await onProvidersRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept booking')
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (bookingId: string) => {
    setBusyId(bookingId)
    setError(null)
    try {
      await updateBookingStatus(bookingId, 'rejected')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject booking')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="booking-block incoming">
      <div className="booking-history-head">
        <h3 className="panel-title">Incoming bookings</h3>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="panel-sub">Accept to confirm the job and increase your completed bookings count.</p>

      {loading && <p className="form-note">Loading incoming requests…</p>}
      {!loading && bookings.length === 0 && <p className="form-note">No booking requests yet.</p>}
      {error && <p className="field-error">{error}</p>}

      <div className="booking-list">
        {bookings.map((booking) => (
          <article key={booking.id} className="booking-item">
            <div>
              <h4>{booking.provider?.name ?? 'Your listing'}</h4>
              <p>
                {booking.provider?.service ?? 'Service'} · {formatBookingWhen(booking)} ·{' '}
                <span className={`status-pill status-${booking.status}`}>
                  {statusLabel(booking.status)}
                </span>
              </p>
              {booking.notes && <p className="booking-notes">{booking.notes}</p>}
            </div>
            {booking.status === 'pending' && (
              <div className="provider-item-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busyId === booking.id}
                  onClick={() => void handleAccept(booking.id)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busyId === booking.id}
                  onClick={() => void handleReject(booking.id)}
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
