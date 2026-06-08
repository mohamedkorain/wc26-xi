# WC26 XI

Spin a 2026 World Cup nation, draft a player, build your starting XI. Optional leagues with friends.

## Stack

- **Frontend:** static HTML/CSS/JS (no build). ES modules.
- **Auth + DB:** Supabase (free tier).
- **Host:** Vercel (static).
- **Data:** Wikipedia 2026 WC squads (scraped), FIFA WC26 draw pots.

## Local dev

```
python3 -m http.server 8765
open http://localhost:8765/
```

## Deploy

1. Run `supabase/schema.sql` once in your Supabase project (SQL Editor).
2. In Supabase → Authentication → URL Configuration, add your Vercel URL + `http://localhost:8765` to "Redirect URLs", and set "Site URL".
3. Push to GitHub; Vercel auto-deploys.

## Pages

- `/` — game (drafts the XI)
- `/login.html` — magic-link sign in
- `/leagues.html` — list/create/join leagues
- `/league.html?code=WC26-XXXXX` — single league: invite link, my entry, leaderboard

## Data refresh

```
python3 scripts/scrape_squads.py
python3 scripts/build_teams.py
```
