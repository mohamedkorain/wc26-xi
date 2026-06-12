// My Team page — detailed pitch view + per-match score breakdown.

import { supabase } from './js/supabase-client.js';
import { mountAuthWidget, currentUser } from './js/auth.js';
import { setLang, t } from './js/i18n.js';

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
  const submitted = new Date(state.entry.submitted_at).toLocaleDateString();

  document.getElementById('teamMeta').innerHTML = `
    <div>
      <div class="tm-name">${escapeHtml(state.entry.team_name)}</div>
      <div style="font-size:11px;color:var(--text-dim);">${state.entry.formation} · ${submitted}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">${t('team.totalpts')}</div>
      <div class="tm-pts">${total}</div>
    </div>
  `;

  // Pitch
  const xi = state.entry.xi_json || [];
  const starters = xi.filter(x => !x.wild).sort((a, b) => a.slot - b.slot);
  const wild = xi.find(x => x.wild);

  const slotsHtml = starters.map((item, i) => {
    const coord = PITCH_COORDS[i] || { x: 50, y: 50, tag: item.tag };
    const name = displayLast(item) || '?';
    const next = nextGameFor(item.nation);
    const sz = name.length >= 16 ? 8 : name.length >= 13 ? 9 : name.length >= 10 ? 10 : 11;
    return `<div class="pitch-slot filled" style="left:${coord.x}%;top:${coord.y}%;direction:ltr;">
      <div class="ps-flag">${flagImg(item.nation_code, 40)}</div>
      <div class="ps-name" style="font-size:${sz}px;">${escapeHtml(name)}</div>
      <div class="ps-tag">${coord.tag}</div>
      ${next ? `<div class="next-game ${next.live ? 'live' : ''}">${next.label}</div>` : ''}
    </div>`;
  }).join('');

  const benchHtml = wild ? `
    <div class="bench-label">${t('squad.bench') || 'Wildcard'}</div>
    <div class="bench-slot filled">
      <span>${flagImg(wild.nation_code, 20)} <b>${escapeHtml(displayLast(wild))}</b>
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

  const rowsHtml = state.scores.map(s => {
    const cls = s.points > 0 ? 'pos' : s.points < 0 ? 'neg' : '';
    const dateLabel = new Date(s.match_date + 'T00:00:00Z').toLocaleDateString(
      document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-GB',
      { day: '2-digit', month: 'short' }
    );
    const contributors = Object.entries(s.breakdown || {})
      .filter(([_, st]) => st && Object.keys(st).length > 0)
      .map(([player, st]) => `${escapeHtml(displayPlayerNameShort(player))} (${describeStat(st)})`)
      .join(', ');
    return `
      <div class="tb-row">
        <div>
          <div>${dateLabel}</div>
          <div class="tb-date">${contributors || '—'}</div>
        </div>
        <div class="tb-pts ${cls}">${s.points >= 0 ? '+' : ''}${s.points}</div>
      </div>
    `;
  }).join('');

  document.getElementById('teamBreakdown').innerHTML = `
    <h3>${t('team.bd.title')}</h3>
    ${rowsHtml}
  `;
}

function nextGameFor(nation) {
  const now = new Date();
  const upcoming = state.fixtures.find(f =>
    (f.home === nation || f.away === nation) &&
    new Date(f.date) > now
  );
  if (!upcoming) return null;
  const opponent = upcoming.home === nation ? upcoming.away : upcoming.home;
  const oppCode = state.nations[opponent]?.code || '';
  const d = new Date(upcoming.date);
  const isAr = document.documentElement.lang === 'ar';
  const day = d.toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', { weekday: 'short' });
  const time = d.toLocaleTimeString(isAr ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const flag = flagEmoji(oppCode);
  return { label: `${t('next.label')} ${flag} ${day} ${time}`, live: false };
}

function flagImg(code, width) {
  const c = (code || '').toLowerCase();
  if (!c) return '';
  return `<img src="https://flagcdn.com/w${width || 40}/${c}.png" alt="" class="flag-img-mid" style="height:auto;width:${width || 40}px;border-radius:3px;" />`;
}

function flagEmoji(code) {
  if (!code) return '';
  const c = code.toUpperCase();
  // ISO-2 → regional indicator emoji
  if (c.length === 2) {
    return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
  }
  return '';
}

function displayLast(item) {
  // build.js stores .shirt_name typically; fall back to last word of name
  if (item.shirt_name) return item.shirt_name;
  return (item.name || '').split(' ')[0] || '';
}

function displayPlayerNameShort(raw) {
  return (raw || '').split(' ')[0] || raw;
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
