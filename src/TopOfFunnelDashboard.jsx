import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { supabase } from "./supabase.js";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  StackedBarChart, PipelineFunnel, ChartBox,
  CHANNEL_COLORS, SECTOR_COLORS, OWNER_PALETTE,
  STAGE_COLORS_GRID_CRM, STAGES, STAGE_LABELS,
  getDaysBetween, formatDaysInStage, getDurationColor,
} from "./PrivateWireDashboard.jsx";
import { GridAppBatteryChart } from "./GreenfieldProjects.jsx";
import { DEAL_STAGE_COLORS, DEAL_STAGES_ORDERED, getDealStage } from "./Portfolio.jsx";

// ─── Sections ────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: "all", label: "All",            color: "#94a3b8" },
  { id: "pw",  label: "Private Wire",   color: "#3b82f6" },
  { id: "gf",  label: "Greenfield",     color: "#10b981" },
  { id: "acq", label: "Acquisitions",   color: "#f59e0b" },
  { id: "dc",  label: "Data Centres",   color: "#F97316" },
];

// ─── Widget registry ───────────────────────────────────────────────────────────
const WIDGET_DEFS = [
  { id: "pw-kpis",        section: "pw",  title: "PW · KPIs",                color: "#3b82f6", default: { x: 0,  y: 0,  w: 12, h: 2 } },
  { id: "pw-outreach",   section: "pw",  title: "PW · Outreach Activity",  color: "#3b82f6", default: { x: 0,  y: 2,  w: 7,  h: 6 } },
  { id: "pw-lead-volume", section: "pw",  title: "PW · Lead Volume",        color: "#3b82f6", default: { x: 0,  y: 8,  w: 12, h: 6 } },
  { id: "pw-pipeline",   section: "pw",  title: "PW · Pipeline",           color: "#3b82f6", default: { x: 7,  y: 2,  w: 5,  h: 6 } },
  { id: "pw-opps",       section: "pw",  title: "PW · Active Opps",        color: "#3b82f6", default: { x: 0,  y: 14, w: 12, h: 7 } },
  { id: "gf",           section: "gf",  title: "Greenfield",             color: "#10b981", default: { x: 0,  y: 15, w: 6,  h: 7 } },
  { id: "acq-velocity", section: "acq", title: "Acq · Velocity",         color: "#f59e0b", default: { x: 6,  y: 15, w: 3,  h: 7 } },
  { id: "acq-pipeline", section: "acq", title: "Acq · Pipeline",         color: "#f59e0b", default: { x: 9,  y: 15, w: 3,  h: 7 } },
  // Added 2026-05 — capacity KPIs + Grid App Submitted battery chart
  { id: "acq-total-capacity", section: "acq", title: "Acq · Total Capacity",          color: "#f59e0b", default: { x: 0, y: 22, w: 6,  h: 2 } },
  { id: "gf-active-capacity", section: "gf",  title: "GF · Active Capacity",          color: "#10b981", default: { x: 6, y: 22, w: 6,  h: 2 } },
  { id: "gf-battery",         section: "gf",  title: "GF · Grid App Submitted (MWp)", color: "#10b981", default: { x: 0, y: 24, w: 12, h: 6 } },
  // Added 2026-05 — projects by deal stage (MWp + count)
  { id: "acq-stages",         section: "acq", title: "Acq · Projects by Stage (MWp)", color: "#f59e0b", default: { x: 0, y: 30, w: 12, h: 5 } },
  { id: "acq-cod",            section: "acq", title: "Acq · MWp by COD",             color: "#f59e0b", default: { x: 0, y: 35, w: 12, h: 6 } },
];

const WIDGET_SECTION = Object.fromEntries(WIDGET_DEFS.map(w => [w.id, w.section]));

const LAYOUT_KEY  = "tof-layout-v4";
const REMOVED_KEY = "tof-removed-v4";
const SECTION_KEY = "tof-section-v1";
const ROW_H       = 60;
const OUTREACH_START = "2026-04-06";

const DEFAULT_LAYOUT = WIDGET_DEFS.map(w => ({ i: w.id, ...w.default }));

// Merge any new widgets (added since the user's last save) into their saved layout,
// so they appear at their default position without losing existing customisations.
function loadLayout() {
  try {
    const s = localStorage.getItem(LAYOUT_KEY);
    if (!s) return DEFAULT_LAYOUT;
    const saved = JSON.parse(s);
    if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_LAYOUT;
    const savedIds = new Set(saved.map(l => l.i));
    const additions = WIDGET_DEFS
      .filter(w => !savedIds.has(w.id))
      .map(w => ({ i: w.id, ...w.default }));
    return additions.length ? [...saved, ...additions] : saved;
  } catch { return DEFAULT_LAYOUT; }
}
function loadRemoved() {
  try { const s = localStorage.getItem(REMOVED_KEY); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

// ─── Greenfield / Acq constants ────────────────────────────────────────────────
const GF_STATUSES = [
  { value: "new",         label: "New",         color: "#6366f1" },
  { value: "contacted",   label: "Contacted",   color: "#3b82f6" },
  { value: "interested",  label: "Interested",  color: "#06b6d4" },
  { value: "negotiating", label: "Negotiating", color: "#f59e0b" },
  { value: "agreed",      label: "Agreed",      color: "#10b981" },
  { value: "dead",        label: "Dead",        color: "#94a3b8" },
];
const ACQ_STAGES = [
  { value: "not_contacted",         label: "Not Contacted",         color: "#64748b" },
  { value: "contacted",             label: "Contacted",             color: "#3b82f6" },
  { value: "project_received",      label: "Project Received",      color: "#f59e0b" },
  { value: "no_projects_available", label: "No Projects Available", color: "#ef4444" },
];

function getMonths(n) {
  const result = []; const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(m.toISOString().slice(0, 7));
  }
  return result;
}
const fmtDay   = d  => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtMonth = ym => new Date(ym + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

// Bucket projects by COD into year or quarter buckets, gap-filled across the
// full span so empty periods show as zero (true timeline density).
function codBuckets(projects, gran) {
  const parsed = [];
  for (const p of projects) {
    if (!p.cod) continue;
    const iso = p.cod.length <= 7 ? `${p.cod}-01` : p.cod;
    const d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3) + 1;
    parsed.push({ y, q, mwp: Number(p.capacity_mwp) || 0, name: p.name });
  }
  if (!parsed.length) return [];
  const map = new Map();
  const keyOf = (y, q) => gran === "quarter" ? `${y}-Q${q}` : `${y}`;
  const labelOf = (y, q) => gran === "quarter" ? `Q${q} '${String(y).slice(2)}` : `${y}`;
  for (const p of parsed) {
    const k = keyOf(p.y, p.q);
    let b = map.get(k);
    if (!b) { b = { key: k, label: labelOf(p.y, p.q), count: 0, mwp: 0, items: [] }; map.set(k, b); }
    b.count++; b.mwp += p.mwp; b.items.push({ name: p.name, mwp: p.mwp });
  }
  // Largest project at the base of each stack for a stable read.
  for (const b of map.values()) b.items.sort((a, c) => c.mwp - a.mwp);
  // Gap-fill across the span
  const minY = Math.min(...parsed.map(p => p.y));
  const maxY = Math.max(...parsed.map(p => p.y));
  const out = [];
  for (let y = minY; y <= maxY; y++) {
    const quarters = gran === "quarter" ? [1, 2, 3, 4] : [null];
    for (const q of quarters) {
      const k = keyOf(y, q || 1);
      out.push(map.get(k) || { key: k, label: labelOf(y, q || 1), count: 0, mwp: 0, items: [] });
    }
  }
  // Trim empty buckets at the very start/end (keep internal gaps so quiet
  // periods between projects still read as real spacing).
  let lo = 0, hi = out.length - 1;
  while (lo < hi && out[lo].count === 0) lo++;
  while (hi > lo && out[hi].count === 0) hi--;
  return out.slice(lo, hi + 1);
}

// Use the CRM's standard categorical palette so project segments match the
// look of the rest of the app's charts.
const fmtCodMwp = v => v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();

// Stacked bar chart — each bar is one COD period; segments are projects sized
// by MWp, so total bar height = total MWp coming online that period.
function CodBarChart({ buckets, width, height, theme }) {
  if (!buckets.length || width < 10) return null;
  const margin = { top: 22, right: 10, bottom: 26, left: 38 };
  const cw = width - margin.left - margin.right;
  const ch = height - margin.top - margin.bottom;
  const max = Math.max(...buckets.map(b => b.mwp), 1);
  const slot = cw / buckets.length;
  const barW = Math.min(slot * 0.62, 54);
  const step = Math.max(10, Math.ceil(max / 4 / 10) * 10);
  const ticks = []; for (let t = 0; t <= max; t += step) ticks.push(t);
  let colourIdx = 0;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {ticks.map(t => {
        const y = margin.top + ch - (t / max) * ch;
        return (
          <g key={t}>
            <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={theme.border} strokeWidth={1} opacity={0.7} />
            <text x={margin.left - 6} y={y + 3} textAnchor="end" fontSize={9} fontWeight={600} fill={theme.textSecondary}>{fmtCodMwp(t)}</text>
          </g>
        );
      })}
      <text x={6} y={margin.top - 8} fontSize={9} fontWeight={700} fill={theme.textSecondary}>MWp</text>
      {buckets.map((b, i) => {
        const x = margin.left + i * slot + (slot - barW) / 2;
        let yCursor = margin.top + ch;
        const totalH = (b.mwp / max) * ch;
        return (
          <g key={b.key}>
            {b.items.map((it, j) => {
              const h = (it.mwp / max) * ch;
              yCursor -= h;
              const fill = SECTOR_COLORS[(colourIdx++) % SECTOR_COLORS.length];
              return (
                <rect key={j} x={x} y={yCursor} width={barW} height={Math.max(h, 0)} rx={1} fill={fill} opacity={0.9} stroke={theme.cardBg} strokeWidth={0.5}>
                  <title>{`${it.name} · ${fmtCodMwp(it.mwp)} MWp (${b.label})`}</title>
                </rect>
              );
            })}
            {b.mwp > 0 && <text x={x + barW / 2} y={margin.top + ch - totalH - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill={theme.textSecondary}>{fmtCodMwp(b.mwp)}</text>}
            <text x={margin.left + i * slot + slot / 2} y={margin.top + ch + 14} textAnchor="middle" fontSize={9} fontWeight={600} fill={theme.textSecondary}>{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Widget shell ──────────────────────────────────────────────────────────────
function Widget({ id, title, color, sub, editMode, onRemove, children, theme, noPad }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: theme.cardBg, border: editMode ? `2px dashed ${theme.accent}` : `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 12, overflow: "hidden", boxSizing: "border-box", transition: "border 0.15s" }}>
      {/* Header — drag handle */}
      <div className="widget-drag-handle" style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px 9px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0, cursor: editMode ? "grab" : "default" }}>
        <div style={{ width: 3, height: 14, background: color, borderRadius: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: theme.textTertiary }}>{sub}</div>}
        {editMode && (
          <>
            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 11, height: 1.5, background: theme.textTertiary, borderRadius: 1, opacity: 0.4 }} />)}
            </div>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onRemove(id); }}
              title="Remove widget"
              style={{ width: 18, height: 18, borderRadius: 4, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textTertiary, fontSize: 13, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 6, fontFamily: "inherit" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#ef444415"; e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#ef444444"; }}
              onMouseLeave={e => { e.currentTarget.style.background = theme.pillBg; e.currentTarget.style.color = theme.textTertiary; e.currentTarget.style.borderColor = theme.border; }}
            >×</button>
          </>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: noPad ? 0 : "12px 14px 14px" }}>
        {children}
      </div>
    </div>
  );
}

function HBar({ label, count, total, color, theme }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: theme.textSecondary }}>{label}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 10, color: theme.textTertiary }}>{Math.round(pct)}%</span>
          <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 22, textAlign: "right" }}>{count}</span>
        </div>
      </div>
      <div style={{ height: 5, background: theme.pillBg || theme.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

// ─── Shared chart tooltip ──────────────────────────────────────────────────────
// Auto-positions next to the cursor and flips left if it would overflow the
// chart's right edge. `rows` is [{ name, value, color? }]; `total` is optional.
function ChartTooltip({ x, y, width: parentW, height: parentH, theme, title, rows, total, totalLabel }) {
  const TT_W = 210, OFFSET = 14;
  const tipLeftRaw = x + OFFSET;
  const flip = tipLeftRaw + TT_W > parentW - 4;
  const tipLeft = flip ? Math.max(4, x - OFFSET - TT_W) : tipLeftRaw;
  const approxH = 36 + rows.length * 18 + (total != null ? 22 : 0);
  const tipTop = Math.min(Math.max(4, y - 20), Math.max(4, parentH - approxH - 4));
  return (
    <div style={{
      position: "absolute", left: tipLeft, top: tipTop, width: TT_W,
      background: theme.elevatedBg || theme.surfaceBg || theme.cardBg,
      border: `1px solid ${theme.border}`, borderRadius: 8,
      padding: "8px 10px", pointerEvents: "none", zIndex: 30,
      boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 12, padding: "2px 0", fontSize: 11 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: theme.textSecondary, minWidth: 0 }}>
            {r.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />}
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          </span>
          <span style={{ fontWeight: 700, color: theme.textPrimary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.value}</span>
        </div>
      ))}
      {total != null && (
        <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 5, paddingTop: 5,
          display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span style={{ color: theme.textTertiary, fontWeight: 600 }}>{totalLabel || "Total"}</span>
          <span style={{ fontWeight: 800, color: theme.textPrimary, fontVariantNumeric: "tabular-nums" }}>{total}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function TopOfFunnelDashboard() {
  const { theme } = useTheme();
  const [editMode, setEditMode]         = useState(false);
  const [layout, setLayout]             = useState(loadLayout);
  const [removedWidgets, setRemovedWidgets] = useState(loadRemoved);
  const [gridWidth, setGridWidth]       = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  const gridRef                         = useRef(null);
  const [period, setPeriod]             = useState("7d");
  // Chart-tooltip hover state — { index, mouseX, mouseY } in container coords
  const [velocityHover, setVelocityHover] = useState(null);
  const velocityRef = useRef(null);
  const [stagesHover, setStagesHover]     = useState(null);
  const stagesRef = useRef(null);
  const [velocitySize, setVelocitySize]   = useState({ w: 0, h: 0 });
  const [stagesSize, setStagesSize]       = useState({ w: 0, h: 0 });
  const [activeSection, setActiveSection] = useState(() => {
    try { return localStorage.getItem(SECTION_KEY) || "all"; } catch { return "all"; }
  });
  const [pwLeadsRaw, setPwLeads]        = useState([]);
  const [initiatives, setInitiatives]   = useState([]);
  const [gfLeads, setGfLeads]           = useState([]);
  const [acqLeads, setAcqLeads]         = useState([]);
  const [acqProjects, setAcqProjects]   = useState([]); // for Acq Total Capacity + COD chart
  const [codGran, setCodGran]           = useState("year"); // "year" | "quarter"
  const [codSelected, setCodSelected]   = useState(null);   // Set of project ids; null = all
  const [codFilterOpen, setCodFilterOpen] = useState(false);
  const [acqProjectData, setAcqProjectData] = useState({}); // project_acquisition rows, keyed by project_id
  const [gfProjects, setGfProjects]     = useState([]); // for GF Active Capacity + battery chart
  const [loading, setLoading]           = useState(true);

  // Re-measure grid width whenever loading changes (gridRef div only exists after loading=false)
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setGridWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]); // re-run once loading resolves and the grid div mounts

  async function fetchAllRows(table, buildQuery) {
    // PAGE must stay <= Supabase's PostgREST max_rows cap (raised to 5000 via
    // ALTER ROLE authenticator SET pgrst.db_max_rows) or the loop exits early.
    const PAGE = 5000;
    let all = [], from = 0;
    while (true) {
      const { data, error } = await buildQuery(supabase.from(table)).range(from, from + PAGE - 1);
      if (error) throw error;
      all = all.concat(data || []);
      if ((data || []).length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  useEffect(() => {
    async function load() {
      try {
        const [pwData, actData, init, gf, acq, acqProj, gfProj, acqProjAcq] = await Promise.all([
          // Only the columns the dashboard actually reads — drops heavy unused text
          // (notes, archive_*, linkedin_*, contact_*, monday_*) from the payload.
          fetchAllRows("private_wire_leads",        q => q.select("id,name,sector,owner,stage,stage_entered_at,campaign,est_load_mw,created_at,archived").order("created_at", { ascending: false })),
          fetchAllRows("private_wire_activity_log", q => q.select("lead_id,date,direction,channel,response").order("date", { ascending: false })),
          supabase.from("initiatives").select("id,name,color").order("created_at", { ascending: false }),
          supabase.from("leads").select("id,initiative_id,status"),
          supabase.from("acquisition_leads").select("id,developer,contact_name,stage,date_contacted,project_name,owner"),
          supabase.from("projects").select("id,name,capacity_mwp,cod,status,technology").eq("cancelled", false),
          supabase.from("greenfield_projects").select("id,name,status,mwp,tech"),
          supabase.from("project_acquisition").select("project_id,data"),
        ]);
        if (pwData && actData) {
          // Group activity by lead_id once (O(n)) instead of filtering per lead
          // (O(leads×activity), ~264M ops on the full set).
          const actByLead = new Map();
          for (const a of actData) {
            const arr = actByLead.get(a.lead_id);
            if (arr) arr.push(a); else actByLead.set(a.lead_id, [a]);
          }
          setPwLeads(pwData.map(l => ({ ...l, activityLog: actByLead.get(l.id) || [] })));
        }
        if (init.data)    setInitiatives(init.data);
        if (gf.data)      setGfLeads(gf.data);
        if (acq.data)     setAcqLeads(acq.data);
        if (acqProj.data) setAcqProjects(acqProj.data);
        if (gfProj.data)  setGfProjects(gfProj.data);
        if (acqProjAcq.data) {
          const map = {};
          acqProjAcq.data.forEach(row => { map[row.project_id] = row; });
          setAcqProjectData(map);
        }
      } catch (e) {
        console.error("Dashboard load error:", e);
      } finally {
        setLoading(false); // always resolve loading, even on error
      }
    }
    load();
  }, []);

  // ── Date helpers ──────────────────────────────────────────────────────────────
  const now = new Date();
  const todayDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

  const rangeStartDate = useMemo(() => {
    if (period === "1d") return todayDate;
    if (period === "all") return "2020-01-01";
    const d = new Date(); d.setDate(d.getDate() - (period === "7d" ? 6 : 29));
    return d.toISOString().slice(0, 10);
  }, [period, todayDate]);

  // ── Private Wire / Data Centres derived ────────────────────────────────────
  // The PW widget set is reused for the Data Centres section. Scope the data by
  // the active section: PW section → PW only, DC section → DC only, All → both.
  // Legacy rows with no campaign default to PW.
  const pwScope = activeSection === "dc" ? "DC" : activeSection === "pw" ? "PW" : "All";
  const isDC = activeSection === "dc";
  const pwLeads = useMemo(
    () => pwScope === "All" ? pwLeadsRaw : pwLeadsRaw.filter(l => (l.campaign || "PW") === pwScope),
    [pwLeadsRaw, pwScope],
  );

  const allActivities = useMemo(() =>
    pwLeads.flatMap(l => (l.activityLog || []).map(a => ({ ...a, leadSector: l.sector, leadOwner: l.owner })))
  , [pwLeads]);

  const rangeActivities = useMemo(() =>
    allActivities.filter(a => a.date >= rangeStartDate && a.date <= todayDate)
  , [allActivities, rangeStartDate, todayDate]);

  const outreachDays = useMemo(() => getDaysBetween(OUTREACH_START, todayDate), [todayDate]);

  const outreachTimeSeries = useMemo(() => {
    const chs = Object.keys(CHANNEL_COLORS);
    return outreachDays.map(date => {
      const dayActs = allActivities.filter(a => (a.date || "").slice(0, 10) === date && a.direction === "Outbound");
      const row = { date };
      chs.forEach(ch => { row[ch] = dayActs.filter(a => a.channel === ch).length; });
      return row;
    });
  }, [allActivities, outreachDays]);

  const stageCounts = useMemo(() =>
    STAGES.map(s => ({ stage: s, count: pwLeads.filter(l => l.stage === s).length }))
  , [pwLeads]);
  const maxStageCount = useMemo(() => Math.max(...stageCounts.map(s => s.count), 1), [stageCounts]);

  const activeOpps = useMemo(() =>
    pwLeads.filter(l => ["Meeting Booked", "Proposal", "Negotiation"].includes(l.stage))
      .sort((a, b) => {
        const order = { Negotiation: 0, Proposal: 1, "Meeting Booked": 2 };
        return (order[a.stage] ?? 99) - (order[b.stage] ?? 99);
      })
  , [pwLeads]);

  const totalTouches = rangeActivities.length;
  // Distinct organisation names in a stage AFTER Contacted (i.e. genuinely
  // engaged): Meeting Booked / Proposal / Negotiation.
  const ACTIVE_ORG_STAGES = ["Meeting Booked", "Proposal", "Negotiation"];
  const activeOrgs = useMemo(() =>
    new Set(
      pwLeads
        .filter(l => ACTIVE_ORG_STAGES.includes(l.stage) && l.name && l.name.trim())
        .map(l => l.name.trim())
    ).size
  , [pwLeads]);

  // ── Lead volume time series (last 30 days, stacked by owner) ─────────────────
  const thirtyDaysAgoDate = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  }, []);
  const last30Days = useMemo(() => getDaysBetween(thirtyDaysAgoDate, todayDate), [thirtyDaysAgoDate, todayDate]);
  const ownerNames = useMemo(() => [...new Set(pwLeads.map(l => l.owner).filter(Boolean))].sort(), [pwLeads]);
  const ownerColorMap = useMemo(() => {
    const map = { Unassigned: "#94A3B8" };
    ownerNames.forEach((name, i) => { map[name] = OWNER_PALETTE[i % OWNER_PALETTE.length]; });
    return map;
  }, [ownerNames]);
  const leadVolumeSeries = useMemo(() => last30Days.map(date => {
    const dayActs = allActivities.filter(a => (a.date || "").slice(0, 10) === date && a.direction === "Outbound");
    const row = { date };
    ownerNames.forEach(owner => { row[owner] = dayActs.filter(a => a.leadOwner === owner).length; });
    row["Unassigned"] = dayActs.filter(a => !a.leadOwner).length;
    return row;
  }), [allActivities, last30Days, ownerNames]);
  const ownerSegments = useMemo(() => {
    const hasUnassigned = leadVolumeSeries.some(d => (d.Unassigned || 0) > 0);
    return [...ownerNames, ...(hasUnassigned ? ["Unassigned"] : [])];
  }, [ownerNames, leadVolumeSeries]);

  // ── Greenfield ────────────────────────────────────────────────────────────────
  const initiativeRows = useMemo(() =>
    initiatives.map(init => {
      const leads = gfLeads.filter(l => l.initiative_id === init.id);
      const counts = {};
      GF_STATUSES.forEach(s => { counts[s.value] = leads.filter(l => l.status === s.value).length; });
      return { ...init, total: leads.length, counts };
    })
  , [initiatives, gfLeads]);

  // ── Acquisitions ──────────────────────────────────────────────────────────────
  const { buckets, isAll } = useMemo(() => {
    if (period === "all") return { buckets: getMonths(12).map(ym => ({ key: ym, label: fmtMonth(ym) })), isAll: true };
    const days = getDaysBetween(rangeStartDate, todayDate);
    return { buckets: days.map(d => ({ key: d, label: fmtDay(d) })), isAll: false };
  }, [period, rangeStartDate, todayDate]);

  const acqTimeSeries = useMemo(() => buckets.map(b => ({
    ...b,
    count: acqLeads.filter(l => isAll ? l.date_contacted?.startsWith(b.key) : l.date_contacted === b.key).length,
  })), [buckets, acqLeads, isAll]);
  const acqMaxBar = useMemo(() => Math.max(...acqTimeSeries.map(d => d.count), 1), [acqTimeSeries]);

  // ── Capacity KPIs ─────────────────────────────────────────────────────────────
  // Acquisitions Total Capacity = sum of capacity_mwp across all projects (mirrors Portfolio's totalMW)
  const acqTotalCapacity = useMemo(() =>
    acqProjects.reduce((s, p) => s + (Number(p.capacity_mwp) || 0), 0)
  , [acqProjects]);

  // Active = not off-pipeline. Off-pipeline statuses (Cancelled, Clock Pause)
  // are excluded so this mirrors GreenfieldProjects' Active KPI exactly.
  const GF_OFF_PIPELINE = ["Cancelled", "Clock Pause"];
  const gfIsActive = (p) => !GF_OFF_PIPELINE.includes(p.status);
  const gfActiveCapacity = useMemo(() =>
    gfProjects.filter(gfIsActive)
      .reduce((s, p) => s + (Number(p.mwp) || 0), 0)
  , [gfProjects]);
  const gfTotalCapacity = useMemo(() =>
    gfProjects.reduce((s, p) => s + (Number(p.mwp) || 0), 0)
  , [gfProjects]);
  const gfActiveCount = useMemo(() =>
    gfProjects.filter(gfIsActive).length
  , [gfProjects]);

  const fmtMwp1 = n => Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

  // ── Projects by deal stage (MWp + count) ──────────────────────────────────────
  // Uses the canonical deal-stage taxonomy (Under Review → NBO → FABO →
  // Exclusivity DD → SPA Signing → Completed). Projects whose acquisition data
  // is empty / brand-new count as Under Review (per Portfolio's getDealStage).
  const acqByStage = useMemo(() => {
    const buckets = Object.fromEntries(DEAL_STAGES_ORDERED.map(s => [s, { mwp: 0, count: 0, projects: [] }]));
    acqProjects.forEach(p => {
      const stage = getDealStage(acqProjectData[p.id], null);
      if (!stage || !buckets[stage]) return;
      buckets[stage].mwp += Number(p.capacity_mwp) || 0;
      buckets[stage].count += 1;
      buckets[stage].projects.push(p.name);
    });
    return DEAL_STAGES_ORDERED.map(s => ({ stage: s, ...buckets[s], color: DEAL_STAGE_COLORS[s] }));
  }, [acqProjects, acqProjectData]);

  // ── Projects by COD ─────────────────────────────────────────────────────────
  // Filterable list of projects (all that exist) + the bucketed chart data for
  // the currently-selected subset. codSelected === null means "all selected".
  const codProjectList = useMemo(
    () => [...acqProjects].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [acqProjects],
  );
  const codSelectedSet = codSelected; // Set | null
  const isCodSelected = (id) => codSelectedSet === null || codSelectedSet.has(id);
  const codFilteredProjects = useMemo(
    () => acqProjects.filter(p => isCodSelected(p.id)),
    [acqProjects, codSelectedSet],
  );
  const codData = useMemo(() => codBuckets(codFilteredProjects, codGran), [codFilteredProjects, codGran]);
  const codSelectedCount = codSelectedSet === null ? acqProjects.length : [...acqProjects].filter(p => codSelectedSet.has(p.id)).length;
  const codNoDate = codFilteredProjects.filter(p => !p.cod).length;
  const codTotalShown = codData.reduce((s, b) => s + b.count, 0);
  const codTotalMwp = codData.reduce((s, b) => s + b.mwp, 0);
  // Tech split across the projects actually charted (selected + has a COD).
  const codShownProjects = codFilteredProjects.filter(p => p.cod);
  const codSolarMwp = codShownProjects.filter(p => p.technology === "Solar").reduce((s, p) => s + (Number(p.capacity_mwp) || 0), 0);
  const codBessMwp  = codShownProjects.filter(p => p.technology === "BESS").reduce((s, p) => s + (Number(p.capacity_mwp) || 0), 0);

  const acqMaxStageMwp = useMemo(() =>
    Math.max(...acqByStage.map(b => b.mwp), 1)
  , [acqByStage]);
  const acqByStageTotalMwp = useMemo(() =>
    acqByStage.reduce((s, b) => s + b.mwp, 0)
  , [acqByStage]);
  const acqByStageTotalCount = useMemo(() =>
    acqByStage.reduce((s, b) => s + b.count, 0)
  , [acqByStage]);

  // ── Widget remove / restore ───────────────────────────────────────────────────
  const handleRemove = (id) => {
    const next = [...removedWidgets, id];
    setRemovedWidgets(next);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(next));
    const newLayout = layout.filter(l => l.i !== id);
    setLayout(newLayout);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(newLayout));
  };

  const handleRestore = (id) => {
    const next = removedWidgets.filter(w => w !== id);
    setRemovedWidgets(next);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(next));
    const def = WIDGET_DEFS.find(w => w.id === id);
    const newLayout = [...layout, { i: id, ...def.default }];
    setLayout(newLayout);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(newLayout));
  };

  const handleReset = () => {
    setLayout(DEFAULT_LAYOUT);
    setRemovedWidgets([]);
    localStorage.removeItem(LAYOUT_KEY);
    localStorage.removeItem(REMOVED_KEY);
  };

  // ── Styles ────────────────────────────────────────────────────────────────────
  const stageColors = STAGE_COLORS_GRID_CRM;
  const channels    = Object.keys(CHANNEL_COLORS);
  const tinyLabel   = { fontSize: 8, color: theme.textTertiary, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const wProps      = { editMode, onRemove: handleRemove, theme };

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <EnergyLoader />
    </div>
  );

  // Filter widgets by section: "all" shows everything, otherwise only widgets
  // matching the active section. When filtered, GridLayout auto-stacks to the
  // top so there are no gaps from missing widgets above (see compactType below).
  // Data Centres reuses the Private Wire widget set, scoped to DC data below.
  const inActiveSection = (id) =>
    activeSection === "all"
    || WIDGET_SECTION[id] === activeSection
    || (activeSection === "dc" && WIDGET_SECTION[id] === "pw");
  const shouldRender = (id) =>
    !removedWidgets.includes(id) && inActiveSection(id);
  const activeLayout = layout.filter(l => shouldRender(l.i));

  return (
    <div style={{ flex: 1, overflowY: "auto", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary }}>

      {/* ── Sticky header ───────────────────────────────────────────────────── */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: theme.pageBg, borderBottom: `1px solid ${theme.border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>Top of Funnel Overview</div>
          {/* Section tabs */}
          <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
            {SECTIONS.map(s => {
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => {
                  setActiveSection(s.id);
                  try { localStorage.setItem(SECTION_KEY, s.id); } catch {}
                }}
                  style={{
                    fontSize: 11, fontWeight: isActive ? 700 : 500,
                    padding: "4px 11px", borderRadius: 6, cursor: "pointer",
                    color: isActive ? "#fff" : theme.textSecondary,
                    background: isActive ? s.color : "transparent",
                    border: isActive ? `1px solid ${s.color}` : "1px solid transparent",
                    fontFamily: "'Inter', system-ui, sans-serif",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                  {s.id !== "all" && (
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: isActive ? "#fff" : s.color, opacity: isActive ? 0.9 : 1 }} />
                  )}
                  {s.label}
                </button>
              );
            })}
          </div>

          {editMode && activeSection === "all" && (
            <span style={{ fontSize: 10, fontWeight: 600, color: theme.accent, background: theme.accent + "18", border: `1px solid ${theme.accent}44`, borderRadius: 4, padding: "2px 8px" }}>
              Drag to move · corner to resize · × to remove
            </span>
          )}
          {editMode && activeSection !== "all" && (
            <span style={{ fontSize: 10, fontWeight: 600, color: theme.textTertiary, background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 4, padding: "2px 8px" }}>
              Switch to "All" to edit layout
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
            {[["1d","1D"],["7d","7D"],["30d","30D"],["all","All"]].map(([key, lbl]) => (
              <button key={key} onClick={() => setPeriod(key)}
                style={{ fontSize: 11, fontWeight: period === key ? 700 : 500, padding: "4px 10px", borderRadius: 6, cursor: "pointer", color: period === key ? theme.pillActiveText : theme.pillInactiveText, background: period === key ? theme.pillActiveBg : "transparent", border: period === key ? `1px solid ${theme.pillBorder}` : "1px solid transparent", fontFamily: "'Inter', system-ui, sans-serif" }}>
                {lbl}
              </button>
            ))}
          </div>
          {editMode && (
            <button onClick={handleReset}
              style={{ fontSize: 11, color: theme.textTertiary, background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
              Reset all
            </button>
          )}
          <button onClick={() => setEditMode(e => !e)}
            style={{ fontSize: 11, fontWeight: 600, color: editMode ? "#fff" : theme.textSecondary, background: editMode ? theme.accent : "none", border: `1px solid ${editMode ? theme.accent : theme.border}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", transition: "all 0.15s" }}>
            {editMode ? "Done" : "✦ Edit layout"}
          </button>
        </div>
      </div>

      {/* ── Removed widgets restore bar ──────────────────────────────────────── */}
      {editMode && removedWidgets.length > 0 && (
        <div style={{ padding: "8px 24px", borderBottom: `1px solid ${theme.border}`, display: "flex", alignItems: "center", gap: 8, background: theme.pageBg, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hidden:</span>
          {removedWidgets.map(id => {
            const def = WIDGET_DEFS.find(w => w.id === id);
            return (
              <button key={id} onClick={() => handleRestore(id)}
                style={{ fontSize: 11, fontWeight: 500, color: def?.color || theme.accent, background: (def?.color || theme.accent) + "15", border: `1px solid ${(def?.color || theme.accent)}44`, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
                <span>+</span> {def?.title || id}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      <div ref={gridRef} style={{ width: "100%", padding: "0 24px", boxSizing: "border-box" }}>
        <GridLayout
          width={Math.max(gridWidth - 48, 300)}
          layout={activeLayout}
          onLayoutChange={(nl) => {
            // Only persist layout changes from the "All" view, which has the
            // master arrangement. Filtered views auto-stack via compactType
            // and would otherwise mangle saved positions.
            if (activeSection !== "all") return;
            setLayout(nl);
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(nl));
          }}
          rowHeight={ROW_H}
          margin={[12, 12]}
          containerPadding={[0, 16]}
          isDraggable={editMode && activeSection === "all"}
          isResizable={editMode && activeSection === "all"}
          compactType={activeSection === "all" ? null : "vertical"}
          preventCollision={activeSection === "all"}
          cols={12}
          draggableHandle=".widget-drag-handle"
        >

          {/* ── PW KPIs ─────────────────────────────────────────────────── */}
          {shouldRender("pw-kpis") && (
            <div key="pw-kpis">
              <Widget id="pw-kpis" title={`${isDC ? "DC" : "PW"} · KPIs`} color="#3b82f6" sub={`${pwLeads.length} leads`} {...wProps}>
                <div style={{ display: "flex", gap: 10, height: "100%", alignItems: "stretch" }}>
                  {[
                    { label: "Total Leads",          value: pwLeads.length, color: theme.textPrimary, sub: `${pwLeads.filter(l => !["Won","Lost"].includes(l.stage)).length} active` },
                    { label: "Active Organisations", value: activeOrgs,     color: "#f59e0b",         sub: "Meeting Booked / Proposal / Negotiation" },
                    { label: "Outreach",             value: totalTouches,   color: theme.success || "#10b981", sub: period === "1d" ? "Today" : period === "all" ? "All time" : `Last ${period}` },
                  ].map((kpi, i) => (
                    <div key={i} style={{ flex: 1, background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{kpi.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color, letterSpacing: "-0.02em" }}>{kpi.value}</div>
                      <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{kpi.sub}</div>
                    </div>
                  ))}
                </div>
              </Widget>
            </div>
          )}

          {/* ── PW Outreach Activity ─────────────────────────────────────── */}
          {shouldRender("pw-outreach") && (
            <div key="pw-outreach">
              <Widget id="pw-outreach" title={`${isDC ? "DC" : "PW"} · Outreach Activity`} color="#3b82f6" sub="Daily reach-outs from 6 Apr 2026" {...wProps}>
                <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
                    {channels.map(ch => (
                      <span key={ch} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: theme.textTertiary }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: CHANNEL_COLORS[ch] }} />
                        {ch}
                      </span>
                    ))}
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ChartBox aspectRatio={0} minHeight={80} fillHeight>
                      {(w, h) => <StackedBarChart data={outreachTimeSeries} channels={channels} width={w} height={Math.max(h, 80)} theme={theme} />}
                    </ChartBox>
                  </div>
                </div>
              </Widget>
            </div>
          )}

          {/* ── PW Lead Volume ───────────────────────────────────────────── */}
          {shouldRender("pw-lead-volume") && (
            <div key="pw-lead-volume">
              <Widget id="pw-lead-volume" title={`${isDC ? "DC" : "PW"} · Lead Volume`} color="#3b82f6" sub="Daily | Last 30 Days" {...wProps}>
                <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
                    {ownerSegments.map(name => (
                      <span key={name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: theme.textTertiary }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: ownerColorMap[name] }} />
                        {name}
                      </span>
                    ))}
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ChartBox aspectRatio={0} minHeight={80} fillHeight>
                      {(w, h) => <StackedBarChart data={leadVolumeSeries} channels={ownerSegments} width={w} height={Math.max(h, 80)} theme={theme} colorMap={ownerColorMap} />}
                    </ChartBox>
                  </div>
                </div>
              </Widget>
            </div>
          )}

          {/* ── PW Pipeline ──────────────────────────────────────────────── */}
          {shouldRender("pw-pipeline") && (
            <div key="pw-pipeline">
              <Widget id="pw-pipeline" title={`${isDC ? "DC" : "PW"} · Pipeline`} color="#3b82f6" {...wProps}>
                <PipelineFunnel stageCounts={stageCounts} stageColors={stageColors} maxCount={maxStageCount} theme={theme} />
              </Widget>
            </div>
          )}

          {/* ── PW Active Opps ───────────────────────────────────────────── */}
          {shouldRender("pw-opps") && (
            <div key="pw-opps">
              <Widget id="pw-opps" title={`${isDC ? "DC" : "PW"} · Active Opportunities`} color="#3b82f6" {...wProps} noPad>
                {activeOpps.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 12, color: theme.textTertiary }}>No active opportunities</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Organisation", "Sector", "Owner", "Stage"].map(h => (
                          <th key={h} style={{ padding: "8px 14px", fontSize: 9, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeOpps.map((l, i) => {
                        const c = stageColors[l.stage] || theme.accent;
                        return (
                          <tr key={l.id} style={{ borderBottom: i < activeOpps.length - 1 ? `1px solid ${theme.border}` : "none" }}>
                            <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{l.name}</td>
                            <td style={{ padding: "8px 14px", fontSize: 11, color: theme.textTertiary }}>{l.sector || "—"}</td>
                            <td style={{ padding: "8px 14px", fontSize: 11, color: theme.textTertiary }}>{l.owner || "—"}</td>
                            <td style={{ padding: "8px 14px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: c, background: c + "18", padding: "2px 8px", borderRadius: 4 }}>
                                  {STAGE_LABELS[l.stage] || l.stage}
                                </span>
                                {formatDaysInStage(l.stage_entered_at) && (
                                  <span style={{ fontSize: 9, color: getDurationColor(l.stage_entered_at) || theme.textTertiary, paddingLeft: 2 }}>{formatDaysInStage(l.stage_entered_at)}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Widget>
            </div>
          )}

          {/* ── Greenfield ───────────────────────────────────────────────── */}
          {shouldRender("gf") && (
            <div key="gf">
              <Widget id="gf" title="Greenfield" color="#10b981" sub={`${initiatives.length} initiative${initiatives.length !== 1 ? "s" : ""} · ${gfLeads.length} leads`} {...wProps}>
                {initiativeRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: theme.textTertiary, padding: "32px 0", textAlign: "center" }}>No initiatives yet</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {initiativeRows.map(row => {
                      const nonZero = GF_STATUSES.filter(s => row.counts[s.value] > 0);
                      return (
                        <div key={row.id} style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 100 }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: row.color || "#6366f1", flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{row.name}</span>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: "center" }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color: theme.textPrimary }}>{row.total}</span>
                            <span style={{ fontSize: 9, color: theme.textTertiary, marginLeft: 3, textTransform: "uppercase" }}>total</span>
                          </div>
                          <div style={{ width: 1, height: 24, background: theme.border, flexShrink: 0 }} />
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1 }}>
                            {nonZero.length === 0 ? (
                              <span style={{ fontSize: 11, color: theme.textTertiary }}>No leads yet</span>
                            ) : nonZero.map(s => (
                              <div key={s.value} style={{ display: "flex", alignItems: "center", gap: 3, background: s.color + "15", border: `1px solid ${s.color}33`, borderRadius: 5, padding: "3px 7px" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: s.color }}>{s.label}</span>
                                <span style={{ fontSize: 11, fontWeight: 800, color: s.color }}>{row.counts[s.value]}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Widget>
            </div>
          )}

          {/* ── Acq Velocity ─────────────────────────────────────────────── */}
          {shouldRender("acq-velocity") && (
            <div key="acq-velocity">
              <Widget id="acq-velocity" title="Acq · Contact Velocity" color="#f59e0b" sub={`${acqLeads.length} developers`} {...wProps}>
                {acqTimeSeries.every(d => d.count === 0) ? (
                  <div style={{ fontSize: 11, color: theme.textTertiary, textAlign: "center", padding: "24px 0" }}>No contacts in this period</div>
                ) : (
                  <div ref={(el) => {
                      velocityRef.current = el;
                      if (el && (el.offsetWidth !== velocitySize.w || el.offsetHeight !== velocitySize.h)) {
                        setVelocitySize({ w: el.offsetWidth, h: el.offsetHeight });
                      }
                    }} style={{ position: "relative" }}>
                    <div style={{ display: "flex", gap: buckets.length > 20 ? 2 : 4, alignItems: "flex-end", height: 80 }}>
                      {acqTimeSeries.map((d, i) => {
                        const onMove = (e) => {
                          const rect = velocityRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setVelocityHover({ index: i, mouseX: e.clientX - rect.left, mouseY: e.clientY - rect.top });
                        };
                        return (
                          <div key={d.key}
                            onMouseEnter={onMove}
                            onMouseMove={onMove}
                            onMouseLeave={() => setVelocityHover(null)}
                            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0, opacity: velocityHover && velocityHover.index !== i ? 0.4 : 1, transition: "opacity 0.1s" }}>
                            {d.count > 0 && <div style={{ fontSize: 9, color: theme.textTertiary, fontWeight: 600 }}>{d.count}</div>}
                            <div style={{ width: "100%", height: Math.max((d.count / acqMaxBar) * 60, d.count > 0 ? 3 : 2), borderRadius: "2px 2px 0 0", background: d.count > 0 ? "#f59e0b" : (theme.pillBg || theme.border) }} />
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: buckets.length > 20 ? 2 : 4, marginTop: 5 }}>
                      {acqTimeSeries.map(d => (
                        <div key={d.key} style={{ flex: 1, ...tinyLabel, transform: buckets.length > 14 ? "rotate(-40deg)" : "none", transformOrigin: "top center", marginTop: buckets.length > 14 ? 8 : 0 }}>
                          {d.label}
                        </div>
                      ))}
                    </div>
                    {velocityHover && acqTimeSeries[velocityHover.index] && (
                      <ChartTooltip
                        x={velocityHover.mouseX} y={velocityHover.mouseY}
                        width={velocitySize.w || 200} height={velocitySize.h || 100}
                        theme={theme}
                        title={acqTimeSeries[velocityHover.index].label}
                        rows={[{
                          name: "Contacts",
                          value: acqTimeSeries[velocityHover.index].count,
                          color: "#f59e0b",
                        }]}
                      />
                    )}
                  </div>
                )}
              </Widget>
            </div>
          )}

          {/* ── Acq Pipeline ─────────────────────────────────────────────── */}
          {shouldRender("acq-pipeline") && (
            <div key="acq-pipeline">
              <Widget id="acq-pipeline" title="Acq · Pipeline" color="#f59e0b" sub={`${acqLeads.filter(l => l.stage === "project_received").length} projects received`} {...wProps}>
                {ACQ_STAGES.map(s => (
                  <HBar key={s.value} label={s.label}
                    count={acqLeads.filter(l => l.stage === s.value).length}
                    total={acqLeads.length} color={s.color} theme={theme} />
                ))}
              </Widget>
            </div>
          )}

          {/* ── Acq Total Capacity (KPI) ─────────────────────────────────── */}
          {shouldRender("acq-total-capacity") && (
            <div key="acq-total-capacity">
              <Widget id="acq-total-capacity" title="Acq · Total Capacity" color="#f59e0b" sub={`${acqProjects.length} project${acqProjects.length !== 1 ? "s" : ""}`} {...wProps}>
                <div style={{ height: "100%", display: "flex", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Total Capacity</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#4A8C5C", letterSpacing: "-0.02em", lineHeight: 1 }}>
                      {fmtMwp1(acqTotalCapacity)} <span style={{ fontSize: 16, fontWeight: 700 }}>MWp</span>
                    </div>
                    <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 4 }}>Across all Acquisitions projects</div>
                  </div>
                </div>
              </Widget>
            </div>
          )}

          {/* ── GF Active Capacity (KPI) ─────────────────────────────────── */}
          {shouldRender("gf-active-capacity") && (
            <div key="gf-active-capacity">
              <Widget id="gf-active-capacity" title="GF · Active Capacity" color="#10b981" sub={`${gfActiveCount} active project${gfActiveCount !== 1 ? "s" : ""}`} {...wProps}>
                <div style={{ height: "100%", display: "flex", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Active Capacity</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#10b981", letterSpacing: "-0.02em", lineHeight: 1 }}>
                      {fmtMwp1(gfActiveCapacity)} <span style={{ fontSize: 16, fontWeight: 700 }}>MWp</span>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: theme.pillBg || theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "2px 9px", marginTop: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary }}>{fmtMwp1(gfTotalCapacity)}</span>
                      <span style={{ fontSize: 9, color: theme.textTertiary }}>total MWp</span>
                    </div>
                  </div>
                </div>
              </Widget>
            </div>
          )}

          {/* ── GF Grid App Submitted (battery chart) ────────────────────── */}
          {shouldRender("gf-battery") && (
            <div key="gf-battery">
              <Widget id="gf-battery" title="GF · Grid App Submitted" color="#10b981" sub="Solar capacity pipeline (MWp)" {...wProps}>
                <GridAppBatteryChart projects={gfProjects} theme={theme} embedded />
              </Widget>
            </div>
          )}

          {/* ── Acq Projects by Stage (MWp + count) — vertical bars w/ Y axis ─ */}
          {shouldRender("acq-stages") && (() => {
            // Reverse pipeline order: most-advanced stage first, fresh leads last.
            // Reads like a "what we're closest to closing → what we just picked up".
            const stageIdx = Object.fromEntries(DEAL_STAGES_ORDERED.map((s, i) => [s, i]));
            const nonEmpty = acqByStage
              .filter(b => b.count > 0)
              .slice()
              .sort((a, b) => (stageIdx[b.stage] ?? -1) - (stageIdx[a.stage] ?? -1));
            // "Nice" Y-axis ticks based on the data range — handles the wide
            // disparity between NBO (~1000 MWp) and downstream stages (~10 MWp).
            const maxVal = nonEmpty.reduce((m, b) => Math.max(m, b.mwp), 0);
            const niceTicks = (max) => {
              if (max <= 0) return { ticks: [0], niceMax: 1 };
              const mag = Math.pow(10, Math.floor(Math.log10(max)));
              const norm = max / mag;
              let step;
              if (norm <= 1.5) step = 0.2 * mag;
              else if (norm <= 3) step = 0.5 * mag;
              else if (norm <= 7) step = mag;
              else step = 2 * mag;
              const niceMax = Math.ceil(max / step) * step || step;
              const ticks = [];
              for (let v = 0; v <= niceMax + step * 0.01; v += step) ticks.push(v);
              return { ticks, niceMax };
            };
            const { ticks: yTicks, niceMax } = niceTicks(maxVal);
            const fmtTick = v => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(Math.round(v));

            return (
              <div key="acq-stages">
                <Widget
                  id="acq-stages"
                  title="Acq · Projects by Stage (MWp)"
                  color="#f59e0b"
                  sub={`${fmtMwp1(acqByStageTotalMwp)} MWp · ${acqByStageTotalCount} project${acqByStageTotalCount !== 1 ? "s" : ""}`}
                  {...wProps}
                >
                  {nonEmpty.length === 0 ? (
                    <div style={{ fontSize: 11, color: theme.textTertiary, textAlign: "center", padding: "24px 0" }}>
                      No projects yet
                    </div>
                  ) : (
                    <div ref={stagesRef} style={{ position: "relative", height: "100%" }}>
                      <ChartBox aspectRatio={0} minHeight={140} fillHeight>
                        {(W, H) => {
                          const PL = 46, PR = 8, PT = 18, PB = 38;
                          const cW = Math.max(W - PL - PR, 10);
                          const cH = Math.max(H - PT - PB, 10);
                          const slotW = cW / nonEmpty.length;
                          const barW = Math.min(60, slotW * 0.55);
                          // Sync size for tooltip positioning (only when it changes)
                          if (W !== stagesSize.w || H !== stagesSize.h) {
                            queueMicrotask(() => setStagesSize({ w: W, h: H }));
                          }

                          return (
                            <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
                              {/* Gridlines + Y-axis labels */}
                              {yTicks.map(v => {
                                const y = PT + cH - (v / niceMax) * cH;
                                return (
                                  <g key={v}>
                                    <line x1={PL} x2={PL + cW} y1={y} y2={y}
                                      stroke={theme.border} strokeWidth={1}
                                      strokeDasharray={v === 0 ? "" : "3 3"} opacity={v === 0 ? 0.9 : 0.45} />
                                    <text x={PL - 6} y={y + 3} textAnchor="end"
                                      fontSize={9} fill={theme.textTertiary}>
                                      {fmtTick(v)}
                                    </text>
                                  </g>
                                );
                              })}
                              {/* Y-axis title */}
                              <text x={PL - 38} y={PT - 6} fontSize={9} fontWeight={600}
                                fill={theme.textTertiary} textTransform="uppercase" letterSpacing="0.06em">
                                MWp
                              </text>

                              {/* Bars + MWp labels + X-axis labels */}
                              {nonEmpty.map((b, i) => {
                                const xCenter = PL + (i + 0.5) * slotW;
                                const x = xCenter - barW / 2;
                                const h = (b.mwp / niceMax) * cH;
                                const y = PT + cH - h;
                                const labelMaxChars = Math.max(6, Math.floor(slotW / 7));
                                const stageLabel = b.stage.length > labelMaxChars
                                  ? b.stage.slice(0, labelMaxChars - 1) + "…"
                                  : b.stage;
                                const onMove = (e) => {
                                  const rect = stagesRef.current?.getBoundingClientRect();
                                  if (!rect) return;
                                  setStagesHover({ index: i, mouseX: e.clientX - rect.left, mouseY: e.clientY - rect.top });
                                };
                                const isFaded = stagesHover && stagesHover.index !== i;
                                return (
                                  <g key={b.stage}
                                    onMouseEnter={onMove}
                                    onMouseMove={onMove}
                                    onMouseLeave={() => setStagesHover(null)}
                                  >
                                    {/* Full-slot hitbox so tooltip triggers above short bars too */}
                                    <rect x={PL + i * slotW} y={PT} width={slotW} height={cH} fill="transparent" />
                                    {/* MWp value above bar */}
                                    <text x={xCenter} y={y - 5} textAnchor="middle"
                                      fontSize={11} fontWeight={700} fill={b.color}
                                      opacity={isFaded ? 0.4 : 1}
                                      style={{ pointerEvents: "none", transition: "opacity 0.1s" }}>
                                      {fmtMwp1(b.mwp)}
                                    </text>
                                    {/* Bar */}
                                    <rect x={x} y={y} width={barW} height={h}
                                      fill={b.color} rx={3} ry={3}
                                      opacity={isFaded ? 0.4 : 1}
                                      style={{ pointerEvents: "none", transition: "opacity 0.1s" }} />
                                    {/* Stage label */}
                                    <text x={xCenter} y={PT + cH + 14} textAnchor="middle"
                                      fontSize={10} fontWeight={600} fill={theme.textSecondary}
                                      style={{ pointerEvents: "none" }}>
                                      {stageLabel}
                                    </text>
                                    {/* Project count */}
                                    <text x={xCenter} y={PT + cH + 27} textAnchor="middle"
                                      fontSize={9} fill={theme.textTertiary}
                                      style={{ pointerEvents: "none" }}>
                                      {b.count} project{b.count !== 1 ? "s" : ""}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        }}
                      </ChartBox>
                      {stagesHover && nonEmpty[stagesHover.index] && (() => {
                        const b = nonEmpty[stagesHover.index];
                        const projectRows = b.projects.slice(0, 6).map(name => ({ name, value: "", color: b.color }));
                        if (b.projects.length > 6) projectRows.push({ name: `+ ${b.projects.length - 6} more`, value: "" });
                        return (
                          <ChartTooltip
                            x={stagesHover.mouseX} y={stagesHover.mouseY}
                            width={stagesSize.w || 400} height={stagesSize.h || 200}
                            theme={theme}
                            title={b.stage}
                            rows={[
                              { name: "Capacity", value: `${fmtMwp1(b.mwp)} MWp`, color: b.color },
                              { name: "Projects", value: b.count },
                              ...projectRows.map(r => ({ name: r.name, value: r.value })),
                            ]}
                          />
                        );
                      })()}
                    </div>
                  )}
                </Widget>
              </div>
            );
          })()}

          {/* ── Acq Projects by COD ──────────────────────────────────────── */}
          {shouldRender("acq-cod") && (
            <div key="acq-cod">
              <Widget id="acq-cod" title="Acq · MWp by COD" color="#f59e0b"
                sub={`${fmtCodMwp(codTotalMwp)} MWp · ${codTotalShown} project${codTotalShown !== 1 ? "s" : ""}${codNoDate ? ` · ${codNoDate} no COD` : ""}`} {...wProps}>
                <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                  {/* Controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", flexWrap: "wrap", flexShrink: 0 }}>
                    <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 6, padding: 2, gap: 2 }}>
                      {[["year", "Year"], ["quarter", "Quarter"]].map(([v, l]) => {
                        const active = codGran === v;
                        return (
                          <button key={v} onClick={() => setCodGran(v)} style={{ fontSize: 10, fontWeight: active ? 700 : 500, padding: "3px 9px", borderRadius: 4, cursor: "pointer", color: active ? "#fff" : theme.textSecondary, background: active ? "#f59e0b" : "transparent", border: "none", fontFamily: "inherit" }}>{l}</button>
                        );
                      })}
                    </div>
                    <button onClick={() => setCodFilterOpen(o => !o)} style={{ fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer", color: codFilterOpen ? "#fff" : theme.textSecondary, background: codFilterOpen ? "#f59e0b" : theme.pillBg, border: `1px solid ${codFilterOpen ? "#f59e0b" : theme.pillBorder}`, marginLeft: "auto", fontFamily: "inherit" }}>
                      {codFilterOpen ? "✓ Done" : `Filter projects (${codSelectedCount}/${acqProjects.length})`}
                    </button>
                  </div>

                  {codFilterOpen ? (
                    <div style={{ flex: 1, overflowY: "auto", padding: "2px 10px 10px", minHeight: 0 }}>
                      <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
                        <button onClick={() => setCodSelected(null)} style={{ fontSize: 10, color: "#f59e0b", background: "none", border: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}>Select all</button>
                        <button onClick={() => setCodSelected(new Set())} style={{ fontSize: 10, color: theme.textTertiary, background: "none", border: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}>Clear</button>
                      </div>
                      {codProjectList.map(p => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11, color: theme.textSecondary, cursor: "pointer" }}>
                          <input type="checkbox" checked={isCodSelected(p.id)} onChange={() => {
                            setCodSelected(prev => {
                              const base = prev === null ? new Set(acqProjects.map(x => x.id)) : new Set(prev);
                              base.has(p.id) ? base.delete(p.id) : base.add(p.id);
                              return base;
                            });
                          }} />
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                          <span style={{ fontSize: 10, color: theme.textTertiary, flexShrink: 0 }}>{p.cod ? p.cod.slice(0, 7) : "no COD"}</span>
                        </label>
                      ))}
                    </div>
                  ) : codData.length === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: theme.textTertiary, textAlign: "center", padding: 12 }}>
                      No projects with a COD date in the current selection.
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1, minHeight: 0 }}>
                        <ChartBox aspectRatio={0} minHeight={120} fillHeight>
                          {(w, h) => <CodBarChart buckets={codData} width={w} height={Math.max(h, 120)} theme={theme} />}
                        </ChartBox>
                      </div>
                      {/* Stats row */}
                      <div style={{ display: "flex", gap: 22, padding: "8px 14px 10px", flexShrink: 0, borderTop: `1px solid ${theme.borderSubtle || theme.border}` }}>
                        {[
                          { label: "Total", value: codTotalMwp, color: theme.textPrimary },
                          { label: "Solar", value: codSolarMwp, color: "#22c55e" },
                          { label: "BESS",  value: codBessMwp,  color: "#3b82f6" },
                        ].map(s => (
                          <div key={s.label}>
                            <div style={{ fontSize: 8, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 2 }}>{s.label}</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: s.color, fontFamily: "monospace", letterSpacing: "-0.02em" }}>{fmtCodMwp(s.value)}<span style={{ fontSize: 9, fontWeight: 600, color: theme.textTertiary, marginLeft: 3 }}>MWp</span></div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Widget>
            </div>
          )}

        </GridLayout>
      </div>

      <style>{`
        .react-resizable-handle { opacity: ${editMode ? 0.6 : 0}; transition: opacity 0.15s; }
        .react-resizable-handle::after { border-color: ${theme.accent} !important; }
        .react-grid-item.react-grid-placeholder { background: ${theme.accent} !important; opacity: 0.1 !important; border-radius: 12px; }
        .widget-drag-handle { user-select: none; }
      `}</style>
    </div>
  );
}
