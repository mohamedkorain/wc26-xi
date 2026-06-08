// HALO AMRIKA — randomizer squad builder.
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';

// Fixed 4-4-2 squad: 1 GK / 2 CB / 2 FB / 2 CM / 2 WIN / 2 ST / 1 WILD
const SLOTS = [
  { tag: 'GK',  role: 'GK',  wild: false },
  { tag: 'CB',  role: 'CB',  wild: false },
  { tag: 'CB',  role: 'CB',  wild: false },
  { tag: 'FB',  role: 'FB',  wild: false },
  { tag: 'FB',  role: 'FB',  wild: false },
  { tag: 'CM',  role: 'CM',  wild: false },
  { tag: 'CM',  role: 'CM',  wild: false },
  { tag: 'WIN', role: 'WIN', wild: false },
  { tag: 'WIN', role: 'WIN', wild: false },
  { tag: 'ST',  role: 'ST',  wild: false },
  { tag: 'ST',  role: 'ST',  wild: false },
  { tag: 'WILD', role: null, wild: true },
];

const ALL_ROLES = ['GK','CB','FB','CM','WIN','ST'];

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

function spin() {
  if (state.spinning || state.locked) return;
  const slotIdx = nextOpenSlotIndex();
  if (slotIdx < 0) { setHint('Squad complete — name it and submit.'); return; }
  const slot = SLOTS[slotIdx];

  // What role + nation can we pick?
  // For named slots: role is fixed. For wildcard: random role from any with eligible players.
  // Must have at least one un-picked player matching.
  const candidate = pickRandomNationAndRole(slot);
  if (!candidate) {
    setHint('No eligible players left for this slot. Try again?');
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
      setTimeout(() => showCandidates(slotIdx, candidate), 250);
    }
  };
  requestAnimationFrame(tumble);
}

function pickRandomNationAndRole(slot) {
  // Need to honor: ≥1 Arab if this is the last slot and we have no Arab yet.
  const haveArab = state.squad.some(s => s && s.nation.arab);
  const slotIdx = nextOpenSlotIndex();
  const isLast = slotIdx === SLOTS.length - 1;

  // Candidate role pool
  const rolePool = slot.wild ? ALL_ROLES.slice() : [slot.role];

  // Candidate nation pool — start with all teams not yet exhausted for the role
  const pickedPlayerKeys = new Set(
    state.squad.filter(Boolean).map(s => `${s.nation.name}|${s.player.name}`)
  );

  let nationPool = state.teams.slice();
  // Filter to Arab-only on the last slot if Arab constraint unsatisfied
  if (isLast && !haveArab) nationPool = nationPool.filter(t => t.arab);

  // Shuffle role pool, then find a nation that has eligible players matching
  shuffle(rolePool);
  for (const role of rolePool) {
    const nations = nationPool.filter(t => {
      const players = state.byNation[t.name] || [];
      return players.some(p =>
        p.roles.includes(role) &&
        !pickedPlayerKeys.has(`${t.name}|${p.name}`)
      );
    });
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

function showCandidates(slotIdx, spin) {
  const card = document.getElementById('candidatesCard');
  card.style.display = '';
  document.getElementById('candHead').innerHTML =
    `${spin.nation.flag} ${spin.nation.name} <span style="color:var(--accent);font-weight:800;">${spin.role}</span>`;
  const list = document.getElementById('candidates');
  list.innerHTML = '';
  for (const p of spin.candidates) {
    const row = document.createElement('div');
    row.className = 'cand-row';
    row.innerHTML = `
      <div class="cand-no">${p.no ?? ''}</div>
      <div>
        <div class="cand-name">${escapeHtml(p.name)}</div>
        <div class="cand-club">${escapeHtml(p.club || '')}</div>
      </div>
      <span class="cand-pick">PICK</span>
    `;
    row.onclick = () => pickPlayer(slotIdx, p, spin.nation);
    list.appendChild(row);
  }
}

function pickPlayer(slotIdx, player, nation) {
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
  renderSlots();
  renderConstraints();
  updateSubmitState();
  const slotIdx = nextOpenSlotIndex();
  if (slotIdx < 0) {
    setHint('Squad complete — name it and submit below.');
    document.getElementById('spinBtn').disabled = true;
  } else if (state.locked) {
    setHint('🔒 Submissions are locked.');
    document.getElementById('spinBtn').disabled = true;
  } else {
    setHint(`Round ${slotIdx + 1} of 12 — next slot: ${SLOTS[slotIdx].tag}`);
  }
}

function renderSlots() {
  const grid = document.getElementById('slotsGrid');
  const next = nextOpenSlotIndex();
  grid.innerHTML = SLOTS.map((s, i) => {
    const item = state.squad[i];
    const isNext = i === next;
    const cls = ['slot-card'];
    if (s.wild) cls.push('wild');
    if (item) cls.push('filled');
    if (isNext) cls.push('next');
    if (item) {
      return `<div class="${cls.join(' ')}">
        <div class="slot-tag">${s.tag}</div>
        <div class="slot-name">${escapeHtml(lastName(item.player.name))}</div>
        <div class="slot-nation">${item.nation.flag} ${item.nation.code}</div>
      </div>`;
    }
    return `<div class="${cls.join(' ')}">
      <div class="slot-tag">${s.tag}</div>
      <div class="slot-empty">${isNext ? '⟵ next' : 'empty'}</div>
    </div>`;
  }).join('');
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
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#ff6b6b;">Failed to load: ${err.message}</pre>`;
});
