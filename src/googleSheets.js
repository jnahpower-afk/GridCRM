// Google Sheets integration - fetches central assumptions on app load

const SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID
const SERVICE_ACCOUNT_EMAIL = import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL
const PRIVATE_KEY = import.meta.env.VITE_GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')

// Generate a JWT token for Google API auth
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const signingInput = `${encode(header)}.${encode(payload)}`

  // Import private key
  const pemBody = PRIVATE_KEY.replace(/-----BEGIN RSA PRIVATE KEY-----|-----END RSA PRIVATE KEY-----|-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '')
  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  
  const key = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(signingInput)
  )

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${signingInput}.${sigB64}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  })

  const data = await res.json()
  return data.access_token
}

// Fetch a range from the sheet
async function fetchRange(token, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json()
  return data.values || []
}

// Parse a curve row — returns array of 64 values (2026-2089)
function parseCurveRow(row, valueStartCol = 2) {
  return row.slice(valueStartCol, valueStartCol + 64).map(v => parseFloat(v) || 0)
}

// Main function — fetches all central assumptions from Google Sheets
export async function fetchCentralAssumptions() {
  try {
    const token = await getAccessToken()

    // Fetch all sheets in parallel
    const [priceRows, inflationRows, capexRows, opexRows] = await Promise.all([
      fetchRange(token, 'Solar Price Curves!A1:BT50'),
      fetchRange(token, 'Inflation!A1:BT15'),
      fetchRange(token, 'Solar Capex!A1:E25'),
      fetchRange(token, 'Solar Opex!A1:D15'),
    ])

    // --- MERCHANT CURVES ---
    // Row 7 = Aurora High, Row 8 = Aurora Central, Row 9 = Aurora Low (1-indexed)
    const merchantHigh    = parseCurveRow(priceRows[6] || [], 2)
    const merchantCentral = parseCurveRow(priceRows[7] || [], 2)
    const merchantLow     = parseCurveRow(priceRows[8] || [], 2)

    // --- REGO CURVES ---
    // Row 19 = Aurora REGO, Row 20 = Power REGO (1-indexed)
    const regoAurora = parseCurveRow(priceRows[18] || [], 2)
    const regoPower  = parseCurveRow(priceRows[19] || [], 2)

    // --- INFLATION ---
    // Row 7 = CPI, Row 9 = RPI, Row 10 = PPA inflation (1-indexed)
    const cpiCurve = parseCurveRow(inflationRows[6] || [], 1)
    const rpiCurve = parseCurveRow(inflationRows[8] || [], 1)
    const ppaInflation = parseCurveRow(inflationRows[9] || [], 1)

    // --- CAPEX BENCHMARKS ---
    // Rows 4-21 contain line items: name, value, unit
    const capexItems = {}
    const capexLineItems = [
      [3,  'modules'],
      [4,  'inverters'],
      [5,  'txStations'],
      [6,  'mountingStructure'],
      [7,  'ppcScada'],
      [8,  'cctvSecurity'],
      [9,  'spareContainer'],
      [10, 'cables'],
      [11, 'substation'],
      [12, 'epcContingencies'],
      [15, 'electricalWorks'],
      [16, 'mechanicalWorks'],
      [17, 'civilWorks'],
      [18, 'testStudies'],
      [19, 'engineeringPM'],
      [20, 'landscaping'],
    ]
    capexLineItems.forEach(([rowIdx, key]) => {
      const row = capexRows[rowIdx] || []
      capexItems[key] = parseFloat(row[1]) || 0
    })

    // --- OPEX BENCHMARKS ---
    const opexItems = {}
    const opexLineItems = [
      [2,  'maintenance'],
      [3,  'insurance'],
      [4,  'assetManagement'],
      [5,  'businessRates'],
      [6,  'taMonitoring'],
      [7,  'spareParts'],
      [8,  'dnoCabinFee'],
    ]
    opexLineItems.forEach(([rowIdx, key]) => {
      const row = opexRows[rowIdx] || []
      opexItems[key] = parseFloat(row[1]) || 0
    })

    return {
      merchant: { high: merchantHigh, central: merchantCentral, low: merchantLow },
      rego: { aurora: regoAurora, power: regoPower },
      inflation: { cpi: cpiCurve, rpi: rpiCurve, ppa: ppaInflation },
      capex: capexItems,
      opex: opexItems,
      fetchedAt: new Date().toISOString(),
    }

  } catch (err) {
    console.error('Failed to fetch central assumptions:', err)
    return null
  }
}

// Fetch BESS-specific assumptions from Google Sheets
export async function fetchBessAssumptions() {
  try {
    const token = await getAccessToken()

    // Fetch BESS-specific sheets in parallel
    const [bessPriceRows, bessDegRows, bessOmRows] = await Promise.all([
      fetchRange(token, 'UK BESS Price Curves!A1:BT50'),
      fetchRange(token, 'BESS Degradation!A1:BT50'),
      fetchRange(token, 'BESS O&M Schedule!A1:F20').catch(() => []),
    ])

    // --- BESS MERCHANT CURVES ---
    // Expect rows structured similar to solar: High / Central / Low
    // Row indices may need adjusting once we see the actual sheet layout
    const bessHigh    = parseCurveRow(bessPriceRows[6] || [], 2)
    const bessCentral = parseCurveRow(bessPriceRows[7] || [], 2)
    const bessLow     = parseCurveRow(bessPriceRows[8] || [], 2)

    // --- BESS DEGRADATION CURVE ---
    // Expect quarterly degradation factors (80 quarters = 20 years)
    // Parse from row 2 onward (row 1 = header)
    const degradationCurve = []
    for (let i = 1; i < bessDegRows.length && i <= 80; i++) {
      const row = bessDegRows[i] || []
      degradationCurve.push(parseFloat(row[1] || row[0]) || 1)
    }

    // --- BESS O&M SCHEDULE ---
    // Expected layout: Row 1 = header, Rows 2-7 = plateaus
    // Columns: A=Plateau Name, B=Start Year, C=End Year, D=£/MW/year, E=Common Cost £/MW/year (optional)
    const omPlateaus = []
    const omCommon = {}
    if (bessOmRows.length > 1) {
      // Parse plateau rows (rows 2-7, i.e. indices 1-6)
      for (let i = 1; i < bessOmRows.length; i++) {
        const row = bessOmRows[i] || []
        if (row[0] && row[1] && row[2] && row[3]) {
          omPlateaus.push({
            name: row[0],
            startYear: parseInt(row[1]) || 1,
            endYear: parseInt(row[2]) || 1,
            perMW: parseFloat(row[3]) || 0,
          })
        }
      }
    }

    return {
      merchant: { high: bessHigh, central: bessCentral, low: bessLow },
      degradation: degradationCurve,
      omPlateaus: omPlateaus.length > 0 ? omPlateaus : null,
      fetchedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('Failed to fetch BESS assumptions:', err)
    return null
  }
}
