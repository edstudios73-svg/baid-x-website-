// Scheduled (see vercel.json crons): ends expired periods, suspends unpaid grace periods, applies scheduled downgrades.
const { configured, env, rpc } = require("./_lib/paystack");
module.exports = async (req, res) => {
  if (!configured()) return res.status(503).end();
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const r = await rpc("billing_sweep", {});
  return res.status(r.ok ? 200 : 500).json(r.json || {});
};
