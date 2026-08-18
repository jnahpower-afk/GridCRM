import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'
import { useTheme } from './ThemeContext.jsx'
import EnergyLoader from './EnergyLoader.jsx'

// ── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Development', 'Acquisitions', 'Policy', 'Grid & Infrastructure', 'Finance & Markets']
const TECHNOLOGIES = ['All', 'Solar', 'Wind', 'BESS', 'Gas Peaker', 'Hydrogen', 'Nuclear', 'Hydro', 'Other Renewables']

const CATEGORY_COLORS = {
  'Development':           '#4A8C5C',
  'Acquisitions':          '#5E6AD2',
  'Policy':                '#E5A100',
  'Grid & Infrastructure': '#FC6A0A',
  'Finance & Markets':     '#2563EB',
}

const TECH_COLORS = {
  'Solar':             '#FFB162',
  'Wind':              '#FC6A0A',
  'BESS':              '#4A8C5C',
  'Gas Peaker':        '#f97316',
  'Hydrogen':          '#60A5FA',
  'Nuclear':           '#A78BFA',
  'Hydro':             '#34d399',
  'Other Renewables':  '#F472B6',
}

const SOURCE_LABELS = {
  'newprojectmedia': 'New Project Media',
  'bloomberg':       'Bloomberg',
  'bbc':             'BBC News',
  'ft':              'Financial Times',
}

const SOURCE_COLORS = {
  'newprojectmedia': '#2563EB',
  'bloomberg':       '#FF6600',
  'bbc':             '#BB1919',
  'ft':              '#FCD0A1',
}

function timeAgo(dateStr) {
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now - d
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function getDateKey(dateStr) {
  return new Date(dateStr).toISOString().split('T')[0]
}

// ── Relevance Badge ─────────────────────────────────────────────────────────
function RelevanceBadge({ score, theme }) {
  if (score == null) return null
  const color = score >= 8 ? '#4A8C5C' : score >= 5 ? '#E5A100' : theme.textMuted
  const label = score >= 8 ? 'High' : score >= 5 ? 'Medium' : 'Low'
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color, letterSpacing: '0.04em',
      background: `${color}18`, border: `1px solid ${color}33`,
      borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase',
    }}>
      {label} relevance
    </span>
  )
}

// ── Article Card ────────────────────────────────────────────────────────────
function ArticleCard({ article, theme }) {
  const catColor = CATEGORY_COLORS[article.category] || theme.textMuted
  const techColor = TECH_COLORS[article.technology] || theme.textMuted
  const srcColor = SOURCE_COLORS[article.source] || theme.textMuted

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div
        onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.background = theme.cardBg }}
        style={{
          background: theme.cardBg,
          border: `1px solid ${theme.cardBorder}`,
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 6,
          transition: 'border-color 0.15s, background 0.15s',
          cursor: 'pointer',
          borderLeft: `3px solid ${catColor}`,
        }}
      >
        {/* Top row: source + time + relevance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: srcColor, letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            {SOURCE_LABELS[article.source] || article.source}
          </span>
          <span style={{ fontSize: 10, color: theme.textMuted }}>·</span>
          <span style={{ fontSize: 10, color: theme.textTertiary }}>{timeAgo(article.published_at)}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <RelevanceBadge score={article.relevance_score} theme={theme} />
          </div>
        </div>

        {/* Title */}
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 6, lineHeight: 1.4 }}>
          {article.title}
        </div>

        {/* Summary */}
        {article.summary && (
          <div style={{ fontSize: 11, color: theme.textSecondary, lineHeight: 1.5, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {article.summary}
          </div>
        )}

        {/* Tags row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: catColor,
            background: `${catColor}18`, border: `1px solid ${catColor}33`,
            borderRadius: 4, padding: '2px 6px',
          }}>
            {article.category}
          </span>
          {article.technology && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: techColor,
              background: `${techColor}18`, border: `1px solid ${techColor}33`,
              borderRadius: 4, padding: '2px 6px',
            }}>
              {article.technology}
            </span>
          )}
          {article.region && (
            <span style={{
              fontSize: 9, fontWeight: 600, color: theme.textTertiary,
              background: theme.pillBg, border: `1px solid ${theme.pillBorder}`,
              borderRadius: 4, padding: '2px 6px',
            }}>
              {article.region}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}

// ── Stats Bar ───────────────────────────────────────────────────────────────
function NewsStats({ articles, theme }) {
  const today = getDateKey(new Date().toISOString())
  const todayCount = articles.filter(a => getDateKey(a.published_at) === today).length
  const sources = [...new Set(articles.map(a => a.source))]
  const highRelevance = articles.filter(a => a.relevance_score >= 8).length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
      {[
        { label: 'Today', value: `${todayCount} articles`, sub: 'Published today' },
        { label: 'Sources', value: `${sources.length} active`, sub: sources.map(s => SOURCE_LABELS[s] || s).join(', ') },
        { label: 'High Relevance', value: `${highRelevance}`, sub: 'Scored 8+ for Grid CRM', color: '#4A8C5C' },
        { label: 'Total Articles', value: `${articles.length}`, sub: 'In current view' },
      ].map(stat => (
        <div key={stat.label} style={{
          background: theme.cardBg, border: `1px solid ${theme.cardBorder}`,
          borderRadius: 10, padding: '12px 14px',
        }}>
          <div style={{ fontSize: 9, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4 }}>
            {stat.label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: stat.color || theme.textPrimary, fontFamily: 'monospace' }}>
            {stat.value}
          </div>
          <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stat.sub}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Category Summary Bar ────────────────────────────────────────────────────
function CategoryBar({ articles, theme }) {
  const cats = CATEGORIES.filter(c => c !== 'All')
  const counts = cats.map(c => ({ cat: c, count: articles.filter(a => a.category === c).length, color: CATEGORY_COLORS[c] }))
  const total = articles.length || 1

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 6, background: theme.progressTrack }}>
        {counts.filter(c => c.count > 0).map(c => (
          <div key={c.cat} style={{ width: `${(c.count / total) * 100}%`, background: c.color, transition: 'width 0.3s' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        {counts.filter(c => c.count > 0).map(c => (
          <div key={c.cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 2, background: c.color }} />
            <span style={{ fontSize: 9, color: theme.textTertiary }}>{c.cat} ({c.count})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── View Mode Toggle (Category / Technology / Timeline) ─────────────────────
function ViewToggle({ groupBy, setGroupBy, theme }) {
  const modes = [['category', 'By Category'], ['technology', 'By Technology'], ['timeline', 'Timeline']]
  return (
    <div style={{ display: 'flex', background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
      {modes.map(([mode, label]) => (
        <button key={mode} onClick={() => setGroupBy(mode)} style={{
          fontSize: 10, fontWeight: groupBy === mode ? 700 : 500,
          color: groupBy === mode ? theme.pillActiveText : theme.pillInactiveText,
          background: groupBy === mode ? theme.pillActiveBg : 'transparent',
          border: groupBy === mode ? `1px solid ${theme.pillBorder}` : '1px solid transparent',
          borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
          boxShadow: groupBy === mode ? theme.shadowSm : 'none',
          transition: 'all 0.1s',
        }}>{label}</button>
      ))}
    </div>
  )
}

// ── Filter Pill ─────────────────────────────────────────────────────────────
function FilterPill({ label, options, value, onChange, theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, color: theme.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          fontSize: 11, color: theme.textPrimary, background: theme.pillBg,
          border: `1px solid ${theme.pillBorder}`, borderRadius: 6, padding: '3px 8px',
          cursor: 'pointer', outline: 'none', fontFamily: "'Inter', sans-serif",
        }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// ── Main News Dashboard ─────────────────────────────────────────────────────
export default function NewsDashboard() {
  const { theme } = useTheme()
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterTech, setFilterTech] = useState('All')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('category') // 'category' | 'technology' | 'timeline'
  const [daysBack, setDaysBack] = useState(7)

  // Fetch articles
  useEffect(() => {
    fetchArticles()
  }, [daysBack])

  const fetchArticles = async () => {
    setLoading(true)
    setError(null)
    try {
      const since = new Date()
      since.setDate(since.getDate() - daysBack)

      const { data, error: fetchError } = await supabase
        .from('news_articles')
        .select('*')
        .gte('published_at', since.toISOString())
        .order('relevance_score', { ascending: false })
        .order('published_at', { ascending: false })

      if (fetchError) throw fetchError
      setArticles(data || [])
    } catch (err) {
      console.error('Error fetching news:', err)
      setError(err.message)
    }
    setLoading(false)
  }

  // Filter
  const filtered = useMemo(() => {
    return articles.filter(a => {
      if (filterCategory !== 'All' && a.category !== filterCategory) return false
      if (filterTech !== 'All' && a.technology !== filterTech) return false
      if (search.trim() && !a.title.toLowerCase().includes(search.trim().toLowerCase()) &&
          !(a.summary || '').toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })
  }, [articles, filterCategory, filterTech, search])

  // Group
  const grouped = useMemo(() => {
    if (groupBy === 'category') {
      const cats = CATEGORIES.filter(c => c !== 'All')
      return cats
        .map(cat => ({
          key: cat,
          label: cat,
          color: CATEGORY_COLORS[cat],
          articles: filtered.filter(a => a.category === cat),
        }))
        .filter(g => g.articles.length > 0)
    }
    if (groupBy === 'technology') {
      const techs = TECHNOLOGIES.filter(t => t !== 'All')
      const groups = techs
        .map(tech => ({
          key: tech,
          label: tech,
          color: TECH_COLORS[tech],
          articles: filtered.filter(a => a.technology === tech),
        }))
        .filter(g => g.articles.length > 0)
      // Add "General" group for articles without a technology
      const general = filtered.filter(a => !a.technology)
      if (general.length > 0) {
        groups.push({ key: 'general', label: 'General / Cross-sector', color: theme.textMuted, articles: general })
      }
      return groups
    }
    // Timeline: group by date
    const dateMap = {}
    filtered.forEach(a => {
      const key = getDateKey(a.published_at)
      if (!dateMap[key]) dateMap[key] = []
      dateMap[key].push(a)
    })
    return Object.entries(dateMap)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, arts]) => ({
        key: date,
        label: formatDate(date + 'T00:00:00Z'),
        color: theme.accent,
        articles: arts,
      }))
  }, [filtered, groupBy, theme])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      {/* Stats bar */}
      <NewsStats articles={filtered} theme={theme} />

      {/* Category distribution bar */}
      <CategoryBar articles={filtered} theme={theme} />

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <ViewToggle groupBy={groupBy} setGroupBy={setGroupBy} theme={theme} />

        <FilterPill label="Category" options={CATEGORIES} value={filterCategory} onChange={setFilterCategory} theme={theme} />
        <FilterPill label="Technology" options={TECHNOLOGIES} value={filterTech} onChange={setFilterTech} theme={theme} />
        <FilterPill label="Period" options={['1', '3', '7', '14', '30']} value={String(daysBack)}
          onChange={v => setDaysBack(Number(v))} theme={theme} />

        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textMuted, fontSize: 13, pointerEvents: 'none' }}>⌕</div>
          <input
            type="text"
            placeholder="Search news..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8,
              color: theme.textPrimary, padding: '6px 12px 6px 28px', fontSize: 12, outline: 'none',
              width: 200, fontFamily: "'Inter', sans-serif",
            }}
            onFocus={e => e.target.style.borderColor = theme.accent}
            onBlur={e => e.target.style.borderColor = theme.pillBorder}
          />
          {search && (
            <div onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: theme.textTertiary, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</div>
          )}
        </div>
      </div>

      {/* Loading / Error / Empty states */}
      {loading && (
        <div style={{ marginTop: 40 }}><EnergyLoader /></div>
      )}

      {error && (
        <div style={{
          background: theme.errorBg, border: `1px solid ${theme.error}33`, borderRadius: 10,
          padding: '16px 20px', marginBottom: 16, color: theme.error, fontSize: 12,
        }}>
          Failed to load news: {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📰</div>
          <div style={{ fontSize: 14, color: theme.textMuted, marginBottom: 6 }}>No news articles yet</div>
          <div style={{ fontSize: 11, color: theme.textTertiary }}>
            Articles will appear here once the daily scrape runs at 8:00 AM.
            <br />Sources: New Project Media, Bloomberg, BBC, Financial Times
          </div>
        </div>
      )}

      {/* Grouped articles */}
      {!loading && grouped.map(group => (
        <div key={group.key} style={{ marginBottom: 24 }}>
          {/* Group header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: group.color }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {group.label}
            </div>
            <div style={{ fontSize: 10, color: theme.textMuted }}>
              {group.articles.length} article{group.articles.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Article cards */}
          {group.articles.map(article => (
            <ArticleCard key={article.id} article={article} theme={theme} />
          ))}
        </div>
      ))}
    </div>
  )
}
