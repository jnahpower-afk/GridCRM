import { useState, useEffect } from 'react'
import { useTheme } from './ThemeContext.jsx'
import EnergyLoader from './EnergyLoader.jsx'
import { supabase } from './supabase.js'

const PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#ef4444','#06b6d4','#84cc16','#f97316',
]

const STATUS_OPTIONS = [
  { value: 'active',   label: 'Active',   color: '#10b981' },
  { value: 'paused',   label: 'Paused',   color: '#f59e0b' },
  { value: 'archived', label: 'Archived', color: '#94a3b8' },
]

export default function InitiativesList({ session, onSelect }) {
  const { theme } = useTheme()
  const [initiatives, setInitiatives] = useState([])
  const [counts, setCounts] = useState({}) // { [id]: { pins, leads } }
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null) // initiative id being deleted

  const load = async () => {
    setLoading(true)
    const { data: inits } = await supabase
      .from('initiatives')
      .select('*')
      .order('created_at', { ascending: false })
    if (!inits) { setLoading(false); return }
    setInitiatives(inits)

    // Load counts
    const ids = inits.map(i => i.id)
    if (ids.length > 0) {
      const [{ data: pins }, { data: leads }] = await Promise.all([
        supabase.from('map_pins').select('initiative_id').in('initiative_id', ids),
        supabase.from('leads').select('initiative_id').in('initiative_id', ids),
      ])
      const c = {}
      ids.forEach(id => { c[id] = { pins: 0, leads: 0 } })
      pins?.forEach(p => { if (c[p.initiative_id]) c[p.initiative_id].pins++ })
      leads?.forEach(l => { if (c[l.initiative_id]) c[l.initiative_id].leads++ })
      setCounts(c)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (init) => {
    setDeleting(init.id)
    // Cascade: delete leads and pins first, then the initiative
    await Promise.all([
      supabase.from('leads').delete().eq('initiative_id', init.id),
      supabase.from('map_pins').delete().eq('initiative_id', init.id),
    ])
    await supabase.from('initiatives').delete().eq('id', init.id)
    setDeleting(null)
    await load()
  }

  const handleCreate = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    await supabase.from('initiatives').insert({
      name: form.name.trim(),
      description: form.description.trim() || null,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      created_by: session.user.id,
    })
    setForm({ name: '', description: '' })
    setShowNew(false)
    setSaving(false)
    await load()
  }

  const inputStyle = {
    width: '100%', background: theme.surfaceBg,
    border: `1px solid ${theme.border}`, borderRadius: 6,
    color: theme.textPrimary, padding: '8px 12px',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    fontFamily: "'Inter', system-ui, sans-serif",
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28, fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: theme.textPrimary }}>Greenfield Initiatives</div>
          <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 2 }}>Outreach campaigns and development sprints</div>
        </div>
        <button onClick={() => setShowNew(true)} style={{
          background: theme.accent, color: '#fff', border: 'none',
          borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: "'Inter', system-ui, sans-serif",
        }}>+ New Initiative</button>
      </div>

      {/* New initiative modal */}
      {showNew && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{
            background: theme.pageBg, border: `1px solid ${theme.border}`,
            borderRadius: 14, padding: 24, width: 420,
            boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 18 }}>New Initiative</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Name *</div>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. 5MW Sprint – South Wales Q2"
                  style={inputStyle}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Description</div>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What is this initiative targeting?"
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={handleCreate} disabled={saving || !form.name.trim()} style={{
                flex: 1, background: theme.accent, color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 600,
                cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || !form.name.trim() ? 0.6 : 1,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>{saving ? 'Creating…' : 'Create Initiative'}</button>
              <button onClick={() => { setShowNew(false); setForm({ name: '', description: '' }) }} style={{
                background: theme.pillBg, color: theme.textSecondary,
                border: `1px solid ${theme.border}`, borderRadius: 8,
                padding: '9px 16px', fontSize: 12, cursor: 'pointer',
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleting && (() => {
        const init = initiatives.find(i => i.id === deleting)
        const c = counts[deleting] || { pins: 0, leads: 0 }
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 28, width: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 8 }}>Delete Initiative?</div>
              <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 6 }}>
                <strong style={{ color: theme.textPrimary }}>{init?.name}</strong> will be permanently deleted.
              </div>
              {(c.pins > 0 || c.leads > 0) && (
                <div style={{ background: '#ef444415', border: '1px solid #ef444433', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#ef4444' }}>
                  This will also delete <strong>{c.pins} parcel{c.pins !== 1 ? 's' : ''}</strong> and <strong>{c.leads} lead{c.leads !== 1 ? 's' : ''}</strong> associated with this initiative.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button
                  onClick={() => handleDelete(init)}
                  style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', system-ui, sans-serif" }}>
                  Delete permanently
                </button>
                <button
                  onClick={() => setDeleting(null)}
                  style={{ background: theme.pillBg, color: theme.textSecondary, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 16px', fontSize: 12, cursor: 'pointer', fontFamily: "'Inter', system-ui, sans-serif" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Grid */}
      {loading ? (
        <div><EnergyLoader /></div>
      ) : initiatives.length === 0 ? (
        <div style={{
          border: `2px dashed ${theme.border}`, borderRadius: 14, padding: '56px 24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textPrimary, marginBottom: 6 }}>No initiatives yet</div>
          <div style={{ fontSize: 12, color: theme.textTertiary }}>Create your first initiative to start mapping greenfield sites</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {initiatives.map(init => {
            const statusOpt = STATUS_OPTIONS.find(s => s.value === init.status) || STATUS_OPTIONS[0]
            const c = counts[init.id] || { pins: 0, leads: 0 }
            return (
              <div
                key={init.id}
                onClick={() => onSelect(init)}
                style={{
                  background: theme.cardBg, border: `1px solid ${theme.cardBorder}`,
                  borderRadius: 12, padding: 20, cursor: 'pointer',
                  transition: 'all 0.15s', position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = init.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 16px ${init.color}22` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                {/* Colour bar */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: init.color, borderRadius: '12px 12px 0 0' }} />

                {/* Delete button */}
                <button
                  onClick={e => { e.stopPropagation(); setDeleting(init.id) }}
                  title="Delete initiative"
                  style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 5, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textTertiary, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, opacity: 0.6, fontFamily: "'Inter', system-ui, sans-serif" }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef444444'; e.currentTarget.style.background = '#ef444415' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = theme.textTertiary; e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.background = theme.pillBg }}>
                  ×
                </button>

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginTop: 6, marginBottom: 8, paddingRight: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, flex: 1 }}>{init.name}</div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: statusOpt.color, background: statusOpt.color + '22',
                    border: `1px solid ${statusOpt.color}44`, borderRadius: 4,
                    padding: '2px 7px', flexShrink: 0,
                  }}>{statusOpt.label}</span>
                </div>

                {init.description && (
                  <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 14, lineHeight: 1.5 }}>{init.description}</div>
                )}

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  {[
                    { label: 'Parcels', value: c.pins },
                    { label: 'Leads',   value: c.leads },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: init.color }}>{value}</span>
                      <span style={{ fontSize: 10, color: theme.textTertiary }}>{label}</span>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 10, color: theme.textTertiary }}>
                  {new Date(init.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
