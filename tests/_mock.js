// Test helpers: a scripted fetch (no real network ever), a fake req/res, and env control. Fake credentials only.
const calls = [];
let script = [];
const reply = (status, json, headers = {}) => ({ ok: status >= 200 && status < 300, status, text: async () => (json === undefined ? "" : JSON.stringify(json)), json: async () => { if (json === undefined) throw new Error("no body"); return json; }, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
function install(routes) { // routes: array of [matcher(url,opts)->bool, response|fn]
  calls.length = 0; script = routes;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers || {} });
    for (let i = 0; i < script.length; i++) {
      const [m, r] = script[i];
      if (m(String(url), opts)) { const out = typeof r === "function" ? r(String(url), opts) : r; if (out instanceof Error) throw out; return out; }
    }
    throw new Error("unmocked fetch: " + url);
  };
  return calls;
}
const FAKE = { SASUSYNC_API_KEY: "ss_FAKE_KEY_FOR_TESTS", SASUSYNC_SENDER_ID: "BAID X", SASUSYNC_BASE_URL: "https://sms.test", SUPABASE_SERVICE_ROLE_KEY: "fake-service", SUPABASE_URL: "https://db.test" };
function env(over = {}) {
  for (const k of ["SASUSYNC_MODE", "SASUSYNC_SENDER_APPROVED", "SASUSYNC_PHONE_AUTH", "SASUSYNC_OTP_DAILY_CAP"]) delete process.env[k];
  Object.assign(process.env, FAKE, over);
}
function mockRes() {
  const out = { status: 200, json: null, headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(n) { out.status = n; return res; }, json(o) { out.json = o; return res; }, end() { return res; } };
  return { res, out };
}
const run = async (handler, req) => { const { res, out } = mockRes(); req.headers = req.headers || {}; await handler(req, res); return out; };
module.exports = { install, reply, env, run, calls, FAKE };
