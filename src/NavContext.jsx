import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";

// ─── NAVIGATION STORE ─────────────────────────────────────────────────────────
// Single source of truth for "where am I" across the CRM, backed by the browser
// history stack so both the in-app back/forward buttons AND the browser's own
// back/forward behave the same. Synced to the URL hash (URLSearchParams) so a
// refresh restores your place and locations are shareable as deep links.
//
// A `location` is a plain serialisable object. Non-serialisable payloads (the
// full project / org object needed for instant render) ride alongside in an
// in-memory map keyed by history position; on a cold deep-link the payload is
// absent and the consuming component resolves the entity from its own data.

const NavContext = createContext(null);

// Fields that participate in the URL. Order here = order in the hash.
const URL_KEYS = ["section", "subView", "viewMode", "org", "portfolioView", "project"];

function normalize(loc) {
  const next = { ...loc };
  if (!next.section) next.section = "topOfFunnel";
  if (next.section === "topOfFunnel" && !next.subView) next.subView = "privateWire";
  if (next.section === "portfolio" && !next.portfolioView) next.portfolioView = "portfolio";
  return next;
}

function serialize(loc) {
  const p = new URLSearchParams();
  for (const k of URL_KEYS) {
    if (loc[k]) p.set(k, loc[k]);
  }
  const s = p.toString();
  return s ? "#" + s : "#";
}

function parse(hash) {
  const p = new URLSearchParams((hash || "").replace(/^#/, ""));
  const loc = {};
  for (const k of URL_KEYS) {
    const v = p.get(k);
    if (v) loc[k] = v;
  }
  return normalize(loc);
}

// A Supabase auth redirect lands with the session in the URL (implicit flow puts
// tokens in the hash; PKCE/errors use the query). We must NOT rewrite the URL
// before the auth client has consumed it, or the tokens are wiped and login
// bounces back to the provider in a loop.
function isAuthCallback() {
  if (typeof window === "undefined") return false;
  const h = window.location.hash || "";
  const s = window.location.search || "";
  return /(?:^|[#&])(access_token|refresh_token|provider_token|expires_in|error_description|error_code|error)=/.test(h)
    || /[?&](code|error)=/.test(s)
    || /(?:^|[#&])type=(recovery|signup|magiclink|invite|email_change)/.test(h);
}

export function NavProvider({ children }) {
  const initial = parse(typeof window !== "undefined" ? window.location.hash : "");

  const [location, setLocation] = useState(initial);
  const [pos, setPos] = useState(0);   // current index in the logical stack
  const [len, setLen] = useState(1);   // logical stack length

  const locRef = useRef(initial);
  const posRef = useRef(0);
  const lenRef = useRef(1);
  const payloadsRef = useRef({ 0: undefined }); // history index → payload object

  // Seed the initial history entry so popstate always has state to read — but
  // never during a Supabase auth callback, or we'd wipe the session tokens from
  // the URL before the auth client reads them (causes a Google login loop).
  useEffect(() => {
    if (isAuthCallback()) return;
    window.history.replaceState({ _seq: 0 }, "", serialize(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback((loc, seq, payload) => {
    locRef.current = loc;
    posRef.current = seq;
    payloadsRef.current[seq] = payload;
    setLocation(loc);
    setPos(seq);
    setLen(lenRef.current);
  }, []);

  const navigate = useCallback((patch, opts = {}) => {
    const next = normalize({ ...locRef.current, ...patch });
    const same = serialize(next) === serialize(locRef.current);

    if (opts.replace || same) {
      const seq = posRef.current;
      window.history.replaceState({ _seq: seq }, "", serialize(next));
      apply(next, seq, "payload" in opts ? opts.payload : payloadsRef.current[seq]);
      return;
    }

    const seq = posRef.current + 1;
    lenRef.current = seq + 1;
    // Drop any forward payloads that this new branch invalidates.
    Object.keys(payloadsRef.current).forEach((k) => { if (Number(k) >= seq) delete payloadsRef.current[k]; });
    window.history.pushState({ _seq: seq }, "", serialize(next));
    apply(next, seq, opts.payload);
  }, [apply]);

  const back = useCallback(() => { if (posRef.current > 0) window.history.back(); }, []);
  const forward = useCallback(() => { if (posRef.current < lenRef.current - 1) window.history.forward(); }, []);

  // Go back if there's history, otherwise navigate to an explicit fallback.
  const backOr = useCallback((fallbackPatch) => {
    if (posRef.current > 0) window.history.back();
    else navigate(fallbackPatch, { replace: true });
  }, [navigate]);

  useEffect(() => {
    const onPop = (e) => {
      const seq = e.state?._seq ?? 0;
      posRef.current = seq;
      const next = parse(window.location.hash);
      locRef.current = next;
      setLocation(next);
      setPos(seq);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keyboard shortcuts: ⌘[ / ⌘] (and Alt+←/→) like Linear.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "[") { e.preventDefault(); back(); }
      else if (meta && e.key === "]") { e.preventDefault(); forward(); }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); back(); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); forward(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, forward]);

  const value = {
    location,
    payload: payloadsRef.current[pos],
    navigate,
    back,
    forward,
    backOr,
    canBack: pos > 0,
    canForward: pos < len - 1,
  };

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within a NavProvider");
  return ctx;
}
