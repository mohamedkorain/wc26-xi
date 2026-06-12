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
  // Leaderboard live (Phase 3 scoring deployed 2026-06-12)
  renderLeaderboard();
  renderTopPlayers();
  if (state.myUserId) renderMyRankCard();

  // If the visitor arrived via a share link (?squad=<entryId>), pop that
  // squad's viewer modal right away — no scrolling, no hunting.
  const sharedSquadId = new URLSearchParams(location.search).get('squad');
  if (sharedSquadId) openSquadModal(sharedSquadId);

  renderCalendar();
  // Update countdowns every minute (so the page flips to "locked" UX
  // without a refresh if the user is still here when the deadline hits)
  setInterval(() => { renderCalendar(); renderHeroStatus(); }, 60_000);

  // Players pool — background load
  hydrateFilters();
  renderPoolStats();

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
    renderCalendar();
    if (state.players.length) renderPool();
  });
  // Re-render leaderboard if user just set their display name
  window.addEventListener('displaynamechange', () => renderLeaderboard());

  // Leaderboard + rank card hidden pre-tournament
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
      <div class="mr-team">${escapeHtml(entry.team_name)}</div>
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

  // Pull both total points + per-match breakdowns so we can show per-player
  // points on each pitch slot.
  const [lbRow, scoreRows] = await Promise.all([
    supabase.from('leaderboard_totals').select('total_points')
      .eq('league_id', HALO_LEAGUE_ID).eq('user_id', state.myUserId).maybeSingle().then(r => r.data),
    supabase.from('scores').select('match_date, breakdown').eq('entry_id', entry.id).then(r => r.data || []),
  ]);
  const pts = lbRow?.total_points ?? 0;

  // Aggregate per-player stats across all matches scored.
  const playerStats = {};
  for (const row of scoreRows) {
    for (const [pname, st] of Object.entries(row.breakdown || {})) {
      if (!st || Object.keys(st).length === 0) continue;
      if (!playerStats[pname]) playerStats[pname] = { points: 0, st: {} };
      const p = (st.win||0) + (st.full90||0) + (st.goals||0) + (st.assists||0) + (st.cleanSheet||0) + (st.mvp||0) - (st.red ? 1 : 0);
      playerStats[pname].points += p;
      for (const k of ['goals','assists','cleanSheet','win','full90','mvp']) playerStats[pname].st[k] = (playerStats[pname].st[k] || 0) + (st[k] || 0);
      if (st.red) playerStats[pname].st.red = true;
    }
  }

  document.getElementById('mySquadStrip').style.display = '';
  document.getElementById('mySquadMeta').innerHTML =
    `${escapeHtml(entry.team_name)} · <b style="color:var(--accent);">${pts} pts</b>`;

  const xi = entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  // Pitch HTML — same +pts foot as /team.html; tooltip with localized breakdown.
  const isAr = document.documentElement.lang === 'ar';
  const ptsLabel = isAr ? 'نقاط' : 'pts';
  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    const name = displayLast(item) || '?';
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    const extra = name.length >= 13 ? 'letter-spacing:-0.3px;max-width:140px;' : '';
    const ps = playerStats[item.name];
    let foot = '';
    let tooltipAttr = '';
    if (ps) {
      const cls = ps.points > 0 ? 'pos' : ps.points < 0 ? 'neg' : '';
      foot = `<div class="ps-pts ${cls}">${ps.points >= 0 ? '+' : ''}${ps.points}</div>`;
      const txt = describeStatTextLocal(ps.st);
      tooltipAttr = ` title="${escapeHtml((ps.points >= 0 ? '+' : '') + ps.points + ' ' + ptsLabel + (txt ? '  ·  ' + txt : ''))}"`;
    }
    return `<div class="pitch-slot filled"${tooltipAttr} style="left:${coord.x}%;top:${coord.y}%;">
      <div class="ps-flag">${flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' })}</div>
      <div class="ps-name" style="font-size:${sz}px;${extra}">${escapeHtml(name)}</div>
      <div class="ps-tag">${coord.tag}</div>
      ${foot}
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

  const squadUrl = `https://halloamrika.saba7okorah.com/?squad=${entry.id}`;
  const shareText = encodeURIComponent(
    `🏆 I built my HALLO AMRIKA fantasy XI: "${entry.team_name}"\n\nSee my squad + build yours: ${squadUrl}`
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

// Localized hover-tooltip text: "Win, 90', Goal x2" / "فوز، ٩٠ دقيقة، جول×٢"
function describeStatTextLocal(s) {
  const parts = [];
  if (s.win)        parts.push(t('pts.win'));
  if (s.full90)     parts.push(t('pts.full90'));
  if (s.goals)      parts.push(`${t('pts.goal')}${s.goals > 1 ? '×' + s.goals : ''}`);
  if (s.assists)    parts.push(`${t('pts.assist')}${s.assists > 1 ? '×' + s.assists : ''}`);
  if (s.cleanSheet) parts.push(t('pts.cleansheet'));
  if (s.mvp)        parts.push(t('pts.mvp'));
  if (s.red)        parts.push(t('pts.red'));
  return parts.join(document.documentElement.lang === 'ar' ? '، ' : ', ');
}

// Kept for callers that still want the emoji fallback
function flagFromCode(code) {
  const team = state.teams.find(t => t.code === code);
  return team?.flag || '';
}

// WC26 round schedule — kickoff of the FIRST match of each round
// (UTC ISO timestamps). Source: FIFA published schedule.
// Adjust if FIFA tweaks times — easy 1-line edits below.
const TOURNAMENT_SCHEDULE = [
  { key: 'gw1',     dateUTC: '2026-06-11T19:00:00Z' }, // Mexico opener, Azteca
  { key: 'gw2',     dateUTC: '2026-06-14T16:00:00Z' }, // MD2 first match
  { key: 'gw3',     dateUTC: '2026-06-17T16:00:00Z' }, // MD3 first match
  { key: 'r32',     dateUTC: '2026-06-28T16:00:00Z' },
  { key: 'r16',     dateUTC: '2026-07-04T16:00:00Z' },
  { key: 'qf',      dateUTC: '2026-07-09T20:00:00Z' },
  { key: 'sf',      dateUTC: '2026-07-14T20:00:00Z' },
  { key: 'final',   dateUTC: '2026-07-19T19:00:00Z' },
];

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  const isArabic = document.documentElement.lang === 'ar';
  const locale = isArabic ? 'ar-EG' : 'en-GB';
  const tzLabel = isArabic ? 'القاهرة' : 'Cairo';
  const now = Date.now();
  grid.innerHTML = TOURNAMENT_SCHEDULE.map(row => {
    const ts = new Date(row.dateUTC).getTime();
    const isPast = ts <= now;
    const cairo = new Date(ts).toLocaleString(locale, {
      timeZone: 'Africa/Cairo',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
    const remaining = formatRemaining(ts - now);
    const cls = isPast ? 'cal-row past' : 'cal-row';
    return `
      <div class="${cls}">
        <div class="cal-name">${t('cal.round.' + row.key)}</div>
        <div class="cal-date">${cairo} <span class="cal-tz">${tzLabel}</span></div>
        <div class="cal-cd">${isPast ? '<span class="cal-locked">🔒 ' + t('cal.locked') + '</span>' : '⏱️ ' + remaining}</div>
      </div>
    `;
  }).join('');
}

function formatRemaining(ms) {
  if (ms <= 0) return '';
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}${t('cal.d')} ${h}${t('cal.h')}`;
  if (h > 0) return `${h}${t('cal.h')} ${m}${t('cal.m')}`;
  return `${m}${t('cal.m')}`;
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
  const txOpen = state.league.transfers_open_until ? new Date(state.league.transfers_open_until) : null;
  const banner = document.getElementById('lockBanner');
  const ctaBuild = document.getElementById('ctaBuild');
  const inTransferWindow = txOpen && now < txOpen;

  if (now >= lock && !inTransferWindow) {
    // Hard-locked (transfer window has also closed)
    ctaBuild.style.display = 'none';
    if (state.myUserId) {
      el.innerHTML = '';
      if (banner) banner.style.display = 'none';
    } else {
      el.textContent = '🔒 ' + (t('spin.locked')?.replace('🔒 ','') || 'Submissions locked');
      if (banner) {
        banner.textContent = t('lock.banner');
        banner.style.display = 'block';
      }
    }
    return;
  }

  // Past initial lock but still in transfer window — late-joiners can still
  // build via the randomizer. CTA stays visible for them.
  if (now >= lock && inTransferWindow) {
    if (banner) banner.style.display = 'none';
    ctaBuild.style.display = '';
    const isAr = document.documentElement.lang === 'ar';
    el.textContent = isAr
      ? `الميركاتو مفتوح · يقفل ${txOpen.toLocaleString('ar-EG')}`
      : `Transfer window open · closes ${txOpen.toLocaleString()}`;
    return;
  }
  // Pre-lock: banner should be hidden regardless of sign-in
  if (banner) banner.style.display = 'none';
  const diffMs = lock - now;
  const totalMins = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const isAr = document.documentElement.lang === 'ar';
  let remaining;
  if (days > 0) {
    remaining = isAr ? `${days} يوم ${hours} ساعة` : `${days}d ${hours}h`;
  } else if (hours > 0) {
    remaining = isAr ? `${hours} ساعة ${mins} دقيقة` : `${hours}h ${mins}m`;
  } else {
    remaining = isAr ? `${mins} دقيقة` : `${mins}m`;
  }
  const lockStr = lock.toLocaleString();
  el.textContent = isAr
    ? `التشكيلات مفتوحة · تقفل خلال ${remaining} (${lockStr})`
    : `Submissions open · locks in ${remaining} (${lockStr})`;
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
      .from('profile_displays').select('id, display_name').in('id', newIds);
    for (const p of profs || []) profiles[p.id] = p;
  }
  for (const r of rows || []) {
    r.ownerName = profiles[r.user_id]?.display_name || '—';
  }

  state.lbRows.push(...(rows || []));
  state.lbLoaded += (rows || []).length;

  document.getElementById('lbTable').innerHTML = state.lbRows.map((r, i) => `
    <div class="lb-row clickable${r.user_id === state.myUserId ? ' me' : ''}" data-entry="${r.entry_id}">
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-team">${escapeHtml(r.team_name)}</div>
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

// Top players widget on the homepage. Aggregates per-player stats from the
// scores.breakdown JSONB across all entries (one match per player counted via
// a (player, match_date) Set dedup, since many entries picked the same player).
async function renderTopPlayers() {
  const board = document.getElementById('topPlayersBoard');
  if (!board) return;
  const { data: rows } = await supabase
    .from('scores')
    .select('match_date, breakdown')
    .order('match_date', { ascending: false })
    .limit(20000);
  if (!rows || rows.length === 0) return;

  const seen = new Set();
  const agg = {};
  for (const r of rows) {
    const md = r.match_date;
    for (const [pname, st] of Object.entries(r.breakdown || {})) {
      const key = `${pname}::${md}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!agg[pname]) agg[pname] = { goals: 0, assists: 0, cs: 0, mvp: 0, red: 0, points: 0, matches: 0 };
      const s = st || {};
      const pts = (s.win||0) + (s.full90||0) + (s.goals||0) + (s.assists||0) + (s.cleanSheet||0) + (s.mvp||0) - (s.red ? 1 : 0);
      agg[pname].goals    += s.goals    || 0;
      agg[pname].assists  += s.assists  || 0;
      agg[pname].cs       += s.cleanSheet || 0;
      agg[pname].mvp      += s.mvp || 0;
      agg[pname].red      += s.red ? 1 : 0;
      agg[pname].points   += pts;
      agg[pname].matches  += 1;
    }
  }

  const top = Object.entries(agg)
    .map(([name, st]) => ({ name, ...st }))
    .sort((a, b) => b.points - a.points || b.goals - a.goals)
    .slice(0, 20);
  if (top.length === 0) return;

  const flipName = (raw) => {
    const parts = raw.split(' ');
    if (parts.length < 2) return raw;
    return `${parts.slice(1).join(' ')} ${parts[0]}`;
  };
  board.innerHTML = top.map((p, i) => `
    <div class="pl-row">
      <span class="pl-rank">${i + 1}</span>
      <span class="pl-name"><b>${escapeHtml(flipName(p.name))}</b><br/><span class="pl-nation">${p.matches} ${p.matches === 1 ? 'match' : 'matches'}</span></span>
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
}

async function openSquadModal(entryId) {
  const [entryRes, scoresRes, fixturesRes] = await Promise.all([
    supabase.from('entries').select('*').eq('id', entryId).maybeSingle(),
    supabase.from('scores').select('match_date, points, breakdown').eq('entry_id', entryId),
    state._fixturesCache || fetch('data/fixtures.json').then(r => r.json()).then(d => { state._fixturesCache = Promise.resolve(d); return d; }),
  ]);
  const entry = entryRes.data;
  if (!entry) return;
  const fixturesData = fixturesRes;
  const scoreRows = scoresRes.data || [];

  // Aggregate player points across all this entry's scored matches
  const playerStats = {};   // playerName → {points, matches: [{date, breakdown, pts}]}
  for (const row of scoreRows) {
    for (const [pname, st] of Object.entries(row.breakdown || {})) {
      if (!playerStats[pname]) playerStats[pname] = { points: 0, lines: [] };
      const pts = (st.win||0) + (st.full90||0) + (st.goals||0) + (st.assists||0) + (st.cleanSheet||0) + (st.mvp||0) - (st.red ? 1 : 0);
      playerStats[pname].points += pts;
      if (Object.keys(st).length > 0) {
        playerStats[pname].lines.push({ date: row.match_date, pts, st });
      }
    }
  }

  const totalPts = scoreRows.reduce((s, r) => s + (r.points || 0), 0);
  const xi = entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  function describeStat(s) {
    const parts = [];
    if (s.goals) parts.push(`⚽${s.goals}`);
    if (s.assists) parts.push(`🎁${s.assists}`);
    if (s.cleanSheet) parts.push('🧤');
    if (s.win) parts.push('✅');
    if (s.full90) parts.push('⏱️');
    if (s.mvp) parts.push('⭐');
    if (s.red) parts.push('🟥');
    return parts.join(' ');
  }

  // Some nations are spelled differently in fixtures.json vs xi_json roster.
  // Map our roster spelling → the fixtures.json spelling.
  const FIXTURE_NATION_ALIAS = {
    'DR Congo':              'Congo DR',
    'Cape Verde':            'Cape Verde Islands',
    'Bosnia and Herzegovina':'Bosnia & Herzegovina',
    'Turkey':                'Türkiye',
    'United States':         'USA',
  };
  function nextMatchFor(nation) {
    const fxNation = FIXTURE_NATION_ALIAS[nation] || nation;
    const now = new Date();
    const upcoming = (fixturesData.fixtures || []).find(f =>
      (f.home === fxNation || f.away === fxNation) && new Date(f.date) > now
    );
    if (!upcoming) return null;
    const opponent = upcoming.home === fxNation ? upcoming.away : upcoming.home;
    return `vs ${escapeHtml(opponent)}`;
  }

  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    const name = displayLast(item) || '?';
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    const extra = name.length >= 13 ? 'letter-spacing:-0.3px;max-width:140px;' : '';
    const stats = playerStats[item.name];
    const hasPlayed = stats && stats.lines.length > 0;
    let foot = '';
    if (hasPlayed) {
      const pts = stats.points;
      const cls = pts > 0 ? 'pos' : pts < 0 ? 'neg' : '';
      const icons = stats.lines.map(l => describeStat(l.st)).filter(Boolean).join(' ');
      foot = `<div class="ps-pts ${cls}">${pts >= 0 ? '+' : ''}${pts}</div>` +
             (icons ? `<div class="ps-icons">${icons}</div>` : '');
    } else {
      const next = nextMatchFor(item.nation);
      if (next) foot = `<div class="ps-next">${next}</div>`;
    }
    return `<div class="pitch-slot filled" style="left:${coord.x}%;top:${coord.y}%;">
      <div class="ps-flag">${flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' })}</div>
      <div class="ps-name" style="font-size:${sz}px;${extra};direction:ltr;">${escapeHtml(name)}</div>
      <div class="ps-tag">${coord.tag}</div>
      ${foot}
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
      <p class="modal-sub"><b style="color:var(--accent);">${totalPts} pts</b></p>
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
