import { useState } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { supabase } from "./supabase.js";

// ─── CSV parsing (RFC4180-ish: quotes, escaped quotes, newlines in fields) ────
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [], field = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => (v || "").trim() !== "")); // drop blank lines
}

// ─── Header auto-mapping ──────────────────────────────────────────────────────
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const FIELD_ALIASES = {
  name:             ["name", "organisation", "organization", "company", "companyname", "org", "account", "business", "lead"],
  sector:           ["sector", "industry", "vertical"],
  owner:            ["owner", "assignedto", "rep", "bd", "salesrep", "accountowner"],
  stage:            ["stage", "status", "pipelinestage", "crmstatus"],
  campaign:         ["campaign"],
  source:           ["source", "leadsource"],
  location:         ["location", "site", "hq", "address", "city", "region", "town"],
  country:          ["country"],
  est_load_mw:      ["estloadmw", "loadmw", "load", "estimatedload", "mw", "mwp", "estloadmwp", "estimatedloadmw"],
  interest_level:   ["interestlevel", "interest"],
  notes:            ["notes", "note", "comments", "comment"],
  contact_name:     ["contactname", "contact", "primarycontact", "fullname", "person", "contactfullname"],
  contact_role:     ["contactrole", "role", "title", "jobtitle", "position"],
  contact_email:    ["contactemail", "email", "emailaddress", "contactemailaddress"],
  contact_phone:    ["contactphone", "phone", "telephone", "mobile", "tel", "phonenumber"],
  linkedin_person:  ["linkedinperson", "linkedin", "linkedinurl", "linkedinprofile"],
  linkedin_company: ["linkedincompany", "companylinkedin", "linkedincompanyurl"],
  monday_id:        ["mondayid"],
  monday_lead_id:   ["mondayleadid", "leadid"],
  monday_url:       ["mondayurl"],
};
const TEMPLATE_COLS = ["Company", "Contact_name", "email", "sector", "linkedin", "stage", "Campaign"];
const VALID_STAGES = ["New", "Contacted", "Meeting Booked", "Proposal", "Negotiation", "Won", "Lost"];
const STAGE_CANON = Object.fromEntries(VALID_STAGES.map(s => [norm(s), s]));

function buildMapping(headers) {
  const map = {}; const used = new Set();
  headers.forEach((h, idx) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.includes(n)) { map[idx] = field; used.add(field); break; }
    }
  });
  return map;
}

export default function LeadImport() {
  const { theme } = useTheme();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(null);       // [{ n, lead, status, reason }]
  const [mappedFields, setMappedFields] = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);   // { inserted, contacts, errors }
  const [error, setError] = useState("");

  const summary = rows && {
    ready: rows.filter(r => r.status === "ready").length,
    dup: rows.filter(r => r.status === "duplicate").length,
    err: rows.filter(r => r.status === "error").length,
  };

  async function handleFile(file) {
    if (!file) return;
    setError(""); setResult(null); setRows(null); setParsing(true); setFileName(file.name);
    try {
      const text = await file.text();
      const table = parseCsv(text);
      if (table.length < 2) throw new Error("CSV has no data rows.");
      const headers = table[0];
      const mapping = buildMapping(headers);
      const mappedIdx = Object.keys(mapping).map(Number);
      const fields = mappedIdx.map(i => mapping[i]);
      setMappedFields(fields);
      setUnmapped(headers.filter((h, i) => !(i in mapping) && (h || "").trim() !== ""));

      if (!fields.includes("name")) {
        throw new Error("Couldn't find an organisation/name column. Rename it to \"name\" (or Company/Organisation) and retry.");
      }

      // Existing PW org names (campaign PW or legacy null) for dedup.
      const existing = new Set();
      let from = 0;
      for (;;) {
        const { data, error: e } = await supabase.from("private_wire_leads")
          .select("name").or("campaign.eq.PW,campaign.is.null").order("id").range(from, from + 999);
        if (e) throw e;
        (data || []).forEach(r => existing.add(norm(r.name)));
        if (!data || data.length < 1000) break;
        from += 1000;
      }

      const seen = new Set();
      const out = table.slice(1).map((cells, idx) => {
        const rec = {};
        mappedIdx.forEach(i => { rec[mapping[i]] = (cells[i] ?? "").trim(); });
        const lead = {
          name: rec.name || "",
          sector: rec.sector || "",
          owner: rec.owner || null,
          source: rec.source || null,
          location: rec.location || null,
          country: rec.country || "UK",
          notes: rec.notes || null,
          interest_level: rec.interest_level || null,
          linkedin_person: rec.linkedin_person || null,
          linkedin_company: rec.linkedin_company || null,
          monday_id: rec.monday_id || null,
          monday_lead_id: rec.monday_lead_id || null,
          monday_url: rec.monday_url || null,
          contact_name: rec.contact_name || null,
          contact_role: rec.contact_role || null,
          contact_email: rec.contact_email || null,
          contact_phone: rec.contact_phone || null,
        };
        // Stage: blank → New; otherwise must be a real stage.
        let stage = "New", reason = "";
        if (rec.stage) {
          const canon = STAGE_CANON[norm(rec.stage)];
          if (canon) stage = canon; else reason = `Invalid stage "${rec.stage}"`;
        }
        lead.stage = stage;
        // est_load_mw: numeric or dropped with a note.
        if (rec.est_load_mw) {
          const cleaned = String(rec.est_load_mw).replace(/[^0-9.\-]/g, "");
          const v = Number(cleaned);
          if (cleaned !== "" && !Number.isNaN(v)) lead.est_load_mw = v;
        }
        // This importer only adds Private Wire leads. Any non-PW Campaign value is
        // flagged rather than silently miscategorised.
        if (rec.campaign && norm(rec.campaign) !== "pw" && !reason) {
          reason = `Campaign must be PW (found "${rec.campaign}")`;
        }
        lead.campaign = "PW";

        let status = "ready";
        const key = norm(lead.name);
        if (!lead.name) { status = "error"; reason = "Missing organisation name"; }
        else if (!lead.sector) { status = "error"; reason = "Missing sector"; }
        else if (reason) { status = "error"; }
        else if (existing.has(key) || seen.has(key)) { status = "duplicate"; reason = "Already exists — skipped"; }
        if (status === "ready" || status === "duplicate") seen.add(key);
        return { n: idx + 2, lead, status, reason };
      });
      setRows(out);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!rows) return;
    const ready = rows.filter(r => r.status === "ready");
    if (ready.length === 0) return;
    setImporting(true); setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const created_by = user?.id || null;
      const now = new Date().toISOString();
      let inserted = 0, contacts = 0;
      const contactByName = {};
      ready.forEach(r => { if (r.lead.contact_name) contactByName[norm(r.lead.name)] = r.lead; });

      for (let i = 0; i < ready.length; i += 500) {
        const batch = ready.slice(i, i + 500).map(r => ({ ...r.lead, campaign: "PW", created_by, created_at: now }));
        const { data, error: e } = await supabase.from("private_wire_leads").insert(batch).select("id, name");
        if (e) throw e;
        inserted += data.length;
        // Create a primary contact for rows that carried contact details.
        const contactRows = [];
        for (const row of data) {
          const src = contactByName[norm(row.name)];
          if (src && src.contact_name) {
            contactRows.push({ lead_id: row.id, name: src.contact_name, email: src.contact_email || null, phone: src.contact_phone || null, role: src.contact_role || "Primary Contact" });
          }
        }
        if (contactRows.length) {
          const { error: ce } = await supabase.from("private_wire_contacts").insert(contactRows);
          if (!ce) contacts += contactRows.length;
        }
      }
      setResult({ inserted, contacts });
      setRows(null); setFileName("");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const example = ["Acme Cold Stores", "Jane Doe", "jane@acme.com", "Cold Storage", "https://www.linkedin.com/in/janedoe", "New", "PW"];
    const csv = "﻿" + TEMPLATE_COLS.join(",") + "\n" +
      example.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "private_wire_leads_template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const badge = (status) => {
    const map = { ready: ["#16A34A", "Ready"], duplicate: ["#F59E0B", "Duplicate"], error: ["#EF4444", "Error"] };
    const [c, label] = map[status];
    return <span style={{ fontSize: 9, fontWeight: 700, color: c, background: c + "1A", border: `1px solid ${c}33`, padding: "1px 6px", borderRadius: 4 }}>{label}</span>;
  };

  const btn = (primary, disabled) => ({
    fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6,
    cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
    color: primary ? "#fff" : theme.textSecondary,
    background: primary ? theme.accent : theme.pillBg,
    border: `1px solid ${primary ? theme.accent : (theme.pillBorder || theme.cardBorder)}`,
    opacity: disabled ? 0.55 : 1,
  });

  return (
    <div style={{ marginBottom: 20, background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>Import Private Wire leads (CSV)</div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
            Auto-maps common column names. Duplicates (by organisation name) are skipped. Nothing is written until you review the preview.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={downloadTemplate} style={btn(false, false)}>↓ Template</button>
          <label style={{ ...btn(true, parsing), display: "inline-block" }}>
            {parsing ? "Reading…" : "Choose CSV"}
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; handleFile(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      <div style={{ padding: "12px 16px" }}>
        {error && (
          <div style={{ fontSize: 12, color: theme.danger || "#EF4444", background: "#EF44441A", border: "1px solid #EF444433", borderRadius: 6, padding: "8px 10px" }}>{error}</div>
        )}
        {result && (
          <div style={{ fontSize: 12, color: "#16A34A", background: "#16A34A14", border: "1px solid #16A34A33", borderRadius: 6, padding: "8px 10px" }}>
            ✓ Imported {result.inserted.toLocaleString()} lead{result.inserted !== 1 ? "s" : ""}{result.contacts ? ` and ${result.contacts} contact${result.contacts !== 1 ? "s" : ""}` : ""}. Refresh the Private Wire leads view to see them.
          </div>
        )}

        {!rows && !error && !result && (
          <div style={{ fontSize: 11, color: theme.textTertiary, lineHeight: 1.6 }}>
            Recognised columns: <span style={{ fontFamily: "monospace" }}>Company</span>/name, <span style={{ fontFamily: "monospace" }}>Contact_name</span>, <span style={{ fontFamily: "monospace" }}>email</span>, <span style={{ fontFamily: "monospace" }}>sector</span>, <span style={{ fontFamily: "monospace" }}>linkedin</span>, <span style={{ fontFamily: "monospace" }}>stage</span>, <span style={{ fontFamily: "monospace" }}>Campaign</span> (plus owner, source, location, est_load_mw, notes if present). <span style={{ fontFamily: "monospace" }}>Company</span> + <span style={{ fontFamily: "monospace" }}>sector</span> are required.
            <br />IDs, dates and other blanks are filled automatically on import — you don't need to populate them.
          </div>
        )}

        {rows && summary && (
          <>
            <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>
              <span style={{ fontFamily: "monospace" }}>{fileName}</span> · mapped: {mappedFields.join(", ") || "none"}
              {unmapped.length > 0 && <> · <span style={{ color: theme.textTertiary }}>ignored: {unmapped.join(", ")}</span></>}
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
              <span style={{ color: "#16A34A" }}>{summary.ready} ready</span>
              <span style={{ color: "#F59E0B" }}>{summary.dup} duplicate</span>
              <span style={{ color: "#EF4444" }}>{summary.err} error</span>
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${theme.borderSubtle || theme.cardBorder}`, borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: theme.surfaceBg || theme.pillBg }}>
                    {["Row", "Status", "Organisation", "Sector", "Stage", "Owner", "Detail"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: theme.textTertiary, fontWeight: 700, borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}`, opacity: r.status === "error" || r.status === "duplicate" ? 0.7 : 1 }}>
                      <td style={{ padding: "5px 10px", color: theme.textTertiary, fontFamily: "monospace" }}>{r.n}</td>
                      <td style={{ padding: "5px 10px" }}>{badge(r.status)}</td>
                      <td style={{ padding: "5px 10px", color: theme.textPrimary, fontWeight: 600 }}>{r.lead.name || "—"}</td>
                      <td style={{ padding: "5px 10px", color: theme.textSecondary }}>{r.lead.sector || "—"}</td>
                      <td style={{ padding: "5px 10px", color: theme.textSecondary }}>{r.lead.stage}</td>
                      <td style={{ padding: "5px 10px", color: theme.textSecondary }}>{r.lead.owner || "—"}</td>
                      <td style={{ padding: "5px 10px", color: theme.textTertiary }}>{r.reason || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 6 }}>Showing first 200 of {rows.length} rows.</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={handleImport} disabled={importing || summary.ready === 0} style={btn(true, importing || summary.ready === 0)}>
                {importing ? "Importing…" : `Import ${summary.ready} lead${summary.ready !== 1 ? "s" : ""}`}
              </button>
              <button onClick={() => { setRows(null); setFileName(""); }} disabled={importing} style={btn(false, importing)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
