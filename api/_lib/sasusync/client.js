// The one place that talks to SasuSync. The API key is read from the environment and only ever sent in the X-API-Key header.
// Retry policy (per the provider docs): retry 429/500/503 with backoff; never retry 400/401/402/403/404/422;
// a timed-out or dropped LIVE send is NEVER resent (it may already have gone out and been billed).
const { cfg } = require("./config");
const { SasuError, kindFor } = require("./errors");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 503]);

// opts: { method, body, retries, resendOnNetworkError, timeoutMs, sleepImpl }
async function request(path, opts = {}) {
  const c = cfg();
  const { method = "GET", body, retries = 2, resendOnNetworkError = false, timeoutMs = 10000, sleepImpl = sleep } = opts;
  let attempt = 0;
  for (;;) {
    let res;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      res = await fetch(`${c.base}${path}`, { method, signal: ctl.signal, headers: { "X-API-Key": c.key, "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      clearTimeout(t);
      const kind = e && e.name === "AbortError" ? "TIMEOUT" : "NETWORK";
      if (resendOnNetworkError && attempt < retries) { attempt++; await sleepImpl(300 * 2 ** attempt); continue; }
      throw new SasuError(kind, 0, "no response from provider"); // caller must reconcile via status, not resend
    }
    clearTimeout(t);
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (res.ok) return { status: res.status, json: json || {} };
    if (RETRYABLE.has(res.status) && attempt < retries) {
      attempt++;
      const ra = Number(res.headers && res.headers.get && res.headers.get("retry-after"));
      await sleepImpl(ra > 0 && ra <= 10 ? ra * 1000 : 500 * 2 ** attempt);
      continue;
    }
    throw new SasuError(kindFor(res.status), res.status, json && (json.detail || json.message) && typeof (json.detail || json.message) === "string" ? (json.detail || json.message) : "");
  }
}
module.exports = { request };
