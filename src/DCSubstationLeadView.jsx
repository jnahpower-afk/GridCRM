// Full-page view for a lead under a DC substation (mirrors the Greenfield lead
// experience). Edit fields, log activity, and Convert to a DC Project.

import { useState, useEffect, useCallback } from "react";
import { Mail, Phone, MessageCircle, Users } from "lucide-react";
import { supabase } from "./supabase.js";
import { useTheme } from "./ThemeContext.jsx";
import FuseLogo from "./FuseLogo.jsx";

// LinkedIn glyph — matches the Private Wire lead activity logger.
function LinkedinIcon({ size = 15, color, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}
const CHANNELS = ["Email", "LinkedIn", "Call", "WhatsApp", "Meeting"];
const CHANNEL_ICON = { Email: Mail, LinkedIn: LinkedinIcon, Call: Phone, WhatsApp: MessageCircle, Meeting: Users };

const LEAD_STATUSES = ["new", "contacted", "interested", "negotiating", "agreed", "dead", "Converted"];
const STATUS_COLORS = { new: "#6366f1", contacted: "#3b82f6", interested: "#06b6d4", negotiating: "#f59e0b", agreed: "#10b981", dead: "#94a3b8", Converted: "#22c55e" };
const FIELDS = [
  { key: "company", label: "Company" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address" },
];

export default function DCSubstationLeadView({ lead, substation, session, onBack, onChanged }) {
  const { theme } = useTheme();
  const [form, setForm] = useState(lead);
  const [activity, setActivity] = useState([]);
  const [parcels, setParcels] = useState([]);
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState("Email");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  // Resolve the current user so logged activity is attributed to them.
  const [userId, setUserId] = useState(session?.user?.id || null);
  useEffect(() => {
    if (userId) return;
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, [userId]);

  // Show the prop immediately, then refresh from the DB so we never render stale
  // cached values (the parent list may hold an older copy of the lead).
  useEffect(() => {
    setForm(lead);
    let cancelled = false;
    supabase.from("dc_substation_leads").select("*").eq("id", lead.id).single()
      .then(({ data }) => { if (!cancelled && data) setForm(data); });
    return () => { cancelled = true; };
  }, [lead?.id]);

  // Land parcels belonging to this substation, to link the lead to one.
  useEffect(() => {
    if (!substation?.id) { setParcels([]); return; }
    let cancelled = false;
    supabase.from("dc_network_features").select("id, name, type").eq("substation_id", substation.id)
      .then(({ data }) => { if (!cancelled) setParcels(data || []); });
    return () => { cancelled = true; };
  }, [substation?.id]);

  const loadActivity = useCallback(async () => {
    const { data } = await supabase.from("dc_substation_lead_activity").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false });
    setActivity(data || []);
  }, [lead.id]);
  useEffect(() => { loadActivity(); }, [loadActivity]);

  const patch = useCallback(async (fields) => {
    setForm(prev => ({ ...prev, ...fields }));
    const { error } = await supabase.from("dc_substation_leads").update(fields).eq("id", lead.id);
    if (error) console.error("Failed to update lead:", error);
    else onChanged?.();
  }, [lead.id, onChanged]);

  const saveFields = useCallback(async () => {
    setSaving(true);
    await patch({ name: form.name, company: form.company || null, phone: form.phone || null, email: form.email || null, address: form.address || null, notes: form.notes || null });
    setSaving(false);
  }, [form, patch]);

  const logActivity = useCallback(async () => {
    const body = note.trim();
    if (!body) return;
    await supabase.from("dc_substation_lead_activity").insert({ lead_id: lead.id, channel, notes: body, source: "manual", created_by: userId, date: new Date().toISOString().slice(0, 10) });
    setNote("");
    loadActivity();
  }, [note, channel, lead.id, userId, loadActivity]);

  const convertToProject = useCallback(async () => {
    if (converting || form.status === "Converted") return;
    if (!window.confirm(`Convert "${form.name}" to a DC Project?`)) return;
    setConverting(true);
    const { data, error } = await supabase.from("dc_projects").insert({
      name: form.name,
      status: "Engaged Landowner",
      dno: substation?.dno || null,
      main_contact: form.name,
      email: form.email || null,
      owner: form.company || null,
      last_updated: new Date().toISOString(),
      originating_substation_id: substation?.id || null,
      originating_lead_id: lead.id,
    }).select("id").single();
    if (error) { console.error("Convert failed:", error); setConverting(false); return; }
    await patch({ status: "Converted", converted_project_id: data.id });
    setConverting(false);
    alert("Converted to a DC Project — find it under Data Centres → Projects.");
  }, [converting, form, substation, lead.id, patch]);

  const inp = { width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: "8px 11px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif" };
  const SH = { fontSize: 10, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 };
  const converted = form.status === "Converted";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: theme.pageBg, display: "flex", flexDirection: "column", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 20px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div onClick={onBack} title="Back" style={{ width: 34, height: 34, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: theme.textTertiary }}>←</div>
        <FuseLogo size={30} />
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>{form.name}</div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: (STATUS_COLORS[form.status] || theme.textMuted) + "22", color: STATUS_COLORS[form.status] || theme.textMuted }}>{form.status || "new"}</span>
        {substation && <span style={{ fontSize: 11, color: theme.textTertiary }}>· {substation.name || "Substation"}</span>}
        <button onClick={convertToProject} disabled={converted || converting}
          style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: converted ? "default" : "pointer", background: converted ? theme.border : theme.accent, color: "#fff", opacity: converting ? 0.7 : 1 }}>
          {converted ? "✓ Converted" : converting ? "Converting…" : "Convert to Project →"}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 40px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Details */}
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 14 }}>Lead details</div>
            <div style={{ marginBottom: 12 }}><div style={SH}>Name</div><input value={form.name || ""} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={inp} /></div>
            {FIELDS.map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}><div style={SH}>{f.label}</div><input value={form[f.key] || ""} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} style={inp} /></div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <div style={SH}>Status</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {LEAD_STATUSES.map(s => (
                  <button key={s} onClick={() => patch({ status: s })}
                    style={{ fontSize: 11, padding: "4px 9px", borderRadius: 6, cursor: "pointer", background: form.status === s ? (STATUS_COLORS[s] + "22") : theme.pillBg, border: `1px solid ${form.status === s ? STATUS_COLORS[s] : theme.border}`, color: form.status === s ? STATUS_COLORS[s] : theme.textSecondary, fontWeight: form.status === s ? 700 : 400, fontFamily: "'Inter', system-ui, sans-serif" }}>{s}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={SH}>Linked Land Parcel</div>
              <select value={form.parcel_id || ""} onChange={e => patch({ parcel_id: e.target.value || null })} style={{ ...inp, cursor: "pointer" }}>
                <option value="">— None —</option>
                {parcels.map(pc => <option key={pc.id} value={pc.id}>{pc.name || pc.type || "Parcel"}</option>)}
              </select>
              {parcels.length === 0 && <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 4 }}>Draw parcels on this substation (Network Map → Parcels) to link them here.</div>}
            </div>
            <div style={{ marginBottom: 12 }}><div style={SH}>Notes</div><textarea value={form.notes || ""} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={4} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} /></div>
            <button onClick={saveFields} disabled={saving} style={{ padding: "9px 18px", fontSize: 12, fontWeight: 700, borderRadius: 8, background: theme.accent, color: "#fff", border: "none", cursor: "pointer", opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : "Save details"}</button>
          </div>

          {/* Activity */}
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 14 }}>Activity</div>
            {/* Channel picker */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {CHANNELS.map(ch => {
                const Icon = CHANNEL_ICON[ch];
                const active = channel === ch;
                return (
                  <div key={ch} onClick={() => setChannel(ch)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: active ? theme.accent : theme.pillBg, color: active ? "#fff" : theme.textTertiary, border: `1px solid ${active ? theme.accent : theme.border}`, transition: "all 0.15s" }}>
                    <Icon size={12} /> {ch}
                  </div>
                );
              })}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={`Log a ${channel.toLowerCase()}…`} rows={3} style={{ ...inp, resize: "vertical", marginBottom: 8 }} />
            <button onClick={logActivity} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, background: theme.accent, color: "#fff", border: "none", cursor: "pointer", marginBottom: 16 }}>Log activity</button>
            {activity.length === 0 && <div style={{ fontSize: 12, color: theme.textMuted }}>No activity yet.</div>}
            {activity.map(a => {
              const Icon = CHANNEL_ICON[a.channel] || null;
              return (
                <div key={a.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${theme.borderSubtle || theme.border}` }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: theme.pillBg, border: `1px solid ${theme.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: theme.textSecondary }}>
                    {Icon ? <Icon size={13} /> : <span style={{ fontSize: 11 }}>📝</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase" }}>{a.channel || "note"}</span>
                      <span style={{ fontSize: 10, color: theme.textMuted, flexShrink: 0 }}>{a.date || (a.created_at ? new Date(a.created_at).toLocaleDateString("en-GB") : "")}</span>
                    </div>
                    <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.notes}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
