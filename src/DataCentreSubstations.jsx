// Data Centres → Substations: a Leads-style table of every 11kV import-connection
// opportunity, grouped per DNO region. Each region row carries its assignee as an
// inline avatar chip (click to (re)assign) — no separate assignment bar.
// Reads dc_network_features (markers), dc_dno_assignments, and profiles.

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "./supabase.js";
import { useTheme } from "./ThemeContext.jsx";
import { capacityRagColor, isInTarget, DC_STATUS_COLORS, DC_STATUS_OPTIONS, DNO_OPTIONS, NETWORK_TYPE_MAP } from "./NetworkMap.jsx";

const DNO_COLORS = { NGED: "#3b82f6", NPG: "#8b5cf6", UKPN: "#ec4899", SSEN: "#10b981", ENWL: "#f59e0b", SPEN: "#06b6d4" };
const COLS = "0.3fr 1.6fr 0.8fr 1.2fr 0.9fr 0.9fr 1.1fr 1.1fr 1fr 0.7fr 1.2fr";
const HEADERS = ["", "Substation", "Capacity", "Status", "DNO Ref", "Conn. Cost", "Contact", "Next Action", "Owner", "Updated", ""];

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; }
}

// A person may be stored as a full name ("Joseph Lord") or an email
// ("joseph.lord@fuseenergy.com"). Reduce either to a friendly first name + initials.
function nameParts(name) {
  if (!name) return [];
  if (name.includes("@")) return name.split("@")[0].split(/[._-]/).filter(Boolean);
  return name.split(/\s+/).filter(Boolean);
}
function firstName(name) {
  const p = nameParts(name)[0];
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : "";
}
function initials(name) {
  const p = nameParts(name);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

export default function DataCentreSubstations({ onOpenMap, onOpenLead, refreshKey = 0 }) {
  const { theme } = useTheme();
  const [features, setFeatures] = useState([]);
  const [leads, setLeads] = useState([]);
  const [assignments, setAssignments] = useState([]); // {dno, assignee_id, assignee_name}
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set()); // DNO groups collapsed by default
  const [expandedSub, setExpandedSub] = useState(() => new Set()); // substation rows collapsed by default
  const [editingId, setEditingId] = useState(null); // substation being edited inline
  const [editForm, setEditForm] = useState({});
  const [confirmState, setConfirmState] = useState(null); // { message, onConfirm } — in-app confirm
  const [renameState, setRenameState] = useState(null);   // { id, value } — in-app rename
  const [assignFor, setAssignFor] = useState(null);       // DNO whose inline assignee dropdown is open
  const toggleGroup = (dno) => setExpanded(prev => { const n = new Set(prev); n.has(dno) ? n.delete(dno) : n.add(dno); return n; });
  const toggleSub = (id) => setExpandedSub(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const load = useCallback(async () => {
    const [featRes, leadRes, asgRes, profRes] = await Promise.all([
      supabase.from("dc_network_features").select("*").order("created_at", { ascending: false }),
      supabase.from("dc_substation_leads").select("*").order("created_at", { ascending: false }),
      supabase.from("dc_dno_assignments").select("dno, assignee_id, assignee_name"),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
    ]);
    setFeatures(featRes.data || []);
    setLeads(leadRes.data || []);
    setAssignments(asgRes.data || []);
    setProfiles(profRes.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const leadsFor   = useCallback((subId) => leads.filter(l => l.substation_id === subId), [leads]);
  const parcelsFor = useCallback((subId) => features.filter(f => f.substation_id === subId), [features]);

  // ── Substation edit / delete ────────────────────────────────────────────────
  const startEdit = (s) => { setEditingId(s.id); setEditForm({ name: s.name || "", capacity_mw: s.capacity_mw ?? "", status: s.status || "", dno: s.dno || "", dno_reference: s.dno_reference || "", connection_cost: s.connection_cost || "", contact: s.contact || "", next_action: s.next_action || "" }); };
  const saveEdit = async () => {
    const f = editForm;
    const patch = { name: f.name.trim() || "Unnamed", capacity_mw: f.capacity_mw === "" ? null : Number(f.capacity_mw), status: f.status || null, dno: f.dno || null, dno_reference: f.dno_reference || null, connection_cost: f.connection_cost || null, contact: f.contact || null, next_action: f.next_action || null };
    const { error } = await supabase.from("dc_network_features").update(patch).eq("id", editingId);
    if (error) { console.error("Failed to save substation:", error); return; }
    setFeatures(prev => prev.map(x => x.id === editingId ? { ...x, ...patch } : x));
    setEditingId(null);
  };
  // In-app confirm / rename dialogs (no native browser popups)
  const askConfirm = (message, onConfirm) => setConfirmState({ message, onConfirm });
  const deleteSub = (s) => askConfirm(`Delete "${s.name || "this substation"}" and all its parcels, leads and surgeries? This cannot be undone.`, async () => {
    await supabase.from("dc_network_features").delete().eq("substation_id", s.id); // parcels
    const { error } = await supabase.from("dc_network_features").delete().eq("id", s.id); // leads/surgeries cascade
    if (error) console.error("Failed to delete substation:", error);
    load();
  });
  const deleteLead = (lead) => askConfirm(`Delete lead "${lead.name}"?`, async () => {
    await supabase.from("dc_substation_leads").delete().eq("id", lead.id);
    load();
  });
  const deleteParcel = (pc) => askConfirm(`Delete parcel "${pc.name || "this parcel"}"?`, async () => {
    await supabase.from("dc_network_features").delete().eq("id", pc.id);
    load();
  });
  const renameParcel = (pc) => setRenameState({ id: pc.id, value: pc.name || "" });
  const saveRename = async () => {
    if (!renameState) return;
    await supabase.from("dc_network_features").update({ name: renameState.value.trim() || null }).eq("id", renameState.id);
    setRenameState(null);
    load();
  };

  const profileName = useCallback(
    (id) => { const p = profiles.find(p => p.id === id); return p ? (p.full_name || p.email) : null; },
    [profiles],
  );
  const assigneeFor = useCallback(
    (dno) => assignments.find(a => a.dno === dno)?.assignee_name || null,
    [assignments],
  );
  const assignIdFor = useCallback(
    (dno) => assignments.find(a => a.dno === dno)?.assignee_id || "",
    [assignments],
  );

  // Substation opportunity markers only (points; exclude radii / lines / areas).
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return features.filter(f =>
      !f.substation_id && f.lat != null && f.lng != null && f.type !== "radius" && !f.geojson &&
      (!q || (f.name || "").toLowerCase().includes(q) || (f.dno_reference || "").toLowerCase().includes(q) || (f.contact || "").toLowerCase().includes(q)),
    );
  }, [features, search]);

  // Group by DNO in a stable order, with an Unassigned bucket last. Every DNO
  // region is always shown (even with no sites) so it can still be assigned —
  // except while searching, when empty regions are hidden to reduce noise.
  const groups = useMemo(() => {
    const order = [...DNO_OPTIONS];
    const byDno = {};
    for (const f of rows) {
      const key = order.includes(f.dno) ? f.dno : "Unassigned";
      (byDno[key] = byDno[key] || []).push(f);
    }
    // Assigned regions first, unassigned regions after; within each, most sites first.
    const isAssigned = (d) => !!assignments.find(a => a.dno === d)?.assignee_id;
    const bySites = (a, b) => b.rows.length - a.rows.length;
    const regions = order.map(d => ({ dno: d, rows: byDno[d] || [] }));
    let result = [
      ...regions.filter(g => isAssigned(g.dno)).sort(bySites),
      ...regions.filter(g => !isAssigned(g.dno)).sort(bySites),
    ];
    if (byDno.Unassigned?.length) result.push({ dno: "Unassigned", rows: byDno.Unassigned });
    if (search.trim()) result = result.filter(g => g.rows.length);
    return result;
  }, [rows, search, assignments]);

  const handleAssign = useCallback(async (dno, assigneeId) => {
    const prof = profiles.find(p => p.id === assigneeId);
    const assignee_name = prof ? (prof.full_name || prof.email) : null;
    const assignee_id = assigneeId || null;
    // optimistic
    setAssignments(prev => {
      const others = prev.filter(a => a.dno !== dno);
      return [...others, { dno, assignee_id, assignee_name }];
    });
    const { error } = await supabase.from("dc_dno_assignments")
      .upsert({ dno, assignee_id, assignee_name, updated_at: new Date().toISOString() }, { onConflict: "dno" });
    if (error) { console.error("Failed to save assignment:", error); load(); }
  }, [profiles, load]);

  const totalInTarget = rows.filter(r => isInTarget(r.capacity_mw)).length;

  const cell = { fontSize: 12, color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary }}>Substations</div>
        <span style={{ fontSize: 11, color: theme.textMuted, background: theme.pillBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{rows.length}</span>
        <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>{totalInTarget} in target (3–10MW)</span>
        <div style={{ marginLeft: "auto" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search substations…"
            style={{ width: 220, background: theme.pillBg, border: `1px solid ${theme.pillBorder || theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: "6px 12px", fontSize: 12, outline: "none", fontFamily: "inherit" }} />
        </div>
      </div>

      {loading ? (
        <div style={{ color: theme.textMuted, fontSize: 13, textAlign: "center", marginTop: 40 }}>Loading…</div>
      ) : (
        groups.map(group => {
          const inTargetMw = group.rows.filter(r => isInTarget(r.capacity_mw)).reduce((s, r) => s + (Number(r.capacity_mw) || 0), 0);
          const gc = DNO_COLORS[group.dno] || theme.textMuted;
          const isOpen = expanded.has(group.dno) || !!search.trim(); // searching reveals matches
          const isRegion = DNO_OPTIONS.includes(group.dno); // Unassigned bucket isn't a real region
          const asg = assigneeFor(group.dno);
          const empty = group.rows.length === 0;
          return (
            <div key={group.dno} style={{ marginBottom: empty ? 10 : 26 }}>
              {/* Group header — click to expand/collapse */}
              <div onClick={() => toggleGroup(group.dno)}
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "7px 10px", borderRadius: 8, background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, cursor: "pointer", userSelect: "none" }}>
                <span style={{ display: "inline-block", width: 10, fontSize: 10, color: theme.textTertiary, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", opacity: empty ? 0.35 : 1 }}>▸</span>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: gc }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{group.dno}</span>

                {/* Assignee chip / inline selector (real regions only) */}
                {isRegion && (
                  <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center" }}>
                    {assignFor === group.dno ? (
                      <select autoFocus value={assignIdFor(group.dno)}
                        onChange={e => { handleAssign(group.dno, e.target.value); setAssignFor(null); }}
                        onBlur={() => setAssignFor(null)}
                        style={{ background: theme.surfaceBg || theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "3px 6px", fontSize: 11, outline: "none", cursor: "pointer", fontFamily: "inherit" }}>
                        <option value="">Unassigned</option>
                        {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                      </select>
                    ) : asg ? (
                      <button onClick={() => setAssignFor(group.dno)} title="Reassign"
                        style={{ display: "flex", alignItems: "center", gap: 6, background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "2px 9px 2px 2px", cursor: "pointer", fontFamily: "inherit" }}>
                        <span style={{ width: 18, height: 18, borderRadius: "50%", background: gc + "33", color: gc, fontSize: 8, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(asg)}</span>
                        <span style={{ fontSize: 11, color: theme.textSecondary, fontWeight: 600 }}>{firstName(asg)}</span>
                      </button>
                    ) : (
                      <button onClick={() => setAssignFor(group.dno)}
                        style={{ fontSize: 11, color: theme.textMuted, background: "none", border: `1px dashed ${theme.border}`, borderRadius: 20, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}>+ Assign</button>
                    )}
                  </div>
                )}

                <span style={{ fontSize: 10, color: theme.textMuted, marginLeft: "auto" }}>{group.rows.length} site{group.rows.length !== 1 ? "s" : ""}</span>
                {inTargetMw > 0 && <span style={{ fontSize: 10, color: "#10b981" }}>{inTargetMw.toFixed(1)} MW in target</span>}
              </div>

              {isOpen && !empty && (
              <>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "4px 14px" }}>
                {HEADERS.map(h => <div key={h} style={{ fontSize: 9, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{h}</div>)}
              </div>

              {/* Rows */}
              {group.rows.map(r => {
                const rag = capacityRagColor(r.capacity_mw);
                const sc = DC_STATUS_COLORS[r.status] || theme.textMuted;
                const open = expandedSub.has(r.id);
                const subLeads = leadsFor(r.id);
                const subParcels = parcelsFor(r.id);
                const actBtn = { fontSize: 12, fontWeight: 700, padding: "5px 9px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.surfaceBg || theme.pillBg, color: theme.textSecondary, cursor: "pointer", lineHeight: 1 };
                const editBtn = { ...actBtn, color: theme.accent, borderColor: theme.accent + "66", background: theme.accent + "1c" };
                const delBtn  = { ...actBtn, color: "#ef4444", borderColor: "#ef444455", background: "#ef444414" };
                return (
                  <div key={r.id} style={{ marginBottom: 6, background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 8 }}>
                    {editingId === r.id ? (
                      /* Inline edit form */
                      <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {[["name", "Name"], ["capacity_mw", "Capacity (MW)"], ["dno_reference", "DNO Ref"], ["connection_cost", "Conn. cost"], ["contact", "Contact"], ["next_action", "Next action"]].map(([k, label]) => (
                          <label key={k} style={{ fontSize: 10, color: theme.textTertiary }}>{label}
                            <input value={editForm[k] ?? ""} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={{ width: "100%", marginTop: 3, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif" }} /></label>
                        ))}
                        <label style={{ fontSize: 10, color: theme.textTertiary }}>Status
                          <select value={editForm.status ?? ""} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} style={{ width: "100%", marginTop: 3, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>
                            <option value="">—</option>{DC_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
                        <label style={{ fontSize: 10, color: theme.textTertiary }}>DNO
                          <select value={editForm.dno ?? ""} onChange={e => setEditForm(f => ({ ...f, dno: e.target.value }))} style={{ width: "100%", marginTop: 3, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "6px 8px", fontSize: 12, cursor: "pointer" }}>
                            <option value="">—</option>{DNO_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
                        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, marginTop: 4 }}>
                          <button onClick={saveEdit} style={{ ...actBtn, background: theme.accent, color: "#fff", border: "none" }}>Save</button>
                          <button onClick={() => setEditingId(null)} style={actBtn}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "11px 14px", alignItems: "center" }}>
                        <button onClick={() => toggleSub(r.id)} title={open ? "Collapse" : "Expand"} style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textSecondary, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>▸</button>
                        <div onClick={() => onOpenMap?.(r)} title="Open on Network Map" style={{ ...cell, color: theme.textPrimary, fontWeight: 600, cursor: onOpenMap ? "pointer" : "default" }}>{r.name || "Unnamed"}</div>
                        <div style={{ ...cell, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", background: rag || theme.border, flexShrink: 0 }} />
                          {r.capacity_mw != null ? `${r.capacity_mw} MW` : "—"}
                        </div>
                        <div style={cell}>{r.status ? <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: sc + "22", color: sc }}>{r.status}</span> : "—"}</div>
                        <div style={cell}>{r.dno_reference || "—"}</div>
                        <div style={cell}>{r.connection_cost || "—"}</div>
                        <div style={cell}>{r.contact || "—"}</div>
                        <div style={cell}>{r.next_action || "—"}</div>
                        <div style={{ ...cell, display: "flex", alignItems: "center", gap: 5 }}>
                          {profileName(r.created_by) ? (<>
                            <span style={{ width: 16, height: 16, borderRadius: "50%", background: theme.accent + "2e", color: theme.accent, fontSize: 7, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(profileName(r.created_by))}</span>
                            {firstName(profileName(r.created_by))}
                          </>) : "—"}
                        </div>
                        <div style={{ ...cell, fontFamily: "monospace", color: theme.textTertiary }}>{fmtDate(r.created_at)}</div>
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <button title="Edit substation" onClick={() => startEdit(r)} style={editBtn}>✎ Edit</button>
                          <button title="Delete substation" onClick={() => deleteSub(r)} style={delBtn}>🗑</button>
                        </div>
                      </div>
                    )}

                    {open && editingId !== r.id && (
                      <div style={{ borderTop: `1px solid ${theme.borderSubtle || theme.border}`, padding: "10px 14px 12px 34px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                        {/* Leads */}
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Leads ({subLeads.length})</div>
                          {subLeads.length === 0 && <div style={{ fontSize: 11, color: theme.textMuted }}>No leads.</div>}
                          {subLeads.map(l => (
                            <div key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
                              <div onClick={() => onOpenLead?.(l, r)} style={{ cursor: onOpenLead ? "pointer" : "default", minWidth: 0 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{l.name}</span>
                                <span style={{ fontSize: 10, color: theme.textTertiary, marginLeft: 6 }}>{l.status || "new"}</span>
                              </div>
                              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                                <button title="Open lead" onClick={() => onOpenLead?.(l, r)} style={editBtn}>✎</button>
                                <button title="Delete lead" onClick={() => deleteLead(l)} style={delBtn}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Parcels */}
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Parcels ({subParcels.length})</div>
                          {subParcels.length === 0 && <div style={{ fontSize: 11, color: theme.textMuted }}>No parcels. Draw them on the Network Map.</div>}
                          {subParcels.map(pc => (
                            <div key={pc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 0" }}>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{pc.name || "Parcel"}</span>
                                <span style={{ fontSize: 10, color: theme.textTertiary, marginLeft: 6 }}>{NETWORK_TYPE_MAP[pc.type]?.label || pc.type}</span>
                              </div>
                              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                                <button title="Rename parcel" onClick={() => renameParcel(pc)} style={editBtn}>✎</button>
                                <button title="Delete parcel" onClick={() => deleteParcel(pc)} style={delBtn}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </>
              )}
            </div>
          );
        })
      )}

      {/* In-app confirm dialog */}
      {confirmState && (
        <div onClick={() => setConfirmState(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 380, background: theme.elevatedBg || theme.cardBg, borderRadius: 12, border: `1px solid ${theme.border}`, padding: 22, boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: 13, color: theme.textPrimary, lineHeight: 1.5, marginBottom: 18 }}>{confirmState.message}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmState(null)} style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, background: "transparent", color: theme.textSecondary, border: `1px solid ${theme.border}`, cursor: "pointer" }}>Cancel</button>
              <button onClick={async () => { const fn = confirmState.onConfirm; setConfirmState(null); await fn?.(); }} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, background: "#ef4444", color: "#fff", border: "none", cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* In-app rename dialog */}
      {renameState && (
        <div onClick={() => setRenameState(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 380, background: theme.elevatedBg || theme.cardBg, borderRadius: 12, border: `1px solid ${theme.border}`, padding: 22, boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Parcel name</div>
            <input autoFocus value={renameState.value} onChange={e => setRenameState(s => ({ ...s, value: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") saveRename(); }}
              style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: "8px 11px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setRenameState(null)} style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, background: "transparent", color: theme.textSecondary, border: `1px solid ${theme.border}`, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveRename} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, background: theme.accent, color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
