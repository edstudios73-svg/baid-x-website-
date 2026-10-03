const test = require("node:test");
const assert = require("node:assert/strict");
const { install, reply, env, run } = require("./_mock");
const admin = require("../api/sasusync-admin");
const scheduler = require("../api/sms-scheduler");
const { renderTemplate, validateTemplate } = require("../api/_lib/sasusync/templates");
const has = (u, s) => u.includes(s);
const LIVEENV = { SASUSYNC_MODE: "live", SASUSYNC_SENDER_APPROVED: "true" };
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
const sched = (over = {}) => ({ action: "sms_schedule", roles: ["worker"], sms: true, message: "Big news for workers: new jobs are live.", run_at: future(), confirm: "SCHEDULE SMS", in_app: { title: "News", body: "New jobs are live." }, expected_recipients: 3, ...over });
test("sms_schedule: staff + confirmation + valid time queue one job; nothing is sent now", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
  const r = await post(sched()); assert.equal(r.status, 200); assert.equal(r.json.job_id, "job-1");
  const ins = calls.find((c) => has(c.url, "sms_jobs") && c.method === "POST").body;
  assert.equal(ins.kind, "broadcast"); assert.equal(ins.payload.message, "BAID X: Big news for workers: new jobs are live."); assert.deepEqual(ins.payload.roles, ["worker"]); assert.deepEqual(ins.payload.channels, ["in_app", "sms"]);
  assert.ok(!calls.some((c) => has(c.url, "sms.test")));
});
test("sms_schedule: validation (auth, roles, time window, confirmation, content) refuses without queuing", async () => {
  env({ SASUSYNC_MODE: "sandbox" });
  const cases = [[sched(), {}, 401], [sched(), "nonfinance", 403], [sched({ roles: ["worker", "boss"] }), null, 400], [sched({ run_at: future(0) }), null, 400], [sched({ run_at: future(60 * 24 * 100) }), null, 400], [sched({ run_at: "garbage" }), null, 400],
    [sched({ confirm: undefined }), null, 400], [sched({ message: "hi" }), null, 400], [sched({ sms: false, in_app: null }), null, 400], [sched({ sms: false, in_app: { title: "x", body: "y" } }), null, 400]];
  for (const [body, mode, status] of cases) {
    const calls = install([staffOk, who(mode === "nonfinance" ? ["support:READ"] : ["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
    const r = await post(body, mode && typeof mode === "object" ? mode : A); assert.equal(r.status, status, JSON.stringify([body.run_at, mode, status])); assert.ok(!calls.some((c) => has(c.url, "/rest/v1/sms_jobs")));
  }
  const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(false), jobIns, aud]); assert.equal((await post(sched())).status, 429); assert.ok(!calls.some((c) => has(c.url, "/rest/v1/sms_jobs")));
});
test("sms_schedule: in-app only needs no SMS confirmation; live-but-unapproved SMS is refused", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]);
  assert.equal((await post(sched({ sms: false, confirm: undefined, message: undefined }))).status, 200);
  env({ SASUSYNC_MODE: "live" }); const calls = install([staffOk, who(["finance:ADMINISTER"]), userRoute, rl(), jobIns, aud]); assert.equal((await post(sched())).status, 409); assert.ok(!calls.some((c) => has(c.url, "/rest/v1/sms_jobs")));
});
test("sms_job_cancel: only a still-queued broadcast can be cancelled", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); let calls = install([staffOk, who(["finance:ADMINISTER"]), [(u, o) => has(u, "/rest/v1/sms_jobs") && o.method === "PATCH", reply(200, [{ id: "j" }])], aud]);
  const id = "11111111-2222-4333-8444-555555555555"; assert.equal((await post({ action: "sms_job_cancel", job_id: id })).status, 200);
  assert.ok(has(calls.find((c) => c.method === "PATCH").url, "status=eq.queued"));
  install([staffOk, who(["finance:ADMINISTER"]), [(u, o) => has(u, "/rest/v1/sms_jobs") && o.method === "PATCH", reply(200, [])], aud]); assert.equal((await post({ action: "sms_job_cancel", job_id: id })).status, 409);
  assert.equal((await post({ action: "sms_job_cancel", job_id: "x" })).status, 400);
  install([staffOk, who(["support:READ"])]); assert.equal((await post({ action: "sms_job_cancel", job_id: id })).status, 403);
});

/* ---------- admin: automations ---------- */
test("automations: save validates role/template/flag and needs finance permission; master switch needs a boolean", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const patch = [(u, o) => has(u, "/rest/v1/sms_automations") && o.method === "PATCH", reply(200, [{ role: "worker" }])];
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
const sandboxOk = [(u) => has(u, "/smssandbox/v1/send"), reply(200, { success: true, balance: { deducted: 0 }, data: { job_id: "sandbox_9", status: "queued" } })];
const logRoute = [(u) => has(u, "/rest/v1/notification_logs"), reply(201)];

test("scheduler: wrong/missing secret -> 401 and nothing is claimed; no jobs -> ran 0", async () => {
  env(); let calls = install([secretRoute, [(u) => has(u, "sms_jobs_claim"), reply(200, [])]]);
  assert.equal((await run(scheduler, { method: "POST", headers: { "x-push-secret": "bad" }, body: {} })).status, 401); assert.ok(!calls.some((c) => has(c.url, "sms_jobs_claim")));
  assert.equal((await run(scheduler, { method: "GET", headers: {} })).status, 405);
  install([secretRoute, [(u) => has(u, "sms_jobs_claim"), reply(200, [])]]); assert.equal((await go()).json.ran, 0);
});
test("welcome: personal message with the user's first name goes out once (sandbox here), logged with a masked number, job marked sent", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const { calls, patches } = run1([welcomeJob], [...flags(), ctx(), rl(), sandboxOk, logRoute]);
  const r = await go(); assert.equal(r.json.ran, 1);
  const send = calls.filter((c) => has(c.url, "/smssandbox/v1/send")); assert.equal(send.length, 1); assert.equal(send[0].body.message, "Welcome to BAID X, Kwame! Complete your profile."); assert.deepEqual(send[0].body.recipients, ["233552148347"]);
  assert.equal(patches.length, 1); assert.equal(patches[0].status, "sent"); assert.equal(patches[0].error, null);
  const log = calls.find((c) => has(c.url, "notification_logs") && c.method === "POST").body; assert.equal(log.meta.automation, "welcome"); assert.ok(!JSON.stringify(log).includes("233552148347") && !JSON.stringify(log).includes("Kwame"));
});
test("welcome: skipped (never sent) when master off, role off, no phone, opted out, bad number, or daily cap reached", async () => {
  const cases = [[flags(false), ctx(), true, "AUTOMATION_OFF"], [flags(true, false), ctx(), true, "AUTOMATION_OFF"], [flags(), ctx({ phone: null }), true, "NO_PHONE"], [flags(), ctx({ opted_out: true }), true, "OPTED_OUT"], [flags(), ctx({ phone: "123" }), true, "INVALID_NUMBER"], [flags(), ctx(), false, "DAILY_CAP"]];
  for (const [f, c, capOk, why] of cases) {
    env({ SASUSYNC_MODE: "sandbox" }); const { calls, patches } = run1([welcomeJob], [...f, c, rl(capOk), sandboxOk, logRoute]); await go();
    assert.equal(patches[0].status, "skipped", why); assert.equal(patches[0].error, why); assert.ok(!calls.some((x) => has(x.url, "sms.test")), why);
  }
});
test("welcome (live): refused if live requested but unapproved, or if credit would dip into the OTP reserve; nothing sent", async () => {
  env({ SASUSYNC_MODE: "live" }); let r = run1([welcomeJob], [...flags(), ctx(), rl(), sandboxOk, logRoute]); await go(); assert.equal(r.patches[0].error, "LIVE_DISABLED"); assert.ok(!r.calls.some((x) => has(x.url, "sms.test")));
  env(LIVEENV); r = run1([welcomeJob], [...flags(), ctx(), rl(), [(u) => has(u, "/api/v1/balance"), reply(200, { sms_sendable: 30 })], [(u) => has(u, "/api/v1/send"), reply(200, { success: true })], logRoute]); await go();
  assert.equal(r.patches[0].error, "INSUFFICIENT_CREDIT"); assert.ok(!r.calls.some((x) => has(x.url, "/api/v1/send")));
  env(LIVEENV); r = run1([welcomeJob], [...flags(), ctx(), rl(), [(u) => has(u, "/api/v1/balance"), reply(200, { sms_sendable: 400 })], [(u) => has(u, "/api/v1/send"), reply(200, { success: true, balance: { deducted: 1, remaining: 399 }, data: { job_id: "j9", status: "queued" } })], logRoute]); await go();
  assert.equal(r.patches[0].status, "sent"); assert.equal(r.calls.filter((x) => has(x.url, "/api/v1/send")).length, 1);
});
test("welcome: a provider failure or timeout is recorded and NEVER resent", async () => {
  for (const [rsp, err] of [[reply(503, { detail: "busy" }), "SERVER"], [new Error("ECONNRESET"), "NETWORK (may have been sent)"]]) {
    env(LIVEENV); const { calls, patches } = run1([welcomeJob], [...flags(), ctx(), rl(), [(u) => has(u, "/api/v1/balance"), reply(200, { sms_sendable: 400 })], [(u) => has(u, "/api/v1/send"), rsp], logRoute]); await go();
    assert.equal(patches[0].status, "failed"); assert.equal(patches[0].error, err); assert.equal(calls.filter((x) => has(x.url, "/api/v1/send")).length, 1);
  }
});
const bJob = (over = {}) => ({ id: "11111111-2222-4333-8444-555555555555", kind: "broadcast", created_by: "admin-1", payload: { roles: ["worker"], sms: true, message: "BAID X: Big news.", parts: 1, in_app: { title: "News", body: "Big news." }, channels: ["in_app", "sms"] }, ...over });
const recs = (n) => [(u) => has(u, "sms_broadcast_recipients"), reply(200, Array.from({ length: n }, (_, i) => ({ user_id: "u" + i, role: "worker", phone: "02" + String(40000000 + i) })))];
const bRows = [[(u, o) => has(u, "/rest/v1/sms_broadcasts") && o.method === "POST", reply(201, [{ id: "bc-1" }])], [(u, o) => has(u, "/rest/v1/sms_broadcasts") && o.method === "PATCH", reply(204)]];
const inApp = [(u) => has(u, "sched_broadcast_inapp"), reply(200, 7)];
test("scheduled broadcast (sandbox): re-resolves the audience, sends with the JOB id as request id, posts the in-app version, marks sent", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const { calls, patches } = run1([bJob()], [recs(3), ...bRows, sandboxOk, inApp]); await go();
  const s = calls.filter((c) => has(c.url, "/smssandbox/v1/send")); assert.equal(s.length, 1); assert.equal(s[0].body.recipients.length, 3); assert.ok(!calls.some((c) => has(c.url, "/api/v1/send")));
  assert.equal(calls.find((c) => has(c.url, "/rest/v1/sms_broadcasts") && c.method === "POST").body.request_id, "11111111-2222-4333-8444-555555555555");
  const ia = calls.find((c) => has(c.url, "sched_broadcast_inapp")).body; assert.equal(ia.p_title, "News"); assert.deepEqual(ia.p_roles, ["worker"]);
  assert.equal(patches[patches.length - 1].status, "sent");
});
test("scheduled broadcast (live): over-limit or insufficient credit -> SMS skipped as failed with a reason, in-app still posted, nothing sent", async () => {
  env({ ...LIVEENV, SASUSYNC_BROADCAST_MAX: "2" }); let r = run1([bJob()], [recs(3), [(u) => has(u, "/api/v1/balance"), reply(200, { sms_sendable: 400 })], ...bRows, [(u) => has(u, "/api/v1/send"), reply(200, { success: true })], inApp]); await go();
  assert.equal(r.patches[0].status, "failed"); assert.equal(r.patches[0].error, "OVER_LIMIT"); assert.ok(!r.calls.some((c) => has(c.url, "/api/v1/send"))); assert.ok(r.calls.some((c) => has(c.url, "sched_broadcast_inapp")));
  env(LIVEENV); r = run1([bJob()], [recs(3), [(u) => has(u, "/api/v1/balance"), reply(200, { sms_sendable: 20 })], ...bRows, [(u) => has(u, "/api/v1/send"), reply(200, { success: true })], inApp]); await go();
  assert.equal(r.patches[0].error, "INSUFFICIENT_CREDIT"); assert.ok(!r.calls.some((c) => has(c.url, "/api/v1/send")));
});
test("scheduled broadcast: in-app only job posts the announcement without touching the SMS provider; no recipients -> skipped", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); let r = run1([bJob({ payload: { roles: [], sms: false, in_app: { title: "T!", body: "Body" }, channels: ["in_app"] } })], [inApp, sandboxOk]); await go();
  assert.equal(r.patches[0].status, "sent"); assert.ok(!r.calls.some((c) => has(c.url, "sms.test")));
  r = run1([bJob()], [recs(0), ...bRows, sandboxOk, inApp]); await go(); assert.equal(r.patches[0].status, "skipped"); assert.equal(r.patches[0].error, "NO_RECIPIENTS");
});
test("scheduler: one crashing job never leaves it 'running' and never blocks the next; unknown kinds fail safely", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const { patches } = run1([{ id: "x1", kind: "mystery", payload: {} }, { ...welcomeJob, id: "w2" }], [[(u) => has(u, "platform_settings"), new Error("boom")], ctx(), rl(), sandboxOk, logRoute]); await go();
  assert.equal(patches.length, 2); assert.equal(patches[0].error, "UNKNOWN_KIND"); assert.equal(patches[1].status, "failed"); assert.equal(patches[1].error, "INTERNAL");
});
test("scheduler/automation: no console output and no phone/message leaks in the job results or audit", async () => {
  env({ SASUSYNC_MODE: "sandbox" }); const out = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => out.push(a.join(" "));
  const { calls, patches } = run1([welcomeJob, bJob()], [...flags(), ctx(), rl(), sandboxOk, logRoute, recs(2), ...bRows, inApp]); await go(); Object.assign(console, o);
  assert.deepEqual(out, []); const text = JSON.stringify([patches, calls.filter((c) => has(c.url, "audit_logs")).map((c) => c.body)]); assert.ok(!text.match(/233\d{9}|02\d{8}|Kwame|Big news/));
});
