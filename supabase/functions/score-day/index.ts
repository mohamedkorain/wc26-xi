// HALLO AMRIKA — daily scoring job.
// Deploy with:  supabase functions deploy score-day
// Trigger via cron (see supabase/score_cron.sql) or manually:
//   curl -X POST 'https://<project>.functions.supabase.co/score-day' \
//        -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
//        -d '{"date":"2026-06-11"}'
//
// What it does for a given date:
//   1. Fetch all WC26 fixtures from API-Football for that date.
//   2. For each finished match, pull lineups + events + player stats.
//   3. Match API players to our roster (by nation + name).
//   4. For every entry on the leaderboard, score each of their 11 active
//      starters against this match's events (per rules in scoring.ts).
//   5. Upsert into `matches`, `goal_events`, `scores`.
//   6. Apply progression bonuses (R32/R16/QF/SF/Final/Champion) when a
//      nation advances.
//
// IMPORTANT: this function uses SERVICE_ROLE_KEY (Deno env), which bypasses
// RLS — only this function can write to scores/matches.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  scorePlayer,
  matchEntryPlayer,
  normaliseName,
  PROGRESSION_BONUS,
  type MatchOutcome,
  type PlayerEvent,
} from './scoring.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const API_FOOTBALL_KEY = Deno.env.get('API_FOOTBALL_KEY')!;
const API_BASE = 'https://v3.football.api-sports.io';

// API-Football competition id for FIFA World Cup. The 2026 edition's
// season/league pair will be confirmed once API token is in hand.
const WC26_LEAGUE_ID = 1;       // World Cup
const WC26_SEASON = 2026;

// Map API-Football team name → our canonical nation name in data/teams.json.
// API-Football mostly matches; this table is for the diffs.
const NATION_ALIAS: Record<string, string> = {
  'Czech Republic':   'Czech Republic',
  'Czechia':          'Czech Republic',
  'Korea Republic':   'South Korea',
  'South Korea':      'South Korea',
  'United States':    'United States',
  'USA':              'United States',
  'Ivory Coast':      'Ivory Coast',
  "Côte d'Ivoire":    'Ivory Coast',
  'Cape Verde':       'Cape Verde',
  'Cabo Verde':       'Cape Verde',
  'DR Congo':         'DR Congo',
  'Congo DR':         'DR Congo',
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function apiFetch(path: string): Promise<any> {
  const res = await fetch(API_BASE + path, {
    headers: { 'x-apisports-key': API_FOOTBALL_KEY },
  });
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadRoster(): Promise<Record<string, any[]>> {
  // The roster comes from the static data/players.json bundled with the site.
  // We mirror it here via a publicly cached fetch — or read from a copy
  // stored in Supabase Storage in production.
  const res = await fetch('https://halloamrika.saba7okorah.com/data/players.json');
  const json = await res.json();
  const byNation: Record<string, any[]> = {};
  for (const n of json.nations) byNation[n.name] = n.players;
  return byNation;
}

function canonNation(s: string): string {
  return NATION_ALIAS[s] || s;
}

async function processMatch(fixture: any, rosterByNation: Record<string, any[]>) {
  const homeNation = canonNation(fixture.teams.home.name);
  const awayNation = canonNation(fixture.teams.away.name);
  const matchId = String(fixture.fixture.id);
  const dateStr = fixture.fixture.date.slice(0, 10);
  const status = fixture.fixture.status.short;
  const homeGoals = fixture.goals.home ?? 0;
  const awayGoals = fixture.goals.away ?? 0;

  // Upsert matches row
  await supa.from('matches').upsert({
    external_id: matchId,
    date: dateStr,
    home: homeNation,
    away: awayNation,
    home_goals: homeGoals,
    away_goals: awayGoals,
    status: (status === 'FT' || status === 'AET' || status === 'PEN') ? 'finished' : 'live',
  }, { onConflict: 'external_id' });

  if (status !== 'FT' && status !== 'AET' && status !== 'PEN') return;   // only score finished

  // Fetch detailed events + player stats
  const [eventsRes, playersRes] = await Promise.all([
    apiFetch(`/fixtures/events?fixture=${matchId}`),
    apiFetch(`/fixtures/players?fixture=${matchId}`),
  ]);

  // Build per-player event objects from API-Football's response
  const rawEvents = buildPlayerEvents(playersRes.response, eventsRes.response, homeNation, awayNation, homeGoals, awayGoals);
  const playerEvents = enrichEvents(rawEvents);   // pre-normalize once

  // For each entry whose XI includes this nation's players, compute scores.
  // PRE-FILTER via JSONB containment: only fetch entries that actually have a
  // player from one of the two playing nations. Cuts 61k → ~23k for a typical match.
  //
  // GW-SNAPSHOT: matches before the MD2 first kickoff (2026-06-18) must score
  // against xi_json_gw1 if it's populated (= the user transferred for GW2 and
  // their pre-transfer GW1 lineup is preserved there). Later matches use
  // the current xi_json. This keeps transferred-in players from
  // retroactively earning GW1 points.
  const MD2_FIRST_KICKOFF = '2026-06-18';
  const useGw1Snapshot = dateStr < MD2_FIRST_KICKOFF;
  // For GW1 matches we also match against xi_json_gw1, so a user who
  // transferred OUT a playing nation still gets that player scored.
  const filters = [
    `xi_json.cs.[{"nation":"${homeNation}"}]`,
    `xi_json.cs.[{"nation":"${awayNation}"}]`,
  ];
  if (useGw1Snapshot) {
    filters.push(`xi_json_gw1.cs.[{"nation":"${homeNation}"}]`);
    filters.push(`xi_json_gw1.cs.[{"nation":"${awayNation}"}]`);
  }
  const orFilter = filters.join(',');
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data: batch } = await supa
      .from('entries')
      .select('id, user_id, league_id, xi_json, xi_json_gw1, submitted_at')
      .or(orFilter)
      .range(offset, offset + PAGE - 1);
    if (!batch || batch.length === 0) break;

    const matchKickoff = new Date(fixture.fixture.date);
    const scoresToUpsert: any[] = [];
    for (const entry of batch) {
      // Late-signup gate: an entry submitted AFTER this match kicked off
      // didn't exist as a squad when the match happened — they should not
      // earn retroactive points. This is the only safeguard for users who
      // join during the transfer window for MD1 matches.
      if (entry.submitted_at && new Date(entry.submitted_at) > matchKickoff) continue;

      // GW1 matches: prefer the snapshot if present (= user transferred).
      // Otherwise use xi_json (unchanged for non-transferred users).
      const effectiveXi = useGw1Snapshot
        ? (entry.xi_json_gw1 || entry.xi_json || [])
        : (entry.xi_json || []);
      const starters = effectiveXi.filter((x: any) => !x.wild);
      let totalPts = 0;
      const breakdownByPlayer: Record<string, any> = {};
      for (const slot of starters) {
        if (slot.nation !== homeNation && slot.nation !== awayNation) continue;
        const ev = matchPlayerToEvent(slot, playerEvents);
        if (!ev) continue;
        const { points, breakdown } = scorePlayer(
          ev,
          slot.roles || [slot.role],
          homeNation,
          homeGoals,
          awayGoals,
        );
        totalPts += points;
        breakdownByPlayer[slot.name] = breakdown;
      }
      if (totalPts === 0) continue;
      scoresToUpsert.push({
        entry_id: entry.id,
        match_date: dateStr,
        points: totalPts,
        breakdown: breakdownByPlayer,
      });
    }

    if (scoresToUpsert.length > 0) {
      await supa.from('scores').upsert(scoresToUpsert, { onConflict: 'entry_id,match_date' });
    }

    if (batch.length < PAGE) break;
    offset += PAGE;
  }
}

function buildPlayerEvents(playersResponse: any[], eventsResponse: any[], homeNation: string, awayNation: string, homeGoals: number, awayGoals: number): PlayerEvent[] {
  // MVP is ONE player per match: highest rating on the winning team.
  // If the match is a draw, MVP goes to the highest-rated player overall.
  const winnerSide: 'home' | 'away' | 'draw' =
    homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';
  let mvpId = -1;
  let mvpRating = 0;
  for (const teamBlock of playersResponse || []) {
    const side: 'home' | 'away' = canonNation(teamBlock.team.name) === homeNation ? 'home' : 'away';
    if (winnerSide !== 'draw' && side !== winnerSide) continue;   // skip the loser
    for (const p of teamBlock.players || []) {
      const r = parseFloat(p.statistics?.[0]?.games?.rating || '0') || 0;
      if (r > mvpRating) { mvpRating = r; mvpId = p.player.id; }
    }
  }

  const evs: PlayerEvent[] = [];
  for (const teamBlock of playersResponse || []) {
    const side: 'home' | 'away' = canonNation(teamBlock.team.name) === homeNation ? 'home' : 'away';
    for (const p of teamBlock.players || []) {
      const st = p.statistics?.[0]; if (!st) continue;
      evs.push({
        player_id: p.player.id,
        player_name: p.player.name,
        team: side,
        minutes: st.games?.minutes || 0,
        is_starter: st.games?.substitute === false,
        goals: st.goals?.total || 0,
        assists: st.goals?.assists || 0,
        red_card: (st.cards?.red || 0) > 0,
        mvp: p.player.id === mvpId,
      });
    }
  }
  return evs;
}

// One enriched event per API player — normalize NAME tokens ONCE here so
// the per-pick matcher runs in O(events) instead of re-normalizing inside
// every inner loop. 23k entries × 11 picks × thousands of token ops was
// blowing the function's CPU budget.
type EnrichedEvent = PlayerEvent & { _tokens: string[]; _tokenSet: Set<string>; _normalized: string };
function enrichEvents(evs: PlayerEvent[]): EnrichedEvent[] {
  return evs.map(ev => {
    const n = normaliseName(ev.player_name);
    const toks = n.split(' ');
    return { ...ev, _tokens: toks, _tokenSet: new Set(toks), _normalized: n };
  });
}

function matchPlayerToEvent(slot: any, enriched: EnrichedEvent[]): PlayerEvent | null {
  // Our roster format: "LASTNAME Firstname(s)" (family first).
  // API format: "Firstname(s) Lastname".
  // Surname alone is NOT enough — Korea has multiple HWANGs. Require
  // family + at least one given name. Fall back to lone surname only when
  // no teammate shares it.
  const target = normaliseName(slot.name);
  const targetTokens = target.split(' ');
  const ourFamily = targetTokens[0] || '';
  const ourGivens = targetTokens.slice(1);

  // Pass 1: exact normalized full-name match.
  for (const ev of enriched) {
    if (ev._normalized === target) return ev;
  }
  // Pass 2: family AND ≥1 given-name match. Handle hyphenated forms.
  for (const ev of enriched) {
    if (!ourFamily || !ev._tokenSet.has(ourFamily)) continue;
    if (ourGivens.some(g => ev._tokenSet.has(g))) return ev;
    if (ourGivens.some(g => ev._tokens.some(et => et.startsWith(g) || g.startsWith(et)))) return ev;
  }
  // Pass 3: lone surname (only when no one else in the match shares it).
  let familyCount = 0;
  for (const ev of enriched) if (ev._tokenSet.has(ourFamily)) familyCount++;
  if (familyCount === 1) {
    for (const ev of enriched) if (ev._tokenSet.has(ourFamily)) return ev;
  }
  return null;
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const { date } = await req.json().catch(() => ({}));
    const dateStr = date || new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fixtures = await apiFetch(`/fixtures?league=${WC26_LEAGUE_ID}&season=${WC26_SEASON}&date=${dateStr}`);
    const roster = await loadRoster();

    const results: any[] = [];
    for (const f of fixtures.response || []) {
      try {
        await processMatch(f, roster);
        results.push({ fixture: f.fixture.id, status: 'ok' });
      } catch (e) {
        results.push({ fixture: f.fixture.id, status: 'error', error: String(e) });
      }
    }

    // Refresh derived caches: per-player leaderboard view + per-entry rank
    // snapshot (used by the homepage leaderboard's ↑/↓ arrows). Both RPCs
    // are SECURITY DEFINER and locked down to service-role callers.
    let refreshed = false;
    try {
      await supa.rpc('refresh_player_leaderboard');
      refreshed = true;
    } catch (e) {
      // Non-fatal — the next scoring run will refresh.
    }
    try {
      await supa.rpc('refresh_entry_ranks');
    } catch (e) {
      // Non-fatal.
    }

    return new Response(JSON.stringify({ date: dateStr, processed: results.length, results, refreshed }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
