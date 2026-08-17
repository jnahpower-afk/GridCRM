import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";
import EnergyLoader from "./EnergyLoader.jsx";
import { FM_VERSION_LABELS } from "./AcquisitionProcess.jsx";

// ─── Fields we surface in the diff (label → input key) ───────────────────────
const TRACKED_FIELDS = [
  // Project
  { label: "Project Name",          key: "projectName",           fmt: v => v },
  { label: "Capacity (MWp)",        key: "capacity",              fmt: v => `${v} MWp` },
  { label: "Export Capacity (MWe)", key: "exportCapacity",        fmt: v => `${v} MWe` },
  { label: "Annual Yield",          key: "yield_",                fmt: v => `${v} kWh/kWp` },
  { label: "COD",                   key: "cod",                   fmt: v => v?.slice(0,10) },
  { label: "Asset Life",            key: "assetLife",             fmt: v => `${v} years` },
  { label: "Construction Months",   key: "constructionMonths",    fmt: v => `${v} months` },
  { label: "Availability",          key: "availability",          fmt: v => `${v}%` },
  { label: "Degradation",           key: "degradation",           fmt: v => `${v}%/yr` },
  // Revenue
  { label: "CfD Strike",            key: "cfdStrike",             fmt: v => `£${v}/MWh` },
  { label: "CfD Term",              key: "cfdTerm",               fmt: v => `${v} years` },
  { label: "CfD Allocation",        key: "cfdAllocPct",           fmt: v => `${v}%` },
  { label: "CfD Start",             key: "cfdStart",              fmt: v => v?.slice(0,10) },
  { label: "CfD Active",            key: "cfdActive",             fmt: v => v ? "Yes" : "No" },
  { label: "PPA Active",            key: "ppaActive",             fmt: v => v ? "Yes" : "No" },
  { label: "PPA Price",             key: "ppaPrice",              fmt: v => `£${v}/MWh` },
  { label: "PPA Term",              key: "ppaTerm",               fmt: v => `${v} years` },
  { label: "Merchant Active",       key: "merchantActive",        fmt: v => v ? "Yes" : "No" },
  { label: "Merchant Scenario",     key: "merchantScenario",      fmt: v => v },
  { label: "REGO Active",           key: "regoActive",            fmt: v => v ? "Yes" : "No" },
  { label: "REGO Scenario",         key: "regoScenario",          fmt: v => v },
  { label: "CPI",                   key: "cpi",                   fmt: v => `${v}%` },
  // Debt
  { label: "Debt Active",           key: "debtActive",            fmt: v => v ? "Yes" : "No" },
  { label: "Gearing",               key: "gearing",               fmt: v => `${v}%` },
  { label: "Construction Interest", key: "interestCon",           fmt: v => `${v}%` },
  { label: "Ops Interest",          key: "interestOps",           fmt: v => `${v}%` },
  { label: "Debt Tenor",            key: "debtTenor",             fmt: v => `${v} years` },
  { label: "Arrangement Fee",       key: "arrangementFee",        fmt: v => `${v}%` },
  { label: "DSRA Months",           key: "dsraMonths",            fmt: v => `${v} months` },
  // Tax
  { label: "Corporation Tax",       key: "corpTax",               fmt: v => `${v}%` },
  { label: "Discount Rate",         key: "discountRate",          fmt: v => `${v}%` },
  // CapEx
  { label: "Acquisition Cost",      key: "acquisition",           fmt: v => `£${Number(v).toLocaleString()}` },
  { label: "DD Costs",              key: "ddCosts",               fmt: v => `£${Number(v).toLocaleString()}` },
  { label: "EPC Modules",           key: "epcModules",            fmt: v => `£${Number(v).toLocaleString()}` },
  { label: "EPC Inverters",         key: "epcInverters",          fmt: v => `£${Number(v).toLocaleString()}` },
  { label: "Grid Contestable",      key: "gridContestable",       fmt: v => `£${Number(v).toLocaleString()}` },
  { label: "Grid Non-Contestable",  key: "gridNonContestable",    fmt: v => `£${Number(v).toLocaleString()}` },
  // OpEx
  { label: "Land Rent 1",           key: "opexRent1",             fmt: v => `£${Number(v).toLocaleString()}/yr` },
  { label: "Land Rent 2",           key: "opexRent2",             fmt: v => `£${Number(v).toLocaleString()}/yr` },
  { label: "O&M",                   key: "opexMaintenance",       fmt: v => `£${Number(v).toLocaleString()}/yr` },
  { label: "Insurance",             key: "opexInsurance",         fmt: v => `£${Number(v).toLocaleString()}/yr` },
  { label: "Asset Management",      key: "opexAssetMgmt",         fmt: v => `£${Number(v).toLocaleString()}/yr` },
];

function diffSnapshots(prev, curr) {
  const changes = [];
  for (const field of TRACKED_FIELDS) {
    const oldVal = prev?.[field.key];
    const newVal = curr?.[field.key];
    // Compare as strings to handle type coercion
    if (String(oldVal) !== String(newVal)) {
      changes.push({
        label: field.label,
        oldFormatted: oldVal != null ? field.fmt(oldVal) : "—",
        newFormatted: newVal != null ? field.fmt(newVal) : "—",
      });
    }
  }
  return changes;
}

function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  if (days < 7)  return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function absoluteTime(isoString) {
  return new Date(isoString).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function InputChangeLog({ project, fmVersion }) {
  const { theme } = useTheme();
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [versionFilter, setVersionFilter] = useState("all");

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("project_inputs_log")
        .select("id, fm_version, saved_by, saved_at, inputs")
        .eq("project_id", project.id)
        .order("saved_at", { ascending: false })
        .limit(200);
      setEntries(data || []);
      setLoading(false);
    })();
  }, [project?.id]);

  // Load user display names
  useEffect(() => {
    if (!entries.length) return;
    const userIds = [...new Set(entries.map(e => e.saved_by).filter(Boolean))];
    if (!userIds.length) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      if (data) {
        const map = {};
        data.forEach(u => { map[u.id] = u.full_name || u.email || u.id.slice(0, 8); });
        setUsers(map);
      }
    })();
  }, [entries]);

  const filtered = useMemo(() => {
    if (versionFilter === "all") return entries;
    return entries.filter(e => e.fm_version === Number(versionFilter));
  }, [entries, versionFilter]);

  // Compute diffs: compare each entry against the one directly before it (same fm_version)
  const entriesWithDiff = useMemo(() => {
    // Group by fm_version, sorted ascending (oldest first) for diff calculation
    const byVersion = {};
    [...entries].reverse().forEach(e => {
      if (!byVersion[e.fm_version]) byVersion[e.fm_version] = [];
      byVersion[e.fm_version].push(e);
    });

    const diffMap = {};
    Object.values(byVersion).forEach(group => {
      group.forEach((entry, idx) => {
        const prev = idx > 0 ? group[idx - 1] : null;
        diffMap[entry.id] = diffSnapshots(prev?.inputs, entry.inputs);
      });
    });
    return diffMap;
  }, [entries]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EnergyLoader />
      </div>
    );
  }

  const FM_VERSIONS = [1, 2, 3];

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        marginBottom: 20, gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>
            Input Change Log
          </div>
          <div style={{ fontSize: 11, color: theme.textTertiary }}>
            Every time inputs are saved, a snapshot is recorded. Click any entry to see what changed.
          </div>
        </div>

        {/* Version filter */}
        <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`,
          borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 }}>
          <button
            onClick={() => setVersionFilter("all")}
            style={{
              fontSize: 10, fontWeight: versionFilter === "all" ? 700 : 500,
              color: versionFilter === "all" ? theme.pillActiveText : theme.pillInactiveText,
              background: versionFilter === "all" ? theme.pillActiveBg : "transparent",
              border: versionFilter === "all" ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
              borderRadius: 6, padding: "4px 12px", cursor: "pointer",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >All</button>
          {FM_VERSIONS.map(v => (
            <button key={v}
              onClick={() => setVersionFilter(String(v))}
              style={{
                fontSize: 10, fontWeight: versionFilter === String(v) ? 700 : 500,
                color: versionFilter === String(v) ? theme.pillActiveText : theme.pillInactiveText,
                background: versionFilter === String(v) ? theme.pillActiveBg : "transparent",
                border: versionFilter === String(v) ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
                borderRadius: 6, padding: "4px 12px", cursor: "pointer",
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >{FM_VERSION_LABELS[v]}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: theme.textTertiary, fontSize: 13, textAlign: "center", marginTop: 60 }}>
          No changes recorded yet. Changes are logged automatically as you edit the financial model.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((entry, idx) => {
            const diffs = entriesWithDiff[entry.id] || [];
            const isExpanded = expandedId === entry.id;
            const userName = users[entry.saved_by] || "Unknown";
            const vLabel = FM_VERSION_LABELS[entry.fm_version] || `v${entry.fm_version}`;
            const isFirst = idx === filtered.length - 1 ||
              filtered[idx + 1]?.fm_version !== entry.fm_version;

            return (
              <div
                key={entry.id}
                style={{
                  background: theme.pillBg,
                  border: `1px solid ${isExpanded ? theme.accent + "66" : theme.border}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  transition: "border-color 0.15s",
                }}
              >
                {/* Row header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 16px", cursor: "pointer",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.hoverBg}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {/* FM version badge */}
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 7px",
                    borderRadius: 4, background: theme.accent + "22",
                    color: theme.accent, letterSpacing: "0.05em",
                    flexShrink: 0,
                  }}>{vLabel}</span>

                  {/* Change count */}
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: diffs.length > 0 ? theme.textPrimary : theme.textTertiary,
                    flex: 1,
                  }}>
                    {isFirst
                      ? "Initial snapshot"
                      : diffs.length === 0
                        ? "No tracked fields changed"
                        : `${diffs.length} field${diffs.length !== 1 ? "s" : ""} changed`}
                  </span>

                  {/* User + time */}
                  <span style={{ fontSize: 10, color: theme.textTertiary, flexShrink: 0 }}>
                    {userName}
                  </span>
                  <span
                    title={absoluteTime(entry.saved_at)}
                    style={{ fontSize: 10, color: theme.textMuted, flexShrink: 0, minWidth: 60, textAlign: "right" }}
                  >
                    {relativeTime(entry.saved_at)}
                  </span>

                  {/* Chevron */}
                  <span style={{
                    fontSize: 10, color: theme.textMuted, flexShrink: 0,
                    transform: isExpanded ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s",
                  }}>▾</span>
                </div>

                {/* Expanded diff */}
                {isExpanded && (
                  <div style={{
                    borderTop: `1px solid ${theme.border}`,
                    padding: "12px 16px",
                  }}>
                    {isFirst ? (
                      <div style={{ fontSize: 11, color: theme.textTertiary }}>
                        This is the first recorded snapshot for {vLabel}. No previous state to compare against.
                      </div>
                    ) : diffs.length === 0 ? (
                      <div style={{ fontSize: 11, color: theme.textTertiary }}>
                        No changes to tracked fields since the previous snapshot.
                      </div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 10,
                              color: theme.textTertiary, fontWeight: 600, width: "30%",
                              textTransform: "uppercase", letterSpacing: "0.06em" }}>Field</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 10,
                              color: theme.textTertiary, fontWeight: 600, width: "35%",
                              textTransform: "uppercase", letterSpacing: "0.06em" }}>Before</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 10,
                              color: theme.textTertiary, fontWeight: 600, width: "35%",
                              textTransform: "uppercase", letterSpacing: "0.06em" }}>After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diffs.map((d, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : theme.surfaceBg + "60" }}>
                              <td style={{ padding: "5px 8px", color: theme.textSecondary, fontWeight: 500 }}>
                                {d.label}
                              </td>
                              <td style={{ padding: "5px 8px", color: theme.error, fontFamily: "monospace" }}>
                                {d.oldFormatted}
                              </td>
                              <td style={{ padding: "5px 8px", color: theme.success, fontFamily: "monospace" }}>
                                {d.newFormatted}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Timestamp detail */}
                    <div style={{ marginTop: 10, fontSize: 10, color: theme.textMuted }}>
                      Saved {absoluteTime(entry.saved_at)} by {userName}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
