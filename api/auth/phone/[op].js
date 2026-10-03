// One serverless function for the phone-auth endpoints (the Hobby plan caps a deployment at 12 functions):
//   /api/auth/phone/start | verify | login | password   ->   handlers in api/_lib/phoneauth/
const handlers = { start: require("../../_lib/phoneauth/start"), verify: require("../../_lib/phoneauth/verify"), login: require("../../_lib/phoneauth/login"), password: require("../../_lib/phoneauth/password") };
module.exports = (req, res) => {
  const h = Object.prototype.hasOwnProperty.call(handlers, String(req.query && req.query.op)) ? handlers[req.query.op] : null;
  if (!h) return res.status(404).end();
  return h(req, res);
};
