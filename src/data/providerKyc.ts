import { supabase } from '../lib/supabase'

export type IdDocumentType = 'aadhaar' | 'pan' | 'voter' | 'passport' | 'driving_licence' | 'other'
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

export type IdNumberFieldMeta = {
  maxLength: number
  inputMode: 'numeric' | 'text'
  placeholder: string
  pattern?: string
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

/** Strip separators and apply type-specific casing for storage/validation. */
export function normalizeIdNumber(idType: IdDocumentType, idNumber: string): string {
  if (idType === 'aadhaar') return idNumber.replace(/\D/g, '')
  const stripped = idNumber.replace(/[\s-]/g, '')
  if (
    idType === 'pan' ||
    idType === 'voter' ||
    idType === 'passport' ||
    idType === 'driving_licence' ||
    idType === 'other'
  ) {
    return stripped.toUpperCase()
  }
  return stripped
}

/** Live input sanitizer used by the KYC form (max length + allowed chars). */
export function sanitizeIdNumberInput(idType: IdDocumentType, raw: string): string {
  switch (idType) {
    case 'aadhaar':
      return raw.replace(/\D/g, '').slice(0, 12)
    case 'pan':
      return raw
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 10)
    case 'voter':
      return raw
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 10)
    case 'passport':
      return raw
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 8)
    case 'driving_licence':
      return raw
        .replace(/[\s-]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 16)
    case 'other':
      return raw
        .replace(/[\s-]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 20)
  }
}

export function idNumberFieldMeta(idType: IdDocumentType): IdNumberFieldMeta {
  switch (idType) {
    case 'aadhaar':
      return {
        maxLength: 12,
        inputMode: 'numeric',
        placeholder: '12-digit Aadhaar',
        pattern: '\\d{12}',
      }
    case 'pan':
      return {
        maxLength: 10,
        inputMode: 'text',
        placeholder: 'ABCDE1234F',
        pattern: '[A-Z]{5}[0-9]{4}[A-Z]',
      }
    case 'voter':
      return {
        maxLength: 10,
        inputMode: 'text',
        placeholder: 'ABC1234567',
        pattern: '[A-Z]{3}[0-9]{7}',
      }
    case 'passport':
      return {
        maxLength: 8,
        inputMode: 'text',
        placeholder: 'A1234567',
        pattern: '[A-Z][0-9]{7}',
      }
    case 'driving_licence':
      return {
        maxLength: 16,
        inputMode: 'text',
        placeholder: 'MH1420110001234',
        pattern: '[A-Z]{2}[A-Z0-9]{8,14}',
      }
    case 'other':
      return {
        maxLength: 20,
        inputMode: 'text',
        placeholder: '6–20 character ID',
      }
  }
}

export function validateKycInput(input: ProviderKycInput): Partial<Record<keyof ProviderKycInput, string>> {
  const errors: Partial<Record<keyof ProviderKycInput, string>> = {}
  if (!input.idHolderName.trim()) {
    errors.idHolderName = 'Enter the name as on the ID card'
  }

  const number = normalizeIdNumber(input.idType, input.idNumber)
  if (!number) {
    switch (input.idType) {
      case 'aadhaar':
        errors.idNumber = 'Enter your 12-digit Aadhaar number'
        break
      case 'pan':
        errors.idNumber = 'Enter your 10-character PAN'
        break
      case 'voter':
        errors.idNumber = 'Enter your 10-character Voter ID (EPIC)'
        break
      case 'passport':
        errors.idNumber = 'Enter your 8-character passport number'
        break
      case 'driving_licence':
        errors.idNumber = 'Enter your driving licence number'
        break
      default:
        errors.idNumber = 'Enter the ID number'
    }
    return errors
  }

  switch (input.idType) {
    case 'aadhaar':
      if (!/^\d{12}$/.test(number)) {
        errors.idNumber = 'Aadhaar must be exactly 12 digits'
      }
      break
    case 'pan':
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(number)) {
        errors.idNumber = 'PAN must be exactly 10 characters in format ABCDE1234F'
      }
      break
    case 'voter':
      if (!/^[A-Z]{3}\d{7}$/.test(number)) {
        errors.idNumber = 'Voter ID must be exactly 10 characters in format ABC1234567'
      }
      break
    case 'passport':
      if (!/^[A-Z]\d{7}$/.test(number)) {
        errors.idNumber = 'Passport must be exactly 8 characters in format A1234567'
      }
      break
    case 'driving_licence':
      if (!/^[A-Z]{2}[A-Z0-9]{8,14}$/.test(number)) {
        errors.idNumber =
          'Driving licence must be 10–16 characters, starting with a 2-letter state code (e.g. MH1420110001234)'
      }
      break
    case 'other':
      if (!/^[A-Z0-9]{6,20}$/.test(number)) {
        errors.idNumber = 'Other ID must be 6–20 alphanumeric characters'
      }
      break
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
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'voter', label: 'Voter ID (EPIC)' },
  { value: 'passport', label: 'Passport' },
  { value: 'other', label: 'Other national ID' },
]
