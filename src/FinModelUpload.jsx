import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";

// ─── Parse the Grid CRM DCF template ──────────────────────────────────────────────
// Everything we read lives on the Inp_C tab (the consolidated "Grid CRM View"),
// labels in column E, values in column F. Most money lines are £k; the two
// exceptions are flagged inline. IRR / % lines are fractions.
function cellNum(ws, addr) {
  const c = ws[addr];
  if (!c || c.v == null) return null;
  const n = typeof c.v === "number" ? c.v : Number(c.v);
  return Number.isFinite(n) ? n : null;
}
function cellStr(ws, addr) {
  const c = ws[addr];
  if (!c || c.v == null) return null;
  const s = String(c.v).trim();
  return s || null;
}
// Dates come back as JS Dates (cellDates) or as Excel serials; normalise to ISO.
function cellDate(ws, addr) {
  const c = ws[addr];
  if (!c || c.v == null) return null;
  // Read the local components — toISOString() would shift BST dates back a day.
  if (c.v instanceof Date) {
    return `${c.v.getFullYear()}-${String(c.v.getMonth() + 1).padStart(2, "0")}-${String(c.v.getDate()).padStart(2, "0")}`;
  }
  if (typeof c.v === "number") {
    const d = XLSX.SSF.parse_date_code(c.v);
    if (!d || !d.y) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return null;
}
function sumRange(ws, col, r1, r2) {
  let s = 0, any = false;
  for (let r = r1; r <= r2; r++) { const v = cellNum(ws, col + r); if (v != null) { s += v; any = true; } }
  return any ? s : null;
}
const k = v => (v != null ? v * 1000 : null);   // £k → £
const pct = v => (v != null ? v * 100 : null);  // fraction → %

// Whichever offtake is switched on wins: CfD, then PPA 1, then PPA 2.
function activeOfftake(ws) {
  if (cellNum(ws, "F165") === 1) return { ppa_type: "CfD", ppa_price: cellNum(ws, "F167"), ppa_term: cellNum(ws, "F169") };
  if (cellNum(ws, "F178") === 1) return { ppa_type: "PPA 1", ppa_price: cellNum(ws, "F181"), ppa_term: cellNum(ws, "F183") };
  if (cellNum(ws, "F189") === 1) return { ppa_type: "PPA 2", ppa_price: cellNum(ws, "F192"), ppa_term: cellNum(ws, "F194") };
  return { ppa_type: null, ppa_price: null, ppa_term: null };
}

export async function parseFinModel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellFormula: false, cellDates: true });
  const ws = wb.Sheets["Inp_C"];
  if (!ws) throw new Error('Could not find the "Inp_C" tab in this workbook.');

  const irrFrac    = cellNum(ws, "F87");
  const capexK     = sumRange(ws, "F", 96, 112);
  if (irrFrac == null && capexK == null) throw new Error("No KPIs found at the expected cells — is this the standard Grid CRM DCF template?");

  const capacity   = cellNum(ws, "F57");            // Installed Capacity, MWp
  const gridCostK  = ["F97", "F98", "F99"]          // Cust. substation + contestables + non-contestables
    .map(a => cellNum(ws, a))
    .reduce((s, v) => (v == null ? s : (s == null ? v : s + v)), null);
  const opexPerMwpK = sumRange(ws, "F", 359, 373);  // £k/MWp opex lines

  return {
    // ── headline KPIs (unchanged keys — the dashboard and charts read these) ──
    irr_pct:      pct(irrFrac),                     // F87  Unlevered Project IRR
    acq_per_mwp:  k(cellNum(ws, "F89")),            // F89  Project Rights £k/MW
    acq_total:    k(cellNum(ws, "F90")),            // F90  Project Rights (£k despite the "£" unit label)
    epc:          k(cellNum(ws, "F96")),            // F96  Solar EPC
    total_capex:  k(capexK),                        // F96:F112

    // ── general ──
    model_project_name: cellStr(ws, "F13"),         // F13
    npv:          cellNum(ws, "F86"),               // F86  Unlevered Project NPV — already £, NOT £k

    // ── generation ──
    capacity_mwp:     capacity,                     // F57
    export_mw:        cellNum(ws, "F58"),           // F58  Export Capacity (MWac / MEC)
    yield_kwh_kwp:    cellNum(ws, "F59"),           // F59  Active Yield
    annual_gen_mwh:   cellNum(ws, "F60"),           // F60
    availability_pct: pct(cellNum(ws, "F74")),      // F74
    curtailment_pct:  cellNum(ws, "F79") === 1 ? pct(cellNum(ws, "F80")) : 0, // F79 switch / F80 curve

    // ── timeline ──
    financial_close:      cellDate(ws, "F39"),      // F39
    construction_start:   cellDate(ws, "F42"),      // F42
    construction_months:  cellNum(ws, "F43"),       // F43
    cod:                  cellDate(ws, "F44"),      // F44  COD Date
    asset_life_yrs:       cellNum(ws, "F48"),       // F48

    // ── capex breakdown ──
    grid_cost:            k(gridCostK),             // F97 + F98 + F99
    customer_substation:  k(cellNum(ws, "F97")),
    contestables:         k(cellNum(ws, "F98")),
    non_contestables:     k(cellNum(ws, "F99")),
    contingency:          k(cellNum(ws, "F110")),   // F110
    capex_per_mwp:        capexK != null && capacity ? k(capexK) / capacity : null,

    // ── opex & offtake ──
    opex_per_mwp: k(opexPerMwpK),                   // F359:F373, £k/MWp → £/MWp
    ...activeOfftake(ws),                           // ppa_type / ppa_price (£/MWh) / ppa_term

    // ── grid / network ──
    dno:              cellStr(ws, "F252"),          // F252
    connection_kv:    cellStr(ws, "F248"),          // F248
  };
}

export function fmtMoney(v) {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e6) return `£${(v / 1e6).toFixed(2)}m`;
  if (Math.abs(v) >= 1e3) return `£${(v / 1e3).toFixed(0)}k`;
  return `£${Math.round(v)}`;
}

// ─── Uploaded-model summary (shown in place of the DCF workflow) ──────────────
export function UploadedModelPanel({ data, project, theme, onReupload, onRemove, onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false);
  const stale = data && data.capacity_mwp === undefined; // parsed before the extended cell map

  async function download() {
    if (!data?.file_path) return;
    const { data: signed, error } = await supabase.storage.from("project-files").createSignedUrl(data.file_path, 60);
    if (error || !signed?.signedUrl) { window.alert("Couldn't open the file."); return; }
    window.open(signed.signedUrl, "_blank", "noopener");
  }

  // Re-read the stored workbook with the current cell map — no re-upload needed.
  async function refresh() {
    if (!data?.file_path || refreshing) return;
    setRefreshing(true);
    try {
      const { data: blob, error } = await supabase.storage.from("project-files").download(data.file_path);
      if (error || !blob) throw new Error("Couldn't read the stored file.");
      const parsed = await parseFinModel(blob);
      const { data: existing } = await supabase.from("project_acquisition").select("data").eq("project_id", project.id).maybeSingle();
      const newData = {
        ...(existing?.data || {}),
        model_source: "uploaded",
        fin_model: { ...(existing?.data?.fin_model || {}), ...parsed, refreshed_at: new Date().toISOString() },
      };
      const { error: saveErr } = await supabase.from("project_acquisition")
        .upsert({ project_id: project.id, data: newData, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
      if (saveErr) throw saveErr;
      onRefreshed?.(newData);
    } catch (e) {
      window.alert(e.message || String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const num = (v, dp, suffix) => (v != null ? `${v.toFixed(dp)}${suffix}` : "—");
  const date = v => (v ? new Date(v).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—");
  const kpis = [
    { label: "Project IRR", value: num(data?.irr_pct, 2, "%"), accent: true },
    { label: "Project NPV", value: fmtMoney(data?.npv) },
    { label: "Total Capex", value: fmtMoney(data?.total_capex) },
    { label: "Acquisition Cost", value: fmtMoney(data?.acq_total) },
    { label: "Acq £/MWp", value: fmtMoney(data?.acq_per_mwp) },
    { label: "EPC Cost", value: fmtMoney(data?.epc) },
    { label: "Capacity", value: num(data?.capacity_mwp, 2, " MWp") },
    { label: "Export", value: num(data?.export_mw, 0, " MW") },
    { label: "Yield", value: num(data?.yield_kwh_kwp, 0, " kWh/kWp") },
    { label: "COD", value: date(data?.cod) },
    { label: "Grid Cost", value: fmtMoney(data?.grid_cost) },
    { label: "Opex £/MWp", value: fmtMoney(data?.opex_per_mwp) },
  ];
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 48px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: theme.textPrimary }}>Uploaded Financial Model</div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span onClick={download} style={{ color: theme.accent, cursor: "pointer", fontWeight: 600 }}>📄 {data?.file_name || "model.xlsm"}</span>
              {data?.uploaded_at && <span>· uploaded {new Date(data.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={refresh} disabled={refreshing} style={{ fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, cursor: refreshing ? "default" : "pointer", color: theme.textSecondary, background: theme.pillBg, border: `1px solid ${theme.pillBorder || theme.cardBorder}`, fontFamily: "inherit", opacity: refreshing ? 0.6 : 1 }}>{refreshing ? "Refreshing…" : "↻ Refresh KPIs"}</button>
            <button onClick={onReupload} style={{ fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, cursor: "pointer", color: theme.textSecondary, background: theme.pillBg, border: `1px solid ${theme.pillBorder || theme.cardBorder}`, fontFamily: "inherit" }}>Re-upload</button>
            <button onClick={onRemove} style={{ fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, cursor: "pointer", color: "#EF4444", background: "transparent", border: "1px solid #EF444433", fontFamily: "inherit" }}>Remove</button>
          </div>
        </div>
        {stale && (
          <div style={{ fontSize: 12, color: theme.warning || "#F59E0B", background: (theme.warning || "#F59E0B") + "1A", border: `1px solid ${(theme.warning || "#F59E0B")}33`, borderRadius: 8, padding: "9px 12px", marginBottom: 14, lineHeight: 1.5 }}>
            This model was read with an older cell map, so capacity, yield, COD, opex and NPV are missing. Click <strong>↻ Refresh KPIs</strong> to re-read the stored file — nothing is re-uploaded and your manual overrides are kept.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 5 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.accent ? theme.accent : theme.textPrimary, letterSpacing: "-0.02em" }}>{k.value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 16, lineHeight: 1.5 }}>
          KPIs extracted from the <span style={{ fontFamily: "monospace" }}>Inp_C</span> tab. Project IRR and Total Capex feed the Acquisitions dashboard tiles and charts; these values also pre-fill the Project Overview, where any of them can be manually overridden. The built-in DCF workflow is hidden for this project.
        </div>
      </div>
    </div>
  );
}

// ─── Upload modal ─────────────────────────────────────────────────────────────
export default function FinModelUpload({ project, onClose, onDone }) {
  const { theme } = useTheme();
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(f) {
    if (!f) return;
    setError(""); setParsed(null); setFile(f);
    try { setParsed(await parseFinModel(f)); }
    catch (e) { setError(e.message); setFile(null); }
  }

  async function confirm() {
    if (!file || !parsed) return;
    setBusy(true); setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `fin-models/${project.id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("project-files").upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      // model_runs — IRR + Total Capex feed the existing dashboard/charts.
      const { data: runs } = await supabase.from("model_runs").select("fm_version").eq("project_id", project.id).order("fm_version", { ascending: false }).limit(1);
      const nextV = ((runs?.[0]?.fm_version) || 0) + 1;
      await supabase.from("model_runs").insert({
        project_id: project.id, fm_version: nextV, project_irr: parsed.irr_pct, total_capex: parsed.total_capex,
        created_by: user?.id || null, notes: `Uploaded fin model: ${file.name}`,
      });

      // project_acquisition.data — flag + acquisition-specific KPIs + file reference.
      const { data: existing } = await supabase.from("project_acquisition").select("data").eq("project_id", project.id).maybeSingle();
      const newData = {
        ...(existing?.data || {}),
        model_source: "uploaded",
        fin_model: { file_path: path, file_name: file.name, uploaded_at: new Date().toISOString(), ...parsed },
      };
      const { error: acqErr } = await supabase.from("project_acquisition").upsert({ project_id: project.id, data: newData, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
      if (acqErr) throw acqErr;

      onDone?.(newData);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const row = (label, value, accent) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}` }}>
      <span style={{ fontSize: 12, color: theme.textSecondary }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: accent ? theme.accent : theme.textPrimary }}>{value}</span>
    </div>
  );

  return (
    <div onClick={() => !busy && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", background: theme.elevatedBg || theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, padding: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>Upload Financial Model</div>
        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 16 }}>Excel (.xlsm/.xlsx) using the standard Grid CRM DCF template. KPIs are read from the <span style={{ fontFamily: "monospace" }}>Inp_C</span> tab.</div>

        {error && <div style={{ fontSize: 12, color: "#EF4444", background: "#EF44441A", border: "1px solid #EF444433", borderRadius: 6, padding: "8px 10px", marginBottom: 12 }}>{error}</div>}

        <label style={{ display: "block", textAlign: "center", border: `1px dashed ${theme.border}`, borderRadius: 8, padding: "16px", cursor: "pointer", color: theme.textSecondary, fontSize: 12, marginBottom: 14 }}>
          {file ? `📄 ${file.name}` : "Choose Excel file…"}
          <input type="file" accept=".xlsm,.xlsx" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; pick(f); e.target.value = ""; }} />
        </label>

        {parsed && (
          <div style={{ marginBottom: 16, maxHeight: 300, overflowY: "auto" }}>
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 }}>Extracted KPIs</div>
            {row("Project IRR", parsed.irr_pct != null ? `${parsed.irr_pct.toFixed(2)}%` : "—", true)}
            {row("Project NPV", fmtMoney(parsed.npv))}
            {row("Capacity", parsed.capacity_mwp != null ? `${parsed.capacity_mwp} MWp` : "—")}
            {row("Export", parsed.export_mw != null ? `${parsed.export_mw} MW` : "—")}
            {row("Yield", parsed.yield_kwh_kwp != null ? `${parsed.yield_kwh_kwp} kWh/kWp` : "—")}
            {row("COD", parsed.cod ? new Date(parsed.cod).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—")}
            {row("Total Capex", fmtMoney(parsed.total_capex))}
            {row("Grid Cost", fmtMoney(parsed.grid_cost))}
            {row("Opex £/MWp", fmtMoney(parsed.opex_per_mwp))}
            {row(parsed.ppa_type ? `${parsed.ppa_type} Price` : "Offtake Price", parsed.ppa_price != null ? `£${parsed.ppa_price}/MWh` : "—")}
            {row("Acquisition Cost (total)", fmtMoney(parsed.acq_total))}
            {row("Acquisition £/MWp", fmtMoney(parsed.acq_per_mwp))}
            {row("EPC Cost", fmtMoney(parsed.epc))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ fontSize: 12, fontWeight: 600, padding: "8px 14px", borderRadius: 6, cursor: busy ? "default" : "pointer", background: "transparent", color: theme.textSecondary, border: `1px solid ${theme.border}`, fontFamily: "inherit" }}>Cancel</button>
          <button onClick={confirm} disabled={busy || !parsed} style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 6, cursor: (busy || !parsed) ? "default" : "pointer", background: theme.accent, color: "#fff", border: "none", fontFamily: "inherit", opacity: (busy || !parsed) ? 0.6 : 1 }}>{busy ? "Saving…" : "Confirm & Save"}</button>
        </div>
      </div>
    </div>
  );
}
