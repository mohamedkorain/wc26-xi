// FIFA 3-letter code → ISO 3166-1 alpha-2 (or subdivision) for flagcdn.com.
// flagcdn returns PNG/SVG flags by ISO code with HTTPS + CDN caching.
const FIFA_TO_ISO = {
  ALG: 'dz', ARG: 'ar', AUS: 'au', AUT: 'at', BEL: 'be',
  BIH: 'ba', BRA: 'br', CAN: 'ca', CPV: 'cv', COL: 'co',
  CRO: 'hr', CUW: 'cw', CZE: 'cz', COD: 'cd', ECU: 'ec',
  EGY: 'eg', ENG: 'gb-eng', FRA: 'fr', GER: 'de', GHA: 'gh',
  HAI: 'ht', IRN: 'ir', IRQ: 'iq', CIV: 'ci', JPN: 'jp',
  JOR: 'jo', MEX: 'mx', MAR: 'ma', NED: 'nl', NZL: 'nz',
  NOR: 'no', PAN: 'pa', PAR: 'py', POR: 'pt', QAT: 'qa',
  KSA: 'sa', SCO: 'gb-sct', SEN: 'sn', RSA: 'za', KOR: 'kr',
  ESP: 'es', SWE: 'se', SUI: 'ch', TUN: 'tn', TUR: 'tr',
  USA: 'us', URU: 'uy', UZB: 'uz',
};

// Renders an <img> tag for the flag at the requested width (default 40).
// Falls back to the emoji (passed in) if the image fails to load.
export function flagImg(code, opts = {}) {
  const iso = FIFA_TO_ISO[(code || '').toUpperCase()];
  const w = opts.width || 40;
  const cls = opts.cls || 'flag-img';
  if (!iso) return `<span class="${cls}-fallback">${opts.fallback || ''}</span>`;
  const src = `https://flagcdn.com/w${w}/${iso}.png`;
  const srcset = `https://flagcdn.com/w${w * 2}/${iso}.png 2x`;
  return `<img class="${cls}" src="${src}" srcset="${srcset}" alt="${code}" loading="lazy" onerror="this.outerHTML='<span class=\\'${cls}-fallback\\'>${opts.fallback || ''}</span>'" />`;
}

// Returns just the URL for a flag at the given width (no <img> wrapper).
// Used for spin animation where we mutate a single <img> src rather than
// recreate the element on every tumble frame (otherwise the browser
// re-fetches each flag and mobile shows blanks).
export function flagUrl(code, width = 80) {
  const iso = FIFA_TO_ISO[(code || '').toUpperCase()];
  if (!iso) return '';
  return `https://flagcdn.com/w${width}/${iso}.png`;
}

// Pre-warm the browser cache for every nation's flag so the spin reel
// renders instantly on mobile.
export function preloadFlags(codes, width = 80) {
  for (const c of codes) {
    const url = flagUrl(c, width);
    if (!url) continue;
    const img = new Image();
    img.src = url;
  }
}
