// Player-points leaderboard.
// Aggregates from scores.breakdown across all entries, deduping by (player, match_date)
// so each player's per-match stats are counted exactly once even though many entries
// picked the same player.

import { supabase } from './js/supabase-client.js';
import { mountAuthWidget } from './js/auth.js';
import { setLang, t } from './js/i18n.js';

mountAuthWidget(document.getElementById('authSlot'));

document.getElementById('langToggle').onclick = () => {
  const cur = document.documentElement.lang === 'ar' ? 'en' : 'ar';
  setLang(cur);
  document.getElementById('langToggle').textContent = cur === 'ar' ? 'English' : 'عربي';
  render();
};

let nationsByName = {};
(async () => {
  const teams = await (await fetch('data/teams.json')).json();
  for (const t of teams.teams) nationsByName[t.name] = t;
  await render();
})();

async function render() {
  // Pull up to ~5000 most recent score rows. Each has breakdown:
  //   { "PLAYER NAME": { win, full90, goals, assists, cleanSheet, mvp, red }, ... }
  // Each PLAYER appears across many entries (everyone who picked them). De-dup by
  // (player_name + match_date) so we count their match stats once, not per entry.
  const { data: rows, error } = await supabase
    .from('scores')
    .select('match_date, breakdown')
    .order('match_date', { ascending: false })
    .limit(5000);

  if (error) {
    document.getElementById('playersBoard').innerHTML =
      `<div class="lb-empty">Error: ${error.message}</div>`;
    return;
  }
  if (!rows || rows.length === 0) {
    document.getElementById('playersBoard').innerHTML =
      `<div class="lb-empty">${t('players.empty')}</div>`;
    return;
  }

  const seen = new Set();
  const agg = {};  // player → { goals, assists, cs, red, mvp, points, matches }
  for (const row of rows) {
    const md = row.match_date;
    const bd = row.breakdown || {};
    for (const [player, stats] of Object.entries(bd)) {
      const key = `${player}::${md}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!agg[player]) agg[player] = { goals: 0, assists: 0, cs: 0, red: 0, mvp: 0, points: 0, matches: 0 };
      const s = stats || {};
      const matchPts = (s.win||0) + (s.full90||0) + (s.goals||0) + (s.assists||0) + (s.cleanSheet||0) + (s.mvp||0) - (s.red ? 1 : 0);
      agg[player].goals    += s.goals    || 0;
      agg[player].assists  += s.assists  || 0;
      agg[player].cs       += s.cleanSheet || 0;
      agg[player].red      += s.red ? 1 : 0;
      agg[player].mvp      += s.mvp || 0;
      agg[player].points   += matchPts;
      agg[player].matches  += 1;
    }
  }

  const sorted = Object.entries(agg)
    .map(([name, st]) => ({ name, ...st }))
    .sort((a, b) => b.points - a.points || b.goals - a.goals || b.assists - a.assists);

  const top = sorted.slice(0, 100);
  if (top.length === 0) {
    document.getElementById('playersBoard').innerHTML =
      `<div class="lb-empty">${t('players.empty')}</div>`;
    return;
  }

  const rowsHtml = top.map((p, i) => `
    <div class="pl-row">
      <span class="pl-rank">${i + 1}</span>
      <span class="pl-name"><b>${escapeHtml(displayPlayerName(p.name))}</b><br/><span class="pl-nation">${p.matches} ${p.matches === 1 ? 'match' : 'matches'}</span></span>
      <span class="pl-stat" title="${t('players.col.goals')}">⚽ ${p.goals}</span>
      <span class="pl-stat" title="${t('players.col.assists')}">🎁 ${p.assists}</span>
      <span class="pl-total">${p.points}</span>
    </div>
  `).join('');
  document.getElementById('playersBoard').innerHTML = rowsHtml;
}

// Our roster stores names as "LASTNAME Firstname". Display as "Firstname LASTNAME"
// (first name first) for the player leaderboard since this is a public-facing list
// and reads more naturally that way.
function displayPlayerName(raw) {
  const parts = raw.split(' ');
  if (parts.length < 2) return raw;
  const family = parts[0];      // already uppercase by data convention
  const rest = parts.slice(1).join(' ');
  return `${rest} ${family}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
