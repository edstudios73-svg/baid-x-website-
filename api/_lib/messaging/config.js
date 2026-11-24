// Zend settings (https://tryzend.com/docs). Zend has no sandbox, so nothing is sent until the owner sets MESSAGING_LIVE=true
// after adding ZEND_API_KEY in Vercel. Before that every send is refused with LIVE_DISABLED: nothing is faked or simulated.
// WhatsApp needs a template approved in the Zend dashboard; email needs a verified sending domain (Email -> Domains).
const { MessagingError } = require("./errors");

const on = (v) => String(v || "").toLowerCase() === "true";
const cfg = () => ({
  key: process.env.ZEND_API_KEY || "",
  base: (process.env.ZEND_BASE_URL || "https://api.tryzend.com").replace(/\/+$/, ""),
  sender: process.env.ZEND_SENDER_ID || "", // optional: Zend uses its default sender when empty; a custom one must be approved
  live: on(process.env.MESSAGING_LIVE),
  // the old name keeps phone sign-in on while the owner moves settings over
  phoneAuth: on(process.env.MESSAGING_PHONE_AUTH) || on(process.env.SASUSYNC_PHONE_AUTH),
  otpChannel: String(process.env.ZEND_OTP_CHANNEL || "sms").toLowerCase() === "whatsapp" ? "whatsapp" : "sms",
  emailFrom: process.env.ZEND_EMAIL_FROM || "", // e.g. "BAID X <hello@baid-x.com>", on a domain verified in Zend
  wa: { // approved WhatsApp template ids; each takes the variables named below
    announce: process.env.ZEND_WA_TEMPLATE_ANNOUNCE || "", // {{message}}
    notify: process.env.ZEND_WA_TEMPLATE_NOTIFY || "", // {{title}}
  },
});
const configured = () => !!cfg().key;
const liveAllowed = () => configured() && cfg().live;
const emailReady = () => liveAllowed() && /@[^@\s>]+\.[a-z]{2,}>?$/i.test(cfg().emailFrom.trim());
// Throws unless a real send is allowed. Used by every path that reaches Zend's send endpoints.
function requireLive(what) {
  if (!configured()) throw new MessagingError("NOT_CONFIGURED", 0, "provider credentials missing");
  if (!cfg().live) throw new MessagingError("LIVE_DISABLED", 0, `${what} is off until MESSAGING_LIVE is true`);
}
// The channels Zend will try, in order. WhatsApp is used only with an approved template, and always falls back to SMS.
function channelsFor(kind, wantWhatsApp) {
  const t = cfg().wa[kind];
  return wantWhatsApp && t ? { channels: ["whatsapp", "sms"], templateId: t } : { channels: ["sms"], templateId: null };
}
module.exports = { cfg, configured, liveAllowed, emailReady, requireLive, channelsFor };
