import { contactsUnlocked, jobHasStarted, type Booking } from '../data/bookings'

const steps = [
  { id: 'requested', label: 'Requested' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'deposit', label: '10% paid' },
  { id: 'started', label: 'Work started' },
  { id: 'done', label: 'Completed' },
  { id: 'paid', label: '90% paid' },
] as const

function isDone(booking: Booking, id: (typeof steps)[number]['id']): boolean {
  if (booking.status === 'rejected' || booking.status === 'cancelled') {
    return id === 'requested'
  }
  switch (id) {
    case 'requested':
      return true
    case 'accepted':
      return booking.status !== 'pending'
    case 'deposit':
      return contactsUnlocked(booking)
    case 'started':
      return jobHasStarted(booking)
    case 'done':
      return booking.status === 'completed' || booking.customerCompleted
    case 'paid':
      return booking.paymentStatus === 'fully_paid'
  }
}

export function JobTimeline({ booking }: { booking: Booking }) {
  const firstOpen = steps.findIndex((step) => !isDone(booking, step.id))
  const stopped = booking.status === 'rejected' || booking.status === 'cancelled'

  return (
    <ol className="job-timeline" aria-label="Job progress">
      {steps.map((step, index) => {
        const done = isDone(booking, step.id)
        const current = !stopped && !done && index === firstOpen
        return (
          <li
            key={step.id}
            className={`job-timeline-step${done ? ' done' : ''}${current ? ' current' : ''}${stopped && !done ? ' stopped' : ''}`}
          >
            <span className="job-timeline-dot" aria-hidden />
            <span>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
