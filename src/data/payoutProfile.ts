import { supabase } from '../lib/supabase'

export type PayoutMethod = 'upi' | 'bank'

export type PayoutProfile = {
  userId: string
  payoutMethod: PayoutMethod
  upiId: string
  accountHolderName: string
  bankName: string
  accountNumber: string
  ifsc: string
  updatedAt: string
  createdAt: string
}

export type PayoutProfileInput = {
  payoutMethod: PayoutMethod
  upiId: string
  accountHolderName: string
  bankName: string
  accountNumber: string
  ifsc: string
}

type PayoutProfileRow = {
  user_id: string
  payout_method: PayoutMethod
  upi_id: string
  account_holder_name: string
  bank_name: string
  account_number: string
  ifsc: string
  updated_at: string
  created_at: string
}

function formatError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(error.hint)
  if (error.code) parts.push(`(${error.code})`)
  return parts.filter(Boolean).join(' — ')
}

function mapRow(row: PayoutProfileRow): PayoutProfile {
  return {
    userId: row.user_id,
    payoutMethod: row.payout_method,
    upiId: row.upi_id ?? '',
    accountHolderName: row.account_holder_name ?? '',
    bankName: row.bank_name ?? '',
    accountNumber: row.account_number ?? '',
    ifsc: row.ifsc ?? '',
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }
}

export function emptyPayoutForm(): PayoutProfileInput {
  return {
    payoutMethod: 'upi',
    upiId: '',
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    ifsc: '',
  }
}

export function payoutProfileToForm(profile: PayoutProfile | null): PayoutProfileInput {
  if (!profile) return emptyPayoutForm()
  return {
    payoutMethod: profile.payoutMethod,
    upiId: profile.upiId,
    accountHolderName: profile.accountHolderName,
    bankName: profile.bankName,
    accountNumber: profile.accountNumber,
    ifsc: profile.ifsc,
  }
}

export function isPayoutProfileComplete(profile: PayoutProfile | null): boolean {
  if (!profile) return false
  if (!profile.accountHolderName.trim()) return false
  if (profile.payoutMethod === 'upi') {
    return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(profile.upiId.trim())
  }
  const ifsc = profile.ifsc.replace(/\s+/g, '').toUpperCase()
  const account = profile.accountNumber.replace(/\s+/g, '')
  return (
    Boolean(profile.bankName.trim()) &&
    /^\d{9,18}$/.test(account) &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)
  )
}

export function validatePayoutProfile(input: PayoutProfileInput): Partial<Record<keyof PayoutProfileInput, string>> {
  const errors: Partial<Record<keyof PayoutProfileInput, string>> = {}
  if (!input.accountHolderName.trim()) {
    errors.accountHolderName = 'Enter the account holder name'
  }

  if (input.payoutMethod === 'upi') {
    const upi = input.upiId.trim()
    if (!upi) errors.upiId = 'Enter your UPI ID'
    else if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) {
      errors.upiId = 'Use a valid UPI ID (e.g. name@oksbi)'
    }
  } else {
    if (!input.bankName.trim()) errors.bankName = 'Enter bank name'
    const account = input.accountNumber.replace(/\s+/g, '')
    if (!account) errors.accountNumber = 'Enter account number'
    else if (!/^\d{9,18}$/.test(account)) errors.accountNumber = 'Account number should be 9–18 digits'
    const ifsc = input.ifsc.replace(/\s+/g, '').toUpperCase()
    if (!ifsc) errors.ifsc = 'Enter IFSC code'
    else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) errors.ifsc = 'Use a valid IFSC (e.g. SBIN0001234)'
  }

  return errors
}

export async function fetchMyPayoutProfile(userId: string): Promise<PayoutProfile | null> {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('provider_payout_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(formatError(error))
  return data ? mapRow(data as PayoutProfileRow) : null
}

export async function saveMyPayoutProfile(userId: string, input: PayoutProfileInput): Promise<PayoutProfile> {
  if (!supabase) throw new Error('Supabase is not configured')

  const errors = validatePayoutProfile(input)
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0] ?? 'Fix the payout form errors')
  }

  const payload = {
    user_id: userId,
    payout_method: input.payoutMethod,
    upi_id: input.payoutMethod === 'upi' ? input.upiId.trim() : '',
    account_holder_name: input.accountHolderName.trim(),
    bank_name: input.payoutMethod === 'bank' ? input.bankName.trim() : '',
    account_number: input.payoutMethod === 'bank' ? input.accountNumber.replace(/\s+/g, '') : '',
    ifsc: input.payoutMethod === 'bank' ? input.ifsc.replace(/\s+/g, '').toUpperCase() : '',
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('provider_payout_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) throw new Error(formatError(error))
  return mapRow(data as PayoutProfileRow)
}

export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '')
  if (digits.length <= 4) return digits
  return `${'•'.repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`
}

export function payoutSummary(profile: PayoutProfile): string {
  if (profile.payoutMethod === 'upi') {
    return `UPI · ${profile.upiId}`
  }
  return `${profile.bankName} · ${maskAccountNumber(profile.accountNumber)} · ${profile.ifsc}`
}
