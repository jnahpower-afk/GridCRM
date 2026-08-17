import { useState, useEffect, useCallback } from "react";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES = [
  { value: "not_contacted",        label: "Not Contacted",       color: "#64748b" },
  { value: "contacted",            label: "Contacted",           color: "#3b82f6" },
  { value: "project_received",     label: "Project Received",    color: "#f59e0b" },
  { value: "nbo_submitted",        label: "NBO Submitted",       color: "#8b5cf6" },
  { value: "no_projects_available",label: "No Projects Available",color: "#ef4444" },
];
const STAGE_MAP   = Object.fromEntries(STAGES.map(s => [s.value, s]));
const STAGE_ORDER = { nbo_submitted: 0, project_received: 1, contacted: 2, not_contacted: 3, no_projects_available: 4 };

const TEAM = ["Laurie Campbell", "Max Karous", "Maher Chaabane", "Dany Dbaibo", "Eoin McEvoy"];
const CHANNELS = ["Email", "LinkedIn", "Call", "WhatsApp", "Meeting"];

const EMPTY_FORM = {
  category: "developer", developer: "", contact_name: "", email: "", phone: "",
  stage: "not_contacted", date_contacted: "", project_name: "",
  owner: "", notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StageBadge({ stage }) {
  const s = STAGE_MAP[stage] || STAGE_MAP.not_contacted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: s.color, background: s.color + "18", border: `1px solid ${s.color}33`, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
  );
}

function ColumnFilter({ label, filterKey, value, options, onChange, isOpen, onToggle, theme }) {
  const isFiltered = value !== "All";
  return (
    <th onClick={e => { e.stopPropagation(); onToggle(isOpen ? null : filterKey); }}
      style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: isFiltered ? theme.accent : theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg, cursor: "pointer", userSelect: "none", position: "relative", whiteSpace: "nowrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ fontSize: 8, transform: isOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s", display: "inline-block" }}>▼</span>
        {isFiltered && <span style={{ width: 6, height: 6, borderRadius: "50%", background: theme.accent, flexShrink: 0 }} />}
      </div>
      {isOpen && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: "absolute", top: "100%", left: 0, zIndex: 200, minWidth: 200, maxHeight: 280, overflowY: "auto", background: theme.elevatedBg || theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", marginTop: 2 }}>
          {["All", ...options].map(opt => (
            <div key={opt} onClick={() => { onChange(opt); onToggle(null); }}
              style={{ padding: "7px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, background: value === opt ? (theme.accent + "18") : "transparent", color: value === opt ? theme.accent : theme.textPrimary, fontWeight: value === opt ? 700 : 400 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${value === opt ? theme.accent : theme.border}`, background: value === opt ? theme.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", flexShrink: 0 }}>{value === opt ? "✓" : ""}</span>
              {opt}
            </div>
          ))}
        </div>
      )}
    </th>
  );
}

// ─── Main component (Leads only) ──────────────────────────────────────────────

export default function AcquisitionTracker({ session }) {
  const { theme } = useTheme();

  const [leads, setLeads]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [teamMembers, setTeamMembers] = useState(TEAM); // fallback to hardcoded list
  const [category, setCategory]     = useState("developer"); // "developer" | "land_manager"
  const [selectedId, setSelectedId] = useState(null);
  const [isAdding, setIsAdding]     = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [filterStage, setFilterStage] = useState("All");
  const [filterOwner, setFilterOwner] = useState("All");
  const [openFilter, setOpenFilter] = useState(null);
  const [search, setSearch]         = useState("");
  const [newActivity, setNewActivity] = useState({ channel: "Email", direction: "Outbound", notes: "", response: false });

  // ── Load ─────────────────────────────────────────────────────────────────────
  const loadLeads = useCallback(async () => {
    const [leadsRes, profilesRes, activityRes] = await Promise.all([
      supabase.from("acquisition_leads").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("acquisition_activity_log").select("*").order("date", { ascending: false }),
    ]);
    if (leadsRes.data) {
      const activities = activityRes.data || [];
      const leadsWithLogs = leadsRes.data.map(lead => ({
        ...lead,
        activityLog: activities.filter(a => a.lead_id === lead.id),
      }));
      setLeads(leadsWithLogs);
    }
    if (!profilesRes.error && profilesRes.data?.length > 0) {
      const names = profilesRes.data
        .map(p => p.full_name?.trim() || p.email)
        .filter(Boolean)
        .sort();
      setTeamMembers(names);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selected     = leads.find(l => l.id === selectedId);
  const allOwners    = [...new Set(leads.map(l => l.owner).filter(Boolean))].sort();
  const allStageVals = [...new Set(leads.map(l => l.stage))];

  const filtered = leads
    .filter(l => filterStage === "All" || l.stage === filterStage)
    .filter(l => filterOwner === "All" || l.owner === filterOwner)
    .filter(l => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (l.developer || "").toLowerCase().includes(q) || (l.contact_name || "").toLowerCase().includes(q);
    })
    .sort((a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99));

  const stageCounts = STAGES.map(s => ({ ...s, count: leads.filter(l => l.stage === s.value).length }));
  const activeFilterCount = [filterStage, filterOwner].filter(f => f !== "All").length;

  // ── Form sync ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (selected) {
      setForm({
        category: selected.category || "developer",
        developer: selected.developer || "",
        contact_name: selected.contact_name || "",
        email: selected.email || "",
        phone: selected.phone || "",
        stage: selected.stage || "not_contacted",
        date_contacted: selected.date_contacted ? selected.date_contacted.slice(0, 10) : "",
        project_name: selected.project_name || "",
        owner: selected.owner || "",
        notes: selected.notes || "",
      });
      setDirty(false);
    }
  }, [selectedId]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.developer.trim()) return;
    setSaving(true);
    const payload = { ...form, date_contacted: form.date_contacted || null, project_name: form.project_name || null, owner: form.owner || null, notes: form.notes || null, created_by: session.user.id };
    const { data } = await supabase.from("acquisition_leads").insert(payload).select().single();
    if (data) { setLeads(p => [data, ...p]); setSelectedId(data.id); setIsAdding(false); }
    setSaving(false);
  };

  const handleSave = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    const payload = { ...form, date_contacted: form.date_contacted || null, project_name: form.project_name || null, owner: form.owner || null, notes: form.notes || null };
    await supabase.from("acquisition_leads").update(payload).eq("id", selected.id);
    setLeads(p => p.map(l => l.id === selected.id ? { ...l, ...payload } : l));
    setDirty(false);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected || !confirm(`Delete "${selected.developer}"? This cannot be undone.`)) return;
    await supabase.from("acquisition_leads").delete().eq("id", selected.id);
    setLeads(p => p.filter(l => l.id !== selected.id));
    setSelectedId(null);
  };

  const handleStageChange = async (newStage) => {
    if (!selected) return;
    await supabase.from("acquisition_leads").update({ stage: newStage }).eq("id", selected.id);
    setLeads(p => p.map(l => l.id === selected.id ? { ...l, stage: newStage } : l));
    setForm(f => ({ ...f, stage: newStage }));
  };

  const handleLogActivity = async () => {
    if (!newActivity.notes.trim() || !selected) return;
    const todayDate = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("acquisition_activity_log")
      .insert([{
        lead_id: selected.id,
        date: todayDate,
        channel: newActivity.channel,
        direction: newActivity.direction,
        notes: newActivity.notes,
        response: newActivity.response,
        created_at: new Date().toISOString(),
      }])
      .select();
    if (error) { console.error("Error logging activity:", error); return; }
    if (data?.[0]) {
      setLeads(prev => prev.map(l =>
        l.id === selected.id
          ? { ...l, activityLog: [data[0], ...(l.activityLog || [])] }
          : l
      ));
    }
    setNewActivity({ channel: "Email", direction: "Outbound", notes: "", response: false });
  };

  function field(key) {
    return { value: form[key], onChange: e => { setForm(f => ({ ...f, [key]: e.target.value })); setDirty(true); } };
  }

  const inp = { width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif" };
  const SH  = { fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div onClick={() => openFilter && setOpenFilter(null)}
      style={{ display: "flex", height: "100%", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary, overflow: "hidden" }}>

      {/* ── Left detail panel ─────────────────────────────────────────────── */}
      {(selected || isAdding) && (
        <div style={{ width: 380, flexShrink: 0, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>{isAdding ? "New Lead" : (selected?.developer || "Lead")}</div>
            <div onClick={() => { setSelectedId(null); setIsAdding(false); }} style={{ cursor: "pointer", fontSize: 14, color: theme.textTertiary, padding: "2px 6px" }}>✕</div>
          </div>

          {/* Stage pipeline — edit mode */}
          {!isAdding && selected && (
            <div style={{ marginBottom: 16 }}>
              <div style={SH}>Pipeline Stage</div>
              <div style={{ display: "flex", gap: 3 }}>
                {STAGES.map(s => {
                  const isCurrent = (selected.stage || "not_contacted") === s.value;
                  const idx = STAGES.findIndex(x => x.value === selected.stage);
                  const thisIdx = STAGES.findIndex(x => x.value === s.value);
                  const isPast = thisIdx < idx && selected.stage !== "dead";
                  const sc = STAGE_MAP[selected.stage]?.color || s.color;
                  return (
                    <div key={s.value} onClick={() => handleStageChange(s.value)}
                      style={{ flex: 1, cursor: "pointer", textAlign: "center", padding: "5px 1px", borderRadius: 6, background: isCurrent ? s.color + "20" : "transparent", transition: "all 0.15s" }}>
                      <div style={{ height: 16, borderRadius: 3, background: isCurrent ? sc : isPast ? sc : theme.pillBg || theme.border, opacity: isCurrent ? 1 : isPast ? 0.4 : 0.25, transition: "all 0.2s" }} />
                      <div style={{ fontSize: 7.5, color: isCurrent ? s.color : theme.textTertiary, marginTop: 3, fontWeight: isCurrent ? 700 : 400, lineHeight: 1.1 }}>{s.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}


          {/* Details */}
          <div style={{ marginBottom: 10 }}>
            <div style={SH}>Developer / Organisation *</div>
            <input {...field("developer")} placeholder="e.g. BayWa r.e." style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div><div style={SH}>Contact Name</div><input {...field("contact_name")} placeholder="e.g. Nick Kay" style={inp} /></div>
            <div>
              <div style={SH}>Owner</div>
              <select value={form.owner} onChange={e => { setForm(f => ({ ...f, owner: e.target.value })); setDirty(true); }} style={{ ...inp, appearance: "none", cursor: "pointer" }}>
                <option value="">— Unassigned —</option>
                {teamMembers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div><div style={SH}>Email</div><input {...field("email")} placeholder="name@company.com" style={inp} /></div>
            <div><div style={SH}>Phone</div><input {...field("phone")} placeholder="+44 20 0000 0000" style={inp} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div>
              <div style={SH}>Date Contacted</div>
              <input type="date" {...field("date_contacted")} style={{ ...inp, colorScheme: "dark" }} />
            </div>
            <div><div style={SH}>Project Name</div><input {...field("project_name")} placeholder="e.g. Project Orion" style={inp} /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={SH}>Notes</div>
            <textarea {...field("notes")} placeholder="Context, next steps, key info…" rows={4} style={{ ...inp, resize: "vertical", lineHeight: 1.55 }} />
          </div>

          {/* Add mode: initial stage + submit */}
          {isAdding && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={SH}>Initial Stage</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {STAGES.filter(s => s.value !== "dead").map(s => (
                    <button key={s.value} onClick={() => setForm(f => ({ ...f, stage: s.value }))} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 4, cursor: "pointer", background: form.stage === s.value ? s.color + "22" : "transparent", border: `1px solid ${form.stage === s.value ? s.color : theme.border}`, color: form.stage === s.value ? s.color : theme.textTertiary, fontWeight: form.stage === s.value ? 700 : 400, fontFamily: "'Inter', system-ui, sans-serif" }}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleAdd} disabled={!form.developer.trim() || saving} style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 8, background: form.developer.trim() ? theme.accent : theme.border, color: "#fff", border: "none", cursor: form.developer.trim() ? "pointer" : "default", fontFamily: "'Inter', system-ui, sans-serif", opacity: saving ? 0.7 : 1 }}>{saving ? "Adding…" : "Add Lead"}</button>
                <button onClick={() => { setIsAdding(false); setForm(EMPTY_FORM); }} style={{ padding: "9px 14px", fontSize: 12, borderRadius: 8, cursor: "pointer", background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`, fontFamily: "'Inter', system-ui, sans-serif" }}>Cancel</button>
              </div>
            </>
          )}

          {/* Edit mode: save + delete */}
          {!isAdding && selected && (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={handleSave} disabled={!dirty || saving} style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 8, background: dirty ? theme.accent : theme.border, color: dirty ? "#fff" : theme.textTertiary, border: "none", cursor: dirty ? "pointer" : "default", fontFamily: "'Inter', system-ui, sans-serif", opacity: saving ? 0.7 : 1, transition: "background 0.15s, color 0.15s" }}>{saving ? "Saving…" : "Save Changes"}</button>
              <button onClick={handleDelete} style={{ padding: "9px 12px", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer", background: "transparent", color: "#ef4444", border: "1px solid #ef444433", fontFamily: "'Inter', system-ui, sans-serif" }}>Delete</button>
            </div>
          )}

          {/* Activity log — only shown in edit mode */}
          {!isAdding && selected && (
            <>
              {/* Section header */}
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 20, marginBottom: 8, paddingTop: 16, borderTop: `1px solid ${theme.border}` }}>Log Activity</div>

              {/* Channel pills */}
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                {CHANNELS.map(ch => (
                  <div key={ch} onClick={() => setNewActivity(p => ({ ...p, channel: ch }))}
                    style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: newActivity.channel === ch ? theme.accent : theme.pillBg,
                      color: newActivity.channel === ch ? "#fff" : theme.textTertiary,
                      border: `1px solid ${newActivity.channel === ch ? theme.accent : theme.border}`,
                      transition: "all 0.15s" }}>{ch}</div>
                ))}
              </div>

              {/* Direction toggle */}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {["Outbound", "Inbound"].map(d => (
                  <div key={d} onClick={() => setNewActivity(p => ({ ...p, direction: d }))}
                    style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: newActivity.direction === d ? (d === "Outbound" ? "#3b82f6" : "#22c55e") + "22" : theme.pillBg,
                      color: newActivity.direction === d ? (d === "Outbound" ? "#3b82f6" : "#22c55e") : theme.textTertiary,
                      border: `1px solid ${newActivity.direction === d ? (d === "Outbound" ? "#3b82f6" : "#22c55e") : theme.border}` }}>
                    {d === "Outbound" ? "↗ Outbound" : "↙ Inbound"}
                  </div>
                ))}
              </div>

              {/* Notes textarea */}
              <textarea value={newActivity.notes} onChange={e => setNewActivity(p => ({ ...p, notes: e.target.value }))}
                placeholder="Quick note on the interaction..."
                style={{ width: "100%", minHeight: 50, background: theme.surfaceBg, border: `1px solid ${theme.border}`,
                  borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none",
                  fontFamily: "'Inter', system-ui, sans-serif", resize: "vertical", boxSizing: "border-box" }} />

              {/* Response checkbox */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
                <div onClick={() => setNewActivity(p => ({ ...p, response: !p.response }))}
                  style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${newActivity.response ? "#22c55e" : theme.border}`,
                    background: newActivity.response ? "#22c55e" : "transparent", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>
                  {newActivity.response ? "✓" : ""}
                </div>
                <span style={{ fontSize: 11, color: theme.textTertiary }}>Response received</span>
              </div>

              {/* Submit button */}
              <button onClick={handleLogActivity}
                style={{ width: "100%", padding: "9px 16px",
                  background: newActivity.notes.trim() ? theme.accent : theme.border,
                  color: newActivity.notes.trim() ? "#fff" : theme.textTertiary,
                  border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: newActivity.notes.trim() ? "pointer" : "default",
                  opacity: newActivity.notes.trim() ? 1 : 0.5,
                  fontFamily: "'Inter', system-ui, sans-serif" }}>
                Log Activity
              </button>

              {/* Activity timeline */}
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 16, marginBottom: 8 }}>Recent Activity</div>
              {(selected.activityLog || []).length === 0 ? (
                <div style={{ fontSize: 11, color: theme.textTertiary, padding: "8px 0", fontStyle: "italic" }}>No activity logged yet</div>
              ) : (
                <div>
                  {(selected.activityLog || []).map((a, i) => {
                    const icon = a.channel === "Email" ? "✉️" : a.channel === "LinkedIn" ? "💼" : a.channel === "Call" ? "📞" : a.channel === "Meeting" ? "🤝" : "💬";
                    const dateStr = new Date(a.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0",
                        borderBottom: i < (selected.activityLog.length - 1) ? `1px solid ${theme.border}` : "none" }}>
                        <div style={{ fontSize: 16, marginTop: 2 }}>{icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: theme.textPrimary }}>{a.notes}</div>
                          <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2, display: "flex", gap: 8 }}>
                            <span>{dateStr}</span>
                            <span>{a.direction === "Outbound" ? "↗" : "↙"} {a.direction}</span>
                            {a.response && <span style={{ color: "#22c55e" }}>✓ Response</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><EnergyLoader /></div>
        ) : (
          <>
            {/* Header bar — leads-only (no title, no view toggle; embedded under Acquisitions tab) */}
            <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: theme.textTertiary, background: theme.pillBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{filtered.length}{filtered.length !== leads.length ? ` of ${leads.length}` : ""}</span>
                {activeFilterCount > 0 && <button onClick={() => { setFilterStage("All"); setFilterOwner("All"); }} style={{ fontSize: 10, color: theme.accent, background: theme.accent + "15", border: `1px solid ${theme.accent}33`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>Clear filters ✕</button>}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ ...inp, width: 160, padding: "5px 10px", fontSize: 11 }} />
                <button onClick={() => { setIsAdding(true); setSelectedId(null); setForm({ ...EMPTY_FORM, category }); }} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#fff", background: theme.accent, border: "none", fontFamily: "'Inter', system-ui, sans-serif" }}>+ Add Lead</button>
              </div>
            </div>

            {/* Leads view */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ padding: 20 }}>
                {/* KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
                  {stageCounts.map(s => (
                    <div key={s.value} onClick={() => setFilterStage(filterStage === s.value ? "All" : s.value)}
                      style={{ background: theme.cardBg, border: `1px solid ${filterStage === s.value ? s.color : (theme.cardBorder || theme.border)}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", transition: "border-color 0.15s", opacity: filterStage !== "All" && filterStage !== s.value ? 0.5 : 1 }}>
                      <div style={{ fontSize: 9, color: s.color, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.count > 0 ? s.color : theme.textTertiary, letterSpacing: "-0.03em" }}>{s.count}</div>
                    </div>
                  ))}
                </div>

                {/* Table */}
                {leads.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 0", color: theme.textTertiary }}>
                    <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>🏢</div>
                    <div style={{ fontSize: 13 }}>No leads yet — click <strong style={{ color: theme.textSecondary }}>+ Add Lead</strong></div>
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: theme.textTertiary, fontSize: 12 }}>No leads match the current filters.</div>
                ) : (
                  <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Developer</th>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Contact</th>
                          <ColumnFilter label="Stage" filterKey="stage" value={filterStage}
                            options={allStageVals.map(v => STAGE_MAP[v]?.label || v)}
                            onChange={v => setFilterStage(v === "All" ? "All" : (STAGES.find(s => s.label === v)?.value || v))}
                            isOpen={openFilter === "stage"} onToggle={setOpenFilter} theme={theme} />
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg, whiteSpace: "nowrap" }}>Date Contacted</th>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Project</th>
                          <ColumnFilter label="Owner" filterKey="owner" value={filterOwner}
                            options={allOwners}
                            onChange={v => setFilterOwner(v)}
                            isOpen={openFilter === "owner"} onToggle={setOpenFilter} theme={theme} />
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(lead => (
                          <tr key={lead.id} onClick={() => { setSelectedId(lead.id); setIsAdding(false); }}
                            style={{ borderBottom: `1px solid ${theme.borderSubtle || theme.border}`, cursor: "pointer", background: lead.id === selectedId ? (theme.accent + "10") : "transparent", transition: "background 0.1s" }}>
                            <td style={{ padding: "10px 14px" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{lead.developer}</div>
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              {lead.contact_name && <div style={{ fontSize: 11, color: theme.textSecondary }}>{lead.contact_name}</div>}
                              {lead.email && <div style={{ fontSize: 10, color: theme.textTertiary }}>{lead.email}</div>}
                              {!lead.contact_name && !lead.email && <span style={{ color: theme.textTertiary, fontSize: 11 }}>—</span>}
                            </td>
                            <td style={{ padding: "10px 14px" }}><StageBadge stage={lead.stage} /></td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>
                              {lead.date_contacted ? new Date(lead.date_contacted).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: lead.project_name ? theme.textSecondary : theme.textTertiary }}>
                              {lead.project_name || "—"}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textTertiary }}>
                              {lead.owner || "—"}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textTertiary, maxWidth: 200 }}>
                              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lead.notes || "—"}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
