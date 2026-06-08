"""Resolve a logo URL for every unique club in data/players.json.

Strategy: TheSportsDB free search API (key "123"). Strip the "(XXX)"
country suffix that the WC dataset adds before searching. Cache results
to data/clubs.json. Run once; re-runs only fetch missing clubs.

Output shape:
  { "Real Madrid (ESP)": { "name": "Real Madrid", "badge": "https://..." }, ... }
"""
from __future__ import annotations
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAYERS = ROOT / "data" / "players.json"
OUT = ROOT / "data" / "clubs.json"

API = "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t={}"
COUNTRY_SUFFIX = re.compile(r"\s*\([A-Z]{3,4}\)\s*$")


def search_term(club: str) -> str:
    return COUNTRY_SUFFIX.sub("", club).strip()


def fetch(name: str) -> dict | None:
    url = API.format(urllib.parse.quote(name))
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}
    teams = data.get("teams") or []
    if not teams:
        return None
    # Prefer soccer/football teams
    soccer = [t for t in teams if (t.get("strSport") or "").lower() in ("soccer", "football")]
    pool = soccer or teams
    best = pool[0]
    return {
        "name": best.get("strTeam"),
        "badge": best.get("strTeamBadge") or best.get("strBadge"),
        "country": best.get("strCountry"),
    }


def main() -> None:
    data = json.loads(PLAYERS.read_text())
    clubs: set[str] = set()
    for n in data["nations"]:
        for p in n["players"]:
            if p.get("club"):
                clubs.add(p["club"])

    cache: dict = {}
    if OUT.exists():
        cache = json.loads(OUT.read_text())
    print(f"Total clubs: {len(clubs)}; already cached: {len(cache)}")

    pending = sorted(c for c in clubs if c not in cache)
    print(f"Fetching {len(pending)} new clubs…")

    for i, club in enumerate(pending, 1):
        term = search_term(club)
        res = fetch(term)
        cache[club] = res or {"name": None, "badge": None, "country": None}
        ok = res and res.get("badge")
        marker = "✓" if ok else ("·" if res is None else "x")
        print(f"  {marker} [{i:>3}/{len(pending)}] {club!r} → {term!r} {res.get('badge','') if res else ''}")
        # Throttle to be polite (free key)
        time.sleep(0.6)
        # Periodic save
        if i % 25 == 0:
            OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2))

    OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
    hits = sum(1 for v in cache.values() if v and v.get("badge"))
    print(f"\nDone. {hits}/{len(cache)} clubs have a badge.")


if __name__ == "__main__":
    main()
