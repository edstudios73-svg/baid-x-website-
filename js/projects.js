/* BAID X project loop (Phase 1): create project -> invite PM -> build team -> tasks -> reports ->
   requests/payments -> completion -> reviews. Every action calls a server function that re-checks
   identity, membership and project role, so the screens only reflect what the database allows. */
(() => {
  "use strict";
  const { esc, pretty, icon, money, ago, JOB_CATS, REGIONS, categoriesFor } = window.BX;
  const U = () => window.DASH.ui;

  /* ---------- plumbing ---------- */
  const rpc = async (c, fn, args) => { const { data, error } = await c.sb.rpc(fn, args); if (error) throw error; return data; };
  const act = async (c, fn, args, okMsg) => {
    try { const data = await rpc(c, fn, args); if (okMsg) c.toast(okMsg); return { ok: true, data }; }
    catch (e) { c.toast(e.message || "Something went wrong. Please try again."); return { ok: false }; }
  };
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const avatar = (name, photo, cls = "") => `<span class="av ${cls}" ${photo ? `style="background-image:url('${esc(photo)}')"` : ""}>${photo ? "" : esc(initials(name))}</span>`;
  const KIND = { ok: ["active", "approved", "paid", "done", "completed", "accepted", "verified"], warn: ["pending", "submitted", "planning", "in_progress", "changes_requested", "info_requested", "pending_company_approval", "sent", "blocked", "high", "urgent"], bad: ["rejected", "declined", "cancelled", "removed"] };
  const kind = (s) => Object.keys(KIND).find((k) => KIND[k].includes(String(s).toLowerCase())) || "";
  const LABEL = { todo: "To do", in_progress: "In progress", pending_company_approval: "Needs approval", changes_requested: "Changes requested", info_requested: "Question asked" };
  const pill = (s, label) => `<span class="pill ${kind(s)}">${esc(label || LABEL[s] || pretty(s))}</span>`;
  const fdate = (d) => (d ? new Date(d).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }) : "");
  const overdue = (d, st) => d && st !== "done" && new Date(d + "T23:59:59") < new Date();
  const REASONS = {
    company_approval_required: "Your setting requires approval", exceeds_headcount: "Over the planned team size", exceeds_role_quantity: "More than planned for this trade",
    unplanned_role: "Role not in the project plan", extra_budget: "Needs extra budget", sensitive_access: "Sensitive access", supervisor: "Supervisor / site lead", outside_requirements: "Outside project requirements",
  };
  const FLAGS = [["extra_budget", "Needs extra budget"], ["sensitive_access", "Needs sensitive access"], ["supervisor", "Supervisor or site lead"], ["outside_requirements", "Outside project requirements"]];

  /* ---------- bottom sheet ---------- */
  let sheetEl = null;
  function openSheet(title, html) {
    closeSheet();
    const root = document.getElementById("sheetRoot");
    root.innerHTML = `<div class="sx-bg" data-close></div><div class="sx" role="dialog" aria-label="${esc(title)}"><div class="sx-h"><b>${esc(title)}</b><button class="sx-x" data-close aria-label="Close">${icon("plus", 18)}</button></div><div class="sx-b">${html}</div></div>`;
    sheetEl = root.querySelector(".sx"); document.body.classList.add("sx-open");
    return sheetEl;
  }
  function closeSheet() { const root = document.getElementById("sheetRoot"); if (root) root.innerHTML = ""; sheetEl = null; document.body.classList.remove("sx-open"); }
  const refresh = () => window.APP.route();

  /* ---------- photos (private bucket, scoped by project folder) ---------- */
  async function uploadPhotos(c, files, pid) {
    const paths = [];
    for (const f of [...files].slice(0, 4)) {
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${pid}/${c.uid}/${Date.now()}-${paths.length}.${ext}`;
      const { error } = await c.sb.storage.from("project-photos").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error; paths.push(path);
    }
    return paths;
  }
  async function signed(c, paths) {
    if (!paths?.length) return [];
    const { data } = await c.sb.storage.from("project-photos").createSignedUrls(paths, 3600);
    return (data || []).map((d) => d.signedUrl).filter(Boolean);
  }
  const thumbs = async (c, paths) => { const urls = await signed(c, paths); return urls.length ? `<div class="thumbs">${urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Progress photo" loading="lazy"></a>`).join("")}</div>` : ""; };

  /* ---------- form helpers ---------- */
  const fld = (label, inner, hint) => `<label class="fl"><span>${esc(label)}</span>${inner}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
  const inp = (name, o = {}) => `<input class="in" name="${name}" ${o.type ? `type="${o.type}"` : ""} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""} ${o.val != null ? `value="${esc(o.val)}"` : ""} ${o.req ? "required" : ""} ${o.max ? `maxlength="${o.max}"` : ""} ${o.min != null ? `min="${o.min}"` : ""} ${o.step ? `step="${o.step}"` : ""} autocomplete="off" />`;
  const area = (name, o = {}) => `<textarea class="in ta" name="${name}" rows="${o.rows || 3}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ""} ${o.req ? "required" : ""} maxlength="${o.max || 1000}">${esc(o.val || "")}</textarea>`;
  const sel = (name, opts, val) => `<select class="in" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const formData = (form) => Object.fromEntries(new FormData(form).entries());

  /* ======================================================================
     Projects list
     ====================================================================== */
  async function projectsView(c, arg) {
    const list = (await rpc(c, "my_projects")) || [];
    c.state.projCache = list;
    const seg = ["active", "completed"].includes(arg) ? arg : "all";
    const shown = list.filter((p) => seg === "all" || (seg === "completed" ? p.status === "completed" : p.status !== "completed"));
    const isCo = c.role === "company";
    const { head, segs, empty, bar, soonBtn } = U();
    const newBtn = isCo ? `<button class="btn-light sm" data-go="new-project">${icon("plus", 15)} New project</button>` : "";
    const rowsHtml = shown.map((p) => `<button class="row proj" data-open-project="${esc(p.id)}"><span class="ic">${icon("proj", 17)}</span><span class="tx"><b>${esc(p.name)}</b><small><span class="code">${esc(p.public_code)}</span> ${esc([p.city_town, p.region].filter(Boolean).join(", ") || "Ghana")}${p.my_role !== "company" && p.company_name ? ` · ${esc(p.company_name)}` : ""}</small>${bar(p.progress_pct)}</span>${pill(p.status)}</button>`).join("");
    const emptyHtml = isCo ? empty("proj", "No projects yet", "Create a project to set the team you need, invite a project manager and keep everything in one workspace.", newBtn.replace("btn-light sm", "btn-light sm"))
      : c.role === "project-manager" ? empty("proj", "No projects yet", "When a company invites you and you accept, their project workspace opens here.", `<button class="btn-light sm" data-go="invites">View invitations</button>`)
      : empty("proj", "No projects yet", "When you accept a project invitation, its workspace opens here.", `<button class="btn-light sm" data-go="invites">View invitations</button>`);
    return head("Projects", newBtn) + segs([["all", "All", "projects"], ["active", "Active", "projects/active"], ["completed", "Completed", "projects/completed"]], seg) + (shown.length ? rowsHtml : emptyHtml);
  }

  /* ======================================================================
     Workspace
     ====================================================================== */
  const WS_TABS = {
    company: [["overview", "Overview"], ["team", "Team"], ["tasks", "Tasks"], ["reports", "Reports"], ["finance", "Finance"], ["milestones", "Milestones"], ["activity", "Activity"]],
    pm: [["overview", "Overview"], ["team", "Team"], ["tasks", "Tasks"], ["reports", "Reports"], ["finance", "Finance"], ["milestones", "Milestones"], ["messages", "Messages"]],
    worker: [["overview", "Overview"], ["mytasks", "My Tasks"], ["milestones", "Milestones"], ["updates", "Updates"], ["messages", "Messages"]],
  };

  async function wsView(c, arg) {
    const { head, segs, empty } = U();
    const list = (await rpc(c, "my_projects")) || [];
    c.state.projCache = list;
    if (!list.length) return head("Workspace") + empty("proj", "No project selected", c.role === "company" ? "Create a project first, then its workspace opens here." : "Once you join a project, its workspace opens here.", c.role === "company" ? `<button class="btn-light sm" data-go="new-project">New project</button>` : `<button class="btn-light sm" data-go="invites">View invitations</button>`);
    const pid = list.find((x) => x.id === c.state.projectId)?.id || list[0].id; c.state.projectId = pid;
    const ov = await rpc(c, "project_overview", { p_project: pid });
    const role = ov.my_role || "worker";
    const tabs = WS_TABS[role] || WS_TABS.worker;
    const tab = tabs.some(([k]) => k === arg) ? arg : "overview";
    const switcher = list.length > 1 ? `<select class="proj-pick" id="projPick">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === pid ? "selected" : ""}>${esc(x.name)} · ${esc(x.public_code)}</option>`).join("")}</select>` : "";
    const ctx = { c, ov, role, pid };
    const TAB = { overview: overviewTab, team: teamTab, tasks: tasksTab, mytasks: myTasksTab, updates: updatesTab, reports: reportsTab, finance: financeTab, milestones: (x) => window.MILESTONES.tab(x), activity: activityTab, messages: messagesTab };
    const content = await TAB[tab](ctx);
    return `<div class="d-head"><div><h1>${esc(ov.name)}</h1><p class="sub"><button class="code-chip" data-act="copy-code" data-code="${esc(ov.public_code)}" title="Copy Project ID">${esc(ov.public_code)}</button> ${pill(ov.status)} ${esc([ov.city_town, ov.region].filter(Boolean).join(", "))}</p></div></div>${switcher}`
      + `<div class="ws-tabs">${segs(tabs.map(([k, l]) => [k, l, `ws/${k}`]), tab)}</div>` + content;
  }

  /* ---------- Overview ---------- */
  // Owner only: attach the project to one of your organizations so its finance, project and
  // director roles can act for the company. Everything else stays as the owner set it.
  async function orgCard(c, pid) {
    const { data: row } = await c.sb.from("projects").select("org_id,company_id").eq("id", pid).maybeSingle();
    if (!row || row.company_id !== c.uid) return "";
    const orgs = (await rpc(c, "my_orgs").catch(() => [])) || [];
    const mine = orgs.filter((o) => o.status === "ACTIVE");
    if (!mine.length && !row.org_id) return "";
    return `<div class="dcard"><h4><span>Organization</span></h4><div class="inline-f"><select class="in" id="projOrg"><option value="">None (just me)</option>${mine.map((o) => `<option value="${esc(o.org_id)}" ${o.org_id === row.org_id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select><button class="btn-light sm" data-act="set-org">Save</button></div><div class="cap2">Members with a project director, finance manager or owner role can then act for the company on this project. Removing someone from the organization removes their access at once.</div></div>`;
  }
  async function overviewTab({ c, ov, role, pid }) {
    const { stats, card, bar, sec, empty } = U();
    const pct = ov.progress_pct || 0;
    let html = stats([[ov.team_active, "Workers"], [`${ov.tasks_done}/${ov.tasks_total}`, "Tasks done"], [ov.tasks_overdue, "Overdue"]])
      + card("Progress", `${pct}%`, `${bar(pct)}<div class="cap2">Updates automatically as tasks are completed.</div>`);
    if (role === "company" && ov.awaiting_approval > 0) html += `<button class="inv-card warn" data-go="approvals"><span class="ic">${icon("task", 20)}</span><span class="tx"><b>${ov.awaiting_approval} item${ov.awaiting_approval > 1 ? "s" : ""} waiting for you</b><small>Workers, requests, payments or reports</small></span><span class="pill warn">${ov.awaiting_approval}</span></button>`;

    const skills = (ov.required_skills || []).map((s) => `<span class="chip-s">${esc(s)}</span>`).join("");
    html += card("About this project", "", `${ov.description ? `<p class="body-t">${esc(ov.description)}</p>` : ""}
      <div class="kv"><span>Company</span><b>${esc(ov.company.name)}</b></div>
      <div class="kv"><span>Project manager</span><b>${ov.pm ? esc(ov.pm.name) : "Not assigned yet"}</b></div>
      <div class="kv"><span>Type</span><b>${esc(pretty(ov.project_type))}</b></div>
      <div class="kv"><span>Dates</span><b>${ov.starts_on ? esc(fdate(ov.starts_on)) : "—"} to ${ov.ends_on ? esc(fdate(ov.ends_on)) : "—"}</b></div>
      ${ov.team_size ? `<div class="kv"><span>Planned team</span><b>${ov.team_size} people</b></div>` : ""}
      ${skills ? `<div class="chips-s">${skills}</div>` : ""}
      ${ov.requirements ? `<div class="req"><small>Requirements</small><p>${esc(ov.requirements)}</p></div>` : ""}`);

    if (role === "company") {
      const m = ov.worker_addition_mode;
      html += sec("Approval settings") + `<div class="dcard"><h4><span>Adding workers</span></h4>
        <div class="segs two">${[["automatic", "Automatic"], ["company_approval", "Company approval"]].map(([k, l]) => `<button class="${m === k ? "on" : ""}" data-act="set-mode" data-mode="${k}">${l}</button>`).join("")}</div>
        <div class="cap2">${m === "automatic" ? "Workers your project manager invites within the plan join as soon as they accept. Anything outside the plan still needs your approval." : "Every worker your project manager invites needs your approval before they join."}</div>
        <div class="cap2 lock">${icon("key", 13)} Expenses, materials, equipment and payments always need your approval.</div></div>`;
    }
    if (role === "company") html += await orgCard(c, pid);
    html += await completionPanel({ c, ov, role, pid });
    if (ov.status === "completed") html += await reviewsPanel({ c, ov, role, pid });
    return html;
  }

  async function completionPanel({ c, ov, role, pid }) {
    const { sec } = U();
    if (ov.status === "completed") return `<div class="done-banner">${icon("task", 18)} <b>Project completed</b> · reviews are open</div>`;
    if (ov.completion_pending) {
      const cid = await rpc(c, "project_pending_completion", { p_project: pid });
      if (role === "company") {
        const r = (await c.sb.from("project_completion_requests").select("note,created_at").eq("id", cid).maybeSingle()).data || {};
        return sec("Completion") + `<div class="dcard warn-card"><h4><span>Completion requested</span><span class="amb">${esc(ago(r.created_at || new Date()))}</span></h4>
          <div class="cap2" style="margin:0 0 10px">${esc(r.note || "Your project manager says the work is finished.")}</div>
          <div class="btn-row"><button class="btn-light sm" data-act="completion-decide" data-id="${esc(cid)}" data-d="approve">Approve completion</button><button class="btn-dark sm" data-act="completion-decide" data-id="${esc(cid)}" data-d="reject">Not yet</button></div></div>`;
      }
      return sec("Completion") + `<div class="dcard"><h4><span>Waiting for the company</span></h4><div class="cap2" style="margin:0">Your completion request was sent. The company decides.</div></div>`;
    }
    if (role === "pm") return sec("Completion") + `<div class="dcard"><h4><span>Finished the work?</span></h4><div class="cap2" style="margin:0 0 10px">BAID X checks for open tasks, unreviewed reports and pending requests first. The company then approves.</div><button class="btn-light sm" data-act="completion-request">Request completion</button></div>`;
    if (role === "company" && !ov.pm) return sec("Completion") + `<div class="dcard"><h4><span>Mark as completed</span></h4><div class="cap2" style="margin:0 0 10px">This project has no project manager, so you can complete it yourself.</div><button class="btn-light sm" data-act="company-complete">Complete project</button></div>`;
    return "";
  }

  async function reviewsPanel({ c, ov, role, pid }) {
    const { sec } = U();
    if (role === "worker") return "";
    const team = await rpc(c, "project_team", { p_project: pid });
    const mine = new Set(((await c.sb.from("project_reviews").select("reviewee_id").eq("project_id", pid).eq("reviewer_id", c.uid)).data || []).map((r) => r.reviewee_id));
    const who = (team.members || []).filter((m) => m.profile_id !== c.uid && !mine.has(m.profile_id) && (role === "company" ? ["pm", "worker"].includes(m.role_type) : ["company", "worker"].includes(m.role_type)));
    if (!who.length) return sec("Reviews") + `<div class="dcard"><div class="cap2" style="margin:0">Thanks. You have reviewed everyone on this project.</div></div>`;
    return sec("Leave reviews") + who.map((m) => `<form class="dcard rev" data-form="review" data-id="${esc(m.profile_id)}">
      <div class="who">${avatar(m.name, m.photo)}<span><b>${esc(m.name)}</b><small>${esc(m.project_role)}</small></span></div>
      <div class="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-act="star" data-n="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${icon("star", 22)}</button>`).join("")}</div>
      <input type="hidden" name="rating" value="0" />${area("comment", { ph: "Optional comment", rows: 2, max: 400 })}
      <button class="btn-light sm" type="submit">Submit review</button></form>`).join("");
  }

  /* ---------- Team ---------- */
  async function teamTab({ c, ov, role, pid }) {
    const { sec, empty } = U();
    const t = await rpc(c, "project_team", { p_project: pid });
    const manager = role === "company" || role === "pm";
    const canInvitePm = role === "company" && !ov.pm && ov.status !== "completed";
    const open = ov.status !== "completed" && ov.status !== "cancelled";
    let html = "";
    if (manager && open) html += `<div class="btn-row top">${canInvitePm ? `<button class="btn-light sm" data-act="invite" data-kind="pm">${icon("plus", 15)} Invite project manager</button>` : ""}<button class="btn-light sm" data-act="invite" data-kind="worker">${icon("plus", 15)} Invite worker</button></div>`;
    html += sec("Team") + (t.members || []).map((m) => `<div class="row mem">${avatar(m.name, m.photo)}<span class="tx"><b>${esc(m.name)}</b><small>${esc(m.project_role)}${m.rate_ghs && manager ? ` · ${esc(money(m.rate_ghs))}` : ""}</small></span>${m.role_type === "company" ? pill("active", "Owner") : pill(m.status)}${role === "company" && m.role_type !== "company" && ov.status !== "completed" ? `<button class="ico-btn" data-act="remove-member" data-id="${esc(m.profile_id)}" data-name="${esc(m.name)}" aria-label="Remove ${esc(m.name)}">${icon("plus", 16)}</button>` : ""}</div>`).join("");
    if (manager) {
      const invs = t.invitations || [];
      if (invs.length) html += sec("Invitations") + invs.map((i) => invitationCard(i, role)).join("");
    }
    if (!(t.members || []).some((m) => m.role_type === "worker") && !(t.invitations || []).length) html += empty("team", "No workers yet", manager ? "Invite workers by trade, location and rating. Workers inside your plan join as soon as they accept." : "Your teammates will appear here.");
    return html;
  }

  function invitationCard(i, role) {
    const reasons = (i.reasons || []).map((r) => `<span class="chip-s warn">${esc(REASONS[r] || pretty(r))}</span>`).join("");
    const pending = i.status === "pending_company_approval";
    return `<div class="dcard inv"><div class="who">${avatar(i.name, i.photo)}<span><b>${esc(i.name)}</b><small>${esc(i.trade_label || pretty(i.invite_role))}${i.rate_ghs ? ` · ${esc(money(i.rate_ghs))}/${esc(i.rate_unit || "day")}` : ""} · invited by ${esc(i.invited_by_name)}</small></span>${pill(i.status, pending ? "Needs approval" : undefined)}</div>
      ${reasons ? `<div class="chips-s">${reasons}</div>` : ""}
      ${i.reason_note ? `<div class="req"><small>Reason from the project manager</small><p>${esc(i.reason_note)}</p></div>` : ""}
      ${i.response_note ? `<div class="req"><small>${esc(i.name)} wrote</small><p>${esc(i.response_note)}</p></div>` : ""}
      ${i.decision_note ? `<div class="req"><small>Company note</small><p>${esc(i.decision_note)}</p></div>` : ""}
      <div class="btn-row">${pending && role === "company" ? `<button class="btn-light sm" data-act="restricted" data-id="${esc(i.id)}" data-d="approve">Approve</button><button class="btn-dark sm" data-act="restricted" data-id="${esc(i.id)}" data-d="reject">Reject</button><button class="btn-dark sm" data-act="restricted" data-id="${esc(i.id)}" data-d="ask_pm">Ask PM</button>` : ""}
      ${["sent", "info_requested", "pending_company_approval"].includes(i.status) ? `<button class="btn-dark sm" data-act="cancel-invite" data-id="${esc(i.id)}">Cancel invite</button>` : ""}</div></div>`;
  }

  /* ---------- Tasks (company + PM) ---------- */
  async function tasksTab({ c, ov, role, pid }) {
    const { empty } = U();
    const [tasks, team] = await Promise.all([
      c.sb.from("project_tasks").select("id,title,description,status,priority,assignee_worker_id,due_on").eq("project_id", pid).order("sort_order", { ascending: true }).then((r) => r.data || []),
      rpc(c, "project_team", { p_project: pid }),
    ]);
    c.state.tasksCache = { tasks, workers: (team.members || []).filter((m) => m.role_type === "worker") };
    const names = Object.fromEntries((team.members || []).map((m) => [m.profile_id, m.name]));
    const open = ov.status !== "completed" && ov.status !== "cancelled";
    return (open ? `<div class="btn-row top"><button class="btn-light sm" data-act="task-new">${icon("plus", 15)} New task</button></div>` : "")
      + (tasks.length ? tasks.map((t) => `<button class="row task" data-act="task-edit" data-id="${esc(t.id)}"><span class="ic ${t.status === "done" ? "ok" : ""}">${icon("task", 17)}</span><span class="tx"><b>${esc(t.title)}</b><small>${t.assignee_worker_id ? esc(names[t.assignee_worker_id] || "Worker") : "Unassigned"}${t.due_on ? ` · <span class="${overdue(t.due_on, t.status) ? "late" : ""}">due ${esc(fdate(t.due_on))}</span>` : ""}</small></span>${t.priority === "high" || t.priority === "urgent" ? pill(t.priority) : ""}${pill(t.status)}</button>`).join("")
        : empty("task", "No tasks yet", "Break the work into tasks, assign each to a worker on your team and track progress here."));
  }

  function taskSheet(c, t) {
    const { workers } = c.state.tasksCache;
    const opts = [["", "Unassigned"], ...workers.map((w) => [w.profile_id, `${w.name} (${w.project_role})`])];
    const isNew = !t;
    const el = openSheet(isNew ? "New task" : "Edit task", `<form data-form="${isNew ? "task-create" : "task-update"}" ${t ? `data-id="${esc(t.id)}"` : ""}>
      ${fld("Task", inp("title", { req: true, val: t?.title, max: 120, ph: "e.g. Wire the second floor" }))}
      ${fld("Details", area("description", { val: t?.description, ph: "What needs to be done", rows: 3 }))}
      ${fld("Assign to", sel("assignee", opts, t?.assignee_worker_id || ""))}
      <div class="two-col">${fld("Due date", inp("due_on", { type: "date", val: t?.due_on || "" }))}${fld("Priority", sel("priority", [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["urgent", "Urgent"]], t?.priority || "medium"))}</div>
      ${isNew ? "" : fld("Status", sel("status", [["todo", "To do"], ["in_progress", "In progress"], ["done", "Completed"], ["blocked", "Blocked"]], t.status))}
      <button class="btn-primary wide" type="submit">${isNew ? "Create task" : "Save changes"}</button></form>`);
    return el;
  }

  /* ---------- My tasks + Updates (worker) ---------- */
  async function myTasksTab({ c, pid }) {
    const { empty } = U();
    const tasks = (await c.sb.from("project_tasks").select("id,title,description,status,priority,due_on,accepted_at").eq("project_id", pid).eq("assignee_worker_id", c.uid).order("sort_order", { ascending: true })).data || [];
    if (!tasks.length) return empty("task", "No tasks assigned to you", "When your project manager assigns you a task it appears here.");
    return tasks.map((t) => `<div class="dcard task-card"><h4><span>${esc(t.title)}</span>${pill(t.status)}</h4>
      ${t.description ? `<p class="body-t">${esc(t.description)}</p>` : ""}
      <div class="cap2" style="margin:0 0 10px">${t.due_on ? `<span class="${overdue(t.due_on, t.status) ? "late" : ""}">Due ${esc(fdate(t.due_on))}</span> · ` : ""}${pill(t.priority)}</div>
      <div class="btn-row">${t.status === "todo" && !t.accepted_at ? `<button class="btn-dark sm" data-act="task-act" data-id="${esc(t.id)}" data-a="accept">Accept</button>` : ""}
      ${t.status === "todo" ? `<button class="btn-light sm" data-act="task-act" data-id="${esc(t.id)}" data-a="start">Start work</button>` : ""}
      ${t.status === "in_progress" || t.status === "blocked" ? `<button class="btn-dark sm" data-act="task-note" data-id="${esc(t.id)}" data-title="${esc(t.title)}">Add update</button><button class="btn-light sm" data-act="task-complete" data-id="${esc(t.id)}" data-title="${esc(t.title)}">Mark complete</button>` : ""}
      ${t.status === "done" ? `<span class="done-t">${icon("task", 15)} Completed</span>` : ""}</div></div>`).join("");
  }

  async function updatesTab({ c, pid }) {
    const { empty } = U();
    const [ups, tasks] = await Promise.all([
      c.sb.from("task_updates").select("id,task_id,kind,body,photo_urls,created_at").eq("project_id", pid).eq("author_id", c.uid).order("created_at", { ascending: false }).limit(40).then((r) => r.data || []),
      c.sb.from("project_tasks").select("id,title").eq("project_id", pid).eq("assignee_worker_id", c.uid).then((r) => r.data || []),
    ]);
    const T = Object.fromEntries(tasks.map((t) => [t.id, t.title]));
    if (!ups.length) return empty("rep", "No updates yet", "Notes, photos and progress you post on your tasks are listed here.");
    const out = [];
    for (const u of ups) out.push(`<div class="row upd"><span class="ic">${icon(u.kind === "completed" ? "task" : "rep", 16)}</span><span class="tx"><b>${esc(T[u.task_id] || "Task")} · ${esc(pretty(u.kind))}</b>${u.body ? `<small class="wrap-t">${esc(u.body)}</small>` : ""}${await thumbs(c, u.photo_urls)}</span><span class="meta2">${esc(ago(u.created_at))}</span></div>`);
    return out.join("");
  }

  /* ---------- Reports ---------- */
  async function reportsTab({ c, ov, role, pid }) {
    const { empty } = U();
    const list = (await c.sb.from("project_reports").select("*").eq("project_id", pid).order("created_at", { ascending: false }).limit(30)).data || [];
    const open = ov.status !== "completed" && ov.status !== "cancelled";
    let html = role === "pm" && open ? `<div class="btn-row top"><button class="btn-light sm" data-act="report-new">${icon("plus", 15)} New report</button></div>` : "";
    if (!list.length) return html + empty("rep", "No reports yet", role === "pm" ? "File a daily or weekly report: work done, who was on site, problems, materials and next steps." : "Your project manager's daily and weekly reports will appear here for review.");
    for (const r of list) {
      html += `<div class="dcard rep"><h4><span>${esc(pretty(r.kind))} report · ${esc(fdate(r.report_date))}</span>${pill(r.status)}</h4>
        <div class="kv"><span>Work completed</span><b class="wrap-t">${esc(r.work_completed)}</b></div>
        ${r.progress_pct != null ? `<div class="kv"><span>Progress</span><b>${r.progress_pct}%</b></div>` : ""}${r.workers_present != null ? `<div class="kv"><span>Workers present</span><b>${r.workers_present}</b></div>` : ""}
        ${r.problems ? `<div class="kv"><span>Problems</span><b class="wrap-t">${esc(r.problems)}</b></div>` : ""}${r.materials_needed ? `<div class="kv"><span>Materials needed</span><b class="wrap-t">${esc(r.materials_needed)}</b></div>` : ""}${r.next_steps ? `<div class="kv"><span>Next steps</span><b class="wrap-t">${esc(r.next_steps)}</b></div>` : ""}
        ${await thumbs(c, r.photo_urls)}${r.company_comment ? `<div class="req"><small>Company comment</small><p>${esc(r.company_comment)}</p></div>` : ""}
        ${role === "company" && r.status === "submitted" ? `<div class="btn-row"><button class="btn-light sm" data-act="report-review" data-id="${esc(r.id)}" data-d="approve">Approve</button><button class="btn-dark sm" data-act="report-review" data-id="${esc(r.id)}" data-d="changes">Request changes</button><button class="btn-dark sm" data-act="report-review" data-id="${esc(r.id)}" data-d="reject">Reject</button></div>` : ""}</div>`;
    }
    return html;
  }

  /* ---------- Finance ---------- */
  async function financeTab({ c, ov, role, pid }) {
    const { sec, empty } = U();
    const [fin, reqs, pays, team] = await Promise.all([
      rpc(c, "project_finance", { p_project: pid }),
      c.sb.from("project_requests").select("id,kind,title,purpose,quantity,amount_ghs,status,decision_note,created_at").eq("project_id", pid).order("created_at", { ascending: false }).limit(40).then((r) => r.data || []),
      c.sb.from("project_payments").select("id,payee_id,purpose,payment_type,amount_ghs,status,reference,created_at").eq("project_id", pid).order("created_at", { ascending: false }).limit(40).then((r) => r.data || []),
      rpc(c, "project_team", { p_project: pid }),
    ]);
    c.state.finCache = { team: team.members || [] };
    const names = Object.fromEntries((team.members || []).map((m) => [m.profile_id, m.name]));
    const tile = (l, v, cls = "") => `<div class="fin-t ${cls}"><small>${l}</small><b>${v == null ? "—" : esc(money(v))}</b></div>`;
    const open = ov.status !== "completed" && ov.status !== "cancelled";
    let html = `<div class="fin">${role === "company" ? tile("Budget", fin.budget) : ""}${tile("Allocated", fin.allocated)}${tile("Committed", fin.committed)}${tile("Spent", fin.spent)}${role === "company" ? tile("Available", fin.available, fin.available != null && fin.available < 0 ? "neg" : "") : ""}</div>
      <p class="note">Allocated is everything the company has approved. Committed is approved money not yet paid. Spent is paid. These are records; BAID X does not move money here.</p>`;
    if (role === "pm" && open) html += `<div class="btn-row top"><button class="btn-light sm" data-act="req-new">${icon("plus", 15)} Request materials or expenses</button><button class="btn-dark sm" data-act="pay-new">${icon("plus", 15)} Payment request</button></div>`;
    if (role === "company" && open) html += `<div class="btn-row top"><button class="btn-dark sm" data-act="pay-record">${icon("plus", 15)} Record a payment</button></div>`;
    html += sec("Requests") + (reqs.length ? reqs.map((r) => `<div class="row fr"><span class="ic">${icon(r.kind === "equipment" ? "equip" : r.kind === "material" ? "mat" : "pay", 16)}</span><span class="tx"><b>${esc(r.title)}</b><small>${esc(pretty(r.kind))}${r.quantity ? ` · ${esc(r.quantity)}` : ""} · ${esc(money(r.amount_ghs))}${r.decision_note ? ` · ${esc(r.decision_note)}` : ""}</small></span>${pill(r.status)}${role === "company" && r.status === "pending" ? `<span class="inl"><button class="btn-light xs" data-act="req-decide" data-id="${esc(r.id)}" data-d="approve" data-amt="${r.amount_ghs}">Approve</button><button class="btn-dark xs" data-act="req-decide" data-id="${esc(r.id)}" data-d="reject">Reject</button></span>` : ""}</div>`).join("") : `<div class="cap2 pad">No requests yet. ${role === "pm" ? "Ask for materials, equipment or expenses; the company approves." : ""}</div>`);
    html += sec("Payment records") + (pays.length ? pays.map((p) => `<div class="row fr"><span class="ic">${icon("wallet", 16)}</span><span class="tx"><b>${esc(money(p.amount_ghs))} · ${esc(p.purpose)}</b><small>To ${esc(names[p.payee_id] || "member")} · ${esc(pretty(p.payment_type))}${p.reference ? ` · ref ${esc(p.reference)}` : ""}</small></span>${pill(p.status)}${role === "company" && p.status === "pending" ? `<span class="inl"><button class="btn-light xs" data-act="pay-decide" data-id="${esc(p.id)}" data-d="approve">Approve</button><button class="btn-dark xs" data-act="pay-decide" data-id="${esc(p.id)}" data-d="reject">Reject</button></span>` : ""}${role === "company" && p.status === "approved" ? `<span class="inl"><button class="btn-light xs" data-act="pay-paid" data-id="${esc(p.id)}">Mark paid</button></span>` : ""}</div>`).join("") : `<div class="cap2 pad">No payment records yet.</div>`);
    return html;
  }

  /* ---------- Activity + messages ---------- */
  async function activityTab({ c, pid }) {
    const { empty } = U();
    const ev = (await c.sb.from("project_events").select("id,event_type,detail,created_at").eq("project_id", pid).order("created_at", { ascending: false }).limit(60)).data || [];
    if (!ev.length) return empty("prog", "No activity yet", "Every important change on this project is recorded here.");
    return `<div class="tl">${ev.map((e) => `<div class="tl-i"><i></i><div><b>${esc(e.detail)}</b><small>${esc(ago(e.created_at))}</small></div></div>`).join("")}</div>`;
  }
  const messagesTab = async () => U().empty("chat", "Project messages", "A shared chat for everyone on this project arrives in the next stage. Until then, use Chats to message people directly.", `<button class="btn-light sm" data-tab="chats">Open Chats</button>`);

  /* ======================================================================
     Approvals inbox (company)
     ====================================================================== */
  async function approvalsView(c) {
    const { head, empty, sec } = U();
    const a = (await rpc(c, "company_approvals")) || {};
    const total = ["workers", "requests", "payments", "reports", "completions"].reduce((t, k) => t + (a[k] || []).length, 0);
    if (!total) return head("Approvals") + empty("task", "Nothing waiting", "Workers, requests, payments, reports and completion requests that need your decision will show up here.");
    const proj = (x) => `<small class="pj">${esc(x.project_name)}</small>`;
    let html = head("Approvals") + `<p class="sub2">PM requests. You approve. BAID X records.</p>`;
    if ((a.completions || []).length) html += sec("Completion") + a.completions.map((x) => `<div class="dcard warn-card">${proj(x)}<h4><span>Completion requested by ${esc(x.requested_by_name)}</span></h4><div class="cap2" style="margin:0 0 10px">${esc(x.note || "")}</div><div class="btn-row"><button class="btn-light sm" data-act="completion-decide" data-id="${esc(x.id)}" data-d="approve">Approve completion</button><button class="btn-dark sm" data-act="completion-decide" data-id="${esc(x.id)}" data-d="reject">Not yet</button></div></div>`).join("");
    if ((a.workers || []).length) html += sec("Workers to approve") + a.workers.map((x) => `${proj(x)}${invitationCard({ id: x.id, name: x.name, photo: x.photo, trade_label: x.trade, rate_ghs: x.rate_ghs, rate_unit: x.rate_unit, invited_by_name: x.invited_by_name, reasons: x.reasons, reason_note: x.reason_note, response_note: x.response_note, decision_note: x.decision_note, status: "pending_company_approval", invite_role: "worker" }, "company")}`).join("");
    if ((a.requests || []).length) html += sec("Requests") + a.requests.map((x) => `<div class="dcard">${proj(x)}<h4><span>${esc(x.title)}</span><span class="amb">${esc(money(x.amount_ghs))}</span></h4><div class="cap2" style="margin:0 0 10px">${esc(pretty(x.kind))}${x.quantity ? ` · ${esc(x.quantity)}` : ""} · from ${esc(x.requester_name)}${x.purpose ? ` · ${esc(x.purpose)}` : ""}</div><div class="btn-row"><button class="btn-light sm" data-act="req-decide" data-id="${esc(x.id)}" data-d="approve" data-amt="${x.amount_ghs}">Approve</button><button class="btn-dark sm" data-act="req-decide" data-id="${esc(x.id)}" data-d="reject">Reject</button></div></div>`).join("");
    if ((a.payments || []).length) html += sec("Payment requests") + a.payments.map((x) => `<div class="dcard">${proj(x)}<h4><span>${esc(x.purpose)}</span><span class="amb">${esc(money(x.amount_ghs))}</span></h4><div class="cap2" style="margin:0 0 10px">To ${esc(x.payee_name)} · ${esc(pretty(x.payment_type))} · requested by ${esc(x.requester_name)}</div><div class="btn-row"><button class="btn-light sm" data-act="pay-decide" data-id="${esc(x.id)}" data-d="approve">Approve</button><button class="btn-dark sm" data-act="pay-decide" data-id="${esc(x.id)}" data-d="reject">Reject</button></div></div>`).join("");
    if ((a.reports || []).length) html += sec("Reports to review") + a.reports.map((x) => `<div class="dcard">${proj(x)}<h4><span>${esc(pretty(x.kind))} report · ${esc(fdate(x.report_date))}</span></h4><div class="cap2" style="margin:0 0 10px">${esc(x.work_completed)}${x.problems ? ` · Problems: ${esc(x.problems)}` : ""}</div><div class="btn-row"><button class="btn-light sm" data-act="report-review" data-id="${esc(x.id)}" data-d="approve">Approve</button><button class="btn-dark sm" data-act="report-review" data-id="${esc(x.id)}" data-d="changes">Request changes</button></div></div>`).join("");
    return html;
  }

  /* ======================================================================
     Invitations (worker + PM)
     ====================================================================== */
  async function invitesView(c) {
    const { head, empty } = U();
    const list = (await rpc(c, "my_invitations")) || [];
    if (!list.length) return head("Invitations") + empty("mail", "No invitations", "When a company or project manager invites you to a project, you can accept, decline or ask a question here.");
    return head("Invitations") + list.map((i) => {
      const waiting = i.status === "pending_company_approval";
      return `<div class="dcard inv"><div class="who"><span class="av sq">${esc(initials(i.project_name))}</span><span><b>${esc(i.project_name)}</b><small><span class="code">${esc(i.public_code)}</span> ${esc(i.company_name)} · ${esc([i.city_town, i.region].filter(Boolean).join(", ") || "Ghana")}</small></span>${waiting ? pill("pending_company_approval", "Waiting for company") : ""}</div>
      <div class="kv"><span>Role</span><b>${esc(i.invite_role === "pm" ? "Project manager" : i.trade_label || "Worker")}</b></div>
      ${i.rate_ghs ? `<div class="kv"><span>Rate</span><b>${esc(money(i.rate_ghs))} per ${esc(i.rate_unit || "day")}</b></div>` : ""}
      ${i.expected_duration ? `<div class="kv"><span>Duration</span><b>${esc(i.expected_duration)}</b></div>` : ""}${i.starts_on ? `<div class="kv"><span>Starts</span><b>${esc(fdate(i.starts_on))}</b></div>` : ""}
      ${i.responsibilities ? `<div class="req"><small>Responsibilities</small><p>${esc(i.responsibilities)}</p></div>` : ""}${i.message ? `<div class="req"><small>Message from ${esc(i.invited_by_name)}</small><p>${esc(i.message)}</p></div>` : ""}
      ${waiting ? `<div class="cap2">You accepted. The company is reviewing your addition before you join.</div>` : `<div class="btn-row"><button class="btn-light sm" data-act="inv-respond" data-id="${esc(i.id)}" data-a="accept" data-role="${esc(i.invite_role)}" data-project="${esc(i.project_id)}">Accept</button><button class="btn-dark sm" data-act="inv-respond" data-id="${esc(i.id)}" data-a="decline">Decline</button><button class="btn-dark sm" data-act="inv-ask" data-id="${esc(i.id)}">Ask a question</button></div>`}</div>`;
    }).join("");
  }

  /* ======================================================================
     New project (company)
     ====================================================================== */
  const TYPES = [["building", "Building & construction"], ["renovation", "Renovation"], ["electrical", "Electrical works"], ["plumbing", "Plumbing & water"], ["civil", "Civil & roadworks"], ["finishing", "Fit-out & finishing"], ["maintenance", "Maintenance"], ["other", "Other"]];
  async function newProjectView(c) {
    c.state.needs = c.state.needs || new Map();
    c.state.needs.clear();
    return `<div class="d-head"><div><h1>New project</h1><p class="sub">Tell us what you are building. You can invite people right after.</p></div></div>
    <form class="pform" data-form="project-create" autocomplete="off">
      <div class="fs"><h3>Basics</h3>
        ${fld("Project name", inp("name", { req: true, max: 100, ph: "e.g. Estate block B" }))}
        ${fld("Description", area("description", { ph: "What is being built or fixed?", rows: 3 }))}
        ${fld("Type of work", sel("project_type", TYPES, "building"))}
      </div>
      <div class="fs"><h3>Location and timeline</h3>
        <div class="two-col">${fld("Region", sel("region", [["", "Choose"], ...REGIONS.map((r) => [r, r])], ""))}${fld("Town", inp("city_town", { ph: "e.g. Tema", max: 60 }))}</div>
        <div class="two-col">${fld("Start date", inp("starts_on", { type: "date" }))}${fld("Expected completion", inp("ends_on", { type: "date" }))}</div>
        ${fld("Budget (GH₵)", inp("budget_ghs", { type: "number", min: 0, step: "0.01", ph: "e.g. 50000" }), "Only you can see the budget. Project managers and workers never do.")}
      </div>
      <div class="fs"><h3>Team you need</h3>
        ${fld("Planned team size", inp("team_size", { type: "number", min: 1, ph: "How many people in total?" }))}
        <div class="fl"><span>Trades needed</span><input class="in" id="skillQ" placeholder="Search a trade, e.g. Electrician" autocomplete="off" /><div class="sugg" id="skillSugg"></div><div class="needs" id="needsList"></div><small>Workers outside this plan need your approval before they join.</small></div>
        ${fld("Requirements", area("requirements", { ph: "Certificates, safety gear, anything workers must have", rows: 2 }))}
      </div>
      <div class="fs"><h3>Project manager</h3>
        <label class="sw"><input type="checkbox" name="needs_pm" checked /><span>I need a project manager</span></label>
        <small class="hint">You will invite one from Discover after you create the project.</small>
      </div>
      <div class="fs"><h3>Approval rules</h3>
        <div class="opt-cards">
          <label class="oc"><input type="radio" name="worker_addition_mode" value="automatic" checked /><span><b>Automatic</b><small>Workers your PM invites within the plan join once they accept.</small></span></label>
          <label class="oc"><input type="radio" name="worker_addition_mode" value="company_approval" /><span><b>Company approval</b><small>You approve every worker before they join.</small></span></label>
        </div>
        <small class="hint lock">${icon("key", 13)} Expenses, materials, equipment and payments always need your approval.</small>
      </div>
      <button class="btn-primary wide" type="submit">Create project</button>
    </form>`;
  }
  function renderNeeds(c) {
    const el = document.getElementById("needsList"); if (!el) return;
    el.innerHTML = [...c.state.needs.entries()].map(([n, q]) => `<span class="need"><b>${esc(n)}</b><button type="button" data-act="need-dec" data-n="${esc(n)}">−</button><i>${q}</i><button type="button" data-act="need-inc" data-n="${esc(n)}">+</button><button type="button" class="x" data-act="need-del" data-n="${esc(n)}" aria-label="Remove">×</button></span>`).join("");
  }

  /* ======================================================================
     Invite flow (company -> PM / worker, PM -> worker)
     ====================================================================== */
  async function openInvite(c, { kind, id }) {
    if (kind === "pm" && c.role !== "company") return c.toast("Only the company invites a project manager.");
    if (kind === "worker" && !["company", "project-manager"].includes(c.role)) return c.toast("Only the company or its project manager can invite workers.");
    const all = (await rpc(c, "my_projects")) || [];
    const mine = all.filter((p) => (c.role === "company" ? p.my_role === "company" : p.my_role === "pm") && !["completed", "cancelled"].includes(p.status) && (kind !== "pm" || !p.pm_id));
    if (!mine.length) return c.toast(kind === "pm" ? "Create a project that still needs a project manager first." : "You have no open project to invite people to.");
    c.state.invite = { kind, projects: mine, person: null };
    if (id) { c.state.invite.person = await loadPerson(c, kind, id); return inviteForm(c); }
    return pickPerson(c, kind);
  }
  async function loadPerson(c, kind, id) {
    const table = kind === "pm" ? "project_manager_profiles" : "worker_profiles";
    const cols = kind === "pm" ? "id,full_name,specialization,city_town,region,profile_photo_url" : "id,full_name,primary_job_category_id,specialty,city_town,region,profile_photo_url,daily_rate_ghs";
    const p = (await c.sb.from(table).select(cols).eq("id", id).maybeSingle()).data;
    if (!p) return { id, name: "Selected person" };
    return { id: p.id, name: p.full_name, photo: p.profile_photo_url, trade: kind === "worker" ? (window.BX.JOB_CAT_BY_ID[p.primary_job_category_id]?.name || p.specialty || "") : pretty(p.specialization), place: [p.city_town, p.region].filter((v) => v && v !== "Pending").join(", "), rate: p.daily_rate_ghs };
  }
  async function pickPerson(c, kind) {
    const table = kind === "pm" ? "project_manager_profiles" : "worker_profiles";
    const cols = kind === "pm" ? "id,full_name,specialization,city_town,region,profile_photo_url" : "id,full_name,primary_job_category_id,specialty,city_town,region,profile_photo_url,daily_rate_ghs";
    const list = (await c.sb.from(table).select(cols).eq("verification_status", "verified").limit(60)).data || [];
    const people = list.map((p) => ({ id: p.id, name: p.full_name, photo: p.profile_photo_url, trade: kind === "worker" ? (window.BX.JOB_CAT_BY_ID[p.primary_job_category_id]?.name || p.specialty || "Professional") : pretty(p.specialization) || "Project manager", place: [p.city_town, p.region].filter((v) => v && v !== "Pending").join(", "), rate: p.daily_rate_ghs }));
    c.state.invite.pool = people;
    const draw = (q) => people.filter((p) => !q || `${p.name} ${p.trade} ${p.place}`.toLowerCase().includes(q.toLowerCase())).map((p) => `<button class="row" data-act="pick-person" data-id="${esc(p.id)}">${avatar(p.name, p.photo)}<span class="tx"><b>${esc(p.name)}</b><small>${esc(p.trade)}${p.place ? ` · ${esc(p.place)}` : ""}</small></span>${icon("plus", 16)}</button>`).join("") || `<div class="cap2 pad">No verified ${kind === "pm" ? "project managers" : "workers"} found.</div>`;
    const el = openSheet(kind === "pm" ? "Invite a project manager" : "Invite a worker", `<label class="search slim"><input id="invQ" type="search" placeholder="Search by name, trade or town" autocomplete="off" /></label><div id="invList">${draw("")}</div>`);
    el.querySelector("#invQ").addEventListener("input", (e) => { el.querySelector("#invList").innerHTML = draw(e.target.value); });
  }
  function inviteForm(c) {
    const { kind, projects, person } = c.state.invite;
    const isPm = c.role === "project-manager";
    const projSel = projects.length > 1 ? fld("Project", sel("project", projects.map((p) => [p.id, `${p.name} · ${p.public_code}`]), c.state.projectId && projects.some((p) => p.id === c.state.projectId) ? c.state.projectId : projects[0].id)) : `<input type="hidden" name="project" value="${esc(projects[0].id)}" />`;
    const person_html = `<div class="who inv-who">${avatar(person.name, person.photo)}<span><b>${esc(person.name)}</b><small>${esc(person.trade || "")}${person.place ? ` · ${esc(person.place)}` : ""}</small></span></div>`;
    const html = kind === "pm"
      ? `<form data-form="invite-pm">${person_html}${projSel}${fld("Responsibilities", area("responsibilities", { ph: "What will they be responsible for?", rows: 3 }))}
          <div class="two-col">${fld("Expected duration", inp("duration", { ph: "e.g. 6 months" }))}${fld("Compensation (GH₵)", inp("rate", { type: "number", min: 0, step: "0.01" }))}</div>
          ${fld("Paid", sel("unit", [["month", "per month"], ["project", "for the project"], ["milestone", "per milestone"], ["percent", "% of budget"]], "month"))}${fld("Message", area("message", { rows: 2, ph: "Optional note" }))}
          <button class="btn-primary wide" type="submit">Send invitation</button></form>`
      : `<form data-form="invite-worker">${person_html}${projSel}
          ${fld("Trade on this project", `<input class="in" name="trade" list="tradeList" value="${esc(person.trade || "")}" placeholder="e.g. Electrician" required autocomplete="off" /><datalist id="tradeList">${JOB_CATS.map((j) => `<option value="${esc(j.name)}">`).join("")}</datalist>`)}
          <div class="two-col">${fld("Rate (GH₵)", inp("rate", { type: "number", min: 0, step: "0.01", val: person.rate || "" }))}${fld("Per", sel("unit", [["day", "day"], ["week", "week"], ["month", "month"], ["project", "project"]], "day"))}</div>
          ${fld("Message", area("message", { rows: 2, ph: "Optional note to the worker" }))}
          ${isPm ? `<div class="fl"><span>Does this need the company's approval?</span><div class="flags">${FLAGS.map(([k, l]) => `<label class="ck"><input type="checkbox" name="flag" value="${k}" /> ${esc(l)}</label>`).join("")}</div>${fld("Reason for the company", area("reason", { rows: 2, ph: "Why is this worker needed? Required if the company must approve.", max: 400 }))}<small>The server checks your plan, team size and the company's rules. If approval is needed, the worker joins only after the company says yes.</small></div>` : ""}
          <button class="btn-primary wide" type="submit">Send invitation</button></form>`;
    openSheet(kind === "pm" ? "Invite project manager" : "Invite worker", html);
  }

  /* ======================================================================
     Actions (click delegation)
     ====================================================================== */
  const ACT = {
    "copy-code": async (c, el) => { try { await navigator.clipboard.writeText(el.dataset.code); c.toast("Project ID copied"); } catch { c.toast(el.dataset.code); } },
    "set-org": async (c) => { const r = await act(c, "link_project_org", { p_project: c.state.projectId, p_org: document.getElementById("projOrg").value || null }, "Organization saved"); if (r.ok) refresh(); },
    "set-mode": async (c, el) => { const r = await act(c, "set_worker_addition_mode", { p_project: c.state.projectId, p_mode: el.dataset.mode }, "Approval setting saved"); if (r.ok) refresh(); },
    "invite": (c, el) => openInvite(c, { kind: el.dataset.kind }),
    "pick-person": async (c, el) => { c.state.invite.person = c.state.invite.pool.find((p) => p.id === el.dataset.id); inviteForm(c); },
    "restricted": async (c, el) => {
      const d = el.dataset.d;
      if (d === "approve") { const r = await act(c, "decide_restricted_worker", { p_invitation: el.dataset.id, p_decision: "approve", p_note: null }, "Worker approved"); if (r.ok) refresh(); return; }
      const label = d === "reject" ? "Reject worker" : "Ask the project manager";
      const note = await askNote(label, d === "reject" ? "Optional note" : "Your question", d !== "reject");
      if (note === null) return;
      const r = await act(c, "decide_restricted_worker", { p_invitation: el.dataset.id, p_decision: d, p_note: note || null }, d === "reject" ? "Worker not approved" : "Question sent"); if (r.ok) refresh();
    },
    "cancel-invite": async (c, el) => { const r = await act(c, "cancel_invitation", { p_invitation: el.dataset.id }, "Invitation cancelled"); if (r.ok) refresh(); },
    "remove-member": async (c, el) => {
      const note = await askNote(`Remove ${el.dataset.name}?`, "Reason (optional). They lose access immediately.", false); if (note === null) return;
      const r = await act(c, "remove_member", { p_project: c.state.projectId, p_profile: el.dataset.id, p_reason: note || null }, "Removed from the project"); if (r.ok) refresh();
    },
    "inv-respond": async (c, el) => {
      const r = await act(c, "respond_invitation", { p_invitation: el.dataset.id, p_action: el.dataset.a, p_note: null });
      if (!r.ok) return;
      const st = r.data?.status;
      if (st === "accepted" || st === "approved") { c.toast(el.dataset.role === "pm" ? "You are now the project manager." : "You joined the project."); c.state.projectId = el.dataset.project; c.go("ws/overview"); }
      else if (st === "pending_company_approval") { c.toast("Accepted. The company must approve before you join."); refresh(); }
      else { c.toast("Invitation declined."); refresh(); }
    },
    "inv-ask": async (c, el) => { const note = await askNote("Ask a question", "What would you like to know?", true); if (note === null) return; const r = await act(c, "respond_invitation", { p_invitation: el.dataset.id, p_action: "request_info", p_note: note }, "Question sent"); if (r.ok) refresh(); },
    "task-new": (c) => taskSheet(c, null),
    "task-edit": (c, el) => taskSheet(c, c.state.tasksCache.tasks.find((t) => t.id === el.dataset.id)),
    "task-act": async (c, el) => { const r = await act(c, "task_progress", { p_task: el.dataset.id, p_action: el.dataset.a, p_note: null, p_photos: [] }, el.dataset.a === "accept" ? "Task accepted" : "Work started"); if (r.ok) refresh(); },
    "task-note": (c, el) => progressSheet(c, el.dataset.id, el.dataset.title, "note"),
    "task-complete": (c, el) => progressSheet(c, el.dataset.id, el.dataset.title, "complete"),
    "report-new": (c) => reportSheet(c),
    "report-review": async (c, el) => {
      const d = el.dataset.d; let comment = null;
      if (d !== "approve") { comment = await askNote(d === "changes" ? "Request changes" : "Reject report", "What should change?", true); if (comment === null) return; }
      const r = await act(c, "review_report", { p_report: el.dataset.id, p_decision: d, p_comment: comment }, d === "approve" ? "Report approved" : "Sent to your project manager"); if (r.ok) refresh();
    },
    "req-new": (c) => requestSheet(c),
    "pay-new": (c) => paymentSheet(c, false),
    "pay-record": (c) => paymentSheet(c, true),
    "req-decide": async (c, el) => {
      const d = el.dataset.d; let note = null;
      if (d === "reject") { note = await askNote("Reject request", "Optional note", false); if (note === null) return; }
      const r = await act(c, "decide_request", { p_request: el.dataset.id, p_decision: d, p_note: note || null }, d === "approve" ? "Request approved" : "Request rejected"); if (r.ok) refresh();
    },
    "pay-decide": async (c, el) => {
      const d = el.dataset.d; let note = null;
      if (d === "reject") { note = await askNote("Reject payment", "Optional note", false); if (note === null) return; }
      const r = await act(c, "decide_payment", { p_payment: el.dataset.id, p_decision: d, p_note: note || null }, d === "approve" ? "Payment approved" : "Payment rejected"); if (r.ok) refresh();
    },
    "pay-paid": async (c, el) => {
      const ref = await askNote("Mark as paid", "Payment reference, e.g. the Mobile Money transaction ID", true); if (!ref) return;
      const r = await act(c, "mark_payment_paid", { p_payment: el.dataset.id, p_reference: ref }, "Marked as paid"); if (r.ok) refresh();
    },
    "completion-request": async (c) => {
      const note = await askNote("Request completion", "Anything the company should know? (optional)", false); if (note === null) return;
      const r = await act(c, "request_completion", { p_project: c.state.projectId, p_note: note || null });
      if (!r.ok) return;
      if (r.data?.ok) { c.toast("Completion request sent to the company"); return refresh(); }
      const b = r.data?.blockers || {}; const L = { open_tasks: "open tasks", reports_waiting_review: "reports waiting for review", pending_requests: "pending requests", pending_payments: "pending payments", workers_waiting_approval: "workers waiting for approval" };
      openSheet("Not ready yet", `<p class="body-t">Clear these first, then request completion again:</p><ul class="blk">${Object.entries(b).filter(([, v]) => v > 0).map(([k, v]) => `<li><b>${v}</b> ${esc(L[k] || k)}</li>`).join("")}</ul><button class="btn-light wide" data-close>OK</button>`);
    },
    "completion-decide": async (c, el) => {
      const d = el.dataset.d; let note = null;
      if (d === "reject") { note = await askNote("Not ready yet", "What is still missing?", true); if (note === null) return; }
      const r = await act(c, "decide_completion", { p_request: el.dataset.id, p_decision: d, p_note: note }, d === "approve" ? "Project completed. Reviews are open." : "Sent back to the project manager"); if (r.ok) refresh();
    },
    "company-complete": async (c) => { if (!(await confirmBox("Complete this project?", "This closes the project for everyone."))) return; const r = await act(c, "complete_structured_project", { target_project_id: c.state.projectId }, "Project completed"); if (r.ok) refresh(); },
    "star": (c, el) => { const f = el.closest("form"); const n = +el.dataset.n; f.querySelector('[name="rating"]').value = n; f.querySelectorAll(".stars button").forEach((b) => b.classList.toggle("on", +b.dataset.n <= n)); },
    "need-inc": (c, el) => { c.state.needs.set(el.dataset.n, (c.state.needs.get(el.dataset.n) || 1) + 1); renderNeeds(c); },
    "need-dec": (c, el) => { const q = (c.state.needs.get(el.dataset.n) || 1) - 1; if (q < 1) c.state.needs.delete(el.dataset.n); else c.state.needs.set(el.dataset.n, q); renderNeeds(c); },
    "need-del": (c, el) => { c.state.needs.delete(el.dataset.n); renderNeeds(c); },
    "add-need": (c, el) => { c.state.needs.set(el.dataset.n, c.state.needs.get(el.dataset.n) || 1); document.getElementById("skillQ").value = ""; document.getElementById("skillSugg").innerHTML = ""; renderNeeds(c); },
  };

  /* ---------- small dialogs ---------- */
  const askNote = (title, ph, required) => new Promise((resolve) => {
    const el = openSheet(title, `<form class="ask"><textarea class="in ta" name="n" rows="3" placeholder="${esc(ph)}" ${required ? "required" : ""} maxlength="500"></textarea><button class="btn-primary wide" type="submit">Continue</button><button class="btn-dark wide" type="button" data-cancel>Cancel</button></form>`);
    let done = false; const finish = (v) => { if (done) return; done = true; closeSheet(); resolve(v); };
    el.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); finish(new FormData(e.target).get("n").trim()); });
    el.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    document.querySelector(".sx-bg").addEventListener("click", () => finish(null), { once: true });
  });
  const confirmBox = (title, text) => new Promise((resolve) => {
    const el = openSheet(title, `<p class="body-t">${esc(text)}</p><button class="btn-primary wide" data-yes>Yes, continue</button><button class="btn-dark wide" data-no>Cancel</button>`);
    el.querySelector("[data-yes]").addEventListener("click", () => { closeSheet(); resolve(true); });
    el.querySelector("[data-no]").addEventListener("click", () => { closeSheet(); resolve(false); });
  });

  function progressSheet(c, taskId, title, mode) {
    openSheet(mode === "complete" ? "Complete task" : "Add update", `<form data-form="task-progress" data-id="${esc(taskId)}" data-mode="${mode}"><p class="body-t"><b>${esc(title)}</b></p>
      ${fld(mode === "complete" ? "Final note (optional)" : "Update", area("note", { rows: 3, ph: mode === "complete" ? "Anything the project manager should know" : "What have you done?", req: mode === "note" }))}
      ${fld("Photos (optional, up to 4)", `<input class="in" type="file" name="photos" accept="image/*" multiple />`)}
      <button class="btn-primary wide" type="submit">${mode === "complete" ? "Mark complete" : "Post update"}</button></form>`);
  }
  function reportSheet(c) {
    openSheet("New report", `<form data-form="report"><div class="two-col">${fld("Type", sel("kind", [["daily", "Daily"], ["weekly", "Weekly"]], "daily"))}${fld("Progress (%)", inp("progress_pct", { type: "number", min: 0, step: "1" }))}</div>
      ${fld("Work completed", area("work_completed", { req: true, rows: 3, ph: "What was done?" }))}${fld("Workers present", inp("workers_present", { type: "number", min: 0 }))}
      ${fld("Problems", area("problems", { rows: 2, ph: "Any delays or issues?" }))}${fld("Materials needed", area("materials_needed", { rows: 2 }))}${fld("Next steps", area("next_steps", { rows: 2 }))}
      ${fld("Photos (optional, up to 4)", `<input class="in" type="file" name="photos" accept="image/*" multiple />`)}<button class="btn-primary wide" type="submit">Submit report</button></form>`);
  }
  function requestSheet(c) {
    openSheet("Request materials or expenses", `<form data-form="request">${fld("What do you need?", sel("kind", [["material", "Materials"], ["equipment", "Equipment"], ["expense", "Expense"]], "material"))}${fld("Item", inp("title", { req: true, ph: "e.g. Cement, 40 bags", max: 120 }))}
      <div class="two-col">${fld("Quantity", inp("quantity", { ph: "e.g. 40 bags" }))}${fld("Estimated cost (GH₵)", inp("amount", { type: "number", min: 0, step: "0.01", req: true }))}</div>${fld("Purpose", area("purpose", { rows: 2, ph: "What is it for?" }))}
      <p class="note">The company approves or rejects. You cannot approve your own request.</p><button class="btn-primary wide" type="submit">Send request</button></form>`);
  }
  function paymentSheet(c, record) {
    const team = (c.state.finCache?.team || []).filter((m) => (record ? m.role_type !== "company" : true));
    const opts = team.map((m) => [m.profile_id, `${m.name} (${m.project_role})`]);
    if (!opts.length) return c.toast("Add a team member first.");
    openSheet(record ? "Record a payment" : "Payment request", `<form data-form="${record ? "payment-record" : "payment-request"}">${fld("Pay to", sel("payee", opts, record ? opts[0][0] : c.uid))}
      <div class="two-col">${fld("Amount (GH₵)", inp("amount", { type: "number", min: 0.01, step: "0.01", req: true }))}${fld("Type", sel("payment_type", record ? [["worker", "Worker pay"], ["milestone", "Milestone"], ["project", "Project fee"], ["monthly", "Monthly"]] : [["monthly", "Monthly fee"], ["project", "Project fee"], ["milestone", "Milestone"], ["percentage", "Percentage"], ["worker", "Worker pay"]], record ? "worker" : "monthly"))}</div>
      ${fld("Purpose", inp("purpose", { req: true, ph: "What is this payment for?", max: 140 }))}
      <p class="note">${record ? "Records only. BAID X does not send money." : "The company approves. You cannot approve your own request."}</p><button class="btn-primary wide" type="submit">${record ? "Record payment" : "Send request"}</button></form>`);
  }

  /* ---------- delegated events ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-close]")) return closeSheet();
    const el = t.closest("[data-act]"); if (!el || !window.APP?.state.me?.role) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    try { await fn(window.APP.dashCtx(), el, e); } catch (err) { console.error(err); window.BX.toast(err.message || "Something went wrong"); }
  }, true);

  document.addEventListener("input", (e) => {
    if (e.target.id !== "skillQ") return;
    const q = e.target.value.trim().toLowerCase(), box = document.getElementById("skillSugg");
    box.innerHTML = q ? JOB_CATS.filter((j) => j.name.toLowerCase().includes(q)).slice(0, 6).map((j) => `<button type="button" data-act="add-need" data-n="${esc(j.name)}">${esc(j.name)}</button>`).join("") : "";
  });
  document.addEventListener("change", (e) => { if (e.target.id === "projPick") { const c = window.APP.dashCtx(); c.state.projectId = e.target.value; refresh(); } });

  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-form]"); if (!form || !window.APP?.state.me?.role) return;
    e.preventDefault();
    const c = window.APP.dashCtx(), kindF = form.dataset.form, d = formData(form), btn = form.querySelector('[type="submit"]');
    const busy = (on) => { if (btn) { btn.disabled = on; btn.dataset.l = btn.dataset.l || btn.textContent; btn.textContent = on ? "Please wait…" : btn.dataset.l; } };
    busy(true);
    try {
      if (kindF === "project-create") {
        const needs = [...c.state.needs.entries()].map(([trade, qty]) => ({ trade, qty }));
        const r = await act(c, "create_project", { p: { name: d.name, description: d.description, project_type: d.project_type, region: d.region, city_town: d.city_town, starts_on: d.starts_on, ends_on: d.ends_on, budget_ghs: d.budget_ghs, team_size: d.team_size, requirements: d.requirements, needs_pm: form.querySelector('[name="needs_pm"]').checked, worker_addition_mode: d.worker_addition_mode, required_skills: needs.map((n) => n.trade), needs } });
        if (r.ok) { c.state.projectId = r.data.id; c.toast(`Project created · ${r.data.public_code}`); c.go("ws/team"); }
      } else if (kindF === "invite-pm") {
        const r = await act(c, "invite_pm", { p_project: d.project, p_pm: c.state.invite.person.id, p_responsibilities: d.responsibilities || null, p_duration: d.duration || null, p_rate: d.rate ? +d.rate : null, p_unit: d.unit, p_message: d.message || null }, "Invitation sent");
        if (r.ok) { closeSheet(); c.state.projectId = d.project; refresh(); }
      } else if (kindF === "invite-worker") {
        const flags = [...form.querySelectorAll('[name="flag"]:checked')].map((x) => x.value);
        const r = await act(c, "invite_worker", { p_project: d.project, p_worker: c.state.invite.person.id, p_trade: d.trade, p_rate: d.rate ? +d.rate : null, p_unit: d.unit, p_flags: flags, p_reason: d.reason || null, p_message: d.message || null });
        if (r.ok) { closeSheet(); c.toast(r.data.restricted ? "Invitation sent. The company approves after the worker accepts." : "Invitation sent"); c.state.projectId = d.project; refresh(); }
      } else if (kindF === "task-create") {
        const r = await act(c, "create_task", { p_project: c.state.projectId, p_title: d.title, p_description: d.description || null, p_assignee: d.assignee || null, p_due: d.due_on || null, p_priority: d.priority }, "Task created"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "task-update") {
        const r = await act(c, "update_task", { p_task: form.dataset.id, p_patch: { title: d.title, description: d.description, assignee: d.assignee || "", due_on: d.due_on || "", priority: d.priority, status: d.status } }, "Task saved"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "task-progress") {
        const files = form.querySelector('[name="photos"]').files; const photos = files.length ? await uploadPhotos(c, files, c.state.projectId) : [];
        const r = await act(c, "task_progress", { p_task: form.dataset.id, p_action: form.dataset.mode === "complete" ? "complete" : "note", p_note: d.note || null, p_photos: photos }, form.dataset.mode === "complete" ? "Task completed" : "Update posted"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "report") {
        const files = form.querySelector('[name="photos"]').files; const photos = files.length ? await uploadPhotos(c, files, c.state.projectId) : [];
        const r = await act(c, "submit_report", { p_project: c.state.projectId, p: { kind: d.kind, work_completed: d.work_completed, progress_pct: d.progress_pct, workers_present: d.workers_present, problems: d.problems, materials_needed: d.materials_needed, next_steps: d.next_steps, photo_urls: photos } }, "Report submitted"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "request") {
        const r = await act(c, "submit_request", { p_project: c.state.projectId, p_kind: d.kind, p_title: d.title, p_purpose: d.purpose || null, p_quantity: d.quantity || null, p_amount: +d.amount }, "Request sent to the company"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "payment-request") {
        const r = await act(c, "submit_payment_request", { p_project: c.state.projectId, p_payee: d.payee, p_amount: +d.amount, p_purpose: d.purpose, p_type: d.payment_type }, "Payment request sent"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "payment-record") {
        const r = await act(c, "record_payment", { p_project: c.state.projectId, p_payee: d.payee, p_amount: +d.amount, p_purpose: d.purpose, p_type: d.payment_type }, "Payment recorded"); if (r.ok) { closeSheet(); refresh(); }
      } else if (kindF === "review") {
        if (!+d.rating) { c.toast("Choose a star rating first."); } else { const r = await act(c, "submit_review", { p_project: c.state.projectId, p_reviewee: form.dataset.id, p_rating: +d.rating, p_comment: d.comment || null }, "Review submitted"); if (r.ok) refresh(); }
      }
    } catch (err) { console.error(err); c.toast(err.message || "Something went wrong"); }
    busy(false);
  });

  window.addEventListener("hashchange", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetEl) closeSheet(); });

  /* ---------- register + hooks ---------- */
  window.DASH.register("projects", projectsView);
  window.DASH.register("ws", wsView);
  window.DASH.register("approvals", approvalsView);
  window.DASH.register("invites", invitesView);
  window.DASH.register("new-project", newProjectView);
  window.PROJ = { openInvite: (kind, id) => openInvite(window.APP.dashCtx(), { kind, id }) };
})();
