import { useState } from 'react'
import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { useTheme } from './ThemeContext.jsx'

// ── IC Memo PDF Generator ───────────────────────────────────────────────────
// Generates a formatted Investment Committee memo as a downloadable PDF,
// pulling data from project overview, financial model, and acquisition process.

const fmt = (n, d = 1) => n == null ? '—' : Number(n).toFixed(d)
const fmtM = (n) => {
  if (!n) return '—'
  const abs = Math.abs(n)
  if (abs >= 1000000) return `£${(n / 1000000).toFixed(1)}m`
  if (abs >= 1000) return `£${(n / 1000).toFixed(1)}k`
  return `£${n.toFixed(0)}`
}

// ── Fetch all project data ──────────────────────────────────────────────────
async function fetchProjectData(project) {
  const projectId = project.id

  // Fetch latest model run (best FM version: FID > FABO > NBO)
  const { data: runs } = await supabase
    .from('model_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('fm_version', { ascending: false })
    .limit(1)
  const latestRun = runs?.[0] || null

  // Fetch project inputs
  const { data: inputs } = await supabase
    .from('project_inputs')
    .select('*')
    .eq('project_id', projectId)
  const inputMap = {}
  inputs?.forEach(i => { inputMap[i.field_name] = i.field_value })

  // Fetch project overview data
  const { data: overview } = await supabase
    .from('project_overview')
    .select('*')
    .eq('project_id', projectId)
    .limit(1)
  const overviewData = overview?.[0]?.data || {}

  // Fetch acquisition process data
  const { data: acquisition } = await supabase
    .from('project_acquisition')
    .select('*')
    .eq('project_id', projectId)
    .limit(1)
  const acquisitionData = acquisition?.[0]?.data || {}

  // Fetch comparable transactions for this technology
  const { data: comps } = await supabase
    .from('comparable_transactions')
    .select('*')
    .eq('technology', project.technology)
    .eq('status', 'confirmed')
    .order('transaction_date', { ascending: false })
    .limit(5)

  return { latestRun, inputMap, overviewData, acquisitionData, comps: comps || [] }
}

// ── Generate PDF ────────────────────────────────────────────────────────────
async function generateMemo(project, data) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const { latestRun, inputMap, overviewData, comps } = data

  const W = 210
  const margin = 20
  const contentW = W - margin * 2
  let y = margin

  // Colours
  const fuseOrange = '#FC6A0A'
  const darkText = '#1B2632'
  const mutedText = '#5A6E82'
  const lightGrey = '#EEE9DF'

  // ── Helper functions ────────────────────────────────────────────────────
  const addPage = () => { doc.addPage(); y = margin }
  const checkPage = (needed = 30) => { if (y + needed > 277) addPage() }

  const heading = (text, size = 14) => {
    checkPage(20)
    doc.setFontSize(size)
    doc.setTextColor(fuseOrange)
    doc.setFont('helvetica', 'bold')
    doc.text(text, margin, y)
    y += size * 0.5
    doc.setDrawColor(fuseOrange)
    doc.setLineWidth(0.5)
    doc.line(margin, y, margin + contentW, y)
    y += 6
  }

  const subheading = (text) => {
    checkPage(12)
    doc.setFontSize(10)
    doc.setTextColor(darkText)
    doc.setFont('helvetica', 'bold')
    doc.text(text, margin, y)
    y += 5
  }

  const body = (text, indent = 0) => {
    checkPage(10)
    doc.setFontSize(9)
    doc.setTextColor(mutedText)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(text, contentW - indent)
    doc.text(lines, margin + indent, y)
    y += lines.length * 4.2
  }

  const row = (label, value, bold = false) => {
    checkPage(7)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(mutedText)
    doc.text(label, margin + 2, y)
    doc.setTextColor(darkText)
    if (bold) doc.setFont('helvetica', 'bold')
    doc.text(String(value || '—'), margin + 60, y)
    y += 5
  }

  const tableRow = (cols, widths, isHeader = false) => {
    checkPage(7)
    doc.setFontSize(isHeader ? 7 : 8)
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal')
    doc.setTextColor(isHeader ? mutedText : darkText)
    let x = margin
    cols.forEach((col, i) => {
      doc.text(String(col || '—'), x + 1, y)
      x += widths[i]
    })
    y += isHeader ? 4 : 4.5
    if (isHeader) {
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.2)
      doc.line(margin, y - 1, margin + contentW, y - 1)
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COVER / HEADER
  // ════════════════════════════════════════════════════════════════════════

  // Orange header bar
  doc.setFillColor(252, 106, 10)
  doc.rect(0, 0, W, 45, 'F')

  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.text('FUSE ENERGY', margin, 15)

  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('Investment Committee Memo', margin, 28)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(project.name, margin, 38)

  // Date & classification
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(`Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, W - margin - 50, 15)
  doc.text('CONFIDENTIAL', W - margin - 50, 22)
  doc.text(`${project.technology} | ${project.geography}`, W - margin - 50, 29)

  y = 55

  // ════════════════════════════════════════════════════════════════════════
  // 1. EXECUTIVE SUMMARY
  // ════════════════════════════════════════════════════════════════════════

  heading('1. Executive Summary')

  body(`This memo presents the investment case for ${project.name}, a ${project.capacity_mwp ? project.capacity_mwp + ' MWp' : ''} ${project.technology} project located in ${project.geography}. The project is currently at ${project.status || 'development'} stage.`)
  y += 2

  // Key metrics box
  doc.setFillColor(250, 247, 242)
  doc.setDrawColor(201, 193, 177)
  doc.roundedRect(margin, y, contentW, 28, 3, 3, 'FD')
  y += 6

  const metrics = [
    ['Capacity', project.capacity_mwp ? `${project.capacity_mwp} MWp` : '—'],
    ['Project IRR', latestRun?.project_irr ? `${fmt(latestRun.project_irr)}%` : '—'],
    ['Equity IRR', latestRun?.equity_irr ? `${fmt(latestRun.equity_irr)}%` : '—'],
    ['Total CapEx', latestRun?.total_capex ? fmtM(latestRun.total_capex) : '—'],
    ['NPV', latestRun?.project_npv ? fmtM(latestRun.project_npv) : '—'],
    ['Min DSCR', latestRun?.min_dscr ? `${fmt(latestRun.min_dscr)}x` : '—'],
  ]

  const metricW = contentW / metrics.length
  metrics.forEach(([label, value], i) => {
    const x = margin + i * metricW + metricW / 2
    doc.setFontSize(7)
    doc.setTextColor(mutedText)
    doc.setFont('helvetica', 'normal')
    doc.text(label.toUpperCase(), x, y, { align: 'center' })
    doc.setFontSize(12)
    doc.setTextColor(darkText)
    doc.setFont('helvetica', 'bold')
    doc.text(value, x, y + 8, { align: 'center' })
  })

  y += 26

  // ════════════════════════════════════════════════════════════════════════
  // 2. PROJECT OVERVIEW
  // ════════════════════════════════════════════════════════════════════════

  heading('2. Project Overview')

  row('Project Name', project.name)
  row('Technology', project.technology)
  row('Geography', project.geography)
  row('Capacity', project.capacity_mwp ? `${project.capacity_mwp} MWp` : '—')
  row('COD', project.cod || inputMap?.cod || '—')
  row('Status', project.status)
  row('Team', project.team_name || '—')
  row('Gearing', project.gearing ? `${project.gearing}%` : '—')
  y += 4

  if (inputMap) {
    subheading('Key Assumptions')
    row('P50 Yield', inputMap.yield_kwh ? `${inputMap.yield_kwh} kWh/kWp` : '—')
    row('Degradation', inputMap.degradation ? `${inputMap.degradation}% p.a.` : '—')
    row('Export Capacity', inputMap.export_mw ? `${inputMap.export_mw} MW` : '—')
    row('Grid Costs', inputMap.grid_costs ? fmtM(Number(inputMap.grid_costs)) : '—')
    row('Opex', inputMap.opex_per_mw ? `£${Number(inputMap.opex_per_mw).toFixed(0)}/MW` : '—')
    y += 4
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. FINANCIAL SUMMARY
  // ════════════════════════════════════════════════════════════════════════

  heading('3. Financial Summary')

  if (latestRun) {
    subheading('Returns')
    row('Project IRR (unlevered)', latestRun.project_irr ? `${fmt(latestRun.project_irr)}%` : '—', true)
    row('Equity IRR (levered)', latestRun.equity_irr ? `${fmt(latestRun.equity_irr)}%` : '—', true)
    row('Project NPV', latestRun.project_npv ? fmtM(latestRun.project_npv) : '—', true)
    row('Minimum DSCR', latestRun.min_dscr ? `${fmt(latestRun.min_dscr)}x` : '—')
    y += 3

    subheading('Capital Structure')
    row('Total CapEx', fmtM(latestRun.total_capex))
    const equity = latestRun.total_capex ? latestRun.total_capex * (1 - (project.gearing || 70) / 100) : null
    row('Equity Required', equity ? fmtM(equity) : '—')
    row('Gearing', project.gearing ? `${project.gearing}%` : '70%')
    row('Total Distributions', latestRun.total_distributions ? fmtM(latestRun.total_distributions * 1000) : '—')
    y += 3

    subheading('Revenue Breakdown')
    row('CfD Revenue', latestRun.cfd_rev ? fmtM(latestRun.cfd_rev * 1000) : '—')
    row('PPA Revenue', latestRun.ppa_rev ? fmtM(latestRun.ppa_rev * 1000) : '—')
    row('Merchant Revenue', latestRun.merchant_rev ? fmtM(latestRun.merchant_rev * 1000) : '—')
    row('REGO Revenue', latestRun.rego_rev ? fmtM(latestRun.rego_rev * 1000) : '—')
  } else {
    body('No financial model run available for this project.')
  }

  y += 4

  // ════════════════════════════════════════════════════════════════════════
  // 4. COMPARABLE TRANSACTIONS
  // ════════════════════════════════════════════════════════════════════════

  if (comps.length > 0) {
    heading('4. Comparable Transactions')

    body(`The following recent ${project.technology} transactions provide market context for this investment:`)
    y += 3

    const colWidths = [50, 25, 20, 25, 25, 25]
    tableRow(['TRANSACTION', 'GEO', 'MW', 'STAGE', '£/MW', 'IRR'], colWidths, true)

    comps.forEach(c => {
      const ccy = c.currency === 'EUR' ? '€' : c.currency === 'USD' ? '$' : '£'
      tableRow([
        (c.project_name || '').substring(0, 28),
        c.geography || '—',
        c.capacity_mw ? fmt(c.capacity_mw, 0) : '—',
        c.stage || '—',
        c.price_per_mw ? `${ccy}${Math.round(c.price_per_mw / 1000)}k` : '—',
        c.implied_irr ? `${fmt(c.implied_irr)}%` : '—',
      ], colWidths)
    })

    y += 6
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. KEY RISKS
  // ════════════════════════════════════════════════════════════════════════

  const riskSection = comps.length > 0 ? '5' : '4'
  heading(`${riskSection}. Key Risks`)

  const risks = []

  // Auto-generate risks based on project data
  if (latestRun?.project_irr && latestRun.project_irr < 7.5) {
    risks.push(['Below-hurdle Returns', `Project IRR of ${fmt(latestRun.project_irr)}% is below the 7.5% target hurdle rate. Requires either value engineering on CapEx or improved revenue assumptions to meet investment criteria.`])
  }
  if (latestRun?.min_dscr && latestRun.min_dscr < 1.25) {
    risks.push(['Debt Service Coverage', `Minimum DSCR of ${fmt(latestRun.min_dscr)}x is tight and may not meet lender covenants (typically 1.25x minimum). Consider adjusting gearing or tenor.`])
  }
  if (latestRun?.merchant_rev && latestRun.cfd_rev && latestRun.merchant_rev > latestRun.cfd_rev) {
    risks.push(['Merchant Revenue Exposure', `A significant portion of revenue is uncontracted (merchant). Power price volatility could materially impact returns.`])
  }
  if (project.status === 'RtB') {
    risks.push(['Construction Risk', 'Project is at Ready-to-Build stage. Construction delays, EPC contractor performance, and supply chain disruptions could impact COD timing and returns.'])
  }

  // Default risks
  risks.push(['Planning & Permitting', 'Risk of planning conditions, judicial review, or community opposition that could delay or prevent development.'])
  risks.push(['Grid Connection', 'Dependency on grid connection timeline and costs. Risk of connection delays, curtailment, or constraint charges.'])
  risks.push(['Power Price Risk', 'Long-term power price forecasts are inherently uncertain. Downside scenarios should be stress-tested against base case returns.'])

  risks.forEach(([title, desc]) => {
    subheading(title)
    body(desc, 2)
    y += 2
  })

  // ════════════════════════════════════════════════════════════════════════
  // 6. RECOMMENDATION
  // ════════════════════════════════════════════════════════════════════════

  const recSection = comps.length > 0 ? '6' : '5'
  heading(`${recSection}. Recommendation`)

  const irrOk = latestRun?.project_irr && latestRun.project_irr >= 7.5
  const dscrOk = !latestRun?.min_dscr || latestRun.min_dscr >= 1.25

  if (irrOk && dscrOk) {
    body(`Based on the financial analysis, ${project.name} meets the investment hurdle rate with a Project IRR of ${fmt(latestRun.project_irr)}% and adequate debt service coverage. The project is recommended for IC approval to proceed to the next stage of the acquisition process.`)
  } else if (irrOk) {
    body(`${project.name} achieves the target IRR of ${fmt(latestRun?.project_irr)}%, however debt service metrics require further review. Conditional approval is recommended, subject to refinancing analysis.`)
  } else {
    body(`${project.name} currently falls below the target hurdle rate. Further value engineering or improved commercial terms are recommended before seeking IC approval.`)
  }

  y += 6

  // Footer on each page
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(180, 180, 180)
    doc.text(`Fuse Energy | IC Memo | ${project.name} | CONFIDENTIAL`, margin, 290)
    doc.text(`Page ${i} of ${pageCount}`, W - margin - 20, 290)
  }

  return doc
}

// ── IC Memo Button Component ────────────────────────────────────────────────
export default function ICMemoButton({ project, style }) {
  const { theme } = useTheme()
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const data = await fetchProjectData(project)
      const doc = await generateMemo(project, data)
      const filename = `IC_Memo_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(filename)
    } catch (err) {
      console.error('Error generating IC memo:', err)
      const msg = err instanceof Error ? err.message : String(err)
      alert('Failed to generate IC memo: ' + msg)
    }
    setGenerating(false)
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={generating}
      style={{
        fontSize: 11, fontWeight: 700, color: generating ? theme.textMuted : '#fff',
        background: generating ? theme.pillBg : theme.accent,
        border: 'none', borderRadius: 8, padding: '8px 16px', cursor: generating ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
        transition: 'all 0.15s', ...style,
      }}
    >
      {generating ? 'Generating...' : '📄 Generate IC Memo'}
    </button>
  )
}
