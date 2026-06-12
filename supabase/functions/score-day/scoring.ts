// HALLO AMRIKA scoring rules — pure functions, no I/O.
// Mirrors what's shown on the public scoring table.

export interface PlayerEvent {
  player_id: number;          // API-Football player id
  player_name: string;
  team: 'home' | 'away';
  minutes: number;             // minutes played in the match
  is_starter: boolean;
  goals: number;
  assists: number;
  red_card: boolean;
  mvp: boolean;                // highest-rated player on the winning team
}

export interface MatchOutcome {
  match_id: string;
  date: string;                // YYYY-MM-DD
  home_team: string;
  away_team: string;
  home_goals: number;
  away_goals: number;
  status: 'finished' | 'live' | 'scheduled';
  players: PlayerEvent[];
}

// Roles in the squad that can earn a clean-sheet bonus
const CS_ELIGIBLE_ROLES = new Set(['GK', 'CB', 'FB', 'CM']);

/**
 * Score a single player's performance in a match.
 * Returns a breakdown object the UI can display + a numeric total.
 */
export function scorePlayer(
  ev: PlayerEvent,
  playerRoles: string[],         // ['GK'], ['CB'], etc. — from our players.json
  matchHomeTeam: string,
  matchHomeGoals: number,
  matchAwayGoals: number,
): { points: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let pts = 0;

  // Did the player's team win?
  const playerOnHomeSide = ev.team === 'home';
  const teamGoalsFor   = playerOnHomeSide ? matchHomeGoals : matchAwayGoals;
  const teamGoalsAgainst = playerOnHomeSide ? matchAwayGoals : matchHomeGoals;
  const teamWon = teamGoalsFor > teamGoalsAgainst;
  const cleanSheet = teamGoalsAgainst === 0;

  // 1. Team win (+1 if played 1'+)
  if (teamWon && ev.minutes >= 1) {
    breakdown.win = 1; pts += 1;
  }

  // 2. 90' bonus (+1) — ONLY if the team won AND the player finished the
  // full match. Per the public rule: "⏱️ Bonus if full 90' (team win)".
  if (teamWon && ev.minutes >= 90) {
    breakdown.full90 = 1; pts += 1;
  }

  // 3. Goal scored (+1 each)
  if (ev.goals > 0) {
    breakdown.goals = ev.goals; pts += ev.goals;
  }

  // 4. Assist (+1 each)
  if (ev.assists > 0) {
    breakdown.assists = ev.assists; pts += ev.assists;
  }

  // 5. Clean sheet (+1) — GK/CB/FB/CM only, must have played 45'+
  const hasEligibleCsRole = playerRoles.some(r => CS_ELIGIBLE_ROLES.has(r));
  if (cleanSheet && hasEligibleCsRole && ev.minutes >= 45) {
    breakdown.cleanSheet = 1; pts += 1;
  }

  // 6. MVP (+1)
  if (ev.mvp) {
    breakdown.mvp = 1; pts += 1;
  }

  // 7. Red card (−1)
  if (ev.red_card) {
    breakdown.red = -1; pts -= 1;
  }

  return { points: pts, breakdown };
}

// Cumulative progression bonus per starter (called once per stage reached).
// R32 +2, R16 +2, QF +3, SF +4, Final +4, Champion +5  (max +20).
export const PROGRESSION_BONUS: Record<string, number> = {
  'r32':       2,
  'r16':       2,
  'quarter':   3,
  'semi':      4,
  'final':     4,
  'champion':  5,
};

/**
 * Normalize a name for fuzzy matching between API-Football and our roster.
 *   "Mohamed SALAH"        -> "mohamed salah"
 *   "Cristián Cuevas"      -> "cristian cuevas"
 *   "BRUNO FERNANDES"      -> "bruno fernandes"
 */
export function normaliseName(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/-/g, '')         // collapse hyphens: "in-beom" ↔ "inbeom"
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match an API-Football player to one of our entry players.
 * Tries normalized exact match, then last-name match within the same nation.
 */
export function matchEntryPlayer(
  apiPlayerName: string,
  apiNation: string,
  rosterByNation: Record<string, { name: string; last?: string; shirt_name?: string; roles: string[] }[]>,
): { name: string; roles: string[] } | null {
  const roster = rosterByNation[apiNation] || [];
  const targetNorm = normaliseName(apiPlayerName);
  const targetLast = targetNorm.split(' ').pop() || '';

  // First pass: exact normalized full-name or shirt-name match
  for (const p of roster) {
    const candidates = [p.name, p.last, p.shirt_name].filter(Boolean).map(normaliseName);
    if (candidates.some(c => c === targetNorm)) return { name: p.name, roles: p.roles };
  }
  // Second pass: last-name match (within the same nation)
  const lastMatches = roster.filter(p => normaliseName(p.last || '').endsWith(targetLast));
  if (lastMatches.length === 1) return { name: lastMatches[0].name, roles: lastMatches[0].roles };

  return null;
}
