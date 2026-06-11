// HALLO AMRIKA audience view — public, read-only.
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';
import { t } from './js/i18n.js';
import { flagImg } from './js/flags.js';

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';
const LB_PAGE_SIZE = 20;

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

  // FAST PATH: things needed for hero + leaderboard + My Squad — load these first.
  // The 700KB players.json is only needed for the pool browser below the fold.
  const playersP = fetch('data/players.json').then(r => r.json());
  const [teams, league, user] = await Promise.all([
    fetch('data/teams.json').then(r => r.json()),
    supabase.from('leagues').select('*').eq('id', HALO_LEAGUE_ID).maybeSingle(),
    currentUser(),
  ]);
  state.teams = teams.teams;
  state.league = league.data;
  state.myUserId = user?.id || null;

  // Render above-the-fold stuff IMMEDIATELY
  renderHeroStatus();
  renderMySquad();
  renderLeaderboard();

  // SLOW PATH: player pool waits for players.json (background)
  playersP.then(players => {
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
    hydrateFilters();
    renderPoolStats();
    renderPool();
    wireFilters();
  });
  // Re-render dynamic strings on language change (only those that are ready)
  window.addEventListener('langchange', () => {
    if (state.players.length) hydrateFilters();
    if (state.players.length) renderPoolStats();
    renderHeroStatus();
    renderMySquad();
    renderLeaderboard();
    if (state.players.length) renderPool();
  });
  // Re-render leaderboard if user just set their display name
  window.addEventListener('displaynamechange', () => renderLeaderboard());

  // Wire up the "Jump to my rank" button + render the My Rank card
  if (state.myUserId) {
    await renderMyRankCard();
  }
}

async function renderMyRankCard() {
  const card = document.getElementById('myRankCard');
  const jumpBtn = document.getElementById('jumpToMeBtn');
  if (!card) return;

  const [rankRes, entryRes] = await Promise.all([
    supabase.rpc('user_rank', { p_league_id: HALO_LEAGUE_ID, p_user_id: state.myUserId }),
    supabase.from('leaderboard_totals')
      .select('team_name, formation, total_points')
      .eq('league_id', HALO_LEAGUE_ID).eq('user_id', state.myUserId).maybeSingle(),
  ]);
  const rank = rankRes.data;
  const entry = entryRes.data;
  if (!rank || !entry) { card.style.display = 'none'; if (jumpBtn) jumpBtn.style.display = 'none'; return; }

  card.style.display = '';
  card.innerHTML = `
    <div class="mr-label">${t('mysquad.title')}</div>
    <div class="mr-row">
      <div class="mr-rank">#${rank}</div>
      <div class="mr-team">${escapeHtml(entry.team_name)}<span class="mr-form">· ${entry.formation}</span></div>
      <div class="mr-pts">${entry.total_points}</div>
    </div>
  `;
  card.onclick = () => jumpToMyRank(rank);

  if (jumpBtn) {
    jumpBtn.style.display = '';
    jumpBtn.onclick = () => jumpToMyRank(rank);
  }
}

async function jumpToMyRank(rank) {
  // Load enough pages to cover the user's rank
  const neededPages = Math.ceil(rank / LB_PAGE_SIZE);
  state.lbRows = [];
  state.lbLoaded = 0;
  // Fetch fresh count
  const { data: cnt } = await supabase.rpc('entry_count', { p_league_id: HALO_LEAGUE_ID });
  state.lbTotal = cnt ?? 0;
  document.getElementById('lbStats').textContent =
    state.lbTotal === 1 ? t('lb.entries.one') : t('lb.entries.n', { n: state.lbTotal });
  document.getElementById('lbTable').innerHTML = '';
  // Loop loading pages
  for (let p = 0; p < neededPages; p++) {
    await renderLeaderboard(false);
  }
  // Scroll to my row + flash highlight
  const me = document.querySelector('.lb-row.me');
  if (me) {
    me.scrollIntoView({ behavior: 'smooth', block: 'center' });
    me.classList.add('flash');
    setTimeout(() => me.classList.remove('flash'), 1800);
  }
}

function renderPoolStats() {
  document.getElementById('poolStats').textContent =
    t('pool.stats', { n: state.players.length.toLocaleString(), teams: state.teams.length });
}

// Pitch coords matching build.js SLOTS (active 11)
const PITCH_COORDS = [
  { x: 50, y: 90, tag: 'GK' },
  { x: 37, y: 72, tag: 'LCB' },
  { x: 63, y: 72, tag: 'RCB' },
  { x: 13, y: 72, tag: 'LB' },
  { x: 87, y: 72, tag: 'RB' },
  { x: 38, y: 48, tag: 'LCM' },
  { x: 62, y: 48, tag: 'RCM' },
  { x: 13, y: 48, tag: 'LW' },
  { x: 87, y: 48, tag: 'RW' },
  { x: 36, y: 18, tag: 'ST' },
  { x: 64, y: 18, tag: 'ST' },
];

async function renderMySquad() {
  if (!state.myUserId) { document.getElementById('mySquadStrip').style.display = 'none'; return; }
  const { data: entry } = await supabase
    .from('entries').select('*')
    .eq('league_id', HALO_LEAGUE_ID).eq('user_id', state.myUserId).maybeSingle();
  if (!entry) { document.getElementById('mySquadStrip').style.display = 'none'; return; }

  document.getElementById('mySquadStrip').style.display = '';
  const submittedAt = new Date(entry.submitted_at).toLocaleString();
  document.getElementById('mySquadMeta').innerHTML =
    `${escapeHtml(entry.team_name)} · ${entry.formation} · ${t('mysquad.submitted', { at: submittedAt })}`;

  const xi = entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  // Pitch HTML
  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    const name = displayLast(item) || '?';
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    const extra = name.length >= 13 ? 'letter-spacing:-0.3px;max-width:140px;' : '';
    return `<div class="pitch-slot filled" style="left:${coord.x}%;top:${coord.y}%;">
      <div class="ps-flag">${flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' })}</div>
      <div class="ps-name" style="font-size:${sz}px;${extra}">${escapeHtml(name)}</div>
      <div class="ps-tag">${coord.tag}</div>
    </div>`;
  }).join('');

  const benchHtml = wild ? `
    <div class="bench-label">${t('squad.bench')}</div>
    <div class="bench-slot filled">
      <span>${flagImg(wild.nation_code, { width: 20, cls: 'flag-img', fallback: '' })} <b>${escapeHtml(displayLast(wild))}</b>
        <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(wild.club || '')}</span>
      </span>
    </div>
  ` : '';

  const shareText = encodeURIComponent(
    `🏆 I built my HALLO AMRIKA fantasy XI: "${entry.team_name}"\n\nBuild yours: https://halloamrika.saba7okorah.com`
  );

  document.getElementById('mySquadCard').innerHTML = `
    <div class="my-squad-card">
      <div class="pitch-wrap">
        <div class="pitch442">
          <div class="pl-box pl-box-top"></div>
          <div class="pl-box pl-box-bottom"></div>
          <div class="pl-circle"></div>
          <div class="pl-halfway"></div>
          ${slotsHtml}
        </div>
        <div class="bench">${benchHtml}</div>
      </div>
      <div style="margin-top:14px;text-align:center;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <a href="https://wa.me/?text=${shareText}" target="_blank" rel="noopener" class="ghost-btn" style="text-decoration:none;background:#25D366;color:#0a0a12;border-color:#25D366;">${t('share.whatsapp')}</a>
        <a href="build.html" class="ghost-btn" style="text-decoration:none;">${t('mysquad.edit')}</a>
      </div>
    </div>
  `;

  // Toggle the hero CTA button text
  const cta = document.getElementById('ctaBuild');
  if (cta) {
    cta.textContent = t('cta.viewsquad');
    cta.setAttribute('href', '#mySquadStrip');
  }
}

function displayLast(item) {
  return item.shirt_name || item.last || item.name || '';
}

// Kept for callers that still want the emoji fallback
function flagFromCode(code) {
  const team = state.teams.find(t => t.code === code);
  return team?.flag || '';
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
    el.textContent = '🔒 ' + (t('spin.locked')?.replace('🔒 ','') || 'Submissions locked');
    document.getElementById('ctaBuild').style.display = 'none';
    return;
  }
  const diffMs = lock - now;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const lockStr = lock.toLocaleString();
  el.textContent = (document.documentElement.lang === 'ar')
    ? `التشكيلات مفتوحة · تقفل خلال ${days} يوم ${hours} ساعة (${lockStr})`
    : `Submissions open · locks in ${days}d ${hours}h (${lockStr})`;
}

async function renderLeaderboard(reset = true) {
  if (reset) {
    state.lbRows = [];
    state.lbLoaded = 0;
    // Fetch total count once (cheap RPC)
    const { data: cnt } = await supabase.rpc('entry_count', { p_league_id: HALO_LEAGUE_ID });
    state.lbTotal = cnt ?? 0;
    const lbStats = document.getElementById('lbStats');
    lbStats.textContent = state.lbTotal === 1 ? t('lb.entries.one') : t('lb.entries.n', { n: state.lbTotal });
    document.getElementById('lbTable').innerHTML = '';
  }

  if (state.lbTotal === 0) {
    document.getElementById('lbTable').innerHTML =
      `<div class="lb-empty">${t('lb.empty')}</div>`;
    return;
  }

  // Paginated leaderboard query (top points first, ties broken by submission order).
  // Uses the aggregated view → tiny payload per row.
  const from = state.lbLoaded;
  const to   = state.lbLoaded + LB_PAGE_SIZE - 1;
  const { data: rows, error } = await supabase
    .from('leaderboard_totals')
    .select('entry_id, team_name, formation, user_id, submitted_at, total_points')
    .eq('league_id', HALO_LEAGUE_ID)
    .order('total_points', { ascending: false })
    .order('submitted_at', { ascending: true })
    .range(from, to);

  if (error) {
    document.getElementById('lbTable').innerHTML =
      `<div class="lb-empty" style="color:var(--danger);">${escapeHtml(error.message)} — has supabase/leaderboard_view.sql been run?</div>`;
    return;
  }

  // Hydrate owner names for just the new rows
  const newIds = (rows || []).map(r => r.user_id);
  let profiles = {};
  if (newIds.length) {
    const { data: profs } = await supabase
      .from('profiles').select('id, email, display_name').in('id', newIds);
    for (const p of profs || []) profiles[p.id] = p;
  }
  for (const r of rows || []) {
    r.ownerName = profiles[r.user_id]?.display_name || profiles[r.user_id]?.email || '—';
  }

  state.lbRows.push(...(rows || []));
  state.lbLoaded += (rows || []).length;

  document.getElementById('lbTable').innerHTML = state.lbRows.map((r, i) => `
    <div class="lb-row clickable${r.user_id === state.myUserId ? ' me' : ''}" data-entry="${r.entry_id}">
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-team">${escapeHtml(r.team_name)}<span class="lb-form">· ${r.formation}</span></div>
      <div class="lb-owner">${escapeHtml(r.ownerName)}</div>
      <div class="lb-pts">${r.total_points}</div>
    </div>
  `).join('') + renderLoadMore();

  for (const row of document.querySelectorAll('.lb-row.clickable')) {
    row.onclick = () => openSquadModal(row.dataset.entry);
  }
  const btn = document.getElementById('lbLoadMore');
  if (btn) btn.onclick = () => renderLeaderboard(false);
}

async function openSquadModal(entryId) {
  const { data: entry } = await supabase
    .from('entries').select('*').eq('id', entryId).maybeSingle();
  if (!entry) return;
  const xi = entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    const name = displayLast(item) || '?';
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    const extra = name.length >= 13 ? 'letter-spacing:-0.3px;max-width:140px;' : '';
    return `<div class="pitch-slot filled" style="left:${coord.x}%;top:${coord.y}%;">
      <div class="ps-flag">${flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' })}</div>
      <div class="ps-name" style="font-size:${sz}px;${extra}">${escapeHtml(name)}</div>
      <div class="ps-tag">${coord.tag}</div>
    </div>`;
  }).join('');

  const benchHtml = wild ? `
    <div class="bench-label">${t('squad.bench')}</div>
    <div class="bench-slot filled">
      <span>${flagImg(wild.nation_code, { width: 20, cls: 'flag-img', fallback: '' })} <b>${escapeHtml(displayLast(wild))}</b>
        <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(wild.club || '')}</span>
      </span>
    </div>
  ` : '';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:560px;">
      <button class="modal-x" id="squadModalX">×</button>
      <h2 class="modal-title">${escapeHtml(entry.team_name)}</h2>
      <p class="modal-sub">${entry.formation} · ${new Date(entry.submitted_at).toLocaleDateString()}</p>
      <div class="pitch-wrap">
        <div class="pitch442" style="aspect-ratio:1/1.25;width:100%;max-width:460px;margin:0 auto;">
          <div class="pl-box pl-box-top"></div>
          <div class="pl-box pl-box-bottom"></div>
          <div class="pl-circle"></div>
          <div class="pl-halfway"></div>
          ${slotsHtml}
        </div>
        <div class="bench" style="max-width:460px;margin:10px auto 0;">${benchHtml}</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('squadModalX').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

function renderLoadMore() {
  if (state.lbLoaded >= state.lbTotal) {
    return `<div style="color:var(--text-dim);font-size:12px;padding:10px;text-align:center;">${state.lbTotal} / ${state.lbTotal}</div>`;
  }
  const next = Math.min(LB_PAGE_SIZE, state.lbTotal - state.lbLoaded);
  return `<div style="margin-top:12px;text-align:center;">
    <button class="ghost-btn" id="lbLoadMore">${t('lb.loadmore', { n: next, rest: state.lbTotal - state.lbLoaded })}</button>
  </div>`;
}

function hydrateFilters() {
  const catSel = document.getElementById('filterCat');
  catSel.innerHTML = `<option value="">${t('filter.all.cat')}</option>` +
    [1,2,3,4,5,6].map(c => `<option value="${c}">${t('filter.cat', { n: c })}</option>`).join('');

  const natSel = document.getElementById('filterNation');
  const opts = state.teams
    .slice().sort((a,b) => a.name.localeCompare(b.name))
    .map(team => `<option value="${team.name}">${team.name}</option>`);
  natSel.innerHTML = `<option value="">${t('filter.all.nat')}</option>` + opts.join('');

  // The "All roles" option also needs localizing
  const roleSel = document.getElementById('filterRole');
  if (roleSel?.options[0]) roleSel.options[0].textContent = t('filter.all.role');
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
      <div class="pr-flag" title="${escapeHtml(p.nation)} · Cat ${p.category}">${flagImg(p.nation_code, { width: 40, cls: 'flag-img', fallback: p.flag })}</div>
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
    more.innerHTML = `<button class="ghost-btn" id="moreBtn">${t('pool.more', { n: Math.min(PAGE_SIZE, filtered.length - visible), rest: filtered.length - visible })}</button>`;
    document.getElementById('moreBtn').onclick = () => { visible += PAGE_SIZE; renderPool(); };
  } else {
    more.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:8px;text-align:center;">${filtered.length} / ${state.players.length}</div>`;
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
