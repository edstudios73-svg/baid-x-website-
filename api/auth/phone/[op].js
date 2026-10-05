// One serverless function for the phone-auth endpoints (the Hobby plan caps a deployment at 12 functions):
//   /api/auth/phone/start | verify | login | password   ->   handlers in api/_lib/phoneauth/
const handlers = { start: require("../../_lib/phoneauth/start"), verify: require("../../_lib/phoneauth/verify"), login: require("../../_lib/phoneauth/login"), password: require("../../_lib/phoneauth/password") };

// The BAID X Flutter app's web build may run on another origin (flutter run -d chrome on localhost,
// or a Vercel preview). Native apps send no Origin and are unaffected. No cookies are used, so this
// only lets those pages read the JSON reply; rate limits and passwords still guard every call.
const ALLOWED = [/^https:\/\/baid-x-website(-[a-z0-9-]+)?\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
function cors(req, res) {
  const origin = String((req.headers && req.headers.origin) || "");
  if (!origin || !ALLOWED.some((re) => re.test(origin))) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

module.exports = (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const h = Object.prototype.hasOwnProperty.call(handlers, String(req.query && req.query.op)) ? handlers[req.query.op] : null;
  if (!h) return res.status(404).end();
  return h(req, res);
};
