// BAID Bot: answers visitors' questions about BAID X on the website landing and the
// app's visitor Home. With ANTHROPIC_API_KEY set (Supabase function secret) it answers
// with Claude, grounded in the facts below; without it, it answers from the same facts
// by matching the question to a topic. Public (no sign-in), rate-limited per address.
// Deployed to Supabase project igfmmprlrybxsdzehwid as "baid-bot".

const MODEL = "claude-haiku-4-5-20251001";
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

Paid plans (per month): Worker Pro GH₵200, Premium GH₵350. Project manager Pro GH₵300, Premium GH₵500, Enterprise GH₵900. Client Pro GH₵250, Premium GH₵450, Enterprise GH₵900. Supplier Pro GH₵600, Premium GH₵1,200. Company Pro GH₵1,500, Premium GH₵3,000, Enterprise GH₵6,000. Founding members pay 30% less for 12 months while founding places last. Paying yearly costs 10 months (2 months free). Pro adds unlimited job applications or job posts and priority support; Premium adds first-in-line help with questions and disputes; Enterprise adds a team organization and a named contact at BAID X. Plans can be cancelled any time and keep working until the end of the paid period. Other fees: a 10% service fee deducted from money released from escrow, paid by the worker or supplier being paid (nothing is charged on a refund). Opening a dispute is free. Withdrawing to mobile money is free (minimum GH₵10). Adding money to the wallet carries Paystack's 1.95% processing fee, shown at checkout. Verification review fees, one-off per check: Identity GH₵10, Professional GH₵20, Advanced GH₵35; business verification GH₵25 or GH₵50. Boosts that promote a profile, job or listing for a few days start at GH₵2. Every fee is shown before you confirm. Full details are on the Pricing page (www.baid-x.com/pricing/) and in sections 6 to 9 of the Terms.

Verification badges: earned, never bought. A person at BAID X reviews them. Tiers: Verified (profile reviewed by BAID X), Identity verified (Ghana Card checked), Professional verified (trade certificates and past work checked), Advanced verified (full background check, for sensitive work). Checks carry a one-off review fee (GH₵10 to GH₵50) that pays for the review, not the result. A paid plan never buys a badge; verification and subscriptions are kept separate on purpose.

Escrow: when you hire, the job is funded from your BAID X wallet (topped up through Paystack). BAID X holds the money while the work happens; the worker can see it is there. The client approves and the payment is released to the worker's wallet, ready for mobile money. If the client does not respond, it is released automatically 3 days after the worker marks the job done (5 days for project milestones). A dispute freezes the money while BAID X reviews it; both sides have 5 days to send evidence and BAID X aims to decide within 10 business days. Money paid outside BAID X is not protected.

Digital Job Card: each hire has a job card with the scope, materials, photo evidence, payments and sign-off by the worker, the client and the project manager when there is one.

For clients: My build (budget and progress, today's site photos, approvals waiting) and House logbook (who did what in the house, maintenance reminders, a trusted team of people you have paid).

For companies and project managers: projects, crews, tasks, site reports, expenses, approvals and payments. A project manager joins a company with an ID the company gives them; the company approves the access.

Suppliers list materials and equipment with up to 6 photos; companies and clients can order.

Visitor tools: "Check a badge" (type at least 3 letters of a full name; it lists only members a person at BAID X has verified, so someone who does not appear has not been verified) and "Rates" (the middle daily rate and range per trade from rates professionals set on BAID X, by region).

Safety: never send cash upfront to someone you have not checked; pay through escrow. BAID X never asks for your password or SMS code.

Contact: email info@baidencreatives.org, phone +233 20 607 1106, WhatsApp +233 55 836 2423, office in East Legon, Accra (Monday to Friday, 8am to 5pm). The Contact page is www.baid-x.com/contact.html. Social: @baidencreatives on Instagram, X, TikTok, Facebook, LinkedIn and YouTube. Guides: the User guide, Verification badges, Terms of Service and Privacy Policy pages on the website.`;

const SYSTEM = `You are BAID Bot, the assistant on BAID X's website and app. Answer questions about BAID X and about hiring or working through it in Ghana, using only the facts below.

Rules:
- Be brief and warm: 1 to 4 short sentences, or a short list when steps help. Plain text, no markdown headings, no emoji.
- Use only these facts. If something is not covered, say you are not sure and point to the Pricing page, the User guide or signing in, rather than guessing. Never invent prices, fees, features, dates or people.
- Never ask for or accept passwords, SMS codes, card numbers or Ghana Card numbers. Never say a payment, verification or account change has been done; you cannot do those.
- For questions about one person, suggest the Check a badge tool. For prices of work, suggest the Rates tool.
- If asked about something unrelated to BAID X or work, say briefly that you only help with BAID X.

Facts:
${FACTS}`;

// Answers when no AI key is set (and the opening greeting). Each topic matches on words.
const TOPICS: { keys: string[]; answer: string }[] = [
  { keys: ["what is", "about", "baid x", "who are", "what do"], answer: "BAID X is Ghana's work network, an organization under Baiden Creatives in East Legon, Accra. It connects workers, companies, project managers, suppliers and clients across all 16 regions, with badges a person at BAID X has checked and payments held in escrow until the work is approved." },
  { keys: ["free", "cost to join", "join", "sign up", "signup", "register", "create account"], answer: "Joining is free for every account type on the Access plan (workers get 5 job applications a month, clients and companies 1 open job post; paid plans remove the limits). Tap Get started and sign up with your phone number; you will get an SMS code. You can add an email later in Edit profile." },
  { keys: ["price", "pricing", "plan", "pro", "premium", "subscription", "how much", "fee", "founding"], answer: "BAID X is free to join on the Access plan (workers 5 job applications a month, clients and companies 1 open job post). Pro per month: worker GH₵200, project manager GH₵300, client GH₵250, supplier GH₵600, company GH₵1,500, with Premium and Enterprise above that. Founding members pay 30% less for 12 months; there is no free trial. Other fees: 10% service fee on money released from escrow (nothing on refunds), verification from GH₵10, boosts from GH₵2 and Paystack's 1.95% when you add money. Disputes and withdrawals are free. See the Pricing page for every fee." },
  { keys: ["escrow", "pay", "payment", "money", "release", "refund", "safe", "dispute", "wallet", "paystack", "momo", "mobile money"], answer: "When you hire, you fund the job from your BAID X wallet (topped up through Paystack). BAID X holds the money while the work happens and releases it when you approve, or automatically 3 days after the worker marks it done if you do not respond. A dispute freezes the money while BAID X reviews it. Payouts go to mobile money." },
  { keys: ["badge", "verif", "verified", "ghana card", "identity", "background", "trust"], answer: "Badges are earned, never bought: a person at BAID X checks the profile, Ghana Card, trade proof or background, depending on the badge (Verified, Identity, Professional, Advanced). Checks have a one-off review fee from GH₵10 that pays for the review, not the result. To check someone, use Check a badge." },
  { keys: ["check", "is this person", "real", "scam", "fake", "legit"], answer: "Use Check a badge: type the person's full name to see whether a person at BAID X has verified them. If they do not appear, be careful and do not send money upfront; hire and pay through escrow instead." },
  { keys: ["rate", "charge", "daily", "quote", "budget", "how much does"], answer: "Open Rates to see the middle daily rate and the range for each trade, from what professionals set on BAID X. You can filter by region. Final prices depend on the job." },
  { keys: ["worker", "electrician", "mason", "plumber", "carpenter", "job", "find work", "artisan"], answer: "Workers create a free profile, get verified to stand out, apply for jobs near them and get paid through escrow to their wallet, then to mobile money. The free plan includes 5 applications a month; Pro from GH₵200 a month makes them unlimited, but never buys a badge." },
  { keys: ["company", "companies", "contractor", "enterprise", "crew", "project"], answer: "Companies run projects on BAID X: hire crews, assign project managers, track tasks, site reports and expenses, and approve every payment through escrow." },
  { keys: ["project manager", "pm"], answer: "Project managers run site delivery: crews, tasks, reports and requests. A company gives you an ID; you enter it and the company approves your access to its projects." },
  { keys: ["supplier", "business", "material", "equipment", "rent", "cement", "sell"], answer: "Suppliers list materials and equipment to sell or rent, with up to 6 photos per listing. Companies and clients can order from them." },
  { keys: ["client", "home", "house", "my build", "logbook", "renovat"], answer: "Clients hire for work on their home and pay through escrow. My build shows budget, progress, site photos and approvals waiting; House logbook keeps who did what, maintenance reminders and your trusted team." },
  { keys: ["job card"], answer: "Every hire gets a Digital Job Card: the scope, materials, photo evidence, payments and sign-off, so everyone sees the same record of the job." },
  { keys: ["region", "where", "location", "accra", "kumasi", "ghana", "city"], answer: "BAID X works in all 16 regions of Ghana. Amounts are in Ghana cedis and payouts go to mobile money." },
  { keys: ["contact", "support", "help", "instagram", "phone number", "email", "call", "whatsapp", "office", "reach", "baiden"], answer: "Email info@baidencreatives.org, call +233 20 607 1106 or WhatsApp +233 55 836 2423 (Monday to Friday, 8am to 5pm). The office is in East Legon, Accra. You can also find BAID X at @baidencreatives on Instagram, X, TikTok, Facebook, LinkedIn and YouTube." },
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

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ reply: topicAnswer(last.content), source: "guide" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 450, system: SYSTEM, messages }),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const data = await r.json();
    const reply = (data?.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
    return json({ reply: reply || topicAnswer(last.content), source: reply ? "ai" : "guide" });
  } catch (e) {
    console.error("baid-bot", String(e));
    return json({ reply: topicAnswer(last.content), source: "guide" });
  }
});
