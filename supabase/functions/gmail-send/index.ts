// Supabase Edge Function: gmail-send
// Sends an HTML email on behalf of a team member via their connected Gmail account.
// - Converts plain-text body to HTML
// - Replaces the calendar link URL with a styled "Book a meeting" anchor
// - Appends a branded Fuse Energy signature with logo
//
// POST body (JSON):
//   owner_name    string  — team member name, e.g. "Laurie Campbell"
//   to            string  — recipient email address
//   subject       string  — email subject line
//   body          string  — plain-text body (substitutions already applied by caller)
//   calendar_link string? — raw calendar URL to replace with "Book a meeting" link

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLIENT_ID     = Deno.env.get("GMAIL_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LOGO_URL      = "https://fuse-platform.vercel.app/favicon.svg";
const BRAND_COLOR   = "#F8632C";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Escape special HTML characters
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Convert plain text → HTML, replace calendar URL, append signature
function buildHtml(body: string, calendarLink: string | undefined, ownerName: string): string {
  // Escape then convert newlines to <br>
  let html = escapeHtml(body).replace(/\n/g, "<br>\n");

  // Replace "Book a meeting →" placeholder (set by the frontend) with a proper anchor
  if (calendarLink && calendarLink.trim()) {
    const escaped = escapeHtml(calendarLink.trim());
    // The frontend substitutes {{calendar_link}} → "Book a meeting →", so we wrap that text with the anchor.
    // Also handle the raw URL as a fallback (in case the body still contains it).
    html = html.replace(
      /Book a meeting →/g,
      `<a href="${escaped}" style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">Book a meeting →</a>`
    );
    const regexSafe = escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(
      new RegExp(regexSafe, "g"),
      `<a href="${escaped}" style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">Book a meeting →</a>`
    );
  }

  // Branded signature
  const signature = `
<br><br>
<div style="border-top:1px solid #e5e7eb;margin-top:20px;padding-top:16px;max-width:500px">
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding-right:12px;vertical-align:middle">
        <img src="${LOGO_URL}" width="40" height="40" alt="Fuse Energy"
          style="display:block;border-radius:8px;border:0">
      </td>
      <td style="vertical-align:middle">
        <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#111111;margin-bottom:2px">${escapeHtml(ownerName)}</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#555555;line-height:1.5">Fuse Energy</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#555555;line-height:1.5">
          <a href="https://fuseenergy.com" style="color:#555555;text-decoration:none;">fuseenergy.com</a>
        </div>
      </td>
    </tr>
  </table>
</div>`;

  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#222222;max-width:600px">${html}${signature}</div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { owner_name, to, subject, body, calendar_link } = await req.json();

    const missing = [];
    if (!owner_name) missing.push("owner_name");
    if (!to)         missing.push("to");
    if (!body)       missing.push("body");
    if (missing.length > 0) {
      return jsonResponse({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
    }

    const emailSubject = subject?.trim() || "(no subject)";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: settings, error: fetchErr } = await supabase
      .from("user_gmail_settings")
      .select("access_token, refresh_token, token_expiry, gmail_email")
      .eq("owner_name", owner_name)
      .single();

    if (fetchErr || !settings?.refresh_token) {
      return jsonResponse({ error: `Gmail not connected for "${owner_name}". Please connect Gmail first.` }, 403);
    }

    // Refresh the access token if expiring within 60 seconds
    let accessToken = settings.access_token;
    const expiry    = settings.token_expiry ? new Date(settings.token_expiry) : null;
    if (!expiry || expiry <= new Date(Date.now() + 60_000)) {
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: settings.refresh_token,
          grant_type:    "refresh_token",
        }),
      });
      const refreshed = await refreshRes.json();
      if (!refreshed.access_token) throw new Error("Token refresh failed — user may need to reconnect Gmail");

      accessToken = refreshed.access_token;
      await supabase.from("user_gmail_settings").update({
        access_token: accessToken,
        token_expiry: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
        updated_at:   new Date().toISOString(),
      }).eq("owner_name", owner_name);
    }

    // Build HTML email body with calendar link replacement and signature
    const htmlBody = buildHtml(body, calendar_link, owner_name);

    // Build RFC 2822 MIME message with HTML content type
    const mime = [
      `From: ${owner_name} <${settings.gmail_email}>`,
      `To: ${to}`,
      `Subject: ${emailSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      htmlBody,
    ].join("\r\n");

    // Base64url encode
    const encoded = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const sendRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      }
    );

    const result = await sendRes.json();
    if (!sendRes.ok) {
      throw new Error(result.error?.message ?? `Gmail API ${sendRes.status}`);
    }

    return jsonResponse({ success: true, messageId: result.id });
  } catch (err) {
    console.error("gmail-send error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
