// Vercel serverless function — proxies PVGIS API to avoid browser CORS restrictions.
// Called as: GET /api/pvgis?lat=51.47&lon=-0.12
export default async function handler(req, res) {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "lat and lon query params are required" });
  }

  // loss=5: realistic UK commercial system (soiling, shading, cable losses).
  // Temperature, spectral and reflectance losses are handled internally by PVGIS.
  // optimalangles=1: optimise tilt and azimuth for this latitude (south-facing, ~35° for UK).
  const url =
    `https://re.jrc.ec.europa.eu/api/v5_2/PVcalc` +
    `?lat=${lat}&lon=${lon}&peakpower=1&loss=5&optimalangles=1` +
    `&pvtechtechnology=crystSi&mountingplace=free&outputformat=json&browser=0`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `PVGIS error: ${text}` });
    }
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
