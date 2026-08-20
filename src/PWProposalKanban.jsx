import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";

// ─── PROPOSAL TASK ORDER ──────────────────────────────────────────────────────
// Must match the task IDs in PrivateWireProcess.jsx PW_STAGES[0].tasks
const PROPOSAL_TASKS = [
  { id: "prop_measure_lcoe",    label: "Sizing & Proposal" },
  { id: "prop_book_meeting",    label: "Presentation Scheduled" },
  { id: "prop_negotiate_survey",label: "Terms Negotiated" },
  { id: "prop_archdesk",        label: "Handed to Archdesk" },
];

// Kanban columns: index = number of proposal tasks completed
const COLUMNS = [
  { label: "Site Sizing & Data Collection", color: "#6366F1" },
  { label: "Drafting Proposal",            color: "#8B5CF6" },
  { label: "Presentation Booked",  color: "#EC4899" },
  { label: "Negotiating",          color: "#15803D" },
];

// How many proposal tasks are checked for this org's data object
function proposalTasksDone(data) {
  return PROPOSAL_TASKS.filter(t => data?.[t.id] === true).length;
}

// Days since a timestamp
function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function daysColor(days) {
  if (days === null) return "#64748B";
  if (days < 7)  return "#16A34A";
  if (days < 14) return "#64748B";
  if (days < 21) return "#F97316";
  return "#EF4444";
}

// ─── ORG CARD ─────────────────────────────────────────────────────────────────

function DayStat({ label, days, theme }) {
  const value = days === null ? "—" : days === 0 ? "Today" : `${days}d`;
  return (
    <span style={{
      display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.1,
    }}>
      <span style={{
        fontSize: 8, color: theme.textMuted, textTransform: "uppercase",
        letterSpacing: "0.04em", fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, color: daysColor(days),
        fontWeight: days !== null && days >= 14 ? 700 : 500,
      }}>
        {value}
      </span>
    </span>
  );
}

// Format a MWp value (drops a trailing ".0"). Returns null for missing/invalid.
function fmtMwp(v) {
  if (v == null || v === "" || isNaN(Number(v))) return null;
  const s = Number(v).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

// A non-colour-coded label + value stat (matches DayStat's layout).
function ValueStat({ label, value, theme }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.1 }}>
      <span style={{ fontSize: 8, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: theme.textPrimary, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function OrgCard({ org, onOrgClick, theme, lastTouch, mwp }) {
  const [hovered, setHovered] = useState(false);
  const touchDays = daysSince(lastTouch);

  return (
    <div
      onClick={() => onOrgClick(org)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? theme.hoverBg : theme.elevatedBg,
        border: `1px solid ${hovered ? "#FC6A0A66" : theme.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "all 0.15s",
        marginBottom: 8,
        boxShadow: hovered ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
      }}
    >
      {/* Org name */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: theme.textPrimary,
        marginBottom: 8, lineHeight: 1.3,
      }}>
        {org.name}
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {/* Owner badge */}
        {org.owner && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px",
            borderRadius: 4, background: theme.accentBg,
            color: theme.accent, textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {org.owner.split(" ")[0]}
          </span>
        )}

        {/* Stats: system size (MWp) + last touch point */}
        <div style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 12,
        }}>
          <ValueStat label="MWp" value={fmtMwp(mwp) ?? "—"} theme={theme} />
          <DayStat label="Touch" days={touchDays} theme={theme} />
        </div>
      </div>
    </div>
  );
}

// ─── COLUMN ──────────────────────────────────────────────────────────────────

function KanbanColumn({ col, colIndex, orgs, onOrgClick, theme, lastTouchByName, mwpByName }) {
  const isEmpty = orgs.length === 0;
  const colMwp = orgs.reduce((s, o) => s + (mwpByName[o.name] || 0), 0);
  return (
    <div style={{
      minWidth: 0,
      display: "flex", flexDirection: "column",
    }}>
      {/* Column header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px", marginBottom: 8,
        borderBottom: `2px solid ${col.color}`,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: theme.textPrimary,
          flex: 1, lineHeight: 1.2,
        }}>
          {col.label}
        </span>
        {colMwp > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: theme.textSecondary, whiteSpace: "nowrap" }}>
            {fmtMwp(colMwp)} MWp
          </span>
        )}
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: isEmpty ? theme.textMuted : col.color,
          background: isEmpty ? "transparent" : col.color + "22",
          padding: "1px 6px", borderRadius: 8,
        }}>
          {orgs.length}
        </span>
      </div>

      {/* Cards */}
      <div style={{ flex: 1 }}>
        {isEmpty ? (
          <div style={{
            fontSize: 11, color: theme.textMuted, fontStyle: "italic",
            textAlign: "center", padding: "16px 0",
          }}>
            —
          </div>
        ) : (
          orgs.map(org => (
            <OrgCard
              key={org.name}
              org={org}
              onOrgClick={onOrgClick}
              theme={theme}
              lastTouch={lastTouchByName[org.name] || null}
              mwp={mwpByName[org.name]}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function PWProposalKanban({ leads, onOrgClick }) {
  const { theme } = useTheme();
  const [orgDataMap, setOrgDataMap] = useState({}); // name → data JSONB
  const [loading, setLoading] = useState(true);

  // Unique proposal-stage orgs from leads
  const proposalLeads = leads.filter(l => l.stage === "Proposal" && !l.archived);

  // Deduplicate by name — use the lead with the most recent stage_entered_at
  const orgMap = {};
  for (const lead of proposalLeads) {
    const existing = orgMap[lead.name];
    if (!existing || new Date(lead.stage_entered_at) > new Date(existing.stage_entered_at)) {
      orgMap[lead.name] = lead;
    }
  }
  const uniqueOrgs = Object.values(orgMap);

  // Last touch point per org name — max activity date across ALL of that org's
  // leads. Uses the per-lead `last_touch` aggregate attached at load (the full
  // activity log is no longer fetched up front).
  const lastTouchByName = {};
  for (const lead of leads) {
    const lt = lead.last_touch;
    if (!lt) continue;
    if (!lastTouchByName[lead.name] || lt > lastTouchByName[lead.name]) {
      lastTouchByName[lead.name] = lt;
    }
  }

  // Fetch org process data for all proposal orgs
  useEffect(() => {
    if (uniqueOrgs.length === 0) { setLoading(false); return; }
    const names = uniqueOrgs.map(o => o.name);
    supabase
      .from("private_wire_organisations")
      .select("name, data")
      .in("name", names)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(row => { map[row.name] = row.data || {}; });
        setOrgDataMap(map);
        setLoading(false);
      });
  }, [leads.length]);

  // System size (MWp) per org — the PV capacity from the org's overview data.
  const mwpByName = {};
  for (const [name, data] of Object.entries(orgDataMap)) {
    const v = parseFloat(data?.pv_capacity);
    if (!isNaN(v)) mwpByName[name] = v;
  }

  // Place each org into a column based on tasks completed
  const columns = COLUMNS.map((col, i) => ({
    ...col,
    orgs: uniqueOrgs
      .filter(org => proposalTasksDone(orgDataMap[org.name]) === i)
      .sort((a, b) => {
        // Within a column: sort by days in stage descending (oldest first — most at risk)
        return new Date(a.stage_entered_at) - new Date(b.stage_entered_at);
      }),
  }));

  const totalProposal = uniqueOrgs.length;

  if (loading) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center" }}>
        <EnergyLoader />
      </div>
    );
  }

  if (totalProposal === 0) {
    return (
      <div style={{
        padding: "40px 0", textAlign: "center",
        color: theme.textMuted, fontSize: 13,
      }}>
        No organisations currently at Proposal stage
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary }}>
            Proposal Pipeline
          </div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
            {totalProposal} organisation{totalProposal !== 1 ? "s" : ""} in proposal stage
            · Click any card to open the project overview
          </div>
        </div>
      </div>

      {/* Board — full width grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        paddingBottom: 16,
        overflowX: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: `${theme.border} transparent`,
      }}>
        {columns.map((col, i) => (
          <KanbanColumn
            key={i}
            col={col}
            colIndex={i}
            orgs={col.orgs}
            onOrgClick={onOrgClick}
            theme={theme}
            lastTouchByName={lastTouchByName}
            mwpByName={mwpByName}
          />
        ))}
      </div>
    </div>
  );
}
