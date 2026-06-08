"""Parse Wikipedia's 2026 FIFA World Cup squads page into data/players.json.

Source HTML: scripts/raw_squads.html (fetched via curl).
Output:      data/players.json
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup, Tag

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = HERE / "raw_squads.html"
OUT = ROOT / "data" / "players.json"

CAPTAIN_RE = re.compile(r"\(\s*captain\s*\)", re.IGNORECASE)
PAREN_DATE_RE = re.compile(r"\(\d{4}-\d{2}-\d{2}\)")
POS_PREFIX_RE = re.compile(r"^\d+")


def clean_player_cell(td: Tag) -> tuple[str, bool]:
    text = td.get_text(" ", strip=True)
    captain = bool(CAPTAIN_RE.search(text))
    text = CAPTAIN_RE.sub("", text).strip()
    return text, captain


def clean_dob_cell(td: Tag) -> str:
    text = td.get_text(" ", strip=True)
    text = PAREN_DATE_RE.sub("", text).strip()
    return text


def safe_int(s: str) -> int:
    s = (s or "").replace(",", "").strip()
    try:
        return int(s)
    except ValueError:
        return 0


def parse_squad_table(table: Tag) -> list[dict]:
    players: list[dict] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 7:
            continue
        if cells[0].name == "th":
            continue
        no_raw = cells[0].get_text(strip=True)
        if not no_raw.isdigit():
            continue
        pos = POS_PREFIX_RE.sub("", cells[1].get_text(strip=True))
        name, is_captain = clean_player_cell(cells[2])
        dob = clean_dob_cell(cells[3])
        caps = safe_int(cells[4].get_text(strip=True))
        goals = safe_int(cells[5].get_text(strip=True))
        club = cells[6].get_text(" ", strip=True)
        players.append({
            "no": int(no_raw),
            "pos": pos,
            "name": name,
            "captain": is_captain,
            "dob": dob,
            "caps": caps,
            "goals": goals,
            "club": club,
        })
    return players


def main() -> None:
    soup = BeautifulSoup(SRC.read_text(), "html.parser")
    nations: list[dict] = []
    current_group: str | None = None

    for tag in soup.find_all(["h2", "h3"]):
        title = (tag.find(class_="mw-headline") or tag).get_text(strip=True)
        if not title:
            continue
        if tag.name == "h2":
            m = re.match(r"Group ([A-L])$", title)
            current_group = m.group(1) if m else None
            continue
        if not current_group:
            continue

        table = tag.find_next("table", class_="wikitable")
        if table is None:
            continue
        players = parse_squad_table(table)
        if not players:
            continue
        nations.append({
            "name": title,
            "group": current_group,
            "players": players,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"nations": nations}, ensure_ascii=False, indent=2))
    print(f"Wrote {len(nations)} nations, "
          f"{sum(len(n['players']) for n in nations)} players → {OUT}")
    by_group: dict[str, list[str]] = {}
    for n in nations:
        by_group.setdefault(n["group"], []).append(n["name"])
    for g in sorted(by_group):
        print(f"  Group {g}: {', '.join(by_group[g])}")


if __name__ == "__main__":
    main()
