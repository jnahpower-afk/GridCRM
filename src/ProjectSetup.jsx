import { useState } from 'react'
import { supabase } from './supabase'
import { useTheme } from './ThemeContext.jsx'

const TECHNOLOGIES = ['Solar', 'Wind', 'BESS', 'Gas Peaker']
const GEOGRAPHIES = ['UK', 'Ireland', 'Spain', 'India']
const STATUSES = ['Greenfield', 'RtB', 'Operational']
const TEAMS = ['UK Dev', 'Spanish Dev', 'Ireland Dev']

export default function ProjectSetup({ session, onCreated, onCancel }) {
  const { theme } = useTheme()
  const [name, setName] = useState('')
  const [technology, setTechnology] = useState('Solar')
  const [geography, setGeography] = useState('UK')
  const [status, setStatus] = useState('RtB')
  const [team, setTeam] = useState('UK Dev')
  const [capacity, setCapacity] = useState('')
  const [cod, setCod] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async () => {
    if (!name.trim()) { setError('Please enter a project name'); return }
    if (!capacity || isNaN(capacity)) { setError('Please enter a valid capacity'); return }
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        technology,
        geography,
        status,
        team_name: team,
        capacity_mwp: parseFloat(capacity),
        cod: cod ? cod + '-01' : null,
        created_by: session.user.id,
      })
      .select()
      .single()

    if (error) { setError(error.message); setLoading(false); return }
    onCreated(data)
  }

  const SelectRow = ({ label, value, onChange, options }) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 11, color: theme.textSecondary, display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)} style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
            background: value === o ? theme.accent : theme.pillBg,
            color: value === o ? '#fff' : theme.textPrimary,
            border: value === o ? `1px solid ${theme.accent}` : `1px solid ${theme.border}`,
          }}>{o}</button>
        ))}
      </div>
    </div>
  )

  const inputStyle = {
    width: '100%', background: theme.inputBg, border: `1px solid ${theme.border}`,
    borderRadius: 8, color: theme.textPrimary, padding: '10px 12px',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'Inter, system-ui, sans-serif',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ width: 500, background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 32, boxShadow: theme.shadowMd }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: theme.textPrimary }}>New Project</div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: theme.textTertiary, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 24 }}>Set up your project details to get started</div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: theme.textSecondary, display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sherbourne Solar" style={inputStyle} />
        </div>

        <SelectRow label="Technology" value={technology} onChange={setTechnology} options={TECHNOLOGIES} />
        <SelectRow label="Geography" value={geography} onChange={setGeography} options={GEOGRAPHIES} />
        <SelectRow label="Team" value={team} onChange={setTeam} options={TEAMS} />
        <SelectRow label="Status" value={status} onChange={setStatus} options={STATUSES} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: theme.textSecondary, display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Capacity (MWp)</label>
            <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="25.5" style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: theme.textSecondary, display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>COD (Target)</label>
            <input type="month" value={cod} onChange={e => setCod(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {error && (
          <div style={{ background: theme.errorBg, border: `1px solid ${theme.error}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: theme.error, marginBottom: 16 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onCancel} style={{ padding: '10px 18px', fontSize: 12, fontWeight: 600, color: theme.textSecondary, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleCreate} disabled={loading} style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, color: '#fff', background: theme.accent, border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating...' : 'Create Project →'}
          </button>
        </div>
      </div>
    </div>
  )
}
