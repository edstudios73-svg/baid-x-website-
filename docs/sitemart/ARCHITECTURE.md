# SiteMart: architecture and roadmap

SiteMart is BAID X's marketplace for construction materials, heavy equipment, delivery and (later) real estate. It launches in Ghana and is built so other African markets can be switched on later.

It shares BAID X's look, accounts, Supabase project, wallet, escrow and Paystack. One account works on both.

- Website: `sites/sitemart/`, Vercel project `sitemart`, branch `sitemart`.
- Database: `supabase/phase27_sitemart_foundation.sql` and later phases.
- App: the `sitemart` branch of `edstudios73-svg/baid-x-mobile-`.

## 1. Decisions made from the brief

| Brief says | What SiteMart does | Why |
|---|---|---|
| Next.js, Tailwind, shadcn | The BAID X stack: static HTML/CSS/vanilla JS, Supabase RPCs with RLS, Vercel | The owner asked for "same UI and interface as BAID X". One codebase style, nothing new to maintain. SiteMart is its own Vercel project, so it has its own 12-function budget. |
| Design "inspired by BDEX" | BAID X's own system: black, white and greys on glass, Inter, line icons | It is the BAID X brand (CLAUDE.md). No gold, amber, yellow, emoji, gradient text or slogan headings. Green and red are used only for verified/approved and error states. |
| 11 account types | 10 SiteMart types in `sm_accounts`. Platform Administrator is BAID X Mission Control staff (`admin_users`, `_need()`). | Staff roles and two-step sign-in already exist. Duplicating them would weaken security. |
| Separate listings | Listings stay in BAID X's `business_products` / `business_equipment`, with SiteMart columns added | One catalogue: a supplier lists once and sells on both. This avoids duplicate models. |
| Supplier trust levels | `_sm_trust()` is computed from BAID X checks: verified business, identity verified, documents in review, unverified | Members cannot set it. Plans and boosts never change it. |
| Maps (Mapbox/Google) | Phase 3: Leaflet with OpenStreetMap tiles, or Mapbox if the owner adds a key | Leaflet/OSM needs no paid key to start. |
| Licensed escrow partner | See §6. Today BAID X escrow is a ledger over funds collected by Paystack. | **Owner decision needed.** |

## 2. System overview

```
Browser (sites/sitemart)            Flutter app (sitemart branch)
   │  publishable key only             │
   ▼                                   ▼
Supabase (igfmmprlrybxsdzehwid)
   Auth ──── one account for BAID X and SiteMart
   Postgres ─ RLS on every table; writes only through SECURITY DEFINER functions
   Storage ── sm-verification (private), listing photos (BAID X buckets)
   Realtime ─ order and shipment updates (Phase 2–3)
   pg_cron ── settle orders, expire quotes, sweep groups
   Edge functions ─ webhooks (Paystack via BAID X), GPS ingest (Phase 3)
BAID X /api (Vercel) ── Paystack checkout + webhook, wallet top-ups, payouts
```

The modules map to database schemas of functions, not separate servers:

- Auth: Supabase Auth plus `sm_accounts`.
- Marketplace: `sitemart_*` reads.
- Procurement: RFQs and groups.
- Orders and payments: existing BAID X `orders`, `wallet_*`, `escrow_holds`.
- Logistics and tracking: `sm_shipments`, `sm_shipment_events`.
- Notifications: BAID X `notify_user`.
- Real estate: `sm_properties`.
- Projects: BAID X `projects`, extended.
- Admin: BAID X Mission Control.

## 3. Data model

### Phase 1 (this file: `phase27_sitemart_foundation.sql`)

| Table / function | Purpose |
|---|---|
| `sm_countries` | Markets with currency and dial code. Only Ghana is `active`; NG, TG, BJ, CI, SN are set up but switched off. |
| `sm_categories` | 19 material and 15 equipment categories, each with its allowed units. |
| `business_products` + columns | `sm_category`, `unit` (bag, tonne, m³, trip, piece, truckload…), `min_order_qty`, `bulk_tiers` (≤5), `delivery_options`, `delivery_days_min/max`, `specs`, `country` |
| `business_equipment` + columns | `sm_category`, `manufacturer`, `model`, `year_made`, `hour_meter`, `hourly_rate`, `weekly_rate` (daily and sale prices already exist), `deposit_ghs`, `operator`, `delivery_options`, `specs`, `country` |
| `sm_accounts` | Account type, name, business name, phone, country, category and registration number |
| `sm_verification` + bucket `sm-verification` | Documents sent for review. Only staff with `verification:APPROVE` can decide, and each decision is audited. |
| `sm_saved` | Saved items and followed suppliers |
| `sitemart_home/search/listing/supplier` | Public reads. They never return phone numbers, emails, IDs or payout details. |
| `sm_register/me/listing_details/toggle_saved/submit_verification` | Member writes. Each checks the caller and validates its input. |

### Planned

| Phase | Tables |
|---|---|
| 2 | `sm_carts`, `sm_rfqs`, `sm_rfq_items`, `sm_quotes`, `sm_documents` (quotes, invoices, POs, receipts as generated PDFs), `orders` extended (multi-line `order_items`, currency, inspection period), `sm_rental_bookings` (period, deposit, availability calendar) |
| 3 | `sm_shipments`, `sm_shipment_events` (source = `gps` / `checkpoint` / `estimate`, with who recorded it), `sm_carriers`, `sm_drivers`, `sm_devices`, `sm_delivery_checks` (photos, quantities received, damage), `sm_condition_reports` (equipment check-in/out) |
| 4 | `sm_groups`, `sm_group_members` (each member with their own escrow hold, allocation, address and invoice), `sm_properties`, `sm_property_enquiries`, `sm_viewings`, project procurement links, supplier analytics views |
| 5 | Corporate accounts and approvals, API keys for partners, regional operations, tax tables per country |

Rules for every phase:

- RLS on every table.
- No client inserts or updates on money or trust tables.
- Idempotency keys on every money movement (the BAID X pattern).
- `_audit()` on every staff action.
- Migrations only add, never drop.

## 4. Design system

- **Colour:** `#050505` background; white text and buttons; greys `#a3a3a3` and `#d4d4d4`; glass at `rgba(255,255,255,.06–.12)` with 14–18px blur. Green `#34d399` means verified or approved only; red `#fca5a5` means errors and "not yet verified" only.
- **Type:** Inter 400/600/700/800, with headings set tight (−0.025em).
- **Shapes:** cards 22px, tiles 18px, inputs 14px, buttons 14px, chips pill.
- **Status is never colour alone.** Tracking uses a solid dot (confirmed checkpoint), a ringed dot (live GPS) and a dashed dot (estimate), each with a written legend.
- **Motion:** hover lift 2px and skeleton pulse only, both off under reduced motion.
- **Navigation:**
  - Desktop top bar: Home, Marketplace, Equipment, Real Estate, Logistics, Dashboard, plus search and account.
  - Phone (≤760px): a bottom bar with Home, Market, Equipment, Logistics, Account.
- **States:** every list has loading (skeleton), empty (what to do next), error (retry) and success.

## 5. Application structure

```
sites/sitemart/
  index.html          shell: top bar, bottom bar, footer
  css/site.css        the design system above
  js/config.js        Supabase URL + publishable key (never a secret)
  js/core.js          client, session, error wording, cards, icons, units
  js/site.js          router and pages
  js/vendor/supabase.js
```

Routes:

- `#/` home
- `#/market` and `#/equipment` (`?cat&q&region&sort&deal`)
- `#/search?q`
- `#/item/<material|equipment>/<id>`
- `#/supplier/<id>`
- `#/property`
- `#/logistics`
- `#/signin`, `#/join`, `#/reset`
- `#/dashboard`

## 6. Money: what is real and what needs a partner

SiteMart orders use BAID X's live money path:

- The buyer tops up the wallet through Paystack (Mobile Money, bank, card; the Paystack fee is 1.95%).
- `place_order` moves the amount into an `escrow_holds` row.
- Release pays the supplier minus `platform_settings.commission_rate` (10%).
- Disputes freeze the hold until an admin with `finance` permission splits it, with an audit entry.

The brief asks for more than BAID X does today:

1. **Licensed escrow partner.** Paystack collects the money into BAID X's own merchant balance. The "escrow" is BAID X's own ledger over that balance, which is the arrangement the brief says not to rely on. Holding customer funds for third parties may need a licence or a regulated partner, such as a bank trust or escrow account; that is for the owner and a lawyer to confirm with the regulator. The code is ready for that partner: release and refund go through `_escrow_release` / `_escrow_refund`, so a partner integration replaces their insides, not the order flow. **Until then, SiteMart must not call this "licensed escrow".**
2. **Release only on buyer confirmation or a dispute decision.** BAID X orders currently release 3 days after the supplier marks them delivered if the buyer stays silent. For SiteMart, the proposal is:
   - release on buyer confirmation;
   - or after the inspection period, only when delivery is evidenced by the logistics provider's confirmed "delivered" checkpoint or a signed delivery note;
   - never on the supplier's word alone.
   **Owner decision needed.**
3. **Multi-currency.** `sm_countries` holds currencies. The wallet stays in GHS until a second market opens and a payment partner supports that currency.

## 7. Logistics tracking rules (Phase 3)

Every shipment event stores its `source`:

- `gps`: from an authorised device or driver app, with device ID and accuracy;
- `checkpoint`: confirmed by an authorised logistics operator, with that person's ID;
- `estimate`: computed by SiteMart.

The page shows the source on every point. SiteMart never invents a position. The route is built from the real origin, destination and carrier, not from a template. Buyers are notified on:

- confirmed;
- payment secured;
- dispatched;
- each checkpoint;
- border crossed;
- approaching;
- delivered.

## 8. Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Look and landing; sign-in on SiteMart; 10 account types; trust levels and verification documents; materials and equipment marketplaces with categories, units, minimum orders, bulk prices, delivery, specs, rent/sale rates; global search; supplier pages; saved items | **Built.** Database file written and tested on a local copy, not yet applied to Supabase. |
| 2 Transactions | Cart with many items, orders inside SiteMart, RFQs and competing quotes, rental requests with periods and deposits, invoices/receipts/POs as documents, order chat | Next |
| 3 Logistics | Carriers, drivers, shipments, GPS ingest, checkpoints, map, delivery checks with photos and quantities, condition reports, dispute dashboard | |
| 4 Ecosystem | Group procurement, project procurement, real estate, supplier analytics, rental management, second country | |
| 5 Enterprise | Corporate accounts and approvals, reporting, partner API, automation, regional operations | |

Each phase ships on both the website and the app, with tests for its permission and money workflows.

## 9. Configuration and integrations

| Item | Where | Notes |
|---|---|---|
| Supabase URL, publishable key | `sites/sitemart/js/config.js` | Public by design. |
| Supabase Auth redirect URLs | Supabase dashboard → Authentication → URL configuration | **Add the SiteMart address** (and its custom domain) so email confirmation and password-reset links return to SiteMart instead of BAID X. |
| Paystack secret, webhook secret | BAID X Vercel env vars | SiteMart does not hold payment secrets. |
| Maps key (optional) | Phase 3, Vercel env var for the `sitemart` project | Only if Mapbox or Google is chosen. |
| SMS / email / push | BAID X providers | Reused through `notify_user`. |

## 10. Open items for the owner

1. Apply `phase27_sitemart_foundation.sql`. This waits on the Supabase connector being reconnected.
2. Add the SiteMart address to the Supabase Auth redirect URLs.
3. Decide the escrow partner question (§6.1) and the release rule (§6.2).
4. Choose SiteMart's web address (for example `sitemart.baid-x.com`).
