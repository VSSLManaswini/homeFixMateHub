import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  downloadAdminBookingsCsv,
  fetchAdminBookings,
  markBookingRefundHandled,
  type AdminBookingRow,
} from '../data/adminBookings'
import {
  fetchAdminBookingPayouts,
  fetchAdminPlatformSummary,
  downloadPayoutsCsv,
  markProviderPayoutManualPaid,
  retryProviderPayout,
  type AdminPlatformSummary,
  type BookingPayoutRow,
} from '../data/adminPayouts'
import { formatMoney, paymentStatusLabel, payoutStatusLabel, type PaymentStatus, type PayoutStatus } from '../data/bookings'
import {
  categoryIconOptions,
  createServiceCategory,
  fetchServiceCategories,
  setServiceCategoryActive,
  slugifyCategoryId,
  updateServiceCategory,
  type ServiceCategory,
  type ServiceCategoryInput,
} from '../data/categories'
import {
  fetchAllProviderKyc,
  idTypeOptions,
  isKycSubmitted,
  kycStatusLabel,
  rejectProviderKyc,
  type ProviderKyc,
} from '../data/providerKyc'
import {
  fetchProviderBookingStats,
  fetchProviders,
  setProviderActive,
  setProviderVerified,
  type Provider,
  type ProviderBookingStats,
} from '../data/providers'
import { Icon } from './Icon'

type AdminPanelProps = {
  user: User
  onCategoriesChanged: () => Promise<void>
  onProvidersChanged: () => Promise<void>
  onSignOut: () => Promise<void>
}

type AdminTab = 'categories' | 'providers' | 'bookings' | 'payouts'
type BookingOpsFilter = 'all' | 'in_progress' | 'remaining' | 'refunds'

const emptyForm: ServiceCategoryInput = {
  name: '',
  description: '',
  icon: 'wrench',
  sortOrder: 200,
  isActive: true,
}

function idTypeLabel(idType: ProviderKyc['idType']): string {
  return idTypeOptions.find((option) => option.value === idType)?.label ?? idType
}

export function AdminPanel({ user, onCategoriesChanged, onProvidersChanged, onSignOut }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('categories')
  const [rows, setRows] = useState<ServiceCategory[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [bookingStatsById, setBookingStatsById] = useState<Record<string, ProviderBookingStats>>({})
  const [kycByUserId, setKycByUserId] = useState<Record<string, ProviderKyc>>({})
  const [payoutRows, setPayoutRows] = useState<BookingPayoutRow[]>([])
  const [adminBookings, setAdminBookings] = useState<AdminBookingRow[]>([])
  const [platformSummary, setPlatformSummary] = useState<AdminPlatformSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [form, setForm] = useState<ServiceCategoryInput>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null)
  const [busyActiveId, setBusyActiveId] = useState<string | null>(null)
  const [busyKycUserId, setBusyKycUserId] = useState<string | null>(null)
  const [busyPayoutId, setBusyPayoutId] = useState<string | null>(null)
  const [busyRefundId, setBusyRefundId] = useState<string | null>(null)
  const [bookingOpsFilter, setBookingOpsFilter] = useState<BookingOpsFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const refreshCategories = async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchServiceCategories(true))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load categories')
    } finally {
      setLoading(false)
    }
  }

  const refreshProviders = async () => {
    setProvidersLoading(true)
    setError(null)
    try {
      const [providerRows, kycRows, statsMap] = await Promise.all([
        fetchProviders(),
        fetchAllProviderKyc(),
        fetchProviderBookingStats(),
      ])
      setProviders(providerRows)
      const mapped: Record<string, ProviderKyc> = {}
      for (const row of kycRows) mapped[row.userId] = row
      setKycByUserId(mapped)
      setBookingStatsById(statsMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load providers')
    } finally {
      setProvidersLoading(false)
    }
  }

  const refreshPayouts = async () => {
    setPayoutsLoading(true)
    setError(null)
    try {
      setPayoutRows(await fetchAdminBookingPayouts(80))
      try {
        setPlatformSummary(await fetchAdminPlatformSummary())
      } catch {
        setPlatformSummary(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payouts')
    } finally {
      setPayoutsLoading(false)
    }
  }

  const refreshAdminBookings = async () => {
    setBookingsLoading(true)
    setError(null)
    try {
      setAdminBookings(await fetchAdminBookings(100))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings')
    } finally {
      setBookingsLoading(false)
    }
  }

  const visibleAdminBookings = useMemo(() => {
    return adminBookings.filter((row) => {
      if (bookingOpsFilter === 'refunds') return row.refundRequested && !row.refundHandledAt
      if (bookingOpsFilter === 'remaining') return row.status === 'completed' && row.paymentStatus === 'deposit_paid'
      if (bookingOpsFilter === 'in_progress') return Boolean(row.workStartedAt) && row.status === 'accepted'
      return true
    })
  }, [adminBookings, bookingOpsFilter])

  useEffect(() => {
    void refreshCategories()
  }, [])

  useEffect(() => {
    if (tab === 'providers') void refreshProviders()
    if (tab === 'payouts') void refreshPayouts()
    if (tab === 'bookings') void refreshAdminBookings()
  }, [tab])

  const handleMarkPayoutManual = async (row: BookingPayoutRow) => {
    const note = window.prompt(
      `Confirm you already transferred ${formatMoney(row.remainingAmount)} to:\n${row.payoutDestination || 'the provider’s saved UPI/bank'}\n\nOptional note (UPI ref / UTR):`,
      '',
    )
    if (note === null) return

    setBusyPayoutId(row.bookingId)
    setError(null)
    setInfo(null)
    try {
      await markProviderPayoutManualPaid(row.bookingId, note)
      setInfo(`Marked ${row.providerName} payout as paid (manual transfer).`)
      await refreshPayouts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark payout paid')
    } finally {
      setBusyPayoutId(null)
    }
  }

  const handleRetryPayout = async (row: BookingPayoutRow) => {
    setBusyPayoutId(row.bookingId)
    setError(null)
    setInfo(null)
    try {
      const result = await retryProviderPayout(row.bookingId)
      if (result.ok || result.alreadyPaid) {
        setInfo(
          result.alreadyPaid
            ? `Payout already recorded for ${row.providerName} (${row.bookingId.slice(0, 8)}…).`
            : `Payout submitted for ${row.providerName} (${formatMoney(row.remainingAmount)}).`,
        )
      } else if (result.error) {
        setError(result.error)
      }
      await refreshPayouts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry payout')
      await refreshPayouts()
    } finally {
      setBusyPayoutId(null)
    }
  }

  const handleMarkRefundHandled = async (row: AdminBookingRow) => {
    if (
      !window.confirm(
        `Confirm you already refunded this Razorpay payment for ${row.providerName} (${row.bookingId.slice(0, 8)}…).`,
      )
    ) {
      return
    }
    setBusyRefundId(row.bookingId)
    setError(null)
    setInfo(null)
    try {
      await markBookingRefundHandled(row.bookingId)
      setInfo(`Marked refund handled for ${row.providerName}.`)
      await refreshAdminBookings()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark refund handled')
    } finally {
      setBusyRefundId(null)
    }
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
  }

  const startEdit = (category: ServiceCategory) => {
    setEditingId(category.id)
    setForm({
      id: category.id,
      name: category.name,
      description: category.description,
      icon: category.icon,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    })
    setInfo(null)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    if (!form.name.trim()) {
      setError('Enter a category name')
      return
    }

    setBusy(true)
    try {
      if (editingId) {
        await updateServiceCategory(editingId, form)
        setInfo(`Updated “${form.name.trim()}”.`)
      } else {
        const created = await createServiceCategory({
          ...form,
          id: slugifyCategoryId(form.name),
        })
        setInfo(`Added “${created.name}”.`)
      }
      resetForm()
      await refreshCategories()
      await onCategoriesChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save category')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (category: ServiceCategory) => {
    setBusy(true)
    setError(null)
    try {
      await setServiceCategoryActive(category.id, !category.isActive)
      await refreshCategories()
      await onCategoriesChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update category')
    } finally {
      setBusy(false)
    }
  }

  const toggleVerified = async (provider: Provider) => {
    setBusyProviderId(provider.id)
    setError(null)
    setInfo(null)
    try {
      const next = !provider.isVerified
      if (next) {
        const ownerId = provider.userId
        const kyc = ownerId ? kycByUserId[ownerId] : undefined
        if (!isKycSubmitted(kyc ?? null)) {
          throw new Error(
            kyc?.status === 'rejected'
              ? 'KYC was rejected. Ask the provider to resubmit ID details before verifying.'
              : 'Provider must submit national ID (KYC) before you can mark them verified.',
          )
        }
      }
      await setProviderVerified(provider.id, next)
      setInfo(next ? `Verified “${provider.name}”.` : `Removed verification from “${provider.name}”.`)
      await refreshProviders()
      await onProvidersChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update verification')
    } finally {
      setBusyProviderId(null)
    }
  }

  const toggleProviderActive = async (provider: Provider) => {
    setBusyActiveId(provider.id)
    setError(null)
    setInfo(null)
    try {
      const next = !provider.isActive
      await setProviderActive(provider.id, next)
      setInfo(
        next
          ? `Reactivated “${provider.name}” — visible in customer browse again.`
          : `Deactivated “${provider.name}” — hidden from customer browse.`,
      )
      await refreshProviders()
      await onProvidersChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update listing status')
    } finally {
      setBusyActiveId(null)
    }
  }

  const handleRejectKyc = async (provider: Provider) => {
    const ownerId = provider.userId
    if (!ownerId) {
      setError('This listing has no linked account, so KYC cannot be rejected.')
      return
    }
    const kyc = kycByUserId[ownerId]
    if (!kyc) {
      setError('No KYC on file for this provider.')
      return
    }
    const reason =
      window.prompt('Optional rejection reason (shown to the provider):', kyc.rejectionReason || '') ?? null
    if (reason === null) return

    setBusyKycUserId(ownerId)
    setError(null)
    setInfo(null)
    try {
      await rejectProviderKyc(ownerId, reason.trim())
      setInfo(`Rejected KYC for “${provider.name}”.`)
      await refreshProviders()
      await onProvidersChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject KYC')
    } finally {
      setBusyKycUserId(null)
    }
  }

  return (
    <div className="admin-panel">
      <div className="account-bar">
        <div>
          <p className="dashboard-kicker">Admin</p>
          <p>
            Signed in as <strong>{user.email ?? user.phone ?? 'admin'}</strong>
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>

      <div className="dashboard-tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          role="tab"
          className={`dashboard-tab ${tab === 'categories' ? 'active' : ''}`}
          aria-selected={tab === 'categories'}
          onClick={() => setTab('categories')}
        >
          Categories
        </button>
        <button
          type="button"
          role="tab"
          className={`dashboard-tab ${tab === 'providers' ? 'active' : ''}`}
          aria-selected={tab === 'providers'}
          onClick={() => setTab('providers')}
        >
          Providers ({providers.length || '…'})
        </button>
        <button
          type="button"
          role="tab"
          className={`dashboard-tab ${tab === 'bookings' ? 'active' : ''}`}
          aria-selected={tab === 'bookings'}
          onClick={() => setTab('bookings')}
        >
          Bookings
        </button>
        <button
          type="button"
          role="tab"
          className={`dashboard-tab ${tab === 'payouts' ? 'active' : ''}`}
          aria-selected={tab === 'payouts'}
          onClick={() => setTab('payouts')}
        >
          Payouts
        </button>
      </div>

      {error && <p className="field-error auth-message">{error}</p>}
      {info && (
        <p className="success-banner auth-message" role="status">
          {info}
        </p>
      )}

      {tab === 'categories' && (
        <>
          <p className="panel-sub">
            Add or edit service categories shown on the landing page and in booking filters. Inactive categories are
            hidden from customers and providers.
          </p>

          <form className="booking-form" onSubmit={handleSubmit} noValidate>
            <h3 className="panel-title">{editingId ? 'Edit category' : 'Add category'}</h3>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="cat-name">Name</label>
                <input
                  id="cat-name"
                  value={form.name}
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="e.g. Solar install"
                />
              </div>
              <div className="field">
                <label htmlFor="cat-sort">Sort order</label>
                <input
                  id="cat-sort"
                  inputMode="numeric"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((current) => ({ ...current, sortOrder: Number(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="field full">
                <label htmlFor="cat-desc">Short description</label>
                <input
                  id="cat-desc"
                  value={form.description}
                  onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                  placeholder="Shown under the category name"
                />
              </div>
              <div className="field">
                <label htmlFor="cat-icon">Icon</label>
                <select
                  id="cat-icon"
                  value={form.icon}
                  onChange={(e) => setForm((current) => ({ ...current, icon: e.target.value }))}
                >
                  {categoryIconOptions.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cat-active">Status</label>
                <select
                  id="cat-active"
                  value={form.isActive ? 'active' : 'inactive'}
                  onChange={(e) => setForm((current) => ({ ...current, isActive: e.target.value === 'active' }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editingId ? 'Update category' : 'Add category'}
              </button>
              {editingId && (
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  Cancel edit
                </button>
              )}
              <span className="category-icon admin-icon-preview" aria-hidden>
                <Icon name={form.icon} />
              </span>
            </div>
          </form>

          <div className="booking-history-head" style={{ marginTop: '1.25rem' }}>
            <h3 className="panel-title">All categories ({rows.length})</h3>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void refreshCategories()}>
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="form-note">Loading categories…</p>
          ) : (
            <div className="provider-list">
              {rows.map((category) => (
                <article key={category.id} className="provider-item">
                  <div className="admin-category-row">
                    <span className="category-icon">
                      <Icon name={category.icon} />
                    </span>
                    <div>
                      <h4>
                        {category.name}{' '}
                        <span className={`status-pill ${category.isActive ? 'status-accepted' : 'status-cancelled'}`}>
                          {category.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </h4>
                      <p>{category.description || 'No description'}</p>
                      <p className="provider-meta">
                        id: {category.id} · sort {category.sortOrder} · icon {category.icon}
                      </p>
                    </div>
                  </div>
                  <div className="provider-item-actions">
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => startEdit(category)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={busy}
                      onClick={() => void toggleActive(category)}
                    >
                      {category.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'providers' && (
        <>
          <p className="panel-sub">
            Mark trusted listings as <strong>Verified</strong> only after the provider submits national ID (KYC).
            Deactivate to hide a listing from customer browse without deleting it. Booking counts are live from the
            bookings table.
          </p>

          <div className="booking-history-head">
            <h3 className="panel-title">
              Provider listings ({providers.filter((p) => p.isVerified).length} verified /{' '}
              {providers.filter((p) => p.isActive).length} active / {providers.length})
            </h3>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void refreshProviders()}>
              Refresh
            </button>
          </div>

          {providersLoading ? (
            <p className="form-note">Loading providers…</p>
          ) : providers.length === 0 ? (
            <p className="form-note">No provider listings yet.</p>
          ) : (
            <div className="provider-list">
              {providers.map((provider) => {
                const kyc = provider.userId ? kycByUserId[provider.userId] : undefined
                const canVerify = isKycSubmitted(kyc ?? null)
                const verifyBlocked = !provider.isVerified && !canVerify
                const stats = bookingStatsById[provider.id]
                const closedCount = (stats?.rejected ?? 0) + (stats?.cancelled ?? 0)

                return (
                  <article key={provider.id} className="provider-item">
                    <div>
                      <h4>
                        {provider.name}{' '}
                        <span
                          className={`status-pill ${provider.isActive ? 'status-accepted' : 'status-cancelled'}`}
                        >
                          {provider.isActive ? 'Active' : 'Inactive'}
                        </span>{' '}
                        {provider.isVerified && <span className="verified-badge">Verified</span>}
                      </h4>
                      <p>
                        {provider.service} · from {provider.quote}
                      </p>
                      <p className="provider-meta">
                        ★ {provider.rating.toFixed(1)}
                        {provider.ratingCount > 0 ? ` (${provider.ratingCount})` : ''} · {provider.bookings} booking
                        {provider.bookings === 1 ? '' : 's'}
                        {provider.isVerified && provider.verifiedAt
                          ? ` · verified ${new Date(provider.verifiedAt).toLocaleDateString('en-IN')}`
                          : ''}
                      </p>
                      <p className="provider-meta admin-booking-stats">
                        Bookings:{' '}
                        {stats ? (
                          <>
                            <strong>{stats.total}</strong> total · {stats.pending} pending · {stats.accepted} accepted ·{' '}
                            {stats.completed} completed · {closedCount} cancelled/rejected
                          </>
                        ) : (
                          <strong>—</strong>
                        )}
                      </p>
                      <p className="provider-meta">
                        KYC:{' '}
                        {kyc ? (
                          <>
                            <strong>{kycStatusLabel(kyc.status)}</strong> · {idTypeLabel(kyc.idType)} ·{' '}
                            {kyc.idNumber} · {kyc.idHolderName}
                            {kyc.status === 'rejected' && kyc.rejectionReason
                              ? ` · reason: ${kyc.rejectionReason}`
                              : ''}
                          </>
                        ) : (
                          <strong>Not submitted</strong>
                        )}
                      </p>
                      {verifyBlocked && (
                        <p className="form-note">
                          {kyc?.status === 'rejected'
                            ? 'Cannot mark verified until the provider resubmits KYC.'
                            : 'Cannot mark verified until the provider submits national ID under KYC.'}
                        </p>
                      )}
                      {!provider.isActive && (
                        <p className="form-note">Hidden from customer browse. Owner can still see it as Inactive.</p>
                      )}
                    </div>
                    <div className="provider-item-actions">
                      <button
                        type="button"
                        className={`btn btn-small ${provider.isActive ? 'btn-secondary' : 'btn-primary'}`}
                        disabled={busyActiveId === provider.id}
                        onClick={() => void toggleProviderActive(provider)}
                      >
                        {busyActiveId === provider.id
                          ? '…'
                          : provider.isActive
                            ? 'Deactivate'
                            : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-small ${provider.isVerified ? 'btn-secondary' : 'btn-primary'}`}
                        disabled={busyProviderId === provider.id || verifyBlocked}
                        onClick={() => void toggleVerified(provider)}
                        title={
                          verifyBlocked
                            ? 'Provider must submit KYC (status submitted or verified) first'
                            : undefined
                        }
                      >
                        {busyProviderId === provider.id
                          ? '…'
                          : provider.isVerified
                            ? 'Remove verified'
                            : 'Mark verified'}
                      </button>
                      {kyc && kyc.status !== 'rejected' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={busyKycUserId === provider.userId}
                          onClick={() => void handleRejectKyc(provider)}
                        >
                          {busyKycUserId === provider.userId ? '…' : 'Reject KYC'}
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'bookings' && (
        <>
          <div className="account-bar">
            <div>
              <h3 className="panel-title">All bookings</h3>
              <p className="panel-sub">Operations view of status, payment, start time, and job address. Payouts stay on the Payouts tab.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void refreshAdminBookings()}>
                Refresh
              </button>
              {adminBookings.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => downloadAdminBookingsCsv(visibleAdminBookings)}
                >
                  Export CSV
                </button>
              )}
            </div>
          </div>
          <div className="booking-ops-filters" role="group" aria-label="Filter bookings">
            {(
              [
                ['all', 'All'],
                ['in_progress', 'In progress'],
                ['remaining', '90% due'],
                ['refunds', 'Refunds'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-small ${bookingOpsFilter === id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setBookingOpsFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {bookingsLoading ? (
            <p className="form-note">Loading bookings…</p>
          ) : adminBookings.length === 0 ? (
            <p className="form-note">No bookings yet.</p>
          ) : visibleAdminBookings.length === 0 ? (
            <p className="form-note">No bookings match this filter.</p>
          ) : (
            <div className="provider-list">
              {visibleAdminBookings.map((row) => (
                <article key={row.bookingId} className="provider-item">
                  <div>
                    <h4>
                      {row.providerName}{' '}
                      <span className={`status-pill status-${row.status}`}>{row.status}</span>
                      {row.refundRequested && !row.refundHandledAt ? (
                        <span className="status-pill status-cancelled">Refund requested</span>
                      ) : null}
                      {row.refundHandledAt ? <span className="status-pill status-accepted">Refund handled</span> : null}
                    </h4>
                    <p>
                      {formatMoney(row.quoteAmount)} · {row.bookingType}
                      {row.scheduledAt ? ` · ${new Date(row.scheduledAt).toLocaleString('en-IN')}` : ''}
                    </p>
                    <p className="provider-meta">
                      {paymentStatusLabel(
                        (['unpaid', 'deposit_paid', 'fully_paid'] as PaymentStatus[]).includes(
                          row.paymentStatus as PaymentStatus,
                        )
                          ? (row.paymentStatus as PaymentStatus)
                          : 'unpaid',
                      )}{' '}
                      ·{' '}
                      {payoutStatusLabel(
                        (['not_due', 'pending', 'paid', 'failed'] as PayoutStatus[]).includes(
                          row.payoutStatus as PayoutStatus,
                        )
                          ? (row.payoutStatus as PayoutStatus)
                          : 'not_due',
                      )}{' '}
                      · booking {row.bookingId.slice(0, 8)}…
                    </p>
                    {row.workStartedAt ? (
                      <p className="form-note">
                        Started {new Date(row.workStartedAt).toLocaleString('en-IN')}
                        {row.customerCompleted ? ' · customer marked completed' : ''}
                      </p>
                    ) : row.customerCompleted ? (
                      <p className="form-note">Customer marked completed (legacy job, no start OTP)</p>
                    ) : null}
                    {row.jobAddress ? <p className="booking-notes">{row.jobAddress}</p> : null}
                    <p className="form-note">{new Date(row.createdAt).toLocaleString('en-IN')}</p>
                  </div>
                  {row.refundRequested && !row.refundHandledAt ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={busyRefundId === row.bookingId}
                      onClick={() => void handleMarkRefundHandled(row)}
                    >
                      {busyRefundId === row.bookingId ? '…' : 'Mark refund handled'}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'payouts' && (
        <>
          <div className="account-bar">
            <div>
              <h3 className="panel-title">Provider payouts</h3>
              <p className="panel-sub">
                After the customer pays the remaining 90%, transfer that amount from your bank/UPI to the destination
                shown, then tap <strong>Mark paid (manual)</strong>. RazorpayX automatic payouts are unavailable on an
                individual Razorpay account — Retry is only for later if X is approved.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void refreshPayouts()}>
                Refresh
              </button>
              {payoutRows.length > 0 && (
                <button type="button" className="btn btn-secondary btn-small" onClick={() => downloadPayoutsCsv(payoutRows)}>
                  Export CSV
                </button>
              )}
            </div>
          </div>

          {platformSummary && (
            <div className="earnings-grid" style={{ marginBottom: '1.25rem' }}>
              <article className="earnings-card">
                <p className="earnings-label">HomeFix 10% collected</p>
                <p className="earnings-value">{formatMoney(platformSummary.platformFeesCollected)}</p>
                <p className="form-note">
                  {platformSummary.fullyPaidCount} fully paid · {platformSummary.depositPaidOpen} deposit-only
                </p>
              </article>
              <article className="earnings-card muted">
                <p className="earnings-label">Provider 90% pipeline</p>
                <p className="earnings-value">{formatMoney(platformSummary.payoutsPendingAmount)}</p>
                <p className="form-note">
                  Paid out: {formatMoney(platformSummary.payoutsPaidAmount)} · {platformSummary.bookingsTotal} bookings
                </p>
              </article>
            </div>
          )}

          {payoutsLoading ? (
            <p className="form-note">Loading payouts…</p>
          ) : payoutRows.length === 0 ? (
            <p className="form-note">No fully paid bookings with payout activity yet.</p>
          ) : (
            <div className="provider-list">
              {payoutRows.map((row) => {
                const canRetry = row.payoutStatus === 'pending' || row.payoutStatus === 'failed'
                return (
                  <article key={row.bookingId} className="provider-item">
                    <div>
                      <h4>
                        {row.providerName}{' '}
                        <span
                          className={`status-pill ${
                            row.payoutStatus === 'paid'
                              ? 'status-accepted'
                              : row.payoutStatus === 'failed'
                                ? 'status-cancelled'
                                : 'status-pending'
                          }`}
                        >
                          {payoutStatusLabel(row.payoutStatus)}
                        </span>
                      </h4>
                      <p>
                        {formatMoney(row.remainingAmount)} · booking {row.bookingId.slice(0, 8)}…
                      </p>
                      {row.payoutDestination ? <p className="provider-meta">Pay to: {row.payoutDestination}</p> : null}
                      <p className="provider-meta">
                        Remaining paid:{' '}
                        {row.remainingPaidAt
                          ? new Date(row.remainingPaidAt).toLocaleString('en-IN')
                          : '—'}
                        {row.razorpayPayoutId ? ` · payout ${row.razorpayPayoutId}` : ''}
                      </p>
                      {row.payoutError && <p className="field-error">{row.payoutError}</p>}
                    </div>
                    <div className="provider-item-actions">
                      {canRetry && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={busyPayoutId === row.bookingId}
                            onClick={() => void handleMarkPayoutManual(row)}
                          >
                            {busyPayoutId === row.bookingId ? '…' : 'Mark paid (manual)'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={busyPayoutId === row.bookingId}
                            onClick={() => void handleRetryPayout(row)}
                            title="Needs RazorpayX — will fail on an individual account"
                          >
                            {busyPayoutId === row.bookingId ? '…' : 'Retry RazorpayX'}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** @deprecated use AdminPanel */
export const AdminCategoriesPanel = AdminPanel
