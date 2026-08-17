// ─────────────────────────────────────────────────────────────────────────────
// PVSizing.jsx
// Full-page PV sizing analysis tool.
// Upload HH data → fetch PVGIS yield → calculate optimal MWp → save to lead.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { supabase } from "./supabase.js";
import * as XLSX from "xlsx";

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const AVAILABILITY = 0.99;
const DEGRADATION  = 0.004;

// ─── HH DATA PARSER ───────────────────────────────────────────────────────────
function parseHHData(workbook) {
  const ws   = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const header       = rows[0] || [];
  const hasSupplyCol = typeof header[0] === "string" && header[0].toLowerCase().includes("supply");
  const dateCol      = hasSupplyCol ? 1 : 0;
  const hhStartCol   = hasSupplyCol ? 2 : 1;

  const excelToDate = (s) =>
    s && typeof s === "number" && s > 40000
      ? new Date((s - 25569) * 86400 * 1000)
      : null;

  const dataRows = rows.slice(1).filter(r => excelToDate(r[dateCol]) !== null);

  // Unique MPANs
  const mpans = [...new Set(dataRows.map(r => r[0]).filter(Boolean).map(String))];

  // Parse each row
  const parsed = dataRows.map(r => {
    const date = excelToDate(r[dateCol]);
    const hh   = Array.from({ length: 48 }, (_, i) => Number(r[hhStartCol + i] || 0));
    return { date, month: date.getMonth(), year: date.getFullYear(), hh, daily: hh.reduce((s,v) => s+v, 0), mpan: String(r[0] || "") };
  });

  // Detect dominant year
  const yearMap = {};
  parsed.forEach(r => { yearMap[r.year] = (yearMap[r.year] || 0) + 1; });
  const year = Number(Object.entries(yearMap).sort((a,b) => b[1]-a[1])[0][0]);

  // Monthly aggregation
  const monthlyKWh  = Array(12).fill(0);
  const monthlyHH   = Array.from({ length: 12 }, () => Array(48).fill(0));
  const monthlyDays = Array(12).fill(0);

  parsed.forEach(r => {
    monthlyKWh[r.month]  += r.daily;
    r.hh.forEach((v, i) => { monthlyHH[r.month][i] += v; });
    monthlyDays[r.month] += 1;
  });

  const monthlyDemandMWh      = monthlyKWh.map(v => v / 1000);
  const annualDemandMWh       = monthlyDemandMWh.reduce((s,v) => s+v, 0);
  const monthlyAvgDailyProfile = monthlyHH.map((slots, m) =>
    slots.map(v => monthlyDays[m] > 0 ? v / monthlyDays[m] : 0)
  );

  // Annual average daily profile
  const annualAvgDailyProfile = Array.from({ length: 48 }, (_, i) =>
    parsed.reduce((s,r) => s + r.hh[i], 0) / parsed.length
  );

  // Peak demand kW (max HH reading × 2 to convert kWh/30min → kW)
  let peakDemandKW = 0;
  parsed.forEach(r => r.hh.forEach(v => { if (v * 2 > peakDemandKW) peakDemandKW = v * 2; }));

  const loadFactor = annualDemandMWh * 1000 / (peakDemandKW * 8760);

  return {
    annualDemandMWh: Math.round(annualDemandMWh * 10) / 10,
    monthlyDemandMWh,
    monthlyAvgDailyProfile,
    annualAvgDailyProfile,
    peakDemandKW: Math.round(peakDemandKW),
    loadFactor: Math.round(loadFactor * 1000) / 1000,
    mpans,
    year,
    totalDays: parsed.length,
  };
}

// ─── GEOCODING ────────────────────────────────────────────────────────────────
async function geocodePostcode(postcode) {
  const clean = postcode.replace(/\s+/g, "").toUpperCase();
  let res;
  try {
    res = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
  } catch {
    throw new Error("Could not reach postcodes.io — check your internet connection");
  }
  if (!res.ok) throw new Error(`Postcode "${clean}" not found — check spelling and try again`);
  const json = await res.json();
  return { lat: json.result.latitude, lon: json.result.longitude };
}

// ─── PVGIS API (via server-side proxy to avoid CORS) ─────────────────────────
async function fetchPVGIS(lat, lon) {
  let res;
  try {
    res = await fetch(`/api/pvgis?lat=${lat}&lon=${lon}`);
  } catch {
    throw new Error("Could not reach the PVGIS proxy — check your connection");
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `PVGIS error (${res.status})`);
  const monthly          = json.outputs.monthly.fixed;
  const annualYield      = json.outputs.totals.fixed.E_y;
  const monthlyKwhPerKwp = monthly.map(m => Number(m.E_m));
  return { annualYield, monthlyKwhPerKwp, lat, lon };
}

// ─── SOLAR DAYLIGHT PROFILE ───────────────────────────────────────────────────
// Approximate UK sunrise/sunset by month for ~51-52°N (local clock time incl. BST).
// [sunrise_decimal_hour, sunset_decimal_hour]
const UK_DAYLIGHT = [
  [8.0,  16.0],  // Jan
  [7.3,  17.0],  // Feb
  [6.3,  18.2],  // Mar
  [6.5,  20.0],  // Apr  (BST)
  [5.5,  21.0],  // May  (BST)
  [4.8,  21.3],  // Jun  (BST)
  [5.0,  21.2],  // Jul  (BST)
  [5.8,  20.3],  // Aug  (BST)
  [6.8,  19.2],  // Sep  (BST)
  [7.8,  18.0],  // Oct
  [7.5,  16.2],  // Nov
  [8.0,  15.9],  // Dec
];

// Returns a 48-element array of fractions (summing to 1.0) that describe how
// generation is distributed across half-hour slots for a given month.
// Uses a sinusoidal shape between sunrise and sunset.
function buildSolarHHFractions(monthIdx) {
  const [sunrise, sunset] = UK_DAYLIGHT[monthIdx];
  const daylight = sunset - sunrise;
  const raw = Array(48).fill(0);
  let total = 0;
  for (let slot = 0; slot < 48; slot++) {
    const midHour = slot * 0.5 + 0.25;
    if (midHour > sunrise && midHour < sunset) {
      raw[slot] = Math.sin(Math.PI * (midHour - sunrise) / daylight);
      total += raw[slot];
    }
  }
  return total > 0 ? raw.map(v => v / total) : raw;
}

// Pre-compute all 12 monthly solar HH fraction arrays (pure, no deps — compute once).
const SOLAR_HH_FRACTIONS = MONTHS_SHORT.map((_, m) => buildSolarHHFractions(m));

// ─── SIZING CALCULATIONS ──────────────────────────────────────────────────────
// demandProfiles: float[12][48] — avg kWh per HH slot per day for each month
//   (from actual HH data; falls back to flat distribution if not available)
// pvgisMonthly:  float[12] — kWh/kWp/month from PVGIS
//
// All self-consumption calculated at half-hourly resolution to correctly
// account for the day/night mismatch between solar generation and demand.

function buildDemandProfiles(monthlyDemandMWh, monthlyAvgDailyProfile) {
  return MONTHS_SHORT.map((_, m) => {
    if (monthlyAvgDailyProfile?.[m]?.length === 48) return monthlyAvgDailyProfile[m];
    // Fallback: uniform distribution across all slots
    const dailyKWh = monthlyDemandMWh[m] * 1000 / DAYS_IN_MONTH[m];
    return Array(48).fill(dailyKWh / 48);
  });
}

function calcResults(demandProfiles, pvgisMonthly, mwp, hasExport, exportLimitMW) {
  const monthly = MONTHS_SHORT.map((_, m) => {
    const days        = DAYS_IN_MONTH[m];
    const solarFrac   = SOLAR_HH_FRACTIONS[m];          // fraction of monthly gen per slot
    const monthlyGenMWh = mwp * pvgisMonthly[m] * AVAILABILITY; // total gen this month (MWh)

    let selfConsumed = 0, exported = 0, gridImport = 0;

    for (let slot = 0; slot < 48; slot++) {
      // Solar energy at this slot for the whole month (MWh)
      const solarSlotMWh  = monthlyGenMWh * solarFrac[slot];
      // Demand at this slot for the whole month (MWh)
      // demandProfiles[m][slot] = avg kWh/day at this slot → × days / 1000 = MWh
      const demandSlotMWh = demandProfiles[m][slot] * days / 1000;

      const sc      = Math.min(solarSlotMWh, demandSlotMWh);
      const surplus = Math.max(0, solarSlotMWh - demandSlotMWh);
      // Export cap per slot: limit_MW × 0.5 hr × days (max MWh exportable at this slot over month)
      const expCap  = hasExport ? exportLimitMW * 0.5 * days : 0;
      const exp     = hasExport ? Math.min(surplus, expCap) : 0;

      selfConsumed += sc;
      exported     += exp;
      gridImport   += Math.max(0, demandSlotMWh - sc);
    }

    const gen      = monthlyGenMWh;
    const demand   = demandProfiles[m].reduce((s, v) => s + v, 0) * days / 1000;
    const curtailed = Math.max(0, gen - selfConsumed - exported);
    const surplus  = Math.max(0, gen - selfConsumed);
    return { gen, demand, selfConsumed, exported, gridImport, surplus, curtailed };
  });

  const totalGen      = monthly.reduce((s,r) => s + r.gen, 0);
  const totalConsumed = monthly.reduce((s,r) => s + r.selfConsumed, 0);
  const totalExported = monthly.reduce((s,r) => s + r.exported, 0);
  const totalImport   = monthly.reduce((s,r) => s + r.gridImport, 0);
  const totalDemand   = monthly.reduce((s,r) => s + r.demand, 0);
  const scRatio       = totalGen    > 0 ? totalConsumed / totalGen    : 0;
  const coverage      = totalDemand > 0 ? totalConsumed / totalDemand : 0;
  const usefulRatio   = totalGen    > 0 ? (totalConsumed + totalExported) / totalGen : 0;

  return { monthly, totalGen, totalConsumed, totalExported, totalImport, totalDemand, scRatio, coverage, usefulRatio };
}

function calcOptimalMWp(demandProfiles, pvgisMonthly, hasExport, exportLimitMW) {
  // adjYield: effective annual yield in kWh/kWp after availability (= MWh/MWp)
  const adjYield = pvgisMonthly.reduce((s, v) => s + v, 0) * AVAILABILITY;

  // totalDemandMWh: sum across all months and HH slots
  const totalDemandMWh = MONTHS_SHORT.reduce((s, _, m) =>
    s + demandProfiles[m].reduce((ds, v) => ds + v, 0) * DAYS_IN_MONTH[m] / 1000, 0);

  if (hasExport && exportLimitMW > 0 && adjYield > 0) {
    // Formula-based: size to meet all demand AND fill the export pipe.
    // At the optimal size, generation = demand + max annual export.
    // maxExportMWh = exportLimitMW × adjYield  (MW × effective-sun-hours = MWh)
    const maxExportMWh = exportLimitMW * adjYield;
    const targetGenMWh = totalDemandMWh + maxExportMWh;
    // recommended = targetGenMWh / adjYield, rounded to nearest 0.5 MWp
    return Math.max(0.5, Math.round((targetGenMWh / adjYield) * 2) / 2);
  }

  // No-export case: iterate until self-consumption ratio drops below 85%
  let optimal = 0.5;
  for (let mwp = 0.5; mwp <= 50; mwp = Math.round((mwp + 0.5) * 10) / 10) {
    const r = calcResults(demandProfiles, pvgisMonthly, mwp, false, 0);
    if (r.scRatio >= 0.85) { optimal = mwp; } else { break; }
  }
  return optimal;
}

function buildSensitivityData(demandProfiles, pvgisMonthly, hasExport, exportLimitMW, recommendedMWp) {
  const cap = Math.max((recommendedMWp || 5) + 3, 3);
  const out = [];
  for (let mwp = 0.5; mwp <= cap; mwp = Math.round((mwp + 0.5) * 10) / 10) {
    const r = calcResults(demandProfiles, pvgisMonthly, mwp, hasExport, exportLimitMW);
    out.push({ mwp, scRatio: r.scRatio, coverage: r.coverage, usefulRatio: r.usefulRatio });
  }
  return out;
}

// ─── SVG CHARTS ──────────────────────────────────────────────────────────────
function BarChart({ data, labels, color, unit = "", height = 130 }) {
  const W = 520, H = height;
  const padL = 48, padR = 10, padT = 12, padB = 22;
  const cW = W - padL - padR, cH = H - padT - padB;
  const max = Math.max(...data, 0.001);
  const n   = data.length;
  const bW  = (cW / n) * 0.65;

  const yTicks = [0, 0.5, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
      {yTicks.map(f => {
        const y = padT + cH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#3a3a3a" strokeWidth={0.5} strokeDasharray="3,2" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9} fill="#888">
              {Math.round(max * f)}{unit}
            </text>
          </g>
        );
      })}
      {data.map((v, i) => {
        const bH  = cH * (v / max);
        const x   = padL + i * (cW / n) + (cW / n - bW) / 2;
        const y   = padT + cH - bH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bW} height={bH} fill={color} rx={2} opacity={0.88} />
            <text x={x + bW / 2} y={H - 5} textAnchor="middle" fontSize={9} fill="#888">{labels[i]}</text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + cH} x2={W - padR} y2={padT + cH} stroke="#555" strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + cH} stroke="#555" strokeWidth={1} />
    </svg>
  );
}

function DailyProfileChart({ data48, color, height = 110 }) {
  const W = 520, H = height;
  const padL = 48, padR = 10, padT = 12, padB = 22;
  const cW = W - padL - padR, cH = H - padT - padB;
  const max = Math.max(...data48, 0.001);
  const pts = data48.map((v, i) => {
    const x = padL + (i / 47) * cW;
    const y = padT + cH * (1 - v / max);
    return [x, y];
  });
  const linePts  = pts.map(([x,y]) => `${x},${y}`).join(" ");
  const areaPath = `M ${linePts} L ${padL + cW},${padT + cH} L ${padL},${padT + cH} Z`;
  const timeLabels = [["00:00", 0], ["06:00", 12], ["12:00", 24], ["18:00", 36], ["24:00", 47]];
  const yTicks = [0, 0.5, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map(f => {
        const y = padT + cH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#3a3a3a" strokeWidth={0.5} strokeDasharray="3,2" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9} fill="#888">{Math.round(max * f)}</text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#areaGrad)" />
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={1.8} />
      {timeLabels.map(([label, idx]) => {
        const x = padL + (idx / 47) * cW;
        return <text key={label} x={x} y={H - 5} textAnchor="middle" fontSize={9} fill="#888">{label}</text>;
      })}
      <line x1={padL} y1={padT + cH} x2={W - padR} y2={padT + cH} stroke="#555" strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + cH} stroke="#555" strokeWidth={1} />
    </svg>
  );
}

function SensitivityChart({ sensData, recommendedMWp, selectedMWp, hasExport, height = 170 }) {
  if (!sensData || sensData.length < 2) return null;
  const W = 520, H = height;
  const padL = 40, padR = 90, padT = 15, padB = 25;
  const cW = W - padL - padR, cH = H - padT - padB;
  const mwpMin = sensData[0].mwp, mwpMax = sensData[sensData.length - 1].mwp;
  const xFor = mwp => padL + ((mwp - mwpMin) / (mwpMax - mwpMin)) * cW;
  const yFor = pct => padT + cH * (1 - pct / 100);

  const coveragePts = sensData.map(d => `${xFor(d.mwp)},${yFor(d.coverage * 100)}`).join(" ");
  const scPts       = sensData.map(d => `${xFor(d.mwp)},${yFor(d.scRatio * 100)}`).join(" ");
  const usefulPts   = hasExport ? sensData.map(d => `${xFor(d.mwp)},${yFor(d.usefulRatio * 100)}`).join(" ") : null;

  const pctTicks = [0, 25, 50, 75, 85, 100];
  // MWp axis ticks — pick 6 evenly
  const step = Math.max(1, Math.round((mwpMax - mwpMin) / 6));
  const mwpTicks = [];
  for (let v = Math.ceil(mwpMin); v <= mwpMax; v += step) mwpTicks.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
      {pctTicks.map(pct => {
        const y = yFor(pct);
        return (
          <g key={pct}>
            <line x1={padL} y1={y} x2={W - padR} y2={y}
              stroke={pct === 85 ? "#F8632C" : "#3a3a3a"}
              strokeWidth={pct === 85 ? 1 : 0.5}
              strokeDasharray={pct === 85 ? "5,3" : "3,2"} />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9}
              fill={pct === 85 ? "#F8632C" : "#888"}>{pct}%</text>
          </g>
        );
      })}
      {/* Lines */}
      <polyline points={coveragePts} fill="none" stroke="#F8632C" strokeWidth={2} />
      <polyline points={scPts}       fill="none" stroke="#5A7984" strokeWidth={2} />
      {usefulPts && <polyline points={usefulPts} fill="none" stroke="#4A8C5C" strokeWidth={1.5} strokeDasharray="4,2" />}
      {/* Recommended marker */}
      {recommendedMWp && (
        <line x1={xFor(recommendedMWp)} y1={padT} x2={xFor(recommendedMWp)} y2={padT + cH}
          stroke="#4A8C5C" strokeWidth={1.5} strokeDasharray="4,2" />
      )}
      {/* Selected marker */}
      {selectedMWp && selectedMWp !== recommendedMWp && (
        <line x1={xFor(selectedMWp)} y1={padT} x2={xFor(selectedMWp)} y2={padT + cH}
          stroke="#F8632C" strokeWidth={2} />
      )}
      {/* MWp axis */}
      {mwpTicks.map(v => (
        <text key={v} x={xFor(v)} y={H - 7} textAnchor="middle" fontSize={9} fill="#888">{v}</text>
      ))}
      <line x1={padL} y1={padT + cH} x2={W - padR} y2={padT + cH} stroke="#555" strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + cH} stroke="#555" strokeWidth={1} />
      {/* Legend */}
      <rect x={W - padR + 8} y={padT}      width={8} height={3} fill="#F8632C" rx={1} />
      <text x={W - padR + 19} y={padT + 4}  fontSize={9} fill="#aaa">Demand coverage</text>
      <rect x={W - padR + 8} y={padT + 14} width={8} height={3} fill="#5A7984" rx={1} />
      <text x={W - padR + 19} y={padT + 18} fontSize={9} fill="#aaa">Self-consumption</text>
      {usefulPts && <>
        <rect x={W - padR + 8} y={padT + 28} width={8} height={3} fill="#4A8C5C" rx={1} />
        <text x={W - padR + 19} y={padT + 32} fontSize={9} fill="#aaa">Useful (incl. export)</text>
      </>}
      <rect x={W - padR + 8} y={padT + 48} width={2} height={16} fill="#4A8C5C" />
      <text x={W - padR + 13} y={padT + 52} fontSize={9} fill="#4A8C5C">Recommended</text>
      {selectedMWp && selectedMWp !== recommendedMWp && <>
        <rect x={W - padR + 8} y={padT + 64} width={2} height={16} fill="#F8632C" />
        <text x={W - padR + 13} y={padT + 68} fontSize={9} fill="#F8632C">Selected</text>
      </>}
    </svg>
  );
}

function ResultsChart({ monthly, height = 160 }) {
  const W = 520, H = height;
  const padL = 48, padR = 10, padT = 12, padB = 22;
  const cW = W - padL - padR, cH = H - padT - padB;
  const maxV = Math.max(...monthly.map(r => Math.max(r.gen, r.demand)), 0.001);
  const n = 12;
  const gW = cW / n;
  const bW = gW * 0.72;

  const yFor = v => padT + cH * (1 - v / maxV);
  const hFor = v => cH * (v / maxV);

  const yTicks = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
      {yTicks.map(f => {
        const y = padT + cH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#3a3a3a" strokeWidth={0.5} strokeDasharray="3,2" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9} fill="#888">{Math.round(maxV * f)}</text>
          </g>
        );
      })}
      {monthly.map((r, i) => {
        const x = padL + i * gW + (gW - bW) / 2;
        const halfW = bW / 2 - 1;
        // Left bar: generation (stacked: self-consumed orange, exported teal, curtailed grey)
        const scH  = hFor(r.selfConsumed);
        const expH = hFor(r.exported);
        const curH = hFor(r.curtailed);
        const genBase = padT + cH; // bottom
        return (
          <g key={i}>
            {/* Generation bar (left half) */}
            {curH > 0.5  && <rect x={x}          y={padT + cH - scH - expH - curH} width={halfW} height={curH}  fill="#555" rx={1} />}
            {expH > 0.5  && <rect x={x}          y={padT + cH - scH - expH}        width={halfW} height={expH}  fill="#1F6B5E" rx={1} />}
            {scH  > 0.5  && <rect x={x}          y={padT + cH - scH}               width={halfW} height={scH}   fill="#F8632C" rx={1} opacity={0.9} />}
            {/* Grid import bar (right half) */}
            {r.gridImport > 0.01 && (
              <rect x={x + halfW + 2} y={yFor(r.gridImport)} width={halfW} height={hFor(r.gridImport)} fill="#666" rx={1} opacity={0.5} />
            )}
            <text x={x + bW / 2} y={H - 5} textAnchor="middle" fontSize={9} fill="#888">{MONTHS_SHORT[i]}</text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + cH} x2={W - padR} y2={padT + cH} stroke="#555" strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + cH} stroke="#555" strokeWidth={1} />
    </svg>
  );
}

// ─── FORMATTING HELPERS ───────────────────────────────────────────────────────
const fmt  = n => Math.round(n).toLocaleString("en-GB");
const fmtD = n => n.toFixed(1);
const pct  = n => `${(n * 100).toFixed(1)}%`;

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PVSizing({ lead, onClose, session }) {
  const { theme } = useTheme();

  // HH data state
  const [hhData,         setHhData]         = useState(null);
  const [hhFilename,     setHhFilename]     = useState("");
  const [multiMpan,      setMultiMpan]      = useState(false);
  const [dragging,       setDragging]       = useState(false);
  const fileInputRef = useRef();

  // PVGIS state
  const [postcode,       setPostcode]       = useState(lead?.location || "");
  const [pvgisData,      setPvgisData]      = useState(null);
  const [pvgisLoading,   setPvgisLoading]   = useState(false);
  const [pvgisError,     setPvgisError]     = useState(null);
  const [manualYield,    setManualYield]    = useState(""); // kWh/kWp/yr override

  // Configuration
  const [hasExport,      setHasExport]      = useState(false);
  const [exportLimitMW,  setExportLimitMW]  = useState("0.5");
  const [ppaPrice,       setPpaPrice]       = useState("85");
  const [ppaTerm,        setPpaTerm]        = useState("25");
  const [cod,            setCod]            = useState("");
  const [opYears,        setOpYears]        = useState("40");

  // Sizing
  const [recommendedMWp, setRecommendedMWp] = useState(null);
  const [selectedMWp,    setSelectedMWp]    = useState(null);
  const [overriding,     setOverriding]     = useState(false);
  const [overrideMWp,    setOverrideMWp]    = useState("");

  // Persistence
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);
  const [saveError,      setSaveError]      = useState(null);
  const [loadedId,       setLoadedId]       = useState(null);

  // ── Load existing record on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!lead?.id) return;
    (async () => {
      const { data } = await supabase
        .from("private_wire_sizing")
        .select("*")
        .eq("lead_id", lead.id)
        .maybeSingle();
      if (!data) return;
      setLoadedId(data.id);
      setHhFilename(data.hh_filename || "");
      setPostcode(data.pvgis_lat ? `${data.pvgis_lat}, ${data.pvgis_lon}` : postcode);
      setHasExport(data.has_export || false);
      setExportLimitMW(String(data.export_limit_mw ?? 0.5));
      setPpaPrice(String(data.ppa_price ?? 85));
      setPpaTerm(String(data.ppa_term_years ?? 25));
      setCod(data.cod || "");
      setOpYears(String(data.operational_years ?? 40));
      setRecommendedMWp(data.recommended_mwp);
      setSelectedMWp(data.selected_mwp);
      if (data.monthly_demand_mwh && data.pvgis_monthly_kwh_kwp) {
        setHhData({
          annualDemandMWh:       data.annual_demand_mwh,
          monthlyDemandMWh:      data.monthly_demand_mwh,
          monthlyAvgDailyProfile: data.monthly_avg_daily_profile || [],
          annualAvgDailyProfile:  (data.monthly_avg_daily_profile || []).length === 12
            ? Array.from({ length: 48 }, (_, i) =>
                data.monthly_avg_daily_profile.reduce((s,m) => s + (m[i] || 0), 0) / 12)
            : [],
          peakDemandKW:          data.peak_demand_kw,
          loadFactor:            data.load_factor,
          mpans:                 data.mpan_list || [],
          year:                  data.hh_year,
          totalDays:             365,
        });
        setPvgisData({
          annualYield:       data.pvgis_annual_yield_kwh_kwp,
          monthlyKwhPerKwp:  data.pvgis_monthly_kwh_kwp,
          lat:               data.pvgis_lat,
          lon:               data.pvgis_lon,
        });
        setPostcode(`${data.pvgis_lat?.toFixed(4)}, ${data.pvgis_lon?.toFixed(4)}`);
      }
    })();
  }, [lead?.id]); // eslint-disable-line

  // ── Effective yield: manual override takes priority over PVGIS ───────────
  // pvgisData.monthlyKwhPerKwp are the monthly fractions; if user overrides the
  // annual total we scale the monthly profile proportionally.
  const effectiveMonthly = useMemo(() => {
    if (!pvgisData) return null;
    const pvgisAnnual = pvgisData.monthlyKwhPerKwp.reduce((s, v) => s + v, 0);
    const overrideVal = parseFloat(manualYield);
    if (manualYield && overrideVal > 0 && pvgisAnnual > 0) {
      const scale = overrideVal / pvgisAnnual;
      return pvgisData.monthlyKwhPerKwp.map(v => v * scale);
    }
    return pvgisData.monthlyKwhPerKwp;
  }, [pvgisData, manualYield]);

  const effectiveAnnualYield = useMemo(() => {
    if (!pvgisData) return 0;
    const overrideVal = parseFloat(manualYield);
    return (manualYield && overrideVal > 0) ? overrideVal : pvgisData.annualYield;
  }, [pvgisData, manualYield]);

  // ── Demand profiles: actual HH data (kWh/slot/day per month) ─────────────
  const demandProfiles = useMemo(() => {
    if (!hhData) return null;
    return buildDemandProfiles(hhData.monthlyDemandMWh, hhData.monthlyAvgDailyProfile);
  }, [hhData]);

  // ── Numeric versions of string config state ────────────────────────────────
  const exportLimitMWNum = parseFloat(exportLimitMW) || 0;
  const ppaPriceNum      = parseFloat(ppaPrice)      || 0;
  const ppaTermNum       = parseInt(ppaTerm,  10)    || 25;
  const opYearsNum       = parseInt(opYears,  10)    || 40;

  // ── Auto-calculate recommended MWp when data is ready ─────────────────────
  useEffect(() => {
    if (!demandProfiles || !effectiveMonthly) return;
    const rec = calcOptimalMWp(demandProfiles, effectiveMonthly, hasExport, exportLimitMWNum);
    setRecommendedMWp(rec);
    if (!overriding) setSelectedMWp(rec);
  }, [demandProfiles, effectiveMonthly, hasExport, exportLimitMWNum, overriding]);

  // ── Sensitivity data ───────────────────────────────────────────────────────
  const sensData = useMemo(() => {
    if (!demandProfiles || !effectiveMonthly) return [];
    return buildSensitivityData(demandProfiles, effectiveMonthly, hasExport, exportLimitMWNum, recommendedMWp);
  }, [demandProfiles, effectiveMonthly, hasExport, exportLimitMWNum, recommendedMWp]);

  // ── Results at selected MWp ────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!demandProfiles || !effectiveMonthly || !selectedMWp) return null;
    return calcResults(demandProfiles, effectiveMonthly, selectedMWp, hasExport, exportLimitMWNum);
  }, [demandProfiles, effectiveMonthly, selectedMWp, hasExport, exportLimitMWNum]);

  // ── File handling ──────────────────────────────────────────────────────────
  const processFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(e.target.result, { type: "array" });
        const data = parseHHData(wb);
        setHhData(data);
        setHhFilename(file.name);
        setSaved(false);
        if (data.mpans.length > 1) setMultiMpan(true);
      } catch (err) {
        alert("Could not read HH data: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── PVGIS fetch ────────────────────────────────────────────────────────────
  const handleFetchPVGIS = async () => {
    if (!postcode.trim()) return;
    setPvgisLoading(true);
    setPvgisError(null);
    setPvgisData(null);
    try {
      let lat, lon;
      // If it's a lat,lon pair already (from loaded record)
      if (/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(postcode.trim())) {
        [lat, lon] = postcode.trim().split(",").map(Number);
      } else {
        ({ lat, lon } = await geocodePostcode(postcode));
      }
      const data = await fetchPVGIS(lat, lon);
      setPvgisData(data);
      setSaved(false);
    } catch (err) {
      setPvgisError(err.message);
    } finally {
      setPvgisLoading(false);
    }
  };

  // ── Save to Supabase ───────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!hhData || !pvgisData || !selectedMWp) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = results;
      const payload = {
        lead_id:                   lead.id,
        hh_filename:               hhFilename,
        hh_year:                   hhData.year,
        mpan_list:                 hhData.mpans,
        annual_demand_mwh:         hhData.annualDemandMWh,
        monthly_demand_mwh:        hhData.monthlyDemandMWh,
        monthly_avg_daily_profile: hhData.monthlyAvgDailyProfile,
        peak_demand_kw:            hhData.peakDemandKW,
        load_factor:               hhData.loadFactor,
        pvgis_lat:                 pvgisData.lat,
        pvgis_lon:                 pvgisData.lon,
        pvgis_annual_yield_kwh_kwp: pvgisData.annualYield,
        pvgis_monthly_kwh_kwp:     effectiveMonthly,
        availability_factor:       AVAILABILITY,
        adjusted_yield_kwh_kwp:    effectiveAnnualYield * AVAILABILITY,
        recommended_mwp:           recommendedMWp,
        selected_mwp:              selectedMWp,
        has_export:                hasExport,
        export_limit_mw:           hasExport ? exportLimitMWNum : null,
        ppa_price:                 ppaPriceNum,
        ppa_term_years:            ppaTermNum,
        cod:                       cod || null,
        operational_years:         opYearsNum,
        degradation_pct:           DEGRADATION,
        annual_generation_mwh:     res?.totalGen,
        annual_self_consumed_mwh:  res?.totalConsumed,
        annual_export_mwh:         res?.totalExported,
        annual_grid_import_mwh:    res?.totalImport,
        self_consumption_ratio:    res?.scRatio,
        demand_coverage_pct:       res?.coverage,
        created_by:                session?.user?.id,
        updated_at:                new Date().toISOString(),
      };

      const { error } = await supabase
        .from("private_wire_sizing")
        .upsert(payload, { onConflict: "lead_id" });

      if (error) throw error;
      setSaved(true);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const card = {
    background: theme.elevatedBg,
    border:     `1px solid ${theme.border}`,
    borderRadius: 12,
    padding:    20,
    marginBottom: 16,
  };
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: theme.textPrimary, marginBottom: 12 };
  const label    = { fontSize: 11, color: theme.textTertiary, fontWeight: 500, marginBottom: 4, display: "block" };
  const inputSt  = {
    width: "100%", boxSizing: "border-box",
    background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.textPrimary, padding: "7px 10px",
    fontSize: 12, fontFamily: "monospace", outline: "none",
  };
  const statCard = (accent) => ({
    flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 8, padding: "12px 14px", borderLeft: `3px solid ${accent}`,
  });
  const canSave = !!hhData && !!pvgisData && !!selectedMWp;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: theme.surfaceBg,
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* ── Fixed Header ── */}
      <div style={{
        flexShrink: 0,
        background: theme.elevatedBg,
        borderBottom: `1px solid ${theme.border}`,
        padding: "0 24px",
        height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: theme.shadowSm,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: theme.textTertiary, fontSize: 18, lineHeight: 1, padding: 4,
          }}>←</button>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>
              PV Sizing
            </div>
            <div style={{ fontSize: 11, color: theme.textTertiary }}>{lead?.name}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saved && <span style={{ fontSize: 11, color: theme.success }}>✓ Saved</span>}
          {saveError && <span style={{ fontSize: 11, color: theme.error }}>{saveError}</span>}
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              padding: "8px 18px", borderRadius: 7, fontSize: 12, fontWeight: 700,
              cursor: canSave ? "pointer" : "not-allowed",
              background: canSave ? theme.accent : theme.pillBg,
              color: canSave ? "#fff" : theme.textMuted, border: "none",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save to Lead"}
          </button>
        </div>
      </div>

      {/* ── Scrollable Content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

        {/* ── Multi-MPAN prompt ── */}
        {multiMpan && (
          <div style={{ ...card, borderColor: theme.accent, background: theme.accentBg }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.accent, marginBottom: 6 }}>
              Multiple meters detected ({hhData?.mpans?.length} MPANs)
            </div>
            <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 12 }}>
              This file contains data for multiple supply points. The analysis below uses all readings aggregated as a single site load. If these are separate sites, upload individual files per site.
            </div>
            <button onClick={() => setMultiMpan(false)} style={{ fontSize: 11, color: theme.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              Understood, proceed with aggregated data
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 1 — DEMAND ANALYSIS
        ══════════════════════════════════════════════════════════════════════ */}
        <div style={card}>
          <div style={sectionTitle}>① Demand Analysis</div>

          {/* Upload zone */}
          {!hhData ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? theme.accent : theme.border}`,
                borderRadius: 10, padding: "40px 24px", textAlign: "center", cursor: "pointer",
                background: dragging ? theme.accentBg : theme.surfaceBg,
                transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 4 }}>
                Drop HH data file here, or click to browse
              </div>
              <div style={{ fontSize: 11, color: theme.textMuted }}>
                Accepts .xlsx — one row per day, 48 half-hourly kWh columns
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: "none" }}
                onChange={e => processFile(e.target.files[0])} />
            </div>
          ) : (
            <>
              {/* File info + re-upload */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: theme.textTertiary }}>
                  <span style={{ color: theme.success, marginRight: 6 }}>✓</span>
                  {hhFilename}
                  {hhData.year && <span style={{ marginLeft: 8, color: theme.textMuted }}>({hhData.year} · {hhData.totalDays} days)</span>}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ fontSize: 11, color: theme.accent, background: "none", border: "none", cursor: "pointer" }}
                >
                  Replace file
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: "none" }}
                  onChange={e => processFile(e.target.files[0])} />
              </div>

              {/* Stat cards */}
              <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                <div style={statCard("#F8632C")}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Annual Demand</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: theme.textPrimary, marginTop: 4 }}>
                    {fmt(hhData.annualDemandMWh)} <span style={{ fontSize: 12, fontWeight: 500, color: theme.textTertiary }}>MWh</span>
                  </div>
                </div>
                <div style={statCard("#1F3D4A")}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Peak Demand</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: theme.textPrimary, marginTop: 4 }}>
                    {fmt(hhData.peakDemandKW)} <span style={{ fontSize: 12, fontWeight: 500, color: theme.textTertiary }}>kW</span>
                  </div>
                </div>
                <div style={statCard("#E4B44A")}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Load Factor</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: theme.textPrimary, marginTop: 4 }}>
                    {pct(hhData.loadFactor)}
                  </div>
                </div>
              </div>

              {/* Monthly demand chart */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 600, marginBottom: 6 }}>Monthly Demand (MWh)</div>
                <BarChart
                  data={hhData.monthlyDemandMWh}
                  labels={MONTHS_SHORT}
                  color="#F8632C"
                  height={130}
                />
              </div>

              {/* Annual avg daily profile */}
              {hhData.annualAvgDailyProfile?.length === 48 && (
                <div>
                  <div style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 600, marginBottom: 6 }}>
                    Average Daily Load Profile — annual average (kWh / half-hour)
                  </div>
                  <DailyProfileChart
                    data48={hhData.annualAvgDailyProfile}
                    color="#F8632C"
                    height={110}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 2 — SOLAR RESOURCE
        ══════════════════════════════════════════════════════════════════════ */}
        <div style={{ ...card, opacity: hhData ? 1 : 0.45, pointerEvents: hhData ? "auto" : "none" }}>
          <div style={sectionTitle}>② Solar Resource (PVGIS)</div>
          {!hhData && <div style={{ fontSize: 11, color: theme.textMuted }}>Upload HH data first</div>}

          {hhData && (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Site Postcode</label>
                  <input
                    style={inputSt}
                    value={postcode}
                    onChange={e => { setPostcode(e.target.value); setPvgisData(null); setSaved(false); }}
                    placeholder="e.g. WR3 8SP"
                  />
                </div>
                <div style={{ alignSelf: "flex-end" }}>
                  <button
                    onClick={handleFetchPVGIS}
                    disabled={pvgisLoading || !postcode.trim()}
                    style={{
                      padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: theme.accent, color: "#fff", border: "none",
                      cursor: pvgisLoading ? "wait" : "pointer",
                      opacity: pvgisLoading ? 0.7 : 1,
                    }}
                  >
                    {pvgisLoading ? "Fetching…" : pvgisData ? "Re-fetch" : "Fetch Yield"}
                  </button>
                </div>
              </div>

              {pvgisError && (
                <div style={{ fontSize: 11, color: theme.error, marginBottom: 10 }}>{pvgisError}</div>
              )}

              {pvgisData && (
                <>
                  {/* Stat cards */}
                  <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    <div style={statCard("#E4B44A")}>
                      <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>PVGIS Yield</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: theme.textPrimary, marginTop: 4 }}>
                        {fmt(pvgisData.annualYield)} <span style={{ fontSize: 11, color: theme.textTertiary }}>kWh/kWp/yr</span>
                      </div>
                      <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 3 }}>Optimised tilt · 5% losses</div>
                    </div>
                    <div style={statCard(manualYield ? "#F8632C" : "#E4B44A")}>
                      <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Used in Calculations</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: theme.textPrimary, marginTop: 4 }}>
                        {fmt(effectiveAnnualYield * AVAILABILITY)} <span style={{ fontSize: 11, color: theme.textTertiary }}>kWh/kWp/yr</span>
                      </div>
                      <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 3 }}>
                        {manualYield ? "Manual override × 99% availability" : "PVGIS × 99% availability"}
                      </div>
                    </div>
                    <div style={statCard("#5A7984")}>
                      <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Location</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, marginTop: 4 }}>
                        {pvgisData.lat.toFixed(4)}°N
                      </div>
                      <div style={{ fontSize: 11, color: theme.textTertiary }}>{pvgisData.lon.toFixed(4)}°E</div>
                    </div>
                  </div>

                  {/* Manual yield override */}
                  <div style={{ marginBottom: 16, padding: "12px 14px", background: theme.surfaceBg, borderRadius: 8, border: `1px solid ${theme.borderSubtle}` }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: theme.textSecondary, marginBottom: 8 }}>
                      Override yield <span style={{ fontWeight: 400, color: theme.textMuted }}>— leave blank to use PVGIS figure above</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", flex: 1, maxWidth: 220 }}>
                        <input
                          type="number" step="10" min="500" max="2000"
                          value={manualYield}
                          onChange={e => { setManualYield(e.target.value); setSaved(false); }}
                          placeholder={fmt(pvgisData.annualYield)}
                          style={{ ...inputSt, borderRadius: "6px 0 0 6px" }}
                        />
                        <span style={{ padding: "7px 10px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>kWh/kWp/yr</span>
                      </div>
                      {manualYield && (
                        <button onClick={() => { setManualYield(""); setSaved(false); }}
                          style={{ fontSize: 11, color: theme.textMuted, background: "none", border: "none", cursor: "pointer" }}>
                          ✕ Clear
                        </button>
                      )}
                      <span style={{ fontSize: 11, color: theme.textMuted }}>
                        Typical UK range: 900–1,100 kWh/kWp/yr
                      </span>
                    </div>
                  </div>

                  {/* Monthly yield chart */}
                  <div style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 600, marginBottom: 6 }}>
                    Monthly Yield — 1 kWp reference system (kWh/kWp)
                    {manualYield && <span style={{ color: theme.accent, marginLeft: 6 }}>(scaled to override)</span>}
                  </div>
                  <BarChart
                    data={effectiveMonthly || pvgisData.monthlyKwhPerKwp}
                    labels={MONTHS_SHORT}
                    color="#E4B44A"
                    height={120}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 3 — CONFIGURATION
        ══════════════════════════════════════════════════════════════════════ */}
        <div style={{ ...card, opacity: pvgisData ? 1 : 0.45, pointerEvents: pvgisData ? "auto" : "none" }}>
          <div style={sectionTitle}>③ Configuration</div>
          {!pvgisData && <div style={{ fontSize: 11, color: theme.textMuted }}>Fetch PVGIS yield first</div>}

          {pvgisData && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Export */}
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label}>Grid Export</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[false, true].map(v => (
                    <button key={String(v)}
                      onClick={() => { setHasExport(v); setSaved(false); }}
                      style={{
                        padding: "7px 20px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        background: hasExport === v ? theme.accent : theme.surfaceBg,
                        color: hasExport === v ? "#fff" : theme.textSecondary,
                        border: `1px solid ${hasExport === v ? theme.accent : theme.border}`,
                      }}
                    >
                      {v ? "Yes — site can export" : "No export"}
                    </button>
                  ))}
                </div>
              </div>

              {hasExport && (
                <div>
                  <label style={label}>Export Limit (MW)</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                    <input
                      type="number" step="0.1" min="0.1"
                      value={exportLimitMW}
                      onChange={e => { setExportLimitMW(e.target.value); setSaved(false); }}
                      style={{ ...inputSt, borderRadius: "6px 0 0 6px" }}
                    />
                    <span style={{ padding: "7px 10px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>MW</span>
                  </div>
                </div>
              )}

              <div>
                <label style={label}>PPA Price</label>
                <div style={{ display: "flex" }}>
                  <input type="number" step="1" min="0" value={ppaPrice}
                    onChange={e => { setPpaPrice(e.target.value); setSaved(false); }}
                    style={{ ...inputSt, borderRadius: "6px 0 0 6px" }} />
                  <span style={{ padding: "7px 10px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary }}>£/MWh</span>
                </div>
              </div>

              <div>
                <label style={label}>PPA Term</label>
                <div style={{ display: "flex" }}>
                  <input type="number" step="1" min="1" max="40" value={ppaTerm}
                    onChange={e => { setPpaTerm(e.target.value); setSaved(false); }}
                    style={{ ...inputSt, borderRadius: "6px 0 0 6px" }} />
                  <span style={{ padding: "7px 10px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary }}>years</span>
                </div>
              </div>

              <div>
                <label style={label}>COD (Commercial Operation Date)</label>
                <input type="date" value={cod}
                  onChange={e => { setCod(e.target.value); setSaved(false); }}
                  style={inputSt} />
              </div>

              <div>
                <label style={label}>Operational Life</label>
                <div style={{ display: "flex" }}>
                  <input type="number" step="1" min="1" max="50" value={opYears}
                    onChange={e => { setOpYears(e.target.value); setSaved(false); }}
                    style={{ ...inputSt, borderRadius: "6px 0 0 6px" }} />
                  <span style={{ padding: "7px 10px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary }}>years</span>
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 10, color: theme.textMuted, display: "flex", gap: 20 }}>
                  <span>Availability factor: 99%</span>
                  <span>Degradation: 0.4%/yr (used in financial model)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 4 — SIZING
        ══════════════════════════════════════════════════════════════════════ */}
        <div style={{ ...card, opacity: pvgisData ? 1 : 0.45, pointerEvents: pvgisData ? "auto" : "none" }}>
          <div style={sectionTitle}>④ Solar Sizing</div>
          {!pvgisData && <div style={{ fontSize: 11, color: theme.textMuted }}>Complete sections above first</div>}

          {pvgisData && hhData && (
            <>
              {/* Recommended */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                <div style={{ ...statCard("#4A8C5C"), flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Recommended Size</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: theme.success, marginTop: 4 }}>
                    {recommendedMWp} <span style={{ fontSize: 13, fontWeight: 500, color: theme.textTertiary }}>MWp</span>
                  </div>
                  <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                    Largest size keeping {hasExport ? "useful" : "self-consumption"} ratio ≥ 85%
                  </div>
                </div>

                {/* Override */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 500 }}>Manual override</label>
                    <div
                      onClick={() => {
                        setOverriding(!overriding);
                        if (!overriding) setOverrideMWp(String(selectedMWp || recommendedMWp));
                        else { setSelectedMWp(recommendedMWp); setSaved(false); }
                      }}
                      style={{
                        width: 34, height: 18, borderRadius: 9, cursor: "pointer", position: "relative",
                        background: overriding ? theme.accent : theme.textMuted, transition: "background 0.2s",
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 2, left: overriding ? 16 : 2,
                        width: 14, height: 14, borderRadius: "50%", background: "#fff",
                        transition: "left 0.2s",
                      }} />
                    </div>
                  </div>
                  {overriding && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ display: "flex", flex: 1 }}>
                        <input
                          type="number" step="0.5" min="0.5"
                          value={overrideMWp}
                          onChange={e => setOverrideMWp(e.target.value)}
                          style={{ ...inputSt, borderRadius: "6px 0 0 6px" }}
                          placeholder={String(recommendedMWp)}
                        />
                        <span style={{ padding: "7px 10px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary }}>MWp</span>
                      </div>
                      <button
                        onClick={() => { setSelectedMWp(Number(overrideMWp) || recommendedMWp); setSaved(false); }}
                        style={{ padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: theme.accent, color: "#fff", border: "none", cursor: "pointer" }}
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Selected indicator */}
              {overriding && selectedMWp && (
                <div style={{ fontSize: 11, color: theme.accent, marginBottom: 12 }}>
                  Showing results for <strong>{selectedMWp} MWp</strong> (recommended: {recommendedMWp} MWp)
                </div>
              )}

              {/* Sensitivity chart */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 600, marginBottom: 6 }}>
                  Sensitivity — MWp vs efficiency (click rows below to change selected size)
                </div>
                <SensitivityChart
                  sensData={sensData}
                  recommendedMWp={recommendedMWp}
                  selectedMWp={selectedMWp}
                  hasExport={hasExport}
                  height={170}
                />
              </div>

              {/* Sensitivity table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                      {["MWp","Annual Gen (MWh)","Self-Consumed (MWh)", hasExport ? "Exported (MWh)" : null, "Demand Coverage","Self-Consumption"].filter(Boolean).map(h => (
                        <th key={h} style={{ padding: "6px 8px", textAlign: "right", color: theme.textTertiary, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sensData.map(d => {
                      const r = calcResults(demandProfiles, effectiveMonthly, d.mwp, hasExport, exportLimitMWNum);
                      const isSelected = selectedMWp === d.mwp;
                      const isRec      = recommendedMWp === d.mwp;
                      return (
                        <tr key={d.mwp}
                          onClick={() => { setSelectedMWp(d.mwp); setOverriding(d.mwp !== recommendedMWp); setSaved(false); }}
                          style={{
                            borderBottom: `1px solid ${theme.borderSubtle}`, cursor: "pointer",
                            background: isSelected ? theme.accentBg : "transparent",
                            transition: "background 0.1s",
                          }}
                        >
                          <td style={{ padding: "7px 8px", fontWeight: 700, color: isSelected ? theme.accent : theme.textPrimary }}>
                            {d.mwp}
                            {isRec && <span style={{ marginLeft: 6, fontSize: 9, color: theme.success, fontWeight: 700 }}>★ REC</span>}
                          </td>
                          <td style={{ padding: "7px 8px", textAlign: "right", color: theme.textSecondary, fontFamily: "monospace" }}>{fmt(r.totalGen)}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", color: "#F8632C",          fontFamily: "monospace" }}>{fmt(r.totalConsumed)}</td>
                          {hasExport && <td style={{ padding: "7px 8px", textAlign: "right", color: "#1F6B5E", fontFamily: "monospace" }}>{fmt(r.totalExported)}</td>}
                          <td style={{ padding: "7px 8px", textAlign: "right", color: theme.textSecondary, fontFamily: "monospace" }}>{pct(r.coverage)}</td>
                          <td style={{ padding: "7px 8px", textAlign: "right", color: r.scRatio >= 0.85 ? theme.success : theme.textMuted, fontFamily: "monospace" }}>{pct(r.scRatio)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            SECTION 5 — RESULTS
        ══════════════════════════════════════════════════════════════════════ */}
        {results && selectedMWp && (
          <div style={card}>
            <div style={sectionTitle}>⑤ Results — {selectedMWp} MWp System</div>

            {/* Key metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
              {[
                { label: "Annual Generation", value: `${fmt(results.totalGen)} MWh`,   accent: "#E4B44A" },
                { label: "Self-Consumed",      value: `${fmt(results.totalConsumed)} MWh`, accent: "#F8632C" },
                { label: "Demand Coverage",    value: pct(results.coverage),           accent: "#F8632C" },
                { label: "Self-Consumption",   value: pct(results.scRatio),            accent: results.scRatio >= 0.85 ? "#4A8C5C" : "#E4B44A" },
                ...(hasExport ? [{ label: "Annual Export", value: `${fmt(results.totalExported)} MWh`, accent: "#1F6B5E" }] : []),
                { label: "Grid Import Saved",  value: `${fmt(results.totalDemand - results.totalImport)} MWh`, accent: "#5A7984" },
                { label: "PPA Revenue (est.)", value: `£${fmt(results.totalConsumed * ppaPriceNum + (hasExport ? results.totalExported * ppaPriceNum * 0.5 : 0))}`, accent: "#4A8C5C" },
              ].map(({ label: l, value: v, accent }) => (
                <div key={l} style={{ ...statCard(accent) }}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Monthly results chart */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 600, marginBottom: 4 }}>Monthly Energy Balance (MWh)</div>
              <ResultsChart monthly={results.monthly} height={160} />
              <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
                {[
                  { color: "#F8632C", label: "Self-consumed (solar)" },
                  ...(hasExport ? [{ color: "#1F6B5E", label: "Exported" }] : []),
                  { color: "#555",    label: "Curtailed / excess" },
                  { color: "#666",    label: "Grid import" },
                ].map(({ color, label: l }) => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                    <span style={{ fontSize: 10, color: theme.textTertiary }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Configuration summary */}
            <div style={{ marginTop: 16, padding: "12px 14px", background: theme.surfaceBg, borderRadius: 8, border: `1px solid ${theme.borderSubtle}` }}>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Configuration Summary</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6, fontSize: 11, color: theme.textSecondary }}>
                <span>PPA: <strong style={{ color: theme.textPrimary }}>£{ppaPriceNum}/MWh · {ppaTermNum} yrs</strong></span>
                <span>Export: <strong style={{ color: theme.textPrimary }}>{hasExport ? `Yes — ${exportLimitMWNum} MW limit` : "No"}</strong></span>
                <span>COD: <strong style={{ color: theme.textPrimary }}>{cod || "Not set"}</strong></span>
                <span>Asset life: <strong style={{ color: theme.textPrimary }}>{opYearsNum} years</strong></span>
                <span>PVGIS yield: <strong style={{ color: theme.textPrimary }}>{fmt(pvgisData?.annualYield || 0)} kWh/kWp/yr</strong></span>
                <span>Availability: <strong style={{ color: theme.textPrimary }}>99%</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* Bottom padding */}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
