export type Provider = {
  id: string
  name: string
  service: string
  quote: string
  contact: string
  bookings: number
  createdAt: string
}

const STORAGE_KEY = 'homefix-providers'

export function loadProviders(): Provider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Provider[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveProviders(providers: Provider[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers))
}

export function addProvider(
  input: Omit<Provider, 'id' | 'bookings' | 'createdAt'>,
): Provider {
  const providers = loadProviders()
  const provider: Provider = {
    ...input,
    id: crypto.randomUUID(),
    bookings: 0,
    createdAt: new Date().toISOString(),
  }
  providers.unshift(provider)
  saveProviders(providers)
  return provider
}

export function totalBookings(providers: Provider[]): number {
  return providers.reduce((sum, p) => sum + p.bookings, 0)
}
