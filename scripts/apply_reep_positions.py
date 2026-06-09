"""Override player roles in data/players.json with Reep's position_detail data.

Reep (https://github.com/withqwerty/reep) maintains an open football identity
register including Transfermarkt-style detailed positions for ~42.5k players.
We download people.csv, match WC26 players by (date_of_birth, last_name),
and replace the AI-generated role flags with reep-derived ones for any match.

Run after build_squads has produced data/players.json. Updates the file in place.
"""
from __future__ import annotations
import csv
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
PLAYERS_JSON = ROOT / "data" / "players.json"
PEOPLE_URL = "https://raw.githubusercontent.com/withqwerty/reep/main/data/people.csv"
PEOPLE_CSV = Path("/tmp/reep_people.csv")

POSITION_TO_ROLES: dict[str, list[str]] = {
    "Goalkeeper":          ["GK"],
    "Centre-Back":         ["CB"],
    "Left-Back":           ["FB"],
    "Right-Back":          ["FB"],
    "Defensive Midfield":  ["CM"],
    "Central Midfield":    ["CM"],
    "Attacking Midfield":  ["CM"],
    "Left Midfield":       ["WIN"],
    "Right Midfield":      ["WIN"],
    "Left Winger":         ["WIN"],
    "Right Winger":        ["WIN"],
    "Centre-Forward":      ["ST"],
    "Second Striker":      ["ST"],
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z\s'-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def last_word(s: str) -> str:
    parts = norm(s).split()
    return parts[-1] if parts else ""


def ensure_people_csv() -> None:
    if PEOPLE_CSV.exists() and PEOPLE_CSV.stat().st_size > 10_000_000:
        return
    print(f"Downloading {PEOPLE_URL}…")
    urllib.request.urlretrieve(PEOPLE_URL, PEOPLE_CSV)


def build_index() -> dict[tuple[str, str], list[dict]]:
    """(dob, last_name_norm) → list of candidate rows."""
    idx: dict[tuple[str, str], list[dict]] = defaultdict(list)
    with PEOPLE_CSV.open(encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            if row["type"] != "player": continue
            if not row["position_detail"]: continue
            dob = row["date_of_birth"]
            if not dob: continue
            # Use both `name` and `full_name` as candidate sources for last-word
            for src in (row["full_name"], row["name"]):
                lw = last_word(src)
                if lw:
                    idx[(dob, lw)].append(row)
    return idx


def map_position(pd: str) -> list[str]:
    """Reep may have a comma-separated list of detailed positions; collect roles."""
    out: list[str] = []
    seen = set()
    for piece in (pd or "").split(","):
        piece = piece.strip()
        for r in POSITION_TO_ROLES.get(piece, []):
            if r not in seen:
                seen.add(r)
                out.append(r)
    return out


def main() -> None:
    ensure_people_csv()
    print("Building DOB+lastname index from reep…")
    idx = build_index()
    print(f"  indexed {sum(len(v) for v in idx.values()):,} reep entries across {len(idx):,} buckets")

    data = json.loads(PLAYERS_JSON.read_text())
    matched = 0
    ambiguous = 0
    no_dob = 0
    no_match = 0
    total = 0

    for nation in data["nations"]:
        for p in nation["players"]:
            total += 1
            dob = p.get("dob")
            last = norm(p.get("last") or "").split()
            last_key = last[-1] if last else ""
            if not dob: no_dob += 1; continue
            if not last_key: no_match += 1; continue

            cands = idx.get((dob, last_key), [])
            # If no last-key hit, try the parsed full name's last word
            if not cands:
                cands = idx.get((dob, last_word(p.get("name") or "")), [])
            if not cands: no_match += 1; continue
            if len(cands) > 1:
                # Disambiguate by first-name first letter when available
                first_first = (norm(p.get("first") or "")[:1])
                if first_first:
                    narrowed = [c for c in cands if norm(c["name"] or c["full_name"] or "").startswith(first_first)]
                    if len(narrowed) == 1:
                        cands = narrowed
                if len(cands) > 1:
                    ambiguous += 1
                    continue
            row = cands[0]
            roles = map_position(row["position_detail"])
            if not roles: no_match += 1; continue
            p["roles"] = roles
            p["roles_source"] = "reep"
            p["reep_position"] = row["position_detail"]
            matched += 1

    print(f"\nWC26 players: {total}")
    print(f"  matched + overridden: {matched}")
    print(f"  ambiguous (multiple reep matches, kept Excel): {ambiguous}")
    print(f"  no DOB in source: {no_dob}")
    print(f"  no reep match (kept Excel): {no_match}")

    PLAYERS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"\nWrote {PLAYERS_JSON}")


if __name__ == "__main__":
    main()
