import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type AuthState = {
  user: User | null
  session: Session | null
  loading: boolean
  configured: boolean
}

function authRedirectTo(): string {
  return `${window.location.origin}/`
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: isSupabaseConfigured,
    configured: isSupabaseConfigured,
  })

  useEffect(() => {
    if (!supabase) {
      setState({ user: null, session: null, loading: false, configured: false })
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setState({
        user: data.session?.user ?? null,
        session: data.session,
        loading: false,
        configured: true,
      })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
        configured: true,
      })
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    if (!data.session) {
      throw new Error(
        'Signup succeeded but email confirmation is required, so you have no session yet. In Supabase go to Authentication → Providers → Email and disable “Confirm email”, then sign in.',
      )
    }
  }

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signInWithGoogle = async () => {
    if (!supabase) throw new Error('Supabase is not configured')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectTo(),
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })
    if (error) throw error
  }

  const sendPhoneOtp = async (phone: string) => {
    if (!supabase) throw new Error('Supabase is not configured')
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw error
  }

  const verifyPhoneOtp = async (phone: string, token: string) => {
    if (!supabase) throw new Error('Supabase is not configured')
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    })
    if (error) throw error
  }

  const signOut = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return {
    ...state,
    signUp,
    signIn,
    signInWithGoogle,
    sendPhoneOtp,
    verifyPhoneOtp,
    signOut,
  }
}
