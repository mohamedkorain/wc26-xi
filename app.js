// WC26 XI — draft a starting eleven, one nation at a time.
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';

// ─── formations ──────────────────────────────────────────────────────────────
// Coordinates are percentages of the pitch (0,0 = top-left).
// GK is at the bottom (defending goal closest to viewer); attack goes UP.
// `pos` is the position used to match Wikipedia squad data (GK/DF/MF/FW).
// `tag` is the on-pitch label.

const FORMATIONS = {
  '4-3-3': {
    desc: 'Classic. Wide forwards, midfield trio.',
    slots: [
      { pos: 'GK', tag: 'GK', x: 50, y: 90 },
      { pos: 'DF', tag: 'LB', x: 15, y: 72 },
      { pos: 'DF', tag: 'CB', x: 37, y: 72 },
      { pos: 'DF', tag: 'CB', x: 63, y: 72 },
      { pos: 'DF', tag: 'RB', x: 85, y: 72 },
      { pos: 'MF', tag: 'CM', x: 25, y: 50 },
      { pos: 'MF', tag: 'CM', x: 50, y: 50 },
      { pos: 'MF', tag: 'CM', x: 75, y: 50 },
      { pos: 'FW', tag: 'LW', x: 22, y: 22 },
      { pos: 'FW', tag: 'ST', x: 50, y: 14 },
      { pos: 'FW', tag: 'RW', x: 78, y: 22 },
    ],
  },
  '4-4-2': {
    desc: 'Two banks of four, two strikers.',
    slots: [
      { pos: 'GK', tag: 'GK', x: 50, y: 90 },
      { pos: 'DF', tag: 'LB', x: 15, y: 72 },
      { pos: 'DF', tag: 'CB', x: 37, y: 72 },
      { pos: 'DF', tag: 'CB', x: 63, y: 72 },
      { pos: 'DF', tag: 'RB', x: 85, y: 72 },
      { pos: 'MF', tag: 'LM', x: 15, y: 48 },
      { pos: 'MF', tag: 'CM', x: 38, y: 48 },
      { pos: 'MF', tag: 'CM', x: 62, y: 48 },
      { pos: 'MF', tag: 'RM', x: 85, y: 48 },
      { pos: 'FW', tag: 'ST', x: 36, y: 18 },
      { pos: 'FW', tag: 'ST', x: 64, y: 18 },
    ],
  },
  '4-2-3-1': {
    desc: 'Double pivot, attacking ten.',
    slots: [
      { pos: 'GK', tag: 'GK', x: 50, y: 90 },
      { pos: 'DF', tag: 'LB', x: 15, y: 72 },
      { pos: 'DF', tag: 'CB', x: 37, y: 72 },
      { pos: 'DF', tag: 'CB', x: 63, y: 72 },
      { pos: 'DF', tag: 'RB', x: 85, y: 72 },
      { pos: 'MF', tag: 'CDM', x: 35, y: 56 },
      { pos: 'MF', tag: 'CDM', x: 65, y: 56 },
      { pos: 'MF', tag: 'LAM', x: 22, y: 34 },
      { pos: 'MF', tag: 'CAM', x: 50, y: 34 },
      { pos: 'MF', tag: 'RAM', x: 78, y: 34 },
      { pos: 'FW', tag: 'ST', x: 50, y: 14 },
    ],
  },
  '3-5-2': {
    desc: 'Three at the back, wing-backs, two up top.',
    slots: [
      { pos: 'GK', tag: 'GK', x: 50, y: 90 },
      { pos: 'DF', tag: 'CB', x: 25, y: 72 },
      { pos: 'DF', tag: 'CB', x: 50, y: 72 },
      { pos: 'DF', tag: 'CB', x: 75, y: 72 },
      { pos: 'MF', tag: 'LWB', x: 12, y: 50 },
      { pos: 'MF', tag: 'CM', x: 32, y: 48 },
      { pos: 'MF', tag: 'CM', x: 50, y: 50 },
      { pos: 'MF', tag: 'CM', x: 68, y: 48 },
      { pos: 'MF', tag: 'RWB', x: 88, y: 50 },
      { pos: 'FW', tag: 'ST', x: 36, y: 16 },
      { pos: 'FW', tag: 'ST', x: 64, y: 16 },
    ],
  },
  '3-4-3': {
    desc: 'Three at the back, three forwards.',
    slots: [
      { pos: 'GK', tag: 'GK', x: 50, y: 90 },
      { pos: 'DF', tag: 'CB', x: 25, y: 72 },
      { pos: 'DF', tag: 'CB', x: 50, y: 72 },
      { pos: 'DF', tag: 'CB', x: 75, y: 72 },
      { pos: 'MF', tag: 'LM', x: 15, y: 50 },
      { pos: 'MF', tag: 'CM', x: 38, y: 50 },
      { pos: 'MF', tag: 'CM', x: 62, y: 50 },
      { pos: 'MF', tag: 'RM', x: 85, y: 50 },
      { pos: 'FW', tag: 'LW', x: 22, y: 22 },
      { pos: 'FW', tag: 'ST', x: 50, y: 14 },
      { pos: 'FW', tag: 'RW', x: 78, y: 22 },
    ],
  },
};

// Picks drawn from each FIFA pot in order (3 from Pot 1, 3 from Pot 2, 3 from Pot 3, 2 from Pot 4).
const PICKS_PER_POT = [3, 3, 3, 2];

// ─── state ───────────────────────────────────────────────────────────────────

const state = {
  teams: [],            // [{name, code, group, flag, pot}]
  players: {},          // nation name → [{no, pos, name, captain, ...}]
  formation: '4-3-3',
  xi: [],               // length 11 — null or {player, nation}
  usedNations: new Set(),
  currentNation: null,  // drawn, not yet drafted
  round: 1,
  spinning: false,
  league: null,         // { id, code, name, locked_at } if ?league=CODE in URL
};

// ─── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  const [teams, players] = await Promise.all([
    fetch('data/teams.json').then(r => r.json()),
    fetch('data/players.json').then(r => r.json()),
  ]);
  state.teams = teams.teams;
  for (const n of players.nations) state.players[n.name] = n.players;

  renderFormationGrid();
  wireSetup();
  wireGame();
  await mountAuthWidget(document.getElementById('authSlot'));
  await loadLeagueFromUrl();
}

async function loadLeagueFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('league') || '').toUpperCase();
  const banner = document.getElementById('leagueBanner');
  if (!code) { banner.classList.add('hidden'); return; }
  const { data: lg } = await supabase
    .from('leagues').select('*').eq('code', code).maybeSingle();
  if (!lg) {
    banner.textContent = `League "${code}" not found.`;
    banner.classList.remove('hidden');
    return;
  }
  state.league = lg;
  const locked = new Date(lg.locked_at) < new Date();
  banner.innerHTML = `Drafting for <b>${escapeHtml(lg.name)}</b>${locked ? ' · <b style="color:var(--danger);">submissions closed</b>' : ''}`;
  banner.classList.remove('hidden');
}

// ─── setup screen ────────────────────────────────────────────────────────────

function renderFormationGrid() {
  const grid = document.getElementById('formationGrid');
  grid.innerHTML = '';
  for (const [name, f] of Object.entries(FORMATIONS)) {
    const card = document.createElement('button');
    card.className = 'formation-card';
    card.dataset.name = name;
    card.innerHTML = `
      <div class="formation-card-name">${name}</div>
      <div class="formation-card-desc">${f.desc}</div>
    `;
    card.onclick = () => {
      state.formation = name;
      document.querySelectorAll('.formation-card')
        .forEach(c => c.classList.toggle('selected', c.dataset.name === name));
      document.getElementById('setupStart').disabled = false;
    };
    grid.appendChild(card);
  }
  // default-select 4-3-3
  grid.querySelector('[data-name="4-3-3"]').click();
}

function wireSetup() {
  document.getElementById('setupStart').onclick = startGame;
  document.getElementById('resetBtn').onclick = resetGame;
}

function startGame() {
  state.xi = FORMATIONS[state.formation].slots.map(() => null);
  state.usedNations = new Set();
  state.currentNation = null;
  state.round = 1;

  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('resultsScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  document.getElementById('formationTag').textContent = state.formation;
  renderPitch('pitch');
  showSpinPane();
  updateRoundPill();
  updateNeededHint();
}

function resetGame() {
  if (state.round > 1 && !confirm('Start over? Your current XI will be lost.')) return;
  document.getElementById('gameScreen').classList.add('hidden');
  document.getElementById('resultsScreen').classList.add('hidden');
  document.getElementById('setupScreen').classList.remove('hidden');
}

// ─── spin ────────────────────────────────────────────────────────────────────

function wireGame() {
  document.getElementById('spinBtn').onclick = spin;
  document.getElementById('draftSearch').oninput = renderPlayerList;
  document.getElementById('playAgainBtn').onclick = resetGame;
  document.getElementById('copyXIBtn').onclick = copyXI;
  document.getElementById('submitXIBtn').onclick = submitXI;
}

const POT_DESC = {
  1: 'Top seeds — Pot 1',
  2: 'Second seeds — Pot 2',
  3: 'Third seeds — Pot 3',
  4: 'Fourth seeds — Pot 4',
};

function showSpinPane() {
  document.getElementById('spinPane').classList.remove('hidden');
  document.getElementById('draftPane').classList.add('hidden');
  document.getElementById('spinBtn').disabled = false;
  const pot = currentPot();
  const remainingInPot = PICKS_PER_POT[pot - 1] - picksMadeInPot(pot);
  document.getElementById('potBanner').innerHTML =
    `${POT_DESC[pot]}<span class="pot-sub">${remainingInPot} pick${remainingInPot === 1 ? '' : 's'} left in this pot</span>`;
  document.getElementById('spinHint').textContent =
    'Spin to draw a nation from this pot, then draft a player.';
}

function picksMadeInPot(pot) {
  let made = 0;
  for (let p = 1; p < pot; p++) made += PICKS_PER_POT[p - 1];
  return state.round - 1 - made;
}

function showDraftPane() {
  document.getElementById('spinPane').classList.add('hidden');
  document.getElementById('draftPane').classList.remove('hidden');
  document.getElementById('draftSearch').value = '';
}

function currentPot() {
  let r = state.round;
  for (let i = 0; i < PICKS_PER_POT.length; i++) {
    if (r <= PICKS_PER_POT[i]) return i + 1;
    r -= PICKS_PER_POT[i];
  }
  return PICKS_PER_POT.length;
}

function spin() {
  if (state.spinning) return;
  const pot = currentPot();
  const available = state.teams.filter(t => t.pot === pot && !state.usedNations.has(t.name));
  if (!available.length) return;

  state.spinning = true;
  document.getElementById('spinBtn').disabled = true;
  const flagEl = document.getElementById('reelFlagVal');
  const nameEl = document.getElementById('reelTeamVal');
  document.getElementById('reelFlag').classList.add('spinning');
  document.querySelector('.reel-team').classList.add('spinning');

  // tumble through random teams from the current pot only
  const potTeams = state.teams.filter(t => t.pot === pot);
  const start = performance.now();
  const tumble = () => {
    const t = potTeams[Math.floor(Math.random() * potTeams.length)];
    flagEl.textContent = t.flag;
    nameEl.textContent = t.code;
    const elapsed = performance.now() - start;
    if (elapsed < 1200) {
      requestAnimationFrame(tumble);
    } else {
      // pick final
      const final = available[Math.floor(Math.random() * available.length)];
      flagEl.textContent = final.flag;
      nameEl.textContent = final.code;
      document.getElementById('reelFlag').classList.remove('spinning');
      document.querySelector('.reel-team').classList.remove('spinning');
      state.currentNation = final;
      state.usedNations.add(final.name);
      state.spinning = false;
      setTimeout(openDraft, 350);
    }
  };
  requestAnimationFrame(tumble);
}

// ─── draft ───────────────────────────────────────────────────────────────────

function openDraft() {
  const n = state.currentNation;
  document.getElementById('draftFlag').textContent = n.flag;
  document.getElementById('draftTeamName').textContent = n.name;
  document.getElementById('draftGroup').textContent = `Group ${n.group}`;
  showDraftPane();
  renderPlayerList();
}

function openPositions() {
  const slots = FORMATIONS[state.formation].slots;
  const open = new Set();
  for (let i = 0; i < slots.length; i++) {
    if (state.xi[i] == null) open.add(slots[i].pos);
  }
  return open;
}

function nextOpenSlotIndex(pos) {
  const slots = FORMATIONS[state.formation].slots;
  for (let i = 0; i < slots.length; i++) {
    if (state.xi[i] == null && slots[i].pos === pos) return i;
  }
  return -1;
}

function renderPlayerList() {
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  const players = state.players[state.currentNation.name] || [];
  const q = document.getElementById('draftSearch').value.toLowerCase().trim();
  const open = openPositions();

  for (const p of players) {
    if (q && !p.name.toLowerCase().includes(q)) continue;
    const disabled = !open.has(p.pos);
    const row = document.createElement('div');
    row.className = 'player-row' + (disabled ? ' disabled' : '');
    row.innerHTML = `
      <div class="pr-no">${p.no}</div>
      <div class="pr-meta">
        <div class="pr-name">${escapeHtml(p.name)}${p.captain ? '<span class="captain">© </span>' : ''}</div>
        <div class="pr-club">${escapeHtml(p.club)}</div>
      </div>
      <div class="pr-pos">${p.pos}</div>
      <div class="pr-caps">${p.caps}</div>
      <div class="pr-goals">${p.goals}</div>
    `;
    if (!disabled) {
      row.onclick = () => draftPlayer(p);
    }
    list.appendChild(row);
  }
  if (!list.children.length) {
    list.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center;font-size:13px;">No matching players.</div>';
  }
}

function draftPlayer(p) {
  const slotIdx = nextOpenSlotIndex(p.pos);
  if (slotIdx < 0) return;
  state.xi[slotIdx] = { player: p, nation: state.currentNation };
  state.currentNation = null;
  state.round += 1;
  renderPitch('pitch');
  updateRoundPill();
  updateNeededHint();
  if (state.xi.every(x => x != null)) {
    showResults();
  } else {
    showSpinPane();
  }
}

// ─── pitch render ────────────────────────────────────────────────────────────

function renderPitch(pitchId) {
  const pitch = document.getElementById(pitchId);
  // clear previous slot nodes (keep .pitch-lines)
  pitch.querySelectorAll('.slot').forEach(el => el.remove());

  const slots = FORMATIONS[state.formation].slots;
  // mark "next" slot = first unfilled
  const nextIdx = state.xi.findIndex(x => x == null);

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const filled = state.xi[i];
    const el = document.createElement('div');
    el.className = 'slot' + (filled ? '' : ' empty') + (i === nextIdx ? ' next' : '');
    el.style.left = s.x + '%';
    el.style.top = s.y + '%';
    if (filled) {
      el.innerHTML = `
        <div class="slot-pill">${escapeHtml(lastName(filled.player.name))}</div>
        <div class="slot-flag">${filled.nation.flag}</div>
        <div class="slot-pos">${s.tag}</div>
      `;
    } else {
      el.innerHTML = `
        <div class="slot-pill">${s.tag}</div>
        <div class="slot-pos">—</div>
      `;
    }
    pitch.appendChild(el);
  }
}

function lastName(full) {
  const parts = full.split(' ');
  return parts.length === 1 ? full : parts[parts.length - 1];
}

// ─── round/need hints ────────────────────────────────────────────────────────

function updateRoundPill() {
  const r = Math.min(state.round, 11);
  const pot = currentPot();
  document.getElementById('roundPill').textContent = `Round ${r}/11 · Pot ${pot}`;
}

function updateNeededHint() {
  const slots = FORMATIONS[state.formation].slots;
  const need = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (let i = 0; i < slots.length; i++) {
    if (state.xi[i] == null) need[slots[i].pos]++;
  }
  const parts = [];
  for (const k of ['GK', 'DF', 'MF', 'FW']) {
    if (need[k]) parts.push(`${need[k]} ${k}`);
  }
  document.getElementById('neededHint').textContent =
    parts.length ? `Still need: ${parts.join(' · ')}` : '';
}

// ─── results ─────────────────────────────────────────────────────────────────

async function showResults() {
  document.getElementById('gameScreen').classList.add('hidden');
  document.getElementById('resultsScreen').classList.remove('hidden');
  renderPitch('resultsPitch');
  const uniqueNations = new Set(state.xi.map(x => x.nation.name)).size;
  document.getElementById('resultsSub').textContent =
    `11 players · ${uniqueNations} nation${uniqueNations === 1 ? '' : 's'} · ${state.formation}`;

  const submitBox = document.getElementById('submitBox');
  if (!state.league) {
    submitBox.classList.add('hidden');
    return;
  }
  const user = await currentUser();
  const locked = new Date(state.league.locked_at) < new Date();
  const submitMsg = document.getElementById('submitMsg');
  document.getElementById('submitLeagueLabel').textContent = state.league.name;

  if (locked) {
    submitBox.classList.add('hidden');
    return;
  }
  if (!user) {
    submitBox.classList.remove('hidden');
    submitMsg.innerHTML = `<a href="login.html" style="color:var(--accent);">Sign in</a> to submit this XI to ${escapeHtml(state.league.name)}.`;
    document.getElementById('submitXIBtn').disabled = true;
    return;
  }
  submitBox.classList.remove('hidden');
  submitMsg.textContent = '';
  document.getElementById('submitXIBtn').disabled = false;
}

async function submitXI() {
  const teamName = document.getElementById('submitTeamName').value.trim();
  const submitMsg = document.getElementById('submitMsg');
  if (!teamName) { submitMsg.style.color = 'var(--danger)'; submitMsg.textContent = 'Pick a team name.'; return; }
  const user = await currentUser();
  if (!user || !state.league) return;

  const payload = {
    league_id: state.league.id,
    user_id: user.id,
    team_name: teamName,
    formation: state.formation,
    xi_json: state.xi.map((item, i) => ({
      slot: i,
      tag: FORMATIONS[state.formation].slots[i].tag,
      pos: item.player.pos,
      no: item.player.no,
      name: item.player.name,
      captain: item.player.captain,
      club: item.player.club,
      nation: item.nation.name,
      nation_code: item.nation.code,
    })),
  };

  // Ensure I'm a member (idempotent)
  await supabase.from('league_members').insert({ league_id: state.league.id, user_id: user.id });

  // Upsert on (league_id, user_id) unique
  const { error } = await supabase.from('entries').upsert(payload, {
    onConflict: 'league_id,user_id',
  });

  if (error) {
    submitMsg.style.color = 'var(--danger)';
    submitMsg.textContent = error.message;
    return;
  }
  submitMsg.style.color = 'var(--accent)';
  submitMsg.innerHTML = `Submitted! <a href="league.html?code=${encodeURIComponent(state.league.code)}" style="color:var(--accent);">View league →</a>`;
  document.getElementById('submitXIBtn').disabled = true;
}

function copyXI() {
  const slots = FORMATIONS[state.formation].slots;
  const lines = [`My WC26 XI (${state.formation})`, ''];
  for (let i = 0; i < slots.length; i++) {
    const item = state.xi[i];
    if (!item) continue;
    lines.push(`${slots[i].tag.padEnd(4)}  ${item.player.name}  (${item.nation.code})`);
  }
  lines.push('', 'wc26-xi');
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyXIBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ─── utils ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#ff6b6b;">Failed to load: ${err.message}</pre>`;
});
