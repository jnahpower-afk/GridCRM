import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";

// ─── PW PROCESS STAGES DEFINITION ────────────────────────────────────────────
// Task types:
//   "check"  → checkbox
//   "text"   → text input
//   "link"   → URL input
//
// These are placeholder stages/tasks. The actual tasks will be configured
// once the page is live. Add / edit tasks here to build out the process.

export const PW_STAGES = [
  // ── 1. Proposal ───────────────────────────────────────────────────────────
  {
    id: "stage_proposal",
    title: "Proposal",
    color: "#FC6A0A",
    tasks: [
      { id: "prop_measure_lcoe", type: "check", label: "Complete site sizing, LCOE model and proposal document" },
      { id: "prop_book_meeting", type: "check", label: "Schedule client presentation" },
      { id: "prop_negotiate_survey", type: "check", label: "Negotiate commercial terms and progress to survey" },
      { id: "prop_archdesk", type: "check", label: "Initiate project handover to Archdesk" },
    ],
  },

  // ── 2. Negotiation ────────────────────────────────────────────────────────
  {
    id: "stage_negotiation",
    title: "Negotiation",
    color: "#15803D",
    tasks: [
      { id: "neg_commercial", type: "check", label: "Commercial terms agreed" },
      { id: "neg_legal", type: "check", label: "Legal / heads of terms review" },
      { id: "neg_price", type: "text", label: "Agreed tariff / price" },
      { id: "neg_contract", type: "link", label: "Contract / HoT document link" },
      { id: "neg_notes", type: "text", label: "Negotiation notes" },
    ],
  },

  // ── 3. Won ────────────────────────────────────────────────────────────────
  {
    id: "stage_won",
    title: "Won",
    color: "#4ADE80",
    tasks: [
      { id: "won_signed", type: "check", label: "Contract signed" },
      { id: "won_date", type: "text", label: "Contract date" },
      { id: "won_value", type: "text", label: "Contract value / capacity (MWp)" },
      { id: "won_handover", type: "check", label: "Handover to delivery team" },
      { id: "won_notes", type: "text", label: "Notes" },
    ],
  },
];

// Count completed tasks in a stage
export function countStageTasks(stage, data) {
  let total = 0, done = 0;
  for (const task of stage.tasks) {
    total++;
    if (task.type === "check" && data[task.id]) done++;
    if ((task.type === "text" || task.type === "link") && data[task.id]?.trim?.()) done++;
  }
  return { total, done };
}

export function countAllTasks(data) {
  let total = 0, done = 0;
  for (const stage of PW_STAGES) {
    const c = countStageTasks(stage, data);
    total += c.total;
    done += c.done;
  }
  return { total, done };
}

// ─── TASK ROW ─────────────────────────────────────────────────────────────────

function TaskRow({ task, data, onChange, theme }) {
  const value = data[task.id];

  if (task.type === "check") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderBottom: `1px solid ${theme.borderSubtle}`,
      }}>
        <div
          onClick={() => onChange(task.id, !value)}
          style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer",
            border: value ? "none" : `2px solid ${theme.textMuted}`,
            background: value ? "#16A34A" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
        >
          {value && (
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <span style={{
          fontSize: 13, color: value ? theme.textMuted : theme.textPrimary,
          textDecoration: value ? "line-through" : "none",
          flex: 1,
        }}>{task.label}</span>
      </div>
    );
  }

  if (task.type === "text") {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "180px 1fr",
        borderBottom: `1px solid ${theme.borderSubtle}`, minHeight: 42, alignItems: "center",
      }}>
        <div style={{ fontSize: 13, color: theme.textSecondary, padding: "8px 16px", fontWeight: 500 }}>{task.label}</div>
        <input
          type="text"
          value={value || ""}
          onChange={e => onChange(task.id, e.target.value)}
          placeholder="—"
          style={{
            background: "transparent", border: "none", outline: "none",
            fontSize: 13, color: theme.textPrimary, padding: "8px 14px",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
          onFocus={e => e.target.style.background = theme.accentBg}
          onBlur={e => e.target.style.background = "transparent"}
        />
      </div>
    );
  }

  if (task.type === "link") {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "180px 1fr auto",
        borderBottom: `1px solid ${theme.borderSubtle}`, minHeight: 42, alignItems: "center",
      }}>
        <div style={{ fontSize: 13, color: theme.textSecondary, padding: "8px 16px", fontWeight: 500 }}>{task.label}</div>
        <input
          type="url"
          value={value || ""}
          onChange={e => onChange(task.id, e.target.value)}
          placeholder="https://..."
          style={{
            background: "transparent", border: "none", outline: "none",
            fontSize: 13, color: theme.accent, padding: "8px 14px",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
          onFocus={e => e.target.style.background = theme.accentBg}
          onBlur={e => e.target.style.background = "transparent"}
        />
        {value && (
          <a href={value} target="_blank" rel="noreferrer" style={{
            marginRight: 12, fontSize: 11, color: theme.accent,
            textDecoration: "none", whiteSpace: "nowrap",
          }}>Open ↗</a>
        )}
      </div>
    );
  }

  return null;
}

// ─── STAGE PANEL ──────────────────────────────────────────────────────────────

function StagePanel({ stage, data, onChange, currentStage, theme }) {
  const [open, setOpen] = useState(true);
  const { total, done } = countStageTasks(stage, data);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isActive = currentStage === stage.id;
  const isComplete = pct === 100;

  return (
    <div style={{
      marginBottom: 16,
      border: `1px solid ${isActive ? stage.color + "66" : theme.border}`,
      borderRadius: 10, overflow: "hidden",
      background: theme.elevatedBg,
      boxShadow: isActive ? `0 0 0 2px ${stage.color}22` : "none",
    }}>
      {/* Stage header */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
          cursor: "pointer", background: isActive ? stage.color + "11" : "transparent",
          userSelect: "none",
        }}
      >
        {/* Stage dot */}
        <div style={{
          width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
          background: isComplete ? "#16A34A" : isActive ? stage.color : theme.textMuted,
          boxShadow: isActive ? `0 0 0 3px ${stage.color}33` : "none",
        }} />

        <span style={{
          fontSize: 14, fontWeight: 700,
          color: isActive ? stage.color : theme.textPrimary, flex: 1,
        }}>{stage.title}</span>

        {/* Progress pill */}
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px",
          borderRadius: 10, background: isComplete ? "#16A34A22" : theme.hoverBg,
          color: isComplete ? "#16A34A" : theme.textMuted,
        }}>
          {done}/{total}
        </span>

        {/* Progress bar */}
        <div style={{ width: 60, height: 4, background: theme.progressTrack, borderRadius: 2 }}>
          <div style={{
            width: `${pct}%`, height: "100%", borderRadius: 2,
            background: isComplete ? "#16A34A" : stage.color,
            transition: "width 0.3s",
          }} />
        </div>

        <span style={{
          fontSize: 12, color: theme.textMuted,
          transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          transition: "transform 0.2s",
          display: "inline-block",
        }}>▼</span>
      </div>

      {/* Tasks */}
      {open && (
        <div style={{ borderTop: `1px solid ${theme.borderSubtle}` }}>
          {stage.tasks.map(task => (
            <TaskRow key={task.id} task={task} data={data} onChange={onChange} theme={theme} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function PrivateWireProcess({ org, session }) {
  const { theme } = useTheme();
  const [data, setData] = useState({});
  const [saveStatus, setSaveStatus] = useState("saved");
  const saveTimer = useRef(null);
  const initialLoad = useRef(false);

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
      setData(rows?.[0]?.data || {});
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

  const handleChange = useCallback((key, value) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  // Determine current active stage from org's pipeline stage
  const stageMap = {
    "Proposal": "stage_proposal",
    "Negotiation": "stage_negotiation",
    "Won": "stage_won",
  };
  const currentStage = stageMap[org?.stage] || "stage_new";

  // Tasks scale linearly from the stage floor to 100%.
  // e.g. Proposal (floor=30): 0 tasks=30%, all tasks=100%, each tick moves the needle.
  const STAGE_FLOOR = { Proposal: 30, Negotiation: 60, Won: 100 };
  const floor = STAGE_FLOOR[org?.stage] || 0;
  const { total, done } = countAllTasks(data);
  const rawPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const pct = Math.round(floor + (rawPct * (100 - floor)) / 100);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 48px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 11, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              PW Process
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary }}>{org?.name}</div>
          </div>

          {/* Overall progress */}
          <div style={{
            background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`,
            borderRadius: 10, padding: "12px 20px", textAlign: "center", minWidth: 140,
          }}>
            <div style={{ fontSize: 10, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Overall Progress</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary }}>{pct}%</div>
            <div style={{ width: "100%", height: 4, background: theme.progressTrack, borderRadius: 2, marginTop: 6 }}>
              <div style={{
                width: `${pct}%`, height: "100%", borderRadius: 2,
                background: pct === 100 ? "#16A34A" : theme.accent, transition: "width 0.3s",
              }} />
            </div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 4 }}>{done} of {total} tasks</div>
          </div>
        </div>

        {/* Save status */}
        <div style={{
          fontSize: 11, marginBottom: 20,
          color: saveStatus === "saved" ? theme.success : saveStatus === "saving" ? theme.warning : theme.error,
          fontWeight: 600,
        }}>
          {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving..." : "Save error"}
        </div>

        {/* Stage panels */}
        {PW_STAGES.map(stage => (
          <StagePanel
            key={stage.id}
            stage={stage}
            data={data}
            onChange={handleChange}
            currentStage={currentStage}
            theme={theme}
          />
        ))}
      </div>
    </div>
  );
}
