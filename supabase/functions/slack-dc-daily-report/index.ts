// Supabase Edge Function: slack-dc-daily-report
// Renders the Data Centres Daily Report as a SINGLE image and posts it to Slack.
// Sections: 1) Assets-added time series (30d, by person)  2) Team output table
// (last 24h, incl. touch points)  3) Grid Apps Submitted capacity pipeline
// 4) Grid Connection Acqui (DC-lead outbound touches, last 7d, by owner).
// Builds one SVG, rasterises to PNG via resvg-wasm, uploads to the public
// `dc-reports` bucket, then posts an image block to the DC channel.
// ?dryRun=1 (or no webhook) returns the public image URL WITHOUT posting.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const SLACK_WEBHOOK = Deno.env.get("SLACK_DC_GRID_WEBHOOK_URL") || Deno.env.get("SLACK_DC_WEBHOOK_URL") || "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRM_URL = "https://gridcrm-two.vercel.app";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TOUCH_CHANNELS = ["Email", "Call", "LinkedIn", "WhatsApp", "Meeting"];

const OWNER_COLORS: Record<string, string> = {
  "Dany Dbaibo": "#43A047",
  "Cormac Mac Grory": "#16A34A",
};
const PALETTE = ["#43A047", "#2F6FEB", "#E8822E", "#6FBF73", "#9B5DE5", "#E0A82E", "#E84B8A", "#35B0A0"];
const PIPE_PALETTE = ["#F28C3B", "#3DB6D6", "#4CAF50", "#E45B4E", "#9B5DE5", "#E0A82E", "#4A72E0", "#E84B8A", "#35B0A0", "#E0902E", "#8B7BE8"];

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtMwp = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));
function lastDays(n: number): string[] {
  const out: string[] = []; const d = new Date();
  for (let i = 0; i < n; i++) { out.unshift(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1); }
  return out;
}
const dLabel = (ds: string) => { const d = new Date(ds + "T12:00:00"); return `${DOW[d.getDay()]} ${d.getDate()}`; };
const fullDate = (ds: string) => { const d = new Date(ds + "T12:00:00"); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };

let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  await initWasm(fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm"));
  wasmReady = true;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1" || !SLACK_WEBHOOK;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const todayStr = new Date().toISOString().slice(0, 10);
    const days30 = lastDays(30);
    const days7 = lastDays(7);
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since24date = since24.slice(0, 10);

    // ── fetch ──
    const [profsR, featsR, leadsR, surgR, actsR, projR, orR] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email"),
      supabase.from("dc_network_features").select("created_by, type, substation_id, created_at").gte("created_at", days30[0] + "T00:00:00"),
      supabase.from("dc_substation_leads").select("created_by, created_at").gte("created_at", days30[0] + "T00:00:00"),
      supabase.from("dc_grid_surgeries").select("created_by, requested_at, held_at, status"),
      supabase.from("dc_substation_lead_activity").select("created_by, channel, created_at").gte("created_at", since24),
      supabase.from("dc_projects").select("name, mwp, status").eq("status", "Grid App Submitted"),
      supabase.from("private_wire_activity_log").select("date, direction, private_wire_leads!inner(owner, campaign)").eq("private_wire_leads.campaign", "DC").gte("date", days7[0]),
    ]);
    const profs = profsR.data || [];
    const nameOf = (id: string | null) => { const p = profs.find((x: any) => x.id === id); return p ? (p.full_name || p.email || "Unknown") : "Unassigned"; };
    const firstName = (n: string) => n.includes("@") ? (() => { const l = n.split("@")[0].split(/[._-]/).filter(Boolean)[0] || n; return l.charAt(0).toUpperCase() + l.slice(1); })() : n.split(/\s+/)[0];
    const colorFor = (n: string, i: number) => OWNER_COLORS[n] || PALETTE[i % PALETTE.length];

    // ── A: time series (30d, assets by person) ──
    const tsPer: Record<string, Record<string, number>> = {};
    const tsPeopleSet = new Set<string>();
    const tsBump = (date: string | null, id: string | null) => {
      if (!date) return; const dd = date.slice(0, 10); if (!days30.includes(dd)) return;
      const n = nameOf(id); (tsPer[dd] = tsPer[dd] || {})[n] = (tsPer[dd][n] || 0) + 1; tsPeopleSet.add(n);
    };
    (featsR.data || []).forEach((f: any) => { if (f.substation_id || (f.type || "").startsWith("substation")) tsBump(f.created_at, f.created_by); });
    (leadsR.data || []).forEach((l: any) => tsBump(l.created_at, l.created_by));
    const tsPeople = [...tsPeopleSet].sort();

    // ── B: 24h table ──
    type Row = { subs: number; parcels: number; leads: number; sReq: number; sDone: number; touches: number };
    const tbl: Record<string, Row> = {};
    const tb = (id: string | null) => { const n = nameOf(id); return (tbl[n] = tbl[n] || { subs: 0, parcels: 0, leads: 0, sReq: 0, sDone: 0, touches: 0 }); };
    (featsR.data || []).forEach((f: any) => { if (f.created_at >= since24) { if (f.substation_id) tb(f.created_by).parcels++; else if ((f.type || "").startsWith("substation")) tb(f.created_by).subs++; } });
    (leadsR.data || []).forEach((l: any) => { if (l.created_at >= since24) tb(l.created_by).leads++; });
    (surgR.data || []).forEach((s: any) => { if ((s.requested_at || "") >= since24date) tb(s.created_by).sReq++; if (s.status === "held" && (s.held_at || "") >= since24date) tb(s.created_by).sDone++; });
    (actsR.data || []).forEach((a: any) => { if (TOUCH_CHANNELS.includes(a.channel) && a.created_at >= since24) tb(a.created_by).touches++; });
    const rowTot = (r: Row) => r.subs + r.parcels + r.leads + r.sReq + r.sDone + r.touches;
    const tblPeople = Object.keys(tbl).sort((a, b) => rowTot(tbl[b]) - rowTot(tbl[a]));
    const team: Row = { subs: 0, parcels: 0, leads: 0, sReq: 0, sDone: 0, touches: 0 };
    tblPeople.forEach(p => { for (const k of Object.keys(team) as (keyof Row)[]) team[k] += tbl[p][k]; });

    // ── C: capacity pipeline ──
    const pipe = (projR.data || []).map((p: any) => ({ name: p.name || "—", mwp: Number(p.mwp) || 0 })).filter((p: any) => p.mwp > 0).sort((a: any, b: any) => b.mwp - a.mwp);
    const pipeTotal = pipe.reduce((s: number, p: any) => s + p.mwp, 0);

    // ── D: grid connection acqui (DC lead outreach, 7d) ──
    const orPer: Record<string, Record<string, number>> = {};
    const orPeopleSet = new Set<string>();
    (orR.data || []).forEach((r: any) => {
      const owner = (r.private_wire_leads?.owner) || "Unassigned"; const dd = (r.date || "").slice(0, 10);
      if (!days7.includes(dd) || (r.direction || "Outbound") === "Inbound") return;
      (orPer[dd] = orPer[dd] || {})[owner] = (orPer[dd][owner] || 0) + 1; orPeopleSet.add(owner);
    });
    const orPeople = [...orPeopleSet].sort();

    // ══════════ BUILD SVG ══════════
    const W = 1240, PADX = 48, PLOT_L = 92, PLOT_R = 1192;
    const parts: string[] = [];
    let y = 0;
    const T = (x: number, yy: number, s: string, size: number, fill: string, weight = 400, anchor = "start") =>
      parts.push(`<text x="${x}" y="${yy}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`);

    // header
    y = 58; T(PADX, y, "Data Centres — Daily Report", 26, "#F5F5F5", 800);
    y += 26; T(PADX, y, fullDate(todayStr), 14, "#8A8A90", 400);

    // ── section 1 ──
    y += 46; T(PADX, y, "1 · TIME SERIES — ASSETS ADDED · LAST 30 DAYS", 14, "#8A8A90", 700);
    // legend
    y += 26; let lx = PADX;
    tsPeople.forEach((p, i) => { parts.push(`<rect x="${lx}" y="${y - 11}" width="13" height="13" rx="2" fill="${colorFor(p, i)}"/>`); T(lx + 19, y, p, 13, "#C7C7CC"); lx += 26 + p.length * 7.2 + 20; });
    // plot
    const p1Top = y + 24, p1H = 300, p1Bot = p1Top + p1H;
    let maxTot = 1;
    days30.forEach(d => { const t = Object.values(tsPer[d] || {}).reduce((s, n) => s + n, 0); if (t > maxTot) maxTot = t; });
    const step1 = Math.ceil(maxTot / 4);
    for (let g = 0; g <= 4; g++) {
      const v = g * step1; const gy = p1Bot - (v / (step1 * 4)) * p1H;
      parts.push(`<line x1="${PLOT_L}" y1="${gy}" x2="${PLOT_R}" y2="${gy}" stroke="${g === 0 ? "#242428" : "#1C1C1F"}"/>`);
      T(PLOT_L - 12, gy + 4, String(v), 12, "#6E6E74", 400, "end");
    }
    const slot1 = (PLOT_R - PLOT_L) / 30, bw1 = Math.min(slot1 - 3, 26);
    days30.forEach((d, i) => {
      const cx = PLOT_L + (i + 0.5) * slot1; const row = tsPer[d] || {};
      let acc = p1Bot; let tot = 0;
      tsPeople.forEach((p, pi) => {
        const v = row[p] || 0; if (!v) return; tot += v;
        const h = (v / (step1 * 4)) * p1H; acc -= h;
        parts.push(`<rect x="${(cx - bw1 / 2).toFixed(1)}" y="${acc.toFixed(1)}" width="${bw1.toFixed(1)}" height="${h.toFixed(1)}" fill="${colorFor(p, pi)}"/>`);
      });
      if (tot > 0) T(cx, acc - 8, String(tot), 12.5, "#F5F5F5", 700, "middle");
    });
    days30.forEach((d, i) => { if (i % 5 === 0 || i === 29) T(PLOT_L + (i + 0.5) * slot1, p1Bot + 22, dLabel(d), 12, "#6E6E74", 400, "middle"); });
    y = p1Bot + 40;

    // divider
    parts.push(`<line x1="${PADX}" y1="${y}" x2="${W - PADX}" y2="${y}" stroke="#1C1C1F"/>`);

    // ── section 2: table ──
    y += 34; T(PADX, y, "2 · TEAM OUTPUT — LAST 24 HOURS", 14, "#8A8A90", 700);
    const cols = [
      { label: "Subs", x: 560 }, { label: "Parcels", x: 680 }, { label: "Leads", x: 800 },
      { label: "Surg req", x: 930 }, { label: "Surg done", x: 1050 }, { label: "Touch pts", x: 1140 }, { label: "Total", x: 1192 },
    ];
    y += 30; T(PADX, y, "PERSON", 11, "#8A8A90", 700);
    cols.forEach(c => T(c.x, y, c.label.toUpperCase(), 11, "#8A8A90", 700, "end"));
    y += 8; parts.push(`<line x1="${PADX}" y1="${y}" x2="${W - PADX}" y2="${y}" stroke="#242428"/>`);
    const drawRow = (label: string, r: Row, bold: boolean) => {
      y += 30; T(PADX, y, label, 13, bold ? "#C7C7CC" : "#E8E8EA", bold ? 800 : 600);
      const vals = [r.subs, r.parcels, r.leads, r.sReq, r.sDone, r.touches, rowTot(r)];
      vals.forEach((v, idx) => { const last = idx === vals.length - 1; T(cols[idx].x, y, String(v), 13, v === 0 && !last && !bold ? "#6E6E74" : "#F5F5F5", last || bold ? 800 : 400, "end"); });
      y += 8; parts.push(`<line x1="${PADX}" y1="${y}" x2="${W - PADX}" y2="${y}" stroke="#1C1C1F"/>`);
    };
    tblPeople.forEach(p => drawRow(firstName(p), tbl[p], false));
    drawRow("Team", team, true);
    y += 24; T(PADX, y, "Touch points = substation-lead activity by channel.", 11, "#6E6E74");

    // divider
    y += 24; parts.push(`<line x1="${PADX}" y1="${y}" x2="${W - PADX}" y2="${y}" stroke="#1C1C1F"/>`);

    // ── section 3: capacity pipeline ──
    y += 34; T(PADX, y, "3 · GRID APPS SUBMITTED — CAPACITY PIPELINE", 14, "#8A8A90", 700);
    y += 22; const barTop = y, barH = 56, barL = PADX, barR = 1116, barW = barR - barL;
    let segX = barL;
    pipe.forEach((p: any, i: number) => {
      const w = pipeTotal > 0 ? (p.mwp / pipeTotal) * barW : 0;
      parts.push(`<rect x="${segX.toFixed(1)}" y="${barTop}" width="${w.toFixed(1)}" height="${barH}" fill="${PIPE_PALETTE[i % PIPE_PALETTE.length]}"/>`);
      if (p.mwp >= 2) T(segX + w / 2, barTop + barH / 2 + 5, fmtMwp(p.mwp), 13, "#FFFFFF", 800, "middle");
      segX += w;
    });
    T(1192, barTop + barH / 2 + 8, fmtMwp(pipeTotal), 24, "#F5F5F5", 800, "end");
    // axis
    const axisY = barTop + barH + 16;
    [0, 7, 14, 21, 28].filter(v => v <= pipeTotal).forEach(v => { const x = barL + (v / pipeTotal) * barW; T(x, axisY, String(v), 10, "#6E6E74", 400, x === barL ? "start" : "middle"); });
    T(barL + barW / 2, axisY + 14, "MWp", 10, "#6E6E74", 400, "middle");
    // legend
    y = axisY + 34; lx = PADX; let ly = y;
    pipe.forEach((p: any, i: number) => {
      const wpx = 24 + p.name.length * 6.6 + 22;
      if (lx + wpx > W - PADX) { lx = PADX; ly += 22; }
      parts.push(`<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${PIPE_PALETTE[i % PIPE_PALETTE.length]}"/>`);
      T(lx + 15, ly, p.name, 11, "#C7C7CC"); lx += wpx;
    });
    y = ly + 24;

    // divider
    parts.push(`<line x1="${PADX}" y1="${y}" x2="${W - PADX}" y2="${y}" stroke="#1C1C1F"/>`);

    // ── section 4: grid connection acqui (7d) ──
    y += 34; T(PADX, y, "4 · GRID CONNECTION ACQUI", 14, "#8A8A90", 700);
    y += 22; T(PADX, y, "Stacked by owner. Each unit = one outbound touch on that date. · Last 7 days (DC leads)", 12, "#8A8A90");
    // legend
    y += 26; lx = PADX;
    orPeople.forEach((p, i) => { parts.push(`<rect x="${lx}" y="${y - 11}" width="13" height="13" rx="2" fill="${colorFor(p, i)}"/>`); T(lx + 19, y, p, 13, "#C7C7CC"); lx += 26 + p.length * 7.2 + 20; });
    const p4Top = y + 22, p4H = 200, p4Bot = p4Top + p4H;
    let maxO = 1;
    days7.forEach(d => { const t = Object.values(orPer[d] || {}).reduce((s, n) => s + n, 0); if (t > maxO) maxO = t; });
    const step4 = Math.ceil(maxO / 2);
    for (let g = 0; g <= 2; g++) { const v = g * step4; const gy = p4Bot - (v / (step4 * 2)) * p4H; parts.push(`<line x1="${PLOT_L}" y1="${gy}" x2="${PLOT_R}" y2="${gy}" stroke="${g === 0 ? "#242428" : "#1C1C1F"}"/>`); T(PLOT_L - 12, gy + 4, String(v), 12, "#6E6E74", 400, "end"); }
    const slot4 = (PLOT_R - PLOT_L) / 7, bw4 = Math.min(slot4 - 6, 30);
    let anyO = false;
    days7.forEach((d, i) => {
      const cx = PLOT_L + (i + 0.5) * slot4; const row = orPer[d] || {}; let acc = p4Bot; let tot = 0;
      orPeople.forEach((p, pi) => { const v = row[p] || 0; if (!v) return; anyO = true; tot += v; const h = (v / (step4 * 2)) * p4H; acc -= h; parts.push(`<rect x="${(cx - bw4 / 2).toFixed(1)}" y="${acc.toFixed(1)}" width="${bw4.toFixed(1)}" height="${h.toFixed(1)}" fill="${colorFor(p, pi)}"/>`); });
      if (tot > 0) T(cx, acc - 8, String(tot), 12.5, "#F5F5F5", 700, "middle");
    });
    if (!anyO) T((PLOT_L + PLOT_R) / 2, p4Top + p4H / 2, "No outreach logged in the last 7 days", 13, "#5A5A60", 400, "middle");
    days7.forEach((d, i) => T(PLOT_L + (i + 0.5) * slot4, p4Bot + 22, dLabel(d), 12, "#6E6E74", 400, "middle"));
    y = p4Bot + 46;

    const H = y + 20;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, sans-serif"><rect width="${W}" height="${H}" fill="#0A0A0B"/>${parts.join("")}</svg>`;

    // ── rasterise ──
    await ensureWasm();
    const [fr, fb] = await Promise.all([
      fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf").then(r => r.arrayBuffer()),
      fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf").then(r => r.arrayBuffer()),
    ]);
    const resvg = new Resvg(svg, { background: "#0A0A0B", fitTo: { mode: "width", value: W * 2 }, font: { fontBuffers: [new Uint8Array(fr), new Uint8Array(fb)], defaultFontFamily: "DejaVu Sans", loadSystemFonts: false } });
    const png = resvg.render().asPng();

    // ── upload ──
    const path = `daily/${todayStr}-${Date.now()}.png`;
    const up = await supabase.storage.from("dc-reports").upload(path, png, { contentType: "image/png", upsert: true });
    if (up.error) throw new Error("upload failed: " + up.error.message);
    const publicUrl = supabase.storage.from("dc-reports").getPublicUrl(path).data.publicUrl;

    if (dryRun) {
      return new Response(JSON.stringify({ dryRun: true, publicUrl, svgHeight: H, pngBytes: png.length }, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    const res = await fetch(SLACK_WEBHOOK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: [
        { type: "image", image_url: publicUrl, alt_text: "Data Centres Daily Report" },
        { type: "context", elements: [{ type: "mrkdwn", text: `<${CRM_URL}|Open CRM →>` }] },
      ] }),
    });
    if (!res.ok) throw new Error(`Slack error: ${res.status} ${await res.text()}`);
    return new Response(JSON.stringify({ success: true, publicUrl }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("slack-dc-daily-report error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
