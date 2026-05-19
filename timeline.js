(async () => {
  const source = 'https://raw.githubusercontent.com/ruslanhirychau/WikiTimeline/ad6c3c2394ddfdf38a9e5ac9b8df34cd3b9fb6de/timeline.js';
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Failed to load timeline source: ${response.status}`);
  let code = await response.text();

  function replaceOnce(oldText, newText, label) {
    if (code.includes(newText)) return;
    if (!code.includes(oldText)) throw new Error(`Missing patch target: ${label}`);
    code = code.replace(oldText, newText);
  }

  replaceOnce(
    "const data = items.map(it => ({ id: it.id, start: it.start, end: it.end, color: it.color, wdId: it.wdId, wpLang: it.wpLang, startProp: it.startProp, endProp: it.endProp }));",
    "const data = items.map(it => ({ id: it.id, start: it.start, end: it.end, color: it.color, wdId: it.wdId, wpLang: it.wpLang, startProp: it.startProp, endProp: it.endProp, muted: !!it.muted }));",
    'save muted state'
  );

  replaceOnce(
`        items = data.map(it => {
          if ((it.wdId === 'Q937' || it.id === 'Albert Einstein') && !it.startProp && !it.endProp) {
            return { ...it, startProp: 'P569', endProp: 'P570' };
          }
          return it;
        });`,
`        items = data.map(it => {
          if ((it.wdId === 'Q937' || it.id === 'Albert Einstein') && !it.startProp && !it.endProp) {
            return { ...it, startProp: 'P569', endProp: 'P570', muted: !!it.muted };
          }
          return { ...it, muted: !!it.muted };
        });`,
    'load muted state'
  );

  replaceOnce(
`    tag.className = 'search-tag';
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
    });`,
`    tag.className = 'search-tag';
    if (item.muted) tag.classList.add('muted');
    tag.style.backgroundColor = colorToRgba(item.color, 0.15);
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    const dotCore = document.createElement('span');
    dotCore.className = 'tag-dot-core';
    dotCore.style.backgroundColor = item.muted ? 'transparent' : item.color;
    dotCore.style.borderColor = item.color;
    dot.appendChild(dotCore);
    const remove = document.createElement('span');
    remove.className = 'tag-remove';
    remove.appendChild(createLucideIcon('x', 12));
    tag.append(dot, document.createTextNode(item.id), remove);
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleItemMuted(item.id);
    });
    tag.addEventListener('click', () => {
      if (item.muted) {
        item.muted = false;
        saveState();
        renderTags();
      }
      focusItem(item.id);
    });`,
    'render muted tags'
  );

  replaceOnce(
    'function clampView(start, end) {',
`function toggleItemMuted(id) {
  const item = items.find(r => r.id === id);
  if (!item) return;
  item.muted = !item.muted;
  saveState();
  renderTags();
  requestDraw();
}

function clampView(start, end) {`,
    'toggle muted function'
  );

  replaceOnce(
`function computeFitView() {
  if (items.length === 0) return null;
  let maxStart = 0, minEnd = Infinity;
  for (const it of items) {`,
`function computeFitView() {
  const visibleItems = items.filter(it => !it.muted);
  if (visibleItems.length === 0) return null;
  let maxStart = 0, minEnd = Infinity;
  for (const it of visibleItems) {`,
    'fit visible items'
  );

  replaceOnce(
`  itemRects = [];
  if (items.length > 0) {
    const { rowCount, rowMap } = assignRows(items);`,
`  itemRects = [];
  const visibleItems = items.filter(it => !it.muted);
  if (visibleItems.length > 0) {
    const { rowCount, rowMap } = assignRows(visibleItems);`,
    'draw visible items setup'
  );

  replaceOnce(
`    for (let i = 0; i < items.length; i++) {
      const s = items[i];`,
`    for (let i = 0; i < visibleItems.length; i++) {
      const s = visibleItems[i];`,
    'draw visible items loop'
  );

  replaceOnce(
    'const showFitAll = items.length > 0;',
    'const showFitAll = visibleItems.length > 0;',
    'fit all visibility'
  );

  replaceOnce(
`  addItem({ id: 'Albert Einstein', start: CURRENT_YEAR - 1879, end: CURRENT_YEAR - 1955, color: nextColor(), wdId: 'Q937', startProp: 'P569', endProp: 'P570' });
  addItem({ id: 'World War I', start: CURRENT_YEAR - 1914, end: CURRENT_YEAR - 1918, color: nextColor(), wdId: 'Q361' });
  addItem({ id: 'World War II', start: CURRENT_YEAR - 1939, end: CURRENT_YEAR - 1945, color: nextColor(), wdId: 'Q362' });`,
`  addItem({ id: 'Albert Einstein', start: CURRENT_YEAR - 1879, end: CURRENT_YEAR - 1955, color: nextColor(), wdId: 'Q937', startProp: 'P569', endProp: 'P570', muted: false });
  addItem({ id: 'World War I', start: CURRENT_YEAR - 1914, end: CURRENT_YEAR - 1918, color: nextColor(), wdId: 'Q361', muted: false });
  addItem({ id: 'World War II', start: CURRENT_YEAR - 1939, end: CURRENT_YEAR - 1945, color: nextColor(), wdId: 'Q362', muted: false });`,
    'default muted state'
  );

  const script = document.createElement('script');
  script.textContent = code;
  document.head.appendChild(script);
})().catch((error) => {
  console.error(error);
  const target = document.getElementById('search-box') || document.body;
  const message = document.createElement('div');
  message.textContent = 'Failed to load timeline.';
  message.style.color = '#ef4444';
  message.style.padding = '8px';
  target.appendChild(message);
});
