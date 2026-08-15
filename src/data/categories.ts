import { supabase } from '../lib/supabase'

export type ServiceCategory = {
  id: string
  name: string
  description: string
  icon: string
  sortOrder: number
  isActive: boolean
}

export type ServiceCategoryInput = {
  id?: string
  name: string
  description: string
  icon: string
  sortOrder: number
  isActive: boolean
}

/** Fallback when Supabase is offline or not seeded yet */
export const defaultCategories: ServiceCategory[] = [
  { id: 'plumbing', name: 'Plumbing', description: 'Leaks, fittings, drains', icon: 'pipe', sortOrder: 10, isActive: true },
  { id: 'electrical', name: 'Electrical', description: 'Wiring, switches, safety', icon: 'bolt', sortOrder: 20, isActive: true },
  { id: 'kitchen', name: 'Kitchen', description: 'Repairs & upgrades', icon: 'kitchen', sortOrder: 30, isActive: true },
  { id: 'appliances', name: 'Appliances', description: 'AC, fridge, washer, TV', icon: 'appliance', sortOrder: 40, isActive: true },
  { id: 'cleaning', name: 'Cleaning', description: 'Home deep cleans', icon: 'sparkle', sortOrder: 50, isActive: true },
  { id: 'painting', name: 'Painting', description: 'Interior & exterior', icon: 'paint', sortOrder: 60, isActive: true },
  { id: 'carpentry', name: 'Carpentry', description: 'Furniture & fittings', icon: 'hammer', sortOrder: 70, isActive: true },
  { id: 'pest', name: 'Pest control', description: 'Safe home treatment', icon: 'shield', sortOrder: 80, isActive: true },
  { id: 'purifier', name: 'Water purifier', description: 'Install & service', icon: 'droplet', sortOrder: 90, isActive: true },
  { id: 'chimney', name: 'Gas & chimney', description: 'Stove & hood care', icon: 'flame', sortOrder: 100, isActive: true },
  { id: 'maintenance', name: 'Maintenance', description: 'Indoor & outdoor', icon: 'wrench', sortOrder: 110, isActive: true },
  { id: 'gardening', name: 'Gardening', description: 'Lawn & plant care', icon: 'leaf', sortOrder: 120, isActive: true },
  { id: 'cctv', name: 'CCTV & security', description: 'Install & monitor', icon: 'camera', sortOrder: 130, isActive: true },
  { id: 'internet', name: 'Wi‑Fi setup', description: 'Routers & networks', icon: 'wifi', sortOrder: 140, isActive: true },
  { id: 'moving', name: 'Moving', description: 'Pack & shift', icon: 'truck', sortOrder: 150, isActive: true },
  { id: 'laundry', name: 'Laundry', description: 'Wash & fold', icon: 'shirt', sortOrder: 160, isActive: true },
  { id: 'beauty', name: 'Beauty at home', description: 'Wellness visits', icon: 'spa', sortOrder: 170, isActive: true },
  { id: 'care', name: 'Care services', description: 'Babysitting & elders', icon: 'heart', sortOrder: 180, isActive: true },
  { id: 'tuition', name: 'Home tuition', description: 'Teaching at home', icon: 'book', sortOrder: 190, isActive: true },
]

/** @deprecated use defaultCategories / fetch — kept for older imports */
export const categories = defaultCategories
export const serviceOptions = defaultCategories.map((c) => c.name)

export const categoryIconOptions = [
  'pipe',
  'bolt',
  'kitchen',
  'appliance',
  'sparkle',
  'paint',
  'hammer',
  'shield',
  'droplet',
  'flame',
  'wrench',
  'leaf',
  'camera',
  'wifi',
  'truck',
  'shirt',
  'spa',
  'heart',
  'book',
  'home',
] as const

type CategoryRow = {
  id: string
  name: string
  description: string
  icon: string
  sort_order: number
  is_active: boolean
}

function formatError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(error.hint)
  if (error.code) parts.push(`(${error.code})`)
  return parts.filter(Boolean).join(' — ')
}

function mapRow(row: CategoryRow): ServiceCategory {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon || 'wrench',
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
  }
}

export function slugifyCategoryId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function activeServiceOptions(categoriesList: ServiceCategory[]): string[] {
  return categoriesList.filter((c) => c.isActive).map((c) => c.name)
}

export async function fetchServiceCategories(includeInactive = false): Promise<ServiceCategory[]> {
  if (!supabase) return defaultCategories

  let query = supabase
    .from('service_categories')
    .select('id, name, description, icon, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) {
    console.warn('categories fetch failed, using defaults', error.message)
    return defaultCategories
  }

  const rows = ((data ?? []) as CategoryRow[]).map(mapRow)
  return rows.length > 0 ? rows : defaultCategories
}

export async function checkIsAppAdmin(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('is_app_admin')
  if (error) return false
  return Boolean(data)
}

export async function createServiceCategory(input: ServiceCategoryInput): Promise<ServiceCategory> {
  if (!supabase) throw new Error('Supabase is not configured')

  const id = (input.id?.trim() || slugifyCategoryId(input.name)) || `cat-${Date.now()}`
  const payload = {
    id,
    name: input.name.trim(),
    description: input.description.trim(),
    icon: input.icon || 'wrench',
    sort_order: input.sortOrder,
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase.from('service_categories').insert(payload).select('*').single()
  if (error) throw new Error(formatError(error))
  return mapRow(data as CategoryRow)
}

export async function updateServiceCategory(
  id: string,
  input: ServiceCategoryInput,
): Promise<ServiceCategory> {
  if (!supabase) throw new Error('Supabase is not configured')

  const payload = {
    name: input.name.trim(),
    description: input.description.trim(),
    icon: input.icon || 'wrench',
    sort_order: input.sortOrder,
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('service_categories')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw new Error(formatError(error))
  return mapRow(data as CategoryRow)
}

export async function setServiceCategoryActive(id: string, isActive: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('service_categories')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(formatError(error))
}
