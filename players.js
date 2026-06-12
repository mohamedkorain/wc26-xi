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
    .limit(20000);

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
    <div class="pl-row clickable" data-player="${escapeHtml(p.name)}" style="cursor:pointer;">
      <span class="pl-rank">${i + 1}</span>
      <span class="pl-name"><b>${escapeHtml(displayPlayerName(p.name))}</b><br/><span class="pl-nation">${p.matches} ${p.matches === 1 ? 'match' : 'matches'}</span></span>
      <span class="pl-icons">
        ${p.goals   ? `<span title="Goals">⚽ ${p.goals}</span>`    : ''}
        ${p.assists ? `<span title="Assists">🎁 ${p.assists}</span>` : ''}
        ${p.cs      ? `<span title="Clean sheets">🧤 ${p.cs}</span>` : ''}
        ${p.mvp     ? `<span title="MVP">⭐ ${p.mvp}</span>`         : ''}
        ${p.red     ? `<span title="Red cards" style="color:var(--danger);">🟥 ${p.red}</span>` : ''}
      </span>
      <span class="pl-total">${p.points}</span>
    </div>
  `).join('');
  document.getElementById('playersBoard').innerHTML = rowsHtml;

  // Click → show full breakdown modal (across all matches)
  document.querySelectorAll('.pl-row.clickable').forEach(el => {
    el.onclick = () => showPlayerDetailModal(el.dataset.player);
  });
}

async function showPlayerDetailModal(playerName) {
  // Re-query scores to find every match this player contributed to.
  // Order DESC so the most recent matches come first (the limit then doesn't
  // skip them on a popular player like Hwang Inbeom whose data lives on the
  // newest match dates).
  const { data: rows } = await supabase
    .from('scores')
    .select('match_date, breakdown')
    .order('match_date', { ascending: false })
    .limit(20000);

  const seen = new Set();
  const perMatch = [];
  for (const row of rows || []) {
    const st = (row.breakdown || {})[playerName];
    if (!st || Object.keys(st).length === 0) continue;
    const key = `${row.match_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pts = (st.win||0) + (st.full90||0) + (st.goals||0) + (st.assists||0) + (st.cleanSheet||0) + (st.mvp||0) - (st.red ? 1 : 0);
    perMatch.push({ date: row.match_date, st, pts });
  }

  const totalPts = perMatch.reduce((s, r) => s + r.pts, 0);
  const rowsHtml = perMatch.map(r => {
    const dateLabel = new Date(r.date + 'T00:00:00Z').toLocaleDateString(
      document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-GB',
      { day: '2-digit', month: 'short' }
    );
    return `
      <div class="tb-row">
        <div>
          <div>${dateLabel}</div>
          <div class="tb-date">${describeStat(r.st)}</div>
        </div>
        <div class="tb-pts ${r.pts > 0 ? 'pos' : r.pts < 0 ? 'neg' : ''}">${r.pts >= 0 ? '+' : ''}${r.pts}</div>
      </div>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <button class="modal-x" id="plModalX">×</button>
      <h2 class="modal-title">${escapeHtml(displayPlayerName(playerName))}</h2>
      <p class="modal-sub">${perMatch.length} ${perMatch.length === 1 ? 'match' : 'matches'} · ${totalPts >= 0 ? '+' : ''}${totalPts} pts</p>
      <div class="team-breakdown" style="margin-top:16px;">${rowsHtml || '<div style="text-align:center;color:var(--text-dim);">No matches yet.</div>'}</div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('plModalX').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

function describeStat(s) {
  const parts = [];
  if (s.goals) parts.push(`⚽${s.goals}`);
  if (s.assists) parts.push(`🎁${s.assists}`);
  if (s.cleanSheet) parts.push('🧤');
  if (s.win) parts.push('✅');
  if (s.full90) parts.push('⏱️');
  if (s.mvp) parts.push('⭐');
  if (s.red) parts.push('🟥');
  return parts.join(' ') || '—';
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
