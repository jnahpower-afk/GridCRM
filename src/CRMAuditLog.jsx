import { useState, useEffect, useMemo, useCallback } from "react";
import { useTheme } from "./ThemeContext.jsx";
import { supabase } from "./supabase.js";

// ─── Helpers ───────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function minuteBucket(iso) {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  return d.toISOString();
}
function dayKey(iso) {
  return new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD (local)
}
function dayLabel(key) {
  const today = new Date().toLocaleDateString("en-CA");
  const yest = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
  if (key === today) return "Today";
  if (key === yest) return "Yesterday";
  return new Date(key + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function CRMAuditLog() {
  const { theme } = useTheme();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);                  // batch key
  const [busyBatch, setBusyBatch] = useState(null);                // batch key while RPC runs
  const [tableFilter, setTableFilter] = useState("All");

  // Last 7 days only, capped at 1000 rows. The UI is a recent-activity view,
  // not a full archive — for older data go to SQL Editor directly.
  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("crm_audit_changes")
        .select("id, table_schema, table_name, op, row_pk, performed_by, performed_by_email, performed_at, row_before, row_after")
        .gte("performed_at", since)
        .order("performed_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Group by (performed_by, minute_bucket). Bulk inserts in the same minute
  // by the same user collapse into one row so the 507-row incident shows as
  // a single "X did 507 things at 14:52" entry.
  const batches = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (tableFilter !== "All" && r.table_name !== tableFilter) continue;
      const bucket = minuteBucket(r.performed_at);
      const key = `${r.performed_by || "null"}__${bucket}`;
      let b = map.get(key);
      if (!b) {
        b = {
          key,
          bucket,
          performed_by: r.performed_by,
          performed_by_email: r.performed_by_email,
          tables: new Map(),     // table_name -> {ins,upd,del}
          rowsCount: 0,
          changes: [],
        };
        map.set(key, b);
      }
      b.rowsCount += 1;
      const t = b.tables.get(r.table_name) || { ins: 0, upd: 0, del: 0 };
      if (r.op === "INSERT") t.ins++;
      else if (r.op === "UPDATE") t.upd++;
      else if (r.op === "DELETE") t.del++;
      b.tables.set(r.table_name, t);
      b.changes.push(r);
    }
    return [...map.values()].sort((a, b) => b.bucket.localeCompare(a.bucket));
  }, [rows, tableFilter]);

  const tableOptions = useMemo(() => {
    const set = new Set(rows.map(r => r.table_name));
    return ["All", ...[...set].sort()];
  }, [rows]);

  // Group the batches by calendar day so the page collapses to one row per day.
  const days = useMemo(() => {
    const map = new Map();
    for (const b of batches) {
      const key = dayKey(b.bucket);
      let g = map.get(key);
      if (!g) { g = { key, batches: [], rows: 0, anon: false }; map.set(key, g); }
      g.batches.push(b);
      g.rows += b.rowsCount;
      if (!b.performed_by) g.anon = true;   // surfaces ⚠︎ on the day header
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [batches]);

  // All days start collapsed; the user expands what they want to see.
  const [openDays, setOpenDays] = useState(() => new Set());
  function toggleDay(key) {
    setOpenDays(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function downloadRollback(batch) {
    setBusyBatch(batch.key);
    try {
      // RPC window: start of minute → start of next minute
      const start = new Date(batch.bucket);
      const end = new Date(start.getTime() + 60_000);
      const { data, error } = await supabase.rpc("crm_audit_rollback_sql", {
        batch_start: start.toISOString(),
        batch_end:   end.toISOString(),
        performed_by: batch.performed_by,
      });
      if (error) throw error;
      const who = batch.performed_by_email || batch.performed_by || "null-user";
      const ts = batch.bucket.slice(0, 19).replace(/[:T]/g, "-");
      downloadText(`rollback_${ts}_${who}.sql`, data || "-- (no changes in batch)\n");
    } catch (e) {
      alert(`Failed to generate rollback SQL: ${e?.message || e}`);
    } finally {
      setBusyBatch(null);
    }
  }

  return (
    <div style={{
      marginBottom: 20, background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`, borderRadius: 10, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px", borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}`,
        background: theme.surfaceBg || theme.pillBg,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>Activity log &amp; rollback</div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 3, maxWidth: 620, lineHeight: 1.5 }}>
            A record of every change to your CRM data — who added, edited or deleted what. Expand a day to see each change, or hit <b style={{ color: theme.textSecondary }}>Rollback SQL</b> on any batch to download a script that undoes it (you review it in Supabase before it runs). Last 7 days · 90-day retention.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={tableFilter}
            onChange={e => setTableFilter(e.target.value)}
            style={{
              fontSize: 11, padding: "5px 10px", borderRadius: 6,
              border: `1px solid ${theme.cardBorder}`,
              background: theme.pillBg, color: theme.textSecondary,
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {tableOptions.map(t => <option key={t} value={t}>{t === "All" ? "All tables" : t}</option>)}
          </select>
          <button
            onClick={fetchRows}
            disabled={loading}
            style={{
              fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 6,
              cursor: loading ? "wait" : "pointer",
              color: theme.textSecondary, background: theme.pillBg,
              border: `1px solid ${theme.cardBorder}`, fontFamily: "inherit",
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Body */}
      {error && (
        <div style={{ padding: "12px 16px", fontSize: 12, color: theme.danger || "#EF4444" }}>{error}</div>
      )}

      {loading && rows.length === 0 && (
        <div style={{ padding: "16px", fontSize: 12, color: theme.textMuted, textAlign: "center" }}>Loading…</div>
      )}

      {!loading && batches.length === 0 && (
        <div style={{ padding: "20px", fontSize: 12, color: theme.textMuted, textAlign: "center" }}>
          No activity in the last 7 days for the selected filter.
        </div>
      )}

      {days.map(group => {
        const dayOpen = openDays.has(group.key);
        return (
        <div key={group.key}>
          {/* Day header (collapsible) */}
          <div
            onClick={() => toggleDay(group.key)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "9px 16px", cursor: "pointer",
              background: theme.surfaceBg || theme.pillBg,
              borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}`,
              borderTop: `1px solid ${theme.borderSubtle || theme.cardBorder}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: theme.textTertiary, width: 12, textAlign: "center" }}>{dayOpen ? "▾" : "▸"}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>{dayLabel(group.key)}</span>
              {group.anon && (
                <span style={{ fontSize: 10, fontWeight: 700, color: theme.danger || "#EF4444", background: `${theme.danger || "#EF4444"}1A`, padding: "1px 7px", borderRadius: 10 }}>⚠︎ no-user activity</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: theme.textMuted }}>
              {group.batches.length} {group.batches.length === 1 ? "batch" : "batches"} · {group.rows.toLocaleString()} {group.rows === 1 ? "change" : "changes"}
            </div>
          </div>

          {dayOpen && group.batches.map(batch => {
        const isOpen = expanded === batch.key;
        const tableSummary = [...batch.tables.entries()].map(([name, t]) => {
          const parts = [];
          if (t.ins) parts.push(`${t.ins} ins`);
          if (t.upd) parts.push(`${t.upd} upd`);
          if (t.del) parts.push(`${t.del} del`);
          return `${name} (${parts.join(", ")})`;
        }).join("  ·  ");
        const who = batch.performed_by_email
          || (batch.performed_by ? batch.performed_by.slice(0, 8) + "…" : "—");
        const isAnonymous = !batch.performed_by;
        return (
          <div key={batch.key} style={{
            borderBottom: `1px solid ${theme.borderSubtle || theme.cardBorder}`,
          }}>
            {/* Batch summary row */}
            <div
              onClick={() => setExpanded(isOpen ? null : batch.key)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 16px", cursor: "pointer",
                background: isOpen ? (theme.pillBg) : "transparent",
              }}
            >
              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 10, color: theme.textTertiary, width: 18, textAlign: "center" }}>{isOpen ? "▾" : "▸"}</span>
                <div style={{ minWidth: 130, fontFamily: "monospace", fontSize: 11, color: theme.textSecondary }}>{fmtDateTime(batch.bucket)}</div>
                <div style={{
                  minWidth: 150, fontSize: 11, fontWeight: 600,
                  color: isAnonymous ? (theme.danger || "#EF4444") : theme.textPrimary,
                }}>
                  {isAnonymous ? "⚠︎ no user" : who}
                </div>
                <div style={{ flex: 1, fontSize: 11, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tableSummary}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                  color: batch.rowsCount > 100 ? (theme.danger || "#EF4444") : theme.textPrimary,
                  minWidth: 40, textAlign: "right",
                }}>{batch.rowsCount.toLocaleString()}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadRollback(batch); }}
                  disabled={busyBatch === batch.key}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6,
                    cursor: busyBatch === batch.key ? "wait" : "pointer",
                    color: theme.textSecondary, background: theme.pillBg,
                    border: `1px solid ${theme.cardBorder}`, fontFamily: "inherit",
                    minWidth: 130,
                  }}
                  title="Generate a SQL script that reverses every change in this batch. Review before running in SQL Editor."
                >{busyBatch === batch.key ? "Generating…" : "↓ Rollback SQL"}</button>
              </div>
            </div>

            {/* Expanded row details */}
            {isOpen && (
              <div style={{ padding: "8px 16px 14px 48px", background: theme.cardBg }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      <th style={{ padding: "4px 6px", fontWeight: 700, fontSize: 9, textAlign: "left" }}>Time</th>
                      <th style={{ padding: "4px 6px", fontWeight: 700, fontSize: 9, textAlign: "left" }}>Op</th>
                      <th style={{ padding: "4px 6px", fontWeight: 700, fontSize: 9, textAlign: "left" }}>Table</th>
                      <th style={{ padding: "4px 6px", fontWeight: 700, fontSize: 9, textAlign: "left" }}>Row id</th>
                      <th style={{ padding: "4px 6px", fontWeight: 700, fontSize: 9, textAlign: "left" }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.changes.slice(0, 30).map(c => {
                      const opColour = c.op === "INSERT" ? "#22c55e" : c.op === "DELETE" ? "#EF4444" : "#F59E0B";
                      const rid = (c.row_pk?.id || "").slice(0, 8);
                      // Brief change summary: show the lead name / org name / notes / etc.
                      const after = c.row_after || c.row_before || {};
                      const detail = after.name || after.notes || after.email || rid;
                      return (
                        <tr key={c.id} style={{ borderTop: `1px solid ${theme.borderSubtle}` }}>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace", color: theme.textMuted }}>{fmtTime(c.performed_at).slice(-8)}</td>
                          <td style={{ padding: "4px 6px" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: opColour, background: `${opColour}1A`, padding: "1px 6px", borderRadius: 4 }}>{c.op}</span>
                          </td>
                          <td style={{ padding: "4px 6px", color: theme.textSecondary }}>{c.table_name}</td>
                          <td style={{ padding: "4px 6px", fontFamily: "monospace", color: theme.textMuted }}>{rid}</td>
                          <td style={{ padding: "4px 6px", color: theme.textSecondary, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380, whiteSpace: "nowrap" }} title={typeof detail === "string" ? detail : ""}>{typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 60)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {batch.changes.length > 30 && (
                  <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 6, fontStyle: "italic" }}>
                    Showing first 30 of {batch.changes.length} changes — the rollback SQL covers all of them.
                  </div>
                )}
              </div>
            )}
          </div>
        );
          })}
        </div>
        );
      })}

      {/* Helper footer */}
      <div style={{ padding: "10px 16px", fontSize: 10, color: theme.textTertiary, lineHeight: 1.5, background: theme.cardBg }}>
        Rollback SQL is generated, not auto-applied — review it in Supabase SQL Editor, then run inside the existing <code style={{ fontFamily: "monospace" }}>BEGIN; … COMMIT;</code> block. FK and downstream-update conflicts will fail loudly inside the transaction so nothing is half-applied.
      </div>
    </div>
  );
}
