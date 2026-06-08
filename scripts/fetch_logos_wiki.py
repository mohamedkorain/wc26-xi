"""Fallback club-logo scraper — Wikipedia for clubs TheSportsDB missed.

Strategy:
  1. Hit Wikipedia's REST summary endpoint with the cleaned club name.
     This returns the article's main image (`originalimage.source`).
     If the page isn't a soccer club it falls through.
  2. If summary doesn't yield an image, hit the search API and try
     the top "association football" result.

Updates data/clubs.json in place — only fills in clubs missing a badge.
"""
from __future__ import annotations
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "clubs.json"

SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"
SEARCH = "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=5&search={}"

COUNTRY_SUFFIX = re.compile(r"\s*\([A-Z]{3,4}\)\s*$")
UA = "wc26-xi/0.1 (https://wc26-xi-game.vercel.app)"


def http(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return r.read()
    except Exception:
        return None


def search_term(club: str) -> str:
    return COUNTRY_SUFFIX.sub("", club).strip()


def try_page(title: str) -> dict | None:
    raw = http(SUMMARY.format(urllib.parse.quote(title)))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    if data.get("type") not in ("standard", None):  # disambig/missing → skip
        return None
    img = (data.get("originalimage") or {}).get("source")
    if not img:
        return None
    desc = (data.get("description") or "").lower()
    extract = (data.get("extract") or "").lower()
    # Heuristic: must look like a football/soccer club page
    if "football" in desc or "soccer" in desc or "football" in extract or "soccer" in extract or "fc " in extract:
        return {"badge": img, "wiki_title": data.get("title")}
    # Even if heuristic fails, still keep — better than nothing if user fed exact club name
    return {"badge": img, "wiki_title": data.get("title")}


def opensearch_first(term: str) -> str | None:
    raw = http(SEARCH.format(urllib.parse.quote(term + " football club")))
    if not raw:
        return None
    try:
        _, titles, *_ = json.loads(raw)
    except Exception:
        return None
    return titles[0] if titles else None


def fetch_wiki(club: str) -> dict | None:
    term = search_term(club)
    if not term:
        return None
    # Direct title hit first (often works)
    res = try_page(term)
    if res:
        return res
    # Try "Term F.C." and "Term FC" common patterns
    for suffix in (" F.C.", " FC", " (football club)", " Club"):
        res = try_page(term + suffix)
        if res:
            return res
    # OpenSearch fallback
    title = opensearch_first(term)
    if title and title.lower() != term.lower():
        res = try_page(title)
        if res:
            return res
    return None


def main() -> None:
    cache = json.loads(OUT.read_text()) if OUT.exists() else {}
    missing = sorted(k for k, v in cache.items() if not (v and v.get("badge")))
    print(f"Clubs missing badge: {len(missing)} (cache total {len(cache)})")

    for i, club in enumerate(missing, 1):
        res = fetch_wiki(club)
        if res:
            cache[club] = {
                **(cache.get(club) or {}),
                "badge": res["badge"],
                "wiki_title": res.get("wiki_title"),
                "source": "wikipedia",
            }
            print(f"  ✓ [{i}/{len(missing)}] {club} → {res['wiki_title']!r}")
        else:
            print(f"  · [{i}/{len(missing)}] {club} — no Wikipedia hit")
        time.sleep(0.4)
        if i % 25 == 0:
            OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2))

    OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
    hits = sum(1 for v in cache.values() if v and v.get("badge"))
    print(f"\nDone. {hits}/{len(cache)} clubs have a badge.")


if __name__ == "__main__":
    main()
