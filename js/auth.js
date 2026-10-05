(() => {
  "use strict";
  const { sb, $, $$, esc, toast, ROLES, categoriesFor, loadMe } = window.BX;

  const COUNTRIES = [
    { n: "Ghana", f: "🇬🇭", d: "233" }, { n: "Nigeria", f: "🇳🇬", d: "234" }, { n: "Côte d'Ivoire", f: "🇨🇮", d: "225" },
    { n: "Togo", f: "🇹🇬", d: "228" }, { n: "Burkina Faso", f: "🇧🇫", d: "226" }, { n: "Kenya", f: "🇰🇪", d: "254" },
    { n: "United Kingdom", f: "🇬🇧", d: "44" }, { n: "United States", f: "🇺🇸", d: "1" },
  ];
  const FLOWS = { signup: ["phone", "code", "name", "cat", "pass"], onboard: ["name", "cat"], reset: ["phone", "code", "pass"] };
  const OTP_LEN = 6;
  const HOME = "index.html#/home";

  // "Pro" paths (workers, project managers, suppliers) and "Client" paths (home clients, companies) are different joins.
  const GROUPS = {
    pro: { roles: ["worker", "project-manager", "business"], title: "Join as a professional", sub: "Pick how you work on BAID X." },
    client: { roles: ["individual-employer", "company"], title: "Join to hire", sub: "Hiring for your home, or for your company?" },
  };
  const params = new URLSearchParams(location.search);
  let GROUP = GROUPS[params.get("group")] || null;
  let ROLE_KEYS = GROUP ? GROUP.roles : Object.keys(ROLES);
  // with no group in the link, the page opens on the professional / client entry
  const START = GROUP ? "type" : "entry";
  const S = { role: ROLE_KEYS[0], mode: "signup", country: COUNTRIES[0], phone: "", name: "", cat: null, user: null, siMode: "phone", history: [START], view: START, gate: null };
  if (ROLE_KEYS.includes(params.get("role"))) S.role = params.get("role");

  /* ---------- navigation ---------- */
  function show(view, { push = true } = {}) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `v-${view}`));
    if (push && S.view !== view) S.history.push(view);
    S.view = view; document.body.dataset.view = view;
    const flow = FLOWS[S.mode] || [];
    const idx = flow.indexOf(view);
    $("#head").classList.toggle("hide", S.history.length <= 1 || view === "entry");
    $("#progress").style.visibility = idx >= 0 ? "visible" : "hidden";
    $("#stepLabel").textContent = idx >= 0 ? `Step ${idx + 1} of ${flow.length}` : "";
    $("#bar").style.width = idx >= 0 ? `${((idx + 1) / flow.length) * 100}%` : "0";
    window.scrollTo(0, 0);
    const focus = { phone: "#phone", name: "#name", pass: "#pass", signin: S.siMode === "phone" ? "#siPhone" : "#siEmail" }[view];
    if (focus) setTimeout(() => $(focus)?.focus({ preventScroll: true }), 320);
    if (view === "code") setTimeout(() => $$("#otp input")[0]?.focus(), 320);
  }
  function back() {
    if (S.history.length <= 1) { location.href = "index.html"; return; }
    S.history.pop();
    const prev = S.history[S.history.length - 1];
    show(prev, { push: false });
  }
  $("#back").addEventListener("click", back);

  /* ---------- entry: professional or client, then sign in or create ---------- */
  const GATE_NAME = { pro: "Professional", client: "Client" };
  $$(".gate").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest("[data-gate-act]"); if (!b) return;
    const key = g.dataset.gate; S.gate = key; GROUP = GROUPS[key]; ROLE_KEYS = GROUP.roles; S.role = ROLE_KEYS[0];
    if (b.dataset.gateAct === "signin") {
      S.mode = "signin"; S.intent = false;
      $("#signinSub").textContent = `${GATE_NAME[key]} sign-in. Use the phone or email on your account.`;
      $("#siErr").textContent = "";
      show("signin");
      return;
    }
    S.mode = "signup"; S.skipChooser = true;
    $("#typeTitle").textContent = GROUP.title; $("#typeSub").textContent = GROUP.sub;
    $("#goSignin").hidden = true; $("#goSignup").textContent = "Continue"; $("#goSignup").className = "btn-light wide"; $(".browse").hidden = true;
    renderTypes(); show("type");
  }));

  $$(".gate").forEach((g) => g.addEventListener("pointermove", (e) => { const r = g.getBoundingClientRect(); g.style.setProperty("--x", `${e.clientX - r.left}px`); g.style.setProperty("--y", `${e.clientY - r.top}px`); }));

  /* ---------- 0. choose type ---------- */
  function renderTypes() {
    $("#types").innerHTML = ROLE_KEYS.map((k) => [k, ROLES[k]]).map(([k, r]) =>
      `<button class="type ${S.role === k ? "on" : ""}" role="radio" aria-checked="${S.role === k}" data-role="${k}">${r.icon}<span>${esc(r.label)}</span></button>`).join("");
    $("#typeBlurb").textContent = ROLES[S.role].blurb;
  }
  $("#types").addEventListener("click", (e) => {
    const b = e.target.closest("[data-role]"); if (!b) return;
    S.role = b.dataset.role; renderTypes();
  });
  $("#goSignup").addEventListener("click", () => {
    if (S.mode === "onboard") { prepName(); show("name"); return; }
    S.mode = "signup"; resetPhoneView(); show("phone");
  });
  $("#goSignin").addEventListener("click", () => {
    if (!S.skipChooser && ACCS().length && params.get("add") !== "1") { openChooser(); return; }
    S.mode = "signin";
    $("#signinSub").textContent = S.intent ? `Signing in as ${ROLES[S.role].label}.` : "Sign in to your BAID X account.";
    $("#siErr").textContent = "";
    show("signin");
  });

  /* ---------- country sheet ---------- */
  let ccTarget = null;
  $$("[data-cc]").forEach((b) => b.addEventListener("click", () => {
    ccTarget = b;
    $("#ccList").innerHTML = COUNTRIES.map((c, i) => `<button data-i="${i}"><span>${c.f}</span><span>${esc(c.n)}</span><span>+${c.d}</span></button>`).join("");
    $("#sheet").hidden = false; $("#sheetBg").hidden = false;
  }));
  const closeSheet = () => { $("#sheet").hidden = true; $("#sheetBg").hidden = true; };
  $("#sheetBg").addEventListener("click", closeSheet);
  $("#ccList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]"); if (!b) return;
    S.country = COUNTRIES[+b.dataset.i];
    $$("[data-cc]").forEach((x) => { x.firstChild.textContent = `${S.country.f} `; x.querySelector("span").textContent = `+${S.country.d}`; });
    closeSheet();
  });

  function toE164(raw) {
    let d = String(raw).replace(/\D/g, "");
    if (d.startsWith(S.country.d) && d.length > S.country.d.length + 7) d = d.slice(S.country.d.length);
    d = d.replace(/^0+/, "");
    return d.length >= 7 && d.length <= 12 ? `+${S.country.d}${d}` : null;
  }
  function friendly(err) {
    const m = String(err?.message || err || "").toLowerCase();
    if (/provider|sms|twilio|unsupported phone|phone.*not.*enabled/.test(m)) return "Phone sign-up isn't switched on yet.";
    if (/invalid login|invalid credentials/.test(m)) return "Wrong phone, email or password.";
    if (/expired|invalid.*token|token.*invalid/.test(m)) return "That code is wrong or has expired.";
    if (/rate|too many|seconds/.test(m)) return "Too many attempts. Please wait a moment and try again.";
    return err?.message || "Something went wrong. Please try again.";
  }
  // Phone accounts: the server sets the password (Supabase would demand a "current password" a phone user doesn't have).
  async function savePassword(password) {
    if (!phoneApi) return sb.auth.updateUser({ password });
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/auth/phone/password", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: { message: j.error || "We couldn't save your password. Try again." } };
    // the server ends old sessions when it sets the password and hands back a fresh one
    if (j.session?.access_token) await sb.auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token });
    return {};
  }
    // when an error message appears, the field above it shakes (no change needed at each call site)
  $$(".err").forEach((el) => new MutationObserver(() => {
    if (!el.textContent.trim()) return;
    const box = el.closest(".view"), f = box && box.querySelector(".field-row, .pw, .field"); if (!f) return;
    f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); setTimeout(() => f.classList.remove("shake"), 600);
  }).observe(el, { childList: true, characterData: true, subtree: true }));
  const setBusy = (btn, on, label) => { btn.disabled = on; btn.classList.toggle("is-loading", on); if (label) btn.textContent = label; };

  /* ---------- 1. phone ---------- */
  function resetPhoneView() {
    const reset = S.mode === "reset";
    $("#phoneTitle").textContent = reset ? "Reset password" : "Phone number";
    $("#phoneSub").textContent = reset ? "We'll send a code to the number on your account." : "A verification code will be sent to this number.";
  }
  $("#phone").addEventListener("input", () => { const ok = !!toE164($("#phone").value); $("#phoneNext").disabled = !ok; $("#phoneErr").textContent = ""; $("#phone").closest(".field-row").classList.toggle("valid", ok); });
  $("#phone").addEventListener("keydown", (e) => e.key === "Enter" && !$("#phoneNext").disabled && $("#phoneNext").click());
  $("#phoneNext").addEventListener("click", async () => {
    const phone = toE164($("#phone").value); if (!phone) return;
    setBusy($("#phoneNext"), true, "Continue");
    const ok = await sendCode(phone);
    setBusy($("#phoneNext"), false, "Continue");
    if (ok) { S.phone = phone; prepCode(); show("code"); }
  });
  // Phone codes go through SasuSync only when the server says so (flag off by default); otherwise the original path is untouched.
  let phoneApi = false;
  fetch("/api/auth/phone/start").then((r) => r.json()).then((j) => { phoneApi = j && j.enabled === true; }).catch(() => {});
  async function sendCode(phone) {
    if (phoneApi) {
      const r = await fetch("/api/auth/phone/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, purpose: S.mode === "reset" ? "reset" : "signup" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { $("#phoneErr").textContent = j.error || "We couldn't send the code. Try again shortly."; return false; }
      return true;
    }
    const { error } = await sb.auth.signInWithOtp({ phone, options: { shouldCreateUser: S.mode !== "reset" } });
    if (error) { $("#phoneErr").textContent = friendly(error); return false; }
    return true;
  }

  /* ---------- 2. confirm code ---------- */
  let resendTimer, resendLeft = 0;
  function buildOtp() {
    $("#otp").innerHTML = Array.from({ length: OTP_LEN }, (_, i) => `<input style="--i:${i}" inputmode="numeric" maxlength="1" autocomplete="${i ? "off" : "one-time-code"}" aria-label="Digit ${i + 1}" />`).join("");
  }
  function otpValue() { return $$("#otp input").map((i) => i.value).join(""); }
  function prepCode() {
    buildOtp(); $("#codeErr").textContent = ""; $("#codeNext").disabled = true;
    $("#codeSub").textContent = `Enter the confirmation code sent to ${"***" + S.phone.slice(-4)}.`;
    startResend();
  }
  function startResend() {
    clearInterval(resendTimer); resendLeft = 30; paintResend();
    resendTimer = setInterval(() => { resendLeft--; paintResend(); if (resendLeft <= 0) clearInterval(resendTimer); }, 1000);
  }
  function paintResend() { const b = $("#resend"); b.disabled = resendLeft > 0; b.textContent = resendLeft > 0 ? `Resend code in ${resendLeft}s` : "Resend code"; }
  $("#resend").addEventListener("click", async () => { if (await sendCode(S.phone)) { toast("New code sent."); startResend(); } else show("phone"); });
  $("#otp").addEventListener("input", (e) => {
    const inputs = $$("#otp input"), i = inputs.indexOf(e.target);
    const digits = e.target.value.replace(/\D/g, "");
    if (digits.length > 1) { digits.slice(0, OTP_LEN).split("").forEach((d, k) => { if (inputs[k]) inputs[k].value = d; }); inputs[Math.min(digits.length, OTP_LEN) - 1].focus(); }
    else { e.target.value = digits; if (digits && inputs[i + 1]) inputs[i + 1].focus(); }
    inputs.forEach((x) => x.classList.toggle("fill", !!x.value));
    $("#codeErr").textContent = "";
    const full = otpValue().length === OTP_LEN; $("#codeNext").disabled = !full;
    if (full) verifyCode();
  });
  $("#otp").addEventListener("keydown", (e) => {
    const inputs = $$("#otp input"), i = inputs.indexOf(e.target);
    if (e.key === "Backspace" && !e.target.value && inputs[i - 1]) { inputs[i - 1].focus(); inputs[i - 1].value = ""; }
  });
  $("#codeNext").addEventListener("click", verifyCode);
  /* ---- OTP motion: checking wave, right-code seal, wrong-code shake ---- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* not supported */ } }
  async function playOk() {
    const otp = $("#otp"), seal = $("#seal");
    if (!seal.querySelector("i")) { // sparkle burst, built once
      const cols = ["#ffffff", "#bff3d9", "#7dd3fc", "#34d399"];
      seal.insertAdjacentHTML("beforeend", Array.from({ length: 20 }, (_, k) => `<i style="--a:${Math.round((k / 20) * 360 + (k % 2 ? 9 : 0))}deg;--d:${78 + (k % 3) * 22}px;--s:${k % 4 === 0 ? 7 : 4}px;--t:${(k % 5) * 40 + 380}ms;--col:${cols[k % 4]}"></i>`).join(""));
    }
    otp.classList.remove("is-checking"); otp.classList.add("is-ok"); seal.classList.add("on"); buzz([14, 40, 22]);
    await wait(reduced() ? 250 : 1150);
    seal.classList.remove("on");
  }
  async function playBad() {
    const otp = $("#otp"); otp.classList.remove("is-checking"); otp.classList.add("is-bad"); buzz([40, 50, 40, 50, 60]);
    await wait(reduced() ? 150 : 560);
    otp.classList.remove("is-bad"); otp.classList.add("is-clearing");
    await wait(reduced() ? 50 : 420);
    $$("#otp input").forEach((i) => { i.value = ""; i.classList.remove("fill"); }); otp.classList.remove("is-clearing");
  }
  let verifying = false;
  async function verifyCode() {
    if (verifying) return; verifying = true; setBusy($("#codeNext"), true, "Continue"); $("#otp").classList.add("is-checking");
    let data, error;
    if (phoneApi) {
      const r = await fetch("/api/auth/phone/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: S.phone, code: otpValue() }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.session) { const x = await sb.auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token }); data = x.data; error = x.error; }
      else error = { message: j.error || "That code isn't right." };
    } else ({ data, error } = await sb.auth.verifyOtp({ phone: S.phone, token: otpValue(), type: "sms" }));
    setBusy($("#codeNext"), false, "Continue");
    if (error) { $("#codeErr").textContent = friendly(error); $("#codeNext").disabled = true; await playBad(); verifying = false; $$("#otp input")[0].focus(); return; }
    await playOk(); $("#otp").classList.remove("is-ok"); verifying = false;
    S.user = data.user;
    if (S.mode === "reset") { prepPass(); show("pass"); return; }
    if (phoneApi && S.mode === "signup") { prepName(); show("name"); return; } // brand-new account: no role yet, skip the lookup
    const me = await loadMe();
    if (me?.role) { location.href = HOME; return; }
    prepName(); show("name");
  }

  /* ---------- 3. name ---------- */
  function prepName() {
    const r = ROLES[S.role];
    $("#nameTitle").textContent = r.nameTitle; $("#nameSub").textContent = r.nameHelp; $("#name").placeholder = r.namePh;
    $("#nameNext").disabled = $("#name").value.trim().length < 2;
  }
  $("#name").addEventListener("input", () => { S.name = $("#name").value.trim(); $("#nameNext").disabled = S.name.length < 2; });
  $("#name").addEventListener("keydown", (e) => e.key === "Enter" && !$("#nameNext").disabled && $("#nameNext").click());
  $("#nameNext").addEventListener("click", () => { prepCat(); show("cat"); });

  /* ---------- 4. category ---------- */
  function prepCat() {
    const r = ROLES[S.role], c = categoriesFor(S.role);
    $("#catTitle").textContent = r.catTitle; $("#catSub").textContent = r.catHelp;
    $("#catSearchWrap").hidden = c.items.length < 12; $("#catQ").value = "";
    renderCats();
  }
  const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.500"/><path d="M9 7V5.500A1.500 1.500 0 0 1 10.500 4h3A1.500 1.500 0 0 1 15 5.500V7M3 13h18"/></svg>';
  function renderCats() {
    const { grouped, items } = categoriesFor(S.role);
    const q = $("#catQ").value.trim().toLowerCase();
    const list = items.filter((i) => !q || `${i.name} ${i.desc || ""}`.toLowerCase().includes(q));
    if (!list.length) { $("#cats").innerHTML = '<div class="empty-cat">No matches</div>'; return; }
    let html = "", last = "";
    list.forEach((i) => {
      if (grouped && i.group !== last) { html += `<div class="cat-group">${esc(i.group)}</div>`; last = i.group; }
      html += `<button class="cat ${S.cat?.id === i.id ? "on" : ""}" data-id="${esc(i.id)}"><span class="ic">${ICON}</span><span><b>${esc(i.name)}</b>${!grouped && i.desc ? `<small>${esc(i.desc)}</small>` : ""}</span></button>`;
    });
    $("#cats").innerHTML = html;
  }
  $("#catQ").addEventListener("input", renderCats);
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    S.cat = categoriesFor(S.role).items.find((i) => i.id === b.dataset.id); renderCats();
    setTimeout(() => { if (S.mode === "onboard") finishProfile(); else { prepPass(); show("pass"); } }, 60);
  });

  /* ---------- 5. password ---------- */
  const rules = { len: (p) => p.length >= 8, num: (p) => /\d/.test(p), let: (p) => /[A-Za-z]/.test(p), mix: (p) => /[A-Z]/.test(p) || /[^A-Za-z0-9]/.test(p) };
  function prepPass() {
    const reset = S.mode === "reset";
    $("#passTitle").textContent = reset ? "Set a new password" : "Create a password";
    $("#passNext").textContent = reset ? "Save password" : "Create account";
    $("#passLegal").hidden = reset; $("#pass").value = ""; checkPass();
  }
  function checkPass() {
    const p = $("#pass").value; let ok = true;
    $$("#rules li").forEach((li) => { const pass = rules[li.dataset.r](p); li.classList.toggle("ok", pass); ok = ok && pass; });
    $("#passNext").disabled = !ok; $("#passErr").textContent = "";
    // strength: Weak / Fair while a rule is missing; Good when all pass; Strong at 12+ characters
    const passed = Object.values(rules).filter((f) => f(p)).length, lvl = !p ? 0 : !ok ? (passed >= 3 ? 2 : 1) : p.length >= 12 ? 4 : 3;
    const [word, col] = [["", "#9a9a9a"], ["Weak", "#f87171"], ["Fair", "#fbbf24"], ["Good", "#7dd3fc"], ["Strong", "#34d399"]][lvl];
    $$("#meter i").forEach((b, k) => { b.classList.toggle("on", k < lvl); b.style.setProperty("--mc", col); });
    $("#meterL").style.setProperty("--mc", col); $("#meterL").textContent = word;
  }
  $("#pass").addEventListener("input", checkPass);
  $("#pass").addEventListener("keydown", (e) => e.key === "Enter" && !$("#passNext").disabled && $("#passNext").click());
  $("#passNext").addEventListener("click", async () => {
    const label = $("#passNext").textContent; setBusy($("#passNext"), true, label);
    if (S.mode !== "reset") { await finishProfile(label, $("#pass").value); return; } // password + profile are saved together
    const { error } = await savePassword($("#pass").value);
    if (error) { setBusy($("#passNext"), false, label); $("#passErr").textContent = friendly(error); return; }
    if (S.mode === "reset") { toast("Password updated."); const me = await loadMe(); setTimeout(() => (location.href = me?.role ? HOME : "auth.html?onboard=1"), 700); return; }
  });

  /* ---------- create the profile row (db trigger adds account_roles) ---------- */
  async function finishProfile(label = "Create account", password) {
    const btn = $("#passNext");
    const { data: { session } } = await sb.auth.getSession(); const user = session?.user; // local read: no network round trip
    if (!user) { toast("Your session expired. Please sign in again."); show("type"); return; }
    const phone = user.phone ? `+${String(user.phone).replace(/^\+/, "")}` : S.phone || "";
    const email = /\.invalid$/i.test(user.email || "") ? "" : user.email || ""; // the internal sign-in placeholder is never shown or stored on a profile
    const name = S.name, cat = S.cat?.id;
    const rows = {
      worker: { full_name: name, phone_number: phone, primary_job_category_id: cat },
      company: { company_name: name, contact_phone: phone, contact_email: email, industry_sector: cat },
      "project-manager": { full_name: name, phone_number: phone, email, specialization: cat },
      business: { business_name: name, contact_person_name: name, contact_phone: phone, contact_email: email, specialty: S.cat?.name },
      "individual-employer": { full_name: name, phone_number: phone, email, profile_sections: { need_category: S.cat?.name } },
    };
    setBusy(btn, true, label);
    // save the password and create the profile at the same time (a retry is safe: an existing profile row is accepted)
    const [pw, ins] = await Promise.all([password ? savePassword(password) : Promise.resolve({}), sb.from(ROLES[S.role].table).insert({ id: user.id, ...rows[S.role] })]);
    const error = pw.error || (ins.error && ins.error.code !== "23505" ? ins.error : null);
    if (error) { setBusy(btn, false, label); const m = friendly(error); if (S.view === "pass") $("#passErr").textContent = m; else toast(m); return; }
    location.href = HOME;
  }

  /* ---------- sign in ---------- */
  $("#seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    S.siMode = b.dataset.m;
    $$("#seg button").forEach((x) => x.classList.toggle("on", x === b));
    $("#siPhoneRow").hidden = S.siMode !== "phone"; $("#siEmail").hidden = S.siMode !== "email"; $("#siErr").textContent = "";
  });
  $$("[data-eye]").forEach((b) => b.addEventListener("click", () => {
    const inp = b.parentElement.querySelector("input"); const on = inp.type === "password";
    inp.type = on ? "text" : "password"; b.classList.toggle("on", on);
  }));
  $("#doSignin").addEventListener("click", async () => {
    const password = $("#siPass").value; let cred;
    if (S.siMode === "phone") { const phone = toE164($("#siPhone").value); if (!phone) return ($("#siErr").textContent = "Enter a valid phone number."); cred = { phone, password }; }
    else { const email = $("#siEmail").value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) return ($("#siErr").textContent = "Enter a valid email address."); cred = { email, password }; }
    if (!password) return ($("#siErr").textContent = "Enter your password.");
    setBusy($("#doSignin"), true, "Sign in");
    let error;
    if (S.siMode === "phone" && phoneApi) { // server maps the number to its account; Supabase's phone provider is not used
      const r = await fetch("/api/auth/phone/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: cred.phone, password }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.session) ({ error } = await sb.auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token }));
      else error = { message: j.error || "That number or password isn't right." };
    } else ({ error } = await sb.auth.signInWithPassword(cred));
    setBusy($("#doSignin"), false, "Sign in");
    if (error) { $("#siErr").textContent = friendly(error); return; }
    const me = await loadMe();
    // they chose an account type first, so make sure the account really is that type
    if (S.intent && me?.role && me.role !== S.role) {
      await sb.auth.signOut();
      $("#siErr").textContent = `That account is a ${ROLES[me.role].label} account. Go back and choose ${ROLES[me.role].label}.`;
      return;
    }
    // signed in from the professional or client panel: the account has to belong to that side
    if (S.gate && me?.role && !GROUPS[S.gate].roles.includes(me.role)) {
      await sb.auth.signOut();
      const other = S.gate === "pro" ? "Client" : "Professional";
      $("#siErr").textContent = `That is a ${ROLES[me.role].label} account. Go back and use ${other} sign in.`;
      return;
    }
    if (me?.role) location.href = HOME; else startOnboard();
  });
  $("#siPass").addEventListener("keydown", (e) => e.key === "Enter" && $("#doSignin").click());
  $("#forgot").addEventListener("click", async () => {
    if (S.siMode === "phone") { S.mode = "reset"; resetPhoneView(); show("phone"); return; }
    const email = $("#siEmail").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return ($("#siErr").textContent = "Enter your email above first.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    if (error) $("#siErr").textContent = friendly(error); else toast("Password reset link sent. Check your email.");
  });
  $$("[data-legal]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); toast("Terms and Privacy pages are coming soon."); }));

  /* ---------- onboarding for signed-in users with no role yet ---------- */
  function startOnboard() { S.mode = "onboard"; S.history = ["type"]; S.view = "type"; renderTypes(); $("#goSignin").hidden = true; $("#goSignup").textContent = "Continue"; show("type", { push: false }); }

  // Sign in from the guest page: pick the account type first, then the credentials step follows.
  function signinIntent() {
    S.mode = "signin"; S.intent = true;
    $("#typeTitle").textContent = GROUP ? (params.get("group") === "pro" ? "Professional sign-in" : "Client sign-in") : "Sign in";
    $("#typeSub").textContent = "Choose your account type to continue.";
    $("#goSignin").textContent = "Continue";
    $("#goSignup").textContent = "New here? Create an account";
    $("#goSignup").onclick = null;
    show("type", { push: false });
  }

  /* ---------- Continue with: accounts remembered on this device ---------- */
  const ACCS = () => window.BX.accounts.list();
  const maskPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d ? `+${d.slice(0, 3)} ••• ${d.slice(-3)}` : ""; };
  function renderChoose() {
    $("#accList").innerHTML = ACCS().map((a) => {
      const role = ROLES[a.role]?.account || "Account", where = a.phone ? maskPhone(a.phone) : a.email || "";
      const av = a.photo ? `style="background-image:url('${esc(a.photo)}')"` : "";
      return `<button class="acc-opt" data-acc="${esc(a.id)}"><span class="av" ${av}>${a.photo ? "" : esc(String(a.name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span><span class="tx"><b>${esc(a.name)}</b><small>${esc(role)}${where ? " · " + esc(where) : ""}</small></span><span class="st ${a.r ? "on" : ""}">${a.r ? "Continue" : "Password"}</span></button>`;
    }).join("");
  }
  function openChooser() { S.mode = "signin"; S.history = ["choose"]; S.view = "choose"; renderChoose(); show("choose", { push: false }); }
  function prefillSignin(a) {
    S.intent = false; S.mode = "signin";
    if (a.phone) {
      const d = String(a.phone).replace(/\D/g, ""), c = COUNTRIES.find((x) => d.startsWith(x.d)); if (c) S.country = c;
      $$("[data-cc]").forEach((x) => { x.firstChild.textContent = `${S.country.f} `; x.querySelector("span").textContent = `+${S.country.d}`; });
      S.siMode = "phone"; $("#siPhone").value = d;
    } else if (a.email) { S.siMode = "email"; $("#siEmail").value = a.email; }
    $$("#seg button").forEach((x) => x.classList.toggle("on", x.dataset.m === S.siMode));
    $("#siPhoneRow").hidden = S.siMode !== "phone"; $("#siEmail").hidden = S.siMode !== "email";
    $("#signinSub").textContent = `Welcome back, ${a.name}. Enter your password to continue.`; $("#siErr").textContent = ""; $("#siPass").value = "";
    show("signin");
  }
  $("#accList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acc]"); if (!b) return;
    const a = ACCS().find((x) => x.id === b.dataset.acc); if (!a) return;
    if (a.r) {
      b.disabled = true; b.querySelector(".st").textContent = "…";
      const r = await window.BX.accounts.switchTo(a.id);
      if (r.ok) { location.href = HOME; return; }
      b.disabled = false; renderChoose(); toast("Please enter your password to continue.");
    }
    prefillSignin(a);
  });
  $("#useOther").addEventListener("click", () => {
    S.skipChooser = true;
    if (!params.get("group")) { S.history = ["choose"]; show("entry"); return; }
    S.history = ["choose"]; signinIntent(); S.history = ["choose", "type"];
  });
  $("#chooseNew").addEventListener("click", () => {
    if (!params.get("group")) { S.history = ["choose"]; show("entry"); return; }
    S.mode = "signup"; S.history = ["type"]; renderTypes(); $("#goSignin").hidden = false; show("type", { push: false });
  });

  /* ---------- boot ---------- */
  if (GROUP) { $("#typeTitle").textContent = GROUP.title; $("#typeSub").textContent = GROUP.sub; }
  renderTypes();
  sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") { S.mode = "reset"; prepPass(); show("pass"); } });
  (async () => {
    const me = await loadMe();
    if (window.BX_RECOVERY) return; // the PASSWORD_RECOVERY event below opens the "set a new password" step
    const adding = params.get("add") === "1"; // "Add another account" from the profile: stay here even though someone is signed in
    if (me?.role && S.mode !== "reset" && !adding) { location.replace(HOME); return; }
    if (me && !me.role && !adding) { startOnboard(); return; }
    if (params.get("acc") && ACCS().some((x) => x.id === params.get("acc"))) { S.mode = "signin"; prefillSignin(ACCS().find((x) => x.id === params.get("acc"))); return; }
    if (params.get("mode") === "signin") { if (ACCS().length && !adding) openChooser(); else if (GROUP) signinIntent(); else show("entry", { push: false }); }
    else if (!GROUP) show("entry", { push: false });
  })();

})();
