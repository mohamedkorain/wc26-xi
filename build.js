// HALO AMRIKA — randomizer squad builder.
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';

// 4-4-2 pitch positions for the 11 active starters; wildcard sits on bench.
// Coordinates are % of the pitch (0,0 top-left). GK at bottom, attack up.
const SLOTS = [
  { tag: 'GK',   role: 'GK',  wild: false, x: 50, y: 90 },
  { tag: 'LCB',  role: 'CB',  wild: false, x: 37, y: 70 },
  { tag: 'RCB',  role: 'CB',  wild: false, x: 63, y: 70 },
  { tag: 'LB',   role: 'FB',  wild: false, x: 13, y: 72 },
  { tag: 'RB',   role: 'FB',  wild: false, x: 87, y: 72 },
  { tag: 'LCM',  role: 'CM',  wild: false, x: 38, y: 48 },
  { tag: 'RCM',  role: 'CM',  wild: false, x: 62, y: 48 },
  { tag: 'LW',   role: 'WIN', wild: false, x: 13, y: 48 },
  { tag: 'RW',   role: 'WIN', wild: false, x: 87, y: 48 },
  { tag: 'ST',   role: 'ST',  wild: false, x: 36, y: 18 },
  { tag: 'ST',   role: 'ST',  wild: false, x: 64, y: 18 },
  { tag: 'WILD', role: null,  wild: true },
];

const ALL_ROLES = ['GK','CB','FB','CM','WIN','ST'];
const ROLE_TARGETS = { GK:1, CB:2, FB:2, CM:2, WIN:2, ST:2 };

const state = {
  teams: [],          // [{name,code,flag,category,arab}]
  byNation: {},       // nation name → players list (with .roles)
  league: null,
  user: null,
  squad: Array(12).fill(null),     // each: {slot, player, nation}
  spin: null,         // current spin: {nation:{name,code,flag,arab}, role}
  spinning: false,
  locked: false,
};

// ─── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  state.user = await currentUser();
  if (!state.user) { location.href = 'login.html'; return; }
  mountAuthWidget(document.getElementById('authSlot'));

  const [teams, players, league] = await Promise.all([
    fetch('data/teams.json').then(r => r.json()),
    fetch('data/players.json').then(r => r.json()),
    supabase.from('leagues').select('*').eq('id', HALO_LEAGUE_ID).maybeSingle(),
  ]);
  state.teams = teams.teams;
  for (const n of players.nations) state.byNation[n.name] = n.players;
  state.league = league.data;

  if (!state.league) {
    document.body.innerHTML = `<pre style="padding:30px;color:#ff6b6b;">HALO AMRIKA league not set up yet. Admin must run supabase/seed_halo.sql.</pre>`;
    return;
  }
  state.locked = new Date() >= new Date(state.league.locked_at);

  // Load existing entry (if user already has one)
  await loadExistingEntry();

  wireUI();
  renderAll();
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
      state.squad[item.slot] = { player, nation: team };
    }
  }
}

// ─── UI wiring ───────────────────────────────────────────────────────────────

function wireUI() {
  document.getElementById('spinBtn').onclick = spin;
  document.getElementById('rerollBtn').onclick = spin;
  document.getElementById('submitBtn').onclick = submit;
  document.getElementById('teamName').oninput = updateSubmitState;
}

// ─── spin ────────────────────────────────────────────────────────────────────

function nextOpenSlotIndex() {
  return state.squad.findIndex(s => s == null);
}

// Remaining capacity per named role; plus whether wildcard is still open.
function openRoleCounts() {
  const counts = { GK:0, CB:0, FB:0, CM:0, WIN:0, ST:0 };
  let wildOpen = false;
  for (let i = 0; i < SLOTS.length; i++) {
    if (state.squad[i] != null) continue;
    if (SLOTS[i].wild) wildOpen = true;
    else counts[SLOTS[i].role]++;
  }
  return { counts, wildOpen };
}

// Find which slot a picked player should fill given the rolled role.
// Prefer a matching named slot; otherwise wildcard.
function assignSlotIndex(role) {
  let i = SLOTS.findIndex((s, idx) => state.squad[idx] == null && !s.wild && s.role === role);
  if (i < 0) i = SLOTS.findIndex((s, idx) => state.squad[idx] == null && s.wild);
  return i;
}

function spin() {
  if (state.spinning || state.locked) return;

  const candidate = pickRandomNationAndRole();
  if (!candidate) {
    setHint('No eligible spin possible.');
    return;
  }

  // animate
  state.spinning = true;
  document.getElementById('spinBtn').disabled = true;
  document.getElementById('rerollBtn').disabled = true;
  document.getElementById('candidatesCard').style.display = 'none';
  document.getElementById('reelNation').classList.add('spinning');
  document.getElementById('reelRole').classList.add('spinning');

  const start = performance.now();
  const flagEl = document.getElementById('reelNationVal');
  const roleEl = document.getElementById('reelRoleVal');
  const tumble = () => {
    flagEl.textContent = state.teams[Math.floor(Math.random() * state.teams.length)].flag;
    roleEl.textContent = ALL_ROLES[Math.floor(Math.random() * ALL_ROLES.length)];
    if (performance.now() - start < 1100) {
      requestAnimationFrame(tumble);
    } else {
      flagEl.textContent = candidate.nation.flag + ' ' + candidate.nation.code;
      roleEl.textContent = candidate.role;
      document.getElementById('reelNation').classList.remove('spinning');
      document.getElementById('reelRole').classList.remove('spinning');
      state.spin = candidate;
      state.spinning = false;
      document.getElementById('spinBtn').disabled = true;     // stay disabled until pick or reroll
      document.getElementById('rerollBtn').disabled = false;
      setTimeout(() => showCandidates(candidate), 250);
    }
  };
  requestAnimationFrame(tumble);
}

function pickRandomNationAndRole() {
  // Randomizer chooses role + nation. We never reveal what slot the user is
  // filling — the role is the surprise. Rules:
  //   • Role is drawn from positions that still have capacity in the squad
  //     (e.g. if you already have both CBs, CB never rolls). If only the
  //     wildcard remains, role is drawn from all 6.
  //   • Nation is then drawn from teams that have a yet-unpicked player at
  //     that role. We skip nations that would leave us no eligible player.
  //   • If we're on the LAST pick and have no Arab yet, force the nation
  //     pool to Arab nations only.

  const { counts, wildOpen } = openRoleCounts();
  const totalOpen = Object.values(counts).reduce((a, b) => a + b, 0) + (wildOpen ? 1 : 0);
  if (totalOpen === 0) return null;

  const namedRolesOpen = Object.keys(counts).filter(r => counts[r] > 0);
  const onlyWildcardLeft = namedRolesOpen.length === 0 && wildOpen;

  const rolePool = onlyWildcardLeft ? ALL_ROLES.slice() : namedRolesOpen.slice();
  shuffle(rolePool);

  const haveArab = state.squad.some(s => s && s.nation.arab);
  const isLastSpin = totalOpen === 1;

  const pickedPlayerKeys = new Set(
    state.squad.filter(Boolean).map(s => `${s.nation.name}|${s.player.name}`)
  );

  for (const role of rolePool) {
    let nationPool = state.teams.slice();
    if (isLastSpin && !haveArab) nationPool = nationPool.filter(t => t.arab);

    const nations = nationPool.filter(t =>
      (state.byNation[t.name] || []).some(p =>
        p.roles.includes(role) && !pickedPlayerKeys.has(`${t.name}|${p.name}`)
      )
    );
    if (!nations.length) continue;

    const nation = nations[Math.floor(Math.random() * nations.length)];
    const candidates = (state.byNation[nation.name] || []).filter(p =>
      p.roles.includes(role) && !pickedPlayerKeys.has(`${nation.name}|${p.name}`)
    );
    return { nation, role, candidates };
  }
  return null;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// ─── candidates ──────────────────────────────────────────────────────────────

function showCandidates(spin) {
  const card = document.getElementById('candidatesCard');
  card.style.display = '';
  document.getElementById('candHead').innerHTML =
    `${spin.nation.flag} ${escapeHtml(spin.nation.name)} <span style="color:var(--accent);font-weight:800;">${spin.role}</span>`;
  const list = document.getElementById('candidates');
  list.innerHTML = '';
  for (const p of spin.candidates) {
    const row = document.createElement('div');
    row.className = 'cand-row';
    row.innerHTML = `
      <div class="cand-no">${p.no ?? ''}</div>
      <div class="cand-meta">
        <div class="cand-name">${escapeHtml(p.name)}</div>
        <div class="cand-club">${clubBadge(p.club)} <span>${escapeHtml(p.club || '')}</span></div>
      </div>
      <span class="cand-pick">PICK</span>
    `;
    row.onclick = () => pickPlayer(p, spin.nation, spin.role);
    list.appendChild(row);
  }
}

function pickPlayer(player, nation, role) {
  const slotIdx = assignSlotIndex(role);
  if (slotIdx < 0) return;  // shouldn't happen
  state.squad[slotIdx] = { player, nation };
  state.spin = null;
  document.getElementById('candidatesCard').style.display = 'none';
  document.getElementById('reelNationVal').textContent = '🌍';
  document.getElementById('reelRoleVal').textContent = '—';
  document.getElementById('spinBtn').disabled = false;
  document.getElementById('rerollBtn').disabled = false;
  renderAll();
}

// ─── render ──────────────────────────────────────────────────────────────────

function renderAll() {
  renderPitch();
  renderConstraints();
  updateSubmitState();
  const filled = state.squad.filter(Boolean).length;
  if (filled >= 12) {
    setHint('Squad complete — name it and submit below.');
    document.getElementById('spinBtn').disabled = true;
  } else if (state.locked) {
    setHint('🔒 Submissions are locked.');
    document.getElementById('spinBtn').disabled = true;
  } else {
    setHint(`${filled} of 12 picked — spin to draw your next nation + position.`);
  }
}

function renderPitch() {
  const pitch = document.getElementById('pitch442');
  pitch.innerHTML = '';
  // pitch background lines
  pitch.innerHTML = `
    <div class="pl-box pl-box-top"></div>
    <div class="pl-box pl-box-bottom"></div>
    <div class="pl-circle"></div>
    <div class="pl-halfway"></div>
  `;
  for (let i = 0; i < SLOTS.length; i++) {
    const s = SLOTS[i];
    if (s.wild) continue;
    const item = state.squad[i];
    const node = document.createElement('div');
    node.className = 'pitch-slot' + (item ? ' filled' : ' empty');
    node.style.left = s.x + '%';
    node.style.top = s.y + '%';
    if (item) {
      node.innerHTML = `
        <div class="ps-name">${escapeHtml(lastName(item.player.name))}</div>
        <div class="ps-meta">${item.nation.flag} <span>${s.tag}</span></div>
      `;
    } else {
      node.innerHTML = `
        <div class="ps-empty">${s.tag}</div>
      `;
    }
    pitch.appendChild(node);
  }
  // wildcard on bench
  const bench = document.getElementById('bench');
  const wildItem = state.squad[11];
  bench.innerHTML = `
    <div class="bench-label">BENCH · Wildcard</div>
    <div class="bench-slot ${wildItem ? 'filled' : 'empty'}">
      ${wildItem
        ? `<span>${wildItem.nation.flag} <b>${escapeHtml(wildItem.player.name)}</b> <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(wildItem.player.club || '')}</span></span>`
        : `<span>Wildcard slot — last pick, any position</span>`}
    </div>
  `;
}

function renderConstraints() {
  const filled = state.squad.filter(Boolean).length;
  const arab = state.squad.filter(s => s && s.nation.arab).length;
  document.getElementById('constraints').innerHTML = `
    <div class="constraint-line">12 players drafted
      <span class="${filled === 12 ? 'ok' : 'bad'}">${filled}/12</span>
    </div>
    <div class="constraint-line">≥1 Arab player
      <span class="${arab >= 1 ? 'ok' : 'bad'}">${arab}</span>
    </div>
    <div class="constraint-line">Formation
      <span class="ok">4-4-2</span>
    </div>
  `;
}

function updateSubmitState() {
  const filled = state.squad.filter(Boolean).length;
  const arab = state.squad.some(s => s && s.nation.arab);
  const name = document.getElementById('teamName').value.trim();
  const ok = filled === 12 && arab && name.length > 0 && !state.locked;
  document.getElementById('submitBtn').disabled = !ok;
}

function setHint(t) { document.getElementById('spinHint').textContent = t; }

// ─── submit ──────────────────────────────────────────────────────────────────

async function submit() {
  const name = document.getElementById('teamName').value.trim();
  const msg = document.getElementById('submitMsg');
  msg.style.color = 'var(--accent-2)';
  msg.textContent = 'Saving…';

  const payload = {
    league_id: HALO_LEAGUE_ID,
    user_id: state.user.id,
    team_name: name,
    formation: '4-4-2',
    xi_json: state.squad.map((item, i) => ({
      slot: i,
      tag: SLOTS[i].tag,
      role: SLOTS[i].role,
      wild: SLOTS[i].wild,
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
    msg.style.color = 'var(--danger)';
    msg.textContent = error.message;
    return;
  }
  msg.style.color = 'var(--accent)';
  msg.innerHTML = `Squad saved! <a href="index.html#leaderboard" style="color:var(--accent);">View leaderboard →</a> (You can still tinker until ${new Date(state.league.locked_at).toLocaleString()}.)`;
}

// ─── utils ───────────────────────────────────────────────────────────────────

function lastName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length === 1 ? full : parts[parts.length - 1];
}

// Initials-in-circle placeholder for club logos (real crests TBD).
function clubBadge(club) {
  const name = String(club || '').replace(/\s*\([A-Z]{3,4}\)\s*$/, '').trim();
  if (!name) return '';
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  // deterministic color from name
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
