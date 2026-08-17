import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { useCentralAssumptions } from "./CentralAssumptions";
import { useTheme } from "./ThemeContext.jsx";
import { runDCF, calcCapexTotals } from "./dcfEngine.js";
import { FM_VERSION_LABELS } from "./AcquisitionProcess.jsx";

const DEFAULT_INP = {
  projectName: "", modelStart: "2026-01-01", financialClose: "2026-03-01",
  constructionMonths: 6, cod: "2027-07-01", assetLife: 40,
  capacity: 25.53, exportCapacity: 16, yield_: 976,
  availability: 99, curtailment: 0, degradation: 0.4,
  epcModules: 0, epcInverters: 0, epcTxStations: 0, epcMountingStructure: 0,
  epcPpcScada: 0, epcCctvSecurity: 0, epcSparesContainer: 0, epcCables: 0,
  epcSubstation: 0, epcContingencies: 0,
  svcElectrical: 0, svcMechanical: 0, svcCivil: 0, svcTestStudies: 0,
  svcEngineering: 0, svcLandscaping: 0, svcLaydown: 0, epcMarginPct: 0,
  gridCableRun: 0, gridCustomerSubstation: 0, gridContestable: 0, gridNonContestable: 0,
  bidPerMWp: 0, landLease: 0, constructionInsurance: 0, preCon: 0, acquisition: 0, ddCosts: 0,
  opexRent1: 0, opexRent2: 0, opexMaintenance: 0, opexInsurance: 0, opexAssetMgmt: 0,
  opexBusinessRates: 0, opexTaMonitoring: 0, opexSpareParts: 0, opexDnoCabin: 0,
  opexSpare1: 0, opexSpare2: 0, opexSpare3: 0,
  cfdActive: true, cfdStrike: 65, cfdIndexBase: "2024-04-01", cfdStart: "2028-01-01",
  cfdTerm: 20, cfdAllocPct: 100, negativePricingDiscount: 1.678,
  ppaActive: false, ppaPrice: 63, ppaStart: "2026-12-01", ppaTerm: 10, ppaAllocPct: 0,
  merchantActive: true, merchantScenario: "central",
  regoActive: true, regoScenario: "aurora", cpi: 2.25,
  debtActive: true, gearing: 80, interestCon: 6.25, interestOps: 5.75,
  debtTenor: 20, arrangementFee: 1.0,
  dsraActive: true, dsraMonths: 6, minCash: 100000,
  corpTax: 25, capAllowGPPct: 5, capAllowGPRate: 18,
  capAllowSRPPct: 95, capAllowSRPRate: 6, capAllowSBAPct: 0, capAllowSBARate: 3,
  discountRate: 7.5,
};

const FM_VERSIONS = [1, 2, 3];

// ─── Comparison row spec ──────────────────────────────────────────────────────
// type: "section" | "kpi" | "input"
// source: "kpi" | "inp" | "capex"
// key: field name on kpis or inp object
// fmt: formatter function
// highlight: true → colour-code if values differ across versions
function buildRows(inps, kpisArr) {
  const fmtPct  = (v) => v != null && !isNaN(v) ? `${v.toFixed(2)}%` : "—";
  const fmtM    = (v) => v != null && !isNaN(v) ? `£${(v/1000).toFixed(1)}m` : "—";
  const fmtK    = (v) => v != null && !isNaN(v) ? `£${v.toFixed(0)}k` : "—";
  const fmtX    = (v) => v != null && !isNaN(v) ? `${v.toFixed(2)}x` : "—";
  const fmtN    = (v, d=2) => v != null && !isNaN(v) ? v.toFixed(d) : "—";
  const fmtDate = (v) => v ? String(v).slice(0, 10) : "—";
  const fmtYN   = (v) => v ? "Yes" : "No";
  const fmtYrs  = (v) => v != null ? `${v} yrs` : "—";
  const fmtMths = (v) => v != null ? `${v} mo` : "—";
  const fmtMWp  = (v) => v != null ? `${v} MWp` : "—";

  // helper: get kpi value for version index i
  const kpi = (i, key) => kpisArr[i]?.[key];
  // helper: get input value for version index i
  const inp = (i, key) => inps[i]?.[key];

  return [
    // ── RETURNS ──────────────────────────────────────────────────────────────
    { type: "section", label: "Returns" },
    { label: "Project IRR",       vals: FM_VERSIONS.map((_, i) => fmtPct(kpi(i, "projectIRR"))),   highlight: true },
    { label: "Equity IRR",        vals: FM_VERSIONS.map((_, i) => fmtPct(kpi(i, "equityIRR"))),    highlight: true },
    { label: "Project NPV",       vals: FM_VERSIONS.map((_, i) => fmtK(kpi(i, "projectNPV"))),     highlight: true },
    { label: "Equity NPV",        vals: FM_VERSIONS.map((_, i) => fmtK(kpi(i, "equityNPV"))),      highlight: true },

    // ── CAPITAL STRUCTURE ─────────────────────────────────────────────────────
    { type: "section", label: "Capital Structure" },
    { label: "Total CapEx",       vals: FM_VERSIONS.map((_, i) => fmtM(kpi(i, "totalCapex") != null ? kpi(i, "totalCapex") * 1000 : null)),  highlight: true },
    { label: "Equity Investment", vals: FM_VERSIONS.map((_, i) => fmtM(kpi(i, "equityInvestment") != null ? kpi(i, "equityInvestment") * 1000 : null)), highlight: true },
    { label: "Debt Amount",       vals: FM_VERSIONS.map((_, i) => fmtM(kpi(i, "debtAmount") != null ? kpi(i, "debtAmount") * 1000 : null)),  highlight: true },
    { label: "Gearing",           vals: FM_VERSIONS.map((_, i) => fmtPct(kpi(i, "gearing"))),      highlight: true },

    // ── REVENUE ───────────────────────────────────────────────────────────────
    { type: "section", label: "Revenue  (life-of-project)" },
    { label: "Total Revenue",     vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalRevenue") || 0) * 1000)),    highlight: true },
    { label: "  CfD",             vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalCfdRev") || 0) * 1000)),     highlight: false },
    { label: "  PPA",             vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalPpaRev") || 0) * 1000)),     highlight: false },
    { label: "  Merchant",        vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalMerchRev") || 0) * 1000)),   highlight: false },
    { label: "  REGO",            vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalRegoRev") || 0) * 1000)),    highlight: false },
    { label: "Total OpEx",        vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalOpex") || 0) * 1000)),       highlight: true },
    { label: "Total EBITDA",      vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalEBITDA") || 0) * 1000)),     highlight: true },
    { label: "Total Tax",         vals: FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalTax") || 0) * 1000)),        highlight: false },
    { label: "Total Distributions",vals:FM_VERSIONS.map((_, i) => fmtM((kpi(i, "totalDistributions") || 0) * 1000)), highlight: true },

    // ── DEBT SERVICE ──────────────────────────────────────────────────────────
    { type: "section", label: "Debt Service" },
    { label: "Min DSCR",          vals: FM_VERSIONS.map((_, i) => fmtX(kpi(i, "minDSCR"))),        highlight: true },
    { label: "Avg DSCR",          vals: FM_VERSIONS.map((_, i) => fmtX(kpi(i, "avgDSCR"))),        highlight: false },
    { label: "DSRA",              vals: FM_VERSIONS.map((_, i) => fmtK(kpi(i, "dsraInitial"))),     highlight: false },

    // ── KEY INPUTS ────────────────────────────────────────────────────────────
    { type: "section", label: "Key Inputs" },
    { label: "Capacity",          vals: FM_VERSIONS.map((_, i) => fmtMWp(inp(i, "capacity"))),     highlight: true },
    { label: "COD",               vals: FM_VERSIONS.map((_, i) => fmtDate(inp(i, "cod"))),         highlight: true },
    { label: "Asset Life",        vals: FM_VERSIONS.map((_, i) => fmtYrs(inp(i, "assetLife"))),    highlight: true },
    { label: "Annual Yield",      vals: FM_VERSIONS.map((_, i) => inp(i, "yield_") != null ? `${inp(i,"yield_")} kWh/kWp` : "—"), highlight: true },
    { label: "CfD Strike",        vals: FM_VERSIONS.map((_, i) => inp(i, "cfdStrike") != null ? `£${inp(i,"cfdStrike")}/MWh` : "—"), highlight: true },
    { label: "CfD Term",          vals: FM_VERSIONS.map((_, i) => fmtYrs(inp(i, "cfdTerm"))),      highlight: true },
    { label: "CfD Start",         vals: FM_VERSIONS.map((_, i) => fmtDate(inp(i, "cfdStart"))),    highlight: true },
    { label: "Merchant Scenario", vals: FM_VERSIONS.map((_, i) => inp(i, "merchantScenario") || "—"), highlight: true },
    { label: "REGO Scenario",     vals: FM_VERSIONS.map((_, i) => inp(i, "regoScenario") || "—"),  highlight: false },
    { label: "CPI",               vals: FM_VERSIONS.map((_, i) => inp(i, "cpi") != null ? `${inp(i,"cpi")}%` : "—"), highlight: true },
    { label: "Gearing %",         vals: FM_VERSIONS.map((_, i) => inp(i, "gearing") != null ? `${inp(i,"gearing")}%` : "—"), highlight: true },
    { label: "Ops Interest",      vals: FM_VERSIONS.map((_, i) => inp(i, "interestOps") != null ? `${inp(i,"interestOps")}%` : "—"), highlight: true },
    { label: "Debt Tenor",        vals: FM_VERSIONS.map((_, i) => fmtYrs(inp(i, "debtTenor"))),    highlight: true },
    { label: "Corp Tax",          vals: FM_VERSIONS.map((_, i) => inp(i, "corpTax") != null ? `${inp(i,"corpTax")}%` : "—"), highlight: false },
    { label: "Discount Rate",     vals: FM_VERSIONS.map((_, i) => inp(i, "discountRate") != null ? `${inp(i,"discountRate")}%` : "—"), highlight: true },
  ];
}

export default function VersionComparison({ project }) {
  const { theme } = useTheme();
  const { assumptions } = useCentralAssumptions() || {};
  const [rawInps, setRawInps] = useState([null, null, null]); // indexed [0]=v1, [1]=v2, [2]=v3
  const [createdAts, setCreatedAts] = useState([null, null, null]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("project_inputs")
        .select("version, inputs, fm_created_at")
        .eq("project_id", project.id)
        .in("version", [1, 2, 3]);

      const inpArr  = [null, null, null];
      const dateArr = [null, null, null];
      (data || []).forEach(row => {
        const idx = row.version - 1;
        inpArr[idx]  = row.inputs;
        dateArr[idx] = row.fm_created_at;
      });
      setRawInps(inpArr);
      setCreatedAts(dateArr);
      setLoading(false);
    })();
  }, [project?.id]);

  // Merge central assumptions curves into each version's inputs
  const effectiveInps = useMemo(() => rawInps.map(inp => {
    if (!inp) return null;
    if (!assumptions) return { ...DEFAULT_INP, ...inp };
    return {
      ...DEFAULT_INP,
      ...inp,
      _merchantHigh:    assumptions.merchant?.high    || null,
      _merchantCentral: assumptions.merchant?.central || null,
      _merchantLow:     assumptions.merchant?.low     || null,
      _regoAurora:      assumptions.rego?.aurora      || null,
      _regoPower:       assumptions.rego?.power       || null,
    };
  }), [rawInps, assumptions]);

  // Run DCF for each version
  const kpisArr = useMemo(() => effectiveInps.map(inp => {
    if (!inp) return null;
    try { return runDCF(inp)?.kpis || null; } catch { return null; }
  }), [effectiveInps]);

  const rows = useMemo(() => buildRows(effectiveInps, kpisArr), [effectiveInps, kpisArr]);

  const anyVersionLoaded = effectiveInps.some(Boolean);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: theme.textTertiary, fontSize: 13 }}>
        Loading version data…
      </div>
    );
  }

  if (!anyVersionLoaded) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: theme.textTertiary, fontSize: 13 }}>
        No FM versions found for this project.
      </div>
    );
  }

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Determine if all non-null values for a row are the same
  const allSame = (vals) => {
    const nonNull = vals.filter(v => v !== "—" && v != null);
    return nonNull.length <= 1 || nonNull.every(v => v === nonNull[0]);
  };

  const V_COLORS = [theme.accent, theme.warning, theme.success];

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>
          Version Comparison — NBO / FABO / FID
        </div>
        <div style={{ fontSize: 11, color: theme.textTertiary }}>
          Side-by-side comparison of all three FM versions. Rows with differences are highlighted.
        </div>
      </div>

      {/* Version header cards */}
      <div style={{ display: "grid", gridTemplateColumns: "220px repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
        <div />
        {FM_VERSIONS.map((v, i) => {
          const exists = !!effectiveInps[i];
          const created = fmtDate(createdAts[i]);
          return (
            <div key={v} style={{
              background: exists ? theme.pillBg : theme.surfaceBg,
              border: `1px solid ${exists ? V_COLORS[i] + "55" : theme.border}`,
              borderRadius: 10, padding: "12px 16px",
              opacity: exists ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: V_COLORS[i],
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                {FM_VERSION_LABELS[v]}
              </div>
              <div style={{ fontSize: 11, color: theme.textSecondary, fontWeight: 600 }}>
                {exists ? effectiveInps[i].projectName || project?.name || "—" : "Not created"}
              </div>
              {created && (
                <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 3 }}>
                  Created {created}
                </div>
              )}
              {!exists && (
                <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 3, fontStyle: "italic" }}>
                  FM version not yet created
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Comparison table */}
      <div style={{ borderRadius: 10, border: `1px solid ${theme.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: theme.pillBg }}>
              <th style={{ padding: "8px 16px", textAlign: "left", width: 220, fontSize: 10,
                color: theme.textSecondary, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.06em", borderRight: `1px solid ${theme.border}` }}>
                Metric
              </th>
              {FM_VERSIONS.map((v, i) => (
                <th key={v} style={{
                  padding: "8px 16px", textAlign: "right", fontSize: 10,
                  color: effectiveInps[i] ? V_COLORS[i] : theme.textMuted,
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                  borderRight: i < 2 ? `1px solid ${theme.border}` : "none",
                }}>
                  {FM_VERSION_LABELS[v]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              if (row.type === "section") {
                return (
                  <tr key={`s-${ri}`} style={{ background: theme.pageBg }}>
                    <td colSpan={4} style={{
                      padding: "10px 16px 4px",
                      fontSize: 10, fontWeight: 700, color: theme.textTertiary,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      borderTop: ri > 0 ? `1px solid ${theme.border}` : "none",
                    }}>{row.label}</td>
                  </tr>
                );
              }

              const different = row.highlight && !allSame(row.vals);
              const bg = ri % 2 === 0 ? "transparent" : theme.surfaceBg + "50";

              return (
                <tr key={`r-${ri}`} style={{ background: bg }}>
                  <td style={{
                    padding: "6px 16px",
                    color: different ? theme.textPrimary : theme.textSecondary,
                    fontWeight: different ? 600 : 400,
                    borderRight: `1px solid ${theme.border}`,
                    paddingLeft: row.label.startsWith("  ") ? 28 : 16,
                  }}>
                    {row.label.trim()}
                    {different && (
                      <span style={{
                        marginLeft: 6, fontSize: 9, padding: "1px 5px",
                        background: theme.warning + "33", color: theme.warning,
                        borderRadius: 3, fontWeight: 700, letterSpacing: "0.04em",
                        verticalAlign: "middle",
                      }}>CHANGED</span>
                    )}
                  </td>
                  {row.vals.map((val, i) => {
                    const exists = !!effectiveInps[i];
                    // Highlight the "best" vs "worst" for changed numeric rows
                    const isChanged = different && val !== "—";
                    return (
                      <td key={i} style={{
                        padding: "6px 16px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: !exists ? theme.textMuted
                          : isChanged ? V_COLORS[i]
                          : theme.textSecondary,
                        fontWeight: isChanged ? 700 : 400,
                        borderRight: i < 2 ? `1px solid ${theme.border}` : "none",
                        opacity: exists ? 1 : 0.4,
                      }}>
                        {exists ? val : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 16, fontSize: 10, color: theme.textMuted, display: "flex", gap: 20 }}>
        <span>
          <span style={{ padding: "1px 5px", background: theme.warning + "33",
            color: theme.warning, borderRadius: 3, fontWeight: 700, marginRight: 4 }}>CHANGED</span>
          value differs between versions
        </span>
        <span>Coloured values indicate which version the figure belongs to</span>
      </div>
    </div>
  );
}
