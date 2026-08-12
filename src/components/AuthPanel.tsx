import { useState, type FormEvent } from 'react'

type AuthMethod = 'email' | 'phone'

type AuthPanelProps = {
  mode?: 'inline' | 'compact'
  onSignedIn?: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  sendPhoneOtp: (phone: string) => Promise<void>
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>
}

/** Normalize Indian mobile numbers to E.164 when possible. */
export function normalizePhone(input: string): string {
  const trimmed = input.trim().replace(/[\s()-]/g, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) return trimmed
  if (/^0\d{10}$/.test(trimmed)) return `+91${trimmed.slice(1)}`
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`
  if (/^91\d{10}$/.test(trimmed)) return `+${trimmed}`
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export function AuthPanel({
  mode = 'inline',
  onSignedIn,
  signIn,
  signUp,
  signInWithGoogle,
  sendPhoneOtp,
  verifyPhoneOtp,
}: AuthPanelProps) {
  const [method, setMethod] = useState<AuthMethod>('email')
  const [isSignUp, setIsSignUp] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const clearMessages = () => {
    setError(null)
    setInfo(null)
  }

  const handleGoogle = async () => {
    clearMessages()
    setBusy(true)
    try {
      await signInWithGoogle()
      setInfo('Redirecting to Google…')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
      setBusy(false)
    }
  }

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault()
    clearMessages()
    setBusy(true)

    try {
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters')
      }

      if (isSignUp) {
        await signUp(email.trim(), password)
        // Prefer an immediate session; if Confirm email is on, session may be missing.
        setInfo(
          'Account created. If you are not signed in yet, open Supabase → Authentication → Providers → Email and turn OFF “Confirm email”, then sign in here.',
        )
        setIsSignUp(false)
      } else {
        await signIn(email.trim(), password)
        onSignedIn?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  const sendOtp = async () => {
    clearMessages()
    setBusy(true)

    try {
      const normalized = normalizePhone(phone)
      if (!/^\+\d{10,15}$/.test(normalized)) {
        throw new Error('Enter a valid mobile number with country code (e.g. +9198XXXXXXXX)')
      }
      await sendPhoneOtp(normalized)
      setPhone(normalized)
      setOtpSent(true)
      setInfo(`OTP sent to ${normalized}. Enter the code below.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP')
    } finally {
      setBusy(false)
    }
  }

  const handleSendOtp = async (event: FormEvent) => {
    event.preventDefault()
    await sendOtp()
  }

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault()
    clearMessages()
    setBusy(true)

    try {
      const normalized = normalizePhone(phone)
      const token = otp.trim()
      if (!/^\d{6}$/.test(token)) {
        throw new Error('Enter the 6-digit OTP')
      }
      await verifyPhoneOtp(normalized, token)
      onSignedIn?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`auth-panel ${mode}`}>
      <h3 className="panel-title">Create account or sign in</h3>
      <p className="panel-sub">Continue with Google, phone OTP, or email and password.</p>

      <button type="button" className="btn btn-google" onClick={() => void handleGoogle()} disabled={busy}>
        <GoogleGlyph />
        Continue with Google
      </button>

      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>

      <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          className={`auth-tab ${method === 'email' ? 'active' : ''}`}
          aria-selected={method === 'email'}
          onClick={() => {
            setMethod('email')
            clearMessages()
          }}
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
          className={`auth-tab ${method === 'phone' ? 'active' : ''}`}
          aria-selected={method === 'phone'}
          onClick={() => {
            setMethod('phone')
            clearMessages()
          }}
        >
          Phone OTP
        </button>
      </div>

      {method === 'email' && (
        <form onSubmit={handleEmailSubmit} noValidate>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@gmail.com"
                required
              />
            </div>
            <div className="field full">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Please wait…' : isSignUp ? 'Sign up with email' : 'Sign in with email'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsSignUp((v) => !v)
                clearMessages()
              }}
            >
              {isSignUp ? 'Have an account? Sign in' : 'Need an account? Sign up'}
            </button>
          </div>
        </form>
      )}

      {method === 'phone' && (
        <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp} noValidate>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="auth-phone">Mobile number</label>
              <input
                id="auth-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setOtpSent(false)
                  setOtp('')
                }}
                placeholder="+91 98765 43210"
                required
              />
            </div>

            {otpSent && (
              <div className="field full">
                <label htmlFor="auth-otp">OTP code</label>
                <input
                  id="auth-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  required
                />
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Please wait…' : otpSent ? 'Verify OTP' : 'Send OTP'}
            </button>
            {otpSent && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void sendOtp()}
                >
                  Resend OTP
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setOtpSent(false)
                    setOtp('')
                    clearMessages()
                  }}
                >
                  Change number
                </button>
              </>
            )}
          </div>
        </form>
      )}

      {error && <p className="field-error auth-message">{error}</p>}
      {info && (
        <p className="success-banner auth-message" role="status">
          {info}
        </p>
      )}
    </div>
  )
}
