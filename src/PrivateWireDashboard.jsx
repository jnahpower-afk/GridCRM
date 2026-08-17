import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import PWProposalKanban from "./PWProposalKanban.jsx";
import NetworkMap from "./NetworkMap.jsx";
import { supabase } from "./supabase.js";

// ─── CHART HELPERS ──────────────────────────────────────────────────────────

const CHANNEL_COLORS = {
  Email: "#2563EB",
  LinkedIn: "#8B5CF6",
  Call: "#16A34A",
  WhatsApp: "#25D366",
  Meeting: "#F59E0B",
  Note: "#64748B",
};

const SECTOR_COLORS = [
  "#6366F1", "#2563EB", "#0EA5E9", "#14B8A6", "#22C55E",
  "#EAB308", "#F97316", "#EF4444", "#EC4899", "#8B5CF6",
  "#64748B", "#78716C",
];

// Distinct hues for per-person stacked charts (assigned by sorted-owner index).
// One colour per hue family — no two greens/blues — so adjacent series stay
// distinguishable (previously #16A34A and #22C55E were both green).
const OWNER_PALETTE = [
  "#2563EB", // blue
  "#F97316", // orange
  "#16A34A", // green
  "#8B5CF6", // purple
  "#DC2626", // red
  "#06B6D4", // cyan
  "#EC4899", // pink
  "#EAB308", // amber
];

// Data Centres team-output chart segments (mirrors the daily Slack report)
const DC_GROWTH_SEGMENTS = ["Substations", "Parcels", "Leads", "Surg req", "Surg done", "Touch pts"];
const DC_GROWTH_COLORS = {
  Substations: "#06B6D4", Parcels: "#84CC16", Leads: "#F59E0B",
  "Surg req": "#8B5CF6", "Surg done": "#6366F1", "Touch pts": "#EC4899",
};
// Touch point = substation-lead activity on these channels (matches the report)
const DC_TOUCH_CHANNELS = ["Email", "Call", "LinkedIn", "WhatsApp", "Meeting"];

function formatDaysInStage(stageEnteredAt) {
  if (!stageEnteredAt) return null;
  const days = Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

function getDurationColor(stageEnteredAt) {
  if (!stageEnteredAt) return null;
  const days = Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / 86400000);
  if (days < 7) return "#16A34A";   // green: under 1 week
  if (days < 14) return null;       // neutral: 1–2 weeks
  if (days < 21) return "#F97316";  // orange: 2–3 weeks
  return "#EF4444";                 // red: 3 weeks+
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTimeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return "yesterday";
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

function getDaysBetween(start, end) {
  const days = [];
  const d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ─── RESPONSIVE CONTAINER HOOK ─────────────────────────────────────────────

function useContainerSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize(prev => (prev.width === Math.round(width) && prev.height === Math.round(height)) ? prev : { width: Math.round(width), height: Math.round(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}

// ─── SVG BAR CHART ──────────────────────────────────────────────────────────

function StackedBarChart({ data, channels, width, height, theme, colorMap }) {
  const containerRef = useRef(null);
  // { index, mouseX, mouseY } in container-relative coords; null = no hover
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0 || width < 10) return null;

  const margin = { top: 24, right: 12, bottom: 32, left: 32 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const maxVal = Math.max(...data.map(d => channels.reduce((s, ch) => s + (d[ch] || 0), 0)), 1);
  const barW = Math.max(Math.min(chartW / data.length - 4, 36), 4);
  const gap = (chartW - barW * data.length) / (data.length + 1);

  const yTicks = [];
  const step = Math.max(1, Math.ceil(maxVal / 4));
  for (let i = 0; i <= maxVal; i += step) yTicks.push(i);
  if (yTicks[yTicks.length - 1] < maxVal) yTicks.push(maxVal);

  const colors = colorMap || CHANNEL_COLORS;

  const handleMove = (e, i) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ index: i, mouseX: e.clientX - rect.left, mouseY: e.clientY - rect.top });
  };

  // Build tooltip data + clamped position
  let tooltipNode = null;
  if (hover && data[hover.index]) {
    const d = data[hover.index];
    const segments = channels
      .map(ch => ({ name: ch, value: d[ch] || 0, color: colors[ch] || theme.accent }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = segments.reduce((s, x) => s + x.value, 0);
    const fullDate = new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
    });
    // Position: to the right of the cursor; flip left if it would overflow
    const TT_W = 180, TT_OFFSET = 14;
    const tipLeftRaw = hover.mouseX + TT_OFFSET;
    const flip = tipLeftRaw + TT_W > width - 4;
    const tipLeft = flip ? Math.max(4, hover.mouseX - TT_OFFSET - TT_W) : tipLeftRaw;
    const approxH = 36 + segments.length * 18 + 20;
    const tipTop = Math.min(Math.max(4, hover.mouseY - 20), Math.max(4, height - approxH - 4));

    tooltipNode = (
      <div style={{
        position: "absolute", left: tipLeft, top: tipTop, width: TT_W,
        background: theme.elevatedBg || theme.surfaceBg || theme.cardBg,
        border: `1px solid ${theme.border}`, borderRadius: 8,
        padding: "8px 10px", pointerEvents: "none", zIndex: 20,
        boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          {fullDate}
        </div>
        {segments.map(seg => (
          <div key={seg.name} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, padding: "2px 0", fontSize: 11 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: theme.textSecondary, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{seg.name}</span>
            </span>
            <span style={{ fontWeight: 700, color: theme.textPrimary, fontVariantNumeric: "tabular-nums" }}>
              {seg.value}
            </span>
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 5, paddingTop: 5,
          display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span style={{ color: theme.textTertiary, fontWeight: 600 }}>Total</span>
          <span style={{ fontWeight: 800, color: theme.textPrimary, fontVariantNumeric: "tabular-nums" }}>
            {total}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width, height }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {yTicks.map(t => {
          const y = margin.top + chartH - (t / maxVal) * chartH;
          return (
            <g key={t}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={theme.borderSubtle} strokeWidth={1} />
              <text x={margin.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill={theme.textMuted}>{t}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = margin.left + gap + i * (barW + gap);
          let y = margin.top + chartH;
          const bars = [];
          channels.forEach(ch => {
            const val = d[ch] || 0;
            if (val > 0) {
              const h = (val / maxVal) * chartH;
              y -= h;
              bars.push(
                <rect key={ch} x={x} y={y} width={barW} height={h} rx={2}
                  fill={colors[ch] || theme.accent}
                  opacity={hover == null || hover.index === i ? 0.9 : 0.35}
                  style={{ transition: "opacity 0.1s" }}
                />
              );
            }
          });
          const total = channels.reduce((s, ch) => s + (d[ch] || 0), 0);
          const showLabel = data.length <= 14 || i % Math.ceil(data.length / 7) === 0 || i === data.length - 1;
          // Hitbox spans the FULL column area (not just the bar) so the tooltip
          // triggers when hovering above a short bar too.
          const hitX = x - gap / 2;
          const hitW = barW + gap;
          return (
            <g key={d.date}
              onMouseEnter={(e) => handleMove(e, i)}
              onMouseMove={(e) => handleMove(e, i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={hitX} y={margin.top} width={hitW} height={chartH} fill="transparent" />
              {bars}
              {total > 0 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={9} fontWeight={700} fill={theme.textSecondary} style={{ pointerEvents: "none" }}>{total}</text>
              )}
              {showLabel && (
                <text x={x + barW / 2} y={margin.top + chartH + 14} textAnchor="middle" fontSize={8} fill={theme.textMuted} style={{ pointerEvents: "none" }}>
                  {formatDateShort(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tooltipNode}
    </div>
  );
}

// ─── SVG AREA CHART ─────────────────────────────────────────────────────────

function AreaChart({ data, lineKey, width, height, color, theme, label, barKey, barColor }) {
  if (!data || data.length < 2 || width < 10) return null;

  const margin = { top: 8, right: 12, bottom: 32, left: 32 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const vals = data.map(d => d[lineKey] || 0);
  const maxVal = Math.max(...vals, 1);

  const barVals = barKey ? data.map(d => d[barKey] || 0) : [];
  const barMax = barKey ? Math.max(...barVals, 1) : 1;

  const points = data.map((d, i) => ({
    x: margin.left + (i / (data.length - 1)) * chartW,
    y: margin.top + chartH - ((d[lineKey] || 0) / maxVal) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = linePath + ` L ${points[points.length - 1].x} ${margin.top + chartH} L ${points[0].x} ${margin.top + chartH} Z`;

  const yTicks = [];
  const step = Math.max(1, Math.ceil(maxVal / 4));
  for (let i = 0; i <= maxVal; i += step) yTicks.push(i);

  const bw = barKey ? Math.max(Math.min(chartW / data.length - 1, 6), 1) : 0;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {yTicks.map(t => {
        const y = margin.top + chartH - (t / maxVal) * chartH;
        return (
          <g key={t}>
            <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={theme.borderSubtle} strokeWidth={1} />
            <text x={margin.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill={theme.textMuted}>{t}</text>
          </g>
        );
      })}

      {barKey && data.map((d, i) => {
        const val = d[barKey] || 0;
        if (val === 0) return null;
        const bh = (val / barMax) * (chartH * 0.4);
        const bx = margin.left + (i / (data.length - 1)) * chartW - bw / 2;
        const by = margin.top + chartH - bh;
        return <rect key={i} x={bx} y={by} width={bw} height={bh} rx={1} fill={barColor || color} opacity={0.35} />;
      })}

      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

      {data.length <= 60 && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={data.length <= 30 ? 3 : 2} fill={color} />
      ))}

      {data.map((d, i) => {
        const showLabel = data.length <= 14 || i % Math.ceil(data.length / 10) === 0 || i === data.length - 1;
        if (!showLabel) return null;
        return (
          <text key={i} x={margin.left + (i / (data.length - 1)) * chartW}
            y={margin.top + chartH + 14} textAnchor="middle" fontSize={8} fill={theme.textMuted}>
            {formatDate(d.date)}
          </text>
        );
      })}

      {label && (
        <text x={margin.left + 4} y={margin.top + 12} fontSize={9} fontWeight={600} fill={color}>{label}</text>
      )}
    </svg>
  );
}

// ─── SVG PIE CHART ──────────────────────────────────────────────────────────

function PieChart({ data, size, theme }) {
  if (!data || data.length === 0 || size < 10) return null;

  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 4;
  const ir = r * 0.55; // donut inner radius

  let startAngle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const angle = (d.count / total) * Math.PI * 2;
    const endAngle = startAngle + angle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + ir * Math.cos(endAngle);
    const iy1 = cy + ir * Math.sin(endAngle);
    const ix2 = cx + ir * Math.cos(startAngle);
    const iy2 = cy + ir * Math.sin(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const path = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      "Z",
    ].join(" ");

    const midAngle = startAngle + angle / 2;
    startAngle = endAngle;

    return { ...d, path, midAngle, color: SECTOR_COLORS[i % SECTOR_COLORS.length], pct: Math.round((d.count / total) * 100) };
  });

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} opacity={0.8} stroke={theme.cardBg} strokeWidth={1.5} />
      ))}
      {/* Center total */}
      <text x={cx} y={cy - size * 0.02} textAnchor="middle" fontSize={Math.max(size * 0.09, 14)} fontWeight={800} fill={theme.textPrimary}>{total}</text>
      <text x={cx} y={cy + size * 0.07} textAnchor="middle" fontSize={Math.max(size * 0.045, 8)} fill={theme.textMuted}>leads</text>
    </svg>
  );
}

// ─── PIPELINE FUNNEL BAR ────────────────────────────────────────────────────

function PipelineFunnel({ stageCounts, stageColors, maxCount, theme }) {
  const visible = stageCounts.filter(s => s.count > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {visible.map(s => (
        <div key={s.stage} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 80, fontSize: 11, color: theme.textSecondary, fontWeight: 500, textAlign: "right", flexShrink: 0 }}>{STAGE_LABELS[s.stage] || s.stage}</div>
          <div style={{ flex: 1, height: 32, background: theme.pillBg, borderRadius: 6, overflow: "hidden", position: "relative" }}>
            <div style={{
              width: `${Math.max((s.count / maxCount) * 100, 0)}%`,
              height: "100%",
              background: stageColors[s.stage] || theme.accent,
              borderRadius: 6,
              transition: "width 0.4s ease",
            }} />
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "#fff" }}>
              {s.count}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── RESPONSIVE CHART WRAPPER ──────────────────────────────────────────────

function ChartBox({ children, aspectRatio, minHeight = 160, fillHeight = false }) {
  const [ref, { width, height }] = useContainerSize();
  const h = fillHeight ? Math.max(height, minHeight) : aspectRatio > 0 ? Math.max(width * aspectRatio, minHeight) : (minHeight || width);
  return (
    <div ref={ref} style={{ width: "100%", height: fillHeight ? "100%" : undefined }}>
      {width > 0 && children(width, h)}
    </div>
  );
}

// ─── WIDGET REGISTRY ──────────────────────────────────────────────────────────
const WIDGET_DEFS_PW = [
  { id: "pw-kpis",     title: "Key Metrics",         color: "#FC6A0A", default: { x: 0, y: 0,  w: 12, h: 2  } },
  { id: "pw-pipeline", title: "Pipeline Breakdown",   color: "#6366F1", default: { x: 0, y: 2,  w: 12, h: 6  } },
  { id: "pw-outreach", title: "Outreach Activity",    color: "#16A34A", default: { x: 0, y: 8,  w: 12, h: 5  } },
  { id: "pw-leadVol",  title: "Daily · Last 30 Days", color: "#3B82F6", default: { x: 0, y: 13, w: 12, h: 5  } },
  { id: "pw-team",     title: "Team Outreach",        color: "#EC4899", default: { x: 0, y: 18, w: 6,  h: 7  } },
  { id: "pw-activity", title: "Team Activity",        color: "#F59E0B", default: { x: 6, y: 18, w: 6,  h: 7  } },
  { id: "pw-kanban",   title: "Proposal Pipeline",    color: "#FC6A0A", default: { x: 0, y: 25, w: 12, h: 9  } },
];
// Data Centres dashboard — the standard team layout: Network Map, DC Metrics and
// Assets Added across the top; Key Metrics + Daily below; Proposal Pipeline last.
// Outreach / Pipeline / Team / Activity are hidden by default (restorable via
// Edit Layout). Bump DC_LAYOUT_VERSION when changing this so every user adopts it.
const WIDGET_DEFS_DC = [
  { id: "dc-map",      title: "Network Map",             color: "#FC6A0A", default: { x: 0, y: 0,  w: 4,  h: 3 } },
  { id: "dc-kpis",     title: "Data Centre Metrics",     color: "#06B6D4", default: { x: 4, y: 0,  w: 1,  h: 3 } },
  { id: "dc-growth",   title: "Team Output · Last 30 Days", color: "#84CC16", default: { x: 5, y: 0,  w: 7,  h: 3 } },
  { id: "pw-kpis",     title: "Key Metrics",             color: "#FC6A0A", default: { x: 0, y: 3,  w: 1,  h: 3 } },
  { id: "pw-leadVol",  title: "Daily · Last 30 Days",    color: "#3B82F6", default: { x: 1, y: 3,  w: 11, h: 3 } },
  { id: "pw-kanban",   title: "Proposal Pipeline",       color: "#FC6A0A", default: { x: 0, y: 6,  w: 12, h: 4 } },
  { id: "dc-surgeries", title: "Grid Surgeries",         color: "#A855F7", default: { x: 0, y: 10, w: 6,  h: 5 } },
  // Hidden by default — kept in the registry so they can be restored.
  { id: "pw-outreach", title: "Outreach Activity",       color: "#16A34A", default: { x: 0, y: 10, w: 12, h: 5 } },
  { id: "pw-pipeline", title: "Pipeline Breakdown",      color: "#6366F1", default: { x: 0, y: 15, w: 12, h: 6 } },
  { id: "pw-team",     title: "Team Outreach",           color: "#EC4899", default: { x: 0, y: 21, w: 6,  h: 7 } },
  { id: "pw-activity", title: "Team Activity",           color: "#F59E0B", default: { x: 6, y: 21, w: 6,  h: 7 } },
];
// Widgets hidden by default on the DC dashboard.
const DC_DEFAULT_REMOVED = ["pw-outreach", "pw-pipeline", "pw-team", "pw-activity"];
// Version suffix for the DC layout keys — bump to force all users onto a new default.
const DC_LAYOUT_VERSION = "v2";
const PW_ROW_H = 60;

function loadLS(key, fallback) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

// ─── WIDGET SHELL ──────────────────────────────────────────────────────────────
function DashboardWidget({ id, title, color, editMode, onRemove, children, theme, headerRight }) {
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: theme.cardBg,
      border: editMode ? `2px dashed ${theme.accent}` : `1px solid ${theme.cardBorder || theme.border}`,
      borderRadius: 12, overflow: "hidden", boxSizing: "border-box",
      transition: "border 0.15s",
    }}>
      <div
        className={editMode ? "widget-drag-handle" : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "9px 12px 8px",
          borderBottom: `1px solid ${theme.borderSubtle || theme.border}`,
          flexShrink: 0, cursor: editMode ? "grab" : "default", userSelect: "none",
        }}
      >
        <div style={{ width: 3, height: 14, background: color, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary, flex: 1 }}>{title}</span>
        {!editMode && headerRight}
        {editMode && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: "auto" }}>
              {[0,1,2].map(i => <div key={i} style={{ width: 10, height: 1.5, background: theme.textTertiary, borderRadius: 1, opacity: 0.4 }} />)}
            </div>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onRemove(id); }}
              title="Remove widget"
              style={{
                width: 18, height: 18, borderRadius: 4, border: `1px solid ${theme.border}`,
                background: theme.pillBg, color: theme.textTertiary, fontSize: 14, lineHeight: 1,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginLeft: 4, fontFamily: "inherit",
              }}
            >×</button>
          </>
        )}
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD COMPONENT ───────────────────────────────────────────────

const STAGE_COLORS_FUSE = { New: "#6366F1", Contacted: "#2563EB", "Meeting Booked": "#FFB162", Proposal: "#FC6A0A", Negotiation: "#15803D", Won: "#4ADE80", Lost: "#EF4444" };
const STAGE_COLORS_LINEAR = { New: "#818CF8", Contacted: "#60A5FA", "Meeting Booked": "#FBBF24", Proposal: "#FB923C", Negotiation: "#16A34A", Won: "#4ADE80", Lost: "#F87171" };
const STAGES = ["New", "Contacted", "Meeting Booked", "Proposal", "Negotiation", "Won", "Lost"];
const STAGE_LABELS = { New: "New Target" }; // display overrides

export default function PrivateWireDashboard({ leads: leadsRaw, theme, hideTeamSections = false, onOrgClick, campaignScope = null, onOpenNetworkMap = null }) {
  const [range, setRange] = useState(7);
  const [outreachView, setOutreachView] = useState("person"); // "person" | "sector"
  const [campaignState, setCampaign] = useState("All"); // "All" | "PW" | "DC" — scopes the whole dashboard
  // When the dashboard is embedded in a campaign-locked section (e.g. Data
  // Centres), campaignScope wins and the in-dashboard switcher is hidden.
  const scoped = campaignScope === "PW" || campaignScope === "DC";
  const campaign = campaignScope || campaignState;

  // Scope every downstream calc (KPIs, charts, funnel, kanban) to the chosen
  // campaign. Legacy rows with no campaign default to PW.
  const leads = useMemo(
    () => campaign === "All" ? leadsRaw : leadsRaw.filter(l => (l.campaign || "PW") === campaign),
    [leadsRaw, campaign],
  );
  const campaignTotals = useMemo(() => {
    let pw = 0, dc = 0;
    for (const l of leadsRaw) ((l.campaign || "PW") === "DC" ? (dc++) : (pw++));
    return { All: leadsRaw.length, PW: pw, DC: dc };
  }, [leadsRaw]);

  // ─── LAYOUT STATE ────────────────────────────────────────────────────────
  // The Data Centres dashboard has its own widget set (map + DC KPIs/growth) and
  // its own persisted layout so it never collides with the Private Wire one.
  const isDC = campaignScope === "DC";
  const WIDGET_DEFS   = isDC ? WIDGET_DEFS_DC : WIDGET_DEFS_PW;
  const LAYOUT_KEY    = isDC ? `dc-layout-${DC_LAYOUT_VERSION}`  : "pw-layout-v1";
  const REMOVED_KEY   = isDC ? `dc-removed-${DC_LAYOUT_VERSION}` : "pw-removed-v1";
  const DEFAULT_LAYOUT  = useMemo(() => WIDGET_DEFS.map(w => ({ i: w.id, ...w.default })), [WIDGET_DEFS]);
  const DEFAULT_REMOVED = isDC ? DC_DEFAULT_REMOVED : [];

  const [editMode, setEditMode]           = useState(false);
  const [layout, setLayout]               = useState(() => {
    // Load the saved layout, then append any registry widgets it doesn't have yet
    // (e.g. cards added after the user's layout was saved) at their default spot —
    // so new widgets appear without wiping personal arrangements.
    const saved = loadLS(LAYOUT_KEY, DEFAULT_LAYOUT);
    const have = new Set(saved.map(l => l.i));
    const missing = DEFAULT_LAYOUT.filter(l => !have.has(l.i));
    return missing.length ? [...saved, ...missing] : saved;
  });
  const [removedWidgets, setRemovedWidgets] = useState(() => loadLS(REMOVED_KEY, DEFAULT_REMOVED));
  const [gridWidth, setGridWidth]         = useState(800);
  const gridRef = useRef(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setGridWidth(Math.floor(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeLayout = useMemo(
    () => layout.filter(l => !removedWidgets.includes(l.i)),
    [layout, removedWidgets]
  );

  // ─── DC ASSET DATA (Data Centres dashboard only) ─────────────────────────
  const [dcFeatures, setDcFeatures] = useState([]);
  const [dcSubLeads, setDcSubLeads] = useState([]);
  const [dcSurgeries, setDcSurgeries] = useState([]);
  const [dcLeadActivity, setDcLeadActivity] = useState([]);
  const [dcProfiles, setDcProfiles] = useState([]);
  const [dcGrowthView, setDcGrowthView] = useState("person"); // "person" | "type"
  const [dcShowTouches, setDcShowTouches] = useState(true);    // include touch points in output
  useEffect(() => {
    if (!isDC) return;
    let cancelled = false;
    (async () => {
      const [f, l, s, a, p] = await Promise.all([
        supabase.from("dc_network_features").select("id, type, substation_id, capacity_mw, created_by, created_at, name, dno, lat, lng"),
        supabase.from("dc_substation_leads").select("id, created_by, created_at"),
        supabase.from("dc_grid_surgeries").select("id, substation_id, dno, status, requested_at, held_at, created_by, notes"),
        supabase.from("dc_substation_lead_activity").select("created_by, channel, created_at"),
        supabase.from("profiles").select("id, full_name, email"),
      ]);
      if (cancelled) return;
      setDcFeatures(f.data || []);
      setDcSubLeads(l.data || []);
      setDcSurgeries(s.data || []);
      setDcLeadActivity(a.data || []);
      setDcProfiles(p.data || []);
    })();
    return () => { cancelled = true; };
  }, [isDC]);
  const dcNameOf = useCallback((id) => {
    const p = dcProfiles.find(x => x.id === id);
    return p ? (p.full_name || p.email || "Unknown") : "Unassigned";
  }, [dcProfiles]);
  const isSubstation = (f) => !f.substation_id && (f.type || "").startsWith("substation");
  const isParcel = (f) => f.substation_id != null;

  function removeWidget(id) {
    const next = [...removedWidgets, id];
    setRemovedWidgets(next);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(next));
  }

  function addWidget(id) {
    const def = WIDGET_DEFS.find(w => w.id === id);
    if (!def) return;
    const nextRemoved = removedWidgets.filter(r => r !== id);
    setRemovedWidgets(nextRemoved);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(nextRemoved));
    if (!layout.find(l => l.i === id)) {
      const nextLayout = [...layout, { i: id, ...def.default }];
      setLayout(nextLayout);
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(nextLayout));
    }
  }

  function resetLayout() {
    setLayout(DEFAULT_LAYOUT);
    setRemovedWidgets(DEFAULT_REMOVED);
    localStorage.removeItem(LAYOUT_KEY);
    localStorage.setItem(REMOVED_KEY, JSON.stringify(DEFAULT_REMOVED));
  }

  const stageColors = theme.name === "linear" ? STAGE_COLORS_LINEAR : STAGE_COLORS_FUSE;

    const _now = new Date();
  const todayDate = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
  const _yest = new Date(Date.now() - 86400000);
  const yesterdayDate = `${_yest.getFullYear()}-${String(_yest.getMonth()+1).padStart(2,"0")}-${String(_yest.getDate()).padStart(2,"0")}`;

  const rangeStartDate = useMemo(() => {
    if (range === "today") return todayDate;
    if (range === "all") return "2020-01-01";
    const d = new Date();
    d.setDate(d.getDate() - range + 1);
    return d.toISOString().slice(0, 10);
  }, [range, todayDate]);

  const allLeads = leads;
  const allActivities = allLeads.flatMap(l => (l.activityLog || []).map(a => ({ ...a, leadName: l.name, leadSector: l.sector, leadOwner: l.owner })));

  // Outreach = outbound touches only — inbound responses are not counted as reach-outs
  const rangeActivities = allActivities.filter(a => a.date >= rangeStartDate && a.date <= todayDate && a.direction !== "Inbound");
  const days = getDaysBetween(rangeStartDate, todayDate);

  // Yesterday's equivalents for deltas (only meaningful when range === "today")
  const yActivities = allActivities.filter(a => a.date === yesterdayDate);
  const yNewLeads = allLeads.filter(l => l.created_at && l.created_at.slice(0, 10) === yesterdayDate).length;

  const channels = Object.keys(CHANNEL_COLORS);

  // ─── OUTREACH TIME SERIES (from 6 Apr 2026) ──────────────────────────────
  const OUTREACH_START = "2026-04-06";
  const outreachDays = getDaysBetween(OUTREACH_START, todayDate);
  const outreachTimeSeries = useMemo(() => {
    return outreachDays.map(date => {
      // Outbound only — matches KPI definition
      const dayActs = allActivities.filter(a => (a.date || "").slice(0, 10) === date && a.direction === "Outbound");
      const row = { date };
      channels.forEach(ch => { row[ch] = dayActs.filter(a => a.channel === ch).length; });
      return row;
    });
  }, [allActivities, outreachDays.join(",")]);

  // ─── CUMULATIVE LEADS OVER TIME ──────────────────────────────────────────
  const cumulativeLeads = useMemo(() => {
    const dated = allLeads.filter(l => l.created_at).map(l => l.created_at.slice(0, 10)).sort();
    const undatedCount = allLeads.filter(l => !l.created_at).length;
    if (dated.length === 0 && undatedCount === 0) return [];
    const earliest = dated.length > 0 ? dated[0] : todayDate;
    const growthDays = getDaysBetween(earliest, todayDate);
    const newPerDay = {};
    dated.forEach(d => { newPerDay[d] = (newPerDay[d] || 0) + 1; });
    // Place undated leads on the earliest day so totals match
    newPerDay[earliest] = (newPerDay[earliest] || 0) + undatedCount;
    let running = 0;
    const result = growthDays.map(date => {
      running += newPerDay[date] || 0;
      return { date, count: running, newCount: newPerDay[date] || 0 };
    });
    // Ensure final count matches actual lead count (in case some created_at are null/missing)
    const totalLeads = allLeads.length;
    if (result.length > 0 && result[result.length - 1].count < totalLeads) {
      const gap = totalLeads - result[result.length - 1].count;
      result[result.length - 1].count = totalLeads;
      result[result.length - 1].newCount += gap;
    }
    return result;
  }, [allLeads, todayDate]);

  // ─── KPIs ────────────────────────────────────────────────────────────────
  const totalTouches = rangeActivities.length;
  const totalResponses = rangeActivities.filter(a => a.response).length;
  const responseRate = totalTouches > 0 ? Math.round((totalResponses / totalTouches) * 100) : 0;
  const avgDailyTouches = days.length > 0 ? (totalTouches / days.length).toFixed(1) : 0;
  const newLeadsInRange = allLeads.filter(l => l.created_at && l.created_at.slice(0, 10) >= rangeStartDate).length;
  const activeSectors = [...new Set(leads.filter(l => (l.activityLog || []).length > 0).map(l => l.sector))].length;

  // ─── PIPELINE ────────────────────────────────────────────────────────────
  const stageCounts = STAGES.map(s => ({
    stage: s, count: leads.filter(l => l.stage === s).length,
  }));
  const maxStageCount = Math.max(...stageCounts.map(s => s.count), 1);

  // ─── 24H ACTIVITY FEED ───────────────────────────────────────────────────
  const last24h = useMemo(() => new Date(Date.now() - 86400000).toISOString(), []);

  const activityFeed = useMemo(() => {
    const events = [];

    // New leads added in last 24h
    leads.filter(l => l.created_at && l.created_at >= last24h).forEach(l => {
      events.push({ type: "new_lead", time: l.created_at, label: l.name, sub: l.sector || "—", owner: l.owner });
    });

    // Stage changes in last 24h (updated but not newly created)
    leads.filter(l => l.updated_at && l.updated_at >= last24h && (!l.created_at || l.created_at < last24h)).forEach(l => {
      events.push({ type: "stage_change", time: l.updated_at, label: l.name, sub: l.stage, owner: l.owner });
    });

    // Activity log entries from today
    allActivities.filter(a => (a.date || "").slice(0, 10) === todayDate).forEach(a => {
      events.push({
        type: "activity",
        time: todayDate + "T12:00:00Z",
        label: a.leadName,
        sub: `${a.channel}${a.response ? " · response" : ""}`,
        owner: a.leadOwner,
      });
    });

    return events.sort((a, b) => b.time.localeCompare(a.time));
  }, [leads, allActivities, last24h, todayDate]);

  // ─── TEAM SUMMARY ────────────────────────────────────────────────────────
  const teamStats = useMemo(() => {
    const owners = [...new Set(allLeads.map(l => l.owner).filter(Boolean))].sort();
    return owners.map(owner => {
      const ownerLeads = leads.filter(l => l.owner === owner);
      const ownerActivities = rangeActivities.filter(a => a.leadOwner === owner);
      const responses = ownerActivities.filter(a => a.response).length;
      return {
        name: owner,
        initials: owner.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
        leads: ownerLeads.length,
        email: ownerActivities.filter(a => a.channel === "Email").length,
        call: ownerActivities.filter(a => a.channel === "Call").length,
        linkedin: ownerActivities.filter(a => a.channel === "LinkedIn").length,
        responses,
        rate: ownerActivities.length > 0 ? Math.round((responses / ownerActivities.length) * 100) : 0,
      };
    });
  }, [leads, rangeActivities, allLeads]);

  // ─── LEAD VOLUME TIME SERIES (last 30 days, stacked by owner) ───────────
  const thirtyDaysAgoDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  }, []);
  const last30Days = useMemo(() => getDaysBetween(thirtyDaysAgoDate, todayDate), [thirtyDaysAgoDate, todayDate]);
  const ownerNames = useMemo(() => [...new Set(allLeads.map(l => l.owner).filter(Boolean))].sort(), [allLeads]);
  const ownerColorMap = useMemo(() => {
    const map = { Unassigned: "#94A3B8" };
    ownerNames.forEach((name, i) => { map[name] = OWNER_PALETTE[i % OWNER_PALETTE.length]; });
    return map;
  }, [ownerNames]);
  const leadVolumeSeries = useMemo(() => {
    return last30Days.map(date => {
      const dayActs = allActivities.filter(a => (a.date || "").slice(0, 10) === date && a.direction === "Outbound");
      const row = { date };
      ownerNames.forEach(owner => { row[owner] = dayActs.filter(a => a.leadOwner === owner).length; });
      row["Unassigned"] = dayActs.filter(a => !a.leadOwner).length;
      return row;
    });
  }, [allActivities, last30Days, ownerNames]);
  const hasUnassignedLeads = useMemo(() => leadVolumeSeries.some(d => (d.Unassigned || 0) > 0), [leadVolumeSeries]);
  const ownerSegments = useMemo(() => [...ownerNames, ...(hasUnassignedLeads ? ["Unassigned"] : [])], [ownerNames, hasUnassignedLeads]);

  // ─── DC TEAM OUTPUT (last 30 days) ───────────────────────────────────────
  // Mirrors the daily Slack report: substations, parcels, leads, surgeries
  // requested, surgeries held, and touch points (channel activity).
  const isTouch = useCallback(a => DC_TOUCH_CHANNELS.includes(a.channel), []);

  // "By type": one stacked segment per activity category.
  const dcGrowthByType = useMemo(() => {
    const sub = {}, par = {}, led = {}, sReq = {}, sDone = {}, tp = {};
    const add = (map, d) => { if (d) map[d] = (map[d] || 0) + 1; };
    dcFeatures.forEach(f => {
      const d = (f.created_at || "").slice(0, 10);
      if (isSubstation(f)) add(sub, d);
      else if (isParcel(f)) add(par, d);
    });
    dcSubLeads.forEach(l => add(led, (l.created_at || "").slice(0, 10)));
    dcSurgeries.forEach(s => {
      add(sReq, (s.requested_at || "").slice(0, 10));
      if (s.status === "held") add(sDone, (s.held_at || "").slice(0, 10));
    });
    if (dcShowTouches) dcLeadActivity.forEach(a => { if (isTouch(a)) add(tp, (a.created_at || "").slice(0, 10)); });
    return last30Days.map(date => ({
      date, Substations: sub[date] || 0, Parcels: par[date] || 0, Leads: led[date] || 0,
      "Surg req": sReq[date] || 0, "Surg done": sDone[date] || 0, "Touch pts": tp[date] || 0,
    }));
  }, [dcFeatures, dcSubLeads, dcSurgeries, dcLeadActivity, dcShowTouches, isTouch, last30Days]);

  // "By person": stacked by whoever logged each unit of output.
  const dcGrowthPeople = useMemo(() => {
    const names = new Set();
    dcFeatures.forEach(f => { if (isSubstation(f) || isParcel(f)) names.add(dcNameOf(f.created_by)); });
    dcSubLeads.forEach(l => names.add(dcNameOf(l.created_by)));
    dcSurgeries.forEach(s => names.add(dcNameOf(s.created_by)));
    if (dcShowTouches) dcLeadActivity.forEach(a => { if (isTouch(a)) names.add(dcNameOf(a.created_by)); });
    return [...names].sort();
  }, [dcFeatures, dcSubLeads, dcSurgeries, dcLeadActivity, dcShowTouches, isTouch, dcNameOf]);
  const dcPeopleColorMap = useMemo(() => {
    const map = { Unassigned: "#94A3B8" };
    dcGrowthPeople.forEach((name, i) => { if (!map[name]) map[name] = OWNER_PALETTE[i % OWNER_PALETTE.length]; });
    return map;
  }, [dcGrowthPeople]);
  const dcGrowthByPerson = useMemo(() => {
    const per = {}; // date -> { name: count }
    const bump = (date, name) => { if (!date) return; (per[date] = per[date] || {})[name] = (per[date][name] || 0) + 1; };
    dcFeatures.forEach(f => { if (isSubstation(f) || isParcel(f)) bump((f.created_at || "").slice(0, 10), dcNameOf(f.created_by)); });
    dcSubLeads.forEach(l => bump((l.created_at || "").slice(0, 10), dcNameOf(l.created_by)));
    dcSurgeries.forEach(s => {
      bump((s.requested_at || "").slice(0, 10), dcNameOf(s.created_by));
      if (s.status === "held") bump((s.held_at || "").slice(0, 10), dcNameOf(s.created_by));
    });
    if (dcShowTouches) dcLeadActivity.forEach(a => { if (isTouch(a)) bump((a.created_at || "").slice(0, 10), dcNameOf(a.created_by)); });
    return last30Days.map(date => ({ date, ...(per[date] || {}) }));
  }, [dcFeatures, dcSubLeads, dcSurgeries, dcLeadActivity, dcShowTouches, isTouch, last30Days, dcNameOf]);

  const dcGrowthByPerson_active = dcGrowthView === "person";
  const dcTypeSegments = dcShowTouches ? DC_GROWTH_SEGMENTS : DC_GROWTH_SEGMENTS.filter(s => s !== "Touch pts");
  const dcGrowthData     = dcGrowthByPerson_active ? dcGrowthByPerson : dcGrowthByType;
  const dcGrowthSegments = dcGrowthByPerson_active ? dcGrowthPeople : dcTypeSegments;
  const dcGrowthColors   = dcGrowthByPerson_active ? dcPeopleColorMap : DC_GROWTH_COLORS;

  // ─── DC KEY METRICS ──────────────────────────────────────────────────────
  const dcMetrics = useMemo(() => {
    const subs = dcFeatures.filter(isSubstation);
    const inTarget = subs.filter(f => { const c = Number(f.capacity_mw); return c >= 3 && c <= 10; }).length;
    const parcels = dcFeatures.filter(isParcel).length;
    const surgeriesDone = dcSurgeries.filter(s => s.status === "held").length;
    return { subs: subs.length, inTarget, parcels, leads: dcSubLeads.length, surgeries: dcSurgeries.length, surgeriesDone };
  }, [dcFeatures, dcSubLeads, dcSurgeries]);

  // ─── GRID SURGERIES LIST ─────────────────────────────────────────────────
  const dcSurgeryList = useMemo(() => {
    const subById = new Map(dcFeatures.map(f => [f.id, f]));
    return dcSurgeries
      .map(s => {
        const sub = subById.get(s.substation_id);
        return {
          id: s.id,
          sub,
          subName: sub?.name || "Unknown substation",
          dno: s.dno || sub?.dno || "—",
          done: s.status === "held",
          requested_at: s.requested_at || null,
          held_at: s.held_at || null,
          person: dcNameOf(s.created_by),
        };
      })
      // Open (requested) first, then most recent by date
      .sort((a, b) => (a.done === b.done ? String(b.requested_at || "").localeCompare(String(a.requested_at || "")) : a.done ? 1 : -1));
  }, [dcSurgeries, dcFeatures, dcNameOf]);

  // ─── CHANNEL BREAKDOWN ───────────────────────────────────────────────────
  const channelStats = channels.map(ch => ({
    channel: ch,
    count: rangeActivities.filter(a => a.channel === ch).length,
    responses: rangeActivities.filter(a => a.channel === ch && a.response).length,
    color: CHANNEL_COLORS[ch],
  })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);

  // ─── SECTOR OUTREACH ─────────────────────────────────────────────────────
  const sectorOutreach = useMemo(() => {
    const sectors = [...new Set(leads.map(l => l.sector).filter(Boolean))].sort();
    return sectors.map(sector => {
      const acts = rangeActivities.filter(a => a.leadSector === sector);
      return {
        sector,
        email: acts.filter(a => a.channel === "Email").length,
        call: acts.filter(a => a.channel === "Call").length,
        linkedin: acts.filter(a => a.channel === "LinkedIn").length,
      };
    }).filter(s => s.email + s.call + s.linkedin > 0)
      .sort((a, b) => (b.email + b.call + b.linkedin) - (a.email + a.call + a.linkedin));
  }, [leads, rangeActivities]);

  // ─── RENDER ──────────────────────────────────────────────────────────────

  // Team toggle (used as headerRight for the pw-team widget)
  const teamToggle = (
    <div onMouseDown={e => e.stopPropagation()}
      style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 6, padding: 2, gap: 2 }}>
      {[["person", "Person"], ["sector", "Sector"]].map(([val, label]) => (
        <button key={val} onClick={() => setOutreachView(val)} style={{
          fontSize: 9, fontWeight: outreachView === val ? 700 : 500, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
          color: outreachView === val ? theme.pillActiveText : theme.pillInactiveText,
          background: outreachView === val ? theme.pillActiveBg : "transparent",
          border: "none",
        }}>{label}</button>
      ))}
    </div>
  );

  // Team-output toggles (headerRight for the dc-growth widget)
  const dcGrowthToggle = (
    <div onMouseDown={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={() => setDcShowTouches(v => !v)}
        title={dcShowTouches ? "Touch points included — click to hide" : "Touch points hidden — click to include"}
        style={{
          fontSize: 9, fontWeight: dcShowTouches ? 700 : 500, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
          color: dcShowTouches ? theme.pillActiveText : theme.pillInactiveText,
          background: dcShowTouches ? theme.pillActiveBg : theme.pillBg,
          border: `1px solid ${theme.pillBorder}`,
        }}
      >{dcShowTouches ? "✓ Touch pts" : "Touch pts"}</button>
      <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 6, padding: 2, gap: 2 }}>
        {[["person", "By person"], ["type", "By type"]].map(([val, label]) => (
          <button key={val} onClick={() => setDcGrowthView(val)} style={{
            fontSize: 9, fontWeight: dcGrowthView === val ? 700 : 500, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
            color: dcGrowthView === val ? theme.pillActiveText : theme.pillInactiveText,
            background: dcGrowthView === val ? theme.pillActiveBg : "transparent",
            border: "none",
          }}>{label}</button>
        ))}
      </div>
    </div>
  );

  function widgetContent(id) {
    switch (id) {
      case "pw-kpis": return (
        <div style={{ padding: "12px 14px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
            {[
              { label: "Total Leads", value: leads.length, sub: `${leads.filter(l => !["Won", "Lost"].includes(l.stage)).length} active` },
              { label: "Outreach", value: totalTouches, color: theme.success, sub: range === "today" ? "Today" : range === "all" ? "All Time" : `${days.length} Days`, delta: range === "today" ? totalTouches - yActivities.length : null },
              { label: "Industries Reached", value: activeSectors, color: theme.accent, sub: "Sectors with outreach" },
            ].map((kpi, i) => {
              const deltaPos = kpi.delta > 0;
              return (
                <div key={i}>
                  <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 5 }}>{kpi.label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color || theme.textPrimary, letterSpacing: "-0.02em" }}>{kpi.value}</div>
                    {kpi.delta != null && kpi.delta !== 0 && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: deltaPos ? theme.success : theme.danger || "#EF4444" }}>
                        {deltaPos ? "+" : ""}{kpi.delta}
                      </div>
                    )}
                  </div>
                  {kpi.sub && <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>{kpi.sub}</div>}
                </div>
              );
            })}
          </div>
        </div>
      );

      case "pw-pipeline": return (
        <div style={{ padding: 14, height: "100%", boxSizing: "border-box", overflow: "auto" }}>
          <PipelineFunnel stageCounts={stageCounts} stageColors={stageColors} maxCount={maxStageCount} theme={theme} />
          {(() => {
            const keyLeads = leads
              .filter(l => ["Meeting Booked", "Proposal", "Negotiation"].includes(l.stage))
              .sort((a, b) => {
                const order = { Negotiation: 0, Proposal: 1, "Meeting Booked": 2 };
                return (order[a.stage] ?? 99) - (order[b.stage] ?? 99);
              });
            if (keyLeads.length === 0) return null;
            return (
              <div style={{ marginTop: 20, borderTop: `1px solid ${theme.borderSubtle}`, paddingTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Active Opportunities</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Organisation", "Sector", "Stage"].map(h => (
                        <th key={h} style={{ padding: "4px 6px", fontSize: 9, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", borderBottom: `1px solid ${theme.borderSubtle}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {keyLeads.map((l, i) => {
                      const c = stageColors[l.stage] || theme.accent;
                      return (
                        <tr key={l.id} style={{ borderBottom: i < keyLeads.length - 1 ? `1px solid ${theme.borderSubtle}` : "none" }}>
                          <td style={{ padding: "6px 6px", fontSize: 11, fontWeight: 600, color: theme.textPrimary }}>{l.name}</td>
                          <td style={{ padding: "6px 6px", fontSize: 11, color: theme.textMuted }}>{l.sector || "—"}</td>
                          <td style={{ padding: "6px 6px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: c, background: `${c}18`, padding: "2px 7px", borderRadius: 4 }}>{STAGE_LABELS[l.stage] || l.stage}</span>
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
              </div>
            );
          })()}
        </div>
      );

      case "pw-outreach": return (
        <div style={{ padding: "8px 14px 14px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: theme.textMuted }}>Daily reach-outs from 6 Apr 2026</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginLeft: "auto" }}>
              {channels.map(ch => (
                <span key={ch} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: theme.textMuted }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: CHANNEL_COLORS[ch] }} />
                  {ch}
                </span>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChartBox fillHeight>
              {(w, h) => <StackedBarChart data={outreachTimeSeries} channels={channels} width={w} height={h} theme={theme} />}
            </ChartBox>
          </div>
        </div>
      );

      case "pw-leadVol": return (
        <div style={{ padding: "8px 14px 14px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: theme.textMuted }}>Stacked by owner. Each unit = one outbound touch on that date.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginLeft: "auto" }}>
              {ownerSegments.map(name => (
                <span key={name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: theme.textMuted }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: ownerColorMap[name] }} />
                  {name}
                </span>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChartBox fillHeight>
              {(w, h) => <StackedBarChart data={leadVolumeSeries} channels={ownerSegments} width={w} height={h} theme={theme} colorMap={ownerColorMap} />}
            </ChartBox>
          </div>
        </div>
      );

      case "pw-team": return (
        <div style={{ padding: 14, height: "100%", boxSizing: "border-box", overflow: "auto" }}>
          {(() => {
            const rows = outreachView === "person"
              ? teamStats.map(t => ({ key: t.name, label: t.name, initials: t.initials, leads: t.leads, email: t.email, call: t.call, linkedin: t.linkedin }))
              : sectorOutreach.map(s => ({ key: s.sector, label: s.sector, initials: s.sector.slice(0, 2).toUpperCase(), leads: null, email: s.email, call: s.call, linkedin: s.linkedin }));
            if (rows.length === 0) return <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic" }}>No outreach logged for this period</div>;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rows.map(r => (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: outreachView === "person" ? "50%" : 8, background: theme.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{r.initials}</span>
                    </div>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{r.label}</div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      {r.leads != null && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: theme.textPrimary, lineHeight: 1 }}>{r.leads}</div>
                          <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>leads</div>
                        </div>
                      )}
                      {[
                        { label: "Email", value: r.email, color: CHANNEL_COLORS.Email },
                        { label: "Call", value: r.call, color: CHANNEL_COLORS.Call },
                        { label: "LinkedIn", value: r.linkedin, color: CHANNEL_COLORS.LinkedIn },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ textAlign: "center", opacity: value === 0 ? 0.3 : 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                          <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      );

      case "pw-activity": return (
        <div style={{ padding: "8px 14px", height: "100%", boxSizing: "border-box", overflow: "auto" }}>
          <div style={{ fontSize: 10, color: theme.textMuted, fontWeight: 500, marginBottom: 10 }}>Last 24 hours</div>
          {activityFeed.length === 0 ? (
            <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic" }}>No activity in the last 24 hours</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {activityFeed.map((ev, i) => {
                const dotColor = ev.type === "new_lead" ? theme.success : ev.type === "stage_change" ? theme.accent : (CHANNEL_COLORS[ev.sub?.split(" ·")[0]] || theme.textMuted);
                const typeLabel = ev.type === "new_lead" ? "New lead" : ev.type === "stage_change" ? `→ ${ev.sub}` : ev.sub;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: i < activityFeed.length - 1 ? `1px solid ${theme.borderSubtle}` : "none" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 3 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: theme.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.label}</div>
                      <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 1 }}>
                        {typeLabel}
                        {ev.owner ? <span style={{ color: theme.textTertiary }}> · {ev.owner}</span> : null}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: theme.textTertiary, flexShrink: 0, marginTop: 2 }}>{formatTimeAgo(ev.time)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );

      case "pw-kanban": return (
        <div style={{ padding: "0 8px", height: "100%", boxSizing: "border-box", overflow: "auto" }}>
          <PWProposalKanban leads={leads} onOrgClick={onOrgClick} />
        </div>
      );

      case "dc-map": return (
        <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
          <NetworkMap table="dc_network_features" dcMode embedded onOpenSubstation={sub => onOpenNetworkMap?.(sub)} />
        </div>
      );

      case "dc-kpis": return (
        <div style={{ padding: "12px 14px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
            {[
              { label: "Substations", value: dcMetrics.subs, color: "#06B6D4", sub: `${dcMetrics.inTarget} in target (3–10MW)` },
              { label: "Land Parcels", value: dcMetrics.parcels, color: "#84CC16", sub: "Areas drawn" },
              { label: "Substation Leads", value: dcMetrics.leads, color: "#F59E0B", sub: "Landowner contacts" },
              { label: "Grid Surgeries", value: dcMetrics.surgeries, color: theme.accent, sub: `${dcMetrics.surgeriesDone} complete` },
            ].map((kpi, i) => (
              <div key={i}>
                <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 5 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color || theme.textPrimary, letterSpacing: "-0.02em" }}>{kpi.value}</div>
                {kpi.sub && <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>{kpi.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      );

      case "dc-growth": return (
        <div style={{ padding: "8px 14px 14px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: theme.textMuted }}>
              {dcGrowthByPerson_active
                ? `Substations, parcels, leads, surgeries${dcShowTouches ? " and touch points" : ""} per day, by team member.`
                : `Team output per day by activity type${dcShowTouches ? ", including touch points" : " (touch points hidden)"}.`}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginLeft: "auto" }}>
              {dcGrowthSegments.map(name => (
                <span key={name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: theme.textMuted }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: dcGrowthColors[name] || theme.accent }} />
                  {name}
                </span>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChartBox fillHeight>
              {(w, h) => <StackedBarChart data={dcGrowthData} channels={dcGrowthSegments} width={w} height={h} theme={theme} colorMap={dcGrowthColors} />}
            </ChartBox>
          </div>
        </div>
      );

      case "dc-surgeries": return (
        <div style={{ padding: "8px 12px 12px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 8 }}>
            {dcMetrics.surgeries} total · {dcMetrics.surgeriesDone} complete · {dcMetrics.surgeries - dcMetrics.surgeriesDone} open
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {dcSurgeryList.length === 0 ? (
              <div style={{ fontSize: 12, color: theme.textMuted, fontStyle: "italic", padding: "8px 2px" }}>No grid surgeries yet.</div>
            ) : dcSurgeryList.map(s => (
              <div key={s.id}
                onClick={() => { if (s.sub && s.sub.lat != null) onOpenNetworkMap?.(s.sub); }}
                title={s.sub ? "Open on Network Map" : undefined}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: `1px solid ${theme.borderSubtle || theme.border}`, cursor: s.sub && s.sub.lat != null ? "pointer" : "default" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: s.done ? "#22C55E" : "#F59E0B" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.subName}</div>
                  <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 1 }}>
                    {s.dno} · {s.person.split(" ")[0]}
                    {s.requested_at ? ` · req ${s.requested_at}` : ""}{s.held_at ? ` · done ${s.held_at}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 5, flexShrink: 0, background: (s.done ? "#22C55E" : "#F59E0B") + "22", color: s.done ? "#16A34A" : "#B45309" }}>
                  {s.done ? "Complete" : "Requested"}
                </span>
              </div>
            ))}
          </div>
        </div>
      );

      default: return null;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", padding: "10px 20px",
        gap: 12, flexShrink: 0, flexWrap: "wrap",
        borderBottom: `1px solid ${theme.border}`,
        background: theme.pageBg,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>
          Pipeline Dashboard <span style={{ color: theme.textMuted, fontWeight: 500 }}>· {campaign === "DC" ? "Data Centres" : campaign === "PW" ? "Private Wire" : "All Campaigns"}</span>
        </div>

        {/* Campaign toggle — scopes every KPI, chart and the funnel.
            Hidden when the dashboard is locked to a campaign by its parent. */}
        {!scoped && (
        <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
          {[["All", "All", theme.accent], ["PW", "Private Wire", "#2563EB"], ["DC", "Data Centres", "#F97316"]].map(([val, label, colour]) => {
            const active = campaign === val;
            return (
              <button key={val} onClick={() => setCampaign(val)} style={{
                fontSize: 10, fontWeight: active ? 700 : 500, padding: "4px 12px", borderRadius: 6, cursor: "pointer",
                color: active ? "#fff" : theme.pillInactiveText,
                background: active ? colour : "transparent",
                border: "1px solid transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {label}
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "0px 5px", borderRadius: 8,
                  color: active ? "#fff" : theme.textTertiary,
                  background: active ? "rgba(255,255,255,0.22)" : theme.cardBg,
                }}>{(campaignTotals[val] || 0).toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        )}

        {/* Range toggle */}
        <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
          {[["today", "Today"], [7, "7 Days"], [30, "30 Days"], ["all", "All Time"]].map(([val, label]) => (
            <button key={val} onClick={() => setRange(val)} style={{
              fontSize: 10, fontWeight: range === val ? 700 : 500, padding: "4px 12px", borderRadius: 6, cursor: "pointer",
              color: range === val ? theme.pillActiveText : theme.pillInactiveText,
              background: range === val ? theme.pillActiveBg : "transparent",
              border: range === val ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
              boxShadow: range === val ? theme.shadowSm : "none",
            }}>{label}</button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {editMode && (
            <button onClick={resetLayout} style={{
              fontSize: 10, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
              border: `1px solid ${theme.border}`, background: theme.pillBg,
              color: theme.textMuted, fontFamily: "inherit",
            }}>Reset</button>
          )}
          <button onClick={() => setEditMode(e => !e)} style={{
            fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${editMode ? theme.accent : theme.border}`,
            background: editMode ? theme.accent + "22" : theme.pillBg,
            color: editMode ? theme.accent : theme.textSecondary, fontFamily: "inherit",
          }}>
            {editMode ? "✓ Done" : "⊞ Edit Layout"}
          </button>
        </div>
      </div>

      {/* Grid area */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div ref={gridRef}>
          {gridWidth > 0 && (
            <GridLayout
              width={gridWidth}
              layout={activeLayout}
              onLayoutChange={(nl) => {
                setLayout(nl);
                localStorage.setItem(LAYOUT_KEY, JSON.stringify(nl));
              }}
              rowHeight={PW_ROW_H}
              margin={[12, 12]}
              containerPadding={[8, 12]}
              isDraggable={editMode}
              isResizable={editMode}
              compactType={null}
              preventCollision={true}
              cols={12}
              draggableHandle=".widget-drag-handle"
            >
              {activeLayout.map(({ i }) => {
                const def = WIDGET_DEFS.find(w => w.id === i);
                if (!def) return null;
                if (i === "pw-kanban" && !onOrgClick) return null;
                return (
                  <div key={i} style={{ boxSizing: "border-box" }}>
                    <DashboardWidget
                      id={i}
                      title={def.title}
                      color={def.color}
                      editMode={editMode}
                      onRemove={removeWidget}
                      theme={theme}
                      headerRight={i === "pw-team" ? teamToggle : i === "dc-growth" ? dcGrowthToggle : null}
                    >
                      {widgetContent(i)}
                    </DashboardWidget>
                  </div>
                );
              })}
            </GridLayout>
          )}
        </div>

        {/* Restore removed widgets */}
        {editMode && removedWidgets.filter(id => id !== "pw-kanban" || !!onOrgClick).length > 0 && (
          <div style={{ padding: "0 20px 24px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Hidden Widgets
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {removedWidgets
                .filter(id => id !== "pw-kanban" || !!onOrgClick)
                .map(id => {
                  const def = WIDGET_DEFS.find(w => w.id === id);
                  if (!def) return null;
                  return (
                    <button key={id} onClick={() => addWidget(id)} style={{
                      fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                      border: `1px solid ${def.color}44`,
                      background: def.color + "11",
                      color: def.color, fontFamily: "inherit",
                    }}>+ {def.title}</button>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Named exports for TOF dashboard ─────────────────────────────────────────
export {
  StackedBarChart, PipelineFunnel, PieChart, AreaChart, ChartBox,
  useContainerSize, CHANNEL_COLORS, SECTOR_COLORS, OWNER_PALETTE,
  STAGE_COLORS_FUSE, STAGE_COLORS_LINEAR, STAGES, STAGE_LABELS,
  getDaysBetween, formatDate, formatDateShort, formatDaysInStage, getDurationColor,
};
