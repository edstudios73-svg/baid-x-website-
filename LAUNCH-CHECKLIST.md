# BAID X launch checklist (owner items)

Items only the owner can do. The site already says BAID X is an organization under Baiden Creatives,
East Legon, Accra (info@baidencreatives.org, +233 20 607 1106).

## Company and legal

- [ ] Send the Baiden Creatives registration number. It goes on the Contact page and in terms
      section 15 (`company.json` → `reg_no` in the fix bundle, or edit `contact.html` and `terms.html`).
      Until then no number is shown.
- [ ] Have a Ghanaian lawyer review `terms.html` (sections 6 to 9: wallet, escrow, disputes, fees)
      and `privacy.html`.
- [ ] Confirm with Paystack (and the Bank of Ghana, if needed) how wallet and escrow money is held.
      Terms 6.3 currently says it is collected and paid out through Paystack and recorded separately
      from BAID X's own money.
- [ ] Register with the Data Protection Commission of Ghana as a data controller (Baiden Creatives).

## Domain and sign-in

- [ ] Supabase → Authentication → URL configuration: set Site URL to `https://www.baid-x.com` and
      add `https://www.baid-x.com/**` to the redirect URLs. Keep the old vercel.app entries until
      old email links have expired.
- [ ] Google Cloud OAuth client: add `https://www.baid-x.com` to the authorised JavaScript origins.
- [ ] Paystack dashboard: set the callback URL to `https://www.baid-x.com/` and the webhook to
      `https://www.baid-x.com/api/paystack-webhook`. The old vercel.app `/api/` URLs keep working
      because `/api/` is not redirected.
- [ ] Optional: in Cloudflare, change the A record for baid-x.com to Vercel's newer IP 216.198.79.1.

## Plans and Paystack

- [ ] Optional tidy-up: in the Paystack dashboard (Products, Plans) archive the old BAID X plans at the
      previous prices. Nothing uses them; checkout creates new plans at the new prices automatically.

- [ ] Paystack dashboard → Settings → Preferences: turn on the payment channels members can pick at checkout
      (Mobile Money, Card, and Bank / Bank transfer if Paystack offers it on your account). A channel that is
      off shows an error on Paystack's page when a member picks it.
- [ ] Paystack dashboard → Settings → Payouts: check the bank or Mobile Money account Paystack pays your
      balance into. Admin → Finance → Paystack money shows the balance and each payout.

## Search and sharing

- [ ] Google Search Console: add the `https://www.baid-x.com` property and submit
      `https://www.baid-x.com/sitemap.xml`. Also use "Change of address" from the old vercel.app property.
- [ ] Bing Webmaster Tools: submit the same sitemap.
- [ ] Facebook Sharing Debugger and LinkedIn Post Inspector: re-scrape `https://www.baid-x.com/`.

## Fees now live

- Service fee on escrow payouts: 10% (database `platform_settings.commission_rate` = 0.10; change it
  in Admin → Settings). Refunds, disputes and withdrawals are free. Paystack's 1.95% applies when
  adding money. Verification fees: GH₵50, 120, 250 (business GH₵250, 500). Boosts GH₵15 to GH₵500.
- If any fee changes, update `terms.html` section 9, `scripts/build-seo.py` (FEE_ROWS and FAQs),
  the homepage FAQ and BAID Bot's facts (`supabase/functions/baid-bot/index.ts`), then redeploy.

## Messaging through Zend (SMS, WhatsApp, email, sign-in codes)

SasuSync has been replaced by Zend (https://tryzend.com). Zend has no test mode, so nothing is sent until
`MESSAGING_LIVE` is `true`. Do these in order; every value goes in Vercel → baid-x-website → Settings →
Environment Variables (Production), never in the code.

- [ ] Zend dashboard: create an API key (with the `email:send` scope too) and add credit.
- [ ] Vercel: `ZEND_API_KEY` = that key (mark it Sensitive).
- [ ] Vercel: `MESSAGING_PHONE_AUTH` = `true` (keeps phone sign-up and sign-in on; it replaces
      `SASUSYNC_PHONE_AUTH`, which is still read until you remove it).
- [ ] Optional: `ZEND_SENDER_ID` = an approved sender name (leave empty to use Zend's default sender).
- [ ] Optional: `ZEND_OTP_CHANNEL` = `whatsapp` to send sign-in codes on WhatsApp instead of SMS.
- [ ] Zend dashboard → Settings → Webhooks → Add endpoint `https://www.baid-x.com/api/webhooks/zend`
      (events: sent, delivered, failed, read). Copy the signing secret into Vercel as `ZEND_WEBHOOK_SECRET`.
- [ ] WhatsApp (optional): create and get approved two templates, then add their ids:
      `ZEND_WA_TEMPLATE_ANNOUNCE` (one variable named `message`) for announcements and welcome texts, and
      `ZEND_WA_TEMPLATE_NOTIFY` (one variable named `title`) for account alerts. Anyone not on WhatsApp
      gets the SMS instead.
- [ ] Email (optional): Zend → Email → Domains, add `baid-x.com` and put the DKIM and SPF records in
      Cloudflare. Then set `ZEND_EMAIL_FROM` = `BAID X <hello@baid-x.com>` (any address on that domain).
- [ ] Redeploy, then set `MESSAGING_LIVE` = `true` and redeploy again.
- [ ] Mission Control → Notifications → Delivery: the Zend card should say "API key works". Send one
      test SMS (and WhatsApp / email if set up) to your own number or address.
- [ ] Remove the old `SASUSYNC_*` variables from Vercel and the webhook in the SasuSync portal.
- Limits you can change in Vercel: `MESSAGING_OTP_DAILY_CAP` (default 40 codes a day),
  `MESSAGING_BROADCAST_MAX` (500 per SMS/WhatsApp announcement), `MESSAGING_EMAIL_BROADCAST_MAX` (300),
  `MESSAGING_AUTO_DAILY_CAP` (100 welcome texts a day).
- Zend sends only: it does not receive replies, so WhatsApp replies and incoming emails do not reach BAID X.
