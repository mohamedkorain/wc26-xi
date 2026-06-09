// HALO AMRIKA — squad builder (v2: nation-only randomizer, 5-bucket picker,
// max 2 per category, wildcard, sub-in step).
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';
import { t } from './js/i18n.js';

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';

// 4-4-2 squad. Slot 0..10 are the active XI; slot 11 is the wildcard (bench).
// `bucket` is what the player picks at; multiple slot roles can fold into one
// bucket (DEF covers CB+FB).
const SLOTS = [
  { idx: 0,  tag: 'GK',  role: 'GK',  bucket: 'GK',  x: 50, y: 90 },
  { idx: 1,  tag: 'LCB', role: 'CB',  bucket: 'DEF', x: 37, y: 70 },
  { idx: 2,  tag: 'RCB', role: 'CB',  bucket: 'DEF', x: 63, y: 70 },
  { idx: 3,  tag: 'LB',  role: 'FB',  bucket: 'DEF', x: 13, y: 72 },
  { idx: 4,  tag: 'RB',  role: 'FB',  bucket: 'DEF', x: 87, y: 72 },
  { idx: 5,  tag: 'LCM', role: 'CM',  bucket: 'MID', x: 38, y: 48 },
  { idx: 6,  tag: 'RCM', role: 'CM',  bucket: 'MID', x: 62, y: 48 },
  { idx: 7,  tag: 'LW',  role: 'WIN', bucket: 'WIN', x: 13, y: 48 },
  { idx: 8,  tag: 'RW',  role: 'WIN', bucket: 'WIN', x: 87, y: 48 },
  { idx: 9,  tag: 'ST',  role: 'ST',  bucket: 'FWD', x: 36, y: 18 },
  { idx: 10, tag: 'ST',  role: 'ST',  bucket: 'FWD', x: 64, y: 18 },
  { idx: 11, tag: 'WILD',role: null,  bucket: null,  wild: true },
];

const BUCKETS = ['GK', 'DEF', 'MID', 'WIN', 'FWD'];
const BUCKET_ROLES = { GK: ['GK'], DEF: ['CB','FB'], MID: ['CM'], WIN: ['WIN'], FWD: ['ST'] };
const MAX_PER_CATEGORY = 2;

const state = {
  teams: [],
  byNation: {},
  clubLogos: {},
  league: null,
  user: null,
  squad: Array(12).fill(null),  // {player, nation, bucket}
  catPicks: { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 },
  spin: null,                   // {nation, isWildcardSpin}
  spinning: false,
  step: 'spin',                 // 'spin' | 'bucket' | 'candidates' | 'subin'
  locked: false,
};

// ─── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  state.user = await currentUser();
  if (!state.user) { location.href = 'login.html'; return; }
  mountAuthWidget(document.getElementById('authSlot'));

  const [teams, players, league, clubs] = await Promise.all([
    fetch('data/teams.json').then(r => r.json()),
    fetch('data/players.json').then(r => r.json()),
    supabase.from('leagues').select('*').eq('id', HALO_LEAGUE_ID).maybeSingle(),
    fetch('data/clubs.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  state.teams = teams.teams;
  for (const n of players.nations) state.byNation[n.name] = n.players;
  state.clubLogos = clubs || {};
  state.league = league.data;
  if (!state.league) {
    document.body.innerHTML = `<pre style="padding:30px;color:#ff6b6b;">HALO AMRIKA league not set up — admin must run supabase/seed_halo.sql.</pre>`;
    return;
  }
  state.locked = new Date() >= new Date(state.league.locked_at);

  await loadExistingEntry();

  wireUI();
  renderAll();
  window.addEventListener('langchange', renderAll);
}

async function loadExistingEntry() {
  const { data: entry } = await supabase
    .from('entries').select('*')
    .eq('league_id', HALO_LEAGUE_ID).eq('user_id', state.user.id).maybeSingle();
  if (!entry) return;
  document.getElementById('teamName').value = entry.team_name || '';
  for (const item of entry.xi_json || []) {
    const team = state.teams.find(t => t.name === item.nation);
    const player = (state.byNation[item.nation] || []).find(p => p.name === item.name);
    if (team && player) {
      state.squad[item.slot] = { player, nation: team, bucket: item.bucket || SLOTS[item.slot].bucket };
      if (item.slot !== 11) state.catPicks[team.category] = (state.catPicks[team.category] || 0) + 1;
      else if (team.category) state.catPicks[team.category] = (state.catPicks[team.category] || 0) + 1;
    }
  }
}

function wireUI() {
  document.getElementById('spinBtn').onclick = spin;
  document.getElementById('submitBtn').onclick = submit;
  document.getElementById('teamName').oninput = updateSubmitState;
  document.getElementById('resetSquadBtn').onclick = resetSquad;
}

function resetSquad() {
  if (state.locked) return;
  const filled = picksCount();
  if (filled > 0 && !confirm(t('reset.confirm'))) return;
  state.squad = Array(12).fill(null);
  state.catPicks = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
  state.spin = null;
  document.getElementById('candidatesCard').style.display = 'none';
  document.getElementById('reelNationVal').textContent = '🌍';
  document.getElementById('reelRoleVal').textContent = '—';
  document.getElementById('submitMsg').textContent = '';
  renderAll();
}

// ─── spin: nation only ───────────────────────────────────────────────────────

function picksCount() { return state.squad.filter(Boolean).length; }
function isWildcardTurn() { return picksCount() === 11; }

function haveArab() { return state.squad.some(s => s && s.nation.arab); }

function usedNationNames() {
  return new Set(state.squad.filter(Boolean).map(s => s.nation.name));
}

function nationPool() {
  // Eligible for current spin: not used yet, category still has capacity.
  // Wildcard turn: also force Arab if we don't have one yet.
  const used = usedNationNames();
  let pool = state.teams.filter(t =>
    !used.has(t.name) && (state.catPicks[t.category] || 0) < MAX_PER_CATEGORY
  );
  if (isWildcardTurn() && !haveArab()) {
    const arabPool = pool.filter(t => t.arab);
    if (arabPool.length) return arabPool;
    // Edge case: no Arab in remaining cats. Fall back to any Arab not yet used.
    const anyArab = state.teams.filter(t => t.arab && !used.has(t.name));
    if (anyArab.length) return anyArab;
  }
  return pool;
}

function spin() {
  if (state.spinning || state.locked) return;
  if (picksCount() >= 12) return;

  // Decide the final (nation, bucket) pair now. For wildcard: nation only.
  const draw = rollNationAndBucket();
  if (!draw) { setHint('No eligible spin possible.'); return; }

  state.spinning = true;
  document.getElementById('spinBtn').disabled = true;
  document.getElementById('candidatesCard').style.display = 'none';
  document.getElementById('reelNation').classList.add('spinning');
  document.getElementById('reelRole').classList.add('spinning');

  const flagEl = document.getElementById('reelNationVal');
  const roleEl = document.getElementById('reelRoleVal');
  const start = performance.now();
  const tumble = () => {
    flagEl.textContent = state.teams[Math.floor(Math.random() * state.teams.length)].flag;
    roleEl.textContent = BUCKETS[Math.floor(Math.random() * BUCKETS.length)];
    if (performance.now() - start < 1200) {
      requestAnimationFrame(tumble);
    } else {
      flagEl.textContent = draw.nation.flag + ' ' + draw.nation.code;
      roleEl.textContent = draw.bucket || t('bucket.wild');
      document.getElementById('reelNation').classList.remove('spinning');
      document.getElementById('reelRole').classList.remove('spinning');
      state.spin = { nation: draw.nation, bucket: draw.bucket, isWildcard: isWildcardTurn() };
      state.spinning = false;
      setTimeout(() => showCandidates(draw.candidates, draw.bucket), 250);
    }
  };
  requestAnimationFrame(tumble);
}

// Randomizer chooses NATION + BUCKET. For wildcard, bucket is null (any role).
function rollNationAndBucket() {
  const nations = nationPool();
  if (!nations.length) return null;

  if (isWildcardTurn()) {
    const nation = nations[Math.floor(Math.random() * nations.length)];
    return { nation, bucket: null, candidates: allPlayersOf(nation) };
  }

  const opens = openBucketsForCurrentSquad();
  const buckets = BUCKETS.filter(b => opens[b] > 0);
  shuffle(buckets);

  // Try each bucket in random order; for each, find nations that have
  // at least one un-picked player matching, and pick one at random.
  for (const bucket of buckets) {
    const eligible = nations.filter(n => bucketCandidatesIn(n, bucket).length > 0);
    if (!eligible.length) continue;
    const nation = eligible[Math.floor(Math.random() * eligible.length)];
    return { nation, bucket, candidates: bucketCandidatesIn(nation, bucket) };
  }
  return null;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function allPlayersOf(nation) {
  const used = new Set(state.squad.filter(Boolean).map(s => `${s.nation.name}|${s.player.name}`));
  return (state.byNation[nation.name] || []).filter(p => !used.has(`${nation.name}|${p.name}`));
}

// ─── bucket picker ───────────────────────────────────────────────────────────

function openBucketsForCurrentSquad() {
  // Which buckets still have an open slot?
  const out = { GK: 0, DEF: 0, MID: 0, WIN: 0, FWD: 0 };
  for (let i = 0; i < 11; i++) {
    if (state.squad[i] != null) continue;
    out[SLOTS[i].bucket]++;
  }
  return out;
}

function bucketCandidatesIn(nation, bucket) {
  const roles = BUCKET_ROLES[bucket];
  const used = new Set(state.squad.filter(Boolean).map(s => `${s.nation.name}|${s.player.name}`));
  return (state.byNation[nation.name] || []).filter(p =>
    p.roles?.some(r => roles.includes(r)) && !used.has(`${nation.name}|${p.name}`)
  );
}

function showBucketPicker() {
  const card = document.getElementById('bucketCard');
  card.style.display = '';
  const opens = openBucketsForCurrentSquad();
  document.getElementById('bucketHead').innerHTML =
    `${state.spin.nation.flag} ${escapeHtml(state.spin.nation.name)} <span style="color:var(--text-dim);font-weight:400;">· ${t('pick.bucket')}</span>`;
  const grid = document.getElementById('bucketGrid');
  grid.innerHTML = '';
  for (const b of BUCKETS) {
    const have = bucketCandidatesIn(state.spin.nation, b).length;
    const hasSlot = opens[b] > 0;
    const enabled = hasSlot && have > 0;
    const btn = document.createElement('button');
    btn.className = 'bucket-btn bucket-' + b + (enabled ? '' : ' disabled');
    btn.disabled = !enabled;
    btn.innerHTML = `
      <div class="bk-tag">${t('bucket.' + b.toLowerCase())}</div>
      <div class="bk-meta">${have} ${have === 1 ? 'player' : 'players'} · ${opens[b]} slot${opens[b] === 1 ? '' : 's'}</div>
    `;
    btn.onclick = () => showCandidates(bucketCandidatesIn(state.spin.nation, b), b);
    grid.appendChild(btn);
  }
}

// ─── candidates list ─────────────────────────────────────────────────────────

function showCandidates(candidates, bucket) {
  const card = document.getElementById('candidatesCard');
  card.style.display = '';
  document.getElementById('candHead').innerHTML =
    `<span class="cand-head-flag">${state.spin.nation.flag}</span> ${escapeHtml(state.spin.nation.name)} <span style="color:var(--accent);font-weight:800;">${bucket || t('bucket.wild')}</span>`;
  const list = document.getElementById('candidates');
  list.innerHTML = '';
  if (!candidates.length) {
    list.innerHTML = `<div style="color:var(--text-dim);padding:18px;text-align:center;">${t('cand.empty')}</div>`;
  }
  for (const p of candidates) {
    const row = document.createElement('div');
    row.className = 'cand-row';
    row.innerHTML = `
      <div class="cand-flag">${state.spin.nation.flag}</div>
      <div class="cand-no">${p.no ?? ''}</div>
      <div class="cand-meta">
        <div class="cand-name">${escapeHtml(p.name)} <span class="cand-roles">${p.roles.map(r => `<span class="role-chip role-${r}">${r}</span>`).join('')}</span></div>
        <div class="cand-club">${clubBadge(p.club)}<span>${escapeHtml(p.club || '')}</span></div>
      </div>
      <span class="cand-pick">${t('pick.btn')}</span>
    `;
    row.onclick = () => pickPlayer(p, state.spin.nation, bucket);
    list.appendChild(row);
  }
}

function pickPlayer(player, nation, bucket) {
  const slotIdx = assignSlotIndex(player, bucket, state.spin.isWildcard);
  if (slotIdx < 0) {
    setHint('No matching slot for that player.');
    return;
  }
  state.squad[slotIdx] = { player, nation, bucket: bucket || 'WILD' };
  state.catPicks[nation.category] = (state.catPicks[nation.category] || 0) + 1;
  state.spin = null;
  document.getElementById('candidatesCard').style.display = 'none';
  document.getElementById('reelNationVal').textContent = '🌍';
  document.getElementById('reelRoleVal').textContent = '—';
  document.getElementById('spinBtn').disabled = false;
  renderAll();
}

function assignSlotIndex(player, bucket, isWildcard) {
  if (isWildcard) return 11;
  // For bucket-driven picks, find the first open slot that matches.
  // DEF: prefer same-role match (CB→CB slot, FB→FB slot); fall back to any DEF slot.
  if (bucket === 'DEF') {
    // Player likely has CB or FB role.
    for (const r of ['CB', 'FB']) {
      if (player.roles.includes(r)) {
        for (let i = 0; i < 11; i++) {
          if (state.squad[i] == null && SLOTS[i].role === r) return i;
        }
      }
    }
    // Fall back: any open DEF slot
    for (let i = 0; i < 11; i++) if (state.squad[i] == null && SLOTS[i].bucket === 'DEF') return i;
    return -1;
  }
  // GK / MID / WIN / FWD: any open slot with matching bucket
  for (let i = 0; i < 11; i++) {
    if (state.squad[i] == null && SLOTS[i].bucket === bucket) return i;
  }
  return -1;
}

// ─── render ──────────────────────────────────────────────────────────────────

function renderAll() {
  renderPitch();
  renderCategoryStatus();
  renderConstraints();
  updateSubmitState();
  const filled = picksCount();
  if (state.locked) {
    setHint(t('spin.locked'));
    document.getElementById('spinBtn').disabled = true;
    return;
  }
  if (filled >= 12) {
    setHint(t('subin.hint'));
    document.getElementById('spinBtn').disabled = true;
    renderSubIn();
    document.getElementById('subInCard').style.display = '';
  } else {
    document.getElementById('subInCard').style.display = 'none';
    if (filled === 11) {
      setHint(t('spin.wildcard.hint'));
    } else {
      setHint(t('spin.hint.next', { n: filled }));
    }
    document.getElementById('spinBtn').disabled = state.spinning || state.spin != null;
  }
}

function renderPitch() {
  const pitch = document.getElementById('pitch442');
  pitch.innerHTML = `
    <div class="pl-box pl-box-top"></div>
    <div class="pl-box pl-box-bottom"></div>
    <div class="pl-circle"></div>
    <div class="pl-halfway"></div>
  `;
  for (let i = 0; i < 11; i++) {
    const s = SLOTS[i];
    const item = state.squad[i];
    const node = document.createElement('div');
    node.className = 'pitch-slot' + (item ? ' filled' : ' empty');
    node.style.left = s.x + '%';
    node.style.top = s.y + '%';
    node.innerHTML = item ? `
      <div class="ps-flag">${item.nation.flag}</div>
      <div class="ps-name">${escapeHtml(displayLast(item.player))}</div>
      <div class="ps-tag">${s.tag}</div>
    ` : `<div class="ps-empty">${s.tag}</div>`;
    pitch.appendChild(node);
  }
  // bench wildcard
  const bench = document.getElementById('bench');
  const wildItem = state.squad[11];
  bench.innerHTML = `
    <div class="bench-label">${t('squad.bench')}</div>
    <div class="bench-slot ${wildItem ? 'filled' : 'empty'}">
      ${wildItem
        ? `<span>${wildItem.nation.flag} <b>${escapeHtml(displayLast(wildItem.player))}</b> <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(wildItem.player.club || '')}</span></span>`
        : `<span>${t('squad.bench.empty')}</span>`}
    </div>
  `;
}

function renderCategoryStatus() {
  const el = document.getElementById('catStatus');
  el.innerHTML = [1,2,3,4,5,6].map(c => {
    const n = state.catPicks[c] || 0;
    const full = n >= MAX_PER_CATEGORY;
    return `<div class="cat-pill ${full ? 'full' : ''}"><span>C${c}</span><b>${n}/${MAX_PER_CATEGORY}</b></div>`;
  }).join('');
}

function renderConstraints() {
  const filled = picksCount();
  const arab = state.squad.filter(s => s && s.nation.arab).length;
  document.getElementById('constraints').innerHTML = `
    <div class="constraint-line">${t('status.players')}
      <span class="${filled === 12 ? 'ok' : 'bad'}">${filled}/12</span>
    </div>
    <div class="constraint-line">${t('status.arab')}
      <span class="${arab >= 1 ? 'ok' : 'bad'}">${arab}</span>
    </div>
    <div class="constraint-line">${t('status.formation')}
      <span class="ok">4-4-2</span>
    </div>
  `;
}

function updateSubmitState() {
  const filled = picksCount();
  const arab = state.squad.some(s => s && s.nation.arab);
  const name = document.getElementById('teamName').value.trim();
  document.getElementById('submitBtn').disabled =
    !(filled === 12 && arab && name.length > 0 && !state.locked);
}

function setHint(t) { document.getElementById('spinHint').textContent = t; }

// ─── sub-in ──────────────────────────────────────────────────────────────────

function renderSubIn() {
  const card = document.getElementById('subInList');
  const wild = state.squad[11];
  if (!wild) { card.innerHTML = ''; return; }
  // Find starters whose role matches one of the wildcard's roles
  const wildRoles = wild.player.roles || [];
  const candidates = [];
  for (let i = 0; i < 11; i++) {
    const s = SLOTS[i];
    const item = state.squad[i];
    if (!item) continue;
    if (wildRoles.includes(s.role)) {
      candidates.push({ slotIdx: i, slot: s, item });
    }
  }
  if (!candidates.length) {
    card.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:10px;">${t('subin.none')}</div>`;
    return;
  }
  card.innerHTML = `
    <div style="color:var(--text-dim);font-size:12px;margin-bottom:8px;">${t('subin.options', { wild: escapeHtml(displayLast(wild.player)), roles: wildRoles.join('/') })}</div>
  ` + candidates.map(c => `
    <button class="subin-row" data-slot="${c.slotIdx}">
      <div>
        <div style="font-weight:700;">${c.slot.tag} · ${escapeHtml(displayLast(c.item.player))}</div>
        <div style="color:var(--text-dim);font-size:11px;">${c.item.nation.flag} ${c.item.nation.code}</div>
      </div>
      <div class="swap-arrow">⇄</div>
      <div>
        <div style="font-weight:700;color:var(--accent-2);">${escapeHtml(displayLast(wild.player))}</div>
        <div style="color:var(--text-dim);font-size:11px;">${wild.nation.flag} ${wild.nation.code}</div>
      </div>
    </button>
  `).join('');
  for (const btn of card.querySelectorAll('.subin-row')) {
    btn.onclick = () => swapWithWildcard(parseInt(btn.dataset.slot, 10));
  }
}

function swapWithWildcard(slotIdx) {
  const starter = state.squad[slotIdx];
  const wild = state.squad[11];
  if (!starter || !wild) return;
  state.squad[slotIdx] = wild;
  state.squad[11] = starter;
  renderAll();
}

// ─── submit ──────────────────────────────────────────────────────────────────

async function submit() {
  const name = document.getElementById('teamName').value.trim();
  const msg = document.getElementById('submitMsg');
  msg.style.color = 'var(--accent-2)';
  msg.textContent = t('submit.saving');

  const { data: { user: freshUser } } = await supabase.auth.getUser();
  if (!freshUser) {
    msg.style.color = 'var(--danger)';
    msg.innerHTML = 'Your session expired. <a href="login.html" style="color:var(--accent);">Sign in again</a> and your draft will be re-loaded.';
    return;
  }

  const payload = {
    league_id: HALO_LEAGUE_ID,
    user_id: freshUser.id,
    team_name: name,
    formation: '4-4-2',
    xi_json: state.squad.map((item, i) => ({
      slot: i,
      tag: SLOTS[i].tag,
      role: SLOTS[i].role,
      bucket: item.bucket,
      wild: i === 11,
      no: item.player.no,
      name: item.player.name,
      shirt_name: item.player.shirt_name,
      club: item.player.club,
      nation: item.nation.name,
      nation_code: item.nation.code,
      arab: item.nation.arab,
      category: item.nation.category,
    })),
  };
  const { error } = await supabase.from('entries').upsert(payload, { onConflict: 'league_id,user_id' });
  if (error) {
    console.error('[wc26] submit error:', error);
    msg.style.color = 'var(--danger)';
    if (error.code === '42501' || /row-level security/i.test(error.message || '')) {
      msg.innerHTML = 'Permission denied — your session may have expired. <a href="login.html" style="color:var(--accent);">Sign in again</a>, then resubmit.';
    } else {
      msg.textContent = `${error.message}${error.hint ? ' · ' + error.hint : ''}`;
    }
    return;
  }
  msg.style.color = 'var(--accent)';
  msg.innerHTML = t('submit.saved', { at: new Date(state.league.locked_at).toLocaleString() });
}

// ─── utils ───────────────────────────────────────────────────────────────────

function displayLast(p) { return p?.shirt_name || p?.last || p?.name || ''; }

function clubBadge(club) {
  const raw = String(club || '');
  const name = raw.replace(/\s*\([A-Z]{3,4}\)\s*$/, '').trim();
  if (!name) return '';
  const cached = state.clubLogos?.[raw];
  if (cached?.badge) {
    return `<img class="club-crest" src="${escapeHtml(cached.badge)}" alt="" loading="lazy" onerror="this.outerHTML=window.__clubFallback(${JSON.stringify(name)})" />`;
  }
  return initialsBadge(name);
}
function initialsBadge(name) {
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<span class="club-badge" style="background:hsl(${hue},45%,28%);color:hsl(${hue},80%,82%);">${escapeHtml(initials)}</span>`;
}
window.__clubFallback = (name) => initialsBadge(String(name || ''));

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#ff6b6b;">Failed to load: ${err.message}</pre>`;
});
