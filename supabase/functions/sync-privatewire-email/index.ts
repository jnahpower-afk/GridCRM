// Supabase Edge Function: sync-privatewire-email
// Hourly Gmail → Private Wire "Touch point" sync.
//
// For each connected mailbox (user_gmail_settings), reads recent Gmail messages
// and, when the other party's address matches a private_wire_contacts email,
// logs an Email touch on that contact's lead:
//   - Outbound touch when the mailbox owner sent it
//   - Inbound touch (marked as a response) when the contact sent it
// Covers both PW and DC leads (they share private_wire_contacts / _leads).
//
// Dedup: each activity row carries the Gmail message id, and a UNIQUE index
// (uq_pw_activity_gmail_msg) makes each message log exactly once — so the
// hourly re-scan is idempotent. "Going forward only": on a mailbox's first run
// we just stamp pw_synced_at=now and skip history; later runs scan since then.
//
// ?dryRun=1 reports what it WOULD log without writing.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLIENT_ID     = Deno.env.get("GMAIL_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
// Overlap buffer so an email near a run boundary can't slip through the gap.
const LOOKBACK_BUFFER_MS = 90 * 60 * 1000; // 90 min

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

// Extract a bare lowercase email from a header value like `Name <a@b.com>`.
function parseAddrs(headerVal: string | undefined): string[] {
  if (!headerVal) return [];
  return headerVal.split(",").map(part => {
    const m = part.match(/<([^>]+)>/);
    return (m ? m[1] : part).trim().toLowerCase();
  }).filter(a => a.includes("@"));
}
const header = (headers: any[], name: string) =>
  headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

async function refreshToken(refresh_token: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token, grant_type: "refresh_token" }),
  });
  const j = await res.json();
  return j.access_token ?? null;
}

serve(async (req) => {
  try {
    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const nowIso = new Date().toISOString();

    // ── Build email → {lead_id, contact_id} map (PW + DC contacts) ──
    const emailMap = new Map<string, { lead_id: string; contact_id: string }>();
    for (let from = 0; ; from += 5000) {
      const { data, error } = await supabase
        .from("private_wire_contacts")
        .select("id, lead_id, email")
        .not("email", "is", null)
        .order("id")
        .range(from, from + 4999);
      if (error) throw error;
      for (const c of data || []) {
        const e = (c.email || "").trim().toLowerCase();
        if (e && c.lead_id && !emailMap.has(e)) emailMap.set(e, { lead_id: c.lead_id, contact_id: c.id });
      }
      if ((data || []).length < 5000) break;
    }

    // Profiles: gmail_email → profile id (for logged_by attribution).
    const { data: profs } = await supabase.from("profiles").select("id, email");
    const profByEmail = new Map<string, string>();
    for (const p of profs || []) if (p.email) profByEmail.set(p.email.toLowerCase(), p.id);

    // Distinct connected mailboxes (the same address may be linked under two owner names).
    const { data: mailboxes } = await supabase
      .from("user_gmail_settings")
      .select("gmail_email, refresh_token, pw_synced_at")
      .not("refresh_token", "is", null);
    const seen = new Set<string>();
    const distinct = (mailboxes || []).filter(m => {
      const e = (m.gmail_email || "").toLowerCase();
      if (!e || seen.has(e)) return false;
      seen.add(e); return true;
    });

    const summary: any[] = [];

    for (const mb of distinct) {
      const addr = mb.gmail_email.toLowerCase();
      try {
        // Going-forward-only: first sight of a mailbox just stamps the cursor.
        if (!mb.pw_synced_at) {
          if (!dryRun) await supabase.from("user_gmail_settings").update({ pw_synced_at: nowIso }).eq("gmail_email", mb.gmail_email);
          summary.push({ mailbox: addr, initialised: true, logged: 0 });
          continue;
        }

        const accessToken = await refreshToken(mb.refresh_token);
        if (!accessToken) { summary.push({ mailbox: addr, error: "token refresh failed" }); continue; }

        const afterSec = Math.floor((new Date(mb.pw_synced_at).getTime() - LOOKBACK_BUFFER_MS) / 1000);
        const q = encodeURIComponent(`after:${afterSec} -in:chats -in:drafts`);

        // List message ids in the window (one page; a 1h window is small).
        const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=200`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const listJson = await listRes.json();
        if (!listRes.ok) { summary.push({ mailbox: addr, error: listJson.error?.message ?? `list ${listRes.status}` }); continue; }
        const ids: string[] = (listJson.messages || []).map((m: any) => m.id);

        const rows: any[] = [];
        for (const id of ids) {
          const mRes = await fetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!mRes.ok) continue;
          const msg = await mRes.json();
          const hs = msg.payload?.headers || [];
          const fromAddrs = parseAddrs(header(hs, "From"));
          const sentByOwner = fromAddrs.includes(addr);
          const direction = sentByOwner ? "Outbound" : "Inbound";
          // The "other party" is who we try to match to a contact.
          const others = sentByOwner
            ? [...parseAddrs(header(hs, "To")), ...parseAddrs(header(hs, "Cc"))]
            : fromAddrs;
          let match: { lead_id: string; contact_id: string } | undefined;
          for (const o of others) { if (emailMap.has(o)) { match = emailMap.get(o); break; } }
          if (!match) continue;

          const dateStr = new Date(Number(msg.internalDate)).toISOString().slice(0, 10);
          rows.push({
            lead_id: match.lead_id,
            contact_id: match.contact_id,
            date: dateStr,
            channel: "Email",
            direction,
            notes: header(hs, "Subject") || "(no subject)",
            response: direction === "Inbound",
            logged_by: profByEmail.get(addr) ?? null,
            gmail_message_id: id,
            created_at: nowIso,
          });
        }

        if (!dryRun) {
          if (rows.length) {
            // ignoreDuplicates → the UNIQUE gmail_message_id index makes re-runs no-ops.
            await supabase.from("private_wire_activity_log").upsert(rows, { onConflict: "gmail_message_id", ignoreDuplicates: true });
          }
          await supabase.from("user_gmail_settings").update({ pw_synced_at: nowIso }).eq("gmail_email", mb.gmail_email);
        }
        summary.push({ mailbox: addr, scanned: ids.length, matched: rows.length });
      } catch (e) {
        summary.push({ mailbox: addr, error: (e as Error).message });
      }
    }

    return json({ ok: true, dryRun, contacts_indexed: emailMap.size, mailboxes: summary });
  } catch (err) {
    console.error("sync-privatewire-email error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
