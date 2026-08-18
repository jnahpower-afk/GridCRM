import { useState } from 'react'
import { useTheme } from './ThemeContext.jsx'
import { supabase } from './supabase.js'
import { LayoutDashboard, Zap, Leaf, Handshake, LogOut, PanelLeftClose, PanelLeftOpen, Settings, Server } from 'lucide-react'

const NAV = [
  { type: 'header',  label: 'Top of Funnel' },
  { type: 'item',    key: 'tof-dashboard',  section: 'topOfFunnel', subView: 'dashboard',   label: 'Dashboard',    icon: LayoutDashboard, indent: true },
  { type: 'item',    key: 'tof-privateWire',section: 'topOfFunnel', subView: 'privateWire', label: 'Private Wire', icon: Zap,             indent: true },
  { type: 'item',    key: 'tof-greenfield', section: 'topOfFunnel', subView: 'greenfield',  label: 'Greenfield',   icon: Leaf,            indent: true },
  { type: 'item',    key: 'portfolio',      section: 'portfolio',                            label: 'Acquisitions', icon: Handshake,       indent: true },
  { type: 'item',    key: 'tof-dataCentres',section: 'topOfFunnel', subView: 'dataCentres', label: 'Data Centres', icon: Server,          indent: true },
]

export default function Sidebar({ section, subView, onNavigate, session, taskBadge }) {
  const { theme, themeName, setThemeName } = useTheme()
  const [collapsed, setCollapsed] = useState(true)

  const handleSignOut = async () => { await supabase.auth.signOut() }

  function isActive(item) {
    if (item.section === 'portfolio') return section === 'portfolio'
    return section === 'topOfFunnel' && subView === item.subView
  }

  const W = collapsed ? 52 : 210

  return (
    <div style={{
      width: W,
      flexShrink: 0,
      height: '100vh',
      background: theme.sidebarBg,
      borderRight: `1px solid ${theme.cardBorder}`,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Inter', system-ui, sans-serif",
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>

      {/* ── Brand + collapse button ── */}
      <div style={{
        padding: '0 10px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap: 8,
        borderBottom: `1px solid ${theme.cardBorder}`,
        flexShrink: 0,
      }}>
        {!collapsed && (
          <span style={{ flex: 1, overflow: 'hidden', fontSize: 15, fontWeight: 800, color: theme.textPrimary, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            Grid CRM
          </span>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: 6,
            color: theme.textTertiary,
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = theme.textPrimary; e.currentTarget.style.borderColor = theme.textMuted }}
          onMouseLeave={e => { e.currentTarget.style.color = theme.textTertiary; e.currentTarget.style.borderColor = theme.cardBorder }}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* ── Nav ── */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 6px' }}>
        {NAV.map((item, i) => {
          if (item.type === 'divider') {
            return <div key={i} style={{ height: 1, background: theme.cardBorder, margin: '6px 6px' }} />
          }

          if (item.type === 'header') {
            // Show a thin divider line instead of text when collapsed
            if (collapsed) return null
            return (
              <div key={i} style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: theme.textTertiary,
                padding: '10px 10px 4px',
                whiteSpace: 'nowrap',
              }}>
                {item.label}
              </div>
            )
          }

          const active = isActive(item)
          const Icon = item.icon
          const showBadge = item.key === 'tof-privateWire' && taskBadge > 0

          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.section, item.subView)}
              title={collapsed ? item.label : undefined}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? 0 : 9,
                padding: collapsed ? '8px 0' : item.indent ? '7px 10px 7px 20px' : '7px 10px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                background: active ? theme.accent + '1a' : 'transparent',
                color: active ? theme.accent : theme.textSecondary,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                transition: 'background 0.1s, color 0.1s',
                marginBottom: 1,
                position: 'relative',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = theme.cardBorder + '55'; e.currentTarget.style.color = theme.textPrimary } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textSecondary } }}
            >
              <Icon size={15} strokeWidth={active ? 2.5 : 2} style={{ flexShrink: 0 }} />

              {!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{item.label}</span>}

              {/* Badge — dot when collapsed, count when expanded */}
              {showBadge && (
                collapsed ? (
                  <span style={{
                    position: 'absolute',
                    top: 5, right: 7,
                    width: 7, height: 7,
                    borderRadius: '50%',
                    background: '#ef4444',
                  }} />
                ) : (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: '#ef4444', color: '#fff',
                    borderRadius: 10, padding: '1px 6px',
                    lineHeight: 1.4, flexShrink: 0,
                  }}>
                    {taskBadge}
                  </span>
                )
              )}
            </button>
          )
        })}
      </nav>

      {/* ── Bottom ── */}
      <div style={{
        padding: collapsed ? '10px 6px 14px' : '10px 10px 14px',
        borderTop: `1px solid ${theme.cardBorder}`,
        flexShrink: 0,
      }}>
        {!collapsed && session && (
          <div style={{
            fontSize: 11,
            color: theme.textTertiary,
            marginBottom: 8,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {session.user.email}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: collapsed ? 'center' : 'flex-start', flexDirection: collapsed ? 'column' : 'row' }}>
          <button
            onClick={() => setThemeName(themeName === 'gridcrm' ? 'linear' : 'gridcrm')}
            title={themeName === 'gridcrm' ? 'Switch to light theme' : 'Switch to dark theme'}
            style={{
              flex: collapsed ? 'none' : 1,
              width: collapsed ? 32 : 'auto',
              height: collapsed ? 32 : 'auto',
              padding: collapsed ? 0 : '5px 0',
              fontSize: 11,
              color: theme.textTertiary,
              background: 'none',
              border: `1px solid ${theme.cardBorder}`,
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {themeName === 'gridcrm' ? (collapsed ? '◐' : '◐ Light') : (collapsed ? '◑' : '◑ Dark')}
          </button>
          <button
            onClick={() => onNavigate('settings')}
            title="CRM Settings — data exports"
            style={{
              flex: 'none',
              width: collapsed ? 32 : 'auto',
              height: collapsed ? 32 : 'auto',
              padding: collapsed ? 0 : '5px 8px',
              fontSize: 11,
              color: section === 'settings' ? theme.accent : theme.textTertiary,
              background: section === 'settings' ? theme.accent + '15' : 'none',
              border: `1px solid ${section === 'settings' ? theme.accent : theme.cardBorder}`,
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Settings size={12} />
            {!collapsed && <span>Settings</span>}
          </button>
          <button
            onClick={handleSignOut}
            title="Sign out"
            style={{
              flex: 'none',
              width: collapsed ? 32 : 'auto',
              height: collapsed ? 32 : 'auto',
              padding: collapsed ? 0 : '5px 8px',
              fontSize: 11,
              color: theme.textTertiary,
              background: 'none',
              border: `1px solid ${theme.cardBorder}`,
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <LogOut size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
