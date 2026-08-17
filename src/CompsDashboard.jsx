import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'
import { useTheme } from './ThemeContext.jsx'
import EnergyLoader from './EnergyLoader.jsx'

// ── Constants ───────────────────────────────────────────────────────────────

const TECHNOLOGIES = ['All', 'Solar', 'Wind', 'BESS', 'Gas Peaker', 'Hydrogen', 'Nuclear', 'Hydro']
const GEOGRAPHIES = ['All', 'UK', 'Ireland', 'Spain', 'Germany', 'France', 'Netherlands', 'Nordics', 'Europe', 'Other']
const STAGES = ['All', 'Development', 'RtB', 'Construction', 'Operational']

const TECH_COLORS = {
  'Solar': '#FFB162', 'Wind': '#FC6A0A', 'BESS': '#4A8C5C', 'Gas Peaker': '#f97316',
  'Hydrogen': '#60A5FA', 'Nuclear': '#A78BFA', 'Hydro': '#34d399',
}
const STAGE_COLORS = {
  'Development': '#A78BFA', 'RtB': '#FFB162', 'Construction': '#60A5FA', 'Operational': '#4A8C5C',
}

const fmt = (n, d = 1) => n == null ? '—' : Number(n).toFixed(d)
const fmtM = (n, ccy = '£') => {
  if (!n) return '—'
  const abs = Math.abs(n)
  if (abs >= 1000000000) return `${ccy}${(n / 1000000000).toFixed(1)}bn`
  if (abs >= 1000000) return `${ccy}${(n / 1000000).toFixed(1)}m`
  if (abs >= 1000) return `${ccy}${(n / 1000).toFixed(0)}k`
  return `${ccy}${n.toFixed(0)}`
}
const ccySymbol = c => ({ GBP: '£', EUR: '€', USD: '$' }[c] || '£')
const timeAgo = (d) => {
  if (!d) return ''
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, theme }) {
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 9, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || theme.textPrimary, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Scatter Chart: £/MW vs IRR with project overlay ─────────────────────────
function CompScatter({ comps, projects, theme }) {
  const compData = comps.filter(c => c.price_per_mw && c.implied_irr)
  const projData = projects.filter(p => p._pricePerMw && p._latestRun?.project_irr)
  const all = [
    ...compData.map(c => ({ pmw: c.price_per_mw, irr: c.implied_irr, tech: c.technology })),
    ...projData.map(p => ({ pmw: p._pricePerMw, irr: p._latestRun.project_irr, tech: p.technology })),
  ]

  if (all.length < 2) return null

  const maxPMW = Math.max(...all.map(d => d.pmw)) * 1.15
  const minIRR = Math.min(...all.map(d => d.irr)) - 1
  const maxIRR = Math.max(...all.map(d => d.irr)) + 1
  const W = 100, H = 100

  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          £/MW vs Implied IRR
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.accent, opacity: 0.7 }} />
            <span style={{ fontSize: 9, color: theme.textTertiary }}>Market comps</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, border: `2px solid ${theme.accent}`, background: 'transparent' }} />
            <span style={{ fontSize: 9, color: theme.textTertiary }}>Your projects</span>
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 180 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <line key={`h${f}`} x1={0} x2={W} y1={H * f} y2={H * f} stroke={theme.borderSubtle} strokeWidth={0.3} />
        ))}
        {/* Comp points (circles) */}
        {compData.map((c, i) => {
          const x = (c.implied_irr - minIRR) / (maxIRR - minIRR) * (W - 10) + 5
          const y = H - (c.price_per_mw / maxPMW) * (H - 10) - 5
          return (
            <g key={`c${i}`}>
              <circle cx={x} cy={y} r={2.2} fill={TECH_COLORS[c.technology] || theme.accent} opacity={0.6} />
              <title>{`${c.project_name}: ${fmt(c.implied_irr)}% IRR, ${ccySymbol(c.currency)}${Math.round(c.price_per_mw / 1000)}k/MW`}</title>
            </g>
          )
        })}
        {/* Project points (squares, larger) */}
        {projData.map((p, i) => {
          const x = (p._latestRun.project_irr - minIRR) / (maxIRR - minIRR) * (W - 10) + 5
          const y = H - (p._pricePerMw / maxPMW) * (H - 10) - 5
          return (
            <g key={`p${i}`}>
              <rect x={x - 2.5} y={y - 2.5} width={5} height={5} fill="none" stroke={theme.accent} strokeWidth={0.8} rx={0.5} />
              <rect x={x - 1} y={y - 1} width={2} height={2} fill={theme.accent} rx={0.3} />
              <title>{`${p.name} (Your project): ${fmt(p._latestRun.project_irr)}% IRR, £${Math.round(p._pricePerMw / 1000)}k/MW`}</title>
            </g>
          )
        })}
        {/* Axis labels */}
        <text x={W / 2} y={H - 0.5} textAnchor="middle" fontSize={3} fill={theme.textMuted}>IRR (%)</text>
        <text x={1} y={H / 2} textAnchor="middle" fontSize={3} fill={theme.textMuted} transform={`rotate(-90, 1, ${H / 2})`}>£/MW</text>
      </svg>
    </div>
  )
}

// ── Market Benchmark Bar ────────────────────────────────────────────────────
function BenchmarkBar({ label, projectVal, marketAvg, marketMin, marketMax, unit, color, theme }) {
  if (!marketAvg) return null
  const rangeMin = Math.min(marketMin || marketAvg, projectVal || marketAvg) * 0.85
  const rangeMax = Math.max(marketMax || marketAvg, projectVal || marketAvg) * 1.15
  const span = rangeMax - rangeMin || 1

  const avgPos = ((marketAvg - rangeMin) / span) * 100
  const projPos = projectVal ? ((projectVal - rangeMin) / span) * 100 : null
  const minPos = marketMin ? ((marketMin - rangeMin) / span) * 100 : null
  const maxPos = marketMax ? ((marketMax - rangeMin) / span) * 100 : null

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: theme.textSecondary }}>{label}</span>
        <span style={{ fontSize: 10, color: theme.textTertiary }}>
          Market avg: {unit}{fmt(marketAvg, 0)} {projectVal ? `| Your: ${unit}${fmt(projectVal, 0)}` : ''}
        </span>
      </div>
      <div style={{ position: 'relative', height: 16, background: theme.pillBg, borderRadius: 8, overflow: 'visible' }}>
        {/* Market range band */}
        {minPos != null && maxPos != null && (
          <div style={{
            position: 'absolute', left: `${minPos}%`, width: `${maxPos - minPos}%`,
            height: '100%', background: `${color}20`, borderRadius: 8,
          }} />
        )}
        {/* Market avg line */}
        <div style={{
          position: 'absolute', left: `${avgPos}%`, top: -2, width: 2, height: 20,
          background: color, borderRadius: 1, opacity: 0.7,
        }} />
        {/* Project marker */}
        {projPos != null && (
          <div style={{
            position: 'absolute', left: `${projPos}%`, top: -3, width: 10, height: 22,
            background: theme.accent, borderRadius: 3, transform: 'translateX(-5px)',
            border: `2px solid ${theme.cardBg}`, boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        )}
      </div>
    </div>
  )
}

// ── Project Comparison Card ─────────────────────────────────────────────────
function ProjectCompCard({ project, benchmarks, theme }) {
  const run = project._latestRun
  const tech = project.technology
  const bench = benchmarks[tech]
  if (!bench || !run) return null

  const projIrr = run.project_irr
  const projCapex = run.total_capex
  const projPMW = project._pricePerMw

  return (
    <div style={{
      background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10,
      padding: '16px 18px', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>{project.name}</div>
          <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
            {project.technology} · {project.geography} · {project.capacity_mwp ? `${project.capacity_mwp} MWp` : ''}
          </div>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, color: TECH_COLORS[tech] || theme.textMuted,
          background: `${TECH_COLORS[tech] || theme.textMuted}18`,
          border: `1px solid ${TECH_COLORS[tech] || theme.textMuted}33`,
          borderRadius: 4, padding: '3px 8px',
        }}>{tech}</span>
      </div>

      <BenchmarkBar label="Project IRR" projectVal={projIrr} marketAvg={bench.avgIrr}
        marketMin={bench.minIrr} marketMax={bench.maxIrr} unit="" color="#4A8C5C" theme={theme} />
      <BenchmarkBar label="£/MW" projectVal={projPMW} marketAvg={bench.avgPMW}
        marketMin={bench.minPMW} marketMax={bench.maxPMW} unit="£" color="#FFB162" theme={theme} />

      {/* Quick stat comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        {[
          { label: 'Your IRR', val: projIrr ? `${fmt(projIrr)}%` : '—', compare: bench.avgIrr, actual: projIrr, better: 'higher' },
          { label: 'Market Avg IRR', val: bench.avgIrr ? `${fmt(bench.avgIrr)}%` : '—' },
          { label: `Comps (${tech})`, val: `${bench.count}`, sub: 'transactions' },
        ].map((s, i) => (
          <div key={i} style={{ padding: 8, background: theme.surfaceBg, borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.compare && s.actual
              ? (s.better === 'higher' ? (s.actual >= s.compare ? '#4A8C5C' : '#ef4444') : (s.actual <= s.compare ? '#4A8C5C' : '#ef4444'))
              : theme.textPrimary, fontFamily: 'monospace' }}>{s.val}</div>
            {s.sub && <div style={{ fontSize: 9, color: theme.textTertiary }}>{s.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Comps Dashboard ────────────────────────────────────────────────────
export default function CompsDashboard({ session }) {
  const { theme } = useTheme()
  const [comps, setComps] = useState([])
  const [projects, setProjects] = useState([])
  const [runs, setRuns] = useState({})
  const [loading, setLoading] = useState(true)
  const [filterTech, setFilterTech] = useState('All')
  const [filterGeo, setFilterGeo] = useState('All')
  const [filterStage, setFilterStage] = useState('All')
  const [search, setSearch] = useState('')
  const [showSuggested, setShowSuggested] = useState(false)
  const [viewMode, setViewMode] = useState('comps') // 'comps' | 'compare'

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)

    // Fetch comps, projects, and model runs in parallel
    const [compsRes, projRes] = await Promise.all([
      supabase.from('comparable_transactions').select('*').order('transaction_date', { ascending: false }),
      supabase.from('projects').select('*').eq('cancelled', false).order('created_at', { ascending: false }),
    ])

    const compsData = compsRes.data || []
    const projData = projRes.data || []
    setComps(compsData)
    setProjects(projData)

    // Fetch latest model run for each project
    const runMap = {}
    await Promise.all(projData.map(async p => {
      const { data: runData } = await supabase
        .from('model_runs')
        .select('*')
        .eq('project_id', p.id)
        .order('fm_version', { ascending: false })
        .limit(1)
      if (runData?.[0]) runMap[p.id] = runData[0]
    }))
    setRuns(runMap)
    setLoading(false)
  }

  const handleConfirm = async (comp) => {
    await supabase.from('comparable_transactions').update({ status: 'confirmed' }).eq('id', comp.id)
    fetchAll()
  }

  const handleReject = async (comp) => {
    await supabase.from('comparable_transactions').update({ status: 'rejected' }).eq('id', comp.id)
    fetchAll()
  }

  // Augment projects with run data and price/MW estimate
  const enrichedProjects = useMemo(() => {
    return projects.map(p => {
      const run = runs[p.id] || null
      const capexPerMw = run?.total_capex && p.capacity_mwp ? (run.total_capex / p.capacity_mwp) : null
      return { ...p, _latestRun: run, _pricePerMw: capexPerMw }
    }).filter(p => p._latestRun)
  }, [projects, runs])

  // Filter comps
  const confirmed = comps.filter(c => c.status === 'confirmed')
  const suggested = comps.filter(c => c.status === 'suggested')

  const filtered = useMemo(() => {
    return confirmed.filter(c => {
      if (filterTech !== 'All' && c.technology !== filterTech) return false
      if (filterGeo !== 'All' && c.geography !== filterGeo) return false
      if (filterStage !== 'All' && c.stage !== filterStage) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (![c.project_name, c.buyer, c.seller].some(f => (f || '').toLowerCase().includes(q))) return false
      }
      return true
    })
  }, [confirmed, filterTech, filterGeo, filterStage, search])

  // Market benchmarks by technology
  const benchmarks = useMemo(() => {
    const result = {}
    for (const tech of TECHNOLOGIES.filter(t => t !== 'All')) {
      const techComps = confirmed.filter(c => c.technology === tech)
      if (techComps.length === 0) continue
      const irrs = techComps.filter(c => c.implied_irr).map(c => c.implied_irr)
      const pmws = techComps.filter(c => c.price_per_mw).map(c => c.price_per_mw)
      result[tech] = {
        count: techComps.length,
        avgIrr: irrs.length ? irrs.reduce((a, b) => a + b, 0) / irrs.length : null,
        minIrr: irrs.length ? Math.min(...irrs) : null,
        maxIrr: irrs.length ? Math.max(...irrs) : null,
        avgPMW: pmws.length ? pmws.reduce((a, b) => a + b, 0) / pmws.length : null,
        minPMW: pmws.length ? Math.min(...pmws) : null,
        maxPMW: pmws.length ? Math.max(...pmws) : null,
      }
    }
    return result
  }, [confirmed])

  // Aggregate stats
  const avgPMW = filtered.length ? filtered.reduce((s, c) => s + (c.price_per_mw || 0), 0) / filtered.filter(c => c.price_per_mw).length : null
  const avgIRR = filtered.length ? filtered.reduce((s, c) => s + (c.implied_irr || 0), 0) / filtered.filter(c => c.implied_irr).length : null
  const totalMW = filtered.reduce((s, c) => s + (c.capacity_mw || 0), 0)

  const selectStyle = {
    fontSize: 11, color: theme.textPrimary, background: theme.pillBg,
    border: `1px solid ${theme.pillBorder}`, borderRadius: 6, padding: '3px 8px',
    cursor: 'pointer', outline: 'none', fontFamily: "'Inter', sans-serif",
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <StatCard label="Market Transactions" value={confirmed.length} sub={`${suggested.length} pending review`} theme={theme} />
        <StatCard label="Total Capacity Tracked" value={`${fmt(totalMW, 0)} MW`} sub="Across filtered comps" theme={theme} />
        <StatCard label="Market Avg £/MW" value={avgPMW ? fmtM(avgPMW) : '—'} sub="Filtered transactions" color={theme.accent} theme={theme} />
        <StatCard label="Market Avg IRR" value={avgIRR ? `${fmt(avgIRR)}%` : '—'} sub="Filtered transactions" color="#4A8C5C" theme={theme} />
      </div>

      {/* Scatter chart */}
      <CompScatter comps={filtered} projects={enrichedProjects} theme={theme} />

      {/* Pending review banner */}
      {suggested.length > 0 && (
        <div
          onClick={() => setShowSuggested(!showSuggested)}
          style={{
            background: theme.warningBg, border: `1px solid ${theme.warning}44`, borderRadius: 10,
            padding: '10px 16px', marginBottom: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.warning, animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>
              {suggested.length} scraped transaction{suggested.length !== 1 ? 's' : ''} pending review
            </span>
            <span style={{ fontSize: 11, color: theme.textTertiary }}>— click to review and confirm</span>
          </div>
          <span style={{ fontSize: 11, color: theme.textMuted }}>{showSuggested ? '▲' : '▼'}</span>
        </div>
      )}

      {/* Suggested transactions expanded */}
      {showSuggested && suggested.map(comp => (
        <div key={comp.id} style={{
          background: theme.warningBg, border: `1px solid ${theme.warning}33`, borderRadius: 10,
          padding: '12px 16px', marginBottom: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 3 }}>{comp.project_name}</div>
              <div style={{ fontSize: 11, color: theme.textSecondary, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {comp.technology && <span>{comp.technology}</span>}
                {comp.geography && <span>· {comp.geography}</span>}
                {comp.capacity_mw && <span>· {comp.capacity_mw} MW</span>}
                {comp.total_value && <span>· {fmtM(comp.total_value, ccySymbol(comp.currency))}</span>}
                {comp.price_per_mw && <span>· {ccySymbol(comp.currency)}{Math.round(comp.price_per_mw / 1000)}k/MW</span>}
                {comp.implied_irr && <span>· {fmt(comp.implied_irr)}% IRR</span>}
                {comp.buyer && <span>· Buyer: {comp.buyer}</span>}
                {comp.seller && <span>· Seller: {comp.seller}</span>}
                {comp.stage && <span>· {comp.stage}</span>}
              </div>
              <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3 }}>
                {comp.notes} · {timeAgo(comp.created_at)}
                {comp.source_url && <> · <a href={comp.source_url} target="_blank" rel="noopener noreferrer" style={{ color: theme.link, textDecoration: 'none' }}>Source article →</a></>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => handleConfirm(comp)} style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#4A8C5C', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Confirm</button>
              <button onClick={() => handleReject(comp)} style={{ fontSize: 11, fontWeight: 600, color: theme.error, background: 'transparent', border: `1px solid ${theme.error}44`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Dismiss</button>
            </div>
          </div>
        </div>
      ))}

      {/* View toggle & filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* View mode toggle */}
        <div style={{ display: 'flex', background: theme.pillBg, borderRadius: 8, padding: 2, border: `1px solid ${theme.pillBorder}` }}>
          {[['comps', 'Market Comps'], ['compare', 'Compare to Projects']].map(([mode, label]) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              fontSize: 11, fontWeight: viewMode === mode ? 700 : 500,
              color: viewMode === mode ? '#fff' : theme.textSecondary,
              background: viewMode === mode ? theme.accent : 'transparent',
              border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, color: theme.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tech</span>
          <select style={selectStyle} value={filterTech} onChange={e => setFilterTech(e.target.value)}>
            {TECHNOLOGIES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, color: theme.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Geo</span>
          <select style={selectStyle} value={filterGeo} onChange={e => setFilterGeo(e.target.value)}>
            {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, color: theme.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stage</span>
          <select style={selectStyle} value={filterStage} onChange={e => setFilterStage(e.target.value)}>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted, fontSize: 13, pointerEvents: 'none' }}>⌕</div>
          <input type="text" placeholder="Search comps..." value={search} onChange={e => setSearch(e.target.value)} style={{
            background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8,
            color: theme.textPrimary, padding: '6px 12px 6px 28px', fontSize: 12, outline: 'none',
            width: 200, fontFamily: "'Inter', sans-serif",
          }}
            onFocus={e => { e.target.style.borderColor = theme.accent }}
            onBlur={e => { e.target.style.borderColor = theme.pillBorder }}
          />
        </div>
      </div>

      {/* ── Comps Table View ─────────────────────────────────────────────── */}
      {viewMode === 'comps' && (
        <>
          {loading ? (
            <div style={{ marginTop: 40 }}><EnergyLoader /></div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 60 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 14, color: theme.textMuted, marginBottom: 6 }}>No comparable transactions yet</div>
              <div style={{ fontSize: 11, color: theme.textTertiary, maxWidth: 400, margin: '0 auto' }}>
                Transactions are automatically scraped from energy news sources daily. Review suggested transactions above to build your comp set.
              </div>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 75px 70px 65px 70px 80px 75px 1fr', gap: 8, padding: '5px 16px', marginBottom: 4 }}>
                {['Transaction', 'Tech', 'Stage', 'MW', 'IRR', '£/MW', 'Value', 'Parties'].map(h => (
                  <div key={h} style={{ fontSize: 9, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{h}</div>
                ))}
              </div>

              {/* Rows */}
              {filtered.map(comp => (
                <div key={comp.id}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.background = theme.cardBg }}
                  style={{
                    display: 'grid', gridTemplateColumns: '1.8fr 75px 70px 65px 70px 80px 75px 1fr', gap: 8,
                    padding: '12px 16px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`,
                    borderRadius: 10, marginBottom: 6, alignItems: 'center', transition: 'border-color 0.15s, background 0.15s',
                    cursor: comp.source_url ? 'pointer' : 'default',
                  }}
                  onClick={() => comp.source_url && window.open(comp.source_url, '_blank')}
                >
                  {/* Name + date */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comp.project_name}</div>
                    <div style={{ fontSize: 10, color: theme.textTertiary }}>
                      {comp.transaction_date ? new Date(comp.transaction_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : timeAgo(comp.created_at)}
                      {comp.source === 'auto_scraped' && <span style={{ marginLeft: 6, fontSize: 9, color: theme.accent, fontWeight: 600 }}>AUTO</span>}
                    </div>
                  </div>

                  {/* Tech */}
                  <div>
                    {comp.technology ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: TECH_COLORS[comp.technology] || theme.textMuted,
                        background: `${TECH_COLORS[comp.technology] || theme.textMuted}18`,
                        border: `1px solid ${TECH_COLORS[comp.technology] || theme.textMuted}33`,
                        borderRadius: 4, padding: '2px 6px',
                      }}>{comp.technology}</span>
                    ) : <span style={{ fontSize: 11, color: theme.textMuted }}>—</span>}
                  </div>

                  {/* Stage */}
                  <div>
                    {comp.stage ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: STAGE_COLORS[comp.stage] || theme.textMuted,
                        background: `${STAGE_COLORS[comp.stage] || theme.textMuted}18`,
                        border: `1px solid ${STAGE_COLORS[comp.stage] || theme.textMuted}33`,
                        borderRadius: 4, padding: '2px 6px',
                      }}>{comp.stage}</span>
                    ) : <span style={{ fontSize: 11, color: theme.textMuted }}>—</span>}
                  </div>

                  {/* MW */}
                  <div style={{ fontSize: 13, color: theme.textPrimary, fontFamily: 'monospace' }}>{comp.capacity_mw ? fmt(comp.capacity_mw, 0) : '—'}</div>

                  {/* IRR */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: comp.implied_irr ? '#4A8C5C' : theme.textMuted, fontFamily: 'monospace' }}>
                    {comp.implied_irr ? `${fmt(comp.implied_irr)}%` : '—'}
                  </div>

                  {/* £/MW */}
                  <div style={{ fontSize: 13, color: theme.textPrimary, fontFamily: 'monospace' }}>
                    {comp.price_per_mw ? `${ccySymbol(comp.currency)}${Math.round(comp.price_per_mw / 1000)}k` : '—'}
                  </div>

                  {/* Total value */}
                  <div style={{ fontSize: 12, color: theme.textSecondary, fontFamily: 'monospace' }}>
                    {comp.total_value ? fmtM(comp.total_value, ccySymbol(comp.currency)) : '—'}
                  </div>

                  {/* Parties */}
                  <div style={{ fontSize: 11, color: theme.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[comp.buyer, comp.seller].filter(Boolean).join(' ← ') || '—'}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* ── Compare to Projects View ────────────────────────────────────── */}
      {viewMode === 'compare' && (
        <>
          {enrichedProjects.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 60 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📈</div>
              <div style={{ fontSize: 14, color: theme.textMuted, marginBottom: 6 }}>No project data available</div>
              <div style={{ fontSize: 11, color: theme.textTertiary }}>Run a financial model on your projects to compare them against market transactions.</div>
            </div>
          ) : (
            <>
              {/* Technology benchmark summary */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Market Benchmarks by Technology
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                  {Object.entries(benchmarks).map(([tech, b]) => (
                    <div key={tech} style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: TECH_COLORS[tech] || theme.accent }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary }}>{tech}</span>
                      </div>
                      <div style={{ fontSize: 10, color: theme.textTertiary, lineHeight: 1.6 }}>
                        <div>{b.count} transactions</div>
                        {b.avgIrr && <div>IRR: {fmt(b.avgIrr)}% ({fmt(b.minIrr)}–{fmt(b.maxIrr)}%)</div>}
                        {b.avgPMW && <div>£/MW: {fmtM(b.avgPMW)} ({fmtM(b.minPMW)}–{fmtM(b.maxPMW)})</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-project comparison cards */}
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Your Projects vs Market
              </div>
              {enrichedProjects
                .filter(p => filterTech === 'All' || p.technology === filterTech)
                .map(project => (
                  <ProjectCompCard key={project.id} project={project} benchmarks={benchmarks} theme={theme} />
                ))
              }
              {enrichedProjects.filter(p => filterTech === 'All' || p.technology === filterTech).length === 0 && (
                <div style={{ fontSize: 12, color: theme.textTertiary, textAlign: 'center', marginTop: 20 }}>
                  No projects match the selected technology filter.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
