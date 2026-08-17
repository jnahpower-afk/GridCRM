import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import { useCentralAssumptions } from "./CentralAssumptions";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";
import { runDCF, calcCapexTotals, MERCHANT_HIGH, MERCHANT_CENTRAL, MERCHANT_LOW, REGO_AURORA, REGO_POWER, SEASONALITY } from "./dcfEngine.js";

// ─── DEFAULT (mirrors App.jsx DEFAULT, used as fallback) ─────────────────────
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtK(v, decimals = 0) {
  if (v == null || isNaN(v)) return "—";
  const k = v / 1000;
  return k === 0 ? "—" : k.toFixed(decimals);
}
function fmtPct(v, d = 2) {
  if (v == null || isNaN(v)) return "—";
  return `${v.toFixed(d)}%`;
}
function fmtX(v, d = 2) {
  if (v == null || isNaN(v)) return "—";
  return `${v.toFixed(d)}x`;
}
function fmtMWh(v) {
  if (v == null || isNaN(v)) return "—";
  return Math.round(v).toLocaleString();
}

// ─── ANNUAL CASHFLOW TABLE ────────────────────────────────────────────────────

const SECTION_HEADER_STYLE = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
  fontSize: 10,
};

const TOTAL_ROW_STYLE = {
  fontWeight: 700,
  fontSize: 11,
};

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────

function exportToExcel({ inp, annualRows, kpis, fmVersion, periods }) {
  if (!periods || !periods.length) return;
  const wb = XLSX.utils.book_new();
  // auto-calc so Monthly/Inputs formulas update when cells change,
  // but do NOT fullCalcOnLoad — XIRR on 400+ monthly periods fails on some
  // Excel builds; IRR is shown as a static JS-computed value instead.
  wb.Workbook = { CalcPr: { calcMode: 'auto', calcOnSave: true, fullCalcOnLoad: false } };
  const FM_LABELS = { 1: "NBO", 2: "FABO", 3: "FID" };
  const vLabel = FM_LABELS[fmVersion] || `v${fmVersion}`;
  const projectName = inp.projectName || "Project";
  const now = new Date().toLocaleDateString("en-GB");

  // ── Helper ──
  const num = (v) => (v == null || isNaN(v)) ? null : v;

  // ── Utilities ──────────────────────────────────────────────────────────────
  const toXlDate = (d) => {
    const dt = (d instanceof Date) ? d : new Date(typeof d === 'string' && d.length === 7 ? d + '-01' : d);
    return Math.round((dt - new Date(1899, 11, 30)) / 86400000);
  };
  const enc = (c, r) => `${XLSX.utils.encode_col(c)}${r}`;
  const setf = (ws, c, r, f, v) => { ws[enc(c, r)] = { t: 'n', f, v: v ?? 0 }; };

  // ── CapEx calculations ──────────────────────────────────────────────────────
  const { grandTotal, epcTotal, gridTotal, epcEquipment, epcServices, epcBase, otherTotal } = calcCapexTotals(inp);
  const debtAmt = inp.debtActive ? grandTotal * (inp.gearing / 100) : 0;
  const equityAmt = grandTotal - debtAmt;
  const conMonthsN = Math.max(1, inp.constructionMonths);
  const conCapexPM = (epcTotal + gridTotal + inp.landLease + inp.constructionInsurance + inp.preCon) / conMonthsN;
  const merchantScenarioCol = inp.merchantScenario === 'high' ? 1 : inp.merchantScenario === 'low' ? 3 : 2;
  const regoScenarioCol = inp.regoScenario === 'power' ? 2 : 1;

  // Merge price curves (central assumptions overrides)
  const mergeCurve = (sheets, hard) => !Array.isArray(sheets) || !sheets.length ? hard :
    hard.map((hv, i) => { const sv = i < sheets.length ? sheets[i] : 0; return sv !== 0 ? sv : hv; });
  const mHigh    = mergeCurve(inp._merchantHigh,    MERCHANT_HIGH);
  const mCentral = mergeCurve(inp._merchantCentral, MERCHANT_CENTRAL);
  const mLow     = mergeCurve(inp._merchantLow,     MERCHANT_LOW);
  const mAurora  = mergeCurve(inp._regoAurora,      REGO_AURORA);
  const mPower   = mergeCurve(inp._regoPower,       REGO_POWER);

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 1: INPUTS (editable — all formula sheets reference this sheet)
  // ══════════════════════════════════════════════════════════════════════════
  const IR = {};         // key → 1-indexed Excel row in Inputs col B
  const inpAoa = [];
  const iRow = (key, label, value) => { inpAoa.push([label, value]); if (key) IR[key] = inpAoa.length; };
  const iHdr = (label) => inpAoa.push([label, null]);
  const iBlk = () => inpAoa.push([null, null]);

  iHdr('MODEL INPUTS  —  edit column B values to recalculate the model');
  iBlk();
  iHdr('PROJECT');
  iRow('PROJECT_NAME', 'Project Name', inp.projectName || '');
  iRow('MODEL_START',  'Model Start Date', toXlDate(inp.modelStart));
  iRow('FIN_CLOSE',    'Financial Close Date', toXlDate(inp.financialClose));
  iRow('CON_MONTHS',   'Construction Months', inp.constructionMonths);
  iRow('COD',          'Commercial Operation Date', toXlDate(inp.cod));
  iRow('ASSET_LIFE',   'Asset Life (years)', inp.assetLife);
  iRow('CAPACITY',     'Capacity (MWp)', inp.capacity);
  iRow('EXPORT_CAP',   'Export Capacity (MWe)', inp.exportCapacity);
  iRow('YIELD',        'Annual Yield (kWh/kWp)', inp.yield_);
  iRow('AVAIL',        'Availability', inp.availability / 100);
  iRow('CURTAIL',      'Curtailment', inp.curtailment / 100);
  iRow('DEGRAD',       'Degradation (%/yr)', inp.degradation / 100);
  iBlk();
  iHdr('CAPITAL EXPENDITURE  (pounds)');
  iRow('EPC_MOD',      'EPC Modules', inp.epcModules);
  iRow('EPC_INV',      'EPC Inverters', inp.epcInverters);
  iRow('EPC_TX',       'EPC Tx Stations', inp.epcTxStations);
  iRow('EPC_MNT',      'EPC Mounting Structure', inp.epcMountingStructure);
  iRow('EPC_PPC',      'EPC PPC/SCADA', inp.epcPpcScada);
  iRow('EPC_CCTV',     'EPC CCTV/Security', inp.epcCctvSecurity);
  iRow('EPC_SPRC',     'EPC Spares Container', inp.epcSparesContainer);
  iRow('EPC_CBL',      'EPC Cables', inp.epcCables);
  iRow('EPC_SUB',      'EPC Substation', inp.epcSubstation);
  iRow('EPC_CTG',      'EPC Contingencies', inp.epcContingencies);
  iRow('SVC_EL',       'Services Electrical', inp.svcElectrical);
  iRow('SVC_ME',       'Services Mechanical', inp.svcMechanical);
  iRow('SVC_CI',       'Services Civil', inp.svcCivil);
  iRow('SVC_TS',       'Services Test & Studies', inp.svcTestStudies);
  iRow('SVC_EN',       'Services Engineering', inp.svcEngineering);
  iRow('SVC_LS',       'Services Landscaping', inp.svcLandscaping);
  iRow('SVC_LD',       'Services Laydown', inp.svcLaydown);
  iRow('EPC_MGN',      'EPC Margin (%)', inp.epcMarginPct / 100);
  iRow('GRID_CBL',     'Grid Cable Run', inp.gridCableRun);
  iRow('GRID_SUB',     'Grid Customer Substation', inp.gridCustomerSubstation);
  iRow('GRID_CON',     'Grid Contestable', inp.gridContestable);
  iRow('GRID_NCO',     'Grid Non-Contestable', inp.gridNonContestable);
  iRow('LAND_LS',      'Land Lease (CapEx)', inp.landLease);
  iRow('CON_INS',      'Construction Insurance', inp.constructionInsurance);
  iRow('PRECON',       'Pre-Construction Costs', inp.preCon);
  iRow('ACQUIS',       'Acquisition Cost', inp.acquisition);
  iRow('DD_COST',      'DD Costs', inp.ddCosts);
  iBlk();
  iHdr('[COMPUTED — do not edit]');
  iRow('EPC_EQ',       '[C] EPC Equipment Total', epcEquipment);
  iRow('EPC_SV',       '[C] EPC Services Total', epcServices);
  iRow('EPC_BS',       '[C] EPC Base', epcBase);
  iRow('EPC_TOT',      '[C] EPC Total (inc. margin)', epcTotal);
  iRow('GRID_TOT',     '[C] Grid Total', gridTotal);
  iRow('OTH_TOT',      '[C] Other Costs Total', otherTotal);
  iRow('GRAN_TOT',     '[C] Grand Total CapEx', grandTotal);
  iRow('DEBT_AMT',     '[C] Debt Amount', debtAmt);
  iRow('EQ_AMT',       '[C] Equity Amount', equityAmt);
  iRow('CON_CPM',      '[C] Construction CapEx/Month', conCapexPM);
  iBlk();
  iHdr('REVENUE');
  iRow('CFD_ACT',      'CfD Active (1=Yes, 0=No)', inp.cfdActive ? 1 : 0);
  iRow('CFD_STR',      'CfD Strike (GBP/MWh, real)', inp.cfdStrike);
  iRow('CFD_IDX',      'CfD Index Base Date', toXlDate(inp.cfdIndexBase));
  iRow('CFD_STA',      'CfD Start Date', toXlDate(inp.cfdStart));
  iRow('CFD_TRM',      'CfD Term (years)', inp.cfdTerm);
  iRow('CFD_ALC',      'CfD Allocation (%)', inp.cfdAllocPct / 100);
  iRow('NEG_DSC',      'Negative Pricing Discount (%)', inp.negativePricingDiscount / 100);
  iRow('PPA_ACT',      'PPA Active (1=Yes, 0=No)', inp.ppaActive ? 1 : 0);
  iRow('PPA_PRC',      'PPA Price (GBP/MWh, real)', inp.ppaPrice);
  iRow('PPA_STA',      'PPA Start Date', toXlDate(inp.ppaStart));
  iRow('PPA_TRM',      'PPA Term (years)', inp.ppaTerm);
  iRow('PPA_ALC',      'PPA Allocation (%)', inp.ppaAllocPct / 100);
  iRow('MERCH_A',      'Merchant Active (1=Yes, 0=No)', inp.merchantActive ? 1 : 0);
  iRow('MERCH_C',      'Merchant Scenario (1=High 2=Central 3=Low)', merchantScenarioCol);
  iRow('REGO_A',       'REGO Active (1=Yes, 0=No)', inp.regoActive ? 1 : 0);
  iRow('REGO_C',       'REGO Scenario (1=Aurora 2=Power)', regoScenarioCol);
  iRow('CPI',          'CPI Rate (%/yr)', inp.cpi / 100);
  iBlk();
  iHdr('DEBT');
  iRow('DBT_ACT',      'Debt Active (1=Yes, 0=No)', inp.debtActive ? 1 : 0);
  iRow('GEARING',      'Gearing (%)', inp.gearing / 100);
  iRow('INT_CON',      'Construction Interest (%/yr)', inp.interestCon / 100);
  iRow('INT_OPS',      'Operational Interest (%/yr)', inp.interestOps / 100);
  iRow('DBT_TEN',      'Debt Tenor (years)', inp.debtTenor);
  iRow('ARR_FEE',      'Arrangement Fee (%)', inp.arrangementFee / 100);
  iRow('DSRA_A',       'DSRA Active (1=Yes, 0=No)', inp.dsraActive ? 1 : 0);
  iRow('DSRA_M',       'DSRA Months', inp.dsraMonths);
  iBlk();
  iHdr('TAX & CAPITAL ALLOWANCES');
  iRow('CORP_TX',      'Corporation Tax (%)', inp.corpTax / 100);
  iRow('GP_PCT',       'GP Pool (% of CapEx)', inp.capAllowGPPct / 100);
  iRow('GP_RATE',      'GP WDA Rate (%/yr)', inp.capAllowGPRate / 100);
  iRow('SRP_PCT',      'SRP Pool (% of CapEx)', inp.capAllowSRPPct / 100);
  iRow('SRP_RAT',      'SRP WDA Rate (%/yr)', inp.capAllowSRPRate / 100);
  iRow('SBA_PCT',      'SBA Pool (% of CapEx)', inp.capAllowSBAPct / 100);
  iRow('SBA_RAT',      'SBA Rate (%/yr straight-line)', inp.capAllowSBARate / 100);
  iRow('DISC_RT',      'Discount Rate (%/yr)', inp.discountRate / 100);
  iBlk();
  iHdr('OPERATING COSTS  (GBP/yr nominal)');
  iRow('OP_RNT1',      'Land Rent 1', inp.opexRent1);
  iRow('OP_RNT2',      'Land Rent 2', inp.opexRent2);
  iRow('OP_OM',        'O&M', inp.opexMaintenance);
  iRow('OP_INS',       'Insurance', inp.opexInsurance);
  iRow('OP_AM',        'Asset Management', inp.opexAssetMgmt);
  iRow('OP_BR',        'Business Rates', inp.opexBusinessRates);
  iRow('OP_TA',        'TA Monitoring', inp.opexTaMonitoring);
  iRow('OP_SP',        'Spare Parts', inp.opexSpareParts);
  iRow('OP_DNO',       'DNO / Cabin', inp.opexDnoCabin);
  iRow('OP_SP1',       'Spare Line 1', inp.opexSpare1);
  iRow('OP_SP2',       'Spare Line 2', inp.opexSpare2);
  iRow('OP_SP3',       'Spare Line 3', inp.opexSpare3);
  iBlk();
  iHdr('SEASONALITY (monthly generation factors, must sum to 1.0)');
  iRow('SE_JAN',       'January (month 0)', SEASONALITY[0]);
  iRow('SE_FEB',       'February (month 1)', SEASONALITY[1]);
  iRow('SE_MAR',       'March (month 2)', SEASONALITY[2]);
  iRow('SE_APR',       'April (month 3)', SEASONALITY[3]);
  iRow('SE_MAY',       'May (month 4)', SEASONALITY[4]);
  iRow('SE_JUN',       'June (month 5)', SEASONALITY[5]);
  iRow('SE_JUL',       'July (month 6)', SEASONALITY[6]);
  iRow('SE_AUG',       'August (month 7)', SEASONALITY[7]);
  iRow('SE_SEP',       'September (month 8)', SEASONALITY[8]);
  iRow('SE_OCT',       'October (month 9)', SEASONALITY[9]);
  iRow('SE_NOV',       'November (month 10)', SEASONALITY[10]);
  iRow('SE_DEC',       'December (month 11)', SEASONALITY[11]);

  const wsI = XLSX.utils.aoa_to_sheet(inpAoa);

  // Helper: reference Inputs col B cell by key (for use in other sheets' formulas)
  const I = (key) => `Inputs!$B$${IR[key]}`;
  const IB = (key) => `$B$${IR[key]}`;  // within-Inputs reference

  // Overwrite computed rows with live Excel formulas
  wsI[`B${IR.EPC_EQ}`]   = { t: 'n', f: `SUM(${IB('EPC_MOD')}:${IB('EPC_CTG')})`, v: epcEquipment };
  wsI[`B${IR.EPC_SV}`]   = { t: 'n', f: `SUM(${IB('SVC_EL')}:${IB('SVC_LD')})`, v: epcServices };
  wsI[`B${IR.EPC_BS}`]   = { t: 'n', f: `${IB('EPC_EQ')}+${IB('EPC_SV')}`, v: epcBase };
  wsI[`B${IR.EPC_TOT}`]  = { t: 'n', f: `${IB('EPC_BS')}*(1+${IB('EPC_MGN')})`, v: epcTotal };
  wsI[`B${IR.GRID_TOT}`] = { t: 'n', f: `SUM(${IB('GRID_CBL')}:${IB('GRID_NCO')})`, v: gridTotal };
  wsI[`B${IR.OTH_TOT}`]  = { t: 'n', f: `${IB('LAND_LS')}+${IB('CON_INS')}+${IB('PRECON')}+${IB('ACQUIS')}+${IB('DD_COST')}`, v: otherTotal };
  wsI[`B${IR.GRAN_TOT}`] = { t: 'n', f: `${IB('EPC_TOT')}+${IB('GRID_TOT')}+${IB('OTH_TOT')}`, v: grandTotal };
  wsI[`B${IR.DEBT_AMT}`] = { t: 'n', f: `IF(${IB('DBT_ACT')}=1,${IB('GRAN_TOT')}*${IB('GEARING')},0)`, v: debtAmt };
  wsI[`B${IR.EQ_AMT}`]   = { t: 'n', f: `${IB('GRAN_TOT')}-${IB('DEBT_AMT')}`, v: equityAmt };
  wsI[`B${IR.CON_CPM}`]  = { t: 'n', f: `(${IB('EPC_TOT')}+${IB('GRID_TOT')}+${IB('LAND_LS')}+${IB('CON_INS')}+${IB('PRECON')})/MAX(1,${IB('CON_MONTHS')})`, v: conCapexPM };

  // Date formatting
  ['MODEL_START', 'FIN_CLOSE', 'COD', 'CFD_IDX', 'CFD_STA', 'PPA_STA'].forEach(k => {
    const cell = wsI[`B${IR[k]}`]; if (cell) cell.z = 'yyyy-mm-dd';
  });
  // Percentage formatting
  ['AVAIL','CURTAIL','DEGRAD','EPC_MGN','CFD_ALC','NEG_DSC','PPA_ALC',
   'GEARING','INT_CON','INT_OPS','ARR_FEE','CORP_TX','GP_PCT','GP_RATE',
   'SRP_PCT','SRP_RAT','SBA_PCT','SBA_RAT','DISC_RT','CPI'].forEach(k => {
    const cell = wsI[`B${IR[k]}`]; if (cell) cell.z = '0.00%';
  });

  wsI['!cols'] = [{ wch: 40 }, { wch: 18 }];
  wsI['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: inpAoa.length - 1, c: 1 } });
  XLSX.utils.book_append_sheet(wb, wsI, 'Inputs');

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 2: PRICE CURVES (editable — merchant and REGO price arrays)
  // ══════════════════════════════════════════════════════════════════════════
  const pcData = [['Year', 'Merchant High (GBP/MWh)', 'Merchant Central (GBP/MWh)', 'Merchant Low (GBP/MWh)', 'REGO Aurora (GBP/MWh)', 'REGO Power (GBP/MWh)']];
  for (let i = 0; i < 64; i++) {
    pcData.push([2026 + i,
      mHigh[i]    ?? MERCHANT_HIGH[i],
      mCentral[i] ?? MERCHANT_CENTRAL[i],
      mLow[i]     ?? MERCHANT_LOW[i],
      mAurora[i]  ?? REGO_AURORA[i],
      mPower[i]   ?? REGO_POWER[i],
    ]);
  }
  const wsPC = XLSX.utils.aoa_to_sheet(pcData);
  wsPC['!cols'] = [{ wch: 8 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsPC, 'PriceCurves');

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 3: MONTHLY CASHFLOWS — horizontal layout
  //   Row 1     = header: col A = "Line Item", col B = "Seed", col C+ = period dates
  //   Rows 2-46 = one line item per row (col A = label, col B = seed value, col C+ = monthly formula)
  //   SEED col (B) holds initial running-balance values so row formulas can reference one column left
  // ══════════════════════════════════════════════════════════════════════════
  const nP = periods.length;

  // Row index constants (0-based from first line-item row).
  // Excel row for a key = MR[key] + 2  (row 1 is the date-header row)
  const MR = {
    PER:0, DATE:1, YR:2, MOI:3, PCOD:4, ICON:5, IOPS:6, OPYR:7, CPIM:8, IFIN:9,
    CPIX:10, SEAS:11, CAPX:12, DDRW:13, DOUT:14, PRIN:15, INTR:16,
    GEN:17, MPRX:18, CFDX:19, CFDA:20, PPAA:21, MCHA:22,
    CFDR:23, PPAR:24, MCHR:25, RGOP:26, RGOR:27, TREV:28, TOPX:29, EBIT:30,
    GPPL:31, GPAW:32, SRPL:33, SRWA:34, SBPL:35, SBWA:36,
    TCAW:37, TXBF:38, TLCF:39, TXAF:40, CTAX:41, UFCF:42, DSRA:43, EFCF:44,
  };
  const NROWS  = 45;
  const HDR    = 1;             // header is Excel row 1 (1-indexed)
  const xr     = (k) => MR[k] + HDR + 1; // Excel row (1-indexed) for line item k
  const SCOL   = 1;             // seed column = col B (0-indexed)
  const DCOL   = 2;             // first data column = col C (0-indexed)
  const lastDC = DCOL + nP - 1; // last data column (0-indexed)

  const wsMo = {};

  // ── Row labels (col A) ─────────────────────────────────────────────────────
  wsMo[enc(0, HDR)] = { t: 's', v: 'Line Item' };
  wsMo[enc(SCOL, HDR)] = { t: 's', v: 'Seed' };
  [
    'Period', 'Date', 'Year', 'Month (0=Jan)', 'Is Pre-COD', 'Is Construction', 'Is Ops', 'Op Year',
    'CPI Months', 'Is Financial Close', 'CPI Index', 'Seasonality', 'CapEx (GBP)', 'Debt Draw (GBP)',
    'Debt Outstanding (GBP)', 'Principal (GBP)', 'Interest (GBP)', 'Generation (MWh)',
    'Merchant Price (GBP/MWh)', 'CfD Strike Indexed (GBP/MWh)', 'CfD Alloc %', 'PPA Alloc %',
    'Merchant Alloc %', 'CfD Revenue (GBP)', 'PPA Revenue (GBP)', 'Merchant Revenue (GBP)',
    'REGO Price (GBP/MWh)', 'REGO Revenue (GBP)', 'Total Revenue (GBP)', 'Total OpEx (GBP)',
    'EBITDA (GBP)', 'GP Pool Balance (GBP)', 'GP Allowance (GBP)', 'SRP Pool Balance (GBP)',
    'SRP Allowance (GBP)', 'SBA Pool Balance (GBP)', 'SBA Allowance (GBP)',
    'Total Cap Allowances (GBP)', 'Taxable Before Loss CF (GBP)', 'Tax Loss Carry Fwd (GBP)',
    'Taxable After Loss CF (GBP)', 'Corp Tax (GBP)', 'Unlevered FCF (GBP)', 'DSRA Movement (GBP)', 'Equity FCF (GBP)',
  ].forEach((lbl, i) => { wsMo[enc(0, HDR + 1 + i)] = { t: 's', v: lbl }; });

  // ── Seed column (col B) — initial values for running balances ──────────────
  wsMo[enc(SCOL, xr('DOUT'))] = { t: 'n', v: 0 };
  setf(wsMo, SCOL, xr('GPPL'), `${I('GRAN_TOT')}*${I('GP_PCT')}`,  grandTotal * (inp.capAllowGPPct / 100));
  setf(wsMo, SCOL, xr('SRPL'), `${I('GRAN_TOT')}*${I('SRP_PCT')}`, grandTotal * (inp.capAllowSRPPct / 100));
  setf(wsMo, SCOL, xr('SBPL'), `${I('GRAN_TOT')}*${I('SBA_PCT')}`, grandTotal * (inp.capAllowSBAPct / 100));
  wsMo[enc(SCOL, xr('TLCF'))] = { t: 'n', v: 0 };

  // Running balance trackers (for accurate cached display values)
  let _gpPool  = grandTotal * (inp.capAllowGPPct  / 100);
  let _srpPool = grandTotal * (inp.capAllowSRPPct / 100);
  let _sbaPool = grandTotal * (inp.capAllowSBAPct / 100);
  let _taxLoss = 0;

  const _msd      = new Date(typeof inp.modelStart     === 'string' && inp.modelStart.length     === 7 ? inp.modelStart     + '-01' : inp.modelStart);
  const _cod      = new Date(typeof inp.cod            === 'string' && inp.cod.length            === 7 ? inp.cod            + '-01' : inp.cod);
  const _finClose = new Date(typeof inp.financialClose === 'string' && inp.financialClose.length === 7 ? inp.financialClose + '-01' : inp.financialClose);

  // Seasonality lookup range in Inputs (Jan row to Dec row)
  const SL = `Inputs!$B$${IR.SE_JAN}:Inputs!$B$${IR.SE_DEC}`;

  for (let m = 0; m < nP; m++) {
    const pc = DCOL + m;   // 0-indexed column for this period
    const p  = periods[m];

    // C(key)  → cell address for this period column, line item row
    // Cp(key) → cell address for previous column (= seed col when m=0)
    const C  = (k) => enc(pc,     xr(k));
    const Cp = (k) => enc(pc - 1, xr(k));

    // Period date (start of month)
    const pd = new Date(_msd);
    pd.setMonth(pd.getMonth() + m);
    const xlD = toXlDate(pd);

    // Header row 1: period date label across the top
    wsMo[enc(pc, HDR)] = { t: 'n', v: xlD, z: 'mmm-yy' };

    // ── Static rows ───────────────────────────────────────────────────────────
    wsMo[C('PER')]  = { t: 'n', v: m + 1 };
    wsMo[C('DATE')] = { t: 'n', v: xlD, z: 'mmm-yy' };
    wsMo[C('YR')]   = { t: 'n', f: `YEAR(${C('DATE')})`, v: p.year };
    wsMo[C('MOI')]  = { t: 'n', f: `MONTH(${C('DATE')})-1`, v: p.month };
    wsMo[C('PCOD')] = { t: 'n', f: `IF(${C('DATE')}<${I('COD')},1,0)`, v: p.isPreCOD ? 1 : 0 };
    wsMo[C('ICON')] = { t: 'n', f: `IF(AND(${C('DATE')}>=DATE(YEAR(${I('COD')}),MONTH(${I('COD')})-${I('CON_MONTHS')},1),${C('PCOD')}=1),1,0)`, v: p.isConstruction ? 1 : 0 };
    wsMo[C('IOPS')] = { t: 'n', f: `1-${C('PCOD')}`, v: p.isOps ? 1 : 0 };
    const opYrV = p.isOps ? Math.floor(((pd.getFullYear() - _cod.getFullYear()) * 12 + pd.getMonth() - _cod.getMonth()) / 12) + 1 : 0;
    wsMo[C('OPYR')] = { t: 'n', f: `IF(${C('IOPS')}=1,INT(((YEAR(${C('DATE')})-YEAR(${I('COD')}))*12+MONTH(${C('DATE')})-MONTH(${I('COD')}))/12)+1,0)`, v: opYrV };
    wsMo[C('CPIM')] = { t: 'n', v: m };
    const isFinV = (pd.getFullYear() === _finClose.getFullYear() && pd.getMonth() === _finClose.getMonth()) ? 1 : 0;
    wsMo[C('IFIN')] = { t: 'n', f: `IF(AND(YEAR(${C('DATE')})=YEAR(${I('FIN_CLOSE')}),MONTH(${C('DATE')})=MONTH(${I('FIN_CLOSE')})),1,0)`, v: isFinV };

    // ── Formula rows ──────────────────────────────────────────────────────────
    setf(wsMo, pc, xr('CPIX'), `(1+${I('CPI')})^(${C('CPIM')}/12)`, Math.pow(1 + inp.cpi / 100, m / 12));
    setf(wsMo, pc, xr('SEAS'), `INDEX(${SL},${C('MOI')}+1)`, SEASONALITY[p.month] ?? (1 / 12));

    setf(wsMo, pc, xr('CAPX'),
      `IF(${C('IFIN')}=1,${I('ACQUIS')}+${I('DD_COST')},0)+IF(${C('ICON')}=1,${I('CON_CPM')},0)`,
      p.capex);
    setf(wsMo, pc, xr('DDRW'),
      `IF(${I('DBT_ACT')}=1,IF(OR(${C('ICON')}=1,${C('IFIN')}=1),${C('CAPX')}*${I('GEARING')},0),0)`,
      p.debtDraw);
    setf(wsMo, pc, xr('PRIN'),
      `IF(AND(${I('DBT_ACT')}=1,${C('IOPS')}=1,(${Cp('DOUT')}+${C('DDRW')})>0),MIN(${I('DEBT_AMT')}/(${I('DBT_TEN')}*12),${Cp('DOUT')}+${C('DDRW')}),0)`,
      p.principal);
    setf(wsMo, pc, xr('INTR'),
      `IF(${I('DBT_ACT')}=1,(${Cp('DOUT')}+${C('DDRW')})*IF(${C('PCOD')}=1,${I('INT_CON')},${I('INT_OPS')})/12,0)`,
      p.interest);
    setf(wsMo, pc, xr('DOUT'), `${Cp('DOUT')}+${C('DDRW')}-${C('PRIN')}`, p.debtOutstanding);

    setf(wsMo, pc, xr('GEN'),
      `IF(${C('IOPS')}=1,${I('CAPACITY')}*${I('YIELD')}*${I('AVAIL')}*(1-${I('CURTAIL')})*${C('SEAS')}*(1-${I('DEGRAD')})^MAX(0,${C('OPYR')}-1),0)`,
      p.genMWh);

    const merchPriceV = (() => {
      if (!p.isOps || !inp.merchantActive) return 0;
      const idx = p.year - 2026;
      const curve = inp.merchantScenario === 'high' ? mHigh : inp.merchantScenario === 'low' ? mLow : mCentral;
      const raw = idx < 0 ? curve[0] : idx >= curve.length ? curve[curve.length - 1] : curve[idx];
      return raw * Math.pow(1 + inp.cpi / 100, m / 12);
    })();
    setf(wsMo, pc, xr('MPRX'),
      `IF(${I('MERCH_A')}=1,INDEX(PriceCurves!$B$2:$D$65,MATCH(${C('YR')},PriceCurves!$A$2:$A$65,0),${I('MERCH_C')})*${C('CPIX')},0)`,
      merchPriceV);

    const cfdBase  = new Date(typeof inp.cfdIndexBase === 'string' && inp.cfdIndexBase.length === 7 ? inp.cfdIndexBase + '-01' : inp.cfdIndexBase);
    const cfdCpiMo = (pd.getFullYear() - cfdBase.getFullYear()) * 12 + pd.getMonth() - cfdBase.getMonth();
    setf(wsMo, pc, xr('CFDX'),
      `${I('CFD_STR')}*(1+${I('CPI')})^((${C('DATE')}-${I('CFD_IDX')})/(365.25/12)/12)`,
      inp.cfdStrike * Math.pow(1 + inp.cpi / 100, cfdCpiMo / 12));

    const cfdS     = new Date(typeof inp.cfdStart === 'string' && inp.cfdStart.length === 7 ? inp.cfdStart + '-01' : inp.cfdStart);
    const cfdE     = new Date(cfdS); cfdE.setMonth(cfdE.getMonth() + inp.cfdTerm * 12);
    const cfdAllocV = (inp.cfdActive && pd >= cfdS && pd < cfdE) ? inp.cfdAllocPct / 100 : 0;
    setf(wsMo, pc, xr('CFDA'),
      `IF(AND(${I('CFD_ACT')}=1,${C('DATE')}>=${I('CFD_STA')},${C('DATE')}<DATE(YEAR(${I('CFD_STA')}),MONTH(${I('CFD_STA')})+${I('CFD_TRM')}*12,1)),${I('CFD_ALC')},0)`,
      cfdAllocV);

    const ppaS     = new Date(typeof inp.ppaStart === 'string' && inp.ppaStart.length === 7 ? inp.ppaStart + '-01' : inp.ppaStart);
    const ppaE     = new Date(ppaS); ppaE.setMonth(ppaE.getMonth() + inp.ppaTerm * 12);
    const ppaAllocV = (inp.ppaActive && pd >= ppaS && pd < ppaE) ? Math.min(inp.ppaAllocPct / 100, 1 - cfdAllocV) : 0;
    setf(wsMo, pc, xr('PPAA'),
      `IF(AND(${I('PPA_ACT')}=1,${C('DATE')}>=${I('PPA_STA')},${C('DATE')}<DATE(YEAR(${I('PPA_STA')}),MONTH(${I('PPA_STA')})+${I('PPA_TRM')}*12,1)),MIN(${I('PPA_ALC')},1-${C('CFDA')}),0)`,
      ppaAllocV);

    setf(wsMo, pc, xr('MCHA'), `MAX(0,1-${C('CFDA')}-${C('PPAA')})`, Math.max(0, 1 - cfdAllocV - ppaAllocV));

    setf(wsMo, pc, xr('CFDR'),
      `IF(${C('CFDA')}>0,${C('GEN')}*${C('CFDA')}*(${C('MPRX')}+MAX(0,${C('CFDX')}-${C('MPRX')})*(1-${I('NEG_DSC')})),0)`,
      p.cfdRev);
    setf(wsMo, pc, xr('PPAR'),
      `IF(${C('PPAA')}>0,${C('GEN')}*${C('PPAA')}*${I('PPA_PRC')}*${C('CPIX')},0)`,
      p.ppaRev);
    setf(wsMo, pc, xr('MCHR'),
      `IF(${I('MERCH_A')}=1,${C('GEN')}*${C('MCHA')}*${C('MPRX')},0)`,
      p.merchantRev);

    const regoPriceV = (() => {
      if (!p.isOps || !inp.regoActive) return 0;
      const idx = p.year - 2026;
      const curve = inp.regoScenario === 'power' ? mPower : mAurora;
      const raw = idx < 0 ? curve[0] : idx >= curve.length ? curve[curve.length - 1] : curve[idx];
      return raw * Math.pow(1 + inp.cpi / 100, m / 12);
    })();
    setf(wsMo, pc, xr('RGOP'),
      `IF(${I('REGO_A')}=1,INDEX(PriceCurves!$E$2:$F$65,MATCH(${C('YR')},PriceCurves!$A$2:$A$65,0),${I('REGO_C')})*${C('CPIX')},0)`,
      regoPriceV);

    setf(wsMo, pc, xr('RGOR'), `IF(${I('REGO_A')}=1,${C('GEN')}*${C('RGOP')},0)`, p.regoRev);
    setf(wsMo, pc, xr('TREV'), `${C('CFDR')}+${C('PPAR')}+${C('MCHR')}+${C('RGOR')}`, p.revenue);
    setf(wsMo, pc, xr('TOPX'),
      `IF(OR(${C('IOPS')}=1,${C('ICON')}=1),(${I('OP_RNT1')}+${I('OP_RNT2')}+${I('OP_OM')}+${I('OP_INS')}+${I('OP_AM')}+${I('OP_BR')}+${I('OP_TA')}+${I('OP_SP')}+${I('OP_DNO')}+${I('OP_SP1')}+${I('OP_SP2')}+${I('OP_SP3')})*${C('CPIX')}/12,0)`,
      p.opex);
    setf(wsMo, pc, xr('EBIT'), `${C('TREV')}-${C('TOPX')}`, p.ebitda);

    setf(wsMo, pc, xr('GPAW'), `IF(${C('IOPS')}=1,${Cp('GPPL')}*(1-(1-${I('GP_RATE')})^(1/12)),0)`, p.gpAllowance);
    setf(wsMo, pc, xr('GPPL'), `${Cp('GPPL')}-${C('GPAW')}`, _gpPool - p.gpAllowance);
    _gpPool -= p.gpAllowance;

    setf(wsMo, pc, xr('SRWA'), `IF(${C('IOPS')}=1,${Cp('SRPL')}*(1-(1-${I('SRP_RAT')})^(1/12)),0)`, p.srpAllowance);
    setf(wsMo, pc, xr('SRPL'), `${Cp('SRPL')}-${C('SRWA')}`, _srpPool - p.srpAllowance);
    _srpPool -= p.srpAllowance;

    setf(wsMo, pc, xr('SBWA'),
      `IF(${C('IOPS')}=1,MIN(${I('GRAN_TOT')}*${I('SBA_PCT')}*${I('SBA_RAT')}/12,${Cp('SBPL')}),0)`,
      p.sbaAllowance);
    setf(wsMo, pc, xr('SBPL'), `${Cp('SBPL')}-${C('SBWA')}`, _sbaPool - p.sbaAllowance);
    _sbaPool -= p.sbaAllowance;

    setf(wsMo, pc, xr('TCAW'), `${C('GPAW')}+${C('SRWA')}+${C('SBWA')}`, p.capitalAllowance);

    const txBefore  = p.isOps ? p.ebitda - p.capitalAllowance : 0;
    setf(wsMo, pc, xr('TXBF'), `IF(${C('IOPS')}=1,${C('EBIT')}-${C('TCAW')},0)`, txBefore);

    const txAfterCF  = txBefore + _taxLoss;
    const newTaxLoss = p.isOps ? (txAfterCF > 0 ? 0 : Math.abs(txAfterCF)) : _taxLoss;
    setf(wsMo, pc, xr('TLCF'),
      `IF(${C('IOPS')}=1,IF(${C('TXBF')}+${Cp('TLCF')}>0,0,ABS(${C('TXBF')}+${Cp('TLCF')})),${Cp('TLCF')})`,
      newTaxLoss);
    _taxLoss = newTaxLoss;

    setf(wsMo, pc, xr('TXAF'), `IF(${C('IOPS')}=1,${C('TXBF')}+${Cp('TLCF')},0)`, p.isOps ? txAfterCF : 0);
    setf(wsMo, pc, xr('CTAX'), `IF(${C('TXAF')}>0,${C('TXAF')}*${I('CORP_TX')},0)`, p.taxCharge);
    setf(wsMo, pc, xr('UFCF'), `-${C('CAPX')}+${C('EBIT')}-${C('CTAX')}`, p.unleveredFCF);

    wsMo[C('DSRA')] = { t: 'n', v: p.dsraMovement };

    setf(wsMo, pc, xr('EFCF'),
      `IF(${C('PCOD')}=1,-(${C('CAPX')}-${C('DDRW')})-${I('DEBT_AMT')}*${I('ARR_FEE')}*${C('IFIN')},${C('EBIT')}-${C('CTAX')}-${C('INTR')}-${C('PRIN')}-${C('DSRA')})`,
      p.equityFCF);
  }

  wsMo['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: NROWS + HDR, c: lastDC } });
  wsMo['!cols'] = [
    { wch: 30 },                          // col A: row labels
    { wch: 14 },                          // col B: seed
    ...Array(nP).fill({ wch: 10 }),       // col C+: one per month
  ];
  XLSX.utils.book_append_sheet(wb, wsMo, 'Monthly');

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 4: KPIs (XIRR / XNPV formulas — update automatically from Monthly)
  // Now references horizontal row ranges (one row per line item, cols C → last period)
  // ══════════════════════════════════════════════════════════════════════════
  const DC0    = XLSX.utils.encode_col(DCOL);    // 'C' — first data column letter
  const DCN    = XLSX.utils.encode_col(lastDC);  // last data column letter
  // Horizontal row ranges (used for XNPV which handles row vectors natively)
  const UF_RNG = `Monthly!$${DC0}$${xr('UFCF')}:Monthly!$${DCN}$${xr('UFCF')}`;
  const EF_RNG = `Monthly!$${DC0}$${xr('EFCF')}:Monthly!$${DCN}$${xr('EFCF')}`;
  const DT_RNG = `Monthly!$${DC0}$${xr('DATE')}:Monthly!$${DCN}$${xr('DATE')}`;
  // XIRR requires column (vertical) vectors — TRANSPOSE converts horizontal rows to columns
  const UF_T   = `TRANSPOSE(${UF_RNG})`;
  const EF_T   = `TRANSPOSE(${EF_RNG})`;
  const DT_T   = `TRANSPOSE(${DT_RNG})`;

  const wsK = {};
  const kc = (c, r, v, f, z) => {
    if (f != null) {
      wsK[enc(c, r)] = { t: 'n', f, v: v ?? 0 };
    } else if (v != null) {
      wsK[enc(c, r)] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) };
    }
    if (z && wsK[enc(c, r)]) wsK[enc(c, r)].z = z;
  };

  kc(0, 1, 'KEY PERFORMANCE INDICATORS  —  IRR/NPV computed at export time from JS engine; see audit section (row 19) to verify with Excel XIRR');
  kc(0, 3, 'Metric'); kc(1, 3, 'Value (computed at export)'); kc(3, 3, 'Notes');

  // Guard: NaN / Infinity / null → null (omit cell) for IRR; 0 for other metrics
  const safeN  = (v) => (v == null || !isFinite(v) || isNaN(v)) ? 0 : v;
  // For IRR specifically: pass the actual decimal if valid, otherwise omit (null → cell not written)
  const safeIRR = (v) => (v == null || isNaN(v) || !isFinite(v)) ? null : v / 100;

  kc(0, 4, 'Project IRR');
  kc(1, 4, safeIRR(kpis.projectIRR), null, '0.00%');
  kc(3, 4, 'Computed at export — unlevered pre-financing (Newton-Raphson monthly IRR annualised)');

  kc(0, 5, 'Equity IRR');
  kc(1, 5, safeIRR(kpis.equityIRR), null, '0.00%');
  kc(3, 5, 'Computed at export — post-debt post-tax');

  kc(0, 6, 'Project NPV (GBPk)');
  kc(1, 6, safeN(kpis.projectNPV ?? 0), `IFERROR(XNPV(${I('DISC_RT')},${UF_RNG},${DT_RNG})/1000,0)`);
  kc(3, 6, `Discount rate from Inputs B${IR.DISC_RT}`);

  kc(0, 7, 'Equity NPV (GBPk)');
  kc(1, 7, safeN(kpis.equityNPV ?? 0), `IFERROR(XNPV(${I('DISC_RT')},${EF_RNG},${DT_RNG})/1000,0)`);

  kc(0, 8,  'Total CapEx (GBPk)');   kc(2, 8,  safeN(kpis.totalCapex ?? 0));
  kc(0, 9,  'Debt Amount (GBPk)');   kc(2, 9,  safeN(kpis.debtAmount ?? 0));
  kc(0, 10, 'Equity Amount (GBPk)'); kc(2, 10, safeN(kpis.equityInvestment ?? 0));
  kc(0, 11, 'Gearing');              kc(2, 11, safeN((kpis.gearing ?? 0) / 100), null, '0.00%');
  kc(0, 12, 'Min DSCR');             kc(2, 12, safeN(kpis.minDSCR ?? 0), null, '0.00x');
  kc(0, 13, 'Avg DSCR');             kc(2, 13, safeN(kpis.avgDSCR ?? 0), null, '0.00x');
  kc(0, 15, 'HOW TO USE: Change any input in the Inputs sheet — Monthly, NPV and DSCR formulas recalculate automatically.');
  kc(0, 16, 'Price curves can be edited on the Price Curves sheet. DSRA Movement column (AR) in Monthly is static.');
  kc(0, 17, 'IRR values above are fixed at export time. Use the audit section below to cross-check with Excel XIRR (press Ctrl+Shift+F9 to force-recalculate).');

  kc(0, 18, '── FORMULA AUDIT ──  press Ctrl+Shift+F9 to force-recalculate  ──────────────────────────────────────────');
  kc(0, 19, '[Audit] Project IRR');
  kc(1, 19, safeIRR(kpis.projectIRR), `IFERROR(XIRR(${UF_T},${DT_T},0.1),0)`, '0.00%');
  kc(3, 19, 'Excel XIRR over unlevered FCF from Monthly — should match row 5 above');
  kc(0, 20, '[Audit] Equity IRR');
  kc(1, 20, safeIRR(kpis.equityIRR), `IFERROR(XIRR(${EF_T},${DT_T},0.1),0)`, '0.00%');
  kc(3, 20, 'Excel XIRR over equity FCF from Monthly — should match row 6 above');

  wsK['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 20, c: 3 } });
  wsK['!cols'] = [{ wch: 24 }, { wch: 68 }, { wch: 14 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(wb, wsK, 'KPIs');

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET 5: COVER (static summary — see KPIs sheet for live formulas)
  // ══════════════════════════════════════════════════════════════════════════
  const coverData = [
    [`SOLAR DCF MODEL  —  ${projectName}  |  ${vLabel}  |  Exported ${now}`],
    [],
    ['Metric', 'Value', 'Notes'],
    ['Project IRR',           num((kpis.projectIRR ?? 0) / 100), 'Unlevered pre-financing — computed at export'],
    ['Equity IRR',            num((kpis.equityIRR  ?? 0) / 100), 'Post-debt, post-tax — computed at export'],
    ['Project NPV (GBPk)',    num(kpis.projectNPV),  `Discount rate ${inp.discountRate}%`],
    ['Equity NPV (GBPk)',     num(kpis.equityNPV),   `Discount rate ${inp.discountRate}%`],
    ['Total CapEx (GBPk)',    num(kpis.totalCapex),  ''],
    ['Equity Investment (GBPk)', num(kpis.equityInvestment), ''],
    ['Debt Amount (GBPk)',    num(kpis.debtAmount),  ''],
    ['Gearing',               num((kpis.gearing ?? 0) / 100), 'Debt / Total CapEx'],
    ['Total Revenue (GBPk)',  num(kpis.totalRevenue), 'Life-of-project'],
    ['Total OpEx (GBPk)',     num(kpis.totalOpex),    'Life-of-project'],
    ['Total EBITDA (GBPk)',   num(kpis.totalEBITDA),  'Life-of-project'],
    ['Total Tax (GBPk)',      num(kpis.totalTax),     'Corporation tax paid'],
    ['Min DSCR',              num(kpis.minDSCR),      'Full 12-month years only'],
    ['Avg DSCR',              num(kpis.avgDSCR),      'Full 12-month years only'],
    [],
    ['HOW TO USE THIS MODEL'],
    ['1. Go to the Inputs sheet and edit the values in column B.'],
    ['2. Monthly sheet recalculates automatically (all formulas reference Inputs).'],
    ['3. KPIs sheet shows IRR (computed at export) and live NPV/DSCR formulas. An XIRR audit section is at the bottom of the KPIs sheet.'],
    ['4. Price curves can be edited directly on the Price Curves sheet.'],
    ['NOTE: DSRA Movement (Monthly column AR) is static — update by re-exporting from the app.'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(coverData);
  ws1['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 46 }];
  // Only apply % format to numeric cells — blank cells (null IRR) must not get % format or they show "0.00%"
  ['B4', 'B5', 'B11'].forEach(addr => { if (ws1[addr] && ws1[addr].t === 'n') ws1[addr].z = '0.00%'; });
  XLSX.utils.book_append_sheet(wb, ws1, 'Cover');

  // ── Write file ────────────────────────────────────────────────────────────
  const fname = `${projectName.replace(/\s+/g, '_')}_DCF_${vLabel}_${now.replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// KPI → table row label mappings (used for highlight-on-click in the UI table)
const KPI_ROW_MAP = {
  "Project IRR":  ["Unlevered FCF"],
  "Equity IRR":   ["Equity FCF"],
  "Project NPV":  ["Unlevered FCF"],
  "Equity NPV":   ["Equity FCF"],
  "Total CapEx":  ["Construction CapEx"],
  "Gearing":      ["Construction CapEx", "Principal"],
  "Min DSCR":     ["DSCR"],
  "Avg DSCR":     ["DSCR"],
};

export default function ModelWorkings({ project, fmVersion = 1 }) {
  const { theme } = useTheme();
  const { assumptions } = useCentralAssumptions() || {};
  const [inp, setInp] = useState(DEFAULT_INP);
  const [loading, setLoading] = useState(true);
  const [selectedKpi, setSelectedKpi] = useState(null);
  const [hoveredKpi, setHoveredKpi] = useState(null);
  const rowRefs = useRef({});

  // Load saved inputs (read-only)
  useEffect(() => {
    if (!project) return;
    setLoading(true);
    (async () => {
      const { data: rows } = await supabase
        .from("project_inputs")
        .select("inputs")
        .eq("project_id", project.id)
        .eq("version", fmVersion)
        .limit(1);
      if (rows?.[0]?.inputs) {
        setInp({ ...DEFAULT_INP, ...rows[0].inputs });
      } else {
        setInp(DEFAULT_INP);
      }
      setLoading(false);
    })();
  }, [project?.id, fmVersion]);

  const effectiveInp = useMemo(() => {
    if (!assumptions) return { ...inp };
    return {
      ...inp,
      _merchantHigh: assumptions.merchant?.high || null,
      _merchantCentral: assumptions.merchant?.central || null,
      _merchantLow: assumptions.merchant?.low || null,
      _regoAurora: assumptions.rego?.aurora || null,
      _regoPower: assumptions.rego?.power || null,
    };
  }, [inp, assumptions]);

  const result = useMemo(() => {
    try { return runDCF(effectiveInp); } catch (e) { return null; }
  }, [effectiveInp]);

  const { annualRows, kpis, periods } = result || {};

  const { grandTotal: totalCapex } = useMemo(() => calcCapexTotals(effectiveInp), [effectiveInp]);
  const debtAmount = effectiveInp.debtActive ? totalCapex * (effectiveInp.gearing / 100) : 0;

  // Scroll state for sticky columns
  const [scrollLeft, setScrollLeft] = useState(0);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EnergyLoader />
      </div>
    );
  }

  if (!annualRows || annualRows.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: theme.textTertiary, fontSize: 13 }}>
        No model data available for this FM version.
      </div>
    );
  }

  const years = annualRows.map(r => r.year);

  // ── table row spec ─────────────────────────────────────────────────────────
  // Each entry: { type: "section"|"row"|"total"|"spacer", label, formula, key, fn, negativeSign }
  const ROWS = [
    // ── Generation ──
    { type: "section", label: "Generation" },
    { type: "row",  label: "Generation", formula: "Capacity × Yield × Avail × (1−Curtailment) × Seasonality × Degradation^yr",
      fn: r => fmtMWh(r.genMWh), unit: "MWh" },

    // ── Revenue ──
    { type: "section", label: "Revenue  (£'000s)" },
    { type: "row",  label: "CfD Revenue",      formula: "Gen × CfD% × max(Strike_indexed − Merchant, 0) + Gen × CfD% × Merchant",
      fn: r => fmtK(r.cfdRev) },
    { type: "row",  label: "PPA Revenue",       formula: "Gen × PPA% × PPA_price_indexed",
      fn: r => fmtK(r.ppaRev) },
    { type: "row",  label: "Merchant Revenue",  formula: "Gen × Merchant% × Merchant_price_curve",
      fn: r => fmtK(r.merchantRev) },
    { type: "row",  label: "REGO Revenue",      formula: "Gen × REGO_price_curve (applied to 100% of generation)",
      fn: r => fmtK(r.regoRev) },
    { type: "total", label: "Total Revenue",    fn: r => fmtK(r.revenue) },

    // ── OpEx ──
    { type: "section", label: "Operating Costs  (£'000s)" },
    { type: "row",  label: "Land Rent",         formula: "Rent1 + Rent2 (£/yr indexed to CPI)",            fn: r => fmtK(r.opexRent) },
    { type: "row",  label: "O&M",               formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexMaintenance) },
    { type: "row",  label: "Insurance",         formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexInsurance) },
    { type: "row",  label: "Asset Management",  formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexAssetMgmt) },
    { type: "row",  label: "Business Rates",    formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexBusinessRates) },
    { type: "row",  label: "TA Monitoring",     formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexTaMonitoring) },
    { type: "row",  label: "Spare Parts",       formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexSpareParts) },
    { type: "row",  label: "DNO / Cabin",       formula: "£/yr × CPI index",                               fn: r => fmtK(r.opexDnoCabin) },
    { type: "row",  label: "Spare Lines",       formula: "(Spare1 + Spare2 + Spare3) × CPI index",         fn: r => fmtK(r.opexSpares) },
    { type: "total", label: "Total OpEx",       fn: r => fmtK(r.opex) },

    // ── EBITDA ──
    { type: "section", label: "EBITDA  (£'000s)" },
    { type: "total",  label: "EBITDA",          formula: "Revenue − Total OpEx",                            fn: r => fmtK(r.ebitda) },

    // ── CapEx ──
    { type: "section", label: "Capital Expenditure  (£'000s)" },
    { type: "row",  label: "Construction CapEx", formula: "(EPC + Grid + Land + Insurance + Pre-Con) ÷ construction months", fn: r => fmtK(r.capex) },

    // ── Capital Allowances ──
    { type: "section", label: "Capital Allowances  (£'000s)" },
    { type: "row",  label: "GP Pool (18% WDA)",  formula: "Declining-balance: pool × (1−(1−18%)^(1/12)) per month; GP pool = " +
        `${effectiveInp.capAllowGPPct}% of CapEx`,  fn: r => fmtK(r.gpAllowance) },
    { type: "row",  label: "SRP Pool (6% WDA)",  formula: "Declining-balance: pool × (1−(1−6%)^(1/12)) per month; SRP pool = " +
        `${effectiveInp.capAllowSRPPct}% of CapEx`, fn: r => fmtK(r.srpAllowance) },
    { type: "row",  label: "SBA (3% SL)",        formula: "Straight-line: SBA_pool × 3% ÷ 12 per month; SBA pool = " +
        `${effectiveInp.capAllowSBAPct}% of CapEx`, fn: r => fmtK(r.sbaAllowance) },
    { type: "total", label: "Total Cap. Allow.", fn: r => fmtK(r.capitalAllowance) },

    // ── Taxable Profit & Tax ──
    { type: "section", label: "Tax  (£'000s)" },
    { type: "row",  label: "Taxable Profit",     formula: "EBITDA − Capital Allowances (loss carry-forward applied)",
      fn: r => fmtK((r.ebitda || 0) - (r.capitalAllowance || 0)) },
    { type: "row",  label: "Corporation Tax",    formula: `Taxable Profit × ${effectiveInp.corpTax}% (with loss carry-forward)`,
      fn: r => fmtK(r.tax) },

    // ── Debt Service ──
    { type: "section", label: "Debt Service  (£'000s)" },
    { type: "row",  label: "Interest",           formula: `Outstanding debt × ${effectiveInp.debtActive ? effectiveInp.interestOps : 0}% ops / ${effectiveInp.debtActive ? effectiveInp.interestCon : 0}% con (÷12)`,
      fn: r => fmtK(r.interest) },
    { type: "row",  label: "Principal",          formula: `Debt amount ÷ ${effectiveInp.debtTenor * 12} months (straight-line amortisation)`,
      fn: r => fmtK(r.principal) },
    { type: "row",  label: "DSRA Movement",      formula: `Target = ${effectiveInp.dsraMonths} months forward debt service; funded at COD`,
      fn: r => fmtK(r.dsraMovement) },
    { type: "total", label: "Total Debt Service",fn: r => fmtK((r.interest || 0) + (r.principal || 0)) },

    // ── Free Cash Flows ──
    { type: "section", label: "Free Cash Flows  (£'000s)" },
    { type: "row",  label: "Unlevered FCF",      formula: "−CapEx + EBITDA − Unlevered Tax (no interest deduction)",
      fn: r => fmtK(r.unleveredFCF) },
    { type: "row",  label: "Equity FCF",         formula: "Construction: −(CapEx − Debt Draw) − Arrangement Fee  |  Ops: EBITDA − Tax − Interest − Principal − DSRA",
      fn: r => fmtK(r.equityFCF) },
    { type: "row",  label: "Cum. Unlevered FCF", formula: "Running sum of Unlevered FCF",
      fn: (r, idx, rows) => {
        let cum = 0;
        for (let i = 0; i <= idx; i++) cum += rows[i].unleveredFCF || 0;
        return fmtK(cum);
      }
    },
    { type: "row",  label: "Cum. Equity FCF",    formula: "Running sum of Equity FCF",
      fn: (r, idx, rows) => {
        let cum = 0;
        for (let i = 0; i <= idx; i++) cum += rows[i].equityFCF || 0;
        return fmtK(cum);
      }
    },

    // ── DSCR ──
    { type: "section", label: "Debt Service Cover Ratio" },
    { type: "row",  label: "DSCR",               formula: "EBITDA ÷ (Interest + Principal); full 12-month years only",
      fn: r => {
        const ds = (r.interest || 0) + (r.principal || 0);
        if (ds <= 0 || !r.isOps) return "—";
        return fmtX(r.ebitda / ds);
      }
    },
  ];

  // ── KPI summary bar ────────────────────────────────────────────────────────
  const kpiItems = kpis ? [
    { label: "Project IRR",   value: fmtPct(kpis.projectIRR) },
    { label: "Equity IRR",    value: fmtPct(kpis.equityIRR) },
    { label: "Project NPV",   value: `£${kpis.projectNPV?.toFixed(0)}k` },
    { label: "Equity NPV",    value: `£${kpis.equityNPV?.toFixed(0)}k` },
    { label: "Total CapEx",   value: `£${kpis.totalCapex?.toFixed(0)}k` },
    { label: "Gearing",       value: fmtPct(kpis.gearing) },
    { label: "Min DSCR",      value: fmtX(kpis.minDSCR) },
    { label: "Avg DSCR",      value: fmtX(kpis.avgDSCR) },
  ] : [];

  // Alternating row colours
  const rowBg = (i) => i % 2 === 0 ? "transparent" : theme.surfaceBg + "60";

  const COL_W = 72; // px per year column
  const LABEL_W = 220;
  const FORMULA_W = 320;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>
            Model Workings — Calculation Trace
          </div>
          <div style={{ fontSize: 11, color: theme.textTertiary }}>
            All monetary values in £'000s unless otherwise stated. Each row shows the formula used to derive the figure.
          </div>
        </div>
        {annualRows && kpis && (
          <button
            onClick={() => exportToExcel({ inp: effectiveInp, annualRows, kpis, fmVersion, periods })}
            style={{
              flexShrink: 0,
              background: theme.accent, color: "#fff",
              border: "none", borderRadius: 8,
              padding: "8px 16px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            ↓ Export to Excel
          </button>
        )}
      </div>

      {/* KPI summary strip */}
      {kpis && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          {kpiItems.map(k => {
            const isHovered = hoveredKpi === k.label;
            const isSelected = selectedKpi === k.label;
            const hasMapping = !!KPI_ROW_MAP[k.label];
            return (
              <div
                key={k.label}
                onClick={() => {
                  if (!hasMapping) return;
                  const next = selectedKpi === k.label ? null : k.label;
                  setSelectedKpi(next);
                  if (next) {
                    const targets = KPI_ROW_MAP[next];
                    const firstRef = rowRefs.current[targets[0]];
                    if (firstRef) firstRef.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }}
                onMouseEnter={() => hasMapping && setHoveredKpi(k.label)}
                onMouseLeave={() => setHoveredKpi(null)}
                style={{
                  background: isSelected ? theme.accent + "22" : isHovered ? theme.hoverBg : theme.pillBg,
                  border: `1px solid ${isSelected ? theme.accent : isHovered ? theme.accent + "88" : theme.border}`,
                  borderRadius: 8, padding: "8px 14px", minWidth: 80,
                  cursor: hasMapping ? "pointer" : "default",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 9, color: isSelected ? theme.accent : theme.textTertiary,
                  textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 3 }}>
                  {k.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800,
                  color: isSelected ? theme.accent : theme.textPrimary, letterSpacing: "-0.02em" }}>
                  {k.value}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main table */}
      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${theme.border}` }}>
        <table style={{ borderCollapse: "collapse", width: "max-content", fontSize: 11 }}>
          <thead>
            <tr style={{ background: theme.pillBg, position: "sticky", top: 0, zIndex: 2 }}>
              <th style={{
                position: "sticky", left: 0, zIndex: 3,
                background: theme.pillBg, borderRight: `1px solid ${theme.border}`,
                padding: "8px 12px", textAlign: "left", fontWeight: 700,
                fontSize: 10, color: theme.textSecondary, width: LABEL_W, minWidth: LABEL_W,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>Line Item</th>
              <th style={{
                background: theme.pillBg, borderRight: `1px solid ${theme.border}`,
                padding: "8px 12px", textAlign: "left", fontWeight: 600,
                fontSize: 10, color: theme.textTertiary, width: FORMULA_W, minWidth: FORMULA_W,
              }}>Formula / Methodology</th>
              {years.map(y => (
                <th key={y} style={{
                  padding: "8px 8px", textAlign: "right", fontWeight: 700,
                  fontSize: 10, color: theme.textSecondary, width: COL_W, minWidth: COL_W,
                  borderLeft: `1px solid ${theme.border}`,
                  whiteSpace: "nowrap",
                }}>{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((rowSpec, ri) => {
              if (rowSpec.type === "spacer") {
                return (
                  <tr key={`spacer-${ri}`}>
                    <td colSpan={years.length + 2} style={{ height: 6, background: theme.pageBg }} />
                  </tr>
                );
              }

              if (rowSpec.type === "section") {
                return (
                  <tr key={`section-${ri}`} style={{ background: theme.pageBg }}>
                    <td
                      colSpan={years.length + 2}
                      style={{
                        position: "sticky", left: 0,
                        background: theme.pageBg,
                        padding: "10px 12px 4px",
                        color: theme.textTertiary,
                        borderTop: ri > 0 ? `1px solid ${theme.border}` : "none",
                        ...SECTION_HEADER_STYLE,
                      }}
                    >{rowSpec.label}</td>
                  </tr>
                );
              }

              const isTotal = rowSpec.type === "total";
              const rowIdx = ri;
              const highlightedRows = selectedKpi ? KPI_ROW_MAP[selectedKpi] || [] : [];
              const isHighlighted = highlightedRows.includes(rowSpec.label);
              const bg = isHighlighted
                ? theme.accent + "20"
                : isTotal ? (theme.pillBg + "cc") : rowBg(ri);
              // Sticky cell needs a fully opaque background to avoid bleed-through when scrolling
              const solidBg = isHighlighted
                ? theme.accent + "30"
                : isTotal ? theme.pillBg : (ri % 2 === 0 ? theme.pageBg : theme.surfaceBg);
              const textColor = isHighlighted ? theme.accent
                : isTotal ? theme.textPrimary : theme.textSecondary;

              return (
                <tr
                  key={`row-${ri}`}
                  ref={el => { if (el) rowRefs.current[rowSpec.label] = el; }}
                  style={{
                    background: bg,
                    outline: isHighlighted ? `2px solid ${theme.accent}40` : "none",
                    outlineOffset: -1,
                  }}
                >
                  {/* Label — sticky */}
                  <td style={{
                    position: "sticky", left: 0, zIndex: 1,
                    background: solidBg,
                    padding: "5px 12px",
                    color: textColor,
                    borderRight: `1px solid ${isHighlighted ? theme.accent : theme.border}`,
                    width: LABEL_W, minWidth: LABEL_W,
                    whiteSpace: "nowrap",
                    fontWeight: isHighlighted ? 700 : undefined,
                    ...(isTotal ? TOTAL_ROW_STYLE : { fontSize: 11 }),
                  }}>{rowSpec.label}</td>

                  {/* Formula — scrolls with table */}
                  <td style={{
                    background: bg,
                    padding: "5px 12px",
                    color: theme.textMuted,
                    borderRight: `1px solid ${theme.border}`,
                    fontSize: 9.5,
                    width: FORMULA_W, minWidth: FORMULA_W,
                    maxWidth: FORMULA_W,
                    overflow: "hidden",
                    whiteSpace: "normal",
                    lineHeight: 1.35,
                  }}>{rowSpec.formula || ""}</td>

                  {/* Year values */}
                  {annualRows.map((r, idx) => {
                    const val = rowSpec.fn(r, idx, annualRows);
                    const isNeg = typeof val === "string" && val.startsWith("-");
                    return (
                      <td key={r.year} style={{
                        padding: "5px 8px",
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: isNeg ? theme.error : (isTotal ? theme.textPrimary : theme.textSecondary),
                        fontWeight: isTotal ? 700 : 400,
                        borderLeft: `1px solid ${theme.border}`,
                        whiteSpace: "nowrap",
                      }}>{val}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer notes */}
      <div style={{ marginTop: 20, padding: "12px 16px", background: theme.pillBg,
        border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 10, color: theme.textTertiary,
        lineHeight: 1.6 }}>
        <strong style={{ color: theme.textSecondary }}>Methodology Notes</strong><br/>
        • CPI indexation applied monthly: CPI_factor = (1 + CPI/100)^(months_from_model_start/12)<br/>
        • Capital allowances use declining-balance WDA rates (GP 18%, SRP 6%) computed monthly, plus straight-line SBA.<br/>
        • Tax losses are carried forward: if taxable profit is negative, it offsets future taxable profit.<br/>
        • Debt drawn proportionally to CapEx during construction; repaid straight-line over tenor from COD.<br/>
        • DSRA funded at COD equal to {effectiveInp.dsraMonths} months of forward debt service; rebalanced monthly.<br/>
        • Unlevered FCF excludes interest and debt draws (pure project returns). Equity FCF is post-debt, post-tax.<br/>
        • IRR computed using Newton-Raphson iteration (monthly cash flows, annualised to effective annual rate).
      </div>
    </div>
  );
}
