import { useState, useCallback } from "react";
import FuseLogo from "./FuseLogo.jsx";
import { useTheme } from "./ThemeContext.jsx";
import PrivateWireProjectOverview from "./PrivateWireProjectOverview.jsx";
import PrivateWireProcess from "./PrivateWireProcess.jsx";

const MAIN_TABS = [
  ["overview", "Project Overview"],
  ["process", "PW Process"],
];

// org shape: { name, stage, sector, location, owner, est_load_mw }
export default function PrivateWireProjectView({ org, session, onBack }) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState("overview");

  const handleNavigate = useCallback((tab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif",
      position: "fixed", inset: 0, zIndex: 100,
    }}>
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 20px", borderBottom: `1px solid ${theme.border}`,
        background: theme.pageBg, flexShrink: 0,
      }}>
        {/* Back button */}
        <div
          onClick={onBack}
          title="Back to Leads"
          style={{
            width: 34, height: 34, borderRadius: 8, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, color: theme.textTertiary,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >←</div>

        {/* Fuse logo */}
        <FuseLogo size={32} />

        {/* Org name */}
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>
          {org?.name || "Organisation"}
        </div>

        {/* Stage badge */}
        {org?.stage && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
            background: theme.hoverBg, color: theme.textSecondary,
            border: `1px solid ${theme.border}`,
          }}>{org.stage}</span>
        )}

        {/* Tab toggle */}
        <div style={{
          display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`,
          borderRadius: 8, padding: 3, gap: 2, marginLeft: 8,
        }}>
          {MAIN_TABS.map(([key, label]) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 500,
                  color: isActive ? theme.pillActiveText : theme.pillInactiveText,
                  background: isActive ? theme.pillActiveBg : "transparent",
                  border: isActive ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
                  borderRadius: 6, padding: "4px 14px", cursor: "pointer",
                  boxShadow: isActive ? theme.shadowSm : "none",
                  transition: "all 0.1s", whiteSpace: "nowrap",
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >{label}</button>
            );
          })}
        </div>

        {/* Sector + owner metadata */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          {org?.sector && (
            <span style={{ fontSize: 11, color: theme.textTertiary }}>{org.sector}</span>
          )}
          {org?.owner && (
            <span style={{ fontSize: 11, color: theme.textTertiary }}>Owner: <strong style={{ color: theme.textSecondary }}>{org.owner}</strong></span>
          )}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activeTab === "overview" && (
          <PrivateWireProjectOverview org={org} session={session} onNavigate={handleNavigate} />
        )}
        {activeTab === "process" && (
          <PrivateWireProcess org={org} session={session} />
        )}
      </div>
    </div>
  );
}
