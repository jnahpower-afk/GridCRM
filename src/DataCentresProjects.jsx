// UK Projects map for Data Centres.
//
// A "DC project" = a Data Centre lead that has reached the Proposal stage and
// has had location info added on its Site Map (a project pin and/or drawn
// site features). This page plots every such project on a UK map; clicking a
// marker shows a quick overview, and "Open project" hands off to the existing
// full-screen PrivateWireProjectView via the onOpenProject callback.
//
// No new storage: location + site_features live on private_wire_organisations.data
// (keyed by org name), exactly as written by SiteMap on the Project Overview page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "./supabase.js";
import { useTheme } from "./ThemeContext.jsx";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const STYLES = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  road:      "mapbox://styles/mapbox/streets-v12",
};

const UK_CENTER = [-2.5, 54.2];
const UK_ZOOM = 5;
const PROJECT_COLOR = "#FC6A0A"; // Proposal stage colour

// ─── geometry helpers ────────────────────────────────────────────────────────
// Average every coordinate in a GeoJSON feature/geometry into a single point.
function geojsonCentroid(geojson) {
  let sx = 0, sy = 0, n = 0;
  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      sx += coords[0]; sy += coords[1]; n += 1;
    } else {
      coords.forEach(visit);
    }
  };
  const geom = geojson?.geometry || geojson;
  if (!geom?.coordinates) return null;
  visit(geom.coordinates);
  return n ? { lng: sx / n, lat: sy / n } : null;
}

// Best available coordinate for a project: the project pin first, then any
// point-like feature (marker/radius), then the centroid of the first shape.
function deriveCoord(data) {
  if (!data) return null;
  if (data.location?.lat != null && data.location?.lng != null) {
    return { lat: data.location.lat, lng: data.location.lng };
  }
  const feats = Array.isArray(data.site_features) ? data.site_features : [];
  const point = feats.find(f => (f.type === "marker" || f.type === "radius") && f.lat != null && f.lng != null);
  if (point) return { lat: point.lat, lng: point.lng };
  const shape = feats.find(f => f.geojson);
  if (shape) return geojsonCentroid(shape.geojson);
  return null;
}

function featureCount(data) {
  return Array.isArray(data?.site_features) ? data.site_features.length : 0;
}

// ─── component ───────────────────────────────────────────────────────────────
export default function DataCentresProjects({ leads, onOpenProject }) {
  const { theme } = useTheme();
  const mapContainer = useRef(null);
  const map = useRef(null);
  const mapInit = useRef(false);
  const markers = useRef({}); // name → mapboxgl.Marker

  const [mapStyle, setMapStyle] = useState("road");
  const [orgData, setOrgData] = useState(null); // name → data jsonb (null = loading)
  const [active, setActive] = useState(null);   // selected project for the overview card
  const [cardPos, setCardPos] = useState(null); // marker's screen position, for anchoring the card

  // Select a project: show its card and gently centre/zoom on it.
  const selectProject = useCallback((p) => {
    setActive(p);
    if (map.current) {
      map.current.flyTo({
        center: [p.coord.lng, p.coord.lat],
        zoom: Math.max(map.current.getZoom(), 9),
        duration: 700,
      });
    }
  }, []);

  // Proposal-stage DC leads, grouped to one entry per organisation.
  const proposalOrgs = useMemo(() => {
    const byName = new Map();
    for (const l of leads || []) {
      if ((l.campaign || "PW") !== "DC") continue;
      if (l.stage !== "Proposal") continue;
      if (!l.name) continue;
      if (!byName.has(l.name)) {
        byName.set(l.name, {
          name: l.name,
          stage: l.stage,
          sector: l.sector || "",
          location: l.location || "",
          owner: l.owner || "",
          est_load_mw: l.est_load_mw ?? null,
        });
      }
    }
    return [...byName.values()];
  }, [leads]);

  // Fetch the saved Site Map data (location + site_features) for those orgs.
  useEffect(() => {
    let cancelled = false;
    const names = proposalOrgs.map(o => o.name);
    if (names.length === 0) { setOrgData({}); return; }
    (async () => {
      const { data, error } = await supabase
        .from("private_wire_organisations")
        .select("name, data")
        .in("name", names);
      if (cancelled) return;
      const map = {};
      if (!error) for (const row of data || []) map[row.name] = row.data || {};
      setOrgData(map);
    })();
    return () => { cancelled = true; };
  }, [proposalOrgs]);

  // Projects that actually have a plottable location.
  const projects = useMemo(() => {
    if (!orgData) return [];
    return proposalOrgs
      .map(org => {
        const data = orgData[org.name] || {};
        const coord = deriveCoord(data);
        return coord ? { org, data, coord, features: featureCount(data) } : null;
      })
      .filter(Boolean);
  }, [proposalOrgs, orgData]);

  // ── init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInit.current || !mapContainer.current) return;
    mapInit.current = true;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: STYLES[mapStyle],
      center: UK_CENTER,
      zoom: UK_ZOOM,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-left");
    map.current.on("click", () => setActive(null)); // click empty map → close card
    return () => {
      Object.values(markers.current).forEach(m => m.remove());
      markers.current = {};
      map.current?.remove();
      map.current = null;
      mapInit.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style change
  useEffect(() => {
    if (map.current) map.current.setStyle(STYLES[mapStyle]);
  }, [mapStyle]);

  // Keep the Mapbox canvas in sync when the container resizes (e.g. the
  // dashboard widget is dragged smaller/larger in Edit Layout mode).
  useEffect(() => {
    const el = mapContainer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── render markers ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    Object.values(markers.current).forEach(m => m.remove());
    markers.current = {};
    projects.forEach(p => {
      // Outer element is positioned by Mapbox (don't touch its transform);
      // the inner element carries the teardrop shape + hover scaling.
      const el = document.createElement("div");
      el.style.cssText = "width:24px;height:24px;cursor:pointer;";
      const inner = document.createElement("div");
      inner.style.cssText =
        `width:24px;height:24px;background:${PROJECT_COLOR};border:3px solid #fff;` +
        `border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
        `box-shadow:0 2px 8px rgba(0,0,0,0.45);transition:transform 0.12s;`;
      el.appendChild(inner);
      el.title = p.org.name;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        selectProject(p);
      });
      el.addEventListener("mouseenter", () => { inner.style.transform = "rotate(-45deg) scale(1.18)"; });
      el.addEventListener("mouseleave", () => { inner.style.transform = "rotate(-45deg)"; });
      markers.current[p.org.name] = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([p.coord.lng, p.coord.lat])
        .addTo(map.current);
    });
  }, [projects, selectProject]);

  // Keep the overview card pinned to the active marker as the map moves.
  useEffect(() => {
    if (!map.current || !active) { setCardPos(null); return; }
    const update = () => {
      if (!map.current) return;
      const pt = map.current.project([active.coord.lng, active.coord.lat]);
      setCardPos({ x: pt.x, y: pt.y });
    };
    update();
    map.current.on("move", update);
    return () => { map.current?.off("move", update); };
  }, [active]);

  // ── styles ────────────────────────────────────────────────────────────────────
  const loading = orgData === null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, gap: 10, minHeight: 0 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>UK Projects</span>
        <span style={{ fontSize: 11, color: theme.textMuted, background: theme.pillBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
          {loading ? "…" : `${projects.length} on map`}
        </span>
        {!loading && proposalOrgs.length > projects.length && (
          <span style={{ fontSize: 11, color: theme.textMuted }}>
            {proposalOrgs.length - projects.length} proposal{proposalOrgs.length - projects.length > 1 ? "s" : ""} without a Site Map location
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder || theme.border}`, borderRadius: 6, padding: 2, gap: 2 }}>
          {[["road", "Road"], ["satellite", "Satellite"]].map(([k, l]) => (
            <button key={k} onClick={() => setMapStyle(k)}
              style={{
                fontSize: 10, fontWeight: mapStyle === k ? 700 : 500,
                padding: "3px 10px", borderRadius: 4, cursor: "pointer", border: "none",
                background: mapStyle === k ? (theme.pillActiveBg || theme.accent + "22") : "transparent",
                color: mapStyle === k ? theme.pillActiveText || theme.accent : theme.textSecondary,
              }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Map + overview card */}
      <div style={{ position: "relative", flex: 1, minHeight: 120, borderRadius: 8, overflow: "hidden", border: `1px solid ${theme.border}` }}>
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

        {/* Empty state */}
        {!loading && projects.length === 0 && (
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.8)", color: "#fff", padding: "8px 16px",
            borderRadius: 8, fontSize: 12, maxWidth: 460, textAlign: "center", lineHeight: 1.5,
          }}>
            No Data Centre projects to show yet. Move a DC lead to <strong>Proposal</strong> and add a
            pin or shape on its <strong>Site Map</strong> (Project Overview) to see it here.
          </div>
        )}

        {/* Quick overview card — anchored just above the active marker */}
        {active && cardPos && (
          <div style={{
            position: "absolute",
            left: cardPos.x, top: cardPos.y,
            transform: "translate(-50%, calc(-100% - 22px))",
            width: 260, zIndex: 5,
            background: theme.pageBg || theme.cardBg,
            border: `1px solid ${theme.border}`, borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)", padding: "14px 16px",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}>
            {/* pointer triangle */}
            <div style={{
              position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%) rotate(45deg)",
              width: 12, height: 12, background: theme.pageBg || theme.cardBg,
              borderRight: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`,
            }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, lineHeight: 1.3 }}>
                {active.org.name}
              </div>
              <button onClick={() => setActive(null)}
                style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: PROJECT_COLOR + "22", color: PROJECT_COLOR }}>
                {active.org.stage}
              </span>
              {active.org.sector && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: theme.pillBg, color: theme.textSecondary, border: `1px solid ${theme.border}` }}>
                  {active.org.sector}
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
              <Row theme={theme} label="Est. load" value={active.org.est_load_mw != null ? `${active.org.est_load_mw} MW` : "—"} />
              <Row theme={theme} label="Location" value={active.org.location || "—"} />
              <Row theme={theme} label="Owner" value={active.org.owner || "—"} />
              <Row theme={theme} label="Site features" value={`${active.features} on map`} />
            </div>

            <button onClick={() => onOpenProject?.(active.org)}
              style={{
                width: "100%", padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 8,
                background: theme.accent, color: "#fff", border: "none", cursor: "pointer",
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>
              Open project →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ theme, label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
      <span style={{ color: theme.textTertiary }}>{label}</span>
      <span style={{ color: theme.textPrimary, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
