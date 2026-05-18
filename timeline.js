const canvas = document.getElementById('timeline');
const ctx = canvas.getContext('2d');
const scaleLabel = document.getElementById('scale-label');
const centerTimeEl = document.getElementById('center-time');
const themeToggle = document.getElementById('theme-toggle');
const langToggle = document.getElementById('lang-toggle');

let dpr = window.devicePixelRatio || 1;
let W, H;

const THEMES = {
  dark: {
    bg: '#0a0a0f',
    axis: '#333',
    tick: '#444',
    tickLabel: '#555',
    grid: 'rgba(255,255,255,0.05)',
    barAlpha: 0.35,
    barBorderAlpha: 0.8,
    removeBtn: '#666',
    removeBtnHover: '#ff4444',
  },
  light: {
    bg: '#f5f5f0',
    axis: '#ccc',
    tick: '#aaa',
    tickLabel: '#888',
    grid: 'rgba(0,0,0,0.06)',
    barAlpha: 0.3,
    barBorderAlpha: 0.6,
    removeBtn: '#999',
    removeBtnHover: '#cc0000',
  },
};

function getTheme() { return document.body.dataset.theme || 'dark'; }
function th(prop) { return THEMES[getTheme()][prop]; }

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

// Restore theme/lang from localStorage
const savedTheme = localStorage.getItem('timeline_theme');
if (savedTheme) { document.body.dataset.theme = savedTheme; themeToggle.textContent = savedTheme === 'dark' ? '☀' : '☾'; }
const savedLang = localStorage.getItem('timeline_lang');
if (savedLang) { setLang(savedLang); langToggle.textContent = savedLang === 'en' ? 'BY' : 'EN'; }

themeToggle.addEventListener('click', () => {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  themeToggle.textContent = next === 'dark' ? '☀' : '☾';
  localStorage.setItem('timeline_theme', next);
  draw();
});

langToggle.addEventListener('click', () => {
  const next = getLang() === 'en' ? 'by' : 'en';
  setLang(next);
  langToggle.textContent = next === 'en' ? 'BY' : 'EN';
  localStorage.setItem('timeline_lang', next);
  searchInput.placeholder = t('search');
  draw();
});

// --- Time model ---
const BIG_BANG = 13.8e9;
const NOW = 0;
const CURRENT_YEAR = 2026;

let viewStart = 300;
let viewEnd = NOW;

// --- Layout ---
const BAR_HEIGHT = 28;
const BAR_GAP = 4;
const AXIS_BOTTOM_MARGIN = 50;
const PAD_LEFT = 20;
const PAD_RIGHT = 40;

// --- Items on timeline ---
let items = [];
let itemRects = [];

const COLORS = [
  '#a78bfa', '#ef4444', '#34d399', '#fbbf24', '#60a5fa',
  '#f472b6', '#fb923c', '#818cf8', '#2dd4bf', '#e879f9',
  '#94a3b8', '#dc2626', '#29b6f6', '#66bb6a', '#c084fc',
];
let colorIndex = 0;
function nextColor() { return COLORS[colorIndex++ % COLORS.length]; }

function assignRows(spans) {
  const sorted = spans.map((s, i) => ({ ...s, _i: i }));
  sorted.sort((a, b) => (b.start - b.end) - (a.start - a.end));
  const rows = [];
  const rowMap = new Array(spans.length);
  for (const span of sorted) {
    let placed = false;
    for (let r = 0; r < rows.length; r++) {
      const conflict = rows[r].some(s => {
        const aStart = Math.max(s.start, s.end), aEnd = Math.min(s.start, s.end);
        const bStart = Math.max(span.start, span.end), bEnd = Math.min(span.start, span.end);
        return !(bEnd >= aStart || bStart <= aEnd);
      });
      if (!conflict) { rows[r].push(span); rowMap[span._i] = r; placed = true; break; }
    }
    if (!placed) { rowMap[span._i] = rows.length; rows.push([span]); }
  }
  return { rowCount: rows.length, rowMap };
}

const searchTagsEl = document.getElementById('search-tags');

function addItem(item) {
  const existing = items.find(r => r.id === item.id);
  if (existing) return;
  items.push(item);
  renderTags();
  saveState();
  fitView();
  draw();
}

function removeItem(id) {
  items = items.filter(r => r.id !== id);
  renderTags();
  saveState();
  if (items.length > 0) fitView();
  draw();
}

function saveState() {
  const data = items.map(it => ({ id: it.id, start: it.start, end: it.end, color: it.color, wdId: it.wdId, wpLang: it.wpLang }));
  try { localStorage.setItem('timeline_items', JSON.stringify(data)); } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem('timeline_items');
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        items = data;
        colorIndex = items.length;
        renderTags();
        fitView();
        return true;
      }
    }
  } catch {}
  return false;
}

function renderTags() {
  searchTagsEl.innerHTML = '';
  for (const item of items) {
    const tag = document.createElement('span');
    tag.className = 'search-tag';
    tag.innerHTML = `<span class="tag-dot" style="background:${item.color}"></span>${item.id}<span class="tag-remove">×</span>`;
    tag.querySelector('.tag-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(item.id);
    });
    searchTagsEl.appendChild(tag);
  }
}

function fitView() {
  if (items.length === 0) return;
  let maxStart = 0, minEnd = Infinity;
  for (const it of items) {
    maxStart = Math.max(maxStart, it.start);
    minEnd = Math.min(minEnd, it.end);
  }
  const pad = Math.max((maxStart - minEnd) * 0.2, 20);
  viewStart = maxStart + pad;
  viewEnd = Math.max(minEnd - pad, 0);
}

// --- Coordinate conversion ---
function yearToX(yearsAgo) {
  const usable = W - PAD_LEFT - PAD_RIGHT;
  return PAD_LEFT + (1 - (yearsAgo - viewEnd) / (viewStart - viewEnd)) * usable;
}

function xToYear(x) {
  const usable = W - PAD_LEFT - PAD_RIGHT;
  return viewEnd + (1 - (x - PAD_LEFT) / usable) * (viewStart - viewEnd);
}

// --- Interaction ---
let isDragging = false;
let dragStartX = 0;
let dragViewStart = 0;
let dragViewEnd = 0;
let mouseX = -1, mouseY = -1;

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const yearAtMouse = xToYear(e.clientX);
    const leftDist = yearAtMouse - viewEnd;
    const rightDist = viewStart - yearAtMouse;
    let newEnd = yearAtMouse - leftDist * zoomFactor;
    let newStart = yearAtMouse + rightDist * zoomFactor;
    if (newStart > BIG_BANG) newStart = BIG_BANG;
    if (newEnd < NOW) newEnd = NOW;
    if (newStart - newEnd < 1e-7) return;
    viewStart = newStart;
    viewEnd = newEnd;
  } else {
    const span = viewStart - viewEnd;
    const yearsPerPx = span / (W - PAD_LEFT - PAD_RIGHT);
    const shift = -(e.deltaX + e.deltaY) * yearsPerPx * 2;
    let newStart = viewStart + shift;
    let newEnd = viewEnd + shift;
    if (newStart > BIG_BANG) { newStart = BIG_BANG; newEnd = BIG_BANG - span; }
    if (newEnd < NOW) { newEnd = NOW; newStart = span; }
    viewStart = newStart;
    viewEnd = newEnd;
  }
  draw();
}, { passive: false });

let dragStartY = 0;
canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragViewStart = viewStart;
  dragViewEnd = viewEnd;
  canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (!isDragging) {
    let onBar = false;
    for (const rect of itemRects) {
      if (mouseX >= rect.barX && mouseX <= rect.barX + rect.barW && mouseY >= rect.barY && mouseY <= rect.barY + rect.barH) {
        const item = items.find(it => it.id === rect.id);
        if (item?.wdId) { onBar = true; break; }
      }
    }
    canvas.style.cursor = onBar ? 'pointer' : 'default';
    draw();
    return;
  }
  const dx = e.clientX - dragStartX;
  const yearsPerPx = (dragViewStart - dragViewEnd) / W;
  const shift = dx * yearsPerPx;
  viewStart = dragViewStart + shift;
  viewEnd = dragViewEnd + shift;
  if (viewStart > BIG_BANG) { viewStart = BIG_BANG; viewEnd = dragViewEnd + (BIG_BANG - dragViewStart); }
  if (viewEnd < NOW) { viewEnd = NOW; viewStart = dragViewStart + (NOW - dragViewEnd); }
  draw();
});

window.addEventListener('mouseup', (e) => {
  const wasDrag = Math.abs(e.clientX - dragStartX) > 3 || Math.abs(e.clientY - dragStartY) > 3;
  isDragging = false;
  canvas.style.cursor = 'default';
  if (!wasDrag) {
    for (const rect of itemRects) {
      if (e.clientX >= rect.barX && e.clientX <= rect.barX + rect.barW && e.clientY >= rect.barY && e.clientY <= rect.barY + rect.barH) {
        const item = items.find(it => it.id === rect.id);
        if (item?.wdId) openWikipedia(item.wdId, item.wpLang);
        return;
      }
    }
  }
});

async function openWikipedia(wdId, preferLang) {
  const lang = preferLang || (getLang() === 'by' ? 'be' : 'en');
  const wiki = lang + 'wiki';
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdId}&props=sitelinks&sitefilter=${wiki},enwiki&format=json&origin=*`;
    const res = await fetch(url);
    const json = await res.json();
    const sitelinks = json.entities?.[wdId]?.sitelinks;
    const title = sitelinks?.[wiki]?.title || sitelinks?.enwiki?.title;
    if (title) {
      const wpLang = sitelinks?.[wiki] ? lang : 'en';
      window.open(`https://${wpLang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, '_blank');
    }
  } catch {}
}

// Touch
let lastTouchDist = 0;
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) { isDragging = true; dragStartX = e.touches[0].clientX; dragViewStart = viewStart; dragViewEnd = viewEnd; }
  else if (e.touches.length === 2) { isDragging = false; lastTouchDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX); }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1 && isDragging) {
    const dx = e.touches[0].clientX - dragStartX;
    const yearsPerPx = (dragViewStart - dragViewEnd) / W;
    viewStart = dragViewStart + dx * yearsPerPx;
    viewEnd = dragViewEnd + dx * yearsPerPx;
    if (viewStart > BIG_BANG) { viewStart = BIG_BANG; viewEnd = dragViewEnd + (BIG_BANG - dragViewStart); }
    if (viewEnd < NOW) { viewEnd = NOW; viewStart = dragViewStart + (NOW - dragViewEnd); }
    draw();
  } else if (e.touches.length === 2) {
    const dist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
    const center = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    if (lastTouchDist > 0) {
      const scale = lastTouchDist / dist;
      const yc = xToYear(center);
      viewEnd = yc - (yc - viewEnd) * scale;
      viewStart = yc + (viewStart - yc) * scale;
      if (viewStart > BIG_BANG) viewStart = BIG_BANG;
      if (viewEnd < NOW) viewEnd = NOW;
    }
    lastTouchDist = dist;
    draw();
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; lastTouchDist = 0; });

// --- Formatting ---
function formatYearsAgo(y) {
  if (y <= 0) return t('now');
  if (y < 1) { const d = y * 365.25; if (d < 1) return `${(d*24).toFixed(1)} ${t('h')}`; return `${d.toFixed(0)} ${t('d')}`; }
  if (y < 1e3) return `${y.toFixed(0)} ${t('yr')}`;
  if (y < 1e6) return `${(y/1e3).toFixed(1)} ${t('kyr')}`;
  if (y < 1e9) return `${(y/1e6).toFixed(1)} ${t('myr')}`;
  return `${(y/1e9).toFixed(2)} ${t('byr')}`;
}

function formatYearsAgoFull(y) {
  if (y <= 0) return t('now');
  if (y < 1e3) return `${y.toFixed(0)} ${t('yearsAgo')}`;
  if (y < 1e6) return `${(y/1e3).toFixed(1)} ${t('kyrAgo')}`;
  if (y < 1e9) return `${(y/1e6).toFixed(1)} ${t('myrAgo')}`;
  return `${(y/1e9).toFixed(2)} ${t('byrAgo')}`;
}

function formatDuration(y) {
  if (y < 1) { const d = y * 365.25; if (d < 1) return `${(d*24).toFixed(1)} ${t('h')}`; return `${d.toFixed(0)} ${t('d')}`; }
  if (y < 1e3) return `${y.toFixed(0)} ${t('yr')}`;
  if (y < 1e6) return `${(y/1e3).toFixed(1)} ${t('kyr')}`;
  if (y < 1e9) return `${(y/1e6).toFixed(1)} ${t('myr')}`;
  return `${(y/1e9).toFixed(2)} ${t('byr')}`;
}

function formatCalendarYear(yearsAgo) {
  const year = CURRENT_YEAR - yearsAgo;
  if (year > 0) return `${year}`;
  if (year === 0) return `1 ${t('bce')}`;
  return `${Math.abs(year)} ${t('bce')}`;
}

function formatCalendarYearCompact(yearsAgo) {
  const year = CURRENT_YEAR - yearsAgo;
  if (Math.abs(year) >= 1e6) return `${(year/1e6).toFixed(1)}M`;
  if (Math.abs(year) >= 1e3) return `${Math.round(Math.abs(year))}${year < 0 ? ` ${t('bce')}` : ''}`;
  if (year > 0) return `${Math.round(year)}`;
  if (year === 0) return `1 ${t('bce')}`;
  return `${Math.round(Math.abs(year))} ${t('bce')}`;
}

function niceStep(range) {
  const rough = range / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}

// --- Draw a bar ---
function drawBar(s, barY, barH, alpha, borderAlpha) {
  const x1 = yearToX(s.start);
  const x2 = yearToX(s.end);
  const barX = Math.max(0, Math.min(x1, x2));
  const barW = Math.min(W, Math.max(x1, x2)) - barX;

  if (barX > W || barX + barW < 0) return null;

  ctx.fillStyle = s.color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(barX, barY, barW, barH);

  ctx.globalAlpha = borderAlpha;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

  ctx.globalAlpha = 1;
  const duration = s.start - s.end;
  const label = s.id;
  const text = `${label} (${formatDuration(duration)})`;
  ctx.font = '12px SF Mono, Consolas, monospace';
  const textW = ctx.measureText(text).width;
  const textY = barY + barH / 2 + 4;

  if (barW > textW + 16) {
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    const textX = Math.max(barX + 8, Math.min(W / 2 - textW / 2, barX + barW - textW - 8));
    ctx.fillText(text, textX, textY);
  } else if (barW > 20) {
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    ctx.save();
    ctx.beginPath(); ctx.rect(barX, barY, barW, barH); ctx.clip();
    ctx.fillText(text, barX + 4, textY);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  return { x: barX, w: barW };
}

// --- Rendering ---
function draw() {
  ctx.clearRect(0, 0, W, H);

  const span = viewStart - viewEnd;

  ctx.fillStyle = th('bg');
  ctx.fillRect(0, 0, W, H);

  // Axis at bottom
  const axisY = H - AXIS_BOTTOM_MARGIN;

  ctx.strokeStyle = th('axis'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(W, axisY); ctx.stroke();

  // Ticks
  const step = niceStep(span);
  const firstTick = Math.floor(viewEnd / step) * step;
  ctx.font = '10px SF Mono, Consolas, monospace';
  ctx.textAlign = 'center';
  for (let ti = firstTick; ti <= viewStart + step; ti += step) {
    const x = yearToX(ti);
    if (x < -50 || x > W + 50) continue;
    ctx.strokeStyle = th('grid');
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, axisY); ctx.stroke();
    ctx.strokeStyle = th('tick');
    ctx.beginPath(); ctx.moveTo(x, axisY - 5); ctx.lineTo(x, axisY + 5); ctx.stroke();
    ctx.fillStyle = th('tickLabel');
    ctx.fillText(formatYearsAgo(ti), x, axisY + 18);
  }

  // Calendar axis
  if (viewStart <= 600e3) {
    const calAxisY = axisY + 30;
    ctx.font = '10px SF Mono, Consolas, monospace'; ctx.textAlign = 'center';
    const calStep = niceStep(span);
    const calFirst = Math.floor(viewEnd / calStep) * calStep;
    for (let ti = calFirst; ti <= viewStart + calStep; ti += calStep) {
      const x = yearToX(ti);
      if (x < -50 || x > W + 50) continue;
      ctx.fillStyle = '#e8a735'; ctx.globalAlpha = 0.7;
      ctx.fillText(formatCalendarYearCompact(ti), x, calAxisY + 4);
    }
    ctx.globalAlpha = 1;
  }

  // Bars — layout from bottom up
  itemRects = [];
  if (items.length > 0) {
    const { rowCount, rowMap } = assignRows(items);
    const totalBarsHeight = rowCount * (BAR_HEIGHT + BAR_GAP) - BAR_GAP;
    const barsBottom = axisY - 12;
    const barsTop = barsBottom - totalBarsHeight;

    ctx.font = '12px SF Mono, Consolas, monospace';
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const row = rowMap[i];
      const barY = barsTop + row * (BAR_HEIGHT + BAR_GAP);
      const rect = drawBar(s, barY, BAR_HEIGHT, th('barAlpha'), th('barBorderAlpha'));
      if (rect) {
        itemRects.push({ id: s.id, barY, barH: BAR_HEIGHT, barX: rect.x, barW: rect.w });
      }
    }
  }

  // Tooltip
  updateTooltip();

  // HUD — position below search box
  const searchBox = document.getElementById('search-box');
  const hudTop = searchBox.offsetTop + searchBox.offsetHeight + 8;
  document.getElementById('hud').style.top = hudTop + 'px';
  scaleLabel.textContent = `${t('range')}: ${formatDuration(span)}`;
  centerTimeEl.textContent = `${t('from')} ${formatYearsAgoFull(viewStart)} ${t('to')} ${formatYearsAgoFull(viewEnd)}`;

  const jumpEl = document.getElementById('jump-now');
  jumpEl.style.top = (hudTop + document.getElementById('hud').offsetHeight + 4) + 'px';
  if (viewEnd > 0) {
    jumpEl.style.display = 'block';
    jumpEl.innerHTML = `<a id="jump-now-link">→ ${t('now')}</a>`;
    document.getElementById('jump-now-link').onclick = () => {
      const s = viewStart - viewEnd;
      viewEnd = 0;
      viewStart = s;
      if (viewStart > BIG_BANG) viewStart = BIG_BANG;
      draw();
    };
  } else {
    jumpEl.style.display = 'none';
  }
}

// --- Wikidata search ---
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
let searchTimeout = null;

searchInput.placeholder = t('search');

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResultsEl.classList.remove('visible'); return; }
  searchTimeout = setTimeout(() => wikidataSearch(q), 400);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchResultsEl.classList.remove('visible'); searchInput.blur(); }
});

searchInput.addEventListener('focus', () => {
  if (searchResultsEl.children.length > 0) searchResultsEl.classList.add('visible');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) searchResultsEl.classList.remove('visible');
});

function detectInputLang(text) {
  if (/[Ѐ-ӿ]/.test(text)) {
    if (/[ІіҐґЄєЇї]/.test(text)) return 'uk';
    if (/[ЎўІі]/.test(text)) return 'be';
    return 'ru';
  }
  if (/[À-ÿ]/.test(text)) return 'fr';
  if (/[ÄÖÜäöüß]/.test(text)) return 'de';
  return 'en';
}

async function wikidataSearch(query) {
  searchResultsEl.innerHTML = `<div class="search-loading">${t('searching')}</div>`;
  searchResultsEl.classList.add('visible');

  try {
    const inputLang = detectInputLang(query);
    const searchLangs = [inputLang];
    for (const l of ['en', 'ru', 'be', 'uk', 'de', 'fr']) {
      if (!searchLangs.includes(l)) searchLangs.push(l);
    }
    const seen = new Set();
    const allEntities = [];

    const fetches = searchLangs.map(lang =>
      fetch('https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' + encodeURIComponent(query) + '&language=' + lang + '&uselang=' + inputLang + '&limit=5&format=json&origin=*')
        .then(r => r.json())
        .then(d => (d.search || []).map(e => ({ ...e, _lang: lang })))
        .catch(() => [])
    );
    const results = await Promise.all(fetches);
    for (const batch of results) {
      for (const entity of batch) {
        if (!seen.has(entity.id)) { seen.add(entity.id); allEntities.push(entity); }
      }
    }

    if (allEntities.length === 0) {
      searchResultsEl.innerHTML = `<div class="search-loading">${t('noResults')}</div>`;
      return;
    }

    // Fetch labels/descriptions in input language
    const ids = allEntities.slice(0, 15).map(e => e.id).join('|');
    const labelUrl = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + ids + '&props=labels|descriptions&languages=' + inputLang + '|en&format=json&origin=*';
    let labelData = {};
    try {
      const lr = await fetch(labelUrl);
      const lj = await lr.json();
      labelData = lj.entities || {};
    } catch {}

    const matched = [];
    for (const entity of allEntities) {
      const dates = await getEntityDates(entity.id);
      if (dates) {
        const ld = labelData[entity.id];
        const label = ld?.labels?.[inputLang]?.value || ld?.labels?.en?.value || entity.label;
        const desc = ld?.descriptions?.[inputLang]?.value || ld?.descriptions?.en?.value || entity.description || '';
        matched.push({ wdId: entity.id, label, description: desc, wpLang: inputLang, ...dates });
        if (matched.length >= 3) break;
      }
    }

    if (matched.length === 0) {
      searchResultsEl.innerHTML = `<div class="search-loading">${t('noResults')}</div>`;
      return;
    }

    searchResultsEl.innerHTML = '';
    for (const r of matched) {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      const startLabel = formatDateForDisplay(r.startYear, r.startEra);
      const endLabel = r.endYear != null ? formatDateForDisplay(r.endYear, r.endEra) : t('now');
      div.innerHTML = `<div class="sr-label">${r.label}</div><div class="sr-desc">${r.description}</div><div class="sr-desc">${startLabel} — ${endLabel}</div>`;
      div.addEventListener('click', () => {
        const startYearsAgo = dateToYearsAgo(r.startYear, r.startEra);
        const endYearsAgo = r.endYear != null ? dateToYearsAgo(r.endYear, r.endEra) : 0;
        addItem({ id: r.label, start: startYearsAgo, end: endYearsAgo, color: nextColor(), wdId: r.wdId, wpLang: r.wpLang });
        searchResultsEl.classList.remove('visible');
        searchInput.value = '';
        searchInput.focus();
      });
      searchResultsEl.appendChild(div);
    }
  } catch (err) {
    searchResultsEl.innerHTML = `<div class="search-loading">Error: ${err.message}</div>`;
  }
}

async function getEntityDates(entityId) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entityId}&format=json&origin=*`;
  const res = await fetch(url);
  const json = await res.json();
  const claims = json.claims || {};

  let startDate = extractDate(claims.P580) || extractDate(claims.P569) || extractDate(claims.P571) || extractDate(claims.P575) || extractDate(claims.P585) || extractDate(claims.P1319);
  let endDate = extractDate(claims.P582) || extractDate(claims.P570) || extractDate(claims.P576) || extractDate(claims.P1326);

  if (startDate) {
    const result = { startYear: startDate.year, startEra: startDate.era };
    if (endDate) { result.endYear = endDate.year; result.endEra = endDate.era; }
    return result;
  }

  return await getEntityDatesFromWikipedia(entityId);
}

async function getEntityDatesFromWikipedia(entityId) {
  try {
    const siteUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`;
    const siteRes = await fetch(siteUrl);
    const siteJson = await siteRes.json();
    const title = siteJson.entities?.[entityId]?.sitelinks?.enwiki?.title;
    if (!title) return null;

    const wpUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=2000&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const wpRes = await fetch(wpUrl);
    const wpJson = await wpRes.json();
    const pages = wpJson.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    const extract = page?.extract;
    if (!extract) return null;

    return parseDatesFromText(extract);
  } catch { return null; }
}

function parseDatesFromText(text) {
  const first300 = text.slice(0, 2000);

  // Try "from YYYY to YYYY" or "YYYY–YYYY" or "(YYYY-YYYY)" patterns
  const rangeMatch = first300.match(/(\d{3,4})\s*[–\-—]\s*(\d{3,4})/);
  if (rangeMatch) {
    const y1 = parseInt(rangeMatch[1]);
    const y2 = parseInt(rangeMatch[2]);
    if (y1 > 0 && y1 < 2100 && y2 > 0 && y2 < 2100) {
      return { startYear: Math.min(y1, y2), startEra: 'ce', endYear: Math.max(y1, y2), endEra: 'ce' };
    }
  }

  // Try BCE patterns: "Xth century BC", "YYYY BC"
  const bceMatch = first300.match(/(\d{1,4})\s*(?:BC|BCE)/i);
  const ceMatch = first300.match(/(?:in|around|circa|c\.|from)\s+(\d{3,4})/i);

  if (bceMatch) {
    const y = parseInt(bceMatch[1]);
    return { startYear: y, startEra: 'bce' };
  }

  // Find all 4-digit years in first 300 chars
  const years = [];
  const yearRe = /\b(1[0-9]{3}|20[0-2][0-9])\b/g;
  let m;
  while ((m = yearRe.exec(first300)) !== null) {
    years.push(parseInt(m[1]));
  }

  if (years.length >= 2) {
    return { startYear: Math.min(...years), startEra: 'ce', endYear: Math.max(...years), endEra: 'ce' };
  }
  if (years.length === 1) {
    return { startYear: years[0], startEra: 'ce' };
  }

  return null;
}

function extractDate(claimArray) {
  if (!claimArray || claimArray.length === 0) return null;
  const val = claimArray[0].mainsnak?.datavalue?.value;
  if (!val || !val.time) return null;
  const time = val.time;
  const negative = time.startsWith('-');
  const match = time.match(/([+-]?\d+)-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Math.abs(parseInt(match[1]));
  return { year, era: negative ? 'bce' : 'ce' };
}

function dateToYearsAgo(year, era) {
  if (era === 'bce') return CURRENT_YEAR + year;
  return Math.max(CURRENT_YEAR - year, 0);
}

function formatDateForDisplay(year, era) {
  if (era === 'bce') return `${year} ${t('bce')}`;
  return `${year} ${t('ce')}`;
}

// --- Tooltip on hover ---
const tooltip = document.getElementById('tooltip');

function updateTooltip() {
  if (isDragging) { tooltip.style.display = 'none'; return; }

  let found = null;
  for (const rect of itemRects) {
    if (mouseX >= rect.barX && mouseX <= rect.barX + rect.barW && mouseY >= rect.barY && mouseY <= rect.barY + rect.barH) {
      found = items.find(it => it.id === rect.id);
      break;
    }
  }

  if (!found) { tooltip.style.display = 'none'; return; }

  const calStart = formatCalendarYear(found.start);
  const calEnd = found.end > 0 ? formatCalendarYear(found.end) : formatCalendarYear(0);
  const duration = found.start - found.end;

  tooltip.innerHTML = `<div class="tt-title">${found.id}</div><div class="tt-dates">${calStart} — ${calEnd}<br>${formatDuration(duration)}</div>`;
  tooltip.style.display = 'block';

  let tx = mouseX + 16;
  let ty = mouseY - 10;
  if (tx + tooltip.offsetWidth > W - 10) tx = mouseX - tooltip.offsetWidth - 10;
  if (ty + tooltip.offsetHeight > H - 10) ty = mouseY - tooltip.offsetHeight - 10;
  tooltip.style.left = tx + 'px';
  tooltip.style.top = ty + 'px';
}

if (!loadState()) {
  addItem({ id: 'Albert Einstein', start: CURRENT_YEAR - 1879, end: CURRENT_YEAR - 1955, color: nextColor(), wdId: 'Q937' });
  addItem({ id: 'World War I', start: CURRENT_YEAR - 1914, end: CURRENT_YEAR - 1918, color: nextColor(), wdId: 'Q361' });
  addItem({ id: 'World War II', start: CURRENT_YEAR - 1939, end: CURRENT_YEAR - 1945, color: nextColor(), wdId: 'Q362' });
}

resize();
