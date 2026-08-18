import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";
import { STAGES, countCompleted, getCurrentStageName, isGateDeclined } from "./AcquisitionProcess.jsx";

// ─── COLLAPSIBLE SECTION ─────────────────────────────────────────────────────

function Section({ title, defaultOpen = true, children }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          fontSize: 18, fontWeight: 700, color: theme.textPrimary,
          padding: "8px 0", userSelect: "none",
        }}
      >
        <span style={{
          display: "inline-block", transition: "transform 0.2s",
          transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          fontSize: 12, color: theme.textTertiary,
        }}>▼</span>
        {title}
      </div>
      {open && <div style={{ paddingLeft: 4 }}>{children}</div>}
    </div>
  );
}

// ─── EDITABLE TABLE ROW ──────────────────────────────────────────────────────

function FieldRow({ label, value, onChange, placeholder, cols = 2 }) {
  const { theme } = useTheme();
  if (cols === 3) return null; // handled by ValuationTable
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "200px 1fr",
      borderBottom: `1px solid ${theme.borderSubtle}`, minHeight: 40, alignItems: "center",
    }}>
      <div style={{ fontSize: 13, color: theme.textSecondary, padding: "8px 12px", fontWeight: 500 }}>{label}</div>
      <input
        type="text"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || "—"}
        style={{
          background: "transparent", border: "none", outline: "none",
          fontSize: 13, color: theme.textPrimary, padding: "8px 12px",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
        onFocus={e => e.target.style.background = theme.accentBg}
        onBlur={e => e.target.style.background = "transparent"}
      />
    </div>
  );
}

// ─── VALUATION TABLE (3-column: Assumptions | Market View | Grid CRM View) ───────

function ValuationTable({ rows, data, onChange, autoValues }) {
  const { theme } = useTheme();
  return (
    <div style={{ border: `1px solid ${theme.textMuted}`, borderRadius: 4, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "180px 1fr 1fr",
        background: theme.tableLabelBg, borderBottom: `1px solid ${theme.textMuted}`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, padding: "10px 14px" }}>Assumptions</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, padding: "10px 14px", borderLeft: `1px solid ${theme.textMuted}` }}>Market View</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, padding: "10px 14px", borderLeft: `1px solid ${theme.textMuted}` }}>Grid CRM View</div>
      </div>
      {rows.map(({ key, label, unit }, i) => {
        const autoVal = autoValues?.[key];
        const hasAuto = autoVal !== undefined && autoVal !== null;
        const overridden = hasAuto && data[`${key}_gridcrm`] != null && data[`${key}_gridcrm`] !== "";
        return (
        <div key={key} style={{
          display: "grid", gridTemplateColumns: "180px 1fr 1fr",
          borderBottom: i < rows.length - 1 ? `1px solid ${theme.borderSubtle}` : "none",
          minHeight: 42, alignItems: "stretch",
        }}>
          <div style={{ fontSize: 13, color: theme.textPrimary, padding: "8px 14px", fontWeight: 500, background: theme.tableLabelBg, display: "flex", alignItems: "center" }}>{label}</div>
          <div style={{ display: "flex", alignItems: "stretch", borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg }}>
            <input
              type="text"
              value={data[`${key}_market`] || ""}
              onChange={e => onChange(`${key}_market`, e.target.value)}
              placeholder="—"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontSize: 13, color: theme.textPrimary, padding: "8px 14px", fontFamily: "'Inter', system-ui, sans-serif",
              }}
              onFocus={e => e.target.style.background = theme.accentBg}
              onBlur={e => e.target.style.background = "transparent"}
            />
            {unit && (
              <span style={{
                display: "flex", alignItems: "center",
                padding: "0 8px", background: theme.hoverBg,
                fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap",
                borderLeft: `1px solid ${theme.border}`,
              }}>{unit}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "stretch", borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg }}>
            <input
              type="text"
              value={hasAuto ? (overridden ? data[`${key}_gridcrm`] : autoVal) : (data[`${key}_gridcrm`] || "")}
              onChange={e => onChange(`${key}_gridcrm`, e.target.value)}
              placeholder="—"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontSize: 13, color: theme.textPrimary, padding: "8px 14px", fontFamily: "'Inter', system-ui, sans-serif",
              }}
              onFocus={e => e.target.style.background = theme.accentBg}
              onBlur={e => e.target.style.background = "transparent"}
            />
            {hasAuto && <FMBadge overridden={overridden} onRevert={() => onChange(`${key}_gridcrm`, "")} theme={theme} />}
            {unit && (
              <span style={{
                display: "flex", alignItems: "center",
                padding: "0 8px", background: theme.hoverBg,
                fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap",
                borderLeft: `1px solid ${theme.border}`,
              }}>{unit}</span>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ─── FREE TEXT AREA ──────────────────────────────────────────────────────────

function FreeText({ value, onChange, placeholder }) {
  const { theme } = useTheme();
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || "Add notes here..."}
      rows={4}
      style={{
        width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.borderSubtle}`,
        borderRadius: 8, padding: "10px 12px", fontSize: 13, color: theme.textPrimary,
        fontFamily: "'Inter', system-ui, sans-serif", resize: "none",
        outline: "none", lineHeight: 1.6, overflow: "hidden",
      }}
      onFocus={e => e.target.style.borderColor = theme.accent}
      onBlur={e => e.target.style.borderColor = theme.borderSubtle}
    />
  );
}

// ─── FM / EDITED BADGE ───────────────────────────────────────────────────────
// FM-derived fields stay editable: the model value is the default, typing over
// it stores an override, and ↺ (or clearing the field) drops back to the model.

function FMBadge({ overridden, onRevert, theme }) {
  const colour = overridden ? (theme.warning || "#F59E0B") : theme.success;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, paddingRight: 8 }}>
      <span
        title={overridden ? "Manually overridden — the financial model says something different" : "Auto-filled from the financial model"}
        style={{
          fontSize: 9, color: colour, background: colour + "22", padding: "1px 6px",
          borderRadius: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
        }}
      >{overridden ? "Edited" : "FM"}</span>
      {overridden && (
        <span
          onClick={onRevert}
          title="Revert to the financial model value"
          style={{ cursor: "pointer", fontSize: 11, color: theme.textTertiary, lineHeight: 1, padding: "0 2px" }}
        >↺</span>
      )}
    </span>
  );
}

// ─── SIMPLE TABLE (2-column key/value) ───────────────────────────────────────

function SimpleTable({ fields, data, onChange, autoValues }) {
  const { theme } = useTheme();
  return (
    <div style={{ border: `1px solid ${theme.textMuted}`, borderRadius: 4, overflow: "hidden" }}>
      {fields.map(({ key, label, unit, type, options }, i) => {
        const autoVal = autoValues?.[key];
        const hasAuto = autoVal !== undefined && autoVal !== null;
        const overridden = hasAuto && data[key] != null && data[key] !== "";
        return (
          <div key={key} style={{
            display: "grid", gridTemplateColumns: "200px 1fr",
            borderBottom: i < fields.length - 1 ? `1px solid ${theme.borderSubtle}` : "none",
            minHeight: 42, alignItems: "stretch",
          }}>
            <div style={{
              fontSize: 13, color: theme.textPrimary, padding: "8px 14px", fontWeight: 500,
              background: theme.tableLabelBg, display: "flex", alignItems: "center",
            }}>{label}</div>
            {hasAuto ? (
              <div style={{
                display: "flex", alignItems: "center",
                borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg,
              }}>
                <input
                  type="text"
                  value={overridden ? data[key] : autoVal}
                  onChange={e => onChange(key, e.target.value)}
                  style={{
                    flex: 1, background: "transparent", border: "none", outline: "none",
                    fontSize: 13, color: theme.textPrimary, padding: "8px 14px",
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                  onFocus={e => e.target.style.background = theme.accentBg}
                  onBlur={e => e.target.style.background = "transparent"}
                />
                <FMBadge overridden={overridden} onRevert={() => onChange(key, "")} theme={theme} />
              </div>
            ) : type === "select" ? (
              <div style={{ borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg, display: "flex", alignItems: "stretch" }}>
                <select
                  value={data[key] || ""}
                  onChange={e => onChange(key, e.target.value)}
                  style={{
                    flex: 1, background: "transparent", border: "none", outline: "none",
                    fontSize: 13, color: theme.textPrimary, padding: "8px 14px",
                    fontFamily: "'Inter', system-ui, sans-serif", cursor: "pointer",
                  }}
                >
                  {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "stretch",
                borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg,
              }}>
                <input
                  type="text"
                  value={data[key] || ""}
                  onChange={e => onChange(key, e.target.value)}
                  placeholder="—"
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    outline: "none", fontSize: 13, color: theme.textPrimary, padding: "8px 14px",
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                  onFocus={e => e.target.style.background = theme.accentBg}
                  onBlur={e => e.target.style.background = "transparent"}
                />
                {unit && (
                  <span style={{
                    display: "flex", alignItems: "center",
                    padding: "0 10px", background: theme.hoverBg,
                    fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap",
                    borderLeft: `1px solid ${theme.border}`,
                  }}>{unit}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── FIELD DEFINITIONS ───────────────────────────────────────────────────────

const EXEC_SUMMARY_FIELDS = [
  { key: "status", label: "Status", type: "select", options: ["Greenfield", "RtB", "Operational"] },
  { key: "recommendation", label: "Recommendation" },
  { key: "size", label: "Size", unit: "MWp" },
  { key: "project_yield", label: "Project Yield", unit: "kWh/kWp" },
  { key: "site_status_timeline", label: "Site Status & Timeline" },
  { key: "price", label: "Price", unit: "£" },
  { key: "structure", label: "Structure" },
  { key: "irr_target", label: "IRR (Target 7.5%)", unit: "%" },
];

const PROJECT_OVERVIEW_FIELDS = [
  { key: "location", label: "Location" },
  { key: "planning", label: "Planning" },
  { key: "capacity", label: "Capacity", unit: "MWp" },
  { key: "export", label: "Export", unit: "MW" },
  { key: "import", label: "Import", unit: "MW" },
  { key: "grid_connection_date", label: "Grid Connection Date" },
  { key: "grid_cost", label: "Grid Cost", unit: "£" },
  { key: "yield_kwh_kwp", label: "Yield", unit: "kWh/kWp" },
  { key: "land", label: "Land" },
  { key: "gtm", label: "GTM" },
  { key: "est_construction_cost", label: "Est Construction Cost", unit: "£" },
  { key: "capex_grid", label: "Capex + Grid", unit: "£" },
];

const VALUATION_ROWS = [
  { key: "capex", label: "Capex", unit: "£/MWp" },
  { key: "opex", label: "Opex", unit: "£/MWp" },
  { key: "ppa", label: "PPA", unit: "£/MWh" },
  { key: "debt", label: "Debt" },
  { key: "cod", label: "COD" },
  { key: "bid", label: "Bid", unit: "£/MWp" },
  { key: "irr", label: "IRR", unit: "%" },
  { key: "npv", label: "NPV", unit: "£k" },
];

const GRID_FIELDS = [
  { key: "grid_export", label: "Export", unit: "MW" },
  { key: "grid_import", label: "Import", unit: "MW" },
  { key: "grid_connection_date_detail", label: "Grid Connection Date" },
  { key: "gate_2", label: "Gate 2" },
  { key: "grid_cost_mwe", label: "Grid Cost", unit: "£/MWe" },
  { key: "total_grid_cost_offer", label: "Total Grid Cost Offer", unit: "£" },
  { key: "curtailment", label: "Curtailment", unit: "%" },
  { key: "dno", label: "DNO" },
];

const LAND_FIELDS = [
  { key: "landlord", label: "Landlord" },
  { key: "option_lease_status", label: "Option / Lease status" },
  { key: "option_period", label: "Option Period" },
  { key: "lease_term_extensions", label: "Lease term & extensions" },
  { key: "rent", label: "Rent", unit: "£/yr" },
  { key: "indexation", label: "Indexation", unit: "%" },
  { key: "revenue_share", label: "Revenue Share (if any)", unit: "%" },
];

// ─── HELPERS: compute capex from FM inputs ──────────────────────────────────

function calcCapexGrandTotal(inp) {
  if (!inp) return 0;
  const epcEquipment = (inp.epcModules || 0) + (inp.epcInverters || 0) + (inp.epcTxStations || 0) + (inp.epcMountingStructure || 0) +
    (inp.epcPpcScada || 0) + (inp.epcCctvSecurity || 0) + (inp.epcSparesContainer || 0) + (inp.epcCables || 0) + (inp.epcSubstation || 0) + (inp.epcContingencies || 0);
  const epcServices = (inp.svcElectrical || 0) + (inp.svcMechanical || 0) + (inp.svcCivil || 0) + (inp.svcTestStudies || 0) +
    (inp.svcEngineering || 0) + (inp.svcLandscaping || 0) + (inp.svcLaydown || 0);
  const epcBase = epcEquipment + epcServices;
  const epcTotal = epcBase * (1 + (inp.epcMarginPct || 0) / 100);
  const gridTotal = (inp.gridCableRun || 0) + (inp.gridCustomerSubstation || 0) + (inp.gridContestable || 0) + (inp.gridNonContestable || 0);
  const otherTotal = (inp.landLease || 0) + (inp.constructionInsurance || 0) + (inp.preCon || 0) + (inp.acquisition || 0) + (inp.ddCosts || 0);
  return epcTotal + gridTotal + otherTotal;
}

function fmtGBP(v) {
  if (!v || v === 0) return null;
  if (v >= 1e6) return `£${(v / 1e6).toFixed(2)}m`;
  if (v >= 1e3) return `£${(v / 1e3).toFixed(0)}k`;
  return `£${v.toFixed(0)}`;
}

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function ProjectOverview({ project, session, onNavigate }) {
  const { theme } = useTheme();
  const [data, setData] = useState({});
  const [fmInputs, setFmInputs] = useState(null);
  const [fmKpis, setFmKpis] = useState(null);
  const [acqData, setAcqData] = useState({});
  const [fmVersionDates, setFmVersionDates] = useState({});
  const [saveStatus, setSaveStatus] = useState("saved");
  const saveTimer = useRef(null);

  // Editable project name
  const [displayName, setDisplayName] = useState(project?.name || "");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  useEffect(() => { setDisplayName(project?.name || ""); setEditingName(false); }, [project?.id]);

  const saveName = useCallback(async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === displayName) return;
    setDisplayName(next);
    if (project) project.name = next; // keep the top-bar title in sync
    const { error } = await supabase.from("projects").update({ name: next }).eq("id", project.id);
    if (error) { console.error("Name update failed:", error); setDisplayName(project?.name || ""); }
  }, [nameDraft, displayName, project]);

  // Load overview data + financial model inputs from supabase
  useEffect(() => {
    if (!project) return;
    const load = async () => {
      // Load overview data
      const { data: overviewRows } = await supabase
        .from("project_overview")
        .select("data")
        .eq("project_id", project.id)
        .limit(1);
      if (overviewRows?.[0]?.data) {
        const { status: _ignore, ...rest } = overviewRows[0].data;
        setData({ status: project.status, ...rest });
      } else {
        setData({ status: project.status });
      }

      // Load best available FM inputs (FID > FABO > NBO)
      const { data: inputRows } = await supabase
        .from("project_inputs")
        .select("inputs, version")
        .eq("project_id", project.id)
        .order("version", { ascending: false })
        .limit(1);
      if (inputRows?.[0]?.inputs) setFmInputs(inputRows[0].inputs);

      // Load best available model run KPIs (FID > FABO > NBO)
      const { data: runRows } = await supabase
        .from("model_runs")
        .select("*")
        .eq("project_id", project.id)
        .order("fm_version", { ascending: false })
        .limit(1);
      if (runRows?.[0]) setFmKpis(runRows[0]);

      // Load acquisition process data (for progress metrics)
      const { data: acqRows } = await supabase
        .from("project_acquisition")
        .select("data")
        .eq("project_id", project.id)
        .limit(1);
      if (acqRows?.[0]?.data) setAcqData(acqRows[0].data);

      // Load FM version dates (for acquisition progress counting)
      const { data: fmRows } = await supabase
        .from("project_inputs")
        .select("version, fm_created_at, created_at")
        .eq("project_id", project.id);
      if (fmRows) {
        const dates = {};
        for (const row of fmRows) {
          dates[row.version] = row.fm_created_at || row.created_at;
        }
        setFmVersionDates(dates);
      }
    };
    load();
  }, [project]);

  // Auto-save overview data
  useEffect(() => {
    if (!project) return;
    if (Object.keys(data).length === 0) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");

    saveTimer.current = setTimeout(async () => {
      try {
        const { data: existing } = await supabase
          .from("project_overview")
          .select("project_id")
          .eq("project_id", project.id)
          .limit(1);

        let error;
        const { status: _omit, ...overviewData } = data;
        if (existing && existing.length > 0) {
          ({ error } = await supabase
            .from("project_overview")
            .update({ data: overviewData, updated_at: new Date().toISOString() })
            .eq("project_id", project.id));
        } else {
          ({ error } = await supabase
            .from("project_overview")
            .insert({ project_id: project.id, data: overviewData, updated_at: new Date().toISOString() }));
        }

        if (error) console.error("Overview save error:", error);
        setSaveStatus(error ? "error" : "saved");
      } catch (e) {
        console.error("Overview save exception:", e);
        setSaveStatus("error");
      }
    }, 1500);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data, project]);

  const updateField = useCallback(async (key, value) => {
    setData(prev => ({ ...prev, [key]: value }));
    // Status lives on the projects table, not project_overview
    if (key === "status") {
      const { error } = await supabase
        .from("projects")
        .update({ status: value })
        .eq("id", project.id)
        .select();
      if (error) console.error("Status update failed:", error);
    }
  }, [project]);

  // ─── Compute acquisition progress metrics ─────────────────────────────────
  const acqMetrics = useMemo(() => {
    let totalAll = 0, doneAll = 0;
    for (const stage of STAGES) {
      const { total, done } = countCompleted(stage.tasks, acqData, fmVersionDates);
      totalAll += total;
      doneAll += done;
    }
    const currentStage = getCurrentStageName(acqData, fmVersionDates);
    const pct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;
    return { totalAll, doneAll, pct, currentStage };
  }, [acqData, fmVersionDates]);

  // ─── Compute auto-fill values from Financial Model ───────────────────────
  // Two sources: an uploaded workbook (project_acquisition.data.fin_model, cells
  // read off the Inp_C tab) or the in-app DCF inputs. An uploaded model wins,
  // since the DCF workflow is hidden for those projects.
  const uploaded = acqData?.model_source === "uploaded" ? acqData.fin_model : null;
  const fm = fmInputs || {};
  const gridCostTotal = (fm.gridContestable || 0) + (fm.gridNonContestable || 0);
  const totalCapex = calcCapexGrandTotal(fm);
  const totalConsideration = fm.bidPerMWp && fm.capacity ? (fm.bidPerMWp / 1000) * fm.capacity : 0;
  const projectIRR = uploaded?.irr_pct ?? fmKpis?.project_irr;

  let execAutoValues, overviewAutoValues, valuationAutoValues, gridAutoValues = {};

  if (uploaded) {
    const u = uploaded;
    const capacity = u.capacity_mwp;
    execAutoValues = {
      size: capacity != null ? `${capacity} MWp` : null,
      project_yield: u.yield_kwh_kwp != null ? `${u.yield_kwh_kwp} kWh/kWp` : null,
      price: fmtGBP(u.acq_total),
      irr_target: u.irr_pct != null ? `${u.irr_pct.toFixed(2)}%` : null,
    };
    overviewAutoValues = {
      capacity: capacity != null ? `${capacity} MWp` : null,
      export: u.export_mw != null ? `${u.export_mw} MW` : null,
      grid_connection_date: fmtDate(u.cod),
      grid_cost: fmtGBP(u.grid_cost),
      yield_kwh_kwp: u.yield_kwh_kwp != null ? `${u.yield_kwh_kwp} kWh/kWp` : null,
      est_construction_cost: fmtGBP(u.epc),
      capex_grid: fmtGBP(u.total_capex),
    };
    valuationAutoValues = {
      capex: u.capex_per_mwp != null ? Math.round(u.capex_per_mwp).toLocaleString("en-GB") : null,
      opex: u.opex_per_mwp != null ? Math.round(u.opex_per_mwp).toLocaleString("en-GB") : null,
      ppa: u.ppa_price != null ? String(u.ppa_price) : null,
      cod: fmtDate(u.cod),
      bid: u.acq_per_mwp != null ? Math.round(u.acq_per_mwp).toLocaleString("en-GB") : null,
      irr: u.irr_pct != null ? u.irr_pct.toFixed(2) : null,
      npv: u.npv != null ? Math.round(u.npv / 1000).toLocaleString("en-GB") : null, // F86 is £, table is £k
    };
    gridAutoValues = {
      grid_export: u.export_mw != null ? `${u.export_mw} MW` : null,
      grid_connection_date_detail: fmtDate(u.cod),
      grid_cost_mwe: u.grid_cost != null && u.export_mw ? fmtGBP(u.grid_cost / u.export_mw) : null,
      total_grid_cost_offer: fmtGBP(u.grid_cost),
      curtailment: u.curtailment_pct != null ? `${u.curtailment_pct}%` : null,
      dno: u.dno || null,
    };
  } else {
    execAutoValues = {
      size: fm.capacity ? `${fm.capacity} MWp` : null,
      project_yield: fm.yield_ ? `${fm.yield_} kWh/kWp` : null,
      price: totalConsideration ? fmtGBP(totalConsideration * 1000) : null,
      irr_target: projectIRR != null ? `${projectIRR.toFixed(2)}%` : null,
    };
    overviewAutoValues = {
      capacity: fm.capacity ? `${fm.capacity} MWp` : null,
      export: fm.exportCapacity ? `${fm.exportCapacity} MW` : null,
      grid_connection_date: fm.cod || null,
      grid_cost: gridCostTotal ? fmtGBP(gridCostTotal) : null,
      yield_kwh_kwp: fm.yield_ ? `${fm.yield_} kWh/kWp` : null,
      capex_grid: totalCapex ? fmtGBP(totalCapex) : null,
    };
    valuationAutoValues = {
      capex: totalCapex && fm.capacity ? Math.round(totalCapex / fm.capacity).toLocaleString("en-GB") : null,
      cod: fm.cod || null,
      bid: fm.bidPerMWp ? Math.round(fm.bidPerMWp * 1000).toLocaleString("en-GB") : null,
      irr: projectIRR != null ? projectIRR.toFixed(2) : null,
    };
  }

  return (
    <div style={{
      flex: 1, overflowY: "auto", background: theme.pageBg,
      padding: "32px 48px", fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          {editingName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 4 }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                onBlur={saveName}
                style={{
                  fontSize: 28, fontWeight: 800, color: theme.textPrimary,
                  background: theme.pillBg, border: `1px solid ${theme.accent}`,
                  borderRadius: 8, padding: "2px 10px", fontFamily: "inherit", outline: "none",
                  minWidth: 280,
                }}
              />
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={saveName}
                style={{
                  fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                  color: "#fff", background: theme.accent, border: `1px solid ${theme.accent}`, fontFamily: "inherit",
                }}
              >Save</button>
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => setEditingName(false)}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                  color: theme.textSecondary, background: "transparent", border: `1px solid ${theme.border}`, fontFamily: "inherit",
                }}
              >Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 4 }}>
              <h1 style={{ fontSize: 28, fontWeight: 800, color: theme.textPrimary, margin: 0 }}>
                {displayName || "Project Name"}
              </h1>
              <button
                onClick={() => { setNameDraft(displayName); setEditingName(true); }}
                title="Edit project name"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: theme.textTertiary, fontSize: 16, lineHeight: 1,
                  padding: 6, borderRadius: 6, transition: "all 0.1s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg; e.currentTarget.style.color = theme.textPrimary; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = theme.textTertiary; }}
              >✎</button>
            </div>
          )}
          <div style={{ fontSize: 12, color: saveStatus === "saved" ? theme.success : saveStatus === "saving" ? theme.warning : theme.error, fontWeight: 600 }}>
            {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving..." : "Save error"}
          </div>
        </div>

        {/* Metrics bar */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12,
          marginBottom: 28,
        }}>
          {/* Project IRR */}
          <div
            onClick={() => onNavigate?.("financial")}
            style={{
              background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
              padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.borderSubtle; e.currentTarget.style.background = theme.elevatedBg; }}
          >
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Project IRR</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: projectIRR != null ? theme.textPrimary : theme.textMuted }}>
              {projectIRR != null ? `${projectIRR.toFixed(2)}%` : "—"}
            </div>
            {projectIRR != null && (
              <div style={{ fontSize: 10, color: projectIRR >= 7.5 ? theme.success : theme.accent, marginTop: 2 }}>
                {projectIRR >= 7.5 ? "Above target" : "Below 7.5% target"}
              </div>
            )}
          </div>

          {/* Acquisition Progress */}
          <div
            onClick={() => onNavigate?.("acquisition")}
            style={{
              background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
              padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.borderSubtle; e.currentTarget.style.background = theme.elevatedBg; }}
          >
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Acquisition Progress</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.textPrimary }}>
              {acqMetrics.pct}%
            </div>
            <div style={{ width: "100%", height: 4, background: theme.progressTrack, borderRadius: 2, marginTop: 6 }}>
              <div style={{
                width: `${acqMetrics.pct}%`, height: "100%", borderRadius: 2,
                background: acqMetrics.pct === 100 ? theme.success : theme.accent,
                transition: "width 0.3s ease",
              }} />
            </div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 4 }}>
              {acqMetrics.doneAll} of {acqMetrics.totalAll} tasks
            </div>
          </div>

          {/* Current Stage */}
          <div
            onClick={() => onNavigate?.("acquisition")}
            style={{
              background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
              padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.borderSubtle; e.currentTarget.style.background = theme.elevatedBg; }}
          >
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Current Stage</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, lineHeight: 1.3 }}>
              {acqMetrics.currentStage}
            </div>
          </div>
        </div>

        {/* Immediate Plan */}
        <Section title="Immediate Plan">
          <FreeText
            value={data.immediate_plan}
            onChange={v => updateField("immediate_plan", v)}
            placeholder="Describe the immediate plan for this project..."
          />
        </Section>

        {/* Executive Summary */}
        <Section title="Executive Summary">
          <SimpleTable fields={EXEC_SUMMARY_FIELDS} data={data} onChange={updateField} autoValues={execAutoValues} />
        </Section>

        {/* Projects Overview */}
        <Section title="Projects Overview">
          <SimpleTable fields={PROJECT_OVERVIEW_FIELDS} data={data} onChange={updateField} autoValues={overviewAutoValues} />
        </Section>

        {/* Valuation */}
        <Section title="Valuation">
          <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 12, fontStyle: "italic" }}>
            Current Valuation as of "To days date"
          </div>
          <ValuationTable rows={VALUATION_ROWS} data={data} onChange={updateField} autoValues={valuationAutoValues} />
        </Section>

        {/* Structure */}
        <Section title="Structure">
          <FreeText
            value={data.structure_notes}
            onChange={v => updateField("structure_notes", v)}
            placeholder="Describe the project structure..."
          />
        </Section>

        {/* Planning */}
        <Section title="Planning">
          <FreeText
            value={data.planning_notes}
            onChange={v => updateField("planning_notes", v)}
            placeholder="Planning notes and details..."
          />
        </Section>

        {/* Grid */}
        <Section title="Grid">
          <SimpleTable fields={GRID_FIELDS} data={data} onChange={updateField} autoValues={gridAutoValues} />
        </Section>

        {/* Land */}
        <Section title="Land">
          <SimpleTable fields={LAND_FIELDS} data={data} onChange={updateField} />
        </Section>

      </div>
    </div>
  );
}
