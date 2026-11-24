// The one place that talks to Zend. The API key is read from the environment and only ever sent in the x-api-key header.
// Zend documents no idempotency key, so a send (POST) is attempted ONCE: a timeout, a dropped connection or a 5xx may already
// have been delivered and billed, and resending could text someone twice. Only reads (GET) are retried, with backoff.
const { cfg } = require("./config");
const { MessagingError, kindFor } = require("./errors");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// opts: { method, body, timeoutMs, sleepImpl, answer4xx }. answer4xx returns a 4xx body instead of throwing (OTP verify).
async function request(path, opts = {}) {
  const c = cfg();
  const { method = "GET", body, timeoutMs = 10000, sleepImpl = sleep, answer4xx = false } = opts;
  const retries = method === "GET" ? 2 : 0;
  for (let attempt = 0; ; attempt++) {
    let res;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      res = await fetch(`${c.base}${path}`, { method, signal: ctl.signal, headers: { "x-api-key": c.key, "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      clearTimeout(t);
      const kind = e && e.name === "AbortError" ? "TIMEOUT" : "NETWORK";
      if (attempt < retries) { await sleepImpl(400 * 2 ** attempt); continue; }
      throw new MessagingError(kind, 0, "no response from provider"); // a send may still have gone out: reconcile, never resend
    }
    clearTimeout(t);
    const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (res.ok) return { status: res.status, json: json || {} };
    if (RETRYABLE.has(res.status) && attempt < retries) { await sleepImpl(500 * 2 ** attempt); continue; }
    const message = json && typeof json.message === "string" ? json.message : Array.isArray(json && json.message) ? json.message.join("; ") : "";
    if (answer4xx && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) return { status: res.status, json: json || {} };
    throw new MessagingError(kindFor(res.status, message), res.status, message);
  }
}
module.exports = { request };
