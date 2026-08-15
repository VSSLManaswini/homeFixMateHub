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
import { fetchProviders, setProviderVerified, type Provider } from '../data/providers'
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

export function AdminPanel({ user, onCategoriesChanged, onProvidersChanged, onSignOut }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('categories')
  const [rows, setRows] = useState<ServiceCategory[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [form, setForm] = useState<ServiceCategoryInput>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null)
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
      setProviders(await fetchProviders())
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
            Mark trusted listings as <strong>Verified</strong>. Receivers see a badge on browse and booking screens.
          </p>

          <div className="booking-history-head">
            <h3 className="panel-title">
              Provider listings ({providers.filter((p) => p.isVerified).length} verified / {providers.length})
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
              {providers.map((provider) => (
                <article key={provider.id} className="provider-item">
                  <div>
                    <h4>
                      {provider.name}{' '}
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
                  </div>
                  <div className="provider-item-actions">
                    <button
                      type="button"
                      className={`btn btn-small ${provider.isVerified ? 'btn-secondary' : 'btn-primary'}`}
                      disabled={busyProviderId === provider.id}
                      onClick={() => void toggleVerified(provider)}
                    >
                      {busyProviderId === provider.id
                        ? '…'
                        : provider.isVerified
                          ? 'Remove verified'
                          : 'Mark verified'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** @deprecated use AdminPanel */
export const AdminCategoriesPanel = AdminPanel
