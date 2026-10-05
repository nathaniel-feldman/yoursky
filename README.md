# Your Sky

College search where you are the sun. The better a school fits you, the closer it orbits.

Static site, no backend, no accounts. Live at https://findyoursky.com (hosted on Cloudflare Pages; `SITE` in `app/app.js` is the fallback shown on share cards when running locally). All state lives in the page; a share link (`#s=…`) carries a student's kept schools and answers, never their GPA, scores or budget.

## Run it

```bash
python3 -m http.server 5173 --directory app
```

Then open http://localhost:5173. Deploy by uploading `app/` to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages).

## Data

`app/data.js` is generated from the U.S. Department of Education College Scorecard API:

```bash
SCORECARD_API_KEY=your_key python3 scripts/build_data.py
```

- Get a free key at https://api.data.gov/signup. `DEMO_KEY` works but allows about 10 requests per hour.
- `scripts/schools.txt` is the curated list (about 200 schools). Each school has hand-entered flags the API doesn't cover: curriculum style (open/core/project), co-op, big-time sports, Greek scene, culture reputation, plus typical deadlines and a one-line note.
- The first run finds Scorecard IDs by name and saves them to `scripts/ids.json`. Later runs fetch by ID in two requests. Responses are cached in `scripts/cache/`; delete that folder to refresh.
- Fields used: admit rate, SAT/ACT middle 50%, test policy, size, student-faculty ratio, locale, Carnegie class, location, cost of attendance, tuition, room and board, average net price and net price by income, graduation rate, earnings, median debt, and share of graduates by field (for major strength).

Deadlines in `schools.txt` are typical patterns, and the app tells students to confirm each date on the school's site.

## Sharing

Results end with a story-sized (1080×1920) share card drawn in the browser from the same particle renderer: the student's planet with their name in sand, kept schools orbiting in their colors, and their three closest orbits. On phones, Share opens the native share sheet with the image and link; elsewhere it's Save image plus Copy link. Link previews (Open Graph) are generic, since personalized previews would need a server.

When you change any file in `app/`, bump the `?v=` number on the asset links in `app/index.html` so returning visitors don't get a stale cached copy.

## Files

- `app/config.js`: majors, regions, climate map, questions, activities, major follow-ups
- `app/engine.js`: fit scoring, reach/target/likely, cost estimates, deadlines, share links, friend compatibility
- `app/sky.js`: Canvas 2D particle renderer (sand planets, solar system, sand effects), batched by brightness level for mid-range phones; it lowers grain counts automatically if frames run slow
- `app/app.js`: screens and interactions
- `app/styles.css`: visual design

Reduced motion: orbits freeze, the sand transitions become plain fades, and the headline renders immediately.
