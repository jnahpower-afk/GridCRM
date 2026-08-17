// Supabase Edge Function: scrape-news
// Scrapes energy news from multiple sources, classifies, scores, and stores articles.
// Triggered daily at 8:00 AM via cron or manually via HTTP POST.
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Configuration ───────────────────────────────────────────────────────────

const SOURCES = {
  newprojectmedia: {
    label: 'New Project Media',
    rssUrl: 'https://newprojectmedia.com/feed/',
    fallbackUrl: 'https://newprojectmedia.com/',
  },
  bloomberg: {
    label: 'Bloomberg Green',
    rssUrl: 'https://feeds.bloomberg.com/green/news.rss',
    fallbackUrl: 'https://www.bloomberg.com/green',
  },
  bbc: {
    label: 'BBC',
    rssUrl: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    fallbackUrl: 'https://www.bbc.co.uk/news/science_and_environment',
  },
  ft: {
    label: 'Financial Times',
    rssUrl: 'https://www.ft.com/energy?format=rss',
    fallbackUrl: 'https://www.ft.com/energy',
  },
  peakload: {
    label: 'PeakLoad',
    rssUrl: 'https://www.peakload.com/feed/',
    fallbackUrl: 'https://www.peakload.com/home',
  },
  renewablesnow: {
    label: 'Renewables Now',
    rssUrl: 'https://renewablesnow.com/feed/',
    fallbackUrl: 'https://renewablesnow.com/news/',
  },
}

const CATEGORIES = ['Development', 'Acquisitions', 'Policy', 'Grid & Infrastructure', 'Finance & Markets']
const TECHNOLOGIES = ['Solar', 'Wind', 'BESS', 'Gas Peaker', 'Hydrogen', 'Nuclear', 'Hydro', 'Other Renewables']

// Keywords for classification
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Development': ['development', 'planning', 'permission', 'consent', 'construction', 'commissioning', 'operational', 'greenfield', 'brownfield', 'site', 'capacity', 'mw', 'gw', 'project', 'farm', 'park', 'plant', 'build', 'develop', 'phase', 'pipeline', 'cod', 'energisation', 'ready to build', 'rtb', 'shovel-ready'],
  'Acquisitions': ['acquisition', 'acquire', 'merger', 'deal', 'purchase', 'sale', 'divest', 'transaction', 'portfolio', 'buyer', 'seller', 'bid', 'offer', 'stake', 'equity', 'invest', 'fund', 'capital', 'ipo', 'spv', 'joint venture', 'jv', 'partnership'],
  'Policy': ['policy', 'regulation', 'legislation', 'government', 'minister', 'parliament', 'subsidy', 'incentive', 'target', 'net zero', 'climate', 'cop', 'emission', 'carbon', 'cfd', 'contracts for difference', 'auction', 'rego', 'guarantee of origin', 'roc', 'fit', 'feed-in', 'nppf', 'planning reform', 'ofgem', 'desnz', 'beis'],
  'Grid & Infrastructure': ['grid', 'transmission', 'distribution', 'network', 'substation', 'interconnector', 'cable', 'pylon', 'national grid', 'ssen', 'ukpn', 'wpd', 'enwl', 'connection', 'curtailment', 'constraint', 'balancing', 'flexibility', 'storage', 'infrastructure', 'dnv', 'eso', 'ngeso'],
  'Finance & Markets': ['price', 'market', 'trading', 'ppa', 'power purchase', 'merchant', 'wholesale', 'baseload', 'peak', 'revenue', 'yield', 'return', 'irr', 'npv', 'valuation', 'finance', 'debt', 'bond', 'green bond', 'refinanc', 'bank', 'lender', 'credit', 'rating', 'forecast', 'outlook', 'demand', 'supply'],
}

const TECH_KEYWORDS: Record<string, string[]> = {
  'Solar': ['solar', 'photovoltaic', 'pv', 'panel', 'module', 'inverter', 'tracker', 'bifacial', 'rooftop solar', 'ground-mount', 'solar farm', 'agrivoltaic'],
  'Wind': ['wind', 'turbine', 'offshore wind', 'onshore wind', 'wind farm', 'blade', 'nacelle', 'floating wind', 'wind power', 'vestas', 'siemens gamesa', 'orsted'],
  'BESS': ['battery', 'bess', 'energy storage', 'lithium', 'li-ion', 'megapack', 'powerpack', 'storage system', 'grid-scale storage', 'battery storage'],
  'Gas Peaker': ['gas peaker', 'peaking plant', 'gas turbine', 'ccgt', 'ocgt', 'gas-fired', 'natural gas', 'gas power', 'peaker'],
  'Hydrogen': ['hydrogen', 'electrolyser', 'electrolysis', 'green hydrogen', 'blue hydrogen', 'h2', 'fuel cell', 'ammonia'],
  'Nuclear': ['nuclear', 'reactor', 'smr', 'small modular', 'fission', 'fusion', 'hinkley', 'sizewell', 'edf', 'rolls-royce smr'],
  'Hydro': ['hydro', 'hydroelectric', 'hydropower', 'pumped storage', 'dam', 'tidal', 'wave energy', 'marine energy'],
  'Other Renewables': ['biomass', 'biogas', 'bioenergy', 'geothermal', 'waste-to-energy', 'landfill gas', 'anaerobic digestion'],
}

const REGION_KEYWORDS: Record<string, string[]> = {
  'UK': ['uk', 'united kingdom', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'london', 'ofgem', 'national grid', 'crown estate'],
  'Ireland': ['ireland', 'irish', 'dublin', 'eirgrid', 'cer', 'northern ireland'],
  'Spain': ['spain', 'spanish', 'iberian', 'madrid', 'ree', 'red electrica'],
  'Germany': ['germany', 'german', 'berlin', 'bundesnetzagentur', 'energiewende'],
  'France': ['france', 'french', 'edf', 'rte'],
  'Netherlands': ['netherlands', 'dutch', 'tennet'],
  'Nordics': ['norway', 'sweden', 'denmark', 'finland', 'nordic', 'scandinavian', 'statnett', 'energinet'],
  'Europe': ['europe', 'european', 'eu', 'brussels', 'entso-e'],
}

// Fuse-relevance keywords (higher weight for acquisition & development context)
const FUSE_RELEVANCE_KEYWORDS = [
  // Core Fuse activities
  'acquisition', 'development', 'ready to build', 'rtb', 'cod', 'commissioning',
  'solar', 'wind', 'bess', 'battery storage', 'gas peaker',
  // Geographies
  'uk', 'ireland', 'spain', 'united kingdom',
  // Financial
  'irr', 'npv', 'capex', 'equity', 'ppa', 'cfd', 'merchant',
  // Deal-specific
  'portfolio', 'pipeline', 'greenfield', 'brownfield', 'spv', 'project finance',
  'mw', 'gw', 'capacity',
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function classify(text: string, keywordMap: Record<string, string[]>): string | null {
  const lower = text.toLowerCase()
  let bestMatch: string | null = null
  let bestScore = 0

  for (const [label, keywords] of Object.entries(keywordMap)) {
    let score = 0
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      const matches = lower.match(regex)
      if (matches) score += matches.length
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = label
    }
  }
  return bestScore >= 1 ? bestMatch : null
}

function scoreRelevance(text: string): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const kw of FUSE_RELEVANCE_KEYWORDS) {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    const matches = lower.match(regex)
    if (matches) score += matches.length
  }
  // Normalise to 0-10 scale (cap at ~15 keyword hits = 10)
  return Math.min(10, Math.round((score / 15) * 10 * 100) / 100)
}

function isEnergyRelated(text: string): boolean {
  const energyKeywords = [
    'energy', 'power', 'electricity', 'renewable', 'solar', 'wind', 'battery',
    'nuclear', 'hydrogen', 'grid', 'transmission', 'gas', 'turbine', 'mw', 'gw',
    'carbon', 'emission', 'net zero', 'climate', 'green', 'storage', 'generator',
    'utility', 'fuel', 'plant', 'offshore', 'onshore', 'substation',
  ]
  const lower = text.toLowerCase()
  return energyKeywords.some(kw => lower.includes(kw))
}

// ── RSS Parsing ─────────────────────────────────────────────────────────────

interface RawArticle {
  title: string
  summary: string
  url: string
  source: string
  published_at: string
  image_url?: string
}

function parseRSS(xml: string, source: string): RawArticle[] {
  const articles: RawArticle[] = []

  // Simple XML parsing for RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]

    const title = extractTag(item, 'title')
    const link = extractTag(item, 'link') || extractTag(item, 'guid')
    const description = extractTag(item, 'description') || extractTag(item, 'content:encoded') || ''
    const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'dc:date') || ''
    const imageUrl = extractMediaImage(item)

    if (title && link) {
      // Clean HTML from description
      const cleanSummary = description
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim()
        .slice(0, 500)

      articles.push({
        title: title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
        summary: cleanSummary,
        url: link.trim(),
        source,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        image_url: imageUrl,
      })
    }
  }

  // Also try Atom format (<entry> instead of <item>)
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1]

    const title = extractTag(entry, 'title')
    const linkMatch = entry.match(/<link[^>]*href=["']([^"']*)["'][^>]*\/?>/)
    const link = linkMatch ? linkMatch[1] : extractTag(entry, 'link')
    const summary = extractTag(entry, 'summary') || extractTag(entry, 'content') || ''
    const published = extractTag(entry, 'published') || extractTag(entry, 'updated') || ''

    if (title && link) {
      articles.push({
        title: title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
        summary: summary.replace(/<[^>]*>/g, '').trim().slice(0, 500),
        url: link.trim(),
        source,
        published_at: published ? new Date(published).toISOString() : new Date().toISOString(),
      })
    }
  }

  return articles
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1] : null
}

function extractMediaImage(item: string): string | undefined {
  // Try media:content
  const mediaMatch = item.match(/<media:content[^>]*url=["']([^"']*)["'][^>]*\/?>/i)
  if (mediaMatch) return mediaMatch[1]
  // Try enclosure
  const encMatch = item.match(/<enclosure[^>]*url=["']([^"']*)["'][^>]*\/?>/i)
  if (encMatch) return encMatch[1]
  // Try image in content
  const imgMatch = item.match(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/i)
  if (imgMatch) return imgMatch[1]
  return undefined
}

// ── Fetch articles from all sources ─────────────────────────────────────────

async function fetchFromSource(sourceKey: string): Promise<RawArticle[]> {
  const config = SOURCES[sourceKey as keyof typeof SOURCES]
  if (!config) return []

  try {
    const response = await fetch(config.rssUrl, {
      headers: {
        'User-Agent': 'FuseEnergy-NewsBot/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
      },
    })

    if (!response.ok) {
      console.warn(`[${sourceKey}] RSS fetch failed (${response.status}), skipping`)
      return []
    }

    const xml = await response.text()
    const articles = parseRSS(xml, sourceKey)
    console.log(`[${sourceKey}] Parsed ${articles.length} articles from RSS`)
    return articles
  } catch (err) {
    console.error(`[${sourceKey}] Error fetching:`, err)
    return []
  }
}

// ── Classify and score ──────────────────────────────────────────────────────

function processArticle(raw: RawArticle) {
  const text = `${raw.title} ${raw.summary}`

  // Only keep energy-related articles
  if (!isEnergyRelated(text)) return null

  // Only keep Europe/UK focused (or general energy)
  const region = classify(text, REGION_KEYWORDS)
  // Allow articles without a specific region (could be general energy news)

  const category = classify(text, CATEGORY_KEYWORDS) || 'Development'
  const technology = classify(text, TECH_KEYWORDS)
  const relevance_score = scoreRelevance(text)

  return {
    ...raw,
    category,
    technology,
    region,
    relevance_score,
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // Allow CORS for manual triggers
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log('Starting news scrape...')

    // Fetch from all sources in parallel
    const allRaw = await Promise.all(
      Object.keys(SOURCES).map(key => fetchFromSource(key))
    )
    const rawArticles = allRaw.flat()
    console.log(`Fetched ${rawArticles.length} total raw articles`)

    // Process: classify, score, filter
    const processed = rawArticles
      .map(processArticle)
      .filter(Boolean)

    console.log(`${processed.length} articles after classification/filtering`)

    if (processed.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No new articles found', count: 0 }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Upsert into Supabase (url_hash handles deduplication)
    const { data, error } = await supabase
      .from('news_articles')
      .upsert(
        processed.map(a => ({
          title: a!.title,
          summary: a!.summary,
          url: a!.url,
          source: a!.source,
          image_url: a!.image_url || null,
          published_at: a!.published_at,
          category: a!.category,
          technology: a!.technology || null,
          region: a!.region || null,
          relevance_score: a!.relevance_score,
        })),
        { onConflict: 'url', ignoreDuplicates: true }
      )

    if (error) {
      console.error('Supabase upsert error:', error)
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // ── Auto-extract comparable transactions from ALL articles ─────────────
    // Look for transaction signals in every article, not just "Acquisitions"
    let suggestedCount = 0

    // Transaction signal keywords — if an article mentions any of these, try extracting
    const TRANSACTION_SIGNALS = [
      'acqui', 'merger', 'deal', 'purchase', 'sale', 'sold', 'bought', 'divest',
      'transaction', 'portfolio sale', 'stake', 'invest', 'fund', 'secur',
      'close', 'complet', 'sign', 'agree', 'joint venture', 'jv', 'partnership',
      'million', 'billion', '£', '€', '$', 'price', 'valuation',
    ]

    for (const article of processed) {
      const text = `${article!.title} ${article!.summary}`
      const lower = text.toLowerCase()
      const technology = article!.technology
      const region = article!.region

      // Check if this article contains transaction signals
      const hasTransactionSignal = TRANSACTION_SIGNALS.some(s => lower.includes(s))
      if (!hasTransactionSignal) continue

      // ── Extract capacity (MW/MWp/GW) ──────────────────────────────────
      const mwMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:MW|MWp|MWac|MWdc)/gi)]
      const gwMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*GW/gi)]
      let capacity: number | null = null
      if (gwMatches.length > 0) {
        capacity = parseFloat(gwMatches[0][1].replace(',', '')) * 1000
      } else if (mwMatches.length > 0) {
        // Take the largest MW figure (most likely the total project size)
        capacity = Math.max(...mwMatches.map(m => parseFloat(m[1].replace(',', ''))))
      }

      // ── Extract deal value ────────────────────────────────────────────
      let totalValue: number | null = null
      let currency = 'GBP'

      // Match patterns like "£450 million", "€1.2 billion", "$50m", "£120m"
      const valuePatterns = [
        /([£€$])\s*(\d+(?:\.\d+)?)\s*(?:billion|bn)/gi,
        /([£€$])\s*(\d+(?:\.\d+)?)\s*(?:million|mn|m\b)/gi,
        /(\d+(?:\.\d+)?)\s*(?:billion|bn)\s*(?:pounds|euros?|dollars)/gi,
        /(\d+(?:\.\d+)?)\s*(?:million|mn|m)\s*(?:pounds|euros?|dollars)/gi,
      ]

      for (const pattern of valuePatterns) {
        const vMatch = pattern.exec(text)
        if (vMatch) {
          const sym = vMatch[1]
          if (sym === '£') currency = 'GBP'
          else if (sym === '€') currency = 'EUR'
          else if (sym === '$') currency = 'USD'

          const num = parseFloat(vMatch[2] || vMatch[1])
          const isBillion = lower.includes('billion') || lower.includes('bn')
          totalValue = num * (isBillion ? 1000000000 : 1000000)
          break
        }
      }

      // ── Extract buyer/seller ──────────────────────────────────────────
      const buyerPatterns = [
        /(?:acquired|bought|purchased|secured|backed)\s+by\s+([A-Z][a-zA-Z\s&'-]{2,30}?)(?:\.|,|;|\s+for|\s+from|\s+in|\s+has)/i,
        /([A-Z][a-zA-Z\s&'-]{2,30}?)\s+(?:has acquired|has bought|has purchased|acquires|buys|purchases|completes acquisition)/i,
        /(?:buyer|acquirer)[:\s]+([A-Z][a-zA-Z\s&'-]{2,30}?)(?:\.|,|;)/i,
      ]
      const sellerPatterns = [
        /(?:sold|divested|offloaded)\s+by\s+([A-Z][a-zA-Z\s&'-]{2,30}?)(?:\.|,|;|\s+to|\s+for)/i,
        /([A-Z][a-zA-Z\s&'-]{2,30}?)\s+(?:has sold|has divested|sells|divests|offloads)/i,
        /(?:seller|vendor)[:\s]+([A-Z][a-zA-Z\s&'-]{2,30}?)(?:\.|,|;)/i,
        /(?:from|acquires? from)\s+([A-Z][a-zA-Z\s&'-]{2,30}?)(?:\.|,|;|\s+for)/i,
      ]

      let buyer: string | null = null
      let seller: string | null = null
      for (const p of buyerPatterns) {
        const m = p.exec(text)
        if (m) { buyer = m[1].trim(); break }
      }
      for (const p of sellerPatterns) {
        const m = p.exec(text)
        if (m) { seller = m[1].trim(); break }
      }

      // ── Extract implied IRR ───────────────────────────────────────────
      let impliedIrr: number | null = null
      const irrMatch = text.match(/(?:IRR|return|yield)\s*(?:of|at|around|~)?\s*(\d+(?:\.\d+)?)\s*%/i)
      if (irrMatch) impliedIrr = parseFloat(irrMatch[1])

      // ── Extract stage ─────────────────────────────────────────────────
      let stage: string | null = null
      if (/\b(?:operational|operating|live)\b/i.test(text)) stage = 'Operational'
      else if (/\b(?:ready.to.build|rtb|shovel.ready|consented)\b/i.test(text)) stage = 'RtB'
      else if (/\b(?:under construction|construction phase|being built)\b/i.test(text)) stage = 'Construction'
      else if (/\b(?:development|pipeline|planning|pre-construction)\b/i.test(text)) stage = 'Development'

      // ── Calculate price per MW ────────────────────────────────────────
      let pricePerMw: number | null = null
      // Direct mention
      const ppmMatch = text.match(/([£€$])\s*(\d+(?:\.\d+)?)\s*(?:k|K|,000)?\s*(?:per|\/)\s*(?:MW|MWp)/i)
      if (ppmMatch) {
        let val = parseFloat(ppmMatch[2])
        if (/k|K/.test(ppmMatch[0]) || /,000/.test(ppmMatch[0])) val *= 1000
        pricePerMw = val
      } else if (totalValue && capacity && capacity > 0) {
        pricePerMw = totalValue / capacity
      }

      // ── Only insert if we extracted meaningful data ────────────────────
      const hasUsefulData = capacity || totalValue || buyer || seller || pricePerMw || impliedIrr
      if (!hasUsefulData) continue

      // Confidence score: how much data did we extract?
      let confidence = 0
      if (capacity) confidence += 2
      if (totalValue) confidence += 2
      if (buyer || seller) confidence += 1
      if (pricePerMw) confidence += 2
      if (impliedIrr) confidence += 2
      if (stage) confidence += 1
      // confidence out of 10

      // Get the inserted article ID
      const { data: articleRow } = await supabase
        .from('news_articles')
        .select('id')
        .eq('url', article!.url)
        .limit(1)

      // Check for duplicate (same URL)
      const { data: existing } = await supabase
        .from('comparable_transactions')
        .select('id')
        .eq('source_url', article!.url)
        .limit(1)

      if (existing && existing.length > 0) continue // Skip duplicates

      const { error: compError } = await supabase
        .from('comparable_transactions')
        .insert({
          project_name: article!.title.substring(0, 120),
          technology: technology || null,
          geography: region || null,
          capacity_mw: capacity,
          total_value: totalValue,
          price_per_mw: pricePerMw,
          implied_irr: impliedIrr,
          currency: currency,
          stage: stage,
          buyer: buyer,
          seller: seller,
          source: 'auto_scraped',
          source_url: article!.url,
          news_article_id: articleRow?.[0]?.id || null,
          status: 'suggested',
          notes: `Auto-extracted from ${article!.source} (confidence: ${confidence}/10)`,
        })

      if (!compError) suggestedCount++
    }

    console.log(`Extracted ${suggestedCount} comparable transactions from ${processed.length} articles`)

    const result = {
      success: true,
      message: `Scraped and stored ${processed.length} articles, suggested ${suggestedCount} comps`,
      count: processed.length,
      suggestedComps: suggestedCount,
      bySource: Object.fromEntries(
        Object.keys(SOURCES).map(s => [s, processed.filter(a => a!.source === s).length])
      ),
    }

    console.log('Scrape complete:', result)

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('Scrape error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
