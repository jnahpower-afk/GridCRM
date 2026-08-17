// Nightly CRM backup.
//
// Tier 1 (always runs): dumps every public table to CSV into the private
//   Supabase Storage bucket `crm-backups/<YYYY-MM-DD>/<table>.csv`.
// Tier 2 (runs only when Google creds are set): uploads the same CSVs into a
//   dated subfolder of a Google Shared Drive folder via a service account.
// Retention: deletes backup folders older than 30 days from BOTH targets.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-provided)
//   GDRIVE_FOLDER_ID                 (Shared Drive folder: bare id OR full URL)
//   GOOGLE_SERVICE_ACCOUNT_JSON      (service-account key: base64 OR raw JSON)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const BUCKET = "crm-backups";
const RETENTION_DAYS = 30;
const GSA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "";

// Accept a bare folder id, a /folders/<id> URL, or an ?id=<id> URL.
function parseFolderId(raw: string): string {
  const s = (raw ?? "").trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
}
const GDRIVE_FOLDER_ID = parseFolderId(Deno.env.get("GDRIVE_FOLDER_ID") ?? "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResp(b: unknown, s = 200) {
  return new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(","));
  return lines.join("\r\n");
}

// Tables where a nightly full dump is mostly re-copying rows that can never
// change again. `sequence_tasks` is the pathological case: ~95k rows / ~20MB of
// CSV every night, of which only the pending tail and the last few days of
// completions are new. We dump the live slice nightly and take a full snapshot
// weekly, so a full restore point is never more than 7 days old.
//
// Keyed by table → column names that mark a row as recently touched. A row is
// included if it is still open (`openFilter`) or any of `dateCols` is recent.
const INCREMENTAL: Record<string, { openFilter?: [string, string]; dateCols: string[] }> = {
  sequence_tasks: { openFilter: ["status", "pending"], dateCols: ["created_at", "completed_at"] },
};
const INCREMENTAL_WINDOW_DAYS = 7;
// Sunday = full snapshot of everything, ignoring INCREMENTAL.
function isFullDumpDay(d = new Date()): boolean {
  return d.getUTCDay() === 0;
}

function windowStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - INCREMENTAL_WINDOW_DAYS);
  return d.toISOString();
}

async function fetchAll(table: string, full: boolean): Promise<Record<string, unknown>[]> {
  const PAGE = 5000;
  const inc = full ? undefined : INCREMENTAL[table];
  const since = inc ? windowStart() : "";
  let all: Record<string, unknown>[] = [], from = 0;
  while (true) {
    let q = supabase.from(table).select("*");
    if (inc) {
      // PostgREST `or` over: still-open rows, or touched inside the window.
      const clauses = inc.dateCols.map(c => `${c}.gte.${since}`);
      if (inc.openFilter) clauses.push(`${inc.openFilter[0]}.eq.${inc.openFilter[1]}`);
      q = q.or(clauses.join(","));
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data || []);
    if ((data || []).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function londonDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
function cutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return londonDate(d);
}

function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  let s = raw.trim();
  if (!s.startsWith("{")) { s = atob(s.replace(/\s+/g, "")).trim(); }
  try { return JSON.parse(s); } catch { /* repair */ }
  const repaired = s.replace(
    /("private_key"\s*:\s*")([\s\S]*?)("\s*[,}])/,
    (_m, p1, body, tail) => p1 + body.replace(/\r/g, "").replace(/\n/g, "\\n") + tail,
  );
  return JSON.parse(repaired);
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlStr(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function googleToken(): Promise<string> {
  const sa = parseServiceAccount(GSA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64urlBytes(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Google token error: " + JSON.stringify(j));
  return j.access_token;
}

async function driveCreateFolder(token: string, name: string, parent: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  const j = await res.json();
  if (!j.id) throw new Error("Drive folder create failed: " + JSON.stringify(j));
  return j.id;
}

async function driveUploadCsv(token: string, name: string, parent: string, content: string): Promise<void> {
  const boundary = "fuse_crm_backup_boundary";
  const meta = JSON.stringify({ name, parents: [parent] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}` +
    `\r\n--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${content}` +
    `\r\n--${boundary}--`;
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload ${name}: ${await res.text()}`);
}

async function drivePrune(token: string, parent: string, cutoff: string): Promise<number> {
  const q = encodeURIComponent(`'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  let n = 0;
  for (const f of j.files ?? []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoff) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      n++;
    }
  }
  return n;
}

async function storagePrune(cutoff: string): Promise<number> {
  const { data: folders } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  let removed = 0;
  for (const f of folders ?? []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoff) {
      const { data: files } = await supabase.storage.from(BUCKET).list(f.name, { limit: 1000 });
      const paths = (files ?? []).map(x => `${f.name}/${x.name}`);
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
      removed++;
    }
  }
  return removed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const started = Date.now();
  const date = londonDate();
  const driveOn = !!(GDRIVE_FOLDER_ID && GSA_JSON);
  const summary: Record<string, unknown> = { date, drive_enabled: driveOn, drive_folder_id: GDRIVE_FOLDER_ID, tables: [], errors: [] };
  const perTable: { table: string; rows: number; bytes: number; partial: boolean }[] = [];
  const errors: string[] = [];

  try {
    const { data: tables, error: tErr } = await supabase.rpc("list_backup_tables");
    if (tErr) throw new Error("list_backup_tables: " + tErr.message);
    const tableList: string[] = tables || [];

    // Prune BEFORE dumping. It used to run after the 38-table loop and never
    // reached: the loop plus uploads overran the cron's 290s timeout, so the
    // function was killed mid-dump and folders accumulated for ~51 days
    // (1829 files / 1.5GB) despite RETENTION_DAYS being 30. Pruning first is
    // cheap and can't be starved by a slow dump.
    const cutoff = cutoffDate();
    let storagePruned = 0, drivePruned = 0;
    try { storagePruned = await storagePrune(cutoff); } catch (e) { errors.push("storage_prune: " + ((e as Error).message ?? String(e))); }

    let token = "", driveFolderId = "";
    if (driveOn) {
      try {
        token = await googleToken();
        driveFolderId = await driveCreateFolder(token, date, GDRIVE_FOLDER_ID);
      } catch (e) {
        errors.push("drive_setup: " + ((e as Error).message ?? String(e)));
      }
    }

    const fullDump = isFullDumpDay();
    for (const table of tableList) {
      try {
        const partial = !fullDump && !!INCREMENTAL[table];
        const rows = await fetchAll(table, fullDump);
        const csv = toCsv(rows);
        // Name partial dumps distinctly so a restore can never mistake an
        // incremental slice for a complete table.
        const path = `${date}/${table}${partial ? ".partial" : ""}.csv`;
        const bytes = new TextEncoder().encode(csv).length;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(
          path, new Blob(["﻿" + csv], { type: "text/csv" }), { upsert: true, contentType: "text/csv" },
        );
        if (upErr) throw new Error(`storage ${table}: ${upErr.message}`);

        if (driveOn && token && driveFolderId) {
          try { await driveUploadCsv(token, `${table}${partial ? ".partial" : ""}.csv`, driveFolderId, "﻿" + csv); }
          catch (e) { errors.push((e as Error).message ?? String(e)); }
        }

        perTable.push({ table, rows: rows.length, bytes, partial });
      } catch (e) {
        errors.push((e as Error).message ?? String(e));
      }
    }

    if (driveOn && token) {
      try { drivePruned = await drivePrune(token, GDRIVE_FOLDER_ID, cutoff); } catch (e) { errors.push("drive_prune: " + ((e as Error).message ?? String(e))); }
    }

    summary.tables = perTable;
    summary.table_count = perTable.length;
    summary.total_rows = perTable.reduce((s, t) => s + t.rows, 0);
    summary.total_bytes = perTable.reduce((s, t) => s + t.bytes, 0);
    summary.full_dump = fullDump;
    summary.drive_uploaded = driveOn && !!driveFolderId;
    summary.pruned = { storage_folders: storagePruned, drive_folders: drivePruned, cutoff };
    summary.errors = errors;
    summary.ok = errors.length === 0;
    summary.elapsed_ms = Date.now() - started;
    return jsonResp(summary, errors.length ? 207 : 200);
  } catch (e) {
    summary.errors = [...errors, (e as Error).message ?? String(e)];
    summary.ok = false;
    summary.elapsed_ms = Date.now() - started;
    return jsonResp(summary, 500);
  }
});
