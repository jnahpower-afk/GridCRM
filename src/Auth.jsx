import { useState } from 'react'
import { supabase } from './supabase'
import { useTheme } from './ThemeContext.jsx'
import FuseLogo from './FuseLogo.jsx'

// Google "G" mark (multi-colour SVG)
function GoogleG({ size = 18 }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.166 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

export default function Auth() {
  const { theme } = useTheme()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Optional email/password fallback — hidden by default. Existing accounts
  // can still sign in this way; new accounts are blocked by the DB trigger
  // that requires @fuseenergy.com.
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleGoogle = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          // hd hints Google to show only the @fuseenergy.com workspace.
          // We still enforce the same constraint server-side via a DB trigger.
          hd: 'fuseenergy.com',
          prompt: 'select_account',
        },
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success the OAuth redirect takes over — no further state to set.
  }

  const handlePasswordSignIn = async () => {
    if (!email.toLowerCase().endsWith('@fuseenergy.com')) {
      setError('This CRM is restricted to fuseenergy.com staff.')
      return
    }
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
          <FuseLogo size={36} />
          <div style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary, fontFamily: "'Inter', sans-serif", letterSpacing: '-0.01em' }}>
            Fuse CRM
          </div>
        </div>
        <div style={{ fontSize: 13, color: theme.textTertiary, marginBottom: 24 }}>
          Sign in with your fuseenergy.com account
        </div>

        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            width: '100%', padding: '11px',
            background: '#fff', border: '1px solid #dadce0', borderRadius: 8,
            color: '#3c4043', fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            fontFamily: "'Inter', system-ui, sans-serif",
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            marginBottom: 18,
            transition: 'background 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f7f8fa' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}
        >
          <GoogleG />
          <span>{loading ? 'Redirecting…' : 'Sign in with Google'}</span>
        </button>

        {/* Restriction message */}
        <div style={{ fontSize: 11, color: theme.textMuted, textAlign: 'center', marginBottom: 18, lineHeight: 1.5 }}>
          Access is restricted to @fuseenergy.com staff.<br/>
          Use your work Google account.
        </div>

        {error && (
          <div style={{ background: theme.errorBg || '#FEF2F2', border: `1px solid ${theme.error || '#EF4444'}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: theme.error || '#B91C1C', marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* Email/password fallback */}
        {!showPassword && (
          <div style={{ textAlign: 'center', fontSize: 11, color: theme.textMuted, marginTop: 8 }}>
            <span onClick={() => setShowPassword(true)} style={{ color: theme.textTertiary, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              use email &amp; password instead
            </span>
          </div>
        )}
        {showPassword && (
          <div style={{ borderTop: `1px solid ${theme.borderSubtle || theme.border}`, paddingTop: 18, marginTop: 4 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: theme.textTertiary, display: 'block', marginBottom: 5 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@fuseenergy.com"
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
                onKeyDown={e => e.key === 'Enter' && handlePasswordSignIn()}
                style={{ width: '100%', background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <button
              onClick={handlePasswordSignIn}
              disabled={loading}
              style={{ width: '100%', padding: '10px', background: theme.accent, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', marginBottom: 8 }}
            >
              {loading ? 'Please wait…' : 'Sign in'}
            </button>
            <div style={{ textAlign: 'center', fontSize: 11 }}>
              <span onClick={() => setShowPassword(false)} style={{ color: theme.textTertiary, cursor: 'pointer' }}>← back to Google</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
