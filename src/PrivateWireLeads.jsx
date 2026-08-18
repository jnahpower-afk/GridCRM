import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { Mail, Phone, MessageCircle, Users, Sun, ClipboardList, Zap, AtSign, ChevronLeft, ChevronRight, Star } from "lucide-react";

function LinkedinIcon({ size = 15, color, style }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
      <rect width="4" height="12" x="2" y="9"/>
      <circle cx="4" cy="4" r="2"/>
    </svg>
  );
}
import { useTheme } from "./ThemeContext.jsx";
import { useNav } from "./NavContext.jsx";
import { supabase } from "./supabase.js";

// Columns this view actually reads off a lead. Deliberately not `*`: the eight
// omitted columns (monday_url, monday_id, linkedin_person, linkedin_company,
// contact_linkedin, interest_level, created_by, archived_at) are import/audit
// fields no part of this view renders, and together they were ~40% of the
// bytes on a ~15k-row fetch. Writes elsewhere in this file all use explicit
// field lists, so omitting them from the read cannot null them out.
const LEAD_COLS = [
  "id", "name", "sector", "location", "owner", "source", "country", "notes",
  "campaign", "dc_campaign", "stage", "stage_entered_at", "created_at",
  "updated_at", "est_load_mw", "last_contacted", "monday_lead_id",
  "contact_name", "contact_email", "contact_phone", "contact_role",
  "archived", "archive_reason", "archive_notes",
].join(",");

// Back / forward arrows — shown inline at the left of the header tab row.
function NavArrow({ icon: Icon, enabled, onClick, theme, dir }) {
  return (
    <button
      onClick={() => enabled && onClick()}
      disabled={!enabled}
      title={dir === "back" ? "Back  (⌘[)" : "Forward  (⌘])"}
      style={{
        width: 28, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "none",
        border: `1px solid ${theme.cardBorder || theme.border}`,
        borderRadius: 6,
        color: enabled ? theme.textTertiary : theme.textMuted,
        opacity: enabled ? 1 : 0.4,
        cursor: enabled ? "pointer" : "default",
        transition: "color 0.15s, border-color 0.15s",
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (enabled) { e.currentTarget.style.color = theme.textPrimary; e.currentTarget.style.borderColor = theme.textMuted; } }}
      onMouseLeave={e => { e.currentTarget.style.color = enabled ? theme.textTertiary : theme.textMuted; e.currentTarget.style.borderColor = theme.cardBorder || theme.border; }}
    >
      <Icon size={16} />
    </button>
  );
}
import PrivateWireDashboard from "./PrivateWireDashboard.jsx";
import ProposalWizard from "./ProposalWizard.jsx";
import PVSizing from "./PVSizing.jsx";
import SequenceManager from "./SequenceManager.jsx";
import TaskQueue from "./TaskQueue.jsx";
import PrivateWireProjectView from "./PrivateWireProjectView.jsx";
import NetworkMap from "./NetworkMap.jsx";
import DataCentreSubstations from "./DataCentreSubstations.jsx";
import GreenfieldProjects from "./GreenfieldProjects.jsx";
import DCSubstationLeadView from "./DCSubstationLeadView.jsx";
import EnergyLoader from "./EnergyLoader.jsx";

// ─── FUZZY SEARCH ────────────────────────────────────────────────────────────
// Small dependency-free matcher. Scores substring hits highest, falls back to
// an in-order subsequence match (typo / abbreviation tolerant, e.g. "dcn" → "Data Centres").
function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = (text || "").toLowerCase();
  if (!q || !t) return 0;

  const idx = t.indexOf(q);
  if (idx >= 0) {
    // Earlier substring hits and word-start hits score higher.
    const wordStart = idx === 0 || !/[a-z0-9]/.test(t[idx - 1]);
    return 1000 + (wordStart ? 200 : 0) - Math.min(idx, 100);
  }

  let score = 0;
  let streak = 0;
  let lastMatch = -2;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      const wordStart = i === 0 || !/[a-z0-9]/.test(t[i - 1]);
      streak = i === lastMatch + 1 ? streak + 1 : 0;
      score += 1 + streak * 2 + (wordStart ? 3 : 0);
      lastMatch = i;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

function leadSearchCorpus(lead) {
  const parts = [
    lead.name,
    lead.contact_name,
    lead.contact_email,
    lead.sector,
    lead.location,
    lead.owner,
    lead.country,
    lead.source,
    lead.stage,
    lead.notes,
    lead.monday_lead_id,
  ];
  (lead.contacts || []).forEach(c => {
    parts.push(c.name, c.email, c.phone, c.role, c.title);
  });
  return parts.filter(Boolean).join(" ");
}

function scoreLead(query, lead) {
  if (!query) return 0;
  // Tokenise so multi-word queries like "cement uk laurie" all have to match something.
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const corpus = leadSearchCorpus(lead);
  let total = 0;
  for (const tok of tokens) {
    const s = fuzzyScore(tok, corpus);
    if (s === 0) return 0;
    total += s;
  }
  // Small bonus if query matches the name directly — leads you're typing are usually names.
  total += fuzzyScore(query, lead.name || "") * 0.5;
  return total;
}

// ─── DATA ────────────────────────────────────────────────────────────────────

const SECTORS = [
  "Food, Beverage & Cold Storage",
  "Building Materials",
  "Metals & Steel",
  "Chemicals",
  "Pharmaceuticals",
  "Electronics & Data Centres",
  "Automotive",
  "Aerospace & Defence",
  "Water & Utilities",
  "Other",
];

const STAGES = ["New", "Contacted", "Meeting Booked", "Proposal", "Negotiation", "Won", "Lost"];
const STAGE_LABELS = { New: "New Target" }; // display overrides — data values unchanged
const STAGE_ORDER = { Won: 0, Negotiation: 1, Proposal: 2, "Meeting Booked": 3, Contacted: 4, New: 5, Lost: 6 };
const STAGE_COLORS_GRID_CRM = { New: "#6366F1", Contacted: "#2563EB", "Meeting Booked": "#FFB162", Proposal: "#FC6A0A", Negotiation: "#15803D", Won: "#4ADE80", Lost: "#C9C1B1" };
const STAGE_COLORS_LINEAR = { New: "#818CF8", Contacted: "#60A5FA", "Meeting Booked": "#FBBF24", Proposal: "#FB923C", Negotiation: "#16A34A", Won: "#4ADE80", Lost: "#62666D" };

const LOST_REASONS = ["No budget", "Already have supplier", "Not a priority", "Wrong timing", "No response after multiple attempts", "Other"];

const SOURCES = ["LinkedIn Keyword", "Conference", "Personal Contact", "Referral", "Inbound", "Cold Outreach", "Partner Intro"];
const COUNTRIES = ["UK", "IRE"];
const CHANNELS = ["Email", "LinkedIn", "Call", "WhatsApp", "Meeting"];
const TEAM = ["Laurie Campbell", "Max Karous", "Maher Chaabane", "Dany Dbaibo", "Eoin McEvoy"];
const CONTACT_ROLES = ["Primary Contact", "Technical", "Finance", "Operations", "Legal", "C-Suite", "Other"];

// ─── CUSTOM OPTION PERSISTENCE ───────────────────────────────────────────────

function getCustomOptions(storageKey) {
  try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
}
function persistCustomOption(storageKey, value, builtinOptions) {
  const trimmed = value?.trim();
  if (!trimmed || builtinOptions.includes(trimmed)) return;
  const current = getCustomOptions(storageKey);
  if (!current.includes(trimmed)) {
    localStorage.setItem(storageKey, JSON.stringify([...current, trimmed]));
  }
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function CreatableField({ label, value, onChange, options, storageKey, hint, theme }) {
  const [customOptions, setCustomOptions] = useState(() => getCustomOptions(storageKey));
  const allOptions = [...options, ...customOptions.filter(c => !options.includes(c))];
  const listId = `datalist-${storageKey}`;

  function handleBlur(e) {
    const val = e.target.value?.trim();
    if (val && !allOptions.includes(val)) {
      persistCustomOption(storageKey, val, options);
      setCustomOptions(getCustomOptions(storageKey));
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 500 }}>{label}</label>
        {hint && <span style={{ fontSize: 10, color: theme.textMuted }}>{hint}</span>}
      </div>
      <input
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Select or type..."
        style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" }}
      />
      <datalist id={listId}>
        {allOptions.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", unit, hint, placeholder, options, disabled, theme }) {
  const isSelect = !!options;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <label style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 500 }}>{label}</label>
        {hint && <span style={{ fontSize: 10, color: theme.textMuted }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {isSelect ? (
          <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
            style={{ flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", width: "100%", appearance: "none", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
            <option value="">— Select —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type === "number" ? "number" : "text"} value={value} placeholder={placeholder}
            onChange={e => onChange(type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)} disabled={disabled}
            style={{ flex: 1, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: unit ? "6px 0 0 6px" : 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, fontFamily: type === "number" ? "monospace" : "'Inter', system-ui, sans-serif", outline: "none", width: "100%", opacity: disabled ? 0.6 : 1 }} />
        )}
        {unit && <span style={{ padding: "7px 8px", background: theme.hoverBg, border: `1px solid ${theme.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: 11, color: theme.textTertiary, whiteSpace: "nowrap" }}>{unit}</span>}
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color, theme }) {
  return (
    <div style={{ background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: theme.textSecondary, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || theme.textPrimary, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function StageBadge({ stage, theme }) {
  const colors = theme.name === "linear" ? STAGE_COLORS_LINEAR : STAGE_COLORS_GRID_CRM;
  const c = colors[stage] || theme.textTertiary;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: c, background: `${c}18`, padding: "3px 8px", borderRadius: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
      {STAGE_LABELS[stage] || stage}
    </span>
  );
}

function ColumnFilterHeader({ label, filterKey, value, options, onChange, isOpen, onToggle, theme }) {
  const isFiltered = value !== "All";
  const [search, setSearch] = useState("");
  const filtered = options.filter(o => {
    const q = search.toLowerCase();
    const opt = o.toLowerCase();
    return opt.startsWith(q) || opt.split(/[\s\-_&,/]+/).some(w => w.startsWith(q));
  });

  return (
    <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: isFiltered ? theme.accent : theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg, position: "relative", cursor: "pointer", userSelect: "none" }}
      onClick={(e) => { e.stopPropagation(); onToggle(isOpen ? null : filterKey); if (!isOpen) setSearch(""); }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ fontSize: 8, transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
        {isFiltered && <span style={{ width: 6, height: 6, borderRadius: "50%", background: theme.accent, flexShrink: 0 }} />}
      </div>
      {isOpen && (
        <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, minWidth: 210,
            background: theme.elevatedBg, border: `1px solid ${theme.border}`, borderRadius: 8,
            boxShadow: theme.shadowMd, marginTop: 2, display: "flex", flexDirection: "column" }}>
          {/* Search input */}
          <div style={{ padding: "8px 8px 4px" }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder={`Search ${label.toLowerCase()}…`}
              style={{
                width: "100%", boxSizing: "border-box",
                background: theme.surfaceBg, border: `1px solid ${theme.border}`,
                borderRadius: 6, padding: "5px 9px", fontSize: 11,
                color: theme.textPrimary, outline: "none", fontFamily: "inherit",
              }}
            />
          </div>
          {/* Options list */}
          <div style={{ maxHeight: 220, overflowY: "auto", padding: "2px 4px 4px" }}>
            {(search ? filtered : ["All", ...options]).map(opt => (
              <div key={opt} onClick={() => { onChange(opt); onToggle(null); setSearch(""); }}
                style={{
                  padding: "7px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  background: value === opt ? theme.accent + "18" : "transparent",
                  color: value === opt ? theme.accent : theme.textPrimary,
                  fontWeight: value === opt ? 700 : 400,
                }}
                onMouseEnter={e => { if (value !== opt) e.currentTarget.style.background = theme.hoverBg || theme.pillBg; }}
                onMouseLeave={e => { if (value !== opt) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${value === opt ? theme.accent : theme.border}`,
                  background: value === opt ? theme.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, color: "#fff", flexShrink: 0 }}>
                  {value === opt ? "✓" : ""}
                </span>
                {opt}
              </div>
            ))}
            {search && filtered.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: 11, color: theme.textMuted, fontStyle: "italic" }}>No matches</div>
            )}
          </div>
        </div>
      )}
    </th>
  );
}

function SectionHeader({ children, theme }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 10 }}>{children}</div>
    </div>
  );
}

// ─── CONTACTS SECTION ─────────────────────────────────────────────────────────

function ContactsSection({ leadId, contacts, onAdd, onDelete, onSetChampion, theme }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", email: "", phone: "", linkedin: "" });
  const [saving, setSaving] = useState(false);

  const inp = (extra = {}) => ({
    background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6,
    color: theme.textPrimary, padding: "6px 9px", fontSize: 12, outline: "none",
    width: "100%", boxSizing: "border-box", fontFamily: "'Inter', system-ui, sans-serif", ...extra,
  });

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("private_wire_contacts")
        .insert([{ lead_id: leadId, name: form.name.trim(), role: form.role || null, email: form.email || null, phone: form.phone || null, linkedin: form.linkedin || null }])
        .select();
      if (error) throw error;
      if (data?.[0]) onAdd(data[0]);
      setForm({ name: "", role: "", email: "", phone: "", linkedin: "" });
      setAdding(false);
    } catch (err) {
      console.error("Error adding contact:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Contact cards */}
      {contacts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {contacts.map(c => (
            <div key={c.id} style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: (c.email || c.phone || c.linkedin) ? 4 : 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>{c.name}</div>
                  {c.is_champion && (
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#F59E0B", background: "#F59E0B18", border: "1px solid #F59E0B44", borderRadius: 4, padding: "1px 6px", display: "flex", alignItems: "center", gap: 3 }}><Star size={9} fill="#F59E0B" /> Champion</span>
                  )}
                  {c.role && (
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: theme.accent, background: `${theme.accent}18`, border: `1px solid ${theme.accent}33`, borderRadius: 4, padding: "1px 6px" }}>{c.role}</span>
                  )}
                </div>
                {c.email && <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}><Mail size={11} style={{ flexShrink: 0 }} /> {c.email}</div>}
                {c.phone && <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}><Phone size={11} style={{ flexShrink: 0 }} /> {c.phone}</div>}
                {c.linkedin && (
                  <a href={c.linkedin.startsWith("http") ? c.linkedin : `https://${c.linkedin}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: theme.accent, marginTop: 2, display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                    <LinkedinIcon size={11} style={{ flexShrink: 0 }} /> LinkedIn
                  </a>
                )}
              </div>
              <button onClick={() => onSetChampion(c)} title={c.is_champion ? "Remove as Champion" : "Set as Champion"}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: `1px solid ${c.is_champion ? "#F59E0B" : theme.border}`, background: c.is_champion ? "#F59E0B22" : theme.pillBg, color: c.is_champion ? "#F59E0B" : theme.textTertiary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>
                <Star size={12} fill={c.is_champion ? "#F59E0B" : "none"} />
              </button>
              <button onClick={() => onDelete(c.id)}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: `1px solid ${theme.border}`, background: theme.pillBg, color: theme.textTertiary, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {contacts.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic", marginBottom: 8, paddingLeft: 2 }}>No contacts added yet</div>
      )}

      {/* Add contact inline form */}
      {adding ? (
        <div style={{ background: theme.pageBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>New Contact</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 500, marginBottom: 3 }}>Name *</div>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" style={inp()} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 500, marginBottom: 3 }}>Role</div>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} style={inp({ appearance: "none", cursor: "pointer" })}>
                <option value="">— Role —</option>
                {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 500, marginBottom: 3 }}>Email</div>
              <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@company.com" style={inp()} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 500, marginBottom: 3 }}>Phone</div>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+44 7700..." style={inp()} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: theme.textTertiary, fontWeight: 500, marginBottom: 3 }}>LinkedIn</div>
            <input value={form.linkedin} onChange={e => setForm(p => ({ ...p, linkedin: e.target.value }))} placeholder="linkedin.com/in/..." style={inp()} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAdd} disabled={!form.name.trim() || saving}
              style={{ flex: 1, padding: "7px 12px", background: form.name.trim() ? theme.accent : theme.textMuted, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: form.name.trim() ? "pointer" : "default", opacity: form.name.trim() ? 1 : 0.5 }}>
              {saving ? "Adding…" : "Add Contact"}
            </button>
            <button onClick={() => { setAdding(false); setForm({ name: "", role: "", email: "", phone: "", linkedin: "" }); }}
              style={{ padding: "7px 12px", background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          style={{ width: "100%", padding: "7px 12px", background: "transparent", color: theme.accent, border: `1px dashed ${theme.accent}66`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", textAlign: "center" }}>
          + Add Contact
        </button>
      )}
    </div>
  );
}

// ─── DELETE BUTTON ────────────────────────────────────────────────────────────

function DeleteLeadButton({ lead, onDeleted, theme }) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await supabase.from("private_wire_contacts").delete().eq("lead_id", lead.id);
    await supabase.from("private_wire_activity_log").delete().eq("lead_id", lead.id);
    await supabase.from("private_wire_leads").delete().eq("id", lead.id);
    onDeleted();
  };

  if (confirm) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: theme.textSecondary, textAlign: "center" }}>
        Delete <strong>{lead.name}</strong>? This cannot be undone.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setConfirm(false)} style={{ flex: 1, padding: "8px", fontSize: 11, fontWeight: 600, background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textSecondary, cursor: "pointer" }}>
          Cancel
        </button>
        <button onClick={handleDelete} disabled={deleting} style={{ flex: 1, padding: "8px", fontSize: 11, fontWeight: 700, background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", opacity: deleting ? 0.6 : 1 }}>
          {deleting ? "Deleting…" : "Yes, delete"}
        </button>
      </div>
    </div>
  );

  return (
    <button onClick={() => setConfirm(true)} style={{ width: "100%", padding: "8px", fontSize: 11, fontWeight: 600, background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textMuted, cursor: "pointer" }}>
      Delete lead
    </button>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

// Sub-campaigns within the Data Centres umbrella (campaign = 'DC').
const DC_CAMPAIGNS = ["Distro Compute", "RtB Acqui", "Powered Land"];
const DC_CAMPAIGN_COLORS = { "Distro Compute": "#F97316", "RtB Acqui": "#8B5CF6", "Powered Land": "#10B981" };

export default function PrivateWireLeads({ onTaskBadgeChange, campaignScope = null }) {
  const { theme, themeName } = useTheme();
  // When mounted as a campaign-specific section (e.g. the "Data Centres" nav
  // item), campaignScope locks the entire view — table, dashboard, KPIs,
  // tasks — to that campaign and hides the All/PW/DC switcher.
  const scoped = campaignScope === "PW" || campaignScope === "DC";
  const isDC = campaignScope === "DC";
  const scopeLabel = campaignScope === "DC" ? "Data Centres" : "Private Wire";

  const nav = useNav();
  const [leads, setLeads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  // Inner tab ("dashboard" | "leads" | "tasks" | DC-only tabs) — driven by the
  // nav store so back/forward and deep links traverse it. "dashboard" is the
  // default, kept out of the URL for clean links.
  const viewMode = nav.location.viewMode || "dashboard";
  const setViewMode = (v) => nav.navigate({ viewMode: v === "dashboard" ? undefined : v, org: null });
  const [dcMapFocus, setDcMapFocus] = useState(null); // substation row + ts — fly the DC Network Map to a substation & select it
  const [dcLead, setDcLead] = useState(null); // { lead, sub } — full-page substation lead view
  const [dcRefresh, setDcRefresh] = useState(0); // bump to refresh DC substation/lead lists after edits
  // Selected org (PW Project View) — driven by the nav store. The live object
  // rides as a payload for instant render; on a deep-link/refresh it's resolved
  // from the loaded leads by name.
  const selectedOrg = useMemo(() => {
    const orgName = nav.location.org;
    if (!orgName) return null;
    if (nav.payload && nav.payload.name === orgName) return nav.payload;
    const l = leads.find(x => x.name === orgName);
    return l ? { name: l.name, stage: l.stage, sector: l.sector, location: l.location, owner: l.owner, est_load_mw: l.est_load_mw } : null;
  }, [nav.location.org, nav.payload, leads]);
  const setSelectedOrg = (org) => org ? nav.navigate({ org: org.name }, { payload: org }) : nav.backOr({ org: null });

  // ── Sequences ────────────────────────────────────────────────────────────────
  const [sequences,   setSequences]   = useState([]);
  const [seqSteps,    setSeqSteps]    = useState([]);
  const [enrolments,  setEnrolments]  = useState([]);
  const [seqTasks,    setSeqTasks]    = useState([]);
  const [showSeqMgr,  setShowSeqMgr]  = useState(false);

  // ── Gmail ────────────────────────────────────────────────────────────────────
  const [gmailSettings,  setGmailSettings]  = useState([]); // [{owner_name, gmail_email, calendar_link}]
  const [showGmailPanel, setShowGmailPanel] = useState(false);
  const [gmailToast,     setGmailToast]     = useState("");  // success / error message
  const [view, setView] = useState("list"); // list | add | detail
  const [activityPanel, setActivityPanel] = useState(false);
  const [filterStage, setFilterStage] = useState("All");
  const [filterSector, setFilterSector] = useState("All");
  const [filterOwner, setFilterOwner] = useState("All");
  const [filterOrg, setFilterOrg] = useState("All");
  const [filterCampaign, setFilterCampaign] = useState(campaignScope || "All");
  // DC sub-campaign filter (Distro Compute / RtB Acqui / Powered Land / All).
  const [dcCampaign, setDcCampaign] = useState("All");
  // Scope always wins over the in-page filter so data can never leak across
  // campaigns even if some control changes filterCampaign.
  const effectiveCampaign = campaignScope || filterCampaign;
  const [openFilter, setOpenFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrgs, setExpandedOrgs] = useState(() => new Set()); // orgs expanded in the grouped leads list
  const searchInputRef = useRef(null);
  const toggleOrg = (name) => setExpandedOrgs(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showProposalWizard, setShowProposalWizard] = useState(false);
  const [showPVSizing,      setShowPVSizing]       = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveNotes, setArchiveNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState(TEAM);

  // New lead form state — contact_name/email/phone create a first contact on save
  const [newLead, setNewLead] = useState({
    name: "", sector: "", source: "", owner: "", country: "UK",
    location: "", contact_name: "", contact_email: "", contact_phone: "", notes: "",
    campaign: campaignScope || "PW",
    dc_campaign: campaignScope === "DC" ? "Distro Compute" : null,
  });

  // Activity form
  const [newActivity, setNewActivity] = useState({ channel: "Email", direction: "Outbound", notes: "", response: false });
  const [editForm, setEditForm] = useState({});
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Owner lookup for the loaded (PW-scoped) leads.
  const ownerByLead = useMemo(() => {
    const m = {};
    for (const l of leads) m[l.id] = l.owner;
    return m;
  }, [leads]);

  // The task counter = distinct leads with a task due (today or overdue), scoped
  // to the signed-in user (matching the Tasks queue's "my tasks" default). A
  // neglected lead with several overdue steps counts once, not once per step.
  const myDueLeadCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const cu = (typeof localStorage !== "undefined" && localStorage.getItem("gridcrm_current_user")) || "";
    const dueLeads = new Set();
    for (const t of seqTasks) {
      if (t.status !== "pending" || t.due_date > today) continue;
      if (cu && ownerByLead[t.lead_id] !== cu) continue;
      dueLeads.add(t.lead_id);
    }
    return dueLeads.size;
  }, [seqTasks, ownerByLead]);

  // ── Sync task count to sidebar badge ─────────────────────────────────────────
  useEffect(() => {
    if (!onTaskBadgeChange) return;
    onTaskBadgeChange(myDueLeadCount);
  }, [myDueLeadCount, onTaskBadgeChange]);

  // ── Paginated fetch: bypasses Supabase server-side 1000-row cap ────────────
  async function fetchAllRows(table, query) {
    // Invariant: PAGE must be <= Supabase's PostgREST max_rows cap. If PAGE
    // exceeds the cap, the first (capped) page looks partial and the loop exits
    // early — silently truncating. The cap was raised to 5000 via
    // `ALTER ROLE authenticator SET pgrst.db_max_rows = 5000`. The loop still
    // pages through tables larger than 5000 (e.g. sequence_tasks); it just
    // takes more than one round-trip.
    const PAGE = 5000;
    let all = [], from = 0;
    while (true) {
      const { data, error } = await query(table).range(from, from + PAGE - 1);
      if (error) throw error;
      all = all.concat(data || []);
      if ((data || []).length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  // ── Handle Gmail OAuth redirect back to app ─────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected")) {
      const owner = params.get("owner") || "";
      setGmailToast(`✓ Gmail connected${owner ? ` for ${owner}` : ""}!`);
      // Reload gmail settings to reflect new connection
      supabase.from("user_gmail_settings").select("owner_name, gmail_email, calendar_link")
        .then(({ data }) => { if (data) setGmailSettings(data); });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setGmailToast(""), 5000);
    } else if (params.get("gmail_error")) {
      setGmailToast(`✗ Gmail connect failed: ${params.get("gmail_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setGmailToast(""), 8000);
    }
  }, []);

  // ── Fetch all data ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchData() {
      try {
        const isDC = campaignScope === "DC";
        // Scope the leads query to the active campaign so a scoped view doesn't
        // download the whole ~10k-row table. PW also covers legacy null-campaign rows.
        //
        // Egress: `select("*")` here was ~9.6MB of row data per mount on the full
        // ~15k-row table, plus the JSON key name repeated on every row. LEAD_COLS
        // omits the eight columns this view never reads — they are written by
        // LeadImport.jsx and only surfaced elsewhere. If you add a field to the
        // detail pane or edit form, add it here too or it will read as undefined.
        const leadQuery = t => {
          let q = supabase.from(t).select(LEAD_COLS).order("created_at", { ascending: false });
          if (campaignScope === "DC")      q = q.eq("campaign", "DC");
          else if (campaignScope === "PW") q = q.or("campaign.eq.PW,campaign.is.null");
          return q;
        };

        // Activity + contacts have no campaign column of their own, so scope them
        // to the active campaign via the leads FK (inner join). Downstream we only
        // keep rows whose lead_id is in the already-scoped leads, so results are
        // identical — this just avoids downloading the whole table (e.g. DC drops
        // activity ~23k→~1.9k, contacts ~11k→~1.8k).
        const scopeByCampaign = q => {
          if (campaignScope === "DC") return q.eq("private_wire_leads.campaign", "DC");
          if (campaignScope === "PW") return q.or("campaign.eq.PW,campaign.is.null", { referencedTable: "private_wire_leads" });
          return q;
        };

        const [leadsData, activityData, profilesRes, contactsData,
               seqData, stepsData, enrolData, tasksData, gmailRes] = await Promise.all([
          fetchAllRows("private_wire_leads", leadQuery),
          fetchAllRows("private_wire_activity_log", t => scopeByCampaign(supabase.from(t).select("*, private_wire_leads!inner(campaign)").order("date", { ascending: false }))),
          supabase.from("profiles").select("*").order("full_name"),
          fetchAllRows("private_wire_contacts",    t => scopeByCampaign(supabase.from(t).select("*, private_wire_leads!inner(campaign)").order("created_at"))),
          supabase.from("sequences").select("*").order("created_at"),
          supabase.from("sequence_steps").select("*").order("step_number"),
          // enrolData is discarded downstream (setEnrolments reads `.data`, undefined
          // for an array), so don't pay to fetch ~9k rows we never use.
          Promise.resolve([]),
          // Tasks power the PW-only Tasks queue and the UI only ever reads pending
          // ones. Skip entirely for DC; fetch only pending for PW (drops ~35k
          // completed/skipped rows from the largest table in the load).
          isDC ? Promise.resolve([]) : fetchAllRows("sequence_tasks", t => supabase.from(t).select("*, private_wire_leads!inner(campaign)").eq("status", "pending").or("campaign.eq.PW,campaign.is.null", { referencedTable: "private_wire_leads" }).order("due_date")),
          supabase.from("user_gmail_settings").select("owner_name, gmail_email, calendar_link"),
        ]);
        setSequences(seqData.data  || []);
        setSeqSteps(stepsData.data || []);
        setEnrolments(enrolData.data || []);
        setSeqTasks(tasksData);
        if (!gmailRes.error) setGmailSettings(gmailRes.data || []);

        const leadsRes    = { data: leadsData,    error: null };
        const activityRes = { data: activityData, error: null };
        const contactsRes = { data: contactsData, error: null };

        if (leadsRes.error) throw leadsRes.error;
        if (activityRes.error) throw activityRes.error;

        const activities = activityRes.data || [];
        const contacts = contactsRes.data || [];

        // Group by lead_id once (O(n)) rather than filtering per lead (O(leads×rows),
        // which was ~200M ops on the full PW set). Insertion order is preserved, so
        // each lead's activity stays date-desc and contacts stay created-order.
        const actByLead = new Map();
        for (const a of activities) {
          const arr = actByLead.get(a.lead_id);
          if (arr) arr.push(a); else actByLead.set(a.lead_id, [a]);
        }
        const contactsByLead = new Map();
        for (const c of contacts) {
          const arr = contactsByLead.get(c.lead_id);
          if (arr) arr.push(c); else contactsByLead.set(c.lead_id, [c]);
        }

        const processedLeads = (leadsRes.data || []).map(lead => ({
          ...lead,
          activityLog: actByLead.get(lead.id) || [],
          contacts: contactsByLead.get(lead.id) || [],
        }));

        setLeads(processedLeads);

        if (!profilesRes.error && profilesRes.data?.length > 0) {
          const names = profilesRes.data
            .map(p => p.full_name?.trim() || p.email)
            .filter(Boolean)
            .sort();
          setTeamMembers(names);
        }
      } catch (err) {
        console.error("Error fetching leads:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const todayDate = new Date().toISOString().slice(0, 10);
  const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── Gmail helpers ────────────────────────────────────────────────────────────
  const gmailConnected = new Set(gmailSettings.filter(s => s.gmail_email).map(s => s.owner_name));
  const calendarLinks  = Object.fromEntries(gmailSettings.filter(s => s.calendar_link).map(s => [s.owner_name, s.calendar_link]));

  function initiateGmailOAuth(ownerName) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const clientId    = import.meta.env.VITE_GMAIL_CLIENT_ID;
    if (!clientId) {
      alert("VITE_GMAIL_CLIENT_ID is not set. Ask your admin to configure it.");
      return;
    }
    const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
      access_type:   "offline",
      prompt:        "consent",
      state:         encodeURIComponent(ownerName),
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async function handleSendEmail({ ownerName, to, subject, body, calendarLink }) {
    const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/gmail-send`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
        "apikey":        supabaseKey,
      },
      body: JSON.stringify({ owner_name: ownerName, to, subject, body, calendar_link: calendarLink || "" }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Send failed");
    return result;
  }

  async function handleStepEdit({ stepId, subject, body }) {
    const { error } = await supabase
      .from("sequence_steps")
      .update({ subject: subject || null, body: body || null })
      .eq("id", stepId);
    if (error) throw new Error(error.message);
    // Refresh steps in state so Task Queue shows updated template immediately
    setSeqSteps(prev => prev.map(s => s.id === stepId ? { ...s, subject: subject || null, body: body || null } : s));
  }

  async function handleSaveCalendarLink(ownerName, calendarLink) {
    await supabase.from("user_gmail_settings").upsert(
      { owner_name: ownerName, calendar_link: calendarLink || null, updated_at: new Date().toISOString() },
      { onConflict: "owner_name" }
    );
    setGmailSettings(prev => {
      const exists = prev.find(s => s.owner_name === ownerName);
      if (exists) return prev.map(s => s.owner_name === ownerName ? { ...s, calendar_link: calendarLink } : s);
      return [...prev, { owner_name: ownerName, gmail_email: null, calendar_link: calendarLink }];
    });
  }

  const selected = leads.find(l => l.id === selectedId);
  // Champion contact of the selected lead — activity defaults to them.
  const championContactId = (selected?.contacts || []).find(c => c.is_champion)?.id || "";

  // Populate edit form when a lead is selected
  useEffect(() => {
    if (selected) {
      setEditForm({
        name: selected.name || "",
        sector: selected.sector || "",
        location: selected.location || "",
        owner: selected.owner || "",
        source: selected.source || "",
        country: selected.country || "UK",
        notes: selected.notes || "",
        campaign: selected.campaign || "PW",
        dc_campaign: selected.dc_campaign || null,
      });
      setEditDirty(false);
    }
  }, [selectedId]);

  // In the DC section, the top campaign filter narrows the working set (drives
  // the table, KPIs, and the dashboard). "All" = every DC lead.
  const activeLeadsList = useMemo(
    () => (isDC && dcCampaign !== "All")
      ? leads.filter(l => (l.dc_campaign || "Distro Compute") === dcCampaign)
      : leads,
    [leads, isDC, dcCampaign]
  );
  // DC sub-campaign counts (from the full loaded DC set, so each pill shows its total).
  const dcCampaignTotals = useMemo(() => {
    const t = { All: leads.length };
    for (const l of leads) { const k = l.dc_campaign || "Distro Compute"; t[k] = (t[k] || 0) + 1; }
    return t;
  }, [leads]);
  const activeSectors = [...new Set(activeLeadsList.map(l => l.sector))].sort();
  const activeOwners = [...new Set(activeLeadsList.map(l => l.owner).filter(Boolean))].sort();
  const activeOrgs = [...new Set(activeLeadsList.map(l => l.name).filter(Boolean))].sort();
  const activeStages = STAGES;
  const trimmedSearch = searchQuery.trim();
  const filteredLeads = useMemo(() => {
    const columnFiltered = activeLeadsList.filter(l =>
      (filterStage === "All" || l.stage === filterStage) &&
      (filterSector === "All" || l.sector === filterSector) &&
      (filterOwner === "All" || l.owner === filterOwner) &&
      (effectiveCampaign === "All" || (l.campaign || "PW") === effectiveCampaign) &&
      (filterOrg === "All" || l.name === filterOrg)
    );
    if (!trimmedSearch) {
      return columnFiltered.sort(
        (a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99)
      );
    }
    return columnFiltered
      .map(l => ({ lead: l, score: scoreLead(trimmedSearch, l) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.lead);
  }, [activeLeadsList, filterStage, filterSector, filterOwner, effectiveCampaign, trimmedSearch]);
  // Group the (already filtered/sorted) leads by organisation so one company with
  // many contact rows collapses into a single row (expandable to its contacts).
  // Order follows filteredLeads (first appearance of each org wins).
  const groupedLeads = useMemo(() => {
    const byOrg = new Map();
    for (const l of filteredLeads) {
      const key = (l.name || "").trim() || "—";
      if (!byOrg.has(key)) byOrg.set(key, []);
      byOrg.get(key).push(l);
    }
    return [...byOrg.entries()].map(([name, leads]) => ({ name, leads }));
  }, [filteredLeads]);

  // Campaign isn't a user-facing filter when the view is scoped, so don't count it.
  const activeFilterCount = [filterSector, filterStage, filterOwner, filterOrg, scoped ? "All" : filterCampaign, isDC ? dcCampaign : "All"].filter(f => f !== "All").length;

  // Keyboard shortcut: "/" focuses search, Esc clears it.
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (e.key === "/" && !typing && viewMode === "leads") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode]);

  const stageColors = theme.name === "linear" ? STAGE_COLORS_LINEAR : STAGE_COLORS_GRID_CRM;

  // Campaign-scoped subset — KPIs, pipeline funnel, and the per-campaign
  // tab counts all derive from this. Defaults to PW for any pre-Campaign-
  // column row so legacy leads keep counting toward Private Wire.
  const campaignScopedLeads = useMemo(
    () => effectiveCampaign === "All"
      ? activeLeadsList
      : activeLeadsList.filter(l => (l.campaign || "PW") === effectiveCampaign),
    [activeLeadsList, effectiveCampaign]
  );

  // Tab counts always use the unfiltered list so each pill shows its own total
  // regardless of which tab is currently active.
  const campaignTotals = useMemo(() => {
    let all = 0, pw = 0, dc = 0;
    for (const l of activeLeadsList) {
      all++;
      const c = l.campaign || "PW";
      if (c === "DC") dc++; else pw++;
    }
    return { All: all, PW: pw, DC: dc };
  }, [activeLeadsList]);

  // KPI calculations — outreach counts OUTBOUND only (inbound doesn't count as a reach-out)
  const totalContacts = campaignScopedLeads.length;
  const totalOrgs = new Set(campaignScopedLeads.map(l => (l.name || "").trim()).filter(Boolean)).size;
  const activeLeads = new Set(campaignScopedLeads.filter(l => !["Won", "Lost"].includes(l.stage)).map(l => l.name)).size;
  const industriesReached = [...new Set(campaignScopedLeads.filter(l => (l.activityLog || []).length > 0).map(l => l.sector))].length;
  // Distinct parent organisations that have received at least one outreach touch.
  // Counts on lead.name so multiple contacts at the same org collapse to one.
  const organisationsContacted = new Set(
    campaignScopedLeads
      .filter(l => l.name && (l.activityLog || []).some(a => a.direction !== "Inbound"))
      .map(l => l.name.trim())
  ).size;
  const outreachToday = campaignScopedLeads.reduce((s, l) =>
    s + (l.activityLog || []).filter(a => a.date === todayDate && a.direction !== "Inbound").length, 0);
  const outreach7d = campaignScopedLeads.reduce((s, l) =>
    s + (l.activityLog || []).filter(a => a.date >= sevenDaysAgoDate && a.direction !== "Inbound").length, 0);
  const responsesToday = campaignScopedLeads.reduce((s, l) =>
    s + (l.activityLog || []).filter(a => a.date === todayDate && a.response).length, 0);

  // Pipeline stage counts for mini funnel
  const stageCounts = STAGES.map(s => ({ stage: s, count: new Set(campaignScopedLeads.filter(l => l.stage === s).map(l => l.name)).size }));

  // ── Add lead ────────────────────────────────────────────────────────────────
  async function handleAddLead() {
    if (!newLead.name) return;
    try {
      const { data, error } = await supabase
        .from("private_wire_leads")
        .insert([{
          name: newLead.name,
          sector: newLead.sector,
          source: newLead.source,
          owner: newLead.owner || null,
          country: newLead.country || "UK",
          location: newLead.location,
          notes: newLead.notes,
          stage: "New",
          created_at: new Date().toISOString(),
          contact_name: newLead.contact_name?.trim() || null,
          contact_email: newLead.contact_email || null,
          contact_phone: newLead.contact_phone || null,
          campaign: newLead.campaign || "PW",
          dc_campaign: isDC ? (newLead.dc_campaign || (dcCampaign !== "All" ? dcCampaign : "Distro Compute")) : null,
        }])
        .select();

      if (error) throw error;

      if (data?.[0]) {
        let firstContact = null;
        // If a contact name was provided in the add form, create the first contact row
        if (newLead.contact_name.trim()) {
          const { data: cData } = await supabase
            .from("private_wire_contacts")
            .insert([{
              lead_id: data[0].id,
              name: newLead.contact_name.trim(),
              email: newLead.contact_email || null,
              phone: newLead.contact_phone || null,
              role: "Primary Contact",
            }])
            .select();
          if (cData?.[0]) firstContact = cData[0];
        }

        setLeads(prev => [{
          ...data[0],
          activityLog: [],
          contacts: firstContact ? [firstContact] : [],
        }, ...prev]);
      }

      setNewLead({ name: "", sector: "", source: "", owner: "", country: "UK", location: "", contact_name: "", contact_email: "", contact_phone: "", notes: "", campaign: campaignScope || "PW", dc_campaign: isDC ? "Distro Compute" : null });
      setView("list");
    } catch (err) {
      console.error("Error adding lead:", err);
    }
  }

  // ── Stage change ────────────────────────────────────────────────────────────
  async function handleStageChange(id, newStage) {
    if (newStage === "Lost") { setShowArchiveModal(true); return; }
    try {
      // Sync ALL contacts at the same organisation to the new stage
      const orgName = leads.find(l => l.id === id)?.name;
      const { error } = await supabase.from("private_wire_leads")
        .update({ stage: newStage })
        .eq("name", orgName);
      if (error) throw error;
      setLeads(prev => prev.map(l => l.name === orgName ? { ...l, stage: newStage } : l));
    } catch (err) {
      console.error("Error updating stage:", err);
    }
  }

  async function handleMarkLost() {
    if (!selected || !archiveReason) return;
    try {
      const { error } = await supabase.from("private_wire_leads")
        .update({ stage: "Lost", archive_reason: archiveReason, archive_notes: archiveNotes })
        .eq("name", selected.name);
      if (error) throw error;
      setLeads(prev => prev.map(l => l.name === selected.name ? { ...l, stage: "Lost", archive_reason: archiveReason, archive_notes: archiveNotes } : l));
      setSelectedId(null); setShowArchiveModal(false); setArchiveReason(""); setArchiveNotes("");
    } catch (err) {
      console.error("Error marking as lost:", err);
    }
  }

  function updateEditField(key, value) {
    setEditForm(prev => ({ ...prev, [key]: value }));
    setEditDirty(true);
  }

  async function handleSaveEdit() {
    if (!selected || !editDirty) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("private_wire_leads")
        .update({
          name: editForm.name,
          sector: editForm.sector,
          location: editForm.location || null,
          owner: editForm.owner || null,
          source: editForm.source || null,
          country: editForm.country || "UK",
          notes: editForm.notes || null,
          dc_campaign: isDC ? (editForm.dc_campaign || "Distro Compute") : (editForm.dc_campaign ?? null),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selected.id);
      if (error) throw error;
      setLeads(prev => prev.map(l => l.id === selected.id ? { ...l, ...editForm } : l));
      setEditDirty(false);
    } catch (err) {
      console.error("Error saving lead:", err);
    } finally {
      setSaving(false);
    }
  }

  // ── Contacts ────────────────────────────────────────────────────────────────
  function handleContactAdded(contact) {
    setLeads(prev => prev.map(l => l.id === selectedId
      ? { ...l, contacts: [...(l.contacts || []), contact] }
      : l
    ));
  }

  async function handleDeleteContact(contactId) {
    await supabase.from("private_wire_contacts").delete().eq("id", contactId);
    setLeads(prev => prev.map(l => l.id === selectedId
      ? { ...l, contacts: (l.contacts || []).filter(c => c.id !== contactId) }
      : l
    ));
  }

  // One champion per organisation: toggle this contact, clearing any other on
  // the same lead.
  async function handleSetChampion(contact) {
    const makeChampion = !contact.is_champion;
    setLeads(prev => prev.map(l => l.id === selectedId
      ? { ...l, contacts: (l.contacts || []).map(c => ({ ...c, is_champion: c.id === contact.id ? makeChampion : false })) }
      : l
    ));
    await supabase.from("private_wire_contacts").update({ is_champion: false }).eq("lead_id", selectedId);
    if (makeChampion) await supabase.from("private_wire_contacts").update({ is_champion: true }).eq("id", contact.id);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  // PW Project View — full-screen overlay when an org is selected
  if (selectedOrg) {
    return (
      <PrivateWireProjectView
        org={selectedOrg}
        session={null}
        onBack={() => setSelectedOrg(null)}
      />
    );
  }

  return (
    <div onClick={() => openFilter && setOpenFilter(null)} style={{ display: "flex", height: "100%", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary, overflow: "hidden" }}>

      {/* Full-page substation lead view (overlays the map) */}
      {dcLead && (
        <DCSubstationLeadView lead={dcLead.lead} substation={dcLead.sub} session={null} onBack={() => setDcLead(null)} onChanged={() => setDcRefresh(v => v + 1)} />
      )}


      {/* ADD LEAD VIEW */}
      {view === "add" && (
        <div style={{ width: 420, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", flexShrink: 0, padding: "12px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, marginBottom: 12, paddingLeft: 4 }}>New {scopeLabel} Lead</div>

          <Field label="Organisation Name" value={newLead.name} onChange={v => setNewLead(p => ({ ...p, name: v }))} placeholder="e.g. Tata Steel UK" theme={theme} />
          <Field label="Sector" value={newLead.sector} onChange={v => setNewLead(p => ({ ...p, sector: v }))} options={SECTORS} theme={theme} />
          <CreatableField label="Lead Source" value={newLead.source} onChange={v => setNewLead(p => ({ ...p, source: v }))} options={SOURCES} storageKey="pw_custom_sources" theme={theme} />
          <Field label="Assigned To" value={newLead.owner} onChange={v => setNewLead(p => ({ ...p, owner: v }))} options={teamMembers} theme={theme} />
          {isDC
            ? <Field label="Campaign" value={newLead.dc_campaign || "Distro Compute"} onChange={v => setNewLead(p => ({ ...p, dc_campaign: v }))} options={DC_CAMPAIGNS} theme={theme} />
            : <Field label="Campaign" value={newLead.campaign || "PW"} onChange={v => setNewLead(p => ({ ...p, campaign: v }))} options={["PW", "DC"]} theme={theme} />}
          <CreatableField label="Country" value={newLead.country} onChange={v => setNewLead(p => ({ ...p, country: v }))} options={COUNTRIES} storageKey="pw_custom_countries" theme={theme} />

          <SectionHeader theme={theme}>Site Details</SectionHeader>
          <Field label="Location" value={newLead.location} onChange={v => setNewLead(p => ({ ...p, location: v }))} placeholder="e.g. Port Talbot, Wales" theme={theme} />

          <SectionHeader theme={theme}>First Contact (optional)</SectionHeader>
          <Field label="Contact Name" value={newLead.contact_name} onChange={v => setNewLead(p => ({ ...p, contact_name: v }))} placeholder="e.g. James Mitchell" theme={theme} />
          <Field label="Email" value={newLead.contact_email} onChange={v => setNewLead(p => ({ ...p, contact_email: v }))} placeholder="e.g. j.mitchell@tatasteel.com" theme={theme} />
          <Field label="Phone" value={newLead.contact_phone} onChange={v => setNewLead(p => ({ ...p, contact_phone: v }))} placeholder="e.g. +44 7700 900123" theme={theme} />

          <SectionHeader theme={theme}>Notes</SectionHeader>
          <textarea value={newLead.notes} onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))} placeholder="Initial context, intro route, key info..."
            style={{ width: "100%", minHeight: 80, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Inter', system-ui, sans-serif", resize: "vertical", boxSizing: "border-box" }} />

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button onClick={handleAddLead} disabled={!newLead.name}
              style={{ flex: 1, padding: "10px 16px", background: newLead.name ? theme.accent : theme.textMuted, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: newLead.name ? "pointer" : "default", opacity: newLead.name ? 1 : 0.5 }}>
              Add Lead
            </button>
            <button onClick={() => setView("list")}
              style={{ padding: "10px 16px", background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* LEAD DETAIL PANEL */}
      {view === "list" && selected && (
        <div style={{ width: 420, background: theme.surfaceBg, borderRight: `1px solid ${theme.border}`, overflowY: "auto", flexShrink: 0, padding: "12px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ paddingLeft: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary }}>{selected.contact_name || selected.name}</div>
              {selected.contact_name && <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 1 }}>{selected.name}</div>}
            </div>
            <div onClick={() => setSelectedId(null)} style={{ cursor: "pointer", fontSize: 14, color: theme.textTertiary, padding: "2px 6px" }}>✕</div>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <StageBadge stage={selected.stage} theme={theme} />
            <span style={{ fontSize: 11, color: theme.textMuted, padding: "3px 8px", background: theme.pillBg, borderRadius: 4 }}>{selected.monday_lead_id || selected.id?.slice(0, 8)}</span>
            {selected.created_at && <span style={{ fontSize: 10, color: theme.textMuted, padding: "3px 8px", background: theme.pillBg, borderRadius: 4 }}>Added {new Date(selected.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
          </div>

          {/* Stage progression */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 8 }}>Pipeline Stage</div>
            <div style={{ display: "flex", gap: 4 }}>
              {STAGES.map((s, i) => {
                const idx = STAGES.indexOf(selected.stage);
                const thisIdx = STAGES.indexOf(s);
                const isActive = thisIdx <= idx && selected.stage !== "Lost";
                const isCurrent = s === selected.stage;
                return (
                  <div key={s} onClick={() => handleStageChange(selected.id, s)}
                    style={{ flex: 1, cursor: "pointer", textAlign: "center", padding: "6px 2px", borderRadius: 6, background: isCurrent ? (stageColors[selected.stage] + "22") : "transparent", transition: "all 0.15s" }}>
                    <div style={{ height: 18, borderRadius: 4, background: isActive ? stageColors[selected.stage] : theme.pillBg, opacity: isCurrent ? 1 : isActive ? 0.5 : 0.3, transition: "all 0.2s" }} />
                    <div style={{ fontSize: 8, color: isCurrent ? stageColors[selected.stage] : theme.textMuted, marginTop: 4, fontWeight: isCurrent ? 700 : 400, lineHeight: 1.1 }}>{STAGE_LABELS[s] || s}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PV Sizing button — always visible on lead detail */}
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setShowPVSizing(true)}
              style={{
                width: "100%", padding: "10px 16px",
                background: "linear-gradient(135deg, #1F3D4A, #2E5A6B)",
                color: "#fff", border: "none", borderRadius: 8,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: "0 2px 8px rgba(31,61,74,0.35)",
              }}
            >
              <Sun size={14} style={{ marginRight: 6 }} /> PV Sizing
            </button>
          </div>

          {/* Generate Proposal button — visible at Proposal and Negotiation stage */}
          {["Proposal", "Negotiation"].includes(selected.stage) && (
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={() => setShowProposalWizard(true)}
                style={{
                  width: "100%", padding: "10px 16px",
                  background: "linear-gradient(135deg, #F8632C, #D94E1A)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: "0 2px 8px rgba(248,99,44,0.35)",
                }}
              >
                <ClipboardList size={14} style={{ marginRight: 6 }} /> Generate Proposal
              </button>
            </div>
          )}

          {/* Lost reason modal */}
          {showArchiveModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
              <div style={{ width: 380, background: theme.elevatedBg, borderRadius: 12, border: `1px solid ${theme.border}`, padding: 24, boxShadow: theme.shadowMd }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>Mark as Lost</div>
                <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 16 }}>
                  <span style={{ fontWeight: 600 }}>{selected.name}</span> will be marked as Lost. Add a reason so the team has context.
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 8 }}>Reason</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {LOST_REASONS.map(r => (
                      <div key={r} onClick={() => setArchiveReason(r)}
                        style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: archiveReason === r ? theme.error + "22" : theme.pillBg, color: archiveReason === r ? theme.error : theme.textTertiary, border: `1px solid ${archiveReason === r ? theme.error : theme.border}` }}>{r}</div>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 6 }}>Notes (optional)</div>
                  <textarea value={archiveNotes} onChange={e => setArchiveNotes(e.target.value)} placeholder="Any context for the team..."
                    style={{ width: "100%", minHeight: 50, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Inter', system-ui, sans-serif", resize: "vertical", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleMarkLost} disabled={!archiveReason}
                    style={{ flex: 1, padding: "10px 16px", background: archiveReason ? theme.error : theme.textMuted, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: archiveReason ? "pointer" : "default", opacity: archiveReason ? 1 : 0.5 }}>
                    Mark as Lost
                  </button>
                  <button onClick={() => { setShowArchiveModal(false); setArchiveReason(""); setArchiveNotes(""); }}
                    style={{ padding: "10px 16px", background: "transparent", color: theme.textTertiary, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <SectionHeader theme={theme}>Details</SectionHeader>
          <Field label="Organisation" value={editForm.name || ""} onChange={v => updateEditField("name", v)} theme={theme} />
          <Field label="Sector" value={editForm.sector || ""} onChange={v => updateEditField("sector", v)} options={SECTORS} theme={theme} />
          <Field label="Location" value={editForm.location || ""} onChange={v => updateEditField("location", v)} placeholder="e.g. Wakefield, W Yorks" theme={theme} />
          <CreatableField label="Country" value={editForm.country || "UK"} onChange={v => updateEditField("country", v)} options={COUNTRIES} storageKey="pw_custom_countries" theme={theme} />
          <Field label="Owner" value={editForm.owner || ""} onChange={v => updateEditField("owner", v)} options={teamMembers} theme={theme} />
          {isDC
            ? <Field label="Campaign" value={editForm.dc_campaign || "Distro Compute"} onChange={v => updateEditField("dc_campaign", v)} options={DC_CAMPAIGNS} theme={theme} />
            : <Field label="Campaign" value={editForm.campaign || "PW"} onChange={v => updateEditField("campaign", v)} options={["PW", "DC"]} theme={theme} />}
          <CreatableField label="Source" value={editForm.source || ""} onChange={v => updateEditField("source", v)} options={SOURCES} storageKey="pw_custom_sources" theme={theme} />

          <SectionHeader theme={theme}>Notes</SectionHeader>
          <textarea value={editForm.notes || ""} onChange={e => updateEditField("notes", e.target.value)} placeholder="Internal notes about this lead..."
            style={{ width: "100%", minHeight: 60, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Inter', system-ui, sans-serif", resize: "vertical", boxSizing: "border-box" }} />

          {editDirty && (
            <button onClick={handleSaveEdit} disabled={saving}
              style={{ width: "100%", marginTop: 10, marginBottom: 6, padding: "9px 16px", background: theme.accent, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}

          {/* Contacts */}
          <SectionHeader theme={theme}>Contacts</SectionHeader>
          <ContactsSection
            leadId={selected.id}
            contacts={selected.contacts || []}
            onAdd={handleContactAdded}
            onDelete={handleDeleteContact}
            onSetChampion={handleSetChampion}
            theme={theme}
          />

          {/* Log Activity */}
          <SectionHeader theme={theme}>Log Activity</SectionHeader>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {CHANNELS.map(ch => (
              <div key={ch} onClick={() => setNewActivity(p => ({ ...p, channel: ch }))}
                style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: newActivity.channel === ch ? theme.accent : theme.pillBg, color: newActivity.channel === ch ? "#fff" : theme.textTertiary, border: `1px solid ${newActivity.channel === ch ? theme.accent : theme.border}`, transition: "all 0.15s" }}>{ch}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {["Outbound", "Inbound"].map(d => (
              <div key={d} onClick={() => setNewActivity(p => ({ ...p, direction: d }))}
                style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: newActivity.direction === d ? (d === "Outbound" ? theme.info : theme.success) + "22" : theme.pillBg, color: newActivity.direction === d ? (d === "Outbound" ? theme.info : theme.success) : theme.textTertiary, border: `1px solid ${newActivity.direction === d ? (d === "Outbound" ? theme.info : theme.success) : theme.border}` }}>{d === "Outbound" ? "↗ Outbound" : "↙ Inbound"}</div>
            ))}
          </div>
          {(selected.contacts || []).length > 0 && (
            <select
              value={newActivity.contact_id !== undefined ? newActivity.contact_id : championContactId}
              onChange={e => setNewActivity(p => ({ ...p, contact_id: e.target.value }))}
              style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Inter', system-ui, sans-serif", marginBottom: 8, appearance: "none", cursor: "pointer" }}>
              <option value="">Organisation (no specific contact)</option>
              {(selected.contacts || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.is_champion ? " ★ Champion" : ""}</option>)}
            </select>
          )}
          <textarea value={newActivity.notes} onChange={e => setNewActivity(p => ({ ...p, notes: e.target.value }))} placeholder="Quick note on the interaction..."
            style={{ width: "100%", minHeight: 50, background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Inter', system-ui, sans-serif", resize: "vertical", boxSizing: "border-box" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
            <div onClick={() => setNewActivity(p => ({ ...p, response: !p.response }))}
              style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${newActivity.response ? theme.success : theme.border}`, background: newActivity.response ? theme.success : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>
              {newActivity.response ? "✓" : ""}
            </div>
            <span style={{ fontSize: 11, color: theme.textTertiary }}>Response received</span>
          </div>
          <button onClick={async () => {
            if (!newActivity.notes.trim() || !selected) return;
            try {
              const { data, error } = await supabase.from("private_wire_activity_log")
                .insert([{ lead_id: selected.id, contact_id: (newActivity.contact_id !== undefined ? newActivity.contact_id : championContactId) || null, date: todayDate, channel: newActivity.channel, direction: newActivity.direction, notes: newActivity.notes, response: newActivity.response, created_at: new Date().toISOString() }])
                .select();
              if (error) throw error;
              const leadUpdate = { last_contacted: todayDate };
              if (selected.stage === "New") {
                leadUpdate.stage = "Contacted";
                await supabase.from("private_wire_leads").update({ stage: "Contacted" }).eq("name", selected.name).eq("stage", "New");
              }
              await supabase.from("private_wire_leads").update({ last_contacted: todayDate }).eq("id", selected.id);
              if (data?.[0]) {
                setLeads(prev => prev.map(l => {
                  if (l.id === selected.id) return { ...l, ...leadUpdate, activityLog: [data[0], ...(l.activityLog || [])] };
                  if (l.name === selected.name && l.stage === "New" && leadUpdate.stage === "Contacted") return { ...l, stage: "Contacted" };
                  return l;
                }));
              }
              // Auto-pause active sequences when an inbound reply is logged
              if (newActivity.direction === "Inbound") {
                const activeEnrols = enrolments.filter(e => e.lead_id === selected.id && e.status === "active");
                if (activeEnrols.length > 0) {
                  await Promise.all(activeEnrols.map(e => supabase.from("sequence_enrolments").update({ status: "paused" }).eq("id", e.id)));
                  setEnrolments(prev => prev.map(e => activeEnrols.find(a => a.id === e.id) ? { ...e, status: "paused" } : e));
                }
              }
              setNewActivity({ channel: "Email", direction: "Outbound", notes: "", response: false });
            } catch (err) {
              console.error("Error logging activity:", err);
            }
          }}
            style={{ width: "100%", padding: "9px 16px", background: newActivity.notes.trim() ? theme.accent : theme.textMuted, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: newActivity.notes.trim() ? "pointer" : "default", opacity: newActivity.notes.trim() ? 1 : 0.5 }}>
            Log Activity
          </button>

          {/* Activity timeline */}
          <SectionHeader theme={theme}>Recent Activity</SectionHeader>
          {(selected.activityLog || []).length === 0 ? (
            <div style={{ fontSize: 11, color: theme.textMuted, padding: "8px 0", fontStyle: "italic" }}>No activity logged yet</div>
          ) : (
            <div>
              {(selected.activityLog || []).map((a, i) => {
                const iconMap = { Email: <Mail size={15} />, LinkedIn: <LinkedinIcon size={15} />, Call: <Phone size={15} />, Meeting: <Users size={15} />, WhatsApp: <MessageCircle size={15} /> };
                const icon = iconMap[a.channel] || <MessageCircle size={15} />;
                const dateObj = new Date(a.date + "T00:00:00");
                const dateStr = dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < (selected.activityLog.length - 1) ? `1px solid ${theme.borderSubtle}` : "none" }}>
                    <div style={{ marginTop: 2, color: theme.textTertiary }}>{icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: theme.textPrimary }}>{a.notes}</div>
                      <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2, display: "flex", gap: 8 }}>
                        <span>{dateStr}</span>
                        <span>{a.direction === "Outbound" ? "↗" : "↙"} {a.direction}</span>
                        {a.response && <span style={{ color: theme.success }}>✓ Response</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sequences */}
          {(() => {
            const leadEnrols = enrolments.filter(e => e.lead_id === selected.id);
            const activeEnrol = leadEnrols.find(e => e.status === "active" || e.status === "paused");
            const activeSeq = activeEnrol ? sequences.find(s => s.id === activeEnrol.sequence_id) : null;
            const nextTask = activeEnrol
              ? seqTasks.filter(t => t.enrolment_id === activeEnrol.id && t.status === "pending").sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
              : null;
            const nextStep = nextTask ? seqSteps.find(s => s.id === nextTask.step_id) : null;

            return (
              <>
                <SectionHeader theme={theme}>Sequences</SectionHeader>
                {activeEnrol ? (
                  <div style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>{activeSeq?.name || "Sequence"}</div>
                        <div style={{ fontSize: 10, color: activeEnrol.status === "paused" ? "#f59e0b" : theme.success, fontWeight: 600, marginTop: 2 }}>
                          {activeEnrol.status === "paused" ? "⏸ Paused — inbound reply received" : "▶ Active"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {activeEnrol.status === "active" && (
                          <button onClick={async () => {
                            await supabase.from("sequence_enrolments").update({ status: "paused" }).eq("id", activeEnrol.id);
                            setEnrolments(prev => prev.map(e => e.id === activeEnrol.id ? { ...e, status: "paused" } : e));
                          }} style={{ padding: "3px 8px", fontSize: 10, background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 5, cursor: "pointer", color: theme.textTertiary }}>Pause</button>
                        )}
                        {activeEnrol.status === "paused" && (
                          <button onClick={async () => {
                            await supabase.from("sequence_enrolments").update({ status: "active" }).eq("id", activeEnrol.id);
                            setEnrolments(prev => prev.map(e => e.id === activeEnrol.id ? { ...e, status: "active" } : e));
                          }} style={{ padding: "3px 8px", fontSize: 10, background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 5, cursor: "pointer", color: theme.textTertiary }}>Resume</button>
                        )}
                        <button onClick={async () => {
                          await supabase.from("sequence_enrolments").update({ status: "unenrolled" }).eq("id", activeEnrol.id);
                          setEnrolments(prev => prev.map(e => e.id === activeEnrol.id ? { ...e, status: "unenrolled" } : e));
                        }} style={{ padding: "3px 8px", fontSize: 10, background: "none", border: `1px solid ${theme.error || "#ef4444"}`, borderRadius: 5, cursor: "pointer", color: theme.error || "#ef4444" }}>Unenrol</button>
                      </div>
                    </div>
                    {nextTask && nextStep && (
                      <div style={{ fontSize: 11, color: theme.textTertiary, borderTop: `1px solid ${theme.borderSubtle}`, paddingTop: 6 }}>
                        Next: <strong style={{ color: theme.textPrimary }}>{nextStep.channel}</strong>
                        {nextStep.subject && ` — "${nextStep.subject}"`}
                        {" · "}due <strong style={{ color: nextTask.due_date <= new Date().toISOString().slice(0, 10) ? "#ef4444" : theme.textPrimary }}>
                          {new Date(nextTask.due_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </strong>
                      </div>
                    )}
                    {!nextTask && <div style={{ fontSize: 11, color: theme.success, borderTop: `1px solid ${theme.borderSubtle}`, paddingTop: 6 }}>✓ All steps complete</div>}
                  </div>
                ) : (
                  <div>
                    {sequences.length === 0 ? (
                      <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: "italic", marginBottom: 8 }}>No sequences yet — create one in the Sequence Manager</div>
                    ) : (
                      <select defaultValue="" onChange={async e => {
                        const seqId = e.target.value;
                        if (!seqId) return;
                        const today = new Date().toISOString().slice(0, 10);
                        const { data: enrol, error } = await supabase.from("sequence_enrolments")
                          .insert([{ lead_id: selected.id, sequence_id: seqId, enrolled_at: today, enrolled_by: selected.owner || null }])
                          .select().single();
                        if (error) { alert("Could not enrol: " + error.message); return; }
                        // Fetch fresh steps from DB at enrolment time (avoids stale state if Sequence Manager was edited mid-session)
                        const { data: freshSteps } = await supabase.from("sequence_steps").select("*").eq("sequence_id", seqId).order("step_number");
                        const steps_for_seq = freshSteps || [];
                        if (steps_for_seq.length > 0) {
                          // Use UTC-safe date arithmetic: parse today as UTC noon to avoid local-timezone day-boundary issues
                          const [yr, mo, dy] = today.split("-").map(Number);
                          const tasksToInsert = steps_for_seq.map(s => {
                            const due = new Date(Date.UTC(yr, mo - 1, dy + (s.day_offset || 0)));
                            return { enrolment_id: enrol.id, step_id: s.id, lead_id: selected.id, due_date: due.toISOString().slice(0, 10) };
                          });
                          const { data: newTasks } = await supabase.from("sequence_tasks").insert(tasksToInsert).select();
                          setSeqTasks(prev => [...prev, ...(newTasks || [])]);
                        }
                        setEnrolments(prev => [...prev, enrol]);
                        e.target.value = "";
                      }} style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textPrimary, padding: "7px 10px", fontSize: 12, outline: "none", appearance: "none", cursor: "pointer" }}>
                        <option value="">+ Enrol in a sequence…</option>
                        {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </>
            );
          })()}

          {/* Delete lead */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${theme.borderSubtle}` }}>
            <DeleteLeadButton lead={selected} onDeleted={() => { setLeads(prev => prev.filter(l => l.id !== selected.id)); setSelectedId(null); }} theme={theme} />
          </div>
        </div>
      )}

      {/* MAIN CONTENT — Lead List + KPIs */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {loading && (
          <div style={{ height: "100%" }}>
            <EnergyLoader />
          </div>
        )}

        {!loading && (
          <>
            {/* Header bar */}
            <div style={{ padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Back / forward — inline at the left of the tab row */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <NavArrow dir="back"    icon={ChevronLeft}  enabled={nav.canBack}    onClick={nav.back}    theme={theme} />
                  <NavArrow dir="forward" icon={ChevronRight} enabled={nav.canForward} onClick={nav.forward} theme={theme} />
                </div>
                <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`, borderRadius: 8, padding: 3, gap: 2 }}>
                  {[["dashboard", "Dashboard"], ["leads", "Leads"], ["networkMap", "Network Map"], ["substations", "Substations"], ["projects", "Projects"], ["tasks", "Tasks"]]
                    .filter(([key]) => !(key === "tasks" && campaignScope === "DC")) // DC has no task queue
                    .filter(([key]) => !(key === "networkMap" && campaignScope !== "DC")) // Network Map is DC-only
                    .filter(([key]) => !(key === "substations" && campaignScope !== "DC")) // Substations list is DC-only
                    .filter(([key]) => !(key === "projects" && campaignScope !== "DC")) // DC Projects is DC-only
                    .map(([key, label]) => {
                    const pendingCount = key === "tasks" ? myDueLeadCount : 0;
                    return (
                      <button key={key} onClick={() => { setViewMode(key); if (key === "leads") setView("list"); }}
                        style={{ fontSize: 11, fontWeight: viewMode === key ? 700 : 500, padding: "4px 12px", borderRadius: 6, cursor: "pointer", color: viewMode === key ? theme.pillActiveText : theme.pillInactiveText, background: viewMode === key ? theme.pillActiveBg : "transparent", border: viewMode === key ? `1px solid ${theme.pillBorder}` : "1px solid transparent", boxShadow: viewMode === key ? theme.shadowSm : "none", display: "flex", alignItems: "center", gap: 5 }}>
                        {label}
                        {pendingCount > 0 && <span style={{ background: "#ef4444", color: "#fff", borderRadius: 8, fontSize: 9, fontWeight: 800, padding: "1px 5px", minWidth: 14, textAlign: "center" }}>{pendingCount}</span>}
                      </button>
                    );
                  })}
                </div>
                {viewMode === "leads" && (
                  <>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{scopeLabel}</span>
                    <span style={{ fontSize: 11, color: theme.textMuted, background: theme.pillBg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{groupedLeads.length} orgs · {filteredLeads.length} contacts</span>
                  </>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {viewMode === "leads" && (
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.textMuted} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
                      style={{ position: "absolute", left: 9, pointerEvents: "none" }}>
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search leads, sectors, contacts…"
                      aria-label="Search leads"
                      style={{
                        width: 240,
                        padding: "5px 26px 5px 26px",
                        fontSize: 11,
                        color: theme.textPrimary,
                        background: theme.pillBg,
                        border: `1px solid ${searchQuery ? theme.accent + "55" : theme.pillBorder}`,
                        borderRadius: 6,
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                    {searchQuery ? (
                      <button
                        onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                        aria-label="Clear search"
                        title="Clear search"
                        style={{ position: "absolute", right: 6, display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", color: theme.textMuted, fontSize: 14, lineHeight: 1, padding: 0 }}
                      >
                        ×
                      </button>
                    ) : (
                      <span style={{ position: "absolute", right: 6, fontSize: 9, fontWeight: 700, color: theme.textMuted, background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 3, padding: "1px 4px", pointerEvents: "none" }}>/</span>
                    )}
                  </div>
                )}
                {viewMode === "leads" && (activeFilterCount > 0 || trimmedSearch) && (
                  <>
                    <span style={{ fontSize: 10, color: theme.textMuted }}>
                      {activeFilterCount > 0 && `${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}`}
                      {activeFilterCount > 0 && trimmedSearch && " + "}
                      {trimmedSearch && "search"} active
                    </span>
                    <div onClick={() => { setFilterSector("All"); setFilterStage("All"); setFilterOwner("All"); setFilterOrg("All"); setFilterCampaign(campaignScope || "All"); setDcCampaign("All"); setSearchQuery(""); }}
                      style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", color: theme.accent, background: theme.accent + "15", border: `1px solid ${theme.accent}33` }}>
                      Clear all
                    </div>
                    <div style={{ width: 1, height: 16, background: theme.border }} />
                  </>
                )}
                <button onClick={() => setShowSeqMgr(true)}
                  style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", color: theme.textSecondary, background: theme.pillBg, border: `1px solid ${theme.border}`, display: "flex", alignItems: "center", gap: 5 }}>
                  <Zap size={13} /> Sequences
                </button>
                <button onClick={() => setShowGmailPanel(true)}
                  style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", color: gmailSettings.some(s => s.gmail_email) ? "#3b82f6" : theme.textSecondary, background: gmailSettings.some(s => s.gmail_email) ? "#3b82f622" : theme.pillBg, border: `1px solid ${gmailSettings.some(s => s.gmail_email) ? "#3b82f644" : theme.border}`, display: "flex", alignItems: "center", gap: 5 }}>
                  <Mail size={13} /> Gmail
                </button>
                {viewMode === "leads" && (
                  <button onClick={() => { setView("add"); setSelectedId(null); }}
                    style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#fff", background: theme.accent, border: "none" }}>
                    + Add Lead
                  </button>
                )}
              </div>
            </div>

            {/* DC campaign filter — Distro Compute / RtB Acqui / Powered Land */}
            {isDC && ["dashboard", "leads", "tasks"].includes(viewMode) && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 20px", borderBottom: `1px solid ${theme.border}`, background: theme.pageBg, flexShrink: 0, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 2 }}>Campaign</span>
                {["All", ...DC_CAMPAIGNS].map(key => {
                  const active = dcCampaign === key;
                  const colour = key === "All" ? theme.accent : DC_CAMPAIGN_COLORS[key];
                  const n = key === "All" ? dcCampaignTotals.All : (dcCampaignTotals[key] || 0);
                  return (
                    <button key={key} onClick={() => setDcCampaign(key)}
                      style={{ fontSize: 11, fontWeight: active ? 700 : 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer", color: active ? "#fff" : theme.textSecondary, background: active ? colour : theme.cardBg, border: `1px solid ${active ? colour : theme.cardBorder}`, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7 }}>
                      <span>{key}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, color: active ? "#fff" : theme.textTertiary, background: active ? "rgba(255,255,255,0.18)" : theme.pillBg }}>{n.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Dashboard view */}
            {viewMode === "dashboard" && (
              <PrivateWireDashboard
                leads={activeLeadsList}
                theme={theme}
                campaignScope={campaignScope}
                onOrgClick={org => setSelectedOrg(org)}
                onOpenNetworkMap={sub => { setDcMapFocus(sub ? { ...sub, ts: Date.now() } : null); setViewMode("networkMap"); }}
              />
            )}


            {/* Network Map view — Data Centres only (import connections + land) */}
            {viewMode === "networkMap" && campaignScope === "DC" && (
              <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <NetworkMap table="dc_network_features" dcMode focus={dcMapFocus} refreshKey={dcRefresh} onOpenLead={(lead, sub) => setDcLead({ lead, sub })} />
              </div>
            )}

            {/* Substations list — Data Centres only, grouped per DNO */}
            {viewMode === "substations" && campaignScope === "DC" && (
              <DataCentreSubstations
                refreshKey={dcRefresh}
                onOpenMap={f => { setDcMapFocus({ ...f, ts: Date.now() }); setViewMode("networkMap"); }}
                onOpenLead={(lead, sub) => setDcLead({ lead, sub })} />
            )}

            {/* DC Projects — Data Centres only, mirrors Greenfield Projects */}
            {viewMode === "projects" && campaignScope === "DC" && (
              <div style={{ flex: 1, minHeight: 0 }}>
                <GreenfieldProjects projectsTable="dc_projects" activityTable="dc_project_activity" emailReview={false}
                  gridChartTech={null} gridChartTitle="Grid App Submitted — Capacity Pipeline" />
              </div>
            )}

            {/* Tasks view */}
            {viewMode === "tasks" && (
              <TaskQueue
                tasks={seqTasks}
                leads={leads}
                steps={seqSteps}
                enrolments={enrolments}
                sequences={sequences}
                theme={theme}
                onTaskComplete={async (task, step, notes) => {
                  const todayDate = new Date().toISOString().slice(0, 10);
                  const lead = leads.find(l => l.id === task.lead_id);
                  if (!lead) return;
                  // Log the activity
                  const { data: actData } = await supabase.from("private_wire_activity_log")
                    .insert([{ lead_id: task.lead_id, date: todayDate, channel: step?.channel || "Email", direction: "Outbound", notes: notes || `Completed sequence step: ${step?.subject || step?.channel}`, response: false }])
                    .select();
                  const leadUpdate = { last_contacted: todayDate };
                  if (lead.stage === "New") {
                    leadUpdate.stage = "Contacted";
                    await supabase.from("private_wire_leads").update({ stage: "Contacted" }).eq("name", lead.name).eq("stage", "New");
                  }
                  await supabase.from("private_wire_leads").update({ last_contacted: todayDate }).eq("id", task.lead_id);
                  // Mark task complete
                  await supabase.from("sequence_tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", task.id);
                  setSeqTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: "completed" } : t));
                  // Update leads state
                  if (actData?.[0]) {
                    setLeads(prev => prev.map(l => {
                      if (l.id === task.lead_id) return { ...l, ...leadUpdate, activityLog: [actData[0], ...(l.activityLog || [])] };
                      if (l.name === lead.name && l.stage === "New" && leadUpdate.stage === "Contacted") return { ...l, stage: "Contacted" };
                      return l;
                    }));
                  }
                  // Check if enrolment is complete
                  const enrol = enrolments.find(e => e.id === task.enrolment_id);
                  if (enrol) {
                    const remaining = seqTasks.filter(t => t.enrolment_id === task.enrolment_id && t.status === "pending" && t.id !== task.id);
                    if (remaining.length === 0) {
                      await supabase.from("sequence_enrolments").update({ status: "completed" }).eq("id", enrol.id);
                      setEnrolments(prev => prev.map(e => e.id === enrol.id ? { ...e, status: "completed" } : e));
                    }
                  }
                }}
                onTaskSkip={async (task) => {
                  await supabase.from("sequence_tasks").update({ status: "skipped" }).eq("id", task.id);
                  setSeqTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: "skipped" } : t));
                }}
                onTaskRemove={async (enrolmentId, allTasks) => {
                  // Skip all pending tasks for this enrolment and mark enrolment as cancelled
                  const pendingIds = allTasks.filter(t => t.status === "pending").map(t => t.id);
                  if (pendingIds.length > 0) {
                    await supabase.from("sequence_tasks").update({ status: "skipped" }).in("id", pendingIds);
                  }
                  await supabase.from("sequence_enrolments").update({ status: "cancelled" }).eq("id", enrolmentId);
                  setSeqTasks(prev => prev.map(t => pendingIds.includes(t.id) ? { ...t, status: "skipped" } : t));
                  setEnrolments(prev => prev.map(e => e.id === enrolmentId ? { ...e, status: "cancelled" } : e));
                }}
                teamMembers={teamMembers}
                calendarLinks={calendarLinks}
                gmailConnected={gmailConnected}
                onSendEmail={handleSendEmail}
                onStepEdit={handleStepEdit}
              />
            )}

            {/* Leads view */}
            {viewMode === "leads" && (
              <div style={{ padding: 20, flex: 1 }}>
                {/* Campaign tabs — hidden when the view is locked to one campaign */}
                {!scoped && (
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {[
                    { key: "All", label: "All",           colour: theme.accent  },
                    { key: "PW",  label: "Private Wire",  colour: "#2563EB"     },
                    { key: "DC",  label: "Data Centres",  colour: "#F97316"     },
                  ].map(t => {
                    const active = filterCampaign === t.key;
                    const n = campaignTotals[t.key] || 0;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setFilterCampaign(t.key)}
                        style={{
                          fontSize: 11, fontWeight: active ? 700 : 600,
                          padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                          color: active ? "#fff" : theme.textSecondary,
                          background: active ? t.colour : theme.cardBg,
                          border: `1px solid ${active ? t.colour : theme.cardBorder}`,
                          fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 8,
                          transition: "all 0.12s",
                        }}
                      >
                        <span>{t.label}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          padding: "1px 7px", borderRadius: 10,
                          color: active ? "#fff" : theme.textTertiary,
                          background: active ? "rgba(255,255,255,0.18)" : theme.pillBg,
                        }}>{n.toLocaleString()}</span>
                      </button>
                    );
                  })}
                </div>
                )}

                {/* KPI Row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
                  <KPI label="Organisations" value={totalOrgs} sub={`${totalContacts} contacts · ${activeLeads} active`} theme={theme} />
                  <KPI label="Organisations Contacted" value={organisationsContacted} sub="Distinct orgs reached" color={theme.accent} theme={theme} />
                  <KPI label="Industries Reached" value={industriesReached} sub="Sectors with outreach" color={theme.accent} theme={theme} />
                  <KPI label="Outreach Today" value={outreachToday} sub={responsesToday > 0 ? `${responsesToday} response${responsesToday > 1 ? "s" : ""}` : "No responses yet"} color={theme.success} theme={theme} />
                  <KPI label="Outreach (7 Days)" value={outreach7d} sub="Outbound touches this week" theme={theme} />
                </div>

                {/* Mini pipeline funnel */}
                <div style={{ display: "flex", gap: 2, marginBottom: 20, padding: "12px 14px", background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, alignItems: "flex-start" }}>
                  {stageCounts.filter(s => s.stage !== "Lost").map(s => (
                    <div key={s.stage} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: s.count > 0 ? stageColors[s.stage] : theme.textMuted }}>{s.count}</div>
                      <div style={{ fontSize: 9, color: theme.textTertiary, marginTop: 2 }}>{STAGE_LABELS[s.stage] || s.stage}</div>
                      <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: s.count > 0 ? stageColors[s.stage] : theme.pillBg, opacity: 0.6 }} />
                    </div>
                  ))}
                  {(() => { const lostCount = stageCounts.find(s => s.stage === "Lost"); return lostCount && lostCount.count > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 6, paddingLeft: 10, borderLeft: `1px solid ${theme.borderSubtle}` }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: theme.error }}>{lostCount.count}</div>
                        <div style={{ fontSize: 9, color: theme.error, marginTop: 2, opacity: 0.7 }}>Lost</div>
                        <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: theme.error, opacity: 0.4 }} />
                      </div>
                    </div>
                  ) : null; })()}
                </div>

                {/* Empty state when search / filters return nothing */}
                {filteredLeads.length === 0 && activeLeadsList.length > 0 && (
                  <div style={{ padding: "32px 20px", textAlign: "center", background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 4 }}>
                      {trimmedSearch ? `No leads match "${trimmedSearch}"` : "No leads match the current filters"}
                    </div>
                    <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>
                      Try a shorter query or different spelling — search covers organisation, sector, owner, location, stage and contacts.
                    </div>
                    <button
                      onClick={() => { setFilterSector("All"); setFilterStage("All"); setFilterOwner("All"); setFilterOrg("All"); setFilterCampaign(campaignScope || "All"); setDcCampaign("All"); setSearchQuery(""); }}
                      style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", color: theme.accent, background: theme.accent + "15", border: `1px solid ${theme.accent}33` }}
                    >
                      Clear filters &amp; search
                    </button>
                  </div>
                )}

                {/* Leads table */}
                {filteredLeads.length > 0 && (
                  <div style={{ background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Contact</th>
                          <ColumnFilterHeader label="Organisation" filterKey="org" value={filterOrg} options={activeOrgs} onChange={setFilterOrg} isOpen={openFilter === "org"} onToggle={setOpenFilter} theme={theme} />
                          <ColumnFilterHeader label="Sector" filterKey="sector" value={filterSector} options={activeSectors} onChange={setFilterSector} isOpen={openFilter === "sector"} onToggle={setOpenFilter} theme={theme} />
                          <ColumnFilterHeader label="Stage" filterKey="stage" value={filterStage} options={activeStages} onChange={setFilterStage} isOpen={openFilter === "stage"} onToggle={setOpenFilter} theme={theme} />
                          <ColumnFilterHeader label="Owner" filterKey="owner" value={filterOwner} options={activeOwners} onChange={setFilterOwner} isOpen={openFilter === "owner"} onToggle={setOpenFilter} theme={theme} />
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Created</th>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Today</th>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Total</th>
                          <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Last Touch</th>
                          {scoped ? (
                            <th style={{ padding: "10px 14px", fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", background: theme.cardBg }}>Campaign</th>
                          ) : (
                            <ColumnFilterHeader label="Campaign" filterKey="campaign" value={isDC ? dcCampaign : filterCampaign} options={isDC ? DC_CAMPAIGNS : ["PW", "DC"]} onChange={isDC ? setDcCampaign : setFilterCampaign} isOpen={openFilter === "campaign"} onToggle={setOpenFilter} theme={theme} />
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const campaignBadge = (lead) => {
                            // In the DC section, show the sub-campaign; elsewhere the PW/DC campaign.
                            const c = isDC ? (lead.dc_campaign || "Distro Compute") : (lead.campaign || "PW");
                            const colour = DC_CAMPAIGN_COLORS[c] || (c === "DC" ? "#F97316" : "#2563EB");
                            return <span style={{ fontSize: 10, fontWeight: 700, color: colour, background: `${colour}1A`, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{c}</span>;
                          };
                          const orgLink = (lead) => ["Proposal", "Negotiation", "Won"].includes(lead.stage) ? (
                            <div onClick={e => { e.stopPropagation(); setSelectedOrg({ name: lead.name, stage: lead.stage, sector: lead.sector, location: lead.location, owner: lead.owner, est_load_mw: lead.est_load_mw }); }}
                              title="Open Project Overview"
                              style={{ fontSize: 12, fontWeight: 600, color: theme.accent, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, textDecoration: "underline", textDecorationColor: theme.accent + "66" }}>
                              {lead.name}<span style={{ fontSize: 9, opacity: 0.6 }}>↗</span>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{lead.name}</div>
                          );
                          // A single contact/lead row (indented when shown under an org header).
                          const renderRow = (lead, indented) => {
                            const log = lead.activityLog || [];
                            const todayCount = log.filter(a => a.date === todayDate && a.direction !== "Inbound").length;
                            const totalCount = log.filter(a => a.direction !== "Inbound").length;
                            const lastDate = log.length > 0 ? log[0].date : (lead.last_contacted || "—");
                            return (
                              <tr key={lead.id} onClick={() => { setSelectedId(lead.id); setView("list"); }}
                                style={{ borderBottom: `1px solid ${theme.borderSubtle}`, cursor: "pointer", background: selectedId === lead.id ? theme.hoverBg : "transparent", transition: "background 0.1s" }}>
                                <td style={{ padding: indented ? "9px 14px 9px 44px" : "10px 14px" }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{lead.contact_name || <span style={{ color: theme.textMuted, fontStyle: "italic" }}>No contact</span>}</div>
                                  <div style={{ fontSize: 10, color: theme.textMuted }}>{lead.contact_email || ""}</div>
                                </td>
                                <td style={{ padding: "10px 14px" }}>{indented ? <span style={{ fontSize: 11, color: theme.textMuted }}>{lead.contact_role || ""}</span> : orgLink(lead)}</td>
                                <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{lead.sector}</td>
                                <td style={{ padding: "10px 14px" }}><StageBadge stage={lead.stage} theme={theme} /></td>
                                <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{lead.owner || <span style={{ color: theme.textMuted }}>—</span>}</td>
                                <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textMuted }}>{lead.created_at ? new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</td>
                                <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ fontSize: 12, fontWeight: 700, color: todayCount > 0 ? theme.success : theme.textMuted }}>{todayCount || "—"}</span></td>
                                <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ fontSize: 12, fontWeight: 700, color: totalCount > 5 ? theme.accent : totalCount > 2 ? theme.textPrimary : theme.textTertiary }}>{totalCount}</span></td>
                                <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textMuted }}>{lastDate}</td>
                                <td style={{ padding: "10px 14px" }}>{campaignBadge(lead)}</td>
                              </tr>
                            );
                          };
                          return groupedLeads.map(group => {
                            const { name, leads: rows } = group;
                            if (rows.length === 1) return renderRow(rows[0], false);
                            const open = expandedOrgs.has(name);
                            const rep = rows[0];
                            const sectors = [...new Set(rows.map(l => l.sector).filter(Boolean))];
                            const owners = [...new Set(rows.map(l => l.owner).filter(Boolean))];
                            let today = 0, total = 0, last = null, earliest = null;
                            for (const l of rows) {
                              const log = l.activityLog || [];
                              today += log.filter(a => a.date === todayDate && a.direction !== "Inbound").length;
                              total += log.filter(a => a.direction !== "Inbound").length;
                              const lt = log.length > 0 ? log[0].date : (l.last_contacted || null);
                              if (lt && (!last || lt > last)) last = lt;
                              if (l.created_at && (!earliest || l.created_at < earliest)) earliest = l.created_at;
                            }
                            return (
                              <Fragment key={"org-" + name}>
                                <tr onClick={() => toggleOrg(name)}
                                  style={{ borderBottom: `1px solid ${theme.borderSubtle}`, cursor: "pointer", background: open ? theme.hoverBg : "transparent", transition: "background 0.1s" }}>
                                  <td style={{ padding: "10px 14px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ display: "inline-block", fontSize: 10, color: theme.textTertiary, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>▸</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary, background: theme.pillBg, padding: "2px 8px", borderRadius: 10 }}>{rows.length} contacts</span>
                                    </div>
                                  </td>
                                  <td style={{ padding: "10px 14px" }}>{orgLink(rep)}</td>
                                  <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{sectors.length === 1 ? sectors[0] : sectors.length ? "Multiple" : "—"}</td>
                                  <td style={{ padding: "10px 14px" }}><StageBadge stage={rep.stage} theme={theme} /></td>
                                  <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textSecondary }}>{owners.length === 1 ? owners[0] : owners.length ? "Multiple" : <span style={{ color: theme.textMuted }}>—</span>}</td>
                                  <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textMuted }}>{earliest ? new Date(earliest).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</td>
                                  <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ fontSize: 12, fontWeight: 700, color: today > 0 ? theme.success : theme.textMuted }}>{today || "—"}</span></td>
                                  <td style={{ padding: "10px 14px", textAlign: "center" }}><span style={{ fontSize: 12, fontWeight: 700, color: total > 5 ? theme.accent : total > 2 ? theme.textPrimary : theme.textTertiary }}>{total}</span></td>
                                  <td style={{ padding: "10px 14px", fontSize: 11, color: theme.textMuted }}>{last || "—"}</td>
                                  <td style={{ padding: "10px 14px" }}>{campaignBadge(rep)}</td>
                                </tr>
                                {open && rows.map(l => renderRow(l, true))}
                              </Fragment>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* PV Sizing full-page view */}
      {showPVSizing && (
        <PVSizing
          lead={selected}
          onClose={() => setShowPVSizing(false)}
        />
      )}

      {/* Proposal Wizard modal */}
      {showProposalWizard && (
        <ProposalWizard
          lead={selected}
          onClose={() => setShowProposalWizard(false)}
        />
      )}
      {showSeqMgr && (
        <SequenceManager
          theme={theme}
          onClose={async () => {
            // Refresh sequences and steps after editing
            const [seqRes, stepsRes] = await Promise.all([
              supabase.from("sequences").select("*").order("created_at"),
              supabase.from("sequence_steps").select("*").order("step_number"),
            ]);
            setSequences(seqRes.data || []);
            setSeqSteps(stepsRes.data || []);
            setShowSeqMgr(false);
          }}
        />
      )}

      {/* ── Gmail Settings Panel ─────────────────────────────────────────────── */}
      {showGmailPanel && (
        <GmailSettingsPanel
          gmailSettings={gmailSettings}
          teamMembers={teamMembers}
          theme={theme}
          onClose={() => setShowGmailPanel(false)}
          onConnect={initiateGmailOAuth}
          onSaveCalendarLink={handleSaveCalendarLink}
        />
      )}

      {/* ── Toast notification ───────────────────────────────────────────────── */}
      {gmailToast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: gmailToast.startsWith("✓") ? "#22c55e" : "#ef4444",
          color: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          cursor: "pointer",
        }} onClick={() => setGmailToast("")}>
          {gmailToast}
        </div>
      )}
    </div>
  );
}

// ─── GMAIL SETTINGS PANEL ────────────────────────────────────────────────────

function GmailSettingsPanel({ gmailSettings, teamMembers, theme, onClose, onConnect, onSaveCalendarLink }) {
  const [selectedOwner, setSelectedOwner] = useState(teamMembers[0] || "");
  const [calLink, setCalLink]             = useState("");
  const [saving, setSaving]               = useState(false);
  const [savedMsg, setSavedMsg]           = useState(false);

  const ownerData = gmailSettings.find(s => s.owner_name === selectedOwner);

  // Sync calendar link field when owner changes
  useState(() => { setCalLink(ownerData?.calendar_link || ""); });
  const handleOwnerChange = (name) => {
    setSelectedOwner(name);
    const d = gmailSettings.find(s => s.owner_name === name);
    setCalLink(d?.calendar_link || "");
    setSavedMsg(false);
  };

  async function saveCalLink() {
    setSaving(true);
    await onSaveCalendarLink(selectedOwner, calLink);
    setSaving(false);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  }

  const inp = {
    background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.textPrimary, padding: "7px 10px",
    fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: theme.elevatedBg, border: `1px solid ${theme.border}`, borderRadius: 14, width: "100%", maxWidth: 460, boxShadow: theme.shadowMd }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 7 }}><Mail size={16} /> Gmail Settings</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ padding: "20px" }}>
          {/* Who are you? */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4, fontWeight: 600 }}>YOUR NAME</label>
            <select value={selectedOwner} onChange={e => handleOwnerChange(e.target.value)} style={{ ...inp, appearance: "none" }}>
              {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Gmail connection status */}
          <div style={{ padding: "12px 14px", background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 8, marginBottom: 16 }}>
            {ownerData?.gmail_email ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>Connected</div>
                  <div style={{ fontSize: 11, color: theme.textTertiary }}>{ownerData.gmail_email}</div>
                </div>
                <button
                  onClick={() => onConnect(selectedOwner)}
                  style={{ marginLeft: "auto", padding: "4px 10px", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, color: theme.textTertiary, cursor: "pointer" }}>
                  Reconnect
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: theme.textMuted, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>Not connected</div>
                  <div style={{ fontSize: 11, color: theme.textTertiary }}>Connect to send emails directly from the CRM</div>
                </div>
                <button
                  onClick={() => onConnect(selectedOwner)}
                  style={{ padding: "6px 14px", background: "#3b82f6", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
                  Connect Gmail
                </button>
              </div>
            )}
          </div>

          {/* Calendar link */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4, fontWeight: 600 }}>CALENDAR LINK <span style={{ fontWeight: 400, fontStyle: "italic" }}>— used in {"{{calendar_link}}"} templates</span></label>
            <input
              value={calLink}
              onChange={e => setCalLink(e.target.value)}
              placeholder="https://calendar.app.google/..."
              style={inp}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ flex: 1, padding: "9px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, color: theme.textSecondary, cursor: "pointer" }}>
              Close
            </button>
            <button onClick={saveCalLink} disabled={saving}
              style={{ flex: 2, padding: "9px", background: theme.accent, border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {savedMsg ? "✓ Saved!" : saving ? "Saving…" : "Save Calendar Link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
