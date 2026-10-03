// Run: node --test tests/   (no network, no SasuSync calls, no credits)
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const fs = require("node:fs");
const handler = require("../api/webhooks/sasusync");
const lib = require("../api/_lib/sasusync-webhook");

const SECRET = "test-secret-not-a-real-one";
const sign = (raw, secret = SECRET) => crypto.createHmac("sha256", secret).update(raw).digest("hex");

function call({ method = "POST", headers = { "content-type": "application/json" }, body = "", secret = SECRET } = {}) {
  const prev = process.env.SASUSYNC_WEBHOOK_SECRET;
  if (secret === null) delete process.env.SASUSYNC_WEBHOOK_SECRET; else process.env.SASUSYNC_WEBHOOK_SECRET = secret;
  const req = Readable.from(body === null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]);
  req.method = method; req.headers = headers;
  const out = { status: null, json: null, headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(n) { out.status = n; return res; }, json(o) { out.json = o; return res; }, end() { return res; } };
  return handler(req, res).then(() => { if (prev === undefined) delete process.env.SASUSYNC_WEBHOOK_SECRET; else process.env.SASUSYNC_WEBHOOK_SECRET = prev; return out; });
}
const goodBody = JSON.stringify({ event: "delivered", timestamp: "2026-08-02T10:05:15.123456", data: { message_id: "m1", recipient: "233552148347", status: "delivered" } });

test("1. no secret configured: rejected with 503, even when 'signed'", async () => {
  const r = await call({ secret: null, body: goodBody, headers: { "content-type": "application/json", "x-webhook-signature": sign(goodBody) } });
  assert.equal(r.status, 503);
});
test("2. no signature header: rejected 401", async () => {
  assert.equal((await call({ body: goodBody })).status, 401);
});
test("3. invalid signature: rejected 401 (wrong value, wrong secret, wrong length, junk)", async () => {
  for (const sig of [sign(goodBody + " "), sign(goodBody, "other"), "abcd", "z".repeat(64), "sha256=" + sign(goodBody)]) {
    assert.equal((await call({ body: goodBody, headers: { "content-type": "application/json", "x-webhook-signature": sig } })).status, 401, sig.slice(0, 12));
  }
});
test("4. valid signature: accepted 200", async () => {
  const r = await call({ body: goodBody, headers: { "content-type": "application/json", "x-webhook-signature": sign(goodBody) } });
  assert.equal(r.status, 200); assert.deepEqual(r.json, { received: true });
});
test("5. valid signature but malformed JSON: 400, no crash", async () => {
  const bad = "{not json";
  assert.equal((await call({ body: bad, headers: { "content-type": "application/json", "x-webhook-signature": sign(bad) } })).status, 400);
});
test("6. unsupported methods rejected 405 with Allow: POST", async () => {
  for (const m of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) { const r = await call({ method: m }); assert.equal(r.status, 405, m); assert.equal(r.headers.allow, "POST"); }
});
test("7. verification uses the exact raw bytes (whitespace / key order / unicode are not normalised)", async () => {
  const pretty = '{\n  "event": "sent",\n  "data": { "message_id": "é-1" }\n}\n';
  assert.equal((await call({ body: pretty, headers: { "content-type": "application/json", "x-webhook-signature": sign(pretty) } })).status, 200);
  const reserialised = JSON.stringify(JSON.parse(pretty)); // same data, different bytes
  assert.notEqual(reserialised, pretty);
  assert.equal((await call({ body: pretty, headers: { "content-type": "application/json", "x-webhook-signature": sign(reserialised) } })).status, 401);
});
test("8. comparison is constant-time (timingSafeEqual) and rejects length mismatch without throwing", async () => {
  const src = fs.readFileSync(require.resolve("../api/_lib/sasusync-webhook"), "utf8");
  assert.match(src, /crypto\.timingSafeEqual/); assert.doesNotMatch(src, /===\s*got|got\s*===|==\s*expected/);
  assert.equal(lib.signatureMatches(Buffer.from("x"), SECRET, "ab"), false);
  assert.equal(lib.signatureMatches(Buffer.from("x"), SECRET, undefined), false);
  assert.equal(lib.signatureMatches(Buffer.from("x"), "", sign("x", "")), false);
  assert.equal(lib.signatureMatches(Buffer.from("x"), SECRET, sign("x").toUpperCase()), true); // hex case is not meaningful
});
test("extra: non-JSON content-type 415, oversize body 413, secret never appears in source logging", async () => {
  assert.equal((await call({ body: goodBody, headers: { "content-type": "text/plain", "x-webhook-signature": sign(goodBody) } })).status, 415);
  const big = JSON.stringify({ pad: "x".repeat(lib.MAX_BODY_BYTES + 10) });
  assert.equal((await call({ body: big, headers: { "content-type": "application/json", "x-webhook-signature": sign(big) } })).status, 413);
  for (const f of ["../api/webhooks/sasusync.js", "../api/_lib/sasusync-webhook.js"]) assert.doesNotMatch(fs.readFileSync(require.resolve(f), "utf8"), /console\.(log|error|warn|info)/);
});

test("9. Vercel-style lazy req.body: the stream is read first and req.body is never touched", async () => {
  let touched = false;
  const prev = process.env.SASUSYNC_WEBHOOK_SECRET; process.env.SASUSYNC_WEBHOOK_SECRET = SECRET;
  const req = Readable.from([Buffer.from(goodBody)]); req.method = "POST"; req.headers = { "content-type": "application/json", "x-webhook-signature": sign(goodBody) };
  Object.defineProperty(req, "body", { get() { touched = true; return JSON.parse(goodBody); } }); // what Vercel's helper does on first access
  const out = { status: null }; const res = { setHeader() {}, status(n) { out.status = n; return res; }, json() { return res; }, end() { return res; } };
  await handler(req, res); if (prev === undefined) delete process.env.SASUSYNC_WEBHOOK_SECRET; else process.env.SASUSYNC_WEBHOOK_SECRET = prev;
  assert.equal(out.status, 200); assert.equal(touched, false);
});
