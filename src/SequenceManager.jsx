import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import EnergyLoader from "./EnergyLoader.jsx";

const CHANNELS = ["Email", "LinkedIn", "Call", "WhatsApp", "Meeting"];

const CHANNEL_COLORS = {
  Email: "#3b82f6", LinkedIn: "#0077b5", Call: "#22c55e",
  WhatsApp: "#25d366", Meeting: "#f59e0b",
};

function inp(theme) {
  return {
    background: theme.surfaceBg, border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.textPrimary, padding: "7px 10px",
    fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box",
  };
}

export default function SequenceManager({ onClose, theme }) {
  const [sequences, setSequences]   = useState([]);
  const [allSteps, setAllSteps]     = useState([]);
  const [selected, setSelected]     = useState(null);
  const [steps, setSteps]           = useState([]);
  const [editName, setEditName]     = useState("");
  const [editDesc, setEditDesc]     = useState("");
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [loading, setLoading]       = useState(true);
  const [expandedStep, setExpandedStep] = useState(null);

  useEffect(() => {
    async function load() {
      const [seqRes, stepsRes] = await Promise.all([
        supabase.from("sequences").select("*").order("created_at"),
        supabase.from("sequence_steps").select("*").order("step_number"),
      ]);
      const seqs  = seqRes.data  || [];
      const stps  = stepsRes.data || [];
      setSequences(seqs);
      setAllSteps(stps);
      if (seqs.length > 0) selectSeq(seqs[0], stps);
      setLoading(false);
    }
    load();
  }, []);

  function selectSeq(seq, stpsOverride) {
    const stps = stpsOverride || allSteps;
    setSelected(seq);
    setEditName(seq.name);
    setEditDesc(seq.description || "");
    setSteps(stps.filter(s => s.sequence_id === seq.id).sort((a, b) => a.step_number - b.step_number));
    setDirty(false);
    setExpandedStep(null);
  }

  async function handleNew() {
    const { data, error } = await supabase.from("sequences")
      .insert([{ name: "New Sequence", description: "" }]).select().single();
    if (!error && data) {
      setSequences(prev => [...prev, data]);
      setAllSteps(prev => prev); // no new steps yet
      selectSeq(data, allSteps);
    }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      await supabase.from("sequences")
        .update({ name: editName.trim() || "Untitled", description: editDesc })
        .eq("id", selected.id);

      // Steps are updated in place, never deleted-and-recreated: sequence_tasks.step_id
      // points at them, so dropping a step used to take its tasks with it (one save on
      // "Private Wire Cold Outreach" destroyed all 93k tasks, 25k of them completed).
      // Only steps the user actually removed get deleted.
      const row = (s, i) => ({
        sequence_id: selected.id,
        step_number: i + 1,
        day_offset:  Number(s.day_offset) || 0,
        channel:     s.channel,
        subject:     s.subject || null,
        body:        s.body    || null,
      });

      const keptIds = new Set(steps.filter(s => s.id).map(s => s.id));
      const removedIds = allSteps
        .filter(s => s.sequence_id === selected.id && !keptIds.has(s.id))
        .map(s => s.id);
      if (removedIds.length > 0) {
        await supabase.from("sequence_steps").delete().in("id", removedIds);
      }

      const existing = steps.map((s, i) => [s, i]).filter(([s]) => s.id);
      const fresh    = steps.map((s, i) => [s, i]).filter(([s]) => !s.id);

      const savedSteps = [];
      if (existing.length > 0) {
        const { data } = await supabase.from("sequence_steps")
          .upsert(existing.map(([s, i]) => ({ id: s.id, ...row(s, i) }))).select();
        savedSteps.push(...(data || []));
      }
      if (fresh.length > 0) {
        const { data } = await supabase.from("sequence_steps")
          .insert(fresh.map(([s, i]) => row(s, i))).select();
        savedSteps.push(...(data || []));
      }

      setSequences(prev => prev.map(s => s.id === selected.id
        ? { ...s, name: editName.trim() || "Untitled", description: editDesc } : s));
      setSelected(prev => ({ ...prev, name: editName.trim() || "Untitled", description: editDesc }));
      setAllSteps(prev => [...prev.filter(s => s.sequence_id !== selected.id), ...savedSteps]);
      setSteps(savedSteps.sort((a, b) => a.step_number - b.step_number));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    await supabase.from("sequences").delete().eq("id", selected.id);
    const remaining = sequences.filter(s => s.id !== selected.id);
    setSequences(remaining);
    setAllSteps(prev => prev.filter(s => s.sequence_id !== selected.id));
    if (remaining.length > 0) selectSeq(remaining[0], allSteps.filter(s => s.sequence_id !== selected.id));
    else { setSelected(null); setSteps([]); }
  }

  function addStep() {
    const lastDay = steps.length > 0 ? steps[steps.length - 1].day_offset : -2;
    setSteps(prev => [...prev, {
      _new: true, sequence_id: selected?.id, step_number: prev.length + 1,
      day_offset: lastDay + 3, channel: "Email", subject: "", body: "",
    }]);
    setExpandedStep(steps.length);
    setDirty(true);
  }

  function updateStep(idx, field, val) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
    setDirty(true);
  }

  function removeStep(idx) {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_number: i + 1 })));
    setDirty(true);
  }

  const card = { background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "14px 16px" };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: theme.pageBg, display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary }}>Sequence Manager</span>
          <span style={{ fontSize: 11, color: theme.textTertiary, background: theme.pillBg, padding: "2px 8px", borderRadius: 10 }}>{sequences.length} sequences</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textTertiary, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>×</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><EnergyLoader /></div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Left — sequence list */}
          <div style={{ width: 260, borderRight: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: `1px solid ${theme.border}` }}>
              <button onClick={handleNew} style={{ width: "100%", padding: "8px 12px", background: theme.accent, color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                + New Sequence
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {sequences.length === 0 && (
                <div style={{ fontSize: 12, color: theme.textTertiary, textAlign: "center", padding: "20px 0" }}>No sequences yet</div>
              )}
              {sequences.map(seq => {
                const stepCount = allSteps.filter(s => s.sequence_id === seq.id).length;
                const isActive = selected?.id === seq.id;
                return (
                  <div key={seq.id} onClick={() => selectSeq(seq)} style={{
                    padding: "10px 12px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
                    background: isActive ? theme.accent + "18" : "transparent",
                    border: `1px solid ${isActive ? theme.accent + "44" : "transparent"}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? theme.accent : theme.textPrimary, marginBottom: 2 }}>{seq.name}</div>
                    <div style={{ fontSize: 10, color: theme.textTertiary }}>{stepCount} step{stepCount !== 1 ? "s" : ""}{seq.description ? ` · ${seq.description.slice(0, 35)}` : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right — editor */}
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            {!selected ? (
              <div style={{ color: theme.textTertiary, fontSize: 13, textAlign: "center", marginTop: 60 }}>Select or create a sequence</div>
            ) : (
              <>
                {/* Sequence meta */}
                <div style={{ ...card, marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>Sequence Details</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Name</label>
                      <input value={editName} onChange={e => { setEditName(e.target.value); setDirty(true); }} style={inp(theme)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Description (optional)</label>
                      <input value={editDesc} onChange={e => { setEditDesc(e.target.value); setDirty(true); }} placeholder="e.g. Cold outreach — industrial energy" style={inp(theme)} />
                    </div>
                  </div>
                </div>

                {/* Steps */}
                <div style={{ ...card, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: theme.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em" }}>Steps</div>
                    <button onClick={addStep} style={{ padding: "5px 12px", background: theme.pillBg, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 11, fontWeight: 600, color: theme.textSecondary, cursor: "pointer" }}>+ Add Step</button>
                  </div>

                  {steps.length === 0 && (
                    <div style={{ fontSize: 12, color: theme.textTertiary, textAlign: "center", padding: "20px 0", fontStyle: "italic" }}>No steps yet — add your first touchpoint</div>
                  )}

                  {steps.map((step, idx) => {
                    const isOpen = expandedStep === idx;
                    return (
                      <div key={idx} style={{ border: `1px solid ${isOpen ? theme.accent + "55" : theme.border}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                        {/* Step header row */}
                        <div onClick={() => setExpandedStep(isOpen ? null : idx)}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isOpen ? theme.accent + "0a" : "transparent" }}>
                          <div style={{ width: 22, height: 22, borderRadius: "50%", background: CHANNEL_COLORS[step.channel] + "22", border: `2px solid ${CHANNEL_COLORS[step.channel]}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: CHANNEL_COLORS[step.channel], flexShrink: 0 }}>{idx + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>Day {step.day_offset} — {step.channel}</span>
                            {step.subject && <span style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 8 }}>"{step.subject}"</span>}
                          </div>
                          <div style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: CHANNEL_COLORS[step.channel] + "22", color: CHANNEL_COLORS[step.channel], fontWeight: 600 }}>{step.channel}</div>
                          <button onClick={e => { e.stopPropagation(); removeStep(idx); }} style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
                        </div>

                        {/* Step body */}
                        {isOpen && (
                          <div style={{ padding: "12px 14px", borderTop: `1px solid ${theme.border}`, display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 12 }}>
                            <div>
                              <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Day offset</label>
                              <input type="number" min="0" value={step.day_offset}
                                onChange={e => updateStep(idx, "day_offset", e.target.value)}
                                style={inp(theme)} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Channel</label>
                              <select value={step.channel} onChange={e => updateStep(idx, "channel", e.target.value)} style={{ ...inp(theme), appearance: "none" }}>
                                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>Subject / task title</label>
                              <input value={step.subject || ""} onChange={e => updateStep(idx, "subject", e.target.value)}
                                placeholder="e.g. Private wire opportunity at {{company_name}}"
                                style={inp(theme)} />
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label style={{ fontSize: 11, color: theme.textTertiary, display: "block", marginBottom: 4 }}>
                                Draft body <span style={{ color: theme.textMuted, fontStyle: "italic" }}>— use {"{{company_name}}"}, {"{{contact_name}}"}, {"{{owner_name}}"}</span>
                              </label>
                              <textarea value={step.body || ""} onChange={e => updateStep(idx, "body", e.target.value)}
                                rows={5} placeholder="Write your draft message here…"
                                style={{ ...inp(theme), resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={handleSave} disabled={!dirty || saving}
                    style={{ flex: 1, padding: "10px 16px", background: dirty ? theme.accent : theme.textMuted, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.5 }}>
                    {saving ? "Saving…" : "Save Sequence"}
                  </button>
                  <button onClick={handleDelete}
                    style={{ padding: "10px 16px", background: "none", border: `1px solid ${theme.error || "#ef4444"}`, color: theme.error || "#ef4444", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
