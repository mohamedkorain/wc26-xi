"""Build data/teams.json from data/players.json + a flag-emoji table.

Output:
  { "teams": [{ "name": "England", "code": "ENG", "group": "L", "flag": "🏴..." }, ...] }
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAYERS = ROOT / "data" / "players.json"
OUT = ROOT / "data" / "teams.json"

# Official WC26 draw pots (5 December 2025), per FIFA Men's World Ranking of
# 19 November 2025. Hosts (USA, MEX, CAN) forced into Pot 1 regardless of rank.
POTS: dict[str, int] = {}
_POT_LISTS = {
    1: ["United States","Mexico","Canada","Spain","Argentina","France",
        "England","Brazil","Portugal","Netherlands","Belgium","Germany"],
    2: ["Croatia","Morocco","Colombia","Uruguay","Switzerland","Japan",
        "Senegal","Iran","South Korea","Ecuador","Austria","Australia"],
    3: ["Norway","Panama","Egypt","Algeria","Scotland","Paraguay",
        "Tunisia","Ivory Coast","Uzbekistan","Qatar","Saudi Arabia","South Africa"],
    4: ["Jordan","Cape Verde","Ghana","Curaçao","Haiti","New Zealand",
        "Bosnia and Herzegovina","Czech Republic","DR Congo","Iraq","Sweden","Turkey"],
}
for _p, _names in _POT_LISTS.items():
    for _n in _names:
        POTS[_n] = _p

# Flag emoji + 3-letter FIFA code per qualified nation.
META: dict[str, tuple[str, str]] = {
    "Algeria":               ("ALG", "🇩🇿"),
    "Argentina":             ("ARG", "🇦🇷"),
    "Australia":             ("AUS", "🇦🇺"),
    "Austria":               ("AUT", "🇦🇹"),
    "Belgium":               ("BEL", "🇧🇪"),
    "Bosnia and Herzegovina":("BIH", "🇧🇦"),
    "Brazil":                ("BRA", "🇧🇷"),
    "Canada":                ("CAN", "🇨🇦"),
    "Cape Verde":            ("CPV", "🇨🇻"),
    "Colombia":              ("COL", "🇨🇴"),
    "Croatia":               ("CRO", "🇭🇷"),
    "Curaçao":               ("CUW", "🇨🇼"),
    "Czech Republic":        ("CZE", "🇨🇿"),
    "DR Congo":              ("COD", "🇨🇩"),
    "Ecuador":               ("ECU", "🇪🇨"),
    "Egypt":                 ("EGY", "🇪🇬"),
    "England":               ("ENG", "🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f"),
    "France":                ("FRA", "🇫🇷"),
    "Germany":               ("GER", "🇩🇪"),
    "Ghana":                 ("GHA", "🇬🇭"),
    "Haiti":                 ("HAI", "🇭🇹"),
    "Iran":                  ("IRN", "🇮🇷"),
    "Iraq":                  ("IRQ", "🇮🇶"),
    "Ivory Coast":           ("CIV", "🇨🇮"),
    "Japan":                 ("JPN", "🇯🇵"),
    "Jordan":                ("JOR", "🇯🇴"),
    "Mexico":                ("MEX", "🇲🇽"),
    "Morocco":               ("MAR", "🇲🇦"),
    "Netherlands":           ("NED", "🇳🇱"),
    "New Zealand":           ("NZL", "🇳🇿"),
    "Norway":                ("NOR", "🇳🇴"),
    "Panama":                ("PAN", "🇵🇦"),
    "Paraguay":              ("PAR", "🇵🇾"),
    "Portugal":              ("POR", "🇵🇹"),
    "Qatar":                 ("QAT", "🇶🇦"),
    "Saudi Arabia":          ("KSA", "🇸🇦"),
    "Scotland":              ("SCO", "🏴\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f"),
    "Senegal":               ("SEN", "🇸🇳"),
    "South Africa":          ("RSA", "🇿🇦"),
    "South Korea":           ("KOR", "🇰🇷"),
    "Spain":                 ("ESP", "🇪🇸"),
    "Sweden":                ("SWE", "🇸🇪"),
    "Switzerland":           ("SUI", "🇨🇭"),
    "Tunisia":               ("TUN", "🇹🇳"),
    "Turkey":                ("TUR", "🇹🇷"),
    "United States":         ("USA", "🇺🇸"),
    "Uruguay":               ("URU", "🇺🇾"),
    "Uzbekistan":            ("UZB", "🇺🇿"),
}


def main() -> None:
    data = json.loads(PLAYERS.read_text())
    teams = []
    missing = []
    for n in data["nations"]:
        name = n["name"]
        if name not in META:
            missing.append(name)
            continue
        code, flag = META[name]
        pot = POTS.get(name)
        if pot is None:
            print(f"!! No pot assignment for {name}")
            pot = 4
        teams.append({
            "name": name,
            "code": code,
            "group": n["group"],
            "flag": flag,
            "pot": pot,
        })
    teams.sort(key=lambda t: (t["pot"], t["name"]))
    OUT.write_text(json.dumps({"teams": teams}, ensure_ascii=False, indent=2))
    print(f"Wrote {len(teams)} teams → {OUT}")
    if missing:
        print(f"!! Missing META entries: {missing}")


if __name__ == "__main__":
    main()
