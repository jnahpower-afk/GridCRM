// ─── SOLAR DCF ENGINE ─────────────────────────────────────────────────────────
// Pure functions — no React, no side effects. Shared by App.jsx and ModelWorkings.jsx

export function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
export function monthDiff(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
export function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
export function computeIRR(cashflows, guess = 0.08) {
  // Newton-Raphson requires at least one sign change for a real IRR
  const hasNeg = cashflows.some(v => v < 0);
  const hasPos = cashflows.some(v => v > 0);
  if (!hasNeg || !hasPos) return null;

  const maxIter = 200; const tol = 1e-8;
  let rate = guess / 12;
  for (let i = 0; i < maxIter; i++) {
    if (!isFinite(rate)) return null; // diverged — no real IRR
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const v = Math.pow(1 + rate, t);
      npv += cashflows[t] / v;
      dnpv -= t * cashflows[t] / (v * (1 + rate));
    }
    if (Math.abs(dnpv) < 1e-12) break;
    const nr = rate - npv / dnpv;
    if (Math.abs(nr - rate) < tol) { rate = nr; break; }
    rate = nr;
  }
  const result = Math.pow(1 + rate, 12) - 1;
  return isFinite(result) ? result : null;
}
export function computeNPV(cashflows, annualRate) {
  const mr = Math.pow(1 + annualRate, 1 / 12) - 1;
  return cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + mr, t), 0);
}
export const SEASONALITY = {
  0: 0.035, 1: 0.050, 2: 0.080, 3: 0.105, 4: 0.130, 5: 0.135,
  6: 0.130, 7: 0.115, 8: 0.090, 9: 0.065, 10: 0.040, 11: 0.025,
};

export function calcCapexTotals(inp) {
  const epcEquipment = inp.epcModules + inp.epcInverters + inp.epcTxStations + inp.epcMountingStructure +
    inp.epcPpcScada + inp.epcCctvSecurity + inp.epcSparesContainer + inp.epcCables + inp.epcSubstation + inp.epcContingencies;
  const epcServices = inp.svcElectrical + inp.svcMechanical + inp.svcCivil + inp.svcTestStudies +
    inp.svcEngineering + inp.svcLandscaping + inp.svcLaydown;
  const epcBase = epcEquipment + epcServices;
  const epcTotal = epcBase * (1 + inp.epcMarginPct / 100);
  const gridTotal = inp.gridCableRun + inp.gridCustomerSubstation + inp.gridContestable + inp.gridNonContestable;
  const otherTotal = inp.landLease + inp.constructionInsurance + inp.preCon + inp.acquisition + inp.ddCosts;
  const grandTotal = epcTotal + gridTotal + otherTotal;
  return { epcEquipment, epcServices, epcBase, epcTotal, gridTotal, otherTotal, grandTotal };
}

export const MERCHANT_HIGH    = [101.2, 96.6, 97.0, 94.0, 89.6, 82.7, 77.8, 74.0, 73.0, 72.9, 75.7, 74.8, 71.4, 71.8, 69.6, 68.0, 66.6, 62.9, 63.2, 62.7, 60.9, 60.1, 60.2, 60.5, 61.0, 60.7, 60.5, 60.2, 60.2, 62.0, 62.1, 61.7, 61.4, 61.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1, 60.1];
export const MERCHANT_CENTRAL = [58.9, 54.1, 59.6, 61.9, 64.7, 63.8, 59.9, 58.5, 58.4, 59.5, 61.6, 62.1, 60.4, 60.1, 58.7, 56.9, 55.8, 53.7, 53.7, 52.8, 51.0, 50.3, 50.0, 50.6, 50.3, 50.7, 50.0, 49.9, 50.5, 51.2, 50.6, 49.5, 48.1, 47.2, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5, 45.5];
export const MERCHANT_LOW     = [38.7, 35.7, 40.7, 44.1, 46.4, 46.4, 43.3, 42.7, 42.6, 42.4, 42.7, 42.7, 42.1, 41.7, 40.7, 40.1, 39.0, 37.5, 37.1, 36.5, 35.3, 34.3, 33.7, 34.0, 34.0, 35.1, 35.9, 36.8, 37.5, 38.9, 39.0, 39.4, 38.6, 38.7, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6, 38.6];
export const REGO_AURORA      = [1.0, 0.9, 0.8, 0.8, 0.7, 0.8, 0.8, 0.8, 0.8, 0.9, 0.9, 1.0, 1.1, 1.1, 1.2, 1.3, 1.3, 1.3, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3];
export const REGO_POWER       = [7.5, 7.5, 7.5, 7.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

export function runDCF(inp) {
  const modelStart = new Date(inp.modelStart && inp.modelStart.length === 7 ? inp.modelStart + "-01" : inp.modelStart);
  const cod = new Date(inp.cod && inp.cod.length === 7 ? inp.cod + "-01" : inp.cod);
  const constructionStart = addMonths(cod, -inp.constructionMonths);
  const projectEnd = addMonths(cod, inp.assetLife * 12);
  const totalMonths = monthDiff(modelStart, projectEnd);
  if (totalMonths <= 0 || totalMonths > 600) return null;

  const monthlyRateCpi = Math.pow(1 + inp.cpi / 100, 1 / 12) - 1;
  const cpiBase = new Date(inp.modelStart && inp.modelStart.length === 7 ? inp.modelStart + "-01" : inp.modelStart);

  const { grandTotal: totalCapex, epcTotal, gridTotal } = calcCapexTotals(inp);
  const debtAmount = inp.debtActive ? totalCapex * (inp.gearing / 100) : 0;
  const equityAmount = totalCapex - debtAmount;
  const arrangementFee = inp.debtActive ? debtAmount * (inp.arrangementFee / 100) : 0;
  const debtTenorMonths = inp.debtTenor * 12;
  const monthlyPrincipal = inp.debtActive ? debtAmount / debtTenorMonths : 0;

  const mergeCurve = (sheets, hardcoded) => {
    if (!Array.isArray(sheets) || sheets.length === 0) return hardcoded;
    return hardcoded.map((hv, i) => {
      const sv = i < sheets.length ? sheets[i] : 0;
      return sv !== 0 ? sv : hv;
    });
  };

  const getMerchantPrice = (year) => {
    const idx = year - 2026;
    const curves = {
      high:    mergeCurve(inp._merchantHigh,    MERCHANT_HIGH),
      central: mergeCurve(inp._merchantCentral, MERCHANT_CENTRAL),
      low:     mergeCurve(inp._merchantLow,     MERCHANT_LOW),
    };
    const p = curves[inp.merchantScenario] || curves.central;
    return idx < 0 ? p[0] : idx >= p.length ? p[p.length - 1] : p[idx];
  };
  const getREGOPrice = (year) => {
    const idx = year - 2026;
    const aurora = mergeCurve(inp._regoAurora, REGO_AURORA);
    const power  = mergeCurve(inp._regoPower,  REGO_POWER);
    const p = inp.regoScenario === "power" ? power : aurora;
    return idx < 0 ? p[0] : idx >= p.length ? p[p.length - 1] : p[idx];
  };

  const periods = [];
  let debtOutstanding = 0;

  let gpPoolBalance  = totalCapex * (inp.capAllowGPPct / 100);
  let srpPoolBalance = totalCapex * (inp.capAllowSRPPct / 100);
  const sbaPoolInitial = totalCapex * (inp.capAllowSBAPct / 100);
  let sbaPoolBalance = sbaPoolInitial;
  const gpMonthlyRate  = 1 - Math.pow(1 - inp.capAllowGPRate / 100, 1 / 12);
  const srpMonthlyRate = 1 - Math.pow(1 - inp.capAllowSRPRate / 100, 1 / 12);
  const sbaMonthlyAllow = sbaPoolInitial * (inp.capAllowSBARate / 100) / 12;

  let taxLossesCarryForward = 0;

  const monthlyPrincipalAtCOD = inp.debtActive ? debtAmount / debtTenorMonths : 0;
  const monthlyInterestAtCOD  = inp.debtActive ? debtAmount * (inp.interestOps / 100) / 12 : 0;
  const dsraTarget = inp.debtActive && inp.dsraActive
    ? (monthlyPrincipalAtCOD + monthlyInterestAtCOD) * inp.dsraMonths
    : 0;
  let dsraBalance = 0;
  let dsraFunded  = false;

  let opYear = 0;
  const unleveredCFs = [];
  const equityCFs = [];

  const conMonths = Math.max(1, monthDiff(constructionStart, cod));
  const constructionCapexPerMonth = (epcTotal + gridTotal + inp.landLease + inp.constructionInsurance + inp.preCon) / conMonths;

  for (let m = 0; m < totalMonths; m++) {
    const periodStart = addMonths(modelStart, m);
    const year = periodStart.getFullYear();
    const month = periodStart.getMonth();
    const cpiMonths = monthDiff(cpiBase, periodStart);
    const cpiIndex = Math.pow(1 + monthlyRateCpi, cpiMonths);

    const isPreCOD = periodStart < cod;
    const isConstruction = periodStart >= constructionStart && isPreCOD;
    const isFinClose = monthDiff(modelStart, periodStart) === monthDiff(modelStart, new Date(inp.financialClose && inp.financialClose.length === 7 ? inp.financialClose + "-01" : inp.financialClose));
    const isOps = !isPreCOD;

    if (isOps) opYear = Math.floor(monthDiff(cod, periodStart) / 12) + 1;

    let capexThisPeriod = 0;
    if (isFinClose) capexThisPeriod += inp.acquisition + inp.ddCosts;
    if (isConstruction) capexThisPeriod += constructionCapexPerMonth;

    let debtDraw = 0;
    if (inp.debtActive && (isConstruction || isFinClose)) {
      debtDraw = capexThisPeriod * (inp.gearing / 100);
      debtOutstanding += debtDraw;
    }

    let interestCharge = 0;
    if (inp.debtActive && debtOutstanding > 0) {
      const rate = isPreCOD ? inp.interestCon / 100 : inp.interestOps / 100;
      interestCharge = debtOutstanding * (rate / 12);
    }

    let principalRepayment = 0;
    if (inp.debtActive && isOps && debtOutstanding > 0) {
      principalRepayment = Math.min(monthlyPrincipal, debtOutstanding);
      debtOutstanding = Math.max(0, debtOutstanding - principalRepayment);
    }

    let revenue = 0, cfdRevenue = 0, ppaRevenue = 0, regoRevenue = 0, merchantRevenue = 0;
    let genMWh = 0;
    if (isOps) {
      const degFactor = Math.pow(1 - inp.degradation / 100, opYear - 1);
      const monthPct = SEASONALITY[month] ?? (1 / 12);
      const annualGen = inp.capacity * inp.yield_ * (inp.availability / 100) * (1 - inp.curtailment / 100);
      genMWh = annualGen * monthPct * degFactor;
      const baseMerchantPrice = inp.merchantActive ? getMerchantPrice(year) * cpiIndex : 0;
      const merchantPrice = baseMerchantPrice;
      const regoPrice = getREGOPrice(year) * cpiIndex;
      const cfdIndexBase = new Date(inp.cfdIndexBase && inp.cfdIndexBase.length === 7 ? inp.cfdIndexBase + "-01" : inp.cfdIndexBase);
      const cfdCpiMonths = monthDiff(cfdIndexBase, periodStart);
      const cfdCpiIndex = Math.pow(1 + monthlyRateCpi, cfdCpiMonths);
      const cfdStrikeIndexed = inp.cfdStrike * cfdCpiIndex;

      let cfdAlloc = 0, ppaAlloc = 0;
      if (inp.cfdActive) {
        const cfdStart = new Date(inp.cfdStart && inp.cfdStart.length === 7 ? inp.cfdStart + "-01" : inp.cfdStart);
        const cfdEnd = addMonths(cfdStart, inp.cfdTerm * 12);
        if (periodStart >= cfdStart && periodStart < cfdEnd) cfdAlloc = inp.cfdAllocPct / 100;
      }
      if (inp.ppaActive) {
        const ppaStart = new Date(inp.ppaStart && inp.ppaStart.length === 7 ? inp.ppaStart + "-01" : inp.ppaStart);
        const ppaEnd = addMonths(ppaStart, inp.ppaTerm * 12);
        if (periodStart >= ppaStart && periodStart < ppaEnd) {
          ppaAlloc = Math.min(inp.ppaAllocPct / 100, 1 - cfdAlloc);
        }
      }
      const merchantAlloc = Math.max(0, 1 - cfdAlloc - ppaAlloc);

      if (cfdAlloc > 0) {
        const topup = Math.max(0, cfdStrikeIndexed - merchantPrice) * (1 - inp.negativePricingDiscount / 100);
        cfdRevenue = genMWh * cfdAlloc * (merchantPrice + topup);
      }
      if (ppaAlloc > 0) ppaRevenue = genMWh * ppaAlloc * inp.ppaPrice * cpiIndex;
      if (inp.merchantActive) merchantRevenue = genMWh * merchantAlloc * merchantPrice;
      if (inp.regoActive) regoRevenue = genMWh * regoPrice;
      revenue = cfdRevenue + ppaRevenue + regoRevenue + merchantRevenue;
    }

    let opex = 0;
    let opexRent = 0, opexMaintenance = 0, opexInsurance = 0, opexAssetMgmt = 0;
    let opexBusinessRates = 0, opexTaMonitoring = 0, opexSpareParts = 0;
    let opexDnoCabin = 0, opexSpares = 0;
    if (isOps || isConstruction) {
      const m12 = cpiIndex / 12;
      opexRent          = (inp.opexRent1 + inp.opexRent2) * m12;
      opexMaintenance   = inp.opexMaintenance * m12;
      opexInsurance     = inp.opexInsurance * m12;
      opexAssetMgmt     = inp.opexAssetMgmt * m12;
      opexBusinessRates = inp.opexBusinessRates * m12;
      opexTaMonitoring  = inp.opexTaMonitoring * m12;
      opexSpareParts    = inp.opexSpareParts * m12;
      opexDnoCabin      = inp.opexDnoCabin * m12;
      opexSpares        = (inp.opexSpare1 + inp.opexSpare2 + inp.opexSpare3) * m12;
      opex = opexRent + opexMaintenance + opexInsurance + opexAssetMgmt + opexBusinessRates + opexTaMonitoring + opexSpareParts + opexDnoCabin + opexSpares;
    }

    const ebitda = revenue - opex;

    let gpAllowance = 0, srpAllowance = 0, sbaAllowance = 0, periodCapAllowance = 0;
    if (isOps) {
      gpAllowance  = gpPoolBalance * gpMonthlyRate;
      srpAllowance = srpPoolBalance * srpMonthlyRate;
      sbaAllowance = Math.min(sbaMonthlyAllow, sbaPoolBalance);
      gpPoolBalance  -= gpAllowance;
      srpPoolBalance -= srpAllowance;
      sbaPoolBalance -= sbaAllowance;
      periodCapAllowance = gpAllowance + srpAllowance + sbaAllowance;
    }

    let taxCharge = 0, unleveredTax = 0;
    if (isOps) {
      const grossUnlevered = ebitda - periodCapAllowance;
      const taxableUnlevered = grossUnlevered + taxLossesCarryForward;
      if (taxableUnlevered > 0) unleveredTax = taxableUnlevered * (inp.corpTax / 100);

      const grossLevered = ebitda - periodCapAllowance;
      const taxableLevered = grossLevered + taxLossesCarryForward;
      if (taxableLevered > 0) {
        taxCharge = taxableLevered * (inp.corpTax / 100);
        taxLossesCarryForward = 0;
      } else {
        taxLossesCarryForward = Math.abs(taxableLevered);
        taxCharge = 0; unleveredTax = 0;
      }
    }

    let dsraMovement = 0;
    if (isOps && inp.debtActive && inp.dsraActive) {
      if (!dsraFunded) {
        dsraMovement = dsraTarget; dsraBalance = dsraTarget; dsraFunded = true;
      } else {
        const fwdDS = (principalRepayment + interestCharge) * inp.dsraMonths;
        const newTarget = Math.max(0, fwdDS);
        dsraMovement = newTarget - dsraBalance; dsraBalance = newTarget;
      }
    }

    const unleveredFCF = -capexThisPeriod + ebitda - unleveredTax;
    const equityFCF = isPreCOD
      ? -(capexThisPeriod - debtDraw) - arrangementFee * (isFinClose ? 1 : 0)
      : ebitda - taxCharge - interestCharge - principalRepayment - dsraMovement;

    unleveredCFs.push(unleveredFCF);
    equityCFs.push(equityFCF);
    periods.push({
      year, month, isOps, isConstruction, isPreCOD,
      capex: capexThisPeriod, debtDraw,
      revenue, cfdRev: cfdRevenue, ppaRev: ppaRevenue, regoRev: regoRevenue, merchantRev: merchantRevenue,
      genMWh,
      opex, opexRent, opexMaintenance, opexInsurance, opexAssetMgmt, opexBusinessRates,
      opexTaMonitoring, opexSpareParts, opexDnoCabin, opexSpares,
      ebitda,
      capitalAllowance: periodCapAllowance, gpAllowance, srpAllowance, sbaAllowance,
      taxableProfit: ebitda - periodCapAllowance,
      taxCharge, unleveredTax,
      interest: interestCharge, principal: principalRepayment, dsraMovement,
      debtOutstanding,
      unleveredFCF, equityFCF,
      depreciation: 0,
    });
  }

  const annualMap = {};
  periods.forEach(p => {
    if (!annualMap[p.year]) annualMap[p.year] = {
      year: p.year, isOps: false,
      capex: 0, debtDraw: 0,
      revenue: 0, cfdRev: 0, ppaRev: 0, regoRev: 0, merchantRev: 0, genMWh: 0,
      opex: 0, opexRent: 0, opexMaintenance: 0, opexInsurance: 0, opexAssetMgmt: 0,
      opexBusinessRates: 0, opexTaMonitoring: 0, opexSpareParts: 0, opexDnoCabin: 0, opexSpares: 0,
      ebitda: 0,
      capitalAllowance: 0, gpAllowance: 0, srpAllowance: 0, sbaAllowance: 0,
      taxableProfit: 0, tax: 0, unleveredTax: 0,
      interest: 0, principal: 0, dsraMovement: 0,
      unleveredFCF: 0, equityFCF: 0,
      depreciation: 0,
    };
    const r = annualMap[p.year];
    if (p.isOps) r.isOps = true;
    r.capex += p.capex; r.debtDraw += p.debtDraw;
    r.revenue += p.revenue; r.cfdRev += p.cfdRev; r.ppaRev += p.ppaRev;
    r.regoRev += p.regoRev; r.merchantRev += p.merchantRev; r.genMWh += p.genMWh;
    r.opex += p.opex; r.opexRent += p.opexRent; r.opexMaintenance += p.opexMaintenance;
    r.opexInsurance += p.opexInsurance; r.opexAssetMgmt += p.opexAssetMgmt;
    r.opexBusinessRates += p.opexBusinessRates; r.opexTaMonitoring += p.opexTaMonitoring;
    r.opexSpareParts += p.opexSpareParts; r.opexDnoCabin += p.opexDnoCabin; r.opexSpares += p.opexSpares;
    r.ebitda += p.ebitda;
    r.capitalAllowance += p.capitalAllowance; r.gpAllowance += p.gpAllowance;
    r.srpAllowance += p.srpAllowance; r.sbaAllowance += p.sbaAllowance;
    r.taxableProfit += p.taxableProfit;
    r.tax += p.taxCharge; r.unleveredTax += p.unleveredTax;
    r.interest += p.interest; r.principal += p.principal; r.dsraMovement += p.dsraMovement;
    r.unleveredFCF += p.unleveredFCF; r.equityFCF += p.equityFCF;
  });
  const annualRows = Object.values(annualMap).sort((a, b) => a.year - b.year);

  // Add cumulative FCF columns
  let cumUnlev = 0, cumEq = 0;
  annualRows.forEach(r => {
    cumUnlev += r.unleveredFCF; r.cumUnleveredFCF = cumUnlev;
    cumEq += r.equityFCF;       r.cumEquityFCF    = cumEq;
  });

  const _projIRR = computeIRR(unleveredCFs);
  const _eqIRR   = computeIRR(equityCFs);
  const projectIRR = _projIRR != null ? _projIRR * 100 : null;
  const equityIRR  = _eqIRR   != null ? _eqIRR   * 100 : null;
  const projectNPV = computeNPV(unleveredCFs, inp.discountRate / 100) / 1000;
  const equityNPV  = computeNPV(equityCFs,   inp.discountRate / 100) / 1000;

  const opsPeriods    = periods.filter(p => p.isOps);
  const totalRevenue  = opsPeriods.reduce((s, p) => s + p.revenue, 0);
  const totalCfdRev   = opsPeriods.reduce((s, p) => s + p.cfdRev, 0);
  const totalPpaRev   = opsPeriods.reduce((s, p) => s + p.ppaRev, 0);
  const totalMerchRev = opsPeriods.reduce((s, p) => s + p.merchantRev, 0);
  const totalRegoRev  = opsPeriods.reduce((s, p) => s + p.regoRev, 0);
  const totalOpex     = periods.reduce((s, p) => s + p.opex, 0);
  const totalEBITDA   = opsPeriods.reduce((s, p) => s + p.ebitda, 0);
  const totalDebtService = periods.reduce((s, p) => s + p.interest + p.principal, 0);
  const totalTax      = periods.reduce((s, p) => s + p.taxCharge, 0);
  const totalDistributions = opsPeriods.reduce((s, p) => s + Math.max(0, p.equityFCF), 0);

  const dscrByYear = {};
  periods.forEach(p => {
    if (!p.isOps) return;
    if (!dscrByYear[p.year]) dscrByYear[p.year] = { ebitda: 0, ds: 0, months: 0 };
    dscrByYear[p.year].ebitda += p.ebitda;
    dscrByYear[p.year].ds += p.interest + p.principal;
    dscrByYear[p.year].months += 1;
  });
  const dscrValues = Object.values(dscrByYear).filter(r => r.ds > 0 && r.months === 12).map(r => r.ebitda / r.ds);
  const minDSCR = dscrValues.length ? Math.min(...dscrValues) : null;
  const avgDSCR = dscrValues.length ? dscrValues.reduce((a, b) => a + b, 0) / dscrValues.length : null;

  // Attach per-year DSCR to annual rows
  annualRows.forEach(r => {
    const d = dscrByYear[r.year];
    r.dscr = d && d.ds > 0 && d.months === 12 ? d.ebitda / d.ds : null;
  });

  return {
    kpis: {
      projectIRR, equityIRR, projectNPV, equityNPV,
      totalCapex: totalCapex / 1000, equityInvestment: equityAmount / 1000, debtAmount: debtAmount / 1000,
      gearing: totalCapex > 0 ? (debtAmount / totalCapex) * 100 : 0,
      totalRevenue: totalRevenue / 1000, totalCfdRev: totalCfdRev / 1000,
      totalPpaRev: totalPpaRev / 1000, totalMerchRev: totalMerchRev / 1000, totalRegoRev: totalRegoRev / 1000,
      totalOpex: totalOpex / 1000, totalEBITDA: totalEBITDA / 1000,
      totalDebtService: totalDebtService / 1000, totalTax: totalTax / 1000,
      totalDistributions: totalDistributions / 1000,
      minDSCR, avgDSCR, dsraInitial: dsraTarget / 1000,
    },
    annualRows,
    periods,
  };
}
