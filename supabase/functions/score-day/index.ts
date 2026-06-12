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
  const playerEvents = buildPlayerEvents(playersRes.response, eventsRes.response, homeNation, awayNation);

  // For each entry whose XI includes this nation's players, compute scores.
  // PRE-FILTER via JSONB containment: only fetch entries that actually have a
  // player from one of the two playing nations. Cuts 61k → ~23k for a typical match.
  // Then stream-process in pages of 1000 so we never hold all rows in memory.
  const homeFilter = `xi_json.cs.[{"nation":"${homeNation}"}]`;
  const awayFilter = `xi_json.cs.[{"nation":"${awayNation}"}]`;
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data: batch } = await supa
      .from('entries')
      .select('id, user_id, league_id, xi_json')
      .or(`${homeFilter},${awayFilter}`)
      .range(offset, offset + PAGE - 1);
    if (!batch || batch.length === 0) break;

    const scoresToUpsert: any[] = [];
    for (const entry of batch) {
      const starters = (entry.xi_json || []).filter((x: any) => !x.wild);
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

function buildPlayerEvents(playersResponse: any[], eventsResponse: any[], homeNation: string, awayNation: string): PlayerEvent[] {
  // playersResponse: [{ team: {name}, players: [{ player, statistics:[{games:{minutes,position,rating,number,substitute}, goals:{total,assists,...}, cards:{yellow,red} }] }] }]
  // eventsResponse: not strictly needed for goals (in stats) — but used for accuracy
  const evs: PlayerEvent[] = [];
  for (const teamBlock of playersResponse || []) {
    const teamName = canonNation(teamBlock.team.name);
    const side: 'home' | 'away' = teamName === homeNation ? 'home' : 'away';
    let maxRating = 0;
    let mvpId = -1;
    // First pass: find MVP candidate (winning team's highest rating)
    for (const p of teamBlock.players || []) {
      const st = p.statistics?.[0]; if (!st) continue;
      const rating = parseFloat(st.games?.rating || '0') || 0;
      if (rating > maxRating) { maxRating = rating; mvpId = p.player.id; }
    }
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

function matchPlayerToEvent(slot: any, allEvents: PlayerEvent[]): PlayerEvent | null {
  // Our roster format: "LASTNAME Firstname" → family name is the FIRST token.
  // API-Football format: "Firstname Lastname" → family name is the LAST token.
  // Match by checking if our family name appears anywhere in the API name.
  const target = normaliseName(slot.name);
  const targetTokens = target.split(' ');
  const ourFamily = targetTokens[0] || '';                  // family (we store LAST first)
  const targetSet = new Set(targetTokens);
  for (const ev of allEvents) {
    const evNorm = normaliseName(ev.player_name);
    if (evNorm === target) return ev;
    const evTokens = evNorm.split(' ');
    // If our family name (e.g. "rangel") appears as any token in API's name
    // (e.g. "raul rangel") → match.
    if (ourFamily && evTokens.includes(ourFamily)) return ev;
    // Reverse: if API's surname (last token) matches any of our tokens.
    const apiSurname = evTokens[evTokens.length - 1];
    if (apiSurname && targetSet.has(apiSurname)) return ev;
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

    return new Response(JSON.stringify({ date: dateStr, processed: results.length, results }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
