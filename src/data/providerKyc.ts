import { supabase } from '../lib/supabase'

export type IdDocumentType = 'aadhaar' | 'pan' | 'voter' | 'passport' | 'other'
export type KycStatus = 'submitted' | 'verified' | 'rejected'

export type ProviderKyc = {
  userId: string
  idType: IdDocumentType
  idNumber: string
  idHolderName: string
  status: KycStatus
  rejectionReason: string
  submittedAt: string
  reviewedAt: string | null
  updatedAt: string
}

export type ProviderKycInput = {
  idType: IdDocumentType
  idNumber: string
  idHolderName: string
}

type KycRow = {
  user_id: string
  id_type: IdDocumentType
  id_number: string
  id_holder_name: string
  status: KycStatus
  rejection_reason: string
  submitted_at: string
  reviewed_at: string | null
  updated_at: string
}

function formatError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message]
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(error.hint)
  if (error.code) parts.push(`(${error.code})`)
  return parts.filter(Boolean).join(' — ')
}

function mapRow(row: KycRow): ProviderKyc {
  return {
    userId: row.user_id,
    idType: row.id_type,
    idNumber: row.id_number ?? '',
    idHolderName: row.id_holder_name ?? '',
    status: row.status,
    rejectionReason: row.rejection_reason ?? '',
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at,
  }
}

export function emptyKycForm(): ProviderKycInput {
  return {
    idType: 'aadhaar',
    idNumber: '',
    idHolderName: '',
  }
}

export function kycToForm(kyc: ProviderKyc | null): ProviderKycInput {
  if (!kyc) return emptyKycForm()
  return {
    idType: kyc.idType,
    idNumber: kyc.idNumber,
    idHolderName: kyc.idHolderName,
  }
}

export function maskIdNumber(idType: IdDocumentType, idNumber: string): string {
  const raw = idNumber.replace(/\s+/g, '')
  if (raw.length <= 4) return raw
  if (idType === 'aadhaar') {
    return `XXXX-XXXX-${raw.slice(-4)}`
  }
  return `${'•'.repeat(Math.min(raw.length - 4, 8))}${raw.slice(-4)}`
}

function normalizeIdNumber(idType: IdDocumentType, idNumber: string): string {
  if (idType === 'aadhaar') return idNumber.replace(/\D/g, '')
  const stripped = idNumber.replace(/[\s-]/g, '')
  return idType === 'pan' ? stripped.toUpperCase() : stripped
}

export function validateKycInput(input: ProviderKycInput): Partial<Record<keyof ProviderKycInput, string>> {
  const errors: Partial<Record<keyof ProviderKycInput, string>> = {}
  if (!input.idHolderName.trim()) {
    errors.idHolderName = 'Enter the name as on the ID card'
  }

  const number = normalizeIdNumber(input.idType, input.idNumber)
  if (!number) {
    errors.idNumber =
      input.idType === 'aadhaar' ? 'Enter your 12-digit Aadhaar number' : 'Enter the ID number'
  } else if (input.idType === 'aadhaar') {
    if (!/^\d{12}$/.test(number)) {
      errors.idNumber = 'Aadhaar must be exactly 12 digits'
    }
  } else if (input.idType === 'pan') {
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(number)) {
      errors.idNumber = 'PAN format should be ABCDE1234F'
    }
  } else if (number.length < 6) {
    errors.idNumber = 'Enter a valid ID number'
  }

  return errors
}

export function isKycSubmitted(kyc: ProviderKyc | null): boolean {
  return Boolean(kyc && (kyc.status === 'submitted' || kyc.status === 'verified'))
}

export function kycStatusLabel(status: KycStatus): string {
  switch (status) {
    case 'verified':
      return 'Verified'
    case 'rejected':
      return 'Rejected — resubmit'
    default:
      return 'Submitted — awaiting admin review'
  }
}

export async function fetchMyKyc(userId: string): Promise<ProviderKyc | null> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('provider_kyc').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(formatError(error))
  return data ? mapRow(data as KycRow) : null
}

export async function fetchAllProviderKyc(): Promise<ProviderKyc[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('provider_kyc').select('*').order('submitted_at', { ascending: false })
  if (error) throw new Error(formatError(error))
  return ((data ?? []) as KycRow[]).map(mapRow)
}

export async function submitMyKyc(userId: string, input: ProviderKycInput): Promise<ProviderKyc> {
  if (!supabase) throw new Error('Supabase is not configured')

  const errors = validateKycInput(input)
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0] ?? 'Fix the KYC form errors')
  }

  const idNumber = normalizeIdNumber(input.idType, input.idNumber)

  const payload = {
    user_id: userId,
    id_type: input.idType,
    id_number: idNumber,
    id_holder_name: input.idHolderName.trim(),
    status: 'submitted' as const,
    rejection_reason: '',
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('provider_kyc')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) throw new Error(formatError(error))
  return mapRow(data as KycRow)
}

export async function rejectProviderKyc(userId: string, reason: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('reject_provider_kyc', {
    p_user_id: userId,
    p_reason: reason,
  })
  if (error) throw new Error(formatError(error))
}

export const idTypeOptions: { value: IdDocumentType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar card' },
  { value: 'pan', label: 'PAN card' },
  { value: 'voter', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'other', label: 'Other national ID' },
]
