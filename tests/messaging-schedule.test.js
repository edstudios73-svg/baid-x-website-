const test = require("node:test");
const assert = require("node:assert/strict");
const { install, reply, env, run } = require("./_mock");
const admin = require("../api/messaging-admin");
const scheduler = require("../api/sms-scheduler");
const { renderTemplate, validateTemplate } = require("../api/_lib/messaging/templates");
const has = (u, s) => u.includes(s);
const LIVEENV = { MESSAGING_LIVE: "true" };
const staffOk = [(u) => has(u, "admin_sms_overview"), reply(200, {})];
const who = (can) => [(u) => has(u, "platform_whoami"), reply(200, { can })];
const userRoute = [(u) => has(u, "/auth/v1/user"), reply(200, { id: "admin-1" })];
const aud = [(u) => has(u, "audit_logs"), reply(201)];
const rl = (ok = true) => [(u) => has(u, "rl_hit"), reply(200, { allowed: ok, count: 1, retry_after_s: 60 })];
const A = { authorization: "Bearer t" };
const post = (body, headers = A) => run(admin, { method: "POST", headers, body });

/* ---------- templates ---------- */
test("templates: personalises with name/first name/role, cleans messy names, falls back to 'there'", () => {
  assert.equal(renderTemplate("Hi {first_name}, welcome {name}! You are a {role}.", { name: "KWAME MENSAH", role: "worker" }), "Hi Kwame, welcome Kwame Mensah! You are a worker.");
  assert.equal(renderTemplate("Hi {first_name}", { name: "  ama   serwaa ", role: "company" }), "Hi Ama");
  assert.equal(renderTemplate("Hi {name}", { name: "Akua O'Neil-Mensah", role: "business" }), "Hi Akua O'Neil-Mensah");
  assert.equal(renderTemplate("Hi {first_name}", { name: "", role: "worker" }), "Hi there"); assert.equal(renderTemplate("Hi {name}", { name: null }), "Hi there");
  assert.equal(renderTemplate("Hi {name}", { name: "Joe http://evil.example/x​" }), "Hi Joe");   // links and zero-width characters never reach the SMS
  assert.ok(renderTemplate("{name}", { name: "x".repeat(200) }).length <= 40);
  assert.equal(renderTemplate("a {role} b", { role: "individual-employer" }), "a client b");
});
test("templates: validation rejects unknown placeholders, stray braces, too short/long", () => {
  assert.equal(validateTemplate("Welcome {first_name}!"), null);
  for (const bad of ["hi", "x".repeat(201), "Hello {nam}", "Hello } there", "{{name}}"]) assert.ok(validateTemplate(bad), bad);
});

/* ---------- admin: schedule / cancel ---------- */
const future = (m = 120) => new Date(Date.now() + m * 60000).toISOString();
const jobIns = [(u, o) => has(u, "/rest/v1/sms_jobs") && o.method === "POST", reply(201, [{ id: "job-1" }])];
const sched = (over = {}) => ({ action: "sms_schedule", roles: ["worker"], sms: true, message: "Big news for workers: new jobs are live.", run_at: future(), confirm: "SCHEDULE BROADCAST", in_app: { title: "News", body: "New jobs are live." }, expected_recipients: 3, ...over });
test("sms_schedule: staff + confirmation + valid time queue one job; nothing is sent now", async () => {
  env(LIVEENV); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
  const r = await post(sched()); assert.equal(r.status, 200); assert.equal(r.json.job_id, "job-1");
  const ins = calls.find((c) => has(c.url, "sms_jobs") && c.method === "POST").body;
  assert.equal(ins.kind, "broadcast"); assert.equal(ins.payload.message, "BAID X: Big news for workers: new jobs are live."); assert.deepEqual(ins.payload.roles, ["worker"]); assert.deepEqual(ins.payload.channels, ["in_app", "sms"]);
  assert.ok(!calls.some((c) => has(c.url, "zend.test")));
});
test("sms_schedule: validation (auth, roles, time window, confirmation, content) refuses without queuing", async () => {
  env(LIVEENV);
  const cases = [[sched(), {}, 401], [sched(), "nonfinance", 403], [sched({ roles: ["worker", "boss"] }), null, 400], [sched({ run_at: future(0) }), null, 400], [sched({ run_at: future(60 * 24 * 100) }), null, 400], [sched({ run_at: "garbage" }), null, 400],
    [sched({ confirm: undefined }), null, 400], [sched({ message: "hi" }), null, 400], [sched({ sms: false, in_app: null }), null, 400], [sched({ sms: false, in_app: { title: "x", body: "y" } }), null, 400]];
  for (const [body, mode, status] of cases) {
    const calls = install([staffOk, who(mode === "nonfinance" ? ["support:READ"] : ["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
    const r = await post(body, mode && typeof mode === "object" ? mode : A); assert.equal(r.status, status, JSON.stringify([body.run_at, mode, status])); assert.ok(!calls.some((c) => has(c.url, "/rest/v1/sms_jobs")));
  }
  const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(false), jobIns, aud]); assert.equal((await post(sched())).status, 429); assert.ok(!calls.some((c) => has(c.url, "/rest/v1/sms_jobs")));
});
test("sms_schedule: in-app only needs no confirmation; a message can be scheduled while live is off (it is checked again when it runs)", async () => {
  env(LIVEENV); install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
  assert.equal((await post(sched({ sms: false, confirm: undefined, message: undefined }))).status, 200);
  env(); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
  const r = await post(sched()); assert.equal(r.status, 200); assert.equal(r.json.live, false); assert.equal(zendPosts(calls).length, 0);
});
test("sms_job_cancel: only a still-queued broadcast can be cancelled", async () => {
  env(LIVEENV); let calls = install([staffOk, who(["finance:ADMINISTER"]), [(u, o) => has(u, "/rest/v1/sms_jobs") && o.method === "PATCH", reply(200, [{ id: "j" }])], aud]);
  const id = "11111111-2222-4333-8444-555555555555"; assert.equal((await post({ action: "sms_job_cancel", job_id: id })).status, 200);
  assert.ok(has(calls.find((c) => c.method === "PATCH").url, "status=eq.queued"));
  install([staffOk, who(["finance:ADMINISTER"]), [(u, o) => has(u, "/rest/v1/sms_jobs") && o.method === "PATCH", reply(200, [])], aud]); assert.equal((await post({ action: "sms_job_cancel", job_id: id })).status, 409);
  assert.equal((await post({ action: "sms_job_cancel", job_id: "x" })).status, 400);
  install([staffOk, who(["support:READ"])]); assert.equal((await post({ action: "sms_job_cancel", job_id: id })).status, 403);
});

/* ---------- admin: automations ---------- */
test("automations: save validates role/template/flag and needs finance permission; master switch needs a boolean", async () => {
  env(LIVEENV); const patch = [(u, o) => has(u, "/rest/v1/sms_automations") && o.method === "PATCH", reply(200, [{ role: "worker" }])];
  let calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, patch, aud]);
  assert.equal((await post({ action: "sms_automation_save", role: "worker", template: "Welcome {first_name}!", enabled: true })).status, 200);
  const b = calls.find((c) => c.method === "PATCH").body; assert.equal(b.template, "Welcome {first_name}!"); assert.equal(b.enabled, true);
  for (const bad of [{ role: "boss" }, { template: "{oops}" }, { template: "x" }, { enabled: "yes" }]) { calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, patch, aud]); assert.equal((await post({ action: "sms_automation_save", role: "worker", template: "Welcome {first_name}!", enabled: true, ...bad })).status, 400, JSON.stringify(bad)); assert.ok(!calls.some((c) => c.method === "PATCH")); }
  install([staffOk, who(["support:READ"]), patch]); assert.equal((await post({ action: "sms_automation_save", role: "worker", template: "Welcome {first_name}!", enabled: true })).status, 403);
  install([staffOk, who(["finance:ADMINISTER"]), [(u, o) => has(u, "platform_settings") && o.method === "PATCH", reply(200, [{ key: "k" }])], aud]); assert.equal((await post({ action: "sms_automations_master", enabled: true })).status, 200);
  install([staffOk, who(["finance:ADMINISTER"])]); assert.equal((await post({ action: "sms_automations_master", enabled: "on" })).status, 400);
});

/* ---------- scheduler ---------- */
const SEC = "sched-secret-fake";
const secretRoute = [(u) => has(u, "app_secrets"), reply(200, [{ v: SEC }])];
const run1 = (jobs, routes) => { const patches = []; const calls = install([secretRoute, [(u) => has(u, "sms_jobs_claim"), reply(200, jobs)], [(u, o) => has(u, "/rest/v1/sms_jobs?id=") && o.method === "PATCH", (u, o) => { patches.push(JSON.parse(o.body)); return reply(204); }], aud, ...routes]); return { calls, patches }; };
const go = () => run(scheduler, { method: "POST", headers: { "x-push-secret": SEC }, body: {} });
const welcomeJob = { id: "w1", kind: "welcome", payload: { user_id: "u-1", role: "worker" }, created_by: "u-1" };
const flags = (master = true, enabled = true, tpl = "Welcome to BAID X, {first_name}! Complete your profile.") => [[(u) => has(u, "platform_settings"), reply(200, [{ value: master }])], [(u) => has(u, "/rest/v1/sms_automations"), reply(200, [{ enabled, template: tpl }])]];
const ctx = (over = {}) => [(u) => has(u, "sms_welcome_context"), reply(200, { role: "worker", name: "KWAME MENSAH", phone: "0552148347", opted_out: false, ...over })];
const zendOk = [(u) => has(u, "zend.test/messages"), reply(200, { id: "msg_9", status: "pending" })];
const zendPosts = (calls) => calls.filter((c) => has(c.url, "zend.test") && c.method === "POST");
const logRoute = [(u) => has(u, "/rest/v1/notification_logs"), reply(201)];

test("scheduler: wrong/missing secret -> 401 and nothing is claimed; no jobs -> ran 0", async () => {
  env(); let calls = install([secretRoute, [(u) => has(u, "sms_jobs_claim"), reply(200, [])]]);
  assert.equal((await run(scheduler, { method: "POST", headers: { "x-push-secret": "bad" }, body: {} })).status, 401); assert.ok(!calls.some((c) => has(c.url, "sms_jobs_claim")));
  assert.equal((await run(scheduler, { method: "GET", headers: {} })).status, 405);
  install([secretRoute, [(u) => has(u, "sms_jobs_claim"), reply(200, [])]]); assert.equal((await go()).json.ran, 0);
});
test("welcome: personal message with the user's first name goes out once through Zend, logged with a masked number, job marked sent", async () => {
  env(LIVEENV); const { calls, patches } = run1([welcomeJob], [...flags(), ctx(), rl(), zendOk, logRoute]);
  const r = await go(); assert.equal(r.json.ran, 1);
  const send = zendPosts(calls); assert.equal(send.length, 1); assert.equal(send[0].body.body, "Welcome to BAID X, Kwame! Complete your profile."); assert.equal(send[0].body.to, "+233552148347"); assert.deepEqual(send[0].body.preferred_channels, ["sms"]);
  assert.equal(patches.length, 1); assert.equal(patches[0].status, "sent"); assert.equal(patches[0].error, null);
  const log = calls.find((c) => has(c.url, "notification_logs") && c.method === "POST").body; assert.equal(log.meta.automation, "welcome"); assert.equal(log.provider, "zend"); assert.ok(!JSON.stringify(log).includes("233552148347") && !JSON.stringify(log).includes("Kwame"));
});
test("welcome: skipped (never sent) when master off, role off, no phone, opted out, bad number, or daily cap reached", async () => {
  const cases = [[flags(false), ctx(), true, "AUTOMATION_OFF"], [flags(true, false), ctx(), true, "AUTOMATION_OFF"], [flags(), ctx({ phone: null }), true, "NO_PHONE"], [flags(), ctx({ opted_out: true }), true, "OPTED_OUT"], [flags(), ctx({ phone: "123" }), true, "INVALID_NUMBER"], [flags(), ctx(), false, "DAILY_CAP"]];
  for (const [f, c, capOk, why] of cases) {
    env(LIVEENV); const { calls, patches } = run1([welcomeJob], [...f, c, rl(capOk), zendOk, logRoute]); await go();
    assert.equal(patches[0].status, "skipped", why); assert.equal(patches[0].error, why); assert.ok(!calls.some((x) => has(x.url, "zend.test")), why);
  }
});
test("welcome: refused while live is off (nothing sent); with the announce template it goes by WhatsApp with SMS fallback", async () => {
  env(); let r = run1([welcomeJob], [...flags(), ctx(), rl(), zendOk, logRoute]); await go(); assert.equal(r.patches[0].error, "LIVE_DISABLED"); assert.equal(zendPosts(r.calls).length, 0);
  env({ ...LIVEENV, ZEND_WA_TEMPLATE_ANNOUNCE: "tmpl_a" }); r = run1([welcomeJob], [...flags(), ctx(), rl(), zendOk, logRoute]); await go();
  assert.equal(r.patches[0].status, "sent"); const b = zendPosts(r.calls)[0].body; assert.deepEqual(b.preferred_channels, ["whatsapp", "sms"]); assert.equal(b.template_id, "tmpl_a");
});
test("welcome: a provider failure or timeout is recorded and NEVER resent", async () => {
  for (const [rsp, err] of [[reply(503, { message: "busy" }), "SERVER"], [new Error("ECONNRESET"), "NETWORK (may have been sent)"]]) {
    env(LIVEENV); const { calls, patches } = run1([welcomeJob], [...flags(), ctx(), rl(), [(u) => has(u, "zend.test/messages"), rsp], logRoute]); await go();
    assert.equal(patches[0].status, "failed"); assert.equal(patches[0].error, err); assert.equal(zendPosts(calls).length, 1);
  }
});
const bJob = (over = {}) => ({ id: "11111111-2222-4333-8444-555555555555", kind: "broadcast", created_by: "admin-1", payload: { roles: ["worker"], sms: true, message: "BAID X: Big news.", parts: 1, in_app: { title: "News", body: "Big news." }, channels: ["in_app", "sms"] }, ...over });
const recs = (n) => [(u) => has(u, "sms_broadcast_recipients"), reply(200, Array.from({ length: n }, (_, i) => ({ user_id: "u" + i, role: "worker", phone: "02" + String(40000000 + i) })))];
const bRows = [[(u, o) => has(u, "/rest/v1/sms_broadcasts") && o.method === "POST", reply(201, [{ id: "bc-1" }])], [(u, o) => has(u, "/rest/v1/sms_broadcasts") && o.method === "PATCH", reply(204)]];
const inApp = [(u) => has(u, "sched_broadcast_inapp"), reply(200, 7)];
test("scheduled broadcast: re-resolves the audience, ONE bulk call with the JOB id as request id, posts the in-app version, marks sent", async () => {
  env(LIVEENV); const { calls, patches } = run1([bJob()], [recs(3), ...bRows, zendOk, inApp]); await go();
  const s = zendPosts(calls); assert.equal(s.length, 1); assert.ok(has(s[0].url, "/messages/bulk")); assert.equal(s[0].body.messages.length, 3);
  assert.equal(calls.find((c) => has(c.url, "/rest/v1/sms_broadcasts") && c.method === "POST").body.request_id, "11111111-2222-4333-8444-555555555555");
  const ia = calls.find((c) => has(c.url, "sched_broadcast_inapp")).body; assert.equal(ia.p_title, "News"); assert.deepEqual(ia.p_roles, ["worker"]);
  assert.equal(patches[patches.length - 1].status, "sent");
});
test("scheduled broadcast: over the limit, live off, or Zend refusing credit -> failed with a reason, in-app still posted, never resent", async () => {
  env({ ...LIVEENV, MESSAGING_BROADCAST_MAX: "2" }); let r = run1([bJob()], [recs(3), ...bRows, zendOk, inApp]); await go();
  assert.equal(r.patches[0].status, "failed"); assert.equal(r.patches[0].error, "OVER_LIMIT"); assert.equal(zendPosts(r.calls).length, 0); assert.ok(r.calls.some((c) => has(c.url, "sched_broadcast_inapp")));
  env(); r = run1([bJob()], [recs(3), ...bRows, zendOk, inApp]); await go(); assert.equal(r.patches[0].error, "LIVE_DISABLED"); assert.equal(zendPosts(r.calls).length, 0);
  env(LIVEENV); r = run1([bJob()], [recs(3), ...bRows, [(u) => has(u, "zend.test/messages/bulk"), reply(400, { statusCode: 400, message: "Insufficient credits for bulk send. Required: 1.000, Available: 0.100." })], inApp]); await go();
  assert.equal(r.patches[0].status, "failed"); assert.equal(r.patches[0].error, "INSUFFICIENT_CREDIT"); assert.equal(zendPosts(r.calls).length, 1);
});
test("scheduled broadcast by email or WhatsApp: refused until that channel is set up; email goes to confirmed login emails", async () => {
  env(LIVEENV); let r = run1([bJob({ payload: { ...bJob().payload, channel: "whatsapp" } })], [recs(2), ...bRows, zendOk, inApp]); await go();
  assert.equal(r.patches[0].error, "CHANNEL_NOT_SET_UP"); assert.equal(zendPosts(r.calls).length, 0);
  env({ ...LIVEENV, ZEND_EMAIL_FROM: "BAID X <hello@baid-x.com>" });
  r = run1([bJob({ payload: { ...bJob().payload, channel: "email", subject: "News", message: "Big news." } })], [recs(2), [(u) => has(u, "/auth/v1/admin/users?page=1"), reply(200, { users: [{ id: "u0", email: "a@x.com", email_confirmed_at: "2026-01-01" }, { id: "u1", email: "b@x.com", email_confirmed_at: "2026-01-01" }] })], ...bRows, [(u) => has(u, "zend.test/email/send"), reply(200, { _id: "e1" })], inApp]); await go();
  assert.equal(r.patches[0].status, "sent"); assert.equal(zendPosts(r.calls).length, 2); assert.ok(zendPosts(r.calls).every((c) => c.body.subject === "News"));
});
test("scheduled broadcast: in-app only job posts the announcement without touching the SMS provider; no recipients -> skipped", async () => {
  env(LIVEENV); let r = run1([bJob({ payload: { roles: [], sms: false, in_app: { title: "T!", body: "Body" }, channels: ["in_app"] } })], [inApp, zendOk]); await go();
  assert.equal(r.patches[0].status, "sent"); assert.ok(!r.calls.some((c) => has(c.url, "zend.test")));
  r = run1([bJob()], [recs(0), ...bRows, zendOk, inApp]); await go(); assert.equal(r.patches[0].status, "skipped"); assert.equal(r.patches[0].error, "NO_RECIPIENTS");
});
test("scheduler: one crashing job never leaves it 'running' and never blocks the next; unknown kinds fail safely", async () => {
  env(LIVEENV); const { patches } = run1([{ id: "x1", kind: "mystery", payload: {} }, { ...welcomeJob, id: "w2" }], [[(u) => has(u, "platform_settings"), new Error("boom")], ctx(), rl(), zendOk, logRoute]); await go();
  assert.equal(patches.length, 2); assert.equal(patches[0].error, "UNKNOWN_KIND"); assert.equal(patches[1].status, "failed"); assert.equal(patches[1].error, "INTERNAL");
});
test("scheduler/automation: no console output and no phone/message leaks in the job results or audit", async () => {
  env(LIVEENV); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  const { calls, patches } = run1([welcomeJob, bJob()], [...flags(), ctx(), rl(), zendOk, logRoute, recs(2), ...bRows, inApp]); await go(); Object.assign(console, o);
  assert.deepEqual(out, []); const text = JSON.stringify([patches, calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body)]); assert.ok(!text.match(/233\d{9}|02\d{8}|Kwame|Big news/));
});
