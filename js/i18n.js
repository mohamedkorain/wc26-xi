// Minimal i18n for HALLO AMRIKA — EN ⇄ AR.
// Usage:
//   <h1 data-i18n="hero.title">English fallback</h1>
//   <input data-i18n-placeholder="filter.search" placeholder="…">
//   In JS:  import { t, setLang, getLang } from './js/i18n.js';
//           const label = t('lb.title');
//   Listen for `window.addEventListener('langchange', cb)` to re-render
//   dynamic strings after a toggle.

const DICT = {
  en: {
    'brand.mark':     'HALLO AMRIKA',
    'hero.eyebrow':   'A Saba7o Koraa Production',
    'hero.tag':       'Build your fantasy World Cup XI. Spin the randomizer, draft 12 players, climb the leaderboard.<br/><b>Jun 11 – Jul 19, 2026.</b>',
    'hero.loading':   'Loading…',
    'cta.build':      'Build my squad →',
    'cta.viewsquad':  'View my squad ↓',
    'cta.lb':         'View leaderboard',
    'share.whatsapp': '📱 Share on WhatsApp',
    'share.copy':     'Copy link',
    'share.copied':   '✓ Copied!',
    'submit.modal.title': 'Squad submitted!',
    'submit.modal.sub':   '"{name}" is on the leaderboard. Share with friends — every signup is one more squad to beat.',
    'submit.modal.view':  'View leaderboard →',
    'submit.modal.close': 'Close',
    'wildcard.help': 'WILDCARD: your 12th pick, sits on the bench. After the 12-pick draft you can swap them with a starter of the same position. Use it as a safety net for a position you regret.',

    'lb.title':       'Leaderboard',
    'lb.team':        'TEAM NAME',
    'lb.owner':       'COACH',
    'lb.pts':         'PTS',
    'lb.empty':       'No squads submitted yet. Be the first — <a href="build.html" style="color:var(--accent);">Build my squad →</a>',
    'lb.entries.one': '1 entry',
    'lb.entries.n':   '{n} entries',
    'lb.loadmore':    'Load {n} more · {rest} remaining',

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

    'footer.line1':   'HALLO AMRIKA · Saba7o USA · Series 04 · A Saba7o Korah Production',
    'footer.line2':   'Hosted by Nsoo7y, Marei & Orfy',

    // build page
    'build.brandsub': 'Build My Squad',
    'build.randomizer': 'The Randomizer',
    'reel.nation':    'NATION',
    'reel.role':      'POSITION',
    'spin':           'SPIN',
    'spin.hint':      '12 picks total. Each spin gives you a nation + position. Pick one player from the matching list.',
    'spin.hint.next': '{n} of 12 picked — spin to draw your next nation + position.',
    'spin.hint.done': 'Squad complete — name it and submit below.',
    'spin.locked':    '🔒 Submissions are locked.',
    'pick.from':      'Pick from',
    'pick.bucket':    'pick a position bucket',
    'pick.player':    'Pick a player —',
    'pick.btn':       'PICK',
    'back.buckets':   '← Back to position buckets',
    'cand.empty':     'No eligible players in this bucket.',
    'slot.choose':    'pick a slot',
    'bucket.gk_st':   'GK / ST',
    'bucket.def':     'DEFENDER',
    'bucket.mid':     'MIDFIELDER',
    'bucket.wild':    'WILDCARD',
    'categories':     'Categories (max 2 each)',
    'spin.wildcard.hint': '11 of 12 picked — your last spin draws your WILDCARD nation (any position).',
    'reset.btn':      '↺ Start over',
    'reset.confirm':  'Clear your current squad and re-draft from scratch? (Your saved entry stays until you submit a new one.)',
    'mysquad.title':  'My Squad',
    'mysquad.submitted':'submitted {at}',
    'mysquad.edit':   'Edit my squad →',
    'status':         'Status',
    'status.players': '12 players drafted',
    'status.arab':    '≥1 Arab player',
    'status.formation':'Formation',
    'subin.title':    'Sub In Wildcard',
    'subin.hint':     'Squad complete — optionally swap your wildcard into the XI, then submit below.',
    'subin.options':  'Swap {wild} ({roles}) with a starter of the same role:',
    'subin.none':     'No starter has the same role as your wildcard — your XI stays as drafted.',
    'submit.title':   'Submit',
    'submit.placeholder':'Team name…',
    'submit.btn':     'Submit Squad',
    'submit.saving':  'Saving…',
    'submit.saved':   'Squad saved! <a href="index.html#leaderboard" style="color:var(--accent);">View leaderboard →</a> (You can still tinker until {at}.)',

    'auth.signin':    'Sign in',
    'auth.signout':   'Sign out',
    'auth.myleagues': 'My leagues',
    'auth.editname':  'Edit display name',
    'auth.nameprompt':'Set your display name (shown on the leaderboard):',
    'login.title':    'Sign in',
    'login.sub':      "We'll email you a one-tap login link. No password.",
    'login.email':    'EMAIL',
    'login.placeholder':'you@example.com',
    'login.send':     'Send magic link →',
    'login.or':       'OR',
    'login.guest':    'Continue as guest (testing) →',
    'login.sending':  'Sending…',
    'login.sent':     'Sent! Check {email} for a sign-in link.',
    'login.guesting': 'Creating guest session…',
  },
  ar: {
    'brand.mark':     'هاللو امريكا',
    'hero.eyebrow':   'من إنتاج صباحو كوره',
    'hero.tag':       'صباحوووووو، عايز تلعب معانا؟! ابني فرقتك لتحدي صباحو كورة كأس العالم ٢٠٢٦ هاللو أمريكا، اختار ١٢ لاعب دلوقتي حالا عشان تنافسنا 💪🏻💪🏻',
    'hero.loading':   'جاري التحميل…',
    'cta.build':      '← ابدأ التشكيلة',
    'cta.viewsquad':  '↓ شوف تشكيلتك',
    'cta.lb':         'الترتيب',
    'share.whatsapp': '📱 شير على واتساب',
    'share.copy':     'انسخ اللينك',
    'share.copied':   '✓ اتنسخ!',
    'submit.modal.title': 'التشكيلة اتبعتت!',
    'submit.modal.sub':   '"{name}" دلوقتي في الترتيب. شيرها مع أصحابك — كل تسجيل تشكيلة جديدة لازم تتغلب عليها.',
    'submit.modal.view':  '← شوف الترتيب',
    'submit.modal.close': 'إغلاق',
    'wildcard.help': 'الورقة الحرة: الاختيار رقم ١٢ بيقعد على الدكة. بعد ما تخلص التشكيلة، تقدر تبدّله مع أساسي في نفس المركز. استخدمه لو ندمت على لاعب.',

    'lb.title':       'الترتيب',
    'lb.team':        'اسم الفريق',
    'lb.owner':       'المدرب',
    'lb.pts':         'نقاط',
    'lb.empty':       'لسه ما حدش بعت تشكيلة. كن أول واحد — <a href="build.html" style="color:var(--accent);">ابدأ التشكيلة →</a>',
    'lb.entries.one': 'تشكيلة واحدة',
    'lb.entries.n':   '{n} تشكيلة',
    'lb.loadmore':    'حمّل {n} كمان · باقي {rest}',

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
    'reel.role':      'المركز',
    'spin':           'لُف',
    'spin.hint':      '١٢ اختيار. كل لفّة بتديك منتخب + مركز. اختار لاعب من القائمة.',
    'spin.hint.next': '{n} من ١٢ اختير — لُف للاختيار اللي بعده.',
    'spin.hint.done': 'التشكيلة كملت — سمّيها وابعتها تحت.',
    'spin.locked':    '🔒 التشكيلات مقفولة.',
    'pick.from':      'اختار من',
    'pick.bucket':    'اختار المركز',
    'pick.player':    'اختار لاعب —',
    'pick.btn':       'اختار',
    'back.buckets':   '← رجوع للمراكز',
    'cand.empty':     'مفيش لاعبين متاحين في المركز ده.',
    'slot.choose':    'اختار مكان في الملعب',
    'bucket.gk_st':   'حارس / مهاجم',
    'bucket.def':     'مدافع',
    'bucket.mid':     'لاعب وسط',
    'bucket.wild':    'ورقة حرة',
    'categories':     'الفئات (حد أقصى ٢ لكل واحدة)',
    'spin.wildcard.hint': '١١ من ١٢ — آخر لفّة للورقة الحرة (أي مركز).',
    'reset.btn':      '↺ ابدأ من جديد',
    'reset.confirm':  'تمسح التشكيلة وتبدأ من جديد؟ (التشكيلة المحفوظة فاضلة لحد ما تبعت واحدة جديدة.)',
    'mysquad.title':  'تشكيلتي',
    'mysquad.submitted':'اتبعتت {at}',
    'mysquad.edit':   '← تعديل التشكيلة',
    'status':         'الحالة',
    'status.players': '١٢ لاعب',
    'status.arab':    'لاعب عربي واحد على الأقل',
    'status.formation':'التشكيلة',
    'subin.title':    'تبديل الورقة الحرة',
    'subin.hint':     'التشكيلة كملت — تقدر تبدّل ورقتك الحرة مع أساسي.',
    'subin.options':  'بدّل {wild} ({roles}) مع أساسي بنفس المركز:',
    'subin.none':     'مفيش أساسي بنفس مركز الورقة الحرة — التشكيلة هتفضل زي ما هي.',
    'submit.title':   'إرسال',
    'submit.placeholder':'اسم الفريق…',
    'submit.btn':     'أرسل التشكيلة',
    'submit.saving':  'جاري الحفظ…',
    'submit.saved':   'اتحفظت! <a href="index.html#leaderboard" style="color:var(--accent);">شوف الترتيب →</a> (تقدر تعدّل لحد {at}.)',

    'auth.signin':    'تسجيل دخول',
    'auth.signout':   'خروج',
    'auth.myleagues': 'دوريّاتي',
    'auth.editname':  'تعديل الاسم المعروض',
    'auth.nameprompt':'اختار اسم يبان في الترتيب:',
    'login.title':    'تسجيل دخول',
    'login.sub':      'هنبعتلك رابط دخول بضغطة واحدة. من غير باسورد.',
    'login.email':    'الإيميل',
    'login.placeholder':'you@example.com',
    'login.send':     '← ابعت الرابط',
    'login.or':       'أو',
    'login.guest':    '← دخول كضيف (تجريبي)',
    'login.sending':  'جاري الإرسال…',
    'login.sent':     'اتبعت! شوف إيميل {email} علشان تلاقي الرابط.',
    'login.guesting': 'بنفتح جلسة ضيف…',
  },
};

// Read at module-load time. Cross-page navigation on the same origin keeps
// localStorage, so once the user picks AR it stays AR everywhere.
let LANG = (() => {
  try { return localStorage.getItem('wc26.lang') || 'en'; }
  catch { return 'en'; }
})();

// Set <html lang/dir> synchronously so first-paint isn't briefly LTR before
// the DOMContentLoaded handler runs.
try {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
} catch {}

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
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
}

// Auto-apply on load
document.addEventListener('DOMContentLoaded', () => {
  setLang(LANG);
  const btn = document.getElementById('langToggle');
  if (btn) btn.onclick = () => setLang(LANG === 'ar' ? 'en' : 'ar');
});
