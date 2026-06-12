// My Team page — detailed pitch view + per-match score breakdown.

import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';
import { setLang, t } from './js/i18n.js';
import { flagImg } from './js/flags.js';

mountAuthWidget(document.getElementById('authSlot'));

document.getElementById('langToggle').onclick = () => {
  const cur = document.documentElement.lang === 'ar' ? 'en' : 'ar';
  setLang(cur);
  document.getElementById('langToggle').textContent = cur === 'ar' ? 'English' : 'عربي';
  if (state.entry) renderEntry();
};

const HALO_LEAGUE_ID = '11111111-1111-1111-1111-111111111111';

const PITCH_COORDS = [
  { x: 50,  y: 88, tag: 'GK'  },
  { x: 20,  y: 70, tag: 'FB'  }, { x: 80,  y: 70, tag: 'FB' },
  { x: 38,  y: 70, tag: 'CB'  }, { x: 62,  y: 70, tag: 'CB' },
  { x: 30,  y: 45, tag: 'CM'  }, { x: 70,  y: 45, tag: 'CM' },
  { x: 10,  y: 35, tag: 'WIN' }, { x: 90,  y: 35, tag: 'WIN' },
  { x: 35,  y: 18, tag: 'ST'  }, { x: 65,  y: 18, tag: 'ST'  },
];

const state = {
  user: null,
  entry: null,
  fixtures: [],
  scores: [],
  nations: {},
};

(async () => {
  const u = await currentUser();
  state.user = u;
  if (!u) {
    document.getElementById('signinPrompt').style.display = 'block';
    document.getElementById('teamHero').style.display = 'none';
    return;
  }

  const [entryRes, fixturesRes, teamsRes] = await Promise.all([
    supabase.from('entries')
      .select('id, team_name, formation, submitted_at, xi_json')
      .eq('league_id', HALO_LEAGUE_ID).eq('user_id', u.id).maybeSingle(),
    fetch('data/fixtures.json').then(r => r.json()),
    fetch('data/teams.json').then(r => r.json()),
  ]);

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
  for (const tm of teamsRes.teams) state.nations[tm.name] = tm;

  const { data: scoreRows } = await supabase
    .from('scores')
    .select('match_date, points, breakdown')
    .eq('entry_id', state.entry.id)
    .order('match_date', { ascending: true });
  state.scores = scoreRows || [];

  renderEntry();
})();

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

  // Aggregate per-player stats from this entry's scores so each pitch slot
  // can show its total points + the icon breakdown of how those were earned.
  const playerStats = {};
  for (const row of state.scores) {
    for (const [pname, st] of Object.entries(row.breakdown || {})) {
      if (!st || Object.keys(st).length === 0) continue;
      if (!playerStats[pname]) playerStats[pname] = { points: 0, st: {} };
      const pts = (st.win||0) + (st.full90||0) + (st.goals||0) + (st.assists||0) + (st.cleanSheet||0) + (st.mvp||0) - (st.red ? 1 : 0);
      playerStats[pname].points += pts;
      for (const k of ['goals','assists','cleanSheet','win','full90','mvp']) playerStats[pname].st[k] = (playerStats[pname].st[k] || 0) + (st[k] || 0);
      if (st.red) playerStats[pname].st.red = true;
    }
  }

  // Pitch
  const xi = state.entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    const name = displayLast(item) || '?';
    const stats = playerStats[item.name];
    const hasPlayed = stats && stats.points !== undefined;
    let foot = '';
    let tooltipAttr = '';
    if (hasPlayed) {
      const pts = stats.points;
      const cls = pts > 0 ? 'pos' : pts < 0 ? 'neg' : '';
      const icons = describeStat(stats.st);
      // Just the points number on-pitch; full icon breakdown lives in a hover
      // tooltip (native browser title) + the Match Breakdown card below.
      foot = `<div class="ps-pts ${cls}">${pts >= 0 ? '+' : ''}${pts}</div>`;
      const tip = `${pts >= 0 ? '+' : ''}${pts} pts${icons && icons !== '—' ? '  ·  ' + icons : ''}`;
      tooltipAttr = ` title="${escapeHtml(tip)}"`;
    } else {
      const next = nextGameFor(item.nation);
      foot = next ? `<div class="next-game ${next.live ? 'live' : ''}">${next.label}</div>` : '';
    }
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    return `<div class="pitch-slot filled"${tooltipAttr} style="left:${coord.x}%;top:${coord.y}%;direction:ltr;">
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

  // Per-match breakdown
  if (state.scores.length === 0) {
    document.getElementById('teamBreakdown').innerHTML = `
      <h3>${t('team.bd.title')}</h3>
      <div style="font-size:13px;color:var(--text-dim);text-align:center;padding:8px 0;">
        ${t('team.bd.empty')}
      </div>
    `;
    return;
  }

  // Build a list of per-player contributions across all scored matches.
  // For each one, look up the actual fixture (date + nation) so we can
  // show "vs OPP · MD1" instead of just the date.
  const rowsByMatch = {};
  for (const s of state.scores) {
    for (const [playerName, st] of Object.entries(s.breakdown || {})) {
      if (!st || Object.keys(st).length === 0) continue;
      const xiPick = (state.entry.xi_json || []).find(x => x.name === playerName);
      const ourNation = xiPick?.nation || '';
      const fxNation = FIXTURE_NATION_ALIAS[ourNation] || ourNation;
      const fixture = state.fixtures.find(f =>
        f.date.slice(0, 10) === s.match_date && (f.home === fxNation || f.away === fxNation)
      );
      const opponent = fixture ? (fixture.home === fxNation ? fixture.away : fixture.home) : '?';
      const matchKey = fixture ? fixture.id : `unk-${s.match_date}-${ourNation}`;
      const roundLabel = fixture ? roundShort(fixture.round) : '';
      const pts = (st.win||0) + (st.full90||0) + (st.goals||0) + (st.assists||0) + (st.cleanSheet||0) + (st.mvp||0) - (st.red ? 1 : 0);
      if (!rowsByMatch[matchKey]) {
        rowsByMatch[matchKey] = {
          date: s.match_date,
          opponent,
          round: roundLabel,
          score: fixture ? `${fixture.home_goals ?? '?'}-${fixture.away_goals ?? '?'}` : '',
          home: fixture?.home,
          players: [],
        };
      }
      rowsByMatch[matchKey].players.push({ name: playerName, st, pts });
    }
  }

  const rowsHtml = Object.values(rowsByMatch)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(m => {
      const playerLines = m.players.map(p => {
        const cls = p.pts > 0 ? 'pos' : p.pts < 0 ? 'neg' : '';
        return `<div class="tb-player">
          <span>${escapeHtml(displayPlayerNameShort(p.name))} <span class="tb-icons">${describeStat(p.st)}</span></span>
          <span class="tb-pts ${cls}">${p.pts >= 0 ? '+' : ''}${p.pts}</span>
        </div>`;
      }).join('');
      const matchPts = m.players.reduce((s, p) => s + p.pts, 0);
      const matchCls = matchPts > 0 ? 'pos' : matchPts < 0 ? 'neg' : '';
      return `
        <div class="tb-match">
          <div class="tb-match-head">
            <span><b>vs ${escapeHtml(m.opponent)}</b>${m.round ? ` · <span style="color:var(--text-dim);">${escapeHtml(m.round)}</span>` : ''}${m.score ? ` · <span style="color:var(--text-dim);">${escapeHtml(m.score)}</span>` : ''}</span>
            <span class="tb-pts ${matchCls}">${matchPts >= 0 ? '+' : ''}${matchPts}</span>
          </div>
          ${playerLines}
        </div>
      `;
    }).join('');

  document.getElementById('teamBreakdown').innerHTML = `
    <h3>${t('team.bd.title')}</h3>
    ${rowsHtml}
  `;
}

const FIXTURE_NATION_ALIAS = {
  'DR Congo':              'Congo DR',
  'Cape Verde':            'Cape Verde Islands',
  'Bosnia and Herzegovina':'Bosnia & Herzegovina',
  'Turkey':                'Türkiye',
  'United States':         'USA',
};
function nextGameFor(nation) {
  const fxNation = FIXTURE_NATION_ALIAS[nation] || nation;
  const now = new Date();
  const upcoming = state.fixtures.find(f =>
    (f.home === fxNation || f.away === fxNation) &&
    new Date(f.date) > now
  );
  if (!upcoming) return null;
  const opponent = upcoming.home === fxNation ? upcoming.away : upcoming.home;
  return { label: `vs ${opponent}`, live: false };
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
