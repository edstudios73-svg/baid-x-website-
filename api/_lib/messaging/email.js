// Email through Zend's POST /email/send. The sender address must be on a domain verified in Zend (Email -> Domains).
// One call per email, never resent. Internal phone-login addresses (…@phone.baidx.invalid) can never receive mail and are refused.
const { cfg, emailReady, requireLive } = require("./config");
const { request } = require("./client");
const { MessagingError } = require("./errors");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const validEmail = (e) => typeof e === "string" && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(e.trim()) && !/\.invalid$/i.test(e.trim());

// BAID X's plain email layout: black on white, the message, then why they got it and how to stop.
function layout(text, footer) {
  const paras = esc(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<div style="font-size:20px;font-weight:bold;letter-spacing:-0.3px;margin-bottom:18px">BAID X</div>${paras}
<hr style="border:0;border-top:1px solid #ddd;margin:22px 0 12px"><p style="font-size:12px;color:#666;line-height:1.5;margin:0">${esc(footer)}</p></div>`;
}
const FOOTER = "You are receiving this because you have a BAID X account. To stop announcements, turn off Announcements in Settings, Notifications. BAID X, East Legon, Accra, Ghana · www.baid-x.com";

async function sendEmail({ to, subject, text, footer = FOOTER }) {
  requireLive("Email");
  if (!emailReady()) throw new MessagingError("EMAIL_NOT_SET_UP", 0, "ZEND_EMAIL_FROM is missing or not an address");
  if (!validEmail(to)) throw new MessagingError("BAD_EMAIL", 0, "invalid recipient");
  const s = String(subject || "").replace(/\s+/g, " ").trim();
  if (s.length < 3 || s.length > 120) throw new MessagingError("BAD_MESSAGE", 0, "subject must be 3-120 characters");
  if (typeof text !== "string" || text.trim().length < 3 || text.length > 5000) throw new MessagingError("BAD_MESSAGE", 0, "message must be 3-5000 characters");
  const r = await request("/email/send", { method: "POST", body: { from: cfg().emailFrom.trim(), to: to.trim(), subject: s, html: layout(text.trim(), footer), text: `${text.trim()}\n\n--\n${footer}` } });
  const id = r.json._id ?? r.json.id; // Zend's email response uses _id
  if (id === undefined || id === null) throw new MessagingError("UNEXPECTED", r.status, "no email id returned");
  return { accepted: true, id: String(id), status: r.json.status || null };
}
module.exports = { sendEmail, validEmail, layout, FOOTER };
