import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUBSTATION_TYPES = ["substation_132kv", "substation_33kv", "substation_11kv"];

export const CAPACITY_OPTIONS = [
  { value: "0MW",    label: "0MW",    color: "#ef4444", radiusKm: 0 },
  { value: "<5MW",   label: "<5MW",   color: "#06b6d4", radiusKm: 3 },
  { value: "5-10MW", label: "5-10MW", color: "#3b82f6", radiusKm: 5 },
  { value: "10MW+",  label: "10MW+",  color: "#8b5cf6", radiusKm: 8 },
];
export const CAPACITY_MAP = Object.fromEntries(CAPACITY_OPTIONS.map(c => [c.value, c]));

// RAG colouring by available import capacity (MW) — used by the Data Centres
// 11kV map. Red <1MW · Amber 1–<3MW · Green ≥3MW (incl. >10). In-target = 3–10MW.
export const RAG_RED = "#ef4444", RAG_AMBER = "#f59e0b", RAG_GREEN = "#10b981", RAG_NONE = "#64748b";
export function capacityRagColor(mw) {
  const n = Number(mw);
  if (mw == null || mw === "" || Number.isNaN(n)) return null;
  if (n < 1) return RAG_RED;
  if (n < 3) return RAG_AMBER;
  return RAG_GREEN;
}
export function isInTarget(mw) {
  const n = Number(mw);
  return !Number.isNaN(n) && mw != null && mw !== "" && n >= 3 && n <= 10;
}

export const NETWORK_TYPES = [
  { value: "substation_132kv",   label: "132kV Substation",   color: "#8b5cf6", shape: "square" },
  { value: "substation_33kv",    label: "33kV Substation",    color: "#3b82f6", shape: "square" },
  { value: "substation_11kv",    label: "11kV Substation",    color: "#06b6d4", shape: "square" },
  { value: "gsp",                label: "Grid Supply Point",  color: "#10b981", shape: "diamond" },
  { value: "overhead_line",      label: "Overhead Line",      color: "#f59e0b", shape: "line" },
  { value: "underground_cable",  label: "Underground Cable",  color: "#f97316", shape: "line" },
  { value: "proposed_connection",label: "Proposed Connection",color: "#ec4899", shape: "line" },
  { value: "radius",             label: "Radius",             color: "#06b6d4", shape: "circle" },
  { value: "other",              label: "Other",              color: "#64748b", shape: "square" },
  { value: "land",               label: "Land",               color: "#84cc16", shape: "square" },
];

export const NETWORK_TYPE_MAP = Object.fromEntries(NETWORK_TYPES.map(t => [t.value, t]));

// Preset colour palette for user-coloured features (radius tool today, extensible later)
export const RADIUS_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#10b981", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
];

// DC opportunity tracking — status pipeline + DNO regions
export const DC_STATUS_OPTIONS = ["Identified", "Grid Surgery Requested", "Quote received", "Viable", "Dead"];
export const DC_STATUS_COLORS = { "Identified": "#64748b", "Grid Surgery Requested": "#3b82f6", "Quote received": "#f59e0b", "Viable": "#10b981", "Dead": "#ef4444" };
export const DNO_OPTIONS = ["NGED", "NPG", "UKPN", "SSEN", "ENWL", "SPEN"];

// Colour per DNO group for the DC region overlay
const DNO_COLORS = { NGED: "#3b82f6", NPG: "#8b5cf6", UKPN: "#ec4899", SSEN: "#10b981", ENWL: "#f59e0b", SPEN: "#06b6d4" };
const DNO_FILL_MATCH = ["match", ["get", "dno"],
  "NGED", DNO_COLORS.NGED, "NPG", DNO_COLORS.NPG, "UKPN", DNO_COLORS.UKPN,
  "SSEN", DNO_COLORS.SSEN, "ENWL", DNO_COLORS.ENWL, "SPEN", DNO_COLORS.SPEN,
  "#64748b"];

// Point-in-polygon (ray casting) for DNO auto-detect on marker drop.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, rings) { // rings = [outer, ...holes]; even-odd handles holes
  let inside = false;
  for (const ring of rings) if (pointInRing(x, y, ring)) inside = !inside;
  return inside;
}
function dnoAtPoint(geo, lng, lat) {
  if (!geo?.features) return null;
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon" && pointInPolygon(lng, lat, g.coordinates)) return f.properties?.dno || null;
    if (g.type === "MultiPolygon") for (const poly of g.coordinates) if (pointInPolygon(lng, lat, poly)) return f.properties?.dno || null;
  }
  return null;
}

const WFS_LAYERS = [
  { id: "sub132", label: "NGED 132kV", color: "#8b5cf6", file: "/sub132.geojson" },
  { id: "sub33",  label: "NGED 33kV",  color: "#3b82f6", file: "/sub33.geojson"  },
  { id: "sub11",  label: "NGED 11kV",  color: "#06b6d4", file: "/sub11.geojson"  },
  { id: "gsp",    label: "GSP Regions",color: "#f59e0b", file: "/gsp_regions.geojson", isPolygon: true },
  { id: "dno",    label: "DNO Regions",color: "#a78bfa", file: "/dno_regions.geojson", isPolygon: true, labelField: "area", colorByDno: true },
];

// Which network feature types map into which reference layer
const TYPE_TO_LAYER = {
  substation_132kv: "sub132",
  substation_33kv:  "sub33",
  substation_11kv:  "sub11",
};

// (SUBSTATION_TYPES, CAPACITY_OPTIONS, CAPACITY_MAP are exported at top of file)

// Generate a circle polygon GeoJSON feature
function makeCircleGeoJSON(centerLng, centerLat, radiusKm, props = {}) {
  const steps = 64;
  const coords = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / steps;
    const dx = radiusKm / (111.32 * Math.cos(centerLat * Math.PI / 180));
    const dy = radiusKm / 110.574;
    return [centerLng + dx * Math.cos(angle), centerLat + dy * Math.sin(angle)];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: props };
}

function calcArea(geojson) {
  if (!geojson?.coordinates?.[0]) return null;
  const ring = geojson.coordinates[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) { area += ring[i][0] * ring[i + 1][1]; area -= ring[i + 1][0] * ring[i][1]; }
  return (Math.abs(area) / 2) * 111320 * (111320 * Math.cos(51.6 * Math.PI / 180)) / 10000;
}

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function lineDistance(coords) { let t = 0; for (let i = 0; i < coords.length - 1; i++) t += haversineKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]); return t; }

// ─── Annotation Panel ─────────────────────────────────────────────────────────

function AnnotationPanel({ feature, onSave, onDelete, onClose, onRadiusPreview, theme, dcMode = false }) {
  const defaultType = dcMode ? "substation_11kv" : "substation_33kv";
  const [name, setName]       = useState(feature?.name || "");
  const [notes, setNotes]     = useState(feature?.notes || "");
  const [type, setType]       = useState(feature?.type || defaultType);
  const [capacity, setCapacity] = useState(feature?.capacity || "");
  const [capacityMw, setCapacityMw] = useState(feature?.capacity_mw ?? "");
  const [tia, setTia]         = useState(feature?.tia || false);
  const [color, setColor]     = useState(feature?.color || NETWORK_TYPE_MAP.radius.color);
  const [radiusKm, setRadiusKm] = useState(feature?.radius_km ?? 1);
  const [saving, setSaving]   = useState(false);
  // DC opportunity fields
  const [status, setStatus]       = useState(feature?.status || "Identified");
  const [dno, setDno]             = useState(feature?.dno || "");
  const [dnoRef, setDnoRef]       = useState(feature?.dno_reference || "");
  const [connCost, setConnCost]   = useState(feature?.connection_cost || "");
  const [contact, setContact]     = useState(feature?.contact || "");
  const [nextAction, setNextAction] = useState(feature?.next_action || "");

  useEffect(() => {
    setName(feature?.name || "");
    setNotes(feature?.notes || "");
    setType(feature?.type || defaultType);
    setCapacity(feature?.capacity || "");
    setCapacityMw(feature?.capacity_mw ?? "");
    setTia(feature?.tia || false);
    setStatus(feature?.status || "Identified");
    setDno(feature?.dno || "");
    setDnoRef(feature?.dno_reference || "");
    setConnCost(feature?.connection_cost || "");
    setContact(feature?.contact || "");
    setNextAction(feature?.next_action || "");
    setColor(feature?.color || NETWORK_TYPE_MAP.radius.color);
    setRadiusKm(feature?.radius_km ?? 1);
  }, [feature?.id]);

  const isRadius = type === "radius" || feature?.type === "radius";
  const isLine = !isRadius && feature?.geojson?.geometry?.type === "LineString";
  const isArea = !isRadius && feature?.geojson?.geometry?.type === "Polygon";
  const area   = isArea ? calcArea(feature.geojson.geometry) : null;
  const dist   = isLine ? lineDistance(feature.geojson.geometry.coordinates) : null;

  // Live preview on the map as the user tweaks radius / colour
  useEffect(() => {
    if (!isRadius || !onRadiusPreview) return;
    onRadiusPreview({ lat: feature?.lat, lng: feature?.lng, radius_km: radiusKm, color });
  }, [isRadius, radiusKm, color, feature?.lat, feature?.lng, onRadiusPreview]);
  const isNew  = !feature?.id;
  const isSubstation = SUBSTATION_TYPES.includes(type);

  const inp = { width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", outline: "none", boxSizing: "border-box" };
  const sel = { ...inp, cursor: "pointer" };
  const SH = { fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 };

  const lineTypes = NETWORK_TYPES.filter(t => t.shape === "line");
  // DC map is 11kV-only — offer just the 11kV substation and Other for point features.
  const pointTypes = NETWORK_TYPES.filter(t => t.shape !== "line" && t.shape !== "circle"
    && (!dcMode || t.value === "substation_11kv" || t.value === "other" || t.value === "land"));
  const relevantTypes = isRadius ? [NETWORK_TYPE_MAP.radius] : isLine ? lineTypes : pointTypes;

  return (
    <div style={{ position: "absolute", top: 8, right: 12, bottom: 12, width: 276, background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", zIndex: 10, overflow: "hidden", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>{isNew ? "New Feature" : "Edit Feature"}</div>
        <div onClick={onClose} style={{ cursor: "pointer", fontSize: 16, color: theme.textTertiary, padding: 2 }}>✕</div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Type</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {relevantTypes.map(t => (
              <button key={t.value} onClick={() => setType(t.value)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: type === t.value ? t.color + "22" : theme.pillBg, border: `1px solid ${type === t.value ? t.color : theme.border}`, color: type === t.value ? t.color : theme.textSecondary, fontWeight: type === t.value ? 700 : 400, fontFamily: "'Inter', system-ui, sans-serif" }}>{t.label}</button>
            ))}
          </div>
        </div>
        {dist != null && (
          <div style={{ background: "#f9731622", border: "1px solid #f9731644", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Length</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f97316", lineHeight: 1 }}>{dist.toFixed(2)} km</div>
            <div style={{ fontSize: 10, color: "#f97316", opacity: 0.7, marginTop: 2 }}>{(dist * 1000).toFixed(0)} metres</div>
          </div>
        )}

        {/* ── Radius controls ─────────────────────────────────────────── */}
        {isRadius && (
          <>
            <div style={{ background: color + "22", border: `1px solid ${color}55`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, color, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Radius</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{radiusKm.toFixed(2)} km</div>
              <div style={{ fontSize: 10, color, opacity: 0.7, marginTop: 2 }}>
                {(radiusKm * 1000).toFixed(0)} m · area {(Math.PI * radiusKm * radiusKm).toFixed(2)} km²
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Adjust radius</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="range"
                  min={0.05}
                  max={50}
                  step={0.05}
                  value={radiusKm}
                  onChange={e => setRadiusKm(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: color }}
                />
                <input
                  type="number"
                  min={0.01}
                  step={0.05}
                  value={radiusKm}
                  onChange={e => setRadiusKm(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  style={{ ...inp, width: 70, padding: "5px 7px", fontSize: 11 }}
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Colour</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {RADIUS_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} title={c} style={{
                    width: 24, height: 24, borderRadius: "50%", cursor: "pointer",
                    background: c, border: color === c ? `2px solid ${theme.textPrimary}` : `2px solid transparent`,
                    boxShadow: color === c ? `0 0 0 1px ${c}` : "none",
                    transition: "transform 0.1s",
                  }} />
                ))}
                <label style={{
                  display: "flex", alignItems: "center", gap: 4, marginLeft: 4, cursor: "pointer",
                  fontSize: 10, color: theme.textTertiary,
                }}>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    style={{ width: 24, height: 24, border: "none", padding: 0, background: "transparent", cursor: "pointer" }} />
                  Custom
                </label>
              </div>
            </div>
          </>
        )}
        {area != null && (
          <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", fontWeight: 600, marginBottom: 2 }}>Area</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary }}>{(area * 2.47105).toFixed(1)} acres</div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{area.toFixed(1)} ha</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Name</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Llanelli Primary 33kV" style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Capacity, constraints, source…" rows={3} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {/* Capacity — substations only. DC = numeric MW with RAG; else fixed buckets. */}
        {isSubstation && !isLine && !isArea && dcMode && (() => {
          const rag = capacityRagColor(capacityMw);
          const n = Number(capacityMw);
          const ragLabel = capacityMw === "" || Number.isNaN(n) ? "Enter available capacity"
            : n < 1 ? "No usable capacity"
            : n < 3 ? "Below target (1–3MW)"
            : n <= 10 ? "In target (3–10MW)"
            : "Above target (>10MW)";
          return (
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Import Capacity (MW)</div>
              <input type="number" min={0} step={0.1} value={capacityMw}
                onChange={e => setCapacityMw(e.target.value)}
                placeholder="e.g. 5.5" style={inp} />
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: rag || theme.border, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: rag || theme.textTertiary, fontWeight: 600 }}>{ragLabel}</span>
              </div>
            </div>
          );
        })()}

        {isSubstation && !isLine && !isArea && !dcMode && (
          <div>
            <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Capacity Available</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {CAPACITY_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setCapacity(capacity === opt.value ? "" : opt.value)}
                  style={{ fontSize: 11, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                    background: capacity === opt.value ? opt.color + "22" : theme.pillBg,
                    border: `1px solid ${capacity === opt.value ? opt.color : theme.border}`,
                    color: capacity === opt.value ? opt.color : theme.textSecondary,
                    fontWeight: capacity === opt.value ? 700 : 400,
                    fontFamily: "'Inter', system-ui, sans-serif" }}>
                  {opt.label}
                </button>
              ))}
            </div>
            {capacity && capacity !== "0MW" && (
              <div style={{ marginTop: 5, fontSize: 10, color: CAPACITY_MAP[capacity]?.color, opacity: 0.8 }}>
                → {CAPACITY_MAP[capacity]?.radiusKm}km radius will be drawn
              </div>
            )}
          </div>
        )}

        {/* TIA toggle — substations only */}
        {isSubstation && !isLine && !isArea && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>TIA Required</div>
              <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 2 }}>Transmission Impact Assessment</div>
            </div>
            <button onClick={() => setTia(t => !t)}
              style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                background: tia ? "#10b981" : theme.border, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff",
                position: "absolute", top: 3, left: tia ? 23 : 3, transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </button>
          </div>
        )}

        {/* ── Opportunity tracking — DC substations only ─────────────────── */}
        {dcMode && isSubstation && !isLine && !isArea && (
          <>
            <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12, marginTop: 2 }}>
              <div style={SH}>Status</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {DC_STATUS_OPTIONS.map(s => (
                  <button key={s} onClick={() => setStatus(s)}
                    style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
                      background: status === s ? DC_STATUS_COLORS[s] + "22" : theme.pillBg,
                      border: `1px solid ${status === s ? DC_STATUS_COLORS[s] : theme.border}`,
                      color: status === s ? DC_STATUS_COLORS[s] : theme.textSecondary,
                      fontWeight: status === s ? 700 : 400, fontFamily: "'Inter', system-ui, sans-serif" }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={SH}>DNO Region</div>
              <select value={dno} onChange={e => setDno(e.target.value)} style={sel}>
                <option value="">—</option>
                {DNO_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <div style={SH}>DNO Reference</div>
              <input value={dnoRef} onChange={e => setDnoRef(e.target.value)} placeholder="e.g. quote / job ref" style={inp} />
            </div>
            <div>
              <div style={SH}>Indicative Connection Cost</div>
              <input value={connCost} onChange={e => setConnCost(e.target.value)} placeholder="e.g. £1.2m" style={inp} />
            </div>
            <div>
              <div style={SH}>DNO Contact</div>
              <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Name / email / phone" style={inp} />
            </div>
            <div>
              <div style={SH}>Next Action</div>
              <input value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. request budget quote" style={inp} />
            </div>
          </>
        )}
      </div>
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${theme.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
        <button onClick={async () => { setSaving(true); await onSave({ name, notes, type, capacity, capacity_mw: capacityMw === "" ? null : Number(capacityMw), tia, color: isRadius ? color : null, radius_km: isRadius ? radiusKm : null, status, dno: dno || null, dno_reference: dnoRef || null, connection_cost: connCost || null, contact: contact || null, next_action: nextAction || null }); setSaving(false); }} disabled={saving} style={{ flex: 1, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : "Save"}</button>
        {!isNew && <button onClick={onDelete} style={{ background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Delete</button>}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function NetworkMap({ session, table = "network_features", dcMode = false, focus = null, onOpenLead = null, refreshKey = 0, embedded = false, onOpenSubstation = null }) {
  const { theme } = useTheme();
  // Embedded (dashboard) mode: read-only overview — no tools sidebar, no editing;
  // clicking a substation bubbles up via onOpenSubstation. Refs keep the marker
  // click handler current without re-binding markers.
  const embeddedRef = useRef(embedded); embeddedRef.current = embedded;
  const onOpenSubstationRef = useRef(onOpenSubstation); onOpenSubstationRef.current = onOpenSubstation;
  const mapContainer      = useRef(null);
  const map               = useRef(null);
  const draw              = useRef(null);
  const markers           = useRef({});
  const mapInit           = useRef(false);
  const drawModeRef       = useRef(null);      // always-current drawMode for map click handler
  const drawIdToFeatId    = useRef({});        // Draw feature id → saved feature id
  const featuresRef       = useRef([]);        // always-current features for use in callbacks
  const dnoGeoRef         = useRef(null);       // DNO regions geojson (for auto-detect on drop)

  const [mapStyle, setMapStyle]       = useState("satellite-streets");
  const [activeLayers, setActiveLayers] = useState(() => dcMode ? new Set(["dno"]) : new Set());
  const [layerData, setLayerData]     = useState({});
  const [layerLoading, setLayerLoading] = useState({});
  const [features, setFeatures]       = useState([]);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [panelOpen, setPanelOpen]     = useState(false);
  const [drawMode, setDrawMode]       = useState(null);
  const [liveDistance, setLiveDistance] = useState(null);
  const [sidebarTab, setSidebarTab]   = useState("tools");
  // Substation drill-down (DC): selected substation + its Parcels/Leads
  const [selectedSub, setSelectedSub] = useState(null);
  const [subTab, setSubTab]           = useState("leads");
  const [subLeads, setSubLeads]       = useState([]);
  const [newLeadName, setNewLeadName] = useState("");
  const [subSurgeries, setSubSurgeries] = useState([]);
  const [subDialogOpen, setSubDialogOpen] = useState(true); // on-map substation details dialog
  const [surgeryNotice, setSurgeryNotice] = useState(null);  // missing-fields list when completing a grid surgery
  const [coordInput, setCoordInput] = useState("");          // lat/lng jump-to search
  const [coordErr, setCoordErr] = useState(false);
  useEffect(() => { if (selectedSub) setSubDialogOpen(true); }, [selectedSub?.id]);

  // Parse "lat, lng" (or "lat lng", "(lat, lng)") and fly there.
  const goToCoords = useCallback(() => {
    const nums = (coordInput.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const [lat, lng] = nums;
    const valid = nums.length >= 2 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (!valid || !map.current) { setCoordErr(true); return; }
    setCoordErr(false);
    map.current.flyTo({ center: [lng, lat], zoom: Math.max(map.current.getZoom(), 14), duration: 900 });
  }, [coordInput]);

  // Current user id — provided via session, or resolved from Supabase auth when
  // the host (e.g. Data Centres) mounts NetworkMap without a session.
  const [userId, setUserId] = useState(session?.user?.id || null);
  useEffect(() => {
    if (userId) return;
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, [userId]);

  const STYLES = { "streets": "mapbox://styles/mapbox/streets-v12", "satellite-streets": "mapbox://styles/mapbox/satellite-streets-v12" };

  // Data Centres map is 11kV-only — DNO regions + NGED 11kV; hide 33kV/132kV/GSP.
  const referenceLayers = dcMode
    ? ["dno", "sub11"].map(id => WFS_LAYERS.find(l => l.id === id)).filter(Boolean)
    : WFS_LAYERS.filter(l => l.id !== "dno");

  // Keep featuresRef in sync
  useEffect(() => { featuresRef.current = features; }, [features]);

  // ── Load features ────────────────────────────────────────────────────────────
  const loadFeatures = useCallback(async () => {
    const { data } = await supabase.from(table).select("*").order("created_at", { ascending: false });
    if (data) setFeatures(data);
    return data || [];
  }, [table]);

  useEffect(() => { loadFeatures(); }, [loadFeatures]);

  // Idempotently create the user-radius and user-radius-preview sources/layers.
  // Called both from style.load AND lazily from the click handler / panel
  // preview, so we never depend on a single event firing at the right time.
  const ensureRadiusLayers = useCallback(() => {
    if (!map.current) return false;
    if (!map.current.isStyleLoaded()) return false;
    if (!map.current.getSource("user-radius")) {
      map.current.addSource("user-radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.current.addLayer({ id: "user-radius-fill",   type: "fill", source: "user-radius", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 } });
      map.current.addLayer({ id: "user-radius-stroke", type: "line", source: "user-radius", paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
      map.current.on("mouseenter", "user-radius-fill", () => { map.current.getCanvas().style.cursor = drawModeRef.current ? "crosshair" : "pointer"; });
      map.current.on("mouseleave", "user-radius-fill", () => { map.current.getCanvas().style.cursor = drawModeRef.current ? "crosshair" : ""; });
      map.current.on("click", "user-radius-fill", e => {
        if (drawModeRef.current) return;
        const featId = e.features?.[0]?.properties?.feature_id;
        if (!featId) return;
        const feat = featuresRef.current.find(f => f.id === featId);
        if (feat) { setSelectedFeature(feat); setPanelOpen(true); }
      });
      console.info("[NetworkMap] user-radius layer initialised (lazy)");
    }
    if (!map.current.getSource("user-radius-preview")) {
      map.current.addSource("user-radius-preview", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.current.addLayer({ id: "user-radius-preview-fill",   type: "fill", source: "user-radius-preview", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 } });
      map.current.addLayer({ id: "user-radius-preview-stroke", type: "line", source: "user-radius-preview", paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2] } });
      console.info("[NetworkMap] user-radius-preview layer initialised (lazy)");
    }
    return true;
  }, []);

  // ── Init map ─────────────────────────────────────────────────────────────────
  // Keep the Mapbox canvas synced to its container (e.g. resized as a dashboard widget).
  useEffect(() => {
    const el = mapContainer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (mapInit.current || !mapContainer.current) return;
    mapInit.current = true;

    // Embedded overview opens UK-wide to show every substation; the tab opens
    // zoomed into the working area.
    map.current = new mapboxgl.Map({ container: mapContainer.current, style: STYLES[mapStyle],
      center: embedded ? [-2.5, 54.2] : [-3.5, 51.65], zoom: embedded ? 5 : 9 });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-left");
    map.current.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      styles: [
        // Lines (orange dashed)
        { id: "gl-draw-line-active",  type: "line", filter: ["all", ["==", "$type", "LineString"], ["!=", "mode", "static"]], paint: { "line-color": "#f97316", "line-width": 2.5, "line-dasharray": [2, 2] } },
        { id: "gl-draw-line-static",  type: "line", filter: ["all", ["==", "$type", "LineString"], ["==", "mode", "static"]],  paint: { "line-color": "#f97316", "line-width": 2,   "line-dasharray": [4, 3] } },
        { id: "gl-draw-line-vertex",  type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"]],    paint: { "circle-radius": 4, "circle-color": "#f97316", "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" } },
        // Polygons (purple)
        { id: "gl-draw-polygon-fill",          type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]], paint: { "fill-color": "#8b5cf6", "fill-opacity": 0.15 } },
        { id: "gl-draw-polygon-stroke",        type: "line", filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]], paint: { "line-color": "#8b5cf6", "line-width": 2 } },
        { id: "gl-draw-polygon-fill-static",   type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]], paint: { "fill-color": "#8b5cf6", "fill-opacity": 0.1 } },
        { id: "gl-draw-polygon-stroke-static", type: "line", filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"]], paint: { "line-color": "#8b5cf6", "line-width": 1.5 } },
        // Points
        { id: "gl-draw-point-outer", type: "circle", filter: ["all", ["==", "$type", "Point"], ["!=", "meta", "vertex"]], paint: { "circle-radius": 6, "circle-color": "#fff", "circle-stroke-width": 2, "circle-stroke-color": "#8b5cf6" } },
      ],
    });
    map.current.addControl(draw.current);

    map.current.on("draw.create", (e) => {
      const f = e.features[0];
      const isLine = f.geometry.type === "LineString";
      const dist   = isLine ? lineDistance(f.geometry.coordinates) : null;
      setSelectedFeature({
        _drawId: f.id, geojson: { ...f, properties: { ...(isLine ? { distance_km: dist } : {}) } },
        type: isLine ? "overhead_line" : "substation_33kv", name: "", notes: "",
      });
      setPanelOpen(true); setDrawMode(null);
    });

    // Use ref so this handler always reads the current drawMode
    map.current.on("click", (e) => {
      if (drawModeRef.current === "point") {
        const lng = e.lngLat.lng, lat = e.lngLat.lat;
        // DC map: default to 11kV and auto-detect the DNO region from where it's dropped.
        const base = { lat, lng, name: "", notes: "" };
        if (dcMode) { base.type = "substation_11kv"; base.dno = dnoAtPoint(dnoGeoRef.current, lng, lat) || ""; }
        else base.type = "substation_33kv";
        setSelectedFeature(base);
        setPanelOpen(true);
        setDrawMode(null);
      } else if (drawModeRef.current === "radius") {
        // Single-click UX: drop a centre and immediately open the panel with a
        // default 1 km circle. The user adjusts radius + colour via the panel
        // slider (live-previewed on the map). Simpler and more reliable than the
        // earlier two-click + mousemove flow.
        const defaultColor = NETWORK_TYPE_MAP.radius.color;
        const defaultRadius = 1; // km
        ensureRadiusLayers();
        const preview = makeCircleGeoJSON(e.lngLat.lng, e.lngLat.lat, defaultRadius, { color: defaultColor });
        map.current.getSource("user-radius-preview")?.setData(preview);
        setSelectedFeature({
          lat: e.lngLat.lat,
          lng: e.lngLat.lng,
          type: "radius",
          name: "",
          notes: "",
          color: defaultColor,
          radius_km: defaultRadius,
          geojson: preview,
        });
        setPanelOpen(true);
        setDrawMode(null);
      }
    });

    // Clicking a saved Draw feature (line / polygon) opens its panel
    map.current.on("draw.selectionchange", (e) => {
      if (e.features.length === 0) return;
      const drawId  = e.features[0].id;
      const featId  = drawIdToFeatId.current[drawId];
      if (!featId) return;
      setFeatures(current => {
        const feat = current.find(f => f.id === featId);
        if (feat) { setSelectedFeature(feat); setPanelOpen(true); }
        return current;
      });
    });

    // Persistent style.load handler — re-initialises radius layers after every style change.
    // Note: Mapbox's style.load doesn't replay to late-registered listeners, so we also
    // invoke this synchronously below if the style was already loaded by the time we got here.
    const onStyleLoad = () => {
      CAPACITY_OPTIONS.forEach(opt => {
        if (opt.radiusKm === 0) return;
        const srcId = `radius-${opt.value.replace(/[^a-z0-9]/gi, "")}`;
        if (!map.current.getSource(srcId)) {
          map.current.addSource(srcId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.current.addLayer({ id: `${srcId}-fill`,   type: "fill", source: srcId, paint: { "fill-color": opt.color, "fill-opacity": 0.1 } });
          map.current.addLayer({ id: `${srcId}-stroke`, type: "line", source: srcId, paint: { "line-color": opt.color, "line-width": 2, "line-dasharray": [5, 3] } });
        }
        const circles = featuresRef.current
          .filter(f => f.lat && f.lng && f.capacity === opt.value && SUBSTATION_TYPES.includes(f.type))
          .map(f => makeCircleGeoJSON(f.lng, f.lat, opt.radiusKm));
        map.current.getSource(srcId)?.setData({ type: "FeatureCollection", features: circles });
      });

      // Init user-radius and preview layers (idempotent — also lazy-called from
      // the click handler / panel preview so we never rely on this fire alone).
      ensureRadiusLayers();
      // Seed the user-radius layer with existing features after style reload
      const userCircles = featuresRef.current
        .filter(f => f.type === "radius" && f.lat != null && f.lng != null && f.radius_km != null)
        .map(f => makeCircleGeoJSON(f.lng, f.lat, f.radius_km, { feature_id: f.id, color: f.color || NETWORK_TYPE_MAP.radius.color, name: f.name || "" }));
      map.current.getSource("user-radius")?.setData({ type: "FeatureCollection", features: userCircles });
    };
    map.current.on("style.load", onStyleLoad);
    // If the style finished loading before we got here (cache hit), run once synchronously
    if (map.current.isStyleLoaded()) onStyleLoad();

    return () => { map.current?.remove(); map.current = null; mapInit.current = false; };
  }, []);

  // ── Style change ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(STYLES[mapStyle]);
    // WFS layers are restored here; radius circles are restored by the persistent
    // on("style.load") handler registered in the map init effect.
    map.current.once("style.load", () => {
      activeLayers.forEach(id => { const data = layerData[id]; if (data) addWFSLayer(id, data); });
    });
  }, [mapStyle]);

  // Fly to a substation when the Substations list requests focus, and select it
  // so its Parcels + Leads open in the sidebar.
  useEffect(() => {
    if (!map.current || focus?.lat == null || focus?.lng == null) return;
    map.current.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.current.getZoom(), 12), duration: 900 });
    if (dcMode && focus.id) setSelectedSub(focus);
  }, [focus?.ts]);

  // ── Keep drawModeRef in sync + update cursor ─────────────────────────────────
  // NOTE: do NOT clear the preview source here. After the second click in radius
  // mode, drawMode flips to null and the AnnotationPanel mounts to populate the
  // preview. React runs child effects before parent effects, so a clear here
  // would wipe the panel's just-set preview circle (the original display bug).
  // Cancel-drawing path clears the preview inside activateDraw instead.
  useEffect(() => {
    drawModeRef.current = drawMode;
    if (!map.current) return;
    map.current.getCanvas().style.cursor = (drawMode === "point" || drawMode === "polygon" || drawMode === "line" || drawMode === "radius") ? "crosshair" : "";
  }, [drawMode]);

  // ── Live distance ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current || drawMode !== "line") { setLiveDistance(null); return; }
    const handler = () => {
      try {
        const active = draw.current?.getAll()?.features.find(f => f.geometry.type === "LineString");
        setLiveDistance(active && active.geometry.coordinates.length >= 2 ? lineDistance(active.geometry.coordinates) : null);
      } catch {}
    };
    map.current.on("mousemove", handler);
    return () => map.current?.off("mousemove", handler);
  }, [drawMode]);

  // ── Render markers ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    Object.values(markers.current).forEach(m => m.remove());
    markers.current = {};
    try { draw.current?.deleteAll(); } catch {}
    drawIdToFeatId.current = {};

    features.forEach(feat => {
      const ti = NETWORK_TYPE_MAP[feat.type] || NETWORK_TYPE_MAP.other;
      // In DC mode, substation markers are RAG-coloured by available capacity (MW).
      const isSubType = SUBSTATION_TYPES.includes(feat.type);
      const markerColor = (dcMode && isSubType) ? (capacityRagColor(feat.capacity_mw) || RAG_NONE) : ti.color;
      // Radius circles render via the dedicated `user-radius` Mapbox layer (so each
      // one gets its own colour). Skip them here.
      if (feat.type === "radius") return;
      if (feat.geojson) {
        try {
          const ids = draw.current?.add(feat.geojson);
          if (ids?.[0]) drawIdToFeatId.current[ids[0]] = feat.id;
        } catch {}
        return;
      }
      if (!feat.lat || !feat.lng) return;
      const el = document.createElement("div");
      const isGSP = feat.type === "gsp";
      const isSub = SUBSTATION_TYPES.includes(feat.type);

      if (isSub) {
        // Substation marker — insulators on top, body with warning triangle
        el.style.cssText = `width:30px;height:36px;background:${markerColor};border:2px solid #fff;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;`;
        el.innerHTML = `<svg width="22" height="30" viewBox="0 0 22 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Left insulator -->
          <rect x="4.5" y="0.5" width="3" height="9" rx="1" fill="white"/>
          <rect x="3" y="2.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <rect x="3" y="5.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <!-- Right insulator -->
          <rect x="14.5" y="0.5" width="3" height="9" rx="1" fill="white"/>
          <rect x="13" y="2.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <rect x="13" y="5.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <!-- Body -->
          <rect x="1" y="10" width="20" height="19" rx="2" fill="none" stroke="white" stroke-width="1.5"/>
          <!-- Warning triangle -->
          <path d="M11 13 L17 23 L5 23 Z" stroke="white" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
          <!-- Lightning bolt -->
          <path d="M11.8 15 L9.5 19 L11.2 19 L10.2 22 L12.5 18 L10.8 18 Z" fill="white"/>
        </svg>`;
      } else if (isGSP) {
        el.style.cssText = `width:22px;height:22px;background:${markerColor};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);cursor:pointer;transform:rotate(45deg);`;
      } else {
        el.style.cssText = `width:22px;height:22px;background:${markerColor};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);cursor:pointer;border-radius:4px;`;
      }
      el.title = feat.name || ti.label;
      el.addEventListener("click", ev => {
        ev.stopPropagation();
        // Embedded overview: read-only. A substation click bubbles up so the host
        // can jump to the full Network Map; other features do nothing.
        if (embeddedRef.current) {
          if (dcMode && isSub && !feat.substation_id) onOpenSubstationRef.current?.(feat);
          return;
        }
        // DC: clicking a top-level substation opens its Parcels/Leads drill-down;
        // everything else (parcels, lines, radii) opens the edit panel.
        if (dcMode && isSub && !feat.substation_id) { setSelectedSub(feat); setSubTab("leads"); }
        else { setSelectedFeature(feat); setPanelOpen(true); }
      });
      markers.current[feat.id] = new mapboxgl.Marker({ element: el }).setLngLat([feat.lng, feat.lat]).addTo(map.current);
    });
  }, [features, dcMode]);

  // Push the current list of radius features into the user-radius source.
  // Pass `list` explicitly when state may not have flushed yet (e.g. right
  // after a save). Retries on style.load if the source isn't ready yet.
  // Declared above the useEffect that uses it so the dep-array reference
  // isn't a temporal-dead-zone error (the bug NetworkMap blanked on).
  const refreshUserRadius = useCallback((list) => {
    if (!map.current) return;
    const data = list || featuresRef.current;
    const circles = data
      .filter(f => f.type === "radius" && f.lat != null && f.lng != null && f.radius_km != null)
      .map(f => makeCircleGeoJSON(
        f.lng, f.lat, Number(f.radius_km),
        { feature_id: f.id, color: f.color || NETWORK_TYPE_MAP.radius.color, name: f.name || "" },
      ));
    const apply = () => {
      ensureRadiusLayers();
      const src = map.current?.getSource("user-radius");
      if (!src) return false;
      src.setData({ type: "FeatureCollection", features: circles });
      return true;
    };
    if (apply()) return;
    // Style not loaded yet — wait for the next style.load and retry once
    map.current.once("style.load", () => { apply(); });
  }, [ensureRadiusLayers]);

  // ── Capacity radius circles — update source data whenever features change ──────
  // Sources/layers are initialised by the persistent style.load handler in map init
  useEffect(() => {
    if (!map.current) return;
    CAPACITY_OPTIONS.forEach(opt => {
      if (opt.radiusKm === 0) return;
      const srcId = `radius-${opt.value.replace(/[^a-z0-9]/gi, "")}`;
      const source = map.current.getSource(srcId);
      if (!source) return; // Not ready yet — style.load handler will seed with featuresRef
      const circles = features
        .filter(f => f.lat && f.lng && f.capacity === opt.value && SUBSTATION_TYPES.includes(f.type))
        .map(f => makeCircleGeoJSON(f.lng, f.lat, opt.radiusKm));
      source.setData({ type: "FeatureCollection", features: circles });
    });

    // User-drawn radius circles — robust against style-not-loaded races
    refreshUserRadius(features);
  }, [features, refreshUserRadius]);

  // ── Activate draw ────────────────────────────────────────────────────────────
  const activateDraw = useCallback((mode) => {
    setLiveDistance(null);
    if (mode === "polygon") draw.current?.changeMode("draw_polygon");
    else if (mode === "line") draw.current?.changeMode("draw_line_string");
    else draw.current?.changeMode("simple_select"); // includes "radius" + "point" — those use plain map clicks, not mapbox-draw
    setDrawMode(mode);
  }, []);

  // Live preview from the AnnotationPanel as the user tweaks radius / colour.
  // Lazy-inits the layer so we never silently no-op on a missing source.
  const handleRadiusPreview = useCallback(({ lat, lng, radius_km, color }) => {
    if (!map.current || lat == null || lng == null || radius_km == null) return;
    if (!ensureRadiusLayers()) return; // style still loading; will be drawn after save
    map.current.getSource("user-radius-preview")
      ?.setData(makeCircleGeoJSON(lng, lat, radius_km, { color: color || NETWORK_TYPE_MAP.radius.color }));
  }, [ensureRadiusLayers]);

  // ── Merge user-added substations into a reference layer's GeoJSON ────────────
  const mergeUserIntoLayer = useCallback((layerId, baseGeojson) => {
    const matchingTypes = Object.entries(TYPE_TO_LAYER)
      .filter(([, lid]) => lid === layerId).map(([t]) => t);
    if (matchingTypes.length === 0) return baseGeojson;
    const userPoints = featuresRef.current
      .filter(f => matchingTypes.includes(f.type) && f.lat && f.lng)
      .map(f => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.lng, f.lat] },
        properties: { name: f.name || NETWORK_TYPE_MAP[f.type]?.label || f.type, user_added: true, feature_id: f.id },
      }));
    return { type: "FeatureCollection", features: [...(baseGeojson?.features || []), ...userPoints] };
  }, []);

  // ── WFS layers ───────────────────────────────────────────────────────────────
  const addWFSLayer = useCallback((id, geojson) => {
    if (!map.current) return;
    const layer = WFS_LAYERS.find(l => l.id === id);
    if (!layer) return;
    const merged = mergeUserIntoLayer(id, geojson);
    if (map.current.getSource(id)) { map.current.getSource(id).setData(merged); return; }
    map.current.addSource(id, { type: "geojson", data: merged });
    if (layer.isPolygon) {
      const fillColor = layer.colorByDno ? DNO_FILL_MATCH : layer.color;
      const labelField = layer.labelField || "gsp";
      map.current.addLayer({ id: `${id}-fill`, type: "fill", source: id, paint: { "fill-color": fillColor, "fill-opacity": layer.colorByDno ? 0.12 : 0.08 } });
      map.current.addLayer({ id: `${id}-stroke`, type: "line", source: id, paint: { "line-color": fillColor, "line-width": layer.colorByDno ? 1.8 : 1.5, "line-opacity": 0.7 } });
      map.current.addLayer({ id: `${id}-label`, type: "symbol", source: id, layout: { "text-field": ["get", labelField], "text-size": 11, "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"] }, paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.5 } });
      map.current.on("click", `${id}-fill`, e => { const p = e.features[0].properties; const title = p[labelField] || p.gsp || p.name || ""; const sub = layer.colorByDno ? (p.dno_full || p.dno || "") : ""; new mapboxgl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat).setHTML(`<div style="padding:14px 16px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${layer.color};margin-bottom:4px">${layer.label}</div><div style="font-size:15px;font-weight:700;color:#fff">${title}</div>${sub ? `<div style="font-size:11px;color:#cbd5e1;margin-top:2px">${sub}</div>` : ""}</div>`).addTo(map.current); });
      map.current.on("mouseenter", `${id}-fill`, () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", `${id}-fill`, () => { map.current.getCanvas().style.cursor = drawMode ? "crosshair" : ""; });
    } else {
      map.current.addLayer({ id: `${id}-circle`, type: "circle", source: id, paint: { "circle-radius": 6, "circle-color": layer.color, "circle-opacity": 0.85, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" } });
      map.current.addLayer({ id: `${id}-label`, type: "symbol", source: id, layout: { "text-field": ["get", "name"], "text-size": 10, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1 }, minzoom: 10 });
      map.current.on("click", `${id}-circle`, e => { const p = e.features[0].properties; new mapboxgl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat).setHTML(`<div style="padding:14px 16px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${layer.color};margin-bottom:4px">${layer.label}</div><div style="font-size:14px;font-weight:700;color:#fff">${p.name || "Substation"}</div></div>`).addTo(map.current); });
      map.current.on("mouseenter", `${id}-circle`, () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", `${id}-circle`, () => { map.current.getCanvas().style.cursor = drawMode ? "crosshair" : ""; });
    }
  }, [mergeUserIntoLayer]);

  const toggleWFSLayer = useCallback(async (id) => {
    const next = new Set(activeLayers);
    if (next.has(id)) {
      next.delete(id);
      ["-fill", "-stroke", "-circle", "-label"].forEach(s => { if (map.current?.getLayer(`${id}${s}`)) map.current.removeLayer(`${id}${s}`); });
      if (map.current?.getSource(id)) map.current.removeSource(id);
    } else {
      next.add(id);
      if (!layerData[id]) {
        setLayerLoading(p => ({ ...p, [id]: true }));
        try { const res = await fetch(WFS_LAYERS.find(l => l.id === id).file); const data = await res.json(); setLayerData(p => ({ ...p, [id]: data })); addWFSLayer(id, data); } catch { next.delete(id); }
        setLayerLoading(p => ({ ...p, [id]: false }));
      } else { addWFSLayer(id, layerData[id]); }
    }
    setActiveLayers(next);
  }, [activeLayers, layerData, addWFSLayer]);

  // DC: load the DNO regions overlay on mount (default on). Placed after
  // addWFSLayer is defined to avoid a temporal-dead-zone on the deps array.
  useEffect(() => {
    if (!dcMode) return;
    let cancelled = false;
    (async () => {
      const layer = WFS_LAYERS.find(l => l.id === "dno");
      try {
        const res = await fetch(layer.file);
        const data = await res.json();
        if (cancelled) return;
        dnoGeoRef.current = data;
        setLayerData(p => ({ ...p, dno: data }));
        const apply = () => addWFSLayer("dno", data);
        if (map.current?.isStyleLoaded()) apply();
        else map.current?.once("style.load", apply);
      } catch { /* overlay is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [dcMode, addWFSLayer]);

  // ── Sync user features into active reference layers when features change ──────
  useEffect(() => {
    if (!map.current) return;
    activeLayers.forEach(layerId => {
      const layer = WFS_LAYERS.find(l => l.id === layerId);
      if (!layer || layer.isPolygon) return;
      const source = map.current.getSource(layerId);
      if (!source || !layerData[layerId]) return;
      source.setData(mergeUserIntoLayer(layerId, layerData[layerId]));
    });
  }, [features, activeLayers, layerData, mergeUserIntoLayer]);

  // ── Save / delete ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async ({ name, notes, type, capacity, capacity_mw, tia, color, radius_km, status, dno, dno_reference, connection_cost, contact, next_action }) => {
    if (!selectedFeature) return;
    const isRadius = type === "radius";
    // For radius features we (re)generate the geojson from centre + radius_km so
    // edits to either always stay in sync with what's drawn.
    const geojson = isRadius
      ? makeCircleGeoJSON(selectedFeature.lng, selectedFeature.lat, radius_km, { color })
      : selectedFeature.geojson || null;
    // Opportunity fields only exist on the DC table — omit for Greenfield.
    // New features drawn while a substation is selected become its parcels.
    const parcelLink = dcMode
      ? { substation_id: selectedFeature.substation_id ?? (!selectedFeature.id && selectedSub ? selectedSub.id : null) }
      : {};
    const opp = dcMode ? {
      status: status || null, dno: dno || null, dno_reference: dno_reference || null,
      connection_cost: connection_cost || null,
      contact: contact || null, next_action: next_action || null,
      ...parcelLink,
    } : {};
    const payload = {
      name, notes, type,
      capacity: capacity || null,
      capacity_mw: capacity_mw ?? null,
      tia: tia || false,
      color: color || null,
      radius_km: radius_km ?? null,
      lat: selectedFeature.lat || null,
      lng: selectedFeature.lng || null,
      geojson,
      created_by: userId,
      ...opp,
    };
    if (selectedFeature.id) {
      const { error } = await supabase.from(table).update({
        name, notes, type,
        capacity: capacity || null,
        capacity_mw: capacity_mw ?? null,
        tia: tia || false,
        color: color || null,
        radius_km: radius_km ?? null,
        geojson, // re-render in case radius changed
        ...opp,
      }).eq("id", selectedFeature.id);
      if (error) console.error("Failed to update network_feature:", error);
    } else {
      const { error } = await supabase.from(table).insert(payload);
      if (error) console.error("Failed to insert network_feature:", error);
    }
    const fresh = await loadFeatures();
    // Keep the drill-down substation in sync with the values just saved.
    if (selectedSub && selectedFeature.id === selectedSub.id) {
      const updated = fresh.find(f => f.id === selectedSub.id);
      if (updated) setSelectedSub(updated);
    }
    // Push radii into the source immediately — don't wait for the React effect
    // (closes the race when the source was just created on style.load).
    if (isRadius) refreshUserRadius(fresh);
    // Clear any preview circle
    map.current?.getSource?.("user-radius-preview")?.setData({ type: "FeatureCollection", features: [] });
    // Auto-enable the matching reference layer for substation types (Greenfield
    // only — on the DC map it floods the view, so the 11kV layer stays a manual toggle).
    const matchedLayer = TYPE_TO_LAYER[type];
    if (!dcMode && matchedLayer && !activeLayers.has(matchedLayer)) {
      await toggleWFSLayer(matchedLayer);
    }
    setPanelOpen(false); setSelectedFeature(null);
  }, [selectedFeature, userId, table, dcMode, selectedSub, loadFeatures, toggleWFSLayer, activeLayers, refreshUserRadius]);

  const handleDelete = useCallback(async () => {
    if (!selectedFeature?.id) return;
    await supabase.from(table).delete().eq("id", selectedFeature.id);
    if (selectedFeature.geojson) try { draw.current?.delete(selectedFeature.geojson.id); } catch {}
    await loadFeatures(); setPanelOpen(false); setSelectedFeature(null);
  }, [selectedFeature, table, loadFeatures]);

  // ── Substation drill-down (DC): Leads under the selected substation ──────────
  const loadSubLeads = useCallback(async (subId) => {
    if (!subId) { setSubLeads([]); return; }
    const { data } = await supabase.from("dc_substation_leads").select("*").eq("substation_id", subId).order("created_at", { ascending: false });
    setSubLeads(data || []);
  }, []);
  useEffect(() => { loadSubLeads(selectedSub?.id); }, [selectedSub?.id, loadSubLeads, refreshKey]);

  const addSubLead = useCallback(async () => {
    const name = newLeadName.trim();
    if (!name || !selectedSub?.id) return;
    const { error } = await supabase.from("dc_substation_leads").insert({ substation_id: selectedSub.id, name, status: "new", created_by: userId });
    if (error) { console.error("Failed to add lead:", error); return; }
    setNewLeadName("");
    loadSubLeads(selectedSub.id);
  }, [newLeadName, selectedSub?.id, userId, loadSubLeads]);

  // Grid surgeries under the selected substation (requested → held)
  const loadSurgeries = useCallback(async (subId) => {
    if (!subId) { setSubSurgeries([]); return; }
    const { data } = await supabase.from("dc_grid_surgeries").select("*").eq("substation_id", subId).order("requested_at", { ascending: false });
    setSubSurgeries(data || []);
  }, []);
  useEffect(() => { loadSurgeries(selectedSub?.id); }, [selectedSub?.id, loadSurgeries]);

  const requestSurgery = useCallback(async () => {
    if (!selectedSub?.id) return;
    const { error } = await supabase.from("dc_grid_surgeries").insert({ substation_id: selectedSub.id, dno: selectedSub.dno || null, status: "requested", created_by: userId });
    if (error) { console.error("Failed to request surgery:", error); return; }
    loadSurgeries(selectedSub.id);
  }, [selectedSub?.id, selectedSub?.dno, userId, loadSurgeries]);

  const markSurgeryHeld = useCallback(async (id) => {
    // Completing a grid surgery requires the substation to be fully qualified.
    const sub = features.find(f => f.id === selectedSub?.id) || selectedSub;
    const missing = [];
    if (!sub?.notes?.trim())           missing.push("Notes");
    if (!sub?.dno_reference?.trim())   missing.push("DNO reference");
    if (!sub?.connection_cost?.trim()) missing.push("Indicative Connection Cost");
    if (!sub?.contact?.trim())         missing.push("DNO Contact");
    if (missing.length) { setSurgeryNotice(missing); return; }
    const { error } = await supabase.from("dc_grid_surgeries").update({ status: "held", held_at: new Date().toISOString().slice(0, 10) }).eq("id", id);
    if (error) { console.error("Failed to mark complete:", error); return; }
    loadSurgeries(selectedSub?.id);
  }, [selectedSub, features, loadSurgeries]);

  const deleteSurgery = useCallback(async (id) => {
    const { error } = await supabase.from("dc_grid_surgeries").delete().eq("id", id);
    if (error) { console.error("Failed to delete surgery:", error); return; }
    loadSurgeries(selectedSub?.id);
  }, [selectedSub?.id, loadSurgeries]);

  // ── Shared styles ────────────────────────────────────────────────────────────
  const SBL = { fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: theme.textTertiary, marginBottom: 7 };
  const sideBtn = (active, color = "#8b5cf6") => ({
    width: "100%", padding: "7px 12px", fontSize: 11, borderRadius: 7, cursor: "pointer", textAlign: "left",
    background: active ? color + "22" : theme.pillBg, border: `1px solid ${active ? color : theme.border}`,
    color: active ? color : theme.textSecondary, fontWeight: active ? 700 : 400,
    fontFamily: "'Inter', system-ui, sans-serif", transition: "all 0.1s",
  });

  const pointFeatures = features.filter(f => !f.geojson);
  const lineFeatures  = features.filter(f => f.geojson?.geometry?.type === "LineString");
  const subParcels    = selectedSub ? features.filter(f => f.substation_id === selectedSub.id) : [];

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Sidebar (hidden in embedded overview mode) ─────────────────────── */}
      {!embedded && (
      <div style={{ width: 290, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${theme.border}`, background: theme.pageBg, overflow: "hidden", position: "relative" }}>

        {/* ── Substation drill-down overlay (Parcels + Leads) ───────────────── */}
        {dcMode && selectedSub && (
          <div style={{ position: "absolute", inset: 0, zIndex: 6, background: theme.pageBg, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${theme.border}` }}>
              <button onClick={() => setSelectedSub(null)} style={{ ...sideBtn(false), width: "auto", padding: "3px 8px", fontSize: 10, marginBottom: 8 }}>← Back</button>
              <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, lineHeight: 1.2 }}>{selectedSub.name || "Substation"}</div>
              <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedSub.capacity_mw != null && <span>{selectedSub.capacity_mw} MW</span>}
                {selectedSub.dno && <span>{selectedSub.dno}</span>}
                {selectedSub.status && <span>{selectedSub.status}</span>}
              </div>
              <button onClick={() => { setSelectedFeature(selectedSub); setPanelOpen(true); }} style={{ ...sideBtn(false), fontSize: 10, marginTop: 8 }}>✎ Edit substation details</button>
            </div>
            {/* Parcels / Leads subtabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}` }}>
              {[["leads", `Leads (${subLeads.length})`], ["parcels", `Parcels (${subParcels.length})`], ["surgery", `Grid Surgery (${subSurgeries.length})`]].map(([key, label]) => (
                <button key={key} onClick={() => setSubTab(key)} style={{ flex: 1, padding: "8px 2px", fontSize: 10, fontWeight: subTab === key ? 700 : 500, color: subTab === key ? theme.textPrimary : theme.textTertiary, background: "none", border: "none", borderBottom: subTab === key ? "2px solid #8b5cf6" : "2px solid transparent", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>{label}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
              {subTab === "leads" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={newLeadName} onChange={e => setNewLeadName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addSubLead(); }} placeholder="New lead name…"
                      style={{ flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "6px 8px", fontSize: 11, outline: "none", fontFamily: "'Inter', system-ui, sans-serif" }} />
                    <button onClick={addSubLead} style={{ ...sideBtn(false), width: "auto", padding: "6px 10px" }}>Add</button>
                  </div>
                  {subLeads.length === 0 && <div style={{ fontSize: 11, color: theme.textMuted, padding: "8px 0" }}>No leads yet.</div>}
                  {subLeads.map(ld => (
                    <div key={ld.id} onClick={() => onOpenLead?.(ld, selectedSub)}
                      style={{ padding: "8px 10px", borderRadius: 7, background: theme.pillBg, border: `1px solid ${theme.border}`, cursor: "pointer" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{ld.name}</div>
                      <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{ld.status || "new"}{ld.company ? ` · ${ld.company}` : ""}</div>
                    </div>
                  ))}
                </div>
              )}
              {subTab === "parcels" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button onClick={() => activateDraw("polygon")} style={{ ...sideBtn(drawMode === "polygon", "#22c55e") }}>⬡ Draw parcel (area)</button>
                  <div style={{ fontSize: 9, color: theme.textMuted }}>New areas/markers you draw now are linked to this substation.</div>
                  {subParcels.length === 0 && <div style={{ fontSize: 11, color: theme.textMuted, padding: "8px 0" }}>No parcels yet.</div>}
                  {subParcels.map(pc => (
                    <div key={pc.id} onClick={() => {
                        setSelectedFeature(pc); setPanelOpen(true);
                        let c = pc.lat != null && pc.lng != null ? [pc.lng, pc.lat] : null;
                        if (!c && pc.geojson) { let sx = 0, sy = 0, n = 0; const visit = a => { if (typeof a[0] === "number") { sx += a[0]; sy += a[1]; n++; } else a.forEach(visit); }; try { visit(pc.geojson.geometry.coordinates); } catch { /* */ } if (n) c = [sx / n, sy / n]; }
                        if (c) map.current?.flyTo({ center: c, zoom: 14, duration: 600 });
                      }}
                      style={{ padding: "8px 10px", borderRadius: 7, background: theme.pillBg, border: `1px solid ${theme.border}`, cursor: "pointer" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{pc.name || "Parcel"}</div>
                      <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{NETWORK_TYPE_MAP[pc.type]?.label || pc.type}</div>
                    </div>
                  ))}
                </div>
              )}
              {subTab === "surgery" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button onClick={requestSurgery} style={{ ...sideBtn(false, "#f59e0b") }}>+ Request grid surgery</button>
                  {subSurgeries.length === 0 && <div style={{ fontSize: 11, color: theme.textMuted, padding: "8px 0" }}>No grid surgeries yet.</div>}
                  {subSurgeries.map(gs => (
                    <div key={gs.id} style={{ padding: "8px 10px", borderRadius: 7, background: theme.pillBg, border: `1px solid ${theme.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: gs.status === "held" ? "#10b981" : "#f59e0b" }}>{gs.status === "held" ? "Complete" : "Requested"}</span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {gs.status !== "held" && <button onClick={() => markSurgeryHeld(gs.id)} style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 5, border: `1px solid ${theme.border}`, background: theme.surfaceBg || theme.pillBg, color: theme.textSecondary, cursor: "pointer" }}>Mark as complete</button>}
                          <button onClick={() => deleteSurgery(gs.id)} title="Cancel / delete" style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, border: "1px solid #ef444455", background: "#ef444414", color: "#ef4444", cursor: "pointer", lineHeight: 1 }}>✕</button>
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3 }}>Requested {gs.requested_at || "—"}{gs.held_at ? ` · Completed ${gs.held_at}` : ""}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          {[["tools", "Tools"], ["features", `Features (${features.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setSidebarTab(key)} style={{ flex: 1, padding: "8px 2px", fontSize: 10, fontWeight: sidebarTab === key ? 700 : 500, color: sidebarTab === key ? theme.textPrimary : theme.textTertiary, background: "none", border: "none", borderBottom: sidebarTab === key ? "2px solid #8b5cf6" : "2px solid transparent", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 14 }}>

          {/* TOOLS */}
          {sidebarTab === "tools" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={SBL}>Draw Tools</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <button onClick={() => activateDraw("point")}   style={sideBtn(drawMode === "point")}>+ Drop Marker</button>
                  <button onClick={() => activateDraw("polygon")} style={sideBtn(drawMode === "polygon")}>⬡ Draw Area</button>
                  <button onClick={() => activateDraw("line")}    style={sideBtn(drawMode === "line", "#f97316")}>— Draw Line / Cable</button>
                  <button onClick={() => activateDraw("radius")}  style={sideBtn(drawMode === "radius", NETWORK_TYPE_MAP.radius.color)}>◯ Draw Radius</button>
                  {drawMode && (
                    <button onClick={() => activateDraw(null)} style={{ ...sideBtn(false), color: theme.textTertiary, fontSize: 10 }}>✕ Cancel drawing</button>
                  )}
                </div>
              </div>

              <div>
                <div style={SBL}>Map Style</div>
                <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 2, gap: 2 }}>
                  {[["streets", "Road"], ["satellite-streets", "Satellite"]].map(([key, label]) => (
                    <button key={key} onClick={() => setMapStyle(key)} style={{ flex: 1, fontSize: 10, padding: "5px 0", borderRadius: 6, cursor: "pointer", background: mapStyle === key ? theme.pillActiveBg : "transparent", color: mapStyle === key ? theme.pillActiveText : theme.pillInactiveText, border: mapStyle === key ? `1px solid ${theme.pillBorder}` : "1px solid transparent", fontWeight: mapStyle === key ? 700 : 400, fontFamily: "'Inter', system-ui, sans-serif" }}>{label}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={SBL}>Reference Layers</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {referenceLayers.map(layer => {
                    const active = activeLayers.has(layer.id);
                    const loading = layerLoading[layer.id];
                    return (
                      <button key={layer.id} onClick={() => toggleWFSLayer(layer.id)} disabled={loading} style={{ padding: "6px 10px", fontSize: 10, borderRadius: 7, cursor: loading ? "not-allowed" : "pointer", background: active ? layer.color + "22" : theme.pillBg, border: `1px solid ${active ? layer.color : theme.border}`, color: active ? layer.color : theme.textSecondary, fontWeight: active ? 700 : 400, opacity: loading ? 0.6 : 1, fontFamily: "'Inter', system-ui, sans-serif", display: "flex", alignItems: "center", gap: 7, textAlign: "left" }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />
                        {loading ? "Loading…" : layer.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div>
                <div style={SBL}>Legend</div>
                {NETWORK_TYPES.map(t => (
                  <div key={t.value} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                    <div style={{
                      width: 10, height: 10,
                      background: t.shape === "circle" ? "transparent" : t.color,
                      border: t.shape === "circle" ? `2px solid ${t.color}` : "none",
                      borderRadius: t.shape === "line" ? 2 : t.shape === "circle" ? "50%" : t.value === "gsp" ? 0 : 3,
                      transform: t.value === "gsp" ? "rotate(45deg)" : "none",
                      flexShrink: 0,
                      boxSizing: "border-box",
                    }} />
                    <div style={{ fontSize: 10, color: theme.textSecondary }}>{t.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FEATURES */}
          {sidebarTab === "features" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {features.length === 0 ? (
                <div style={{ fontSize: 11, color: theme.textTertiary, textAlign: "center", padding: "24px 8px", lineHeight: 1.6 }}>No features yet.<br />Use Tools to start mapping the network.</div>
              ) : features.map(feat => {
                const ti = NETWORK_TYPE_MAP[feat.type] || NETWORK_TYPE_MAP.other;
                return (
                  <div key={feat.id}
                    style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "7px 8px", display: "flex", alignItems: "center", gap: 6 }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = ti.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor = theme.border}>
                    <div style={{ width: 8, height: 8, background: ti.color, borderRadius: ti.shape === "line" ? 2 : 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => { setSelectedFeature(feat); setPanelOpen(true); if (feat.lat && feat.lng) map.current?.flyTo({ center: [feat.lng, feat.lat], zoom: 13, duration: 600 }); }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: theme.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{feat.name || "(unnamed)"}</div>
                      <div style={{ fontSize: 10, color: theme.textTertiary }}>{ti.label}</div>
                    </div>
                    <button onClick={async () => {
                      if (!confirm(`Delete "${feat.name || "this feature"}"?`)) return;
                      await supabase.from(table).delete().eq("id", feat.id);
                      if (feat.geojson) try { draw.current?.delete(feat.geojson.id); } catch {}
                      if (selectedFeature?.id === feat.id) { setPanelOpen(false); setSelectedFeature(null); }
                      await loadFeatures();
                    }} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textTertiary, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

        {/* Coordinate jump-to search (hidden in embedded overview) */}
        {!embedded && (
          <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 5, display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", borderRadius: 8, padding: "6px 8px", boxShadow: "0 2px 10px rgba(0,0,0,0.35)" }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>📍</span>
            <input
              value={coordInput}
              onChange={e => { setCoordInput(e.target.value); if (coordErr) setCoordErr(false); }}
              onKeyDown={e => { if (e.key === "Enter") goToCoords(); }}
              placeholder="lat, lng — e.g. 52.4862, -1.8904"
              style={{ width: 210, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", borderBottom: `1px solid ${coordErr ? "#ef4444" : "transparent"}` }}
            />
            <button onClick={goToCoords} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Go</button>
          </div>
        )}

        {/* Draw hint */}
        {drawMode && (
          <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.8)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 12, pointerEvents: "none", zIndex: 5, display: "flex", alignItems: "center", gap: 10 }}>
            <span>
              {drawMode === "point"   && "Click to drop a network marker"}
              {drawMode === "polygon" && "Click to draw area — double-click to finish"}
              {drawMode === "line"    && "Click to trace cable / line — double-click to finish"}
              {drawMode === "radius"  && "Click to drop a radius — adjust size & colour in the panel"}
            </span>
            {drawMode === "line" && liveDistance != null && (
              <span style={{ background: "#f97316", color: "#fff", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{liveDistance.toFixed(2)} km</span>
            )}
          </div>
        )}

        {/* Feature count badge */}
        <div style={{ position: "absolute", top: 10, right: panelOpen ? 296 : 10, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", borderRadius: 8, padding: "6px 12px", zIndex: 5, transition: "right 0.2s", display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#8b5cf6" }} />
          <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{features.length} network feature{features.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Substation details dialog (DC) — opens on select, next to the sidebar */}
        {dcMode && selectedSub && subDialogOpen && !panelOpen && (
          <div style={{ position: "absolute", top: 12, left: 12, width: 260, background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.5)", zIndex: 6, fontFamily: "'Inter', system-ui, sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedSub.name || "Substation"}</div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => { setSelectedFeature(selectedSub); setPanelOpen(true); }} style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 5, border: `1px solid ${theme.accent}55`, background: theme.accent + "18", color: theme.accent, cursor: "pointer" }}>✎ Edit</button>
                <button onClick={() => setSubDialogOpen(false)} style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 14, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
            </div>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
              {(() => {
                const rag = capacityRagColor(selectedSub.capacity_mw);
                const sc = DC_STATUS_COLORS[selectedSub.status] || theme.textMuted;
                const rows = [
                  ["Capacity", selectedSub.capacity_mw != null ? `${selectedSub.capacity_mw} MW` : "—", rag],
                  ["Status", selectedSub.status || "—", sc],
                  ["DNO", selectedSub.dno || "—"],
                  ["DNO ref", selectedSub.dno_reference || "—"],
                  ["Conn. cost", selectedSub.connection_cost || "—"],
                  ["Contact", selectedSub.contact || "—"],
                  ["Next action", selectedSub.next_action || "—"],
                ];
                return rows.map(([k, v, dot]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
                    <span style={{ color: theme.textTertiary }}>{k}</span>
                    <span style={{ color: dot || theme.textPrimary, fontWeight: 600, textAlign: "right", display: "flex", alignItems: "center", gap: 5 }}>
                      {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />}{v}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Annotation panel */}
        {panelOpen && selectedFeature && (
          <AnnotationPanel feature={selectedFeature} theme={theme} dcMode={dcMode}
            onSave={handleSave} onDelete={handleDelete}
            onRadiusPreview={handleRadiusPreview}
            onClose={() => {
              map.current?.getSource?.("user-radius-preview")?.setData({ type: "FeatureCollection", features: [] });
              setPanelOpen(false); setSelectedFeature(null);
            }} />
        )}

        {/* Missing-fields notice when completing a grid surgery */}
        {surgeryNotice && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <div style={{ width: 340, background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, marginBottom: 8 }}>Complete the substation details first</div>
              <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.5, marginBottom: 12 }}>
                Before marking this grid surgery as complete, please add the following to the substation details:
              </div>
              <ul style={{ margin: "0 0 16px", paddingLeft: 18, fontSize: 12, color: theme.textPrimary }}>
                {surgeryNotice.map(m => <li key={m} style={{ marginBottom: 4 }}>{m}</li>)}
              </ul>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setSurgeryNotice(null)} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textSecondary, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Close</button>
                <button onClick={() => { setSurgeryNotice(null); setSelectedFeature(selectedSub); setPanelOpen(true); }} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: theme.accent, color: "#fff", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Edit details</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
