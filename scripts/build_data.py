#!/usr/bin/env python3
"""Build app/data.js from the U.S. Dept. of Education College Scorecard API.

Usage:
  SCORECARD_API_KEY=yourkey python3 scripts/build_data.py

Get a free key at https://api.data.gov/signup (DEMO_KEY works but allows ~10 requests/hour).
First run discovers Scorecard IDs by name and saves them to scripts/ids.json.
Later runs fetch those IDs directly (2 requests for ~200 schools).
Responses are cached in scripts/cache/ so a rate-limited run can resume.
"""
import json, os, re, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "cache")
OUT = os.path.join(ROOT, "..", "app", "data.js")
KEY = os.environ.get("SCORECARD_API_KEY", "DEMO_KEY")
BASE = "https://api.data.gov/ed/collegescorecard/v1/schools"

BRACKETS = ["0-30000", "30001-48000", "48001-75000", "75001-110000", "110001-plus"]
FIELDS = [
    "id", "school.name", "school.city", "school.state", "school.locale", "school.ownership",
    "school.carnegie_basic", "school.religious_affiliation", "school.minority_serving.historically_black",
    "school.women_only", "school.school_url", "school.price_calculator_url", "location.lat", "location.lon",
    "latest.student.size", "latest.student.demographics.student_faculty_ratio",
    "latest.admissions.admission_rate.overall", "latest.admissions.test_requirements",
    "latest.admissions.sat_scores.25th_percentile.critical_reading", "latest.admissions.sat_scores.25th_percentile.math",
    "latest.admissions.sat_scores.75th_percentile.critical_reading", "latest.admissions.sat_scores.75th_percentile.math",
    "latest.admissions.act_scores.25th_percentile.cumulative", "latest.admissions.act_scores.75th_percentile.cumulative",
    "latest.cost.attendance.academic_year", "latest.cost.tuition.in_state", "latest.cost.tuition.out_of_state",
    "latest.cost.roomboard.oncampus", "latest.cost.roomboard.offcampus", "latest.cost.booksupply",
    "latest.cost.avg_net_price.public", "latest.cost.avg_net_price.private",
    "latest.completion.rate_suppressed.overall", "latest.earnings.10_yrs_after_entry.median",
    "latest.aid.median_debt.completers.overall", "latest.academics.program_percentage",
] + [f"latest.cost.net_price.{o}.by_income_level.{b}" for o in ("public", "private") for b in BRACKETS]
BASEQ = "school.degrees_awarded.predominant=3&school.operating=1&latest.student.size__range=300.."


def check_key():
    if KEY.lower() in ("paste_your_key", "your_key_here", "your_key", ""):
        sys.exit("Replace the placeholder with your real key from https://api.data.gov/signup\n"
                 "  SCORECARD_API_KEY=<your 40-character key> python3 scripts/build_data.py")


def get(name, query):
    path = os.path.join(CACHE, name + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    url = f"{BASE}?api_key={KEY}&{query}&fields={','.join(FIELDS)}&per_page=100"
    for attempt in range(4):
        try:
            data = json.load(urllib.request.urlopen(url, timeout=60))
            os.makedirs(CACHE, exist_ok=True)
            json.dump(data, open(path, "w"))
            print(f"  fetched {name}: {len(data['results'])} rows (total {data['metadata']['total']})")
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # Rejected requests still count against the hourly window, so back off a full hour.
                print(f"  rate limited on {name}; waiting 61 min (attempt {attempt + 1})", flush=True)
                time.sleep(3660)
                continue
            body = e.read()[:400]
            if e.code == 403 and b"API_KEY_INVALID" in body:
                sys.exit("That API key was rejected. Copy the key exactly from your api.data.gov email and try again.")
            sys.exit(f"HTTP {e.code} for {name}: {body}")
    sys.exit("gave up after repeated rate limits")


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower().replace("&", " ")).strip()


def load_curated():
    rows = []
    for line in open(os.path.join(ROOT, "schools.txt")):
        if not line.strip() or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.rstrip("\n").split("|")] + [""]
        short, keys, st, flags, dl, note, color = parts[:7]
        rows.append(dict(short=short, keys=[norm(k) for k in keys.split("/")], st=st, flags=flags, dl=dl, note=note, color=color))
    return rows


def pool_by_discovery():
    pool = {}
    # Selective schools (any size >= 300), then the 300 largest schools. Fits in ~9 requests.
    for p in range(6):
        d = get(f"selective_{p}", f"{BASEQ}&latest.admissions.admission_rate.overall__range=0..0.6&page={p}")
        for r in d["results"]:
            pool[r["id"]] = r
        if len(d["results"]) < 100:
            break
    for p in range(3):
        d = get(f"largest_{p}", f"{BASEQ}&sort=latest.student.size:desc&page={p}")
        for r in d["results"]:
            pool[r["id"]] = r
    return pool


def match(curated, pool):
    ids, missing = {}, []
    for c in curated:
        cands = [r for r in pool.values() if r["school.state"] == c["st"]
                 and any(norm(r["school.name"]).startswith(k) for k in c["keys"])]
        if not cands:
            missing.append(c["short"])
            continue
        cands.sort(key=lambda r: (-(r.get("latest.student.size") or 0)))
        ids[c["short"]] = cands[0]["id"]
    return ids, missing


def r0(v, n=0):
    return None if v is None else (round(v) if n == 0 else round(v, n))


def compact(r, c):
    g = lambda k: r.get(k)
    own = g("school.ownership")
    pub = own == 1
    sat = None
    parts = [g(f"latest.admissions.sat_scores.{p}_percentile.{s}") for p in ("25th", "75th") for s in ("critical_reading", "math")]
    if all(parts):
        sat = [parts[0] + parts[1], parts[2] + parts[3]]
    act = [g("latest.admissions.act_scores.25th_percentile.cumulative"), g("latest.admissions.act_scores.75th_percentile.cumulative")]
    nbi = [g(f"latest.cost.net_price.{'public' if pub else 'private'}.by_income_level.{b}") for b in BRACKETS]
    progs = {k.split(".")[-1]: round(v, 3) for k, v in r.items()
             if k.startswith("latest.academics.program_percentage.") and v and v >= 0.002}
    return dict(
        id=r["id"], n=c["short"], f=g("school.name"), c=g("school.city"), s=g("school.state"),
        lat=r0(g("location.lat"), 3), lon=r0(g("location.lon"), 3), loc=g("school.locale"), pub=1 if pub else 0,
        cb=g("school.carnegie_basic"), rel=1 if g("school.religious_affiliation") else 0,
        hbcu=g("school.minority_serving.historically_black") or 0, wo=g("school.women_only") or 0,
        url=g("school.school_url"), calc=g("school.price_calculator_url"),
        size=g("latest.student.size"), sfr=g("latest.student.demographics.student_faculty_ratio"),
        adm=r0(g("latest.admissions.admission_rate.overall"), 3), test=g("latest.admissions.test_requirements"),
        sat=sat, act=act if all(act) else None,
        coa=g("latest.cost.attendance.academic_year"), tin=g("latest.cost.tuition.in_state"),
        tout=g("latest.cost.tuition.out_of_state"), rb=g("latest.cost.roomboard.oncampus"), rboff=g("latest.cost.roomboard.offcampus"), books=g("latest.cost.booksupply"),
        net=g("latest.cost.avg_net_price.public") if pub else g("latest.cost.avg_net_price.private"), nbi=nbi,
        grad=r0(g("latest.completion.rate_suppressed.overall"), 3), earn=g("latest.earnings.10_yrs_after_entry.median"),
        debt=r0(g("latest.aid.median_debt.completers.overall")), prog=progs,
        x=c["flags"], dl=c["dl"], note=c["note"] or None, col=c["color"] or None,
    )


def main():
    check_key()
    curated = load_curated()
    ids_path = os.path.join(ROOT, "ids.json")
    if os.path.exists(ids_path):
        ids = json.load(open(ids_path))
        id_list = list(ids.values())
        pool = {}
        for i in range(0, len(id_list), 100):
            d = get(f"ids_{i // 100}", "id=" + ",".join(map(str, id_list[i:i + 100])))
            pool.update({r["id"]: r for r in d["results"]})
        missing = [c["short"] for c in curated if c["short"] not in ids or ids[c["short"]] not in pool]
    else:
        pool = pool_by_discovery()
        ids, missing = match(curated, pool)
        json.dump(ids, open(ids_path, "w"), indent=1)
    # Look up anything still unmatched by name (one request each), then remember its ID.
    if missing:
        import urllib.parse
        for c in [c for c in curated if c["short"] in missing]:
            term = urllib.parse.quote(c["keys"][0])
            d = get("name_" + re.sub(r"[^a-z0-9]+", "_", c["short"].lower()), f"school.name={term}&school.state={c['st']}&school.operating=1")
            cands = [r for r in d["results"] if any(norm(r["school.name"]).startswith(k) for k in c["keys"])] or d["results"]
            if cands:
                best = max(cands, key=lambda r: r.get("latest.student.size") or 0)
                pool[best["id"]] = best; ids[c["short"]] = best["id"]
        json.dump(ids, open(ids_path, "w"), indent=1)
        missing = [s for s in missing if s not in ids]
    if missing:
        print("Not matched (skipped):", ", ".join(missing))
    schools = [compact(pool[ids[c["short"]]], c) for c in curated if c["short"] in ids and ids[c["short"]] in pool]
    with open(OUT, "w") as f:
        f.write("// Generated by scripts/build_data.py from the U.S. Dept. of Education College Scorecard.\n")
        f.write(f"window.ORBIT_DATA={{asOf:{json.dumps(time.strftime('%Y-%m-%d'))},schools:")
        json.dump(schools, f, separators=(",", ":"))
        f.write("};\n")
    print(f"Wrote {len(schools)} schools to app/data.js")


if __name__ == "__main__":
    main()
