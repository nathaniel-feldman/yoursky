# Your Sky

College search where you are the sun. The better a school fits you, the closer it orbits. Live at https://findyoursky.com.

There's no backend yet and no accounts. All state lives in the page, and a share link (`#s=…`) carries a student's kept schools and answers, never their GPA, scores or budget. Accounts, Pro and friend skies are in progress on `feature/accounts-and-pro`; see [PLAN.md](PLAN.md).

## Run it

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload
npm test           # unit and parity tests (Vitest)
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

## Deploy

Cloudflare Pages builds from GitHub:

- Build command: `npm run build`
- Build output directory: `dist`
- Node version: read from `.node-version` (22)

Every push to a branch gets its own preview URL; `main` deploys to findyoursky.com. Vite fingerprints asset filenames, so there's no manual cache busting. `app/public/_headers` sets security headers and caches `/assets/*` for a year.

## Layout

```
app/
  index.html, about.html   pages (Vite entry points)
  public/                  copied as-is: favicon, touch icon, og.jpg, _headers
  src/
    app.js                 screens and interactions (entry module)
    config.js              majors, regions, climate, questions, activities, follow-ups
    engine.js              fit scoring, reach/target/likely, cost estimates, deadlines, share links, friend compatibility
    sky.js                 Canvas 2D sand renderer (planets, solar system, sand effects); lowers grain counts if frames run slow
    styles.css             visual design
    data.json              generated school data (see below)
scripts/                   data and asset generators
tests/                     Vitest tests and fixtures
```

Reduced motion: orbits freeze, the sand transitions become plain fades, and the headline renders immediately.

## Data

`app/src/data.json` is generated from the U.S. Department of Education College Scorecard API:

```bash
SCORECARD_API_KEY=your_key python3 scripts/build_data.py
```

- Get a free key at https://api.data.gov/signup. `DEMO_KEY` works but allows about 10 requests per hour.
- `scripts/schools.txt` is the curated list (about 200 schools). Each school has hand-entered fields the API doesn't cover:
  - flags for curriculum style (open/core/project), co-op, big-time sports, Greek scene and culture reputation
  - typical deadlines, a one-line note and an accent color
- The first run finds Scorecard IDs by name and saves them to `scripts/ids.json`. Later runs fetch by ID in two requests. Responses are cached in `scripts/cache/`; delete that folder to refresh.
- Fields used:
  - admissions: admit rate, SAT/ACT middle 50%, test policy
  - school: size, student-faculty ratio, locale, Carnegie class, location
  - cost: cost of attendance, tuition, room and board, average net price, net price by income
  - outcomes: graduation rate, earnings, median debt, share of graduates by field (for major strength)

Deadlines in `schools.txt` are typical patterns, and the app tells students to confirm each date on the school's site.

The favicon, touch icon and link-preview image come from `python3 scripts/make_assets.py` (macOS, uses `sips`).

## Sharing

Results end with a story-sized (1080×1920) share card drawn in the browser by the same particle renderer. It shows the student's planet with their name in sand, their kept schools orbiting in school colors, and their three closest orbits. On phones, Share opens the native share sheet with the image and link; elsewhere it's Save image plus Copy link. `SITE` in `app/src/app.js` is the domain printed on the card. Link previews (Open Graph) are generic, since personalized previews would need a server.

## Tests

- `tests/parity.test.js` checks that the module engine gives exactly the same output as the pre-refactor scripts: fits, chances, costs, explanations, deadlines, share links and friend compatibility. The check covers six fixed students across all 203 schools, compared against `tests/fixtures/engine-baseline.json`. Regenerate that file (`node scripts/make_baseline.mjs <commit>`) only when a scoring change is intentional.
- `tests/engine.test.js` covers edge cases: missing data, test-optional, out-of-state tuition, and share-link privacy.
