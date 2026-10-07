# Your Sky

College search where you are the sun. The better a school fits you, the closer it orbits. Live at https://findyoursky.com.

The quiz is free and needs no account. Optional accounts (Supabase) save skies and connect friends, and a one-time Pro pass (Lemon Squeezy) adds hidden matches, chances, real cost and earnings. With no keys configured, accounts and Pro switch off and the site behaves exactly like the account-free version. See [PLAN.md](PLAN.md) for the design and decisions.

## Run it

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173, account-free unless .env has Supabase keys
npm run dev:mock   # same, with a fake in-browser backend: try sign-in (code 000000), saving, Pro and friends
npm test           # all tests (Vitest), including database RLS tests in an in-process Postgres
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
npm run check:functions   # type-check the Edge Functions with Deno
```

## Environment variables

Copy [.env.example](.env.example) to `.env` (never commit it). Only `VITE_*` values reach the browser, and only public ones belong there.

| Variable | Where | What |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | Turn accounts on. Use the publishable key (`sb_publishable_…`). |
| `VITE_LEMON_CHECKOUT_URL` | browser | Turns Pro on. Production builds then strip Pro-only fields from the public school data. |
| `VITE_LEMON_STORE` | browser | Store slug for the affiliate tracking script. |
| `VITE_PRO_PRICE` | browser | Price shown on the paywall (`$4.99`). |
| `LEMON_WEBHOOK_SECRET`, `LEMON_VARIANT_ID`, `ALLOWED_ORIGINS` | Edge Function secrets | Webhook signing secret, the Pro product's variant id, extra allowed origins. |
| `SCORECARD_API_KEY` | local scripts | api.data.gov key for `build_data.py`. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | local scripts | For `import_supabase.py`. A secret key bypasses RLS: keep it local. |

Supabase gives Edge Functions `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_JWKS` automatically.

## Layout

```
app/
  index.html, about.html, privacy.html   pages (Vite entry points)
  public/                                copied as-is: icons, og.jpg, _headers, _redirects (/f/CODE friend links)
  src/
    app.js            screens and interactions (entry)
    config.js         majors, regions, questions, activities
    engine.js         fit scoring, cost estimates, deadlines, share links, friend compatibility
    sky.js            Canvas 2D sand renderer
    accounts.js       sign-in, saving, account page, friends
    pro.js            hidden planets, chance pills, teasers, paywall, checkout, builder
    backend*.js       Supabase client (lazy-loaded) and the dev-only mock
    env.js, api.js, referral.js, stash.js, checkout.js, inapp.js, storage.js
    data.json         generated curated school data
supabase/
  migrations/         schema, RLS, functions (apply with the Supabase CLI)
  functions/          Edge Functions: lemon-webhook, sky, account-delete; shared logic in _shared/
  templates/          email templates to paste into Supabase Auth
scripts/              data and asset generators, Supabase import
tests/                Vitest: engine parity, client helpers, Edge Function logic, database RLS
```

## Data

```bash
SCORECARD_API_KEY=your_key python3 scripts/build_data.py              # curated schools → app/src/data.json
SCORECARD_API_KEY=your_key python3 scripts/build_data.py --pool 1000  # + expanded Pro pool → scripts/out/pool.json
python3 scripts/import_supabase.py                                     # upsert both into Supabase (schools, school_pro)
```

- `scripts/schools.txt` is the curated list (about 200 schools). Each school has hand-entered fields the API doesn't cover:
  - flags for curriculum style, co-op, big-time sports, Greek scene and culture reputation
  - typical deadlines, a one-line note and an accent color
- IDs are saved to `scripts/ids.json`, and responses are cached in `scripts/cache/` (delete the folder to refresh). Re-run yearly when Scorecard updates.
- The pool is the largest bachelor's schools outside the curated list, skipping online-first schools by name. It has no curated flags, so it scores on Scorecard data alone. It is never committed or shipped to browsers.
- Public and private schools report net price by income in different Scorecard fields; the build handles both. Missing values stay `null`, and the app shows "—" or falls back (for example, to average net price, labeled).

## Deploy

**Website (Cloudflare Pages).**
- Build settings: build command `npm run build`, output directory `dist`. The Node version comes from `.node-version`.
- Add the `VITE_*` variables under Settings → Environment variables, for Production and Preview.
- Every branch gets a preview URL.

**Database and functions (Supabase CLI)**, run from the repo root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push                                  # applies supabase/migrations
npx supabase secrets set LEMON_WEBHOOK_SECRET=... LEMON_VARIANT_ID=...
npx supabase functions deploy lemon-webhook sky account-delete
```

Before deploying functions after an engine change, run `npm run sync:shared` (the build does this too). A test fails if the copies drift.

## Testing payments (Lemon Squeezy test mode)

1. In Lemon Squeezy, switch the store to **Test mode**.
2. Use the test-mode checkout link as `VITE_LEMON_CHECKOUT_URL`, and add a test-mode webhook:
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/lemon-webhook`
   - Events: `order_created`, `order_refunded`
3. Buy with card `4242 4242 4242 4242`, any future date and any CVC. Pro should switch on within seconds.
4. Refund the order in Lemon Squeezy. Pro switches off.
5. Lemon Squeezy → Webhooks shows each delivery and lets you resend one. A duplicate delivery doesn't create a second order.

## Tests

- **Parity:** `tests/parity.test.js` proves the module engine matches the pre-refactor scripts. It checks six fixed students across all 203 schools.
- **Client:** `tests/client.test.js` covers referral capture, the anonymous stash, in-app browser detection and checkout links.
- **Edge Functions:** `tests/functions/` covers webhook signatures, idempotency and refunds through the real database, the chances heuristic, what free vs. Pro callers receive, token verification and CORS.
- **Database:** `tests/db/` runs the real migrations in PGlite with Supabase's roles and default grants. It checks every RLS policy with multiple accounts, and checks that the importer's output fits the schema.

## Sharing

Results end with a share card drawn in the browser by the same particle renderer, in story (1080×1920) or square (1080×1080) size. On phones, Share opens the native share sheet with the image and link; elsewhere it's Save image plus Copy link. Share links never include grades, scores, budget or income.

Reduced motion: orbits freeze, the sand transitions become plain fades, and the headline renders immediately.
