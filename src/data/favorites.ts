import { supabase } from '../lib/supabase'

function formatError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(error.hint)
  if (error.code) parts.push(`(${error.code})`)
  return parts.filter(Boolean).join(' — ')
}

export async function fetchFavoriteProviderIds(userId: string): Promise<Set<string>> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('favorites')
    .select('provider_id')
    .eq('user_id', userId)

  if (error) throw new Error(formatError(error))
  return new Set((data ?? []).map((row) => row.provider_id as string))
}

export async function addFavorite(userId: string, providerId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase.from('favorites').insert({
    user_id: userId,
    provider_id: providerId,
  })

  if (error) {
    // Already favorited — treat as success
    if (error.code === '23505') return
    throw new Error(formatError(error))
  }
}

export async function removeFavorite(userId: string, providerId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', userId)
    .eq('provider_id', providerId)

  if (error) throw new Error(formatError(error))
}

export async function toggleFavorite(
  userId: string,
  providerId: string,
  currentlySaved: boolean,
): Promise<boolean> {
  if (currentlySaved) {
    await removeFavorite(userId, providerId)
    return false
  }
  await addFavorite(userId, providerId)
  return true
}
