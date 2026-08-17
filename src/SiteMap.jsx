// Site Map for Private Wire project overview.
//
// - KML / KMZ upload → parsed to GeoJSON, original preserved in Supabase
//   Storage (pw-kml bucket), coloured overlay drawn on Mapbox satellite
// - Project location pin (click-to-set + manual lat/lng input)
// - Drawing tools — same set as Network Map:
//     + Marker     · drops a labelled HTML marker
//     ⬡ Area      · polygon, name + colour + optional notes
//     — Line       · line/cable, with auto distance readout
//     ◯ Radius    · centre + slider-adjustable radius circle
//   Each saved feature persists per-org on data.site_features.
//   Annotation panel pops up after drawing for name / colour / notes.
// - Distance + area measure tools (separate from saved drawings)
//
// Persistence (on the parent's data jsonb):
//   { kml: {...}, location: {lat,lng}, site_features: [feature, ...] }
// where feature = { id, type, name, notes, color, lat?, lng?, geojson?, radius_km? }

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import { unzipSync, strFromU8 } from "fflate";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { supabase } from "./supabase.js";
import { useTheme } from "./ThemeContext.jsx";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const STYLES = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  road:      "mapbox://styles/mapbox/streets-v12",
};

const COLOURS = [
  "#ef4444", "#f97316", "#f59e0b", "#10b981",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff",
];
const DEFAULT_FEATURE_COLOR = "#FC6A0A";

// ─── helpers ─────────────────────────────────────────────────────────────────
function genId() {
  return "f_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function bboxFromGeoJSON(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } else {
      coords.forEach(visit);
    }
  };
  const features = geojson.type === "FeatureCollection" ? geojson.features : [geojson];
  features.forEach(f => f?.geometry && visit(f.geometry.coordinates));
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

// Bounding box covering every saved site feature (markers, radii, drawn shapes).
function featuresBbox(features) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (lng, lat) => {
    if (lng < minX) minX = lng; if (lng > maxX) maxX = lng;
    if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
  };
  (features || []).forEach(f => {
    if (f.lat != null && f.lng != null) ext(f.lng, f.lat);
    if (f.geojson) {
      const b = bboxFromGeoJSON(f.geojson);
      if (b) { ext(b[0][0], b[0][1]); ext(b[1][0], b[1][1]); }
    }
  });
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function lineDistanceKm(coords) {
  let t = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    t += haversineKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return t;
}
function polygonAreaHa(coords) {
  if (!coords?.[0]) return null;
  const ring = coords[0];
  if (ring.length < 4) return null;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += (x2 - x1) * Math.PI / 180 * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
  }
  area = Math.abs(area * R * R / 2);
  return area / 10000;
}

// One readout for area in three common units: acres, hectares, m².
// We use acres as the primary because most UK site plans (and the user's
// own KML filenames) refer to acres.
const HA_PER_ACRE = 0.404686; // 1 acre = 0.404686 ha
function formatAreaReadout(coords) {
  const ha = polygonAreaHa(coords);
  if (ha == null) return null;
  const acres = ha / HA_PER_ACRE;
  const m2 = ha * 10000;
  return `${acres.toFixed(2)} ac · ${ha.toFixed(2)} ha · ${Math.round(m2).toLocaleString()} m²`;
}

// Circle as a 64-sided polygon. radiusKm in km.
function makeCircleGeoJSON(lng, lat, radiusKm, props = {}) {
  const steps = 64;
  const coords = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i * 2 * Math.PI) / steps;
    const dx = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
    const dy = radiusKm / 110.574;
    return [lng + dx * Math.cos(angle), lat + dy * Math.sin(angle)];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: props };
}

// ─── component ───────────────────────────────────────────────────────────────
export default function SiteMap({ org, kml, location, features, onChange }) {
  const { theme } = useTheme();
  const mapContainer = useRef(null);
  const map          = useRef(null);
  const draw         = useRef(null);
  const projectMarker = useRef(null);
  const featureMarkers = useRef({}); // id → mapboxgl.Marker (for type='marker' features)
  const mapInit      = useRef(false);
  // Latest renderers, reachable from the once-registered style.load handler so
  // it never calls a stale closure (which would skip drawing data loaded later).
  const renderKmlRef  = useRef(null);
  const renderFeatRef = useRef(null);
  // Master visibility for the whole site overlay (KML boundary + drawn features).
  const layerOnRef    = useRef(true);

  const safeFeatures = useMemo(() => Array.isArray(features) ? features : [], [features]);

  const [mapStyle, setMapStyle]     = useState("satellite");
  const [layerOn, setLayerOn]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [uploadError, setUploadErr] = useState(null);
  // drawMode values:
  //   null
  //   'pin'                   — drop project pin
  //   'measure-distance'      — temporary distance read-out
  //   'measure-area'          — temporary area read-out
  //   'draw-marker' | 'draw-area' | 'draw-line' | 'draw-radius'
  const [drawMode, setDrawMode]     = useState(null);
  const drawModeRef = useRef(null);
  const [measure, setMeasure]       = useState(null);
  const [latInput, setLatInput]     = useState(location?.lat ?? "");
  const [lngInput, setLngInput]     = useState(location?.lng ?? "");
  const [toolsOpen, setToolsOpen]   = useState(false);
  const toolsWrapRef = useRef(null);

  // Close the Tools dropdown on outside click / Escape
  useEffect(() => {
    if (!toolsOpen) return;
    const onClick = (e) => {
      if (toolsWrapRef.current && !toolsWrapRef.current.contains(e.target)) setToolsOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setToolsOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  // Annotation panel: null OR a feature being created/edited
  const [panelFeature, setPanelFeature] = useState(null);
  const panelFeatureRef = useRef(null);
  useEffect(() => { panelFeatureRef.current = panelFeature; }, [panelFeature]);

  // Keep latInput/lngInput in sync with the saved location prop
  useEffect(() => {
    setLatInput(location?.lat ?? "");
    setLngInput(location?.lng ?? "");
  }, [location?.lat, location?.lng]);

  // featuresRef so map handlers always see the latest array
  const featuresRef = useRef(safeFeatures);
  useEffect(() => { featuresRef.current = safeFeatures; }, [safeFeatures]);

  // ── init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInit.current || !mapContainer.current) return;
    mapInit.current = true;

    const initialCenter = location?.lng != null && location?.lat != null
      ? [location.lng, location.lat]
      : [-3.0, 53.5];

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: STYLES[mapStyle],
      center: initialCenter,
      zoom: location ? 14 : 5,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-left");
    map.current.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    // mapbox-gl-draw — used for in-progress drawing (area/line/measure).
    // The orange styling matches our brand and the NetworkMap.
    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      styles: [
        { id: "gl-draw-line",         type: "line",   filter: ["all", ["==", "$type", "LineString"]], paint: { "line-color": "#FC6A0A", "line-width": 2.5, "line-dasharray": [2, 2] } },
        { id: "gl-draw-line-vertex",  type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"]], paint: { "circle-radius": 4, "circle-color": "#FC6A0A", "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" } },
        { id: "gl-draw-polygon-fill", type: "fill",   filter: ["all", ["==", "$type", "Polygon"]], paint: { "fill-color": "#FC6A0A", "fill-opacity": 0.18 } },
        { id: "gl-draw-polygon-line", type: "line",   filter: ["all", ["==", "$type", "Polygon"]], paint: { "line-color": "#FC6A0A", "line-width": 2 } },
      ],
    });
    map.current.addControl(draw.current);

    // On draw.create: depending on the active draw mode, either save the
    // resulting feature (draw-area / draw-line) or just update the measure
    // read-out (measure-distance / measure-area).
    const onDrawCreate = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const mode = drawModeRef.current;
      if (mode === "draw-area" || mode === "draw-line") {
        const id = genId();
        const isPolygon = f.geometry.type === "Polygon";
        const baseName = isPolygon ? "New area" : "New line";
        // Open annotation panel with the freshly drawn shape
        setPanelFeature({
          id, isNew: true,
          type: isPolygon ? "area" : "line",
          name: baseName, notes: "",
          color: DEFAULT_FEATURE_COLOR,
          geojson: f,
        });
        // Remove from mapbox-draw — we'll render it ourselves from the saved list
        try { draw.current.delete(f.id); } catch { /* */ }
        setDrawMode(null);
      } else if (mode === "measure-distance" || mode === "measure-area") {
        updateMeasure();
      }
    };
    const updateMeasure = () => {
      try {
        const all = draw.current.getAll();
        const f = all.features[0];
        if (!f) { setMeasure(null); return; }
        if (f.geometry.type === "LineString" && f.geometry.coordinates.length >= 2) {
          setMeasure({ km: lineDistanceKm(f.geometry.coordinates) });
        } else if (f.geometry.type === "Polygon") {
          setMeasure({ ha: polygonAreaHa(f.geometry.coordinates) });
        }
      } catch { /* */ }
    };

    map.current.on("draw.create", onDrawCreate);
    map.current.on("draw.update", updateMeasure);
    map.current.on("mousemove", () => {
      if (drawModeRef.current === "measure-distance" || drawModeRef.current === "measure-area") updateMeasure();
    });

    // Single click handler — pin / draw-marker / draw-radius
    map.current.on("click", (e) => {
      const mode = drawModeRef.current;
      if (mode === "pin") {
        const lat = +e.lngLat.lat.toFixed(6);
        const lng = +e.lngLat.lng.toFixed(6);
        setLatInput(lat); setLngInput(lng);
        onChange({ location: { lat, lng } });
        setDrawMode(null);
      } else if (mode === "draw-marker") {
        setPanelFeature({
          id: genId(), isNew: true,
          type: "marker",
          name: "New marker", notes: "",
          color: DEFAULT_FEATURE_COLOR,
          lat: +e.lngLat.lat.toFixed(6),
          lng: +e.lngLat.lng.toFixed(6),
        });
        setDrawMode(null);
      } else if (mode === "draw-radius") {
        const lat = +e.lngLat.lat.toFixed(6);
        const lng = +e.lngLat.lng.toFixed(6);
        const radius_km = 0.5;
        setPanelFeature({
          id: genId(), isNew: true,
          type: "radius",
          name: "New radius", notes: "",
          color: DEFAULT_FEATURE_COLOR,
          lat, lng, radius_km,
          geojson: makeCircleGeoJSON(lng, lat, radius_km),
        });
        setDrawMode(null);
      }
    });

    // Re-render layers after every style change. Use refs so this handler
    // (registered once) always invokes the current renderers — otherwise data
    // that loads after mount, but before the style finishes loading, is skipped.
    map.current.on("style.load", () => {
      renderKmlRef.current?.();
      renderFeatRef.current?.();
    });

    return () => {
      // remove HTML feature markers
      Object.values(featureMarkers.current).forEach(m => m.remove());
      featureMarkers.current = {};
      map.current?.remove();
      map.current = null;
      mapInit.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync drawModeRef and cursor / draw library mode
  useEffect(() => {
    drawModeRef.current = drawMode;
    if (!map.current) return;
    map.current.getCanvas().style.cursor =
      drawMode === null ? "" : "crosshair";
    if (drawMode === "measure-distance" || drawMode === "draw-line") {
      draw.current?.changeMode("draw_line_string");
    } else if (drawMode === "measure-area" || drawMode === "draw-area") {
      draw.current?.changeMode("draw_polygon");
    } else {
      try { draw.current?.changeMode("simple_select"); } catch { /* */ }
    }
    if (drawMode === null) setMeasure(null);
  }, [drawMode]);

  // Style change — replace style; renderKmlLayers + renderSavedFeatures fire on style.load
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(STYLES[mapStyle]);
  }, [mapStyle]);

  // ── KML rendering ─────────────────────────────────────────────────────────
  const renderKmlLayers = useCallback(() => {
    if (!map.current?.isStyleLoaded()) return;
    const SRC = "site-kml";
    const fill = "site-kml-fill", stroke = "site-kml-stroke", point = "site-kml-point";

    [fill, stroke, point].forEach(id => { if (map.current.getLayer(id)) map.current.removeLayer(id); });
    if (map.current.getSource(SRC)) map.current.removeSource(SRC);

    if (!kml?.geojson || kml.visible === false || !layerOnRef.current) return;
    const color = kml.color || DEFAULT_FEATURE_COLOR;

    map.current.addSource(SRC, { type: "geojson", data: kml.geojson });
    map.current.addLayer({ id: fill,   type: "fill",   source: SRC, paint: { "fill-color": color, "fill-opacity": 0.22 }, filter: ["==", "$type", "Polygon"] });
    map.current.addLayer({ id: stroke, type: "line",   source: SRC, paint: { "line-color": color, "line-width": 2.5 } });
    map.current.addLayer({ id: point,  type: "circle", source: SRC, paint: { "circle-color": color, "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 2 }, filter: ["==", "$type", "Point"] });
  }, [kml]);
  useEffect(() => { renderKmlLayers(); }, [renderKmlLayers]);

  // One-time zoom-to-project once the saved data has loaded. The map inits to a
  // default UK view because location/kml/features arrive asynchronously after
  // mount; this flies in as soon as we have something to show. Priority:
  // project pin → KML boundary → bounds of saved features.
  const lastFitRef = useRef(null);
  const didInitialZoom = useRef(false);
  useEffect(() => {
    if (!map.current || didInitialZoom.current) return;
    const hasLocation = location?.lat != null && location?.lng != null;
    const hasFeatures = (featuresRef.current || []).length > 0;
    if (!hasLocation && !kml?.geojson && !hasFeatures) return;

    const run = () => {
      if (hasLocation) {
        map.current.flyTo({ center: [location.lng, location.lat], zoom: 14, duration: 1000 });
      } else if (kml?.geojson) {
        const bbox = bboxFromGeoJSON(kml.geojson);
        if (bbox) {
          lastFitRef.current = kml.file_url;
          try { map.current.fitBounds(bbox, { padding: 40, maxZoom: 18, duration: 1000 }); } catch { /* */ }
        }
      } else {
        const bbox = featuresBbox(featuresRef.current);
        if (bbox) {
          try { map.current.fitBounds(bbox, { padding: 60, maxZoom: 16, duration: 1000 }); } catch { /* */ }
        }
      }
    };
    if (map.current.isStyleLoaded()) run(); else map.current.once("idle", run);
    didInitialZoom.current = true;
  }, [location?.lat, location?.lng, kml, safeFeatures]);

  // Fit-to-bounds when a *new* KML is uploaded (after the initial zoom).
  useEffect(() => {
    if (!map.current || !kml?.geojson) return;
    if (!didInitialZoom.current) return; // initial load handled above
    if (lastFitRef.current === kml.file_url) return;
    lastFitRef.current = kml.file_url;
    const bbox = bboxFromGeoJSON(kml.geojson);
    if (!bbox) return;
    try { map.current.fitBounds(bbox, { padding: 40, maxZoom: 18, duration: 800 }); } catch { /* */ }
  }, [kml]);

  // ── Saved features rendering ──────────────────────────────────────────────
  // areas/lines/radii share one GeoJSON source (per-feature color via paint expr).
  // Markers are HTML elements — each with its own colour pin.
  const renderSavedFeatures = useCallback(() => {
    if (!map.current?.isStyleLoaded()) return;
    const SRC = "site-features";
    const FILL = "site-features-fill", STROKE = "site-features-stroke";
    const previewSrc = "site-features-preview";

    // Drop old layers/source
    [FILL, STROKE, `${previewSrc}-fill`, `${previewSrc}-stroke`].forEach(id => {
      if (map.current.getLayer(id)) map.current.removeLayer(id);
    });
    [SRC, previewSrc].forEach(id => { if (map.current.getSource(id)) map.current.removeSource(id); });

    // Master overlay toggle off → clear HTML markers too and stop here.
    if (!layerOnRef.current) {
      Object.values(featureMarkers.current).forEach(m => m.remove());
      featureMarkers.current = {};
      return;
    }

    // Build a FeatureCollection of areas, lines, and radius circles
    const list = featuresRef.current || [];
    const geo = {
      type: "FeatureCollection",
      features: list
        .filter(f => f.type === "area" || f.type === "line" || f.type === "radius")
        .map(f => {
          if (f.type === "radius") {
            return makeCircleGeoJSON(f.lng, f.lat, Number(f.radius_km) || 0.5, { feature_id: f.id, color: f.color || DEFAULT_FEATURE_COLOR, name: f.name || "" });
          }
          return {
            ...f.geojson,
            properties: { ...(f.geojson?.properties || {}), feature_id: f.id, color: f.color || DEFAULT_FEATURE_COLOR, name: f.name || "" },
          };
        }),
    };

    map.current.addSource(SRC, { type: "geojson", data: geo });
    map.current.addLayer({
      id: FILL, type: "fill", source: SRC,
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 },
      filter: ["==", "$type", "Polygon"],
    });
    map.current.addLayer({
      id: STROKE, type: "line", source: SRC,
      paint: { "line-color": ["get", "color"], "line-width": 2.5 },
    });

    // Preview source for the panel (live editing of in-progress feature)
    map.current.addSource(previewSrc, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.current.addLayer({
      id: `${previewSrc}-fill`, type: "fill", source: previewSrc,
      paint: { "fill-color": ["coalesce", ["get", "color"], DEFAULT_FEATURE_COLOR], "fill-opacity": 0.18 },
      filter: ["==", "$type", "Polygon"],
    });
    map.current.addLayer({
      id: `${previewSrc}-stroke`, type: "line", source: previewSrc,
      paint: { "line-color": ["coalesce", ["get", "color"], DEFAULT_FEATURE_COLOR], "line-width": 2, "line-dasharray": [3, 2] },
    });

    // Hover + click handlers on saved polygons/lines
    const openExisting = (e) => {
      if (drawModeRef.current) return;
      const id = e.features?.[0]?.properties?.feature_id;
      if (!id) return;
      const feat = (featuresRef.current || []).find(f => f.id === id);
      if (feat) setPanelFeature({ ...feat, isNew: false });
    };
    map.current.on("click", FILL, openExisting);
    map.current.on("click", STROKE, openExisting);

    // Refresh HTML markers
    Object.values(featureMarkers.current).forEach(m => m.remove());
    featureMarkers.current = {};
    list.filter(f => f.type === "marker").forEach(f => {
      if (f.lat == null || f.lng == null) return;
      const el = document.createElement("div");
      const color = f.color || DEFAULT_FEATURE_COLOR;
      el.style.cssText =
        `width:20px;height:20px;background:${color};border:2px solid #fff;` +
        `border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;` +
        `transition:transform 0.12s;`;
      el.title = f.name || "marker";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (drawModeRef.current) return;
        setPanelFeature({ ...f, isNew: false });
      });
      el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.15)"; });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
      featureMarkers.current[f.id] = new mapboxgl.Marker({ element: el })
        .setLngLat([f.lng, f.lat])
        .addTo(map.current);
    });
  }, []);
  useEffect(() => { renderSavedFeatures(); }, [renderSavedFeatures, safeFeatures, mapStyle]);

  // Expose the latest renderers to the style.load handler (see init effect).
  renderKmlRef.current  = renderKmlLayers;
  renderFeatRef.current = renderSavedFeatures;
  layerOnRef.current    = layerOn;

  // Toggling the master overlay forces a redraw of both KML and features.
  useEffect(() => {
    renderKmlRef.current?.();
    renderFeatRef.current?.();
  }, [layerOn]);

  // ── Live preview while annotation panel is open ───────────────────────────
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const src = map.current.getSource("site-features-preview");
    if (!src) return;
    const f = panelFeature;
    if (!f || f.type === "marker") {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    let preview = null;
    if (f.type === "radius") {
      if (f.lat == null || f.lng == null) return;
      preview = makeCircleGeoJSON(f.lng, f.lat, Number(f.radius_km) || 0.5, { color: f.color || DEFAULT_FEATURE_COLOR });
    } else if (f.geojson) {
      preview = { ...f.geojson, properties: { ...(f.geojson.properties || {}), color: f.color || DEFAULT_FEATURE_COLOR } };
    }
    src.setData(preview ? { type: "FeatureCollection", features: [preview] } : { type: "FeatureCollection", features: [] });
  }, [panelFeature]);

  // ── project marker (the orange pin) ──────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    if (projectMarker.current) { projectMarker.current.remove(); projectMarker.current = null; }
    if (location?.lat != null && location?.lng != null) {
      const el = document.createElement("div");
      el.style.cssText = "width:26px;height:26px;background:#fc6a0a;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;";
      projectMarker.current = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([location.lng, location.lat])
        .addTo(map.current);
      projectMarker.current.on("dragend", () => {
        const ll = projectMarker.current.getLngLat();
        const lat = +ll.lat.toFixed(6);
        const lng = +ll.lng.toFixed(6);
        setLatInput(lat); setLngInput(lng);
        onChange({ location: { lat, lng } });
      });
    }
  }, [location?.lat, location?.lng, onChange]);

  // ── KML upload ────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const isKmz = file.name.toLowerCase().endsWith(".kmz");
      let text;
      if (isKmz) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let entries;
        try { entries = unzipSync(buf); }
        catch (e) { throw new Error("Couldn't read KMZ archive: " + (e.message || "unknown error")); }
        const kmlEntry = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith(".kml"));
        if (!kmlEntry) throw new Error("No .kml file found inside the KMZ archive");
        text = strFromU8(kmlEntry[1]);
      } else {
        text = await file.text();
      }
      const xml = new DOMParser().parseFromString(text, "text/xml");
      const parseErr = xml.querySelector("parsererror");
      if (parseErr) throw new Error("KML appears to be malformed XML");
      const geojson = kmlToGeoJSON(xml);
      if (!geojson?.features?.length) throw new Error("No drawable features found in KML");

      const orgKey = (org?.name || "unknown").trim();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${orgKey}/${Date.now()}_${safeName}`;
      const contentType = isKmz
        ? "application/vnd.google-earth.kmz"
        : "application/vnd.google-earth.kml+xml";
      const { error: upErr } = await supabase.storage.from("pw-kml")
        .upload(path, file, { upsert: false, contentType });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("pw-kml")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);

      onChange({
        kml: {
          filename: file.name,
          file_url: signed?.signedUrl || null,
          storage_path: path,
          geojson,
          color: kml?.color || DEFAULT_FEATURE_COLOR,
          visible: true,
        },
      });
    } catch (e) {
      console.error("KML upload failed", e);
      setUploadErr(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [org?.name, kml?.color, onChange]);

  const handleRemoveKml = useCallback(async () => {
    if (!kml) return;
    if (!confirm("Remove the current site boundary?")) return;
    if (kml.storage_path) {
      try { await supabase.storage.from("pw-kml").remove([kml.storage_path]); } catch { /* */ }
    }
    onChange({ kml: null });
    lastFitRef.current = null;
  }, [kml, onChange]);

  const setKmlColor = (c) => { if (kml) onChange({ kml: { ...kml, color: c } }); };
  const toggleKmlVisible = () => { if (kml) onChange({ kml: { ...kml, visible: kml.visible === false } }); };

  // ── Feature save / delete ─────────────────────────────────────────────────
  const persistFeature = useCallback((feature) => {
    const list = [...(featuresRef.current || [])];
    const idx = list.findIndex(f => f.id === feature.id);
    // strip internal `isNew` flag before saving
    const clean = { ...feature };
    delete clean.isNew;
    if (idx === -1) list.push(clean);
    else list[idx] = clean;
    onChange({ site_features: list });
  }, [onChange]);

  const deleteFeature = useCallback((id) => {
    const list = (featuresRef.current || []).filter(f => f.id !== id);
    onChange({ site_features: list });
  }, [onChange]);

  const handleSavePanel = () => {
    if (!panelFeature) return;
    persistFeature(panelFeature);
    setPanelFeature(null);
    // clear preview
    map.current?.getSource("site-features-preview")?.setData({ type: "FeatureCollection", features: [] });
  };
  const handleDeletePanel = () => {
    if (!panelFeature) return;
    if (!panelFeature.isNew && !confirm("Delete this feature?")) return;
    if (!panelFeature.isNew) deleteFeature(panelFeature.id);
    setPanelFeature(null);
    map.current?.getSource("site-features-preview")?.setData({ type: "FeatureCollection", features: [] });
  };
  const handleClosePanel = () => {
    setPanelFeature(null);
    map.current?.getSource("site-features-preview")?.setData({ type: "FeatureCollection", features: [] });
  };

  // Apply manual lat/lng input
  const applyManualLatLng = () => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (!isFinite(lat) || !isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    onChange({ location: { lat: +lat.toFixed(6), lng: +lng.toFixed(6) } });
    map.current?.flyTo({ center: [lng, lat], zoom: 14 });
  };

  // ── styles ────────────────────────────────────────────────────────────────
  const ctrlBtn = (active, color = theme.accent) => ({
    fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6,
    cursor: "pointer", border: `1px solid ${active ? color : theme.border}`,
    background: active ? color + "22" : theme.pillBg,
    color: active ? color : theme.textSecondary,
    fontFamily: "'Inter', system-ui, sans-serif",
    display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
  });
  const inp = (w = 90) => ({
    width: w, background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 5, color: theme.textPrimary, padding: "4px 7px",
    fontSize: 11, outline: "none", fontFamily: "'Inter', system-ui, sans-serif",
  });

  // ── Render ────────────────────────────────────────────────────────────────
  const featureCount = safeFeatures.length;
  const drawHint = {
    "pin":              "Click on the map to drop the project pin",
    "draw-marker":      "Click to drop a marker",
    "draw-area":        "Click to outline · double-click to finish",
    "draw-line":        "Click to trace · double-click to finish",
    "draw-radius":      "Click to set the centre of the radius",
    "measure-distance": "Click to trace · double-click to finish",
    "measure-area":     "Click to outline · double-click to finish",
  }[drawMode];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ── Row 1: KML controls ───────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <label style={ctrlBtn(false)}>
          <input
            type="file"
            accept=".kml,.kmz"
            onChange={(e) => { handleUpload(e.target.files?.[0]); e.target.value = ""; }}
            style={{ display: "none" }}
          />
          {uploading ? "Uploading…" : (kml ? "↻ Replace KML/KMZ" : "+ Upload KML/KMZ")}
        </label>

        {kml && (
          <>
            <span style={{
              fontSize: 11, color: theme.textSecondary,
              padding: "4px 8px", background: theme.pillBg,
              border: `1px solid ${theme.border}`, borderRadius: 6,
              maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={kml.filename}>
              📄 {kml.filename}
            </span>
            <button onClick={toggleKmlVisible} style={ctrlBtn(kml.visible !== false)}>
              {kml.visible === false ? "👁 Show" : "👁 Hide"}
            </button>
            <div style={{ display: "flex", gap: 3, alignItems: "center", padding: "0 2px" }}>
              {COLOURS.map(c => (
                <button key={c} onClick={() => setKmlColor(c)} title={c}
                  style={{
                    width: 18, height: 18, borderRadius: "50%", border: "none",
                    background: c, cursor: "pointer",
                    outline: kml.color === c ? `2px solid ${theme.textPrimary}` : "none",
                    outlineOffset: 1,
                  }} />
              ))}
              <input type="color" value={kml.color || DEFAULT_FEATURE_COLOR} onChange={e => setKmlColor(e.target.value)}
                style={{ width: 22, height: 22, border: "none", padding: 0, background: "transparent", cursor: "pointer" }}
                title="Custom" />
            </div>
            <button onClick={handleRemoveKml} style={{ ...ctrlBtn(false), color: "#ef4444", borderColor: "#ef444433" }}>
              ✕ Remove
            </button>
            {kml.file_url && (
              <a href={kml.file_url} download={kml.filename}
                style={{ ...ctrlBtn(false), textDecoration: "none" }}>
                ⤓ Download
              </a>
            )}
          </>
        )}

        {/* Tools dropdown — drawing tools, pin location, measure */}
        <div ref={toolsWrapRef} style={{ position: "relative" }}>
          <button onClick={() => setToolsOpen(o => !o)}
            style={ctrlBtn(toolsOpen || !!drawMode, "#8b5cf6")}>
            🛠 Tools {drawMode ? "• active" : ""} ▾
          </button>
          {toolsOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 6,
              width: 320, padding: "12px 14px", borderRadius: 10,
              background: theme.pageBg || theme.cardBg,
              border: `1px solid ${theme.border}`,
              boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
              display: "flex", flexDirection: "column", gap: 12,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {/* DRAW */}
              <div>
                <div style={{ fontSize: 9, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  Draw {featureCount > 0 && <span style={{ color: theme.textTertiary, opacity: 0.7, marginLeft: 6 }}>· {featureCount} saved</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <button onClick={() => { setDrawMode("draw-marker"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "draw-marker", "#8b5cf6")}>+ Marker</button>
                  <button onClick={() => { setDrawMode("draw-area"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "draw-area", "#8b5cf6")}>⬡ Area</button>
                  <button onClick={() => { setDrawMode("draw-line"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "draw-line", "#f97316")}>— Line</button>
                  <button onClick={() => { setDrawMode("draw-radius"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "draw-radius", "#06b6d4")}>◯ Radius</button>
                </div>
              </div>

              {/* PIN LOCATION */}
              <div>
                <div style={{ fontSize: 9, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  Project Pin {location && <span style={{ color: theme.textTertiary, opacity: 0.7, marginLeft: 6 }}>· set</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button onClick={() => { setDrawMode("pin"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "pin", "#fc6a0a")}>📍 Click to drop pin</button>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" step="any" placeholder="Lat" value={latInput}
                      onChange={e => setLatInput(e.target.value)} style={{ ...inp(0), flex: 1 }} />
                    <input type="number" step="any" placeholder="Lng" value={lngInput}
                      onChange={e => setLngInput(e.target.value)} style={{ ...inp(0), flex: 1 }} />
                    <button onClick={() => { applyManualLatLng(); setToolsOpen(false); }} style={ctrlBtn(false)}>Apply</button>
                  </div>
                  {location && (
                    <button onClick={() => { onChange({ location: null }); setLatInput(""); setLngInput(""); }}
                      style={{ ...ctrlBtn(false), color: "#ef4444", borderColor: "#ef444433", justifyContent: "center" }}>
                      ✕ Clear pin
                    </button>
                  )}
                </div>
              </div>

              {/* MEASURE */}
              <div>
                <div style={{ fontSize: 9, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  Quick Measure <span style={{ color: theme.textTertiary, opacity: 0.7, marginLeft: 6 }}>· not saved</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <button onClick={() => { try { draw.current?.deleteAll(); } catch { /* */ } setDrawMode("measure-distance"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "measure-distance", "#FC6A0A")}>📏 Distance</button>
                  <button onClick={() => { try { draw.current?.deleteAll(); } catch { /* */ } setDrawMode("measure-area"); setToolsOpen(false); }}
                    style={ctrlBtn(drawMode === "measure-area", "#FC6A0A")}>⬡ Area</button>
                </div>
              </div>

              {drawMode && (
                <button onClick={() => { setDrawMode(null); setToolsOpen(false); }}
                  style={{ ...ctrlBtn(false), color: theme.textTertiary, justifyContent: "center" }}>
                  ✕ Cancel current tool
                </button>
              )}
            </div>
          )}
        </div>

        {/* Master site-overlay toggle — forces the KML + features layer to redraw */}
        <button onClick={() => setLayerOn(v => !v)}
          style={{ ...ctrlBtn(layerOn, "#10b981"), marginLeft: "auto" }}
          title={layerOn ? "Hide the site overlay" : "Show the site overlay"}>
          {layerOn ? "◉ Site layer" : "◯ Site layer"}
        </button>

        <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder || theme.border}`, borderRadius: 6, padding: 2, gap: 2 }}>
          {[["satellite","Satellite"],["road","Road"]].map(([k,l]) => (
            <button key={k} onClick={() => setMapStyle(k)}
              style={{
                fontSize: 10, fontWeight: mapStyle === k ? 700 : 500,
                padding: "3px 8px", borderRadius: 4, cursor: "pointer", border: "none",
                background: mapStyle === k ? (theme.pillActiveBg || theme.accent + "22") : "transparent",
                color: mapStyle === k ? theme.pillActiveText || theme.accent : theme.textSecondary,
              }}>{l}</button>
          ))}
        </div>
      </div>

      {uploadError && (
        <div style={{ fontSize: 11, color: "#ef4444", padding: "4px 8px", background: "#ef444415", borderRadius: 5 }}>
          {uploadError}
        </div>
      )}

      {/* ── Map ────────────────────────────────────────────────────── */}
      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `1px solid ${theme.border}` }}>
        <div ref={mapContainer} style={{ width: "100%", height: 480 }} />

        {/* Mode hint */}
        {drawHint && !panelFeature && (
          <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.8)", color: "#fff", padding: "5px 12px", borderRadius: 6, fontSize: 11, pointerEvents: "none" }}>
            {drawHint}
          </div>
        )}

        {/* Live measure readout — floats on the map (the toolbar is now collapsed) */}
        {measure?.km != null && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(252,106,10,0.95)", color: "#fff", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
            📏 {measure.km.toFixed(2)} km · {(measure.km * 1000).toFixed(0)} m
          </div>
        )}
        {measure?.ha != null && (() => {
          const acres = measure.ha / HA_PER_ACRE;
          const m2 = measure.ha * 10000;
          return (
            <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(252,106,10,0.95)", color: "#fff", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
              ⬡ {acres.toFixed(2)} ac · {measure.ha.toFixed(2)} ha · {Math.round(m2).toLocaleString()} m²
            </div>
          );
        })()}

        {/* ── Annotation panel ────────────────────────────────────── */}
        {panelFeature && (
          <AnnotationPanel
            theme={theme} feature={panelFeature}
            onChange={(patch) => setPanelFeature(prev => prev ? { ...prev, ...patch } : null)}
            onSave={handleSavePanel}
            onDelete={handleDeletePanel}
            onClose={handleClosePanel}
          />
        )}
      </div>
    </div>
  );
}

// ─── Annotation Panel ────────────────────────────────────────────────────────
function AnnotationPanel({ theme, feature, onChange, onSave, onDelete, onClose }) {
  const isRadius = feature.type === "radius";
  const isMarker = feature.type === "marker";
  const isLine   = feature.type === "line";
  const isArea   = feature.type === "area";

  // Compute readout for line distance / area
  const readout = (() => {
    if (isLine && feature.geojson?.geometry?.coordinates?.length >= 2) {
      const km = lineDistanceKm(feature.geojson.geometry.coordinates);
      return `${km.toFixed(2)} km · ${(km * 1000).toFixed(0)} m`;
    }
    if (isArea && feature.geojson?.geometry?.coordinates?.[0]?.length >= 4) {
      return formatAreaReadout(feature.geojson.geometry.coordinates);
    }
    if (isRadius) {
      const r = Number(feature.radius_km) || 0;
      const ha = Math.PI * r * r * 100; // km² → ha
      const acres = ha / HA_PER_ACRE;
      return `${r.toFixed(2)} km radius · ${acres.toFixed(2)} ac · ${ha.toFixed(2)} ha`;
    }
    if (isMarker) return `${feature.lat?.toFixed(5)}, ${feature.lng?.toFixed(5)}`;
    return null;
  })();

  const inp = {
    width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.textPrimary, padding: "6px 9px", fontSize: 12,
    outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif",
  };
  const SH = { fontSize: 9, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 };

  return (
    <div style={{
      position: "absolute", top: 8, right: 8, width: 260,
      maxHeight: "calc(100% - 16px)", overflow: "auto",
      background: theme.pageBg || theme.cardBg,
      border: `1px solid ${theme.border}`, borderRadius: 10,
      boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
      padding: "12px 14px", zIndex: 5,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: feature.type === "line" ? 2 : "50%", background: feature.color || DEFAULT_FEATURE_COLOR, flexShrink: 0 }} />
          {feature.isNew ? "New " : "Edit "}{isRadius ? "radius" : isMarker ? "marker" : isLine ? "line" : "area"}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 14, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ marginBottom: 9 }}>
        <div style={SH}>Name</div>
        <input value={feature.name || ""} onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. East field boundary" style={inp} />
      </div>

      {readout && (
        <div style={{
          background: (feature.color || DEFAULT_FEATURE_COLOR) + "18",
          border: `1px solid ${(feature.color || DEFAULT_FEATURE_COLOR)}44`,
          borderRadius: 6, padding: "6px 9px", marginBottom: 9,
          fontSize: 11, color: feature.color || DEFAULT_FEATURE_COLOR, fontWeight: 600,
        }}>
          {readout}
        </div>
      )}

      {isRadius && (
        <div style={{ marginBottom: 9 }}>
          <div style={SH}>Radius (km)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="range" min="0.05" max="20" step="0.05"
              value={feature.radius_km ?? 0.5}
              onChange={(e) => onChange({ radius_km: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: feature.color || DEFAULT_FEATURE_COLOR }} />
            <input type="number" min="0.01" step="0.05"
              value={feature.radius_km ?? 0.5}
              onChange={(e) => onChange({ radius_km: Math.max(0.01, parseFloat(e.target.value) || 0.01) })}
              style={{ ...inp, width: 64, padding: "5px 6px", fontSize: 11 }} />
          </div>
        </div>
      )}

      <div style={{ marginBottom: 9 }}>
        <div style={SH}>Colour</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {COLOURS.map(c => (
            <button key={c} onClick={() => onChange({ color: c })} title={c}
              style={{
                width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
                background: c, border: "2px solid transparent",
                outline: feature.color === c ? `2px solid ${theme.textPrimary}` : "none",
                outlineOffset: 1, padding: 0,
              }} />
          ))}
          <input type="color" value={feature.color || DEFAULT_FEATURE_COLOR}
            onChange={(e) => onChange({ color: e.target.value })}
            style={{ width: 24, height: 24, border: "none", background: "transparent", cursor: "pointer", padding: 0 }} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={SH}>Notes</div>
        <textarea value={feature.notes || ""} onChange={(e) => onChange({ notes: e.target.value })}
          rows={3} placeholder="Optional notes…"
          style={{ ...inp, resize: "vertical", lineHeight: 1.4 }} />
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onSave} style={{
          flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 7,
          background: feature.color || DEFAULT_FEATURE_COLOR, color: "#fff", border: "none", cursor: "pointer",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>{feature.isNew ? "Save" : "Update"}</button>
        <button onClick={onDelete} style={{
          padding: "8px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7,
          background: "transparent", color: "#ef4444",
          border: "1px solid #ef444444", cursor: "pointer",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>{feature.isNew ? "Cancel" : "Delete"}</button>
      </div>
    </div>
  );
}
