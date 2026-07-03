// My Team page — detailed pitch view + per-match score breakdown.

import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';
import { setLang, t } from './js/i18n.js?v=20260703-r16';
import { flagImg } from './js/flags.js';

mountAuthWidget(document.getElementById('authSlot'));

document.getElementById('langToggle').onclick = () => {
  const cur = document.documentElement.lang === 'ar' ? 'en' : 'ar';
  setLang(cur);
  document.getElementById('langToggle').textContent = cur === 'ar' ? 'English' : 'عربي';
  if (state.entry) renderEntry();
};

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';
const FIXTURES_DATA_URL = 'data/fixtures.json?v=20260703-r16';
const R16_OUT_COUNT = 4;
const R16_IN_COUNT = 2;

// Slot order MUST match xi_json's convention (the same one audience.js uses):
//   0 GK · 1 LCB · 2 RCB · 3 LB · 4 RB · 5 LCM · 6 RCM
//   7 LW · 8 RW · 9 LST · 10 RST
const PITCH_COORDS = [
  { x: 50, y: 90, tag: 'GK'  },
  { x: 37, y: 72, tag: 'CB'  }, { x: 63, y: 72, tag: 'CB' },
  { x: 13, y: 72, tag: 'FB'  }, { x: 87, y: 72, tag: 'FB' },
  { x: 38, y: 48, tag: 'CM'  }, { x: 62, y: 48, tag: 'CM' },
  { x: 13, y: 48, tag: 'WIN' }, { x: 87, y: 48, tag: 'WIN' },
  { x: 36, y: 18, tag: 'ST'  }, { x: 64, y: 18, tag: 'ST' },
];

const state = {
  user: null,
  entry: null,
  league: null,
  fixtures: [],
  scores: [],
  matches: [],
  nations: {},
  players: [],   // flat list, loaded lazily on first transfer-modal open
};

const MAX_TRANSFERS = 2;

(async () => {
  const u = await currentUser();
  state.user = u;
  if (!u) {
    document.getElementById('signinPrompt').style.display = 'block';
    document.getElementById('teamHero').style.display = 'none';
    return;
  }

  const [entryRes, leagueRes, fixturesRes, teamsRes, matchesRes] = await Promise.all([
    supabase.from('entries')
      .select('id, team_name, formation, submitted_at, xi_json, xi_json_gw1, xi_json_gw2, xi_json_gw3, xi_json_r32, transfers_used')
      .eq('league_id', HALO_LEAGUE_ID).eq('user_id', u.id).maybeSingle(),
    supabase.from('leagues')
      .select('id, name, locked_at, transfers_open_until')
      .eq('id', HALO_LEAGUE_ID).maybeSingle(),
    fetch(FIXTURES_DATA_URL).then(r => r.json()),
    fetch('data/teams.json').then(r => r.json()),
    supabase
      .from('matches')
      .select('external_id, date, home, away, status, home_goals, away_goals, scored_at')
      .order('date', { ascending: false })
      .limit(180),
  ]);
  state.league = leagueRes.data;

  if (!entryRes.data) {
    document.getElementById('teamHero').innerHTML = `
      <div class="strip-inner" style="max-width:520px;text-align:center;padding:32px 16px;">
        <h2 class="strip-title">${t('team.notyet.title')}</h2>
        <p class="strip-note">${t('team.notyet.sub')}</p>
        <a href="index.html" class="hero-cta">${t('tab.home')}</a>
      </div>
    `;
    return;
  }

  state.entry = entryRes.data;
  state.fixtures = fixturesRes.fixtures || [];
  state.matches = matchesRes.data || [];
  for (const tm of teamsRes.teams) state.nations[tm.name] = tm;

  const { data: scoreRows } = await supabase
    .from('scores')
    .select('match_date, points, breakdown')
    .eq('entry_id', state.entry.id)
    .order('match_date', { ascending: true });
  state.scores = scoreRows || [];

  renderEntry();
  renderTransferBar();
})();

function renderTransferBar() {
  const bar = document.getElementById('transferBar');
  if (!bar || !state.league) return;
  const openUntil = state.league.transfers_open_until ? new Date(state.league.transfers_open_until) : null;
  const isOpen = openUntil && new Date() < openUntil;
  if (!isOpen) { bar.style.display = 'none'; return; }
  const used = state.entry.transfers_used || 0;
  const left = Math.max(0, MAX_TRANSFERS - used);
  const closesAt = openUntil.toLocaleString(document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
  bar.style.display = '';
  bar.innerHTML = `
    <div class="tx-window-warning">${t('tx.r16.warn')}</div>
    <div class="tx-left">
      <div class="tx-counter"><span class="tx-num">${left}</span><span class="tx-num-label">${t('tx.left')}</span></div>
      <div class="tx-closes">${escapeHtml(closesAt)}</div>
    </div>
    <div class="tx-actions">
      <button class="tx-btn tx-btn-secondary" id="openWildBtn">${t('tx.wild.btn')}</button>
      <button class="tx-btn" id="openTxBtn" ${left === 0 ? 'disabled' : ''}>${t('tx.btn')}</button>
    </div>
  `;
  const btn = document.getElementById('openTxBtn');
  if (btn) btn.onclick = openTransferModal;
  const wildBtn = document.getElementById('openWildBtn');
  if (wildBtn) wildBtn.onclick = openWildcardSwapModal;
}

// Global per-player tournament points, populated on first transfer-modal open.
// Map: "PLAYER NAME" → total points.
let globalPlayerPts = null;
let globalPlayerOwnership = { total: 0, byName: {}, byKey: {} };

function ownershipKey(playerName, nation) {
  return `${playerName || ''}\u001f${nation || ''}`;
}

function formatOwnershipPct(owners, total) {
  if (!owners || !total) return '';
  const pct = (owners / total) * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${Math.round(pct * 10) / 10}%`;
}

function ownershipLabel(playerName, nation) {
  const owners = globalPlayerOwnership.byKey[ownershipKey(playerName, nation)] ??
    globalPlayerOwnership.byName[playerName] ?? 0;
  const pct = formatOwnershipPct(owners, globalPlayerOwnership.total);
  if (!pct) return '';
  return document.documentElement.lang === 'ar' ? `${pct} امتلاك` : `${pct} owned`;
}

async function ensurePlayersLoaded() {
  if (state.players.length > 0) return;
  const data = await (await fetch('data/players.json')).json();
  for (const nation of data.nations) {
    const code = state.nations[nation.name]?.code || nation.code || '';
    for (const p of nation.players) {
      state.players.push({
        ...p,
        nation: nation.name,
        nation_code: code,
        arab: nation.arab === true,
        category: nation.category,
      });
    }
  }
}

function playerKey(p) {
  return `${p?.no || ''}|${p?.nation || ''}|${p?.name || ''}`;
}

function playerSame(a, b) {
  return a && b && a.name === b.name && a.nation === b.nation;
}

function playerFromPool(p) {
  return state.players.find(candidate => playerSame(candidate, p));
}

function slotRole(slot) {
  return PITCH_COORDS[Number(slot)]?.tag || '';
}

function bucketForRole(role) {
  if (role === 'GK' || role === 'ST') return 'GK_ST';
  if (role === 'CB' || role === 'FB') return 'DEF';
  if (role === 'CM' || role === 'WIN') return 'MID';
  return '';
}

function playerRoles(p) {
  if (!p) return [];
  const fromPool = playerFromPool(p);
  return fromPool?.roles || p.roles || (p.role ? [p.role] : []);
}

async function fetchPlayerOwnershipCounts() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('player_ownership_counts')
      .select('player_name, nation, owners')
      .eq('league_id', HALO_LEAGUE_ID)
      .order('player_name', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return [];
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadGlobalPlayerPts() {
  if (globalPlayerPts) return globalPlayerPts;
  // Server-side aggregated view — one query instead of paginating 37k+ rows.
  const [pointsRes, ownershipRes, countRes] = await Promise.all([
    supabase
      .from('player_leaderboard')
      .select('player_name, total_points')
      .order('total_points', { ascending: false })
      .limit(2000),   // covers every WC26 player who has scored
    fetchPlayerOwnershipCounts(),
    supabase.rpc('entry_count', { p_league_id: HALO_LEAGUE_ID }),
  ]);
  const totals = {};
  for (const r of pointsRes.data || []) totals[r.player_name] = r.total_points;
  const byName = {};
  const byKey = {};
  for (const row of ownershipRes || []) {
    byName[row.player_name] = (byName[row.player_name] || 0) + (row.owners || 0);
    byKey[ownershipKey(row.player_name, row.nation)] = row.owners || 0;
  }
  globalPlayerOwnership = {
    total: countRes.data || 0,
    byName,
    byKey,
  };
  globalPlayerPts = totals;
  return totals;
}

// R16 transfer flow:
//  Step 1 — pick exactly 4 starter slots OUT.
//  Step 2 — choose exactly 2 of those slots to refill with same-role players.
//  Step 3 — confirm. Remaining 2 removed slots become explicit empty slots.
async function openTransferModal() {
  await ensurePlayersLoaded();
  await loadGlobalPlayerPts();

  const xi = state.entry.xi_json || [];
  const starters = xi
    .filter(p => !p.wild && !p.empty)
    .sort((a, b) => Number(a.slot) - Number(b.slot));
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:620px;">
      <button class="modal-x" id="txX">×</button>
      <h2 class="modal-title">${t('tx.title')}</h2>
      <p class="modal-sub" id="txProgress">${t('tx.r16.rule')}</p>

      <div class="tx-step" id="txOutPanel">
        <div class="tx-step-label">${t('tx.outpick')}</div>
        <p class="modal-sub" id="txOutHint" style="margin:0 0 8px;"></p>
        <div class="tx-out-list" id="txOutList"></div>
        <button class="tx-btn" id="txOutContinue" style="width:100%;margin-top:12px;" disabled>${t('tx.next')}</button>
      </div>

      <div class="tx-step" id="txInPanel" style="display:none;">
        <div class="tx-step-label" id="txInLabel">${t('tx.inpick')}</div>
        <div class="tx-refill-list" id="txRefillList"></div>
        <input type="search" id="txSearch" placeholder="${t('tx.search')}" class="tx-search" />
        <div class="tx-in-list" id="txInList"></div>
      </div>

      <div class="tx-summary" id="txSummary" style="display:none;">
        <div class="tx-step-label">${t('tx.confirm')}</div>
        <div id="txSwapsView"></div>
        <button class="tx-btn" id="txConfirmBtn" style="width:100%;margin-top:12px;">${t('tx.confirm')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('txX').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  const selectedOut = [];
  const refills = [];
  let activeOut = null;

  function renderOutList() {
    const selected = new Set(selectedOut);
    const html = starters
      .map(p => txRowHtml(p, true, selected.has(p))).join('');
    document.getElementById('txOutList').innerHTML = html;
    document.getElementById('txOutHint').textContent = t('tx.outcount', {
      picked: selectedOut.length,
      total: R16_OUT_COUNT,
    });
    document.getElementById('txOutContinue').disabled = selectedOut.length !== R16_OUT_COUNT;
    document.querySelectorAll('#txOutList .tx-row').forEach(btn => {
      btn.onclick = () => {
        const pick = starters.find(p => String(p.slot) === btn.dataset.slot);
        if (!pick) return;
        const idx = selectedOut.indexOf(pick);
        if (idx >= 0) {
          selectedOut.splice(idx, 1);
        } else if (selectedOut.length < R16_OUT_COUNT) {
          selectedOut.push(pick);
        }
        renderOutList();
      };
    });
  }

  function showInPanel() {
    activeOut = selectedOut.find(p => !refills.some(r => r.out === p)) || null;
    document.getElementById('txProgress').textContent = t('tx.incount', {
      picked: refills.length,
      total: R16_IN_COUNT,
    });
    document.getElementById('txOutPanel').style.display = 'none';
    document.getElementById('txInPanel').style.display = '';
    document.getElementById('txSearch').value = '';
    document.getElementById('txSummary').style.display = 'none';
    renderRefillSlots();
    renderInCandidates();
  }

  function renderRefillSlots() {
    document.getElementById('txRefillList').innerHTML = selectedOut.map(out => {
      const refill = refills.find(r => r.out === out);
      const active = activeOut === out ? ' selected' : '';
      const status = refill
        ? `${escapeHtml(displayLast(refill.in))}`
        : (refills.length >= R16_IN_COUNT ? escapeHtml(t('tx.empty.slot')) : escapeHtml(t('tx.pick.slot')));
      return `
        <button class="tx-row${active}" data-slot="${out.slot}" style="grid-template-columns:44px 24px 1fr auto;">
          <span class="tx-row-pos">${escapeHtml(out.role || slotRole(out.slot))}</span>
          <span class="tx-row-flag">${flagImg(out.nation_code, { width: 20, cls: 'flag-img', fallback: '' })}</span>
          <span class="tx-row-name">
            <b>${escapeHtml(displayLast(out))}</b>
            <span class="tx-row-meta">${escapeHtml(out.nation)}</span>
          </span>
          <span class="tx-row-next">${status}</span>
        </button>
      `;
    }).join('');

    document.querySelectorAll('#txRefillList .tx-row').forEach(btn => {
      btn.onclick = () => {
        const pick = selectedOut.find(p => String(p.slot) === btn.dataset.slot);
        if (!pick || refills.some(r => r.out === pick) || refills.length >= R16_IN_COUNT) return;
        activeOut = pick;
        renderRefillSlots();
        renderInCandidates();
      };
    });

    document.getElementById('txInLabel').textContent = activeOut
      ? `${t('tx.inpick')}: ${displayLast(activeOut)} (${activeOut.nation})`
      : t('tx.inpick');
  }

  function renderInCandidates() {
    const list = document.getElementById('txInList');
    if (refills.length >= R16_IN_COUNT) {
      showSummary();
      return;
    }
    if (!activeOut) {
      list.innerHTML = `<div class="tx-empty">${t('tx.pick.slot')}</div>`;
      return;
    }
    const out = activeOut;
    const q = (document.getElementById('txSearch').value || '').toLowerCase().trim();
    const outRole = out.role || slotRole(out.slot);
    const requiredRoles = new Set([outRole]);

    // Players already in the squad + players being transferred OUT this session
    // are excluded, except the selected OUT players whose slots are being freed.
    const inUseIds = new Set();
    const outSet = new Set(selectedOut);
    for (const p of xi) {
      if (!p.empty && !outSet.has(p)) inUseIds.add(playerKey(p));
    }
    for (const r of refills) {
      if (r.in) inUseIds.add(playerKey(r.in));
    }

    const NATION_CAP = 3;
    const nationCount = {};
    for (const p of xi) {
      if (p.empty || outSet.has(p)) continue;
      nationCount[p.nation] = (nationCount[p.nation] || 0) + 1;
    }
    for (const r of refills) {
      if (!r.in) continue;
      nationCount[r.in.nation] = (nationCount[r.in.nation] || 0) + 1;
    }

    let filtered = state.players.filter(p => {
      const id = p.no + '|' + p.nation + '|' + p.name;
      if (inUseIds.has(id)) return false;
      if ((nationCount[p.nation] || 0) >= NATION_CAP) return false;
      const roles = new Set(p.roles || [p.role].filter(Boolean));
      if (![...requiredRoles].some(r => roles.has(r))) return false;
      if (q && !(p.name?.toLowerCase().includes(q) || (p.club || '').toLowerCase().includes(q))) return false;
      return true;
    });
    filtered.sort((a, b) => (globalPlayerPts?.[b.name] || 0) - (globalPlayerPts?.[a.name] || 0));

    if (filtered.length === 0) {
      list.innerHTML = `<div class="tx-empty">—</div>`;
      return;
    }
    list.innerHTML = filtered.slice(0, 100).map(p => txRowHtml(p, false)).join('');
    list.querySelectorAll('.tx-row.in').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const pick = filtered.find(p => playerKey(p) === id);
        if (!pick) return;
        refills.push({ out: activeOut, in: pick });
        activeOut = selectedOut.find(p => !refills.some(r => r.out === p)) || null;
        if (refills.length >= R16_IN_COUNT) {
          showSummary();
        } else {
          renderRefillSlots();
          renderInCandidates();
        }
      };
    });
  }

  function showSummary() {
    document.getElementById('txProgress').textContent = t('tx.summary.r16');
    document.getElementById('txOutPanel').style.display = 'none';
    document.getElementById('txInPanel').style.display = 'none';
    document.getElementById('txSummary').style.display = '';
    document.getElementById('txSwapsView').innerHTML = selectedOut.map(out => {
      const refill = refills.find(r => r.out === out);
      const inHtml = refill ? `
        ${flagImg(refill.in.nation_code, { width: 20, cls: 'flag-img', fallback: '' })}
        <b>${escapeHtml(displayLast(refill.in))}</b>
      ` : `<b>${escapeHtml(t('tx.empty.slot'))}</b>`;
      return `
      <div class="tx-swap-pair">
        <div class="tx-swap-side">
          <span class="tx-row-pos">${out.role || slotRole(out.slot)}</span>
          ${flagImg(out.nation_code, { width: 20, cls: 'flag-img', fallback: '' })}
          <b>${escapeHtml(displayLast(out))}</b>
        </div>
        <span class="tx-swap-arrow">→</span>
        <div class="tx-swap-side">
          ${inHtml}
        </div>
      </div>
    `;
    }).join('');
    document.getElementById('txConfirmBtn').onclick = () => commitR16Transfers(selectedOut, refills, modal);
  }

  document.getElementById('txSearch').addEventListener('input', renderInCandidates);
  document.getElementById('txOutContinue').onclick = showInPanel;
  renderOutList();
}

async function openWildcardSwapModal() {
  await ensurePlayersLoaded();
  await loadGlobalPlayerPts();

  const xi = state.entry.xi_json || [];
  const wild = xi.find(p => p.wild && !p.empty);
  const roles = playerRoles(wild);
  const starters = xi
    .filter(p => !p.wild)
    .filter(p => roles.includes(p.role || slotRole(p.slot)))
    .sort((a, b) => Number(a.slot) - Number(b.slot));

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:620px;">
      <button class="modal-x" id="wildX">×</button>
      <h2 class="modal-title">${t('tx.wild.title')}</h2>
      <p class="modal-sub">${t('tx.wild.sub')}</p>
      ${wild ? `
        <div class="tx-wild-card">
          <span class="tx-row-pos">WILD</span>
          ${flagImg(wild.nation_code, { width: 22, cls: 'flag-img', fallback: '' })}
          <b>${escapeHtml(displayLast(wild))}</b>
          <span>${escapeHtml(roles.join(' / ') || wild.nation)}</span>
        </div>
      ` : ''}
      <div class="tx-step">
        <div class="tx-step-label">${t('tx.wild.pick')}</div>
        <div class="tx-out-list" id="wildSwapList">
          ${starters.length ? starters.map(p => p.empty ? txEmptyRowHtml(p) : txRowHtml(p, true)).join('') : `<div class="tx-empty">${t('tx.wild.none')}</div>`}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('wildX').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  document.querySelectorAll('#wildSwapList .tx-row').forEach(btn => {
    btn.onclick = () => {
      const starter = starters.find(p => String(p.slot) === btn.dataset.slot);
      if (!starter || !wild) return;
      commitWildcardSwap(wild, starter, modal);
    };
  });
}

async function commitWildcardSwap(wild, starter, modal) {
  const starterRole = starter.role || slotRole(starter.slot);
  const wildAsStarter = {
    ...wild,
    slot: starter.slot,
    tag: starter.tag || starterRole,
    role: starterRole,
    wild: false,
    bucket: starter.bucket || bucketForRole(starterRole),
    empty: false,
  };
  const starterAsWild = starter.empty
    ? {
        slot: 11,
        tag: 'WILD',
        role: null,
        bucket: 'WILD',
        wild: true,
        empty: true,
      }
    : {
        ...starter,
        slot: 11,
        tag: 'WILD',
        role: null,
        wild: true,
        bucket: 'WILD',
      };
  const newXi = (state.entry.xi_json || []).map(p => {
    if (p === starter) return wildAsStarter;
    if (p === wild) return starterAsWild;
    return p;
  });

  const update = { xi_json: newXi };
  if (!state.entry.xi_json_gw1) {
    update.xi_json_gw1 = state.entry.xi_json;
  }
  const { error } = await supabase
    .from('entries')
    .update(update)
    .eq('id', state.entry.id);
  if (error) { alert('Wildcard swap failed: ' + error.message); return; }
  if (modal) modal.remove();
  alert(t('tx.wild.success'));
  location.reload();
}

function emptySlotFor(out) {
  const role = out.role || slotRole(out.slot);
  return {
    slot: Number(out.slot),
    tag: out.tag || role,
    role,
    bucket: out.bucket || bucketForRole(role),
    wild: false,
    empty: true,
  };
}

function txEmptyRowHtml(p) {
  const role = p.role || slotRole(p.slot);
  return `
    <button class="tx-row" data-slot="${p.slot}">
      <span class="tx-row-pos">${escapeHtml(role)}</span>
      <span class="tx-row-flag"></span>
      <span class="tx-row-name">
        <b>${escapeHtml(t('tx.empty.slot'))}</b>
        <span class="tx-row-meta">${escapeHtml(t('slot.empty'))}</span>
      </span>
      <span class="tx-row-pts">0</span>
      <span class="tx-row-next"></span>
    </button>
  `;
}

function playerInSlot(out, inn) {
  const role = out.role || slotRole(out.slot);
  return {
    ...out,
    no: inn.no,
    name: inn.name,
    shirt_name: inn.shirt_name,
    first: inn.first,
    last: inn.last,
    club: inn.club,
    nation: inn.nation,
    nation_code: inn.nation_code,
    category: inn.category,
    arab: inn.arab,
    slot: Number(out.slot),
    tag: out.tag || role,
    role,
    bucket: out.bucket || bucketForRole(role),
    wild: false,
    empty: false,
  };
}

async function commitR16Transfers(selectedOut, refills, modal) {
  if (selectedOut.length !== R16_OUT_COUNT || refills.length !== R16_IN_COUNT) {
    alert(t('tx.invalid.r16'));
    return;
  }

  const outSet = new Set(selectedOut);
  const newXi = (state.entry.xi_json || []).map(p => {
    if (!outSet.has(p)) return p;
    const refill = refills.find(r => r.out === p);
    return refill ? playerInSlot(p, refill.in) : emptySlotFor(p);
  });

  const update = { xi_json: newXi, transfers_used: (state.entry.transfers_used || 0) + 2 };
  if (!state.entry.xi_json_gw1) {
    update.xi_json_gw1 = state.entry.xi_json;
  }
  const { error } = await supabase
    .from('entries')
    .update(update)
    .eq('id', state.entry.id);
  if (error) { alert('Transfer failed: ' + error.message); return; }
  alert(t('tx.success'));
  location.reload();
}

// Render one row of the transfer modal — used for BOTH the OUT list (current
// squad) and the IN list (candidates). Shows: flag · pos · name (club) ·
// nation small · pts · next match.
function txRowHtml(p, isOut, selected = false) {
  const pos = p.wild ? 'WILD' : (p.role || (p.roles && p.roles[0]) || '');
  const pts = globalPlayerPts?.[p.name] || 0;
  const ownership = ownershipLabel(p.name, p.nation);
  const next = nextGameFor(p.nation);
  const flag = flagImg(p.nation_code, { width: 20, cls: 'flag-img', fallback: '' });
  const meta = [
    escapeHtml(p.nation),
    p.club ? escapeHtml(p.club) : '',
    ownership ? escapeHtml(ownership) : '',
  ].filter(Boolean).join(' · ');
  return `
    <button class="tx-row${isOut ? '' : ' in'}${selected ? ' selected' : ''}" ${isOut ? `data-slot="${p.slot}" data-wild="${p.wild ? 1 : 0}"` : `data-id="${escapeHtml(playerKey(p))}"`}>
      <span class="tx-row-pos">${pos}</span>
      <span class="tx-row-flag">${flag}</span>
      <span class="tx-row-name">
        <b>${escapeHtml(displayLast(p))}</b>
        <span class="tx-row-meta">${meta}</span>
      </span>
      <span class="tx-row-pts">${pts > 0 ? '+' + pts : pts}</span>
      <span class="tx-row-next">${next ? escapeHtml(next.label) : ''}</span>
    </button>
  `;
}

// (Old two-swap helpers replaced by commitR16Transfers + the R16 flow inside
// openTransferModal.)

function renderEntry() {
  const total = state.scores.reduce((sum, s) => sum + (s.points || 0), 0);

  document.getElementById('teamMeta').innerHTML = `
    <div>
      <div class="tm-name">${escapeHtml(state.entry.team_name)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">${t('team.totalpts')}</div>
      <div class="tm-pts">${total}</div>
    </div>
  `;

  const scoreRowByDate = {};
  for (const row of state.scores) scoreRowByDate[row.match_date] = row;

  // Pitch
  const xi = state.entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    if (item?.empty) {
      return `<div class="pitch-slot empty" style="left:${coord.x}%;top:${coord.y}%;direction:ltr;">
        <div class="ps-empty">${escapeHtml(t('slot.empty'))}</div>
        <div class="ps-tag">${escapeHtml(coord.tag || item.role || '')}</div>
      </div>`;
    }
    const name = displayLast(item) || '?';
    const next = nextGameFor(item.nation);
    const stats = statsForFixture(item, next, scoreRowByDate);
    let foot = '';
    if (stats) {
      const cls = stats.points > 0 ? 'pos' : stats.points < 0 ? 'neg' : '';
      foot = `<div class="ps-pts ${cls}">${stats.points >= 0 ? '+' : ''}${stats.points}</div>`;
    } else if (next) {
      foot = next.scored
        ? `<div class="ps-pts" style="color:var(--text-dim);">0</div>`
        : `<div class="next-game ${next.live ? 'live' : ''}">${next.label}</div>`;
    }
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    return `<div class="pitch-slot filled" style="left:${coord.x}%;top:${coord.y}%;direction:ltr;">
      <div class="ps-flag">${flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' })}</div>
      <div class="ps-name" style="font-size:${sz}px;">${escapeHtml(name)}</div>
      <div class="ps-tag">${coord.tag}</div>
      ${foot}
    </div>`;
  }).join('');

  const benchHtml = wild ? `
    <div class="bench-label">${t('squad.bench') || 'Wildcard'}</div>
    <div class="bench-slot filled">
      <span>${flagImg(wild.nation_code, { width: 20, cls: 'flag-img', fallback: '' })} <b>${escapeHtml(displayLast(wild))}</b>
        <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(wild.club || '')}</span>
      </span>
    </div>
  ` : '';

  document.getElementById('teamPitch').innerHTML = `
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
  `;

  // Per-match breakdown lives on the homepage (which renders the GW1
  // lineup). On /team.html the breakdown box is repurposed for the
  // TRANSFER HISTORY — a diff of xi_json_gw1 (the squad as it was at
  // GW1 lock) against the current xi_json (post-transfer).
  const bd = document.getElementById('teamBreakdown');
  if (bd) bd.innerHTML = renderTransferHistoryHtml();
}

function renderTransferHistoryHtml() {
  const gw1Xi = state.entry.xi_json_gw1;
  const gw2Xi = state.entry.xi_json_gw2;
  const gw3Xi = state.entry.xi_json_gw3;
  const r32Xi = state.entry.xi_json_r32;
  const currentXi = state.entry.xi_json || [];

  const groups = [];
  if (gw1Xi && gw2Xi) {
    groups.push({ from: 'MD1', to: 'MD2', rows: transferDiffs(gw1Xi, gw2Xi) });
  } else if (gw1Xi) {
    groups.push({ from: 'MD1', to: 'MD2', rows: transferDiffs(gw1Xi, currentXi) });
  }
  if (gw2Xi && gw3Xi) {
    groups.push({ from: 'MD2', to: 'MD3', rows: transferDiffs(gw2Xi, gw3Xi) });
  } else if (gw2Xi) {
    groups.push({ from: 'MD2', to: 'MD3', rows: transferDiffs(gw2Xi, currentXi) });
  }
  if (gw3Xi && r32Xi) {
    groups.push({ from: 'MD3', to: 'R32', rows: transferDiffs(gw3Xi, r32Xi) });
  } else if (gw3Xi) {
    groups.push({ from: 'MD3', to: 'R32', rows: transferDiffs(gw3Xi, currentXi) });
  }
  if (r32Xi) {
    groups.push({ from: 'R32', to: 'R16', rows: transferDiffs(r32Xi, currentXi) });
  }
  const visibleGroups = groups.filter(group => group.rows.length > 0);

  if (!visibleGroups.length) {
    return `
      <h3>${t('tx.hist.title')}</h3>
      <div style="text-align:center;color:var(--text-dim);font-size:13px;padding:8px 0;">
        ${t('tx.hist.empty')}
      </div>
    `;
  }

  return `
    <h3>${t('tx.hist.title')}</h3>
    ${visibleGroups.map(group => `
      <div class="tx-hist-md">${t('tx.hist.md', { from: group.from, to: group.to })}</div>
      ${group.rows.map(transferRowHtml).join('')}
    `).join('')}
  `;
}

function transferDiffs(oldXi, newXi) {
  const swaps = [];
  for (let i = 0; i < newXi.length; i++) {
    const a = oldXi[i], b = newXi[i];
    if (!a || !b) continue;
    if (a.name !== b.name || a.nation !== b.nation) {
      swaps.push({ out: a, in: b });
    }
  }
  return swaps;
}

function transferRowHtml(s) {
  const inSide = s.in?.empty ? `
    <b>${escapeHtml(t('tx.empty.slot'))}</b>
    <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(s.in.role || '')}</span>
  ` : `
    ${flagImg(s.in.nation_code, { width: 20, cls: 'flag-img', fallback: '' })}
    <b>${escapeHtml(displayLast(s.in))}</b>
    <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(s.in.nation)}</span>
  `;
  return `
    <div class="tx-swap-pair">
      <div class="tx-swap-side">
        <span class="tx-row-pos">${s.out.wild ? 'WILD' : s.out.role}</span>
        ${flagImg(s.out.nation_code, { width: 20, cls: 'flag-img', fallback: '' })}
        <b>${escapeHtml(displayLast(s.out))}</b>
        <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(s.out.nation)}</span>
      </div>
      <span class="tx-swap-arrow">→</span>
      <div class="tx-swap-side">
        ${inSide}
      </div>
    </div>
  `;
}

const FIXTURE_NATION_ALIAS = {
  'DR Congo':              'Congo DR',
  'Cape Verde':            'Cape Verde Islands',
  'Bosnia and Herzegovina':'Bosnia & Herzegovina',
  'Turkey':                'Türkiye',
  'United States':         'USA',
};
// /team.html shows the current squad phase. After the MD2 transfer deadline,
// each player resolves to their current-MD fixture: scored fixtures show
// points/0, and unscored fixtures stay as "vs OPP".
function nextGameFor(nation) {
  const fxNation = FIXTURE_NATION_ALIAS[nation] || nation;
  const txClose = state.league?.transfers_open_until
    ? new Date(state.league.transfers_open_until)
    : new Date();
  const isNation = f => f.home === fxNation || f.away === fxNation;
  const upcoming = state.fixtures.find(f => isNation(f) && new Date(f.date) >= txClose)
    || state.fixtures.find(f => isNation(f) && new Date(f.date) > new Date());
  if (!upcoming) return null;
  const opponent = upcoming.home === fxNation ? upcoming.away : upcoming.home;
  const dbMatch = state.matches.find(m => String(m.external_id) === String(upcoming.id)) || {};
  return { fixture: upcoming, label: `vs ${opponent}`, live: dbMatch.status === 'live', scored: Boolean(dbMatch.scored_at) };
}

function redCardCount(st) {
  if (!st?.red) return 0;
  return Math.abs(Number(st.red)) || 1;
}

function pointsFromStatLine(st) {
  return (st.win || 0)
    + (st.full90 || 0)
    + (st.goals || 0)
    + (st.assists || 0)
    + (st.cleanSheet || 0)
    + (st.mvp || 0)
    + (st.r32 || 0)
    - redCardCount(st);
}

function statsForFixture(item, match, scoreRowByDate) {
  if (!match?.fixture || !match.scored) return null;
  const row = scoreRowByDate[(match.fixture.date || '').slice(0, 10)];
  const st = row?.breakdown?.[item.name];
  if (!st || Object.keys(st).length === 0) return null;
  return { points: pointsFromStatLine(st), st };
}

function displayLast(item) {
  // build.js stores .shirt_name typically; fall back to last word of name
  if (item.shirt_name) return item.shirt_name;
  return (item.name || '').split(' ')[0] || '';
}

function displayPlayerNameShort(raw) {
  return (raw || '').split(' ')[0] || raw;
}

function roundShort(round) {
  if (!round) return '';
  const isAr = document.documentElement.lang === 'ar';
  if (round.includes('Group Stage - 1')) return isAr ? 'الجولة ١' : 'MD1';
  if (round.includes('Group Stage - 2')) return isAr ? 'الجولة ٢' : 'MD2';
  if (round.includes('Group Stage - 3')) return isAr ? 'الجولة ٣' : 'MD3';
  if (round.includes('Round of 32'))     return isAr ? 'دور الـ٣٢' : 'R32';
  if (round.includes('Round of 16'))     return isAr ? 'دور الـ١٦' : 'R16';
  if (round.includes('Quarter'))         return isAr ? 'ربع نهائي' : 'QF';
  if (round.includes('Semi'))            return isAr ? 'نصف نهائي' : 'SF';
  if (round.toLowerCase() === 'final')   return isAr ? 'النهائي'   : 'Final';
  return round;
}

function describeStat(s) {
  // Used in the match-breakdown card. Keeps the emoji-shortform here
  // because the rows are tight; the on-pitch tooltip uses describeStatText().
  const parts = [];
  if (s.goals) parts.push(`⚽${s.goals}`);
  if (s.assists) parts.push(`🎁${s.assists}`);
  if (s.cleanSheet) parts.push('🧤');
  if (s.win) parts.push('✅');
  if (s.full90) parts.push('⏱️');
  if (s.mvp) parts.push('⭐');
  if (s.r32) parts.push('R32');
  if (s.red) parts.push('🟥');
  return parts.join(' ') || '—';
}

// Verbose, localized version used in pitch-slot hover tooltips:
//   "Win, 90', Goal x2"  /  "فوز، ٩٠ دقيقة، جول×٢"
function describeStatText(s) {
  const parts = [];
  if (s.win)        parts.push(t('pts.win'));
  if (s.full90)     parts.push(t('pts.full90'));
  if (s.goals)      parts.push(`${t('pts.goal')}${s.goals > 1 ? '×' + s.goals : ''}`);
  if (s.assists)    parts.push(`${t('pts.assist')}${s.assists > 1 ? '×' + s.assists : ''}`);
  if (s.cleanSheet) parts.push(t('pts.cleansheet'));
  if (s.mvp)        parts.push(t('pts.mvp'));
  if (s.r32)        parts.push(t('pts.r32'));
  if (s.red)        parts.push(t('pts.red'));
  return parts.join(document.documentElement.lang === 'ar' ? '، ' : ', ');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
