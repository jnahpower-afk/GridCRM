import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { useCentralAssumptions } from './CentralAssumptions'
import { useTheme } from "./ThemeContext.jsx"
import EnergyLoader from "./EnergyLoader.jsx"
import FuseLogo from './FuseLogo.jsx'
import NewsDashboard from './NewsDashboard.jsx'
import CompsDashboard from './CompsDashboard.jsx'
import AcquisitionTracker from './AcquisitionTracker.jsx'

import { STAGES, countCompleted, getCurrentStageName, isGateDeclined } from './AcquisitionProcess.jsx'

const TECHNOLOGIES = ['Solar', 'Wind', 'BESS', 'Gas Peaker']
const GEOGRAPHIES = ['UK', 'Ireland', 'Spain', 'India']
const STATUSES = ['Greenfield', 'RtB', 'Operational']
const TEAMS = ['UK Dev', 'Spanish Dev', 'Ireland Dev']

const TECH_COLORS = { Solar: '#FFB162', Wind: '#FC6A0A', BESS: '#4A8C5C', 'Gas Peaker': '#f97316' }
const GEO_COLORS  = { UK: '#4A8C5C', Ireland: '#34d399', Spain: '#f87171', India: '#7A8A96' }
const STATUS_COLORS = { Greenfield: '#6366f1', RtB: '#7A8A96', Operational: '#4A8C5C' }

const CANCEL_REASONS = ['Failed due diligence', 'Price too high', 'Lost to competitor', 'Grid / planning risk', 'Strategic fit changed', 'Seller withdrew', 'Other']

// Map acquisition stage IDs to simplified deal stage labels.
// Exported so other dashboards (TopOfFunnelDashboard) can reuse the canonical
// deal-stage taxonomy without duplicating it.
export const DEAL_STAGE_MAP = {
  'origination': 'NBO', 'prelim_dd': 'NBO', 'nbo_meeting': 'NBO',
  'nbo_evaluation': 'FABO', 'fabo_meeting': 'FABO',
  'add_process': 'Exclusivity DD', 'bid_adjustment': 'Exclusivity DD',
  'spa_apa': 'SPA Signing', 'negotiation': 'SPA Signing', 'sign_spa': 'SPA Signing',
  'handover': 'Completed',
}
export const DEAL_STAGE_COLORS = {
  'Under Review':   '#1E40AF', // blue-800 — deep "cold" blue; distinct from Exclusivity DD's lighter blue
  'NBO':            '#7C3AED', // violet-600 — saturated purple; distinct from SPA Signing's lighter violet
  'FABO':           '#FFB162',
  'Exclusivity DD': '#60A5FA',
  'SPA Signing':    '#A78BFA',
  'Completed':      '#4A8C5C',
}
// Stage display order — used by aggregation widgets so bars render in the
// canonical pipeline direction (Under Review → NBO → … → Completed).
export const DEAL_STAGES_ORDERED = ['Under Review', 'NBO', 'FABO', 'Exclusivity DD', 'SPA Signing', 'Completed']

// Get simplified deal stage from acquisition data.
// Returns 'Under Review' for newly-added projects (no acquisition row OR no
// tasks completed yet); progresses to 'NBO' once the first origination task
// is checked off, and onwards through the pipeline.
export function getDealStage(acqData, fmVersionDates) {
  if (!acqData) return 'Under Review'
  const data = acqData.data || acqData
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const stage = STAGES[i]
    const { total, done } = countCompleted(stage.tasks, data, fmVersionDates || {})
    if (done > 0) {
      // If this stage is fully complete, current stage is the next one
      if (done === total && i < STAGES.length - 1) {
        return DEAL_STAGE_MAP[STAGES[i + 1].id] || null
      }
      return DEAL_STAGE_MAP[stage.id] || null
    }
  }
  return 'Under Review'
}

// Get acquisition progress percentage
function getAcqProgress(acqData, fmVersionDates) {
  if (!acqData) return null
  const data = acqData.data || acqData
  let totalAll = 0, doneAll = 0
  for (const stage of STAGES) {
    if (isGateDeclined(stage, data)) break
    const { total, done } = countCompleted(stage.tasks, data, fmVersionDates || {})
    totalAll += total
    doneAll += done
  }
  return totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0
}

const fmt  = (n, d=1) => n == null ? '—' : Number(n).toFixed(d)
const fmtM = (n) => {
  if (!n) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000000) return `£${(n/1000000).toFixed(1)}m`;
  if (abs >= 1000) return `£${(n/1000).toFixed(1)}k`;
  return `£${n.toFixed(0)}`;
}
const fmtK = (n) => !n ? '—' : `£${(n/1000).toFixed(0)}k`

// ── IRR Distribution Histogram ──────────────────────────────────────────────
function IRRHistogram({ projects, getLatestRun, hurdleRate = 7.5 }) {
  const { theme } = useTheme()
  const irrs = projects.map(p => getLatestRun(p)?.project_irr).filter(v => v != null)
  // Buckets: <6, 6-7, 7-8, 8-9, 9-10, 10-12, 12+
  const buckets = [
    { label: '<6%',   min: -99, max: 6,  color: '#ef4444' },
    { label: '6–7%',  min: 6,   max: 7,  color: '#f97316' },
    { label: '7–8%',  min: 7,   max: 8,  color: '#FFB162' },
    { label: '8–9%',  min: 8,   max: 9,  color: '#86efac' },
    { label: '9–10%', min: 9,   max: 10, color: '#4A8C5C' },
    { label: '10–12%',min: 10,  max: 12, color: '#2d6a4f' },
    { label: '12%+',  min: 12,  max: 99, color: '#1B2632' },
  ]
  const counts = buckets.map(b => ({ ...b, count: irrs.filter(v => v >= b.min && v < b.max).length }))
  const maxCount = Math.max(...counts.map(c => c.count), 1)

  if (irrs.length === 0) return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>IRR Distribution</div>
      <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', padding: '20px 0' }}>No IRR data yet</div>
    </div>
  )

  const aboveHurdle = irrs.filter(v => v >= hurdleRate).length
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>IRR Distribution</div>
        <div style={{ fontSize: 10, color: theme.success, fontWeight: 700 }}>{aboveHurdle}/{irrs.length} above hurdle</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110 }}>
        {counts.map((b, i) => {
          const h = b.count === 0 ? 0 : Math.max(8, (b.count / maxCount) * 90)
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {b.count > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: b.color }}>{b.count}</div>}
              <div style={{ width: '100%', height: h, background: b.color, borderRadius: '3px 3px 0 0', opacity: 0.85, minHeight: b.count > 0 ? 8 : 0 }} />
              <div style={{ fontSize: 8, color: theme.textTertiary, textAlign: 'center', lineHeight: 1.2 }}>{b.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── IRR horizontal ranked list ───────────────────────────────────────────────
function IRRChart({ projects, getLatestRun, hurdleRate = 7.5 }) {
  const { theme } = useTheme()
  const points = projects
    .map(p => ({ name: p.name, irr: getLatestRun(p)?.project_irr, tech: p.technology }))
    .filter(p => p.irr != null)
    .sort((a, b) => b.irr - a.irr)

  if (points.length === 0) return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>IRR vs Hurdle Rate</div>
      <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', padding: '20px 0' }}>No IRR data yet</div>
    </div>
  )

  const maxIRR = Math.max(...points.map(p => p.irr), hurdleRate) * 1.15

  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>IRR vs Hurdle Rate</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: theme.warning }}>
          <div style={{ width: 12, height: 1, borderTop: `1.5px dashed ${theme.warning}` }} />
          {hurdleRate}% hurdle
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, overflowY: 'auto', maxHeight: 220 }}>
        {points.map((p, i) => {
          const above = p.irr >= hurdleRate
          const color = above ? theme.success : '#ef4444'
          const barPct = (p.irr / maxIRR) * 100
          const hurdlePct = (hurdleRate / maxIRR) * 100
          const techColor = TECH_COLORS[p.tech] || theme.success
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Project name */}
              <div style={{ width: 80, fontSize: 10, color: '#8A9AAA', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={p.name}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 1, background: techColor, marginRight: 4, verticalAlign: 'middle' }} />
                {p.name}
              </div>
              {/* Bar track */}
              <div style={{ flex: 1, position: 'relative', height: 16, background: theme.pillBg, borderRadius: 4, overflow: 'visible' }}>
                {/* Bar fill */}
                <div style={{ position: 'absolute', left: 0, top: 2, height: 12, width: `${barPct}%`, background: color, borderRadius: 3, opacity: 0.85, transition: 'width 0.3s' }} />
                {/* Hurdle marker */}
                <div style={{ position: 'absolute', left: `${hurdlePct}%`, top: -2, height: 20, width: 1.5, background: theme.warning, opacity: 0.8 }} />
              </div>
              {/* IRR value */}
              <div style={{ width: 36, fontSize: 11, fontWeight: 700, color, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                {fmt(p.irr)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Contracted vs Merchant revenue mix (stacked bar + summary) ──────────────
function RevenueStackChart({ projects, runs }) {
  const { theme } = useTheme()
  const totals = { cfd: 0, ppa: 0, merchant: 0, rego: 0 }
  projects.forEach(p => {
    const r = runs[p.id]
    if (!r) return
    totals.cfd      += r.cfd_rev      || 0
    totals.ppa      += r.ppa_rev      || 0
    totals.merchant += r.merchant_rev || 0
    totals.rego     += r.rego_rev     || 0
  })
  const total = totals.cfd + totals.ppa + totals.merchant + totals.rego
  const contracted = totals.cfd + totals.ppa + totals.rego
  const merchant   = totals.merchant
  const contractedPct = total > 0 ? Math.round((contracted / total) * 100) : 0
  const merchantPct   = total > 0 ? Math.round((merchant / total) * 100) : 0

  const streams = [
    { key: 'cfd',      color: '#FC6A0A', label: 'CfD' },
    { key: 'ppa',      color: '#7A8A96', label: 'PPA' },
    { key: 'rego',     color: '#4A8C5C', label: 'REGO' },
    { key: 'merchant', color: '#FFB162', label: 'Merchant' },
  ]

  if (total === 0) return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 11, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Revenue Contracted vs Merchant</div>
      <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', padding: '20px 0', margin: 'auto 0' }}>No revenue data yet</div>
    </div>
  )

  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Revenue — Contracted vs Merchant</div>
        <div style={{ fontSize: 11, color: '#8A9AAA' }}>Lifetime £000s</div>
      </div>
      {/* Two headline figures */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div style={{ padding: '14px 16px', background: theme.pillBg, borderRadius: 8, borderLeft: `4px solid ${theme.accent}` }}>
          <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Contracted</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: theme.accent, fontFamily: 'monospace', lineHeight: 1.1 }}>{contractedPct}%</div>
          <div style={{ fontSize: 12, color: '#8A9AAA', marginTop: 4 }}>{fmtM(contracted * 1000)}</div>
        </div>
        <div style={{ padding: '14px 16px', background: theme.pillBg, borderRadius: 8, borderLeft: `4px solid ${theme.warning}` }}>
          <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Merchant</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: theme.warning, fontFamily: 'monospace', lineHeight: 1.1 }}>{merchantPct}%</div>
          <div style={{ fontSize: 12, color: '#8A9AAA', marginTop: 4 }}>{fmtM(merchant * 1000)}</div>
        </div>
      </div>
      {/* Full stacked bar */}
      <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden', marginBottom: 14, flex: '0 0 auto' }}>
        {streams.map(s => {
          const pct = total > 0 ? (totals[s.key] / total) * 100 : 0
          if (pct === 0) return null
          return <div key={s.key} style={{ width: `${pct}%`, background: s.color, opacity: 0.9, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={`${s.label}: ${Math.round(pct)}%`}>
            {pct >= 8 && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{Math.round(pct)}%</span>}
          </div>
        })}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 'auto' }}>
        {streams.filter(s => totals[s.key] > 0).map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <span style={{ fontSize: 11, color: theme.textTertiary }}>{s.label}</span>
            <span style={{ fontSize: 11, color: theme.textSecondary, fontWeight: 600 }}>{total > 0 ? Math.round((totals[s.key]/total)*100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CapEx Drawdown Timeline ─────────────────────────────────────────────────
function CapexTimelineChart({ projects, getLatestRun }) {
  const { theme } = useTheme()
  // Build quarterly buckets of CapEx by project, keyed by COD quarter
  // (CapEx is committed during construction leading up to COD)
  const buckets = {}
  projects.forEach(p => {
    const r = getLatestRun(p)
    if (!r || !r.total_capex || !p.cod) return
    const codDate = new Date(p.cod)
    const yr = codDate.getFullYear()
    const q = Math.floor(codDate.getMonth() / 3) + 1
    const key = `${yr} Q${q}`
    if (!buckets[key]) buckets[key] = { total: 0, equity: 0, debt: 0, projects: [] }
    const capex = r.total_capex / 1e6 // £m
    const gearing = (p.gearing || 70) / 100
    buckets[key].total += capex
    buckets[key].debt += capex * gearing
    buckets[key].equity += capex * (1 - gearing)
    buckets[key].projects.push(p.name)
  })
  const data = Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0]))

  if (data.length === 0) return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>CapEx Drawdown Timeline</div>
      <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', padding: '20px 0' }}>No data yet</div>
    </div>
  )

  const W = 380, H = 160, PL = 36, PB = 28, PT = 14, PR = 8
  const cW = W - PL - PR, cH = H - PT - PB
  const maxVal = Math.max(...data.map(([, d]) => d.total), 1)
  const slotW = cW / data.length
  const barW = Math.max(20, Math.min(48, slotW - 10))

  // Friendly y-axis ticks
  const yStep = maxVal > 20 ? 10 : maxVal > 10 ? 5 : maxVal > 4 ? 2 : 1
  const yTicks = []
  for (let v = 0; v <= maxVal * 1.05; v += yStep) yTicks.push(Math.round(v))
  if (yTicks.length < 2) yTicks.push(Math.ceil(maxVal))

  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>CapEx Drawdown Timeline</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: theme.accent }} />
            <span style={{ fontSize: 9, color: theme.textTertiary }}>Equity</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: '#2C3B4D' }} />
            <span style={{ fontSize: 9, color: theme.textTertiary }}>Debt</span>
          </div>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
        {/* Gridlines */}
        {yTicks.map(v => {
          const y = PT + cH - (v / maxVal) * cH
          return <line key={v} x1={PL} x2={PL + cW} y1={y} y2={y} stroke={theme.borderSubtle} strokeWidth={0.8} />
        })}
        <line x1={PL} x2={PL} y1={PT} y2={PT + cH} stroke={theme.cardBorder} strokeWidth={1} />
        {/* Y labels */}
        {yTicks.map(v => {
          const y = PT + cH - (v / maxVal) * cH
          return <text key={v} x={PL - 3} y={y + 3} textAnchor="end" fontSize={8} fill={theme.textTertiary}>£{v}m</text>
        })}
        {/* Stacked bars: equity (bottom) + debt (top) */}
        {data.map(([label, d], i) => {
          const x = PL + i * slotW + (slotW - barW) / 2
          const equityH = Math.max(1, (d.equity / maxVal) * cH)
          const debtH = Math.max(1, (d.debt / maxVal) * cH)
          const totalH = equityH + debtH
          const barTop = PT + cH - totalH
          return (
            <g key={label}>
              {/* Debt (top segment) */}
              <rect x={x} y={barTop} width={barW} height={debtH} fill="#2C3B4D" opacity={0.85} rx={3} />
              {/* Debt label inside segment */}
              {debtH > 14 && <text x={x + barW / 2} y={barTop + debtH / 2 + 3} textAnchor="middle" fontSize={8} fontWeight="600" fill={theme.elevatedBg}>£{d.debt.toFixed(1)}m</text>}
              {/* Equity (bottom segment) */}
              <rect x={x} y={barTop + debtH} width={barW} height={equityH} fill={theme.accent} opacity={0.88} />
              {/* Equity label inside segment */}
              {equityH > 14 && <text x={x + barW / 2} y={barTop + debtH + equityH / 2 + 3} textAnchor="middle" fontSize={8} fontWeight="600" fill="#fff">£{d.equity.toFixed(1)}m</text>}
              {/* Total label above */}
              <text x={x + barW / 2} y={barTop - 3} textAnchor="middle" fontSize={9} fontWeight="600" fill="#2C3B4D">£{d.total.toFixed(1)}m</text>
              {/* Project names */}
              <text x={x + barW / 2} y={PT + cH + 10} textAnchor="middle" fontSize={7} fill={theme.textTertiary}>{d.projects.length} proj</text>
              {/* Quarter label */}
              <text x={x + barW / 2} y={PT + cH + 20} textAnchor="middle" fontSize={8} fill={theme.textSecondary} fontWeight="600">{label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Pipeline by COD — monthly drill-down modal ──────────────────────────────
function CodChartModal({ projects, onClose }) {
  const { theme } = useTheme()
  const [chartScale, setChartScale] = useState(0.5) // 0.2 → 1.5

  // Group by YYYY-MM
  const grouped = {}
  projects.forEach(p => {
    if (!p.cod || !p.capacity_mwp) return
    const ym = p.cod.slice(0, 7)
    if (!grouped[ym]) grouped[ym] = { total: 0, segments: [] }
    grouped[ym].total += p.capacity_mwp
    grouped[ym].segments.push({ name: p.name, mwp: p.capacity_mwp, tech: p.technology || 'Solar' })
  })
  const data = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const techSet = new Set()
  data.forEach(([, d]) => d.segments.forEach(s => techSet.add(s.tech)))
  const techList = ['Solar', 'Wind', 'BESS', 'Gas Peaker'].filter(t => techSet.has(t))

  // ── Dynamic chart height driven by the scale slider ──
  const MIN_SEG_H = Math.round(26 * chartScale)
  const PL = 40, PB = 44, PT = 24, PR = 16
  const maxVal = Math.max(...(data.length ? data.map(([, d]) => d.total) : [1]), 1)
  const allSegs = data.flatMap(([, d]) => d.segments)
  const minSegFrac = allSegs.length ? Math.min(...allSegs.map(s => s.mwp / maxVal)) : 1
  const minCH = Math.ceil(MIN_SEG_H / minSegFrac)
  const cH = Math.max(120, minCH)
  const H = cH + PT + PB
  const slotCount = Math.max(data.length, 1)
  const W = Math.max(600, slotCount * 90 + PL + PR)
  const cW = W - PL - PR
  const slotW = cW / slotCount
  const barW = Math.max(40, Math.min(72, slotW - 16))

  const yStep = maxVal > 200 ? 50 : maxVal > 100 ? 50 : maxVal > 40 ? 20 : maxVal > 20 ? 10 : 5
  const yTicks = []
  for (let v = 0; v <= maxVal * 1.1; v += yStep) yTicks.push(Math.round(v))
  if (yTicks.length < 2) yTicks.push(Math.ceil(maxVal))

  // Table data — sorted by COD
  const tableRows = [...projects]
    .filter(p => p.cod && p.capacity_mwp)
    .sort((a, b) => a.cod.localeCompare(b.cod))
  const totalMwp = tableRows.reduce((s, p) => s + (p.capacity_mwp || 0), 0)

  const TH = { fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '7px 12px', textAlign: 'left', borderBottom: `1px solid ${theme.cardBorder}`, whiteSpace: 'nowrap' }
  const TD = { fontSize: 12, color: theme.textSecondary, padding: '7px 12px', borderBottom: `1px solid ${theme.borderSubtle}`, verticalAlign: 'middle' }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
    >
      <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, width: '100%', maxWidth: 1160, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pipeline by COD Month (MWp)</div>
            <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>Monthly breakdown · {tableRows.length} projects · {fmt(totalMwp, 0)} MWp total</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {techList.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: TECH_COLORS[t] }} />
                <span style={{ fontSize: 11, color: theme.textTertiary }}>{t}</span>
              </div>
            ))}
            {/* Chart height slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, borderLeft: `1px solid ${theme.cardBorder}`, paddingLeft: 16 }}>
              <span style={{ fontSize: 10, color: theme.textTertiary, whiteSpace: 'nowrap' }}>Chart size</span>
              <input
                type="range" min="0.2" max="1.5" step="0.05"
                value={chartScale}
                onChange={e => setChartScale(parseFloat(e.target.value))}
                style={{ width: 80, accentColor: theme.accent, cursor: 'pointer' }}
              />
            </div>
            <button onClick={onClose} style={{ background: 'none', border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.textTertiary, fontSize: 18, cursor: 'pointer', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Scrollable body — chart + table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Chart */}
          <div style={{ overflowX: 'auto', padding: '24px 24px 8px' }}>
            {data.length === 0 ? (
              <div style={{ fontSize: 13, color: theme.textMuted, textAlign: 'center', padding: '60px 0' }}>No COD data available</div>
            ) : (
              <svg width={W} height={H} style={{ display: 'block', minWidth: W }}>
                {/* Gridlines + Y labels */}
                {yTicks.map(v => {
                  const y = PT + cH - (v / maxVal) * cH
                  return (
                    <g key={v}>
                      <line x1={PL} x2={PL + cW} y1={y} y2={y} stroke={theme.borderSubtle} strokeWidth={0.8} />
                      <text x={PL - 5} y={y + 3} textAnchor="end" fontSize={9} fill={theme.textTertiary}>{v}</text>
                    </g>
                  )
                })}
                <line x1={PL} x2={PL} y1={PT} y2={PT + cH} stroke={theme.cardBorder} strokeWidth={1} />

                {/* Year separators + labels */}
                {(() => {
                  const yearGroups = {}
                  data.forEach(([ym], i) => {
                    const yr = ym.slice(0, 4)
                    if (!yearGroups[yr]) yearGroups[yr] = { first: i, last: i }
                    yearGroups[yr].last = i
                  })
                  return Object.entries(yearGroups).map(([yr, { first, last }]) => {
                    const xStart = PL + first * slotW
                    const xEnd   = PL + (last + 1) * slotW
                    const midX   = (xStart + xEnd) / 2
                    return (
                      <g key={yr}>
                        {first > 0 && <line x1={xStart} x2={xStart} y1={PT} y2={PT + cH + 32} stroke={theme.cardBorder} strokeWidth={1} strokeDasharray="4 3" />}
                        <text x={midX} y={H - 4} textAnchor="middle" fontSize={12} fontWeight="700" fill={theme.textSecondary}>{yr}</text>
                      </g>
                    )
                  })
                })()}

                {/* Stacked bars */}
                {data.map(([ym, d], i) => {
                  const monthIdx = parseInt(ym.slice(5, 7), 10) - 1
                  const x = PL + i * slotW + (slotW - barW) / 2
                  let yBottom = PT + cH
                  return (
                    <g key={ym}>
                      {d.segments.map((seg, si) => {
                        const segH = Math.max(2, (seg.mwp / maxVal) * cH)
                        yBottom -= segH
                        const isTop = si === d.segments.length - 1
                        return (
                          <g key={si}>
                            <rect x={x} y={yBottom} width={barW} height={segH}
                              fill={TECH_COLORS[seg.tech] || theme.textTertiary}
                              opacity={0.88} rx={isTop ? 4 : 0}
                            />
                            {/* Name label — always shown when tall enough */}
                            {segH >= MIN_SEG_H - 2 && (
                              <text x={x + barW / 2} y={yBottom + segH / 2 + 4} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="600">
                                {seg.name.length > 11 ? seg.name.slice(0, 10) + '…' : seg.name}
                              </text>
                            )}
                            {/* MWp sub-label when segment is very tall */}
                            {segH >= MIN_SEG_H + 10 && (
                              <text x={x + barW / 2} y={yBottom + segH / 2 + 14} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.7)">
                                {seg.mwp % 1 === 0 ? seg.mwp : seg.mwp.toFixed(1)} MWp
                              </text>
                            )}
                          </g>
                        )
                      })}
                      {/* Total above bar */}
                      <text x={x + barW / 2} y={yBottom - 5} textAnchor="middle" fontSize={10} fontWeight="700" fill={theme.success}>
                        {d.total % 1 === 0 ? d.total : d.total.toFixed(1)} MWp
                      </text>
                      {/* Month label */}
                      <text x={x + barW / 2} y={PT + cH + 14} textAnchor="middle" fontSize={10} fill={theme.textTertiary}>{MONTHS[monthIdx]}</text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>

          {/* Project table */}
          <div style={{ padding: '0 24px 24px' }}>
            <div style={{ borderRadius: 10, border: `1px solid ${theme.cardBorder}`, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                <thead>
                  <tr style={{ background: theme.elevatedBg || theme.pillBg }}>
                    <th style={TH}>Project</th>
                    <th style={{ ...TH, textAlign: 'center' }}>COD</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Technology</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Geography</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Capacity (MWp)</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(p => (
                    <tr key={p.id} style={{ background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg || theme.pillBg }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ ...TD, fontWeight: 600, color: theme.textPrimary }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 7, height: 7, borderRadius: 2, background: TECH_COLORS[p.technology || 'Solar'], flexShrink: 0 }} />
                          {p.name}
                        </div>
                      </td>
                      <td style={{ ...TD, textAlign: 'center', color: theme.textTertiary }}>
                        {p.cod ? `${MONTHS[parseInt(p.cod.slice(5, 7), 10) - 1]} ${p.cod.slice(0, 4)}` : '—'}
                      </td>
                      <td style={{ ...TD, textAlign: 'center' }}>
                        <span style={{ background: TECH_COLORS[p.technology || 'Solar'] + '22', color: TECH_COLORS[p.technology || 'Solar'], borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                          {p.technology || 'Solar'}
                        </span>
                      </td>
                      <td style={{ ...TD, textAlign: 'center', color: theme.textTertiary }}>{p.geography || '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: theme.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                        {p.capacity_mwp % 1 === 0 ? p.capacity_mwp : p.capacity_mwp.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: theme.elevatedBg || theme.pillBg, borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...TD, fontWeight: 700, color: theme.textPrimary, borderBottom: 'none' }}>Total</td>
                    <td style={{ ...TD, borderBottom: 'none' }} />
                    <td style={{ ...TD, textAlign: 'center', fontSize: 11, color: theme.textTertiary, borderBottom: 'none' }}>{tableRows.length} projects</td>
                    <td style={{ ...TD, borderBottom: 'none' }} />
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: theme.success, fontSize: 13, borderBottom: 'none', fontVariantNumeric: 'tabular-nums' }}>
                      {totalMwp % 1 === 0 ? totalMwp : totalMwp.toFixed(1)} MWp
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Pipeline by COD Year — stacked by project MWp ──────────────────────────
function CodChart({ projects }) {
  const { theme } = useTheme()
  const [expanded, setExpanded] = useState(false)
  // Group by year, with individual project segments for stacking
  const grouped = {}
  projects.forEach(p => {
    if (!p.cod || !p.capacity_mwp) return
    const yr = p.cod.slice(0, 4)
    if (!grouped[yr]) grouped[yr] = { total: 0, segments: [] }
    grouped[yr].total += p.capacity_mwp
    grouped[yr].segments.push({
      name: p.name,
      mwp: p.capacity_mwp,
      tech: p.technology || 'Solar',
    })
  })
  const data = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))

  if (data.length === 0) return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Pipeline by COD Year</div>
      <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', padding: '20px 0' }}>No COD data yet</div>
    </div>
  )

  // Collect unique techs for legend
  const techSet = new Set()
  data.forEach(([, d]) => d.segments.forEach(s => techSet.add(s.tech)))
  const techList = ['Solar', 'Wind', 'BESS', 'Gas Peaker'].filter(t => techSet.has(t))

  const W = 400, H = 160, PL = 32, PB = 28, PT = 14, PR = 8
  const cW = W - PL - PR, cH = H - PT - PB
  const maxVal = Math.max(...data.map(([, d]) => d.total), 1)
  const slotW = cW / data.length
  const barW = Math.max(24, Math.min(56, slotW - 10))

  // Y-axis ticks
  const yStep = maxVal > 100 ? 50 : maxVal > 40 ? 20 : maxVal > 20 ? 10 : 5
  const yTicks = []
  for (let v = 0; v <= maxVal * 1.05; v += yStep) yTicks.push(Math.round(v))
  if (yTicks.length < 2) yTicks.push(Math.ceil(maxVal))

  return (
    <>
      {expanded && <CodChartModal projects={projects} onClose={() => setExpanded(false)} />}
      <div
        onClick={() => setExpanded(true)}
        title="Click to expand monthly view"
        style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = theme.cardBorder }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Pipeline by COD Year (MWp)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {techList.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: TECH_COLORS[t] }} />
                <span style={{ fontSize: 9, color: theme.textTertiary }}>{t}</span>
              </div>
            ))}
            <span style={{ fontSize: 9, color: theme.textTertiary, marginLeft: 4, opacity: 0.6 }}>↗ expand</span>
          </div>
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
          {/* Gridlines */}
          {yTicks.map(v => {
            const y = PT + cH - (v / maxVal) * cH
            return <line key={v} x1={PL} x2={PL + cW} y1={y} y2={y} stroke={theme.borderSubtle} strokeWidth={0.8} />
          })}
          <line x1={PL} x2={PL} y1={PT} y2={PT + cH} stroke={theme.cardBorder} strokeWidth={1} />
          {/* Y labels */}
          {yTicks.map(v => {
            const y = PT + cH - (v / maxVal) * cH
            return <text key={v} x={PL - 3} y={y + 3} textAnchor="end" fontSize={8} fill={theme.textTertiary}>{v}</text>
          })}
          {/* Stacked bars — each segment is a project */}
          {data.map(([yr, d], i) => {
            const x = PL + i * slotW + (slotW - barW) / 2
            let yBottom = PT + cH
            return (
              <g key={yr}>
                {d.segments.map((seg, si) => {
                  const segH = Math.max(2, (seg.mwp / maxVal) * cH)
                  yBottom -= segH
                  const isTop = si === d.segments.length - 1
                  return (
                    <g key={si}>
                      <rect
                        x={x} y={yBottom}
                        width={barW} height={segH}
                        fill={TECH_COLORS[seg.tech] || theme.textTertiary}
                        opacity={0.88}
                        rx={isTop ? 3 : 0}
                      />
                      {segH > 12 && (
                        <text x={x + barW / 2} y={yBottom + segH / 2 + 3} textAnchor="middle" fontSize={7} fill="#fff" fontWeight="600">
                          {seg.name.length > 8 ? seg.name.slice(0, 7) + '…' : seg.name}
                        </text>
                      )}
                    </g>
                  )
                })}
                <text x={x + barW / 2} y={yBottom - 3} textAnchor="middle" fontSize={9} fontWeight="600" fill={theme.success}>{fmt(d.total, 0)} MWp</text>
                <text x={x + barW / 2} y={PT + cH + 10} textAnchor="middle" fontSize={8} fill={theme.textTertiary}>{d.segments.length} proj</text>
                <text x={x + barW / 2} y={PT + cH + 20} textAnchor="middle" fontSize={9} fill={theme.textSecondary} fontWeight="600">{yr}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </>
  )
}

// ── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, value2, value2Label, value2Color, badge, badgeColor }) {
  const { theme } = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? theme.hoverBg : theme.cardBg,
        border: `1px solid ${hovered ? theme.accent : theme.cardBorder}`,
        borderRadius: 12, padding: '16px 20px',
        transition: 'background 0.15s, border-color 0.15s',
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</div>
        {badge != null && <div style={{ fontSize: 10, fontWeight: 700, color: badgeColor || '#ef4444', background: (badgeColor || '#ef4444') + '18', border: `1px solid ${badgeColor || '#ef4444'}44`, borderRadius: 4, padding: '1px 6px' }}>{badge}</div>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || theme.textPrimary, fontFamily: "'Inter', sans-serif" }}>{value}</div>
      <div style={{ overflow: 'hidden', maxHeight: hovered ? 40 : 0, opacity: hovered ? 1 : 0, transition: 'max-height 0.2s ease, opacity 0.2s ease' }}>
        {value2 && (
          <div style={{ fontSize: 12, fontWeight: 600, color: value2Color || '#8A9AAA', marginTop: 2 }}>{value2Label && <span style={{ fontWeight: 400, color: theme.textTertiary }}>{value2Label} </span>}{value2}</div>
        )}
        {sub && <div style={{ fontSize: 11, color: '#8A9AAA', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ── Portfolio health card ────────────────────────────────────────────────────
function PortfolioHealthCard({ counts, atRisk, preCODCapex }) {
  const { theme } = useTheme()
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>Portfolio Health</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {STATUSES.map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: STATUS_COLORS[s] }} />
              <span style={{ fontSize: 11, color: theme.textSecondary }}>{s}</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLORS[s], fontFamily: 'monospace' }}>{counts[s] || 0}</span>
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${theme.borderSubtle}`, paddingTop: 7, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: theme.textSecondary }}>At risk</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: atRisk > 0 ? '#ef4444' : theme.success, fontFamily: 'monospace' }}>{atRisk} project{atRisk !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: theme.textSecondary }}>Pipeline spend</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: theme.textPrimary, fontFamily: 'monospace' }}>{preCODCapex > 0 ? fmtM(preCODCapex) : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Portfolio component ────────────────────────────────────────────────
// Compact multi-select dropdown for the Projects filters. Empty selection = all.
function MultiFilter({ allLabel, options, selected, onToggle, onClear, theme }) {
  const [open, setOpen] = useState(false)
  const active = selected.length > 0
  const summary = selected.length === 0 ? allLabel : selected.length <= 2 ? selected.join(', ') : `${selected.length} selected`
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: active ? theme.accent + '18' : theme.pillBg,
        border: `1px solid ${active ? theme.accent + '55' : theme.pillBorder}`,
        color: active ? theme.accent : theme.textSecondary,
        borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      }}>
        {summary} <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 51,
            background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: 150, padding: 4,
          }}>
            {options.map(o => {
              const on = selected.includes(o)
              return (
                <div key={o} onClick={() => onToggle(o)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: theme.textPrimary }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.pillBg}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    border: `1px solid ${on ? theme.accent : theme.cardBorder}`, background: on ? theme.accent : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 800,
                  }}>{on ? '✓' : ''}</span>
                  {o}
                </div>
              )
            })}
            {active && (
              <div onClick={onClear}
                style={{ borderTop: `1px solid ${theme.cardBorder}`, marginTop: 4, padding: '7px 9px', fontSize: 11, color: theme.textTertiary, cursor: 'pointer', textAlign: 'center' }}>
                Clear
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function Portfolio({ session, onOpenProject, onNewProject }) {
  const { theme, themeName, setThemeName } = useTheme()
  const [projects, setProjects] = useState([])
  const [runs, setRuns] = useState({}) // projectId → latest run
  const [acqData, setAcqData] = useState({}) // projectId → acquisition data
  const [inputData, setInputData] = useState({}) // projectId → { field_name: field_value }
  const [fmVersionDates, setFmVersionDates] = useState({}) // projectId → { fmVersion: date } (for acq progress / deal stage)
  const [overviewData, setOverviewData] = useState({}) // projectId → project_overview.data (Executive Summary)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(null)
  const [viewMode, setViewMode] = useState('projects') // 'projects' | 'leads' | 'news' | 'comps'
  const [search, setSearch] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [filterTech, setFilterTech] = useState(['Solar'])  // default view: Solar (multi-select; [] = all)
  const [filterGeo, setFilterGeo]   = useState(['UK'])      // default view: UK   (multi-select; [] = all)
  const toggleIn = (setter) => (opt) => setter(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt])
  const [sortKey, setSortKey] = useState('stage')  // default: Stage, completed first
  const [sortDir, setSortDir] = useState('desc')
  const toggleSort = (k) => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('asc'); } }
  const [cancelTarget, setCancelTarget] = useState(null) // project pending cancellation
  const [cancelReason, setCancelReason] = useState('')
  const [cancelNotes, setCancelNotes] = useState('')
  const { assumptions, loading: assumptionsLoading, error: assumptionsError } = useCentralAssumptions() || {}

  useEffect(() => { fetchProjects() }, [])

  const fetchProjects = async () => {
    setLoading(true)
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (projectData) {
      setProjects(projectData)
      // Fetch runs, acquisition data, inputs, and overview data for each project
      const runMap = {}, acqMap = {}, inputMap = {}, fmMap = {}, overviewMap = {}
      await Promise.all(projectData.map(async p => {
        const [runsRes, acqRes, inputsRes, ovRes] = await Promise.all([
          supabase.from('model_runs').select('*').eq('project_id', p.id).order('fm_version', { ascending: false }).limit(1),
          supabase.from('project_acquisition').select('*').eq('project_id', p.id).limit(1),
          supabase.from('project_inputs').select('inputs, version, fm_created_at, created_at').eq('project_id', p.id),
          supabase.from('project_overview').select('data').eq('project_id', p.id).limit(1),
        ])
        if (runsRes.data?.[0]) runMap[p.id] = runsRes.data[0]
        if (acqRes.data?.[0]) acqMap[p.id] = acqRes.data[0]
        if (ovRes.data?.[0]?.data) overviewMap[p.id] = ovRes.data[0].data
        if (inputsRes.data) {
          const fm = {}
          let latestInputs = null, latestVer = -1
          inputsRes.data.forEach(i => {
            // FM version creation dates drive fm_action task completion (deal stage / acq %).
            if (i.version != null && (i.fm_created_at || i.created_at)) fm[i.version] = i.fm_created_at || i.created_at
            const v = i.version ?? 0
            if (i.inputs && v >= latestVer) { latestVer = v; latestInputs = i.inputs }
          })
          inputMap[p.id] = latestInputs || {}
          fmMap[p.id] = fm
        }
      }))
      setRuns(runMap)
      setAcqData(acqMap)
      setInputData(inputMap)
      setFmVersionDates(fmMap)
      setOverviewData(overviewMap)
    }
    setLoading(false)
  }

  const handleSignOut = async () => { await supabase.auth.signOut() }

  const handleDelete = async (projectId) => {
    if (!window.confirm('Are you sure you want to delete this project? This cannot be undone.')) return
    await supabase.from('run_cashflows').delete().eq('project_id', projectId)
    await supabase.from('model_runs').delete().eq('project_id', projectId)
    await supabase.from('project_inputs').delete().eq('project_id', projectId)
    await supabase.from('projects').delete().eq('id', projectId)
    setMenuOpen(null)
    fetchProjects()
  }
  const getLatestRun = (p) => runs[p.id] || null

  const parseNum = (v) => {
    if (v == null || v === '') return null
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
    return isNaN(n) ? null : n
  }
  // Resolve an Executive Summary value the same way the overview page does:
  // manual override → uploaded fin model → in-app DCF inputs → project record.
  const acqOf = (p) => acqData[p.id]?.data || null
  const uploadedFM = (p) => { const a = acqOf(p); return a?.model_source === 'uploaded' ? a.fin_model : null }
  // MWp = Executive Summary "Size".
  const projectMwp = (p) => {
    const ov = parseNum(overviewData[p.id]?.size); if (ov != null) return ov
    const u = uploadedFM(p); if (u?.capacity_mwp != null) return Number(u.capacity_mwp)
    const cap = parseNum(inputData[p.id]?.capacity); if (cap != null) return cap
    return p.capacity_mwp != null ? Number(p.capacity_mwp) : null
  }
  const gridCostOf = (p) => {
    const ov = parseNum(overviewData[p.id]?.grid_cost); if (ov != null) return ov
    const u = uploadedFM(p); if (u?.grid_cost != null) return Number(u.grid_cost)
    const fm = inputData[p.id] || {}
    const gc = (Number(fm.gridContestable) || 0) + (Number(fm.gridNonContestable) || 0)
    return gc > 0 ? gc : null
  }
  const exportOf = (p) => {
    const ov = parseNum(overviewData[p.id]?.export); if (ov != null) return ov
    const u = uploadedFM(p); if (u?.export_mw != null) return Number(u.export_mw)
    const ex = parseNum(inputData[p.id]?.exportCapacity); if (ex != null) return ex
    return null
  }
  // Grid £/MWe = Grid Cost ÷ Export.
  const gridPerMW = (p) => { const gc = gridCostOf(p), ex = exportOf(p); return (gc && ex) ? gc / ex : null }

  // Cancel = soft archive. Keeps the project and all its model data; just
  // flags it so it drops out of the active pipeline (recoverable via Restore).
  const handleCancel = async () => {
    if (!cancelTarget || !cancelReason) return
    const { error } = await supabase.from('projects')
      .update({ cancelled: true, cancel_reason: cancelReason, cancel_notes: cancelNotes || null, cancelled_at: new Date().toISOString() })
      .eq('id', cancelTarget.id)
    if (error) { console.error('Error cancelling project:', error); return }
    setCancelTarget(null); setCancelReason(''); setCancelNotes(''); setMenuOpen(null)
    fetchProjects()
  }

  const handleRestore = async (projectId) => {
    const { error } = await supabase.from('projects')
      .update({ cancelled: false, cancel_reason: null, cancel_notes: null, cancelled_at: null })
      .eq('id', projectId)
    if (error) { console.error('Error restoring project:', error); return }
    setMenuOpen(null)
    fetchProjects()
  }

  const matchesSearch = (p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
  // Technology / geography filters. All KPIs, status groups and charts derive
  // from `filtered`, so they update with the filter automatically.
  const matchesFilters = (p) =>
    (filterTech.length === 0 || filterTech.includes(p.technology || 'Solar')) &&
    (filterGeo.length === 0 || filterGeo.includes(p.geography))
  // Active pipeline — drives the KPIs and status groups (never includes cancelled).
  const filtered = projects.filter(p => !p.cancelled && matchesSearch(p) && matchesFilters(p))
  // Cancelled (archived) projects, shown in their own group when toggled on.
  const cancelledProjects = projects.filter(p => p.cancelled && matchesSearch(p) && matchesFilters(p))

  // ── Aggregate KPIs ────────────────────────────────────────────────────────
  const totalMW       = filtered.reduce((s, p) => s + (projectMwp(p) || 0), 0)
  const totalCapex    = filtered.reduce((s, p) => s + (getLatestRun(p)?.total_capex || 0), 0)
  const totalEquity   = filtered.reduce((s, p) => {
    const r = getLatestRun(p)
    const cap = r?.total_capex || 0
    return s + cap * (1 - ((p.gearing || 70) / 100))
  }, 0)
  const irrs          = filtered.map(p => getLatestRun(p)?.project_irr).filter(Boolean)
  const blendedIRR    = irrs.length ? irrs.reduce((a, b) => a + b, 0) / irrs.length : null
  const equityIrrs    = filtered.map(p => getLatestRun(p)?.equity_irr).filter(v => v != null && v > -50 && v < 100)
  const blendedEquityIRR = equityIrrs.length ? equityIrrs.reduce((a, b) => a + b, 0) / equityIrrs.length : null
  const statusCounts  = STATUSES.reduce((acc, s) => ({ ...acc, [s]: filtered.filter(p => p.status === s).length }), {})
  const totalNPV      = filtered.reduce((s, p) => s + (getLatestRun(p)?.project_npv || 0), 0)
  const totalDistrib  = filtered.reduce((s, p) => s + (getLatestRun(p)?.total_distributions || 0), 0)
  const atRisk        = filtered.filter(p => { const r = getLatestRun(p); return r && (r.project_irr < 7.5 || (r.min_dscr && r.min_dscr < 1.25)) }).length
  const preCODCapex   = filtered.filter(p => p.status !== 'Operational').reduce((s, p) => s + (getLatestRun(p)?.total_capex || 0), 0)

  // ── Chart data ────────────────────────────────────────────────────────────
  const techMW = TECHNOLOGIES
    .map(t => ({ label: t, value: filtered.filter(p => p.technology === t).reduce((s, p) => s + (projectMwp(p) || 0), 0) }))
    .filter(d => d.value > 0)
  const geoMW = GEOGRAPHIES
    .map(g => ({ label: g, value: filtered.filter(p => p.geography === g).reduce((s, p) => s + (projectMwp(p) || 0), 0) }))
    .filter(d => d.value > 0)

  // ── Group by status ───────────────────────────────────────────────────────
  const byStatus = STATUSES
    .map(status => ({ status, projects: filtered.filter(p => p.status === status), color: STATUS_COLORS[status] }))
    .filter(g => g.projects.length > 0)

  // Append a Cancelled group when the toggle is on.
  const groups = showCancelled && cancelledProjects.length > 0
    ? [...byStatus, { status: 'Cancelled', projects: cancelledProjects, color: '#9CA3AF' }]
    : byStatus

  // Sort rows within each status group by the active column. Missing values sink.
  const sortProjects = (projs) => {
    if (!sortKey) return projs
    const missing = (p) => sortKey === 'mwp' ? (projectMwp(p) == null)
      : sortKey === 'cod' ? !p.cod
      : DEAL_STAGES_ORDERED.indexOf(getDealStage(acqData[p.id], fmVersionDates[p.id])) < 0
    const val = (p) => sortKey === 'mwp' ? projectMwp(p)
      : sortKey === 'cod' ? p.cod
      : DEAL_STAGES_ORDERED.indexOf(getDealStage(acqData[p.id], fmVersionDates[p.id]))
    return [...projs].sort((a, b) => {
      const am = missing(a), bm = missing(b)
      if (am && bm) return 0
      if (am) return 1
      if (bm) return -1
      const av = val(a), bv = val(b)
      let cmp = typeof av === 'string' ? av.localeCompare(bv) : (av - bv)
      // Same stage → break the tie by acquisition progress (ACQ%).
      if (sortKey === 'stage' && cmp === 0) {
        const ap = getAcqProgress(acqData[a.id], fmVersionDates[a.id]) ?? -1
        const bp = getAcqProgress(acqData[b.id], fmVersionDates[b.id]) ?? -1
        cmp = ap - bp
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }
  const SORTABLE = { Stage: 'stage', MWp: 'mwp', COD: 'cod' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: '#2C3B4D', overflow: 'hidden' }}>

      {/* Top bar — view toggle + search + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 52, borderBottom: `1px solid ${theme.cardBorder}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary }}>Acquisitions</div>
          <div style={{ width: 1, height: 16, background: theme.cardBorder }} />
          {/* View toggle */}
          <div style={{ display: 'flex', background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
            {[['projects', 'Projects'], ['leads', 'Leads']].map(([mode, label]) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                fontSize: 11, fontWeight: viewMode === mode ? 700 : 500,
                color: viewMode === mode ? theme.pillActiveText : theme.pillInactiveText,
                background: viewMode === mode ? theme.pillActiveBg : 'transparent',
                border: viewMode === mode ? `1px solid ${theme.pillBorder}` : '1px solid transparent',
                borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                boxShadow: viewMode === mode ? theme.shadowSm : 'none',
                transition: 'all 0.1s',
              }}>{label}</button>
            ))}
          </div>
        </div>
        {/* Right-side controls — only relevant for the Projects view */}
        {viewMode !== 'leads' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Technology + geography multi-select filters (KPIs update to match) */}
            <MultiFilter allLabel="All tech" options={TECHNOLOGIES} selected={filterTech} onToggle={toggleIn(setFilterTech)} onClear={() => setFilterTech([])} theme={theme} />
            <MultiFilter allLabel="All regions" options={GEOGRAPHIES} selected={filterGeo} onToggle={toggleIn(setFilterGeo)} onClear={() => setFilterGeo([])} theme={theme} />
            {/* Search */}
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted, fontSize: 13, pointerEvents: 'none' }}>⌕</div>
              <input
                type="text"
                placeholder="Search projects..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, color: theme.textPrimary, padding: '6px 12px 6px 28px', fontSize: 12, outline: 'none', width: 200, fontFamily: "'Inter', sans-serif" }}
                onFocus={e => e.target.style.borderColor = theme.accent}
                onBlur={e => e.target.style.borderColor = theme.pillBorder}
              />
              {search && (
                <div onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: theme.textTertiary, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</div>
              )}
            </div>
            {/* Show cancelled toggle */}
            {cancelledProjects.length > 0 && (
              <button
                onClick={() => setShowCancelled(v => !v)}
                title={showCancelled ? 'Hide cancelled projects' : 'Show cancelled projects'}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                  color: showCancelled ? theme.accent : theme.textSecondary,
                  background: showCancelled ? theme.accent + '18' : theme.pillBg,
                  border: `1px solid ${showCancelled ? theme.accent + '55' : theme.pillBorder}`,
                  whiteSpace: 'nowrap',
                }}
              >{showCancelled ? 'Hide' : 'Show'} cancelled ({cancelledProjects.length})</button>
            )}
            {/* Curves status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: assumptionsError ? '#ef4444' : assumptionsLoading ? theme.warning : theme.success }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: assumptionsError ? '#ef4444' : assumptionsLoading ? theme.warning : theme.success }} />
              {assumptionsLoading ? 'Loading curves...' : assumptionsError ? 'Using defaults' : 'Curves live'}
            </div>
            <button onClick={onNewProject} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: theme.accent, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>+ New Project</button>
          </div>
        )}
      </div>

      {/* Leads view — embed the (stripped-down) AcquisitionTracker full-bleed */}
      {viewMode === 'leads' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <AcquisitionTracker session={session} />
        </div>
      )}

      {viewMode !== 'leads' && (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} onClick={() => setMenuOpen(null)}>

          {viewMode === 'news' && <NewsDashboard />}
          {viewMode === 'comps' && <CompsDashboard session={session} />}

          {/* Projects view summary bar */}
          {viewMode === 'projects' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
              <StatCard label="Portfolio" value={`${filtered.length} projects`} sub={`${projects.length} total in pipeline`} />
              <StatCard label="Total Capacity" value={`${fmt(totalMW, 1)} MWp`} sub="Filtered projects" color="#4A8C5C" />
              <StatCard label="Blended IRR" value={blendedIRR ? `${fmt(blendedIRR)}%` : '—'} sub="Project unlevered" color={blendedIRR ? '#4A8C5C' : '#C9C1B1'}  />
              <StatCard label="Total CapEx / Equity" value={fmtM(totalCapex)} value2={totalEquity > 0 ? fmtM(totalEquity) : null} value2Label="equity" value2Color="#8A9AAA" sub="Across filtered projects" />
              <StatCard label="Portfolio NPV" value={totalNPV ? fmtM(totalNPV) : '—'} sub="Project unlevered · 7.5% discount" color={totalNPV > 0 ? '#4A8C5C' : totalNPV < 0 ? '#ef4444' : '#C9C1B1'} />
            </div>
          )}

          {/* Projects table */}
          {loading ? (
            <div style={{ marginTop: 40 }}><EnergyLoader /></div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 60 }}>
              <div style={{ fontSize: 14, color: theme.textMuted, marginBottom: 12 }}>No projects yet</div>
              <button onClick={onNewProject} style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: theme.accent, border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' }}>+ Create your first project</button>
            </div>
          ) : (
            groups.map(group => (
              <div key={group.status} style={{ marginBottom: 28 }}>
                {/* Group header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: group.color }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{group.status}</div>
                  <div style={{ fontSize: 10, color: theme.textMuted }}>{group.projects.length} project{group.projects.length !== 1 ? 's' : ''}</div>
                  <div style={{ fontSize: 10, color: theme.textTertiary, marginLeft: 8 }}>
                    {fmt(group.projects.reduce((s, p) => s + (projectMwp(p) || 0), 0), 1)} MWp total
                  </div>
                </div>

                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 2fr 1fr 1fr 1fr 1fr 1fr 1fr 0.6fr 0.5fr', gap: 6, padding: '5px 16px', marginBottom: 4 }}>
                  {['Project', 'Tech', 'Stage', 'Acq %', 'Geography', 'MWp', 'Proj. IRR', 'CapEx', 'Grid £/MWe', 'COD', '', ''].map((h, i) => {
                    const sk = SORTABLE[h]
                    const active = sk && sortKey === sk
                    return (
                      <div key={i} onClick={sk ? () => toggleSort(sk) : undefined}
                        style={{ fontSize: 9, color: active ? theme.textSecondary : theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, cursor: sk ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 3, userSelect: 'none' }}>
                        {h}{sk && <span style={{ fontSize: 8, opacity: active ? 1 : 0.35 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>}
                      </div>
                    )
                  })}
                </div>

                {/* Project rows */}
                {sortProjects(group.projects).map(p => {
                  const run = getLatestRun(p)
                  const irrVal = run?.project_irr
                  const irrColor = !irrVal ? theme.textMuted : irrVal < 0 ? '#ef4444' : irrVal < 7.5 ? theme.warning : theme.success
                  const isMenuOpen = menuOpen === p.id
                  const dealStage = getDealStage(acqData[p.id], fmVersionDates[p.id])
                  const acqPct = getAcqProgress(acqData[p.id], fmVersionDates[p.id])
                  const inputs = inputData[p.id] || {}
                  const gridCostMWe = gridPerMW(p)
                  const stageColor = DEAL_STAGE_COLORS[dealStage] || theme.textMuted
                  const techColor = TECH_COLORS[p.technology] || theme.textMuted
                  return (
                    <div key={p.id}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.background = theme.cardBg; }}
                      style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 2fr 1fr 1fr 1fr 1fr 1fr 1fr 0.6fr 0.5fr', gap: 6, padding: '14px 16px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, marginBottom: 6, alignItems: 'center', transition: 'border-color 0.15s, background 0.15s', position: 'relative', cursor: 'pointer' }}
                    >
                      {/* Name + COD */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: theme.textPrimary, marginBottom: 2 }}>{p.name}</div>
                        <span style={{ fontSize: 10, color: theme.textTertiary }}>{p.team_name || '—'}</span>
                      </div>
                      {/* Tech */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: techColor, background: `${techColor}18`, border: `1px solid ${techColor}33`, borderRadius: 4, padding: '2px 6px' }}>{p.technology}</span>
                      </div>
                      {/* Deal Stage */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer' }}>
                        {dealStage ? (
                          <span style={{ fontSize: 9, fontWeight: 700, color: stageColor, background: `${stageColor}18`, border: `1px solid ${stageColor}33`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>{dealStage}</span>
                        ) : <span style={{ fontSize: 11, color: theme.textMuted }}>—</span>}
                      </div>
                      {/* Acquisition Progress % */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {acqPct != null ? (
                          <>
                            <div style={{ flex: 1, height: 5, background: theme.pillBg, borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${acqPct}%`, height: '100%', background: acqPct >= 80 ? theme.success : acqPct >= 40 ? theme.warning : theme.textMuted, borderRadius: 3, transition: 'width 0.3s' }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: theme.textSecondary, fontFamily: 'monospace', minWidth: 28 }}>{acqPct}%</span>
                          </>
                        ) : <span style={{ fontSize: 11, color: theme.textMuted }}>—</span>}
                      </div>
                      {/* Geography */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 12, color: '#8A9AAA' }}>{p.geography}</div>
                      {/* MWp */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 13, color: theme.textPrimary, fontFamily: 'monospace' }}>{projectMwp(p) != null ? fmt(projectMwp(p), 1) : '—'}</div>
                      {/* Project IRR */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700, color: irrColor, fontFamily: 'monospace' }}>
                        {irrVal != null ? `${fmt(irrVal)}%` : '—'}
                      </div>
                      {/* CapEx */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 13, color: theme.textPrimary, fontFamily: 'monospace' }}>
                        {run?.total_capex ? fmtM(run.total_capex) : '—'}
                      </div>
                      {/* Grid Cost £/MWe */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 13, color: theme.textPrimary, fontFamily: 'monospace' }}>
                        {gridCostMWe ? fmtK(gridCostMWe) : '—'}
                      </div>
                      {/* COD */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 13, color: theme.textPrimary, fontFamily: 'monospace' }}>
                        {p.cod ? new Date(p.cod).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}
                      </div>
                      {/* Open link */}
                      <div onClick={() => onOpenProject(p)} style={{ cursor: 'pointer', fontSize: 11, color: theme.accent, textAlign: 'center' }}>Open →</div>
                      {/* Three-dot menu */}
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setMenuOpen(isMenuOpen ? null : p.id) }}
                          style={{ width: 28, height: 28, borderRadius: 6, background: isMenuOpen ? theme.border : 'transparent', border: '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textTertiary, fontSize: 16, lineHeight: 1 }}
                          onMouseEnter={e => e.currentTarget.style.background = theme.border}
                          onMouseLeave={e => { if (!isMenuOpen) e.currentTarget.style.background = 'transparent' }}
                        >⋯</button>
                        {isMenuOpen && (
                          <div
                            style={{ position: 'absolute', right: 0, top: 32, width: 160, background: theme.pillBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }}
                            onClick={e => e.stopPropagation()}
                          >
                            <div
                              onClick={() => { onOpenProject(p); setMenuOpen(null) }}
                              style={{ padding: '10px 14px', fontSize: 12, color: theme.textSecondary, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` }}
                              onMouseEnter={e => e.currentTarget.style.background = theme.border}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >Open model</div>
                            {p.cancelled ? (
                              <div
                                onClick={() => handleRestore(p.id)}
                                style={{ padding: '10px 14px', fontSize: 12, color: theme.accent, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` }}
                                onMouseEnter={e => e.currentTarget.style.background = theme.border}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >Restore project</div>
                            ) : (
                              <div
                                onClick={() => { setCancelTarget(p); setCancelReason(''); setCancelNotes(''); setMenuOpen(null) }}
                                style={{ padding: '10px 14px', fontSize: 12, color: '#d97706', cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` }}
                                onMouseEnter={e => e.currentTarget.style.background = theme.border}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >Cancel acquisition</div>
                            )}
                            <div
                              onClick={() => handleDelete(p.id)}
                              style={{ padding: '10px 14px', fontSize: 12, color: '#ef4444', cursor: 'pointer' }}
                              onMouseEnter={e => e.currentTarget.style.background = theme.border}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >Delete project</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* Cancel acquisition modal */}
      {cancelTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setCancelTarget(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 400, background: theme.elevatedBg || theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, padding: 24, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>Cancel acquisition</div>
            <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 16 }}>
              <span style={{ fontWeight: 600 }}>{cancelTarget.name}</span> will be archived and removed from the active pipeline. Its model data is kept and it can be restored later.
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>Reason</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CANCEL_REASONS.map(r => (
                  <div key={r} onClick={() => setCancelReason(r)}
                    style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: cancelReason === r ? '#d9770622' : theme.pillBg,
                      color: cancelReason === r ? '#d97706' : theme.textTertiary,
                      border: `1px solid ${cancelReason === r ? '#d97706' : theme.cardBorder}` }}>{r}</div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 6 }}>Notes (optional)</div>
              <textarea value={cancelNotes} onChange={e => setCancelNotes(e.target.value)} placeholder="Any context for the team..."
                style={{ width: '100%', minHeight: 56, background: theme.surfaceBg || theme.pillBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 6, color: theme.textPrimary, padding: '7px 10px', fontSize: 12, outline: 'none', fontFamily: "'Inter', system-ui, sans-serif", resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCancel} disabled={!cancelReason}
                style={{ flex: 1, padding: '10px 16px', background: cancelReason ? '#d97706' : theme.textMuted, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: cancelReason ? 'pointer' : 'default', opacity: cancelReason ? 1 : 0.5 }}>
                Cancel acquisition
              </button>
              <button onClick={() => setCancelTarget(null)}
                style={{ padding: '10px 16px', background: 'transparent', color: theme.textSecondary, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
