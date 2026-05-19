const canvas = document.getElementById('timeline');
const ctx = canvas.getContext('2d');
const scaleLabel = document.getElementById('scale-label');
const centerTimeEl = document.getElementById('center-time');

let dpr = window.devicePixelRatio || 1;
let W, H;
let drawScheduled = false;

const TH = {
  bg: '#0a0a0f',
  axis: '#333',
  tick: '#444',
  tickLabel: '#555',
  grid: 'rgba(255,255,255,0.05)',
  barAlpha: 0.35,
  barBorderAlpha: 0.8,
};

function th(prop) { return TH[prop]; }

function requestDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => {
    drawScheduled = false;
    draw();
  });
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestDraw();
}
window.addEventListener('resize', resize);

// --- Time model ---
const BIG_BANG = 13.8e9;
const NOW = 0;
const CURRENT_YEAR = new Date().getUTCFullYear();

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
let highlightedItemId = null;
let highlightFade = 0;

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

const LUCIDE_ICONS = {
  arrowRight: [
    { tag: 'path', d: 'M5 12h14' },
    { tag: 'path', d: 'm12 5 7 7-7 7' },
  ],
  alignHSpaceAround: [
    { tag: 'rect', width: 6, height: 10, x: 9, y: 7, rx: 2 },
    { tag: 'path', d: 'M4 22V2' },
    { tag: 'path', d: 'M20 22V2' },
  ],
  x: [
    { tag: 'path', d: 'M18 6 6 18' },
    { tag: 'path', d: 'm6 6 12 12' },
  ],
};

function createLucideIcon(name, size = 14) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('lucide');
  for (const node of LUCIDE_ICONS[name]) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', node.tag);
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'tag') el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  return svg;
}

const searchTagsEl = document.getElementById('search-tags');
const jumpEl = document.getElementById('jump-now');
const jumpNowLink = document.createElement('a');
const fitAllLink = document.createElement('a');

jumpNowLink.id = 'jump-now-link';
jumpNowLink.append(createLucideIcon('arrowRight', 13), document.createTextNode(' Now'));
jumpNowLink.addEventListener('click', () => {
  const s = viewStart - viewEnd;
  const targetStart = Math.min(s, BIG_BANG);
  animateView(targetStart, 0);
});

fitAllLink.id = 'fit-all-link';
fitAllLink.append(createLucideIcon('alignHSpaceAround', 13), document.createTextNode(' Fit All'));
fitAllLink.addEventListener('click', () => {
  const target = computeFitView();
  if (target) animateView(target.start, target.end);
});

jumpEl.append(jumpNowLink, fitAllLink);

function clearElement(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function appendTextElement(parent, tagName, className, text) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function colorToRgba(color, alpha) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) return color;
  const [, r, g, b] = match;
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
}

function showSearchMessage(message) {
  clearElement(searchResultsEl);
  appendTextElement(searchResultsEl, 'div', 'search-loading', message);
  setSearchResultsVisible(true);
}

let searchResultsHideTimer = null;
function setSearchResultsVisible(visible) {
  const wasVisible = searchResultsEl.classList.contains('has-results');
  if (visible === wasVisible) return;
  clearTimeout(searchResultsHideTimer);
  if (visible) {
    searchResultsEl.style.display = 'block';
    void searchResultsEl.offsetHeight;
    searchResultsEl.classList.add('has-results');
  } else {
    searchResultsEl.classList.remove('has-results');
    searchResultsHideTimer = setTimeout(() => {
      searchResultsEl.style.display = '';
      searchResultsHideTimer = null;
    }, 180);
  }
  requestDraw();
}

function setLinkVisible(el, visible) {
  const isVisible = el.classList.contains('visible');
  if (visible === isVisible) return;
  clearTimeout(el._hideTimer);
  if (visible) {
    el.style.display = 'inline-flex';
    void el.offsetHeight;
    el.classList.add('visible');
  } else {
    el.classList.remove('visible');
    el._hideTimer = setTimeout(() => {
      el.style.display = '';
      el._hideTimer = null;
    }, 180);
  }
}

function addItem(item, opts = {}) {
  const existing = items.find(r => r.id === item.id);
  if (existing) return;
  items.push(item);
  renderTags();
  saveState();
  fitView({ animated: opts.animateFit });
  requestDraw();
}

function removeItem(id) {
  items = items.filter(r => r.id !== id);
  renderTags();
  saveState();
  if (items.length > 0) fitView({ animated: true });
  requestDraw();
}

function saveState() {
  const data = items.map(it => ({ id: it.id, start: it.start, end: it.end, color: it.color, wdId: it.wdId, wpLang: it.wpLang, startProp: it.startProp, endProp: it.endProp }));
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
  clearElement(searchTagsEl);
  for (const item of items) {
    const tag = document.createElement('span');
    tag.className = 'search-tag';
    tag.style.backgroundColor = colorToRgba(item.color, 0.15);
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.backgroundColor = item.color;
    const remove = document.createElement('span');
    remove.className = 'tag-remove';
    remove.appendChild(createLucideIcon('x', 12));
    tag.append(dot, document.createTextNode(item.id), remove);
    tag.addEventListener('click', () => {
      focusItem(item.id);
    });
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(item.id);
    });
    searchTagsEl.appendChild(tag);
  }
}

function clampView(start, end) {
  const span = start - end;
  if (span >= BIG_BANG) return { start: BIG_BANG, end: NOW };
  if (start > BIG_BANG) {
    start = BIG_BANG;
    end = BIG_BANG - span;
  }
  if (end < NOW) {
    end = NOW;
    start = span;
  }
  return { start, end };
}

function highlightItem(id) {
  highlightedItemId = id;
  highlightFade = 1;
  let last = performance.now();
  function tick(now) {
    if (highlightedItemId !== id) return;
    const dt = now - last;
    last = now;
    highlightFade = Math.max(0, highlightFade - dt / 600);
    if (highlightFade <= 0) {
      highlightFade = 0;
      highlightedItemId = null;
    }
    drawScheduled = false;
    draw();
    if (highlightedItemId === id) {
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
}

function focusItem(id) {
  const item = items.find(it => it.id === id);
  if (!item) return;
  const span = viewStart - viewEnd;
  const center = (item.start + item.end) / 2;
  const nextView = clampView(center + span / 2, center - span / 2);
  viewStart = nextView.start;
  viewEnd = nextView.end;
  highlightItem(id);
  requestDraw();
}

function computeFitView() {
  if (items.length === 0) return null;
  let maxStart = 0, minEnd = Infinity;
  for (const it of items) {
    maxStart = Math.max(maxStart, it.start);
    minEnd = Math.min(it.end, minEnd);
  }
  const pad = Math.max((maxStart - minEnd) * 0.2, 20);
  return { start: maxStart + pad, end: Math.max(minEnd - pad, 0) };
}

function fitView(opts = {}) {
  const target = computeFitView();
  if (!target) return;
  if (opts.animated) {
    animateView(target.start, target.end);
  } else {
    viewStart = target.start;
    viewEnd = target.end;
  }
}

let viewAnimId = 0;
function animateView(targetStart, targetEnd, duration = 600) {
  const id = ++viewAnimId;
  const fromStart = viewStart;
  const fromEnd = viewEnd;
  if (fromStart === targetStart && fromEnd === targetEnd) return;
  const t0 = performance.now();
  const ease = t => t < 0.5 ? 16*t*t*t*t*t : 1 - Math.pow(-2*t+2, 5)/2;
  function step(now) {
    if (id !== viewAnimId) return;
    const t = Math.min(1, (now - t0) / duration);
    const e = ease(t);
    viewStart = fromStart + (targetStart - fromStart) * e;
    viewEnd = fromEnd + (targetEnd - fromEnd) * e;
    requestDraw();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function cancelViewAnimation() { viewAnimId++; }

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
  cancelViewAnimation();
  if (e.ctrlKey || e.shiftKey) {
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const magnitude = Math.min(Math.abs(delta), 400);
    const zoomFactor = Math.exp(Math.sign(delta) * Math.sqrt(magnitude) * 0.015);
    const yearAtMouse = xToYear(e.clientX);
    const leftDist = yearAtMouse - viewEnd;
    const rightDist = viewStart - yearAtMouse;
    let newEnd = yearAtMouse - leftDist * zoomFactor;
    let newStart = yearAtMouse + rightDist * zoomFactor;
    if (newStart - newEnd < 1e-7) return;
    const nextView = clampView(newStart, newEnd);
    viewStart = nextView.start;
    viewEnd = nextView.end;
  } else {
    const span = viewStart - viewEnd;
    const yearsPerPx = span / (W - PAD_LEFT - PAD_RIGHT);
    const shift = -(e.deltaX + e.deltaY) * yearsPerPx * 2;
    const nextView = clampView(viewStart + shift, viewEnd + shift);
    viewStart = nextView.start;
    viewEnd = nextView.end;
  }
  requestDraw();
}, { passive: false });

let dragStartY = 0;
canvas.addEventListener('mousedown', (e) => {
  cancelViewAnimation();
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
    requestDraw();
    return;
  }
  const dx = e.clientX - dragStartX;
  const yearsPerPx = (dragViewStart - dragViewEnd) / W;
  const shift = dx * yearsPerPx;
  viewStart = dragViewStart + shift;
  viewEnd = dragViewEnd + shift;
  if (viewStart > BIG_BANG) { viewStart = BIG_BANG; viewEnd = dragViewEnd + (BIG_BANG - dragViewStart); }
  if (viewEnd < NOW) { viewEnd = NOW; viewStart = dragViewStart + (NOW - dragViewEnd); }
  requestDraw();
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
  const lang = preferLang || 'en';
  const wiki = lang + 'wiki';
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdId}&props=sitelinks&sitefilter=${wiki},enwiki&format=json&origin=*`;
    const res = await fetch(url);
    const json = await res.json();
    const sitelinks = json.entities?.[wdId]?.sitelinks;
    const title = sitelinks?.[wiki]?.title || sitelinks?.enwiki?.title;
    if (title) {
      const wpLang = sitelinks?.[wiki] ? lang : 'en';
      window.open(`https://${wpLang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, '_blank', 'noopener,noreferrer');
    }
  } catch {}
}

// Touch
let lastTouchDist = 0;
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  cancelViewAnimation();
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
    requestDraw();
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
    requestDraw();
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; lastTouchDist = 0; });

// --- Formatting ---
function formatYearsAgo(y) {
  if (y <= 0) return 'now';
  if (y < 1) { const d = y * 365.25; if (d < 1) return `${(d*24).toFixed(1)} h`; return `${d.toFixed(0)} d`; }
  if (y < 1e3) return `${y.toFixed(0)} yr`;
  if (y < 1e6) return `${(y/1e3).toFixed(1)} kyr`;
  if (y < 1e9) return `${(y/1e6).toFixed(1)} Myr`;
  return `${(y/1e9).toFixed(2)} Byr`;
}

function formatYearsAgoFull(y) {
  if (y <= 0) return 'now';
  if (y < 1e3) return `${y.toFixed(0)} years ago`;
  if (y < 1e6) return `${(y/1e3).toFixed(1)} kyr ago`;
  if (y < 1e9) return `${(y/1e6).toFixed(1)} Myr ago`;
  return `${(y/1e9).toFixed(2)} Byr ago`;
}

function formatDuration(y) {
  if (y < 1) { const d = y * 365.25; if (d < 1) return `${(d*24).toFixed(1)} h`; return `${d.toFixed(0)} d`; }
  if (y < 1e3) return `${y.toFixed(0)} yr`;
  if (y < 1e6) return `${(y/1e3).toFixed(1)} kyr`;
  if (y < 1e9) return `${(y/1e6).toFixed(1)} Myr`;
  return `${(y/1e9).toFixed(2)} Byr`;
}

function formatCalendarYear(yearsAgo) {
  const year = CURRENT_YEAR - yearsAgo;
  if (year > 0) return `${year}`;
  if (year === 0) return '1 BCE';
  return `${Math.abs(year)} BCE`;
}

function formatCalendarYearCompact(yearsAgo) {
  const year = CURRENT_YEAR - yearsAgo;
  if (Math.abs(year) >= 1e6) return `${(year/1e6).toFixed(1)}M`;
  if (Math.abs(year) >= 1e3) return `${Math.round(Math.abs(year))}${year < 0 ? ' BCE' : ''}`;
  if (year > 0) return `${Math.round(year)}`;
  if (year === 0) return '1 BCE';
  return `${Math.round(Math.abs(year))} BCE`;
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

// --- Draw a bar or marker line ---
function drawBar(s, barY, barH, alpha, borderAlpha) {
  const x1 = yearToX(s.start);
  const x2 = yearToX(s.end);
  const isPoint = Math.abs(x1 - x2) < 2;
  const isHighlighted = s.id === highlightedItemId;
  const hlProgress = isHighlighted ? highlightFade : 0;
  const fillAlpha = alpha;
  const strokeAlpha = borderAlpha;

  if (isPoint) {
    const x = x1;
    if (x < -50 || x > W + 50) return null;

    if (hlProgress > 0) {
      const glowR = 4 + 16 * hlProgress;
      ctx.globalAlpha = 0.3 * hlProgress;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(x, barY + barH / 2, glowR, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = s.color;
    ctx.globalAlpha = strokeAlpha;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, barY); ctx.lineTo(x, barY + barH); ctx.stroke();

    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = s.color;
    const r = 4;
    ctx.beginPath(); ctx.arc(x, barY + barH / 2, r, 0, Math.PI * 2); ctx.fill();

    ctx.globalAlpha = 1;
    ctx.font = '12px SF Mono, Consolas, monospace';
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    const label = s.id;
    ctx.fillText(label, x + 8, barY + barH / 2 + 4);

    return { x: x - r, w: r * 2 };
  }

  const barX = Math.max(0, Math.min(x1, x2));
  const barW = Math.min(W, Math.max(x1, x2)) - barX;

  if (barX > W || barX + barW < 0) return null;

  if (hlProgress > 0) {
    const glowPad = 12 * hlProgress;
    ctx.globalAlpha = 0.15 * hlProgress;
    ctx.fillStyle = s.color;
    ctx.fillRect(barX - glowPad, barY - glowPad, barW + glowPad * 2, barH + glowPad * 2);
  }

  ctx.fillStyle = s.color;
  ctx.globalAlpha = fillAlpha;
  ctx.fillRect(barX, barY, barW, barH);

  ctx.globalAlpha = strokeAlpha;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 1;
  const inset = 0.5;
  ctx.beginPath();
  ctx.moveTo(barX + inset, barY);
  ctx.lineTo(barX + inset, barY + barH);
  ctx.moveTo(barX + barW - inset, barY);
  ctx.lineTo(barX + barW - inset, barY + barH);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  const duration = s.start - s.end;
  const label = s.id;
  const text = `${label} (${formatDuration(duration)})`;
  ctx.font = '12px SF Mono, Consolas, monospace';
  const textW = ctx.measureText(text).width;
  const textY = barY + barH / 2 + 4;
  const visibleBarX = Math.max(barX, 0);
  const visibleBarRight = Math.min(barX + barW, W);
  const visibleBarW = visibleBarRight - visibleBarX;

  if (visibleBarW > textW + 16) {
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    const textX = Math.min(visibleBarX + 8, visibleBarRight - textW - 8);
    ctx.fillText(text, textX, textY);
  } else if (visibleBarW > 20) {
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    ctx.save();
    ctx.beginPath(); ctx.rect(visibleBarX, barY, visibleBarW, barH); ctx.clip();
    ctx.fillText(text, visibleBarX + 4, textY);
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

  // HUD — position below search box (and below results dropdown if open)
  const searchBox = document.getElementById('search-box');
  const sbBottom = searchBox.offsetTop + searchBox.offsetHeight;
  searchResultsEl.style.top = (sbBottom + 6) + 'px';
  const dropdownH = searchResultsEl.classList.contains('has-results') ? searchResultsEl.offsetHeight + 6 : 0;
  const hudTop = sbBottom + dropdownH + 8;
  document.getElementById('hud').style.top = hudTop + 'px';
  scaleLabel.textContent = `Visible range: ${formatDuration(span)}`;
  centerTimeEl.textContent = `From ${formatYearsAgoFull(viewStart)} to ${formatYearsAgoFull(viewEnd)}`;

  const showJumpNow = viewEnd > 0;
  const showFitAll = items.length > 0;
  setLinkVisible(jumpNowLink, showJumpNow);
  setLinkVisible(fitAllLink, showFitAll);
}

// --- Wikidata search ---
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');
let searchTimeout = null;
let activeSearchId = 0;
let activeSearchController = null;
const entityDatesCache = new Map();

function cancelSearch() {
  activeSearchId++;
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }
}
const SEARCH_CANDIDATE_LIMIT = 10;
const SEARCH_RESULT_LIMIT = 5;

searchInput.placeholder = 'Add...';

let selectedResultIndex = 0;
function updateSelectedResult() {
  const els = searchResultsEl.querySelectorAll('.search-result-item');
  els.forEach((el, i) => el.classList.toggle('selected', i === selectedResultIndex));
  const sel = els[selectedResultIndex];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    cancelSearch();
    clearElement(searchResultsEl);
    setSearchResultsVisible(false);
    return;
  }
  searchTimeout = setTimeout(() => wikidataSearch(q), 400);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cancelSearch();
    clearElement(searchResultsEl);
    setSearchResultsVisible(false);
    searchInput.blur();
    return;
  }
  const els = searchResultsEl.querySelectorAll('.search-result-item');
  if (els.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedResultIndex = (selectedResultIndex + 1) % els.length;
    updateSelectedResult();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedResultIndex = (selectedResultIndex - 1 + els.length) % els.length;
    updateSelectedResult();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (els[selectedResultIndex]) els[selectedResultIndex].click();
  }
});

searchInput.addEventListener('focus', () => {
  if (searchResultsEl.children.length > 0) {
    setSearchResultsVisible(true);
  } else {
    const q = searchInput.value.trim();
    if (q.length >= 2) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => wikidataSearch(q), 200);
    }
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box')) {
    cancelSearch();
    clearElement(searchResultsEl);
    setSearchResultsVisible(false);
  }
});

function detectInputLang(text) {
  if (/[\u0400-\u04ff]/.test(text)) {
    if (/[\u0406\u0456\u0490\u0491\u0404\u0454\u0407\u0457]/.test(text)) return 'uk';
    if (/[\u040e\u045e\u0406\u0456]/.test(text)) return 'be';
    return 'ru';
  }
  if (/[\u00c0-\u00ff]/.test(text)) return 'fr';
  if (/[\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/.test(text)) return 'de';
  return 'en';
}

async function wikidataSearch(query) {
  if (activeSearchController) activeSearchController.abort();
  const controller = new AbortController();
  activeSearchController = controller;
  const signal = controller.signal;
  const searchId = ++activeSearchId;
  const isCurrentSearch = () => searchId === activeSearchId && searchInput.value.trim() === query;
  showSearchMessage('Searching...');

  try {
    const inputLang = detectInputLang(query);
    const searchLangs = inputLang === 'ru' ? ['ru', 'en'] : ['en', 'ru'];
    const seen = new Set();
    const allEntities = [];

    const fetches = searchLangs.map(lang =>
      fetch('https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' + encodeURIComponent(query) + '&language=' + lang + '&uselang=' + inputLang + '&limit=5&format=json&origin=*', { signal })
        .then(r => r.json())
        .then(d => (d.search || []).map(e => ({ ...e, _lang: lang })))
        .catch(() => [])
    );
    const results = await Promise.all(fetches);
    if (!isCurrentSearch()) return;

    for (const batch of results) {
      for (const entity of batch) {
        if (!seen.has(entity.id)) { seen.add(entity.id); allEntities.push(entity); }
      }
    }

    if (allEntities.length === 0) {
      showSearchMessage('No results with dates found');
      return;
    }

    // Fetch labels/descriptions/sitelinks in input language. Sitelinks count is used as a popularity signal for ranking.
    const ids = allEntities.slice(0, 15).map(e => e.id).join('|');
    const labelUrl = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + ids + '&props=labels|descriptions|sitelinks&languages=' + inputLang + '|en&format=json&origin=*';
    let labelData = {};
    try {
      const lr = await fetch(labelUrl, { signal });
      const lj = await lr.json();
      labelData = lj.entities || {};
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
    if (!isCurrentSearch()) return;

    const queryLower = query.toLowerCase();
    const popularity = (id) => Object.keys(labelData[id]?.sitelinks || {}).length;
    allEntities.sort((a, b) => {
      const aExact = (a.label || '').toLowerCase() === queryLower ? 0 : 1;
      const bExact = (b.label || '').toLowerCase() === queryLower ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return popularity(b.id) - popularity(a.id);
    });

    const candidateDateResults = await Promise.all(
      allEntities.slice(0, SEARCH_CANDIDATE_LIMIT).map(async entity => ({
        entity,
        allDates: await getAllEntityDatesCached(entity.id, signal),
      }))
    );
    if (!isCurrentSearch()) return;

    const matched = [];
    for (const { entity, allDates } of candidateDateResults) {
      const ld = labelData[entity.id];
      const label = ld?.labels?.[inputLang]?.value || ld?.labels?.en?.value || entity.label;
      const desc = ld?.descriptions?.[inputLang]?.value || ld?.descriptions?.en?.value || entity.description || '';
      if (!allDates || allDates.length === 0) continue;
      const hasMultiple = allDates.length > 1;
      for (const dates of allDates.slice(0, 3)) {
        const dateLabel = getDateLabelFromProps(dates.startProp, dates.endProp, inputLang);
        matched.push({ wdId: entity.id, label, description: desc, wpLang: inputLang, isPointEvent: dates.isPointEvent || false, dateLabel, hasMultiple, ...dates });
      }
      if (matched.length >= SEARCH_RESULT_LIMIT) break;
    }
    for (const { entity, allDates } of candidateDateResults) {
      if (allDates && allDates.length > 0) continue;
      const ld = labelData[entity.id];
      const label = ld?.labels?.[inputLang]?.value || ld?.labels?.en?.value || entity.label;
      const desc = ld?.descriptions?.[inputLang]?.value || ld?.descriptions?.en?.value || entity.description || '';
      matched.push({ wdId: entity.id, label, description: desc, noDates: true });
    }
    if (!isCurrentSearch()) return;

    if (matched.length === 0) {
      showSearchMessage('No results found');
      return;
    }

    clearElement(searchResultsEl);
    for (const r of matched) {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      if (r.noDates) div.classList.add('sr-disabled');
      appendTextElement(div, 'div', 'sr-label', r.label);
      if (r.description) appendTextElement(div, 'div', 'sr-desc', r.description);
      if (r.noDates) {
        appendTextElement(div, 'div', 'sr-desc', 'No dates');
      } else {
        const startLabel = formatDateForDisplay(r.startYear, r.startEra);
        const hasEnd = r.endYear != null;
        const dateText = hasEnd
          ? `${startLabel} — ${formatDateForDisplay(r.endYear, r.endEra)}`
          : startLabel;
        const dateLine = document.createElement('div');
        dateLine.className = 'sr-desc';
        if (r.dateLabel) {
          const tag = document.createElement('span');
          tag.className = 'sr-date-label';
          tag.textContent = r.dateLabel;
          dateLine.appendChild(tag);
          dateLine.appendChild(document.createTextNode(' · '));
        }
        dateLine.appendChild(document.createTextNode(dateText));
        div.appendChild(dateLine);
        div.addEventListener('click', () => {
          activeSearchId++;
          clearTimeout(searchTimeout);
          const startYearsAgo = dateToYearsAgo(r.startYear, r.startEra);
          const endYearsAgo = hasEnd ? dateToYearsAgo(r.endYear, r.endEra) : startYearsAgo;
          const itemId = r.hasMultiple && r.dateLabel ? `${r.label} — ${r.dateLabel}` : r.label;
          addItem({ id: itemId, start: startYearsAgo, end: endYearsAgo, color: nextColor(), wdId: r.wdId, wpLang: r.wpLang, startProp: r.startProp, endProp: r.endProp }, { animateFit: true });
          clearElement(searchResultsEl);
          setSearchResultsVisible(false);
          searchInput.value = '';
          searchInput.blur();
        });
      }
      searchResultsEl.appendChild(div);
    }
    selectedResultIndex = 0;
    updateSelectedResult();
    setSearchResultsVisible(searchResultsEl.children.length > 0);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (!isCurrentSearch()) return;
    showSearchMessage(`Error: ${err.message}`);
  }
}

function getEntityDatesCached(entityId, signal) {
  const cached = entityDatesCache.get(entityId);
  if (cached) return cached;
  const promise = getEntityDates(entityId, signal).catch(err => {
    if (err.name === 'AbortError') entityDatesCache.delete(entityId);
    return null;
  });
  entityDatesCache.set(entityId, promise);
  return promise;
}

async function getEntityDates(entityId, signal) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entityId}&format=json&origin=*`;
  const res = await fetch(url, { signal });
  const json = await res.json();
  const claims = json.claims || {};

  const startPropsRange = ['P580', 'P569', 'P571', 'P1319'];
  const startPropsPoint = ['P575', 'P585'];
  const endProps = ['P582', 'P570', 'P576', 'P1326'];

  let startDate = null, startProp = null, isPointEvent = false;
  for (const p of startPropsRange) {
    startDate = extractDate(claims[p]);
    if (startDate) { startProp = p; break; }
  }
  if (!startDate) {
    for (const p of startPropsPoint) {
      startDate = extractDate(claims[p]);
      if (startDate) { startProp = p; isPointEvent = true; break; }
    }
  }
  let endDate = null, endProp = null;
  for (const p of endProps) {
    endDate = extractDate(claims[p]);
    if (endDate) { endProp = p; break; }
  }

  if (!startDate) {
    startDate = extractDateFromQualifiers(claims);
  }

  if (startDate) {
    const result = { startYear: startDate.year, startEra: startDate.era, isPointEvent: isPointEvent && !endDate, startProp, endProp };
    if (endDate) { result.endYear = endDate.year; result.endEra = endDate.era; }
    return result;
  }

  const wpDates = await getEntityDatesFromWikipedia(entityId, signal);
  if (wpDates) wpDates.isPointEvent = false;
  return wpDates;
}

const DATE_PAIRS = [
  { start: 'P569', end: 'P570', type: 'range' },
  { start: 'P571', end: 'P576', type: 'range' },
  { start: 'P580', end: 'P582', type: 'range' },
  { start: 'P729', end: 'P730', type: 'range' },
  { start: 'P1319', end: 'P1326', type: 'range' },
  { start: 'P606', type: 'point' },
  { start: 'P575', type: 'point' },
  { start: 'P585', type: 'point' },
];

async function getAllEntityDates(entityId, signal) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entityId}&format=json&origin=*`;
  const res = await fetch(url, { signal });
  const json = await res.json();
  const claims = json.claims || {};

  const results = [];
  const seen = new Set();

  for (const pair of DATE_PAIRS) {
    const startDate = extractDate(claims[pair.start]);
    if (!startDate) continue;
    const endDate = pair.end ? extractDate(claims[pair.end]) : null;
    const key = `${startDate.year}:${startDate.era}:${endDate?.year || ''}:${endDate?.era || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = { startYear: startDate.year, startEra: startDate.era, isPointEvent: pair.type === 'point' && !endDate, startProp: pair.start, endProp: endDate ? pair.end : null };
    if (endDate) { r.endYear = endDate.year; r.endEra = endDate.era; }
    results.push(r);
  }

  if (results.length === 0) {
    const qualDate = extractDateFromQualifiers(claims);
    if (qualDate) {
      results.push({ startYear: qualDate.year, startEra: qualDate.era, isPointEvent: false, startProp: null, endProp: null });
    }
  }

  if (results.length === 0) {
    const wpDates = await getEntityDatesFromWikipedia(entityId, signal);
    if (wpDates) { wpDates.isPointEvent = false; results.push(wpDates); }
  }

  return results;
}

const entityAllDatesCache = new Map();
function getAllEntityDatesCached(entityId, signal) {
  const cached = entityAllDatesCache.get(entityId);
  if (cached) return cached;
  const promise = getAllEntityDates(entityId, signal).catch(err => {
    if (err.name === 'AbortError') entityAllDatesCache.delete(entityId);
    return [];
  });
  entityAllDatesCache.set(entityId, promise);
  return promise;
}

function extractDateFromQualifiers(claims) {
  const propsToScan = ['P793', 'P527', 'P1542', 'P31'];
  const dateProps = ['P580', 'P585', 'P571', 'P575', 'P1319'];
  let earliest = null;
  for (const prop of propsToScan) {
    const arr = claims[prop];
    if (!arr) continue;
    for (const claim of arr) {
      const quals = claim.qualifiers;
      if (!quals) continue;
      for (const dp of dateProps) {
        if (!quals[dp]) continue;
        const d = extractDateFromSnak(quals[dp][0]);
        if (d && (!earliest || d.year < earliest.year)) earliest = d;
      }
    }
  }
  return earliest;
}

function extractDateFromSnak(snak) {
  const val = snak?.datavalue?.value;
  if (!val || !val.time) return null;
  const time = val.time;
  const negative = time.startsWith('-');
  const match = time.match(/([+-]?\d+)-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Math.abs(parseInt(match[1]));
  return { year, era: negative ? 'bce' : 'ce' };
}

async function getEntityDatesFromWikipedia(entityId, signal) {
  try {
    const siteUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`;
    const siteRes = await fetch(siteUrl, { signal });
    const siteJson = await siteRes.json();
    const title = siteJson.entities?.[entityId]?.sitelinks?.enwiki?.title;
    if (!title) return null;

    const wpUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=2000&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const wpRes = await fetch(wpUrl, { signal });
    const wpJson = await wpRes.json();
    const pages = wpJson.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    const extract = page?.extract;
    if (!extract) return null;

    return parseDatesFromText(extract);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return null;
  }
}

function parseDatesFromText(text) {
  const first300 = text.slice(0, 2000);

  // Try "X million/billion years ago" patterns (e.g. "233.23 million years ago")
  const myaMatches = [];
  const myaRe = /([\d.]+)\s*(million|billion)\s+years\s+ago/gi;
  let myaM;
  while ((myaM = myaRe.exec(first300)) !== null) {
    const num = parseFloat(myaM[1]);
    const mult = myaM[2].toLowerCase() === 'billion' ? 1e9 : 1e6;
    myaMatches.push(Math.round(num * mult));
  }
  if (myaMatches.length >= 2) {
    const oldest = Math.max(...myaMatches);
    const newest = Math.min(...myaMatches);
    return { startYear: oldest, startEra: 'bce', endYear: newest, endEra: 'bce' };
  }
  if (myaMatches.length === 1) {
    return { startYear: myaMatches[0], startEra: 'bce' };
  }

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
  if (era === 'bce') return `${year} BCE`;
  return `${year} CE`;
}

const PROP_LABELS = {
  en: {
    P569: 'Date of birth', P570: 'Date of death',
    P571: 'Inception', P576: 'Dissolved',
    P580: 'Start', P582: 'End',
    P575: 'Date of discovery', P585: 'Date',
    P606: 'First flight', P729: 'Service entry', P730: 'Service retirement',
    P1319: 'Earliest date', P1326: 'Latest date',
  },
  ru: {
    P569: 'Дата рождения', P570: 'Дата смерти',
    P571: 'Основано', P576: 'Прекращено',
    P580: 'Начало', P582: 'Окончание',
    P575: 'Дата открытия', P585: 'Дата',
    P606: 'Первый полёт', P729: 'Начало эксплуатации', P730: 'Конец эксплуатации',
    P1319: 'Самая ранняя дата', P1326: 'Самая поздняя дата',
  },
};

const RANGE_LABELS = {
  en: {
    'P569-P570': 'Lifespan',
    'P571-P576': 'Existence',
    'P580-P582': 'Period',
    'P729-P730': 'Service period',
    'P1319-P1326': 'Range',
  },
  ru: {
    'P569-P570': 'Годы жизни',
    'P571-P576': 'Существование',
    'P580-P582': 'Период',
    'P729-P730': 'Период эксплуатации',
    'P1319-P1326': 'Диапазон',
  },
};

const LIVING_LABEL = { en: 'Born (still alive)', ru: 'Дата рождения' };

function getDateLabelFromProps(startProp, endProp, lang) {
  const l = (lang === 'ru') ? 'ru' : 'en';
  const labels = PROP_LABELS[l];
  const ranges = RANGE_LABELS[l];
  if (!startProp) return '';
  if (endProp) {
    const key = startProp + '-' + endProp;
    return ranges[key] || `${labels[startProp] || ''} — ${labels[endProp] || ''}`;
  }
  return labels[startProp] || '';
}

function getDateLabel(item) {
  const lang = (item.wpLang === 'ru') ? 'ru' : 'en';
  const labels = PROP_LABELS[lang];
  const ranges = RANGE_LABELS[lang];
  if (!item.startProp) return '';
  if (item.endProp) {
    const key = item.startProp + '-' + item.endProp;
    return ranges[key] || `${labels[item.startProp] || ''} — ${labels[item.endProp] || ''}`;
  }
  if (item.startProp === 'P569' && item.start === item.end) {
    return LIVING_LABEL[lang];
  }
  return labels[item.startProp] || '';
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
  const isPoint = found.start === found.end;
  clearElement(tooltip);
  appendTextElement(tooltip, 'div', 'tt-title', found.id);
  const label = getDateLabel(found);
  if (label) appendTextElement(tooltip, 'div', 'tt-label', label);
  const datesEl = appendTextElement(tooltip, 'div', 'tt-dates', calStart);
  if (isPoint) {
    datesEl.textContent = calStart;
  } else {
    const calEnd = found.end > 0 ? formatCalendarYear(found.end) : formatCalendarYear(0);
    const duration = found.start - found.end;
    datesEl.textContent = `${calStart} — ${calEnd}`;
    datesEl.append(document.createElement('br'), document.createTextNode(formatDuration(duration)));
  }
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
