import { useState, useEffect, useMemo } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { supabase } from "./supabase.js";
import CRMAuditLog from "./CRMAuditLog.jsx";
import LeadImport from "./LeadImport.jsx";

// ─── Sections ──────────────────────────────────────────────────────────────
// Edit this to add/remove tables. `filename` is the suggested download name
// (without extension); leave blank to use the table id.
const SECTIONS = [
  {
    group: "Private Wire",
    items: [
      { table: "private_wire_leads",         label: "Leads",          filename: "private_wire_leads" },
      { table: "private_wire_contacts",      label: "Contacts",       filename: "private_wire_contacts" },
      { table: "private_wire_organisations", label: "Organisations",  filename: "private_wire_organisations" },
      { table: "private_wire_activity_log",  label: "Activity log",   filename: "private_wire_activity_log" },
      { table: "private_wire_sizing",        label: "Sizing",         filename: "private_wire_sizing" },
    ],
  },
  {
    group: "Greenfield",
    items: [
      { table: "greenfield_projects",          label: "Projects",            filename: "greenfield_projects" },
      { table: "greenfield_project_activity",  label: "Project activity",    filename: "greenfield_project_activity" },
      { table: "leads",                        label: "Leads",               filename: "greenfield_leads" },
      { table: "leads_activity_log",           label: "Lead activity log",   filename: "greenfield_leads_activity_log" },
    ],
  },
  {
    group: "Acquisitions / Portfolio",
    items: [
      { table: "acquisition_leads",        label: "Acquisition leads",        filename: "acquisition_leads" },
      { table: "acquisition_activity_log", label: "Acquisition activity log", filename: "acquisition_activity_log" },
      { table: "projects",                 label: "Portfolio projects",       filename: "portfolio_projects" },
      { table: "project_inputs",           label: "Project inputs",           filename: "project_inputs" },
      { table: "project_overview",         label: "Project overview",         filename: "project_overview" },
      { table: "project_acquisition",      label: "Project acquisitions",     filename: "project_acquisitions" },
      { table: "model_runs",               label: "Model runs",               filename: "model_runs" },
      { table: "comparable_transactions",  label: "Comparable transactions",  filename: "comparable_transactions" },
    ],
  },
  {
    group: "Sequences (outreach)",
    items: [
      { table: "sequences",            label: "Sequences",            filename: "sequences" },
      { table: "sequence_steps",       label: "Sequence steps",       filename: "sequence_steps" },
      { table: "sequence_enrolments",  label: "Sequence enrolments",  filename: "sequence_enrolments" },
      { table: "sequence_tasks",       label: "Sequence tasks",       filename: "sequence_tasks" },
    ],
  },
  {
    group: "Misc",
    items: [
      { table: "news_articles", label: "News articles", filename: "news_articles" },
      { table: "initiatives",   label: "Initiatives",   filename: "initiatives" },
      { table: "map_pins",      label: "Map pins",      filename: "map_pins" },
      { table: "network_features", label: "Network features", filename: "network_features" },
    ],
  },
];

// ─── CSV utilities ─────────────────────────────────────────────────────────
// Quote-wrap if the cell contains a comma, quote, newline, or leading/trailing
// whitespace. Double up internal quotes. JSON values are stringified.
function csvCell(v) {
  if (v == null) return "";
  let s;
  if (typeof v === "object") s = JSON.stringify(v);
  else                       s = String(v);
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Compute the union of keys across all rows so sparsely-populated columns
// still show up in the export. Preserves first-seen order.
function unionColumns(rows) {
  const seen = new Set();
  const cols = [];
  for (const r of rows) {
    if (!r) continue;
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const cols = unionColumns(rows);
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(","));
  return lines.join("\r\n");
}

function downloadBlob(filename, text, mime = "text/csv;charset=utf-8") {
  // Prepend UTF-8 BOM so Excel opens it without mojibake.
  const blob = new Blob(["﻿" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

// Paginated full fetch — mirrors fetchAllRows in PrivateWireLeads.
async function fetchAllRows(table) {
  const PAGE = 5000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if ((data || []).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function CRMSettings() {
  const { theme } = useTheme();

  // table id → { count: number|null, loading: bool }
  const [counts, setCounts] = useState({});
  // table id → 'idle' | 'downloading' | 'error'
  const [statuses, setStatuses] = useState({});
  // table id → string (last error message)
  const [errors, setErrors] = useState({});

  const allTables = useMemo(() => SECTIONS.flatMap(s => s.items.map(i => i.table)), []);

  // Load row counts in parallel on mount. Uses HEAD select with count="exact".
  useEffect(() => {
    let cancelled = false;
    setCounts(Object.fromEntries(allTables.map(t => [t, { count: null, loading: true }])));
    (async () => {
      await Promise.all(allTables.map(async (t) => {
        try {
          const { count, error } = await supabase
            .from(t).select("*", { count: "exact", head: true });
          if (cancelled) return;
          if (error) {
            setCounts(prev => ({ ...prev, [t]: { count: null, loading: false, error: error.message } }));
          } else {
            setCounts(prev => ({ ...prev, [t]: { count: count ?? 0, loading: false } }));
          }
        } catch (e) {
          if (cancelled) return;
          setCounts(prev => ({ ...prev, [t]: { count: null, loading: false, error: e?.message || String(e) } }));
        }
      }));
    })();
    return () => { cancelled = true; };
  }, [allTables.join(",")]);

  async function handleDownload(item) {
    const { table, filename } = item;
    setStatuses(prev => ({ ...prev, [table]: "downloading" }));
    setErrors(prev => ({ ...prev, [table]: "" }));
    try {
      const rows = await fetchAllRows(table);
      if (rows.length === 0) {
        // Still emit an empty CSV so the user sees a result.
        downloadBlob(`${filename || table}.csv`, "");
      } else {
        downloadBlob(`${filename || table}.csv`, toCsv(rows));
      }
      setStatuses(prev => ({ ...prev, [table]: "idle" }));
    } catch (e) {
      setStatuses(prev => ({ ...prev, [table]: "error" }));
      setErrors(prev => ({ ...prev, [table]: e?.message || String(e) }));
    }
  }

  async function handleDownloadAll() {
    for (const section of SECTIONS) {
      for (const item of section.items) {
        // Sequential download with a small delay between files so the browser
        // doesn't merge or block them. Each .click() needs its own tick.
        await handleDownload(item);
        await new Promise(res => setTimeout(res, 250));
      }
    }
  }

  return (
    <div style={{ padding: "32px 40px", overflowY: "auto", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary, letterSpacing: "-0.01em" }}>CRM Settings</div>
          <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 6 }}>
            Download a snapshot of any CRM section as CSV. Files open cleanly in Excel and Google Sheets — UTF-8 with BOM, JSON columns are stringified.
          </div>
        </div>

        {/* Activity log & rollback */}
        <CRMAuditLog />

        {/* Batch import — Private Wire leads */}
        <LeadImport />

        {/* Top toolbar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", marginBottom: 16,
          background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>Data exports</div>
            <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
              {SECTIONS.reduce((s, g) => s + g.items.length, 0)} tables across {SECTIONS.length} groups
            </div>
          </div>
          <button
            onClick={handleDownloadAll}
            style={{
              fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, cursor: "pointer",
              color: "#fff", background: theme.accent, border: `1px solid ${theme.accent}`,
              fontFamily: "inherit",
            }}
            title="Download every section as separate CSV files"
          >
            Download all
          </button>
        </div>

        {/* Section groups */}
        {SECTIONS.map(section => (
          <div key={section.group} style={{
            marginBottom: 20, background: theme.cardBg,
            border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 16px",
              fontSize: 10, fontWeight: 700, color: theme.textTertiary,
              textTransform: "uppercase", letterSpacing: "0.08em",
              borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}`,
              background: theme.surfaceBg || theme.pillBg,
            }}>{section.group}</div>
            <div>
              {section.items.map((item, i) => {
                const c = counts[item.table] || { count: null, loading: true };
                const status = statuses[item.table] || "idle";
                const err = errors[item.table];
                const rowText = c.loading ? "…"
                  : c.error ? "error"
                  : `${(c.count ?? 0).toLocaleString()} rows`;
                return (
                  <div key={item.table} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: i < section.items.length - 1 ? `1px solid ${theme.borderSubtle || theme.cardBorder}` : "none",
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{item.label}</div>
                      <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2, fontFamily: "monospace" }}>{item.table}</div>
                      {err && (
                        <div style={{ fontSize: 10, color: theme.danger || "#EF4444", marginTop: 4 }} title={err}>
                          {err.length > 90 ? err.slice(0, 87) + "…" : err}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: c.error ? (theme.danger || "#EF4444") : theme.textMuted, fontFamily: "monospace", minWidth: 80, textAlign: "right" }}>
                        {rowText}
                      </div>
                      <button
                        onClick={() => handleDownload(item)}
                        disabled={status === "downloading" || c.loading}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: "6px 12px", borderRadius: 6,
                          cursor: status === "downloading" ? "wait" : "pointer",
                          color: status === "downloading" ? theme.textMuted : theme.textSecondary,
                          background: theme.pillBg,
                          border: `1px solid ${theme.pillBorder || theme.cardBorder}`,
                          fontFamily: "inherit",
                          opacity: c.loading ? 0.5 : 1,
                          minWidth: 92,
                        }}
                      >
                        {status === "downloading" ? "Exporting…" : "↓ CSV"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 24, padding: "12px 16px", fontSize: 11, color: theme.textTertiary, lineHeight: 1.5 }}>
          Tables with more than 5,000 rows are paged through under the hood. Very large exports (e.g. <span style={{ fontFamily: "monospace" }}>sequence_tasks</span>) can take ~10–20 seconds and produce multi-MB files.
        </div>
      </div>
    </div>
  );
}
