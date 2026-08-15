import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  acceptBooking,
  confirmJobComplete,
  contactsUnlocked,
  createBooking,
  fetchMyCustomerBookings,
  fetchProviderIncomingBookings,
  formatBookingWhen,
  formatMoney,
  payBookingDeposit,
  payBookingRemaining,
  paymentStatusLabel,
  payoutStatusLabel,
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
import { fetchReviewedBookingIds, submitReview } from '../data/reviews'
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
  const [customerContact, setCustomerContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [myBookings, setMyBookings] = useState<Booking[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [filters, setFilters] = useState<ProviderFilters>(defaultProviderFilters)
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set())
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: number; comment: string }>>({})
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)

  const filteredProviders = useMemo(() => filterProviders(providers, filters), [providers, filters])
  const selected = filteredProviders.find((p) => p.id === selectedId) ?? providers.find((p) => p.id === selectedId) ?? null

  const updateFilter = <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setSelectedId(null)
  }

  const loadReviewed = async (customerId: string) => {
    try {
      setReviewedIds(await fetchReviewedBookingIds(customerId))
    } catch {
      setReviewedIds(new Set())
    }
  }

  const refreshMyBookings = async () => {
    if (!user) {
      setMyBookings([])
      setReviewedIds(new Set())
      return
    }
    setLoadingBookings(true)
    try {
      setMyBookings(await fetchMyCustomerBookings(user.id))
      await loadReviewed(user.id)
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
    const contact = customerContact.replace(/\s+/g, '')
    if (!/^\+?\d{10,15}$/.test(contact)) {
      setError('Enter your contact number (shared with the provider only after you pay 10%).')
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
        quoteText: selected.quote,
        customerContact: contact,
      })
      setInfo(
        `Booking request sent to ${selected.name}. After they accept, pay 10% to HomeFix — then both of you get each other’s numbers.`,
      )
      setNotes('')
      setCustomerContact('')
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

  const handleSubmitReview = async (bookingId: string) => {
    const draft = reviewDrafts[bookingId] ?? { rating: 5, comment: '' }
    setReviewBusyId(bookingId)
    setError(null)
    setInfo(null)
    try {
      await submitReview({
        bookingId,
        rating: draft.rating,
        comment: draft.comment,
      })
      setInfo('Thanks! Your review updated the provider rating.')
      await refreshMyBookings()
      await onProvidersRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit review')
    } finally {
      setReviewBusyId(null)
    }
  }

  const handlePayDeposit = async (bookingId: string) => {
    setReviewBusyId(bookingId)
    setError(null)
    try {
      await payBookingDeposit(bookingId)
      setInfo('10% paid to HomeFix. Contact numbers are now visible to both of you. After both confirm the job is done, pay the remaining 90%.')
      await refreshMyBookings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pay deposit')
    } finally {
      setReviewBusyId(null)
    }
  }

  const handlePayRemaining = async (bookingId: string) => {
    setReviewBusyId(bookingId)
    setError(null)
    try {
      await payBookingRemaining(bookingId)
      setInfo(
        'Remaining 90% paid to HomeFix and credited to the provider. You can leave a review now.',
      )
      await refreshMyBookings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pay remaining amount')
    } finally {
      setReviewBusyId(null)
    }
  }

  const handleConfirmComplete = async (bookingId: string) => {
    setReviewBusyId(bookingId)
    setError(null)
    try {
      const updated = await confirmJobComplete(bookingId)
      if (updated.status === 'completed') {
        setInfo('Both sides confirmed completion. Pay the remaining 90% to HomeFix (credited to the provider).')
      } else {
        setInfo('You confirmed completion. Waiting for the provider to confirm as well.')
      }
      await refreshMyBookings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm completion')
    } finally {
      setReviewBusyId(null)
    }
  }

  return (
    <div className="booking-block">
      <h3 className="panel-title">Book a provider</h3>
      <p className="panel-sub">
        Pay HomeFix only: 10% after accept (unlocks contacts), then 90% after both of you confirm the job is done.
        That 90% is credited to the provider.
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
                  {provider.service} · from {provider.quote}
                </p>
                <p className="provider-meta">
                  ★ {provider.rating.toFixed(1)}
                  {provider.ratingCount > 0 ? ` (${provider.ratingCount})` : ''} · {provider.bookings} booking
                  {provider.bookings === 1 ? '' : 's'} · Contact via HomeFix
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
              <label htmlFor="booking-contact">Your contact number</label>
              <input
                id="booking-contact"
                type="tel"
                value={customerContact}
                onChange={(e) => setCustomerContact(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                required
              />
              <p className="form-note">Shared with the provider only after you pay the 10% HomeFix deposit.</p>
            </div>
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
            {myBookings.map((booking) => {
              const draft = reviewDrafts[booking.id] ?? { rating: 5, comment: '' }
              const canPayDeposit = booking.status === 'accepted' && booking.paymentStatus === 'unpaid'
              const unlocked = contactsUnlocked(booking)
              const canConfirmComplete =
                unlocked &&
                booking.status === 'accepted' &&
                !booking.customerCompleted
              const canPayRemaining =
                booking.status === 'completed' &&
                booking.paymentStatus === 'deposit_paid' &&
                booking.providerCompleted &&
                booking.customerCompleted
              const canReview =
                booking.status === 'completed' &&
                booking.paymentStatus === 'fully_paid' &&
                !reviewedIds.has(booking.id)

              return (
                <article key={booking.id} className="booking-item reviewable">
                  <div>
                    <h4>{booking.provider?.name ?? 'Provider'}</h4>
                    <p>
                      {booking.provider?.service ?? 'Service'} · {formatBookingWhen(booking)} ·{' '}
                      <span className={`status-pill status-${booking.status}`}>
                        {statusLabel(booking.status)}
                      </span>
                    </p>
                    <p className="provider-meta">
                      Total {formatMoney(booking.quoteAmount)} · Deposit {formatMoney(booking.depositAmount)} ·
                      Remaining {formatMoney(booking.remainingAmount)} ·{' '}
                      <span className={`status-pill status-payment-${booking.paymentStatus}`}>
                        {paymentStatusLabel(booking.paymentStatus)}
                      </span>
                    </p>
                    {unlocked ? (
                      <p className="form-note">
                        Provider contact: <strong>{booking.provider?.contact || '—'}</strong>
                        {booking.customerCompleted ? ' · You confirmed done' : ''}
                        {booking.providerCompleted ? ' · Provider confirmed done' : ' · Waiting for provider confirm'}
                      </p>
                    ) : (
                      <p className="form-note">
                        Provider contact unlocks after you pay 10% to HomeFix.
                      </p>
                    )}
                    {booking.notes && <p className="booking-notes">{booking.notes}</p>}

                    {canPayDeposit && (
                      <div className="payment-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={reviewBusyId === booking.id}
                          onClick={() => void handlePayDeposit(booking.id)}
                        >
                          Pay 10% to HomeFix ({formatMoney(booking.depositAmount)})
                        </button>
                        <p className="form-note">Unlocks contact numbers for both of you.</p>
                      </div>
                    )}

                    {canConfirmComplete && (
                      <div className="payment-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={reviewBusyId === booking.id}
                          onClick={() => void handleConfirmComplete(booking.id)}
                        >
                          Confirm job completed
                        </button>
                        <p className="form-note">Provider must confirm too before the final 90% payment.</p>
                      </div>
                    )}

                    {booking.status === 'accepted' &&
                      unlocked &&
                      booking.customerCompleted &&
                      !booking.providerCompleted && (
                        <p className="form-note">Waiting for the provider to confirm completion.</p>
                      )}

                    {canPayRemaining && (
                      <div className="payment-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={reviewBusyId === booking.id}
                          onClick={() => void handlePayRemaining(booking.id)}
                        >
                          Pay remaining 90% to HomeFix ({formatMoney(booking.remainingAmount)})
                        </button>
                        <p className="form-note">
                          This 90% is credited to the provider. HomeFix keeps the 10% deposit as fee.
                        </p>
                      </div>
                    )}

                    {booking.paymentStatus === 'fully_paid' && (
                      <p className="success-banner auth-message">
                        Paid in full to HomeFix · Provider credited: {payoutStatusLabel(booking.payoutStatus)} (
                        {formatMoney(booking.remainingAmount)})
                      </p>
                    )}

                    {booking.status === 'completed' && booking.paymentStatus === 'fully_paid' && reviewedIds.has(booking.id) && (
                      <p className="form-note">You already reviewed this job.</p>
                    )}
                    {canReview && (
                      <div className="review-form">
                        <label htmlFor={`rating-${booking.id}`}>Your rating</label>
                        <select
                          id={`rating-${booking.id}`}
                          value={draft.rating}
                          onChange={(e) =>
                            setReviewDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...draft, rating: Number(e.target.value) },
                            }))
                          }
                        >
                          {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((value) => (
                            <option key={value} value={value}>
                              {value.toFixed(1)} ★
                            </option>
                          ))}
                        </select>
                        <label htmlFor={`comment-${booking.id}`}>Comment (optional)</label>
                        <textarea
                          id={`comment-${booking.id}`}
                          value={draft.comment}
                          onChange={(e) =>
                            setReviewDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...draft, comment: e.target.value },
                            }))
                          }
                          placeholder="How was the service?"
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={reviewBusyId === booking.id}
                          onClick={() => void handleSubmitReview(booking.id)}
                        >
                          {reviewBusyId === booking.id ? 'Submitting…' : 'Submit review'}
                        </button>
                      </div>
                    )}
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
              )
            })}
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

  const handleComplete = async (bookingId: string) => {
    setBusyId(bookingId)
    setError(null)
    try {
      const target = bookings.find((b) => b.id === bookingId)
      if (target && target.paymentStatus === 'unpaid') {
        throw new Error('Customer must pay the 10% HomeFix deposit before you can confirm completion.')
      }
      await confirmJobComplete(bookingId)
      await refresh()
      await onProvidersRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm completion')
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
      <p className="panel-sub">
        After the customer pays 10% to HomeFix, you both see contact numbers. When both of you confirm the job is
        done, they pay the remaining 90% to HomeFix — and that 90% is credited to you.
      </p>

      {loading && <p className="form-note">Loading incoming requests…</p>}
      {!loading && bookings.length === 0 && <p className="form-note">No booking requests yet.</p>}
      {error && <p className="field-error">{error}</p>}

      <div className="booking-list">
        {bookings.map((booking) => {
          const unlocked = contactsUnlocked(booking)
          const canConfirm =
            unlocked && booking.status === 'accepted' && !booking.providerCompleted

          return (
            <article key={booking.id} className="booking-item">
              <div>
                <h4>{booking.provider?.name ?? 'Your listing'}</h4>
                <p>
                  {booking.provider?.service ?? 'Service'} · {formatBookingWhen(booking)} ·{' '}
                  <span className={`status-pill status-${booking.status}`}>
                    {statusLabel(booking.status)}
                  </span>
                </p>
                <p className="provider-meta">
                  Quote {formatMoney(booking.quoteAmount)} · You receive {formatMoney(booking.remainingAmount)} via
                  HomeFix · HomeFix fee {formatMoney(booking.platformFeeAmount)} ·{' '}
                  {paymentStatusLabel(booking.paymentStatus)} · {payoutStatusLabel(booking.payoutStatus)}
                </p>
                {unlocked ? (
                  <p className="form-note">
                    Customer contact: <strong>{booking.customerContact || '—'}</strong>
                    {booking.providerCompleted ? ' · You confirmed done' : ''}
                    {booking.customerCompleted ? ' · Customer confirmed done' : ' · Waiting for customer confirm'}
                  </p>
                ) : booking.status === 'accepted' ? (
                  <p className="form-note">Waiting for customer’s 10% payment to HomeFix — then contacts unlock.</p>
                ) : null}
                {booking.notes && <p className="booking-notes">{booking.notes}</p>}
                {booking.status === 'accepted' &&
                  unlocked &&
                  booking.providerCompleted &&
                  !booking.customerCompleted && (
                    <p className="form-note">Waiting for the customer to confirm completion.</p>
                  )}
                {booking.status === 'completed' && booking.paymentStatus === 'deposit_paid' && (
                  <p className="form-note">
                    Both confirmed. Waiting for customer’s final 90% to HomeFix — then you are credited 90%.
                  </p>
                )}
                {booking.payoutStatus === 'paid' && (
                  <p className="form-note">
                    HomeFix credited your share of {formatMoney(booking.remainingAmount)} (demo payout recorded).
                  </p>
                )}
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
              {canConfirm && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busyId === booking.id}
                  onClick={() => void handleComplete(booking.id)}
                >
                  Confirm job completed
                </button>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
