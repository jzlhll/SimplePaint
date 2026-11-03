import { drawingTools, basicLines, basicShapes, extraShapes, lineTools, shortcuts, title, tagline, isLine, drawLine, drawShape, icon } from './drawing.js';
import { createColorPicker } from './color-picker.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), overlay = $('#overlay');
const ctx = canvas.getContext('2d', { willReadFrequently: true }), preview = overlay.getContext('2d');
const app = $('#app'), viewport = $('#viewport'), wrap = $('#canvas-wrap');
const state = {
  tool: 'brush', color: '#263843', size: 3, fontSize: 32, font: 'system-ui', filled: false, zoom: .6,
  history: [], future: [], id: 0, savedId: 0, nextId: 1, selection: null, floating: null, gesture: null,
  busy: false, clipboard: null, recent: [], filename: '未命名.png',
};
const palette = ['#263843', '#FFFFFF', '#88929E', '#EE6469', '#F0A04C', '#E9CF54', '#7CAC73', '#339D92', '#66B6CC', '#588BC8', '#9A83BB', '#D487AF'];
const allShapes = [...new Set([...basicShapes, ...extraShapes])];
const fixedLines = basicLines.slice(0, 4), fixedShapes = basicShapes.slice(0, 4);
const moreLines = [basicLines[4], ...lineTools.filter(tool => !basicLines.includes(tool))];
const moreShapes = [basicShapes[4], ...allShapes.filter(tool => !basicShapes.includes(tool))];
let extraLine = readPreference('simplepaint.visibleLine', basicLines[4]);
let extraShape = readPreference('simplepaint.visibleShape', basicShapes[4]);
if (!moreLines.includes(extraLine)) extraLine = basicLines[4];
if (!moreShapes.includes(extraShape)) extraShape = basicShapes[4];
try { for (const key of ['simplepaint.usage.lines.v1', 'simplepaint.usage.shapes.v1', 'simplepaint.usage.colors.v1']) localStorage.removeItem(key); } catch { /* 清理旧排序缓存失败不影响工具选择。 */ }
let visibleLines = [], visibleShapes = [];
let colorDisplay = readPreference('simplepaint.colorDisplay', 'hex') === 'rgb' ? 'rgb' : 'hex';
let toastTimer;

function readPreference(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
    return value ?? fallback;
  } catch { return fallback; }
}
function preference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式下仍可继续绘画。 */ }
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function blank(width, height, white = false) {
  const image = document.createElement('canvas'); image.width = width; image.height = height;
  if (white) { const context = image.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
  return image;
}
function copyCanvas(source = canvas) { const image = blank(source.width, source.height); image.getContext('2d').drawImage(source, 0, 0); return image; }
function snapshot() { return { image: copyCanvas(), id: state.id }; }
function validateSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('请输入 1–8192 的整数尺寸，总像素不能超过 1600 万。');
  }
}
function setImage(image) {
  canvas.width = image.width; canvas.height = image.height;
  overlay.width = image.width; overlay.height = image.height;
  ctx.drawImage(image, 0, 0); state.selection = null; state.floating = null; refreshLayout();
}
function record(previous) {
  state.history.push(previous); state.future = []; state.id = state.nextId++;
  trimHistory(); update();
}
// 按位图实际大小限制历史内存，大图保留较少步骤。
function trimHistory() {
  let bytes = canvas.width * canvas.height * 4;
  for (const entries of [state.history, state.future]) {
    let keep = 0;
    for (let i = entries.length - 1; i >= 0 && keep < 20; i--) {
      const size = entries[i].image.width * entries[i].image.height * 4;
      if (keep > 0 && bytes + size > 128_000_000) break;
      bytes += size; keep++;
    }
    if (entries.length > keep) entries.splice(0, entries.length - keep);
  }
}
function change(operation) {
  finishGesture(); const previous = snapshot(); operation(); state.selection = null; state.floating = null; clearPreview(); record(previous);
}
function undo() {
  finishGesture(); const previous = state.history.pop(); if (!previous) return;
  state.future.push(snapshot()); setImage(previous.image); state.id = previous.id; update();
}
function redo() {
  finishGesture(); const next = state.future.pop(); if (!next) return;
  state.history.push(snapshot()); setImage(next.image); state.id = next.id; update();
}
function update() {
  document.querySelector('[data-action="undo"]').disabled = !state.history.length;
  document.querySelector('[data-action="redo"]').disabled = !state.future.length;
  document.querySelector('[data-action="crop"]').disabled = !state.selection;
  document.title = `${state.id === state.savedId ? '' : '* '}${state.filename} · 轻绘 SimplePaint`;
  $('#dimensions').textContent = `${canvas.width} × ${canvas.height} px`;
  $('#zoom').textContent = `${Math.round(state.zoom * 100)}%`;
  drawSelection();
}
function refreshLayout() { wrap.style.width = `${canvas.width * state.zoom}px`; wrap.style.height = `${canvas.height * state.zoom}px`; update(); }
function zoom(value) {
  finishGesture();
  const old = state.zoom, center = { x: viewport.scrollLeft + viewport.clientWidth / 2, y: viewport.scrollTop + viewport.clientHeight / 2 };
  state.zoom = Math.max(.1, Math.min(4, value)); refreshLayout();
  viewport.scrollLeft = center.x * state.zoom / old - viewport.clientWidth / 2;
  viewport.scrollTop = center.y * state.zoom / old - viewport.clientHeight / 2;
}
function clearPreview() { preview.clearRect(0, 0, overlay.width, overlay.height); }
function drawSelection() {
  if (state.gesture && !['select', 'move'].includes(state.gesture.kind)) return;
  clearPreview(); const s = state.selection; if (!s) return;
  preview.save(); preview.lineWidth = 1 / state.zoom; preview.setLineDash([5 / state.zoom, 4 / state.zoom]);
  preview.strokeStyle = '#fff'; preview.strokeRect(s.x, s.y, s.w, s.h); preview.lineDashOffset = 5 / state.zoom;
  preview.strokeStyle = '#222'; preview.strokeRect(s.x, s.y, s.w, s.h); preview.restore();
}
function toolButton(tool, compact = false) {
  const button = document.createElement('button'); button.type = 'button'; button.className = `tool-button${compact ? ' line-button' : ''}`;
  button.dataset.tool = tool; button.setAttribute('aria-label', title(tool)); button.title = title(tool) + (shortcuts[tool] ? ` · ${shortcuts[tool]}` : '');
  button.append(icon(tool));
  if (!compact) { const name = document.createElement('span'); name.textContent = tool === 'moreLines' ? '更多' : title(tool); button.append(name); }
  button.addEventListener('click', () => {
    if (tool === 'more' || tool === 'moreLines') showTools(button, tool === 'moreLines');
    else { selectTool(tool); $('#tool-popover').hidePopover(); }
  });
  return button;
}
function selectTool(tool) {
  finishGesture();
  if (moreLines.includes(tool)) { extraLine = tool; preference('simplepaint.visibleLine', tool); }
  else if (moreShapes.includes(tool)) { extraShape = tool; preference('simplepaint.visibleShape', tool); }
  state.tool = tool;
  renderToolGroups();
  if (tool !== 'selection') { state.selection = null; state.floating = null; }
  clearPreview();
  for (const button of document.querySelectorAll('[data-tool]')) {
    const selected = button.dataset.tool === tool || (button.dataset.tool === 'more' && extraShapes.includes(tool) && !visibleShapes.includes(tool)) || (button.dataset.tool === 'moreLines' && isLine(tool) && !visibleLines.includes(tool));
    button.setAttribute('aria-pressed', String(selected));
  }
  $('#tool-title').textContent = title(tool); $('#tool-tagline').textContent = tagline(tool);
  $('#brush-controls').hidden = tool === 'text'; $('#text-controls').hidden = tool !== 'text';
  canvas.style.cursor = tool === 'text' ? 'text' : tool === 'selection' ? 'default' : 'crosshair'; update();
}
function openPopover(anchor, heading) {
  finishGesture(); const popover = $('#tool-popover'); popover.replaceChildren();
  const h = document.createElement('h2'); h.textContent = heading; popover.append(h); popover.showPopover();
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, rect.right + 8))}px`;
  popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, rect.top))}px`;
  return popover;
}
function showTools(anchor, lines) {
  const popover = openPopover(anchor, lines ? '更多线条' : '更多形状');
  const grid = document.createElement('div'); grid.className = 'popover-grid';
  (lines ? moreLines : moreShapes).forEach(tool => grid.append(toolButton(tool, true))); popover.append(grid);
  // 加入内容后重新定位，避免短窗口中菜单超出可视区域。
  popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, anchor.getBoundingClientRect().top))}px`;
}
function renderToolGroups() {
  visibleLines = [...fixedLines, extraLine];
  visibleShapes = [...fixedShapes, extraShape];
  for (const [selector, tools] of [['#line-tools', [...visibleLines, 'moreLines']], ['#shape-tools', [...visibleShapes, 'more']]]) {
    const container = $(selector); container.replaceChildren();
    tools.forEach(tool => container.append(toolButton(tool, selector === '#line-tools')));
  }
}
function colorValue() {
  if (colorDisplay === 'hex') return state.color;
  return state.color.slice(1).match(/../g).map(value => parseInt(value, 16)).join(',');
}
function refreshColorValue() {
  $('#hex').value = colorValue(); $('#hex').dataset.format = colorDisplay;
  $('#hex').setAttribute('aria-label', colorDisplay === 'hex' ? '十六进制颜色' : 'RGB 颜色');
  document.querySelectorAll('[data-color-display]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.colorDisplay === colorDisplay)));
}
function chooseColor(color, recent = false) {
  if (!/^#[\da-f]{6}$/i.test(color)) return false;
  state.color = color.toUpperCase(); refreshColorValue();
  $('.current-color').style.background = state.color;
  if (recent && !palette.includes(state.color)) {
    state.recent = [state.color, ...state.recent.filter(value => value !== state.color)].slice(0, 3); preference('simplepaint.colors', state.recent);
  }
  renderPalette(); return true;
}
function colorButton(color, onPick) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'swatch'; button.title = color; button.setAttribute('aria-label', `颜色 ${color}`);
  button.style.background = color; button.style.setProperty('--swatch', color); button.setAttribute('aria-pressed', String(color === state.color));
  button.addEventListener('click', () => onPick(color)); return button;
}
function renderPalette() {
  for (const [selector, colors] of [['#palette', palette], ['#recent-colors', state.recent]]) {
    const container = $(selector); container.replaceChildren();
    colors.forEach(color => container.append(colorButton(color, chooseColor)));
    container.hidden = !colors.length;
  }
}
async function showColorPicker() {
  const picker = createColorPicker(state.color, readPreference('simplepaint.colorFormat', 'hex'), format => preference('simplepaint.colorFormat', format));
  if (await ask({ heading: '更多颜色', content: picker.element, confirm: '应用' })) chooseColor(picker.color, true);
}
async function copyColor() {
  try { await navigator.clipboard.writeText(colorDisplay === 'hex' ? state.color : `rgb(${colorValue()})`); toast('已复制色值'); }
  catch { toast('无法访问系统剪贴板，请选中色值手动复制。'); }
}
function applyTheme(theme) {
  if (!['dark', 'light', 'system'].includes(theme)) theme = 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  for (const button of document.querySelectorAll('button[data-theme]')) button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  preference('simplepaint.theme', theme);
}

function ask({ heading, content, confirm = '确定', validate = () => true }) {
  finishGesture(); $('#tool-popover').hidePopover();
  const dialog = $('#dialog'); $('#dialog-title').textContent = heading; $('#dialog-content').replaceChildren(content);
  $('#dialog-error').textContent = ''; $('#dialog-confirm').textContent = confirm; dialog.returnValue = '';
  return new Promise(resolve => {
    const form = $('#dialog-form');
    const submit = event => {
      event.preventDefault();
      try { if (validate()) dialog.close('confirm'); } catch (error) { $('#dialog-error').textContent = error.message; }
    };
    const close = () => { form.removeEventListener('submit', submit); resolve(dialog.returnValue === 'confirm'); canvas.focus({ preventScroll: true }); };
    form.addEventListener('submit', submit); dialog.addEventListener('close', close, { once: true });
    dialog.showModal();
  });
}
function paragraph(text) { const p = document.createElement('p'); p.textContent = text; return p; }
async function canDiscard() {
  if (state.id === state.savedId) return true;
  return ask({ heading: '放弃未保存的修改？', content: paragraph('当前画布尚未保存。继续操作会丢弃这些修改。'), confirm: '放弃修改' });
}
async function newDocument() {
  if (!await canDiscard()) return;
  const image = blank(1200, 800, true); resetDocument(image, '未命名.png');
}
function resetDocument(image, filename) {
  state.history = []; state.future = []; state.id = state.nextId++; state.savedId = state.id;
  state.filename = filename; setImage(image); update();
}
async function withBusy(operation) {
  if (state.busy || $('#dialog').open) return;
  finishGesture(); state.busy = true; app.inert = true;
  try { await operation(); } catch (error) { console.error('Editor operation failed', error); toast(error.message || '操作失败，请重试。'); }
  finally { state.busy = false; app.inert = false; }
}
async function decodeFile(file) {
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode(); validateSize(image.naturalWidth, image.naturalHeight);
    const result = blank(image.naturalWidth, image.naturalHeight); result.getContext('2d').drawImage(image, 0, 0); return result;
  } catch (error) {
    if (error.message?.startsWith('请输入')) throw error;
    throw new Error('无法打开这张图片，请使用浏览器支持的 PNG、JPEG、WebP、GIF、BMP 或 SVG 图片。');
  } finally { URL.revokeObjectURL(url); }
}
async function openFile(file) {
  if (!file) return;
  await withBusy(async () => {
    const image = await decodeFile(file);
    if (await canDiscard()) resetDocument(image, file.name.replace(/\.[^.]+$/, '') + '.png');
  });
}
async function save() {
  const content = document.createElement('div'); content.className = 'dialog-fields';
  const name = document.createElement('input'); name.value = state.filename; name.maxLength = 180; name.setAttribute('aria-label', '导出文件名');
  const format = document.createElement('select'); format.setAttribute('aria-label', '图片格式');
  for (const [value, text] of [['png', 'PNG · 无损，保留透明'], ['jpeg', 'JPEG · 白色背景'], ['webp', 'WebP · 较小文件']]) format.add(new Option(text, value));
  const extension = state.filename.split('.').pop().toLowerCase(); format.value = ['jpeg', 'jpg'].includes(extension) ? 'jpeg' : extension === 'webp' ? 'webp' : 'png';
  for (const [text, field] of [['文件名', name], ['格式', format]]) { const label = document.createElement('label'); label.append(text, field); content.append(label); }
  if (!await ask({ heading: '保存图片', content, confirm: '下载', validate: () => { if (!name.value.trim()) throw new Error('请输入文件名。'); return true; } })) return;
  const filename = name.value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.(png|jpe?g|webp)$/i, '') + '.' + (format.value === 'jpeg' ? 'jpg' : format.value);
  let image = canvas;
  if (format.value === 'jpeg') { image = blank(canvas.width, canvas.height, true); image.getContext('2d').drawImage(canvas, 0, 0); }
  const blob = await new Promise(resolve => image.toBlob(resolve, `image/${format.value}`, .92));
  if (!blob) throw new Error('图片导出失败。');
  if (blob.type !== `image/${format.value}`) throw new Error('当前浏览器不支持该格式，请选择 PNG。');
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  state.filename = filename; state.savedId = state.id; update(); toast('已发起图片下载');
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(canvas.width - 1, (event.clientX - rect.left) / state.zoom)), y: Math.max(0, Math.min(canvas.height - 1, (event.clientY - rect.top) / state.zoom)) };
}
function rectangle(a, b, constrain = false) {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (constrain) { const side = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * side; dy = (dy < 0 ? -1 : 1) * side; }
  const x = Math.max(0, Math.floor(Math.min(a.x, a.x + dx))), y = Math.max(0, Math.floor(Math.min(a.y, a.y + dy)));
  return { x, y, w: Math.min(canvas.width - x, Math.round(Math.abs(dx))), h: Math.min(canvas.height - y, Math.round(Math.abs(dy))) };
}
function inside(p, rect) { return rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h; }
function selectionImage(rect = state.selection) {
  const image = blank(rect.w, rect.h); image.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h); return image;
}
function brush(from, to) {
  const size = state.tool === 'pencil' ? 1 : state.size;
  ctx.save(); ctx.strokeStyle = state.tool === 'eraser' ? '#fff' : state.color; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
  if (from.x === to.x && from.y === to.y) { ctx.beginPath(); ctx.arc(from.x, from.y, size / 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function startGesture(event) {
  if (event.button !== 0 || state.busy || $('#dialog').open) return;
  event.preventDefault(); finishGesture(); canvas.focus({ preventScroll: true });
  const p = point(event);
  if (state.tool === 'picker') {
    const pixel = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
    chooseColor(pixel[3] ? '#' + Array.from(pixel.slice(0, 3), c => c.toString(16).padStart(2, '0')).join('') : '#FFFFFF', true); return;
  }
  if (state.tool === 'fill') { floodFill(p); return; }
  if (state.tool === 'text') { void withBusy(() => insertText(p)); return; }
  const g = { start: p, last: p, end: p, shift: event.shiftKey, pointer: event.pointerId };
  if (state.tool === 'selection' && inside(p, state.selection)) {
    g.kind = 'move'; g.previous = snapshot(); g.rect = { ...state.selection };
    g.content = state.floating?.image || selectionImage(); g.background = state.floating?.background || copyCanvas();
    if (!state.floating) { const context = g.background.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h); }
  } else if (state.tool === 'selection') { g.kind = 'select'; state.selection = null; state.floating = null; }
  else {
    state.selection = null; state.floating = null; clearPreview(); g.previous = snapshot();
    g.kind = ['brush', 'pencil', 'eraser'].includes(state.tool) ? 'brush' : 'shape';
    if (g.kind === 'brush') brush(p, p);
  }
  state.gesture = g; canvas.setPointerCapture(event.pointerId);
}
function moveGesture(event) {
  const g = state.gesture, p = point(event);
  if (!g) {
    if (state.tool === 'selection') canvas.style.cursor = inside(p, state.selection) ? 'move' : 'crosshair';
    return;
  }
  if (event.pointerId !== g.pointer) return;
  g.end = p; g.shift = event.shiftKey;
  if (g.kind === 'brush') {
    const coalesced = event.getCoalescedEvents?.();
    for (const item of coalesced?.length ? coalesced : [event]) { const next = point(item); brush(g.last, next); g.last = next; }
  } else if (g.kind === 'select') { state.selection = rectangle(g.start, p); drawSelection(); }
  else if (g.kind === 'move') {
    const x = Math.max(0, Math.min(canvas.width - g.rect.w, Math.round(g.rect.x + p.x - g.start.x)));
    const y = Math.max(0, Math.min(canvas.height - g.rect.h, Math.round(g.rect.y + p.y - g.start.y)));
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(g.background, 0, 0); ctx.drawImage(g.content, x, y);
    state.selection = { ...g.rect, x, y }; drawSelection();
  } else { clearPreview(); drawGesture(preview, g); }
}
function drawGesture(context, g) {
  if (isLine(state.tool)) {
    let end = g.end;
    if (g.shift) { const length = Math.hypot(end.x - g.start.x, end.y - g.start.y), angle = Math.round(Math.atan2(end.y - g.start.y, end.x - g.start.x) / (Math.PI / 4)) * Math.PI / 4; end = { x: g.start.x + Math.cos(angle) * length, y: g.start.y + Math.sin(angle) * length }; }
    drawLine(context, state.tool, g.start, end, state.color, state.size);
  } else drawShape(context, state.tool, rectangle(g.start, g.end, g.shift), state.color, state.size, state.filled);
}
function finishGesture(cancel = false) {
  const g = state.gesture; if (!g) return;
  state.gesture = null;
  if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
  clearPreview();
  if (cancel) {
    if (g.previous) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(g.previous.image, 0, 0); }
    state.selection = null; state.floating = null;
  } else if (g.kind === 'select') {
    if (!state.selection?.w || !state.selection?.h) state.selection = null;
  } else {
    if (g.kind === 'shape') drawGesture(ctx, g);
    if (g.kind === 'move') state.floating = { image: g.content, background: g.background };
    const changed = g.kind === 'move' ? state.selection.x !== g.rect.x || state.selection.y !== g.rect.y : g.kind === 'brush' || Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) > .5;
    if (changed) record(g.previous);
  }
  update();
}
function floodFill(p) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), data = image.data, width = canvas.width, height = canvas.height;
  const x = Math.floor(p.x), y = Math.floor(p.y), at = (y * width + x) * 4;
  const target = Array.from(data.slice(at, at + 4));
  const color = [parseInt(state.color.slice(1, 3), 16), parseInt(state.color.slice(3, 5), 16), parseInt(state.color.slice(5, 7), 16), 255];
  if (target.every((c, i) => c === color[i])) return;
  const previous = snapshot(), visited = new Uint8Array(width * height), stack = [y * width + x];
  const matches = index => {
    if (visited[index]) return false;
    const offset = index * 4;
    return target.every((value, channel) => Math.abs(value - data[offset + channel]) <= 20);
  };
  // 扫描线填充避免逐像素递归导致调用栈溢出。
  while (stack.length) {
    const index = stack.pop(); if (!matches(index)) continue;
    const row = Math.floor(index / width), col = index % width;
    let left = col, right = col;
    while (left > 0 && matches(row * width + left - 1)) left--;
    while (right + 1 < width && matches(row * width + right + 1)) right++;
    let above = false, below = false;
    for (let column = left; column <= right; column++) {
      const current = row * width + column; visited[current] = 1; data.set(color, current * 4);
      if (row > 0) { const match = matches(current - width); if (match && !above) stack.push(current - width); above = match; }
      if (row + 1 < height) { const match = matches(current + width); if (match && !below) stack.push(current + width); below = match; }
    }
  }
  ctx.putImageData(image, 0, 0); record(previous);
}

async function insertText(p) {
  const text = document.createElement('textarea'); text.placeholder = '写点什么…'; text.setAttribute('aria-label', '文字内容'); text.autofocus = true;
  if (!await ask({ heading: '添加文字', content: text, confirm: '添加', validate: () => Boolean(text.value.trim()) })) return;
  const lines = text.value.split('\n'), background = copyCanvas(), x = Math.floor(p.x), y = Math.floor(p.y);
  const measure = blank(1, 1).getContext('2d'); measure.font = `${state.fontSize}px ${state.font}`;
  const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(Math.max(...lines.map(line => measure.measureText(line).width))) + 4));
  const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(lines.length * state.fontSize * 1.3)));
  const image = blank(width, height), context = image.getContext('2d');
  context.font = measure.font; context.fillStyle = state.color; context.textBaseline = 'top';
  lines.forEach((line, i) => context.fillText(line, 1, i * state.fontSize * 1.3));
  change(() => ctx.drawImage(image, x, y));
  state.selection = { x, y, w: width, h: height }; state.floating = { image, background }; update();
}
function crop() { if (state.selection) { const image = selectionImage(); change(() => setImage(image)); } }
function deleteSelection() {
  if (!state.selection) return;
  const rect = { ...state.selection }, background = state.floating?.background;
  change(() => { if (background) setImage(background); else { ctx.fillStyle = '#fff'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); } });
}
function transform(kind) {
  change(() => {
    const source = copyCanvas(), rotate = ['clockwise', 'counterclockwise'].includes(kind);
    const image = blank(rotate ? source.height : source.width, rotate ? source.width : source.height), context = image.getContext('2d');
    if (kind === 'clockwise') { context.translate(image.width, 0); context.rotate(Math.PI / 2); }
    if (kind === 'counterclockwise') { context.translate(0, image.height); context.rotate(-Math.PI / 2); }
    if (kind === 'horizontal') { context.translate(image.width, 0); context.scale(-1, 1); }
    if (kind === 'vertical') { context.translate(0, image.height); context.scale(1, -1); }
    context.drawImage(source, 0, 0); setImage(image);
  });
}
async function resize() {
  const content = document.createElement('div'); content.className = 'dialog-fields';
  const width = document.createElement('input'), height = document.createElement('input');
  for (const [name, input, value] of [['宽度', width, canvas.width], ['高度', height, canvas.height]]) {
    input.type = 'number'; input.min = '1'; input.max = '8192'; input.step = '1'; input.value = value; input.required = true;
    const label = document.createElement('label'); label.append(name, input); content.append(label);
  }
  content.append(paragraph('原内容按原始像素贴在新画布左上角，超出右侧和下方的部分会裁掉。'));
  if (!await ask({ heading: '调整画布尺寸', content, confirm: '应用', validate: () => { validateSize(Number(width.value), Number(height.value)); return true; } })) return;
  if (Number(width.value) === canvas.width && Number(height.value) === canvas.height) return;
  change(() => {
    const source = copyCanvas(), image = blank(Number(width.value), Number(height.value), true), context = image.getContext('2d');
    context.drawImage(source, 0, 0);
    setImage(image);
  });
}
async function clear() {
  if (await ask({ heading: '清空画布？', content: paragraph('画布上的所有内容都将被清除，清空后可通过撤销恢复。'), confirm: '清空画布' })) change(() => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
}
async function copySelection(cut = false, writeSystem = true) {
  finishGesture(); state.clipboard = state.selection ? state.floating?.image || selectionImage() : copyCanvas();
  if (writeSystem && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      const blob = new Promise(resolve => state.clipboard.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch { toast('已复制到画板剪贴板，可在此页面粘贴。'); }
  } else if (writeSystem) toast('已复制到画板剪贴板，可在此页面粘贴。');
  if (cut && state.selection) deleteSelection();
}
function pasteImage(image) {
  const origin = state.selection ? { x: state.selection.x, y: state.selection.y } : { x: 0, y: 0 };
  const width = Math.max(canvas.width, origin.x + image.width), height = Math.max(canvas.height, origin.y + image.height); validateSize(width, height);
  const background = blank(width, height); background.getContext('2d').drawImage(canvas, 0, 0);
  change(() => { const result = copyCanvas(background); result.getContext('2d').drawImage(image, origin.x, origin.y); setImage(result); });
  selectTool('selection'); state.selection = { ...origin, w: image.width, h: image.height }; state.floating = { image, background }; update();
}
async function paste() {
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) { const type = item.types.find(value => value.startsWith('image/')); if (type) { pasteImage(await decodeFile(await item.getType(type))); return; } }
    } catch { /* 浏览器拒绝系统剪贴板时，仍可使用页面内的剪贴板。 */ }
  }
  if (state.clipboard) pasteImage(state.clipboard); else toast('请用 ⌘ / Ctrl V 粘贴图片，或将图片拖入画布。');
}
function showActions(anchor) {
  const popover = openPopover(anchor, '画布操作');
  for (const [text, action] of [['逆时针旋转 90°', () => transform('counterclockwise')], ['水平翻转', () => transform('horizontal')], ['垂直翻转', () => transform('vertical')], ['复制 · ⌘ / Ctrl C', () => withBusy(() => copySelection())], ['剪切 · ⌘ / Ctrl X', () => withBusy(() => copySelection(true))], ['粘贴 · ⌘ / Ctrl V', () => withBusy(paste)], ['全选 · ⌘ / Ctrl A', selectAll], ['删除选区', deleteSelection]]) {
    const button = document.createElement('button'); button.className = 'menu-action'; button.textContent = text;
    if (text.startsWith('删除') || text.startsWith('剪切')) button.disabled = !state.selection;
    button.addEventListener('click', () => { popover.hidePopover(); action(); }); popover.append(button);
  }
  popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, anchor.getBoundingClientRect().left - popover.offsetWidth - 8))}px`;
  popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, anchor.getBoundingClientRect().top))}px`;
}
function selectAll() { selectTool('selection'); state.floating = null; state.selection = { x: 0, y: 0, w: canvas.width, h: canvas.height }; update(); }

const actions = {
  new: () => withBusy(newDocument), open: () => { finishGesture(); $('#file-input').click(); }, save: () => withBusy(save), undo, redo,
  zoomIn: () => zoom(state.zoom + .1), zoomOut: () => zoom(state.zoom - .1), resetZoom: () => zoom(1),
  crop, clear: () => withBusy(clear), rotate: () => transform('clockwise'), resize: () => withBusy(resize), actions: event => showActions(event.currentTarget),
};
for (const placeholder of document.querySelectorAll('[data-icon]')) placeholder.append(icon(placeholder.dataset.icon));
drawingTools.forEach(tool => $('#drawing-tools').append(toolButton(tool)));
renderToolGroups();
for (const action of ['selection', 'crop', 'clear', 'rotate', 'actions']) {
  if (action === 'selection') { $('#canvas-actions').append(toolButton(action)); continue; }
  const button = document.createElement('button'); button.className = 'tool-button'; button.dataset.action = action; button.append(icon(action), title(action)); $('#canvas-actions').append(button);
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', event => { if (!state.busy) actions[button.dataset.action](event); });
for (const button of document.querySelectorAll('[data-filled]')) button.addEventListener('click', () => {
  finishGesture(); state.filled = button.dataset.filled === 'true'; document.querySelectorAll('[data-filled]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
});
for (const button of document.querySelectorAll('[data-theme]')) button.addEventListener('click', () => applyTheme(button.dataset.theme));
$('#dialog-cancel').addEventListener('click', () => $('#dialog').close('cancel'));
$('#size').addEventListener('input', event => { finishGesture(); state.size = Number(event.target.value); $('#size-value').value = `${state.size} px`; });
$('#font-size').addEventListener('input', event => { state.fontSize = Number(event.target.value); $('#font-value').value = `${state.fontSize} px`; });
$('#font-family').addEventListener('change', event => { state.font = event.target.value; });
$('#color-picker').addEventListener('click', () => void showColorPicker());
$('#more-colors').addEventListener('click', () => void showColorPicker());
$('#hex').addEventListener('change', event => {
  let value = event.target.value.trim();
  if (colorDisplay === 'rgb') {
    const components = value.replace(/^rgb\(|\)$/gi, '').split(',').map(part => part.trim());
    const parts = components.map(Number);
    value = components.length === 3 && components.every(part => /^\d{1,3}$/.test(part)) && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? '#' + parts.map(part => part.toString(16).padStart(2, '0')).join('') : '';
  } else value = '#' + value.replace(/^#/, '');
  if (!chooseColor(value, true)) { refreshColorValue(); toast('请输入有效的 HEX 或 RGB 色值。'); }
});
$('#copy-color').addEventListener('click', () => void copyColor());
for (const button of document.querySelectorAll('[data-color-display]')) button.addEventListener('click', () => {
  colorDisplay = button.dataset.colorDisplay; preference('simplepaint.colorDisplay', colorDisplay); refreshColorValue();
});
$('#hex').addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
$('#file-input').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; void openFile(file); });
canvas.addEventListener('pointerdown', startGesture); canvas.addEventListener('pointermove', moveGesture);
canvas.addEventListener('pointerup', event => { if (state.gesture?.pointer === event.pointerId) { moveGesture(event); finishGesture(); } });
canvas.addEventListener('pointercancel', () => finishGesture(true));
canvas.addEventListener('lostpointercapture', () => finishGesture());
window.addEventListener('blur', () => finishGesture());
viewport.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(state.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
viewport.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
viewport.addEventListener('drop', event => { event.preventDefault(); if (!state.busy) void openFile(event.dataTransfer.files[0]); });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('paste', event => {
  if (event.target.matches('input, textarea, select') || state.busy || $('#dialog').open) return;
  const file = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); void withBusy(async () => pasteImage(await decodeFile(file))); }
  else if (state.clipboard) { event.preventDefault(); void withBusy(() => pasteImage(state.clipboard)); }
});
document.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea, select') || $('#dialog').open || state.busy) return;
  const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
  if (command) {
    if (key === 's') { event.preventDefault(); void withBusy(save); }
    else if (key === 'o') { event.preventDefault(); actions.open(); }
    else if (key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    else if (key === 'y') { event.preventDefault(); redo(); }
    else if (key === 'a') { event.preventDefault(); selectAll(); }
    else if (key === 'c' || key === 'x') { event.preventDefault(); void withBusy(() => copySelection(key === 'x')); }
    else if (['+', '=', '-'].includes(key)) { event.preventDefault(); zoom(state.zoom + (key === '-' ? -.1 : .1)); }
    else if (key === '0') { event.preventDefault(); zoom(1); }
    return;
  }
  if (event.altKey) return;
  if (key === 'escape') { finishGesture(true); state.selection = null; state.floating = null; clearPreview(); update(); return; }
  if (['delete', 'backspace'].includes(key)) { event.preventDefault(); deleteSelection(); return; }
  const tool = Object.keys(shortcuts).find(tool => shortcuts[tool].toLowerCase() === key);
  if (tool) { event.preventDefault(); selectTool(tool); }
});
window.addEventListener('beforeunload', event => { if (state.id !== state.savedId || state.gesture) { event.preventDefault(); event.returnValue = ''; } });

state.recent = readPreference('simplepaint.colors', []).filter(value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)).map(value => value.toUpperCase()).slice(0, 3);
applyTheme(readPreference('simplepaint.theme', 'system')); chooseColor(state.color, false); selectTool('brush');
resetDocument(blank(1200, 800, true), '未命名.png');
