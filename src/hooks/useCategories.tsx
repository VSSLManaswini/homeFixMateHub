import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  activeServiceOptions,
  defaultCategories,
  fetchServiceCategories,
  type ServiceCategory,
} from '../data/categories'
import { useAuth } from './useAuth'

type CategoriesContextValue = {
  categories: ServiceCategory[]
  activeCategories: ServiceCategory[]
  serviceOptions: string[]
  loading: boolean
  refresh: (includeInactive?: boolean) => Promise<void>
}

const CategoriesContext = createContext<CategoriesContextValue | null>(null)

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const { configured } = useAuth()
  const [categories, setCategories] = useState<ServiceCategory[]>(defaultCategories)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (includeInactive = false) => {
    if (!configured) {
      setCategories(defaultCategories)
      return
    }
    setLoading(true)
    try {
      setCategories(await fetchServiceCategories(includeInactive))
    } catch {
      setCategories(defaultCategories)
    } finally {
      setLoading(false)
    }
  }, [configured])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  const value = useMemo<CategoriesContextValue>(() => {
    const activeCategories = categories.filter((c) => c.isActive)
    return {
      categories,
      activeCategories,
      serviceOptions: activeServiceOptions(categories),
      loading,
      refresh,
    }
  }, [categories, loading, refresh])

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
}

export function useCategories() {
  const ctx = useContext(CategoriesContext)
  if (!ctx) {
    return {
      categories: defaultCategories,
      activeCategories: defaultCategories,
      serviceOptions: defaultCategories.map((c) => c.name),
      loading: false,
      refresh: async () => {},
    } satisfies CategoriesContextValue
  }
  return ctx
}
