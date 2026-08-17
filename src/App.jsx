import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { useCentralAssumptions } from "./CentralAssumptions";
import FuseLogo from "./FuseLogo.jsx";
import { useTheme } from "./ThemeContext.jsx";
import { addMonths, monthDiff, daysInMonth, computeIRR, computeNPV, SEASONALITY, calcCapexTotals, MERCHANT_HIGH, MERCHANT_CENTRAL, MERCHANT_LOW, REGO_AURORA, REGO_POWER, runDCF } from "./dcfEngine.js";

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────

const DEFAULT = {
  projectName: "Sherbourne",
  modelStart: "2026-01-01", financialClose: "2026-03-01",
  constructionMonths: 6, cod: "2027-07-01", assetLife: 40,
  capacity: 25.53, exportCapacity: 16, yield_: 976,
  availability: 99, curtailment: 0, degradation: 0.4,
  // EPC Equipment (£)
  epcModules: 2285856, epcInverters: 306000, epcTxStations: 360000,
  epcMountingStructure: 1428660, epcPpcScada: 140000, epcCctvSecurity: 340000,
  epcSparesContainer: 130000, epcCables: 547653, epcSubstation: 400000, epcContingencies: 952440,
  // EPC Services (£)
  svcElectrical: 809574, svcMechanical: 785763, svcCivil: 714330,
  svcTestStudies: 240000, svcEngineering: 476220, svcLandscaping: 105000, svcLaydown: 125000,
  epcMarginPct: 0,
  // Grid (£)
  gridCableRun: 0, gridCustomerSubstation: 0, gridContestable: 756492, gridNonContestable: 868648,
  // Other CapEx (£)
  bidPerMWp: 0,
  landLease: 14000, constructionInsurance: 60000, preCon: 100000, acquisition: 2162000, ddCosts: 80000,
  // Opex — Rent (stored as total £ p.a.)
  opexRent1: 30000, opexRent1_acres: 40, opexRent1_rate: 750,
  opexRent2: 25500, opexRent2_acres: 30, opexRent2_rate: 850,
  // Opex — £/MWp lines (stored as total £ p.a.)
  opexMaintenance: 114885, opexInsurance: 38295, opexAssetMgmt: 42124,
  opexBusinessRates: 76590, opexTaMonitoring: 2553, opexSpareParts: 31912,
  opexDnoCabin: 5673,
  opexSpare1: 0, opexSpare2: 0, opexSpare3: 0,
  // Revenue
  cfdActive: true, cfdStrike: 65.23, cfdIndexBase: "2024-04-01", cfdStart: "2028-01-01", cfdTerm: 20, cfdAllocPct: 100, negativePricingDiscount: 1.678,
  ppaActive: false, ppaPrice: 63, ppaStart: "2026-12-01", ppaTerm: 10, ppaAllocPct: 0,
  merchantActive: true, merchantScenario: "central",
  regoActive: true, regoScenario: "aurora",
  cpi: 2.25,
  debtActive: true, gearing: 80, interestCon: 6.25, interestOps: 5.75, debtTenor: 20, arrangementFee: 1.0,
  dsraActive: true, dsraMonths: 6, minCash: 100000,
  corpTax: 25, capAllowGPPct: 5, capAllowGPRate: 18, capAllowSRPPct: 95, capAllowSRPRate: 6, capAllowSBAPct: 0, capAllowSBARate: 3, discountRate: 7.5,
};

// ─── UI HELPERS ───────────────────────────────────────────────────────────────

function Field({ label, value, onChange, type = "number", unit, step = "0.01", min, hint }) {
  const { theme } = useTheme();
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 500 }}>{label}</label>
        {hint && <span style={{ fontSize: 10, color: theme.textMuted }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <input
          type={type === "date" ? "month" : "number"}
          value={type === "date" ? value.slice(0, 7) : value}
          step={step} min={min}
          onChange={e => onChange(type === "date" ? e.target.value + "-01" : parseFloat(e.target.value) || 0)}
          onFocus={e => e.target.select()}
          style={{ flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: unit ? "6px 0 0 6px" : 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" }}
        />
        {unit && <span style={{ padding: "7px 8px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>{unit}</span>}
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  const { theme } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: theme.textTertiary }}>{label}</label>
      <div onClick={() => onChange(!value)} style={{ width: 36, height: 20, borderRadius: 10, cursor: "pointer", position: "relative", background: value ? theme.accent : theme.textMuted, transition: "background 0.2s" }}>
        <div style={{ position: "absolute", top: 3, left: value ? 18 : 3, width: 14, height: 14, borderRadius: "50%", background: value ? theme.success : theme.textTertiary, transition: "left 0.2s" }} />
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color = null, size = 20 }) {
  const { theme } = useTheme();
  const textColor = color || theme.textPrimary;
  return (
    <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 800, color: textColor, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function fmt(n, d = 2) { return (n == null || isNaN(n)) ? "—" : n.toFixed(d); }
function fmtPct(n, d = 2) { return (n == null || isNaN(n)) ? "—" : `${fmt(n, d)}%`; }
function fmtM(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000000) return `£${fmt(n / 1000000, 1)}m`;
  if (abs >= 1000) return `£${fmt(n / 1000, 1)}k`;
  return `£${fmt(n, 0)}`;
}

function StackedRevenueChart({ rows }) {
  const { theme } = useTheme();
  if (!rows || rows.length === 0) return null;
  const opsRows = rows.filter(r => r.isOps);
  if (opsRows.length === 0) return null;

  const STACKS = [
    { key: "cfdRev",      label: "CfD",      color: theme.accent },
    { key: "ppaRev",      label: "PPA",       color: theme.textTertiary },
    { key: "merchantRev", label: "Merchant",  color: theme.warning },
    { key: "regoRev",     label: "REGO",      color: theme.success },
  ];

  const W = 600, H = 220, PAD_L = 60, PAD_B = 28, PAD_T = 8, PAD_R = 8;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const rawMax = Math.max(...opsRows.map(r => (r.cfdRev + r.ppaRev + r.merchantRev + r.regoRev) / 1000));
  const niceMax = Math.ceil(rawMax / 500) * 500 || 1000;
  const tickStep = niceMax <= 2000 ? 500 : niceMax <= 5000 ? 1000 : 2000;
  const ticks = [];
  for (let t = 0; t <= niceMax; t += tickStep) ticks.push(t);
  const toSvgY = v => PAD_T + chartH - (v / niceMax) * chartH;
  const barW = Math.max(2, chartW / opsRows.length - 2);
  const barSpacing = chartW / opsRows.length;

  return (
    <div>
      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
        Annual Revenue by Source (£’000s)
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        {STACKS.map(s => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, opacity: 0.85, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: theme.textSecondary }}>{s.label}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        {/* Gridlines + Y labels */}
        {ticks.map(t => {
          const y = toSvgY(t);
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={t === 0 ? theme.textMuted : theme.border} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fontSize={9} fill={theme.textTertiary}>
                {t === 0 ? "0" : `£${t.toLocaleString()}`}
              </text>
            </g>
          );
        })}
        {/* Stacked bars */}
        {opsRows.map((r, i) => {
          const x = PAD_L + i * barSpacing + (barSpacing - barW) / 2;
          let yOffset = toSvgY(0);
          return STACKS.map(s => {
            const v = (r[s.key] || 0) / 1000;
            if (v <= 0) return null;
            const segH = (v / niceMax) * chartH;
            yOffset -= segH;
            return (
              <rect key={s.key} x={x} y={yOffset} width={barW} height={segH}
                fill={s.color} opacity={0.85} />
            );
          });
        })}
        {/* X axis labels */}
        {opsRows.map((r, i) => {
          if (i !== 0 && r.year % 5 !== 0) return null;
          const x = PAD_L + i * barSpacing + barSpacing / 2;
          return <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize={9} fill={theme.textTertiary}>{r.year}</text>;
        })}
        {/* Baseline */}
        <line x1={PAD_L} x2={W - PAD_R} y1={toSvgY(0)} y2={toSvgY(0)} stroke={theme.textMuted} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function BarChart({ rows, yKey, label, color = null }) {
  const { theme } = useTheme();
  const barColor = color || theme.accent;
  if (!rows || rows.length === 0) return null;
  const vals = rows.map(r => r[yKey]);
  if (vals.every(v => v === 0)) return null;

  const W = 600, H = 200, PAD_L = 56, PAD_B = 28, PAD_T = 8, PAD_R = 8;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const hasNeg = vals.some(v => v < 0);
  const rawMax = Math.max(...vals.map(Math.abs)) / 1000;
  const niceMax = Math.ceil(rawMax / 500) * 500 || 1000;
  const yMin = hasNeg ? -niceMax : 0;
  const yMax = niceMax;
  const yRange = yMax - yMin;
  const tickStep = niceMax <= 2000 ? 500 : niceMax <= 5000 ? 1000 : 2000;
  const ticks = [];
  for (let t = yMin; t <= yMax; t += tickStep) ticks.push(t);
  const toSvgY = v => PAD_T + chartH - ((v - yMin) / yRange) * chartH;
  const zeroY = toSvgY(0);
  const barW = Math.max(2, chartW / rows.length - 2);
  const barSpacing = chartW / rows.length;

  return (
    <div>
      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label} (£’000s)</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        {/* Gridlines + Y labels */}
        {ticks.map(t => {
          const y = toSvgY(t);
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={t === 0 ? theme.textMuted : theme.border} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fontSize={9} fill={theme.textTertiary}>
                {t === 0 ? "0" : `${t < 0 ? "-" : ""}£${Math.abs(t).toLocaleString()}`}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {rows.map((r, i) => {
          const v = r[yKey] / 1000;
          const isNeg = v < 0;
          const barH = Math.abs(v / yRange) * chartH;
          const x = PAD_L + i * barSpacing + (barSpacing - barW) / 2;
          const y = isNeg ? zeroY : zeroY - barH;
          return (
            <rect key={i} x={x} y={y} width={barW} height={Math.max(barH, 0.5)}
              fill={isNeg ? theme.error : barColor} opacity={0.85}
              rx={2} />
          );
        })}
        {/* X axis labels */}
        {rows.map((r, i) => {
          if (i !== 0 && r.year % 5 !== 0) return null;
          const x = PAD_L + i * barSpacing + barSpacing / 2;
          return <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize={9} fill={theme.textTertiary}>{r.year}</text>;
        })}
        {/* Zero line */}
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke={theme.textMuted} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ─── CAPEX FULL PAGE ──────────────────────────────────────────────────────────

function CapexPage({ inp, set, assumptions }) {
  const { theme } = useTheme();
  const mwp = inp.capacity || 1;
  const mwe = inp.exportCapacity || 1;
  const { epcEquipment, epcServices, epcBase, epcTotal, gridTotal, otherTotal, grandTotal } = calcCapexTotals(inp);
  const pct = (v) => grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(1)}%` : "—";
  const fmtGBP = (v) => `£${Math.round(v).toLocaleString()}`;

  function CRow({ label, storeKey, isFixed, unit }) {
    const u = unit || "MWp";
    const autoMult = u === "MWe" ? mwe : mwp;

    // For fixed rows we store: { base, mult } so user can edit both independently.
    // We encode this by storing the total in storeKey and tracking mult in storeKey+"_mult".
    // For rate rows we store the total (rate × autoMult) in storeKey.
    const stored = inp[storeKey];
    const storedMult = inp[storeKey + "_mult"];

    let rate, mult, total;
    if (isFixed) {
      mult = storedMult != null ? storedMult : 1;
      // "rate" for fixed is the per-unit base; total = rate * mult
      // We store total in storeKey, so base = stored / mult
      const base = mult !== 0 ? stored / mult : stored;
      rate = base;
      total = rate * mult;
    } else {
      mult = autoMult;
      rate = mult !== 0 ? stored / mult : 0;
      total = stored;
    }

    const inputStyle = {
      width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
      borderRadius: 4, color: theme.textPrimary, padding: "4px 8px",
      fontSize: 11, fontFamily: "monospace", outline: "none", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
    };

    return (
      <tr style={{ borderBottom: `1px solid ${theme.surfaceBg}` }}>
        <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>{label}</td>
        <td style={{ padding: "5px 8px" }}>
          <input
            type="text"
            inputMode="numeric"
            defaultValue={isFixed ? Math.round(rate) : rate.toFixed(0)}
            key={`${storeKey}-rate-${isFixed ? Math.round(rate) : rate.toFixed(0)}`}
            onBlur={e => {
              const v = parseFloat(e.target.value.replace(/,/g, "")) || 0;
              if (isFixed) {
                const m = inp[storeKey + "_mult"] != null ? inp[storeKey + "_mult"] : 1;
                set(storeKey, v * m);
              } else {
                set(storeKey, v * autoMult);
              }
            }}
            style={inputStyle}
          />
        </td>
        <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center", whiteSpace: "nowrap" }}>
          {isFixed ? "Fixed" : `£/${u}`}
        </td>
        <td style={{ padding: "5px 8px" }}>
          {isFixed ? (
            <input
              type="text"
              inputMode="numeric"
              defaultValue={mult}
              key={`${storeKey}-mult-${mult}`}
              onBlur={e => {
                const newMult = parseFloat(e.target.value.replace(/,/g, "")) || 1;
                // Preserve the base rate, update total = base * newMult
                const currentMult = inp[storeKey + "_mult"] != null ? inp[storeKey + "_mult"] : 1;
                const base = currentMult !== 0 ? inp[storeKey] / currentMult : inp[storeKey];
                set(storeKey + "_mult", newMult);
                set(storeKey, base * newMult);
              }}
              style={{ ...inputStyle, textAlign: "right" }}
            />
          ) : (
            <span style={{ display: "block", textAlign: "right", fontSize: 11, color: theme.textTertiary, fontFamily: "monospace", padding: "4px 8px" }}>
              ×{mult.toFixed(2)}
            </span>
          )}
        </td>
        <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>
          {fmtGBP(total)}
        </td>
        <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>
          {pct(total)}
        </td>
      </tr>
    );
  }

  function SHead({ title, total, color }) {
    return (
      <tr style={{ background: theme.pillBg, borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}` }}>
        <td colSpan={4} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</td>
        <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, color, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "8px 12px", fontSize: 10, color: theme.textMuted, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  function SubTotal({ label, total, color }) {
    return (
      <tr style={{ background: theme.hoverBg, borderBottom: `1px solid ${theme.border}` }}>
        <td colSpan={4} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color }}>{label}</td>
        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 800, color, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "8px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary, fontFamily: "'Inter', system-ui, sans-serif" }}>Capital Expenditure</span>
          <span style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 12 }}>{inp.projectName} · {inp.capacity} MWp · {inp.exportCapacity} MWe</span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total CapEx</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.warning, fontFamily: "'Inter', system-ui, sans-serif" }}>£{(grandTotal / 1e6).toFixed(2)}m</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>£ / MWp</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.textSecondary, fontFamily: "'Inter', system-ui, sans-serif" }}>£{Math.round(grandTotal / mwp).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "EPC Total", value: epcTotal, color: theme.success, dimColor: theme.textSecondary, unitValue: mwp > 0 ? `£${Math.round(epcTotal / mwp / 1000)}k / MWp` : null },
            { label: "Grid Total", value: gridTotal, color: theme.success, dimColor: theme.textSecondary, unitValue: mwe > 0 ? `£${Math.round(gridTotal / mwe / 1000)}k / MWe` : null },
            { label: "Other Costs", value: otherTotal, color: theme.textTertiary, dimColor: null, unitValue: null },
          ].map(({ label, value, color, dimColor, unitValue }) => (
            <div key={label} style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'Inter', system-ui, sans-serif" }}>£{(value / 1e6).toFixed(2)}m</span>
                {unitValue && <span style={{ fontSize: 18, fontWeight: 800, color: dimColor, fontFamily: "'Inter', system-ui, sans-serif" }}>{unitValue}</span>}
              </div>
              <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 4 }}>{pct(value)} of total</div>
            </div>
          ))}
        </div>

        <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}`, background: theme.pillBg }}>
                {["Line Item", "Rate (£)", "Unit", "Multiplier", "Total Cost", "% of CapEx"].map((h, i) => (
                  <th key={h} style={{ padding: "9px 12px", fontSize: 9, color: theme.textTertiary, textAlign: i === 0 ? "left" : "right", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SHead title="EPC — Solar Equipment" total={epcEquipment} color="#4A8C5C" />
              <CRow label="Modules" storeKey="epcModules" unit="MWp" />
              <CRow label="Inverters" storeKey="epcInverters" unit="MWp" />
              <CRow label="TX Stations" storeKey="epcTxStations" unit="MWp" />
              <CRow label="Mounting Structure" storeKey="epcMountingStructure" unit="MWp" />
              <CRow label="PPC & SCADA" storeKey="epcPpcScada" isFixed />
              <CRow label="CCTV & Security" storeKey="epcCctvSecurity" isFixed />
              <CRow label="Spares, Container & Welfare" storeKey="epcSparesContainer" isFixed />
              <CRow label="Cables" storeKey="epcCables" unit="MWp" />
              <CRow label="Substation" storeKey="epcSubstation" isFixed />
              <CRow label="EPC Contingencies" storeKey="epcContingencies" unit="MWp" />

              <SHead title="EPC — Services" total={epcServices} color="#4A8C5C" />
              <CRow label="Electrical Works (excl. cables)" storeKey="svcElectrical" unit="MWp" />
              <CRow label="Mechanical Works" storeKey="svcMechanical" unit="MWp" />
              <CRow label="Civil Works" storeKey="svcCivil" unit="MWp" />
              <CRow label="Tests & Studies" storeKey="svcTestStudies" isFixed />
              <CRow label="Engineering & Project Management" storeKey="svcEngineering" unit="MWp" />
              <CRow label="Landscaping" storeKey="svcLandscaping" isFixed />
              <CRow label="Additional Laydown Costs" storeKey="svcLaydown" isFixed />

              <tr style={{ background: theme.pillBg, borderTop: `1px solid ${theme.border}` }}>
                <td style={{ padding: "7px 12px", fontSize: 11, color: theme.textSecondary }}>EPC Contractor Margin</td>
                <td style={{ padding: "5px 8px" }}>
                  <input type="text" inputMode="decimal"
                    defaultValue={inp.epcMarginPct}
                    key={`epcMargin-${inp.epcMarginPct}`}
                    onBlur={e => set("epcMarginPct", parseFloat(e.target.value.replace(/,/g, "")) || 0)}
                    style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 4, color: theme.textPrimary, padding: "4px 8px", fontSize: 11, fontFamily: "monospace", outline: "none" }}
                  />
                </td>
                <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center" }}>%</td>
                <td style={{ padding: "5px 8px", fontSize: 11, color: theme.textTertiary, textAlign: "right", fontFamily: "monospace" }}>× EPC base</td>
                <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(epcBase * inp.epcMarginPct / 100)}</td>
                <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(epcBase * inp.epcMarginPct / 100)}</td>
              </tr>
              <SubTotal label="EPC Total (inc. margin)" total={epcTotal} color={theme.success} />

              <SHead title="Grid Connection" total={gridTotal} color={theme.success} />
              <CRow label="Cable Run" storeKey="gridCableRun" unit="MWe" />
              <CRow label="Customer Substation" storeKey="gridCustomerSubstation" isFixed />
              <CRow label="Contestable (incl. in grid offer)" storeKey="gridContestable" unit="MWe" />
              <CRow label="Non-Contestable" storeKey="gridNonContestable" unit="MWe" />
              <SubTotal label="Grid Total" total={gridTotal} color={theme.success} />

              <SHead title="Other Capital Costs" total={otherTotal} color={theme.textTertiary} />
              <CRow label="Land / Lease Costs" storeKey="landLease" isFixed />
              <CRow label="Construction Insurance" storeKey="constructionInsurance" isFixed />
              <CRow label="Pre-Construction" storeKey="preCon" isFixed />
              {/* Acquisition — auto-derived from Bid Rate in PRO tab */}
              <tr style={{ borderBottom: `1px solid ${theme.surfaceBg}`, background: theme.surfaceBg }}>
                <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>
                  Acquisition / Project Rights
                  <span style={{ marginLeft: 6, fontSize: 9, color: theme.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>← Bid</span>
                </td>
                <td style={{ padding: "5px 8px" }}>
                  <div style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 4, color: theme.textTertiary, padding: "4px 8px", fontSize: 11, fontFamily: "monospace" }}>
                    {inp.bidPerMWp > 0 ? (inp.bidPerMWp / 1000).toFixed(0) : "—"}
                  </div>
                </td>
                <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center" }}>£k/MWp</td>
                <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textTertiary, textAlign: "center" }}>×{mwp.toFixed(2)}</td>
                <td style={{ padding: "5px 8px", fontSize: 12, fontWeight: 700, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>
                  {fmtGBP(inp.acquisition)}
                </td>
                <td style={{ padding: "5px 8px", fontSize: 11, color: theme.textTertiary, textAlign: "right" }}>
                  {grandTotal > 0 ? ((inp.acquisition / grandTotal) * 100).toFixed(1) + "%" : "—"}
                </td>
              </tr>
              <CRow label="DD / Transaction Costs" storeKey="ddCosts" isFixed />
              <SubTotal label="Other Total" total={otherTotal} color={theme.textTertiary} />

              <tr style={{ background: theme.pillBg, borderTop: `2px solid ${theme.textMuted}` }}>
                <td colSpan={4} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800, color: theme.warning, fontFamily: "'Inter', system-ui, sans-serif" }}>TOTAL CAPITAL EXPENDITURE</td>
                <td style={{ padding: "10px 12px", fontSize: 15, fontWeight: 800, color: theme.warning, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(grandTotal)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, color: theme.warning, textAlign: "right" }}>100%</td>
              </tr>
              <tr style={{ background: theme.surfaceBg }}>
                <td colSpan={4} style={{ padding: "6px 12px", fontSize: 10, color: theme.textTertiary }}>£ per MWp installed</td>
                <td style={{ padding: "6px 12px", fontSize: 11, color: theme.textTertiary, textAlign: "right", fontFamily: "monospace" }}>£{Math.round(grandTotal / mwp).toLocaleString()} / MWp</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}



// ─── OPEX FULL PAGE ──────────────────────────────────────────────────────────────────────────────

function calcOpexTotal(inp) {
  const rentTotal = inp.opexRent1 + inp.opexRent2;
  const opsTotal  = inp.opexMaintenance + inp.opexInsurance + inp.opexAssetMgmt +
                    inp.opexBusinessRates + inp.opexTaMonitoring + inp.opexSpareParts +
                    inp.opexDnoCabin + inp.opexSpare1 + inp.opexSpare2 + inp.opexSpare3;
  return { rentTotal, opsTotal, grandTotal: rentTotal + opsTotal };
}

function OpexPage({ inp, set, assumptions }) {
  const { theme } = useTheme();
  const mwp = inp.capacity || 1;
  const { rentTotal, opsTotal, grandTotal } = calcOpexTotal(inp);
  const pct    = v => grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(1)}%` : "—";
  const fmtGBP = v => `£${Math.round(v).toLocaleString()}`;

  const cellStyle = {
    width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 4, color: theme.textPrimary, padding: "4px 8px",
    fontSize: 11, fontFamily: "monospace", outline: "none",
  };

  function RentRow({ label, storeKey, rateKey, acresKey }) {
    const rate  = inp[rateKey];
    const acres = inp[acresKey];
    const total = inp[storeKey];
    return (
      <tr style={{ borderBottom: `1px solid ${theme.surfaceBg}` }}>
        <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>{label}</td>
        <td style={{ padding: "5px 8px" }}>
          <input type="text" inputMode="numeric"
            defaultValue={rate}
            key={`${storeKey}-r-${rate}`}
            onBlur={e => {
              const r = parseFloat(e.target.value.replace(/,/g,"")) || 0;
              set(rateKey, r);
              set(storeKey, r * inp[acresKey]);
            }}
            style={cellStyle}
          />
        </td>
        <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center", whiteSpace: "nowrap" }}>£/Acre</td>
        <td style={{ padding: "5px 8px" }}>
          <input type="text" inputMode="numeric"
            defaultValue={acres}
            key={`${storeKey}-a-${acres}`}
            onBlur={e => {
              const a = parseFloat(e.target.value.replace(/,/g,"")) || 0;
              set(acresKey, a);
              set(storeKey, inp[rateKey] * a);
            }}
            style={{ ...cellStyle, textAlign: "right" }}
          />
        </td>
        <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  function MwpRow({ label, storeKey }) {
    const total = inp[storeKey];
    const rate  = mwp > 0 ? total / mwp : 0;
    return (
      <tr style={{ borderBottom: `1px solid ${theme.surfaceBg}` }}>
        <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>{label}</td>
        <td style={{ padding: "5px 8px" }}>
          <input type="text" inputMode="numeric"
            defaultValue={rate.toFixed(0)}
            key={`${storeKey}-r-${rate.toFixed(0)}`}
            onBlur={e => {
              const r = parseFloat(e.target.value.replace(/,/g,"")) || 0;
              set(storeKey, r * mwp);
            }}
            style={cellStyle}
          />
        </td>
        <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center", whiteSpace: "nowrap" }}>£/MWp</td>
        <td style={{ padding: "5px 8px", fontSize: 11, color: theme.textTertiary, textAlign: "right", fontFamily: "monospace" }}>×{mwp.toFixed(2)}</td>
        <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  function SHead({ title, total, color }) {
    return (
      <tr style={{ background: theme.pillBg, borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}` }}>
        <td colSpan={4} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</td>
        <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, color, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "8px 12px", fontSize: 10, color: theme.textMuted, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  function SubTotal({ label, total, color }) {
    return (
      <tr style={{ background: theme.hoverBg, borderBottom: `1px solid ${theme.border}` }}>
        <td colSpan={4} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color }}>{label}</td>
        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 800, color, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "8px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary, fontFamily: "'Inter', system-ui, sans-serif" }}>Operating Expenditure</span>
          <span style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 12 }}>{inp.projectName} · {inp.capacity} MWp · Year 1, CPI-indexed</span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Opex (Y1)</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.error, fontFamily: "'Inter', system-ui, sans-serif" }}>£{(grandTotal / 1e3).toFixed(1)}k</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>£ / MWp</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.textSecondary, fontFamily: "'Inter', system-ui, sans-serif" }}>£{Math.round(grandTotal / mwp).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Rent Total", value: rentTotal, color: theme.warning, dimColor: theme.textSecondary, unit: `£${Math.round(rentTotal / mwp).toLocaleString()} / MWp` },
            { label: "Operating Costs", value: opsTotal, color: theme.error, dimColor: theme.textSecondary, unit: `£${Math.round(opsTotal / mwp).toLocaleString()} / MWp` },
          ].map(({ label, value, color, dimColor, unit }) => (
            <div key={label} style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'Inter', system-ui, sans-serif" }}>£{(value / 1e3).toFixed(1)}k</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: dimColor, fontFamily: "'Inter', system-ui, sans-serif" }}>{unit}</span>
              </div>
              <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 4 }}>{pct(value)} of total</div>
            </div>
          ))}
        </div>

        <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}`, background: theme.pillBg }}>
                {["Line Item", "Rate (£)", "Unit", "Multiplier", "Annual Cost", "% of Opex"].map((h, i) => (
                  <th key={h} style={{ padding: "9px 12px", fontSize: 9, color: theme.textTertiary, textAlign: i === 0 ? "left" : "right", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SHead title="Rent" total={rentTotal} color={theme.warning} />
              <RentRow label="Land Parcel 1" storeKey="opexRent1" rateKey="opexRent1_rate" acresKey="opexRent1_acres" />
              <RentRow label="Land Parcel 2" storeKey="opexRent2" rateKey="opexRent2_rate" acresKey="opexRent2_acres" />
              <SubTotal label="Rent Total" total={rentTotal} color={theme.warning} />

              <SHead title="Operating Costs" total={opsTotal} color={theme.error} />
              <MwpRow label="Maintenance (O&M)" storeKey="opexMaintenance" />
              <MwpRow label="Insurance" storeKey="opexInsurance" />
              <MwpRow label="Asset Management" storeKey="opexAssetMgmt" />
              <MwpRow label="Business Rates" storeKey="opexBusinessRates" />
              <MwpRow label="TA Monitoring" storeKey="opexTaMonitoring" />
              <MwpRow label="Spare Parts" storeKey="opexSpareParts" />
              <MwpRow label="DNO Cabin Fee" storeKey="opexDnoCabin" />
              <MwpRow label="Spare 1" storeKey="opexSpare1" />
              <MwpRow label="Spare 2" storeKey="opexSpare2" />
              <MwpRow label="Spare 3" storeKey="opexSpare3" />
              <SubTotal label="Operating Costs Total" total={opsTotal} color={theme.error} />

              <tr style={{ background: theme.pillBg, borderTop: `2px solid ${theme.textMuted}` }}>
                <td colSpan={4} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800, color: theme.error, fontFamily: "'Inter', system-ui, sans-serif" }}>TOTAL OPERATING EXPENDITURE</td>
                <td style={{ padding: "10px 12px", fontSize: 15, fontWeight: 800, color: theme.error, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(grandTotal)}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, color: theme.error, textAlign: "right" }}>100%</td>
              </tr>
              <tr style={{ background: theme.surfaceBg }}>
                <td colSpan={4} style={{ padding: "6px 12px", fontSize: 10, color: theme.textTertiary }}>£ per MWp installed (Year 1)</td>
                <td style={{ padding: "6px 12px", fontSize: 11, color: theme.textTertiary, textAlign: "right", fontFamily: "monospace" }}>£{Math.round(grandTotal / mwp).toLocaleString()} / MWp</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── SEED HELPER (for new FM versions) ───────────────────────────────────────

function seedFromProject(project, assumptions) {
  const cap = project.capacity_mwp || DEFAULT.capacity;
  const c = assumptions?.capex || {};
  const o = assumptions?.opex || {};
  return {
    ...DEFAULT,
    projectName: project.name || DEFAULT.projectName,
    capacity: cap,
    cod: project.cod ? (project.cod.length === 7 ? project.cod + "-01" : project.cod) : DEFAULT.cod,
    epcModules:          (c.modules            || 96000)  * cap,
    epcInverters:        (c.inverters           || 20000)  * cap,
    epcTxStations:       (c.txStations          || 25000)  * cap,
    epcMountingStructure:(c.mountingStructure   || 45000)  * cap,
    epcPpcScada:         (c.ppcScada            || 7000)   * cap,
    epcCctvSecurity:     (c.cctvSecurity        || 10000)  * cap,
    epcSparesContainer:  (c.spareContainer      || 7000)   * cap,
    epcCables:           (c.cables              || 30000)  * cap,
    epcSubstation:       (c.substation          || 30000)  * cap,
    epcContingencies:    (c.epcContingencies    || 10000)  * cap,
    svcElectrical:       (c.electricalWorks     || 30000)  * cap,
    svcMechanical:       (c.mechanicalWorks     || 30000)  * cap,
    svcCivil:            (c.civilWorks          || 25000)  * cap,
    svcTestStudies:      (c.testStudies         || 10000)  * cap,
    svcEngineering:      (c.engineeringPM       || 40000)  * cap,
    svcLandscaping:      (c.landscaping         || 5000)   * cap,
    gridCableRun: 0, gridCustomerSubstation: 0, gridContestable: 0, gridNonContestable: 0,
    bidPerMWp: 0,
    landLease: 0, constructionInsurance: 0, preCon: 0, acquisition: 0, ddCosts: 0,
    opexMaintenance:     (o.maintenance         || 4000)   * cap,
    opexInsurance:       (o.insurance           || 1000)   * cap,
    opexAssetMgmt:       (o.assetManagement     || 0)      * cap,
    opexBusinessRates:   (o.businessRates       || 2500)   * cap,
    opexTaMonitoring:    (o.taMonitoring        || 100)    * cap,
    opexSpareParts:      (o.spareParts          || 500)    * cap,
    opexDnoCabin:        (o.dnoCabinFee         || 0)      * cap,
  };
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App({ session, project, onBack, embedded, fmVersion = 1 }) {
  const [inp, setInp] = useState(DEFAULT);
  const [activeTab, setActiveTab] = useState("returns");
  const [inputSection, setInputSection] = useState("project");
  const { assumptions } = useCentralAssumptions() || {};
  const [saveStatus, setSaveStatus] = useState("saved"); // "saving" | "saved" | "error"
  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);
  const lastLoggedSnapshot = useRef(null); // JSON string of last inputs we logged

  // Load saved inputs for the requested FM version
  useEffect(() => {
    if (!project) return;
    initialLoadDone.current = false;
    lastLoggedSnapshot.current = null;
    const loadInputs = async () => {
      // Try to load the requested version
      const { data: rows } = await supabase
        .from("project_inputs")
        .select("inputs")
        .eq("project_id", project.id)
        .eq("version", fmVersion)
        .limit(1);
      const data = rows?.[0] || null;

      if (data?.inputs) {
        // Existing FM version — load saved inputs
        setInp({ ...DEFAULT, ...data.inputs });
      } else if (fmVersion > 1) {
        // New FABO/FID version — pre-populate from previous version
        const prevVersion = fmVersion - 1;
        const { data: prevRows } = await supabase
          .from("project_inputs")
          .select("inputs")
          .eq("project_id", project.id)
          .eq("version", prevVersion)
          .limit(1);
        if (prevRows?.[0]?.inputs) {
          setInp({ ...DEFAULT, ...prevRows[0].inputs });
        } else {
          // No previous version either — seed from project metadata
          setInp(seedFromProject(project, assumptions));
        }
      } else {
        // Brand new NBO — seed from project metadata + Google Sheets benchmarks
        setInp(seedFromProject(project, assumptions));
      }
      initialLoadDone.current = true;
    };
    loadInputs();
  }, [project?.id, fmVersion]);

  // Auto-save inputs whenever they change (only after initial load)
  useEffect(() => {
    if (!project || !session) return;
    if (!initialLoadDone.current) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // Check if this FM version already exists (to preserve original creation date)
      const { data: existingRows } = await supabase
        .from("project_inputs")
        .select("id, fm_created_at")
        .eq("project_id", project.id)
        .eq("version", fmVersion)
        .limit(1);

      const isNew = !existingRows || existingRows.length === 0;
      const upsertPayload = {
        project_id: project.id,
        inputs: inp,
        created_by: session.user.id,
        version: fmVersion,
      };
      // Only set fm_created_at on first creation
      if (isNew) {
        upsertPayload.fm_created_at = new Date().toISOString();
      }

      const { data: inputData } = await supabase
        .from("project_inputs")
        .upsert(upsertPayload, { onConflict: "project_id,version", ignoreDuplicates: false })
        .select().single();

      // Only sync project metadata from the NBO FM (version 1) to avoid overwriting
      if (fmVersion === 1) {
        await supabase.from("projects").update({
          name: inp.projectName,
          capacity_mwp: inp.capacity,
          cod: inp.cod,
        }).eq("id", project.id);
      }

      // Save model run outputs
      if (inputData) {
        try {
          const res = runDCF(inp);
          if (res?.kpis) {
            const k = res.kpis;
            await supabase.from("model_runs").upsert({
              project_id: project.id,
              input_id: inputData.id,
              created_by: session.user.id,
              fm_version: fmVersion,
              project_irr: k.projectIRR,
              equity_irr: k.equityIRR,
              project_npv: k.projectNPV * 1000,
              equity_npv: k.equityNPV * 1000,
              min_dscr: k.minDSCR,
              avg_dscr: k.avgDSCR,
              total_capex: k.totalCapex * 1000,
              total_revenue: k.totalRevenue,
              cfd_rev: k.totalCfdRev,
              ppa_rev: k.totalPpaRev,
              merchant_rev: k.totalMerchRev,
              rego_rev: k.totalRegoRev,
              total_distributions: k.totalDistributions,
            }, { onConflict: "project_id,fm_version" });
          }
        } catch(e) { console.error("Model run save error:", e); }
      }
      // Log snapshot if inputs changed since last log entry
      try {
        const currentSnapshot = JSON.stringify(inp);
        if (currentSnapshot !== lastLoggedSnapshot.current) {
          await supabase.from("project_inputs_log").insert({
            project_id: project.id,
            fm_version: fmVersion,
            saved_by: session.user.id,
            inputs: inp,
          });
          lastLoggedSnapshot.current = currentSnapshot;
        }
      } catch(e) { console.error("Change log error:", e); }

      setSaveStatus("saved");
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [inp]);

  const set = useCallback((key, val) => setInp(prev => ({ ...prev, [key]: val })), []);
  const setCurve = useCallback((key, idx, val) => setInp(prev => {
    const arr = [...prev[key]]; arr[idx] = val; return { ...prev, [key]: arr };
  }), []);

  const effectiveInp = useMemo(() => {
    const base = assumptions ? {
      ...inp,
      // Override curves with live Google Sheets data
      _merchantHigh: assumptions.merchant?.high || null,
      _merchantCentral: assumptions.merchant?.central || null,
      _merchantLow: assumptions.merchant?.low || null,
      _regoAurora: assumptions.rego?.aurora || null,
      _regoPower: assumptions.rego?.power || null,
      _cpiCurve: assumptions.inflation?.cpi || null,
    } : { ...inp };
    // Always derive acquisition from bid rate × capacity
    if (base.bidPerMWp > 0) {
      base.acquisition = Math.round(base.bidPerMWp * base.capacity);
    }
    return base;
  }, [inp, assumptions]);

  const result = useMemo(() => { try { return runDCF(effectiveInp); } catch(e) { console.error("runDCF error:", e?.message, e?.stack?.split("\n")[1]); return null; } }, [effectiveInp]);
  const K = result?.kpis;
  const annual = result?.annualRows || [];
  const monthly = result?.periods || [];
  const inp_display = effectiveInp;
  const inputSections = ["project", "generation", "capex", "opex", "revenue", "debt", "tax"];
  const isCapex = inputSection === "capex";
  const isOpex  = inputSection === "opex";

  const { theme } = useTheme();

  return (
    <div style={{ display: "flex", height: embedded ? "100%" : "100vh", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary, overflow: "hidden", flex: embedded ? 1 : undefined }}>

      {/* LEFT NAV */}
      <div style={{ width: 48, background: theme.pageBg, borderRight: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 16, gap: 4, flexShrink: 0 }}>
        {/* Back to portfolio — hidden when embedded in ProjectView */}
        {!embedded && onBack && (
          <div onClick={onBack} title="Back to Portfolio" style={{ width: 34, height: 34, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: theme.textTertiary, marginBottom: 4 }}>←</div>
        )}
        {!embedded && <div style={{ marginBottom: 8 }}><FuseLogo size={32} /></div>}
        {inputSections.map(s => (
          <div key={s} onClick={() => setInputSection(s)} title={s} style={{
            width: 34, height: 34, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: inputSection === s ? theme.hoverBg : "transparent",
            border: inputSection === s ? `1px solid ${theme.textMuted}` : "1px solid transparent",
            fontSize: 10, fontWeight: 700, color: inputSection === s ? theme.success : theme.textTertiary,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>{s.slice(0, 3)}</div>
        ))}
        {/* Save status */}
        <div style={{ marginTop: "auto", marginBottom: 16, fontSize: 8, color: saveStatus === "saved" ? theme.success : saveStatus === "saving" ? theme.warning : theme.error, textTransform: "uppercase", letterSpacing: "0.05em", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving..." : "Error"}
        </div>
      </div>

      {/* CAPEX FULL PAGE */}
      {isCapex && <CapexPage inp={inp} set={set} assumptions={assumptions} />}

      {/* OPEX FULL PAGE */}
      {isOpex && <OpexPage inp={inp} set={set} assumptions={assumptions} />}

      {/* INPUT PANEL */}
      {!isCapex && !isOpex && (
        <div style={{ width: 320, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", flexShrink: 0, padding: "12px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, marginBottom: 12, paddingLeft: 4, fontFamily: "'Inter', system-ui, sans-serif", textTransform: "capitalize" }}>{inputSection}</div>

          {inputSection === "project" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Project Name</label>
                <input value={inp.projectName} onChange={e => set("projectName", e.target.value)}
                  style={{ width: "100%", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              </div>
              <Field label="Model Start Date" value={inp.modelStart} onChange={v => set("modelStart", v)} type="date" />
              <Field label="Financial Close" value={inp.financialClose} onChange={v => set("financialClose", v)} type="date" />
              <Field label="COD (Commercial Operation)" value={inp.cod} onChange={v => set("cod", v)} type="date" />
              <Field label="Construction Duration" value={inp.constructionMonths} onChange={v => set("constructionMonths", Math.max(1, Math.round(v)))} unit="months" step="1" min="1" />
              {(() => {
                const derived = addMonths(new Date(inp.cod && inp.cod.length === 7 ? inp.cod + "-01" : inp.cod), -inp.constructionMonths);
                const display = isNaN(derived.getTime()) ? "—" : derived.toISOString().slice(0, 7);
                return (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <label style={{ fontSize: 11, color: theme.textTertiary }}>Construction Start</label>
                      <span style={{ fontSize: 9, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Auto</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "7px 10px", opacity: 0.7 }}>
                      <span style={{ fontSize: 12, color: theme.textTertiary, fontFamily: "monospace" }}>{display}</span>
                      <span style={{ fontSize: 9, color: theme.textMuted }}>COD − {inp.constructionMonths}m</span>
                    </div>
                  </div>
                );
              })()}
              <Field label="Asset Life" value={inp.assetLife} onChange={v => set("assetLife", v)} unit="years" step="1" min="1" />
              <Field label="Discount Rate (NPV)" value={inp.discountRate} onChange={v => set("discountRate", v)} unit="%" step="0.1" />
              <Field label="CPI Inflation" value={inp.cpi} onChange={v => set("cpi", v)} unit="%" step="0.05" />

              {/* Bid / Acquisition */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${theme.borderSubtle}` }}>
                <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 10 }}>Acquisition Bid</div>
                <Field
                  label="Bid Rate"
                  value={inp.bidPerMWp / 1000}
                  onChange={v => {
                    const raw = Math.round(v * 1000);
                    set("bidPerMWp", raw);
                    set("acquisition", raw * inp.capacity);
                  }}
                  unit="£k/MWp"
                  step="1"
                  min="0"
                />
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <label style={{ fontSize: 11, color: theme.textTertiary }}>Total Consideration</label>
                    <span style={{ fontSize: 9, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Auto</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "7px 10px", opacity: 0.85 }}>
                    <span style={{ fontSize: 12, color: theme.textPrimary, fontWeight: 700, fontFamily: "monospace" }}>
                      {(() => {
                        const total = (inp.bidPerMWp / 1000) * inp.capacity;
                        if (total >= 1000) return `£${(total / 1000).toFixed(1)}m`;
                        if (total > 0) return `£${total.toFixed(0)}k`;
                        return "—";
                      })()}
                    </span>
                    <span style={{ fontSize: 9, color: theme.textMuted }}>{inp.bidPerMWp > 0 ? `£${(inp.bidPerMWp/1000).toFixed(0)}k × ${inp.capacity} MWp` : "Set bid rate above"}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {inputSection === "generation" && (
            <>
              <Field label="Installed Capacity" value={inp.capacity} onChange={v => set("capacity", v)} unit="MWp" step="0.01" />
              <Field label="Export Capacity" value={inp.exportCapacity} onChange={v => set("exportCapacity", v)} unit="MW" step="0.1" />
              <Field label="Specific Yield (P50)" value={inp.yield_} onChange={v => set("yield_", v)} unit="kWh/kWp" step="1" />
              <Field label="Availability" value={inp.availability} onChange={v => set("availability", v)} unit="%" step="0.1" />
              <Field label="Curtailment" value={inp.curtailment} onChange={v => set("curtailment", v)} unit="%" step="0.1" />
              <Field label="Annual Degradation" value={inp.degradation} onChange={v => set("degradation", v)} unit="% p.a." step="0.01" />
              {(() => {
                const gen = inp.capacity * inp.yield_ * (inp.availability / 100) * (1 - inp.curtailment / 100);
                return (
                  <div style={{ padding: "10px 12px", background: theme.pillBg, borderRadius: 8, border: `1px solid ${theme.textMuted}` }}>
                    <div style={{ fontSize: 10, color: theme.textTertiary, marginBottom: 4 }}>Calculated Annual Generation (Y1)</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: theme.success, fontFamily: "'Inter', system-ui, sans-serif" }}>{gen.toFixed(0)} MWh</div>
                  </div>
                );
              })()}
            </>
          )}



          {inputSection === "revenue" && (
            <>
              {/* Live allocation breakdown */}
              {(() => {
                const cfd   = inp.cfdActive  ? inp.cfdAllocPct : 0;
                const ppa   = inp.ppaActive  ? Math.min(inp.ppaAllocPct, Math.max(0, 100 - cfd)) : 0;
                const merch = Math.max(0, 100 - cfd - ppa);

                const fmtDate = (d) => { if (!d) return null; const dt = new Date(d); return `${dt.toLocaleString("default",{month:"short"})} ${dt.getFullYear()}`; };
                const addYrs = (d, y) => { if (!d) return null; const dt = new Date(d); dt.setFullYear(dt.getFullYear() + y); return fmtDate(dt); };

                const streams = [
                  {
                    label: "CfD", pct: cfd, color: "#4A8C5C", active: inp.cfdActive,
                    period: inp.cfdActive ? `${fmtDate(inp.cfdStart)} – ${addYrs(inp.cfdStart, inp.cfdTerm)} (${inp.cfdTerm}yr)` : null,
                  },
                  {
                    label: "PPA", pct: ppa, color: "#7A8A96", active: inp.ppaActive,
                    period: inp.ppaActive ? `${fmtDate(inp.ppaStart)} – ${addYrs(inp.ppaStart, inp.ppaTerm)} (${inp.ppaTerm}yr)` : null,
                  },
                  {
                    label: "Merchant", pct: merch, color: "#FFB162", active: inp.merchantActive,
                    period: "Residual – full asset life",
                  },
                ];

                return (
                  <div style={{ background: theme.pillBg, border: `1px solid ${theme.textMuted}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>Generation Allocation</div>
                    {/* Allocation bar */}
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                      {streams.filter(s => s.pct > 0).map(s => (
                        <div key={s.label} style={{ width: `${s.pct}%`, background: s.color, opacity: s.active ? 1 : 0.3 }} />
                      ))}
                    </div>
                    {/* Per-stream rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {streams.map(s => (
                        <div key={s.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", opacity: s.active ? 1 : 0.35 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label}</span>
                          </div>
                          <span style={{ fontSize: 10, color: theme.textTertiary, fontFamily: "monospace" }}>{s.period}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: s.active && s.pct > 0 ? s.color : theme.textMuted, fontFamily: "'Inter', system-ui, sans-serif", minWidth: 36, textAlign: "right" }}>{s.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* CfD */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.textMuted}` }}>CfD</div>
                <Toggle label="CfD Active" value={inp.cfdActive} onChange={v => set("cfdActive", v)} />
                {inp.cfdActive && <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 500, display: "block", marginBottom: 4 }}>Strike Price</label>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <input type="number" value={inp.cfdStrike} step="0.01" onChange={e => set("cfdStrike", parseFloat(e.target.value) || 0)} onFocus={e => e.target.select()} style={{ flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: "6px 0 0 6px", color: theme.textPrimary, padding: "7px 10px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" }} />
                        <span style={{ padding: "7px 8px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>£/MWh</span>
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 500, display: "block", marginBottom: 4 }}>Indexation Base Date</label>
                      <input type="month" value={(inp.cfdIndexBase || "2024-04-01").slice(0, 7)} onChange={e => set("cfdIndexBase", e.target.value + "-01")} style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <Field label="CfD Start Date" value={inp.cfdStart} onChange={v => set("cfdStart", v)} type="date" />
                  <Field label="CfD Term" value={inp.cfdTerm} onChange={v => set("cfdTerm", v)} unit="years" step="1" />
                  <Field label="Generation Allocated" value={inp.cfdAllocPct} onChange={v => set("cfdAllocPct", Math.min(100, Math.max(0, v)))} unit="%" step="1" />
                  <Field label="Negative Pricing Discount" value={inp.negativePricingDiscount} onChange={v => set("negativePricingDiscount", v)} unit="£/MWh" step="0.001" />
                </>}
              </div>
              {/* PPA */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.textMuted}` }}>PPA</div>
                <Toggle label="PPA Active" value={inp.ppaActive} onChange={v => set("ppaActive", v)} />
                {inp.ppaActive && <>
                  <Field label="PPA Price" value={inp.ppaPrice} onChange={v => set("ppaPrice", v)} unit="£/MWh" step="0.5" />
                  <Field label="PPA Start Date" value={inp.ppaStart} onChange={v => set("ppaStart", v)} type="date" />
                  <Field label="PPA Term" value={inp.ppaTerm} onChange={v => set("ppaTerm", v)} unit="years" step="1" />
                  <Field label="Generation Allocated" value={inp.ppaAllocPct} onChange={v => set("ppaAllocPct", Math.min(100, Math.max(0, v)))} unit="%" step="1" />
                  {inp.cfdActive && (
                    <div style={{ padding: "6px 10px", background: theme.pillBg, borderRadius: 6, border: `1px solid ${theme.textMuted}`, marginTop: 4 }}>
                      <div style={{ fontSize: 9, color: theme.textTertiary, marginBottom: 2 }}>Effective allocation when CfD overlaps</div>
                      <div style={{ fontSize: 10, color: theme.textSecondary }}>
                        CfD <span style={{ color: theme.success, fontWeight: 700 }}>{inp.cfdAllocPct}%</span>
                        {" · "}
                        PPA <span style={{ color: theme.textTertiary, fontWeight: 700 }}>{Math.min(inp.ppaAllocPct, Math.max(0, 100 - inp.cfdAllocPct))}%</span>
                        {" · "}
                        Merchant <span style={{ color: theme.warning, fontWeight: 700 }}>{Math.max(0, 100 - inp.cfdAllocPct - Math.min(inp.ppaAllocPct, Math.max(0, 100 - inp.cfdAllocPct)))}%</span>
                      </div>
                    </div>
                  )}
                </>}
              </div>
              {/* Merchant */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.textMuted}` }}>Merchant</div>
                {(() => {
                  const cfdPct = inp.cfdActive ? inp.cfdAllocPct : 0;
                  const ppaPct = inp.ppaActive ? Math.min(inp.ppaAllocPct, Math.max(0, 100 - cfdPct)) : 0;
                  const merchantPctInContract = Math.max(0, 100 - cfdPct - ppaPct);
                  const hasContracts = inp.cfdActive || inp.ppaActive;
                  return !hasContracts ? null : (
                    <div style={{ padding: "5px 10px", background: theme.pillBg, borderRadius: 6, border: `1px solid ${theme.border}`, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, color: theme.textSecondary }}>During contract: </span>
                      <span style={{ fontSize: 10, color: theme.warning, fontWeight: 700 }}>{merchantPctInContract}%</span>
                      {merchantPctInContract === 0 && (
                        <span style={{ fontSize: 9, color: theme.textTertiary, marginLeft: 6 }}>· 100% outside contract periods</span>
                      )}
                    </div>
                  );
                })()}
                <Toggle label="Merchant Active" value={inp.merchantActive} onChange={v => set("merchantActive", v)} />
                {inp.merchantActive && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: 11, color: theme.textSecondary, display: "block", marginBottom: 4 }}>Aurora Scenario</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["high", "central", "low"].map(s => (
                        <button key={s} onClick={() => set("merchantScenario", s)} style={{
                          flex: 1, padding: "6px 4px", fontSize: 10, fontWeight: 600, borderRadius: 6,
                          textTransform: "capitalize", cursor: "pointer",
                          background: inp.merchantScenario === s ? theme.accent : theme.pillBg,
                          color: inp.merchantScenario === s ? '#ffffff' : theme.textTertiary,
                          border: inp.merchantScenario === s ? `1px solid ${theme.accent}` : `1px solid ${theme.border}`,
                        }}>{s}</button>
                      ))}
                    </div>
                    {(() => {
                      const mc = (s, h) => !Array.isArray(s) || !s.length ? h : h.map((hv, i) => (i < s.length && s[i] !== 0) ? s[i] : hv);
                      const curves = { high: mc(inp._merchantHigh, MERCHANT_HIGH), central: mc(inp._merchantCentral, MERCHANT_CENTRAL), low: mc(inp._merchantLow, MERCHANT_LOW) };
                      const curve = curves[inp.merchantScenario] || curves.central;
                      const preview = curve.slice(0, 5).map((v, i) => `${2026+i}: £${v}`).join(" · ");
                      return <div style={{ fontSize: 9, color: theme.textTertiary, marginTop: 6, lineHeight: 1.6 }}>{preview}...</div>;
                    })()}
                  </div>
                )}
              </div>
              {/* REGO */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.textMuted}` }}>REGO</div>
                <Toggle label="REGO Active" value={inp.regoActive} onChange={v => set("regoActive", v)} />
                {inp.regoActive && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: 11, color: theme.textSecondary, display: "block", marginBottom: 4 }}>Scenario</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[{ key: "aurora", label: "Aurora" }, { key: "power", label: "Power" }].map(s => (
                        <button key={s.key} onClick={() => set("regoScenario", s.key)} style={{
                          flex: 1, padding: "6px 4px", fontSize: 10, fontWeight: 600, borderRadius: 6,
                          cursor: "pointer",
                          background: inp.regoScenario === s.key ? theme.accent : theme.pillBg,
                          color: inp.regoScenario === s.key ? '#ffffff' : theme.textTertiary,
                          border: inp.regoScenario === s.key ? `1px solid ${theme.success}` : `1px solid ${theme.border}`,
                        }}>{s.label}</button>
                      ))}
                    </div>
                    {(() => {
                      const mc = (s, h) => !Array.isArray(s) || !s.length ? h : h.map((hv, i) => (i < s.length && s[i] !== 0) ? s[i] : hv);
                      const curve = inp.regoScenario === "power" ? mc(inp._regoPower, REGO_POWER) : mc(inp._regoAurora, REGO_AURORA);
                      const preview = curve.slice(0, 5).map((v, i) => `${2026+i}: £${v}`).join(" · ");
                      return <div style={{ fontSize: 9, color: theme.textTertiary, marginTop: 6, lineHeight: 1.6 }}>{preview}...</div>;
                    })()}
                  </div>
                )}
              </div>
            </>
          )}

          {inputSection === "debt" && (
            <>
              <Toggle label="Senior Debt Active" value={inp.debtActive} onChange={v => set("debtActive", v)} />
              {inp.debtActive && <>
                <Field label="Gearing" value={inp.gearing} onChange={v => set("gearing", v)} unit="% of CapEx" step="1" />
                <Field label="Construction Interest Rate" value={inp.interestCon} onChange={v => set("interestCon", v)} unit="%" step="0.05" />
                <Field label="Operations Interest Rate" value={inp.interestOps} onChange={v => set("interestOps", v)} unit="%" step="0.05" />
                <Field label="Debt Tenor" value={inp.debtTenor} onChange={v => set("debtTenor", v)} unit="years" step="1" />
                <Field label="Arrangement Fee" value={inp.arrangementFee} onChange={v => set("arrangementFee", v)} unit="% of facility" step="0.1" />
                <Toggle label="DSRA Active" value={inp.dsraActive} onChange={v => set("dsraActive", v)} />
                {inp.dsraActive && <Field label="DSRA Reserve (months)" value={inp.dsraMonths} onChange={v => set("dsraMonths", v)} unit="months" step="1" />}
                <Field label="Minimum Cash Balance" value={inp.minCash} onChange={v => set("minCash", v)} unit="£" step="1000" />
                {K && (
                  <div style={{ padding: "10px 12px", background: theme.pillBg, borderRadius: 8, border: `1px solid ${theme.textMuted}`, marginTop: 8 }}>
                    <div style={{ fontSize: 10, color: theme.textTertiary, marginBottom: 6 }}>Debt Structure</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <div><div style={{ fontSize: 9, color: theme.textTertiary }}>Debt</div><div style={{ fontSize: 14, fontWeight: 700, color: theme.success, fontFamily: "monospace" }}>{fmtM(K.debtAmount * 1000)}</div></div>
                      <div><div style={{ fontSize: 9, color: theme.textTertiary }}>Equity</div><div style={{ fontSize: 14, fontWeight: 700, color: theme.warning, fontFamily: "monospace" }}>{fmtM(K.equityInvestment * 1000)}</div></div>
                      {K.minDSCR && <div><div style={{ fontSize: 9, color: theme.textTertiary }}>Min DSCR</div><div style={{ fontSize: 14, fontWeight: 700, color: K.minDSCR >= 1.15 ? theme.success : theme.error, fontFamily: "monospace" }}>{K.minDSCR.toFixed(2)}x</div></div>}
                      {K.avgDSCR && <div><div style={{ fontSize: 9, color: theme.textTertiary }}>Avg DSCR</div><div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, fontFamily: "monospace" }}>{K.avgDSCR.toFixed(2)}x</div></div>}
                    </div>
                  </div>
                )}
              </>}
            </>
          )}

          {inputSection === "tax" && (
            <>
              <Field label="Corporation Tax Rate" value={inp.corpTax} onChange={v => set("corpTax", v)} unit="%" step="1" />
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary, marginBottom: 8, marginTop: 12 }}>Capital Allowances</div>
              <Field label="General Pool" value={inp.capAllowGPRate} onChange={v => set("capAllowGPRate", v)} unit="%" step="1" hint={`${inp.capAllowGPPct}% of CapEx · declining`} />
              <Field label="Special Rate Pool" value={inp.capAllowSRPRate} onChange={v => set("capAllowSRPRate", v)} unit="%" step="1" hint={`${inp.capAllowSRPPct}% of CapEx · declining`} />
              <Field label="SBA" value={inp.capAllowSBARate} onChange={v => set("capAllowSBARate", v)} unit="%" step="0.5" hint={`${inp.capAllowSBAPct}% of CapEx · straight-line`} />
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary, marginBottom: 8, marginTop: 12 }}>Pool Allocation (% of CapEx)</div>
              <Field label="General Pool" value={inp.capAllowGPPct} onChange={v => set("capAllowGPPct", v)} unit="%" step="1" min="0" />
              <Field label="Special Rate Pool" value={inp.capAllowSRPPct} onChange={v => set("capAllowSRPPct", v)} unit="%" step="1" min="0" />
              <Field label="SBA" value={inp.capAllowSBAPct} onChange={v => set("capAllowSBAPct", v)} unit="%" step="1" min="0" />
              {K && <div style={{ fontSize: 9, color: theme.textMuted, marginBottom: 6 }}>
                Total: {(inp.capAllowGPPct + inp.capAllowSRPPct + inp.capAllowSBAPct).toFixed(0)}% of CapEx · GP: £{(K.totalCapex * inp.capAllowGPPct / 100).toFixed(0)}k · SRP: £{(K.totalCapex * inp.capAllowSRPPct / 100).toFixed(0)}k · SBA: £{(K.totalCapex * inp.capAllowSBAPct / 100).toFixed(0)}k
              </div>}
            </>
          )}
        </div>
      )}

      {/* RESULTS PANEL */}
      {!isCapex && !isOpex && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
            <div>
              <span style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary, fontFamily: "'Inter', system-ui, sans-serif" }}>{inp.projectName || "Untitled Project"}</span>
              <span style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 12 }}>{inp.capacity} MWp · COD {inp.cod}</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {["returns", "model", "summary"].map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={{
                  padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 8, textTransform: "capitalize",
                  background: activeTab === t ? theme.hoverBg : "transparent",
                  color: activeTab === t ? theme.success : theme.textSecondary,
                  border: activeTab === t ? `1px solid ${theme.textMuted}` : "1px solid transparent",
                  cursor: "pointer",
                }}>{t}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {!result && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: theme.textMuted }}>
                Adjust inputs to compute model…
              </div>
            )}

            {result && activeTab === "returns" && K && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                  <KPI label="Project IRR" value={fmtPct(K.projectIRR)} sub="Unlevered" color={theme.success} size={24} />
                  <KPI label="Equity IRR" value={fmtPct(K.equityIRR)} sub="Levered" color={theme.success} size={24} />
                  <KPI label="Project NPV" value={fmtM(K.projectNPV * 1000)} sub={`@ ${inp.discountRate}% discount`} />
                  <KPI label="Equity NPV" value={fmtM(K.equityNPV * 1000)} sub={`@ ${inp.discountRate}% discount`} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                  <KPI label="Total CapEx" value={fmtM(K.totalCapex * 1000)} sub={`£${inp.capacity > 0 ? (K.totalCapex / inp.capacity).toFixed(0) : "—"}k/MWp`} />
                  <KPI label="Gearing" value={fmtPct(K.gearing, 1)} sub={`Debt ${fmtM(K.debtAmount * 1000)}`} />
                  {K.minDSCR != null ? <KPI label="Min DSCR" value={`${fmt(K.minDSCR, 2)}x`} color={K.minDSCR >= 1.15 ? theme.success : theme.error} sub="Operations period" /> : <KPI label="Min DSCR" value="—" />}
                  <KPI label="Distributions" value={fmtM(K.totalDistributions * 1000)} sub="Lifetime total" color={theme.warning} />
                </div>
                <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 12 }}>Lifetime P&L</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                    {[
                      { l: "Revenue", v: K.totalRevenue, c: theme.success },
                      { l: "Opex", v: -K.totalOpex, c: theme.error },
                      { l: "EBITDA", v: K.totalEBITDA, c: theme.success },
                      { l: "Debt Service", v: -K.totalDebtService, c: theme.warning },
                      { l: "Tax", v: -K.totalTax, c: theme.textTertiary },
                    ].map(({ l, v, c }) => (
                      <div key={l}>
                        <div style={{ fontSize: 10, color: theme.textSecondary, marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: c, fontFamily: "'Inter', system-ui, sans-serif" }}>
                          {v < 0 ? "(" : ""}{fmtM(Math.abs(v) * 1000)}{v < 0 ? ")" : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20 }}>
                    <StackedRevenueChart rows={annual} />
                  </div>
                  <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20 }}>
                    <BarChart rows={annual} yKey="equityFCF" label="Equity Cash Flow (£)" />
                  </div>
                </div>
              </div>
            )}

            {result && activeTab === "model" && (() => {
              const LABEL_W = 220;
              const COL_W = 72;
              const ROW_H = 28;
              const HEADER_H = 52;

              // Format £'000s with parens for negatives
              const fk = (v) => {
                const k = v / 1000;
                if (Math.abs(k) < 0.05) return "—";
                return k < 0 ? `(${Math.abs(k).toFixed(0)})` : k.toFixed(0);
              };
              const fmwh = (v) => Math.abs(v) < 0.05 ? "—" : v.toFixed(0);

              // Row definitions: label, getValue(period), style variant
              // variant: 'normal' | 'subtotal' | 'total' | 'section' | 'spacer'
              const rows = [
                { label: "GENERATION", variant: "section" },
                { label: "Generation (MWh)", key: "gen", fmt: fmwh, get: p => p.genMWh },

                { label: "REVENUE", variant: "section" },
                { label: "CfD Revenue", key: "cfd", fmt: fk, get: p => p.cfdRev },
                { label: "PPA Revenue", key: "ppa", fmt: fk, get: p => p.ppaRev },
                { label: "Merchant Revenue", key: "merch", fmt: fk, get: p => p.merchantRev },
                { label: "REGO Revenue", key: "rego", fmt: fk, get: p => p.regoRev },
                { label: "Total Revenue", key: "rev", fmt: fk, get: p => p.revenue, variant: "subtotal" },

                { label: "COSTS", variant: "section" },
                { label: "Land Rent", key: "opRent", fmt: fk, get: p => -p.opexRent },
                { label: "Maintenance (O&M)", key: "opMaint", fmt: fk, get: p => -p.opexMaintenance },
                { label: "Insurance", key: "opIns", fmt: fk, get: p => -p.opexInsurance },
                { label: "Asset Management", key: "opAM", fmt: fk, get: p => -p.opexAssetMgmt },
                { label: "Business Rates", key: "opBR", fmt: fk, get: p => -p.opexBusinessRates },
                { label: "TA Monitoring", key: "opTA", fmt: fk, get: p => -p.opexTaMonitoring },
                { label: "Spare Parts", key: "opSP", fmt: fk, get: p => -p.opexSpareParts },
                { label: "DNO Cabin Fee", key: "opDNO", fmt: fk, get: p => -p.opexDnoCabin },
                ...(inp.opexSpare1 + inp.opexSpare2 + inp.opexSpare3 > 0 ? [{ label: "Other Costs", key: "opOther", fmt: fk, get: p => -p.opexSpares }] : []),
                { label: "Total Operating Costs", key: "opex", fmt: fk, get: p => -p.opex, variant: "subtotal" },
                { label: "EBITDA", key: "ebitda", fmt: fk, get: p => p.ebitda, variant: "subtotal" },

                { label: "CAPITAL", variant: "section" },
                { label: "Capital Expenditure", key: "capex", fmt: fk, get: p => -p.capex },
                { label: `General Pool (${inp.capAllowGPPct}% @ ${inp.capAllowGPRate}%)`, key: "gpAllow", fmt: fk, get: p => -p.gpAllowance },
                { label: `Special Rate Pool (${inp.capAllowSRPPct}% @ ${inp.capAllowSRPRate}%)`, key: "srpAllow", fmt: fk, get: p => -p.srpAllowance },
                ...(inp.capAllowSBAPct > 0 ? [{ label: `SBA (${inp.capAllowSBAPct}% @ ${inp.capAllowSBARate}%)`, key: "sbaAllow", fmt: fk, get: p => -p.sbaAllowance }] : []),
                { label: "Total Capital Allowances", key: "ca", fmt: fk, get: p => -p.capitalAllowance, variant: "subtotal" },
                { label: "Taxable Profit", key: "ebitda_adj", fmt: fk, get: p => p.ebitda - p.capitalAllowance, variant: "subtotal" },

                { label: "TAX", variant: "section" },
                { label: "Corporation Tax", key: "tax", fmt: fk, get: p => -p.unleveredTax },

                { label: "UNLEVERED FCF", key: "ufcf", fmt: fk, get: p => p.unleveredFCF, variant: "total" },

                { label: "DEBT", variant: "section" },
                { label: "Interest", key: "int", fmt: fk, get: p => -p.interest },
                { label: "Principal Repayment", key: "princ", fmt: fk, get: p => -p.principal },
                { label: "Total Debt Service", key: "ds", fmt: fk, get: p => -(p.interest + p.principal), variant: "subtotal" },
                { label: "DSRA Movement", key: "dsra", fmt: fk, get: p => -p.dsraMovement },

                { label: "FCFE (Equity Cash Flow)", key: "fcfe", fmt: fk, get: p => p.equityFCF, variant: "total" },
              ];

              const STYLE = {
                section:  { background: theme.textPrimary, color: theme.pageBg, fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.09em", paddingLeft: 12 },
                subtotal: { background: theme.pillBg, color: theme.textPrimary, fontWeight: 700, borderTop: `1px solid ${theme.textMuted}`, paddingLeft: 16 },
                total:    { background: theme.textPrimary, color: theme.warning, fontWeight: 800, fontSize: 12, paddingLeft: 12 },
                normal:   { background: "transparent", color: theme.textSecondary, fontWeight: 400, paddingLeft: 20 },
              };

              // Month labels: "Jan 26", "Feb 26" etc
              const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
              const getLabel = (p) => `${monthNames[p.month]}\u00a0${String(p.year).slice(2)}`;

              return (
                <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
                  {/* Units note */}
                  <div style={{ padding: "8px 16px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary }}>Monthly Financial Model</div>
                    <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Revenue & costs in £&apos;000s · Generation in MWh</div>
                  </div>
                  {/* Scrollable table */}
                  <div style={{ display: "flex", overflow: "hidden" }}>
                    {/* Frozen label column */}
                    <div style={{ flexShrink: 0, width: LABEL_W, borderRight: `2px solid ${theme.textMuted}`, zIndex: 2 }}>
                      {/* Header cell */}
                      <div style={{ height: HEADER_H, background: theme.pillBg, borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "flex-end", padding: "0 12px 8px", fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                        Line Item
                      </div>
                      {rows.map((row, ri) => {
                        const s = STYLE[row.variant || "normal"];
                        return (
                          <div key={ri} style={{ height: ROW_H, display: "flex", alignItems: "center", borderBottom: `1px solid ${theme.borderSubtle}`, fontSize: row.variant === "section" ? 9 : row.variant === "total" ? 12 : 11, paddingLeft: s.paddingLeft, background: s.background, color: s.color, fontWeight: s.fontWeight, textTransform: s.textTransform, letterSpacing: s.letterSpacing }}>
                            {row.label}
                          </div>
                        );
                      })}
                    </div>

                    {/* Scrollable data columns */}
                    <div style={{ flex: 1, overflowX: "auto" }}>
                      <div style={{ display: "flex", minWidth: monthly.length * COL_W }}>
                        {monthly.map((p, ci) => {
                          const label = getLabel(p);
                          const isFirstOfYear = p.month === 0;
                          const isCODMonth = !p.isOps && monthly[ci + 1]?.isOps;
                          const colBg = !p.isOps ? theme.surfaceBg : "transparent";
                          return (
                            <div key={ci} style={{ flexShrink: 0, width: COL_W, borderRight: isFirstOfYear ? `1px solid ${theme.textMuted}` : `1px solid ${theme.pageBg}` }}>
                              {/* Month header */}
                              <div style={{ height: HEADER_H, background: p.isOps ? theme.pillBg : theme.hoverBg, borderBottom: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", padding: "0 0 6px" }}>
                                {isFirstOfYear && <div style={{ fontSize: 8, color: theme.textTertiary, fontWeight: 700, marginBottom: 2 }}>{p.year}</div>}
                                <div style={{ fontSize: 9, color: p.isOps ? theme.textPrimary : theme.textTertiary, fontWeight: p.isOps ? 600 : 400 }}>{monthNames[p.month]}</div>
                                {isCODMonth && <div style={{ fontSize: 7, color: theme.accent, fontWeight: 700, textTransform: "uppercase" }}>COD→</div>}
                              </div>
                              {/* Data cells */}
                              {rows.map((row, ri) => {
                                if (row.variant === "section") {
                                  return <div key={ri} style={{ height: ROW_H, background: theme.textPrimary, borderBottom: `1px solid ${theme.textMuted}` }} />;
                                }
                                const raw = row.get(p);
                                const formatted = (row.fmt || fk)(raw);
                                const s = STYLE[row.variant || "normal"];
                                const isNeg = typeof raw === "number" && raw < -0.05;
                                const isPos = typeof raw === "number" && raw > 0.05;
                                const numColor = row.variant === "total" ? theme.warning
                                  : row.variant === "subtotal" ? (isNeg ? theme.error : isPos ? theme.textPrimary : theme.textTertiary)
                                  : isNeg ? theme.error : isPos ? theme.success : theme.textMuted;
                                return (
                                  <div key={ri} style={{ height: ROW_H, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8, borderBottom: `1px solid ${theme.borderSubtle}`, background: row.variant === "total" ? theme.textPrimary : row.variant === "subtotal" ? theme.pillBg : (ci % 2 === 0 ? colBg : row.variant === "section" ? theme.textPrimary : theme.surfaceBg), fontSize: 10, fontFamily: "monospace", color: numColor, fontWeight: row.variant === "total" ? 700 : 400 }}>
                                    {formatted}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {result && activeTab === "summary" && K && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { title: "Project", color: theme.accent, items: [["Name", inp.projectName], ["Technology", "Solar PV"], ["Capacity", `${inp.capacity} MWp`], ["Export Capacity", `${inp.exportCapacity} MW`], ["COD", inp.cod], ["Asset Life", `${inp.assetLife} years`]] },
                  { title: "Returns", color: theme.success, items: [["Project IRR", fmtPct(K.projectIRR)], ["Equity IRR", fmtPct(K.equityIRR)], ["Project NPV", fmtM(K.projectNPV * 1000)], ["Equity NPV", fmtM(K.equityNPV * 1000)], ["Min DSCR", K.minDSCR ? `${K.minDSCR.toFixed(2)}x` : "—"], ["Avg DSCR", K.avgDSCR ? `${K.avgDSCR.toFixed(2)}x` : "—"]] },
                  { title: "Capital Structure", color: theme.warning, items: [["Total CapEx", fmtM(K.totalCapex * 1000)], ["Senior Debt", fmtM(K.debtAmount * 1000)], ["Equity", fmtM(K.equityInvestment * 1000)], ["Gearing", fmtPct(K.gearing, 1)], ["Ops Interest Rate", fmtPct(inp.interestOps)], ["Debt Tenor", `${inp.debtTenor} years`], ["DSRA (Initial)", K.dsraInitial > 0 ? fmtM(K.dsraInitial * 1000) : "—"]] },
                  { title: "Tax & Capital Allowances", color: theme.error, items: [["Corp Tax Rate", fmtPct(inp.corpTax, 0)], ["General Pool", `${inp.capAllowGPPct}% @ ${inp.capAllowGPRate}% WDA`], ["Special Rate Pool", `${inp.capAllowSRPPct}% @ ${inp.capAllowSRPRate}% WDA`], ["SBA", `${inp.capAllowSBAPct}% @ ${inp.capAllowSBARate}% SL`], ["Total Tax Paid", fmtM(K.totalTax * 1000)]] },
                  { title: "Lifetime Financials", color: theme.textTertiary, items: [["Total Revenue", fmtM(K.totalRevenue * 1000)], ["Total Opex", fmtM(K.totalOpex * 1000)], ["Total EBITDA", fmtM(K.totalEBITDA * 1000)], ["Total Debt Service", fmtM(K.totalDebtService * 1000)], ["Total Tax", fmtM(K.totalTax * 1000)], ["Total Distributions", fmtM(K.totalDistributions * 1000)]] },
                ].map(({ title, color, items }) => (
                  <div key={title} style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "10px 16px", borderBottom: `1px solid ${theme.border}`, borderLeft: `3px solid ${color}`, fontSize: 11, fontWeight: 700, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</div>
                    <div style={{ padding: "8px 0" }}>
                      {items.map(([label, val]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 16px", borderBottom: `1px solid ${theme.borderSubtle}` }}>
                          <span style={{ fontSize: 12, color: theme.textTertiary }}>{label}</span>
                          <span style={{ fontSize: 12, color: theme.textPrimary, fontFamily: "monospace", fontWeight: 600 }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
