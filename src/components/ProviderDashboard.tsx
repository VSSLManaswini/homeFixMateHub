import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  bookingErrorMessage,
  fetchProviderIncomingBookings,
  formatMoney,
  type Booking,
} from '../data/bookings'
import {
  ensureBrowserNotificationPermission,
  fetchMyNotifications,
  markAllNotificationsRead,
  maybeShowBrowserNotification,
  subscribeToNotifications,
  unreadCount,
  type AppNotification,
} from '../data/notifications'
import {
  emptyPayoutForm,
  fetchMyPayoutProfile,
  isPayoutProfileComplete,
  payoutProfileToForm,
  payoutSummary,
  saveMyPayoutProfile,
  validatePayoutProfile,
  type PayoutProfile,
  type PayoutProfileInput,
} from '../data/payoutProfile'
import {
  emptyKycForm,
  fetchMyKyc,
  idTypeOptions,
  isKycSubmitted,
  kycStatusLabel,
  kycToForm,
  maskIdNumber,
  submitMyKyc,
  validateKycInput,
  type ProviderKyc,
  type ProviderKycInput,
} from '../data/providerKyc'
import { buildProviderPaymentLedger } from '../data/paymentHistory'
import { type Provider } from '../data/providers'
import { ProviderIncomingBookings } from './BookingPanel'
import { PaymentHistoryPanel } from './PaymentHistoryPanel'
import { useCategories } from '../hooks/useCategories'

type DashboardTab = 'overview' | 'listings' | 'bookings' | 'payout' | 'kyc' | 'add'

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
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [payoutProfile, setPayoutProfile] = useState<PayoutProfile | null>(null)
  const [payoutForm, setPayoutForm] = useState<PayoutProfileInput>(emptyPayoutForm())
  const [payoutErrors, setPayoutErrors] = useState<Partial<Record<keyof PayoutProfileInput, string>>>({})
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutMessage, setPayoutMessage] = useState<string | null>(null)
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const [kyc, setKyc] = useState<ProviderKyc | null>(null)
  const [kycForm, setKycForm] = useState<ProviderKycInput>(emptyKycForm())
  const [kycErrors, setKycErrors] = useState<Partial<Record<keyof ProviderKycInput, string>>>({})
  const [kycBusy, setKycBusy] = useState(false)
  const [kycMessage, setKycMessage] = useState<string | null>(null)
  const [kycError, setKycError] = useState<string | null>(null)
  const { serviceOptions } = useCategories()

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

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await fetchMyNotifications(user.id))
    } catch {
      // Keep previous list if refresh fails
    }
  }, [user.id])

  const loadPayoutProfile = useCallback(async () => {
    try {
      const profile = await fetchMyPayoutProfile(user.id)
      setPayoutProfile(profile)
      setPayoutForm(payoutProfileToForm(profile))
    } catch {
      // Keep previous if refresh fails
    }
  }, [user.id])

  const loadKyc = useCallback(async () => {
    try {
      const row = await fetchMyKyc(user.id)
      setKyc(row)
      setKycForm(kycToForm(row))
    } catch {
      // Keep previous if refresh fails
    }
  }, [user.id])

  useEffect(() => {
    void loadBookings()
    void loadNotifications()
    void loadPayoutProfile()
    void loadKyc()
    void ensureBrowserNotificationPermission()
  }, [loadBookings, loadNotifications, loadPayoutProfile, loadKyc, sessionKey, justAdded])

  useEffect(() => {
    if (tab === 'bookings' || tab === 'overview') {
      void loadBookings()
      void loadNotifications()
    }
  }, [tab, loadBookings, loadNotifications])

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadBookings()
        void loadNotifications()
      }
    }
    const onFocus = () => {
      void loadBookings()
      void loadNotifications()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [loadBookings, loadNotifications])

  useEffect(() => {
    return subscribeToNotifications(user.id, (notification) => {
      setNotifications((current) => [notification, ...current.filter((n) => n.id !== notification.id)])
      maybeShowBrowserNotification(notification)
      void loadBookings()
    })
  }, [user.id, loadBookings])

  const refreshAll = async () => {
    await onRefreshProviders()
    await loadBookings()
    await loadNotifications()
    await loadPayoutProfile()
    await loadKyc()
  }

  const openBookingsTab = async () => {
    setTab('bookings')
    try {
      await markAllNotificationsRead(user.id)
      setNotifications((current) =>
        current.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
      )
    } catch {
      // Still open the tab even if mark-read fails
    }
    await loadBookings()
  }

  const handleSavePayout = async (event: FormEvent) => {
    event.preventDefault()
    setPayoutMessage(null)
    setPayoutError(null)
    const nextErrors = validatePayoutProfile(payoutForm)
    setPayoutErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setPayoutBusy(true)
    try {
      const saved = await saveMyPayoutProfile(user.id, payoutForm)
      setPayoutProfile(saved)
      setPayoutForm(payoutProfileToForm(saved))
      setPayoutMessage('Payout details saved. HomeFix will use these for your 90% credits.')
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'Could not save payout profile')
    } finally {
      setPayoutBusy(false)
    }
  }

  const handleSubmitKyc = async (event: FormEvent) => {
    event.preventDefault()
    setKycMessage(null)
    setKycError(null)
    const nextErrors = validateKycInput(kycForm)
    setKycErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setKycBusy(true)
    try {
      const saved = await submitMyKyc(user.id, kycForm)
      setKyc(saved)
      setKycForm(kycToForm(saved))
      setKycMessage('ID details submitted. An admin will review them before verifying your listings.')
    } catch (err) {
      setKycError(err instanceof Error ? err.message : 'Could not submit ID verification')
    } finally {
      setKycBusy(false)
    }
  }

  const pendingCount = bookings.filter((b) => b.status === 'pending').length
  const acceptedCount = bookings.filter((b) => b.status === 'accepted' || b.status === 'completed').length
  const rejectedCount = bookings.filter((b) => b.status === 'rejected').length
  const notificationUnread = unreadCount(notifications)
  const payoutReady = isPayoutProfileComplete(payoutProfile)
  const kycReady = isKycSubmitted(kyc)
  const anyListingUnverified = myListings.some((p) => !p.isVerified)
  const showKycNudge = anyListingUnverified && !kycReady
  const kycLocked = kyc?.status === 'verified'
  const providerPaymentLedger = useMemo(() => buildProviderPaymentLedger(bookings), [bookings])

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
    {
      id: 'bookings',
      label:
        notificationUnread > 0
          ? `Bookings (${pendingCount}) · ${notificationUnread} new`
          : `Bookings (${pendingCount})`,
    },
    { id: 'payout', label: payoutReady ? 'Payout' : 'Payout · setup' },
    {
      id: 'kyc',
      label: kycReady
        ? kyc?.status === 'verified'
          ? 'ID verification'
          : 'ID verification · pending'
        : 'KYC · needed',
    },
    { id: 'add', label: 'Add listing' },
  ]

  return (
    <div className="provider-dashboard">
      <div className="account-bar">
        <div>
          <p className="dashboard-kicker">Provider dashboard</p>
          <p>
            Signed in as <strong>{user.email ?? user.phone ?? 'provider'}</strong>
            {notificationUnread > 0 ? (
              <>
                {' '}
                · <strong className="notif-unread">{notificationUnread} new booking alert{notificationUnread === 1 ? '' : 's'}</strong>
              </>
            ) : null}
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
            onClick={() => {
              if (item.id === 'bookings') void openBookingsTab()
              else setTab(item.id)
            }}
          >
            {item.label}
            {item.id === 'bookings' && notificationUnread > 0 ? (
              <span className="tab-badge" aria-hidden>
                {notificationUnread}
              </span>
            ) : null}
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
          {notifications.length > 0 && (
            <div className="notif-panel">
              <div className="booking-history-head">
                <h3 className="panel-title">Notifications</h3>
                {notificationUnread > 0 && (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void openBookingsTab()}>
                    Open bookings
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
            <button type="button" className="btn btn-primary" onClick={() => void openBookingsTab()}>
              Review incoming bookings
              {notificationUnread > 0 ? ` (${notificationUnread} new)` : ''}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setTab('payout')}>
              {payoutReady ? 'Edit payout details' : 'Set up payout account'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setTab('kyc')}>
              {kycReady ? 'View ID verification' : 'Submit national ID'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setTab('add')}>
              Add a new listing
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void refreshAll()}>
              Refresh data
            </button>
          </div>

          {!payoutReady && (
            <p className="form-note" style={{ marginTop: '0.85rem' }}>
              Add your UPI or bank details under <strong>Payout</strong> so HomeFix can credit your 90% share later.
            </p>
          )}
          {payoutReady && payoutProfile && (
            <p className="form-note" style={{ marginTop: '0.85rem' }}>
              Payout destination: <strong>{payoutSummary(payoutProfile)}</strong>
            </p>
          )}
          {showKycNudge && (
            <p className="form-note" style={{ marginTop: '0.85rem' }}>
              To get the Verified badge, submit your national ID under{' '}
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setTab('kyc')}>
                ID verification
              </button>
              . Admins can only verify listings after KYC is reviewed.
            </p>
          )}
          {kycReady && kyc && (
            <p className="form-note" style={{ marginTop: '0.85rem' }}>
              ID verification: <strong>{kycStatusLabel(kyc.status)}</strong>
              {kyc.status === 'verified' ? ' · badge eligible' : ''}
            </p>
          )}

          <PaymentHistoryPanel
            title="Earnings history"
            subtitle="Invoice-style record of 90% credits after customers pay HomeFix in full."
            entries={providerPaymentLedger}
            emptyNote="No credits yet. When a job is fully paid, your 90% share appears here."
          />

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
            <>
              {showKycNudge && (
                <p className="form-note" style={{ marginBottom: '0.85rem' }}>
                  Listings without a Verified badge need national ID under{' '}
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => setTab('kyc')}>
                    ID verification
                  </button>
                  .
                </p>
              )}
              <div className="provider-list">
                {myListings.map((provider) => (
                  <article key={provider.id} className="provider-item">
                    <div>
                      <h4>
                        {provider.name}
                        {provider.isVerified ? <span className="verified-badge">Verified</span> : null}
                      </h4>
                      <p>
                        {provider.service} · from {provider.quote} · {provider.contact}
                      </p>
                      <p className="provider-meta">
                        ★ {provider.rating.toFixed(1)}
                        {provider.ratingCount > 0 ? ` (${provider.ratingCount})` : ''} · {provider.bookings} booking
                        {provider.bookings === 1 ? '' : 's'}
                        {provider.isVerified ? ' · HomeFix verified' : ' · not verified yet'}
                      </p>
                    </div>
                    <span className="bookings-pill">
                      {provider.bookings} done
                    </span>
                  </article>
                ))}
              </div>
            </>
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

      {tab === 'payout' && (
        <div className="dashboard-panel">
          <h3 className="panel-title">Payout details</h3>
          <p className="panel-sub">
            These details stay private. After a customer pays HomeFix in full, your 90% share is marked paid here —
            real bank/UPI transfers will use this profile when live payouts are enabled.
          </p>

          {payoutReady && payoutProfile && (
            <p className="success-banner auth-message" role="status">
              Ready · {payoutSummary(payoutProfile)}
            </p>
          )}

          <form className="booking-form" onSubmit={handleSavePayout} noValidate>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="payout-method">Payout method</label>
                <select
                  id="payout-method"
                  value={payoutForm.payoutMethod}
                  onChange={(e) =>
                    setPayoutForm((current) => ({
                      ...current,
                      payoutMethod: e.target.value as PayoutProfileInput['payoutMethod'],
                    }))
                  }
                >
                  <option value="upi">UPI</option>
                  <option value="bank">Bank account</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="payout-holder">Account holder name</label>
                <input
                  id="payout-holder"
                  value={payoutForm.accountHolderName}
                  onChange={(e) => setPayoutForm((current) => ({ ...current, accountHolderName: e.target.value }))}
                  placeholder="Name as on bank / UPI"
                  autoComplete="name"
                />
                {payoutErrors.accountHolderName && (
                  <span className="field-error">{payoutErrors.accountHolderName}</span>
                )}
              </div>

              {payoutForm.payoutMethod === 'upi' ? (
                <div className="field full">
                  <label htmlFor="payout-upi">UPI ID</label>
                  <input
                    id="payout-upi"
                    value={payoutForm.upiId}
                    onChange={(e) => setPayoutForm((current) => ({ ...current, upiId: e.target.value }))}
                    placeholder="name@oksbi"
                    autoComplete="off"
                  />
                  {payoutErrors.upiId && <span className="field-error">{payoutErrors.upiId}</span>}
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="payout-bank">Bank name</label>
                    <input
                      id="payout-bank"
                      value={payoutForm.bankName}
                      onChange={(e) => setPayoutForm((current) => ({ ...current, bankName: e.target.value }))}
                      placeholder="e.g. State Bank of India"
                    />
                    {payoutErrors.bankName && <span className="field-error">{payoutErrors.bankName}</span>}
                  </div>
                  <div className="field">
                    <label htmlFor="payout-account">Account number</label>
                    <input
                      id="payout-account"
                      value={payoutForm.accountNumber}
                      onChange={(e) => setPayoutForm((current) => ({ ...current, accountNumber: e.target.value }))}
                      placeholder="9–18 digits"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    {payoutErrors.accountNumber && (
                      <span className="field-error">{payoutErrors.accountNumber}</span>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor="payout-ifsc">IFSC</label>
                    <input
                      id="payout-ifsc"
                      value={payoutForm.ifsc}
                      onChange={(e) => setPayoutForm((current) => ({ ...current, ifsc: e.target.value }))}
                      placeholder="e.g. SBIN0001234"
                      autoComplete="off"
                    />
                    {payoutErrors.ifsc && <span className="field-error">{payoutErrors.ifsc}</span>}
                  </div>
                </>
              )}
            </div>

            {payoutError && <p className="field-error auth-message">{payoutError}</p>}
            {payoutMessage && (
              <p className="success-banner auth-message" role="status">
                {payoutMessage}
              </p>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={payoutBusy}>
                {payoutBusy ? 'Saving…' : 'Save payout details'}
              </button>
              <p className="form-note">Only you can see this. Never shown to customers.</p>
            </div>
          </form>
        </div>
      )}

      {tab === 'kyc' && (
        <div className="dashboard-panel">
          <h3 className="panel-title">National ID verification</h3>
          <p className="panel-sub">
            Submit your Aadhaar or other national ID so HomeFix admins can verify your listings. Customers never see
            your ID number.
          </p>

          {kyc && (
            <p
              className={`auth-message ${kyc.status === 'rejected' ? 'field-error' : 'success-banner'}`}
              role="status"
            >
              Status: <strong>{kycStatusLabel(kyc.status)}</strong>
              {kyc.status === 'verified' ? <span className="verified-badge">Verified</span> : null}
              {kyc.status === 'rejected' && kyc.rejectionReason
                ? ` — ${kyc.rejectionReason}`
                : null}
              {' · '}
              ID on file: {maskIdNumber(kyc.idType, kyc.idNumber)} · {kyc.idHolderName}
            </p>
          )}

          {kycLocked ? (
            <p className="form-note">
              Your ID is verified. Contact support if you need to update these details.
            </p>
          ) : (
            <form className="booking-form" onSubmit={handleSubmitKyc} noValidate>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="kyc-id-type">ID type</label>
                  <select
                    id="kyc-id-type"
                    value={kycForm.idType}
                    onChange={(e) => {
                      const idType = e.target.value as ProviderKycInput['idType']
                      setKycForm((current) => ({
                        ...current,
                        idType,
                        idNumber:
                          idType === 'aadhaar'
                            ? current.idNumber.replace(/\D/g, '').slice(0, 12)
                            : current.idNumber,
                      }))
                    }}
                  >
                    {idTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="kyc-holder">Name as on ID</label>
                  <input
                    id="kyc-holder"
                    value={kycForm.idHolderName}
                    onChange={(e) => setKycForm((current) => ({ ...current, idHolderName: e.target.value }))}
                    placeholder="Exact name on the ID card"
                    autoComplete="name"
                  />
                  {kycErrors.idHolderName && <span className="field-error">{kycErrors.idHolderName}</span>}
                </div>

                <div className="field full">
                  <label htmlFor="kyc-id-number">ID number</label>
                  <input
                    id="kyc-id-number"
                    value={kycForm.idNumber}
                    onChange={(e) => {
                      const raw = e.target.value
                      const idNumber =
                        kycForm.idType === 'aadhaar' ? raw.replace(/\D/g, '').slice(0, 12) : raw
                      setKycForm((current) => ({ ...current, idNumber }))
                      if (kycErrors.idNumber) {
                        setKycErrors((current) => ({ ...current, idNumber: undefined }))
                      }
                    }}
                    placeholder={kycForm.idType === 'aadhaar' ? '12-digit Aadhaar' : 'ID number'}
                    inputMode={kycForm.idType === 'aadhaar' ? 'numeric' : 'text'}
                    maxLength={kycForm.idType === 'aadhaar' ? 12 : undefined}
                    pattern={kycForm.idType === 'aadhaar' ? '\\d{12}' : undefined}
                    autoComplete="off"
                  />
                  {kycErrors.idNumber && <span className="field-error">{kycErrors.idNumber}</span>}
                </div>
              </div>

              {kycError && <p className="field-error auth-message">{kycError}</p>}
              {kycMessage && (
                <p className="success-banner auth-message" role="status">
                  {kycMessage}
                </p>
              )}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={kycBusy}>
                  {kycBusy
                    ? 'Submitting…'
                    : kyc?.status === 'rejected'
                      ? 'Resubmit ID details'
                      : kyc
                        ? 'Update ID details'
                        : 'Submit ID for review'}
                </button>
                <p className="form-note">Stored securely for admin review only. Never shown to customers.</p>
              </div>
            </form>
          )}
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
