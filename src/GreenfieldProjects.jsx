import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";
import { supabase } from "./supabase.js";

const ACCENT = "#10b981";

// Dev-pipeline stages in progression order (earliest → most advanced).
// Planning Submitted is the final stage. Cancelled / Clock Pause are off-pipeline.
const STAGES = [
  { value: "Engaged Landowner",   color: "#6366f1" },
  { value: "LoA Sent",            color: "#14b8a6" },
  { value: "Grid App Submitted",  color: "#3b82f6" },
  { value: "Grid App Received",   color: "#06b6d4" },
  { value: "Neg HoTs",            color: "#f59e0b" },
  { value: "HoTs Agreed",         color: "#eab308" },
  { value: "Negs Option & Lease", color: "#10b981" },
  { value: "Signed Option",       color: "#22c55e" },
  { value: "Planning Submitted",  color: "#4ade80" },
];
const OFF_PIPELINE = { "Cancelled": "#94a3b8", "Clock Pause": "#64748b" };
const STAGE_COLOR = { ...Object.fromEntries(STAGES.map(s => [s.value, s.color])), ...OFF_PIPELINE };
// Higher rank = more advanced. Off-pipeline / unknown = 0 (sorts to bottom).
const STAGE_RANK = Object.fromEntries(STAGES.map((s, i) => [s.value, i + 1]));
const stageRank = (status) => STAGE_RANK[status] ?? 0;
const ALL_STATUSES = [...STAGES.map(s => s.value), ...Object.keys(OFF_PIPELINE)];

function fmtMwp(v) {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function StatusBadge({ status }) {
  const color = STAGE_COLOR[status] || "#94a3b8";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 10, fontWeight: 700, color,
      background: color + "18", border: `1px solid ${color}33`,
      padding: "2px 7px", borderRadius: 4,
      fontFamily: "'Inter', system-ui, sans-serif", whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {status || "—"}
    </span>
  );
}

// Distinct palette for battery segments (matches screenshot style)
const BATTERY_PALETTE = [
  "#f97316", "#06b6d4", "#22c55e", "#ef4444",
  "#a855f7", "#eab308", "#3b82f6", "#ec4899",
  "#14b8a6", "#f59e0b", "#8b5cf6", "#84cc16",
];

export function GridAppBatteryChart({ projects, theme, embedded = false, techFilter = "solar", title = "Grid App Submitted — Solar Capacity Pipeline" }) {
  const items = useMemo(() => {
    const raw = projects
      .filter(p => p.status === "Grid App Submitted" && Number(p.mwp) > 0
        && (!techFilter || (p.tech?.toLowerCase().includes(techFilter) && !p.tech?.toLowerCase().includes("bess"))))
      .sort((a, b) => Number(b.mwp) - Number(a.mwp));
    return raw.map((p, i) => ({ ...p, color: BATTERY_PALETTE[i % BATTERY_PALETTE.length], mwpNum: Number(p.mwp) }));
  }, [projects, techFilter]);

  const [barWidth, setBarWidth] = useState(600);
  const [hover, setHover] = useState(null); // { index, mouseX, mouseY } in container coords
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setBarWidth(Math.floor(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (items.length === 0) return null;

  const total = items.reduce((s, p) => s + p.mwpNum, 0);

  // Layout constants
  const LBL_W  = 136; // left label
  const TOT_W  = 60;  // right total
  const BAR_H  = 48;
  const AXIS_H = 28;
  const chartW = Math.max(barWidth - LBL_W - TOT_W, 20);
  const svgW   = barWidth;
  const svgH   = BAR_H + AXIS_H;

  // Axis ticks — pick a nice step
  const rawStep = total / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep / mag) * mag || 5;
  const ticks = [];
  for (let t = 0; t <= total + niceStep * 0.5; t += niceStep) ticks.push(+t.toFixed(2));

  // Build segments
  let cx = 0;
  const segments = items.map(p => {
    const segW = (p.mwpNum / total) * chartW;
    const x = cx;
    cx += segW;
    return { ...p, x, segW };
  });

  return (
    <div style={embedded
      ? { width: "100%" }
      : { background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 10, padding: "14px 20px 16px" }}>
      {!embedded && (
        <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>
          {title}
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", position: "relative" }}>
        {barWidth > 80 && (
          <svg width={svgW} height={svgH} style={{ display: "block", overflow: "visible" }}>
            <defs>
              <clipPath id="battery-bar-clip">
                <rect x={LBL_W} y={0} width={chartW} height={BAR_H} rx={5} />
              </clipPath>
            </defs>

            {/* Row label */}
            <text x={LBL_W - 10} y={BAR_H / 2 + 4} textAnchor="end" fontSize={10} fontWeight={600} fill={theme.textSecondary}>
              Grid App Submitted
            </text>

            {/* Bar segments (clipped to rounded rect) */}
            <g clipPath="url(#battery-bar-clip)">
              {segments.map((seg, i) => {
                const onMove = (e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setHover({ index: i, mouseX: e.clientX - rect.left, mouseY: e.clientY - rect.top });
                };
                return (
                  <rect key={seg.id}
                    x={LBL_W + seg.x} y={0} width={seg.segW} height={BAR_H}
                    fill={seg.color}
                    opacity={hover && hover.index !== i ? 0.35 : 1}
                    style={{ transition: "opacity 0.1s", cursor: "default" }}
                    onMouseEnter={onMove}
                    onMouseMove={onMove}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>

            {/* MWp labels inside segments */}
            {segments.map(seg => seg.segW > 20 && (
              <text key={`lbl-${seg.id}`}
                x={LBL_W + seg.x + seg.segW / 2} y={BAR_H / 2 + 4}
                textAnchor="middle" fontSize={seg.segW > 50 ? 12 : 9} fontWeight={700} fill="#fff"
                style={{ pointerEvents: "none" }}>
                {fmtMwp(seg.mwpNum)}
              </text>
            ))}

            {/* Total */}
            <text x={LBL_W + chartW + 9} y={BAR_H / 2 + 5} textAnchor="start" fontSize={13} fontWeight={800} fill={theme.textPrimary}>
              {fmtMwp(total)}
            </text>

            {/* X-axis ticks + labels */}
            {ticks.map(t => {
              const tx = LBL_W + (t / total) * chartW;
              if (tx > LBL_W + chartW + 4) return null;
              return (
                <g key={t}>
                  <line x1={tx} y1={BAR_H} x2={tx} y2={BAR_H + 5} stroke={theme.borderSubtle || theme.border} strokeWidth={1} />
                  <text x={tx} y={BAR_H + 17} textAnchor="middle" fontSize={9} fill={theme.textMuted}>{t}</text>
                </g>
              );
            })}
            <text x={LBL_W + chartW / 2} y={svgH} textAnchor="middle" fontSize={9} fill={theme.textTertiary}>MWp</text>
          </svg>
        )}
        {/* Hover tooltip — positioned next to the cursor, flipped if near edge */}
        {hover && items[hover.index] && (() => {
          const seg = items[hover.index];
          const pct = total > 0 ? (seg.mwpNum / total) * 100 : 0;
          const TT_W = 210, OFFSET = 14;
          const tipLeftRaw = hover.mouseX + OFFSET;
          const flip = tipLeftRaw + TT_W > svgW - 4;
          const tipLeft = flip ? Math.max(4, hover.mouseX - OFFSET - TT_W) : tipLeftRaw;
          const tipTop = Math.max(4, hover.mouseY - 60);
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
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
                display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{seg.name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "2px 0", fontSize: 11 }}>
                <span style={{ color: theme.textSecondary }}>Capacity</span>
                <span style={{ fontWeight: 700, color: theme.textPrimary, fontVariantNumeric: "tabular-nums" }}>{fmtMwp(seg.mwpNum)} MWp</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "2px 0", fontSize: 11 }}>
                <span style={{ color: theme.textSecondary }}>Share of pipeline</span>
                <span style={{ fontWeight: 700, color: theme.textPrimary, fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
              </div>
              {seg.tech && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "2px 0", fontSize: 11 }}>
                  <span style={{ color: theme.textSecondary }}>Tech</span>
                  <span style={{ fontWeight: 600, color: theme.textTertiary, fontSize: 10 }}>{seg.tech}</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 18px", marginTop: 14 }}>
        {items.map(p => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: theme.textSecondary }}>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal bar chart of Grid App Submitted projects, soonest expected offer
// first. Bar length = days remaining (shorter = sooner); colour by urgency.
function GridOfferChart({ projects, theme, title = "Grid Offers · Coming Soonest" }) {
  const items = projects
    .map(p => ({ p, est: gridOfferEstimate(p) }))
    .filter(x => x.est)
    .sort((a, b) => a.est.expected - b.est.expected)
    .slice(0, 8);
  const maxDays = Math.max(1, ...items.map(x => Math.max(x.est.diffDays, 1)));
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: "12px 16px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic", margin: "auto 0" }}>No submitted projects with a date yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, justifyContent: "center", flex: 1 }}>
          {items.map(({ p, est }) => {
            const pct = Math.max(5, Math.min(100, (Math.max(est.diffDays, 0) / maxDays) * 100));
            const color = gridCountdownColor(est.diffDays);
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 82, flexShrink: 0, fontSize: 10, color: theme.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</div>
                <div style={{ flex: 1, minWidth: 0, height: 13, background: theme.pillBg || theme.surfaceBg, borderRadius: 4, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color, borderRadius: 4 }} />
                </div>
                <div style={{ width: 66, flexShrink: 0, fontSize: 10, fontWeight: 700, color, textAlign: "right", whiteSpace: "nowrap" }}>{gridCountdownLabel(est.diffDays)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, sub, color, theme }) {
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: "12px 16px", flex: 1 }}>
      <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || theme.textPrimary, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ children, theme }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${theme.borderSubtle || theme.border}` }}>
      <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 10 }}>{children}</div>
    </div>
  );
}

function DetailRow({ label, value, theme }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: theme.textPrimary }}>{value || <span style={{ color: theme.textTertiary }}>—</span>}</div>
    </div>
  );
}

function FieldLabel({ children, theme }) {
  return <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{children}</div>;
}

function ColumnFilterHeader({ label, filterKey, value, options, onChange, isOpen, onToggle, theme }) {
  const isFiltered = value !== "All";
  const [search, setSearch] = useState("");
  const filtered = options.filter(o => {
    const q = search.toLowerCase();
    const opt = String(o).toLowerCase();
    return opt.startsWith(q) || opt.split(/[\s\-_&,/]+/).some(w => w.startsWith(q));
  });
  return (
    <th onClick={e => { e.stopPropagation(); onToggle(isOpen ? null : filterKey); if (!isOpen) setSearch(""); }}
      style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: isFiltered ? ACCENT : theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg, cursor: "pointer", userSelect: "none", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ fontSize: 8, transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
        {isFiltered && <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT, flexShrink: 0 }} />}
      </div>
      {isOpen && (
        <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, minWidth: 200,
            background: theme.elevatedBg || theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)", marginTop: 2, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 8px 4px" }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              style={{ width: "100%", boxSizing: "border-box", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
                borderRadius: 6, padding: "5px 9px", fontSize: 11, color: theme.textPrimary, outline: "none", fontFamily: "inherit" }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "2px 4px 4px" }}>
            {(search ? filtered : ["All", ...options]).map(opt => (
              <div key={opt} onClick={() => { onChange(opt); onToggle(null); setSearch(""); }}
                style={{ padding: "7px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  background: value === opt ? (ACCENT + "18") : "transparent",
                  color: value === opt ? ACCENT : theme.textPrimary, fontWeight: value === opt ? 700 : 400 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${value === opt ? ACCENT : theme.border}`,
                  background: value === opt ? ACCENT : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", flexShrink: 0 }}>
                  {value === opt ? "✓" : ""}
                </span>
                {opt}
              </div>
            ))}
            {search && filtered.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: 11, color: theme.textTertiary, fontStyle: "italic" }}>No matches</div>
            )}
          </div>
        </div>
      )}
    </th>
  );
}

// ── Grid offer estimate ───────────────────────────────────────────────────────
// Submission date + working days (35 if ≤5 MWp, else 60). Weekends skipped;
// bank holidays are not accounted for.
function addWorkingDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}
function gridOfferEstimate(project) {
  if (project?.status !== "Grid App Submitted" || !project.grid_app_submitted_at) return null;
  const days = (project.mwp != null && Number(project.mwp) <= 5) ? 35 : 60;
  const expected = addWorkingDays(project.grid_app_submitted_at, days);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((expected - today) / 86400000);
  return { expected, days, diffDays };
}
function fmtGridDate(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function gridCountdownLabel(diffDays) {
  if (diffDays > 0) return `in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  if (diffDays === 0) return "due today";
  return `${-diffDays} day${diffDays !== -1 ? "s" : ""} overdue`;
}
function gridCountdownColor(diffDays) {
  if (diffDays < 0) return "#EF4444";
  if (diffDays <= 5) return "#F59E0B";
  return "#16A34A";
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!n || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileEmoji(mime, name = "") {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (mime?.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf" || ext === "pdf") return "📄";
  if (["doc", "docx"].includes(ext) || mime?.includes("word")) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext) || mime?.includes("sheet")) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜️";
  return "📎";
}

export default function GreenfieldProjects({
  projectsTable = "greenfield_projects",
  activityTable = "greenfield_project_activity",
  emailReview = true,
  gridChartTech = "solar",
  gridChartTitle = "Grid App Submitted — Solar Capacity Pipeline",
} = {}) {
  const { theme } = useTheme();

  const [projects, setProjects]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [openFilter, setOpenFilter] = useState(null);
  const [search, setSearch]       = useState("");
  const [fTech, setFTech]         = useState("All");
  const [fStatus, setFStatus]     = useState("All");
  const [fDno, setFDno]           = useState("All");
  const [fOwner, setFOwner]       = useState("All");
  const [activity, setActivity]   = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expanded, setExpanded]   = useState(() => new Set());
  const [editing, setEditing]     = useState(false);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const openEditOnSelectRef       = useRef(false); // open panel in edit mode after a New Project insert
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewOpen, setReviewOpen]   = useState(false);
  const [noteText, setNoteText]       = useState("");
  const [noteSaving, setNoteSaving]   = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // activity row pending attachment deletion
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  const loadReview = useCallback(async () => {
    if (!emailReview) { setReviewItems([]); return; }
    const { data } = await supabase
      .from("greenfield_email_review")
      .select("*")
      .eq("resolved", false)
      .order("sent_at", { ascending: false });
    setReviewItems(data || []);
  }, [emailReview]);

  const loadData = useCallback(async () => {
    const { data } = await supabase
      .from(projectsTable)
      .select("*")
      .order("last_updated", { ascending: false, nullsFirst: false });
    if (data) setProjects(data);
    setLoading(false);
  }, [projectsTable]);

  useEffect(() => { loadData(); loadReview(); }, [loadData, loadReview]);

  const selected = projects.find(p => p.id === selectedId);

  useEffect(() => {
    setEditing(openEditOnSelectRef.current); // stay in edit mode for a freshly-created project
    openEditOnSelectRef.current = false;
    setNoteText("");
    if (!selectedId) { setActivity([]); return; }
    let cancelled = false;
    setActivityLoading(true);
    setExpanded(new Set());
    supabase
      .from(activityTable)
      .select("id, kind, author, body, created_at, source, subject, direction, file_path, file_name, file_size, mime_type")
      .eq("project_id", selectedId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setActivity(data || []);
        setActivityLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const techOptions   = useMemo(() => [...new Set(projects.map(p => p.tech).filter(Boolean))].sort(), [projects]);
  const statusOptions = useMemo(() => [...new Set(projects.map(p => p.status).filter(Boolean))].sort(), [projects]);
  const dnoOptions    = useMemo(() => [...new Set(projects.map(p => p.dno).filter(Boolean))].sort(), [projects]);
  const ownerOptions  = useMemo(() => [...new Set(projects.map(p => p.owner).filter(Boolean))].sort(), [projects]);

  const q = search.trim().toLowerCase();
  const filtered = projects
    .filter(p => fTech === "All"   || p.tech === fTech)
    .filter(p => fStatus === "All" || p.status === fStatus)
    .filter(p => fDno === "All"    || p.dno === fDno)
    .filter(p => fOwner === "All"  || p.owner === fOwner)
    .filter(p => !q || [p.name, p.owner, p.dno, p.tech, p.email, p.main_contact, p.status]
      .some(v => v && String(v).toLowerCase().includes(q)))
    .sort((a, b) => {
      const r = stageRank(b.status) - stageRank(a.status); // most advanced first
      if (r !== 0) return r;
      return (b.last_updated || "").localeCompare(a.last_updated || "");
    });

  // Off-pipeline statuses (Cancelled, Clock Pause) are not "active" — this keeps
  // the Active KPI in step with the pipeline tracker, which only buckets the
  // in-progression stages.
  const isActive   = (p) => !OFF_PIPELINE[p.status];
  const total      = projects.length;
  const active     = projects.filter(isActive).length;
  const cancelled  = projects.filter(p => p.status === "Cancelled").length;
  const totalMwp   = projects.reduce((s, p) => s + (Number(p.mwp) || 0), 0);
  const activeMwp  = projects.filter(isActive).reduce((s, p) => s + (Number(p.mwp) || 0), 0);
  const stageCounts = STAGES.map(s => ({ ...s, count: projects.filter(p => p.status === s.value).length }));

  const anyFilter = fTech !== "All" || fStatus !== "All" || fDno !== "All" || fOwner !== "All" || q;
  const clearAll = () => { setFTech("All"); setFStatus("All"); setFDno("All"); setFOwner("All"); setSearch(""); };

  const inp = {
    width: "100%", boxSizing: "border-box", background: theme.surfaceBg,
    border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary,
    padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Inter', system-ui, sans-serif",
  };

  function startEdit() {
    if (!selected) return;
    setForm({
      name: selected.name || "", status: selected.status || "",
      tech: selected.tech || "", mwp: selected.mwp ?? "",
      dno: selected.dno || "", owner: selected.owner || "",
      main_contact: selected.main_contact || "", email: selected.email || "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected || !form.name.trim()) return;
    setSaving(true);
    const patch = {
      name: form.name.trim(),
      status: form.status || null,
      tech: form.tech.trim() || null,
      mwp: form.mwp === "" || form.mwp == null ? null : Number(form.mwp),
      dno: form.dno.trim() || null,
      owner: form.owner.trim() || null,
      main_contact: form.main_contact.trim() || null,
      email: form.email.trim() || null,
      last_updated: new Date().toISOString(),
    };
    // Select the row back so the trigger-stamped grid_app_submitted_at (set when
    // status becomes 'Grid App Submitted') is reflected locally without a reload.
    const { data, error } = await supabase.from(projectsTable).update(patch).eq("id", selected.id).select().single();
    if (!error) setProjects(prev => prev.map(p => p.id === selected.id ? { ...p, ...patch, ...(data || {}) } : p));
    setSaving(false);
    setEditing(false);
  }

  // Bump a project's last_updated so the "Updated" column reflects activity
  // (notes, attachments, synced emails), not just field edits.
  async function touchProject(projectId) {
    if (!projectId) return;
    const ts = new Date().toISOString();
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, last_updated: ts } : p));
    await supabase.from(projectsTable).update({ last_updated: ts }).eq("id", projectId);
  }

  async function updateGridDate(dateStr) {
    if (!selected) return;
    const val = dateStr || null;
    setProjects(prev => prev.map(p => p.id === selected.id ? { ...p, grid_app_submitted_at: val } : p));
    await supabase.from(projectsTable).update({ grid_app_submitted_at: val }).eq("id", selected.id);
  }

  async function deleteProject() {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"? This also removes its activity and cannot be undone.`)) return;
    const { error } = await supabase.from(projectsTable).delete().eq("id", selected.id);
    if (!error) { setProjects(prev => prev.filter(p => p.id !== selected.id)); setSelectedId(null); }
  }

  async function createNewProject() {
    const { data, error } = await supabase
      .from(projectsTable)
      .insert({ name: "New Project", last_updated: new Date().toISOString() })
      .select("*")
      .single();
    if (error) { console.error("Failed to create project:", error); return; }
    setProjects(prev => [data, ...prev]);
    setForm({
      name: data.name || "", status: "", tech: "", mwp: "",
      dno: "", owner: "", main_contact: "", email: "",
    });
    openEditOnSelectRef.current = true;
    setSelectedId(data.id);
  }

  async function addNote() {
    const body = noteText.trim();
    if (!body || !selected) return;
    setNoteSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const author = user?.email || "Unknown";
    const row = {
      project_id: selected.id,
      kind: "note",
      source: "manual",
      author,
      body,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from(activityTable)
      .insert(row)
      .select("id, kind, author, body, created_at, source, subject, direction, file_path, file_name, file_size, mime_type")
      .single();
    setNoteSaving(false);
    if (!error && data) {
      setActivity(prev => [data, ...prev]);   // newest first, matches load order
      setNoteText("");
      touchProject(selected.id);
    } else if (error) {
      window.alert(`Couldn't save note: ${error.message}`);
    }
  }

  async function uploadFile(file) {
    if (!file || !selected) return;
    setFileUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${selected.id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("project-files")
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        project_id: selected.id,
        kind: "file",
        source: "upload",
        author: user?.email || "Unknown",
        body: "",
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        created_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from(activityTable)
        .insert(row)
        .select("id, kind, author, body, created_at, source, subject, direction, file_path, file_name, file_size, mime_type")
        .single();
      if (error) throw error;
      setActivity(prev => [data, ...prev]);
      touchProject(selected.id);
    } catch (e) {
      window.alert(`Couldn't upload file: ${e.message}`);
    } finally {
      setFileUploading(false);
    }
  }

  // Private bucket → mint a short-lived signed URL on demand.
  async function openFile(a) {
    if (!a.file_path) return;
    const { data, error } = await supabase.storage.from("project-files").createSignedUrl(a.file_path, 60);
    if (error || !data?.signedUrl) { window.alert(`Couldn't open file: ${error?.message || "unknown error"}`); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function deleteFile(a) {
    setDeleting(true);
    try {
      if (a.file_path) {
        const { error: rmErr } = await supabase.storage.from("project-files").remove([a.file_path]);
        if (rmErr) throw rmErr;
      }
      const { error } = await supabase.from(activityTable).delete().eq("id", a.id);
      if (error) throw error;
      setActivity(prev => prev.filter(x => x.id !== a.id));
      setPendingDelete(null);
    } catch (e) {
      window.alert(`Couldn't delete attachment: ${e.message}`);
    } finally {
      setDeleting(false);
    }
  }

  const fld = (k) => ({ value: form[k] ?? "", onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) });

  const projName = (id) => projects.find(p => p.id === id)?.name || "(unknown project)";

  async function assignReview(item, projectId) {
    if (!projectId) return;
    await supabase.from(activityTable).upsert({
      project_id: projectId, source: "gmail", kind: "email",
      gmail_message_id: item.gmail_message_id, author: item.from_addr,
      subject: item.subject, from_addr: item.from_addr, direction: item.direction,
      body: item.body, created_at: item.sent_at,
    }, { onConflict: "gmail_message_id", ignoreDuplicates: true });
    await supabase.from("greenfield_email_review").update({ resolved: true }).eq("id", item.id);
    setReviewItems(prev => prev.filter(r => r.id !== item.id));
    touchProject(projectId);
    if (selectedId === projectId) {
      const { data } = await supabase.from(activityTable)
        .select("id, kind, author, body, created_at, source, subject, direction, file_path, file_name, file_size, mime_type")
        .eq("project_id", selectedId).order("created_at", { ascending: false });
      setActivity(data || []);
    }
  }

  async function dismissReview(item) {
    await supabase.from("greenfield_email_review").update({ resolved: true }).eq("id", item.id);
    setReviewItems(prev => prev.filter(r => r.id !== item.id));
  }

  return (
    <div onClick={() => openFilter && setOpenFilter(null)}
      style={{ display: "flex", height: "100%", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary, overflow: "hidden" }}>

      {selected && (
        <div style={{ width: 380, flexShrink: 0, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", padding: "14px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, paddingLeft: 2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {editing ? "Edit Project" : selected.name}
            </div>
            {!editing && (
              <button onClick={startEdit} style={{ fontSize: 11, fontWeight: 700, color: ACCENT, background: ACCENT + "15", border: `1px solid ${ACCENT}33`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Edit</button>
            )}
            <div onClick={() => { setEditing(false); setSelectedId(null); }} style={{ cursor: "pointer", fontSize: 14, color: theme.textTertiary, padding: "2px 6px" }}>✕</div>
          </div>

          {editing ? (
            <>
              <div style={{ marginBottom: 10 }}>
                <FieldLabel theme={theme}>Project Name *</FieldLabel>
                <input {...fld("name")} style={inp} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <FieldLabel theme={theme}>Status</FieldLabel>
                <select {...fld("status")} style={{ ...inp, appearance: "none", cursor: "pointer" }}>
                  <option value="">— None —</option>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div><FieldLabel theme={theme}>Technology</FieldLabel><input {...fld("tech")} placeholder="Solar / Battery / Wind…" style={inp} /></div>
                <div><FieldLabel theme={theme}>Capacity (MWp)</FieldLabel><input {...fld("mwp")} type="number" step="0.1" style={inp} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div><FieldLabel theme={theme}>DNO</FieldLabel><input {...fld("dno")} style={inp} /></div>
                <div><FieldLabel theme={theme}>Owner</FieldLabel><input {...fld("owner")} style={inp} /></div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <FieldLabel theme={theme}>Main Contact</FieldLabel>
                <input {...fld("main_contact")} style={inp} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <FieldLabel theme={theme}>Email</FieldLabel>
                <input {...fld("email")} style={inp} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveEdit} disabled={!form.name?.trim() || saving} style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 8, background: form.name?.trim() ? ACCENT : theme.border, color: "#fff", border: "none", cursor: form.name?.trim() ? "pointer" : "default", fontFamily: "'Inter', system-ui, sans-serif", opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : "Save Changes"}</button>
                <button onClick={() => setEditing(false)} style={{ padding: "9px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer", background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`, fontFamily: "'Inter', system-ui, sans-serif" }}>Cancel</button>
                <button onClick={deleteProject} title="Delete project" style={{ padding: "9px 12px", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", background: "transparent", color: "#ef4444", border: "1px solid #ef444433", fontFamily: "'Inter', system-ui, sans-serif" }}>Delete</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 4 }}><StatusBadge status={selected.status} /></div>

              <SectionHeader theme={theme}>Project</SectionHeader>
              <DetailRow label="Technology" value={selected.tech} theme={theme} />
              <DetailRow label="Capacity (MWp)" value={fmtMwp(selected.mwp)} theme={theme} />
              <DetailRow label="DNO" value={selected.dno} theme={theme} />
              <DetailRow label="Owner" value={selected.owner} theme={theme} />

              {selected.status === "Grid App Submitted" && (
                <>
                  <SectionHeader theme={theme}>Grid Application</SectionHeader>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 0" }}>
                    <span style={{ fontSize: 11, color: theme.textTertiary }}>Submitted</span>
                    <input type="date" value={selected.grid_app_submitted_at || ""} onChange={e => updateGridDate(e.target.value)}
                      style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "4px 8px", fontSize: 11, outline: "none", fontFamily: "inherit", colorScheme: "dark" }} />
                  </div>
                  {(() => {
                    const est = gridOfferEstimate(selected);
                    if (!est) return <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic", padding: "2px 0 6px" }}>Set the submission date to estimate the grid offer.</div>;
                    return (
                      <div style={{ background: gridCountdownColor(est.diffDays) + "12", border: `1px solid ${gridCountdownColor(est.diffDays)}44`, borderRadius: 8, padding: "9px 11px", marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Grid offer expected ({est.days} working days)</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>{fmtGridDate(est.expected)}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: gridCountdownColor(est.diffDays), marginTop: 1 }}>{gridCountdownLabel(est.diffDays)}</div>
                      </div>
                    );
                  })()}
                </>
              )}

              <SectionHeader theme={theme}>Contact</SectionHeader>
              <DetailRow label="Main Contact" value={selected.main_contact} theme={theme} />
              <DetailRow label="Email" value={selected.email} theme={theme} />
            </>
          )}

          <SectionHeader theme={theme}>Source</SectionHeader>
          <DetailRow label="Last Updated"
            value={selected.last_updated ? new Date(selected.last_updated).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null}
            theme={theme} />
          <DetailRow label="Monday ID" value={selected.monday_id} theme={theme} />

          <SectionHeader theme={theme}>Activity{activity.length ? ` (${activity.length})` : ""}</SectionHeader>

          {/* Add note composer */}
          <div style={{ marginBottom: 10 }}>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote(); }}
              placeholder="Add a note… (⌘/Ctrl+Enter to save)"
              rows={2}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                background: theme.inputBg || theme.cardBg, color: theme.textPrimary,
                border: `1px solid ${theme.border}`, borderRadius: 8,
                padding: "8px 10px", fontSize: 11, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
                style={{ display: "none" }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={fileUploading}
                title="Attach a file (PDF, Doc, image…)"
                style={{
                  fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6,
                  cursor: fileUploading ? "default" : "pointer",
                  color: theme.textSecondary, background: "transparent",
                  border: `1px solid ${theme.border}`, fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 5, opacity: fileUploading ? 0.6 : 1,
                }}
              >📎 {fileUploading ? "Uploading…" : "Attach"}</button>
              <button
                onClick={addNote}
                disabled={!noteText.trim() || noteSaving}
                style={{
                  fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 6,
                  cursor: !noteText.trim() || noteSaving ? "default" : "pointer",
                  color: "#fff", background: !noteText.trim() ? theme.border : ACCENT,
                  border: "none", fontFamily: "inherit", opacity: noteSaving ? 0.6 : 1,
                }}
              >{noteSaving ? "Saving…" : "Add note"}</button>
            </div>
          </div>

          {activityLoading ? (
            <div style={{ fontSize: 11, color: theme.textTertiary, padding: "4px 0" }}>Loading…</div>
          ) : activity.length === 0 ? (
            <div style={{ fontSize: 11, color: theme.textTertiary, fontStyle: "italic", padding: "4px 0" }}>No activity logged</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activity.map(a => {
                const isEmail = a.kind === "email";
                const isFile = a.kind === "file";
                const isOpen = expanded.has(a.id);
                const body = a.body || "";
                const long = body.length > 280;
                const shown = isOpen || !long ? body : body.slice(0, 280) + "…";
                const tone = isFile ? "#10b981" : isEmail ? "#3b82f6" : "#94a3b8";
                const label = isFile ? "File" : isEmail ? "Email" : "Note";
                const dt = a.created_at
                  ? new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                  : "";
                return (
                  <div key={a.id} style={{ background: theme.cardBg, border: `1px solid ${theme.borderSubtle || theme.border}`, borderRadius: 8, padding: "9px 11px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                        color: tone, background: tone + "1a", border: `1px solid ${tone}33`,
                        padding: "1px 6px", borderRadius: 4,
                      }}>{label}</span>
                      {a.source === "gmail" && (
                        <span title={a.direction === "outbound" ? "Sent from Fuse" : "Received"} style={{
                          fontSize: 9, fontWeight: 700, color: ACCENT, background: ACCENT + "1a",
                          border: `1px solid ${ACCENT}33`, padding: "1px 6px", borderRadius: 4,
                        }}>{a.direction === "outbound" ? "Gmail ↗" : a.direction === "inbound" ? "Gmail ↙" : "Gmail"}</span>
                      )}
                      <span style={{ fontSize: 10, color: theme.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.author || "—"}</span>
                      <span style={{ fontSize: 10, color: theme.textTertiary, marginLeft: "auto", flexShrink: 0 }}>{dt}</span>
                    </div>
                    {a.subject && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary, marginBottom: 3 }}>{a.subject}</div>
                    )}
                    {isFile ? (
                      <div
                        onClick={() => openFile(a)}
                        title="Download / open"
                        style={{
                          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                          background: theme.surfaceBg, border: `1px solid ${theme.border}`,
                          borderRadius: 6, padding: "7px 9px",
                        }}
                      >
                        <span style={{ fontSize: 15 }}>{fileEmoji(a.mime_type, a.file_name)}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: ACCENT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.file_name || "file"}</span>
                        <span style={{ fontSize: 10, color: theme.textTertiary, marginLeft: "auto", flexShrink: 0 }}>{formatFileSize(a.file_size)}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setPendingDelete(a); }}
                          title="Delete attachment"
                          style={{
                            flexShrink: 0, width: 20, height: 20, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "transparent", border: "none", borderRadius: 4,
                            color: theme.textTertiary, cursor: "pointer", fontSize: 15,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "#ef444418"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = theme.textTertiary; e.currentTarget.style.background = "transparent"; }}
                        >×</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: theme.textSecondary, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{shown}</div>
                        {long && (
                          <div onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}
                            style={{ marginTop: 5, fontSize: 10, fontWeight: 700, color: ACCENT, cursor: "pointer" }}>
                            {isOpen ? "Show less" : "Show more"}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><EnergyLoader /></div>
        ) : (
          <>
            <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>Projects</span>
                <span style={{ fontSize: 11, color: theme.textTertiary, background: theme.pillBg || theme.surfaceBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                  {filtered.length}{filtered.length !== total ? ` of ${total}` : ""}
                </span>
                {anyFilter && (
                  <button onClick={clearAll} style={{ fontSize: 10, color: ACCENT, background: ACCENT + "15", border: `1px solid ${ACCENT}33`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                    Clear filters ✕
                  </button>
                )}
                {reviewItems.length > 0 && (
                  <button onClick={() => setReviewOpen(true)} style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "#f59e0b15", border: "1px solid #f59e0b44", borderRadius: 5, padding: "2px 9px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                    {reviewItems.length} email{reviewItems.length > 1 ? "s" : ""} to review
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…"
                  style={{ width: 220, background: theme.surfaceBg, border: `1px solid ${search ? ACCENT + "55" : theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "6px 10px", fontSize: 11, outline: "none", fontFamily: "'Inter', system-ui, sans-serif" }} />
                <button onClick={createNewProject}
                  style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: ACCENT, border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", whiteSpace: "nowrap" }}>
                  + New Project
                </button>
              </div>
            </div>

            <div style={{ padding: 20, flex: 1 }}>
              <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.1fr 1.1fr", gap: 12, marginBottom: 20, alignItems: "stretch" }}>
                {/* Combined Active KPI: projects + capacity in one card */}
                <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: "12px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>Active Projects</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: ACCENT, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 6 }}>{active}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: theme.pillBg || theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "2px 9px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary }}>{total}</span>
                      <span style={{ fontSize: 9, color: theme.textTertiary }}>total</span>
                    </div>
                  </div>
                  <div style={{ borderTop: `1px solid ${theme.borderSubtle || theme.border}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>Active Capacity</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: ACCENT, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 6 }}>{fmtMwp(activeMwp)} MWp</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: theme.pillBg || theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "2px 9px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary }}>{fmtMwp(totalMwp)}</span>
                      <span style={{ fontSize: 9, color: theme.textTertiary }}>total MWp</span>
                    </div>
                  </div>
                </div>
                {/* Existing capacity pipeline chart */}
                <GridAppBatteryChart projects={projects} theme={theme} techFilter={gridChartTech} title={gridChartTitle} />
                {/* New: grid offers coming soonest */}
                <GridOfferChart projects={projects} theme={theme} />
              </div>

              <div style={{ display: "flex", gap: 2, marginBottom: 20, padding: "12px 16px", background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 10, alignItems: "flex-start" }}>
                {stageCounts.map(s => (
                  <div key={s.value} onClick={() => setFStatus(fStatus === s.value ? "All" : s.value)}
                    style={{ flex: 1, textAlign: "center", cursor: "pointer", opacity: fStatus !== "All" && fStatus !== s.value ? 0.4 : 1, transition: "opacity 0.15s" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: s.count > 0 ? s.color : theme.textTertiary }}>{s.count}</div>
                    <div style={{ fontSize: 8.5, color: theme.textTertiary, marginTop: 2, lineHeight: 1.1 }}>{s.value}</div>
                    <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: s.count > 0 ? s.color : theme.pillBg || theme.border, opacity: 0.6 }} />
                  </div>
                ))}
                {cancelled > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 6, paddingLeft: 10, borderLeft: `1px solid ${theme.border}` }}>
                    <div onClick={() => setFStatus(fStatus === "Cancelled" ? "All" : "Cancelled")}
                      style={{ textAlign: "center", cursor: "pointer", opacity: fStatus !== "All" && fStatus !== "Cancelled" ? 0.4 : 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#94a3b8" }}>{cancelled}</div>
                      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2, opacity: 0.7 }}>Cancelled</div>
                      <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: "#94a3b8", opacity: 0.4 }} />
                    </div>
                  </div>
                )}
              </div>

              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: theme.textTertiary, fontSize: 12 }}>No projects match these filters.</div>
              ) : (
                <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Project</th>
                        <ColumnFilterHeader label="Tech" filterKey="tech" value={fTech} options={techOptions} onChange={v => setFTech(v)} isOpen={openFilter === "tech"} onToggle={setOpenFilter} theme={theme} />
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", background: theme.cardBg }}>MWp</th>
                        <ColumnFilterHeader label="DNO" filterKey="dno" value={fDno} options={dnoOptions} onChange={v => setFDno(v)} isOpen={openFilter === "dno"} onToggle={setOpenFilter} theme={theme} />
                        <ColumnFilterHeader label="Status" filterKey="status" value={fStatus} options={statusOptions} onChange={v => setFStatus(v)} isOpen={openFilter === "status"} onToggle={setOpenFilter} theme={theme} />
                        <ColumnFilterHeader label="Owner" filterKey="owner" value={fOwner} options={ownerOptions} onChange={v => setFOwner(v)} isOpen={openFilter === "owner"} onToggle={setOpenFilter} theme={theme} />
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Grid Offer Due</th>
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(p => {
                        const isSel = p.id === selectedId;
                        return (
                          <tr key={p.id} onClick={() => setSelectedId(p.id)}
                            style={{ borderBottom: `1px solid ${theme.borderSubtle || theme.border}`, cursor: "pointer",
                              background: isSel ? (ACCENT + "14") : "transparent", transition: "background 0.1s" }}>
                            <td style={{ padding: "10px 14px" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{p.name}</div>
                              {p.main_contact && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 1 }}>{p.main_contact}</div>}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{p.tech || <span style={{ color: theme.textTertiary }}>—</span>}</td>
                            <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: theme.textPrimary, textAlign: "right" }}>{fmtMwp(p.mwp)}</td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{p.dno || <span style={{ color: theme.textTertiary }}>—</span>}</td>
                            <td style={{ padding: "10px 14px" }}><StatusBadge status={p.status} /></td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{p.owner || <span style={{ color: theme.textTertiary }}>—</span>}</td>
                            <td style={{ padding: "10px 14px", fontSize: 11, whiteSpace: "nowrap" }}>
                              {(() => {
                                const est = gridOfferEstimate(p);
                                if (est) return (
                                  <div>
                                    <div style={{ color: theme.textPrimary, fontWeight: 600 }}>{fmtGridDate(est.expected)}</div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: gridCountdownColor(est.diffDays) }}>{gridCountdownLabel(est.diffDays)}</div>
                                  </div>
                                );
                                return <span style={{ color: theme.textTertiary }}>{p.status === "Grid App Submitted" ? "set date" : "—"}</span>;
                              })()}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>
                              {p.last_updated ? new Date(p.last_updated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {reviewOpen && (
        <div onClick={() => setReviewOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 720, maxWidth: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>
                Emails to review <span style={{ color: theme.textTertiary, fontWeight: 500 }}>· {reviewItems.length}</span>
              </div>
              <div onClick={() => setReviewOpen(false)} style={{ cursor: "pointer", fontSize: 16, color: theme.textTertiary }}>✕</div>
            </div>
            <div style={{ padding: "10px 14px 4px", fontSize: 11, color: theme.textTertiary }}>
              These emails matched a contact shared by multiple projects and the subject didn't name one. Assign each to the right project, or dismiss.
            </div>
            <div style={{ overflowY: "auto", padding: "8px 14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {reviewItems.length === 0 ? (
                <div style={{ fontSize: 12, color: theme.textTertiary, fontStyle: "italic", padding: "16px 0", textAlign: "center" }}>Nothing to review.</div>
              ) : reviewItems.map(item => (
                <div key={item.id} style={{ background: theme.cardBg, border: `1px solid ${theme.borderSubtle || theme.border}`, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT, background: ACCENT + "1a", border: `1px solid ${ACCENT}33`, padding: "1px 6px", borderRadius: 4 }}>
                      {item.direction === "outbound" ? "Gmail ↗" : "Gmail ↙"}
                    </span>
                    <span style={{ fontSize: 11, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.from_addr || "—"}</span>
                    <span style={{ fontSize: 10, color: theme.textTertiary, marginLeft: "auto", flexShrink: 0 }}>
                      {item.sent_at ? new Date(item.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary, marginBottom: 3 }}>{item.subject || "(no subject)"}</div>
                  <div style={{ fontSize: 11, color: theme.textSecondary, lineHeight: 1.45, marginBottom: 8, maxHeight: 54, overflow: "hidden" }}>
                    {(item.body || "").slice(0, 220)}{(item.body || "").length > 220 ? "…" : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select defaultValue="" id={`rv-${item.id}`}
                      style={{ flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "6px 9px", fontSize: 11, outline: "none", appearance: "none", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                      <option value="" disabled>Assign to project…</option>
                      {(item.candidate_project_ids || []).map(pid => (
                        <option key={pid} value={pid}>{projName(pid)}</option>
                      ))}
                    </select>
                    <button onClick={() => { const v = document.getElementById(`rv-${item.id}`).value; if (v) assignReview(item, v); }}
                      style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: ACCENT, border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                      Assign
                    </button>
                    <button onClick={() => dismissReview(item)}
                      style={{ fontSize: 11, fontWeight: 600, color: theme.textTertiary, background: "transparent", border: `1px solid ${theme.border}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete attachment confirmation */}
      {pendingDelete && (
        <div
          onClick={() => !deleting && setPendingDelete(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 400, maxWidth: "100%", background: theme.elevatedBg || theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder || theme.border}`, padding: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", fontFamily: "'Inter', system-ui, sans-serif" }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 8 }}>Delete attachment?</div>
            <div style={{ fontSize: 12.5, color: theme.textSecondary, lineHeight: 1.5, marginBottom: 20 }}>
              <span style={{ fontWeight: 600, color: theme.textPrimary }}>{pendingDelete.file_name || "This attachment"}</span> will be permanently removed. This can’t be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                style={{ fontSize: 12, fontWeight: 600, padding: "8px 14px", borderRadius: 6, cursor: deleting ? "default" : "pointer", background: "transparent", color: theme.textSecondary, border: `1px solid ${theme.border}`, fontFamily: "inherit" }}
              >Cancel</button>
              <button
                onClick={() => deleteFile(pendingDelete)}
                disabled={deleting}
                style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 6, cursor: deleting ? "default" : "pointer", background: "#ef4444", color: "#fff", border: "none", fontFamily: "inherit", opacity: deleting ? 0.6 : 1 }}
              >{deleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
