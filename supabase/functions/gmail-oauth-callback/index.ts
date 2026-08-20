// Supabase Edge Function: gmail-oauth-callback
// Handles the Google OAuth redirect, exchanges the auth code for tokens,
// stores them in user_gmail_settings, then redirects back to the app.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   GMAIL_CLIENT_ID       — from Google Cloud OAuth credentials
//   GMAIL_CLIENT_SECRET   — from Google Cloud OAuth credentials

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLIENT_ID      = Deno.env.get("GMAIL_CLIENT_ID")!;
const CLIENT_SECRET  = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL        = "https://gridcrm-two.vercel.app";

serve(async (req) => {
  const url = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // URL-encoded owner_name

  if (!code || !state) {
    return Response.redirect(`${APP_URL}?gmail_error=missing_params`, 302);
  }

  const ownerName  = decodeURIComponent(state);
  const redirectUri = `${SUPABASE_URL}/functions/v1/gmail-oauth-callback`;

  try {
    // 1. Exchange authorisation code for access + refresh tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      throw new Error(tokens.error_description || "Token exchange failed");
    }

    // 2. Fetch the user's Gmail address to confirm which account was connected
    const userRes  = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json();
    const gmailEmail = userInfo.email as string;

    // 3. Persist tokens (upsert on owner_name)
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Reject a mailbox already claimed by a different owner. Without this, one
    // person completing consent on someone else's Google account silently
    // creates a second row for that mailbox, and gmail-send — which looks the
    // sending account up by owner_name — then sends their outreach from the
    // wrong inbox, with replies landing there too. A unique index on
    // gmail_email backs this up; the check exists to give a usable message.
    const { data: clash } = await supabase
      .from("user_gmail_settings")
      .select("owner_name")
      .eq("gmail_email", gmailEmail)
      .neq("owner_name", ownerName)
      .maybeSingle();

    if (clash) {
      throw new Error(
        `${gmailEmail} is already connected as ${clash.owner_name}. ` +
        `Sign out of Google (or use a private window) and reconnect as ${ownerName}.`
      );
    }

    const { error } = await supabase.from("user_gmail_settings").upsert({
      owner_name:    ownerName,
      gmail_email:   gmailEmail,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? null, // Google only returns refresh_token on first consent
      token_expiry:  new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      updated_at:    new Date().toISOString(),
    }, { onConflict: "owner_name" });

    if (error) throw new Error(error.message);

    // 4. Redirect back to the app with success flag
    return Response.redirect(
      `${APP_URL}?gmail_connected=true&owner=${encodeURIComponent(ownerName)}`,
      302
    );
  } catch (err) {
    console.error("gmail-oauth-callback error:", err);
    return Response.redirect(
      `${APP_URL}?gmail_error=${encodeURIComponent((err as Error).message)}`,
      302
    );
  }
});
