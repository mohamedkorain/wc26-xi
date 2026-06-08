// Minimal i18n for HALO AMRIKA — EN ⇄ AR.
// Usage:
//   <h1 data-i18n="hero.title">English fallback</h1>
//   <input data-i18n-placeholder="filter.search" placeholder="…">
//   In JS:  import { t, setLang, getLang } from './js/i18n.js';
//           const label = t('lb.title');
//   Listen for `window.addEventListener('langchange', cb)` to re-render
//   dynamic strings after a toggle.

const DICT = {
  en: {
    'hero.eyebrow':   'A Saba7o Korah Production',
    'hero.tag':       'Build your fantasy World Cup XI. Spin the randomizer, draft 12 players, climb the leaderboard.<br/><b>Jun 11 – Jul 19, 2026.</b>',
    'hero.loading':   'Loading…',
    'cta.build':      'Build my squad →',
    'cta.lb':         'View leaderboard',

    'lb.title':       'Leaderboard',
    'lb.team':        'TEAM NAME',
    'lb.owner':       'OWNER',
    'lb.pts':         'PTS',
    'lb.empty':       'No squads submitted yet. Be the first — <a href="build.html" style="color:var(--accent);">Build my squad →</a>',
    'lb.entries.one': '1 entry',
    'lb.entries.n':   '{n} entries',

    'squad.title':    'Squad · 4-4-2',
    'squad.note':     '12 picks per squad. 11 active starters earn points; wildcard sits on the bench. At least one player must be from an Arab nation.',
    'squad.build.title': 'Squad — 4-4-2',
    'squad.bench':    'BENCH · Wildcard',
    'squad.bench.empty': 'Wildcard slot — last pick, any position',

    'scoring.title':  'Scoring',
    'scoring.note':   'Progression bonuses (per starter, cumulative): R32 +2 · R16 +2 · QF +3 · SF +4 · Final +4 · Champion +5 (max +20).',

    'rule.win':       "Team win (played 1'+)",
    'rule.90':        "Bonus if full 90'",
    'rule.goal':      'Goal scored',
    'rule.assist':    'Assist',
    'rule.cs':        "Clean sheet (GK/CB/FB/CM, 45'+)",
    'rule.mvp':       'MVP / Man of the Match',
    'rule.red':       'Red card',

    'pool.title':     'Player Pool',
    'pool.stats':     '{n} players · {teams} nations · 6 categories',
    'filter.search':  'Search player or club…',
    'filter.all.cat': 'All categories',
    'filter.cat':     'Category {n}',
    'filter.all.nat': 'All nations',
    'filter.all.role':'All roles',
    'filter.arab':    'Arab only',
    'pool.more':      'Show {n} more · {rest} remaining',

    'footer.line1':   'HALO AMRIKA · Saba7o USA · Series 04 · A Saba7o Korah Production',
    'footer.line2':   'Hosted by Nsoo7y, Marei & Orfy',

    // build page
    'build.brandsub': 'Build My Squad',
    'build.randomizer': 'The Randomizer',
    'reel.nation':    'NATION',
    'reel.role':      'ROLE',
    'spin':           'SPIN',
    'spin.hint':      '12 picks total. Each spin gives you a nation + position. Pick one player from the matching list.',
    'spin.hint.next': '{n} of 12 picked — spin to draw your next nation + position.',
    'spin.hint.done': 'Squad complete — name it and submit below.',
    'spin.locked':    '🔒 Submissions are locked.',
    'pick.from':      'Pick from',
    'reroll.left':    'Re-spin ({n} left)',
    'reroll.none':    'Re-spins used — pick a player',
    'status':         'Status',
    'status.players': '12 players drafted',
    'status.arab':    '≥1 Arab player',
    'status.formation':'Formation',
    'submit.title':   'Submit',
    'submit.placeholder':'Team name…',
    'submit.btn':     'Submit Squad',
    'submit.saving':  'Saving…',
    'submit.saved':   'Squad saved! <a href="index.html#leaderboard" style="color:var(--accent);">View leaderboard →</a> (You can still tinker until {at}.)',

    'auth.signin':    'Sign in',
    'auth.signout':   'Sign out',
    'auth.myleagues': 'My leagues',
  },
  ar: {
    'hero.eyebrow':   'من إنتاج صباحو كرة',
    'hero.tag':       'ابني تشكيلتك لكأس العالم. لُف العجلة، اختار ١٢ لاعب، واطلع على القمة.<br/><b>١١ يونيو – ١٩ يوليو ٢٠٢٦.</b>',
    'hero.loading':   'جاري التحميل…',
    'cta.build':      '← ابدأ التشكيلة',
    'cta.lb':         'الترتيب',

    'lb.title':       'الترتيب',
    'lb.team':        'اسم الفريق',
    'lb.owner':       'المالك',
    'lb.pts':         'نقاط',
    'lb.empty':       'لسه ما حدش بعت تشكيلة. كن أول واحد — <a href="build.html" style="color:var(--accent);">ابدأ التشكيلة →</a>',
    'lb.entries.one': 'تشكيلة واحدة',
    'lb.entries.n':   '{n} تشكيلة',

    'squad.title':    'التشكيلة · ٤-٤-٢',
    'squad.note':     '١٢ اختيار لكل تشكيلة. ١١ لاعب أساسي يجيبوا النقاط؛ والاحتياطي (الورقة الحرة) قاعد على الدكة. لازم لاعب واحد على الأقل يكون من منتخب عربي.',
    'squad.build.title': 'التشكيلة — ٤-٤-٢',
    'squad.bench':    'الدكة · الورقة الحرة',
    'squad.bench.empty': 'مكان الورقة الحرة — آخر اختيار، أي مركز',

    'scoring.title':  'النقاط',
    'scoring.note':   'مكافآت التقدم (لكل أساسي، تراكمية): دور ٣٢ ‎+٢‎ · دور ١٦ ‎+٢‎ · ربع نهائي ‎+٣‎ · نصف نهائي ‎+٤‎ · النهائي ‎+٤‎ · البطل ‎+٥‎ (حد أقصى ‎+٢٠‎).',

    'rule.win':       'فوز المنتخب (لعب ١ دقيقة على الأقل)',
    'rule.90':        'مكافأة لو لعب ٩٠ دقيقة كاملة',
    'rule.goal':      'تسجيل هدف',
    'rule.assist':    'صناعة هدف',
    'rule.cs':        'شباك نظيفة (حارس/قلب دفاع/ظهير/وسط، ٤٥ دقيقة)',
    'rule.mvp':       'أفضل لاعب في المباراة',
    'rule.red':       'كارت أحمر',

    'pool.title':     'قائمة اللاعبين',
    'pool.stats':     '{n} لاعب · {teams} منتخب · ٦ فئات',
    'filter.search':  'ابحث عن لاعب أو نادي…',
    'filter.all.cat': 'كل الفئات',
    'filter.cat':     'الفئة {n}',
    'filter.all.nat': 'كل المنتخبات',
    'filter.all.role':'كل المراكز',
    'filter.arab':    'العرب فقط',
    'pool.more':      'عرض {n} أكثر · باقي {rest}',

    'footer.line1':   'هالو أمريكا · صباحو USA · موسم ٤ · من إنتاج صباحو كرة',
    'footer.line2':   'تقديم نصوحي، مرعي وعرفي',

    'build.brandsub': 'ابني التشكيلة',
    'build.randomizer': 'العجلة',
    'reel.nation':    'منتخب',
    'reel.role':      'مركز',
    'spin':           'لُف',
    'spin.hint':      '١٢ اختيار. كل لفّة بتديك منتخب + مركز. اختار لاعب من القائمة.',
    'spin.hint.next': '{n} من ١٢ اختير — لُف للاختيار اللي بعده.',
    'spin.hint.done': 'التشكيلة كملت — سمّيها وابعتها تحت.',
    'spin.locked':    '🔒 التشكيلات مقفولة.',
    'pick.from':      'اختار من',
    'reroll.left':    'لُف تاني ({n} متبقي)',
    'reroll.none':    'استنفدت اللفّات — اختار لاعب',
    'status':         'الحالة',
    'status.players': '١٢ لاعب',
    'status.arab':    'لاعب عربي واحد على الأقل',
    'status.formation':'التشكيلة',
    'submit.title':   'إرسال',
    'submit.placeholder':'اسم الفريق…',
    'submit.btn':     'أرسل التشكيلة',
    'submit.saving':  'جاري الحفظ…',
    'submit.saved':   'اتحفظت! <a href="index.html#leaderboard" style="color:var(--accent);">شوف الترتيب →</a> (تقدر تعدّل لحد {at}.)',

    'auth.signin':    'تسجيل دخول',
    'auth.signout':   'خروج',
    'auth.myleagues': 'دوريّاتي',
  },
};

let LANG = localStorage.getItem('wc26.lang') || 'en';

export function getLang() { return LANG; }

export function t(key, vars) {
  let s = DICT[LANG]?.[key] ?? DICT.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function setLang(lang) {
  LANG = (lang === 'ar') ? 'ar' : 'en';
  localStorage.setItem('wc26.lang', LANG);
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  applyToDom();
  // Update toggle button label
  const btn = document.getElementById('langToggle');
  if (btn) btn.textContent = LANG === 'ar' ? 'EN' : 'عربي';
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: LANG } }));
}

function applyToDom() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.innerHTML = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
}

// Auto-apply on load
document.addEventListener('DOMContentLoaded', () => {
  setLang(LANG);
  const btn = document.getElementById('langToggle');
  if (btn) btn.onclick = () => setLang(LANG === 'ar' ? 'en' : 'ar');
});
