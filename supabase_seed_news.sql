-- ============================================================================
-- SEED: Initial news articles scraped 31 March 2026
-- Run this AFTER running supabase_migration_news.sql
-- ============================================================================

INSERT INTO news_articles (title, summary, url, source, published_at, category, technology, region, relevance_score)
VALUES

-- ── New Project Media (31 March 2026) ───────────────────────────────────────

(
  'PJM proposes price cap extension as it weighs data center policy changes',
  'PJM Interconnection is proposing a price cap extension as it evaluates policy changes related to data center power demand and grid capacity.',
  'https://newprojectmedia.com/news/pjm-proposes-price-cap-extension-data-center-policy',
  'newprojectmedia',
  '2026-03-31T08:00:00Z',
  'Policy',
  NULL,
  'Europe',
  4.50
),
(
  'ENGIE outlines global clean energy pipeline and data center plans',
  'ENGIE has outlined its global clean energy development pipeline alongside plans for data center infrastructure expansion across key markets.',
  'https://newprojectmedia.com/news/engie-outlines-global-clean-energy-pipeline-data-center-plans',
  'newprojectmedia',
  '2026-03-31T08:00:00Z',
  'Development',
  NULL,
  'Europe',
  7.20
),
(
  'Masdar eyes BESS expansion drive across key European markets',
  'Abu Dhabi-backed Masdar is targeting battery energy storage system expansion across key European markets as part of its clean energy growth strategy.',
  'https://newprojectmedia.com/news/masdar-eyes-bess-expansion-european-markets',
  'newprojectmedia',
  '2026-03-31T08:00:00Z',
  'Development',
  'BESS',
  'Europe',
  9.20
),
(
  'Greencoat Renewables and Schroders Greencoat form data centre platform with Drogheda 36 MW first project',
  'Greencoat Renewables and Schroders Greencoat have formed a new data centre platform in Ireland, with a 36 MW project in Drogheda as the first asset.',
  'https://newprojectmedia.com/news/greencoat-schroders-data-centre-platform-drogheda',
  'newprojectmedia',
  '2026-03-31T08:00:00Z',
  'Acquisitions',
  NULL,
  'Ireland',
  8.80
),
(
  'Luxcara eyes co-investor for 520 MW BESS build in Germany',
  'Luxcara is seeking a co-investor for a large-scale 520 MW battery energy storage system project in Germany.',
  'https://newprojectmedia.com/news/luxcara-co-investor-520mw-bess-germany',
  'newprojectmedia',
  '2026-03-31T08:00:00Z',
  'Finance & Markets',
  'BESS',
  'Germany',
  9.50
),

-- ── BBC News (Energy-relevant articles) ─────────────────────────────────────

(
  'Heat pumps for all new homes and plug-in solar in green tech drive',
  'The UK government has announced plans requiring heat pumps in all new homes alongside measures to boost plug-in solar panel adoption as part of a wider green technology push.',
  'https://www.bbc.co.uk/news/science-environment-heat-pumps-solar-green-tech',
  'bbc',
  '2026-03-24T08:00:00Z',
  'Policy',
  'Solar',
  'UK',
  8.50
),
(
  'Building solar panels on farm land made harder',
  'New rules in Jersey are making it more difficult to build solar panel installations on agricultural land, tightening planning requirements for ground-mount solar farms.',
  'https://www.bbc.co.uk/news/jersey-solar-panels-farm-land',
  'bbc',
  '2026-03-31T12:30:00Z',
  'Policy',
  'Solar',
  'UK',
  7.80
),
(
  'Ministers confirm heat pump targets as climate plan unveiled',
  'Scottish ministers have confirmed heat pump installation targets as part of a broader climate action plan, setting out commitments for renewable heating and emissions reduction.',
  'https://www.bbc.co.uk/news/scotland-heat-pump-targets-climate-plan',
  'bbc',
  '2026-03-24T10:00:00Z',
  'Policy',
  NULL,
  'UK',
  5.50
),
(
  'England sewage spills nearly halved in 2025 due mostly to drier weather',
  'Water companies in England report sewage spill incidents nearly halved during 2025, though experts attribute the improvement largely to drier weather conditions rather than infrastructure investment.',
  'https://www.bbc.co.uk/news/england-sewage-spills-halved-2025',
  'bbc',
  '2026-03-26T09:00:00Z',
  'Grid & Infrastructure',
  NULL,
  'UK',
  2.00
),

-- ── Financial Times (Energy section, 27-31 March 2026) ──────────────────────

(
  'Top energy developer warns on overbuilding power supplies for AI',
  'David Crane, a leading energy developer, warns that data centres should bear the cost of developing infrastructure to serve their demand rather than overbuild power supply capacity.',
  'https://www.ft.com/content/top-energy-developer-warns-overbuilding-ai',
  'ft',
  '2026-03-31T10:00:00Z',
  'Development',
  NULL,
  'Europe',
  6.80
),
(
  'UK diesel stockpiles at risk, warn traders',
  'Commercial diesel inventories in the UK could be used up by mid-May if the Strait of Hormuz remains closed, according to energy traders monitoring supply disruptions.',
  'https://www.ft.com/content/uk-diesel-stockpiles-risk-traders',
  'ft',
  '2026-03-27T14:00:00Z',
  'Finance & Markets',
  'Gas Peaker',
  'UK',
  5.50
),
(
  'UK ministers explore targeted energy bill relief for those most in need',
  'UK government ministers are considering a lower-cost targeted energy bill support scheme that could be delivered through local councils to help vulnerable households.',
  'https://www.ft.com/content/uk-ministers-targeted-energy-bill-relief',
  'ft',
  '2026-03-30T11:00:00Z',
  'Policy',
  NULL,
  'UK',
  5.20
),
(
  'Asia turns to coal as Iran war chokes off gas supplies',
  'Asian countries are increasing coal usage as disruptions from the Iran conflict restrict gas supplies, raising concerns about environmental commitments.',
  'https://www.ft.com/content/asia-coal-iran-war-gas-supplies',
  'ft',
  '2026-03-31T09:00:00Z',
  'Finance & Markets',
  NULL,
  'Europe',
  3.00
),
(
  'Avoid energy protectionism, UK chancellor will tell G7 allies',
  'The UK chancellor will urge G7 partners to act together and avoid energy protectionism, warning against policies that weaken collective resilience amid the Strait of Hormuz disruption.',
  'https://www.ft.com/content/avoid-energy-protectionism-uk-chancellor-g7',
  'ft',
  '2026-03-29T08:00:00Z',
  'Policy',
  NULL,
  'UK',
  5.80
),
(
  'BP loses head of EV charging as it accelerates pivot back to oil and gas',
  'Martin Thomsen, head of EV charging at BP, has departed as the oil major accelerates its strategic pivot back towards oil and gas ahead of its new CEO arrival.',
  'https://www.ft.com/content/bp-loses-head-ev-charging-pivot-oil-gas',
  'ft',
  '2026-03-30T14:00:00Z',
  'Acquisitions',
  NULL,
  'UK',
  4.80
),
(
  'Qatar-backed US LNG plant starts production as Iran war hits global supply',
  'The Golden Pass LNG plant, owned by QatarEnergy and ExxonMobil, has started production and may help replace gas supply shortages caused by the Hormuz crisis.',
  'https://www.ft.com/content/qatar-lng-plant-production-iran-war',
  'ft',
  '2026-03-30T10:00:00Z',
  'Development',
  'Gas Peaker',
  'Europe',
  4.20
),
(
  'Google nears deal to help finance multibillion-dollar data centre leased to Anthropic',
  'Google is close to financing a large data centre in Texas for Nexus Data Centers leased to Anthropic, with plans to bypass grid connection delays using direct gas supplies.',
  'https://www.ft.com/content/google-finance-data-centre-anthropic',
  'ft',
  '2026-03-27T16:00:00Z',
  'Finance & Markets',
  NULL,
  'Europe',
  3.50
),
(
  'Thinking of installing a home battery? Here is how',
  'Two households share contrasting experiences of joining the home energy revolution by installing residential battery storage systems.',
  'https://www.ft.com/content/home-battery-installation-guide',
  'ft',
  '2026-03-28T12:00:00Z',
  'Development',
  'BESS',
  'UK',
  5.00
),
(
  'UK growers warn of cucumber and tomato shortages as gas prices surge',
  'UK greenhouse growers are warning of fresh produce shortages as surging gas prices dramatically increase heating costs for protected crop production.',
  'https://www.ft.com/content/uk-growers-shortages-gas-prices-surge',
  'ft',
  '2026-03-31T09:30:00Z',
  'Finance & Markets',
  NULL,
  'UK',
  3.20
)

ON CONFLICT (url) DO NOTHING;

-- Verify insertion
SELECT
  source,
  category,
  COUNT(*) as article_count,
  ROUND(AVG(relevance_score), 1) as avg_relevance
FROM news_articles
GROUP BY source, category
ORDER BY source, category;
