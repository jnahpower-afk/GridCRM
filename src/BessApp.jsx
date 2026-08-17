import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { useCentralAssumptions } from "./CentralAssumptions";
import { useTheme } from "./ThemeContext.jsx";
import FuseLogo from "./FuseLogo.jsx";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function monthDiff(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
function computeIRR(cashflows, guess = 0.08) {
  const maxIter = 300; const tol = 1e-8;
  let rate = guess / 12;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const v = Math.pow(1 + rate, t);
      if (!isFinite(v)) break;
      npv += cashflows[t] / v;
      dnpv -= t * cashflows[t] / (v * (1 + rate));
    }
    if (Math.abs(dnpv) < 1e-12) break;
    const nr = rate - npv / dnpv;
    // Clamp to prevent divergence
    const clamped = Math.max(-0.5, Math.min(nr, 2.0));
    if (Math.abs(clamped - rate) < tol) { rate = clamped; break; }
    rate = clamped;
  }
  const annual = Math.pow(1 + rate, 12) - 1;
  return isFinite(annual) ? annual : 0;
}
function computeNPV(cashflows, annualRate) {
  const mr = Math.pow(1 + annualRate, 1 / 12) - 1;
  return cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + mr, t), 0);
}

// ─── BESS MERCHANT CURVES (fallback, £k/MW/year) ────────────────────────────

const BESS_MERCHANT_HIGH    = [85, 82, 80, 78, 76, 74, 72, 70, 68, 66, 65, 64, 63, 62, 61, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60];
const BESS_MERCHANT_CENTRAL = [63.5, 61, 59, 57, 55, 53, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42];
const BESS_MERCHANT_LOW     = [45, 43, 41, 39, 37, 35, 34, 33, 32, 31, 30, 29, 28, 28, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27];

// ─── DEFAULT INPUTS ───────────────────────────────────────────────────────

const BESS_DEFAULT = {
  // Project
  projectName: "New BESS",
  modelStart: "2026-01-01", financialClose: "2026-03-01",
  constructionMonths: 12, cod: "2027-07-01", assetLife: 20,
  discountRate: 7.5, cpi: 2.25,

  // Technical
  storageMW: 20, storageHours: 2, cyclesPerDay: 1.5,
  initialOversizing: 0, roundTripEfficiency: 86, availability: 96, degradation: 2.5,

  // CAPEX (£/MW rates — multiplied by storageMW to get totals)
  capexBatteryContainers: 120000, capexPCS: 25000, capexShipping: 5000,
  capexBOP: 15000, capexSpareParts: 3000, capexInstallation: 12000,
  capexEmsScada: 4000, capexSSAA: 2000,
  capexEngineering: 8000, capexConstructionInsurance: 3000,
  capexContingencyPct: 10, capexOtherCosts: 0,

  // OPEX — BESS O&M Plateaus (£/MW/year)
  omPlateaus: [
    { name: "Warranty",      startYear: 1,  endYear: 2,  perMW: 2087 },
    { name: "Post-warranty", startYear: 3,  endYear: 3,  perMW: 3258 },
    { name: "Settling",      startYear: 4,  endYear: 5,  perMW: 3589 },
    { name: "Block 1",       startYear: 6,  endYear: 10, perMW: 4063 },
    { name: "Block 2",       startYear: 11, endYear: 15, perMW: 4664 },
    { name: "Block 3",       startYear: 16, endYear: 20, perMW: 5647 },
  ],
  // Common costs (£/MW/year)
  opexLandRent: 1000, opexAssetMgmt: 1500, opexInsurance: 750,
  opexBusinessRates: 1250, opexOther: 0,

  // Revenue — Capacity Market
  cmActive: true, cmStartDate: "2031-10-01", cmTerm: 15, cmPrice: 9.462, cmEscalation: true,

  // Revenue — Floor/Tolling
  floorActive: true, floorType: 0, floorStartDate: "2027-07-01", floorTerm: 10,
  floorPrice: 63.5, floorEscalation: true,

  // Revenue — Merchant
  merchantActive: true, merchantScenario: "central", merchantDiscount: 5,

  // Debt
  debtActive: true, gearing: 75, interestCon: 6.25, interestOps: 5.75,
  debtTenor: 18, arrangementFee: 1.0,
  dsraActive: true, dsraMonths: 6, minCash: 100000,

  // Tax
  corpTax: 25, capAllowRate: 6,

  // Bid
  bidPerMW: 0,
};

// ─── CAPEX CALCULATION ─────────────────────────────────────────────────────

function calcBessCapex(inp) {
  const mw = inp.storageMW || 1;
  const mwh = mw * (inp.storageHours || 2);
  const epcEquipment = (inp.capexBatteryContainers + inp.capexPCS + inp.capexShipping + inp.capexBOP +
                        inp.capexSpareParts + inp.capexInstallation + inp.capexEmsScada + inp.capexSSAA) * mw;
  const epcServices = (inp.capexEngineering + inp.capexConstructionInsurance) * mw;
  const epcTotal = epcEquipment + epcServices;
  const contingency = epcTotal * (inp.capexContingencyPct / 100);
  const otherCosts = inp.capexOtherCosts;
  const grandTotal = epcTotal + contingency + otherCosts;
  return { epcEquipment, epcServices, epcTotal, contingency, otherCosts, grandTotal, mw, mwh };
}

// ─── DCF ENGINE ────────────────────────────────────────────────────────────

function runBessDCF(inp) {
  const normalise = d => d && d.length === 7 ? d + "-01" : d;
  const modelStart = new Date(inp.modelStart && inp.modelStart.length === 7 ? inp.modelStart + "-01" : inp.modelStart);
  const cod = new Date(inp.cod && inp.cod.length === 7 ? inp.cod + "-01" : inp.cod);
  const constructionStart = addMonths(cod, -inp.constructionMonths);
  const projectEnd = addMonths(cod, inp.assetLife * 12);
  const totalMonths = monthDiff(modelStart, projectEnd);
  if (totalMonths <= 0 || totalMonths > 600) return null;

  const monthlyRateCpi = Math.pow(1 + inp.cpi / 100, 1 / 12) - 1;
  const cpiBase = new Date(inp.modelStart && inp.modelStart.length === 7 ? inp.modelStart + "-01" : inp.modelStart);

  // CAPEX calculation
  const { grandTotal: totalCapex } = calcBessCapex(inp);

  const debtAmount = inp.debtActive ? totalCapex * (inp.gearing / 100) : 0;
  const equityAmount = totalCapex - debtAmount;
  const arrangementFee = inp.debtActive ? debtAmount * (inp.arrangementFee / 100) : 0;
  const debtTenorMonths = inp.debtTenor * 12;
  const monthlyPrincipal = inp.debtActive ? debtAmount / debtTenorMonths : 0;

  // Merge curves
  const mergeCurve = (sheets, hardcoded) => {
    if (!Array.isArray(sheets) || sheets.length === 0) return hardcoded;
    return hardcoded.map((hv, i) => {
      const sv = i < sheets.length ? sheets[i] : 0;
      return sv !== 0 ? sv : hv;
    });
  };

  const merchantCurve = inp.merchantScenario === "high" ? mergeCurve(inp._bessHighCurve, BESS_MERCHANT_HIGH)
    : inp.merchantScenario === "low" ? mergeCurve(inp._bessLowCurve, BESS_MERCHANT_LOW)
    : mergeCurve(inp._bessCentralCurve, BESS_MERCHANT_CENTRAL);

  const getMerchantPrice = (calendarYear) => {
    const idx = Math.max(0, Math.min(calendarYear - 2026, merchantCurve.length - 1));
    return merchantCurve[idx];
  };

  // Tech params
  const installedCapacityMWh = inp.storageMW * inp.storageHours * (1 + inp.initialOversizing / 100);
  const usableCapacityMWh = inp.storageMW * inp.storageHours;

  // For degradation: check for degradation curve; if not, use fixed degradation
  const getDegradation = (opYear) => {
    if (Array.isArray(inp._degradationCurve) && inp._degradationCurve.length > 0) {
      // Degradation curve is quarterly, so we need to interpolate to annual
      const qIndex = Math.max(0, Math.min((opYear - 1) * 4, inp._degradationCurve.length - 1));
      return inp._degradationCurve[qIndex] || 0;
    }
    return inp.degradation || 2.5;
  };

  // Initialize arrays
  const periods = [];
  const months = monthDiff(modelStart, projectEnd);
  const capexSchedule = new Map();

  // Spread capex over construction period
  const constructionMonths = inp.constructionMonths || 12;
  for (let i = 0; i < constructionMonths; i++) {
    capexSchedule.set(monthDiff(modelStart, addMonths(constructionStart, i)), totalCapex / constructionMonths);
  }

  // Tax tracking
  let taxLossCarryForward = 0;
  const capAllowAnnual = totalCapex / (inp.assetLife * 12) * 12; // Straight-line
  let capAllowAccumulated = 0;

  // Debt tracking
  let debtBalance = 0;
  let dsraBalance = 0; // DSRA funded during operations

  // Collect KPI rows
  const annualRows = [];
  let currentYear = null;
  let yearData = null;

  for (let mi = 0; mi < months; mi++) {
    const periodDate = addMonths(modelStart, mi);
    const periodYear = periodDate.getFullYear();
    const periodMonth = periodDate.getMonth();
    const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][periodMonth];

    // Check if construction or operations
    const isConstruction = periodDate >= constructionStart && periodDate < cod;
    const isOps = periodDate >= cod && periodDate < projectEnd;
    const opYear = isOps ? Math.floor(monthDiff(cod, periodDate) / 12) + 1 : 0;

    // Initialize annual row if new year
    if (currentYear !== periodYear) {
      if (yearData) annualRows.push(yearData);
      currentYear = periodYear;
      yearData = {
        year: periodYear,
        totalRevenueCM: 0,
        totalRevenueFloor: 0,
        totalRevenuemerchant: 0,
        totalOpex: 0,
        totalEBITDA: 0,
        equityFCF: 0,
        isConstruction: !isOps,
      };
    }

    // ─── CAPEX ────

    const capexMonth = capexSchedule.get(mi) || 0;

    // ─── OPERATIONS ────

    let dispatchableMW = 0;
    let dispatchableMWh = 0;
    let revenueCM = 0;
    let revenueFloor = 0;
    let revenueMerchant = 0;
    let opex = 0;
    let bessOmCost = 0;
    let otherOpexCost = 0;

    if (isOps) {
      // Degradation factor
      const annualDegradationPct = getDegradation(opYear) || inp.degradation;
      const degradationFactor = Math.pow(1 - annualDegradationPct / 100, opYear - 1);
      dispatchableMW = inp.storageMW * degradationFactor;

      // Monthly energy dispatch
      const monthDays = daysInMonth(periodDate);
      const monthlyMWh = inp.storageMW * inp.storageHours * inp.cyclesPerDay * monthDays *
                         (inp.availability / 100) * degradationFactor * (inp.roundTripEfficiency / 100);
      dispatchableMWh = monthlyMWh;

      // CPI indexing
      const monthsSinceBase = monthDiff(cpiBase, periodDate);
      const cpiIndex = Math.pow(1 + monthlyRateCpi, monthsSinceBase);

      // ─── REVENUE ────

      // Capacity Market
      if (inp.cmActive) {
        const cmStartDate = new Date(inp.cmStartDate && inp.cmStartDate.length === 7 ? inp.cmStartDate + "-01" : inp.cmStartDate);
        const cmEndDate = addMonths(cmStartDate, inp.cmTerm * 12);
        if (periodDate >= cmStartDate && periodDate < cmEndDate) {
          const cmPrice = inp.cmPrice * (inp.cmEscalation ? cpiIndex : 1);
          revenueCM = dispatchableMW * cmPrice * 1000 / 12; // £k → £
        }
      }

      // Floor/Tolling Agreement
      if (inp.floorActive) {
        const floorStartDate = new Date(inp.floorStartDate && inp.floorStartDate.length === 7 ? inp.floorStartDate + "-01" : inp.floorStartDate);
        const floorEndDate = addMonths(floorStartDate, inp.floorTerm * 12);
        if (periodDate >= floorStartDate && periodDate < floorEndDate) {
          const floorPrice = inp.floorPrice * (inp.floorEscalation ? cpiIndex : 1);
          if (inp.floorType === 0) {
            // Tolling — fixed MW × price
            revenueFloor = inp.storageMW * floorPrice * 1000 / 12;
          } else {
            // Floor — MAX(floor, merchant)
            const merchantPrice = getMerchantPrice(periodYear);
            const merchantRev = dispatchableMW * merchantPrice * 1000 / 12 * (1 - inp.merchantDiscount / 100);
            const floorRev = inp.storageMW * floorPrice * 1000 / 12;
            revenueFloor = Math.max(floorRev, merchantRev);
            revenueMerchant = 0; // Don't double-count
          }
        }
      }

      // Merchant — applies outside floor window, or when floor type is tolling (0) and we're outside the window
      if (inp.merchantActive && revenueFloor === 0 && revenueMerchant === 0) {
        const merchantPrice = getMerchantPrice(periodYear);
        revenueMerchant = dispatchableMW * merchantPrice * 1000 / 12 * (1 - inp.merchantDiscount / 100);
      }

      // ─── OPEX ────

      // BESS O&M — find the plateau for this operating year
      const plateaus = inp.omPlateaus || [];
      const plateau = plateaus.find(p => opYear >= p.startYear && opYear <= p.endYear);
      const bessOmPerMW = plateau ? plateau.perMW : (plateaus.length > 0 ? plateaus[plateaus.length - 1].perMW : 4063);
      bessOmCost = bessOmPerMW * inp.storageMW / 12 * cpiIndex;

      // Common costs (£/MW/year × MW → £/month)
      const mw = inp.storageMW;
      otherOpexCost = ((inp.opexLandRent + inp.opexAssetMgmt + inp.opexInsurance + inp.opexBusinessRates + inp.opexOther) * mw / 12) * cpiIndex;

      opex = bessOmCost + otherOpexCost;
    }

    // ─── EBITDA ────

    const totalRevenue = revenueCM + revenueFloor + revenueMerchant;
    const ebitda = totalRevenue - opex;

    // ─── DEPRECIATION & TAX ────

    const monthlyCapAllow = isOps ? capAllowAnnual / 12 : 0;
    capAllowAccumulated += monthlyCapAllow;
    const taxableIncome = ebitda - monthlyCapAllow;

    let taxableWithCarryForward = taxableIncome + taxLossCarryForward;
    const taxPayable = Math.max(0, taxableWithCarryForward * (inp.corpTax / 100));
    if (taxableWithCarryForward < 0) {
      taxLossCarryForward = taxableWithCarryForward;
    } else {
      taxLossCarryForward = 0;
    }

    // ─── DEBT ────

    let interest = 0;
    let principal = 0;
    let dsraFunding = 0;
    let dsraDrawdown = 0;
    let debtDraw = 0;

    if (isConstruction && debtAmount > 0) {
      // Draw debt during construction proportional to capex
      if (capexMonth > 0) {
        debtDraw = capexMonth * (inp.gearing / 100);
        debtBalance += debtDraw;
      }
      interest = debtBalance * (inp.interestCon / 100) / 12;
    } else if (isOps && debtBalance > 0) {
      // Operations phase — only service debt if balance outstanding
      interest = debtBalance * (inp.interestOps / 100) / 12;
      principal = Math.min(monthlyPrincipal, debtBalance);
      debtBalance = Math.max(0, debtBalance - principal);

      // DSRA logic
      if (inp.dsraActive) {
        const dsraTarget = inp.dsraMonths * (interest + principal) / 1; // target = N months of debt service
        const availableForDS = ebitda - taxPayable;
        const debtService = interest + principal;

        if (dsraBalance < dsraTarget) {
          // Fund DSRA shortfall from equity (capped at available cash after debt service)
          const shortfall = dsraTarget - dsraBalance;
          const excessCash = Math.max(0, availableForDS - debtService);
          dsraFunding = Math.min(shortfall, excessCash);
          dsraBalance += dsraFunding;
        } else if (dsraBalance > dsraTarget) {
          // Release excess DSRA back to equity
          dsraDrawdown = Math.min(dsraBalance - dsraTarget, dsraBalance);
          dsraBalance -= dsraDrawdown;
        }
      }
    }

    // ─── UNLEVERED & EQUITY FCF ────

    const unleveredFCF = ebitda - taxPayable - capexMonth;
    const equityFCF = ebitda - interest - principal - taxPayable - capexMonth + debtDraw + dsraDrawdown - dsraFunding;

    // Accumulate annual data
    if (yearData) {
      yearData.equityFCF += equityFCF;
      if (isOps) {
        yearData.totalRevenueCM += revenueCM;
        yearData.totalRevenueFloor += revenueFloor;
        yearData.totalRevenuemerchant += revenueMerchant;
        yearData.totalOpex += opex;
        yearData.totalEBITDA += ebitda;
      }
    }

    periods.push({
      mi,
      date: periodDate,
      year: periodYear,
      monthLabel: monthName,
      isConstruction,
      isOps,
      opYear,
      dispatchableMW,
      dispatchableMWh,
      revenueCM,
      revenueFloor,
      revenueMerchant,
      totalRevenue,
      opex,
      bessOmCost,
      otherOpexCost,
      ebitda,
      capex: capexMonth,
      depreciation: monthlyCapAllow,
      tax: taxPayable,
      interest,
      principal,
      dsraFunding,
      dsraDrawdown,
      debtDraw,
      debtBalance,
      dsraBalance,
      unleveredFCF,
      equityFCF,
    });
  }
  if (yearData) annualRows.push(yearData);

  // ─── KPIs ────

  const unleveredCashflows = periods.map(p => p.unleveredFCF);
  const equityCashflows = periods.map(p => p.equityFCF);

  const projectIRR = computeIRR(unleveredCashflows) * 100;
  const equityIRR = computeIRR(equityCashflows) * 100;
  const projectNPV = computeNPV(unleveredCashflows, inp.discountRate / 100) / 1000;
  const equityNPV = computeNPV(equityCashflows, inp.discountRate / 100) / 1000;

  const totalRevenue = periods.reduce((s, p) => s + p.totalRevenue, 0) / 1000;
  const totalCMRev = periods.reduce((s, p) => s + p.revenueCM, 0) / 1000;
  const totalFloorRev = periods.reduce((s, p) => s + p.revenueFloor, 0) / 1000;
  const totalMerchantRev = periods.reduce((s, p) => s + p.revenueMerchant, 0) / 1000;
  const totalOpex = periods.reduce((s, p) => s + p.opex, 0) / 1000;
  const totalEBITDA = periods.reduce((s, p) => s + p.ebitda, 0) / 1000;
  const totalTax = periods.reduce((s, p) => s + p.tax, 0) / 1000;
  const totalDebtService = periods.reduce((s, p) => s + p.interest + p.principal, 0) / 1000;
  const totalDistributions = periods.reduce((s, p) => s + Math.max(0, p.equityFCF), 0) / 1000;

  // DSCR
  const dscrs = periods
    .filter(p => p.isOps && (p.interest + p.principal) > 0)
    .map(p => {
      const ds = p.interest + p.principal;
      return p.ebitda / ds;
    });
  const minDSCR = dscrs.length > 0 ? Math.min(...dscrs) : 0;
  const avgDSCR = dscrs.length > 0 ? dscrs.reduce((s, v) => s + v, 0) / dscrs.length : 0;

  return {
    periods,
    annualRows,
    kpis: {
      projectIRR, equityIRR, projectNPV, equityNPV,
      totalCapex: totalCapex / 1000,
      debtAmount: debtAmount / 1000,
      equityInvestment: equityAmount / 1000,
      gearing: inp.debtActive ? (debtAmount / totalCapex) * 100 : 0,
      totalRevenue, totalCMRev, totalFloorRev, totalMerchantRev,
      totalOpex, totalEBITDA, totalTax, totalDebtService,
      totalDistributions, minDSCR, avgDSCR,
      dsraInitial: dsraBalance / 1000,
    },
  };
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────

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
      <div onClick={() => onChange(!value)} style={{ width: 36, height: 20, borderRadius: 10, cursor: "pointer", position: "relative", background: value ? theme.accent : theme.border, transition: "background 0.2s" }}>
        <div style={{ position: "absolute", top: 3, left: value ? 18 : 3, width: 14, height: 14, borderRadius: "50%", background: value ? theme.success : theme.textTertiary, transition: "left 0.2s" }} />
      </div>
    </div>
  );
}

function KPI({ label, value, sub, size = 20 }) {
  const { theme } = useTheme();
  const color = theme.textPrimary;
  return (
    <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 800, color, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em" }}>{value}</div>
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
  const opsRows = rows.filter(r => r.isConstruction === false);
  if (opsRows.length === 0) return null;

  const STACKS = [
    { key: "totalRevenueCM",      label: "CM",       color: "#4A8C5C" },
    { key: "totalRevenueFloor",   label: "Floor",    color: "#7A8A96" },
    { key: "totalRevenuemerchant", label: "Merchant", color: "#FFB162" },
  ];

  const W = 600, H = 220, PAD_L = 60, PAD_B = 28, PAD_T = 8, PAD_R = 8;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const rawMax = Math.max(...opsRows.map(r => ((r.totalRevenueCM || 0) + (r.totalRevenueFloor || 0) + (r.totalRevenuemerchant || 0)) / 1000));
  const niceMax = Math.ceil(rawMax / 500) * 500 || 1000;
  const tickStep = niceMax <= 2000 ? 500 : niceMax <= 5000 ? 1000 : 2000;
  const ticks = [];
  for (let t = 0; t <= niceMax; t += tickStep) ticks.push(t);
  const toSvgY = v => PAD_T + chartH - (v / niceMax) * chartH;
  const barW = Math.max(2, chartW / opsRows.length - 2);
  const barSpacing = chartW / opsRows.length;

  return (
    <div>
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
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={t === 0 ? theme.border : theme.borderSubtle} strokeWidth={t === 0 ? 1.5 : 1} />
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
        <line x1={PAD_L} x2={W - PAD_R} y1={toSvgY(0)} y2={toSvgY(0)} stroke={theme.border} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function BarChart({ rows, yKey, label, color = "#FC6A0A" }) {
  const { theme } = useTheme();
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
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        {/* Gridlines + Y labels */}
        {ticks.map(t => {
          const y = toSvgY(t);
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={t === 0 ? theme.border : theme.borderSubtle} strokeWidth={t === 0 ? 1.5 : 1} />
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
              fill={isNeg ? theme.error : color} opacity={0.85}
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
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke={theme.border} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ─── CAPEX PAGE ────────────────────────────────────────────────────────────

function CapexPage({ inp, set }) {
  const { theme } = useTheme();
  const { epcEquipment, epcServices, epcTotal, contingency, otherCosts, grandTotal, mw, mwh } = calcBessCapex(inp);
  const pct = (v) => grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(1)}%` : "—";
  const fmtGBP = (v) => `£${Math.round(v).toLocaleString()}`;

  const inputStyle = {
    width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.borderSubtle}`,
    borderRadius: 4, color: theme.textPrimary, padding: "4px 8px",
    fontSize: 11, fontFamily: "monospace", outline: "none", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
  };

  function CRow({ label, storeKey }) {
    const rate = inp[storeKey] || 0;
    const total = rate * mw;
    return (
      <tr style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
        <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>{label}</td>
        <td style={{ padding: "5px 8px" }}>
          <input type="text" inputMode="numeric" defaultValue={Math.round(rate)}
            key={`${storeKey}-${Math.round(rate)}`}
            onBlur={e => set(storeKey, parseFloat(e.target.value.replace(/,/g, "")) || 0)}
            style={inputStyle} />
        </td>
        <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center", whiteSpace: "nowrap" }}>£/MW</td>
        <td style={{ padding: "5px 8px" }}>
          <span style={{ display: "block", textAlign: "right", fontSize: 11, color: theme.textTertiary, fontFamily: "monospace", padding: "4px 8px" }}>×{mw.toFixed(1)}</span>
        </td>
        <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  function SHead({ label, total }) {
    return (
      <tr style={{ background: theme.pageBg }}>
        <td colSpan={4} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 800, color: theme.success, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</td>
        <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 800, color: theme.success, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(total)}</td>
        <td style={{ padding: "8px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(total)}</td>
      </tr>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary }}>Capital Expenditure</span>
          <span style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 12 }}>{inp.projectName} · {mw} MW · {mwh} MWh</span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total CapEx</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.warning, fontFamily: "'Inter', system-ui, sans-serif" }}>£{(grandTotal / 1e6).toFixed(2)}m</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>£ / MW</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.textSecondary, fontFamily: "'Inter', system-ui, sans-serif" }}>£{Math.round(grandTotal / mw).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "EPC Equipment", value: epcEquipment, unitValue: mw > 0 ? `£${Math.round(epcEquipment / mw / 1000)}k / MW` : null },
            { label: "EPC Services", value: epcServices, unitValue: mw > 0 ? `£${Math.round(epcServices / mw / 1000)}k / MW` : null },
            { label: "Other Costs", value: contingency + otherCosts, unitValue: null },
          ].map(({ label, value, unitValue }) => (
            <div key={label} style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: theme.success, fontFamily: "'Inter', system-ui, sans-serif" }}>£{(value / 1e6).toFixed(2)}m</span>
                {unitValue && <span style={{ fontSize: 18, fontWeight: 800, color: theme.link, fontFamily: "'Inter', system-ui, sans-serif" }}>{unitValue}</span>}
              </div>
              <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 4 }}>{pct(value)} of total</div>
            </div>
          ))}
        </div>

        {/* CapEx table */}
        <table style={{ width: "100%", borderCollapse: "collapse", background: theme.elevatedBg, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: "hidden" }}>
          <thead>
            <tr style={{ background: theme.tableLabelBg }}>
              <th style={{ padding: "8px 12px", fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, textAlign: "left" }}>Line Item</th>
              <th style={{ padding: "8px 8px", fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, textAlign: "left", width: 120 }}>Rate (£)</th>
              <th style={{ padding: "8px 8px", fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, textAlign: "center", width: 50 }}>Unit</th>
              <th style={{ padding: "8px 8px", fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, textAlign: "right", width: 70 }}>Multiplier</th>
              <th style={{ padding: "8px 12px", fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, textAlign: "right", width: 110 }}>Total Cost</th>
              <th style={{ padding: "8px 12px", fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, textAlign: "right", width: 70 }}>% of CapEx</th>
            </tr>
          </thead>
          <tbody>
            <SHead label="EPC — Battery Equipment" total={epcEquipment} />
            <CRow label="Battery Containers" storeKey="capexBatteryContainers" />
            <CRow label="PCS (Power Conversion)" storeKey="capexPCS" />
            <CRow label="Shipping" storeKey="capexShipping" />
            <CRow label="BOP (Balance of Plant)" storeKey="capexBOP" />
            <CRow label="Spare Parts" storeKey="capexSpareParts" />
            <CRow label="Installation" storeKey="capexInstallation" />
            <CRow label="EMS/SCADA" storeKey="capexEmsScada" />
            <CRow label="SSAA" storeKey="capexSSAA" />

            <SHead label="EPC — Services" total={epcServices} />
            <CRow label="Engineering & PM" storeKey="capexEngineering" />
            <CRow label="Construction Insurance" storeKey="capexConstructionInsurance" />

            {/* Contingency & Other */}
            <tr style={{ background: theme.pageBg }}>
              <td colSpan={4} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 800, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Other Costs</td>
              <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 800, color: theme.textSecondary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(contingency + otherCosts)}</td>
              <td style={{ padding: "8px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(contingency + otherCosts)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
              <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>Contingency</td>
              <td style={{ padding: "5px 8px" }}>
                <input type="text" inputMode="numeric" defaultValue={inp.capexContingencyPct}
                  key={`cont-${inp.capexContingencyPct}`}
                  onBlur={e => set("capexContingencyPct", parseFloat(e.target.value) || 0)}
                  style={inputStyle} />
              </td>
              <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center" }}>%</td>
              <td style={{ padding: "5px 8px" }}>
                <span style={{ display: "block", textAlign: "right", fontSize: 11, color: theme.textTertiary, fontFamily: "monospace", padding: "4px 8px" }}>of EPC</span>
              </td>
              <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(contingency)}</td>
              <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(contingency)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
              <td style={{ padding: "6px 12px", fontSize: 12, color: theme.textSecondary }}>Other Costs</td>
              <td style={{ padding: "5px 8px" }}>
                <input type="text" inputMode="numeric" defaultValue={Math.round(inp.capexOtherCosts)}
                  key={`other-${Math.round(inp.capexOtherCosts)}`}
                  onBlur={e => set("capexOtherCosts", parseFloat(e.target.value.replace(/,/g, "")) || 0)}
                  style={inputStyle} />
              </td>
              <td style={{ padding: "5px 8px", fontSize: 10, color: theme.textMuted, textAlign: "center" }}>Fixed</td>
              <td style={{ padding: "5px 8px" }}>
                <span style={{ display: "block", textAlign: "right", fontSize: 11, color: theme.textTertiary, fontFamily: "monospace", padding: "4px 8px" }}>×1</span>
              </td>
              <td style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right", fontFamily: "monospace" }}>{fmtGBP(otherCosts)}</td>
              <td style={{ padding: "5px 12px", fontSize: 10, color: theme.textTertiary, textAlign: "right" }}>{pct(otherCosts)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── OPEX PAGE ────────────────────────────────────────────────────────────

const PLATEAU_COLORS = ["#4A8C5C", "#A3B956", "#D4C94A", "#3A7FC2", "#2355A0", "#D45A3A"];

function OpexPage({ inp, set, setInp }) {
  const { theme } = useTheme();
  const mw = inp.storageMW || 1;
  const plateaus = inp.omPlateaus || [];

  // Calculate lifetime O&M total (£)
  const lifetimeOm = plateaus.reduce((sum, p) => {
    const years = p.endYear - p.startYear + 1;
    return sum + p.perMW * mw * years;
  }, 0);

  // Calculate common costs total (£/year)
  const commonPerYear = (inp.opexLandRent + inp.opexAssetMgmt + inp.opexInsurance + inp.opexBusinessRates + inp.opexOther) * mw;
  const lifetimeCommon = commonPerYear * (inp.assetLife || 20);

  const updatePlateau = (idx, field, value) => {
    const updated = plateaus.map((p, i) => i === idx ? { ...p, [field]: value } : { ...p });
    setInp(prev => ({ ...prev, omPlateaus: updated }));
  };

  const hdrStyle = { fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 0" };
  const cellStyle = { padding: "5px 0", fontSize: 12, color: theme.textPrimary };
  const inputSm = { background: theme.surfaceBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 5, color: theme.textPrimary, padding: "5px 7px", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box", textAlign: "right" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: theme.surfaceBg, overflowY: "auto" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg }}>
        <h2 style={{ margin: 0, fontSize: 16, color: theme.textPrimary, fontWeight: 700 }}>Operating Expenditure</h2>
        <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 3 }}>All rates are per MW — costs scale with {mw} MW capacity</div>
      </div>
      <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>

        {/* BESS O&M Plateau Table */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 12 }}>BESS O&M Schedule</div>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 68px 72px 78px 68px 62px", gap: 0, padding: "6px 10px", background: theme.textPrimary, alignItems: "center" }}>
              <div />
              <div style={{ ...hdrStyle, color: theme.border }}>Plateau</div>
              <div style={{ ...hdrStyle, color: theme.border, textAlign: "center" }}>Years</div>
              <div style={{ ...hdrStyle, color: theme.border, textAlign: "right" }}>£/MW/yr</div>
              <div style={{ ...hdrStyle, color: theme.border, textAlign: "right" }}>£/year</div>
              <div style={{ ...hdrStyle, color: theme.border, textAlign: "right" }}>Step-Up</div>
              <div style={{ ...hdrStyle, color: theme.border, textAlign: "right" }}>Duration</div>
            </div>
            {/* Plateau rows */}
            {plateaus.map((p, idx) => {
              const years = p.endYear - p.startYear + 1;
              const totalPerYear = p.perMW * mw;
              const prevRate = idx > 0 ? plateaus[idx - 1].perMW : 0;
              const stepUp = idx > 0 && prevRate > 0 ? ((p.perMW - prevRate) / prevRate * 100) : null;
              return (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "28px 1fr 68px 72px 78px 68px 62px", gap: 0, padding: "5px 10px", background: idx % 2 === 0 ? theme.surfaceBg : theme.tableLabelBg, alignItems: "center", borderTop: `1px solid ${theme.borderSubtle}` }}>
                  <div style={{ width: 14, height: 14, borderRadius: 7, background: PLATEAU_COLORS[idx] || theme.textTertiary, opacity: 0.85 }} />
                  <div style={{ ...cellStyle, fontWeight: 600, fontSize: 11 }}>{p.name}</div>
                  <div style={{ ...cellStyle, textAlign: "center", fontSize: 11, color: theme.textSecondary }}>{p.startYear === p.endYear ? p.startYear : `${p.startYear}–${p.endYear}`}</div>
                  <div style={{ padding: "3px 0" }}>
                    <input type="number" value={p.perMW} step="1"
                      onChange={e => updatePlateau(idx, "perMW", parseFloat(e.target.value) || 0)}
                      style={inputSm}
                    />
                  </div>
                  <div style={{ ...cellStyle, textAlign: "right", fontFamily: "monospace", fontSize: 11 }}>£{Math.round(totalPerYear).toLocaleString()}</div>
                  <div style={{ ...cellStyle, textAlign: "right", fontSize: 11, color: stepUp != null ? (stepUp > 15 ? theme.error : theme.success) : theme.textTertiary, fontWeight: stepUp != null ? 700 : 400 }}>
                    {stepUp != null ? `+${stepUp.toFixed(1)}%` : "—"}
                  </div>
                  <div style={{ ...cellStyle, textAlign: "right", fontSize: 11, color: theme.textSecondary }}>{years} {years === 1 ? "year" : "years"}</div>
                </div>
              );
            })}
            {/* Total row */}
            <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 68px 72px 78px 68px 62px", gap: 0, padding: "8px 10px", background: theme.textPrimary, alignItems: "center", borderTop: `1px solid ${theme.border}` }}>
              <div />
              <div style={{ fontSize: 11, color: theme.accent, fontWeight: 800, textTransform: "uppercase" }}>Lifetime O&M</div>
              <div />
              <div />
              <div style={{ textAlign: "right", fontSize: 12, fontWeight: 800, color: theme.accent, fontFamily: "monospace" }}>{fmtM(lifetimeOm)}</div>
              <div />
              <div style={{ textAlign: "right", fontSize: 11, color: theme.border }}>20 years</div>
            </div>
          </div>
        </div>

        {/* Common Costs — per MW */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 12 }}>Common Costs (£/MW/year)</div>
          <Field label="Land Rent" value={inp.opexLandRent} onChange={v => set("opexLandRent", v)} unit="£/MW" hint={`= £${Math.round(inp.opexLandRent * mw).toLocaleString()}/yr`} />
          <Field label="Asset Management" value={inp.opexAssetMgmt} onChange={v => set("opexAssetMgmt", v)} unit="£/MW" hint={`= £${Math.round(inp.opexAssetMgmt * mw).toLocaleString()}/yr`} />
          <Field label="Insurance" value={inp.opexInsurance} onChange={v => set("opexInsurance", v)} unit="£/MW" hint={`= £${Math.round(inp.opexInsurance * mw).toLocaleString()}/yr`} />
          <Field label="Business Rates" value={inp.opexBusinessRates} onChange={v => set("opexBusinessRates", v)} unit="£/MW" hint={`= £${Math.round(inp.opexBusinessRates * mw).toLocaleString()}/yr`} />
          <Field label="Other" value={inp.opexOther} onChange={v => set("opexOther", v)} unit="£/MW" hint={`= £${Math.round(inp.opexOther * mw).toLocaleString()}/yr`} />
          <div style={{ padding: "10px 12px", background: theme.pillBg, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <div style={{ fontSize: 10, color: theme.textTertiary }}>Total Common Costs</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary }}>{fmtM(commonPerYear)}/yr</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: theme.textTertiary }}>Lifetime</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: theme.textSecondary }}>{fmtM(lifetimeCommon)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Grand Total Summary */}
        <div style={{ padding: "12px 14px", background: theme.textPrimary, borderRadius: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em" }}>Total Lifetime OpEx</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: theme.accent, fontFamily: "'Inter', system-ui, sans-serif" }}>{fmtM(lifetimeOm + lifetimeCommon)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: theme.textTertiary }}>Avg £/MW/year</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.elevatedBg }}>£{Math.round((lifetimeOm + lifetimeCommon) / (inp.assetLife || 20) / mw).toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function BessApp({ session, project, onBack, embedded, fmVersion = 1 }) {
  const { theme } = useTheme();
  const [inp, setInp] = useState(BESS_DEFAULT);
  const [activeTab, setActiveTab] = useState("returns");
  const [inputSection, setInputSection] = useState("project");
  const { assumptions, bessAssumptions } = useCentralAssumptions() || {};
  const [saveStatus, setSaveStatus] = useState("saved");
  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);

  // Seed helper for new BESS projects
  function seedBessFromProject() {
    const seeded = { ...BESS_DEFAULT, omPlateaus: [...BESS_DEFAULT.omPlateaus.map(p => ({...p}))] };
    if (project.name) seeded.projectName = project.name;
    if (project.capacity_mwp) seeded.storageMW = project.capacity_mwp;
    if (project.cod) {
      const codDate = new Date(project.cod);
      if (!isNaN(codDate)) {
        seeded.cod = project.cod;
        const conStart = new Date(codDate);
        conStart.setMonth(conStart.getMonth() - seeded.constructionMonths);
        const modelStart = new Date(conStart);
        modelStart.setMonth(modelStart.getMonth() - 2);
        const fc = new Date(conStart);
        seeded.modelStart = modelStart.toISOString().slice(0, 10);
        seeded.financialClose = fc.toISOString().slice(0, 10);
      }
    }
    if (bessAssumptions?.omPlateaus) {
      seeded.omPlateaus = bessAssumptions.omPlateaus.map(p => ({ ...p }));
    }
    return seeded;
  }

  function migrateLoadedInputs(raw) {
    const loaded = { ...BESS_DEFAULT, ...raw };
    if (!raw.omPlateaus) {
      loaded.omPlateaus = [...BESS_DEFAULT.omPlateaus.map(p => ({...p}))];
    }
    const maxCommon = Math.max(loaded.opexLandRent || 0, loaded.opexAssetMgmt || 0, loaded.opexInsurance || 0, loaded.opexBusinessRates || 0);
    if (maxCommon > 5000) {
      loaded.opexLandRent = BESS_DEFAULT.opexLandRent;
      loaded.opexAssetMgmt = BESS_DEFAULT.opexAssetMgmt;
      loaded.opexInsurance = BESS_DEFAULT.opexInsurance;
      loaded.opexBusinessRates = BESS_DEFAULT.opexBusinessRates;
      loaded.opexOther = BESS_DEFAULT.opexOther;
    }
    const capexFields = ['capexBatteryContainers', 'capexPCS', 'capexBOP', 'capexInstallation', 'capexEngineering'];
    const maxCapex = Math.max(...capexFields.map(f => loaded[f] || 0));
    if (maxCapex > 500000) {
      const allCapexKeys = Object.keys(BESS_DEFAULT).filter(k => k.startsWith('capex'));
      allCapexKeys.forEach(k => { loaded[k] = BESS_DEFAULT[k]; });
    }
    return loaded;
  }

  // Load saved inputs for the requested FM version
  useEffect(() => {
    if (!project) return;
    initialLoadDone.current = false;
    const loadInputs = async () => {
      const { data: rows } = await supabase
        .from("project_inputs")
        .select("inputs")
        .eq("project_id", project.id)
        .eq("version", fmVersion)
        .limit(1);
      const data = rows?.[0] || null;

      if (data?.inputs) {
        setInp(migrateLoadedInputs(data.inputs));
      } else if (fmVersion > 1) {
        // Pre-populate from previous version
        const { data: prevRows } = await supabase
          .from("project_inputs")
          .select("inputs")
          .eq("project_id", project.id)
          .eq("version", fmVersion - 1)
          .limit(1);
        if (prevRows?.[0]?.inputs) {
          setInp(migrateLoadedInputs(prevRows[0].inputs));
        } else {
          setInp(seedBessFromProject());
        }
      } else {
        setInp(seedBessFromProject());
      }
      initialLoadDone.current = true;
    };
    loadInputs();
  }, [project?.id, fmVersion]);

  // Auto-save inputs (only after initial load)
  useEffect(() => {
    if (!project || !session) return;
    if (!initialLoadDone.current) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // Check if this FM version already exists (preserve original creation date)
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
      if (isNew) {
        upsertPayload.fm_created_at = new Date().toISOString();
      }

      const { data: inputData } = await supabase
        .from("project_inputs")
        .upsert(upsertPayload, { onConflict: "project_id,version", ignoreDuplicates: false })
        .select().single();

      if (fmVersion === 1) {
        await supabase.from("projects").update({
          name: inp.projectName,
          capacity_mwp: inp.storageMW,
          cod: inp.cod,
        }).eq("id", project.id);
      }

      if (inputData) {
        try {
          const res = runBessDCF(inp);
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
              cfd_rev: k.totalCMRev,
              ppa_rev: k.totalFloorRev,
              merchant_rev: k.totalMerchantRev,
              rego_rev: 0,
              total_distributions: k.totalDistributions,
            }, { onConflict: "project_id,fm_version" });
          }
        } catch(e) { console.error("BESS model run save error:", e); }
      }
      setSaveStatus("saved");
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [inp]);

  const set = useCallback((key, val) => setInp(prev => ({ ...prev, [key]: val })), []);

  const effectiveInp = useMemo(() => {
    const base = { ...inp };
    if (bessAssumptions) {
      base._bessCentralCurve = bessAssumptions.merchant?.central || null;
      base._bessHighCurve = bessAssumptions.merchant?.high || null;
      base._bessLowCurve = bessAssumptions.merchant?.low || null;
      base._degradationCurve = bessAssumptions.degradation || null;
    }
    return base;
  }, [inp, bessAssumptions]);

  const result = useMemo(() => { try { return runBessDCF(effectiveInp); } catch(e) { console.error("runBessDCF error:", e?.message); return null; } }, [effectiveInp]);
  const K = result?.kpis;
  const annual = result?.annualRows || [];
  const monthly = result?.periods || [];
  const inp_display = effectiveInp;

  const inputSections = ["project", "technical", "capex", "opex", "revenue", "debt", "tax"];
  const isCapex = inputSection === "capex";
  const isOpex = inputSection === "opex";

  return (
    <div style={{ display: "flex", height: embedded ? "100%" : "100vh", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary, overflow: "hidden", flex: embedded ? 1 : undefined }}>

      {/* LEFT NAV */}
      <div style={{ width: 48, background: theme.pageBg, borderRight: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 16, gap: 4, flexShrink: 0 }}>
        {!embedded && onBack && (
          <div onClick={onBack} title="Back to Portfolio" style={{ width: 34, height: 34, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: theme.textTertiary, marginBottom: 4 }}>←</div>
        )}
        {!embedded && <div style={{ marginBottom: 8 }}><FuseLogo size={32} /></div>}
        {inputSections.map(s => (
          <div key={s} onClick={() => setInputSection(s)} title={s} style={{
            width: 34, height: 34, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            background: inputSection === s ? theme.hoverBg : "transparent",
            border: inputSection === s ? `1px solid ${theme.border}` : "1px solid transparent",
            fontSize: 10, fontWeight: 700, color: inputSection === s ? theme.success : theme.textTertiary,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>{s.slice(0, 3)}</div>
        ))}
        <div style={{ marginTop: "auto", marginBottom: 16, fontSize: 8, color: saveStatus === "saved" ? theme.success : saveStatus === "saving" ? theme.warning : theme.error, textTransform: "uppercase", letterSpacing: "0.05em", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving..." : "Error"}
        </div>
      </div>

      {/* CAPEX FULL PAGE */}
      {isCapex && <CapexPage inp={inp} set={set} assumptions={assumptions} />}

      {/* OPEX FULL PAGE */}
      {isOpex && <OpexPage inp={inp} set={set} setInp={setInp} />}

      {/* INPUT PANEL & RESULTS */}
      {!isCapex && !isOpex && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Input panel */}
          <div style={{ width: 320, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", flexShrink: 0, padding: "12px 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, marginBottom: 12, paddingLeft: 4, textTransform: "capitalize" }}>{inputSection}</div>

            {inputSection === "project" && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Project Name</label>
                  <input value={inp.projectName} onChange={e => set("projectName", e.target.value)}
                    style={{ width: "100%", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                </div>
                <Field label="Model Start Date" value={inp.modelStart} onChange={v => set("modelStart", v)} type="date" />
                <Field label="Financial Close" value={inp.financialClose} onChange={v => set("financialClose", v)} type="date" />
                <Field label="COD" value={inp.cod} onChange={v => set("cod", v)} type="date" />
                <Field label="Construction Duration" value={inp.constructionMonths} onChange={v => set("constructionMonths", Math.max(1, Math.round(v)))} unit="months" step="1" min="1" />
                <Field label="Asset Life" value={inp.assetLife} onChange={v => set("assetLife", v)} unit="years" step="1" min="1" />
                <Field label="Discount Rate" value={inp.discountRate} onChange={v => set("discountRate", v)} unit="%" step="0.1" />
                <Field label="CPI Inflation" value={inp.cpi} onChange={v => set("cpi", v)} unit="%" step="0.05" />
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${theme.borderSubtle}` }}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 10 }}>Bid</div>
                  <Field label="Bid Rate" value={inp.bidPerMW / 1000} onChange={v => set("bidPerMW", Math.round(v * 1000))} unit="£k/MW" step="1" min="0" />
                </div>
              </>
            )}

            {inputSection === "technical" && (
              <>
                <Field label="Storage Capacity" value={inp.storageMW} onChange={v => set("storageMW", v)} unit="MW" step="0.1" />
                <Field label="Storage Duration" value={inp.storageHours} onChange={v => set("storageHours", v)} unit="hours" step="0.1" />
                <Field label="Cycles Per Day" value={inp.cyclesPerDay} onChange={v => set("cyclesPerDay", v)} unit="cycles" step="0.1" />
                <Field label="Initial Oversizing" value={inp.initialOversizing} onChange={v => set("initialOversizing", v)} unit="%" step="0.1" />
                <Field label="Round Trip Efficiency" value={inp.roundTripEfficiency} onChange={v => set("roundTripEfficiency", v)} unit="%" step="0.1" />
                <Field label="Availability" value={inp.availability} onChange={v => set("availability", v)} unit="%" step="0.1" />
                <Field label="Annual Degradation" value={inp.degradation} onChange={v => set("degradation", v)} unit="% p.a." step="0.01" />
                {(() => {
                  const installedMWh = inp.storageMW * inp.storageHours * (1 + inp.initialOversizing / 100);
                  const usableMWh = inp.storageMW * inp.storageHours;
                  const annualMWh = usableMWh * inp.cyclesPerDay * 365 * (inp.availability / 100) * (inp.roundTripEfficiency / 100);
                  return (
                    <div style={{ padding: "10px 12px", background: theme.pillBg, borderRadius: 8, border: `1px solid ${theme.border}` }}>
                      <div style={{ fontSize: 9, color: theme.textTertiary, marginBottom: 3 }}>Installed Capacity</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: theme.textPrimary, marginBottom: 8 }}>{installedMWh.toFixed(1)} MWh</div>
                      <div style={{ fontSize: 9, color: theme.textTertiary, marginBottom: 3 }}>Usable Capacity</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: theme.textPrimary, marginBottom: 8 }}>{usableMWh.toFixed(1)} MWh</div>
                      <div style={{ fontSize: 9, color: theme.textTertiary, marginBottom: 3 }}>Annual Dispatch (Y1)</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: theme.success }}>{annualMWh.toFixed(0)} MWh</div>
                    </div>
                  );
                })()}
              </>
            )}

            {inputSection === "revenue" && (
              <>
                {/* Revenue allocation summary */}
                {(() => {
                  const cmActive = inp.cmActive ? 33 : 0;
                  const floorActive = inp.floorActive ? 33 : 0;
                  const merchantActive = inp.merchantActive ? Math.max(0, 100 - cmActive - floorActive) : 0;

                  return (
                    <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>Revenue Allocation</div>
                      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                        {cmActive > 0 && <div style={{ width: `${cmActive}%`, background: "#4A8C5C" }} />}
                        {floorActive > 0 && <div style={{ width: `${floorActive}%`, background: "#7A8A96" }} />}
                        {merchantActive > 0 && <div style={{ width: `${merchantActive}%`, background: "#FFB162" }} />}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#4A8C5C", fontWeight: 700 }}>Capacity Market</span>
                          <span style={{ color: theme.textTertiary }}>{cmActive}%</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#7A8A96", fontWeight: 700 }}>Floor/Tolling</span>
                          <span style={{ color: theme.textTertiary }}>{floorActive}%</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#FFB162", fontWeight: 700 }}>Merchant</span>
                          <span style={{ color: theme.textTertiary }}>{merchantActive}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Capacity Market */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.border}` }}>Capacity Market</div>
                  <Toggle label="CM Active" value={inp.cmActive} onChange={v => set("cmActive", v)} />
                  {inp.cmActive && <>
                    <Field label="Start Date" value={inp.cmStartDate} onChange={v => set("cmStartDate", v)} type="date" />
                    <Field label="Term" value={inp.cmTerm} onChange={v => set("cmTerm", v)} unit="years" step="1" />
                    <Field label="Price" value={inp.cmPrice} onChange={v => set("cmPrice", v)} unit="£k/MW" step="0.1" />
                    <Toggle label="Escalation (CPI)" value={inp.cmEscalation} onChange={v => set("cmEscalation", v)} />
                  </>}
                </div>

                {/* Floor/Tolling */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.border}` }}>Floor/Tolling</div>
                  <Toggle label="Floor Active" value={inp.floorActive} onChange={v => set("floorActive", v)} />
                  {inp.floorActive && <>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Type</label>
                      <select value={inp.floorType} onChange={e => set("floorType", parseInt(e.target.value))}
                        style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}>
                        <option value={0}>Tolling (Fixed MW × Price)</option>
                        <option value={1}>Floor (MAX(Floor, Merchant))</option>
                      </select>
                    </div>
                    <Field label="Start Date" value={inp.floorStartDate} onChange={v => set("floorStartDate", v)} type="date" />
                    <Field label="Term" value={inp.floorTerm} onChange={v => set("floorTerm", v)} unit="years" step="1" />
                    <Field label="Price" value={inp.floorPrice} onChange={v => set("floorPrice", v)} unit="£k/MW" step="0.1" />
                    <Toggle label="Escalation (CPI)" value={inp.floorEscalation} onChange={v => set("floorEscalation", v)} />
                  </>}
                </div>

                {/* Merchant */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${theme.border}` }}>Merchant</div>
                  <Toggle label="Merchant Active" value={inp.merchantActive} onChange={v => set("merchantActive", v)} />
                  {inp.merchantActive && <>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Scenario</label>
                      <select value={inp.merchantScenario} onChange={e => set("merchantScenario", e.target.value)}
                        style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box" }}>
                        <option value="high">High</option>
                        <option value="central">Central</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <Field label="Discount (Route to Market)" value={inp.merchantDiscount} onChange={v => set("merchantDiscount", v)} unit="%" step="0.1" />
                  </>}
                </div>
              </>
            )}

            {inputSection === "debt" && (
              <>
                <Toggle label="Debt Active" value={inp.debtActive} onChange={v => set("debtActive", v)} />
                {inp.debtActive && <>
                  <Field label="Gearing" value={inp.gearing} onChange={v => set("gearing", v)} unit="%" step="1" />
                  <Field label="Construction Interest Rate" value={inp.interestCon} onChange={v => set("interestCon", v)} unit="%" step="0.1" />
                  <Field label="Operations Interest Rate" value={inp.interestOps} onChange={v => set("interestOps", v)} unit="%" step="0.1" />
                  <Field label="Debt Tenor" value={inp.debtTenor} onChange={v => set("debtTenor", v)} unit="years" step="1" />
                  <Field label="Arrangement Fee" value={inp.arrangementFee} onChange={v => set("arrangementFee", v)} unit="%" step="0.1" />
                  <Toggle label="DSRA Active" value={inp.dsraActive} onChange={v => set("dsraActive", v)} />
                  {inp.dsraActive && <>
                    <Field label="DSRA Months" value={inp.dsraMonths} onChange={v => set("dsraMonths", v)} unit="months" step="1" />
                    <Field label="Minimum Cash" value={inp.minCash} onChange={v => set("minCash", v)} unit="£" step="1000" />
                  </>}
                </>}
              </>
            )}

            {inputSection === "tax" && (
              <>
                <Field label="Corporate Tax Rate" value={inp.corpTax} onChange={v => set("corpTax", v)} unit="%" step="0.1" />
                <Field label="Capital Allowance Rate" value={inp.capAllowRate} onChange={v => set("capAllowRate", v)} unit="% p.a." step="0.1" />
              </>
            )}
          </div>

          {/* RESULTS PANEL */}
          <div style={{ flex: 1, background: theme.surfaceBg, borderLeft: `1px solid ${theme.border}`, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
              {["returns", "model", "summary"].map(t => (
                <div key={t} onClick={() => setActiveTab(t)} style={{
                  flex: 1, padding: "12px 16px", textAlign: "center", cursor: "pointer",
                  borderBottom: activeTab === t ? `2px solid ${theme.accent}` : "none",
                  color: activeTab === t ? theme.accent : theme.textTertiary,
                  fontSize: 12, fontWeight: activeTab === t ? 700 : 500,
                  textTransform: "capitalize"
                }}>{t}</div>
              ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
              {!result && <div style={{ color: theme.textTertiary }}>Running calculations...</div>}

              {result && activeTab === "returns" && K && (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                    <KPI label="Project IRR" value={fmtPct(K.projectIRR)} size={22} />
                    <KPI label="Equity IRR" value={fmtPct(K.equityIRR)} size={22} />
                    <KPI label="Project NPV" value={fmtM(K.projectNPV * 1000)} size={18} />
                    <KPI label="Equity NPV" value={fmtM(K.equityNPV * 1000)} size={18} />
                    <KPI label="Total CapEx" value={fmtM(K.totalCapex * 1000)} size={16} />
                    <KPI label="Gearing" value={fmtPct(K.gearing, 1)} size={16} />
                    <KPI label="Min DSCR" value={K.minDSCR ? `${K.minDSCR.toFixed(2)}x` : "—"} size={16} />
                    <KPI label="Total Distributions" value={fmtM(K.totalDistributions * 1000)} size={16} />
                  </div>

                  {/* P&L */}
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: theme.textPrimary }}>Lifetime P&L (£k)</h3>
                    <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 0" }}>
                      {[
                        ["Total Revenue", K.totalRevenue, "#4A8C5C"],
                        ["  ∟ Capacity Market", K.totalCMRev, "#4A8C5C"],
                        ["  ∟ Floor/Tolling", K.totalFloorRev, "#7A8A96"],
                        ["  ∟ Merchant", K.totalMerchantRev, "#FFB162"],
                        ["Total OpEx", -K.totalOpex, theme.error],
                        ["EBITDA", K.totalEBITDA, K.totalEBITDA >= 0 ? theme.textPrimary : theme.error],
                        ["Tax", -K.totalTax, theme.error],
                        ["Debt Service", -K.totalDebtService, theme.error],
                      ].map(([label, value, color]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 16px", borderBottom: `1px solid ${theme.borderSubtle}`, fontSize: 12 }}>
                          <span style={{ color: theme.textTertiary }}>{label}</span>
                          <span style={{ color, fontFamily: "monospace", fontWeight: 600 }}>{fmtM(value * 1000)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Revenue chart */}
                  {annual.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Annual Revenue by Source (£'000s)</div>
                      <StackedRevenueChart rows={annual} />
                    </div>
                  )}

                  {/* Equity CF chart */}
                  {monthly.filter(p => p.isOps).length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Equity Cash Flow (£'000s)</div>
                      <BarChart rows={annual} yKey="equityFCF" label="Equity CF" color="#4A8C5C" />
                    </div>
                  )}
                </div>
              )}

              {result && activeTab === "model" && monthly.length > 0 && (() => {
                const LABEL_W = 220;
                const COL_W = 72;
                const ROW_H = 28;
                const HEADER_H = 52;

                const fk = (v) => {
                  const k = v / 1000;
                  if (Math.abs(k) < 0.05) return "—";
                  return k < 0 ? `(${Math.abs(k).toFixed(0)})` : k.toFixed(0);
                };
                const fmwh = (v) => Math.abs(v) < 0.05 ? "—" : v.toFixed(0);

                const modelRows = [
                  { label: "DISPATCH", variant: "section" },
                  { label: "Energy Dispatch (MWh)", key: "disp", fmt: fmwh, get: p => p.dispatchableMWh },

                  { label: "REVENUE", variant: "section" },
                  { label: "Capacity Market", key: "cm", fmt: fk, get: p => p.revenueCM },
                  { label: "Floor/Tolling", key: "floor", fmt: fk, get: p => p.revenueFloor },
                  { label: "Merchant", key: "merch", fmt: fk, get: p => p.revenueMerchant },
                  { label: "Total Revenue", key: "rev", fmt: fk, get: p => p.totalRevenue, variant: "subtotal" },

                  { label: "COSTS", variant: "section" },
                  { label: "BESS O&M", key: "opBess", fmt: fk, get: p => -p.bessOmCost },
                  { label: "Other OpEx", key: "opOther", fmt: fk, get: p => -p.otherOpexCost },
                  { label: "Total Operating Costs", key: "opex", fmt: fk, get: p => -p.opex, variant: "subtotal" },
                  { label: "EBITDA", key: "ebitda", fmt: fk, get: p => p.ebitda, variant: "subtotal" },

                  { label: "CAPITAL", variant: "section" },
                  { label: "Capital Expenditure", key: "capex", fmt: fk, get: p => -p.capex },
                  { label: "Capital Allowances", key: "ca", fmt: fk, get: p => -p.depreciation },

                  { label: "TAX", variant: "section" },
                  { label: "Corporation Tax", key: "tax", fmt: fk, get: p => -p.tax },

                  { label: "UNLEVERED FCF", key: "ufcf", fmt: fk, get: p => p.unleveredFCF, variant: "total" },

                  { label: "DEBT", variant: "section" },
                  { label: "Debt Drawdown", key: "draw", fmt: fk, get: p => p.debtDraw },
                  { label: "Interest", key: "int", fmt: fk, get: p => -p.interest },
                  { label: "Principal Repayment", key: "princ", fmt: fk, get: p => -p.principal },
                  { label: "Total Debt Service", key: "ds", fmt: fk, get: p => -(p.interest + p.principal), variant: "subtotal" },
                  { label: "DSRA Movement", key: "dsra", fmt: fk, get: p => p.dsraDrawdown - p.dsraFunding },

                  { label: "FCFE (Equity Cash Flow)", key: "fcfe", fmt: fk, get: p => p.equityFCF, variant: "total" },
                ];

                const STYLE = {
                  section:  { background: theme.textPrimary, color: theme.pageBg, fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.09em", paddingLeft: 12 },
                  subtotal: { background: theme.pillBg, color: theme.textPrimary, fontWeight: 700, borderTop: `1px solid ${theme.border}`, paddingLeft: 16 },
                  total:    { background: theme.textPrimary, color: theme.warning, fontWeight: 800, fontSize: 12, paddingLeft: 12 },
                  normal:   { background: "transparent", color: theme.textSecondary, fontWeight: 400, paddingLeft: 20 },
                };

                const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

                return (
                  <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "8px 16px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary }}>Monthly Financial Model</div>
                      <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Revenue & costs in £&apos;000s · Dispatch in MWh</div>
                    </div>
                    <div style={{ display: "flex", overflow: "hidden" }}>
                      {/* Frozen label column */}
                      <div style={{ flexShrink: 0, width: LABEL_W, borderRight: `2px solid ${theme.border}`, zIndex: 2 }}>
                        <div style={{ height: HEADER_H, background: theme.pillBg, borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "flex-end", padding: "0 12px 8px", fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                          Line Item
                        </div>
                        {modelRows.map((row, ri) => {
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
                            const pMonth = p.date.getMonth();
                            const isFirstOfYear = pMonth === 0;
                            const isCODMonth = !p.isOps && monthly[ci + 1]?.isOps;
                            const colBg = !p.isOps ? theme.hoverBg : "transparent";
                            return (
                              <div key={ci} style={{ flexShrink: 0, width: COL_W, borderRight: isFirstOfYear ? `1px solid ${theme.border}` : `1px solid ${theme.borderSubtle}` }}>
                                <div style={{ height: HEADER_H, background: p.isOps ? theme.pillBg : theme.hoverBg, borderBottom: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", padding: "0 0 6px" }}>
                                  {isFirstOfYear && <div style={{ fontSize: 8, color: theme.textTertiary, fontWeight: 700, marginBottom: 2 }}>{p.year}</div>}
                                  <div style={{ fontSize: 9, color: p.isOps ? theme.textPrimary : theme.textTertiary, fontWeight: p.isOps ? 600 : 400 }}>{monthNames[pMonth]}</div>
                                  {isCODMonth && <div style={{ fontSize: 7, color: theme.accent, fontWeight: 700, textTransform: "uppercase" }}>COD→</div>}
                                </div>
                                {modelRows.map((row, ri) => {
                                  if (row.variant === "section") {
                                    return <div key={ri} style={{ height: ROW_H, background: theme.textPrimary, borderBottom: `1px solid ${theme.borderSubtle}` }} />;
                                  }
                                  const raw = row.get(p);
                                  const formatted = (row.fmt || fk)(raw);
                                  const s = STYLE[row.variant || "normal"];
                                  const isNeg = typeof raw === "number" && raw < -0.05;
                                  const isPos = typeof raw === "number" && raw > 0.05;
                                  const numColor = row.variant === "total" ? theme.warning
                                    : row.variant === "subtotal" ? (isNeg ? theme.error : isPos ? theme.textPrimary : theme.textTertiary)
                                    : isNeg ? theme.error : isPos ? theme.success : theme.border;
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
                    { title: "Project", color: theme.accent, items: [["Name", inp.projectName], ["Technology", "BESS"], ["Capacity", `${inp.storageMW} MW × ${inp.storageHours}h`], ["COD", inp.cod], ["Asset Life", `${inp.assetLife} years`]] },
                    { title: "Returns", color: theme.success, items: [["Project IRR", fmtPct(K.projectIRR)], ["Equity IRR", fmtPct(K.equityIRR)], ["Project NPV", fmtM(K.projectNPV * 1000)], ["Equity NPV", fmtM(K.equityNPV * 1000)], ["Min DSCR", K.minDSCR ? `${K.minDSCR.toFixed(2)}x` : "—"]] },
                    { title: "Capital Structure", color: theme.warning, items: [["Total CapEx", fmtM(K.totalCapex * 1000)], ["Senior Debt", fmtM((K.totalCapex * K.gearing / 100) * 1000)], ["Equity", fmtM(K.equityInvestment * 1000)], ["Gearing", fmtPct(K.gearing, 1)], ["Debt Tenor", `${inp.debtTenor} years`]] },
                    { title: "Lifetime Financials", color: theme.textSecondary, items: [["Total Revenue", fmtM(K.totalRevenue * 1000)], ["Total OpEx", fmtM(K.totalOpex * 1000)], ["Total EBITDA", fmtM(K.totalEBITDA * 1000)], ["Total Debt Service", fmtM(K.totalDebtService * 1000)], ["Total Tax", fmtM(K.totalTax * 1000)]] },
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
        </div>
      )}
    </div>
  );
}
