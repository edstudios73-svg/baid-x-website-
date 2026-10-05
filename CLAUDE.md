# BAID X — Website

Static site (HTML/CSS/vanilla JS in `js/`) with serverless routes in `api/` on Vercel (project `baid-x-website`, Hobby plan: 12 functions max), backed by Supabase project `igfmmprlrybxsdzehwid`. Secrets live only in Vercel env vars; never print or commit them.

## Website and app are one product

The Flutter app lives in `edstudios73-svg/baid-x-mobile-` and uses the same Supabase project and this site's `/api` routes. Its web build is served from `app/` here (`/app/`).

Standing rule from the product owner: **every change requested for the website is also made in the app, and every app change is also made here, in the same task.** One request covers both; the owner should never have to ask twice.

For every change:

1. Implement it here and in the app, matching flow, wording and UI (sizes, layout, states).
2. Here: `npm test`. App: `flutter analyze` and `flutter test`.
3. Rebuild the app's web build into `app/` (`flutter build web --release --base-href /app/`; copy `main.dart.js`, `flutter_bootstrap.js`, `version.json`, `assets/`).
4. Commit and push both repos on the working branch, then deploy to production.
5. Compare the website and the app at phone width (390px) before calling it done.

UI: flat dark cards on the grid background for home, dashboards, profile and checklist; glass only on `auth.html` and the guest Profile. No emoji in the UI.

Database: inspect before changing, never disable RLS, avoid destructive migrations.
