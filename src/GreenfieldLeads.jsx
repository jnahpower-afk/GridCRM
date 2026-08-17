import { useState, useEffect, useCallback } from "react";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = [
  { value: "new",         label: "New Target",  color: "#6366f1" },
  { value: "contacted",   label: "Contacted",   color: "#3b82f6" },
  { value: "interested",  label: "Interested",  color: "#06b6d4" },
  { value: "negotiating", label: "Negotiating", color: "#f59e0b" },
  { value: "agreed",      label: "Agreed",      color: "#10b981" },
  { value: "dead",        label: "Dead",        color: "#94a3b8" },
];

const STATUS_ORDER = { agreed: 0, negotiating: 1, interested: 2, contacted: 3, new: 4, dead: 5 };
const STATUS_MAP   = Object.fromEntries(STATUSES.map(s => [s.value, s]));
const EMPTY_FORM   = { name: "", company: "", phone: "", email: "", address: "", notes: "", status: "new", pin_id: "" };

// ─── Activity log constants ───────────────────────────────────────────────────
// Channels stored lowercase in leads_activity_log (matches Monday-migrated rows
// which use 'note'). Display labels are Title Case.
const CHANNELS = ["Email", "LinkedIn", "Call", "WhatsApp", "Meeting", "Note"];
const CHANNEL_COLORS = {
  Email: "#3b82f6", LinkedIn: "#0077b5", Call: "#22c55e",
  WhatsApp: "#25d366", Meeting: "#f59e0b", Note: "#94a3b8",
};
const CHANNEL_ICONS = {
  email: "✉️", linkedin: "💼", call: "📞",
  whatsapp: "💬", meeting: "🤝", note: "📝",
};
const channelLabel = (ch) => ch ? ch[0].toUpperCase() + ch.slice(1) : "Note";
const EMPTY_ACTIVITY_FORM = { channel: "Email", direction: "Outbound", notes: "", response: false };

// ─── Small helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.new;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 10, fontWeight: 700, color: s.color,
      background: s.color + "18", border: `1px solid ${s.color}33`,
      padding: "2px 7px", borderRadius: 4,
      fontFamily: "'Inter', system-ui, sans-serif", whiteSpace: "nowrap",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
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

function FieldLabel({ children, theme }) {
  return <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{children}</div>;
}

function ColumnFilterHeader({ label, filterKey, value, options, onChange, isOpen, onToggle, theme }) {
  const isFiltered = value !== "All";
  return (
    <th onClick={e => { e.stopPropagation(); onToggle(isOpen ? null : filterKey); }}
      style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: isFiltered ? theme.accent : theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg, cursor: "pointer", userSelect: "none", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ fontSize: 8, transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
        {isFiltered && <span style={{ width: 6, height: 6, borderRadius: "50%", background: theme.accent, flexShrink: 0 }} />}
      </div>
      {isOpen && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, minWidth: 180, maxHeight: 260, overflowY: "auto",
            background: theme.elevatedBg || theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)", marginTop: 2 }}>
          {["All", ...options].map(opt => (
            <div key={opt} onClick={() => { onChange(opt); onToggle(null); }}
              style={{ padding: "7px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: value === opt ? (theme.accent + "18") : "transparent",
                color: value === opt ? theme.accent : theme.textPrimary, fontWeight: value === opt ? 700 : 400 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${value === opt ? theme.accent : theme.border}`,
                background: value === opt ? theme.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", flexShrink: 0 }}>
                {value === opt ? "✓" : ""}
              </span>
              {opt}
            </div>
          ))}
        </div>
      )}
    </th>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function GreenfieldLeads({ initiative, session }) {
  const { theme } = useTheme();

  const [leads, setLeads]           = useState([]);
  const [pins, setPins]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [isAdding, setIsAdding]     = useState(false);
  const [filterStatus, setFilterStatus] = useState("All");
  const [openFilter, setOpenFilter] = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);

  // Activity timeline state
  const [activity, setActivity]                 = useState([]);
  const [loadingActivity, setLoadingActivity]   = useState(false);
  const [newActivity, setNewActivity]           = useState(EMPTY_ACTIVITY_FORM);
  const [savingActivity, setSavingActivity]     = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [leadsRes, pinsRes] = await Promise.all([
      supabase.from("leads").select("*").eq("initiative_id", initiative.id).order("created_at", { ascending: false }),
      supabase.from("map_pins").select("id,name,type,lat,lng").eq("initiative_id", initiative.id),
    ]);
    if (leadsRes.data) setLeads(leadsRes.data);
    if (pinsRes.data)  setPins(pinsRes.data);
    setLoading(false);
  }, [initiative.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selected = leads.find(l => l.id === selectedId);

  useEffect(() => {
    if (selected) {
      setForm({ name: selected.name || "", company: selected.company || "", phone: selected.phone || "", email: selected.email || "", address: selected.address || "", notes: selected.notes || "", status: selected.status || "new", pin_id: selected.pin_id || "" });
      setDirty(false);
    }
  }, [selectedId]);

  // Load activity log for the selected lead (also resets the compose form)
  useEffect(() => {
    setNewActivity(EMPTY_ACTIVITY_FORM);
    if (!selectedId) { setActivity([]); return; }
    let cancelled = false;
    setLoadingActivity(true);
    supabase
      .from("leads_activity_log")
      .select("*")
      .eq("lead_id", selectedId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Failed to load activity:", error);
        setActivity(data || []);
        setLoadingActivity(false);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const statusValues = STATUSES.map(s => s.value);
  const filtered = leads
    .filter(l => filterStatus === "All" || l.status === filterStatus)
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));

  const totalLeads = leads.length;
  const active     = leads.filter(l => !["agreed", "dead"].includes(l.status)).length;
  const agreed     = leads.filter(l => l.status === "agreed").length;
  const inTalks    = leads.filter(l => ["negotiating", "interested"].includes(l.status)).length;
  const statusCounts = STATUSES.map(s => ({ ...s, count: leads.filter(l => l.status === s.value).length }));
  const activeStatusValues = [...new Set(leads.map(l => l.status))];

  // ── Mutations ────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const { data } = await supabase.from("leads")
      .insert({ ...form, pin_id: form.pin_id || null, initiative_id: initiative.id, created_by: session.user.id })
      .select().single();
    if (data) { setLeads(p => [data, ...p]); setSelectedId(data.id); setIsAdding(false); }
    setSaving(false);
  };

  const handleSave = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    await supabase.from("leads").update({ ...form, pin_id: form.pin_id || null }).eq("id", selected.id);
    setLeads(p => p.map(l => l.id === selected.id ? { ...l, ...form } : l));
    setDirty(false);
    setSaving(false);
  };

  const handleStatusChange = async (newStatus) => {
    if (!selected) return;
    await supabase.from("leads").update({ status: newStatus }).eq("id", selected.id);
    setLeads(p => p.map(l => l.id === selected.id ? { ...l, status: newStatus } : l));
    setForm(f => ({ ...f, status: newStatus }));
  };

  const handleDelete = async () => {
    if (!selected || !confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    await supabase.from("leads").delete().eq("id", selected.id);
    setLeads(p => p.filter(l => l.id !== selected.id));
    setSelectedId(null);
  };

  const handleLogActivity = async () => {
    if (!newActivity.notes.trim() || !selected) return;
    setSavingActivity(true);
    const today = new Date().toISOString().slice(0, 10);
    const isNote = newActivity.channel === "Note";
    const payload = {
      lead_id: selected.id,
      date: today,
      channel: newActivity.channel.toLowerCase(),
      direction: isNote ? null : newActivity.direction,
      notes: newActivity.notes.trim(),
      response: isNote ? false : newActivity.response,
      created_by: session?.user?.id || null,
    };
    const { data, error } = await supabase
      .from("leads_activity_log")
      .insert(payload)
      .select()
      .single();
    if (error) {
      console.error("Failed to log activity:", error);
    } else if (data) {
      setActivity(prev => [data, ...prev]);
      setNewActivity(EMPTY_ACTIVITY_FORM);
    }
    setSavingActivity(false);
  };

  const handleDeleteActivity = async (id) => {
    if (!confirm("Delete this activity entry?")) return;
    const { error } = await supabase.from("leads_activity_log").delete().eq("id", id);
    if (error) { console.error("Failed to delete activity:", error); return; }
    setActivity(prev => prev.filter(a => a.id !== id));
  };

  function field(key) {
    return { value: form[key], onChange: e => { setForm(f => ({ ...f, [key]: e.target.value })); setDirty(true); } };
  }

  const inp = {
    width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12,
    outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif",
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div onClick={() => openFilter && setOpenFilter(null)}
      style={{ display: "flex", height: "100%", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary, overflow: "hidden" }}>

      {/* ── Left detail panel ─────────────────────────────────────────────────── */}
      {(selected || isAdding) && (
        <div style={{ width: 380, flexShrink: 0, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", padding: "14px 14px" }}>

          {/* Panel header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, paddingLeft: 2 }}>
              {isAdding ? "New Lead" : (selected?.name || "Lead")}
            </div>
            <div onClick={() => { setSelectedId(null); setIsAdding(false); }}
              style={{ cursor: "pointer", fontSize: 14, color: theme.textTertiary, padding: "2px 6px" }}>✕</div>
          </div>

          {/* Status pipeline — edit mode only */}
          {!isAdding && selected && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 8 }}>Pipeline Stage</div>
              <div style={{ display: "flex", gap: 3 }}>
                {STATUSES.map((s) => {
                  const isCurrent = (selected.status || "new") === s.value;
                  const idx = statusValues.indexOf(selected.status);
                  const thisIdx = statusValues.indexOf(s.value);
                  const isPast = thisIdx < idx && selected.status !== "dead";
                  const sc = STATUS_MAP[selected.status]?.color || s.color;
                  return (
                    <div key={s.value} onClick={() => handleStatusChange(s.value)}
                      style={{ flex: 1, cursor: "pointer", textAlign: "center", padding: "5px 1px", borderRadius: 6,
                        background: isCurrent ? s.color + "20" : "transparent", transition: "all 0.15s" }}>
                      <div style={{ height: 16, borderRadius: 3,
                        background: isCurrent ? sc : isPast ? sc : theme.pillBg || theme.border,
                        opacity: isCurrent ? 1 : isPast ? 0.4 : 0.25, transition: "all 0.2s" }} />
                      <div style={{ fontSize: 7.5, color: isCurrent ? s.color : theme.textTertiary, marginTop: 3, fontWeight: isCurrent ? 700 : 400, lineHeight: 1.1 }}>{s.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contact details */}
          <SectionHeader theme={theme}>Contact Details</SectionHeader>
          <div style={{ marginBottom: 10 }}>
            <FieldLabel theme={theme}>Landowner / Organisation *</FieldLabel>
            <input {...field("name")} placeholder="e.g. Davies Farms Ltd" style={inp} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <FieldLabel theme={theme}>Company</FieldLabel>
            <input {...field("company")} placeholder="e.g. Davies Agricultural Holdings" style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div>
              <FieldLabel theme={theme}>Phone</FieldLabel>
              <input {...field("phone")} placeholder="+44 7700 900000" style={inp} />
            </div>
            <div>
              <FieldLabel theme={theme}>Email</FieldLabel>
              <input {...field("email")} placeholder="name@example.com" style={inp} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <FieldLabel theme={theme}>Address / Location</FieldLabel>
            <input {...field("address")} placeholder="e.g. Bryncoch Farm, Neath SA10 7NP" style={inp} />
          </div>

          {/* Linked parcel */}
          <SectionHeader theme={theme}>Linked Map Parcel</SectionHeader>
          <div style={{ marginBottom: 10 }}>
            <FieldLabel theme={theme}>Parcel from map</FieldLabel>
            <select value={form.pin_id} onChange={e => { setForm(f => ({ ...f, pin_id: e.target.value })); setDirty(true); }}
              style={{ ...inp, appearance: "none", cursor: "pointer" }}>
              <option value="">— Not linked —</option>
              {pins.map(p => <option key={p.id} value={p.id}>{p.name || "(unnamed)"} — {p.type?.replace(/_/g, " ")}</option>)}
            </select>
            {form.pin_id && (() => {
              const lp = pins.find(p => p.id === form.pin_id);
              return lp ? (
                <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#22c55e" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                  Linked to <strong>{lp.name}</strong>
                </div>
              ) : null;
            })()}
          </div>

          {/* Notes */}
          <SectionHeader theme={theme}>Notes</SectionHeader>
          <textarea {...field("notes")} placeholder="Conversation history, key details, next steps…" rows={4}
            style={{ ...inp, resize: "vertical", lineHeight: 1.55, marginBottom: 10 }} />

          {/* Add mode: status selector + submit */}
          {isAdding && (
            <>
              <SectionHeader theme={theme}>Initial Status</SectionHeader>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
                {STATUSES.filter(s => s.value !== "dead").map(s => (
                  <button key={s.value} onClick={() => setForm(f => ({ ...f, status: s.value }))} style={{
                    fontSize: 10, padding: "3px 9px", borderRadius: 4, cursor: "pointer",
                    background: form.status === s.value ? s.color + "22" : "transparent",
                    border: `1px solid ${form.status === s.value ? s.color : theme.border}`,
                    color: form.status === s.value ? s.color : theme.textTertiary,
                    fontWeight: form.status === s.value ? 700 : 400,
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}>{s.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleAdd} disabled={!form.name.trim() || saving} style={{
                  flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 8,
                  background: form.name.trim() ? initiative.color : theme.border,
                  color: "#fff", border: "none", cursor: form.name.trim() ? "pointer" : "default",
                  fontFamily: "'Inter', system-ui, sans-serif", opacity: saving ? 0.7 : 1,
                }}>{saving ? "Adding…" : "Add Lead"}</button>
                <button onClick={() => { setIsAdding(false); setForm(EMPTY_FORM); }} style={{
                  padding: "9px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer",
                  background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`,
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}>Cancel</button>
              </div>
            </>
          )}

          {/* Edit mode: save + delete */}
          {!isAdding && selected && (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {dirty && (
                <button onClick={handleSave} disabled={saving} style={{
                  flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 8,
                  background: initiative.color, color: "#fff", border: "none", cursor: "pointer",
                  fontFamily: "'Inter', system-ui, sans-serif", opacity: saving ? 0.7 : 1,
                }}>{saving ? "Saving…" : "Save Changes"}</button>
              )}
              <button onClick={handleDelete} style={{
                padding: "9px 12px", fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: "pointer",
                background: "transparent", color: "#ef4444", border: "1px solid #ef444433",
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>Delete</button>
            </div>
          )}

          {/* ── Activity log — only in edit mode ───────────────────────────── */}
          {!isAdding && selected && (
            <>
              {/* Log Activity form */}
              <SectionHeader theme={theme}>Log Activity</SectionHeader>

              {/* Channel pills */}
              <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
                {CHANNELS.map(ch => (
                  <div key={ch} onClick={() => setNewActivity(p => ({ ...p, channel: ch }))}
                    style={{
                      padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: newActivity.channel === ch ? CHANNEL_COLORS[ch] : theme.pillBg,
                      color: newActivity.channel === ch ? "#fff" : theme.textTertiary,
                      border: `1px solid ${newActivity.channel === ch ? CHANNEL_COLORS[ch] : theme.border}`,
                      transition: "all 0.15s",
                    }}>
                    {ch}
                  </div>
                ))}
              </div>

              {/* Direction toggle (hidden for Note since notes are internal) */}
              {newActivity.channel !== "Note" && (
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {["Outbound", "Inbound"].map(d => (
                    <div key={d} onClick={() => setNewActivity(p => ({ ...p, direction: d }))}
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                        background: newActivity.direction === d ? (d === "Outbound" ? "#3b82f6" : "#22c55e") + "22" : theme.pillBg,
                        color: newActivity.direction === d ? (d === "Outbound" ? "#3b82f6" : "#22c55e") : theme.textTertiary,
                        border: `1px solid ${newActivity.direction === d ? (d === "Outbound" ? "#3b82f6" : "#22c55e") : theme.border}`,
                      }}>
                      {d === "Outbound" ? "↗ Outbound" : "↙ Inbound"}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes textarea */}
              <textarea
                value={newActivity.notes}
                onChange={e => setNewActivity(p => ({ ...p, notes: e.target.value }))}
                placeholder={newActivity.channel === "Note" ? "Internal note…" : "Quick note on the interaction…"}
                style={{ ...inp, minHeight: 50, resize: "vertical", lineHeight: 1.5 }}
              />

              {/* Response checkbox (hidden for Note) */}
              {newActivity.channel !== "Note" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
                  <div onClick={() => setNewActivity(p => ({ ...p, response: !p.response }))}
                    style={{
                      width: 16, height: 16, borderRadius: 4,
                      border: `2px solid ${newActivity.response ? "#22c55e" : theme.border}`,
                      background: newActivity.response ? "#22c55e" : "transparent",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: "#fff",
                    }}>{newActivity.response ? "✓" : ""}</div>
                  <span style={{ fontSize: 11, color: theme.textTertiary }}>Response received</span>
                </div>
              )}

              <button
                onClick={handleLogActivity}
                disabled={!newActivity.notes.trim() || savingActivity}
                style={{
                  width: "100%", marginTop: newActivity.channel === "Note" ? 8 : 0,
                  padding: "9px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: newActivity.notes.trim() ? initiative.color : theme.border,
                  color: newActivity.notes.trim() ? "#fff" : theme.textTertiary,
                  border: "none", cursor: newActivity.notes.trim() ? "pointer" : "default",
                  opacity: savingActivity ? 0.7 : 1,
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}>
                {savingActivity ? "Logging…" : "Log Activity"}
              </button>

              {/* Activity timeline */}
              <SectionHeader theme={theme}>Activity Timeline</SectionHeader>
              {loadingActivity ? (
                <div style={{ fontSize: 11, color: theme.textTertiary, padding: "8px 0" }}>Loading…</div>
              ) : activity.length === 0 ? (
                <div style={{ fontSize: 11, color: theme.textTertiary, padding: "8px 0", fontStyle: "italic" }}>
                  No activity logged yet
                </div>
              ) : (
                <div>
                  {activity.map((a, i) => {
                    const icon = CHANNEL_ICONS[a.channel] || "💬";
                    const dateStr = a.date
                      ? new Date(a.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "—";
                    const isMigrated = a.source && a.source.startsWith("monday_migration_");
                    return (
                      <div key={a.id} style={{
                        display: "flex", gap: 10, padding: "8px 0",
                        borderBottom: i < activity.length - 1 ? `1px solid ${theme.border}` : "none",
                      }}>
                        <div style={{ fontSize: 16, marginTop: 2 }}>{icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: theme.textPrimary, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {a.notes}
                          </div>
                          <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span>{dateStr}</span>
                            <span style={{ color: theme.textTertiary }}>· {channelLabel(a.channel)}</span>
                            {a.direction && <span>{a.direction === "Outbound" ? "↗" : "↙"} {a.direction}</span>}
                            {a.response && <span style={{ color: "#22c55e" }}>✓ Response</span>}
                            {isMigrated && (
                              <span style={{
                                fontSize: 9, color: theme.textTertiary,
                                background: theme.pillBg, border: `1px solid ${theme.border}`,
                                borderRadius: 4, padding: "1px 5px",
                              }}>migrated</span>
                            )}
                          </div>
                        </div>
                        <div
                          onClick={() => handleDeleteActivity(a.id)}
                          title="Delete entry"
                          style={{
                            fontSize: 12, color: theme.textTertiary, cursor: "pointer",
                            padding: "2px 5px", borderRadius: 4, alignSelf: "flex-start",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = theme.textTertiary; }}
                        >×</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Main content: header + KPIs + table ──────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><EnergyLoader /></div>
        ) : (
          <>
            {/* Header bar */}
            <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary }}>Leads</span>
                <span style={{ fontSize: 11, color: theme.textTertiary, background: theme.pillBg || theme.surfaceBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                  {filtered.length}{filtered.length !== leads.length ? ` of ${leads.length}` : ""}
                </span>
                {filterStatus !== "All" && (
                  <button onClick={() => setFilterStatus("All")} style={{ fontSize: 10, color: theme.accent, background: theme.accent + "15", border: `1px solid ${theme.accent}33`, borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                    Clear filter ✕
                  </button>
                )}
              </div>
              <button onClick={() => { setIsAdding(true); setSelectedId(null); setForm(EMPTY_FORM); }} style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                color: "#fff", background: initiative.color, border: "none",
                fontFamily: "'Inter', system-ui, sans-serif",
              }}>+ Add Lead</button>
            </div>

            <div style={{ padding: 20, flex: 1 }}>
              {/* KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <KPI label="Total Leads" value={totalLeads} sub={`${active} active`} theme={theme} />
                <KPI label="Agreed" value={agreed} sub="Contracted / agreed" color="#10b981" theme={theme} />
                <KPI label="In Talks" value={inTalks} sub="Negotiating or interested" color="#f59e0b" theme={theme} />
                <KPI label="New Targets" value={leads.filter(l => l.status === "new").length} sub="Not yet contacted" color="#6366f1" theme={theme} />
              </div>

              {/* Pipeline funnel bar */}
              <div style={{ display: "flex", gap: 2, marginBottom: 20, padding: "12px 16px", background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 10, alignItems: "flex-start" }}>
                {statusCounts.filter(s => s.value !== "dead").map(s => (
                  <div key={s.value} onClick={() => setFilterStatus(filterStatus === s.value ? "All" : s.value)}
                    style={{ flex: 1, textAlign: "center", cursor: "pointer", opacity: filterStatus !== "All" && filterStatus !== s.value ? 0.4 : 1, transition: "opacity 0.15s" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: s.count > 0 ? s.color : theme.textTertiary }}>{s.count}</div>
                    <div style={{ fontSize: 9, color: theme.textTertiary, marginTop: 2 }}>{s.label}</div>
                    <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: s.count > 0 ? s.color : theme.pillBg || theme.border, opacity: 0.6 }} />
                  </div>
                ))}
                {(() => { const dead = statusCounts.find(s => s.value === "dead"); return dead && dead.count > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 6, paddingLeft: 10, borderLeft: `1px solid ${theme.border}` }}>
                    <div onClick={() => setFilterStatus(filterStatus === "dead" ? "All" : "dead")}
                      style={{ textAlign: "center", cursor: "pointer", opacity: filterStatus !== "All" && filterStatus !== "dead" ? 0.4 : 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#94a3b8" }}>{dead.count}</div>
                      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2, opacity: 0.7 }}>Dead</div>
                      <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: "#94a3b8", opacity: 0.4 }} />
                    </div>
                  </div>
                ) : null; })()}
              </div>

              {/* Table */}
              {leads.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: theme.textTertiary, fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>👤</div>
                  No leads yet — click <strong style={{ color: theme.textSecondary }}>+ Add Lead</strong> to get started.
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: theme.textTertiary, fontSize: 12 }}>No leads match this filter.</div>
              ) : (
                <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder || theme.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Landowner</th>
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Company</th>
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Contact</th>
                        <ColumnFilterHeader label="Status" filterKey="status" value={filterStatus} options={activeStatusValues.map(v => STATUS_MAP[v]?.label || v)}
                          onChange={v => setFilterStatus(v === "All" ? "All" : (STATUSES.find(s => s.label === v)?.value || v))}
                          isOpen={openFilter === "status"} onToggle={setOpenFilter} theme={theme} />
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Linked Parcel</th>
                        <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(lead => {
                        const lp = pins.find(p => p.id === lead.pin_id);
                        const isSelected = lead.id === selectedId;
                        return (
                          <tr key={lead.id} onClick={() => { setSelectedId(lead.id); setIsAdding(false); }}
                            style={{ borderBottom: `1px solid ${theme.borderSubtle || theme.border}`, cursor: "pointer",
                              background: isSelected ? (initiative.color + "14") : "transparent", transition: "background 0.1s" }}>
                            <td style={{ padding: "10px 14px" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{lead.name}</div>
                              {lead.address && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 1 }}>{lead.address}</div>}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{lead.company || <span style={{ color: theme.textTertiary }}>—</span>}</td>
                            <td style={{ padding: "10px 14px" }}>
                              {lead.phone && <div style={{ fontSize: 11, color: theme.textSecondary }}>{lead.phone}</div>}
                              {lead.email && <div style={{ fontSize: 10, color: theme.textTertiary }}>{lead.email}</div>}
                              {!lead.phone && !lead.email && <span style={{ fontSize: 11, color: theme.textTertiary }}>—</span>}
                            </td>
                            <td style={{ padding: "10px 14px" }}><StatusBadge status={lead.status} /></td>
                            <td style={{ padding: "10px 14px" }}>
                              {lp ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#22c55e" }}>
                                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                                  {lp.name}
                                </div>
                              ) : <span style={{ fontSize: 11, color: theme.textTertiary }}>—</span>}
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>
                              {lead.created_at ? new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
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
    </div>
  );
}
