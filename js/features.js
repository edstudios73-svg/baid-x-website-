/* BAID X profile features: edit profile, verification, portfolio, certifications, company link,
   account settings, help pages and public profile sheets. Every write goes through row-level security
   (own row only) or a server function; verification itself can only be decided by BAID X staff. */
(() => {
  "use strict";
  const { esc, pretty, icon, ago, JOB_CATS, REGIONS, INDUSTRIES, ROLES } = window.BX;
  const U = () => window.DASH.ui;
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  /* ---------- sheet ---------- */
  function openSheet(title, html) {
    const root = document.getElementById("sheetRoot");
    root.innerHTML = `<div class="sx-bg" data-close></div><div class="sx" role="dialog" aria-label="${esc(title)}"><div class="sx-h"><b>${esc(title)}</b><button class="sx-x" data-close aria-label="Close">${icon("plus", 18)}</button></div><div class="sx-b">${html}</div></div>`;
    document.body.classList.add("sx-open");
  }
  const closeSheet = () => { const r = document.getElementById("sheetRoot"); if (r) r.innerHTML = ""; document.body.classList.remove("sx-open"); };
  const refreshMe = async () => { await window.APP.refresh(); };
  const fld = (label, inner, hint) => `<label class="fl"><span>${esc(label)}</span>${inner}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
  const inp = (name, o = {}) => `<input class="in" name="${name}" ${o.type ? `type="${o.type}"` : ""} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""} ${o.val != null && o.val !== "" ? `value="${esc(o.val)}"` : ""} ${o.req ? "required" : ""} ${o.max ? `maxlength="${o.max}"` : ""} ${o.min != null ? `min="${o.min}"` : ""} ${o.step ? `step="${o.step}"` : ""} autocomplete="off" />`;
  const area = (name, o = {}) => `<textarea class="in ta" name="${name}" rows="${o.rows || 3}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ""} maxlength="${o.max || 1000}">${esc(o.val || "")}</textarea>`;
  const sel = (name, opts, val) => `<select class="in" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const chk = (name, label, on) => `<label class="oc"><input type="checkbox" name="${name}" ${on ? "checked" : ""} /><span><b>${esc(label)}</b></span></label>`;
  const ext = (f) => (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const OKTYPE = /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/;

  async function upload(c, bucket, file, tag) {
    if (!file || !file.size) return null;
    if (file.size > 8 * 1024 * 1024) throw new Error("That file is over 8 MB. Choose a smaller one.");
    if (file.type && !OKTYPE.test(file.type)) throw new Error("Use a photo (JPG, PNG, WebP) or a PDF.");
    const path = `${c.uid}/${tag}-${Date.now()}.${ext(file)}`;
    const { error } = await c.sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw error;
    return path;
  }
  const publicUrl = (c, bucket, path) => c.sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  async function signedUrl(c, bucket, path) { const { data } = await c.sb.storage.from(bucket).createSignedUrl(path, 600); return data?.signedUrl; }

  const TABLE = { worker: "worker_profiles", company: "company_profiles", "project-manager": "project_manager_profiles", business: "business_profiles", "individual-employer": "individual_employer_profiles" };
  const save = async (c, patch) => { const { error } = await c.sb.from(TABLE[c.role]).update(patch).eq("id", c.uid); if (error) throw error; };
  const busyBtn = (b, on, label) => { if (!b) return; b.disabled = on; b.dataset.l = b.dataset.l || b.textContent; b.textContent = on ? (label || "Saving…") : b.dataset.l; };
  const fail = (c, e) => { console.error(e); c.toast(e?.message || "Something went wrong. Please try again."); };

  /* ======================================================================
     Edit profile
     ====================================================================== */
  const EXP = [["", "Choose"], ["<1", "Under 1 year"], ["1-3", "1 to 3 years"], ["3-5", "3 to 5 years"], ["5-10", "5 to 10 years"], ["10+", "10+ years"]];
  const AVAIL = [["", "Choose"], ["full_time", "Full time"], ["part_time", "Part time"], ["contract", "Contract"], ["weekends_only", "Weekends only"]];
  const PHASE = [["", "Choose"], ["structural", "Structural"], ["electrical_mechanical", "Electrical and mechanical"], ["plumbing_water", "Plumbing and water"], ["finishing_interior", "Finishing and interior"], ["exterior_compound", "Exterior and compound"], ["support_general", "Support and general"]];
  const NET = [["", "Choose"], ["mtn_momo", "MTN MoMo"], ["telecel_cash", "Telecel Cash"], ["airteltigo_money", "AirtelTigo Money"]];
  const REG = [["", "Choose region"], ...REGIONS.map((r) => [r, r])];
  const IND = [["", "Choose"], ["real_estate_development", "Real estate development"], ["construction", "Construction"], ["property_management", "Property management"], ["architecture_engineering", "Architecture and engineering"], ["facilities_management", "Facilities management"], ["other", "Other"]];
  const SIZE = [["", "Choose"], ["1-10", "1 to 10"], ["11-50", "11 to 50"], ["51-200", "51 to 200"], ["200+", "More than 200"]];
  const ENT = [["", "Choose"], ["sole_proprietorship", "Sole proprietorship"], ["registered_company", "Registered company"], ["partnership", "Partnership"]];
  const ENG = [["", "Choose"], ["freelance", "Freelance"], ["company_affiliated", "Company affiliated"], ["both", "Both"]];
  const PAYOUT = [["name", "Account name", "text"], ["acct", "Mobile money number", "text"]];
  // [column, label, kind, extra]. kinds: text, area, number, select, bool, list (comma separated), jobcat
  const FIELDS = {
    worker: [["full_name", "Full name", "text"], ["short_bio", "Short bio", "area", { ph: "One or two lines about your work", max: 280 }], ["primary_job_category_id", "Main trade", "jobcat"], ["years_of_experience", "Experience", "select", { opts: EXP }], ["availability_type", "Availability", "select", { opts: AVAIL }], ["daily_rate_ghs", "Daily rate (GH₵)", "number"], ["has_own_tools", "I have my own tools", "bool"], ["available_for_work", "Available for work now", "bool"], ["region", "Region", "select", { opts: REG }], ["city_town", "Town", "text"], ["specific_area", "Area or neighbourhood", "text"], ["willing_to_travel_km", "Willing to travel (km)", "number"], ["languages_spoken", "Languages (comma separated)", "list"], ["highest_qualification", "Highest qualification", "text"], ["emergency_contact_name", "Emergency contact name", "text"], ["emergency_contact_phone", "Emergency contact phone", "text"], ["payout_method", "Payout network", "select", { opts: NET }], ["payout_account", "Payout number", "text"], ["payout_account_name", "Payout account name", "text"]],
    company: [["company_name", "Company name", "text"], ["company_overview", "About the company", "area", { max: 600 }], ["industry_sector", "Industry", "select", { opts: IND }], ["company_size", "Company size", "select", { opts: SIZE }], ["contact_person_name", "Contact person", "text"], ["contact_person_title", "Contact title", "text"], ["contact_email", "Contact email", "text"], ["website_url", "Website", "text"], ["region", "Region", "select", { opts: REG }], ["city_town", "Town", "text"], ["physical_address", "Address", "text"], ["payout_method", "Payout network", "select", { opts: NET }], ["payout_account", "Payout number", "text"], ["payout_account_name", "Payout account name", "text"]],
    "project-manager": [["full_name", "Full name", "text"], ["engagement_type", "How you work", "select", { opts: ENG }], ["specialization", "Main specialty", "select", { opts: PHASE }], ["specialization_tags", "Specialties (comma separated)", "list"], ["years_managing_projects", "Years managing projects", "number"], ["projects_managed_count", "Projects managed", "number"], ["certification_body", "Certification body", "text"], ["certification_number", "Certification number", "text"], ["region", "Region", "select", { opts: REG }], ["city_town", "Town", "text"], ["payout_method", "Payout network", "select", { opts: NET }], ["payout_account", "Payout number", "text"], ["payout_account_name", "Payout account name", "text"]],
    business: [["business_name", "Business name", "text"], ["short_bio", "About the business", "area", { max: 400 }], ["specialty", "What you supply", "text"], ["entity_type", "Business type", "select", { opts: ENT }], ["contact_person_name", "Contact person", "text"], ["contact_email", "Contact email", "text"], ["crew_size", "Crew size", "number"], ["years_in_operation", "Years in operation", "number"], ["service_areas", "Service areas (comma separated)", "list"], ["willing_to_travel_km", "Delivery range (km)", "number"], ["accepting_orders", "Accepting orders", "bool"], ["region", "Region", "select", { opts: REG }], ["city_town", "Town", "text"], ["physical_address", "Address", "text"], ["payout_method", "Payout network", "select", { opts: NET }], ["payout_account", "Payout number", "text"], ["payout_account_name", "Payout account name", "text"]],
    "individual-employer": [["full_name", "Full name", "text"], ["email", "Email", "text"], ["region", "Region", "select", { opts: REG }], ["city_town", "Town", "text"]],
  };
  const PHOTO = { worker: ["profile_photo_url", "portfolios", "Profile photo"], "project-manager": ["profile_photo_url", "portfolios", "Profile photo"], "individual-employer": ["profile_photo_url", "portfolios", "Profile photo"], company: ["company_logo_url", "company-logos", "Company logo"], business: ["logo_url", "logos", "Business logo"] };

  async function editProfileView(c) {
    const { head } = U(), p = c.profile, fields = FIELDS[c.role], [pcol, , plabel] = PHOTO[c.role];
    const cats = JOB_CATS.map((j) => [j.id, j.name]);
    const field = ([col, label, kind, x = {}]) => {
      const v = p[col];
      if (kind === "text") return fld(label, inp(col, { val: v }));
      if (kind === "area") return fld(label, area(col, { val: v, ph: x.ph, max: x.max }));
      if (kind === "number") return fld(label, inp(col, { type: "number", val: v, min: 0, step: "any" }));
      if (kind === "select") return fld(label, sel(col, x.opts, v));
      if (kind === "jobcat") return fld(label, sel(col, [["", "Choose a trade"], ...cats], v));
      if (kind === "list") return fld(label, inp(col, { val: (v || []).join(", ") }));
      if (kind === "bool") return chk(col, label, !!v);
      return "";
    };
    return head("Edit profile") + `<form class="pform" data-fx-form="edit-profile" autocomplete="off">
      <div class="fs"><h3>${esc(plabel)}</h3><div class="photo-row"><span class="av lg" ${p[pcol] ? `style="background-image:url('${esc(p[pcol])}')"` : ""}>${p[pcol] ? "" : esc(initials(p[ROLES[c.role].nameKey]))}</span><label class="btn-dark sm filebtn">Choose photo<input type="file" name="photo" accept="image/*" hidden /></label></div></div>
      <div class="fs"><h3>Cover image</h3><div class="cover-prev" id="coverPrev" ${p.cover_url ? `style="background-image:url('${esc(p.cover_url)}')"` : ""}>${p.cover_url ? "" : "No cover image yet"}</div><label class="btn-dark sm filebtn">Choose cover image<input type="file" name="cover" accept="image/*" hidden onchange="var f=this.files[0];if(f){var b=document.getElementById('coverPrev');b.style.backgroundImage='url('+URL.createObjectURL(f)+')';b.textContent='';}" /></label><p class="cap2">Shown at the top of your card in Discover and on your public profile. Wide photos work best.</p></div>
      <div class="fs"><h3>Details</h3>${fields.map(field).join("")}</div>
      <p class="cap2">Your phone number and verification status are changed elsewhere. Verification can only be decided by BAID X.</p>
      <button class="btn-light" type="submit" style="width:100%">Save changes</button></form>`;
  }

  async function submitEditProfile(c, form, btn) {
    const d = new FormData(form), patch = {};
    for (const [col, , kind] of FIELDS[c.role]) {
      if (kind === "bool") { patch[col] = form.querySelector(`[name="${col}"]`).checked; continue; }
      const raw = String(d.get(col) ?? "").trim();
      if (kind === "number") patch[col] = raw === "" ? null : Number(raw);
      else if (kind === "list") patch[col] = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
      else patch[col] = raw === "" ? null : raw;
    }
    for (const req of ["full_name", "company_name", "business_name"]) if (req in patch && !patch[req]) throw new Error("Name can't be empty.");
    const file = form.querySelector('[name="photo"]').files[0];
    if (file) { const [col, bucket] = PHOTO[c.role]; const path = await upload(c, bucket, file, "photo"); patch[col] = publicUrl(c, bucket, path); }
    const cover = form.querySelector('[name="cover"]').files[0];
    if (cover) { const [, bucket] = PHOTO[c.role]; const path = await upload(c, bucket, cover, "cover"); patch.cover_url = publicUrl(c, bucket, path); }
    await save(c, patch);
  }

  /* ======================================================================
     Verification
     ====================================================================== */
  const CARD_FRONT = ["ghana_card_front_url", "Ghana Card, front", "ghana-cards"], CARD_BACK = ["ghana_card_back_url", "Ghana Card, back", "ghana-cards"];
  const VDOCS = {
    worker: { blurb: "Confirm who you are so clients and companies can trust your profile.", items: [["ghana_card_number", "Ghana Card number", "text", { ph: "GHA-000000000-0", req: true }], { ...{}, f: CARD_FRONT, req: true }, { f: CARD_BACK, req: true }, { f: ["profile_photo_url", "Clear photo of your face", "portfolios", true], req: true }, { f: ["qualification_doc_url", "Trade certificate or qualification (optional)", "trade-licenses"] }] },
    "project-manager": { blurb: "Confirm your identity and, if you have one, your project management certificate.", items: [["ghana_card_number", "Ghana Card number", "text", { ph: "GHA-000000000-0", req: true }], { f: CARD_FRONT, req: true }, { f: CARD_BACK, req: true }, { f: ["profile_photo_url", "Clear photo of your face", "portfolios", true], req: true }, { f: ["certification_doc_url", "Certification (optional)", "trade-licenses"] }] },
    company: { blurb: "Confirm your company is registered so workers and suppliers can trust you.", items: [["rgd_registration_number", "Registrar General (RGD) number", "text", { req: true }], ["tin_number", "Tax Identification Number (TIN)", "text", { req: true }], { f: ["business_registration_doc_url", "Business registration document", "business-docs"], req: true }, ["contact_ghana_card_number", "Contact person's Ghana Card number", "text", { req: true }], { f: ["contact_ghana_card_url", "Contact person's Ghana Card", "ghana-cards"], req: true }, { f: ["company_logo_url", "Company logo (optional)", "company-logos", true] }] },
    business: { blurb: "Confirm your business so buyers know they are dealing with a real supplier.", items: [["rgd_registration_number", "Registrar General (RGD) number", "text", { req: true }], ["tin_number", "Tax Identification Number (TIN)", "text", { req: true }], { f: ["business_registration_doc_url", "Business registration document", "business-docs"], req: true }, ["ghana_card_number", "Owner's Ghana Card number", "text", { req: true }], { f: CARD_FRONT, req: true }, { f: CARD_BACK, req: true }, { f: ["trade_license_url", "Trade licence (optional)", "trade-licenses"] }, { f: ["logo_url", "Business logo (optional)", "logos", true] }] },
    "individual-employer": { blurb: "Confirm who you are so the people you hire know you are real.", items: [["ps.ghana_card_number", "Ghana Card number", "text", { ph: "GHA-000000000-0", req: true }], { f: ["ps.ghana_card_front", "Ghana Card, front", "ghana-cards"], req: true }, { f: ["ps.ghana_card_back", "Ghana Card, back", "ghana-cards"], req: true }, { f: ["profile_photo_url", "Clear photo of your face", "portfolios", true], req: true }] },
  };
  const getV = (p, col) => (col.startsWith("ps.") ? (p.profile_sections || {})[col.slice(3)] : p[col]);
  const STATE = { pending_verification: ["Under review", "warn", "We have your documents. A BAID X reviewer will decide soon, and you'll be notified."], verified: ["Verified", "ok", "Your account is verified. This badge is separate from any paid plan."], rejected: ["Not approved", "bad", "The review was not approved. Fix the points below and submit again."], resubmit_required: ["Action needed", "warn", "Please add or replace your documents, then submit for review."] };

  async function verificationView(c) {
    const { head } = U(), p = c.profile, cfg = VDOCS[c.role], st = STATE[p.verification_status] || ["Not submitted", "", "Add your documents, then submit them for review."];
    const rows = cfg.items.map((it) => {
      if (Array.isArray(it)) { const [col, label, , o = {}] = it; const v = getV(p, col); return fld(label + (o.req ? "" : ""), inp(col, { val: v, ph: o.ph })); }
      const [col, label, , isPublic] = it.f, v = getV(p, col);
      return `<div class="doc"><span class="tx"><b>${esc(label)}</b><small>${v ? "Uploaded. Choose a file to replace it." : it.req ? "Required" : "Optional"}</small></span>${v ? `<span class="pill ok">Uploaded</span>` : ""}<label class="btn-dark sm filebtn">${v ? "Replace" : "Upload"}<input type="file" name="file:${esc(col)}" accept="image/*,application/pdf" hidden /></label></div>`;
    }).join("");
    return head("Verification") + `<div class="dcard"><h4><span>Status</span><span class="pill ${st[1]}">${esc(st[0])}</span></h4><p class="cap2">${esc(st[2])}</p>${p.rejection_reason && ["rejected", "resubmit_required"].includes(p.verification_status) ? `<div class="req"><small>Reviewer note</small><p>${esc(p.rejection_reason)}</p></div>` : ""}</div>
      <p class="sub2">${esc(cfg.blurb)}</p>
      <form class="pform" data-fx-form="verification" autocomplete="off"><div class="fs"><h3>Documents</h3><div class="doc-list">${rows}</div></div>
      <p class="cap2">Photos and PDFs up to 8 MB. Your documents are private. Only you and BAID X reviewers can open them. Verification is a separate review and is never part of a paid plan.</p>
      <button class="btn-light" type="submit" style="width:100%">${p.verification_status === "pending_verification" ? "Update and resubmit" : "Submit for review"}</button></form>`;
  }

  async function submitVerification(c, form) {
    const p = c.profile, cfg = VDOCS[c.role], patch = {}, ps = { ...(p.profile_sections || {}) };
    let usePs = false;
    for (const it of cfg.items) {
      if (Array.isArray(it)) {
        const [col, label, , o = {}] = it; const raw = String(new FormData(form).get(col) || "").trim();
        const have = getV(p, col); const val = raw || have;
        if (o.req && !val) throw new Error(`Enter your ${label.toLowerCase()}.`);
        if (raw) { if (col.startsWith("ps.")) { ps[col.slice(3)] = raw; usePs = true; } else patch[col] = raw; }
      } else {
        const [col, label, bucket, isPublic] = it.f, file = form.querySelector(`[name="file:${col}"]`).files[0], have = getV(p, col);
        if (it.req && !file && !have) throw new Error(`Add: ${label}.`);
        if (file) { const path = await upload(c, bucket, file, col.replace(/\W/g, "")); const val = isPublic ? publicUrl(c, bucket, path) : path; if (col.startsWith("ps.")) { ps[col.slice(3)] = val; usePs = true; } else patch[col] = val; }
      }
    }
    if (usePs) patch.profile_sections = ps;
    patch.verification_status = "pending_verification"; patch.profile_status = "pending_review";
    await save(c, patch);
  }

  /* ======================================================================
     Portfolio (photos for workers and businesses, past projects for project managers)
     ====================================================================== */
  async function portfolioView(c) {
    const { head, empty } = U(), p = c.profile;
    if (c.role === "project-manager") {
      const list = Array.isArray(p.past_projects_json) ? p.past_projects_json : [];
      return head("Past projects", `<button class="btn-light sm" data-fx="add-past">Add</button>`) + (list.length ? list.map((x, i) => `<div class="dcard"><h4><span>${esc(x.name)}</span><span class="amb">${esc(x.year || "")}</span></h4><p class="cap2">${esc([x.client, x.description].filter(Boolean).join(" · "))}</p><button class="btn-dark sm" data-fx="del-past" data-i="${i}">Remove</button></div>`).join("") : empty("proj", "No past projects yet", "Show projects you have delivered so clients can see your track record.", `<button class="btn-light sm" data-fx="add-past">Add a project</button>`));
    }
    const col = "portfolio_photo_urls", photos = p[col] || [];
    return head("Portfolio", `<label class="btn-light sm filebtn">Add photos<input type="file" id="pfFiles" accept="image/*" multiple hidden /></label>`) + `<p class="sub2">${c.role === "worker" ? "Show your best finished work." : "Show your products and past supply."} Photos are public on your profile.</p>`
      + (photos.length ? `<div class="pgrid">${photos.map((u, i) => `<div class="pph"><img src="${esc(u)}" alt="Portfolio photo ${i + 1}" loading="lazy" /><button class="pdel" data-fx="del-photo" data-i="${i}" aria-label="Remove photo">${icon("plus", 14)}</button></div>`).join("")}</div>` : empty("rep", "No photos yet", "Add photos of completed work to build trust."));
  }

  async function certsView(c) {
    const { head, empty } = U(), p = c.profile;
    if (c.role === "project-manager") {
      return head("Certifications") + `<form class="pform" data-fx-form="pm-cert" autocomplete="off"><div class="fs"><h3>Project management certificate</h3>${fld("Certification body", inp("certification_body", { val: p.certification_body, ph: "e.g. PMI, PRINCE2" }))}${fld("Certificate number", inp("certification_number", { val: p.certification_number }))}
        <div class="doc"><span class="tx"><b>Certificate document</b><small>${p.certification_doc_url ? "Uploaded. Choose a file to replace it." : "Optional"}</small></span>${p.certification_doc_url ? `<span class="pill ok">Uploaded</span>` : ""}<label class="btn-dark sm filebtn">${p.certification_doc_url ? "Replace" : "Upload"}<input type="file" name="doc" accept="image/*,application/pdf" hidden /></label></div></div>
        <button class="btn-light" type="submit" style="width:100%">Save</button></form>`;
    }
    const { data } = await c.sb.from("worker_certifications").select("id,cert_name,issuing_body,verified,created_at").eq("worker_id", c.uid).order("created_at", { ascending: false });
    return head("Certifications", `<button class="btn-light sm" data-fx="add-cert">Add</button>`) + ((data || []).length ? data.map((x) => `<div class="row"><span class="ic">${icon("rep", 17)}</span><span class="tx"><b>${esc(x.cert_name)}</b><small>${esc(x.issuing_body || "Issuer not set")} · ${esc(ago(x.created_at))}</small></span>${x.verified ? `<span class="pill ok">Checked</span>` : `<span class="pill warn">Not checked</span>`}<button class="btn-dark sm" data-fx="del-cert" data-id="${esc(x.id)}">Remove</button></div>`).join("")
      : empty("rep", "No certifications yet", "Upload trade certificates and licences to build trust.", `<button class="btn-light sm" data-fx="add-cert">Add certification</button>`));
  }

  /* ======================================================================
     Company link (join code)
     ====================================================================== */
  async function teamLinkView(c) {
    const { head, empty } = U(), links = (await rpc(c, "my_pm_links").catch(() => [])) || [];
    const status = (s) => `<span class="pill ${s === "approved" ? "ok" : s === "pending" ? "warn" : "bad"}">${esc(pretty(s))}</span>`;
    if (c.role === "company") {
      return head("Team & join code") + `<div class="dcard"><h4><span>Join code</span></h4><p class="cap2">Give this one-time code to a project manager. They enter it, you approve the link. A new code replaces the old one and lasts 30 days.</p><div id="codeBox"></div><button class="btn-light sm" data-fx="make-code">Create a code</button></div>`
        + `<div class="sec">Linked project managers</div>` + (links.length ? links.map((l) => `<div class="row"><span class="av">${esc(initials(l.pm))}</span><span class="tx"><b>${esc(l.pm || "Project manager")}</b><small>${esc(ago(l.requested_at))}</small></span>${status(l.status)}${l.status === "pending" ? `<button class="btn-light sm" data-fx="link-yes" data-id="${esc(l.id)}">Approve</button><button class="btn-dark sm" data-fx="link-no" data-id="${esc(l.id)}">Decline</button>` : l.status === "approved" ? `<button class="btn-dark sm" data-fx="link-no" data-id="${esc(l.id)}">Remove</button>` : ""}</div>`).join("") : empty("team", "No linked project managers", "Create a code and share it with the project manager you work with."));
    }
    return head("Link a company") + `<form class="inline-f" data-fx-form="link-code" autocomplete="off">${inp("code", { ph: "Enter the company's code", req: true, max: 16 })}<button class="btn-light sm" type="submit">Request link</button></form>`
      + `<div class="sec">Your links</div>` + (links.length ? links.map((l) => `<div class="row"><span class="av">${esc(initials(l.company))}</span><span class="tx"><b>${esc(l.company || "Company")}</b><small>${esc(ago(l.requested_at))}</small></span>${status(l.status)}</div>`).join("") : `<div class="cap2">No links yet.</div>`);
  }

  /* ======================================================================
     Help and policies
     ====================================================================== */
  const INFO = {
    help: ["Help center", [["How do I get verified?", "Open Profile → Verification documents. Add your Ghana Card (or business papers), then submit. A BAID X reviewer decides and you get a notification."], ["Does a paid plan make me verified?", "No. Plans and verification are separate. Verification is a review of your documents. Paying for a plan never changes it."], ["How do I add money to my wallet?", "Open Wallet → Add money, send the amount by Mobile Money using the details shown, and add your reference. Your balance updates after BAID X confirms the payment."], ["How do projects work?", "A company creates a project and invites a project manager. The project manager builds the team, assigns tasks and files reports. The company approves requests, payments and completion."], ["How do I contact support?", "Message us through Chats, or email the address shown under About BAID X."]]],
    terms: ["Terms of service", [["Draft", "These terms are a working draft for the BAID X test period and will be replaced by the final terms before launch."], ["Using BAID X", "You must give accurate information, keep your sign-in private, and use the platform lawfully. Accounts that mislead others can be suspended."], ["Payments", "Payments and subscriptions are processed by Paystack. Plan prices, trial rules, the 7-day refund window and cancellation rules are shown before you pay."], ["Verification", "Verification is a review by BAID X. Paying for any service does not guarantee approval."]]],
    privacy: ["Privacy policy", [["Draft", "This policy is a working draft for the BAID X test period and will be replaced by the final policy before launch."], ["What we collect", "Profile details you enter, documents you upload for verification, messages, project activity and payment records."], ["Who can see it", "Verification documents are private to you and BAID X reviewers. Public profile fields are visible to other members. Card details never reach BAID X; Paystack handles them."], ["Your choices", "You can edit your profile any time and ask us to close your account."]]],
    about: ["About BAID X", [["Ghana's work network", "BAID X connects professionals, companies, project managers, suppliers and clients, and helps them run real projects with trust."], ["Built by", "Baiden Creatives."], ["Version", "Test release"]]],
  };
  async function infoView(c, arg) {
    const { head } = U(), [title, items] = INFO[arg] || INFO.help;
    return head(title) + items.map(([q, a]) => `<details class="dcard rl"><summary><span><b>${esc(q)}</b></span></summary><p class="cap2" style="margin-top:6px">${esc(a)}</p></details>`).join("");
  }

  /* ======================================================================
     Account sheets, public profile
     ====================================================================== */
  async function publicProfile(c) {
    const p = c.profile, r = ROLES[c.role], name = p[r.nameKey] || "Your account", photo = p.profile_photo_url || p.company_logo_url || p.logo_url;
    const vs = p.verification_status === "verified";
    openSheet("How others see you", `${p.cover_url ? `<div class="cover-prev" style="background-image:url('${esc(p.cover_url)}');margin-bottom:12px"></div>` : ""}<div class="pv"><span class="av lg" ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>${photo ? "" : esc(initials(name))}</span><h3>${esc(name)} ${vs ? `<span class="pill ok">Verified</span>` : ""}</h3><p class="cap2">${esc(r.account)} · ${esc([p.city_town, p.region].filter(Boolean).join(", ") || "Ghana")}</p>${p.short_bio || p.company_overview || p.personal_statement ? `<p>${esc(p.short_bio || p.company_overview || p.personal_statement)}</p>` : `<p class="cap2">Add a short bio in Edit profile.</p>`}</div>${vs ? "" : `<button class="btn-light" style="width:100%" data-go="verification">Get verified</button>`}`);
  }

  const FX = {
    "open-docs": () => { window.open("docs.html", "_blank", "noopener"); },
    "public-profile": (c) => publicProfile(c),
    "add-email": (c) => openSheet("Add email", `<form data-fx-form="add-email">${fld("Email address", inp("email", { type: "email", req: true, val: c.me.session.user.email }), "We send a link to confirm it.")}<button class="btn-light" type="submit" style="width:100%">Send confirmation</button></form>`),
    "change-phone": (c) => openSheet("Change phone", `<form data-fx-form="change-phone">${fld("New mobile number", inp("phone", { type: "tel", ph: "+233201234567", req: true }), "Include the country code. We text a code to confirm.")}<button class="btn-light" type="submit" style="width:100%">Send code</button></form>`),
    "change-password": (c) => openSheet("Change password", `<form data-fx-form="change-password">${fld("New password", inp("pw", { type: "password", req: true, min: 8 }), "At least 8 characters.")}${fld("Confirm new password", inp("pw2", { type: "password", req: true }))}<button class="btn-light" type="submit" style="width:100%">Update password</button></form>`),
    "add-past": () => openSheet("Add a past project", `<form data-fx-form="add-past">${fld("Project name", inp("name", { req: true, max: 100 }))}${fld("Client", inp("client", { max: 100 }))}${fld("Year", inp("year", { type: "number", min: 1990, step: 1 }))}${fld("What you delivered", area("description", { max: 400 }))}<button class="btn-light" type="submit" style="width:100%">Add project</button></form>`),
    "del-past": async (c, el) => { const list = [...(c.profile.past_projects_json || [])]; list.splice(+el.dataset.i, 1); await save(c, { past_projects_json: list }); await refreshMe(); },
    "del-photo": async (c, el) => { const list = [...(c.profile.portfolio_photo_urls || [])]; list.splice(+el.dataset.i, 1); await save(c, { portfolio_photo_urls: list }); await refreshMe(); },
    "add-cert": () => openSheet("Add certification", `<form data-fx-form="add-cert">${fld("Certificate name", inp("name", { req: true, max: 120, ph: "e.g. NVTI Electrical Installation" }))}${fld("Issued by", inp("issuer", { max: 120 }))}<div class="doc"><span class="tx"><b>Certificate file</b><small>Photo or PDF, up to 8 MB</small></span><label class="btn-dark sm filebtn">Choose<input type="file" name="doc" accept="image/*,application/pdf" hidden required /></label></div><button class="btn-light" type="submit" style="width:100%">Save certification</button></form>`),
    "del-cert": async (c, el) => { const { error } = await c.sb.from("worker_certifications").delete().eq("id", el.dataset.id); if (error) throw error; window.APP.route(); },
    "make-code": async (c) => { const code = await rpc(c, "create_join_code"); document.getElementById("codeBox").innerHTML = `<div class="codebig">${esc(code)}</div><p class="cap2">Shown once. Share it with your project manager.</p>`; },
    "link-yes": async (c, el) => { await rpc(c, "decide_pm_link", { p_link: el.dataset.id, p_approve: true }); c.toast("Linked"); window.APP.route(); },
    "link-no": async (c, el) => { await rpc(c, "decide_pm_link", { p_link: el.dataset.id, p_approve: false }); window.APP.route(); },
  };
  window.FX = Object.assign(window.FX || {}, FX);

  /* profile card sheet for Discover (works for guests too) */
  async function openCard(kind, id) {
    const c = window.APP.state.me?.role ? window.APP.dashCtx() : null, src = { company: "companies", worker: "professionals", pm: "managers", business: "businesses" }[kind], S = window.APP.sources[src];
    const { data } = await window.BX.sb.from(S.table).select(S.cols).eq("id", id).maybeSingle();
    if (!data) return window.BX.toast("This profile isn't available.");
    const it = S.map(data), vs = data.verification_status === "verified", me = window.APP.state.me;
    openSheet(it.name, `${it.cover ? `<div class="cover-prev" style="background-image:url('${esc(it.cover)}');margin-bottom:12px"></div>` : ""}<div class="pv"><span class="av lg" ${it.image ? `style="background-image:url('${esc(it.image)}')"` : ""}>${it.image ? "" : esc(initials(it.name))}</span><h3>${esc(it.name)} ${vs ? `<span class="pill ok">Verified</span>` : ""}</h3><p class="cap2">${esc(it.tag)} · ${esc(it.place)}</p><p>${esc(it.desc)}</p></div>
      <div class="stats">${it.stats.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><small>${esc(l)}</small></div>`).join("")}</div>
      ${me?.role ? (id === c.uid ? `<p class="cap2" style="margin-top:12px">This is you.</p>` : `<button class="btn-light" style="width:100%;margin-top:14px" data-fx="message" data-id="${esc(id)}" data-name="${esc(it.name)}">Message</button>`) : `<button class="btn-light" style="width:100%;margin-top:14px" data-action="signin">Sign in to message</button>`}`);
  }
  window.FEAT = { openCard, openSheet, closeSheet, upload, publicUrl, signedUrl, fld, inp, area, sel, chk, rpc, fail, busyBtn };

  /* ---------- events ---------- */
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) return closeSheet();
    const el = e.target.closest("[data-fx]"); if (!el || !window.APP?.state.me?.role) return;
    const fn = window.FX[el.dataset.fx]; if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    try { await fn(window.APP.dashCtx(), el, e); } catch (err) { fail(window.APP.dashCtx(), err); }
  }, true);
  document.addEventListener("change", async (e) => {
    if (e.target.id !== "pfFiles" || !window.APP?.state.me?.role) return;
    const c = window.APP.dashCtx(), files = [...e.target.files].slice(0, 6);
    try { const urls = []; for (const f of files) urls.push(publicUrl(c, "portfolios", await upload(c, "portfolios", f, "work"))); await save(c, { portfolio_photo_urls: [...(c.profile.portfolio_photo_urls || []), ...urls] }); c.toast("Photos added"); await refreshMe(); } catch (err) { fail(c, err); }
  });
  document.addEventListener("change", (e) => {
    const i = e.target; if (i.type !== "file" || !i.closest("[data-fx-form]")) return;
    const lab = i.closest(".filebtn"); if (lab && i.files[0]) { const t = lab.childNodes[0]; if (t) t.textContent = i.files[0].name.slice(0, 18) + " ✓"; }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-fx-form]"); if (!form || !window.APP?.state.me?.role) return;
    e.preventDefault();
    const c = window.APP.dashCtx(), k = form.dataset.fxForm, d = Object.fromEntries(new FormData(form)), btn = form.querySelector('[type="submit"]');
    busyBtn(btn, true);
    try {
      if (k === "edit-profile") { await submitEditProfile(c, form); c.toast("Profile saved"); await refreshMe(); c.go("profile"); }
      else if (k === "verification") { await submitVerification(c, form); c.toast("Submitted for review"); await refreshMe(); }
      else if (k === "add-past") { await save(c, { past_projects_json: [...(c.profile.past_projects_json || []), { name: d.name, client: d.client, year: d.year, description: d.description }] }); closeSheet(); await refreshMe(); }
      else if (k === "add-cert") { const file = form.querySelector('[name="doc"]').files[0]; const path = await upload(c, "trade-licenses", file, "cert"); const { error } = await c.sb.from("worker_certifications").insert({ worker_id: c.uid, cert_name: d.name, issuing_body: d.issuer || null, document_url: path }); if (error) throw error; closeSheet(); c.toast("Certification added"); window.APP.route(); }
      else if (k === "pm-cert") { const patch = { certification_body: d.certification_body || null, certification_number: d.certification_number || null }; const f = form.querySelector('[name="doc"]').files[0]; if (f) patch.certification_doc_url = await upload(c, "trade-licenses", f, "cert"); await save(c, patch); c.toast("Saved"); await refreshMe(); window.APP.route(); }
      else if (k === "link-code") { await rpc(c, "request_pm_link", { p_code: d.code }); c.toast("Request sent. The company will review it."); window.APP.route(); }
      else if (k === "add-email") { const { error } = await c.sb.auth.updateUser({ email: d.email }); if (error) throw error; closeSheet(); c.toast("Check your email to confirm."); }
      else if (k === "change-phone") { const { error } = await c.sb.auth.updateUser({ phone: d.phone.replace(/\s/g, "") }); if (error) throw new Error("Phone changes need SMS, which isn't switched on yet."); closeSheet(); c.toast("We texted you a code."); }
      else if (k === "change-password") { if (d.pw !== d.pw2) throw new Error("The two passwords don't match."); const { error } = await c.sb.auth.updateUser({ password: d.pw }); if (error) throw error; closeSheet(); c.toast("Password updated"); }
    } catch (err) { fail(c, err); }
    busyBtn(btn, false);
  });
  window.addEventListener("hashchange", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  window.DASH.register("edit-profile", editProfileView);
  window.DASH.register("verification", verificationView);
  window.DASH.register("portfolio", portfolioView);
  window.DASH.register("certs", certsView);
  window.DASH.register("team-link", teamLinkView);
  window.DASH.register("info", infoView);
})();
