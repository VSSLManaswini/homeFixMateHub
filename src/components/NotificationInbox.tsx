import { useState } from 'react'
import { unreadCount, type AppNotification } from '../data/notifications'

type NotificationInboxProps = {
  notifications: AppNotification[]
  onMarkRead?: () => void
  previewLimit?: number
}

export function NotificationInbox({
  notifications,
  onMarkRead,
  previewLimit = 8,
}: NotificationInboxProps) {
  const [expanded, setExpanded] = useState(false)
  const unread = unreadCount(notifications)
  const visible = expanded ? notifications : notifications.slice(0, previewLimit)
  const hidden = Math.max(notifications.length - visible.length, 0)

  if (notifications.length === 0) return null

  return (
    <div className="notif-panel" style={{ marginBottom: '1rem' }}>
      <div className="booking-history-head">
        <h4>
          Notifications
          {unread > 0 ? ` (${unread} new)` : ''}
        </h4>
        {unread > 0 && onMarkRead && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void onMarkRead()}>
            Mark read
          </button>
        )}
      </div>
      <ul className="notif-list">
        {visible.map((item) => (
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
      {hidden > 0 && (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      )}
      {expanded && notifications.length > previewLimit && (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </div>
  )
}
