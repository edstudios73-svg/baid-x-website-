/* Shared helpers, role definitions and category data for every BAID X page. */
(() => {
  "use strict";
  // Capture a password-recovery link before the Supabase client consumes and clears the URL hash.
  window.BX_RECOVERY = /type=recovery/.test(location.hash + location.search);
  const cfg = window.BAIDX_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const real = (v) => !!v && String(v).trim() !== "" && String(v).toLowerCase() !== "pending";

  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  /* ---------- Job categories (mirror of public.job_categories; guests and new users cannot read that table) ---------- */
  const PHASES = {
    structural: "Structural & Site Works",
    electrical_mechanical: "Electrical & Mechanical",
    plumbing_water: "Plumbing & Water",
    finishing_interior: "Finishing & Interior",
    exterior_compound: "Exterior & Compound",
    support_general: "Support & General",
  };
  const J = (phase, rows) => rows.map(([id, name]) => ({ id, name, phase }));
  const JOB_CATS = [
    ...J("structural", [["bf56961c-a599-4b4f-9c37-eea21c0e8998", "Mason / Block Layer"], ["6ae7bf46-1564-441b-9a41-8127f8947876", "Steel Bender / Iron Bender"], ["4bf4c8bd-c1d1-4062-814e-011e09069a0b", "Concrete Worker / Pourer"], ["0bd54968-7270-4776-9b23-8cdb77ad15c8", "Carpenter (Structural / Formwork)"], ["c4ea3b2a-f40c-4676-b503-39e54de0c707", "Scaffolder"], ["151e1eb4-0ee4-48f1-ba7f-ff679e3b0881", "Excavator Operator"], ["5f412540-9a21-43a4-ad8f-8cbe71faa511", "Bulldozer / Grader Operator"], ["d59ead2c-deed-46ae-87d0-c79a527be23e", "Site Foreman / Supervisor"], ["88d2584a-9b50-48a7-a53d-76f7f3038c35", "Borehole Driller"], ["af532cf8-1fe0-4372-a0d3-cd57ddce68e4", "Land Surveyor Assistant"]]),
    ...J("electrical_mechanical", [["bb7f934f-fffa-46c3-b031-4dd6408b11ba", "Electrician"], ["d868cda9-9ecc-4554-a217-617e269655db", "AC / HVAC Technician"], ["1b017073-8e79-45c2-a009-cba5269b0adc", "Generator Technician"], ["0c47f4ed-0601-463a-95cb-20b7f76efb30", "Solar Panel Installer"], ["6d649839-d4ec-471b-bf3c-b695dd9bffde", "Elevator / Lift Technician"], ["ff2622c5-5dd9-4fe4-95b0-4d3804d630c3", "CCTV / Security Systems Installer"], ["231b5ac9-4bb9-487d-b7fc-ffe6c3826180", "Network / Structured Cabling Technician"], ["9998564d-97e7-4769-a9b2-642f3a93610f", "Fire Safety Systems Installer"], ["29e05c5d-b433-4f4f-a7af-1fc99a5ff3f6", "Satellite Dish / TV Aerial Installer"], ["ddfa3c9f-d6f9-4d43-b73a-9b43d126dcff", "Swimming Pool Technician"]]),
    ...J("plumbing_water", [["3bec9905-9cef-4391-b685-f69f0dacecd3", "Plumber"], ["b32b2aab-8845-4fb4-9df3-91bd0fcad910", "Borehole Pump Mechanic"], ["659772be-9163-49fd-ad7c-eab795d8fd96", "Septic Tank / Soakaway Constructor"], ["8b941981-ab7a-4cab-9ae2-ba0008cee0bf", "Waterproofing Specialist"], ["2c4a9623-18f8-4833-b0fa-028867b3442a", "Gutter Installer"]]),
    ...J("finishing_interior", [["0f7a801e-a1ac-453e-a913-926c0ebb4bcc", "Painter"], ["bf17a29f-78d2-4b04-9cd6-c47b12f8a80b", "Tiler"], ["91c8f3d7-ae6a-481f-b719-a4b094698ea8", "POP / Ceiling Installer"], ["339153e7-bffa-4056-b2f1-68df8b179334", "Screeder"], ["28f17c47-33bc-4ee4-81e0-c2b635938591", "Terrazzo / Granite Fixer"], ["30a6c143-11f7-4da9-acd1-54c56e4f4ec3", "Interior Decorator"], ["29e43fac-36f3-47fb-9548-501138a15322", "Wallpaper Installer"], ["6a6d1881-6d9b-45fa-be33-e9ba14bdbdd1", "Cabinetmaker / Kitchen Cabinet Installer"], ["a154f45b-b024-4494-aedd-11a947e07297", "Wardrobe / Closet Installer"], ["7e21e6f2-70d9-43c2-af34-c1c34be80758", "Wood Polisher / Varnisher"], ["649769ca-a821-4a37-a0e9-746ad83ffd35", "Upholsterer"], ["31376931-4c8c-4d18-9c3c-fe2f4c753399", "Curtain / Blinds Installer"], ["b7a3bc27-3c95-4bd2-9d71-6deba83b6c2f", "Glass Tinting Technician"], ["649d1fee-ec7a-431d-809b-d0d7089598a7", "Aluminium & Glazing Installer"], ["782ba896-56aa-4988-b89b-9b278500f530", "Locksmith"]]),
    ...J("exterior_compound", [["5aaf67d4-6bc7-4c8d-bf71-8414a1943aca", "Roofer"], ["642c9737-6a8d-40a2-8edd-dab46b04f831", "Welder / Metal Fabricator"], ["5610402e-321e-433e-8138-daf4b9bc6312", "Fence Wall Builder"], ["f8d8403b-305a-421b-96d8-9bbb99bb6686", "Gate Fabricator / Installer"], ["49e1bc33-b589-4085-8018-696bbfd4428b", "Interlock / Paving Block Layer"], ["7fed628e-f9d9-4d28-a4be-913750ec5895", "Landscaper / Gardener"], ["5612beaa-7f14-4e1a-bb54-20c0c4a3b116", "Fumigation / Pest Control Technician"]]),
    ...J("support_general", [["53f4413b-d10d-46a8-af9b-fe42b6d497ab", "Furniture Assembler"], ["61aa3f09-77f4-498a-bd81-a6bd838ec2c2", "Post-Construction Cleaner"], ["dc939e89-0044-4e02-90bd-74ef10937fc5", "General Handyman (Repairs & Maintenance)"]]),
  ];
  const JOB_CAT_BY_ID = Object.fromEntries(JOB_CATS.map((c) => [c.id, c]));

  /* ---------- Per-role category lists ---------- */
  const INDUSTRIES = [
    ["construction", "Construction", "Building, civil and contracting works"],
    ["real_estate_development", "Real Estate Development", "Developers and property builders"],
    ["property_management", "Property Management", "Managing and maintaining properties"],
    ["architecture_engineering", "Architecture & Engineering", "Design, drafting and engineering consultancy"],
    ["facilities_management", "Facilities Management", "Maintenance, cleaning and building services"],
    ["other", "Other", "Another construction-related industry"],
  ].map(([id, name, desc]) => ({ id, name, desc }));

  const SPECIALIZATIONS = [
    ["structural", "Structural & Civil", "Foundations, concrete, steel and site works"],
    ["electrical_mechanical", "Electrical & Mechanical", "Power, HVAC, solar, security and building systems"],
    ["plumbing_water", "Plumbing & Water", "Plumbing, boreholes, drainage and waterproofing"],
    ["finishing_interior", "Finishing & Interior", "Painting, tiling, ceilings, joinery and fit-out"],
    ["exterior_compound", "Exterior & Compound", "Roofing, fencing, paving and landscaping"],
    ["support_general", "General & Support", "Mixed trades, maintenance and site support"],
  ].map(([id, name, desc]) => ({ id, name, desc }));

  const SUPPLY = [
    ["Building Materials", "Blocks, sand, gravel and general materials"],
    ["Cement & Concrete", "Cement, ready-mix and concrete products"],
    ["Steel & Metalwork", "Iron rods, roofing sheets and metal fabrication"],
    ["Timber & Roofing", "Timber, trusses, roofing sheets and accessories"],
    ["Electrical Supplies", "Cables, switches, lighting and distribution"],
    ["Plumbing Supplies", "Pipes, fittings, tanks and sanitary ware"],
    ["Paint & Finishes", "Paints, coatings, sealants and adhesives"],
    ["Tiles & Flooring", "Tiles, granite, laminate and flooring"],
    ["Doors, Windows & Glass", "Aluminium, glass, doors and windows"],
    ["Tools & Hardware", "Hand tools, power tools and fixings"],
    ["Equipment Rental", "Excavators, mixers, scaffolding and machinery"],
    ["Safety & PPE", "Helmets, boots, harnesses and site safety gear"],
    ["Solar & Power", "Solar panels, inverters, batteries and generators"],
  ].map(([name, desc]) => ({ id: name, name, desc }));

  const CLIENT_NEEDS = ["Mason", "Electrician", "Plumber", "Carpenter", "Painter", "Tiler", "Roofer", "AC / HVAC Technician", "Welder", "General Handyman"]
    .map((name) => ({ id: name, name, desc: "" }));

  const REGIONS = ["Greater Accra", "Ashanti", "Central", "Eastern", "Western", "Western North", "Volta", "Oti", "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo"];

  /* ---------- Roles ---------- */
  const ico = (body) => `<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ROLES = {
    worker: {
      label: "Professional", short: "Professional", account: "Professional account",
      blurb: "Set up your personal trade profile and let clients and companies find and hire you.",
      icon: ico('<path d="M14 24a10 10 0 0 1 20 0z"/><path d="M11 24h26M24 12v6"/><circle cx="24" cy="30" r="4.5"/><path d="M13 43c1-6 5.500-8.500 11-8.500S34 37 35 43"/>'),
      table: "worker_profiles", nameKey: "full_name", phoneKey: "phone_number",
      nameTitle: "Your name", nameHelp: "Keep the account simple and identifiable. This is the name other people will see.", namePh: "Enter your full name",
      catTitle: "Trade category", catHelp: "Choose the trade you work in.", cats: "jobs",
    },
    company: {
      label: "Company", short: "Company", account: "Company account",
      blurb: "Post jobs, build projects and hire verified professionals, project managers and suppliers.",
      icon: ico('<path d="M10 42V12l16-6v36"/><path d="M26 18l12 4v20"/><path d="M5 42h38M16 18h4M16 25h4M16 32h4M31 28h3M31 35h3"/>'),
      table: "company_profiles", nameKey: "company_name", phoneKey: "contact_phone",
      nameTitle: "Company name", nameHelp: "Use your registered or trading name. Clients and professionals will see this.", namePh: "Enter your company name",
      catTitle: "Industry", catHelp: "Choose the industry your company works in.", cats: "industry",
    },
    "project-manager": {
      label: "Project Manager", short: "Project Manager", account: "Project manager account",
      blurb: "Run delivery on company projects: tasks, teams, reports and resource requests.",
      icon: ico('<rect x="9" y="8" width="30" height="35" rx="3"/><path d="M18 8V5h12v3M15 20h18M15 27h18M15 34h10"/><path d="m31 33 3 3 5-6" stroke-width="2.200"/>'),
      table: "project_manager_profiles", nameKey: "full_name", phoneKey: "phone_number",
      nameTitle: "Your name", nameHelp: "Keep the account simple and identifiable. This is the name other people will see.", namePh: "Enter your full name",
      catTitle: "Specialization", catHelp: "Choose the kind of projects you manage.", cats: "spec",
    },
    business: {
      label: "Supplier", short: "Supplier", account: "Supplier account",
      blurb: "List products, equipment and materials, and quote on what projects need.",
      icon: ico('<path d="M4 14h26v22H4z"/><path d="M30 20h9l5 7v9H30z"/><circle cx="14" cy="38" r="4" fill="#121212"/><circle cx="37" cy="38" r="4" fill="#121212"/>'),
      table: "business_profiles", nameKey: "business_name", phoneKey: "contact_phone",
      nameTitle: "Business name", nameHelp: "Use the name your customers know you by.", namePh: "Enter your business name",
      catTitle: "Supply category", catHelp: "Choose the main thing you supply.", cats: "supply",
    },
    "individual-employer": {
      label: "Client", short: "Client", account: "Client account",
      blurb: "Hiring for your home? Find a trade, message them and keep a record of your hires.",
      icon: ico('<path d="M6 22 24 8l18 14"/><path d="M10 19v22h28V19"/><path d="M20 41V29h8v12"/>'),
      table: "individual_employer_profiles", nameKey: "full_name", phoneKey: "phone_number",
      nameTitle: "Your name", nameHelp: "Keep the account simple and identifiable. This is the name professionals will see.", namePh: "Enter your full name",
      catTitle: "What do you need done?", catHelp: "Choose the trade you hire for most.", cats: "need",
    },
  };
  ROLES.worker.checklist = [
    ["Phone number", "Your verified mobile number.", (p) => real(p.phone_number)],
    ["Basic profile", "Add your name and account photo so clients can identify you.", (p) => real(p.full_name) && real(p.profile_photo_url)],
    ["Trade category", "Choose your profession and specialties.", (p) => !!p.primary_job_category_id],
    ["About you", "Add a short description of your work.", (p) => real(p.short_bio)],
    ["Portfolio", "Add completed works with images and descriptions.", (p) => (p.portfolio_photo_urls || []).length > 0],
    ["Location", "Add the city and region clients should use for your profile.", (p) => real(p.city_town) && real(p.region)],
    ["Years of experience", "Tell clients how long you have worked professionally.", (p) => real(p.years_of_experience)],
    ["Daily rate", "Set what you charge per day.", (p) => Number(p.daily_rate_ghs) > 0],
    ["Ghana Card", "Upload the identity document required for BAID X verification.", (p) => real(p.ghana_card_front_url)],
    ["Payout details", "Add the Mobile Money account you get paid on.", (p) => real(p.payout_account)],
  ];
  ROLES.company.checklist = [
    ["Phone number", "Your verified mobile number.", (p) => real(p.contact_phone)],
    ["Email", "Add and verify the email used for notices.", (p) => real(p.contact_email)],
    ["Basic profile", "Add your company name and logo.", (p) => real(p.company_name) && real(p.company_logo_url)],
    ["Industry", "Choose the industry your company works in.", (p) => real(p.industry_sector)],
    ["About your company", "Add a short description of what you do.", (p) => real(p.company_overview)],
    ["Location", "Add the city and region of your office.", (p) => real(p.city_town) && real(p.region)],
    ["Registration documents", "Upload your registration number or certificate.", (p) => real(p.rgd_registration_number) || real(p.business_registration_doc_url)],
    ["Contact person", "Add who we should speak to about this company.", (p) => real(p.contact_person_name)],
    ["Contact Ghana Card", "Upload the contact person's identity document.", (p) => real(p.contact_ghana_card_url)],
    ["Payout details", "Add the account used for payments.", (p) => real(p.payout_account)],
  ];
  ROLES["project-manager"].checklist = [
    ["Phone number", "Your verified mobile number.", (p) => real(p.phone_number)],
    ["Email", "Add and verify the email used for notices.", (p) => real(p.email)],
    ["Basic profile", "Add your name and account photo.", (p) => real(p.full_name) && real(p.profile_photo_url)],
    ["Specialization", "Choose the kind of projects you manage.", (p) => real(p.specialization)],
    ["Experience", "Add the years you have managed projects.", (p) => Number(p.years_managing_projects) > 0],
    ["Past projects", "Add projects you have delivered.", (p) => Array.isArray(p.past_projects_json) && p.past_projects_json.length > 0],
    ["Location", "Add the city and region you work from.", (p) => real(p.city_town) && real(p.region)],
    ["Ghana Card", "Upload the identity document required for verification.", (p) => real(p.ghana_card_front_url)],
    ["Certification", "Upload a project management certificate if you have one.", (p) => real(p.certification_doc_url)],
    ["Payout details", "Add the account you get paid on.", (p) => real(p.payout_account)],
  ];
  ROLES.business.checklist = [
    ["Phone number", "Your verified mobile number.", (p) => real(p.contact_phone)],
    ["Email", "Add and verify the email used for notices.", (p) => real(p.contact_email)],
    ["Basic profile", "Add your business name and logo.", (p) => real(p.business_name) && real(p.logo_url)],
    ["Supply category", "Choose the main thing you supply.", (p) => real(p.specialty)],
    ["About your business", "Add a tagline and description.", (p) => real(p.short_bio)],
    ["Portfolio", "Add photos of your products or past supply.", (p) => (p.portfolio_photo_urls || []).length > 0],
    ["Location", "Add the city and region of your shop or yard.", (p) => real(p.city_town) && real(p.region)],
    ["Registration documents", "Upload your business registration.", (p) => real(p.rgd_registration_number) || real(p.business_registration_doc_url)],
    ["Ghana Card", "Upload the owner's identity document.", (p) => real(p.ghana_card_front_url)],
    ["Payout details", "Add the account you get paid on.", (p) => real(p.payout_account)],
  ];
  ROLES["individual-employer"].checklist = [
    ["Phone number", "Your verified mobile number.", (p) => real(p.phone_number)],
    ["Email", "Add and verify an email address.", (p) => real(p.email)],
    ["Basic profile", "Add your name and account photo.", (p) => real(p.full_name) && real(p.profile_photo_url)],
    ["Location", "Add where the work will be done.", (p) => real(p.city_town) && real(p.region)],
    ["What you hire for", "Choose the trade you hire for most.", (p) => !!(p.profile_sections && p.profile_sections.need_category)],
  ];

  function categoriesFor(role) {
    switch (ROLES[role].cats) {
      case "jobs": return { grouped: true, items: JOB_CATS.map((c) => ({ id: c.id, name: c.name, desc: PHASES[c.phase], group: PHASES[c.phase] })) };
      case "industry": return { items: INDUSTRIES };
      case "spec": return { items: SPECIALIZATIONS };
      case "supply": return { items: SUPPLY };
      default: return { items: CLIENT_NEEDS };
    }
  }

  /* ---------- Session ---------- */
  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data: ar } = await sb.from("account_roles").select("role,account_status").eq("user_id", session.user.id).maybeSingle();
    const role = ar && ROLES[ar.role] ? ar.role : null;
    if (!role) return { session, role: null, profile: null };
    const { data: profile } = await sb.from(ROLES[role].table).select("*").eq("id", session.user.id).maybeSingle();
    return { session, role, profile: profile || {} };
  }
  function checklistState(role, profile) {
    const items = ROLES[role].checklist.map(([title, desc, test]) => ({ title, desc, done: !!test(profile || {}) }));
    return { items, done: items.filter((i) => i.done).length, total: items.length };
  }
  const statusLabel = (v) => ({ verified: "Verified", rejected: "Rejected", resubmit_required: "Resubmit" }[v] || "Unverified");


  /* ---------- Icons (24px line set) ---------- */
  const ICONS = {
    home: '<path d="M12 3.500 4 8.500v10a1.500 1.500 0 0 0 1.500 1.500h13a1.500 1.500 0 0 0 1.500-1.500v-10z"/><circle cx="12" cy="13" r="2.200"/>',
    disc: '<circle cx="12" cy="12" r="9"/><path d="m15.500 8.500-2 5-5 2 2-5z"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2.500"/><path d="M9 7V5.500A1.500 1.500 0 0 1 10.500 4h3A1.500 1.500 0 0 1 15 5.500V7M3 13h18"/>',
    proj: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    chat: '<path d="M5 4h14a1.500 1.500 0 0 1 1.500 1.500v9A1.500 1.500 0 0 1 19 16h-7l-4.500 4v-4H5a1.500 1.500 0 0 1-1.500-1.500v-9A1.500 1.500 0 0 1 5 4z"/><path d="M8 8.500h8M8 11.500h5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.500 20.500c1-4 4-6 7.500-6s6.500 2 7.500 6"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1z"/><circle cx="16" cy="14" r="1.200"/>',
    grow: '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
    pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.500"/>',
    equip: '<path d="M3 17h13l3-6h-5l-2-5H7l-1 5"/><circle cx="7" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>',
    mat: '<path d="m12 3 8 4.500v9L12 21l-8-4.500v-9z"/><path d="M12 12 4 7.500M12 12l8-4.500M12 12v9"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    hire: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.7-3.500 3.200-5 6.500-5s5.800 1.500 6.500 5M16 11l2 2 4-4"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    site: '<path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
    team: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.7-3.500 3.200-5 6.500-5s5.800 1.500 6.500 5M16 5.500a3.500 3.500 0 0 1 0 6.500M18 15c2 .6 3.200 2 3.500 5"/>',
    rep: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    prog: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    star: '<path d="m12 3 2.800 5.700 6.200.9-4.500 4.400 1 6.200L12 17.200 6.500 20.200l1-6.200L3 9.600l6.200-.9z"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  };
  const icon = (k, s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;

  /* ---------- Navigation ----------
     tabs = mobile bottom bar (max 5). side = desktop sidebar (every function). '--' = divider.
     parent maps a deeper route to the tab that stays highlighted. */
  const NAV = {
    guest: { tabs: [["home", "Home", "home"], ["chats", "Chats", "chat"], ["profile", "Profile", "user"]], side: [], parent: {} },
    worker: {
      tabs: [["home", "Home", "home"], ["jobs", "Jobs", "disc"], ["work", "Work", "work"], ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      side: [["home", "Home", "home"], ["jobs", "Job Marketplace", "disc"], ["work", "Work Management", "work"], ["wallet", "Wallet", "wallet"], ["growth", "Career Growth", "grow"], "--", ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      parent: { wallet: "home", growth: "home" },
    },
    company: {
      tabs: [["home", "Home", "home"], ["discover", "Workforce", "disc"], ["projects", "Projects", "proj"], ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      side: [["home", "Overview", "home"], ["discover", "Workforce Marketplace", "disc"], ["projects", "Project Management", "proj"], ["payments", "Payments", "pay"], ["equipment", "Equipment", "equip"], ["materials", "Materials", "mat"], "--", ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      parent: { payments: "home", equipment: "home", materials: "home", ws: "projects" },
    },
    "project-manager": {
      tabs: [["home", "Home", "home"], ["discover", "Discover", "disc"], ["projects", "Projects", "proj"], ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      side: [["home", "Overview", "home"], ["discover", "Discover", "disc"], ["projects", "Projects", "proj"], "--", ["ws/site", "Site Management", "site"], ["ws/tasks", "Task Management", "task"], ["ws/progress", "Progress Monitoring", "prog"], ["ws/team", "Team Management", "team"], ["ws/reports", "Reports", "rep"], "--", ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      parent: { ws: "projects" },
    },
    business: {
      tabs: [["home", "Home", "home"], ["discover", "Discover", "disc"], ["catalog", "Catalog", "box"], ["inquiries", "Inquiries", "mail"], ["profile", "Profile", "user"]],
      side: [["home", "Home", "home"], ["discover", "Discover", "disc"], ["catalog", "Catalog", "box"], ["inquiries", "Inquiries", "mail"], ["chats", "Chats", "chat"], "--", ["profile", "Profile", "user"]],
      parent: { chats: "inquiries" },
    },
    "individual-employer": {
      tabs: [["home", "Home", "home"], ["discover", "Discover", "disc"], ["hires", "Hires", "hire"], ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      side: [["home", "Home", "home"], ["discover", "Discover", "disc"], ["hires", "Hires", "hire"], ["chats", "Chats", "chat"], ["profile", "Profile", "user"]],
      parent: {},
    },
  };
  // Routes each role may open (anything else falls back to Home).
  const COMMON_ROUTES = ["home", "chats", "profile", "checklist", "filters", "picker"];
  const ROLE_ROUTES = {
    worker: ["jobs", "work", "wallet", "growth"],
    company: ["discover", "projects", "ws", "payments", "equipment", "materials"],
    "project-manager": ["discover", "projects", "ws"],
    business: ["discover", "catalog", "inquiries"],
    "individual-employer": ["discover", "hires"],
  };
  const money = (n) => { const v = Number(n) || 0; return `${v < 0 ? "-" : ""}GH₵${Math.abs(v).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const ago = (iso) => {
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
  };

  window.BX = { ICONS, icon, NAV, COMMON_ROUTES, ROLE_ROUTES, money, ago, sb, $, $$, esc, pretty, real, toast, ROLES, JOB_CATS, JOB_CAT_BY_ID, PHASES, INDUSTRIES, SPECIALIZATIONS, SUPPLY, REGIONS, categoriesFor, loadMe, checklistState, statusLabel };
})();
