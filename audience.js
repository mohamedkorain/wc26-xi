// HALLO AMRIKA audience view — public, read-only.
import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';
import { t } from './js/i18n.js?v=20260713-qf4';
import { flagImg } from './js/flags.js';

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';
const LB_PAGE_SIZE = 20;
const MATCHDAY_REFRESH_MS = 60_000;
const FIXTURES_DATA_URL = 'data/fixtures.json?v=20260713-qf4';
const MD2_FIRST_KICKOFF = new Date('2026-06-18T16:00:00.000Z');
const MD3_FIRST_KICKOFF = new Date('2026-06-24T19:00:00.000Z');
const R32_FIRST_KICKOFF = new Date('2026-06-28T19:00:00.000Z');
const R16_FIRST_KICKOFF = new Date('2026-07-04T16:00:00.000Z');
const QF_FIRST_KICKOFF = new Date('2026-07-09T19:00:00.000Z');
// Curated show/presenter league. Emails are intentionally not shipped; these
// entry IDs were resolved once from private profiles/admin data.
const HALLO_AMRIKA_MINI_ENTRY_IDS = [
  'a098a535-a561-428b-b978-b1ff413e6683',
  'b4bf20e4-e454-4859-9dd7-c2ec55874ee9',
  '06f4870f-9cc9-408e-aa10-b744ab2acf08',
  '550eed0a-73c3-44c0-8478-03ff9797f1c0',
  'f9ced3d7-7ab8-4e09-81c0-b01e74644f79',
  '1ae17874-1b08-4b08-a54c-122f3d87b676',
  'd8089b80-3ce9-45c5-b94f-f8f90c6e205d',
  'e6613d8c-ac16-4bf6-81d5-bae433394ee2',
  '8bf0e040-6920-4a8b-9909-63afca7ca413',
];

const state = {
  teams: [],
  players: [],     // flat: each row carries nation + category
  league: null,    // { locked_at, ... }
  myUserId: null,
  lbMode: 'overall',
  lbPage: 0,
};

const PAGE_SIZE = 60;
let visible = PAGE_SIZE;

function currentSquadPhase(now = new Date()) {
  if (now < MD2_FIRST_KICKOFF) return 'gw1';
  if (now < MD3_FIRST_KICKOFF) return 'gw2';
  if (now < R32_FIRST_KICKOFF) return 'gw3';
  if (now < R16_FIRST_KICKOFF) return 'r32';
  if (now < QF_FIRST_KICKOFF) return 'r16';
  return 'current';
}

function previousSquadPhase(now = new Date()) {
  const phase = currentSquadPhase(now);
  if (phase === 'current') return 'r16';
  if (phase === 'r16') return 'r32';
  if (phase === 'r32') return 'gw3';
  if (phase === 'gw3') return 'gw2';
  if (phase === 'gw2') return 'gw1';
  return null;
}

function squadForPhase(entry, phase = currentSquadPhase()) {
  if (!entry) return [];
  if (phase === 'gw1') return entry.xi_json_gw1 || entry.xi_json || [];
  if (phase === 'gw2') return entry.xi_json_gw2 || [];
  if (phase === 'gw3') return entry.xi_json_gw3 || entry.xi_json || [];
  if (phase === 'r32') return entry.xi_json_r32 || entry.xi_json || [];
  if (phase === 'r16') return entry.xi_json_r16 || entry.xi_json || [];
  return entry.xi_json || [];
}

function maxDate(...dates) {
  const valid = dates.filter(Boolean).map(d => new Date(d)).filter(d => !Number.isNaN(d.getTime()));
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map(d => d.getTime())));
}

function fixtureCutoffForPhase(entry, phase = currentSquadPhase()) {
  const submittedAt = entry?.submitted_at ? new Date(entry.submitted_at) : null;
  if (phase === 'gw1') return submittedAt;
  if (phase === 'gw2') return maxDate(submittedAt, MD2_FIRST_KICKOFF);
  if (phase === 'gw3') return maxDate(submittedAt, MD3_FIRST_KICKOFF);
  if (phase === 'r32') return maxDate(submittedAt, R32_FIRST_KICKOFF);
  if (phase === 'r16') return maxDate(submittedAt, R16_FIRST_KICKOFF);
  return maxDate(submittedAt, QF_FIRST_KICKOFF);
}

function roundNameForPhase(fixtures, phase = currentSquadPhase()) {
  const needles = {
    gw1: 'Group Stage - 1',
    gw2: 'Group Stage - 2',
    gw3: 'Group Stage - 3',
    r32: 'Round of 32',
    r16: 'Round of 16',
    current: 'Quarter-finals',
  };
  const needle = needles[phase] || '';
  if (!needle) return '';

  // Never fall back to another round. After a deadline, a missing fixture list
  // for the new phase should show 0 round points, not stale previous-round data.
  return (fixtures || []).find(f => String(f.round || '').includes(needle))?.round || '';
}

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
  state.userEmail = user?.email || null;

  // Render above-the-fold stuff IMMEDIATELY
  renderHeroStatus();
  renderMatchdayHub();
  renderScoringStatus();
  renderMySquad();
  renderFeaturedLeague();
  // Leaderboard live (Phase 3 scoring deployed 2026-06-12)
  wireLeaderboardTabs();
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
  setInterval(() => {
    state._matchdayContext = null;
    renderMatchdayHub();
  }, MATCHDAY_REFRESH_MS);
  setInterval(() => { renderScoringStatus(); }, 5 * 60_000);

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
    // Top Players widget can now show flag + nation + club (needed players)
    renderTopPlayers();
  });
  // Re-render dynamic strings on language change (only those that are ready)
  window.addEventListener('langchange', () => {
    if (state.players.length) hydrateFilters();
    if (state.players.length) renderPoolStats();
    renderHeroStatus();
    renderMatchdayHub();
    renderScoringStatus();
    renderMySquad();
    renderFeaturedLeague();
    renderCalendar();
    if (state.players.length) renderPool();
    renderLeaderboard();
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
  state.lbMode = 'overall';
  state.lbPage = Math.max(0, Math.ceil(rank / LB_PAGE_SIZE) - 1);
  paintLeaderboardTabs();
  const { data: cnt } = await supabase.rpc('entry_count', { p_league_id: HALO_LEAGUE_ID });
  state.lbTotal = cnt ?? 0;
  document.getElementById('lbStats').textContent =
    state.lbTotal === 1 ? t('lb.entries.one') : t('lb.entries.n', { n: state.lbTotal });
  document.getElementById('lbTable').innerHTML = '';
  await renderLeaderboard(false);
  // Scroll to my row + flash highlight
  const me = document.querySelector('.lb-row.me');
  if (me) {
    me.scrollIntoView({ behavior: 'smooth', block: 'center' });
    me.classList.add('flash');
    setTimeout(() => me.classList.remove('flash'), 1800);
  }
}

async function renderFeaturedLeague() {
  const card = document.getElementById('featuredLeagueCard');
  if (!card) return;

  card.style.display = '';
  card.innerHTML = `<div class="lb-empty">${escapeHtml(t('mini.loading'))}</div>`;

  try {
    const { data, error } = await supabase
      .from('leaderboard_totals')
      .select('entry_id, team_name, user_id, submitted_at, total_points')
      .in('entry_id', HALLO_AMRIKA_MINI_ENTRY_IDS);
    if (error) throw error;

    const entries = await entriesById((data || []).map(row => row.entry_id));
    const rows = (data || [])
      .map(row => ({
        ...row,
        ...(entries[row.entry_id] || {}),
        points: row.total_points || 0,
      }))
      .filter(row => row.team_name)
      .sort((a, b) => (b.points - a.points) || String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')));
    let mdPoints = {};
    try {
      mdPoints = await matchdayPointsForEntries(rows.map(row => row.entry_id));
    } catch (e) {
      console.error('mini league matchday points fetch failed:', e);
    }
    for (const row of rows) row.round_points = mdPoints[row.entry_id] || 0;

    const stat = t('mini.stats', {
      n: rows.length,
      total: HALLO_AMRIKA_MINI_ENTRY_IDS.length,
    });

    card.innerHTML = `
      <div class="mini-league-head">
        <div>
          <h3>${escapeHtml(t('mini.title'))}</h3>
          <p>${escapeHtml(t('mini.sub'))}</p>
        </div>
        <div class="mini-league-stat">${escapeHtml(stat)}</div>
      </div>
      <div class="lb-head mini-league-cols">
        <div>#</div>
        <div>${escapeHtml(t('lb.team'))}</div>
        <div>${escapeHtml(t('lb.owner'))}</div>
        <div style="text-align:right;">${escapeHtml(t('lb.roundpts'))}</div>
        <div style="text-align:right;">${escapeHtml(t('lb.totalpts'))}</div>
      </div>
      <div class="lb-table mini-league-board">
        ${rows.length ? rows.map((r, i) => {
          const globalRank = r.rank_current
            ? t('mini.globalRank', { rank: r.rank_current })
            : t('mini.globalPending');
          return `
            <div class="lb-row clickable${r.user_id === state.myUserId ? ' me' : ''}" data-entry="${r.entry_id}">
              <div class="lb-rank">${i + 1}</div>
              <div class="lb-team">${escapeHtml(r.team_name)}</div>
              <div class="lb-owner">${escapeHtml(r.ownerName || '—')} <span class="mini-global">${escapeHtml(globalRank)}</span></div>
              ${leaderboardPointsCells(r.round_points, r.points)}
            </div>
          `;
        }).join('') : `<div class="lb-empty">${escapeHtml(t('mini.empty'))}</div>`}
      </div>
    `;
    wireLeaderboardRows();
  } catch (e) {
    card.innerHTML = `<div class="lb-empty" style="color:var(--danger);">${escapeHtml(e.message || t('mini.empty'))}</div>`;
  }
}

function renderPoolStats() {
  document.getElementById('poolStats').textContent =
    t('pool.stats', { n: state.players.length.toLocaleString(), teams: state.teams.length });
}

function loadFixturesData() {
  if (!state._fixturesCache) {
    state._fixturesCache = fetch(FIXTURES_DATA_URL).then(r => r.json());
  }
  return state._fixturesCache;
}

async function getMatchdayContext() {
  if (state._matchdayContext) return state._matchdayContext;
  const [fixturesData, matchesRes] = await Promise.all([
    loadFixturesData(),
    supabase
      .from('matches')
      .select('external_id, date, home, away, status, home_goals, away_goals, scored_at')
      .order('date', { ascending: false })
      .limit(180),
  ]);
  if (matchesRes.error) throw matchesRes.error;
  const fixtures = fixturesData.fixtures || [];
  state._matchdayContext = selectMatchday(fixtures, matchesRes.data || []);
  return state._matchdayContext;
}

function expectedFinalWhistle(fixture) {
  return new Date(new Date(fixture.date).getTime() + 125 * 60_000);
}

function isScoringWindow(now = new Date()) {
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  return h === 7 || h === 8 || (h === 9 && m <= 5);
}

function formatCairoTime(value) {
  const lang = document.documentElement.lang || 'en';
  if (lang === 'ar') {
    const parts = new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).formatToParts(new Date(value));
    const part = (type) => parts.find(p => p.type === type)?.value || '';
    return `${part('day')} ${part('month')} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim();
  }
  return new Intl.DateTimeFormat(lang, {
    timeZone: 'Africa/Cairo',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const AR_NATION_NAMES = {
  'Argentina': 'الأرجنتين',
  'Brazil': 'البرازيل',
  'England': 'إنجلترا',
  'France': 'فرنسا',
  'Morocco': 'المغرب',
  'Netherlands': 'هولندا',
  'Portugal': 'البرتغال',
  'Spain': 'إسبانيا',
  'Belgium': 'بلجيكا',
  'Colombia': 'كولومبيا',
  'Croatia': 'كرواتيا',
  'Germany': 'ألمانيا',
  'Mexico': 'المكسيك',
  'Senegal': 'السنغال',
  'United States': 'أمريكا',
  'Uruguay': 'أوروجواي',
  'Australia': 'أستراليا',
  'Austria': 'النمسا',
  'Ecuador': 'الإكوادور',
  'Iran': 'إيران',
  'Japan': 'اليابان',
  'South Korea': 'كوريا الجنوبية',
  'Switzerland': 'سويسرا',
  'Turkey': 'تركيا',
  'Algeria': 'الجزائر',
  'Canada': 'كندا',
  'Egypt': 'مصر',
  'Ivory Coast': 'كوت ديفوار',
  'Norway': 'النرويج',
  'Panama': 'بنما',
  'Paraguay': 'باراجواي',
  'Sweden': 'السويد',
  'Czech Republic': 'التشيك',
  'DR Congo': 'الكونغو الديمقراطية',
  'Iraq': 'العراق',
  'Qatar': 'قطر',
  'Scotland': 'اسكتلندا',
  'South Africa': 'جنوب أفريقيا',
  'Tunisia': 'تونس',
  'Uzbekistan': 'أوزبكستان',
  'Bosnia and Herzegovina': 'البوسنة والهرسك',
  'Cape Verde': 'كاب فيردي',
  'Curaçao': 'كوراساو',
  'Ghana': 'غانا',
  'Haiti': 'هايتي',
  'Jordan': 'الأردن',
  'New Zealand': 'نيوزيلندا',
  'Saudi Arabia': 'السعودية',
};

function displayNationName(name) {
  return document.documentElement.lang === 'ar' ? (AR_NATION_NAMES[name] || name) : name;
}

const ROSTER_TO_FIXTURE_NATION = {
  'DR Congo': 'Congo DR',
  'Cape Verde': 'Cape Verde Islands',
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  'Turkey': 'Türkiye',
  'United States': 'USA',
};

function fixtureNationName(name) {
  return ROSTER_TO_FIXTURE_NATION[name] || name;
}

function displayScoreNumber(value) {
  return document.documentElement.lang === 'ar'
    ? Number(value || 0).toLocaleString('ar-EG')
    : String(value || 0);
}

function displayMatchLabel(match) {
  const home = displayNationName(match.home);
  const away = displayNationName(match.away);
  if (match.home_goals !== null && match.home_goals !== undefined &&
      match.away_goals !== null && match.away_goals !== undefined &&
      match.status === 'finished') {
    return `${home} ${displayScoreNumber(match.home_goals)}-${displayScoreNumber(match.away_goals)} ${away}`;
  }
  return `${home} - ${away}`;
}

function cairoDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type) => parts.find(p => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatMatchdayDate(value) {
  const lang = document.documentElement.lang || 'en';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

function formatKickoffTime(value) {
  const lang = document.documentElement.lang || 'en';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function fixtureDbDate(fixture) {
  return new Date(fixture.date).toISOString().slice(0, 10);
}

function mergeFixture(fixture, matchById) {
  const liveMatch = matchById[String(fixture.id)] || {};
  const status = liveMatch.status || (fixture.status === 'FT' ? 'finished' : 'scheduled');
  return {
    ...fixture,
    external_id: String(fixture.id),
    date_key: cairoDateKey(fixture.date),
    db_date: fixtureDbDate(fixture),
    status,
    home_goals: liveMatch.home_goals ?? fixture.home_goals,
    away_goals: liveMatch.away_goals ?? fixture.away_goals,
    scored_at: liveMatch.scored_at || null,
  };
}

function selectMatchday(fixtures, matches) {
  const matchById = {};
  for (const m of matches || []) matchById[String(m.external_id)] = m;
  const merged = fixtures.map(f => mergeFixture(f, matchById));
  const today = cairoDateKey(new Date());
  const days = [...new Set(merged.map(f => f.date_key))].sort();

  let selected = days.includes(today) ? today : null;
  if (!selected) selected = days.find(d => d > today) || null;
  if (!selected) {
    const latestScored = merged
      .filter(f => f.scored_at)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    selected = latestScored?.date_key || days[days.length - 1];
  }

  const games = merged
    .filter(f => f.date_key === selected)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return { dateKey: selected, games, dbDates: [...new Set(games.map(f => f.db_date))] };
}

function matchTone(game, now = new Date()) {
  const kickoff = new Date(game.date);
  const finalWhistle = expectedFinalWhistle(game);
  if (kickoff <= now && now < finalWhistle && game.status !== 'finished') return 'live';
  if (game.status === 'finished' && game.scored_at) return 'scored';
  if (game.status === 'finished') return 'queued';
  return 'upcoming';
}

function matchToneLabel(tone) {
  return t(`hub.status.${tone}`);
}

function renderMatchScore(game) {
  if (game.home_goals === null || game.home_goals === undefined ||
      game.away_goals === null || game.away_goals === undefined ||
      matchTone(game) === 'upcoming') {
    return `<span class="md-time">${formatKickoffTime(game.date)}</span>`;
  }
  return `<span class="md-score">${displayScoreNumber(game.home_goals)}-${displayScoreNumber(game.away_goals)}</span>`;
}

async function renderUserDashboard(matchday) {
  const panel = document.getElementById('userDashboard');
  if (!panel) return;

  if (!state.myUserId) {
    panel.className = 'matchday-panel user-dashboard guest';
    panel.innerHTML = `
      <div class="dash-kicker">${escapeHtml(t('hub.user.kicker'))}</div>
      <div class="dash-guest-title">${escapeHtml(t('hub.guest.title'))}</div>
      <div class="dash-guest-copy">${escapeHtml(t('hub.guest.copy'))}</div>
      <a href="login.html" class="dash-link">${escapeHtml(t('cta.signin'))}</a>
    `;
    return;
  }

  const [rankRes, entryRes] = await Promise.all([
    supabase.rpc('user_rank', { p_league_id: HALO_LEAGUE_ID, p_user_id: state.myUserId }),
    supabase
      .from('entries')
      .select('id, team_name, transfers_used, rank_current, rank_previous')
      .eq('league_id', HALO_LEAGUE_ID)
      .eq('user_id', state.myUserId)
      .maybeSingle(),
  ]);
  const entry = entryRes.data;
  if (!entry) {
    panel.className = 'matchday-panel user-dashboard guest';
    panel.innerHTML = `
      <div class="dash-kicker">${escapeHtml(t('hub.user.kicker'))}</div>
      <div class="dash-guest-title">${escapeHtml(t('team.notyet.title'))}</div>
      <div class="dash-guest-copy">${escapeHtml(t('team.notyet.sub'))}</div>
      <a href="team.html" class="dash-link">${escapeHtml(t('tab.team'))}</a>
    `;
    return;
  }

  const scoreQuery = supabase
    .from('scores')
    .select('points')
    .eq('entry_id', entry.id);
  if (matchday.dbDates.length > 0) scoreQuery.in('match_date', matchday.dbDates);
  const [scoreRows, totalRes] = await Promise.all([
    scoreQuery.then(r => r.data || []),
    supabase
      .from('leaderboard_totals')
      .select('total_points')
      .eq('league_id', HALO_LEAGUE_ID)
      .eq('entry_id', entry.id)
      .maybeSingle(),
  ]);

  const rank = rankRes.data || entry.rank_current || '-';
  const total = totalRes.data?.total_points ?? 0;
  const todayPoints = scoreRows.reduce((sum, row) => sum + (row.points || 0), 0);
  const transfersLeft = Math.max(0, 2 - (entry.transfers_used || 0));
  const rankDiff = entry.rank_previous && entry.rank_current
    ? entry.rank_previous - entry.rank_current
    : 0;
  const rankMove = rankDiff > 0
    ? `+${rankDiff}`
    : rankDiff < 0
      ? `${rankDiff}`
      : '0';
  const moveClass = rankDiff > 0 ? 'up' : rankDiff < 0 ? 'down' : 'flat';

  panel.className = 'matchday-panel user-dashboard';
  panel.innerHTML = `
    <div class="dash-head">
      <div>
        <div class="dash-kicker">${escapeHtml(t('hub.user.kicker'))}</div>
        <div class="dash-team">${escapeHtml(entry.team_name)}</div>
      </div>
      <a href="team.html" class="dash-link">${escapeHtml(t('tab.team'))}</a>
    </div>
    <div class="dash-grid">
      <div class="dash-stat primary">
        <span>${escapeHtml(t('hub.rank'))}</span>
        <b>#${rank}</b>
      </div>
      <div class="dash-stat">
        <span>${escapeHtml(t('hub.total'))}</span>
        <b>${displayScoreNumber(total)}</b>
      </div>
      <div class="dash-stat">
        <span>${escapeHtml(t('hub.today'))}</span>
        <b>${todayPoints >= 0 ? '+' : ''}${displayScoreNumber(todayPoints)}</b>
      </div>
      <div class="dash-stat">
        <span>${escapeHtml(t('hub.transfers'))}</span>
        <b>${displayScoreNumber(transfersLeft)}</b>
      </div>
    </div>
    <div class="dash-move ${moveClass}">
      <span>${escapeHtml(t('hub.rankmove'))}</span>
      <b>${rankMove}</b>
    </div>
  `;
}

async function renderMatchdayHub() {
  const board = document.getElementById('matchdayBoard');
  if (!board) return;
  try {
    const matchday = await getMatchdayContext();
    const games = matchday.games;
    const now = new Date();
    const tones = games.map(g => matchTone(g, now));
    const liveCount = tones.filter(x => x === 'live').length;
    const queuedCount = tones.filter(x => x === 'queued').length;
    const scoredCount = tones.filter(x => x === 'scored').length;
    const topTone = liveCount ? 'live' : queuedCount ? 'queued' : scoredCount === games.length ? 'scored' : 'upcoming';
    const summary = liveCount
      ? t('hub.summary.live', { n: liveCount })
      : queuedCount
        ? t('hub.summary.queued', { n: queuedCount })
        : scoredCount === games.length && games.length
          ? t('hub.summary.scored')
          : t('hub.summary.upcoming');

    const dateLabel = games[0] ? formatMatchdayDate(games[0].date) : '';
    board.innerHTML = `
      <div class="md-topline">
        <div>
          <div class="md-title">${escapeHtml(t('hub.title'))}</div>
          <div class="md-date">${escapeHtml(dateLabel)} · ${escapeHtml(t('score.status.window'))}</div>
        </div>
        <div class="md-pill ${topTone}">${escapeHtml(summary)}</div>
      </div>
      <div class="md-games">
        ${games.map(game => {
          const tone = matchTone(game, now);
          return `
            <div class="md-game ${tone}">
              <div class="md-status">${escapeHtml(matchToneLabel(tone))}</div>
              <div class="md-sides">
                <span>${escapeHtml(displayNationName(game.home))}</span>
                ${renderMatchScore(game)}
                <span>${escapeHtml(displayNationName(game.away))}</span>
              </div>
              <div class="md-meta">${tone === 'scored' && game.scored_at ? escapeHtml(formatCairoTime(game.scored_at)) : escapeHtml(formatKickoffTime(game.date))}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    await renderUserDashboard(matchday);
  } catch (e) {
    board.innerHTML = `<div class="hub-skeleton">${escapeHtml(t('hub.unavailable'))}</div>`;
  }
}

function formatRosterName(raw) {
  const parts = String(raw || '').trim().split(/\s+/);
  if (parts.length < 2) return raw || '';
  return `${parts.slice(1).join(' ')} ${parts[0]}`;
}

function renderStatusBody(title, body) {
  return `
    <div class="score-status-title">${title}</div>
    <div class="score-status-body">${body}</div>
  `;
}

async function renderScoringStatus() {
  const card = document.getElementById('scoringStatusCard');
  if (!card) return;
  try {
    const [fixturesData, matchesRes] = await Promise.all([
      loadFixturesData(),
      supabase.from('matches')
        .select('external_id, date, home, away, status, home_goals, away_goals, scored_at')
        .order('date', { ascending: false })
        .limit(140),
    ]);
    const fixtures = (fixturesData.fixtures || [])
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const matches = matchesRes.data || [];
    const now = new Date();
    const scoredById = new Set(matches.filter(m => m.scored_at).map(m => String(m.external_id)));
    const live = fixtures.filter(f => {
      const kickoff = new Date(f.date);
      const finalWhistle = expectedFinalWhistle(f);
      return kickoff <= now && now < finalWhistle;
    });
    const finishedUnscored = fixtures.filter(f => {
      const kickoff = new Date(f.date);
      return kickoff <= now && expectedFinalWhistle(f) <= now && !scoredById.has(String(f.id));
    });
    const latestScored = matches
      .filter(m => m.scored_at)
      .sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return new Date(b.scored_at) - new Date(a.scored_at);
      })[0];

    const title = t('score.status.title');
    const windowText = t('score.status.window');
    let tone = 'idle';
    let body = t('score.status.waiting', { window: windowText });

    if (isScoringWindow(now) && finishedUnscored.length > 0) {
      tone = 'updating';
      body = t('score.status.updating', { window: windowText });
    } else if (live.length > 0) {
      tone = 'live';
      const match = live.length === 1
        ? `${displayNationName(live[0].home)} - ${displayNationName(live[0].away)}`
        : t('score.status.matchcount', { n: live.length });
      body = t('score.status.live', { match, window: windowText });
    } else if (finishedUnscored.length > 0) {
      tone = 'queued';
      body = t('score.status.queued', { window: windowText });
    } else if (latestScored) {
      tone = 'updated';
      body = t('score.status.updated', {
        match: displayMatchLabel(latestScored),
        time: formatCairoTime(latestScored.scored_at),
      });
    }

    card.className = `score-status-card ${tone}`;
    card.innerHTML = renderStatusBody(title, body);
    card.style.display = '';
  } catch (e) {
    card.style.display = 'none';
  }
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

  // Homepage is a scoring view, not an edit view. While MD3 transfers are
  // open, it must still show the frozen MD2 squad until MD3 kicks off.
  const phase = currentSquadPhase();
  const displaySquad = squadForPhase(entry, phase);
  const titleEl = document.querySelector('#mySquadStrip .strip-title');
  if (titleEl) titleEl.textContent = t(`mysquad.phase.${phase}`);

  // Pull total points + per-match breakdowns + fixtures (for the "vs OPP"
  // / "0 (played, no points)" indicators on each pitch slot).
  const [scoreRows, fixturesData, matchesRes] = await Promise.all([
    supabase.from('scores').select('match_date, points, breakdown').eq('entry_id', entry.id).then(r => r.data || []),
    state._fixturesCache || fetch(FIXTURES_DATA_URL).then(r => r.json()).then(d => { state._fixturesCache = Promise.resolve(d); return d; }),
    supabase
      .from('matches')
      .select('external_id, date, home, away, status, home_goals, away_goals, scored_at')
      .order('date', { ascending: false })
      .limit(180),
  ]);
  const matchById = {};
  for (const m of matchesRes.data || []) matchById[String(m.external_id)] = m;
  const scoreRowByDate = {};
  for (const row of scoreRows) scoreRowByDate[row.match_date] = row;
  const phasePoints = phasePointsFromRows(scoreRows, fixturesData, matchById, entry, phase);
  const phasePointsLabel = document.documentElement.lang === 'ar'
    ? `${displayScoreNumber(phasePoints)} نقاط الجولة`
    : `${displayScoreNumber(phasePoints)} round pts`;

  document.getElementById('mySquadStrip').style.display = '';
  document.getElementById('mySquadMeta').innerHTML =
    `${escapeHtml(entry.team_name)} · <b style="color:var(--accent);">${escapeHtml(phasePointsLabel)}</b>`;

  const xi = displaySquad || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);
  const playerStats = {};
  const cardEl = document.getElementById('mySquadCard');
  if (!cardEl) return;

  if (!starters.length) {
    cardEl.innerHTML = `<div class="lb-empty">${escapeHtml(t('team.notyet.sub'))}</div>`;
    return;
  }

  // Paint a basic pitch immediately. Optional fixture/score/share details
  // below can enhance it, but cannot leave the section blank if they fail.
  cardEl.innerHTML = simpleSquadCardHtml(starters, wild);

  // Find the fixture for the squad phase being displayed.
  const NATION_ALIAS_HS = {
    'DR Congo':'Congo DR', 'Cape Verde':'Cape Verde Islands',
    'Bosnia and Herzegovina':'Bosnia & Herzegovina', 'Turkey':'Türkiye', 'United States':'USA',
  };
  const fixtureCutoff = fixtureCutoffForPhase(entry, phase);
  function firstFixtureFor(nation) {
    const fx = NATION_ALIAS_HS[nation] || nation;
    return (fixturesData?.fixtures || []).find(f =>
      (f.home === fx || f.away === fx)
      && (!fixtureCutoff || new Date(f.date) >= fixtureCutoff)
    );
  }
  function statsForFixture(item, fixture, fixtureScored) {
    if (!fixture || !fixtureScored) return null;
    const row = scoreRowByDate[(fixture.date || '').slice(0, 10)];
    const st = row?.breakdown?.[item.name];
    if (!st || Object.keys(st).length === 0) return null;
    const stats = { points: pointsFromStatLine(st), st };
    playerStats[item.name] = stats;
    return stats;
  }

  // Pitch HTML — show +pts if scored, "0" if their nation played but they
  // earned nothing, otherwise "vs OPP" for the upcoming match.
  const isAr = document.documentElement.lang === 'ar';
  const ptsLabel = isAr ? 'نقاط' : 'pts';
  const slotsHtml = starters.map((item, i) => {
    try {
      const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
      if (item?.empty) {
        return `<div class="pitch-slot empty" style="left:${coord.x}%;top:${coord.y}%;">
          <div class="ps-empty">${escapeHtml(t('slot.empty'))}</div>
          <div class="ps-tag">${escapeHtml(coord.tag || item.role || '')}</div>
        </div>`;
      }
      const name = displayLast(item) || '?';
      const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
      const extra = name.length >= 13 ? 'letter-spacing:-0.3px;max-width:140px;' : '';
      const fixture = firstFixtureFor(item.nation);
      const opp = fixture ? (fixture.home === (NATION_ALIAS_HS[item.nation] || item.nation) ? fixture.away : fixture.home) : '';
      const fixtureScored = fixture ? Boolean(matchById[String(fixture.id)]?.scored_at) : false;
      const ps = statsForFixture(item, fixture, fixtureScored);
      const vsLine = opp ? `<div class="ps-next">vs ${escapeHtml(opp)}</div>` : '';
      let foot = '';
      let tooltipAttr = '';
      if (ps) {
        const cls = ps.points > 0 ? 'pos' : ps.points < 0 ? 'neg' : '';
        foot = `<div class="ps-pts ${cls}">${ps.points >= 0 ? '+' : ''}${ps.points}</div>${vsLine}`;
        const txt = describeStatTextLocal(ps.st);
        tooltipAttr = ` title="${escapeHtml((ps.points >= 0 ? '+' : '') + ps.points + ' ' + ptsLabel + (txt ? '  ·  ' + txt : ''))}"`;
      } else if (fixture) {
        // Nation's current-phase fixture has been scored but player earned 0
        // → show "0". If not scored yet, keep showing the fixture.
        foot = fixtureScored
          ? `<div class="ps-pts" style="color:var(--text-dim);">0</div>${vsLine}`
          : vsLine;
      }
      return `<div class="pitch-slot filled"${tooltipAttr} style="left:${coord.x}%;top:${coord.y}%;">
        <div class="ps-flag">${flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' })}</div>
        <div class="ps-name" style="font-size:${sz}px;${extra}">${escapeHtml(name)}</div>
        <div class="ps-tag">${coord.tag}</div>
        ${foot}
      </div>`;
    } catch (e) {
      console.error('pitch slot render failed:', item, e);
      return '';
    }
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

  const lockPassed = state.league?.locked_at && new Date() >= new Date(state.league.locked_at);
  const editHref = lockPassed ? 'team.html' : 'build.html';
  const editLabel = lockPassed ? t('tab.team') : t('mysquad.edit');

  const detailsHtml = safeScoreDetails(playerStats, starters);
  cardEl.innerHTML = `
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
      ${detailsHtml}
      <div style="margin-top:14px;text-align:center;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <a href="https://wa.me/?text=${shareText}" target="_blank" rel="noopener" class="ghost-btn" style="text-decoration:none;background:#25D366;color:#0a0a12;border-color:#25D366;">${t('share.whatsapp')}</a>
        <a href="${editHref}" class="ghost-btn" style="text-decoration:none;">${editLabel}</a>
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

function simpleSquadCardHtml(starters, wild) {
  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag || item.role || '' };
    if (item?.empty) {
      return `<div class="pitch-slot empty" style="left:${coord.x}%;top:${coord.y}%;">
        <div class="ps-empty">${escapeHtml(t('slot.empty'))}</div>
        <div class="ps-tag">${escapeHtml(coord.tag || item.role || '')}</div>
      </div>`;
    }
    const name = displayLast(item) || '?';
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    let flag = '';
    try {
      flag = flagImg(item.nation_code, { width: 40, cls: 'flag-img-mid', fallback: '' });
    } catch {}
    return `<div class="pitch-slot filled" style="left:${coord.x}%;top:${coord.y}%;">
      <div class="ps-flag">${flag}</div>
      <div class="ps-name" style="font-size:${sz}px;">${escapeHtml(name)}</div>
      <div class="ps-tag">${escapeHtml(coord.tag || item.role || '')}</div>
    </div>`;
  }).join('');
  let benchHtml = '';
  if (wild) {
    let flag = '';
    try {
      flag = flagImg(wild.nation_code, { width: 20, cls: 'flag-img', fallback: '' });
    } catch {}
    benchHtml = `
      <div class="bench-label">${t('squad.bench')}</div>
      <div class="bench-slot filled">
        <span>${flag} <b>${escapeHtml(displayLast(wild))}</b>
          <span style="color:var(--text-dim);font-size:11px;">${escapeHtml(wild.club || '')}</span>
        </span>
      </div>
    `;
  }
  return `
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
    </div>
  `;
}

function safeScoreDetails(playerStats, starters) {
  try {
    return renderScoreDetails(playerStats, starters);
  } catch (e) {
    console.error('score details render failed:', e);
    return '';
  }
}

function displayLast(item) {
  return item.shirt_name || item.last || item.name || '';
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
    + (st.r16 || 0)
    + (st.qf || 0)
    + (st.sf || 0)
    - redCardCount(st);
}

function phasePointsFromRows(scoreRows, fixturesData, matchById, entry, phase = currentSquadPhase()) {
  const fixtures = fixturesData?.fixtures || [];
  const roundName = roundNameForPhase(fixtures, phase);
  const scoreRowByDate = {};
  for (const row of scoreRows || []) scoreRowByDate[row.match_date] = row;

  let total = 0;
  for (const slot of squadForPhase(entry, phase) || []) {
    if (slot?.wild || slot?.empty || !slot?.name || !slot?.nation) continue;
    const fxNation = fixtureNationName(slot.nation);
    const fixture = fixtures.find(f =>
      f.round === roundName && (f.home === fxNation || f.away === fxNation)
    );
    if (!fixture) continue;
    const dbMatch = matchById?.[String(fixture.id)] || {};
    if (!dbMatch.scored_at) continue;
    const row = scoreRowByDate[fixtureDbDate(fixture)];
    const st = row?.breakdown?.[slot.name];
    if (!st || Object.keys(st).length === 0) continue;
    total += pointsFromStatLine(st);
  }
  return total;
}

function addStatTotals(into, st) {
  for (const k of ['goals','assists','cleanSheet','win','full90','mvp','r32','r16','qf','sf']) {
    if (st[k]) into[k] = (into[k] || 0) + st[k];
  }
  const reds = redCardCount(st);
  if (reds) into.red = (into.red || 0) + reds;
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
  if (s.r32)        parts.push(t('pts.r32'));
  if (s.r16)        parts.push(t('pts.r16'));
  if (s.qf)         parts.push(t('pts.qf'));
  if (s.sf)         parts.push(t('pts.sf'));
  if (s.red) {
    const reds = redCardCount(s);
    parts.push(`${t('pts.red')}${reds > 1 ? '×' + reds : ''}`);
  }
  return parts.join(document.documentElement.lang === 'ar' ? '، ' : ', ');
}

function statPointParts(st) {
  const parts = [];
  if (st.win)        parts.push({ code: 'WIN', label: t('pts.win'),        value: st.win });
  if (st.full90)     parts.push({ code: '90',  label: t('pts.full90'),     value: st.full90 });
  if (st.goals)      parts.push({ code: 'G',   label: t('pts.goal'),       value: st.goals });
  if (st.assists)    parts.push({ code: 'A',   label: t('pts.assist'),     value: st.assists });
  if (st.cleanSheet) parts.push({ code: 'CS',  label: t('pts.cleansheet'), value: st.cleanSheet });
  if (st.mvp)        parts.push({ code: 'MVP', label: t('pts.mvp'),        value: st.mvp });
  if (st.r32)        parts.push({ code: 'R32', label: t('pts.r32'),        value: st.r32 });
  if (st.r16)        parts.push({ code: 'R16', label: t('pts.r16'),        value: st.r16 });
  if (st.qf)         parts.push({ code: 'QF',  label: t('pts.qf'),         value: st.qf });
  if (st.sf)         parts.push({ code: 'SF',  label: t('pts.sf'),         value: st.sf });
  if (st.red)        parts.push({ code: 'RC',  label: t('pts.red'),        value: -redCardCount(st) });
  return parts;
}

function renderScoreDetails(playerStats, starters) {
  const rows = starters
    .map(item => {
      if (item?.empty) return '';
      const ps = playerStats[item.name];
      if (!ps || !ps.st || Object.keys(ps.st).length === 0) return '';
      const parts = statPointParts(ps.st);
      if (!parts.length) return '';
      const totalClass = ps.points < 0 ? 'neg' : 'pos';
      const chips = parts.map(p => {
        const cls = p.value < 0 ? 'neg' : '';
        const signed = p.value > 0 ? `+${displayScoreNumber(p.value)}` : displayScoreNumber(p.value);
        return `<span class="score-chip ${cls}"><em>${escapeHtml(p.code)}</em><span>${escapeHtml(p.label)}</span><b>${signed}</b></span>`;
      }).join('');
      return `
        <div class="score-detail-row">
          <div class="score-detail-player">
            ${flagImg(item.nation_code, { width: 18, cls: 'flag-img', fallback: '' })}
            <b>${escapeHtml(displayLast(item))}</b>
          </div>
          <div class="score-detail-chips">${chips}</div>
          <div class="score-detail-total ${totalClass}">${ps.points >= 0 ? '+' : ''}${displayScoreNumber(ps.points)}</div>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  const title = t('score.breakdown');
  return `<div class="score-detail"><div class="score-detail-title">${title}</div>${rows}</div>`;
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
  { key: 'gw2',     dateUTC: '2026-06-18T16:00:00Z' }, // MD2 first match (Czech vs South Africa, 19:00 Cairo)
  { key: 'gw3',     dateUTC: '2026-06-24T19:00:00Z' }, // MD3 first match (Switzerland vs Canada, 22:00 Cairo)
  { key: 'r32',     dateUTC: '2026-06-28T19:00:00Z' },
  { key: 'r16',     dateUTC: '2026-07-04T16:00:00Z' },
  { key: 'qf',      dateUTC: '2026-07-09T19:00:00Z' },
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
  el.classList.remove('is-transfer');
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
    el.textContent = '🔒 ' + (t('spin.locked')?.replace('🔒 ','') || 'Submissions locked');
    if (banner) {
      banner.textContent = t('lock.banner');
      banner.style.display = 'block';
    }
    return;
  }

  // Past initial lock but still in transfer window — open to everyone now.
  if (now >= lock && inTransferWindow) {
    if (banner) {
      banner.textContent = t('tx.qf.warn');
      banner.style.display = 'block';
    }
    ctaBuild.style.display = '';
    const isAr = document.documentElement.lang === 'ar';
    const closeLabel = txOpen.toLocaleString(isAr ? 'ar-EG' : 'en-GB', {
      timeZone: 'Africa/Cairo',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    el.classList.add('is-transfer');
    el.innerHTML = `<span>${escapeHtml(t('tx.qf.open'))}</span><span class="hs-date">${escapeHtml(t('tx.qf.closes', { date: closeLabel }))}</span><span>${escapeHtml(t('time.cairo'))}</span>`;
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

function wireLeaderboardTabs() {
  const tabs = document.querySelectorAll('#lbTabs .lb-tab');
  for (const btn of tabs) {
    if (btn.dataset.wired === '1') continue;
    btn.dataset.wired = '1';
    btn.onclick = () => {
      const mode = btn.dataset.lbMode || 'overall';
      if (state.lbMode === mode) return;
      state.lbMode = mode;
      state.lbPage = 0;
      renderLeaderboard(true);
    };
  }
  paintLeaderboardTabs();
}

function paintLeaderboardTabs() {
  const tabs = document.querySelectorAll('#lbTabs .lb-tab');
  for (const btn of tabs) {
    btn.classList.toggle('active', (btn.dataset.lbMode || 'overall') === state.lbMode);
  }
}

async function profileNamesByUserId(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabase
    .from('profile_displays')
    .select('id, display_name')
    .in('id', ids);
  const names = {};
  for (const row of data || []) names[row.id] = row.display_name;
  return names;
}

async function entriesById(entryIds) {
  const ids = [...new Set((entryIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabase
    .from('entries')
    .select('id, team_name, user_id, rank_current, rank_previous')
    .in('id', ids);
  const names = await profileNamesByUserId((data || []).map(row => row.user_id));
  const entries = {};
  for (const row of data || []) {
    entries[row.id] = {
      ...row,
      ownerName: names[row.user_id] || '—',
    };
  }
  return entries;
}

function wireLeaderboardRows() {
  for (const row of document.querySelectorAll('.lb-row.clickable')) {
    row.onclick = () => openSquadModal(row.dataset.entry, row.dataset.squadPhase || undefined);
  }
}

function movementHtml(r) {
  if (r.rank_previous == null || r.rank_current == null) return '';
  const diff = r.rank_previous - r.rank_current;
  if (diff > 0) return `<span class="lb-mv up" title="Moved up ${diff}">▲</span>`;
  if (diff < 0) return `<span class="lb-mv down" title="Moved down ${-diff}">▼</span>`;
  return `<span class="lb-mv same" title="No change">—</span>`;
}

function leaderboardPointsCells(roundPoints, totalPoints) {
  return `
    <div class="lb-round-pts">${displayScoreNumber(roundPoints || 0)}</div>
    <div class="lb-pts">${displayScoreNumber(totalPoints || 0)}</div>
  `;
}

async function totalPointsForEntries(entryIds) {
  const ids = [...new Set((entryIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('leaderboard_totals')
    .select('entry_id, total_points')
    .in('entry_id', ids);
  if (error) throw error;
  const byEntry = {};
  for (const row of data || []) byEntry[row.entry_id] = row.total_points || 0;
  return byEntry;
}

async function matchdayPointsForEntries(entryIds) {
  const ids = [...new Set((entryIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const [fixturesData, matchesRes, entriesRes] = await Promise.all([
    loadFixturesData(),
    supabase
      .from('matches')
      .select('external_id, scored_at')
      .order('date', { ascending: false })
      .limit(180),
    supabase
      .from('entries')
      .select('id, submitted_at, xi_json, xi_json_gw1, xi_json_gw2, xi_json_gw3, xi_json_r32, xi_json_r16')
      .in('id', ids),
  ]);
  if (matchesRes.error) throw matchesRes.error;
  if (entriesRes.error) throw entriesRes.error;

  const fixtures = fixturesData.fixtures || [];
  const phase = currentSquadPhase();
  const roundName = roundNameForPhase(fixtures, phase);
  const matchById = {};
  for (const m of matchesRes.data || []) matchById[String(m.external_id)] = m;

  const fixtureByNation = {};
  const scoredDates = new Set();
  for (const f of fixtures.filter(f => f.round === roundName)) {
    const scored = Boolean(matchById[String(f.id)]?.scored_at);
    const normalized = { ...f, scored, db_date: fixtureDbDate(f) };
    fixtureByNation[f.home] = normalized;
    fixtureByNation[f.away] = normalized;
    if (scored) scoredDates.add(normalized.db_date);
  }
  const dates = [...scoredDates];
  const byEntry = Object.fromEntries(ids.map(id => [id, 0]));
  if (!dates.length) return byEntry;

  const currentPlayersByEntry = {};
  for (const entry of entriesRes.data || []) {
    const players = {};
    for (const slot of squadForPhase(entry, phase)) {
      if (slot?.wild || slot?.empty || !slot?.name) continue;
      players[slot.name] = slot;
    }
    currentPlayersByEntry[entry.id] = players;
  }

  const { data, error } = await supabase
    .from('scores')
    .select('entry_id, match_date, breakdown')
    .in('entry_id', ids)
    .in('match_date', dates);
  if (error) throw error;
  for (const row of data || []) {
    const currentPlayers = currentPlayersByEntry[row.entry_id] || {};
    for (const [pname, st] of Object.entries(row.breakdown || {})) {
      const slot = currentPlayers[pname];
      if (!slot) continue;
      const fixture = fixtureByNation[fixtureNationName(slot.nation)];
      if (!fixture?.scored || fixture.db_date !== row.match_date) continue;
      byEntry[row.entry_id] += pointsFromStatLine(st);
    }
  }
  return byEntry;
}

function fixtureRosterAliases(fixtureName) {
  const names = new Set([fixtureName]);
  for (const [rosterName, mappedFixtureName] of Object.entries(ROSTER_TO_FIXTURE_NATION)) {
    if (mappedFixtureName === fixtureName) names.add(rosterName);
  }
  return [...names];
}

async function roundScoredFixturePayload(phase = currentSquadPhase()) {
  const [fixturesData, matchesRes] = await Promise.all([
    loadFixturesData(),
    supabase
      .from('matches')
      .select('external_id, scored_at')
      .order('date', { ascending: false })
      .limit(180),
  ]);
  if (matchesRes.error) throw matchesRes.error;

  const fixtures = fixturesData.fixtures || [];
  const roundName = roundNameForPhase(fixtures, phase);
  const matchById = {};
  for (const m of matchesRes.data || []) matchById[String(m.external_id)] = m;

  const rows = [];
  const seen = new Set();
  for (const fixture of fixtures.filter(f => f.round === roundName)) {
    if (!matchById[String(fixture.id)]?.scored_at) continue;
    const dbDate = fixtureDbDate(fixture);
    for (const nation of [...fixtureRosterAliases(fixture.home), ...fixtureRosterAliases(fixture.away)]) {
      const key = `${nation}|${dbDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ nation, db_date: dbDate });
    }
  }

  return { phase, fixtures: rows };
}

async function currentRoundScoredFixturePayload() {
  return roundScoredFixturePayload(currentSquadPhase());
}

async function previousRoundScoredFixturePayload() {
  const phase = previousSquadPhase();
  if (!phase) return { phase: null, fixtures: [] };
  return roundScoredFixturePayload(phase);
}

function paintStaticLeaderboard(rows, emptyText) {
  const table = document.getElementById('lbTable');
  if (!table) return;
  if (!rows.length) {
    table.innerHTML = `<div class="lb-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  table.innerHTML = rows.map((r, i) => `
    <div class="lb-row clickable${r.user_id === state.myUserId ? ' me' : ''}" data-entry="${r.entry_id}"${r.squad_phase ? ` data-squad-phase="${escapeHtml(r.squad_phase)}"` : ''}>
      <div class="lb-rank">${displayScoreNumber(i + 1)}${r.rankMoveHtml || ''}</div>
      <div class="lb-team">${escapeHtml(r.team_name)}</div>
      <div class="lb-owner">${escapeHtml(r.ownerName || '—')}</div>
      ${leaderboardPointsCells(r.round_points ?? 0, r.total_points ?? r.points ?? 0)}
    </div>
  `).join('');
  wireLeaderboardRows();
}

async function renderScorersLeaderboard(payloadLoader, statsKey, emptyKey) {
  const table = document.getElementById('lbTable');
  const lbStats = document.getElementById('lbStats');
  if (!table) return;
  table.innerHTML = `<div class="lb-empty">${escapeHtml(t('lb.loading'))}</div>`;
  try {
    const { phase, fixtures } = await payloadLoader();
    if (!phase || !fixtures.length) {
      if (lbStats) lbStats.textContent = t(statsKey, { n: displayScoreNumber(0) });
      paintStaticLeaderboard([], t(emptyKey));
      return;
    }
    const { data, error } = await supabase.rpc('matchday_top_scorers', {
      p_phase: phase,
      p_fixtures: fixtures,
      p_limit: 5,
      p_league_id: HALO_LEAGUE_ID,
    });
    if (error) throw error;
    const rows = (data || []).map(row => ({
      entry_id: row.entry_id,
      team_name: row.team_name,
      user_id: row.user_id,
      ownerName: row.owner_name || '-',
      round_points: row.round_points || 0,
      total_points: row.total_points || 0,
      squad_phase: phase,
    }));
    if (lbStats) lbStats.textContent = t(statsKey, { n: displayScoreNumber(rows.length) });
    paintStaticLeaderboard(rows, t(emptyKey));
  } catch (e) {
    table.innerHTML = `<div class="lb-empty" style="color:var(--danger);">${escapeHtml(e.message || t(emptyKey))}</div>`;
  }
}

async function renderTopScorersLeaderboard() {
  return renderScorersLeaderboard(
    currentRoundScoredFixturePayload,
    'lb.topscorers.stats',
    'lb.topscorers.empty',
  );
}

async function renderLastTopScorersLeaderboard() {
  return renderScorersLeaderboard(
    previousRoundScoredFixturePayload,
    'lb.lasttopscorers.stats',
    'lb.lasttopscorers.empty',
  );
}

async function renderLeaderboard(reset = true) {
  paintLeaderboardTabs();
  if (state.lbMode === 'topscorers') return renderTopScorersLeaderboard();
  if (state.lbMode === 'lasttopscorers') return renderLastTopScorersLeaderboard();

  const table = document.getElementById('lbTable');
  const lbStats = document.getElementById('lbStats');
  if (!table) return;

  if (reset) {
    state.lbPage = 0;
    table.innerHTML = `<div class="lb-empty">${escapeHtml(t('lb.loading'))}</div>`;
    const { data: cnt } = await supabase.rpc('entry_count', { p_league_id: HALO_LEAGUE_ID });
    state.lbTotal = cnt ?? 0;
  }
  if (lbStats) lbStats.textContent = state.lbTotal === 1 ? t('lb.entries.one') : t('lb.entries.n', { n: state.lbTotal || 0 });

  if (state.lbTotal === 0) {
    table.innerHTML =
      `<div class="lb-empty">${t('lb.empty')}</div>`;
    return;
  }

  const pageCount = Math.max(1, Math.ceil((state.lbTotal || 0) / LB_PAGE_SIZE));
  state.lbPage = Math.max(0, Math.min(state.lbPage || 0, pageCount - 1));

  // Page-based leaderboard query (top points first, ties broken by submission order).
  // Uses the aggregated view → tiny payload per row.
  const from = state.lbPage * LB_PAGE_SIZE;
  const to   = from + LB_PAGE_SIZE - 1;
  table.innerHTML = `<div class="lb-empty">${escapeHtml(t('lb.loading'))}</div>`;
  const { data: rows, error } = await supabase
    .from('leaderboard_totals')
    .select('entry_id, team_name, formation, user_id, submitted_at, total_points')
    .eq('league_id', HALO_LEAGUE_ID)
    .order('total_points', { ascending: false })
    .order('submitted_at', { ascending: true })
    .range(from, to);

  if (error) {
    table.innerHTML =
      `<div class="lb-empty" style="color:var(--danger);">${escapeHtml(error.message)} — has supabase/leaderboard_view.sql been run?</div>`;
    return;
  }

  // Hydrate owner names + rank snapshots for just the new rows
  const newIds = (rows || []).map(r => r.user_id);
  const newEntryIds = (rows || []).map(r => r.entry_id);
  let profiles = {};
  const ranks = {};
  if (newIds.length) {
    const [{ data: profs }, { data: rankRows }] = await Promise.all([
      supabase.from('profile_displays').select('id, display_name').in('id', newIds),
      supabase.from('entries').select('id, rank_current, rank_previous').in('id', newEntryIds),
    ]);
    for (const p of profs || []) profiles[p.id] = p;
    for (const e of rankRows || []) ranks[e.id] = e;
  }
  for (const r of rows || []) {
    r.ownerName = profiles[r.user_id]?.display_name || '—';
    const rk = ranks[r.entry_id] || {};
    r.rank_current = rk.rank_current;
    r.rank_previous = rk.rank_previous;
  }
  try {
    const mdPoints = await matchdayPointsForEntries(newEntryIds);
    for (const r of rows || []) r.round_points = mdPoints[r.entry_id] || 0;
  } catch (e) {
    console.error('matchday points fetch failed:', e);
  }

  table.innerHTML = (rows || []).map((r, i) => `
    <div class="lb-row clickable${r.user_id === state.myUserId ? ' me' : ''}" data-entry="${r.entry_id}">
      <div class="lb-rank">${displayScoreNumber(from + i + 1)}${movementHtml(r)}</div>
      <div class="lb-team">${escapeHtml(r.team_name)}</div>
      <div class="lb-owner">${escapeHtml(r.ownerName)}</div>
      ${leaderboardPointsCells(r.round_points, r.total_points)}
    </div>
  `).join('') + renderLeaderboardPager();

  for (const row of document.querySelectorAll('.lb-row.clickable')) {
    row.onclick = () => openSquadModal(row.dataset.entry, row.dataset.squadPhase || undefined);
  }
  const prev = document.getElementById('lbPrevPage');
  const next = document.getElementById('lbNextPage');
  if (prev) prev.onclick = () => {
    if (state.lbPage <= 0) return;
    state.lbPage -= 1;
    renderLeaderboard(false);
  };
  if (next) next.onclick = () => {
    if (state.lbPage >= pageCount - 1) return;
    state.lbPage += 1;
    renderLeaderboard(false);
  };
}

// Top players widget on the homepage. Aggregates per-player stats from the
// scores.breakdown JSONB across all entries (one match per player counted via
// a (player, match_date) Set dedup, since many entries picked the same player).
const TP_PAGE = 20;
const tpState = {
  all: [],
  visible: TP_PAGE,
  query: '',
  ownership: { total: 0, byName: {}, byKey: {} },
};

function ownershipKey(playerName, nation) {
  return `${playerName || ''}\u001f${nation || ''}`;
}

function formatOwnershipPct(owners, total) {
  if (!owners || !total) return '';
  const pct = (owners / total) * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  return `${Math.round(pct * 10) / 10}%`;
}

function playerOwnership(playerName, nation) {
  const own = tpState.ownership || {};
  const owners = (nation && own.byKey?.[ownershipKey(playerName, nation)] !== undefined)
    ? own.byKey[ownershipKey(playerName, nation)]
    : own.byName?.[playerName];
  return {
    owners: owners || 0,
    pct: formatOwnershipPct(owners || 0, own.total || 0),
  };
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

async function renderTopPlayers() {
  const board = document.getElementById('topPlayersBoard');
  if (!board) return;
  // Server-side aggregated view (one fast query vs 37 paginated requests).
  // Pull the whole leaderboard once (typically a few hundred players) so the
  // search filter + Load More work without further round-trips.
  if (tpState.all.length === 0) {
    const [leaderboardRes, ownershipRes, countRes] = await Promise.all([
      supabase
        .from('player_leaderboard')
        .select('player_name, matches, goals, assists, clean_sheets, mvps, reds, total_points')
        .order('total_points', { ascending: false })
        .order('goals', { ascending: false })
        .order('assists', { ascending: false })
        .limit(2000),
      fetchPlayerOwnershipCounts(),
      supabase.rpc('entry_count', { p_league_id: HALO_LEAGUE_ID }),
    ]);
    const rows = leaderboardRes.data;
    const error = leaderboardRes.error;
    if (error || !rows || rows.length === 0) return;
    const byName = {};
    const byKey = {};
    for (const row of ownershipRes || []) {
      byName[row.player_name] = (byName[row.player_name] || 0) + (row.owners || 0);
      byKey[ownershipKey(row.player_name, row.nation)] = row.owners || 0;
    }
    tpState.ownership = {
      total: countRes.data || 0,
      byName,
      byKey,
    };
    tpState.all = rows.map(r => ({
      name: r.player_name,
      matches: r.matches,
      goals: r.goals,
      assists: r.assists,
      cs: r.clean_sheets,
      mvp: r.mvps,
      red: r.reds,
      points: r.total_points,
    }));
  }
  paintTopPlayers();
}

function paintTopPlayers() {
  const board = document.getElementById('topPlayersBoard');
  if (!board) return;
  const meta = {};
  for (const pl of state.players) meta[pl.name] = pl;

  const q = (tpState.query || '').toLowerCase().trim();
  const filtered = q
    ? tpState.all.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (meta[p.name]?.nation || '').toLowerCase().includes(q) ||
        (meta[p.name]?.club || '').toLowerCase().includes(q))
    : tpState.all;
  const slice = filtered.slice(0, tpState.visible);

  const isAr = document.documentElement.lang === 'ar';
  const searchPlaceholder = isAr ? 'دور بإسم اللاعب…' : 'Search by player, nation, or club…';
  const loadMoreLabel = isAr ? `حمّل المزيد (${filtered.length - tpState.visible})` : `Load more (${filtered.length - tpState.visible})`;
  const noResults = isAr ? 'مفيش نتائج.' : 'No players match.';
  const headerHtml = `
    <div class="pl-head">
      <span>#</span>
      <span></span>
      <span>${escapeHtml(t('players.col.player'))}</span>
      <span class="pl-head-stats">${escapeHtml(t('players.col.stats'))}</span>
      <span class="pl-head-own">${escapeHtml(t('players.col.owned'))}</span>
      <span class="pl-head-total">${escapeHtml(t('players.col.total'))}</span>
    </div>
  `;

  const rowsHtml = slice.map((p, i) => {
    const m = meta[p.name];
    const own = playerOwnership(p.name, m?.nation);
    const ownTitle = own.pct
      ? t('players.owned.title', { pct: own.pct, n: displayScoreNumber(own.owners) })
      : '';
    const flag = m ? flagImg(m.nation_code, { width: 20, cls: 'flag-img', fallback: '' }) : '';
    return `
    <div class="pl-row">
      <span class="pl-rank">${displayScoreNumber(i + 1)}</span>
      <span class="pl-flag">${flag}</span>
      <span class="pl-name">
        <b>${escapeHtml(formatRosterName(p.name))}</b>
        <span class="pl-nation">${escapeHtml(m?.nation || '')}</span>
      </span>
      <span class="pl-icons">
        ${p.goals   ? `<span title="${escapeHtml(t('pts.goal'))}"><em>G</em>${displayScoreNumber(p.goals)}</span>` : ''}
        ${p.assists ? `<span title="${escapeHtml(t('pts.assist'))}"><em>A</em>${displayScoreNumber(p.assists)}</span>` : ''}
        ${p.cs      ? `<span title="${escapeHtml(t('pts.cleansheet'))}"><em>CS</em>${displayScoreNumber(p.cs)}</span>` : ''}
        ${p.mvp     ? `<span title="${escapeHtml(t('pts.mvp'))}"><em>MVP</em>${displayScoreNumber(p.mvp)}</span>` : ''}
        ${p.red     ? `<span title="${escapeHtml(t('pts.red'))}" class="neg"><em>RC</em>${displayScoreNumber(p.red)}</span>` : ''}
      </span>
      <span class="pl-own" title="${escapeHtml(ownTitle)}">${own.pct || '—'}</span>
      <span class="pl-total">${displayScoreNumber(p.points)}</span>
    </div>
    `;
  }).join('');

  board.innerHTML = `
    <input type="search" id="tpSearch" class="tp-search" placeholder="${escapeHtml(searchPlaceholder)}" value="${escapeHtml(tpState.query)}" />
    <div class="pl-board" style="margin-top:8px;">
      ${slice.length ? headerHtml + rowsHtml : `<div class="lb-empty">${noResults}</div>`}
    </div>
    ${filtered.length > tpState.visible
      ? `<div style="text-align:center;margin-top:12px;"><button class="ghost-btn" id="tpLoadMore">${loadMoreLabel}</button></div>`
      : ''}
  `;

  const search = document.getElementById('tpSearch');
  if (search) {
    search.addEventListener('input', (e) => {
      tpState.query = e.target.value;
      tpState.visible = TP_PAGE;   // reset on new search
      paintTopPlayers();
      // Refocus the input + place cursor at end after re-render
      requestAnimationFrame(() => {
        const s = document.getElementById('tpSearch');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      });
    });
  }
  const more = document.getElementById('tpLoadMore');
  if (more) more.onclick = () => { tpState.visible += TP_PAGE; paintTopPlayers(); };
}

async function openSquadModal(entryId, phaseOverride) {
  const [entryRes, scoresRes, fixturesRes, matchesRes] = await Promise.all([
    supabase.from('entries').select('*').eq('id', entryId).maybeSingle(),
    supabase.from('scores').select('match_date, points, breakdown').eq('entry_id', entryId),
    state._fixturesCache || fetch(FIXTURES_DATA_URL).then(r => r.json()).then(d => { state._fixturesCache = Promise.resolve(d); return d; }),
    supabase
      .from('matches')
      .select('external_id, date, home, away, status, home_goals, away_goals, scored_at')
      .order('date', { ascending: false })
      .limit(180),
  ]);
  const entry = entryRes.data;
  if (!entry) return;
  const fixturesData = fixturesRes;
  const scoreRows = scoresRes.data || [];
  const matchById = {};
  for (const m of matchesRes.data || []) matchById[String(m.external_id)] = m;
  const scoreRowByDate = {};
  for (const row of scoreRows) scoreRowByDate[row.match_date] = row;

  const phase = phaseOverride || currentSquadPhase();
  const playerStats = {};

  // Public squad view should match the scoring phase. During the MD3 transfer
  // window, show the frozen MD2 squad until MD3 actually kicks off.
  const xi = squadForPhase(entry, phase);
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);
  const phasePoints = phasePointsFromRows(scoreRows, fixturesData, matchById, entry, phase);

  // Some nations are spelled differently in fixtures.json vs xi_json roster.
  // Map our roster spelling → the fixtures.json spelling.
  const FIXTURE_NATION_ALIAS = {
    'DR Congo':              'Congo DR',
    'Cape Verde':            'Cape Verde Islands',
    'Bosnia and Herzegovina':'Bosnia & Herzegovina',
    'Turkey':                'Türkiye',
    'United States':         'USA',
  };
  // Returns { opp, scored }. "scored" means this current-phase fixture has
  // been scored in fantasy, so an absent player breakdown is a true 0.
  // Unscored/live/upcoming fixtures stay as "vs OPP".
  const fixtureCutoff = fixtureCutoffForPhase(entry, phase);
  function firstApplicableFixture(nation) {
    const fxNation = FIXTURE_NATION_ALIAS[nation] || nation;
    return (fixturesData.fixtures || []).find(f =>
      (f.home === fxNation || f.away === fxNation) && (!fixtureCutoff || new Date(f.date) >= fixtureCutoff)
    );
  }
  function nextMatchFor(nation) {
    const f = firstApplicableFixture(nation);
    if (!f) return null;
    const fxNation = FIXTURE_NATION_ALIAS[nation] || nation;
    const opponent = f.home === fxNation ? f.away : f.home;
    const dbMatch = matchById[String(f.id)] || {};
    return { fixture: f, label: `vs ${escapeHtml(opponent)}`, scored: Boolean(dbMatch.scored_at) };
  }
  function statsForFixture(item, match) {
    if (!match?.fixture || !match.scored) return null;
    const row = scoreRowByDate[(match.fixture.date || '').slice(0, 10)];
    const st = row?.breakdown?.[item.name];
    if (!st || Object.keys(st).length === 0) return null;
    const stats = { points: pointsFromStatLine(st), st };
    playerStats[item.name] = stats;
    return stats;
  }

  const isAr = document.documentElement.lang === 'ar';
  const ptsLabel = isAr ? 'نقاط' : 'pts';
  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    if (item?.empty) {
      return `<div class="pitch-slot empty" style="left:${coord.x}%;top:${coord.y}%;">
        <div class="ps-empty">${escapeHtml(t('slot.empty'))}</div>
        <div class="ps-tag">${escapeHtml(coord.tag || item.role || '')}</div>
      </div>`;
    }
    const name = displayLast(item) || '?';
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    const extra = name.length >= 13 ? 'letter-spacing:-0.3px;max-width:140px;' : '';
    const next = nextMatchFor(item.nation);
    const stats = statsForFixture(item, next);
    let foot = '';
    let tooltipAttr = '';
    if (stats) {
      const pts = stats.points;
      const cls = pts > 0 ? 'pos' : pts < 0 ? 'neg' : '';
      foot = `<div class="ps-pts ${cls}">${pts >= 0 ? '+' : ''}${pts}</div>`;
      const txt = describeStatTextLocal(stats.st);
      const tip = `${pts >= 0 ? '+' : ''}${pts} ${ptsLabel}${txt ? '  ·  ' + txt : ''}`;
      tooltipAttr = ` title="${escapeHtml(tip)}"`;
    } else if (next) {
      // Scored, no points → just "0". Not scored yet → just "vs OPP".
      foot = next.scored
        ? `<div class="ps-pts" style="color:var(--text-dim);">0</div>`
        : `<div class="ps-next">${next.label}</div>`;
    }
    return `<div class="pitch-slot filled"${tooltipAttr} style="left:${coord.x}%;top:${coord.y}%;">
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
  const modalPointsLabel = isAr
    ? `${displayScoreNumber(phasePoints)} نقاط الجولة`
    : `${displayScoreNumber(phasePoints)} round pts`;
  modal.innerHTML = `
    <div class="modal-card" style="max-width:560px;">
      <button class="modal-x" id="squadModalX">×</button>
      <h2 class="modal-title">${escapeHtml(entry.team_name)}</h2>
      <p class="modal-sub"><b style="color:var(--accent);">${escapeHtml(modalPointsLabel)}</b></p>
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
      ${renderScoreDetails(playerStats, starters)}
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('squadModalX').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

function renderLeaderboardPager() {
  const pageCount = Math.max(1, Math.ceil((state.lbTotal || 0) / LB_PAGE_SIZE));
  const page = Math.max(0, Math.min(state.lbPage || 0, pageCount - 1));
  const label = t('lb.page', {
    page: displayScoreNumber(page + 1),
    pages: displayScoreNumber(pageCount),
  });
  return `
    <div class="lb-pager">
      <button class="ghost-btn lb-page-btn" id="lbPrevPage" ${page <= 0 ? 'disabled' : ''}>${escapeHtml(t('lb.prev'))}</button>
      <span>${escapeHtml(label)}</span>
      <button class="ghost-btn lb-page-btn" id="lbNextPage" ${page >= pageCount - 1 ? 'disabled' : ''}>${escapeHtml(t('lb.next'))}</button>
    </div>
  `;
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
