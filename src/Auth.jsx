import { useState } from 'react'
import { supabase } from './supabase'
import { useTheme } from './ThemeContext.jsx'

export default function Auth() {
  const { theme } = useTheme()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handlePasswordSignIn = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: theme.pageBg }}>
      <div style={{ width: 360, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary, fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em' }}>
            Grid CRM
          </div>
        </div>
        <div style={{ fontSize: 13, color: theme.textTertiary, marginBottom: 24 }}>
          Sign in with your Grid CRM account
        </div>

        {error && (
          <div style={{ background: theme.errorBg || '#FEF2F2', border: `1px solid ${theme.error || '#EF4444'}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: theme.error || '#B91C1C', marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: theme.textTertiary, display: 'block', marginBottom: 5 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            style={{ width: '100%', background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: theme.textTertiary, display: 'block', marginBottom: 5 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            onKeyDown={e => e.key === 'Enter' && handlePasswordSignIn()}
            style={{ width: '100%', background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button
          onClick={handlePasswordSignIn}
          disabled={loading}
          style={{ width: '100%', padding: '10px', background: theme.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
        >
          {loading ? 'Please wait…' : 'Sign in'}
        </button>
      </div>
    </div>
  )
}

export function PasswordSetup({ onComplete }) {
  const { theme } = useTheme()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async () => {
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onComplete()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: theme.pageBg }}>
      <div style={{ width: 360, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary, fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em', marginBottom: 6 }}>
          Set your Grid CRM password
        </div>
        <div style={{ fontSize: 13, color: theme.textTertiary, marginBottom: 24 }}>
          Choose a password to finish setting up your account.
        </div>

        {error && (
          <div style={{ background: theme.errorBg || '#FEF2F2', border: `1px solid ${theme.error || '#EF4444'}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: theme.error || '#B91C1C', marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: theme.textTertiary, display: 'block', marginBottom: 5 }}>New password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            style={{ width: '100%', background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: theme.textTertiary, display: 'block', marginBottom: 5 }}>Confirm password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{ width: '100%', background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '10px', background: theme.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
        >
          {loading ? 'Saving…' : 'Set password'}
        </button>
      </div>
    </div>
  )
}
