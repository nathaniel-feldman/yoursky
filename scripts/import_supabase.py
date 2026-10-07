#!/usr/bin/env python3
"""Import school data into Supabase (schools + school_pro). Re-runnable: rows are upserted by Scorecard id.

Usage (after scripts/build_data.py, and --pool for hidden planets):
  python3 scripts/import_supabase.py            # reads SUPABASE_URL and SUPABASE_SECRET_KEY from .env
  python3 scripts/import_supabase.py --dry-run  # shows what would be sent

The secret key bypasses Row Level Security, so it must only ever live in your local .env (never VITE_*, never in the
browser, never committed).
"""
import datetime, json, os, sys, urllib.request, urllib.error

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CURATED = os.path.join(ROOT, "app", "src", "data.json")
POOL = os.path.join(ROOT, "scripts", "out", "pool.json")
PRO_FIELDS = ("nbi", "earn")  # must match PRO_FIELDS in vite.config.js


def load_env():
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def rows_for(schools, curated, as_of):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out_s, out_p = [], []
    for s in schools:
        public = {k: v for k, v in s.items() if k not in PRO_FIELDS}
        sat, act = s.get("sat") or [None, None], s.get("act") or [None, None]
        out_s.append({
            "unitid": s["id"], "curated": curated, "name": s.get("f") or s["n"], "short_name": s["n"],
            "city": s.get("c"), "state": s.get("s"), "size": s.get("size"), "is_public": bool(s.get("pub")),
            "admit_rate": s.get("adm"), "sat_25": sat[0], "sat_75": sat[1], "act_25": act[0], "act_75": act[1],
            "sticker_price": s.get("coa"), "avg_net_price": s.get("net"), "data": public,
            "data_year": f"Scorecard latest, fetched {as_of}", "updated_at": now,
        })
        nbi = s.get("nbi")
        out_p.append({
            "unitid": s["id"],
            "net_price_by_income": nbi if isinstance(nbi, list) and len(nbi) == 5 else None,
            "median_earnings": s.get("earn"),
            "data": {k: s[k] for k in PRO_FIELDS if k in s},
            "updated_at": now,
        })
    return out_s, out_p


def upsert(url, key, table, rows, dry):
    if dry:
        print(f"  [dry run] {table}: {len(rows)} rows, e.g. {json.dumps(rows[0])[:160]}…")
        return
    headers = {"apikey": key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    if key.count(".") == 2:  # legacy service_role JWT also goes in Authorization; new sb_secret_ keys use apikey only
        headers["Authorization"] = f"Bearer {key}"
    for i in range(0, len(rows), 200):
        batch = rows[i:i + 200]
        req = urllib.request.Request(f"{url}/rest/v1/{table}?on_conflict=unitid", data=json.dumps(batch).encode(), headers=headers, method="POST")
        try:
            urllib.request.urlopen(req, timeout=60).read()
        except urllib.error.HTTPError as e:
            sys.exit(f"{table} upsert failed ({e.code}): {e.read()[:400].decode(errors='replace')}")
    print(f"  {table}: upserted {len(rows)} rows")


def main():
    load_env()
    dry = "--dry-run" in sys.argv
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not dry and (not url or not key):
        sys.exit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env (Supabase → Project Settings → API keys → secret key).")
    if key.startswith("sb_publishable") or "anon" in key[:40]:
        sys.exit("That's a publishable key. The import needs a secret key (sb_secret_…).")

    data = json.load(open(CURATED))
    schools, pro = rows_for(data["schools"], True, data["asOf"])
    pool_n = 0
    if os.path.exists(POOL):
        pool = json.load(open(POOL))
        curated_ids = {s["id"] for s in data["schools"]}
        ps, pp = rows_for([s for s in pool["schools"] if s["id"] not in curated_ids], False, pool["asOf"])
        schools += ps; pro += pp; pool_n = len(ps)
    else:
        print("No scripts/out/pool.json yet: importing curated schools only (run build_data.py --pool for hidden planets).")

    print(f"Importing {len(schools) - pool_n} curated + {pool_n} pool schools{' (dry run)' if dry else ''}")
    upsert(url, key, "schools", schools, dry)  # schools first: school_pro references it
    upsert(url, key, "school_pro", pro, dry)
    print("Done. The sky function caches schools for 10 minutes per instance.")


if __name__ == "__main__":
    main()
