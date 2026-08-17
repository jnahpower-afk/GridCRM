import { useState, useEffect } from "react";
import { Mail, Phone, MessageCircle, Users, CheckCircle, Layers, Send, FileText, ChevronRight, CheckCheck, Pencil, X } from "lucide-react";

function LinkedinIcon({ size = 15, color, strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
      <rect width="4" height="12" x="2" y="9"/>
      <circle cx="4" cy="4" r="2"/>
    </svg>
  );
}

const CHANNEL_COLORS = {
  Email: "#3b82f6", LinkedIn: "#0077b5", Call: "#22c55e",
  WhatsApp: "#25d366", Meeting: "#f59e0b",
};

function ChannelIcon({ channel, size = 15, color }) {
  const props = { size, color: color || CHANNEL_COLORS[channel] || "#888", strokeWidth: size <= 13 ? 1.75 : 2 };
  switch (channel) {
    case "Email":    return <Mail {...props} />;
    case "LinkedIn": return <LinkedinIcon {...props} />;
    case "Call":     return <Phone {...props} />;
    case "WhatsApp": return <MessageCircle {...props} />;
    case "Meeting":  return <Users {...props} />;
    default:         return <Layers {...props} />;
  }
}

const CHANNELS = ["All", "Email", "Call", "LinkedIn", "WhatsApp", "Meeting"];

function substitute(text, lead, calendarLink) {
  if (!text) return "";
  return text
    .replace(/\{\{company_name\}\}/g,  lead?.name  || "")
    .replace(/\{\{contact_name\}\}/g,  lead?.contact_name || lead?.contacts?.[0]?.name || "")
    .replace(/\{\{owner_name\}\}/g,    lead?.owner || "")
    .replace(/\{\{calendar_link\}\}/g, calendarLink || "[calendar link]");
}

function dueFmt(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── DRAFT / SEND MODAL ──────────────────────────────────────────────────────

function DraftModal({ task, lead, step, onClose, onDone, onSendEmail, theme }) {
  const calendarLink   = lead?._calendarLink || "";
  // Show "Book a meeting →" in the preview instead of the raw URL
  const rawBody        = substitute(step?.body, lead, calendarLink);
  const displayBody    = calendarLink ? rawBody.replace(calendarLink, "Book a meeting →") : rawBody;
  const [body, setBody] = useState(displayBody);
  const subject         = substitute(step?.subject, lead, calendarLink);
  const [saving, setSaving]   = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentOk, setSentOk]   = useState(false);

  const recipientEmail = lead?.contact_email || lead?.contacts?.[0]?.email || "";
  const canSendGmail   = !!(onSendEmail && recipientEmail && step?.channel === "Email");

  async function handleDone() {
    setSaving(true);
    await onDone(task, step, body);
    setSaving(false);
    onClose();
  }

  async function handleSendGmail() {
    setSending(true); setSendError("");
    try {
      await onSendEmail({ ownerName: lead.owner, to: recipientEmail, subject, body, calendarLink });
      setSentOk(true);
      setTimeout(async () => { await onDone(task, step, body); onClose(); }, 1200);
    } catch (err) {
      setSendError(err.message || "Send failed");
    } finally { setSending(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: theme.elevatedBg, border: `1px solid ${theme.border}`, borderRadius: 14, width: "100%", maxWidth: 620, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: theme.shadowMd }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>{step?.channel} Draft — {lead?.name}</div>
            {subject && <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>Subject: {subject}</div>}
            {canSendGmail && <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>To: {recipientEmail}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 8 }}>Edit before sending — logged as an activity</div>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
            style={{ width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.textPrimary, padding: "10px 12px", fontSize: 12, lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
          <button onClick={() => navigator.clipboard?.writeText(body)}
            style={{ marginTop: 8, padding: "5px 12px", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, color: theme.textSecondary, cursor: "pointer" }}>
            📋 Copy to clipboard
          </button>
          {canSendGmail && calendarLink && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: theme.pillBg, borderRadius: 6, fontSize: 11, color: theme.textTertiary, border: `1px solid ${theme.border}` }}>
              📅 Your calendar link will appear as <strong style={{ color: theme.textSecondary }}>"Book a meeting →"</strong> in the sent email.
            </div>
          )}
          {!canSendGmail && step?.channel === "Email" && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: theme.pillBg, borderRadius: 6, fontSize: 11, color: theme.textTertiary, border: `1px solid ${theme.border}` }}>
              {!recipientEmail ? "⚠ No email address on file for this contact." : "ⓘ Connect Gmail (📧 Gmail button) to enable one-click sending."}
            </div>
          )}
          {sendError && <div style={{ marginTop: 10, padding: "8px 12px", background: "#ef444422", borderRadius: 6, fontSize: 11, color: "#ef4444", border: "1px solid #ef444444" }}>✗ {sendError}</div>}
          {sentOk    && <div style={{ marginTop: 10, padding: "8px 12px", background: "#22c55e22", borderRadius: 6, fontSize: 11, color: "#22c55e",  border: "1px solid #22c55e44" }}>✓ Sent — marking done…</div>}
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${theme.border}`, display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, color: theme.textSecondary, cursor: "pointer" }}>Cancel</button>
          {canSendGmail ? (
            <button onClick={handleSendGmail} disabled={sending || sentOk || !body.trim()}
              style={{ flex: 3, padding: "9px", background: sentOk ? "#22c55e" : "#3b82f6", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#fff", cursor: (sending || sentOk) ? "default" : "pointer", opacity: sending && !sentOk ? 0.7 : 1 }}>
              {sentOk ? <><CheckCircle size={13} style={{ marginRight: 6 }} />Sent!</> : sending ? "Sending…" : <><Send size={13} style={{ marginRight: 6 }} />Send via Gmail & Mark Done</>}
            </button>
          ) : (
            <button onClick={handleDone} disabled={saving || !body.trim()}
              style={{ flex: 3, padding: "9px", background: theme.accent, border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "✓ Mark Done & Log Activity"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── STEP EDIT MODAL ─────────────────────────────────────────────────────────

function StepEditModal({ step, onClose, onSave, theme }) {
  const [subject, setSubject] = useState(step?.subject || "");
  const [body,    setBody]    = useState(step?.body    || "");
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const inp = {
    width: "100%", background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 8, color: theme.textPrimary, padding: "8px 12px",
    fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ stepId: step.id, subject, body });
      setSaved(true);
      setTimeout(onClose, 900);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: theme.elevatedBg, border: `1px solid ${theme.border}`, borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: theme.shadowMd }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, display: "flex", alignItems: "center", gap: 7 }}>
              <Pencil size={14} color={theme.textTertiary} />
              Edit Step {step?.step_number} — {step?.channel}
            </div>
            <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
              Changes apply to this step's template. Use <code style={{ background: theme.pillBg, padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>{"{{company_name}}"}</code>, <code style={{ background: theme.pillBg, padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>{"{{contact_name}}"}</code>, <code style={{ background: theme.pillBg, padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>{"{{owner_name}}"}</code>, <code style={{ background: theme.pillBg, padding: "1px 4px", borderRadius: 3, fontSize: 10 }}>{"{{calendar_link}}"}</code>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 20, cursor: "pointer", flexShrink: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {step?.channel === "Email" && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Subject line</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} placeholder="Email subject…" />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>
              {step?.channel === "Email" ? "Email body" : step?.channel === "Call" ? "Call script" : step?.channel === "LinkedIn" ? "Message / note" : "Content"}
            </label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={14}
              style={{ ...inp, resize: "vertical", lineHeight: 1.6 }} placeholder="Write your template here…" />
          </div>
          <div style={{ fontSize: 10, color: theme.textTertiary, background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "6px 10px" }}>
            ℹ️ Day offset: <strong>{step?.day_offset ?? "—"}</strong> · This affects when the task appears in the queue. Change the day offset in the Sequences settings.
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${theme.border}`, display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, color: theme.textSecondary, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || saved || !body.trim()}
            style={{ flex: 3, padding: "9px", background: saved ? "#22c55e" : theme.accent, border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#fff", cursor: (saving || saved) ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
            {saved ? "✓ Saved!" : saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TASK ROW (inside expanded lead) ─────────────────────────────────────────

function TaskRow({ task, lead, step, sequence, onDone, onSkip, onSendEmail, onStepEdit, isChannelMatch, theme }) {
  const [showDraft, setShowDraft] = useState(false);
  const [showEdit,  setShowEdit]  = useState(false);
  const todayStr  = new Date().toISOString().slice(0, 10);
  const isOverdue = task.due_date < todayStr;
  const isToday   = task.due_date === todayStr;
  const urgencyColor = isOverdue ? "#ef4444" : isToday ? "#f59e0b" : theme.textMuted;
  const hasDraft  = !!(step?.body);
  const canEmail  = step?.channel === "Email" && onSendEmail;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 42px", borderTop: `1px solid ${theme.borderSubtle}`, opacity: isChannelMatch ? 1 : 0.45 }}>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}><ChannelIcon channel={step?.channel} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: theme.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Step {step?.step_number} · {step?.channel}
            {step?.subject && <span style={{ color: theme.textMuted }}> · {substitute(step.subject, lead, lead?._calendarLink).slice(0, 40)}{step.subject.length > 40 ? "…" : ""}</span>}
          </div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: urgencyColor, flexShrink: 0, minWidth: 70, textAlign: "right" }}>
          {isOverdue ? `Overdue ${dueFmt(task.due_date)}` : isToday ? "Today" : dueFmt(task.due_date)}
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <button onClick={() => setShowEdit(true)}
            title="Edit step template"
            style={{ padding: "3px 7px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 10, color: theme.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <Pencil size={10} />
          </button>
          {hasDraft && (
            <button onClick={() => setShowDraft(true)}
              style={{ padding: "3px 8px", background: canEmail ? "#3b82f622" : theme.pillBg, border: `1px solid ${canEmail ? "#3b82f644" : theme.border}`, borderRadius: 5, fontSize: 10, fontWeight: 600, color: canEmail ? "#3b82f6" : theme.textSecondary, cursor: "pointer" }}>
              {canEmail ? <Send size={10} /> : "Draft"}
            </button>
          )}
          <button onClick={() => onDone(task, step, "")}
            style={{ padding: "3px 8px", background: theme.accent, border: "none", borderRadius: 5, fontSize: 10, fontWeight: 700, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center" }}><CheckCheck size={11} /></button>
          <button onClick={() => onSkip(task)}
            style={{ padding: "3px 8px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 5, fontSize: 10, color: theme.textMuted, cursor: "pointer" }}>Skip</button>
        </div>
      </div>
      {showDraft && (
        <DraftModal task={task} lead={lead} step={step}
          onClose={() => setShowDraft(false)} onDone={onDone}
          onSendEmail={step?.channel === "Email" ? onSendEmail : null} theme={theme} />
      )}
      {showEdit && (
        <StepEditModal step={step} onClose={() => setShowEdit(false)} onSave={onStepEdit} theme={theme} />
      )}
    </>
  );
}

// ─── LEAD ROW (accordion) ─────────────────────────────────────────────────────

function LeadRow({ lead, tasks, stepsMap, enrolMap, onDone, onSkip, onRemove, onSendEmail, onStepEdit, channelFilter, theme }) {
  const [expanded,  setExpanded]  = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [showEdit,  setShowEdit]  = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Sort all tasks by due date ascending
  const sorted = [...tasks].sort((a, b) => a.due_date.localeCompare(b.due_date));

  // Primary = most urgent task matching the active channel filter (or overall most urgent)
  const primary = channelFilter !== "All"
    ? sorted.find(t => stepsMap[t.step_id]?.channel === channelFilter) || sorted[0]
    : sorted[0];

  const primaryStep = stepsMap[primary?.step_id];
  const isOverdue   = primary?.due_date < todayStr;
  const isToday     = primary?.due_date === todayStr;
  const urgencyColor = isOverdue ? "#ef4444" : isToday ? "#f59e0b" : "#3b82f6";
  const urgencyLabel = isOverdue ? `Overdue · ${dueFmt(primary.due_date)}` : isToday ? "Due today" : dueFmt(primary.due_date);
  const hasDraft    = !!(primaryStep?.body);
  const canEmail    = primaryStep?.channel === "Email" && onSendEmail;
  const remaining   = sorted.filter(t => t.id !== primary?.id);

  // Count breakdown
  const overdueCount = tasks.filter(t => t.due_date < todayStr).length;
  const todayCount   = tasks.filter(t => t.due_date === todayStr).length;

  return (
    <>
      {/* ── Primary row ── */}
      <div style={{ background: theme.cardBg, border: `1px solid ${isOverdue ? "#ef444433" : theme.border}`, borderRadius: expanded ? "10px 10px 0 0" : 10, marginBottom: expanded ? 0 : 6, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px" }}>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(e => !e)}
            disabled={remaining.length === 0}
            style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: remaining.length > 0 ? theme.textTertiary : "transparent", cursor: remaining.length > 0 ? "pointer" : "default", flexShrink: 0, transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>
            <ChevronRight size={14} />
          </button>

          {/* Channel icon */}
          <div style={{ width: 32, height: 32, borderRadius: 7, background: (CHANNEL_COLORS[primaryStep?.channel] || "#888") + "18", border: `2px solid ${CHANNEL_COLORS[primaryStep?.channel] || theme.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <ChannelIcon channel={primaryStep?.channel} size={15} />
          </div>

          {/* Lead name + step info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {lead?.name || "Unknown lead"}
              </span>
              {tasks.length > 1 && (
                <span style={{ fontSize: 10, color: theme.textMuted, background: theme.pillBg, padding: "1px 6px", borderRadius: 8, flexShrink: 0 }}>
                  {tasks.length} tasks
                  {overdueCount > 0 && <span style={{ color: "#ef4444" }}> · {overdueCount} overdue</span>}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Step {primaryStep?.step_number} · {enrolMap[primary?.enrolment_id]?.name || "Sequence"}
              {primaryStep?.subject && <span style={{ color: theme.textMuted }}> · "{substitute(primaryStep.subject, lead, lead?._calendarLink).slice(0, 35)}{primaryStep?.subject?.length > 35 ? "…" : ""}"</span>}
            </div>
          </div>

          {/* Due label */}
          <div style={{ fontSize: 11, fontWeight: 700, color: urgencyColor, flexShrink: 0, textAlign: "right", minWidth: 80 }}>
            {urgencyLabel}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => setShowEdit(true)}
              title="Edit step template"
              style={{ padding: "4px 8px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, color: theme.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Pencil size={12} />
            </button>
            {hasDraft && (
              <button onClick={() => setShowDraft(true)}
                style={{ padding: "4px 10px", background: canEmail ? "#3b82f622" : theme.pillBg, border: `1px solid ${canEmail ? "#3b82f644" : theme.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, color: canEmail ? "#3b82f6" : theme.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                {canEmail ? <><Send size={11} />Send</> : <><FileText size={11} />Draft</>}
              </button>
            )}
            <button onClick={() => onDone(primary, primaryStep, "")}
              style={{ padding: "4px 10px", background: theme.accent, border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><CheckCircle size={12} /> Done</button>
            <button onClick={() => onSkip(primary)}
              style={{ padding: "4px 10px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, color: theme.textMuted, cursor: "pointer" }}>Skip</button>
            {onRemove && (
              <button
                onClick={() => { if (window.confirm(`Remove ${lead?.name} from this sequence? All pending tasks will be cancelled.`)) onRemove(primary.enrolment_id, tasks); }}
                title="Remove from sequence"
                style={{ padding: "4px 8px", background: "none", border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", opacity: 0.7 }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── Expanded sub-tasks ── */}
        {expanded && remaining.map(task => {
          const step = stepsMap[task.step_id];
          const isMatch = channelFilter === "All" || step?.channel === channelFilter;
          return (
            <TaskRow key={task.id} task={task} lead={lead} step={step}
              sequence={enrolMap[task.enrolment_id]}
              onDone={onDone} onSkip={onSkip}
              onSendEmail={step?.channel === "Email" ? onSendEmail : null}
              onStepEdit={onStepEdit}
              isChannelMatch={isMatch} theme={theme} />
          );
        })}
      </div>
      {expanded && <div style={{ marginBottom: 6 }} />}

      {showDraft && (
        <DraftModal task={primary} lead={lead} step={primaryStep}
          onClose={() => setShowDraft(false)} onDone={onDone}
          onSendEmail={primaryStep?.channel === "Email" ? onSendEmail : null} theme={theme} />
      )}
      {showEdit && (
        <StepEditModal step={primaryStep} onClose={() => setShowEdit(false)} onSave={onStepEdit} theme={theme} />
      )}
    </>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export default function TaskQueue({
  tasks, leads, steps, enrolments, sequences,
  onTaskComplete, onTaskSkip, onTaskRemove, onStepEdit,
  teamMembers, calendarLinks, gmailConnected, onSendEmail,
  theme,
}) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [channelFilter, setChannelFilter] = useState("All");
  const [myTasksOnly, setMyTasksOnly]     = useState(() => localStorage.getItem("fuse_my_tasks_only") !== "false");
  const [currentUser, setCurrentUser]     = useState(() => localStorage.getItem("fuse_current_user") || "");

  useEffect(() => { localStorage.setItem("fuse_my_tasks_only", String(myTasksOnly)); }, [myTasksOnly]);
  useEffect(() => { if (currentUser) localStorage.setItem("fuse_current_user", currentUser); }, [currentUser]);

  // Lookup maps
  const leadsMap  = Object.fromEntries(leads.map(l => [l.id, { ...l, _calendarLink: calendarLinks?.[l.owner] || "" }]));
  const stepsMap  = Object.fromEntries(steps.map(s => [s.id, s]));
  const seqById   = Object.fromEntries(sequences.map(s => [s.id, s]));
  const enrolMap  = Object.fromEntries(enrolments.map(e => [e.id, {
    ...seqById[e.sequence_id],
    _stepCount: steps.filter(s => s.sequence_id === e.sequence_id).length,
  }]));

  // 1. Owner filter
  const ownerFiltered = (myTasksOnly && currentUser)
    ? tasks.filter(t => leadsMap[t.lead_id]?.owner === currentUser)
    : tasks;

  // 2. Status filter — pending only
  const pending = ownerFiltered.filter(t => t.status === "pending");

  // 3. Channel filter — only affects which LEADS are shown (a lead shows if it has ≥1 task of that channel)
  const channelPending = channelFilter === "All"
    ? pending
    : pending.filter(t => stepsMap[t.step_id]?.channel === channelFilter);

  // 4. Group by lead, then sort leads by urgency
  const byLead = channelPending.reduce((acc, task) => {
    if (!acc[task.lead_id]) acc[task.lead_id] = [];
    acc[task.lead_id].push(task);
    return acc;
  }, {});

  const leadRows = Object.entries(byLead)
    .map(([leadId, leadTasks]) => {
      const hasOverdue = leadTasks.some(t => t.due_date < todayStr);
      const hasToday   = leadTasks.some(t => t.due_date === todayStr);
      const earliest   = leadTasks.reduce((min, t) => t.due_date < min ? t.due_date : min, leadTasks[0]?.due_date || "");
      return { leadId, leadTasks, hasOverdue, hasToday, earliest };
    })
    .sort((a, b) => {
      if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
      if (a.hasToday   !== b.hasToday)   return a.hasToday   ? -1 : 1;
      return a.earliest.localeCompare(b.earliest);
    });

  const totalLeads    = leadRows.length;
  const totalTasks    = pending.length;
  const overdueLeads  = leadRows.filter(r => r.hasOverdue).length;
  const totalAllTasks = tasks.filter(t => t.status === "pending").length;

  function sendHandler(ownerName) {
    return (ownerName && gmailConnected?.has(ownerName)) ? onSendEmail : null;
  }

  // Channel task counts for filter bar
  const channelCounts = CHANNELS.reduce((acc, ch) => {
    acc[ch] = ch === "All" ? pending.length : pending.filter(t => stepsMap[t.step_id]?.channel === ch).length;
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary }}>Task Queue</div>
          <div style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
            {totalLeads} lead{totalLeads !== 1 ? "s" : ""} · {channelFilter === "All" ? totalTasks : channelCounts[channelFilter]} task{totalTasks !== 1 ? "s" : ""}
            {overdueLeads > 0 && <span style={{ color: "#ef4444", fontWeight: 600 }}> · {overdueLeads} overdue</span>}
            {myTasksOnly && totalAllTasks !== totalTasks && <span style={{ color: theme.textMuted }}> · {totalAllTasks} total team</span>}
          </div>
        </div>

        {/* My Tasks / All Tasks toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {myTasksOnly && (
            <select value={currentUser} onChange={e => setCurrentUser(e.target.value)}
              style={{ background: theme.surfaceBg, border: `1px solid ${theme.border}`, borderRadius: 6, color: currentUser ? theme.textPrimary : theme.textMuted, padding: "5px 8px", fontSize: 11, outline: "none", cursor: "pointer" }}>
              <option value="">— Select your name —</option>
              {(teamMembers || []).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <div style={{ display: "flex", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: "hidden" }}>
            {[{ label: "My Tasks", value: true }, { label: "All Tasks", value: false }].map(opt => (
              <button key={String(opt.value)} onClick={() => setMyTasksOnly(opt.value)}
                style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: myTasksOnly === opt.value ? theme.accent : "transparent", color: myTasksOnly === opt.value ? "#fff" : theme.textSecondary }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Channel filter bar ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {CHANNELS.filter(ch => ch === "All" || channelCounts[ch] > 0).map(ch => {
          const active = channelFilter === ch;
          const color  = ch === "All" ? theme.accent : CHANNEL_COLORS[ch];
          const count  = channelCounts[ch];
          return (
            <button key={ch} onClick={() => setChannelFilter(ch)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", border: `1px solid ${active ? color : theme.border}`, background: active ? color + "22" : theme.pillBg, color: active ? color : theme.textSecondary }}>
              {ch !== "All" && <ChannelIcon channel={ch} size={13} color={active ? color : theme.textMuted} />}
              {ch}
              <span style={{ fontSize: 10, background: active ? color + "33" : theme.border, color: active ? color : theme.textMuted, padding: "1px 5px", borderRadius: 8 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── No name selected ── */}
      {myTasksOnly && !currentUser && (
        <div style={{ padding: "12px 16px", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12, color: theme.textTertiary, marginBottom: 20, textAlign: "center" }}>
          Select your name above to see your tasks
        </div>
      )}

      {/* ── Empty state ── */}
      {leadRows.length === 0 && (myTasksOnly ? !!currentUser : true) && (
        <div style={{ textAlign: "center", padding: "60px 0", color: theme.textTertiary }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><CheckCircle size={36} color="#22c55e" /></div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>All caught up</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {channelFilter !== "All" ? `No ${channelFilter} tasks pending` : "No pending sequence tasks"}
          </div>
        </div>
      )}

      {/* ── Lead accordion rows ── */}
      {leadRows.map(({ leadId, leadTasks }) => (
        <LeadRow
          key={leadId}
          lead={leadsMap[leadId]}
          tasks={leadTasks}
          stepsMap={stepsMap}
          enrolMap={enrolMap}
          onDone={onTaskComplete}
          onSkip={onTaskSkip}
          onRemove={onTaskRemove}
          onSendEmail={sendHandler(leadsMap[leadId]?.owner)}
          onStepEdit={onStepEdit}
          channelFilter={channelFilter}
          theme={theme}
        />
      ))}
    </div>
  );
}
