// Mode guard. Sandbox is the default. Live needs SASUSYNC_MODE=live AND SASUSYNC_SENDER_APPROVED=true (set by the owner only after
// the portal shows the sender as approved). There is no silent fallback between live and sandbox: a disallowed call throws.
const { SasuError } = require("./errors");
const cfg = () => ({
  key: process.env.SASUSYNC_API_KEY || "",
  sender: process.env.SASUSYNC_SENDER_ID || "",
  base: (process.env.SASUSYNC_BASE_URL || "https://sms.sasusync.com").replace(/\/+$/, ""),
  mode: String(process.env.SASUSYNC_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox",
  senderApproved: process.env.SASUSYNC_SENDER_APPROVED === "true",
  phoneAuth: process.env.SASUSYNC_PHONE_AUTH === "true",
});
const configured = () => { const c = cfg(); return !!(c.key && c.sender); };
const liveAllowed = () => { const c = cfg(); return c.mode === "live" && c.senderApproved; };
// Throws unless a live provider call is explicitly allowed. Used by every live-only endpoint (OTP has no sandbox).
function requireLive(what) {
  if (!configured()) throw new SasuError("NOT_CONFIGURED", 0, "provider credentials missing");
  if (!liveAllowed()) throw new SasuError("LIVE_DISABLED", 0, `${what} is disabled until the sender is approved and live mode is enabled`);
}
module.exports = { cfg, configured, liveAllowed, requireLive };
