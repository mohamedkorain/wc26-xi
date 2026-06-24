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
const SUPABASE_SECRET_KEYS = parseSecretValues(Deno.env.get('SUPABASE_SECRET_KEYS'));
const SCORE_DAY_CRON_SECRET = Deno.env.get('SCORE_DAY_CRON_SECRET') || '';
const API_FOOTBALL_KEY = Deno.env.get('API_FOOTBALL_KEY')!;
const API_BASE = 'https://v3.football.api-sports.io';

// API-Football competition id for FIFA World Cup. The 2026 edition's
// season/league pair will be confirmed once API token is in hand.
const WC26_LEAGUE_ID = 1;       // World Cup
const WC26_SEASON = 2026;

// Manual match-level rulings. By default MVP is API-Football's highest-rated
// player on the winning team; these entries preserve explicit production
// overrides when a match is re-scored.
const MANUAL_MVP_OVERRIDES: Record<string, string[]> = {
  '1489373': ['abunada'],      // 2026-06-13 Qatar-Switzerland
  '1489374': ['kai', 'havertz'], // 2026-06-14 Germany-Curacao
  '1489385': ['semenyo'],      // 2026-06-17 Ghana-Panama
  '1489389': ['vinicius', 'junior'], // 2026-06-20 Brazil-Haiti
  '1539006': ['matias', 'galarza'], // 2026-06-20 Turkey-Paraguay
  '1489400': ['maza'],         // 2026-06-23 Jordan-Algeria
};

// Manual player stat corrections for cases where API-Football's player feed
// misses a player entirely or cannot be matched to our roster.
const MANUAL_PLAYER_SCORE_OVERRIDES: Record<string, Record<string, Record<string, number>>> = {
  '1539001': {
    'ONEILL Aiden': { win: 1, full90: 1, cleanSheet: 1 }, // 2026-06-14 Australia-Turkiye
  },
  '1489390': {
    'BOUNOU Yassine': { win: 1, full90: 1, cleanSheet: 1 }, // 2026-06-19 Scotland-Morocco
  },
};

// Map API-Football team name → our canonical nation name in data/teams.json.
// API-Football mostly matches; this table is for the diffs.
const NATION_ALIAS: Record<string, string> = {
  'Czech Republic':              'Czech Republic',
  'Czechia':                     'Czech Republic',
  'Korea Republic':              'South Korea',
  'South Korea':                 'South Korea',
  'United States':               'United States',
  'USA':                         'United States',
  'Ivory Coast':                 'Ivory Coast',
  "Côte d'Ivoire":               'Ivory Coast',
  'Cape Verde':                  'Cape Verde',
  'Cape Verde Islands':          'Cape Verde',
  'Cabo Verde':                  'Cape Verde',
  'DR Congo':                    'DR Congo',
  'Congo DR':                    'DR Congo',
  'Bosnia and Herzegovina':      'Bosnia and Herzegovina',
  'Bosnia & Herzegovina':        'Bosnia and Herzegovina',
  'Türkiye':                     'Turkey',
  'Turkey':                      'Turkey',
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function parseSecretValues(raw: string | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const values: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === 'string') values.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(parsed);
    return values;
  } catch (_) {
    return [raw];
  }
}

function isAuthorizedByEnv(req: Request): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const accepted = new Set(
    [SERVICE_ROLE_KEY, SCORE_DAY_CRON_SECRET, ...SUPABASE_SECRET_KEYS]
      .filter(Boolean)
      .map((key) => `Bearer ${key}`)
  );
  return accepted.has(authHeader);
}

async function isAuthorizedCronRequest(req: Request): Promise<boolean> {
  if (isAuthorizedByEnv(req)) return true;

  const authHeader = req.headers.get('authorization') || '';
  try {
    const { data, error } = await supa.rpc('is_score_day_cron_authorized', {
      auth_header: authHeader,
    });
    if (error) console.error('is_score_day_cron_authorized failed:', error);
    return data === true;
  } catch (e) {
    console.error('is_score_day_cron_authorized threw:', e);
    return false;
  }
}

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

function isFinishedStatus(status: string): boolean {
  return status === 'FT' || status === 'AET' || status === 'PEN';
}

function pointsFromManualBreakdown(breakdown: Record<string, number>): number {
  return (breakdown.win || 0)
    + (breakdown.full90 || 0)
    + (breakdown.goals || 0)
    + (breakdown.assists || 0)
    + (breakdown.cleanSheet || 0)
    + (breakdown.mvp || 0)
    + (breakdown.red || 0);
}

function fixtureId(fixture: any): string {
  return String(fixture.fixture.id);
}

async function deleteScoreRows(dateStr: string, entryIds: string[]) {
  const CHUNK = 100;
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const ids = entryIds.slice(i, i + CHUNK);
    const { error } = await supa
      .from('scores')
      .delete()
      .eq('match_date', dateStr)
      .in('entry_id', ids);
    if (error) console.error('scores stale-zero cleanup failed:', error);
  }
}

function fixtureStatusBucket(status: string): 'finished' | 'live' | 'scheduled' {
  // Map API-Football's per-state codes to 3 clean buckets.
  //   FT/AET/PEN          -> finished
  //   1H/HT/2H/ET/BT/P    -> live (actually in progress)
  //   NS/TBD/PST/SUSP/INT -> scheduled (not started yet)
  if (isFinishedStatus(status)) return 'finished';
  if (['1H','HT','2H','ET','BT','P','LIVE'].includes(status)) return 'live';
  return 'scheduled';
}

async function refreshFixtureSummary(fixture: any): Promise<any> {
  const homeNation = canonNation(fixture.teams.home.name);
  const awayNation = canonNation(fixture.teams.away.name);
  const matchId = fixtureId(fixture);
  const dateStr = fixture.fixture.date.slice(0, 10);
  const status = fixture.fixture.status.short;
  const homeGoals = fixture.goals.home ?? 0;
  const awayGoals = fixture.goals.away ?? 0;
  const kickoff = new Date(fixture.fixture.date);
  const bucket = fixtureStatusBucket(status);

  await supa.from('matches').upsert({
    external_id: matchId, date: dateStr,
    home: homeNation, away: awayNation,
    home_goals: homeGoals, away_goals: awayGoals,
    status: bucket,
  }, { onConflict: 'external_id' });

  return { matchId, homeNation, awayNation, homeGoals, awayGoals, kickoff, bucket };
}

// Per-fixture preparation: upsert matches row, fetch API stats, return
// the enriched event list. Returns null if the match is not yet finished
// (so we don't score in-progress matches).
async function prepareFixture(fixture: any): Promise<any> {
  const summary = await refreshFixtureSummary(fixture);
  const { matchId, homeNation, awayNation, homeGoals, awayGoals, kickoff, bucket } = summary;

  if (bucket !== 'finished') return null;

  const [eventsRes, playersRes] = await Promise.all([
    apiFetch(`/fixtures/events?fixture=${matchId}`),
    apiFetch(`/fixtures/players?fixture=${matchId}`),
  ]);
  const rawEvents = buildPlayerEvents(playersRes.response, eventsRes.response, homeNation, awayNation, homeGoals, awayGoals, matchId);
  return {
    matchId, homeNation, awayNation, homeGoals, awayGoals, kickoff,
    events: enrichEvents(rawEvents),
  };
}

// Per-date scoring: score each entry against ALL of the day's fixtures in
// ONE pass, then write a single merged breakdown per entry. The previous
// per-fixture loop was overwriting earlier matches' contributions (e.g. an
// entry with USA + Qatar picks on 2026-06-13 lost the USA breakdown when
// Qatar-Switzerland processed second).
async function processDate(dateStr: string, prepared: any[]): Promise<boolean> {
  // Returns true if all entries for the date were processed; false if we
  // bailed out early on the time budget (caller will not stamp scored_at).
  if (prepared.length === 0) return true;
  const start = Date.now();
  const TIME_BUDGET_MS = 45_000;    // return before Supabase's worker compute cap

  // GW-SNAPSHOT: choose the scoring squad per fixture kickoff, not per
  // calendar date. 2026-06-18 contains both Colombia-Uzbekistan before the
  // MD2 deadline and MD2 fixtures after it. During the MD3 transfer window,
  // current xi_json becomes the editable MD3 squad, while xi_json_gw2 remains
  // the scoring squad for every MD2 fixture.
  const MD1_LOCK = new Date('2026-06-11T19:00:00.000Z');
  const MD2_FIRST_KICKOFF = new Date('2026-06-18T16:00:00.000Z');
  const MD3_FIRST_KICKOFF = new Date('2026-06-24T19:00:00.000Z');

  // Collect playing nations once
  const playingNations = new Set<string>();
  for (const m of prepared) { playingNations.add(m.homeNation); playingNations.add(m.awayNation); }
  const nationsArr = [...playingNations];

  const PAGE = 300;
  // Resume from where the last run left off (timeout-safe).
  const { data: progressRow } = await supa
    .from('scoring_progress').select('offset_').eq('match_date', dateStr).maybeSingle();
  let offset = progressRow?.offset_ || 0;
  while (true) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      await supa.from('scoring_progress')
        .upsert({ match_date: dateStr, offset_: offset, updated_at: new Date().toISOString() },
                { onConflict: 'match_date' });
      return false;
    }
    // Fetch entries via SECURITY DEFINER RPC — avoids the giant URL-OR
    // PostgREST was 400'ing on (which silently dropped everything).
    const { data: batch, error: batchErr } = await supa
      .rpc('entries_for_nations', { p_nations: nationsArr })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (batchErr) {
      console.error('entries_for_nations RPC failed:', batchErr);
      await supa.from('scoring_progress')
        .upsert({ match_date: dateStr, offset_: offset, updated_at: new Date().toISOString() },
                { onConflict: 'match_date' });
      return false;
    }
    if (!batch || batch.length === 0) break;

    const scoresToUpsert: any[] = [];
    const staleZeroScoreIds: string[] = [];
    for (const entry of batch) {
      const gw1Xi = entry.xi_json_gw1
        || ((entry.transfers_used || 0) === 0 ? entry.xi_json : []);
      const gw1Starters = (gw1Xi || []).filter((x: any) => !x.wild);
      const gw2Starters = (entry.xi_json_gw2 || []).filter((x: any) => !x.wild);
      const currentStarters = (entry.xi_json || []).filter((x: any) => !x.wild);
      const submittedAt = entry.submitted_at ? new Date(entry.submitted_at) : null;

      const breakdown: Record<string, any> = {};
      let totalPts = 0;

      for (const m of prepared) {
        // Late-signup gate by round deadline, not individual team kickoff.
        // MD1 teams must have existed at the tournament lock; late joiners
        // score from the next unlocked round, not from unplayed MD1 teams.
        const scoringCutoff = m.kickoff < MD2_FIRST_KICKOFF
          ? MD1_LOCK
          : m.kickoff < MD3_FIRST_KICKOFF
            ? MD2_FIRST_KICKOFF
            : MD3_FIRST_KICKOFF;
        if (submittedAt && submittedAt > scoringCutoff) continue;

        const starters = m.kickoff < MD2_FIRST_KICKOFF
          ? gw1Starters
          : m.kickoff < MD3_FIRST_KICKOFF
            ? gw2Starters
            : currentStarters;
        for (const slot of starters) {
          if (slot.nation !== m.homeNation && slot.nation !== m.awayNation) continue;
          const manualBreakdown = MANUAL_PLAYER_SCORE_OVERRIDES[m.matchId]?.[slot.name];
          if (manualBreakdown) {
            totalPts += pointsFromManualBreakdown(manualBreakdown);
            breakdown[slot.name] = { ...(breakdown[slot.name] || {}), ...manualBreakdown };
            continue;
          }
          const expectedSide = slot.nation === m.homeNation ? 'home' : 'away';
          const ev = matchPlayerToEvent(slot, m.events, expectedSide);
          if (!ev) continue;
          const { points, breakdown: b } = scorePlayer(
            ev, slot.role ? [slot.role] : [], m.homeNation, m.homeGoals, m.awayGoals,
          );
          totalPts += points;
          // If somehow the same player shows in two fixtures the same day
          // (impossible in WC group stage, but safe), keep the LAST one.
          breakdown[slot.name] = b;
        }
      }

      const hasBreakdown = Object.values(breakdown).some((b: any) => b && Object.keys(b).length > 0);
      if (totalPts === 0 && !hasBreakdown) {
        staleZeroScoreIds.push(entry.id);
        continue;
      }
      scoresToUpsert.push({
        entry_id: entry.id, match_date: dateStr,
        points: totalPts, breakdown,
      });
    }
    if (staleZeroScoreIds.length > 0) {
      await deleteScoreRows(dateStr, staleZeroScoreIds);
    }
    if (scoresToUpsert.length > 0) {
      const { error: upsertErr } = await supa
        .from('scores')
        .upsert(scoresToUpsert, { onConflict: 'entry_id,match_date' });
      if (upsertErr) {
        console.error('scores upsert failed:', upsertErr);
        await supa.from('scoring_progress')
          .upsert({ match_date: dateStr, offset_: offset, updated_at: new Date().toISOString() },
                  { onConflict: 'match_date' });
        return false;
      }
    }
    if (batch.length < PAGE) break;
    offset += batch.length;
    await supa.from('scoring_progress')
      .upsert({ match_date: dateStr, offset_: offset, updated_at: new Date().toISOString() },
              { onConflict: 'match_date' });
  }
  // Completed all entries for the date — reset the progress cursor.
  await supa.from('scoring_progress')
    .upsert({ match_date: dateStr, offset_: 0, updated_at: new Date().toISOString() },
            { onConflict: 'match_date' });
  return true;
}

function buildPlayerEvents(
  playersResponse: any[],
  eventsResponse: any[],
  homeNation: string,
  awayNation: string,
  homeGoals: number,
  awayGoals: number,
  matchId: string,
): PlayerEvent[] {
  // MVP is ONE player per match: highest rating on the winning team.
  // If the match is a draw, MVP goes to the highest-rated player overall.
  // Manual overrides take precedence.
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
  const overrideTokens = MANUAL_MVP_OVERRIDES[matchId];
  if (overrideTokens) {
    for (const teamBlock of playersResponse || []) {
      const side: 'home' | 'away' = canonNation(teamBlock.team.name) === homeNation ? 'home' : 'away';
      if (winnerSide !== 'draw' && side !== winnerSide) continue;
      for (const p of teamBlock.players || []) {
        const tokens = new Set(normaliseName(p.player.name).split(' '));
        if (overrideTokens.every(tok => tokens.has(tok))) {
          mvpId = p.player.id;
          break;
        }
      }
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

function matchPlayerToEvent(
  slot: any,
  enriched: EnrichedEvent[],
  expectedSide?: 'home' | 'away',
): PlayerEvent | null {
  // Our roster format: "LASTNAME Firstname(s)" (family first).
  // API format: "Firstname(s) Lastname".
  // Surname alone is NOT enough — Korea has multiple HWANGs. Require
  // family + at least one given name. Fall back to lone surname only when
  // no teammate shares it.
  const target = normaliseName(slot.name);
  const targetTokens = target.split(' ');
  const ourFamily = targetTokens[0] || '';
  const ourGivens = targetTokens.slice(1);
  const candidates = expectedSide ? enriched.filter(ev => ev.team === expectedSide) : enriched;

  // Pass 1: exact normalized full-name match.
  for (const ev of candidates) {
    if (ev._normalized === target) return ev;
  }
  // Pass 2: family AND ≥1 given-name match. Handle hyphenated forms.
  for (const ev of candidates) {
    if (!ourFamily || !ev._tokenSet.has(ourFamily)) continue;
    if (ourGivens.some(g => ev._tokenSet.has(g))) return ev;
    if (ourGivens.some(g => ev._tokens.some(et => et.startsWith(g) || g.startsWith(et)))) return ev;
  }
  // Pass 3: lone surname (only when no one else in the match shares it).
  let familyCount = 0;
  for (const ev of candidates) if (ev._tokenSet.has(ourFamily)) familyCount++;
  if (familyCount === 1) {
    for (const ev of candidates) if (ev._tokenSet.has(ourFamily)) return ev;
  }
  return null;
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // Require a server-side bearer. Without this check, anyone on the internet
    // can POST and burn through API-Football quota / spike DB CPU. Accept both
    // legacy service_role and newer Supabase secret keys because projects may
    // expose only one of them in editable Dashboard surfaces.
    if (!(await isAuthorizedCronRequest(req))) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });
    }

    const { date, liveOnly } = await req.json().catch(() => ({}));
    const dateStr = date || new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fixtures = await apiFetch(`/fixtures?league=${WC26_LEAGUE_ID}&season=${WC26_SEASON}&date=${dateStr}`);
    const fixtureRows = fixtures.response || [];

    if (liveOnly) {
      const results: any[] = [];
      for (const f of fixtureRows) {
        try {
          const data = await refreshFixtureSummary(f);
          results.push({
            fixture: f.fixture.id,
            status: data.bucket,
            home_goals: data.homeGoals,
            away_goals: data.awayGoals,
          });
        } catch (e) {
          results.push({ fixture: f.fixture.id, status: 'error', error: String(e) });
        }
      }
      return new Response(JSON.stringify({
        date: dateStr,
        liveOnly: true,
        processed: results.length,
        results,
        scored: false,
        refreshed: false,
        playerLeaderboardRefreshed: false,
        entryLeaderboardRefreshed: false,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const finishedIds = fixtureRows
      .filter((f: any) => isFinishedStatus(f.fixture.status.short))
      .map(fixtureId);

    const scoredAt: Record<string, string | null> = {};
    if (finishedIds.length > 0) {
      const { data: existing } = await supa
        .from('matches')
        .select('external_id, scored_at')
        .in('external_id', finishedIds);
      for (const m of existing || []) scoredAt[m.external_id] = m.scored_at;
    }
    const allFinishedAlreadyScored = finishedIds.length > 0
      && finishedIds.every(id => Boolean(scoredAt[id]));

    // Phase 1 — prepare each fixture (upsert matches row, fetch events)
    const prepared: any[] = [];
    const results: any[] = [];
    for (const f of fixtureRows) {
      try {
        if (allFinishedAlreadyScored && isFinishedStatus(f.fixture.status.short)) {
          results.push({ fixture: f.fixture.id, status: 'already_scored' });
          continue;
        }
        const data = await prepareFixture(f);
        if (data) prepared.push(data);
        results.push({ fixture: f.fixture.id, status: data ? 'ok' : 'pending' });
      } catch (e) {
        results.push({ fixture: f.fixture.id, status: 'error', error: String(e) });
      }
    }

    // Phase 2 — score every entry across all FT fixtures of this date.
    // Short-circuit if every FT fixture is already scored (matches.scored_at
    // is set). On a re-trigger with nothing new, this avoids re-iterating
    // ~15k entries for no change.
    let scored = false;
    if (prepared.length > 0) {
      const ids = prepared.map(m => m.matchId);
      const anyUnscored = prepared.some(m => !scoredAt[m.matchId]);

      if (anyUnscored) {
        // processDate manages the cursor internally — reads it at start,
        // saves on time-out, resets to 0 on full completion. No explicit
        // reset here (resetting on every run while scored_at is null
        // would wipe progress between successive runs).
        const completed = await processDate(dateStr, prepared);
        if (completed) {
          await supa.from('matches')
            .update({ scored_at: new Date().toISOString() })
            .in('external_id', ids);
        }
        scored = completed;
      }
    }

    // Refresh derived caches only if we actually scored something —
    // otherwise this re-running on idle is just wasted DB CPU.
    let playerLeaderboardRefreshed = false;
    let entryLeaderboardRefreshed = false;
    if (scored) {
      try { await supa.rpc('refresh_player_leaderboard'); playerLeaderboardRefreshed = true; }
      catch (e) { console.error('refresh_player_leaderboard failed:', e); }
      try { await supa.rpc('refresh_leaderboard_and_ranks'); entryLeaderboardRefreshed = true; }
      catch (e) { console.error('refresh_leaderboard_and_ranks failed:', e); }
    }

    return new Response(JSON.stringify({
      date: dateStr,
      processed: results.length,
      results,
      scored,
      refreshed: playerLeaderboardRefreshed && entryLeaderboardRefreshed,
      playerLeaderboardRefreshed,
      entryLeaderboardRefreshed,
    }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
