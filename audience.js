// HALO AMRIKA audience view — public, read-only.
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';

const state = {
  teams: [],
  players: [],     // flat: each row carries nation + category
  league: null,    // { locked_at, ... }
  myUserId: null,
};

const PAGE_SIZE = 60;
let visible = PAGE_SIZE;

async function boot() {
  mountAuthWidget(document.getElementById('authSlot'));
  const [teams, players, league, user] = await Promise.all([
    fetch('data/teams.json').then(r => r.json()),
    fetch('data/players.json').then(r => r.json()),
    supabase.from('leagues').select('*').eq('id', HALO_LEAGUE_ID).maybeSingle(),
    currentUser(),
  ]);
  state.teams = teams.teams;
  for (const n of players.nations) {
    const t = state.teams.find(x => x.name === n.name);
    for (const p of n.players) {
      state.players.push({
        ...p,
        nation: n.name,
        nation_code: t?.code || '',
        flag: t?.flag || '',
        category: n.category,
        arab: n.arab,
      });
    }
  }
  state.league = league.data;
  state.myUserId = user?.id || null;

  hydrateFilters();
  document.getElementById('poolStats').textContent =
    `${state.players.length.toLocaleString()} players · ${state.teams.length} nations · 6 categories`;
  renderHeroStatus();
  renderLeaderboard();
  renderPool();
  wireFilters();
}

function renderHeroStatus() {
  const el = document.getElementById('heroStatus');
  if (!state.league) {
    el.textContent = 'Setup pending — admin must run seed_halo.sql';
    el.style.color = 'var(--accent-2)';
    return;
  }
  const now = new Date();
  const lock = new Date(state.league.locked_at);
  if (now >= lock) {
    el.textContent = '🔒 Submissions locked · tournament live';
    document.getElementById('ctaBuild').style.display = 'none';
    return;
  }
  const diffMs = lock - now;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  el.textContent = `Submissions open · locks in ${days}d ${hours}h (${lock.toLocaleString()})`;
}

async function renderLeaderboard() {
  const { data: entries } = await supabase
    .from('entries').select('id, team_name, formation, user_id, submitted_at')
    .eq('league_id', HALO_LEAGUE_ID);

  const lbStats = document.getElementById('lbStats');
  const lbTable = document.getElementById('lbTable');
  lbStats.textContent = `${(entries || []).length} entr${(entries || []).length === 1 ? 'y' : 'ies'}`;

  if (!entries || !entries.length) return;  // leave the empty-state message

  // Pull profile display_names
  const ids = entries.map(e => e.user_id);
  const { data: profs } = await supabase
    .from('profiles').select('id, email, display_name').in('id', ids);
  const profiles = {};
  for (const p of profs || []) profiles[p.id] = p;

  // Aggregate points
  const totals = {};
  const { data: scores } = await supabase
    .from('scores').select('entry_id, points').in('entry_id', entries.map(e => e.id));
  for (const s of scores || []) totals[s.entry_id] = (totals[s.entry_id] || 0) + s.points;

  const rows = entries
    .map(e => ({
      ...e,
      points: totals[e.id] || 0,
      ownerName: profiles[e.user_id]?.display_name || profiles[e.user_id]?.email || '—',
    }))
    .sort((a, b) => b.points - a.points || a.submitted_at.localeCompare(b.submitted_at));

  lbTable.innerHTML = rows.map((r, i) => `
    <div class="lb-row${r.user_id === state.myUserId ? ' me' : ''}">
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-team">${escapeHtml(r.team_name)}<span class="lb-form">· ${r.formation}</span></div>
      <div class="lb-owner">${escapeHtml(r.ownerName)}</div>
      <div class="lb-pts">${r.points}</div>
    </div>
  `).join('');
}

function hydrateFilters() {
  const catSel = document.getElementById('filterCat');
  catSel.innerHTML = '<option value="">All categories</option>' +
    [1,2,3,4,5,6].map(c => `<option value="${c}">Category ${c}</option>`).join('');

  const natSel = document.getElementById('filterNation');
  const opts = state.teams
    .slice().sort((a,b) => a.name.localeCompare(b.name))
    .map(t => `<option value="${t.name}">${t.flag} ${t.name}</option>`);
  natSel.innerHTML = '<option value="">All nations</option>' + opts.join('');
}

function wireFilters() {
  for (const id of ['filterSearch','filterCat','filterNation','filterRole','filterArab']) {
    const el = document.getElementById(id);
    el.oninput = () => { visible = PAGE_SIZE; renderPool(); };
    el.onchange = () => { visible = PAGE_SIZE; renderPool(); };
  }
}

function renderPool() {
  const q = document.getElementById('filterSearch').value.toLowerCase().trim();
  const cat = document.getElementById('filterCat').value;
  const nat = document.getElementById('filterNation').value;
  const role = document.getElementById('filterRole').value;
  const arab = document.getElementById('filterArab').checked;

  const filtered = state.players.filter(p => {
    if (cat && String(p.category) !== cat) return false;
    if (nat && p.nation !== nat) return false;
    if (role && !p.roles.includes(role)) return false;
    if (arab && !p.arab) return false;
    if (q && !(p.name?.toLowerCase().includes(q) || (p.club||'').toLowerCase().includes(q))) return false;
    return true;
  });

  const list = document.getElementById('poolList');
  list.innerHTML = filtered.slice(0, visible).map(p => `
    <div class="pool-row">
      <div class="pr-flag" title="${escapeHtml(p.nation)} · Cat ${p.category}">${p.flag}</div>
      <div class="pr-meta">
        <div class="pr-name">${escapeHtml(p.name || '')}</div>
        <div class="pr-club">${clubBadge(p.club)}<span>${escapeHtml(p.club || '')}</span></div>
      </div>
      <div class="pr-roles">${p.roles.map(r => `<span class="role-chip role-${r}">${r}</span>`).join('')}</div>
      <div class="pr-cat cat-${p.category}">C${p.category}</div>
    </div>
  `).join('');
  const more = document.getElementById('poolMore');
  if (filtered.length > visible) {
    more.innerHTML = `<button class="ghost-btn" id="moreBtn">Show ${Math.min(PAGE_SIZE, filtered.length - visible)} more · ${filtered.length - visible} remaining</button>`;
    document.getElementById('moreBtn').onclick = () => { visible += PAGE_SIZE; renderPool(); };
  } else {
    more.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:8px;text-align:center;">${filtered.length} of ${state.players.length}</div>`;
  }
}

function clubBadge(club) {
  const name = String(club || '').replace(/\s*\([A-Z]{3,4}\)\s*$/, '').trim();
  if (!name) return '';
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<span class="club-badge" style="background:hsl(${hue},45%,28%);color:hsl(${hue},80%,82%);">${escapeHtml(initials)}</span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#ff6b6b;">Failed to load: ${err.message}</pre>`;
});
