import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { useTheme } from "./ThemeContext.jsx";

// ─── ACQUISITION STAGES DEFINITION ──────────────────────────────────────────
// Task types:
//   "check"        → checkbox
//   "text"         → text input
//   "link"         → URL input (Google Drive link etc.)
//   "group"        → nested children
//   "doc_versions" → document version tracker with Drive links per version
//   "fm_action"    → Financial Model create/open button (version: 1=NBO, 2=FABO, 3=FID)
//   "gate"         → Go / No-go decision point (renders as a special toggle)
//
// Stage-level flags:
//   isGate: true   → renders as a decision diamond instead of a normal dot
//   approvers: []  → array of names shown as approval badges

export const STAGES = [
  // ── 1. Origination ────────────────────────────────────────────────────────
  {
    id: "origination",
    title: "Origination",
    timeline: "1 week",
    tasks: [
      { id: "log_linear", type: "check", label: "Log details (Linear)" },
      { id: "log_notion", type: "check", label: "Log details of target (Notion page)" },
      { id: "counterparty_timeline", type: "text", label: "Counterparty expectations on timeline", required: true },
      { id: "counterparty_price", type: "text", label: "Counterparty expectations on price" },
      { id: "nda_creation", type: "check", label: "NDA creation → Legal sign off" },
      { id: "notion_page", type: "check", label: "Notion page creation" },
      { id: "im_received", type: "link", label: "IM received (Google Drive Link) / Dataroom access (URL)" },
      { id: "dd_lead_check", type: "check", label: "Check with DD Lead → Move to Prelim DD" },
    ],
  },

  // ── 2. Preliminary DD ─────────────────────────────────────────────────────
  {
    id: "prelim_dd",
    title: "Prelim DD",
    timeline: "1 day",
    tasks: [
      { id: "benchmark_log", type: "check", label: "Benchmark project characteristics — log info (tech, location, POC) on Linear / Notion" },
      { id: "checklist_template", type: "check", label: "Checklist Template (pre-requisites confirmed with Andrew / Charles)" },
      {
        id: "qa_doc", type: "doc_versions", label: "Q/A Document",
        versions: [
          { version: "V0", id: "qa_v0_link", label: "Q/A V0 — creation and issue to client" },
        ],
      },
      { id: "fm_nbo", type: "fm_action", label: "NBO Financial Model", fmVersion: 1 },
    ],
  },

  // ── 3. NBO Meeting — GATE ─────────────────────────────────────────────────
  {
    id: "nbo_meeting",
    title: "NBO Meeting",
    timeline: "",
    isGate: true,
    approvers: ["Laurie"],
    tasks: [
      { id: "nbo_gate", type: "gate", label: "Go / No-go decision" },
      { id: "nbo_approval", type: "check", label: "Laurie approval to submit NBO" },
      { id: "nbo_submitted", type: "check", label: "NBO submitted" },
      { id: "nbo_notes", type: "text", label: "Meeting notes" },
    ],
  },

  // ── 4. NBO Evaluation ─────────────────────────────────────────────────────
  {
    id: "nbo_evaluation",
    title: "NBO Evaluation",
    timeline: "Counterparty managed",
    tasks: [
      {
        id: "qa_doc_v1", type: "doc_versions", label: "Q/A Document",
        versions: [
          { version: "V1", id: "qa_v1_link", label: "Q/A V1 — add / close open points" },
        ],
      },
      { id: "internal_closeout", type: "check", label: "Internal open points close out (2 days)" },
      { id: "checklist_kim", type: "check", label: "Update Checklist and internal Key Issues Matrix (KIM)" },
      { id: "gauge_interest", type: "check", label: "Gauge counterparty interest and push for exclusivity" },
      {
        id: "if_positive", type: "group", label: "If positive sentiment:",
        children: [
          { id: "approach_advisors", type: "check", label: "Approach advisors / do internally (align with Triple Point expectations)" },
          { id: "vdr_index", type: "check", label: "Ask for VDR index (issue to advisors to mature quotes)" },
          { id: "vdr_request", type: "check", label: "Issue VDR request and RFQ from advisors / ELs" },
        ],
      },
      {
        id: "if_negative", type: "group", label: "If negative sentiment:",
        children: [
          { id: "reassess_position", type: "check", label: "Reassess position and pricing" },
          { id: "decision_continue", type: "check", label: "Decision: continue pursuit or withdraw" },
        ],
      },
    ],
  },

  // ── 5. FABO Meeting — GATE ────────────────────────────────────────────────
  {
    id: "fabo_meeting",
    title: "FABO Meeting",
    timeline: "1 week",
    isGate: true,
    approvers: ["Andrew", "Charles", "Manuel"],
    tasks: [
      { id: "fabo_gate", type: "gate", label: "Go / No-go decision" },
      { id: "fm_fabo", type: "fm_action", label: "FABO Financial Model", fmVersion: 2 },
      { id: "fabo_signoff", type: "check", label: "Manuel sign off (Andrew / Charles review)" },
      { id: "fabo_notes", type: "text", label: "Meeting notes" },
    ],
  },

  // ── 6. ADD Process (Advanced DD) ──────────────────────────────────────────
  {
    id: "add_process",
    title: "ADD Process",
    timeline: "Multi-week",
    tasks: [
      { id: "exclusivity_agreement", type: "check", label: "Exclusivity Agreement (1–2 weeks)" },
      {
        id: "doc_request", type: "group", label: "Document request list (in parallel):",
        children: [
          { id: "send_tech_docs", type: "check", label: "Send Technical doc request list" },
          { id: "send_commercial_docs", type: "check", label: "Send Commercial doc request list" },
          { id: "send_legal_docs", type: "check", label: "Send Legal doc request list" },
        ],
      },
      { id: "get_vdr", type: "check", label: "Get on VDR (full data room — Grid CRM)" },
      { id: "draft_spa", type: "check", label: "Grid CRM to provide our draft SPA agreement" },
      {
        id: "gridcrm_dd", type: "group", label: "Grid CRM internal DD (DD Checklist) — 1–2 days:",
        children: [
          { id: "produce_layout", type: "check", label: "Produce Layout (1 day) — EPC" },
          { id: "produce_yield", type: "check", label: "Produce Yield Report (1 day) — EPC" },
        ],
      },
      {
        id: "sign_advisors", type: "group", label: "Sign Advisors (4 days — Andy can sign up to £50k):",
        children: [
          { id: "legal_review_advisors", type: "check", label: "Legal / Financial review of Advisor contracts" },
          { id: "approval_benchmarking", type: "check", label: "Approval process + benchmarking" },
          { id: "contract_advisors", type: "check", label: "Contract advisors — Legal / Technical / Financial" },
        ],
      },
      { id: "vdr_access_advisors", type: "check", label: "VDR access for advisors (1 day)" },
      {
        id: "dd_execution", type: "group", label: "DD execution (3 weeks, all in parallel):",
        children: [
          { id: "dd_tax", type: "check", label: "Tax DD" },
          { id: "dd_legal", type: "check", label: "Legal DD" },
          { id: "dd_technical", type: "check", label: "Technical DD" },
        ],
      },
      {
        id: "qa_doc_v2", type: "doc_versions", label: "Q/A Document",
        versions: [
          { version: "V2", id: "qa_v2_link", label: "Q/A V2 — final questions from DD" },
        ],
      },
      {
        id: "risk_matrix_doc", type: "doc_versions", label: "Risk Matrix",
        versions: [
          { version: "V0", id: "risk_v0_link", label: "Risk Matrix V0 — master creation" },
          { version: "V1", id: "risk_v1_link", label: "Risk Matrix V1 — after feedback (1 week)" },
          { version: "V2", id: "risk_v2_link", label: "Risk Matrix V2 — final after second round DD" },
        ],
      },
      { id: "wait_counterparty", type: "text", label: "Wait for counterparty (1–4 weeks) — notes / DNO info" },
      { id: "close_flags", type: "check", label: "Close out open flags (approx 2 weeks)" },
      { id: "fm_fid", type: "fm_action", label: "FID Financial Model", fmVersion: 3 },
    ],
  },

  // ── 7. Bid Adjustment Meeting — GATE ──────────────────────────────────────
  {
    id: "bid_adjustment",
    title: "Bid Adjustment Meeting",
    timeline: "",
    isGate: true,
    approvers: ["Andrew", "Charles", "Manuel"],
    tasks: [
      { id: "bid_gate", type: "gate", label: "Go / No-go decision" },
      { id: "bid_signoff", type: "check", label: "Manuel sign off (Andrew / Charles review)" },
      { id: "bid_notes", type: "text", label: "Meeting notes / adjustment rationale" },
    ],
  },

  // ── 8. SPA / APA ──────────────────────────────────────────────────────────
  {
    id: "spa_apa",
    title: "SPA / APA",
    timeline: "1 month (parallel with bid adjustment)",
    tasks: [
      { id: "agree_conditions", type: "check", label: "Agree conditions of SPA / APA prior to drafting (to save on cost)" },
      { id: "inhouse_or_advisor", type: "text", label: "In-house or via legal advisor?" },
      {
        id: "spa_doc", type: "doc_versions", label: "SPA Document",
        versions: [
          { version: "V1", id: "spa_v1_link", label: "SPA V1 — initial draft" },
        ],
      },
    ],
  },

  // ── 9. Negotiation ────────────────────────────────────────────────────────
  {
    id: "negotiation",
    title: "Negotiation",
    timeline: "1 month max",
    tasks: [
      { id: "transaction_docs", type: "check", label: "Transaction documents prepared" },
      { id: "negotiation_legal", type: "check", label: "Negotiation — legal" },
      { id: "negotiation_technical", type: "check", label: "Negotiation — technical" },
      { id: "negotiation_valuation", type: "check", label: "Negotiation — valuation (sliding scale)" },
      { id: "direct_counterparty", type: "check", label: "Ensure negotiation direct with counterparty (not through agent)" },
      { id: "align_commercials", type: "check", label: "Align on commercials prior to sending SPA" },
      {
        id: "spa_doc_v2", type: "doc_versions", label: "SPA Document",
        versions: [
          { version: "V2", id: "spa_v2_link", label: "SPA V2 — final negotiated version" },
        ],
      },
    ],
  },

  // ── 10. Sign SPA — GATE ───────────────────────────────────────────────────
  {
    id: "sign_spa",
    title: "Sign SPA",
    timeline: "",
    isGate: true,
    approvers: ["Andy"],
    tasks: [
      { id: "sign_gate", type: "gate", label: "Final approval to sign" },
      { id: "spa_signed", type: "check", label: "SPA signed" },
      { id: "sign_date", type: "text", label: "Sign date" },
      { id: "sign_notes", type: "text", label: "Notes" },
    ],
  },

  // ── 11. Handover ──────────────────────────────────────────────────────────
  {
    id: "handover",
    title: "Handover to EPC for Construction Design",
    timeline: "",
    tasks: [
      { id: "create_im_pack", type: "check", label: "Create IM pack" },
      { id: "employers_requirements", type: "check", label: "Employers Requirements" },
      { id: "epc_contract", type: "check", label: "EPC Contract" },
      { id: "project_finance", type: "check", label: "Project Finance" },
    ],
  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getAllTaskIds(tasks) {
  const ids = [];
  for (const t of tasks) {
    if (t.type === "group") {
      for (const c of t.children) ids.push(c.id);
    } else if (t.type === "doc_versions") {
      for (const v of t.versions) ids.push(v.id);
    } else {
      ids.push(t.id);
    }
  }
  return ids;
}

// FM version labels
export const FM_VERSION_LABELS = { 1: "NBO FM", 2: "FABO FM", 3: "FID FM" };

export function countCompleted(tasks, data, fmVersionDates) {
  let total = 0, done = 0;
  for (const t of tasks) {
    if (t.type === "group") {
      for (const c of t.children) {
        total++;
        if (c.type === "check" && data[c.id]) done++;
        if ((c.type === "text" || c.type === "link") && data[c.id]?.trim()) done++;
      }
    } else if (t.type === "doc_versions") {
      for (const v of t.versions) {
        total++;
        if (data[v.id]?.trim()) done++;
      }
    } else if (t.type === "fm_action") {
      total++;
      // fm_action counts as done when the FM version has been created
      if (fmVersionDates && fmVersionDates[t.fmVersion]) done++;
    } else if (t.type === "gate") {
      total++;
      if (data[t.id] === "go") done++;
    } else {
      total++;
      if (t.type === "check" && data[t.id]) done++;
      if ((t.type === "text" || t.type === "link") && data[t.id]?.trim()) done++;
    }
  }
  return { total, done };
}

function isStageComplete(stage, data, fmVersionDates) {
  const { total, done } = countCompleted(stage.tasks, data, fmVersionDates);
  return total > 0 && done === total;
}

// Check if a gate stage was declined (No-go)
export function isGateDeclined(stage, data) {
  if (!stage.isGate) return false;
  const gateTask = stage.tasks.find(t => t.type === "gate");
  return gateTask && data[gateTask.id] === "nogo";
}

// Get the current active stage name for metrics display
export function getCurrentStageName(data, fmVersionDates) {
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];
    if (isGateDeclined(stage, data)) {
      return `${stage.title} — No-go`;
    }
    const { total, done } = countCompleted(stage.tasks, data, fmVersionDates);
    if (done < total || done === 0) {
      return stage.title;
    }
  }
  return "Complete";
}

// ─── TASK INPUT COMPONENTS ───────────────────────────────────────────────────

function CheckTask({ id, label, checked, onChange, required }) {
  const { theme } = useTheme();
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0",
      borderBottom: `1px solid ${theme.borderSubtle}`,
    }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(id, e.target.checked)}
        style={{ marginTop: 2, accentColor: theme.checkboxAccent, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
      />
      <label style={{
        fontSize: 13, color: checked ? theme.textTertiary : theme.textPrimary,
        textDecoration: checked ? "line-through" : "none",
        cursor: "pointer", lineHeight: 1.5, flex: 1,
      }} onClick={() => onChange(id, !checked)}>
        {label}
        {required && <span style={{ color: theme.accent, marginLeft: 4, fontSize: 11 }}>*</span>}
      </label>
    </div>
  );
}

function TextTask({ id, label, value, onChange, required }) {
  const { theme } = useTheme();
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ fontSize: 13, color: theme.textPrimary, fontWeight: 500, marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: theme.accent, marginLeft: 4, fontSize: 11 }}>*</span>}
      </div>
      <input
        type="text"
        value={value || ""}
        onChange={e => onChange(id, e.target.value)}
        placeholder="Enter details..."
        style={{
          width: "100%", background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`,
          borderRadius: 6, padding: "8px 12px", fontSize: 13, color: theme.textPrimary,
          fontFamily: "'Inter', system-ui, sans-serif", outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={e => e.target.style.borderColor = theme.accent}
        onBlur={e => e.target.style.borderColor = theme.borderSubtle}
      />
    </div>
  );
}

function LinkTask({ id, label, value, onChange }) {
  const { theme } = useTheme();
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ fontSize: 13, color: theme.textPrimary, fontWeight: 500, marginBottom: 6 }}>{label}</div>
      <input
        type="url"
        value={value || ""}
        onChange={e => onChange(id, e.target.value)}
        placeholder="https://..."
        style={{
          width: "100%", background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`,
          borderRadius: 6, padding: "8px 12px", fontSize: 13, color: theme.link,
          fontFamily: "'Inter', system-ui, sans-serif", outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={e => e.target.style.borderColor = theme.accent}
        onBlur={e => e.target.style.borderColor = theme.borderSubtle}
      />
    </div>
  );
}

// ─── GATE DECISION COMPONENT ─────────────────────────────────────────────────

function GateTask({ id, label, value, onChange }) {
  const { theme } = useTheme();
  const isGo = value === "go";
  const isNogo = value === "nogo";
  const isUndecided = !isGo && !isNogo;

  return (
    <div style={{
      padding: "12px 0", borderBottom: `1px solid ${theme.borderSubtle}`,
    }}>
      <div style={{ fontSize: 13, color: theme.textPrimary, fontWeight: 600, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onChange(id, isGo ? "" : "go")}
          style={{
            padding: "8px 20px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: "pointer", transition: "all 0.15s",
            border: isGo ? `2px solid ${theme.gateGo}` : `2px solid ${theme.borderSubtle}`,
            background: isGo ? theme.gateGoBg : theme.elevatedBg,
            color: isGo ? theme.gateGo : theme.textTertiary,
          }}
        >
          ✓ Go
        </button>
        <button
          onClick={() => onChange(id, isNogo ? "" : "nogo")}
          style={{
            padding: "8px 20px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: "pointer", transition: "all 0.15s",
            border: isNogo ? `2px solid ${theme.gateNogo}` : `2px solid ${theme.borderSubtle}`,
            background: isNogo ? theme.gateNogoBg : theme.elevatedBg,
            color: isNogo ? theme.gateNogo : theme.textTertiary,
          }}
        >
          ✕ No-go
        </button>
      </div>
      {isNogo && (
        <div style={{
          marginTop: 8, background: theme.gateNogoBg, border: `1px solid ${theme.gateNogoBorder}`,
          borderRadius: 6, padding: "8px 12px", fontSize: 12, color: theme.gateNogo,
        }}>
          Project will not proceed past this gate. All downstream stages are locked.
        </div>
      )}
    </div>
  );
}

// ─── FM ACTION BUTTON ────────────────────────────────────────────────────────

function FmActionTask({ task, fmVersionDates, onOpenFM }) {
  const { theme } = useTheme();
  const created = fmVersionDates?.[task.fmVersion];
  const label = FM_VERSION_LABELS[task.fmVersion] || `FM V${task.fmVersion}`;

  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ fontSize: 13, color: theme.textPrimary, fontWeight: 600, marginBottom: 8 }}>{task.label}</div>
      <button
        onClick={() => onOpenFM(task.fmVersion)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
          cursor: "pointer", transition: "all 0.15s", width: "100%",
          border: created ? `1px solid ${theme.success}` : `1px solid ${theme.accent}`,
          background: created ? theme.elevatedBg : theme.accentBg,
          color: created ? theme.textPrimary : theme.accent,
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = theme.shadowMd; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}
      >
        {/* Icon */}
        <span style={{
          width: 28, height: 28, borderRadius: 6, display: "flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14,
          background: created ? theme.successBg : theme.accentBg,
          color: created ? theme.success : theme.accent,
        }}>
          {created ? "✓" : "+"}
        </span>
        {/* Label + date */}
        <div style={{ flex: 1, textAlign: "left" }}>
          <div>{created ? label : `Create ${label}`}</div>
          {created && (
            <div style={{ fontSize: 11, color: theme.textTertiary, fontWeight: 400, marginTop: 2 }}>
              Created {new Date(created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          )}
        </div>
        {/* Arrow */}
        <span style={{ fontSize: 14, color: theme.textTertiary }}>→</span>
      </button>
    </div>
  );
}

// ─── DOCUMENT VERSION TRACKER ────────────────────────────────────────────────

function DocVersionsTask({ task, data, onChange }) {
  const { theme } = useTheme();
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary }}>{task.label}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
          background: theme.infoBg, color: theme.info,
        }}>
          {task.versions.filter(v => data[v.id]?.trim()).length}/{task.versions.length} versions linked
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {task.versions.map(v => {
          const hasLink = data[v.id]?.trim();
          return (
            <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Version badge */}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                background: hasLink ? theme.successBg : theme.borderSubtle,
                color: hasLink ? theme.success : theme.textTertiary,
                minWidth: 28, textAlign: "center", flexShrink: 0,
              }}>
                {v.version}
              </span>
              {/* Link input */}
              <input
                type="url"
                value={data[v.id] || ""}
                onChange={e => onChange(v.id, e.target.value)}
                placeholder={v.label}
                style={{
                  flex: 1, background: theme.elevatedBg, border: `1px solid ${theme.borderSubtle}`,
                  borderRadius: 6, padding: "6px 10px", fontSize: 12, color: theme.link,
                  fontFamily: "'Inter', system-ui, sans-serif", outline: "none",
                }}
                onFocus={e => e.target.style.borderColor = theme.accent}
                onBlur={e => e.target.style.borderColor = theme.borderSubtle}
              />
              {/* Open link button */}
              {hasLink && (
                <a
                  href={data[v.id]}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: theme.link, textDecoration: "none",
                    padding: "4px 8px", borderRadius: 4, background: theme.infoBg,
                    fontWeight: 600, flexShrink: 0,
                  }}
                >
                  Open ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TASK GROUP ──────────────────────────────────────────────────────────────

function TaskGroup({ group, data, onChange }) {
  const { theme } = useTheme();
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <div style={{ fontSize: 13, color: theme.textSecondary, fontWeight: 600, marginBottom: 4 }}>{group.label}</div>
      <div style={{ paddingLeft: 16, borderLeft: `2px solid ${theme.borderSubtle}` }}>
        {group.children.map(child => {
          if (child.type === "check") {
            return <CheckTask key={child.id} {...child} checked={data[child.id]} onChange={onChange} />;
          }
          if (child.type === "text") {
            return <TextTask key={child.id} {...child} value={data[child.id]} onChange={onChange} />;
          }
          if (child.type === "link") {
            return <LinkTask key={child.id} {...child} value={data[child.id]} onChange={onChange} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

function renderTask(task, data, onChange, fmVersionDates, onOpenFM) {
  if (task.type === "group") {
    return <TaskGroup key={task.id} group={task} data={data} onChange={onChange} />;
  }
  if (task.type === "gate") {
    return <GateTask key={task.id} {...task} value={data[task.id]} onChange={onChange} />;
  }
  if (task.type === "fm_action") {
    return <FmActionTask key={task.id} task={task} fmVersionDates={fmVersionDates} onOpenFM={onOpenFM} />;
  }
  if (task.type === "doc_versions") {
    return <DocVersionsTask key={task.id} task={task} data={data} onChange={onChange} />;
  }
  if (task.type === "check") {
    return <CheckTask key={task.id} {...task} checked={data[task.id]} onChange={onChange} />;
  }
  if (task.type === "text") {
    return <TextTask key={task.id} {...task} value={data[task.id]} onChange={onChange} />;
  }
  if (task.type === "link") {
    return <LinkTask key={task.id} {...task} value={data[task.id]} onChange={onChange} />;
  }
  return null;
}

// ─── APPROVER BADGES ─────────────────────────────────────────────────────────

function ApproverBadges({ approvers }) {
  const { theme } = useTheme();
  if (!approvers || approvers.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, marginLeft: 8, flexShrink: 0 }}>
      {approvers.map(name => (
        <span key={name} style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
          background: theme.badgePurpleBg, color: theme.badgePurpleText,
          whiteSpace: "nowrap",
        }}>
          {name}
        </span>
      ))}
    </div>
  );
}

// ─── STAGE COMPONENT ─────────────────────────────────────────────────────────

function Stage({ stage, stageIndex, data, onChange, isOpen, onToggle, prevComplete, isDownstreamLocked, fmVersionDates, onOpenFM }) {
  const { theme } = useTheme();
  const { total, done } = countCompleted(stage.tasks, data, fmVersionDates);
  const complete = total > 0 && done === total;
  const inProgress = done > 0 && !complete;
  const locked = isDownstreamLocked || (!prevComplete && stageIndex > 0);

  // Gate stages get a diamond shape indicator
  const isGate = stage.isGate;
  const gateTask = isGate ? stage.tasks.find(t => t.type === "gate") : null;
  const gateDecision = gateTask ? data[gateTask.id] : null;
  const isNogo = gateDecision === "nogo";

  // Colours
  let dotColor, dotBg;
  if (isNogo) {
    dotColor = theme.gateNogo; dotBg = theme.gateNogo;
  } else if (complete) {
    dotColor = theme.success; dotBg = theme.success;
  } else if (inProgress) {
    dotColor = theme.accent; dotBg = theme.accent;
  } else if (locked) {
    dotColor = theme.textMuted; dotBg = theme.elevatedBg;
  } else {
    dotColor = theme.border; dotBg = theme.elevatedBg;
  }

  // Gate diamond or regular dot
  const dotSize = isGate ? 24 : 20;

  return (
    <div style={{ display: "flex", gap: 0 }}>
      {/* Stepper rail */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 32, flexShrink: 0 }}>
        {/* Dot / Diamond */}
        {isGate ? (
          <div style={{
            width: dotSize, height: dotSize, transform: "rotate(45deg)",
            border: `2px solid ${dotColor}`, background: dotBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginTop: 0, flexShrink: 0, borderRadius: 4,
          }}>
            {complete && <span style={{ color: "#FFFFFF", fontSize: 11, fontWeight: 700, transform: "rotate(-45deg)" }}>✓</span>}
            {isNogo && <span style={{ color: "#FFFFFF", fontSize: 11, fontWeight: 700, transform: "rotate(-45deg)" }}>✕</span>}
          </div>
        ) : (
          <div style={{
            width: dotSize, height: dotSize, borderRadius: "50%", border: `2px solid ${dotColor}`,
            background: dotBg, display: "flex", alignItems: "center", justifyContent: "center",
            marginTop: 2, flexShrink: 0,
          }}>
            {complete && <span style={{ color: "#FFFFFF", fontSize: 11, fontWeight: 700 }}>✓</span>}
            {inProgress && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFFFFF" }} />}
          </div>
        )}
        {/* Line */}
        <div style={{
          width: 2, flex: 1, minHeight: 16,
          background: isNogo ? theme.gateNogoBorder : complete ? theme.stepperLineComplete : theme.stepperLine,
        }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: 16 }}>
        {/* Header */}
        <div
          onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
            padding: "0 0 8px 0", userSelect: "none",
          }}
        >
          <span style={{
            fontSize: 11, color: theme.textTertiary, transition: "transform 0.2s",
            transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
          }}>▼</span>
          <div style={{ flex: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
            <span style={{
              fontSize: 15, fontWeight: 700,
              color: isNogo ? theme.gateNogo : locked ? theme.border : theme.textPrimary,
            }}>
              {stage.title}
            </span>
            {isGate && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                background: isNogo ? theme.gateNogoBg : gateDecision === "go" ? theme.gateGoBg : theme.accentBg,
                color: isNogo ? theme.gateNogo : gateDecision === "go" ? theme.gateGo : theme.accent,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                {isNogo ? "No-go" : gateDecision === "go" ? "Go" : "Gate"}
              </span>
            )}
            <ApproverBadges approvers={stage.approvers} />
            {stage.timeline && (
              <span style={{ fontSize: 11, color: theme.textTertiary }}>({stage.timeline})</span>
            )}
          </div>
          {/* Progress badge */}
          <div style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
            background: isNogo ? theme.gateNogoBg : complete ? theme.successBg : inProgress ? theme.accentBg : theme.borderSubtle,
            color: isNogo ? theme.gateNogo : complete ? theme.success : inProgress ? theme.accent : theme.textTertiary,
          }}>
            {done}/{total}
          </div>
        </div>

        {/* Soft gate warning */}
        {isOpen && locked && !isDownstreamLocked && (
          <div style={{
            background: theme.warningBg, border: `1px solid ${theme.warning}`, borderRadius: 6,
            padding: "8px 12px", marginBottom: 8, fontSize: 12, color: theme.warning,
          }}>
            ⚠ Previous stage is not yet complete. You can still proceed, but it's recommended to finish the prior step first.
          </div>
        )}

        {/* No-go downstream lock message */}
        {isOpen && isDownstreamLocked && (
          <div style={{
            background: theme.gateNogoBg, border: `1px solid ${theme.gateNogoBorder}`, borderRadius: 6,
            padding: "8px 12px", marginBottom: 8, fontSize: 12, color: theme.gateNogo,
          }}>
            This stage is locked — a prior gate was declined (No-go).
          </div>
        )}

        {/* Tasks */}
        {isOpen && (
          <div style={{
            background: theme.cardBg, border: `1px solid ${theme.borderSubtle}`, borderRadius: 8,
            padding: "4px 16px", marginTop: 4,
            opacity: isDownstreamLocked ? 0.5 : 1,
            pointerEvents: isDownstreamLocked ? "none" : "auto",
          }}>
            {stage.tasks.map(task => renderTask(task, data, onChange, fmVersionDates, onOpenFM))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function AcquisitionProcess({ project, session, onOpenFM }) {
  const { theme } = useTheme();
  const [data, setData] = useState({});
  const [openStages, setOpenStages] = useState({ origination: true });
  const [saveStatus, setSaveStatus] = useState("saved");
  const [fmVersionDates, setFmVersionDates] = useState({}); // { 1: "2026-03-15T...", 2: null, 3: null }
  const saveTimer = useRef(null);
  const initialLoadDone = useRef(false);

  // Load from supabase
  useEffect(() => {
    if (!project) return;
    const load = async () => {
      // Load acquisition data
      const { data: rows } = await supabase
        .from("project_acquisition")
        .select("data")
        .eq("project_id", project.id)
        .limit(1);
      if (rows?.[0]?.data) {
        setData(rows[0].data);
      }

      // Load FM version creation dates
      const { data: fmRows } = await supabase
        .from("project_inputs")
        .select("version, fm_created_at, created_at")
        .eq("project_id", project.id);
      if (fmRows) {
        const dates = {};
        for (const row of fmRows) {
          dates[row.version] = row.fm_created_at || row.created_at;
        }
        setFmVersionDates(dates);
      }

      initialLoadDone.current = true;
    };
    load();
  }, [project]);

  // Auto-save (only after initial load)
  useEffect(() => {
    if (!project) return;
    if (!initialLoadDone.current) return;
    if (Object.keys(data).length === 0) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");

    saveTimer.current = setTimeout(async () => {
      try {
        // Check if row exists
        const { data: existing } = await supabase
          .from("project_acquisition")
          .select("project_id")
          .eq("project_id", project.id)
          .limit(1);

        let error;
        if (existing && existing.length > 0) {
          // Update existing row
          ({ error } = await supabase
            .from("project_acquisition")
            .update({ data, updated_at: new Date().toISOString() })
            .eq("project_id", project.id));
        } else {
          // Insert new row
          ({ error } = await supabase
            .from("project_acquisition")
            .insert({ project_id: project.id, data, updated_at: new Date().toISOString() }));
        }

        if (error) console.error("Acquisition save error:", error);
        setSaveStatus(error ? "error" : "saved");
      } catch (e) {
        console.error("Acquisition save exception:", e);
        setSaveStatus("error");
      }
    }, 1500);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [data, project]);

  const handleChange = useCallback((id, value) => {
    setData(prev => ({ ...prev, [id]: value }));
  }, []);

  const toggleStage = useCallback((stageId) => {
    setOpenStages(prev => ({ ...prev, [stageId]: !prev[stageId] }));
  }, []);

  // Calculate overall progress + detect no-go locks
  let totalAll = 0, doneAll = 0;
  let nogoAfterIndex = -1;
  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];
    const { total, done } = countCompleted(stage.tasks, data, fmVersionDates);
    totalAll += total;
    doneAll += done;
    if (nogoAfterIndex === -1 && isGateDeclined(stage, data)) {
      nogoAfterIndex = i;
    }
  }
  const overallPct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

  return (
    <div style={{
      flex: 1, overflowY: "auto", background: theme.pageBg,
      padding: "32px 48px", fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: theme.textPrimary, marginBottom: 4 }}>Acquisition Process</h1>
            <div style={{ fontSize: 12, color: theme.textTertiary }}>
              {project?.name || "Project"} — {doneAll} of {totalAll} tasks complete
              {nogoAfterIndex >= 0 && (
                <span style={{ color: theme.gateNogo, marginLeft: 8 }}>
                  (Declined at {STAGES[nogoAfterIndex].title})
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            {/* Overall progress bar */}
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>{overallPct}%</div>
            <div style={{ width: 160, height: 6, background: theme.progressTrack, borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${overallPct}%`, height: "100%", borderRadius: 3,
                background: nogoAfterIndex >= 0 ? theme.gateNogo : overallPct === 100 ? theme.success : theme.accent,
                transition: "width 0.3s ease",
              }} />
            </div>
            <div style={{ fontSize: 10, color: saveStatus === "saved" ? theme.success : saveStatus === "saving" ? theme.warning : theme.error, marginTop: 4 }}>
              {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving..." : "Save error"}
            </div>
          </div>
        </div>

        {/* Stages */}
        <div style={{ paddingLeft: 4 }}>
          {STAGES.map((stage, i) => {
            const prevComplete = i === 0 || isStageComplete(STAGES[i - 1], data, fmVersionDates);
            const isDownstreamLocked = nogoAfterIndex >= 0 && i > nogoAfterIndex;
            return (
              <Stage
                key={stage.id}
                stage={stage}
                stageIndex={i}
                data={data}
                onChange={handleChange}
                isOpen={!!openStages[stage.id]}
                onToggle={() => toggleStage(stage.id)}
                prevComplete={prevComplete}
                isDownstreamLocked={isDownstreamLocked}
                fmVersionDates={fmVersionDates}
                onOpenFM={onOpenFM}
              />
            );
          })}
        </div>

      </div>
    </div>
  );
}
