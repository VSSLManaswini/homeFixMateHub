import { useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
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

type AdminTab = 'categories' | 'providers'

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
  const [loading, setLoading] = useState(true)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [form, setForm] = useState<ServiceCategoryInput>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null)
  const [busyActiveId, setBusyActiveId] = useState<string | null>(null)
  const [busyKycUserId, setBusyKycUserId] = useState<string | null>(null)
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

  useEffect(() => {
    void refreshCategories()
  }, [])

  useEffect(() => {
    if (tab === 'providers') void refreshProviders()
  }, [tab])

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
    </div>
  )
}

/** @deprecated use AdminPanel */
export const AdminCategoriesPanel = AdminPanel
