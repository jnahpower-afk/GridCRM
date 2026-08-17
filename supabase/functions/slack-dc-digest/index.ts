// Supabase Edge Function: slack-dc-digest
// Data Centres end-of-day report, per team member, over the last 3 calendar days:
//   - Substations added / Land parcels added / Leads added
//   - Grid surgeries requested / completed
//   - Touch points (lead activity by channel: email, call, LinkedIn, …)
// Renders a stacked bar chart (QuickChart) by person + a per-person breakdown,
// posts to Slack. Call with ?dryRun=1 (or with no DC webhook set) to return the
// payload WITHOUT posting. Intended for pg_cron on weekdays.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Dedicated DC channel only — never fall back to the Private Wire channel.
const SLACK_WEBHOOK = Deno.env.get("SLACK_DC_GRID_WEBHOOK_URL") || Deno.env.get("SLACK_DC_WEBHOOK_URL") || "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DAY_NAMES   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const METRICS = [
  { key: "subs",    label: "Substations",    emoji: "🏗", color: "#06B6D4" },
  { key: "parcels", label: "Parcels",        emoji: "🟩", color: "#84CC16" },
  { key: "leads",   label: "Leads",          emoji: "📇", color: "#F59E0B" },
  { key: "sReq",    label: "Surgeries req.", emoji: "🩺", color: "#A855F7" },
  { key: "sDone",   label: "Surgeries done", emoji: "✅", color: "#22C55E" },
  { key: "touches", label: "Touch points",   emoji: "☎️", color: "#EF4444" },
] as const;

// Outreach channels that count as a touch point (notes are excluded).
const CH_EMOJI: Record<string, string> = { Email: "📧", Call: "📞", LinkedIn: "🔗", WhatsApp: "💬", Meeting: "🤝" };
const TOUCH_CHANNELS = Object.keys(CH_EMOJI);

const WINDOW_DAYS = 3;

function dateLabel(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}
function lastCalendarDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) { out.unshift(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1); }
  return out;
}
async function postToSlack(payload: object) {
  const res = await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Slack API error: ${res.status} ${await res.text()}`);
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1" || !SLACK_WEBHOOK;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const dates = lastCalendarDays(WINDOW_DAYS);
    const from = dates[0], today = dates[dates.length - 1];
    const fromTs = `${from}T00:00:00`, toTs = `${today}T23:59:59`;

    const { data: profs } = await supabase.from("profiles").select("id, full_name, email");
    const nameOf = (id: string | null) => {
      const p = (profs || []).find((x: any) => x.id === id);
      return p ? (p.full_name || p.email || "Unknown") : "Unassigned";
    };
    const firstName = (name: string) => {
      if (name.includes("@")) {
        const local = name.split("@")[0].split(/[._-]/).filter(Boolean)[0] || name;
        return local.charAt(0).toUpperCase() + local.slice(1);
      }
      return name.split(/\s+/)[0];
    };

    // Assets created in-window
    const { data: feats } = await supabase.from("dc_network_features")
      .select("created_by, type, substation_id").gte("created_at", fromTs).lte("created_at", toTs);
    const { data: subLeads } = await supabase.from("dc_substation_leads")
      .select("created_by").gte("created_at", fromTs).lte("created_at", toTs);
    // Grid surgeries requested / completed in-window (completed = status 'held')
    const { data: sReqRows } = await supabase.from("dc_grid_surgeries")
      .select("created_by, requested_at").gte("requested_at", from).lte("requested_at", today);
    const { data: sDoneRows } = await supabase.from("dc_grid_surgeries")
      .select("created_by, held_at").eq("status", "held").gte("held_at", from).lte("held_at", today);
    // Touch points — lead activity logged by channel
    const { data: acts } = await supabase.from("dc_substation_lead_activity")
      .select("created_by, channel, created_at").gte("created_at", fromTs).lte("created_at", toTs);

    // Aggregate per person
    type Row = { subs: number; parcels: number; leads: number; sReq: number; sDone: number; touches: number };
    const per: Record<string, Row> = {};
    const chanByPerson: Record<string, Record<string, number>> = {}; // name -> channel -> count
    const bump = (id: string | null, key: keyof Row) => {
      const n = nameOf(id);
      (per[n] = per[n] || { subs: 0, parcels: 0, leads: 0, sReq: 0, sDone: 0, touches: 0 })[key]++;
    };
    (feats || []).forEach((f: any) => {
      if (f.substation_id) bump(f.created_by, "parcels");
      else if ((f.type || "").startsWith("substation")) bump(f.created_by, "subs");
    });
    (subLeads || []).forEach((l: any) => bump(l.created_by, "leads"));
    (sReqRows || []).forEach((s: any) => bump(s.created_by, "sReq"));
    (sDoneRows || []).forEach((s: any) => bump(s.created_by, "sDone"));
    (acts || []).forEach((a: any) => {
      if (!TOUCH_CHANNELS.includes(a.channel)) return; // ignore notes / unknown
      const n = nameOf(a.created_by);
      bump(a.created_by, "touches");
      (chanByPerson[n] = chanByPerson[n] || {})[a.channel] = (chanByPerson[n][a.channel] || 0) + 1;
    });

    const rowTotal = (r: Row) => r.subs + r.parcels + r.leads + r.sReq + r.sDone + r.touches;
    const people = Object.keys(per).sort((a, b) => rowTotal(per[b]) - rowTotal(per[a]));
    const totals: Row = { subs: 0, parcels: 0, leads: 0, sReq: 0, sDone: 0, touches: 0 };
    people.forEach(p => { for (const k of Object.keys(totals) as (keyof Row)[]) totals[k] += per[p][k]; });
    const grand = rowTotal(totals);

    // Per-person channel breakdown string, e.g. "(📧 5 · 📞 4 · 🔗 3)"
    const chanStr = (name: string) => {
      const m = chanByPerson[name];
      if (!m) return "";
      const parts = TOUCH_CHANNELS.filter(c => m[c]).map(c => `${CH_EMOJI[c]} ${m[c]}`);
      return parts.length ? `  (${parts.join(" · ")})` : "";
    };

    // Stacked bar: x = people, one dataset per metric
    const datasets = METRICS.map(m => ({ label: m.label, data: people.map(p => per[p][m.key]), backgroundColor: m.color, borderRadius: 3 }));
    const chartConfig = {
      type: "bar",
      data: { labels: people.map(p => firstName(p)), datasets },
      options: { plugins: { legend: { position: "top", labels: { font: { size: 12 } } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } } },
    };
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&backgroundColor=white&w=700&h=300&f=png`;

    const blocks: object[] = [
      { type: "header", text: { type: "plain_text", text: "🖧 Data Centres — End of Day", emoji: true } },
      { type: "context", elements: [{ type: "mrkdwn", text: `*${dateLabel(today)}*  ·  last ${WINDOW_DAYS} days (${dateLabel(from)} – ${dateLabel(today)})` }] },
      { type: "divider" },
      { type: "image", image_url: chartUrl, alt_text: "Activity by team member", title: { type: "plain_text", text: "Activity by team member" } },
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: `*Team total: ${grand}*\n_🏗 ${totals.subs} substations · 🟩 ${totals.parcels} parcels · 📇 ${totals.leads} leads · 🩺 ${totals.sReq} surgeries requested · ✅ ${totals.sDone} completed · ☎️ ${totals.touches} touch points_` } },
    ];
    if (people.length === 0) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No activity in this period_" } });
    } else {
      for (const p of people) {
        const d = per[p];
        const total = rowTotal(d);
        const parts = METRICS.filter(m => d[m.key]).map(m => `${m.emoji} ${d[m.key]}`);
        blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${firstName(p)}* — ${total}   ${parts.length ? parts.join("  ·  ") : "_none_"}${chanStr(p)}` } });
      }
    }
    blocks.push({ type: "divider" });
    blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open CRM →", emoji: true }, url: "https://fuse-platform.vercel.app", style: "primary" }] });

    if (dryRun) {
      const textPreview = [`Data Centres — End of Day, last ${WINDOW_DAYS} days (${from} → ${today})`,
        `Team total: ${grand}  (🏗 ${totals.subs} substations · 🟩 ${totals.parcels} parcels · 📇 ${totals.leads} leads · 🩺 ${totals.sReq} surgeries requested · ✅ ${totals.sDone} completed · ☎️ ${totals.touches} touch points)`,
        ...people.map(p => `  ${firstName(p)}: ${per[p].subs} subs, ${per[p].parcels} parcels, ${per[p].leads} leads, ${per[p].sReq} surg.req, ${per[p].sDone} surg.done, ${per[p].touches} touches${chanStr(p)}`)].join("\n");
      return new Response(JSON.stringify({ dryRun: true, window: { from, today }, totals: { ...totals, grand }, perPerson: per, chanByPerson, textPreview, chartUrl, blocks }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    await postToSlack({ blocks });
    return new Response(JSON.stringify({ success: true, totals: { ...totals, grand } }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("slack-dc-digest error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
