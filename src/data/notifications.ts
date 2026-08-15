import { supabase } from '../lib/supabase'

export type AppNotification = {
  id: string
  userId: string
  type: 'booking_request' | 'booking_update' | 'booking_accepted'
  title: string
  body: string
  bookingId: string | null
  readAt: string | null
  createdAt: string
}

type NotificationRow = {
  id: string
  user_id: string
  type: 'booking_request' | 'booking_update' | 'booking_accepted'
  title: string
  body: string
  booking_id: string | null
  read_at: string | null
  created_at: string
}

function formatError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(error.hint)
  if (error.code) parts.push(`(${error.code})`)
  return parts.filter(Boolean).join(' — ')
}

function mapRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    bookingId: row.booking_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

export async function fetchMyNotifications(userId: string, limit = 20): Promise<AppNotification[]> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, type, title, body, booking_id, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(formatError(error))
  return ((data ?? []) as NotificationRow[]).map(mapRow)
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null)

  if (error) throw new Error(formatError(error))
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)

  if (error) throw new Error(formatError(error))
}

export function unreadCount(notifications: AppNotification[]): number {
  return notifications.filter((n) => !n.readAt).length
}

/** Subscribe to new notifications for this user. Returns an unsubscribe function. */
export function subscribeToNotifications(
  userId: string,
  onInsert: (notification: AppNotification) => void,
): () => void {
  if (!supabase) return () => {}

  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        onInsert(mapRow(payload.new as NotificationRow))
      },
    )
    .subscribe()

  return () => {
    void supabase?.removeChannel(channel)
  }
}

export function maybeShowBrowserNotification(notification: AppNotification): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return

  try {
    new Notification(notification.title, {
      body: notification.body,
      tag: notification.id,
    })
  } catch {
    // Ignore browser notification failures
  }
}

export async function ensureBrowserNotificationPermission(): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      // Ignore
    }
  }
}
