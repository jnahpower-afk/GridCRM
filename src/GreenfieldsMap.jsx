import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";
import { NETWORK_TYPES, NETWORK_TYPE_MAP, SUBSTATION_TYPES, CAPACITY_MAP } from "./NetworkMap.jsx";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── Constants ────────────────────────────────────────────────────────────────

const PIN_TYPES = [
  { value: "land_parcel",   label: "Land Parcel",  color: "#22c55e" },
  { value: "landowner",     label: "Landowner",    color: "#f59e0b" },
  { value: "gsp",           label: "GSP",          color: "#8b5cf6" },
  { value: "substation",    label: "Substation",   color: "#3b82f6" },
  { value: "constraint",    label: "Constraint",   color: "#ef4444" },
  { value: "site_visit",    label: "Site Visit",   color: "#06b6d4" },
  { value: "cable_route",   label: "Cable Route",  color: "#f97316" },
  { value: "radius_circle", label: "Radius",       color: "#94a3b8" },
  { value: "other",         label: "Other",        color: "#64748b" },
];

const LEAD_STATUSES = [
  { value: "new",         label: "New",         color: "#6366f1" },
  { value: "contacted",   label: "Contacted",   color: "#3b82f6" },
  { value: "interested",  label: "Interested",  color: "#06b6d4" },
  { value: "negotiating", label: "Negotiating", color: "#f59e0b" },
  { value: "agreed",      label: "Agreed",      color: "#10b981" },
  { value: "dead",        label: "Dead",        color: "#94a3b8" },
];

const LEAD_STATUS_MAP = Object.fromEntries(LEAD_STATUSES.map(s => [s.value, s]));
const TYPE_MAP = Object.fromEntries(PIN_TYPES.map(t => [t.value, t]));

const WFS_LAYERS = [
  { id: "sub132", label: "132kV Substations", color: "#8b5cf6", file: "/sub132.geojson" },
  { id: "sub33",  label: "33kV Substations",  color: "#3b82f6", file: "/sub33.geojson"  },
  { id: "gsp",    label: "GSP Regions",       color: "#f59e0b", file: "/gsp_regions.geojson", isPolygon: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCircleGeoJSON(centerLng, centerLat, radiusKm) {
  const steps = 64;
  const d = radiusKm / 6371;
  const lat1 = centerLat * Math.PI / 180;
  const lon1 = centerLng * Math.PI / 180;
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] },
    // radius_circle:true is used by MapboxDraw styles to render differently
    properties: { radius_km: radiusKm, center: [centerLng, centerLat], radius_circle: true },
  };
}

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lineDistance(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return total;
}

function calcArea(geojson) {
  if (!geojson?.coordinates?.[0]) return null;
  const ring = geojson.coordinates[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1];
    area -= ring[i + 1][0] * ring[i][1];
  }
  const sqMeters = (Math.abs(area) / 2) * 111320 * (111320 * Math.cos(51.6 * Math.PI / 180));
  return sqMeters / 10000;
}

// Render (or update) a Mapbox GL source/layer that colours linked land-parcel
// polygons by their associated lead's status.
// Only runs when the map style is fully loaded — callers that run before the
// style is ready should defer via the style.load / idle event.
function applyLinkedParcelsOverlay(map, data) {
  if (!map || !map.isStyleLoaded()) return;
  try {
    if (map.getSource("linked-parcels")) {
      map.getSource("linked-parcels").setData(data);
    } else {
      map.addSource("linked-parcels", { type: "geojson", data });
      map.addLayer({ id: "linked-parcels-fill",   type: "fill", source: "linked-parcels", paint: { "fill-color": ["get", "lead_color"], "fill-opacity": 0.45 } });
      map.addLayer({ id: "linked-parcels-stroke", type: "line", source: "linked-parcels", paint: { "line-color": ["get", "lead_color"], "line-width": 3, "line-opacity": 1 } });
    }
  } catch (e) {
    console.warn("linked-parcels overlay error:", e);
  }
}

// ─── Annotation Panel ─────────────────────────────────────────────────────────

function AnnotationPanel({ pin, onSave, onDelete, onClose, theme }) {
  const [name, setName]     = useState(pin?.name || "");
  const [notes, setNotes]   = useState(pin?.notes || "");
  const [type, setType]     = useState(pin?.type || "land_parcel");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(pin?.name || "");
    setNotes(pin?.notes || "");
    setType(pin?.type || "land_parcel");
  }, [pin?.id]);

  const isRadius = type === "radius_circle" || pin?.type === "radius_circle";
  const isRoute  = type === "cable_route"   || pin?.type === "cable_route";
  const area = !isRadius && !isRoute && pin?.geojson?.geometry ? calcArea(pin.geojson.geometry) : null;
  const radiusKm  = pin?.geojson?.properties?.radius_km;
  const distanceKm = pin?.geojson?.properties?.distance_km;
  const isNew = !pin?.id;

  const handleSave = async () => { setSaving(true); await onSave({ name, notes, type }); setSaving(false); };

  const inp = {
    width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12,
    fontFamily: "'Inter', system-ui, sans-serif", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{
      position: "absolute", top: 8, right: 12, bottom: 12, width: 276,
      background: theme.pageBg, border: `1px solid ${theme.border}`,
      borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
      display: "flex", flexDirection: "column", zIndex: 10, overflow: "hidden",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>
          {isNew ? "New Annotation" : "Edit Annotation"}
        </div>
        <div onClick={onClose} style={{ cursor: "pointer", fontSize: 16, color: theme.textTertiary, padding: 2 }}>✕</div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {!isRadius && !isRoute && (
          <div>
            <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Type</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {PIN_TYPES.filter(t => !["radius_circle", "cable_route"].includes(t.value)).map(t => (
                <button key={t.value} onClick={() => setType(t.value)} style={{
                  fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
                  background: type === t.value ? t.color + "22" : theme.pillBg,
                  border: `1px solid ${type === t.value ? t.color : theme.border}`,
                  color: type === t.value ? t.color : theme.textSecondary,
                  fontWeight: type === t.value ? 700 : 400,
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}>{t.label}</button>
              ))}
            </div>
          </div>
        )}

        {isRadius && radiusKm && (
          <div style={{ background: "#94a3b822", border: "1px solid #94a3b844", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Radius</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>{radiusKm} km</div>
          </div>
        )}

        {isRoute && distanceKm != null && (
          <div style={{ background: "#f9731622", border: "1px solid #f9731644", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>Route Distance</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f97316", lineHeight: 1 }}>{distanceKm.toFixed(2)} km</div>
            <div style={{ fontSize: 11, color: "#f97316", opacity: 0.7, marginTop: 3 }}>{(distanceKm * 1000).toFixed(0)} metres</div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Name</div>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder={isRadius ? "e.g. 5km from Llanelli GSP" : "e.g. Llangennech Farm"}
            style={inp} />
        </div>

        {area != null && (
          <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Area</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary }}>{area.toFixed(1)} ha</div>
            <div style={{ fontSize: 10, color: theme.textTertiary }}>≈ {(area * 2.471).toFixed(1)} acres</div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes, grid reference, contact details…"
            rows={4} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
        </div>
      </div>

      <div style={{ padding: "10px 14px", borderTop: `1px solid ${theme.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, background: theme.accent, color: "#fff", border: "none",
          borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: 600,
          cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>{saving ? "Saving…" : "Save"}</button>
        {!isNew && (
          <button onClick={onDelete} style={{
            background: theme.error + "22", color: theme.error,
            border: `1px solid ${theme.error}44`, borderRadius: 8,
            padding: "8px 12px", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif",
          }}>Delete</button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GreenfieldsMap({ initiative, session, onBack }) {
  const { theme } = useTheme();
  const mapContainer  = useRef(null);
  const map           = useRef(null);
  const draw          = useRef(null);
  const markers       = useRef({});
  const mapInit       = useRef(false);
  const previewDrawId   = useRef(null); // Draw feature id of unsaved radius preview
  const drawIdToPinId   = useRef({});   // maps Draw feature id → saved pin id
  const linkedParcelsRef = useRef({ type: "FeatureCollection", features: [] });

  const [mapStyle, setMapStyle]         = useState("satellite-streets");
  const [activeLayers, setActiveLayers] = useState(new Set());
  const [layerData, setLayerData]       = useState({});
  const [layerLoading, setLayerLoading] = useState({});
  const [pins, setPins]                 = useState([]);
  const [leads, setLeads]               = useState([]);
  const [selectedPin, setSelectedPin]   = useState(null);
  const [panelOpen, setPanelOpen]       = useState(false);
  const [drawMode, setDrawMode]         = useState(null);
  const [sidebarTab, setSidebarTab]     = useState("tools");
  const [radiusCenter, setRadiusCenter] = useState(null);
  const [radiusPicking, setRadiusPicking] = useState(false);
  const [customRadius, setCustomRadius] = useState("");
  const [liveDistance, setLiveDistance] = useState(null); // km while drawing a route
  const [networkFeatures, setNetworkFeatures] = useState([]);
  const [showNetworkLayer, setShowNetworkLayer] = useState(true);
  const networkMarkers = useRef({});
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [editingLead, setEditingLead]   = useState(null);
  const [leadForm, setLeadForm]         = useState({ name: "", company: "", phone: "", email: "", address: "", notes: "", status: "new", pin_id: "" });

  const STYLES = {
    "streets":           "mapbox://styles/mapbox/streets-v12",
    "satellite-streets": "mapbox://styles/mapbox/satellite-streets-v12",
  };

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadPins = useCallback(async () => {
    const { data } = await supabase.from("map_pins").select("*")
      .eq("initiative_id", initiative.id).order("created_at", { ascending: false });
    if (data) setPins(data);
  }, [initiative.id]);

  const loadLeads = useCallback(async () => {
    const { data } = await supabase.from("leads").select("*")
      .eq("initiative_id", initiative.id).order("created_at", { ascending: false });
    if (data) setLeads(data);
  }, [initiative.id]);

  useEffect(() => { loadPins(); loadLeads(); }, [loadPins, loadLeads]);

  // Load shared network features (not initiative-scoped)
  useEffect(() => {
    supabase.from("network_features").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setNetworkFeatures(data); });
  }, []);

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInit.current || !mapContainer.current) return;
    mapInit.current = true;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: STYLES[mapStyle],
      center: [-3.5, 51.65],
      zoom: 9,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-left");
    map.current.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      styles: [
        // ── Radius circles (grey dashed) — matched by user_radius_circle property
        { id: "gl-draw-radius-fill",          type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["==", "user_radius_circle", true]],  paint: { "fill-color": "#94a3b8", "fill-opacity": 0.06 } },
        { id: "gl-draw-radius-stroke",        type: "line", filter: ["all", ["==", "$type", "Polygon"], ["==", "user_radius_circle", true]],  paint: { "line-color": "#94a3b8", "line-width": 2, "line-dasharray": [4, 4] } },
        { id: "gl-draw-radius-fill-static",   type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"], ["==", "user_radius_circle", true]],  paint: { "fill-color": "#94a3b8", "fill-opacity": 0.06 } },
        { id: "gl-draw-radius-stroke-static", type: "line", filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"], ["==", "user_radius_circle", true]],  paint: { "line-color": "#94a3b8", "line-width": 2, "line-dasharray": [4, 4] } },
        // ── Land parcels — colour from linked lead status if set, else green
        { id: "gl-draw-polygon-fill",          type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"], ["!=", "user_radius_circle", true]], paint: { "fill-color": ["coalesce", ["get", "user_lead_color"], "#22c55e"], "fill-opacity": 0.15 } },
        { id: "gl-draw-polygon-stroke",        type: "line", filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"], ["!=", "user_radius_circle", true]], paint: { "line-color": ["coalesce", ["get", "user_lead_color"], "#22c55e"], "line-width": 2 } },
        { id: "gl-draw-polygon-fill-static",   type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"],  ["!=", "user_radius_circle", true]], paint: { "fill-color": ["coalesce", ["get", "user_lead_color"], "#22c55e"], "fill-opacity": 0.1 } },
        { id: "gl-draw-polygon-stroke-static", type: "line", filter: ["all", ["==", "$type", "Polygon"], ["==", "mode", "static"],  ["!=", "user_radius_circle", true]], paint: { "line-color": ["coalesce", ["get", "user_lead_color"], "#22c55e"], "line-width": 1.5 } },
        // ── Cable routes (orange dashed lines)
        { id: "gl-draw-line-active",  type: "line", filter: ["all", ["==", "$type", "LineString"], ["!=", "mode", "static"]], paint: { "line-color": "#f97316", "line-width": 2.5, "line-dasharray": [2, 2] } },
        { id: "gl-draw-line-static",  type: "line", filter: ["all", ["==", "$type", "LineString"], ["==", "mode", "static"]], paint: { "line-color": "#f97316", "line-width": 2, "line-dasharray": [4, 3] } },
        { id: "gl-draw-line-vertex",  type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"]], paint: { "circle-radius": 4, "circle-color": "#f97316", "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" } },
        // ── Point markers
        { id: "gl-draw-point-outer", type: "circle", filter: ["all", ["==", "$type", "Point"], ["!=", "meta", "vertex"]], paint: { "circle-radius": 6, "circle-color": "#fff", "circle-stroke-width": 2, "circle-stroke-color": "#22c55e" } },
      ],
    });
    map.current.addControl(draw.current);
    map.current.on("draw.create", (e) => {
      const f = e.features[0];
      // Ignore radius preview features added programmatically
      if (f.properties?.radius_circle) return;
      if (f.geometry.type === "LineString") {
        const dist = lineDistance(f.geometry.coordinates);
        setSelectedPin({ _drawId: f.id, geojson: { ...f, properties: { ...f.properties, distance_km: dist } }, type: "cable_route", name: "", notes: "" });
        setLiveDistance(null);
      } else {
        setSelectedPin({ _drawId: f.id, geojson: f, type: "land_parcel", name: "", notes: "" });
      }
      setPanelOpen(true);
      setDrawMode(null);
    });

    // Clicking a saved Draw feature (parcel, radius, cable route) opens its panel
    map.current.on("draw.selectionchange", (e) => {
      if (e.features.length === 0) return;
      const drawId = e.features[0].id;
      const pinId  = drawIdToPinId.current[drawId];
      if (!pinId) return; // unsaved preview — ignore
      // Find the pin from the latest state via a callback setter trick
      setPins(current => {
        const pin = current.find(p => p.id === pinId);
        if (pin) { setSelectedPin(pin); setPanelOpen(true); }
        return current;
      });
    });

    return () => { map.current?.remove(); map.current = null; mapInit.current = false; };
  }, []);

  // ── Style change ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(STYLES[mapStyle]);
    map.current.once("style.load", () => {
      activeLayers.forEach(id => { const data = layerData[id]; if (data) addWFSLayer(id, data); });
      applyLinkedParcelsOverlay(map.current, linkedParcelsRef.current);
    });
  }, [mapStyle]);

  // ── Cursor: reflect active draw tool ──────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    const canvas = map.current.getCanvas();
    if (drawMode === "point" || drawMode === "radius" || drawMode === "polygon" || drawMode === "route") {
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "";
    }
  }, [drawMode]);

  // ── Live distance while drawing a route ───────────────────────────────────
  useEffect(() => {
    if (!map.current || drawMode !== "route") { setLiveDistance(null); return; }
    const handler = () => {
      try {
        const all = draw.current?.getAll();
        const active = all?.features.find(f => f.geometry.type === "LineString");
        if (active && active.geometry.coordinates.length >= 2) {
          setLiveDistance(lineDistance(active.geometry.coordinates));
        } else {
          setLiveDistance(null);
        }
      } catch {}
    };
    map.current.on("mousemove", handler);
    return () => map.current?.off("mousemove", handler);
  }, [drawMode]);

  // ── Render markers + radius circles via Draw ───────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    Object.values(markers.current).forEach(m => m.remove());
    markers.current = {};
    try { draw.current?.deleteAll(); } catch {}
    previewDrawId.current = null;
    drawIdToPinId.current = {};

    pins.forEach(pin => {
      // Radius circles + polygons both go through Draw (radius uses grey dashed style)
      if (pin.geojson) {
        try {
          const ids = draw.current?.add(pin.geojson);
          if (ids?.[0]) {
            drawIdToPinId.current[ids[0]] = pin.id;
            // Also set lead colour directly on the Draw feature via the Draw API
            const linkedLead = leads.find(l => l.pin_id === pin.id);
            if (linkedLead) {
              const lc = LEAD_STATUS_MAP[linkedLead.status]?.color;
              if (lc) try { draw.current.setFeatureProperty(ids[0], "lead_color", lc); } catch {}
            }
          }
        } catch {}
        return;
      }
      if (!pin.lat || !pin.lng) return;
      // Point markers: use lead status colour if pin is linked to a lead
      const linkedLead = leads.find(l => l.pin_id === pin.id);
      const ti    = TYPE_MAP[pin.type] || TYPE_MAP.other;
      const color = linkedLead ? (LEAD_STATUS_MAP[linkedLead.status]?.color || ti.color) : ti.color;
      const el = document.createElement("div");
      el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);cursor:pointer;`;
      el.title = pin.name || ti.label;
      el.addEventListener("click", ev => { ev.stopPropagation(); setSelectedPin(pin); setPanelOpen(true); });
      markers.current[pin.id] = new mapboxgl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map.current);
    });

    // ── Linked-parcel colour overlay (separate GL source as primary colour method)
    const linkedFeatures = pins
      .filter(pin => {
        if (!pin.geojson) return false;
        const geom = pin.geojson.type === "Feature" ? pin.geojson.geometry : pin.geojson;
        return geom?.type === "Polygon" && !pin.geojson.properties?.radius_circle;
      })
      .map(pin => {
        const lead = leads.find(l => l.pin_id === pin.id);
        if (!lead) return null;
        const color   = LEAD_STATUS_MAP[lead.status]?.color;
        if (!color) return null;
        const feature = pin.geojson.type === "Feature" ? pin.geojson : { type: "Feature", geometry: pin.geojson, properties: {} };
        return { ...feature, properties: { ...(feature.properties || {}), lead_color: color } };
      })
      .filter(Boolean);

    linkedParcelsRef.current = { type: "FeatureCollection", features: linkedFeatures };

    // Apply now if style is loaded, otherwise wait for idle (style still loading)
    if (map.current.isStyleLoaded()) {
      applyLinkedParcelsOverlay(map.current, linkedParcelsRef.current);
    } else {
      map.current.once("idle", () => applyLinkedParcelsOverlay(map.current, linkedParcelsRef.current));
    }
  }, [pins, leads]);

  // ── Network layer (read-only, shared across all initiatives) ─────────────
  useEffect(() => {
    if (!map.current) return;
    // Clear old network markers
    Object.values(networkMarkers.current).forEach(m => m.remove());
    networkMarkers.current = {};
    // Remove old geojson source if exists
    try {
      if (map.current.getLayer("network-lines")) map.current.removeLayer("network-lines");
      if (map.current.getLayer("network-polygons-fill")) map.current.removeLayer("network-polygons-fill");
      if (map.current.getLayer("network-polygons-stroke")) map.current.removeLayer("network-polygons-stroke");
      if (map.current.getSource("network-geojson")) map.current.removeSource("network-geojson");
    } catch {}

    if (!showNetworkLayer || networkFeatures.length === 0) return;

    // Render point features as distinct markers
    networkFeatures.filter(f => !f.geojson && f.lat && f.lng).forEach(feat => {
      const ti = NETWORK_TYPE_MAP[feat.type] || NETWORK_TYPE_MAP.other;
      const isGSP = feat.type === "gsp";
      const isSub = SUBSTATION_TYPES.includes(feat.type);
      const el = document.createElement("div");

      if (isSub) {
        // Transformer SVG icon — matches NetworkMap marker
        el.style.cssText = `width:30px;height:36px;background:${ti.color};border:2px solid #fff;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;`;
        el.innerHTML = `<svg width="22" height="30" viewBox="0 0 22 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4.5" y="0.5" width="3" height="9" rx="1" fill="white"/>
          <rect x="3" y="2.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <rect x="3" y="5.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <rect x="14.5" y="0.5" width="3" height="9" rx="1" fill="white"/>
          <rect x="13" y="2.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <rect x="13" y="5.5" width="6" height="1.5" rx="0.75" fill="white" opacity="0.55"/>
          <rect x="1" y="10" width="20" height="19" rx="2" fill="none" stroke="white" stroke-width="1.5"/>
          <path d="M11 13 L17 23 L5 23 Z" stroke="white" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
          <path d="M11.8 15 L9.5 19 L11.2 19 L10.2 22 L12.5 18 L10.8 18 Z" fill="white"/>
        </svg>`;
      } else if (isGSP) {
        el.style.cssText = `width:18px;height:18px;background:${ti.color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;transform:rotate(45deg);`;
      } else {
        el.style.cssText = `width:18px;height:18px;background:${ti.color};border:2px solid rgba(255,255,255,0.9);box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer;border-radius:3px;`;
      }

      el.title = feat.name || ti.label;

      // Build popup — include capacity & TIA for substations
      const capInfo = isSub && feat.capacity ? (() => {
        const cap = CAPACITY_MAP[feat.capacity];
        return cap ? `<div style="margin-top:6px;display:flex;align-items:center;gap:6px"><span style="font-size:10px;font-weight:700;color:${cap.color};background:${cap.color}22;border:1px solid ${cap.color}44;border-radius:4px;padding:2px 7px">${cap.label} capacity</span>${feat.tia ? '<span style="font-size:10px;font-weight:700;color:#f59e0b;background:#f59e0b22;border:1px solid #f59e0b44;border-radius:4px;padding:2px 7px">TIA</span>' : ''}</div>` : "";
      })() : "";

      el.addEventListener("click", ev => {
        ev.stopPropagation();
        new mapboxgl.Popup({ closeButton: true, maxWidth: "240px", offset: isSub ? 20 : 14 })
          .setLngLat([feat.lng, feat.lat])
          .setHTML(`<div style="padding:12px 14px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${ti.color};margin-bottom:4px">Network Layer · ${ti.label}</div><div style="font-size:14px;font-weight:700;color:#fff">${feat.name || "(unnamed)"}</div>${feat.notes ? `<div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px">${feat.notes}</div>` : ""}${capInfo}</div>`)
          .addTo(map.current);
      });
      networkMarkers.current[feat.id] = new mapboxgl.Marker({ element: el }).setLngLat([feat.lng, feat.lat]).addTo(map.current);
    });

    // Render line/polygon features as a Mapbox GL source
    const geoFeatures = networkFeatures.filter(f => f.geojson);
    if (geoFeatures.length > 0) {
      const fc = { type: "FeatureCollection", features: geoFeatures.map(f => ({ ...f.geojson, properties: { ...f.geojson.properties, _nf_id: f.id, _nf_type: f.type, _nf_name: f.name || "", _nf_color: (NETWORK_TYPE_MAP[f.type] || NETWORK_TYPE_MAP.other).color } })) };
      try {
        if (!map.current.getSource("network-geojson")) {
          map.current.addSource("network-geojson", { type: "geojson", data: fc });
          map.current.addLayer({ id: "network-lines", type: "line", source: "network-geojson", filter: ["==", "$type", "LineString"], paint: { "line-color": ["get", "_nf_color"], "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.75 } });
          map.current.addLayer({ id: "network-polygons-fill", type: "fill", source: "network-geojson", filter: ["==", "$type", "Polygon"], paint: { "fill-color": ["get", "_nf_color"], "fill-opacity": 0.08 } });
          map.current.addLayer({ id: "network-polygons-stroke", type: "line", source: "network-geojson", filter: ["==", "$type", "Polygon"], paint: { "line-color": ["get", "_nf_color"], "line-width": 1.5 } });
          map.current.on("click", "network-lines", e => {
            const p = e.features[0].properties;
            new mapboxgl.Popup({ closeButton: true, maxWidth: "220px" }).setLngLat(e.lngLat)
              .setHTML(`<div style="padding:12px 14px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${p._nf_color};margin-bottom:4px">Network Layer · ${(NETWORK_TYPE_MAP[p._nf_type] || NETWORK_TYPE_MAP.other).label}</div><div style="font-size:14px;font-weight:700;color:#fff">${p._nf_name || "(unnamed)"}</div></div>`)
              .addTo(map.current);
          });
          map.current.on("mouseenter", "network-lines", () => { map.current.getCanvas().style.cursor = "pointer"; });
          map.current.on("mouseleave", "network-lines", () => { map.current.getCanvas().style.cursor = ""; });
        }
      } catch {}
    }
  }, [networkFeatures, showNetworkLayer]);

  // ── WFS layers ─────────────────────────────────────────────────────────────
  const addWFSLayer = useCallback((id, geojson) => {
    if (!map.current) return;
    const layer = WFS_LAYERS.find(l => l.id === id);
    if (!layer) return;
    if (map.current.getSource(id)) { map.current.getSource(id).setData(geojson); return; }
    map.current.addSource(id, { type: "geojson", data: geojson });

    if (layer.isPolygon) {
      map.current.addLayer({ id: `${id}-fill`,   type: "fill",   source: id, paint: { "fill-color": layer.color, "fill-opacity": 0.08 } });
      map.current.addLayer({ id: `${id}-stroke`, type: "line",   source: id, paint: { "line-color": layer.color, "line-width": 1.5, "line-opacity": 0.6 } });
      map.current.addLayer({ id: `${id}-label`,  type: "symbol", source: id,
        layout: { "text-field": ["get", "gsp"], "text-size": 11, "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"] },
        paint:  { "text-color": layer.color, "text-halo-color": "rgba(0,0,0,0.7)", "text-halo-width": 1.5 } });
      map.current.on("click", `${id}-fill`, e => {
        const p = e.features[0].properties;
        new mapboxgl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat)
          .setHTML(`<div style="padding:14px 16px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#f59e0b;margin-bottom:4px">Grid Supply Point</div><div style="font-size:15px;font-weight:700;color:#fff">${p.gsp}</div><div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px">GSP Catchment Region</div></div>`)
          .addTo(map.current);
      });
      map.current.on("mouseenter", `${id}-fill`, () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", `${id}-fill`, () => { map.current.getCanvas().style.cursor = ""; });
    } else {
      map.current.addLayer({ id: `${id}-circle`, type: "circle", source: id,
        paint: { "circle-radius": 6, "circle-color": layer.color, "circle-opacity": 0.85, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" } });
      map.current.addLayer({ id: `${id}-label`, type: "symbol", source: id,
        layout: { "text-field": ["get", "name"], "text-size": 10, "text-offset": [0, 1.4], "text-anchor": "top" },
        paint:  { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1 }, minzoom: 10 });
      map.current.on("click", `${id}-circle`, e => {
        const p = e.features[0].properties;
        const v = p.voltage ? p.voltage.replace(/;/g, " / ") : null;
        new mapboxgl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat)
          .setHTML(`<div style="padding:14px 16px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${layer.color};margin-bottom:4px">${layer.label}</div><div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:${v ? 4 : 0}px">${p.name || "Substation"}</div>${v ? `<div style="display:inline-block;font-size:10px;font-weight:600;color:${layer.color};background:${layer.color}22;border:1px solid ${layer.color}44;border-radius:4px;padding:2px 7px">${v}</div>` : ""}</div>`)
          .addTo(map.current);
      });
      map.current.on("mouseenter", `${id}-circle`, () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", `${id}-circle`, () => { map.current.getCanvas().style.cursor = ""; });
    }
  }, []);

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
        try {
          const res = await fetch(WFS_LAYERS.find(l => l.id === id).file);
          const data = await res.json();
          setLayerData(p => ({ ...p, [id]: data }));
          map.current?.once("idle", () => addWFSLayer(id, data));
          addWFSLayer(id, data);
        } catch { next.delete(id); }
        setLayerLoading(p => ({ ...p, [id]: false }));
      } else { addWFSLayer(id, layerData[id]); }
    }
    setActiveLayers(next);
  }, [activeLayers, layerData, addWFSLayer]);

  // ── Draw / click ───────────────────────────────────────────────────────────
  const activateDraw = useCallback((mode) => {
    setRadiusCenter(null); setRadiusPicking(false); setLiveDistance(null);
    if (mode === "polygon") draw.current?.changeMode("draw_polygon");
    else if (mode === "route") draw.current?.changeMode("draw_line_string");
    else draw.current?.changeMode("simple_select");
    setDrawMode(mode);
  }, []);

  useEffect(() => {
    if (!map.current) return;
    const handler = e => {
      if (drawMode === "point") {
        setSelectedPin({ lat: e.lngLat.lat, lng: e.lngLat.lng, type: "land_parcel", name: "", notes: "" });
        setPanelOpen(true); setDrawMode(null);
      } else if (drawMode === "radius") {
        setRadiusCenter([e.lngLat.lng, e.lngLat.lat]); setRadiusPicking(true); setDrawMode(null);
      }
    };
    map.current.on("click", handler);
    return () => map.current?.off("click", handler);
  }, [drawMode]);

  const handleRadiusPick = useCallback((km) => {
    if (!radiusCenter) return;
    const [lng, lat] = radiusCenter;
    const circleFeature = makeCircleGeoJSON(lng, lat, km);
    // Add to Draw immediately for visual preview before the user saves
    try {
      const ids = draw.current?.add(circleFeature);
      previewDrawId.current = ids?.[0] ?? null;
    } catch {}
    setSelectedPin({ lat, lng, type: "radius_circle", name: `${km}km radius`, notes: "", geojson: circleFeature });
    setPanelOpen(true); setRadiusPicking(false); setRadiusCenter(null); setCustomRadius("");
  }, [radiusCenter]);

  // ── Save / delete annotation ───────────────────────────────────────────────
  const handleSave = useCallback(async ({ name, notes, type }) => {
    if (!selectedPin) return;
    const payload = { name, notes, type, initiative_id: initiative.id, lat: selectedPin.lat || null, lng: selectedPin.lng || null, geojson: selectedPin.geojson || null, created_by: session.user.id };
    if (selectedPin.id) await supabase.from("map_pins").update({ name, notes, type }).eq("id", selectedPin.id);
    else await supabase.from("map_pins").insert(payload);
    await loadPins(); setPanelOpen(false); setSelectedPin(null);
  }, [selectedPin, session, initiative.id, loadPins]);

  const handleDelete = useCallback(async () => {
    if (!selectedPin?.id) return;
    await supabase.from("map_pins").delete().eq("id", selectedPin.id);
    if (selectedPin.geojson) try { draw.current?.delete(selectedPin.geojson.id); } catch {}
    await loadPins(); setPanelOpen(false); setSelectedPin(null);
  }, [selectedPin, loadPins]);

  // ── Leads ──────────────────────────────────────────────────────────────────
  const openLeadForm = (lead = null) => {
    setEditingLead(lead);
    setLeadForm(lead
      ? { name: lead.name, company: lead.company || "", phone: lead.phone || "", email: lead.email || "", address: lead.address || "", notes: lead.notes || "", status: lead.status, pin_id: lead.pin_id || "" }
      : { name: "", company: "", phone: "", email: "", address: "", notes: "", status: "new", pin_id: "" });
    setShowLeadForm(true);
  };

  const handleSaveLead = async () => {
    const payload = { ...leadForm, initiative_id: initiative.id, pin_id: leadForm.pin_id || null, created_by: session.user.id };
    if (editingLead) await supabase.from("leads").update(payload).eq("id", editingLead.id);
    else await supabase.from("leads").insert(payload);
    await loadLeads(); setShowLeadForm(false); setEditingLead(null);
  };

  const handleDeleteLead = async id => {
    await supabase.from("leads").delete().eq("id", id);
    await loadLeads();
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const SBL = { fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: theme.textTertiary, marginBottom: 7 };
  const inputSt = { width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif" };
  const sideBtn = (active, color) => ({
    width: "100%", padding: "7px 12px", fontSize: 11, borderRadius: 7, cursor: "pointer", textAlign: "left",
    background: active ? (color || initiative.color) + "22" : theme.pillBg,
    border: `1px solid ${active ? (color || initiative.color) : theme.border}`,
    color: active ? (color || initiative.color) : theme.textSecondary,
    fontWeight: active ? 700 : 400, fontFamily: "'Inter', system-ui, sans-serif", transition: "all 0.1s",
  });

  const nonRadiusPins = pins.filter(p => p.type !== "radius_circle");

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${theme.border}`, background: theme.pageBg, overflow: "hidden" }}>

        {/* Header */}
        {initiative.description && (
          <div style={{ padding: "8px 14px 10px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: theme.textTertiary, lineHeight: 1.4 }}>{initiative.description}</div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          {[
            ["tools",   "Tools"],
            ["parcels", `Parcels (${pins.length})`],
            ["leads",   `Leads (${leads.length})`],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setSidebarTab(key)} style={{
              flex: 1, padding: "8px 2px", fontSize: 10, fontWeight: sidebarTab === key ? 700 : 500,
              color: sidebarTab === key ? theme.textPrimary : theme.textTertiary,
              background: "none", border: "none",
              borderBottom: sidebarTab === key ? `2px solid ${initiative.color}` : "2px solid transparent",
              cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", transition: "all 0.1s",
            }}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: "auto", padding: 14 }}>

          {/* TOOLS */}
          {sidebarTab === "tools" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={SBL}>Draw Tools</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <button onClick={() => activateDraw("point")}   style={sideBtn(drawMode === "point")}>+ Drop Marker</button>
                  <button onClick={() => activateDraw("polygon")} style={sideBtn(drawMode === "polygon")}>⬡ Draw Parcel</button>
                  <button onClick={() => activateDraw("radius")}  style={sideBtn(drawMode === "radius")}>◎ Radius Tool</button>
                  <button onClick={() => activateDraw("route")}   style={sideBtn(drawMode === "route", "#f97316")}>📏 Cable Route</button>
                  {(drawMode || radiusPicking) && (
                    <button onClick={() => { activateDraw(null); setRadiusCenter(null); setRadiusPicking(false); setLiveDistance(null); }} style={{ ...sideBtn(false), color: theme.textTertiary, fontSize: 10 }}>
                      ✕ Cancel drawing
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div style={SBL}>Map Style</div>
                <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 2, gap: 2 }}>
                  {[["streets", "Road"], ["satellite-streets", "Satellite"]].map(([key, label]) => (
                    <button key={key} onClick={() => setMapStyle(key)} style={{
                      flex: 1, fontSize: 10, padding: "5px 0", borderRadius: 6, cursor: "pointer",
                      background: mapStyle === key ? theme.pillActiveBg : "transparent",
                      color: mapStyle === key ? theme.pillActiveText : theme.pillInactiveText,
                      border: mapStyle === key ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
                      fontWeight: mapStyle === key ? 700 : 400,
                      fontFamily: "'Inter', system-ui, sans-serif",
                    }}>{label}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={SBL}>Network Layer</div>
                <button onClick={() => setShowNetworkLayer(v => !v)} style={{
                  ...sideBtn(showNetworkLayer, "#8b5cf6"),
                  display: "flex", alignItems: "center", gap: 7, marginBottom: 4,
                }}>
                  <div style={{ width: 7, height: 7, background: "#8b5cf6", borderRadius: 2, flexShrink: 0 }} />
                  {showNetworkLayer ? "Network Layer On" : "Network Layer Off"}
                  {networkFeatures.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 9, background: "#8b5cf622", color: "#8b5cf6", border: "1px solid #8b5cf644", borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>{networkFeatures.length}</span>
                  )}
                </button>
                {networkFeatures.length === 0 && (
                  <div style={{ fontSize: 10, color: theme.textTertiary, paddingLeft: 2, lineHeight: 1.5 }}>No network features yet. Add them in the Network Map.</div>
                )}
              </div>

              <div>
                <div style={SBL}>NGED Layers</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {WFS_LAYERS.map(layer => {
                    const active = activeLayers.has(layer.id);
                    const loading = layerLoading[layer.id];
                    return (
                      <button key={layer.id} onClick={() => toggleWFSLayer(layer.id)} disabled={loading} style={{
                        padding: "6px 10px", fontSize: 10, borderRadius: 7, cursor: loading ? "not-allowed" : "pointer",
                        background: active ? layer.color + "22" : theme.pillBg,
                        border: `1px solid ${active ? layer.color : theme.border}`,
                        color: active ? layer.color : theme.textSecondary,
                        fontWeight: active ? 700 : 400, opacity: loading ? 0.6 : 1,
                        fontFamily: "'Inter', system-ui, sans-serif",
                        display: "flex", alignItems: "center", gap: 7, textAlign: "left",
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />
                        {loading ? "Loading…" : layer.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* PARCELS */}
          {sidebarTab === "parcels" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {pins.length === 0 ? (
                <div style={{ fontSize: 11, color: theme.textTertiary, textAlign: "center", padding: "24px 8px", lineHeight: 1.6 }}>
                  No annotations yet.<br/>Use Tools to add markers, parcels or radius rings.
                </div>
              ) : pins.map(pin => {
                const ti = TYPE_MAP[pin.type] || TYPE_MAP.other;
                const rKm = pin.type === "radius_circle" && pin.geojson?.properties?.radius_km;
                return (
                  <div key={pin.id}
                    style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "7px 8px", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Inter', system-ui, sans-serif", transition: "border-color 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = ti.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor = theme.border}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: ti.color, flexShrink: 0 }} />
                    <div
                      style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                      onClick={() => {
                        setSelectedPin(pin); setPanelOpen(true);
                        if (pin.lat && pin.lng) map.current?.flyTo({ center: [pin.lng, pin.lat], zoom: 13, duration: 600 });
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600, color: theme.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pin.name || "(unnamed)"}</div>
                      <div style={{ fontSize: 10, color: theme.textTertiary }}>{rKm ? `${rKm}km radius` : ti.label}</div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete "${pin.name || "this annotation"}"?`)) return;
                        await supabase.from("map_pins").delete().eq("id", pin.id);
                        if (pin.geojson) try { draw.current?.delete(pin.geojson.id); } catch {}
                        if (selectedPin?.id === pin.id) { setPanelOpen(false); setSelectedPin(null); }
                        await loadPins();
                      }}
                      style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textTertiary, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1 }}
                      title="Delete"
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* LEADS */}
          {sidebarTab === "leads" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={() => openLeadForm()} style={{
                width: "100%", background: initiative.color, color: "#fff", border: "none",
                borderRadius: 8, padding: "8px 0", fontSize: 11, fontWeight: 600,
                cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif",
              }}>+ Add Lead</button>

              {leads.length === 0 ? (
                <div style={{ fontSize: 11, color: theme.textTertiary, textAlign: "center", padding: "16px 0" }}>No leads yet</div>
              ) : leads.map(lead => {
                const st = LEAD_STATUS_MAP[lead.status] || LEAD_STATUS_MAP.new;
                const linkedPin = pins.find(p => p.id === lead.pin_id);
                return (
                  <div key={lead.id} style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>{lead.name}</div>
                        {lead.company && <div style={{ fontSize: 10, color: theme.textTertiary }}>{lead.company}</div>}
                        {lead.phone   && <div style={{ fontSize: 10, color: theme.textTertiary }}>{lead.phone}</div>}
                        {linkedPin    && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>📍 {linkedPin.name}</div>}
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: st.color, background: st.color + "22", border: `1px solid ${st.color}44`, borderRadius: 4, padding: "2px 5px", flexShrink: 0 }}>{st.label}</span>
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => openLeadForm(lead)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: theme.pillBg, border: `1px solid ${theme.border}`, color: theme.textSecondary, fontFamily: "'Inter', system-ui, sans-serif" }}>Edit</button>
                      <button onClick={() => handleDeleteLead(lead.id)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer", background: theme.error + "11", border: `1px solid ${theme.error}33`, color: theme.error, fontFamily: "'Inter', system-ui, sans-serif" }}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Map ───────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

        {/* Draw hint */}
        {(drawMode || radiusPicking) && (
          <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.8)", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 12, pointerEvents: "none", zIndex: 5, display: "flex", alignItems: "center", gap: 10 }}>
            <span>
              {drawMode === "point"   && "Click the map to drop a marker"}
              {drawMode === "polygon" && "Click to draw polygon — double-click to finish"}
              {drawMode === "radius"  && "Click the map to place the radius centre"}
              {drawMode === "route"   && "Click to trace cable route — double-click to finish"}
              {radiusPicking && !drawMode && "Choose a radius distance below"}
            </span>
            {drawMode === "route" && liveDistance != null && (
              <span style={{ background: "#f97316", color: "#fff", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                {liveDistance.toFixed(2)} km
              </span>
            )}
          </div>
        )}

        {/* Radius picker */}
        {radiusPicking && (
          <div style={{ position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)", background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "14px 16px", zIndex: 20, boxShadow: "0 4px 24px rgba(0,0,0,0.35)", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: theme.textTertiary, marginBottom: 10 }}>Select radius</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {[1, 2, 5, 10].map(km => (
                <button key={km} onClick={() => handleRadiusPick(km)} style={{ fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 7, cursor: "pointer", background: initiative.color + "22", border: `1px solid ${initiative.color}66`, color: initiative.color, fontFamily: "'Inter', system-ui, sans-serif" }}>{km}km</button>
              ))}
              <input type="number" min="0.1" step="0.1" value={customRadius} onChange={e => setCustomRadius(e.target.value)}
                onKeyDown={e => e.key === "Enter" && customRadius && handleRadiusPick(parseFloat(customRadius))}
                placeholder="km" style={{ width: 56, padding: "6px 8px", fontSize: 11, borderRadius: 7, background: theme.surfaceBg, border: `1px solid ${theme.border}`, color: theme.textPrimary, outline: "none", fontFamily: "'Inter', system-ui, sans-serif" }} />
              {customRadius && <button onClick={() => handleRadiusPick(parseFloat(customRadius))} style={{ fontSize: 11, padding: "6px 10px", borderRadius: 7, cursor: "pointer", background: initiative.color, color: "#fff", border: "none", fontFamily: "'Inter', system-ui, sans-serif" }}>Go</button>}
            </div>
            <button onClick={() => { setRadiusPicking(false); setRadiusCenter(null); }} style={{ marginTop: 10, fontSize: 10, color: theme.textTertiary, background: "none", border: "none", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>✕ Cancel</button>
          </div>
        )}

        {/* Legend */}
        <div style={{ position: "absolute", bottom: 36, right: panelOpen ? 300 : 12, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", borderRadius: 8, padding: "8px 12px", zIndex: 5, transition: "right 0.2s" }}>
          {PIN_TYPES.filter(t => !["radius_circle", "other"].includes(t.value)).map(t => (
            <div key={t.value} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, fontSize: 10, color: "#fff" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
              {t.label}
            </div>
          ))}
        </div>

        {/* Annotation panel */}
        {panelOpen && selectedPin && (
          <AnnotationPanel pin={selectedPin} theme={theme}
            onSave={handleSave} onDelete={handleDelete}
            onClose={() => {
              // If user cancels an unsaved radius, remove its preview from Draw
              if (!selectedPin.id && previewDrawId.current) {
                try { draw.current?.delete(previewDrawId.current); } catch {}
                previewDrawId.current = null;
              }
              setPanelOpen(false); setSelectedPin(null);
            }} />
        )}
      </div>

      {/* ── Lead form modal ────────────────────────────────────────────────── */}
      {showLeadForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 24, width: 420, maxHeight: "88vh", overflow: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, marginBottom: 18 }}>{editingLead ? "Edit Lead" : "New Lead"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[["name","Name *","e.g. John Davies"],["company","Company","Davies Farms Ltd"],["phone","Phone","+44 7700 900000"],["email","Email","john@example.com"],["address","Address","Farm address…"]].map(([key, label, ph]) => (
                <div key={key}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{label}</div>
                  <input value={leadForm[key]} onChange={e => setLeadForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph} style={inputSt} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Status</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {LEAD_STATUSES.map(s => (
                    <button key={s.value} onClick={() => setLeadForm(f => ({ ...f, status: s.value }))} style={{
                      fontSize: 10, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                      background: leadForm.status === s.value ? s.color + "22" : theme.pillBg,
                      border: `1px solid ${leadForm.status === s.value ? s.color : theme.border}`,
                      color: leadForm.status === s.value ? s.color : theme.textSecondary,
                      fontWeight: leadForm.status === s.value ? 700 : 400,
                      fontFamily: "'Inter', system-ui, sans-serif",
                    }}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Linked Parcel</div>
                <select value={leadForm.pin_id} onChange={e => setLeadForm(f => ({ ...f, pin_id: e.target.value }))} style={{ ...inputSt }}>
                  <option value="">None</option>
                  {nonRadiusPins.map(p => <option key={p.id} value={p.id}>{p.name || `(${TYPE_MAP[p.type]?.label || "pin"})`}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Notes</div>
                <textarea value={leadForm.notes} onChange={e => setLeadForm(f => ({ ...f, notes: e.target.value }))} placeholder="Add notes…" rows={3} style={{ ...inputSt, resize: "vertical", lineHeight: 1.5 }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={handleSaveLead} disabled={!leadForm.name.trim()} style={{ flex: 1, background: initiative.color, color: "#fff", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 12, fontWeight: 600, cursor: !leadForm.name.trim() ? "not-allowed" : "pointer", opacity: !leadForm.name.trim() ? 0.6 : 1, fontFamily: "'Inter', system-ui, sans-serif" }}>Save Lead</button>
              <button onClick={() => { setShowLeadForm(false); setEditingLead(null); }} style={{ background: theme.pillBg, color: theme.textSecondary, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "9px 16px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
