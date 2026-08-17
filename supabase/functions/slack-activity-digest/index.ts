// Supabase Edge Function: slack-activity-digest
// Posts a 7pm end-of-day summary to Slack with:
//   - A 4-day stacked bar chart (via QuickChart.io) — one colour per team member
//   - A table of today's activity broken down by individual (channel counts + tasks done)
//   - Inbound reply highlights
// Triggered by pg_cron at 6pm UTC (7pm BST) every weekday.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SLACK_WEBHOOK = Deno.env.get("SLACK_WEBHOOK_URL")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// One distinct colour per person (up to 8 team members)
const PERSON_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FECA57",
  "#FF9FF3", "#96CEB4", "#54A0FF", "#F8632C",
];

const CHANNEL_EMOJI: Record<string, string> = {
  Email: "✉️", LinkedIn: "💼", Call: "📞", WhatsApp: "💬", Meeting: "🤝",
};
const CHANNELS = ["Email", "LinkedIn", "Call", "WhatsApp", "Meeting"];

const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dateLabel(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

// Last N weekdays (inclusive of today), most-recent last
function lastWeekdays(n: number): string[] {
  const result: string[] = [];
  const d = new Date();
  while (result.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) result.unshift(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return result;
}

async function postToSlack(payload: object) {
  const res = await fetch(SLACK_WEBHOOK, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Slack API error: ${res.status} ${await res.text()}`);
}

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const dates = lastWeekdays(4);
    const today = dates[dates.length - 1];

    // ── Fetch last 4 days of activity ────────────────────────────────────────
    const { data: activities, error: actErr } = await supabase
      .from("private_wire_activity_log")
      .select("id, date, channel, direction, lead:private_wire_leads(owner, name)")
      .gte("date", dates[0])
      .lte("date", today)
      .order("date", { ascending: true });

    if (actErr) throw new Error(actErr.message);

    // ── Fetch tasks completed today ───────────────────────────────────────────
    const { data: completedTasks } = await supabase
      .from("sequence_tasks")
      .select("id, completed_at, lead:private_wire_leads(owner)")
      .eq("status", "completed")
      .gte("completed_at", `${today}T00:00:00`);

    // ── Derive sorted owner list from last 4 days ────────────────────────────
    const ownerSet = new Set<string>();
    (activities || []).forEach(a => {
      const o = (a.lead as any)?.owner;
      if (o) ownerSet.add(o);
    });
    const owners = [...ownerSet].sort();

    // ── Build chart data: date × owner touchpoint counts ─────────────────────
    const countByDateOwner: Record<string, Record<string, number>> = {};
    dates.forEach(d => { countByDateOwner[d] = {}; });
    (activities || []).forEach(a => {
      const owner = (a.lead as any)?.owner;
      if (!owner || !countByDateOwner[a.date]) return;
      countByDateOwner[a.date][owner] = (countByDateOwner[a.date][owner] || 0) + 1;
    });

    // One dataset per person, stacked
    const datasets = owners.map((owner, i) => ({
      label: owner.split(" ")[0],
      data:  dates.map(d => countByDateOwner[d][owner] || 0),
      backgroundColor: PERSON_COLORS[i % PERSON_COLORS.length],
      borderRadius: 3,
    }));

    const chartConfig = {
      type: "bar",
      data: {
        labels: dates.map(dateLabel),
        datasets,
      },
      options: {
        plugins: {
          legend: { position: "top", labels: { font: { size: 12 } } },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
        },
      },
    };

    const chartUrl =
      `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}` +
      `&backgroundColor=white&w=700&h=280&f=png`;

    // ── Today's per-person breakdown ─────────────────────────────────────────
    const todayActivities = (activities || []).filter(a => a.date === today);

    const todayByOwner: Record<string, { channels: Record<string, number>; total: number }> = {};
    todayActivities.forEach(a => {
      const owner = (a.lead as any)?.owner;
      if (!owner) return;
      if (!todayByOwner[owner]) todayByOwner[owner] = { channels: {}, total: 0 };
      todayByOwner[owner].channels[a.channel] = (todayByOwner[owner].channels[a.channel] || 0) + 1;
      todayByOwner[owner].total++;
    });

    const tasksByOwner: Record<string, number> = {};
    (completedTasks || []).forEach(t => {
      const owner = (t.lead as any)?.owner;
      if (owner) tasksByOwner[owner] = (tasksByOwner[owner] || 0) + 1;
    });

    // All owners active today (either touchpoints or tasks)
    const todayOwners = [
      ...new Set([...Object.keys(todayByOwner), ...Object.keys(tasksByOwner)]),
    ].sort();

    // Team totals
    const teamTouchpoints = Object.values(todayByOwner).reduce((s, d) => s + d.total, 0);
    const teamTasks       = Object.values(tasksByOwner).reduce((s, n) => s + n, 0);

    // ── Assemble Slack Block Kit ─────────────────────────────────────────────
    const blocks: object[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "📊 Fuse CRM — End of Day", emoji: true },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `*${dateLabel(today)}*  ·  Team activity — last 4 days`,
        }],
      },
      { type: "divider" },

      // ── 4-day stacked bar chart ──
      {
        type: "image",
        image_url: chartUrl,
        alt_text: "Team activity last 4 days (stacked by person)",
        title: { type: "plain_text", text: "Touchpoints by team member" },
      },

      { type: "divider" },

      // ── Today's table header ──
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Today's activity — ${dateLabel(today)}*\n` +
                `_${teamTouchpoints} touchpoints · ${teamTasks} tasks completed_`,
        },
      },
    ];

    // ── One row per person ───────────────────────────────────────────────────
    if (todayOwners.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_No activity logged today_" },
      });
    } else {
      for (const owner of todayOwners) {
        const d       = todayByOwner[owner] || { channels: {}, inbound: 0, total: 0 };
        const tasks   = tasksByOwner[owner] || 0;
        const first   = owner.split(" ")[0];

        // Channel pills: ✉️ 3  💼 2  📞 1
        const channelStr = CHANNELS
          .filter(c => d.channels[c])
          .map(c => `${CHANNEL_EMOJI[c]} ${d.channels[c]}`)
          .join("  ");

        const statParts: string[] = [];
        if (channelStr)    statParts.push(channelStr);
        if (d.total)       statParts.push(`*${d.total} total*`);
        if (tasks)         statParts.push(`✅ ${tasks} task${tasks > 1 ? "s" : ""} done`);

        // Owner colour dot (matching chart)
        const ownerIdx  = owners.indexOf(owner);
        const colorDot  = ownerIdx >= 0
          ? `\`  \`` // Slack doesn't support coloured text; label is enough
          : "";

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${first}*   ${statParts.length ? statParts.join("  ·  ") : "_No activity_"}`,
          },
        });
      }
    }

    // ── CTA ──────────────────────────────────────────────────────────────────
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text:  { type: "plain_text", text: "Open CRM →", emoji: true },
        url:   "https://fuse-platform.vercel.app",
        style: "primary",
      }],
    });

    await postToSlack({ blocks });

    return new Response(
      JSON.stringify({ success: true, todayTouchpoints: teamTouchpoints, todayTasks: teamTasks }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("slack-activity-digest error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
