import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  acceptBooking,
  bookingErrorMessage,
  confirmJobComplete,
  contactsUnlocked,
  createBooking,
  fetchMyCustomerBookings,
  fetchProviderIncomingBookings,
  formatBookingWhen,
  formatMoney,
  paymentStatusLabel,
  payoutStatusLabel,
  updateBookingStatus,
  type Booking,
  type BookingType,
} from '../data/bookings'
import {
  confirmRazorpayPaymentLinkReturn,
  isPaymentLinkResult,
  isUnpaidPaymentLinkStatus,
  payBookingWithRazorpay,
  paymentActionErrorMessage,
  waitForBookingPaymentCapture,
  type PaymentLinkResult,
  type RazorpayPaymentKind,
} from '../data/razorpayPayments'
import {
  defaultProviderFilters,
  filterProviders,
  type Provider,
  type ProviderFilters,
} from '../data/providers'
import { fetchFavoriteProviderIds, toggleFavorite } from '../data/favorites'
import {
  ensureBrowserNotificationPermission,
  fetchMyNotifications,
  markAllNotificationsRead,
  maybeShowBrowserNotification,
  subscribeToNotifications,
  unreadCount,
  type AppNotification,
} from '../data/notifications'
import { buildCustomerPaymentLedger } from '../data/paymentHistory'
import { fetchReviewedBookingIds, submitReview } from '../data/reviews'
import { AuthPanel } from './AuthPanel'
import { BookingEmailDraftControl } from './BookingEmailDraftControl'
import { PaymentHistoryPanel } from './PaymentHistoryPanel'
import { useCategories } from '../hooks/useCategories'

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
  sessionKey: string
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
  /** success = paid/confirmed; info = link created / pending; warning = cancelled/unpaid return */
  const [infoTone, setInfoTone] = useState<'success' | 'info' | 'warning'>('info')
  const [myBookings, setMyBookings] = useState<Booking[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [filters, setFilters] = useState<ProviderFilters>(defaultProviderFilters)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set())
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: number; comment: string }>>({})
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)
  const [paymentLinks, setPaymentLinks] = useState<
    Record<string, { url: string; kind: RazorpayPaymentKind }>
  >({})
  const bookingFormRef = useRef<HTMLFormElement>(null)
  const bookingContactRef = useRef<HTMLInputElement>(null)
  const { serviceOptions } = useCategories()

  const filteredProviders = useMemo(
    () => filterProviders(providers, filters, favoriteIds),
    [providers, filters, favoriteIds],
  )
  const selected = filteredProviders.find((p) => p.id === selectedId) ?? providers.find((p) => p.id === selectedId) ?? null
  const notificationUnread = unreadCount(notifications)
  const customerPaymentLedger = useMemo(() => buildCustomerPaymentLedger(myBookings), [myBookings])

  const focusBookingForm = () => {
    bookingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    window.requestAnimationFrame(() => {
      bookingContactRef.current?.focus({ preventScroll: true })
    })
  }

  const selectProviderForBooking = (providerId: string) => {
    if (!user) {
      setError('Sign in above first, then tap Book again.')
      setSelectedId(null)
      return
    }
    setSelectedId(providerId)
    setError(null)
    setInfo(null)
  }

  // Bring the book form into view as soon as a provider is selected.
  useEffect(() => {
    if (!selectedId || !user) return
    const timer = window.setTimeout(() => focusBookingForm(), 40)
    return () => window.clearTimeout(timer)
  }, [selectedId, user?.id])

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

  const loadFavorites = async (customerId: string) => {
    try {
      setFavoriteIds(await fetchFavoriteProviderIds(customerId))
    } catch {
      setFavoriteIds(new Set())
    }
  }

  const loadNotifications = async (customerId: string) => {
    try {
      setNotifications(await fetchMyNotifications(customerId))
    } catch {
      setNotifications([])
    }
  }

  const refreshMyBookings = async () => {
    if (!user) {
      setMyBookings([])
      setReviewedIds(new Set())
      setFavoriteIds(new Set())
      setNotifications([])
      return
    }
    setLoadingBookings(true)
    try {
      const bookings = await fetchMyCustomerBookings(user.id)
      setMyBookings(bookings)
      setPaymentLinks((current) => {
        const next = { ...current }
        for (const booking of bookings) {
          const link = next[booking.id]
          if (!link) continue
          if (link.kind === 'deposit' && booking.paymentStatus !== 'unpaid') delete next[booking.id]
          if (link.kind === 'remaining' && booking.paymentStatus === 'fully_paid') delete next[booking.id]
        }
        return next
      })
      await loadReviewed(user.id)
      await loadFavorites(user.id)
      await loadNotifications(user.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your bookings')
    } finally {
      setLoadingBookings(false)
    }
  }

  useEffect(() => {
    void refreshMyBookings()
    if (user) void ensureBrowserNotificationPermission()
  }, [user?.id])

  // After Razorpay Payment Link callback / tab return: confirm signature then refresh.
  useEffect(() => {
    if (!user) return

    const params = new URLSearchParams(window.location.search)
    const isPaymentReturn = params.get('payment') === 'return'
    const linkId = params.get('razorpay_payment_link_id')?.trim() ?? ''
    const paymentId = params.get('razorpay_payment_id')?.trim() ?? ''
    const linkStatus = params.get('razorpay_payment_link_status')?.trim() ?? ''
    const signature = params.get('razorpay_signature')?.trim() ?? ''
    const referenceId = params.get('razorpay_payment_link_reference_id')?.trim() ?? ''
    const bookingId = params.get('booking_id')?.trim() ?? ''
    const kindRaw = params.get('kind')?.trim() ?? ''
    const kind =
      kindRaw === 'deposit' || kindRaw === 'remaining' ? (kindRaw as RazorpayPaymentKind) : undefined

    if (isPaymentReturn || (linkId && paymentId && signature)) {
      const clearReturnParams = () => {
        ;[
          'payment',
          'booking_id',
          'kind',
          'razorpay_payment_id',
          'razorpay_payment_link_id',
          'razorpay_payment_link_reference_id',
          'razorpay_payment_link_status',
          'razorpay_signature',
        ].forEach((key) => params.delete(key))
        const next = params.toString()
        const path = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
        window.history.replaceState({}, '', path)
      }

      void (async () => {
        setError(null)
        const statusLower = linkStatus.toLowerCase()
        const paidCallback =
          Boolean(linkId && paymentId && signature && linkStatus) &&
          statusLower === 'paid'

        if (linkStatus && isUnpaidPaymentLinkStatus(linkStatus)) {
          setInfoTone('warning')
          setInfo(
            `Payment ${statusLower || 'incomplete'} — not confirmed. Your booking is still unpaid. Open the payment link again to pay.`,
          )
        } else if (paidCallback) {
          setInfoTone('info')
          setInfo('Checking payment…')
          try {
            const verified = await confirmRazorpayPaymentLinkReturn({
              bookingId: bookingId || undefined,
              kind,
              razorpayPaymentId: paymentId,
              razorpayPaymentLinkId: linkId,
              razorpayPaymentLinkReferenceId: referenceId,
              razorpayPaymentLinkStatus: linkStatus,
              razorpaySignature: signature,
            })
            const targetId = verified.bookingId || bookingId
            const pollKind: RazorpayPaymentKind =
              kind ||
              (verified.kind === 'deposit' || verified.kind === 'remaining'
                ? verified.kind
                : 'deposit')
            if (!targetId) {
              setInfoTone('warning')
              setInfo(
                'Checking payment… could not match a booking yet. Refresh shortly — HomeFix only confirms after the booking status updates on the server.',
              )
            } else {
              const capture = await waitForBookingPaymentCapture(targetId, pollKind)
              if (capture.paid) {
                setInfoTone('success')
                setInfo(
                  pollKind === 'remaining'
                    ? 'Payment confirmed. Remaining 90% is recorded on your booking and credited toward the provider.'
                    : 'Payment confirmed. 10% deposit is recorded on your booking — provider contact is unlocked.',
                )
              } else {
                setInfoTone('warning')
                setInfo(
                  'Checking payment… not confirmed on your booking yet. If Razorpay’s page showed success, wait and refresh — HomeFix stays unpaid until the server shows deposit paid / fully paid.',
                )
              }
            }
          } catch (err) {
            setError(
              paymentActionErrorMessage(
                err,
                'Payment could not be confirmed. If Razorpay showed success, wait a moment or refresh — webhook may still apply it. Booking stays unpaid until then.',
              ),
            )
            setInfo(null)
          }
        } else if (isPaymentReturn) {
          // Callback hit without a paid signature — treat as cancelled / abandoned.
          setInfoTone('warning')
          setInfo(
            'Payment was not completed. Your booking is still unpaid — use Pay again or open the payment link when ready.',
          )
        } else {
          setInfoTone('warning')
          setInfo(
            'Payment return was incomplete. Booking stays unpaid until Razorpay capture is verified on the server.',
          )
        }
        clearReturnParams()
        await refreshMyBookings()
      })()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshMyBookings()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    return subscribeToNotifications(user.id, (notification) => {
      setNotifications((current) => [notification, ...current.filter((n) => n.id !== notification.id)])
      maybeShowBrowserNotification(notification)
      void refreshMyBookings()
    })
  }, [user?.id])

  const storePaymentLink = (bookingId: string, link: PaymentLinkResult) => {
    setPaymentLinks((current) => ({
      ...current,
      [bookingId]: { url: link.shortUrl, kind: link.kind },
    }))
  }

  /** Same-tab redirect — fastest path to Razorpay Payment Link. */
  const redirectToPaymentLink = (url: string) => {
    window.location.assign(url)
  }

  /** Secondary: open in a new tab (copy/re-open helpers only). */
  const openPaymentLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const copyPaymentLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setInfoTone('info')
      setInfo('Payment link copied. Open it to complete Razorpay payment — HomeFix confirms only after the booking status updates on the server.')
    } catch {
      setInfoTone('info')
      setInfo(`Payment link: ${url}`)
    }
  }

  const dismissNotifications = async () => {
    if (!user || notificationUnread === 0) return
    try {
      await markAllNotificationsRead(user.id)
      setNotifications((current) =>
        current.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
      )
    } catch {
      // Ignore mark-read failures
    }
  }

  const handleToggleFavorite = async (providerId: string) => {
    if (!user) {
      setError('Sign in to save providers.')
      return
    }
    setFavoriteBusyId(providerId)
    setError(null)
    try {
      const currentlySaved = favoriteIds.has(providerId)
      const nextSaved = await toggleFavorite(user.id, providerId, currentlySaved)
      setFavoriteIds((current) => {
        const next = new Set(current)
        if (nextSaved) next.add(providerId)
        else next.delete(providerId)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update favorites')
    } finally {
      setFavoriteBusyId(null)
    }
  }

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
      setInfoTone('success')
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
      setInfoTone('success')
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
    setInfo(null)
    setInfoTone('info')
    setInfo('Opening Razorpay…')
    try {
      const result = await payBookingWithRazorpay(bookingId, 'deposit')
      if (isPaymentLinkResult(result)) {
        // Store for secondary copy/open if navigation is blocked; redirect immediately.
        storePaymentLink(bookingId, result)
        redirectToPaymentLink(result.shortUrl)
        return
      }
      setInfo('Checking payment…')
      const capture = await waitForBookingPaymentCapture(bookingId, 'deposit')
      if (capture.paid) {
        setInfoTone('success')
        setInfo(
          'Payment confirmed. 10% deposit is recorded — provider phone is unlocked. After both confirm the job is done, pay the remaining 90%.',
        )
      } else {
        setInfoTone('warning')
        setInfo(
          'Checkout finished, but the booking is still unpaid on the server. Refresh shortly or contact support — do not assume payment succeeded.',
        )
      }
      await refreshMyBookings()
    } catch (err) {
      setError(paymentActionErrorMessage(err, 'Could not pay deposit'))
      setInfo(null)
    } finally {
      setReviewBusyId(null)
    }
  }

  const handlePayRemaining = async (bookingId: string) => {
    setReviewBusyId(bookingId)
    setError(null)
    setInfo(null)
    setInfoTone('info')
    setInfo('Opening Razorpay…')
    try {
      const result = await payBookingWithRazorpay(bookingId, 'remaining')
      if (isPaymentLinkResult(result)) {
        storePaymentLink(bookingId, result)
        redirectToPaymentLink(result.shortUrl)
        return
      }
      setInfo('Checking payment…')
      const capture = await waitForBookingPaymentCapture(bookingId, 'remaining')
      if (capture.paid) {
        setInfoTone('success')
        setInfo(
          'Payment confirmed. Remaining 90% is recorded and credited toward the provider. You can leave a review now.',
        )
      } else {
        setInfoTone('warning')
        setInfo(
          'Checkout finished, but the booking is still not fully paid on the server. Refresh shortly or contact support — do not assume payment succeeded.',
        )
      }
      await refreshMyBookings()
    } catch (err) {
      setError(paymentActionErrorMessage(err, 'Could not pay remaining amount'))
      setInfo(null)
    } finally {
      setReviewBusyId(null)
    }
  }

  const handleConfirmComplete = async (bookingId: string) => {
    setReviewBusyId(bookingId)
    setError(null)
    try {
      const updated = await confirmJobComplete(bookingId)
      setInfoTone('info')
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
    <div className={`booking-block${user && selected ? ' has-sticky-book' : ''}`}>
      <h3 className="panel-title">Book a provider</h3>
      <p className="panel-sub">
        Save providers you like, then filter Saved only. Pay HomeFix: 10% after accept (unlocks contacts), then 90%
        after both confirm the job — that 90% is credited to the provider.
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
        <div className="field">
          <label htmlFor="filter-saved">Show</label>
          <select
            id="filter-saved"
            value={filters.savedOnly ? 'saved' : 'all'}
            onChange={(e) => updateFilter('savedOnly', e.target.value === 'saved')}
            disabled={!user}
          >
            <option value="all">All providers</option>
            <option value="saved">Saved only ({favoriteIds.size})</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-verified">Trust</label>
          <select
            id="filter-verified"
            value={filters.verifiedOnly ? 'verified' : 'all'}
            onChange={(e) => updateFilter('verifiedOnly', e.target.value === 'verified')}
          >
            <option value="all">Any</option>
            <option value="verified">Verified only</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-availability">Availability</label>
          <select
            id="filter-availability"
            value={filters.availableOnly ? 'available' : 'all'}
            onChange={(e) => updateFilter('availableOnly', e.target.value === 'available')}
          >
            <option value="all">Any</option>
            <option value="available">Available only</option>
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
        <p className="form-note">
          {filters.savedOnly
            ? 'No saved providers yet. Tap Save on a listing, then filter Saved only.'
            : filters.availableOnly
              ? 'No available providers match these filters. Try clearing “Available only” or other filters.'
              : 'No providers match these filters. Try clearing filters or widening price/rating.'}
        </p>
      ) : (
        <div className="provider-list">
          {filteredProviders.map((provider) => {
            const isSaved = favoriteIds.has(provider.id)
            const isSelected = selectedId === provider.id
            return (
              <div key={provider.id} className="provider-book-stack">
                <article
                  className={`provider-item selectable ${isSelected ? 'selected' : ''}`}
                >
                  <div>
                    <h4>
                      {provider.name}
                      {provider.isVerified ? <span className="verified-badge">Verified</span> : null}
                      <span
                        className={`availability-badge ${
                          provider.availabilityStatus === 'busy' ? 'busy' : 'available'
                        }`}
                      >
                        {provider.availabilityStatus === 'busy' ? 'Busy' : 'Available'}
                      </span>
                    </h4>
                    <p>
                      {provider.service} · from {provider.quote}
                    </p>
                    <p className="provider-meta">
                      ★ {provider.rating.toFixed(1)}
                      {provider.ratingCount > 0 ? ` (${provider.ratingCount})` : ''} · {provider.bookings} booking
                      {provider.bookings === 1 ? '' : 's'} · Contact via HomeFix
                      {provider.preferredHours ? ` · Hours: ${provider.preferredHours}` : ''}
                      {isSaved ? ' · Saved' : ''}
                    </p>
                  </div>
                  <div className="provider-item-actions">
                    <span className="bookings-pill">
                      ★ {provider.rating.toFixed(1)}
                    </span>
                    <button
                      type="button"
                      className={`btn btn-small ${isSaved ? 'btn-primary' : 'btn-secondary'}`}
                      disabled={favoriteBusyId === provider.id}
                      aria-pressed={isSaved}
                      onClick={() => void handleToggleFavorite(provider.id)}
                    >
                      {favoriteBusyId === provider.id ? '…' : isSaved ? 'Saved' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => selectProviderForBooking(provider.id)}
                    >
                      {isSelected ? 'Selected' : 'Book'}
                    </button>
                  </div>
                </article>

                {user && isSelected && selected && (
                  <form
                    ref={bookingFormRef}
                    id="customer-booking-form"
                    className="booking-form booking-form-inline"
                    onSubmit={handleBook}
                    noValidate
                  >
                    <h4 className="booking-form-title">
                      Book {selected.name}
                      <span className="booking-form-quote"> · from {selected.quote}</span>
                    </h4>
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
                          ref={bookingContactRef}
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
              </div>
            )
          })}
        </div>
      )}

      {user && selected && (
        <div className="booking-sticky-bar" role="region" aria-label="Continue booking">
          <div className="booking-sticky-bar-copy">
            <strong>{selected.name}</strong>
            <span>
              {selected.service} · from {selected.quote}
            </span>
          </div>
          <div className="booking-sticky-bar-actions">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectedId(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => focusBookingForm()}>
              Book {selected.name}
            </button>
          </div>
        </div>
      )}

      {user && (
        <div className="booking-history">
          {notifications.length > 0 && (
            <div className="notif-panel" style={{ marginBottom: '1rem' }}>
              <div className="booking-history-head">
                <h4>
                  Notifications
                  {notificationUnread > 0 ? ` (${notificationUnread} new)` : ''}
                </h4>
                {notificationUnread > 0 && (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void dismissNotifications()}>
                    Mark read
                  </button>
                )}
              </div>
              <ul className="notif-list">
                {notifications.slice(0, 5).map((item) => (
                  <li key={item.id} className={item.readAt ? 'notif-item' : 'notif-item unread'}>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <span className="notif-time">
                      {new Date(item.createdAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              const payingThis = reviewBusyId === booking.id

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
                      <div className="contact-reveal">
                        <p className="contact-reveal-label">Provider phone (unlocked after 10% payment)</p>
                        {booking.provider?.contact ? (
                          <a className="contact-reveal-link" href={`tel:${booking.provider.contact}`}>
                            {booking.provider.contact}
                          </a>
                        ) : (
                          <p className="form-note">Phone not available on this listing — ask HomeFix support.</p>
                        )}
                        <p className="form-note">
                          {booking.customerCompleted ? 'You confirmed done' : 'Waiting for your confirm'}
                          {' · '}
                          {booking.providerCompleted ? 'Provider confirmed done' : 'Waiting for provider confirm'}
                        </p>
                      </div>
                    ) : booking.status === 'accepted' ? (
                      <p className="form-note">
                        Provider accepted. Pay 10% to HomeFix below to unlock their phone number.
                      </p>
                    ) : booking.status === 'pending' ? (
                      <p className="form-note">Waiting for the provider to accept. You’ll get a notification when they do.</p>
                    ) : (
                      <p className="form-note">Provider contact unlocks after you pay 10% to HomeFix.</p>
                    )}
                    {booking.notes && <p className="booking-notes">{booking.notes}</p>}

                    <BookingEmailDraftControl
                      booking={booking}
                      role="customer"
                      customerName={
                        typeof user?.user_metadata?.full_name === 'string'
                          ? user.user_metadata.full_name
                          : user?.email ?? undefined
                      }
                      onFlash={(message) => {
                        setInfoTone('info')
                        setInfo(message)
                      }}
                    />

                    {canPayDeposit && (
                      <div className="payment-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={payingThis}
                          onClick={() => void handlePayDeposit(booking.id)}
                        >
                          {payingThis
                            ? 'Opening Razorpay…'
                            : `Pay deposit (10%) — ${formatMoney(booking.depositAmount)}`}
                        </button>
                        <p className="form-note">
                          Redirects you to Razorpay to pay. HomeFix confirms only after the booking status updates
                          on the server — opening the link is not payment confirmation.
                        </p>
                        {paymentLinks[booking.id]?.kind === 'deposit' && (
                          <div className="payment-link-box">
                            <p className="payment-link-url">{paymentLinks[booking.id].url}</p>
                            <div className="email-draft-actions">
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => void copyPaymentLink(paymentLinks[booking.id].url)}
                              >
                                Copy payment link
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => openPaymentLink(paymentLinks[booking.id].url)}
                              >
                                Open payment link
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {canConfirmComplete && (
                      <div className="payment-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={payingThis}
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
                          disabled={payingThis}
                          onClick={() => void handlePayRemaining(booking.id)}
                        >
                          {payingThis
                            ? 'Opening Razorpay…'
                            : `Pay remaining (90%) — ${formatMoney(booking.remainingAmount)}`}
                        </button>
                        <p className="form-note">
                          Redirects you to Razorpay to pay. Completing payment credits the provider — HomeFix
                          confirms only after the booking is fully paid on the server.
                        </p>
                        {paymentLinks[booking.id]?.kind === 'remaining' && (
                          <div className="payment-link-box">
                            <p className="payment-link-url">{paymentLinks[booking.id].url}</p>
                            <div className="email-draft-actions">
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => void copyPaymentLink(paymentLinks[booking.id].url)}
                              >
                                Copy payment link
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-small"
                                onClick={() => openPaymentLink(paymentLinks[booking.id].url)}
                              >
                                Open payment link
                              </button>
                            </div>
                          </div>
                        )}
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
                          disabled={payingThis}
                          onClick={() => void handleSubmitReview(booking.id)}
                        >
                          {payingThis ? 'Submitting…' : 'Submit review'}
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

          <PaymentHistoryPanel
            title="Payment history"
            subtitle="Invoice-style record of amounts you paid to HomeFix (10% deposit and 90% final)."
            entries={customerPaymentLedger}
            emptyNote="No payments yet. After a provider accepts, pay 10% — it will appear here."
          />
        </div>
      )}

      {error && <p className="field-error auth-message">{error}</p>}
      {info && (
        <p
          className={`auth-message ${
            infoTone === 'success'
              ? 'success-banner'
              : infoTone === 'warning'
                ? 'warning-banner'
                : 'info-banner'
          }`}
          role="status"
        >
          {info}
        </p>
      )}
    </div>
  )
}

export function ProviderIncomingBookings({ user, sessionKey, onProvidersRefresh }: ProviderBookingsProps) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      setBookings(await fetchProviderIncomingBookings(user.id))
    } catch (err) {
      setError(bookingErrorMessage(err, 'Could not load incoming bookings'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [user.id, sessionKey])

  useEffect(() => {
    const onFocus = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
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
      {info && (
        <p className="success-banner auth-message" role="status">
          {info}
        </p>
      )}

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
                  <div className="contact-reveal">
                    <p className="contact-reveal-label">Customer phone (unlocked after 10% payment)</p>
                    {booking.customerContact ? (
                      <a className="contact-reveal-link" href={`tel:${booking.customerContact}`}>
                        {booking.customerContact}
                      </a>
                    ) : (
                      <p className="form-note">Customer phone not provided.</p>
                    )}
                    <p className="form-note">
                      {booking.providerCompleted ? 'You confirmed done' : 'Waiting for your confirm'}
                      {' · '}
                      {booking.customerCompleted ? 'Customer confirmed done' : 'Waiting for customer confirm'}
                    </p>
                  </div>
                ) : booking.status === 'accepted' ? (
                  <p className="form-note">Waiting for customer’s 10% payment to HomeFix — then contacts unlock.</p>
                ) : null}
                {booking.notes && <p className="booking-notes">{booking.notes}</p>}
                <BookingEmailDraftControl
                  booking={booking}
                  role="provider"
                  customerName={undefined}
                  onFlash={(message) => setInfo(message)}
                />
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
