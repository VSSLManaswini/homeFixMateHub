import { supabase } from '../lib/supabase'

export type Review = {
  id: string
  bookingId: string
  providerId: string
  customerId: string
  rating: number
  comment: string
  createdAt: string
}

type ReviewRow = {
  id: string
  booking_id: string
  provider_id: string
  customer_id: string
  rating: number
  comment: string
  created_at: string
}

function mapRow(row: ReviewRow): Review {
  return {
    id: row.id,
    bookingId: row.booking_id,
    providerId: row.provider_id,
    customerId: row.customer_id,
    rating: Number(row.rating),
    comment: row.comment,
    createdAt: row.created_at,
  }
}

export async function fetchReviewedBookingIds(customerId: string): Promise<Set<string>> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('reviews')
    .select('booking_id')
    .eq('customer_id', customerId)

  if (error) throw error
  return new Set((data ?? []).map((row) => row.booking_id as string))
}

export async function submitReview(input: {
  bookingId: string
  rating: number
  comment?: string
}): Promise<Review> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('submit_review', {
    p_booking_id: input.bookingId,
    p_rating: input.rating,
    p_comment: input.comment?.trim() ?? '',
  })

  if (error) throw error
  return mapRow(data as ReviewRow)
}
