import { useState, useEffect, useCallback, useRef } from "react";
import { Star } from "lucide-react";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";
import { PW_STAGES, countAllTasks } from "./PrivateWireProcess.jsx";
import SiteMap from "./SiteMap.jsx";

// ─── COLLAPSIBLE SECTION ─────────────────────────────────────────────────────

function Section({ title, defaultOpen = true, children }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          fontSize: 18, fontWeight: 700, color: theme.textPrimary,
          padding: "8px 0", userSelect: "none",
        }}
      >
        <span style={{
          display: "inline-block", transition: "transform 0.2s",
          transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          fontSize: 12, color: theme.textTertiary,
        }}>▼</span>
        {title}
      </div>
      {open && <div style={{ paddingLeft: 4 }}>{children}</div>}
    </div>
  );
}

// ─── FREE TEXT AREA ──────────────────────────────────────────────────────────

function FreeText({ value, onChange, placeholder }) {
  const { theme } = useTheme();
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || "Add notes here..."}
      rows={4}
      style={{
        width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.borderSubtle}`,
        borderRadius: 8, padding: "10px 12px", fontSize: 13, color: theme.textPrimary,
        fontFamily: "'Inter', system-ui, sans-serif", resize: "none",
        outline: "none", lineHeight: 1.6, overflow: "hidden", boxSizing: "border-box",
      }}
      onFocus={e => e.target.style.borderColor = theme.accent}
      onBlur={e => e.target.style.borderColor = theme.borderSubtle}
    />
  );
}

// ─── SIMPLE TABLE (label / value rows) ───────────────────────────────────────

function SimpleTable({ fields, data, onChange }) {
  const { theme } = useTheme();
  return (
    <div style={{ border: `1px solid ${theme.textMuted}`, borderRadius: 4, overflow: "hidden" }}>
      {fields.map(({ key, label, unit, type, options }, i) => (
        <div key={key} style={{
          display: "grid", gridTemplateColumns: "200px 1fr",
          borderBottom: i < fields.length - 1 ? `1px solid ${theme.borderSubtle}` : "none",
          minHeight: 42, alignItems: "stretch",
        }}>
          <div style={{
            fontSize: 13, color: theme.textPrimary, padding: "8px 14px", fontWeight: 500,
            background: theme.tableLabelBg, display: "flex", alignItems: "center",
          }}>{label}</div>

          {type === "select" ? (
            <div style={{ borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg, display: "flex", alignItems: "stretch" }}>
              <select
                value={data[key] || ""}
                onChange={e => onChange(key, e.target.value)}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  fontSize: 13, color: theme.textPrimary, padding: "8px 14px",
                  fontFamily: "'Inter', system-ui, sans-serif", cursor: "pointer",
                }}
              >
                <option value="">—</option>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ) : (
            <div style={{
              display: "flex", alignItems: "stretch",
              borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.elevatedBg,
            }}>
              <input
                type="text"
                value={data[key] || ""}
                onChange={e => onChange(key, e.target.value)}
                placeholder="—"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  fontSize: 13, color: theme.textPrimary, padding: "8px 14px",
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
                onFocus={e => e.target.style.background = theme.accentBg}
                onBlur={e => e.target.style.background = "transparent"}
              />
              {unit && (
                <span style={{
                  display: "flex", alignItems: "center",
                  padding: "0 10px", background: theme.hoverBg,
                  fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap",
                  borderLeft: `1px solid ${theme.border}`,
                }}>{unit}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── FIELD DEFINITIONS (scaffold — user will specify the actual fields) ───────
// These will be replaced with the real fields once confirmed by the user.

const PROJECT_SUMMARY_FIELDS = [
  { key: "status", label: "Status", type: "select", options: ["Active", "On Hold", "Won", "Lost"] },
  { key: "recommendation", label: "Recommendation" },
  { key: "est_load_mw", label: "Estimated Load", unit: "MWp" },
  { key: "location", label: "Location" },
  { key: "sector", label: "Sector" },
  { key: "connection_type", label: "Connection Type" },
  { key: "target_tariff", label: "Target Tariff", unit: "£/MWh" },
  { key: "contract_term", label: "Contract Term", unit: "years" },
];

const COMMERCIAL_FIELDS = [
  { key: "counterparty_timeline", label: "Counterparty Timeline" },
  { key: "counterparty_price", label: "Counterparty Price Expectation" },
  { key: "decision_maker", label: "Key Decision Maker" },
  { key: "decision_date", label: "Target Decision Date" },
  { key: "competitors", label: "Known Competitors" },
  { key: "current_energy_cost", label: "Current Energy Cost", unit: "£/MWh" },
];

const TECHNICAL_FIELDS = [
  { key: "site_location", label: "Site Location" },
  { key: "grid_connection", label: "Grid Connection" },
  { key: "planning", label: "Planning Status" },
  { key: "export_mw", label: "Export", unit: "MW" },
  { key: "import_mw", label: "Import", unit: "MW" },
  { key: "pv_capacity", label: "PV Capacity", unit: "MWp" },
  { key: "battery_capacity", label: "Battery Capacity", unit: "MWh" },
];

// ─── STAGE COLOUR MAP ─────────────────────────────────────────────────────────

const STAGE_COLORS = {
  New: "#6366F1",
  Contacted: "#2563EB",
  "Meeting Booked": "#FFB162",
  Proposal: "#FC6A0A",
  Negotiation: "#15803D",
  Won: "#4ADE80",
  Lost: "#EF4444",
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function PrivateWireProjectOverview({ org, session, onNavigate }) {
  const { theme } = useTheme();
  const [data, setData] = useState({});
  const [processData, setProcessData] = useState({});
  const [saveStatus, setSaveStatus] = useState("saved");
  const [orgLeadIds, setOrgLeadIds] = useState([]);
  const [contacts, setContacts] = useState([]);       // org's contacts (for the dropdown)
  const [champion, setChampion] = useState(null);     // champion contact, or null
  const [recentActivity, setRecentActivity] = useState(null);
  const saveTimer = useRef(null);
  const initialLoad = useRef(false);

  // Most recent activity for the org project page. If a champion is set, show
  // theirs; otherwise the org's latest activity overall. Also loads the contact
  // list so a champion can be nominated from here.
  useEffect(() => {
    if (!org?.name) { setOrgLeadIds([]); setContacts([]); setChampion(null); setRecentActivity(null); return; }
    let cancelled = false;
    (async () => {
      const { data: leadRows } = await supabase.from("private_wire_leads").select("id").eq("name", org.name);
      const leadIds = (leadRows || []).map(l => l.id);
      if (cancelled) return;
      setOrgLeadIds(leadIds);
      if (leadIds.length === 0) { setContacts([]); setChampion(null); setRecentActivity(null); return; }
      const { data: cts } = await supabase.from("private_wire_contacts")
        .select("id, name, role, is_champion").in("lead_id", leadIds).order("created_at");
      const champ = (cts || []).find(c => c.is_champion) || null;
      let actQ = supabase.from("private_wire_activity_log")
        .select("date, channel, direction, notes, created_at, contact_id")
        .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1);
      actQ = champ ? actQ.eq("contact_id", champ.id) : actQ.in("lead_id", leadIds);
      const { data: acts } = await actQ;
      if (cancelled) return;
      setContacts(cts || []);
      setChampion(champ);
      setRecentActivity(acts?.[0] || null);
    })();
    return () => { cancelled = true; };
  }, [org?.name]);

  // Nominate a contact as champion from the overview; reload their latest activity.
  async function selectChampion(contactId) {
    if (!contactId) return;
    const contact = contacts.find(c => c.id === contactId) || null;
    setChampion(contact);
    if (orgLeadIds.length) await supabase.from("private_wire_contacts").update({ is_champion: false }).in("lead_id", orgLeadIds);
    await supabase.from("private_wire_contacts").update({ is_champion: true }).eq("id", contactId);
    const { data: acts } = await supabase.from("private_wire_activity_log")
      .select("date, channel, direction, notes, created_at, contact_id").eq("contact_id", contactId)
      .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(1);
    setRecentActivity(acts?.[0] || null);
  }

  // Load org data
  useEffect(() => {
    if (!org) return;
    initialLoad.current = false;
    const load = async () => {
      const { data: rows } = await supabase
        .from("private_wire_organisations")
        .select("data")
        .eq("name", org.name)
        .limit(1);
      const saved = rows?.[0]?.data || {};
      // Pre-fill overview fields from the lead where the overview doesn't already
      // have a value, so location/sector/load aren't re-typed. Saved values win.
      const blank = v => v == null || v === "";
      const seed = {};
      if (org.sector && blank(saved.sector))           seed.sector = org.sector;
      if (org.location && blank(saved.location))        seed.location = org.location;
      if (org.est_load_mw != null && blank(saved.est_load_mw)) seed.est_load_mw = org.est_load_mw;
      const merged = { ...saved, ...seed };
      // Split out overview fields vs process fields
      setData(merged);
      setProcessData(merged); // process data is in the same row, used for counting
      initialLoad.current = true;
    };
    load();
  }, [org?.name]);

  // Auto-save
  useEffect(() => {
    if (!initialLoad.current || !org) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { data: existing } = await supabase
          .from("private_wire_organisations")
          .select("name")
          .eq("name", org.name)
          .limit(1);

        let error;
        if (existing?.length > 0) {
          ({ error } = await supabase
            .from("private_wire_organisations")
            .update({ data, updated_at: new Date().toISOString() })
            .eq("name", org.name));
        } else {
          ({ error } = await supabase
            .from("private_wire_organisations")
            .insert({ name: org.name, data }));
        }
        setSaveStatus(error ? "error" : "saved");
      } catch {
        setSaveStatus("error");
      }
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [data]);

  const updateField = useCallback((key, value) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  // Process progress metrics
  // Tasks scale linearly from the stage floor to 100%.
  const STAGE_FLOOR = { Proposal: 30, Negotiation: 60, Won: 100 };
  const procFloor = STAGE_FLOOR[org?.stage] || 0;
  const { total: procTotal, done: procDone } = countAllTasks(processData);
  const rawPct = procTotal > 0 ? Math.round((procDone / procTotal) * 100) : 0;
  const procPct = Math.round(procFloor + (rawPct * (100 - procFloor)) / 100);

  const stageColor = STAGE_COLORS[org?.stage] || theme.textMuted;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 48px" }}>

        {/* Save status */}
        <div style={{
          fontSize: 12, marginBottom: 24,
          color: saveStatus === "saved" ? theme.success : saveStatus === "saving" ? theme.warning : theme.error,
          fontWeight: 600,
        }}>
          {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving..." : "Save error"}
        </div>

        {/* Most recent activity — champion's if set, otherwise the org's latest.
            When no champion is set, a dropdown lets you nominate one. */}
        {(() => {
          const attributionName = champion?.name || contacts.find(c => c.id === recentActivity?.contact_id)?.name;
          return (
            <div style={{ background: "#F59E0B0F", border: "1px solid #F59E0B44", borderRadius: 10, padding: "14px 16px", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Star size={13} fill="#F59E0B" color="#F59E0B" />
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#F59E0B" }}>Most Recent Activity</span>
                {!champion && contacts.length > 0 && (
                  <select value="" onChange={e => selectChampion(e.target.value)}
                    style={{ marginLeft: "auto", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textSecondary, padding: "4px 8px", fontSize: 11, outline: "none", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
                    <option value="">Set champion contact…</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ""}</option>)}
                  </select>
                )}
              </div>
              {recentActivity ? (
                <>
                  <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 3 }}>
                    {recentActivity.channel} · {recentActivity.direction} · {new Date(recentActivity.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{attributionName ? ` · ${attributionName}` : ""}
                  </div>
                  <div style={{ fontSize: 13, color: theme.textPrimary, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{recentActivity.notes || "—"}</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: theme.textMuted, fontStyle: "italic" }}>No activity logged yet.</div>
              )}
            </div>
          );
        })()}

        {/* Metrics bar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 32 }}>

          {/* Process Progress */}
          <div
            onClick={() => onNavigate?.("process")}
            style={{
              background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
              padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = theme.hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.borderSubtle; e.currentTarget.style.background = theme.elevatedBg; }}
          >
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Process Progress</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.textPrimary }}>{procPct}%</div>
            <div style={{ width: "100%", height: 4, background: theme.progressTrack, borderRadius: 2, marginTop: 6 }}>
              <div style={{
                width: `${procPct}%`, height: "100%", borderRadius: 2,
                background: procPct === 100 ? "#16A34A" : theme.accent, transition: "width 0.3s",
              }} />
            </div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 4 }}>{procDone} of {procTotal} tasks</div>
          </div>

          {/* Current Stage */}
          <div
            onClick={() => onNavigate?.("process")}
            style={{
              background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
              padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = stageColor; e.currentTarget.style.background = theme.hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.borderSubtle; e.currentTarget.style.background = theme.elevatedBg; }}
          >
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Current Stage</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: stageColor }}>{org?.stage || "—"}</div>
          </div>

          {/* Estimated Load */}
          <div style={{
            background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
            padding: "14px 16px",
          }}>
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Estimated Load</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: theme.textPrimary }}>
              {org?.est_load_mw ? `${org.est_load_mw} MWp` : data.est_load_mw || "—"}
            </div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{org?.sector || "—"}</div>
          </div>
        </div>

        {/* Immediate Plan */}
        <Section title="Immediate Plan">
          <FreeText
            value={data.immediate_plan}
            onChange={v => updateField("immediate_plan", v)}
            placeholder="Describe the immediate plan for this organisation..."
          />
        </Section>

        {/* Site Map — KML overlay, drawing tools, satellite imagery */}
        <Section title="Site Map" defaultOpen={true}>
          <SiteMap
            org={org}
            kml={data.kml}
            location={data.location}
            features={data.site_features}
            onChange={(patch) => setData(prev => ({ ...prev, ...patch }))}
          />
        </Section>

        {/* Project Summary */}
        <Section title="Project Summary">
          <SimpleTable fields={PROJECT_SUMMARY_FIELDS} data={data} onChange={updateField} />
        </Section>

        {/* Commercial */}
        <Section title="Commercial" defaultOpen={false}>
          <SimpleTable fields={COMMERCIAL_FIELDS} data={data} onChange={updateField} />
        </Section>

        {/* Technical */}
        <Section title="Technical" defaultOpen={false}>
          <SimpleTable fields={TECHNICAL_FIELDS} data={data} onChange={updateField} />
        </Section>

        {/* Notes */}
        <Section title="Notes" defaultOpen={false}>
          <FreeText
            value={data.general_notes}
            onChange={v => updateField("general_notes", v)}
            placeholder="General notes, key risks, next steps..."
          />
        </Section>

      </div>
    </div>
  );
}
