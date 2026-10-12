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
