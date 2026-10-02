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
    pro: { roles: ["worker", "project-manager", "business"], title: "Join as a Pro", sub: "Pick how you work on BAID X." },
    client: { roles: ["individual-employer", "company"], title: "Join as a client", sub: "Hiring for your home, or for your company?" },
  };
  const params = new URLSearchParams(location.search);
  const GROUP = GROUPS[params.get("group")] || null;
  const ROLE_KEYS = GROUP ? GROUP.roles : Object.keys(ROLES);
  const S = { role: ROLE_KEYS[0], mode: "signup", country: COUNTRIES[0], phone: "", name: "", cat: null, user: null, siMode: "phone", history: ["type"], view: "type" };
  if (ROLE_KEYS.includes(params.get("role"))) S.role = params.get("role");

  /* ---------- navigation ---------- */
  function show(view, { push = true } = {}) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `v-${view}`));
    if (push && S.view !== view) S.history.push(view);
    S.view = view;
    const flow = FLOWS[S.mode] || [];
    const idx = flow.indexOf(view);
    $("#head").classList.toggle("hide", view === "type");
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
  $("#goSignin").addEventListener("click", () => { S.mode = "signin"; show("signin"); });

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
    if (/provider|sms|twilio|unsupported phone|phone.*not.*enabled/.test(m)) return "SMS sign-up isn't switched on yet. The BAID X admin needs to enable the Phone provider in Supabase.";
    if (/invalid login|invalid credentials/.test(m)) return "Wrong phone, email or password.";
    if (/expired|invalid.*token|token.*invalid/.test(m)) return "That code is wrong or has expired.";
    if (/rate|too many|seconds/.test(m)) return "Too many attempts. Please wait a moment and try again.";
    return err?.message || "Something went wrong. Please try again.";
  }
  const setBusy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = on ? "Please wait…" : label; };

  /* ---------- 1. phone ---------- */
  function resetPhoneView() {
    const reset = S.mode === "reset";
    $("#phoneTitle").textContent = reset ? "Reset password" : "Phone number";
    $("#phoneSub").textContent = reset ? "We'll send a code to the number on your account." : "A verification code will be sent to this number.";
  }
  $("#phone").addEventListener("input", () => { $("#phoneNext").disabled = !toE164($("#phone").value); $("#phoneErr").textContent = ""; });
  $("#phone").addEventListener("keydown", (e) => e.key === "Enter" && !$("#phoneNext").disabled && $("#phoneNext").click());
  $("#phoneNext").addEventListener("click", async () => {
    const phone = toE164($("#phone").value); if (!phone) return;
    setBusy($("#phoneNext"), true, "Continue");
    const ok = await sendCode(phone);
    setBusy($("#phoneNext"), false, "Continue");
    if (ok) { S.phone = phone; prepCode(); show("code"); }
  });
  async function sendCode(phone) {
    const { error } = await sb.auth.signInWithOtp({ phone, options: { shouldCreateUser: S.mode !== "reset" } });
    if (error) { $("#phoneErr").textContent = friendly(error); return false; }
    return true;
  }

  /* ---------- 2. confirm code ---------- */
  let resendTimer, resendLeft = 0;
  function buildOtp() {
    $("#otp").innerHTML = Array.from({ length: OTP_LEN }, (_, i) => `<input inputmode="numeric" maxlength="1" autocomplete="${i ? "off" : "one-time-code"}" aria-label="Digit ${i + 1}" />`).join("");
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
  let verifying = false;
  async function verifyCode() {
    if (verifying) return; verifying = true; setBusy($("#codeNext"), true, "Continue");
    const { data, error } = await sb.auth.verifyOtp({ phone: S.phone, token: otpValue(), type: "sms" });
    verifying = false; setBusy($("#codeNext"), false, "Continue");
    if (error) { $("#codeErr").textContent = friendly(error); $$("#otp input").forEach((i) => (i.value = "")); $$("#otp input")[0].focus(); $("#codeNext").disabled = true; return; }
    S.user = data.user;
    if (S.mode === "reset") { prepPass(); show("pass"); return; }
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
    setTimeout(() => { if (S.mode === "onboard") finishProfile(); else { prepPass(); show("pass"); } }, 200);
  });

  /* ---------- 5. password ---------- */
  const rules = { len: (p) => p.length >= 8, num: (p) => /\d/.test(p), let: (p) => /[A-Za-z]/.test(p) };
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
  }
  $("#pass").addEventListener("input", checkPass);
  $("#pass").addEventListener("keydown", (e) => e.key === "Enter" && !$("#passNext").disabled && $("#passNext").click());
  $("#passNext").addEventListener("click", async () => {
    const label = $("#passNext").textContent; setBusy($("#passNext"), true, label);
    const { error } = await sb.auth.updateUser({ password: $("#pass").value });
    if (error) { setBusy($("#passNext"), false, label); $("#passErr").textContent = friendly(error); return; }
    if (S.mode === "reset") { toast("Password updated."); const me = await loadMe(); setTimeout(() => (location.href = me?.role ? HOME : "auth.html?onboard=1"), 700); return; }
    await finishProfile(label);
  });

  /* ---------- create the profile row (db trigger adds account_roles) ---------- */
  async function finishProfile(label = "Create account") {
    const btn = $("#passNext");
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { toast("Your session expired. Please sign in again."); show("type"); return; }
    const phone = user.phone ? `+${String(user.phone).replace(/^\+/, "")}` : S.phone || "";
    const email = user.email || "";
    const name = S.name, cat = S.cat?.id;
    const rows = {
      worker: { full_name: name, phone_number: phone, primary_job_category_id: cat },
      company: { company_name: name, contact_phone: phone, contact_email: email, industry_sector: cat },
      "project-manager": { full_name: name, phone_number: phone, email, specialization: cat },
      business: { business_name: name, contact_person_name: name, contact_phone: phone, contact_email: email, specialty: S.cat?.name },
      "individual-employer": { full_name: name, phone_number: phone, email, profile_sections: { need_category: S.cat?.name } },
    };
    setBusy(btn, true, label);
    const { error } = await sb.from(ROLES[S.role].table).insert({ id: user.id, ...rows[S.role] });
    if (error && error.code !== "23505") { setBusy(btn, false, label); const m = friendly(error); if (S.view === "pass") $("#passErr").textContent = m; else toast(m); return; }
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
    const { error } = await sb.auth.signInWithPassword(cred);
    setBusy($("#doSignin"), false, "Sign in");
    if (error) { $("#siErr").textContent = friendly(error); return; }
    const me = await loadMe();
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
  $("#google").addEventListener("click", async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: new URL("index.html", location.href).href } });
    if (error) $("#siErr").textContent = friendly(error);
  });
  $$("[data-legal]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); toast("Terms and Privacy pages are coming soon."); }));

  /* ---------- onboarding for signed-in users with no role (e.g. Google) ---------- */
  function startOnboard() { S.mode = "onboard"; S.history = ["type"]; S.view = "type"; renderTypes(); $("#goSignin").hidden = true; $("#goSignup").textContent = "Continue"; show("type", { push: false }); }

  /* ---------- boot ---------- */
  if (GROUP) { $("#typeTitle").textContent = GROUP.title; $("#typeSub").textContent = GROUP.sub; }
  renderTypes();
  sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") { S.mode = "reset"; prepPass(); show("pass"); } });
  (async () => {
    const me = await loadMe();
    if (window.BX_RECOVERY) return; // the PASSWORD_RECOVERY event below opens the "set a new password" step
    if (me?.role && S.mode !== "reset") { location.replace(HOME); return; }
    if (me && !me.role) { startOnboard(); return; }
    if (params.get("mode") === "signin") { S.mode = "signin"; show("signin"); }
  })();
})();
