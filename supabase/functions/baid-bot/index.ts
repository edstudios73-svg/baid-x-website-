// BAID Bot: the assistant on the website landing and the app's visitor Home. It answers
// questions about BAID X and finds real people and open jobs: "I need a top electrician in
// Kumasi" searches the live directory (bot_find_people / bot_find_jobs, phase24) and returns
// cards with the best matches. With an Anthropic key (function secret ANTHROPIC_API_KEY, or the
// copy in Vault read by _bot_ai_key) Claude chooses the search and explains its picks; without
// one it still matches trades and places and answers from the facts below. Public (no sign-in),
// rate-limited per address. Deployed to Supabase project igfmmprlrybxsdzehwid as "baid-bot".

const MODELS = ["claude-sonnet-5-5", "claude-haiku-4-5-20251001"]; // the first one this key can use
const MAX_TURNS = 8; // conversation turns sent to the model
const MAX_CHARS = 600; // per message
const LIMIT = 20; // requests per address per window
const WINDOW_MS = 10 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FACTS = `BAID X is Ghana's work network and an organization under Baiden Creatives, a Ghanaian company based in East Legon, Accra. Made in Ghana. Website: www.baid-x.com. It connects workers (skilled professionals such as electricians, masons, plumbers, carpenters, technicians, drivers, designers and developers), companies, project managers, suppliers (businesses selling or renting materials and equipment) and clients (individuals hiring for work on their home). It covers all 16 regions of Ghana and about 50 trades. Amounts are in Ghana cedis (GH₵) and payouts go to mobile money.

Account types (5): Worker / professional; Company; Project manager; Supplier (business: materials, equipment, rentals); Client (individual employer hiring for their home). A supplier profile is for selling and renting, not for hiring.

Joining: free. Every account type starts on the free Access plan with a profile, search, messaging, reviews and escrow payments. On Access, workers can send 5 job applications a month and clients and companies can keep 1 job post open at a time; any paid plan removes those limits. There is no free trial. Sign up with a phone number (an SMS code) at the Get started button; email can be added later in Edit profile.

Paid plans (per month): Worker Pro GH₵200, Premium GH₵350. Project manager Pro GH₵300, Premium GH₵500, Enterprise GH₵900. Client Pro GH₵250, Premium GH₵450, Enterprise GH₵900. Supplier Pro GH₵600, Premium GH₵1,200. Company Pro GH₵1,500, Premium GH₵3,000, Enterprise GH₵6,000. Founding members pay 30% less for 12 months while founding places last. Paying yearly costs 10 months (2 months free). Pro adds unlimited job applications or job posts and priority support; Premium adds first-in-line help with questions and disputes; Enterprise adds a team organization and a named contact at BAID X. Plans can be cancelled any time and keep working until the end of the paid period. Other fees: a 10% service fee deducted from money released from escrow, paid by the worker or supplier being paid (nothing is charged on a refund). Opening a dispute is free. Withdrawing to mobile money is free (minimum GH₵10). Adding money to the wallet carries Paystack's 1.95% processing fee, shown at checkout. Verification review fees, one-off per check: Identity GH₵50, Professional GH₵120, Advanced or Enhanced GH₵250; business verification GH₵250 or GH₵500. Boosts put a profile or job first for 1 to 30 days: worker profile GH₵15 (1 day) to GH₵250 (30 days), project manager profile GH₵25 to GH₵350, supplier profile GH₵30 to GH₵500, job GH₵30 (1 day) to GH₵250 (14 days); a boosted profile or job shows first, marked Featured. Members on a paid plan carry a Pro, Premium or Enterprise mark beside their name and are listed before free members in Discover; that mark is not verification. You pay through Paystack and choose Mobile Money, bank or card; a plan paid by card renews automatically, while Mobile Money and bank pay for one period at a time. Every fee is shown before you confirm. Full details are on the Pricing page (www.baid-x.com/pricing/) and in sections 6 to 9 of the Terms.

Verification badges: earned, never bought. A person at BAID X reviews them. Tiers: Verified (profile reviewed by BAID X), Identity verified (Ghana Card checked), Professional verified (trade certificates and past work checked), Advanced verified (full background check, for sensitive work). Checks carry a one-off review fee (GH₵50 to GH₵500) that pays for the review, not the result. A paid plan never buys a badge; verification and subscriptions are kept separate on purpose.

Escrow: when you hire, the job is funded from your BAID X wallet (topped up through Paystack). BAID X holds the money while the work happens; the worker can see it is there. The client approves and the payment is released to the worker's wallet, ready for mobile money. If the client does not respond, it is released automatically 3 days after the worker marks the job done (5 days for project milestones). A dispute freezes the money while BAID X reviews it; both sides have 5 days to send evidence and BAID X aims to decide within 10 business days. Money paid outside BAID X is not protected.

Digital Job Card: each hire has a job card with the scope, materials, photo evidence, payments and sign-off by the worker, the client and the project manager when there is one.

For clients: My build (budget and progress, today's site photos, approvals waiting) and House logbook (who did what in the house, maintenance reminders, a trusted team of people you have paid).

For companies and project managers: projects, crews, tasks, site reports, expenses, approvals and payments. A project manager joins a company with an ID the company gives them; the company approves the access.

Suppliers list materials and equipment with up to 6 photos; companies and clients can order.

BAID Bot (this assistant) can find the best matching verified professionals, project managers, companies, suppliers and open jobs from the live directory.

Visitor tools: "Check a badge" (type at least 3 letters of a full name; it lists only members a person at BAID X has verified, so someone who does not appear has not been verified) and "Rates" (the middle daily rate and range per trade from rates professionals set on BAID X, by region).

Safety: never send cash upfront to someone you have not checked; pay through escrow. BAID X never asks for your password or SMS code.

Contact: email info@baidencreatives.org, phone +233 20 607 1106, WhatsApp +233 55 836 2423, office in East Legon, Accra (Monday to Friday, 8am to 5pm). The Contact page is www.baid-x.com/contact.html. Social: Baiden Creatives on Instagram and TikTok (@baidencreatives) and on X (@baidencteatives). Guides: the User guide, Verification badges, Terms of Service and Privacy Policy pages on the website.`;

const SYSTEM = `You are BAID Bot, the assistant on BAID X's website and app. You help people hire, find work and understand BAID X in Ghana, using only the facts below and what your tools return.

How to help:
- When someone wants a person (a worker in any trade, a project manager, a company or a supplier of materials or equipment), call find_people. Pick the trade or need from their words, and the town or region if they gave one. Use kind "worker" for tradespeople, "pm" for project managers, "company" for companies and contractors, "supplier" for materials and equipment.
- When someone is looking for work, call find_jobs.
- If the first search finds nothing, try once more with a broader need or without the place.
- Recommend from the results only. Name your top 1 to 3 picks and say in a few words why each fits: their badge, experience, daily rate, rating, town. Verified members come first; if you mention someone who is not verified yet, say so. The results appear as cards under your answer, so do not list every detail again.
- If nobody matches, say so plainly and suggest Discover, a nearby region, or posting a job so verified pros can apply. Never invent people, jobs, ratings or prices.
- Contact happens on BAID X: tap a card to see the profile; sign in to message or hire, and pay through escrow. Never give out phone numbers or emails of members.

Style:
- Warm, confident and plain-spoken, like a helpful person on the BAID X team. Say "we" and "you". Keep it under 70 words: 1 to 4 short sentences, or a short list when steps help. Plain text, no markdown, no headings, no emoji.
- Refer to members by name or as "they"; never guess "he" or "she" from a name.
- If something is not covered, say you are not sure and point to the Pricing page or the User guide.
- Never ask for or accept passwords, SMS codes, card numbers or Ghana Card numbers. Never say a payment, verification or account change has been done.
- For questions about one named person, suggest Check a badge. For what work usually costs, suggest Rates.
- If asked about something unrelated to BAID X or work, say briefly that you only help with BAID X.

Facts:
${FACTS}`;

const TOOLS = [
  {
    name: "find_people",
    description: "Search BAID X's live directory for the best matching members, ranked: featured, paid plans, verified, rating, experience. Returns public profile details only.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["worker", "pm", "company", "supplier"], description: "worker = tradesperson or professional; pm = project manager; company = company or contractor; supplier = materials or equipment" },
        need: { type: "string", description: "Trade or need in a few words, e.g. 'electrician', 'tiler bathroom', 'cement blocks', 'excavator'" },
        place: { type: "string", description: "Town or region in Ghana, e.g. 'Accra', 'Kumasi', 'Ashanti'. Omit if not given." },
        min_years: { type: "integer", description: "Minimum years of experience, if asked" },
        max_daily_rate: { type: "number", description: "Highest daily rate in GH₵, if the person gave a budget" },
        verified_only: { type: "boolean", description: "Only members with a BAID X badge" },
      },
      required: ["kind"],
    },
  },
  {
    name: "find_jobs",
    description: "Search open jobs on BAID X, featured first. Use for people looking for work.",
    input_schema: {
      type: "object",
      properties: {
        need: { type: "string", description: "Trade or kind of work, e.g. 'tiling', 'electrical'" },
        place: { type: "string", description: "Town or region in Ghana. Omit if not given." },
      },
    },
  },
];

const SB_URL = Deno.env.get("SUPABASE_URL") || "https://igfmmprlrybxsdzehwid.supabase.co";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn} ${r.status}`);
  return r.json();
}

// The Anthropic key: a function secret if one is set, otherwise the copy kept in Vault.
let aiKey: string | null | undefined;
async function getKey(): Promise<string | null> {
  if (aiKey !== undefined) return aiKey;
  aiKey = Deno.env.get("ANTHROPIC_API_KEY") || null;
  if (!aiKey && SERVICE) { try { aiKey = (await rpc("_bot_ai_key", {})) as string || null; } catch (e) { console.error("baid-bot key", String(e)); aiKey = null; } }
  return aiKey;
}

type Card = Record<string, unknown>;
async function runTool(name: string, input: Record<string, unknown>): Promise<Card[]> {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
  if (name === "find_jobs") return (await rpc("bot_find_jobs", { p_query: s(input.need), p_region: s(input.place), p_limit: 5 })) as Card[] || [];
  const kind = ["worker", "pm", "company", "supplier"].includes(String(input.kind)) ? String(input.kind) : "worker";
  return (await rpc("bot_find_people", {
    p_kind: kind, p_query: s(input.need), p_region: s(input.place),
    p_min_years: Number.isFinite(Number(input.min_years)) ? Math.round(Number(input.min_years)) : null,
    p_max_rate: Number.isFinite(Number(input.max_daily_rate)) ? Number(input.max_daily_rate) : null,
    p_verified_only: input.verified_only === true, p_limit: 5,
  })) as Card[] || [];
}

// Answers when no AI key is set (and the opening greeting). Each topic matches on words.
const TOPICS: { keys: string[]; answer: string }[] = [
  { keys: ["what is", "about", "baid x", "who are", "what do"], answer: "BAID X is Ghana's work network, an organization under Baiden Creatives in East Legon, Accra. It connects workers, companies, project managers, suppliers and clients across all 16 regions, with badges our team checks by hand and payments held safely in escrow until the work is approved." },
  { keys: ["free", "cost to join", "join", "sign up", "signup", "register", "create account"], answer: "Joining is free for every account type on the Access plan (workers get 5 job applications a month, clients and companies 1 open job post; paid plans remove the limits). Tap Get started and sign up with your phone number; you will get an SMS code. You can add an email later in Edit profile." },
  { keys: ["price", "pricing", "plan", "pro", "premium", "subscription", "how much", "fee", "founding"], answer: "BAID X is free to join on the Access plan (workers 5 job applications a month, clients and companies 1 open job post). Pro per month: worker GH₵200, project manager GH₵300, client GH₵250, supplier GH₵600, company GH₵1,500, with Premium and Enterprise above that. Founding members pay 30% less for 12 months; there is no free trial. Other fees: 10% service fee on money released from escrow (nothing on refunds), verification from GH₵50, boosts from GH₵15 and Paystack's 1.95% when you add money. Disputes and withdrawals are free. See the Pricing page for every fee." },
  { keys: ["escrow", "pay", "payment", "money", "release", "refund", "safe", "dispute", "wallet", "paystack", "momo", "mobile money"], answer: "When you hire, you fund the job from your BAID X wallet, topped up with Mobile Money, bank or card. We hold the money while the work happens and release it when you approve. If you don't respond within 3 days of the job being marked done, it's released automatically. If something goes wrong, open a dispute and the money stays frozen until we've looked into it. Payouts go straight to mobile money." },
  { keys: ["badge", "verif", "verified", "ghana card", "identity", "background", "trust"], answer: "A badge means our team has checked that person by hand, from their profile and Ghana Card up to their trade certificates and background, depending on the badge (Verified, Identity, Professional, Advanced). You can't buy one. The one-off review fee, from GH₵50, pays for the check, not the result. To check someone, use Check a badge." },
  { keys: ["check", "is this person", "real", "scam", "fake", "legit"], answer: "Use Check a badge and type their full name. If we've verified them, you'll see their badge. If they don't show up, be careful: don't send money up front, and only pay through escrow." },
  { keys: ["rate", "charge", "daily", "quote", "budget", "how much does"], answer: "Open Rates to see the typical day rate and the range for each trade, based on what professionals charge on BAID X. You can filter by region. Every job is different, so agree the final price with your pro." },
  { keys: ["worker", "electrician", "mason", "plumber", "carpenter", "job", "find work", "artisan"], answer: "Workers create a free profile, get verified to stand out, apply for jobs near them and get paid through escrow to their wallet, then to mobile money. The free plan includes 5 applications a month; Pro from GH₵200 a month makes them unlimited, but never buys a badge." },
  { keys: ["company", "companies", "contractor", "enterprise", "crew", "project"], answer: "Companies run projects on BAID X: hire crews, assign project managers, track tasks, site reports and expenses, and approve every payment through escrow." },
  { keys: ["project manager", "pm"], answer: "Project managers run site delivery: crews, tasks, reports and requests. A company gives you an ID; you enter it and the company approves your access to its projects." },
  { keys: ["supplier", "business", "material", "equipment", "rent", "cement", "sell"], answer: "Suppliers list materials and equipment to sell or rent, with up to 6 photos per listing. Companies and clients can order from them." },
  { keys: ["client", "home", "house", "my build", "logbook", "renovat"], answer: "Clients hire for work on their home and pay through escrow. My build shows budget, progress, site photos and approvals waiting; House logbook keeps who did what, maintenance reminders and your trusted team." },
  { keys: ["job card"], answer: "Every hire gets a Digital Job Card: the scope, materials, photo evidence, payments and sign-off, so everyone sees the same record of the job." },
  { keys: ["region", "where", "location", "accra", "kumasi", "ghana", "city"], answer: "Everywhere in Ghana, across all 16 regions, from Accra and Kumasi to Tamale and Takoradi. Prices are in cedis, and payouts go straight to mobile money." },
  { keys: ["contact", "support", "help", "instagram", "phone number", "email", "call", "whatsapp", "office", "reach", "baiden"], answer: "Email info@baidencreatives.org, call +233 20 607 1106 or WhatsApp +233 55 836 2423 (Monday to Friday, 8am to 5pm). The office is in East Legon, Accra. Follow us on Instagram and TikTok (@baidencreatives) and on X (@baidencteatives)." },
  { keys: ["password", "code", "otp", "pin"], answer: "BAID X will never ask for your password or SMS code. If you cannot sign in, use the sign-in screen's reset option." },
];
const FALLBACK = "I can help with joining, plans and prices, escrow and payments, verification badges, and how BAID X works for workers, companies, project managers, suppliers and clients. What would you like to know?";

function topicAnswer(q: string): string {
  const t = q.toLowerCase();
  let best = { score: 0, answer: FALLBACK };
  for (const topic of TOPICS) {
    const score = topic.keys.reduce((n, k) => n + (t.includes(k) ? k.length : 0), 0);
    if (score > best.score) best = { score, answer: topic.answer };
  }
  return best.answer;
}

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Without the AI: "I need a top electrician in Kumasi" still gets real matches.
const PLACES = ["accra", "kumasi", "tamale", "takoradi", "tema", "cape coast", "koforidua", "ho", "sunyani", "bolgatanga", "wa", "techiman", "kasoa", "madina", "east legon", "spintex", "ashanti", "greater accra", "northern", "western", "central", "eastern", "volta", "bono", "upper east", "upper west", "oti", "ahafo", "savannah", "north east", "western north", "bono east"];
async function guideMatch(q: string): Promise<{ reply: string; cards: Card[] } | null> {
  const t = ` ${q.toLowerCase()} `;
  const place = PLACES.filter((p) => t.includes(` ${p} `) || t.includes(` ${p},`) || t.includes(` ${p}.`) || t.includes(` ${p}?`)).sort((a, b) => b.length - a.length)[0] || null;
  if (/\b(job|jobs|work for me|find work|looking for work|hiring now)\b/.test(t) && !/\b(hire|need a|need an|find me a|recommend)\b/.test(t)) {
    const cards = await runTool("find_jobs", { need: q, place });
    return { reply: cards.length ? `Here are open jobs${place ? ` around ${place.replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}. Sign in to apply.` : "No open jobs match that right now. Try another trade or region, and turn on job alerts after you sign in.", cards };
  }
  if (!/\b(find|need|needs|looking for|recommend|hire|top|best|good|get me|suggest|who can)\b/.test(t)) return null;
  const kind = /\b(project manager|pm)\b/.test(t) ? "pm" : /\b(supplier|cement|blocks|sand|material|materials|equipment|rent|excavator hire)\b/.test(t) ? "supplier" : /\b(company|companies|contractor|firm)\b/.test(t) ? "company" : "worker";
  const cards = await runTool("find_people", { kind, need: q, place });
  if (!cards.length) return { reply: "I couldn't find a match for that yet. Try a nearby region or a different trade, or post a job so verified pros can apply.", cards };
  const top = cards[0] as Record<string, unknown>;
  const why = [top.verified ? "verified by our team" : "not verified yet", top.experience ? `${top.experience} years' experience` : "", top.rate ? `GH₵${top.rate} a day` : ""].filter(Boolean).join(", ");
  return { reply: `My top pick is ${top.name}, ${String(top.trade).toLowerCase()}${top.town ? ` in ${top.town}` : ""}: ${why}. Tap a card to see the profile, then sign in to message or hire through escrow.`, cards };
}

async function claude(key: string, messages: unknown[]): Promise<{ data: Record<string, unknown>; model: string }> {
  let last = "";
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 700, system: SYSTEM, tools: TOOLS, messages }),
    });
    if (r.ok) return { data: await r.json(), model };
    last = `anthropic ${r.status} ${model}`;
    if (r.status !== 404 && r.status !== 400) break; // only a model this key can't use moves on to the next
  }
  throw new Error(last);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return json({ reply: "You have asked a lot of questions in a short time. Please wait a few minutes and try again.", source: "limit" }, 429);

  let messages: { role: string; content: string }[] = [];
  try {
    const body = await req.json();
    messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: { role?: string; content?: unknown }) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }))
      .slice(-MAX_TURNS);
  } catch { /* falls through to the empty check */ }
  while (messages.length && messages[0].role !== "user") messages.shift();
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return json({ error: "no question" }, 400);

  const guide = async () => {
    try { const m = await guideMatch(last.content); if (m) return json({ ...m, source: "guide" }); } catch (e) { console.error("baid-bot match", String(e)); }
    return json({ reply: topicAnswer(last.content), cards: [], source: "guide" });
  };
  const key = await getKey();
  if (!key) return guide();

  try {
    const convo: unknown[] = [...messages];
    let cards: Card[] = [];
    for (let round = 0; round < 4; round++) {
      const { data } = await claude(key, convo);
      const content = (data.content || []) as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      const uses = content.filter((c) => c.type === "tool_use");
      if (data.stop_reason !== "tool_use" || !uses.length || round === 3) {
        const reply = content.filter((c) => c.type === "text").map((c) => c.text).join("").trim();
        if (!reply) break;
        return json({ reply, cards, source: "ai" });
      }
      convo.push({ role: "assistant", content });
      const results = [];
      for (const u of uses) {
        let out: Card[] = [];
        try { out = await runTool(u.name || "", u.input || {}); } catch (e) { console.error("baid-bot tool", String(e)); }
        if (out.length) cards = out; // the cards shown are the latest search that found someone
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out.map(({ photo: _p, ...rest }) => rest)) });
      }
      convo.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("baid-bot", String(e));
  }
  return guide();
});
