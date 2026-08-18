import { useState, useRef } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { generateProposalHTML } from "./generateProposalHTML.js";
import * as XLSX from "xlsx";

// ─── STEPS ───────────────────────────────────────────────────────────────────
const STEPS = [
  { id: "client",   label: "Client & Site"    },
  { id: "dcf",      label: "DCF Upload"        },
  { id: "scenarios",label: "Pick Scenarios"    },
  { id: "review",   label: "Review & Generate" },
];

const TEAM_MEMBERS = [
  "Laurie Campbell",
  "Max Karous",
  "Maher Chaabane",
  "Dany Dbaibo",
  "Eoin McEvoy",
];

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── DCF PARSER ──────────────────────────────────────────────────────────────
// Extracts all relevant data from the Grid CRM DCF Excel workbook using SheetJS.
function parseDCF(workbook) {
  // ── 1. WMP Proposal sheet ─────────────────────────────────────────────────
  // Find the sheet with "Proposal" in the name (could be named differently per client)
  const proposalSheetName = workbook.SheetNames.find(n =>
    n.toLowerCase().includes("proposal") || n.toLowerCase().includes("wmp")
  ) || workbook.SheetNames[2]; // fallback: 3rd sheet

  const wsProposal = workbook.Sheets[proposalSheetName];
  const proposalData = XLSX.utils.sheet_to_json(wsProposal, { header: 1, defval: null });

  // Build a lookup from col-A labels → col-B values
  const lookup = {};
  proposalData.forEach(row => {
    if (row[0] && typeof row[0] === "string") {
      lookup[row[0].trim()] = row[1];
    }
  });

  const annualDemandKWh = Number(lookup["2030 Annualised Consumption"] ||
                                  lookup["Annualised Consumption"] || 0);
  const annualDemandMWh = Math.round(annualDemandKWh / 1000);
  const hasExport   = String(lookup["Grid Export"] || "").toLowerCase() === "yes";
  const currentMWp  = Number(lookup["Solar Site Size DC"] || 1);
  const ppa1Price   = Number(lookup["PPA 1 Price"] || 85);
  const ppa2Price   = Number(lookup["PPA 2 Price"] || 75);

  // Monthly data — scan for the header row "Month", then read 12 data rows
  let monthlyDemandMWh  = [];
  let monthlyGenMWh1MWp = [];  // generation at currentMWp — we'll normalise to 1 MWp
  let totalGenMWh1MWp   = 0;

  for (let ri = 0; ri < proposalData.length; ri++) {
    const row = proposalData[ri];
    if (row[5] === "Month") {
      // Next 12 rows are monthly data
      for (let mi = 0; mi < 12; mi++) {
        const mr = proposalData[ri + 1 + mi];
        if (!mr || typeof mr[5] !== "number") break;
        const demandKWh = Number(mr[6] || 0);
        const genKWh    = Number(mr[7] || 0);
        monthlyDemandMWh.push(demandKWh / 1000);
        monthlyGenMWh1MWp.push(genKWh / 1000);  // at currentMWp
      }
      break;
    }
  }

  // Normalise generation to 1 MWp baseline
  const annualGenAtCurrent = monthlyGenMWh1MWp.reduce((s, v) => s + v, 0);
  if (currentMWp !== 1 && annualGenAtCurrent > 0) {
    const factor = 1 / currentMWp;
    monthlyGenMWh1MWp = monthlyGenMWh1MWp.map(v => v * factor);
  }
  totalGenMWh1MWp = monthlyGenMWh1MWp.reduce((s, v) => s + v, 0);

  // ── 2. MWp Sensitivity sheet ──────────────────────────────────────────────
  const sensitivitySheetName = workbook.SheetNames.find(n =>
    n.toLowerCase().includes("sensitivity") || n.toLowerCase().includes("mwp")
  ) || workbook.SheetNames[1];

  const wsSens = workbook.Sheets[sensitivitySheetName];
  const sensData = XLSX.utils.sheet_to_json(wsSens, { header: 1, defval: null });

  // Find header row: col B = "MWp"
  let sensRows = [];
  for (let ri = 0; ri < sensData.length; ri++) {
    const row = sensData[ri];
    if (row[1] === "MWp" && row[2] && String(row[2]).toLowerCase().includes("npv")) {
      // Next rows are data
      for (let di = ri + 1; di < sensData.length; di++) {
        const dr = sensData[di];
        if (!dr || typeof dr[1] !== "number") break;
        const mwp       = Number(dr[1]);
        const npv       = Number(dr[2] || 0);
        const ulIrr     = Number(dr[3] || 0);
        const eqIrr     = Number(dr[4] || 0);
        const lcoe      = Number(dr[5] || 0);
        const consumedKWh = Number(dr[6] || 0);
        const annualGenMWh  = Math.round(totalGenMWh1MWp * mwp);
        const consumedMWh   = consumedKWh / 1000;
        const exportMWh     = Math.max(0, annualGenMWh - consumedMWh);
        const coveragePct   = annualDemandMWh > 0
          ? Math.round((consumedMWh / annualDemandMWh) * 100)
          : 0;

        sensRows.push({ mwp, npv, ulIrr, eqIrr, lcoe, consumedMWh, annualGenMWh, exportMWh, coveragePct });
      }
      break;
    }
  }

  return {
    annualDemandMWh,
    hasExport,
    ppa1Price,
    ppa2Price,
    currentMWp,
    monthlyDemandMWh,    // [12] — actual client demand
    monthlyGenMWh1MWp,  // [12] — generation per MWp at 1 MWp basis
    totalGenMWh1MWp,
    sensRows,
    proposalSheetName,
  };
}

// Build monthly scenario data for a chosen MWp size
function buildMonthlyData(dcf, mwp, hasExportOverride) {
  const { monthlyDemandMWh, monthlyGenMWh1MWp, annualDemandMWh } = dcf;
  const useExport = hasExportOverride ?? dcf.hasExport;

  return MONTHS_SHORT.map((month, i) => {
    const demand       = Math.round(monthlyDemandMWh[i] || 0);
    const generation   = Math.round((monthlyGenMWh1MWp[i] || 0) * mwp);
    const solarConsumed = Math.min(generation, demand);
    const gridExport   = useExport ? Math.max(0, generation - demand) : 0;
    const gridImport   = demand - solarConsumed;
    return { month, demand, gridImport, solarConsumed, gridExport, generation };
  });
}

// ─── SUBCOMPONENTS ───────────────────────────────────────────────────────────

function WizardField({ label, hint, children, theme }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
        {hint && <span style={{ fontSize: 10, color: theme.textMuted }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function WizardInput({ value, onChange, placeholder, type = "text", min, max, step, theme }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      min={min} max={max} step={step}
      style={{
        width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
        borderRadius: 8, color: theme.textPrimary, padding: "10px 12px",
        fontSize: 13, outline: "none", boxSizing: "border-box",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    />
  );
}

function WizardSelect({ value, onChange, options, theme }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
        borderRadius: 8, color: theme.textPrimary, padding: "10px 12px",
        fontSize: 13, outline: "none", boxSizing: "border-box",
        fontFamily: "'Inter', system-ui, sans-serif", cursor: "pointer",
      }}>
      {options.map(o => (
        <option key={typeof o === "string" ? o : o.value} value={typeof o === "string" ? o : o.value}>
          {typeof o === "string" ? o : o.label}
        </option>
      ))}
    </select>
  );
}

function SectionDivider({ label, theme }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 14px" }}>
      <div style={{ flex: 1, height: 1, background: theme.border }} />
      <span style={{ fontSize: 10, color: theme.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: theme.border }} />
    </div>
  );
}

function StatPill({ label, value, color = "#F8632C", theme }) {
  return (
    <div style={{ background: theme.pillBg, borderRadius: 8, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 9, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

// ─── MAIN WIZARD ─────────────────────────────────────────────────────────────
export default function ProposalWizard({ lead, onClose }) {
  const { theme } = useTheme();
  const fileInputRef = useRef(null);

  const todayStr     = new Date().toISOString().slice(0, 10);

  const [step, setStep] = useState(0);

  // ── Step 0: Client & Site ─────────────────────────────────────────────────
  const [client, setClient] = useState({
    orgName:       lead?.name || "",
    siteName:      "",
    postcode:      "",
    planningAuth:  "",
    wireDistance:  "",
    preparerName:  "",
    preparerEmail: "",
    proposalDate:  todayStr,
    ppaTerm:       "10",
  });
  function setClientField(k, v) { setClient(p => ({ ...p, [k]: v })); }
  function handlePreparerNameChange(name) {
    setClientField("preparerName", name);
  }

  // ── Step 1: DCF Upload ────────────────────────────────────────────────────
  const [dcfParsing, setDcfParsing] = useState(false);
  const [dcfError,   setDcfError]   = useState(null);
  const [dcf,        setDcf]        = useState(null);   // parsed DCF result

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDcfParsing(true);
    setDcfError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: "array" });
      const result = parseDCF(wb);
      if (!result.annualDemandMWh || result.sensRows.length === 0) {
        throw new Error("Could not find expected data. Make sure this is a Grid CRM DCF workbook.");
      }
      setDcf(result);
      // Pre-fill PPA term from the client state
    } catch (err) {
      setDcfError(err.message || "Failed to parse the Excel file.");
    } finally {
      setDcfParsing(false);
    }
  }

  // ── Step 2: Scenario Picker ───────────────────────────────────────────────
  const [scAIdx, setScAIdx] = useState(null);  // index into dcf.sensRows
  const [scBIdx, setScBIdx] = useState(null);
  // Override export flag per scenario
  const [scAExport, setScAExport] = useState(false);
  const [scBExport, setScBExport] = useState(true);

  const scARow = dcf && scAIdx !== null ? dcf.sensRows[scAIdx] : null;
  const scBRow = dcf && scBIdx !== null ? dcf.sensRows[scBIdx] : null;

  // ── Step 3: Review & Generate ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generated,  setGenerated]  = useState(false);

  // ── Validation ────────────────────────────────────────────────────────────
  function canProceed() {
    if (step === 0) return client.orgName.trim() && client.siteName.trim();
    if (step === 1) return dcf !== null;
    if (step === 2) return scAIdx !== null && scBIdx !== null && scAIdx !== scBIdx;
    return true;
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  function handleGenerate() {
    if (!dcf || !scARow || !scBRow) return;
    setGenerating(true);
    try {
      const dateObj = new Date(client.proposalDate || todayStr);
      const proposalDateDisplay  = dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const proposalMonthYear    = dateObj.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

      // Build monthly arrays from DCF data for the chosen MWp sizes
      const scAMonthly = buildMonthlyData(dcf, scARow.mwp, scAExport);
      const scBMonthly = buildMonthlyData(dcf, scBRow.mwp, scBExport);

      const html = generateProposalHTML({
        orgName:      client.orgName,
        siteName:     client.siteName,
        postcode:     client.postcode,
        annualDemand: dcf.annualDemandMWh,
        scA: {
          cap: scARow.mwp,
          gen: Math.round(scARow.annualGenMWh),
          cov: scARow.coveragePct,
        },
        scB: {
          cap: scBRow.mwp,
          gen: Math.round(scBRow.annualGenMWh),
          cov: scBRow.coveragePct,
          exp: Math.round(scBExport ? scBRow.exportMWh : 0),
        },
        ppaTerm:           Number(client.ppaTerm),
        planningAuth:      client.planningAuth,
        wireDistance:      client.wireDistance,
        preparerEmail:     client.preparerEmail,
        proposalDate:      proposalDateDisplay,
        proposalMonthYear: proposalMonthYear,
        _rawDate:          client.proposalDate || todayStr,
        // Pass pre-computed monthly data so the generator uses DCF actuals
        _scAMonthly: scAMonthly,
        _scBMonthly: scBMonthly,
      });

      const blob = new Blob([html], { type: "text/html" });
      const url  = URL.createObjectURL(blob);
      window.open(url, "_blank");

      const a = document.createElement("a");
      a.href = url;
      a.download = `Grid-CRM-Proposal-${client.orgName.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setGenerated(true);
    } catch (err) {
      console.error("Proposal generation error:", err);
    } finally {
      setGenerating(false);
    }
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: 680,
        background: theme.elevatedBg || theme.surfaceBg,
        borderRadius: 16,
        border: `1px solid ${theme.border}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
        display: "flex", flexDirection: "column",
        maxHeight: "92vh", overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          padding: "18px 24px 14px",
          borderBottom: `1px solid ${theme.border}`,
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: "#F8632C",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0,
          }}>📋</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>Generate Proposal</div>
            <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>
              {lead?.name} · {STEPS[step].label}
            </div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: theme.textTertiary, padding: "2px 8px" }}>✕</div>
        </div>

        {/* Step progress */}
        <div style={{ display: "flex", padding: "10px 24px 0", gap: 6, flexShrink: 0 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ flex: 1 }}>
              <div style={{
                height: 3, borderRadius: 2,
                background: i <= step ? "#F8632C" : theme.border,
                opacity: i === step ? 1 : i < step ? 0.55 : 0.25,
                marginBottom: 4,
              }} />
              <div style={{
                fontSize: 9, color: i <= step ? "#F8632C" : theme.textMuted,
                fontWeight: i === step ? 700 : 400,
                textTransform: "uppercase", letterSpacing: "0.04em",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── STEP 0: Client & Site ── */}
          {step === 0 && (
            <div>
              <WizardField label="Organisation Name *" theme={theme}>
                <WizardInput value={client.orgName} onChange={v => setClientField("orgName", v)} placeholder="e.g. West Mercia Police" theme={theme} />
              </WizardField>
              <WizardField label="Site Name *" hint="e.g. HQ building, factory name" theme={theme}>
                <WizardInput value={client.siteName} onChange={v => setClientField("siteName", v)} placeholder="e.g. Hindlip Hall" theme={theme} />
              </WizardField>
              <WizardField label="Postcode" theme={theme}>
                <WizardInput value={client.postcode} onChange={v => setClientField("postcode", v)} placeholder="e.g. WR3 8SP" theme={theme} />
              </WizardField>
              <SectionDivider label="Location & commercial" theme={theme} />
              <WizardField label="Planning Authority" hint="LPA for planning submission" theme={theme}>
                <WizardInput value={client.planningAuth} onChange={v => setClientField("planningAuth", v)} placeholder="e.g. Wychavon District Council" theme={theme} />
              </WizardField>
              <WizardField label="Private Wire Distance" hint="Farm to site" theme={theme}>
                <WizardInput value={client.wireDistance} onChange={v => setClientField("wireDistance", v)} placeholder="e.g. ~500 m" theme={theme} />
              </WizardField>
              <WizardField label="PPA Term" theme={theme}>
                <WizardSelect
                  value={client.ppaTerm}
                  onChange={v => setClientField("ppaTerm", v)}
                  options={["5","7","10","12","15","20"].map(v => ({ value: v, label: `${v} years` }))}
                  theme={theme}
                />
              </WizardField>
              <SectionDivider label="Prepared by" theme={theme} />
              <WizardField label="Account Manager" theme={theme}>
                <WizardSelect
                  value={client.preparerName}
                  onChange={handlePreparerNameChange}
                  options={["", ...TEAM_MEMBERS]}
                  theme={theme}
                />
              </WizardField>
              <WizardField label="Email" theme={theme}>
                <WizardInput value={client.preparerEmail} onChange={v => setClientField("preparerEmail", v)} placeholder="name@example.com" theme={theme} />
              </WizardField>
              <WizardField label="Proposal Date" theme={theme}>
                <WizardInput type="date" value={client.proposalDate} onChange={v => setClientField("proposalDate", v)} theme={theme} />
              </WizardField>
            </div>
          )}

          {/* ── STEP 1: DCF Upload ── */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 20, lineHeight: 1.6 }}>
                Upload the Grid CRM DCF workbook for <strong>{client.orgName}</strong>. The wizard will read the annual demand, PPA pricing, actual monthly energy profile, and MWp sensitivity table directly from the file.
              </div>

              {/* Drop zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    const synth = { target: { files: [file] } };
                    handleFileChange(synth);
                  }
                }}
                style={{
                  border: `2px dashed ${dcf ? "#4A8C5C" : "#F8632C88"}`,
                  borderRadius: 12, padding: "40px 24px",
                  textAlign: "center", cursor: "pointer",
                  background: dcf ? "#4A8C5C0A" : "#F8632C08",
                  transition: "all 0.2s",
                  marginBottom: 20,
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 10 }}>{dcf ? "✅" : "📂"}</div>
                {dcfParsing ? (
                  <div style={{ fontSize: 13, color: theme.textMuted }}>Parsing Excel…</div>
                ) : dcf ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#4A8C5C", marginBottom: 4 }}>DCF loaded successfully</div>
                    <div style={{ fontSize: 11, color: theme.textMuted }}>Click to replace</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 4 }}>Drop DCF Excel file here</div>
                    <div style={{ fontSize: 11, color: theme.textMuted }}>or click to browse · .xlsx</div>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />

              {dcfError && (
                <div style={{ padding: 12, borderRadius: 8, background: "#ef444422", border: "1px solid #ef444466", fontSize: 12, color: "#ef4444", marginBottom: 16 }}>
                  ⚠️ {dcfError}
                </div>
              )}

              {/* Extracted summary */}
              {dcf && (
                <div>
                  <SectionDivider label="Extracted from DCF" theme={theme} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <StatPill label="Annual demand" value={`${dcf.annualDemandMWh.toLocaleString("en-GB")} MWh/yr`} theme={theme} />
                    <StatPill label="PPA1 price" value={`£${dcf.ppa1Price}/MWh`} theme={theme} />
                    <StatPill label="Sensitivity rows" value={`${dcf.sensRows.length} sizes`} theme={theme} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {dcf.monthlyDemandMWh.map((v, i) => (
                      <div key={i} style={{
                        background: theme.pillBg, borderRadius: 6, padding: "6px 8px",
                        fontSize: 11, color: theme.textSecondary,
                      }}>
                        <span style={{ fontWeight: 600, color: theme.textPrimary }}>{MONTHS_SHORT[i]}</span>
                        <span style={{ float: "right", color: theme.textMuted }}>{Math.round(v)} MWh</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Pick Scenarios ── */}
          {step === 2 && dcf && (
            <div>
              <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16, lineHeight: 1.6 }}>
                Select one row as <strong>Scenario A</strong> (typically the conservative option) and one as <strong>Scenario B</strong> (the larger site). The proposal will present both side-by-side.
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: theme.textMuted }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#3b82f6", display: "inline-block" }} /> Scenario A
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#F8632C", display: "inline-block" }} /> Scenario B
                </span>
                <span style={{ marginLeft: "auto", color: theme.textMuted }}>Annual demand: <strong style={{ color: theme.textPrimary }}>{dcf.annualDemandMWh.toLocaleString("en-GB")} MWh</strong></span>
              </div>

              {/* Sensitivity table */}
              <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${theme.border}` }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: theme.pillBg }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>MWp</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Generation</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Coverage</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>UL IRR</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>LCOE</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>NPV</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", fontWeight: 600, color: theme.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Scenario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dcf.sensRows.map((row, idx) => {
                      const isA = scAIdx === idx;
                      const isB = scBIdx === idx;
                      const bg  = isA ? "#3b82f611" : isB ? "#F8632C11" : "transparent";
                      const border = isA ? "1.5px solid #3b82f6" : isB ? "1.5px solid #F8632C" : `1px solid ${theme.borderSubtle || theme.border}`;
                      return (
                        <tr
                          key={idx}
                          style={{ background: bg, cursor: "pointer", transition: "background 0.1s" }}
                          onClick={() => {
                            // If already selected as A or B, deselect; else assign to A first, then B
                            if (isA) { setScAIdx(null); }
                            else if (isB) { setScBIdx(null); }
                            else if (scAIdx === null) { setScAIdx(idx); }
                            else if (scBIdx === null) { setScBIdx(idx); }
                            else { setScBIdx(idx); } // replace B
                          }}
                        >
                          <td style={{ padding: "9px 12px", fontWeight: 700, color: theme.textPrimary, borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            {row.mwp.toFixed(2)}
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "right", color: theme.textSecondary, borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            {Math.round(row.annualGenMWh).toLocaleString("en-GB")} MWh
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "right", color: theme.textSecondary, borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            {row.coveragePct}%
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "right", color: theme.textSecondary, borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            {(row.ulIrr * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "right", color: theme.textSecondary, borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            £{row.lcoe.toFixed(0)}/MWh
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "right", color: theme.textSecondary, borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            £{Math.round(row.npv).toLocaleString("en-GB")}
                          </td>
                          <td style={{ padding: "9px 10px", textAlign: "center", borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                            {isA && <span style={{ background: "#3b82f6", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>A</span>}
                            {isB && <span style={{ background: "#F8632C", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>B</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Export toggles */}
              {(scAIdx !== null || scBIdx !== null) && (
                <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
                  {scAIdx !== null && (
                    <div style={{
                      flex: 1, padding: 12, borderRadius: 10,
                      background: "#3b82f611", border: "1px solid #3b82f644",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", marginBottom: 8 }}>
                        SCENARIO A — {scARow.mwp.toFixed(2)} MWp
                      </div>
                      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 6 }}>
                        Generation: {Math.round(scARow.annualGenMWh).toLocaleString("en-GB")} MWh/yr · Coverage: {scARow.coveragePct}%
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: theme.textSecondary }}>
                        <input type="checkbox" checked={scAExport} onChange={e => setScAExport(e.target.checked)} />
                        Allow grid export
                      </label>
                    </div>
                  )}
                  {scBIdx !== null && (
                    <div style={{
                      flex: 1, padding: 12, borderRadius: 10,
                      background: "#F8632C11", border: "1px solid #F8632C44",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#F8632C", marginBottom: 8 }}>
                        SCENARIO B — {scBRow.mwp.toFixed(2)} MWp
                      </div>
                      <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 6 }}>
                        Generation: {Math.round(scBRow.annualGenMWh).toLocaleString("en-GB")} MWh/yr · Coverage: {scBRow.coveragePct}%
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: theme.textSecondary }}>
                        <input type="checkbox" checked={scBExport} onChange={e => setScBExport(e.target.checked)} />
                        Allow grid export
                      </label>
                    </div>
                  )}
                </div>
              )}

              {scAIdx !== null && scBIdx !== null && scAIdx === scBIdx && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#F8632C" }}>
                  ⚠️ Scenario A and B must be different sizes.
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Review ── */}
          {step === 3 && dcf && scARow && scBRow && (
            <div>
              <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 20, lineHeight: 1.6 }}>
                Review everything below, then click <strong>Generate Proposal</strong>. The HTML file will open in a new tab and download automatically.
              </div>

              {[
                { section: "Client & Site" },
                { label: "Organisation",      value: client.orgName },
                { label: "Site",              value: `${client.siteName}${client.postcode ? " · " + client.postcode : ""}` },
                { label: "Planning authority",value: client.planningAuth || "—" },
                { label: "Wire distance",     value: client.wireDistance || "—" },
                { label: "PPA term",          value: `${client.ppaTerm} years` },
                { label: "Prepared by",       value: client.preparerEmail || "—" },
                { label: "Date",              value: client.proposalDate },

                { section: "Energy (from DCF)" },
                { label: "Annual demand",     value: `${dcf.annualDemandMWh.toLocaleString("en-GB")} MWh/yr` },
                { label: "PPA1 rate",         value: `£${dcf.ppa1Price}/MWh` },

                { section: "Scenario A" },
                { label: "Capacity",          value: `${scARow.mwp.toFixed(2)} MWp` },
                { label: "Generation",        value: `${Math.round(scARow.annualGenMWh).toLocaleString("en-GB")} MWh/yr` },
                { label: "Coverage",          value: `${scARow.coveragePct}%` },
                { label: "Grid export",       value: scAExport ? `${Math.round(scARow.exportMWh).toLocaleString("en-GB")} MWh/yr` : "None" },
                { label: "LCOE",              value: `£${scARow.lcoe.toFixed(0)}/MWh` },
                { label: "Unlevered IRR",     value: `${(scARow.ulIrr * 100).toFixed(1)}%` },

                { section: "Scenario B" },
                { label: "Capacity",          value: `${scBRow.mwp.toFixed(2)} MWp` },
                { label: "Generation",        value: `${Math.round(scBRow.annualGenMWh).toLocaleString("en-GB")} MWh/yr` },
                { label: "Coverage",          value: `${scBRow.coveragePct}%` },
                { label: "Grid export",       value: scBExport ? `${Math.round(scBRow.exportMWh).toLocaleString("en-GB")} MWh/yr` : "None" },
                { label: "LCOE",              value: `£${scBRow.lcoe.toFixed(0)}/MWh` },
                { label: "Unlevered IRR",     value: `${(scBRow.ulIrr * 100).toFixed(1)}%` },
              ].map((row, i) => {
                if (row.section) return (
                  <div key={i} style={{ fontSize: 10, color: theme.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: i === 0 ? 0 : 14, marginBottom: 6 }}>
                    {row.section}
                  </div>
                );
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                    <span style={{ fontSize: 12, color: theme.textTertiary }}>{row.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{row.value}</span>
                  </div>
                );
              })}

              {generated && (
                <div style={{ marginTop: 20, padding: 14, background: "#4A8C5C22", border: "1px solid #4A8C5C66", borderRadius: 10, fontSize: 12, color: theme.textSecondary }}>
                  ✅ Proposal generated and downloaded. Click <strong>Generate Again</strong> to re-download.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div style={{
          padding: "14px 24px",
          borderTop: `1px solid ${theme.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexShrink: 0, background: theme.surfaceBg,
        }}>
          <div style={{ fontSize: 11, color: theme.textMuted }}>Step {step + 1} of {STEPS.length}</div>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                style={{ padding: "9px 18px", background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                ← Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(s => s + 1)} disabled={!canProceed()}
                style={{ padding: "9px 22px", background: canProceed() ? "#F8632C" : theme.textMuted, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: canProceed() ? "pointer" : "default", opacity: canProceed() ? 1 : 0.5 }}>
                Next →
              </button>
            ) : (
              <button onClick={handleGenerate} disabled={generating}
                style={{ padding: "9px 22px", background: generating ? theme.textMuted : "#F8632C", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: generating ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                {generating ? "Generating…" : generated ? "Generate Again" : "🚀 Generate Proposal"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
