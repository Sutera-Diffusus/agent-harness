// harness v6 renderer: icon rail sidebar + project tree + quota rings + frosted dock.
const $ = s => document.querySelector(s);
const grid = $('#grid');
const segBtns = document.querySelectorAll('.seg button');
const AGENT_CLIS = new Set(['codex', 'omp', 'kimi', 'dsh', 'opencode']);

let slots = [];
let capacity = 4;
let nextPane = 1;
let cliList = [];
let catFilter = 'all';
let search = '';
let projects = [];
let quotaItems = [];
let quotaSeries = {};
let quotaPlans = {};
let quotaPinned = [];
let usageDaily = [];
let usageBySource = [];
let focused = null;
let pjOpen = new Set();
let pjInitDone = false;   // 只在首次加载时默认展开第一个项目，之后尊重用户操作

const CLI_ID = {
  codex:      {color:'#34c26e', label:'Codex'},
  omp:        {color:'#f759ab', label:'omp'},
  kimi:       {color:'#b37feb', label:'Kimi'},
  dsh:        {color:'#4d6bfe', label:'DSH'},
  opencode:   {color:'#f0a832', label:'opencode'},
  powershell: {color:'#4d9fff', label:'PowerShell'},
  cmd:        {color:'#8b919c', label:'cmd'},
  bash:       {color:'#3fb27f', label:'bash'},
};
const cliMeta = id => CLI_ID[id] || {color:'#8b919c', label:id};
const cliLabel = id => cliList.find(c => c.id === id)?.label || cliMeta(id).label;

// ── 真实图标系统（官方品牌标 + lucide） ──
const BRAND_IMG = {codex:'codex.svg', omp:'omp.png', kimi:'kimi.svg', powershell:'powershell.png', cmd:'cmd.png',
                   dsh:'deepseek.svg', opencode:'opencode.svg', bash:'gnubash.svg'};
function lu(name, cls = 'ic') {
  const s = window.__ICONS?.lucide?.[name];
  return s ? s.replace('<svg ', `<svg class="${cls}" `) : '';
}
function brandIcon(id, cls = 'bi') {
  const f = BRAND_IMG[id];
  if (f) return `<img class="${cls}" src="vendor/icons/${f}" alt="">`;
  return lu('terminal', 'ic ' + cls);
}

const paneById = id => slots.find(p => p && p.id === id);
const baseName = pth => { if (!pth) return '?'; const s = pth.replace(/[\\/]+$/, '').split(/[\\/]/); return s[s.length - 1] || pth; };
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setSt = (p, text, cls) => {
  const dirPart = p.cwd ? ` <span class="st-dir">${escapeHtml(baseName(p.cwd))}</span>` : '';
  const showTitle = p.lastTitle && cls !== 'err' && !/[A-Za-z]:[\\/]/.test(p.lastTitle) && !/\.exe/i.test(p.lastTitle)
    && p.lastTitle.trim().length > 2 && p.lastTitle.trim().toLowerCase() !== cliLabel(p.cliId).toLowerCase()
    && p.lastTitle.trim() !== baseName(p.cwd || '');
  const titlePart = showTitle ? ` <span class="st-ttl" title="${escapeHtml(p.lastTitle)}">${escapeHtml(p.lastTitle.length > 20 ? p.lastTitle.slice(0, 20) + '…' : p.lastTitle)}</span>` : '';
  p.st.innerHTML = `${text}${dirPart}${titlePart}`;
  p.st.className = 'st' + (cls ? ' ' + cls : '');
};

// ═══ pty events + 活动状态机 ═══
const WAIT_MS = 5000;
window.harness.onData((id, d) => {
  const p = paneById(id);
  if (!p || !p.term) return;
  p.term.write(d);
  p.act.push(Date.now());
  if (p.act.length > 60) p.act.shift();
  p.lastData = Date.now();
  p.totalChars = (p.totalChars || 0) + d.length;
  const plain = d.replace(/\x1b\[[0-9;?]*[a-zA-Z@]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');
  p.tail = ((p.tail || '') + plain).slice(-2400);
  clearTimeout(p.waitT);
  p.waitT = setTimeout(() => {
    if (!p.alive) return;
    const clean = d.replace(/\x1b\[[0-9;?]*[a-zA-Z@]/g, '').replace(/[^\x20-\uFFFF\n]/g, '');
    if (AGENT_CLIS.has(p.cliId) && /[>$❯»]\s*$/.test(clean)) {
      p.waitingSince = Date.now();
      updatePaneState(p);
    }
  }, WAIT_MS);
});
window.harness.onExit((id, code) => {
  const p = paneById(id);
  if (!p) return;
  p.alive = false;
  p.waitingSince = null;
  // agent CLI 启动后秒退（如账号未登录/瞬态网络）→ 自动重试一次
  const diedFast = p.startedAt && (Date.now() - p.startedAt) < 9000;
  if (diedFast && !p.retried && AGENT_CLIS.has(p.cliId)) {
    p.retried = true;
    setSt(p, '重试中…', 'err');
    setTimeout(() => { if (!p.alive && slots[p.slot] === p) restartPane(p); }, 2500);
  } else {
    setSt(p, '已退出', 'err');
    showDead(p, code);
  }
  updatePaneState(p);
  updateLive();
  toast(`${cliLabel(p.cliId)} 已退出（code ${code}）${diedFast ? '，自动重试' : ''}`, 'err', 2600);
});

function activityRate(p) {
  if (!p.act || !p.act.length) return 0;
  const now = Date.now();
  return p.act.filter(t => now - t < 1500).length;
}
function updatePaneState(p) {
  if (!p.el) return;
  p.el.classList.remove('waiting');
  const rate = activityRate(p);
  if (!p.alive) p.state = 'dead';
  else if (p.waitingSince && rate === 0) {
    p.state = 'waiting';
    p.el.classList.add('waiting');
    setSt(p, '等待输入', 'warn');
  }
  else if (rate >= 2) { p.waitingSince = null; p.state = 'working'; setSt(p, '运行中', 'working'); }
  else if (rate === 0 && p.state !== 'idle') { p.waitingSince = null; p.state = 'idle'; setSt(p, '运行中', 'ok'); }
  renderOps();
}
// 状态衰减：仅 1s 轻量检查（无 canvas 绘制）
setInterval(() => {
  let dirty = false;
  for (const p of slots) {
    if (!p) continue;
    const was = p.state;
    updatePaneState(p);
    if (p.state !== was) dirty = true;
  }
  if (dirty) updateLive();
}, 1000);

function updateLive() {
  const n = slots.filter(p => p && p.alive).length;
  const waiting = slots.filter(p => p && p.alive && p.state === 'waiting').length;
  const live = $('#live');
  live.textContent = `${n} 运行中`;
  live.classList.toggle('on', n > 0);
  $('#hudRun').textContent = n;
  $('#hudWait').textContent = waiting;
  $('#hudWaitSeg').classList.toggle('dim', waiting === 0);
  renderQuotaAlerts();
}
const CLI_PROVIDER = {codex:'commandcode', omp:'kimi-code', kimi:'kimi-code', opencode:'opencode-go'};
function renderQuotaAlerts() {
  for (const p of slots) {
    if (!p || !p.el) continue;
    const prov = CLI_PROVIDER[p.cliId];
    const existing = p.el.querySelector('.quota-warn');
    if (!prov) { existing?.remove(); continue; }
    const q = quotaItems.find(x => x.provider === prov && x.used_fraction != null);
    if (q && q.used_fraction >= 0.7) {
      if (!existing) {
        const w = document.createElement('span');
        w.className = 'quota-warn';
        w.innerHTML = lu('zap', 'ic sm');
        w.title = `${q.label || q.limit_id} 已用 ${(q.used_fraction * 100).toFixed(0)}%`;
        w.style.color = q.used_fraction >= 0.9 ? 'var(--err)' : 'var(--warn)';
        p.el.querySelector('.pane-bar .st').after(w);
      }
    } else existing?.remove();
  }
}
function focusPane(p) {
  focused = p;
  slots.forEach(x => x && x.el.classList.toggle('focus', x === p));
  if (p && p.term) p.term.focus();
}
function toast(msg, type = 'info', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, ms);
}

// ═══ 最大化 ═══
let maxed = null;
function unmax() {
  if (!maxed) return;
  maxed.el.classList.remove('max');
  maxed = null;
  grid.classList.remove('max');
  requestAnimationFrame(fitAll);
}
function toggleMax(p) {
  if (maxed === p) return unmax();
  if (maxed) maxed.el.classList.remove('max');
  maxed = p;
  grid.classList.add('max');
  p.el.classList.add('max');
  requestAnimationFrame(fitAll);
  focusPane(p);
}

// ═══ 设置 ═══
const FONT_STACKS = {
  cascadia: '"CaskaydiaCove NF","Cascadia Mono","Cascadia Code",Consolas,"Microsoft YaHei Mono",monospace',
  consolas: 'Consolas,"Courier New","Microsoft YaHei Mono",monospace',
};
const SET = {
  fs: Number(localStorage.getItem('harness.fs')) || 13,
  ff: localStorage.getItem('harness.ff') || 'cascadia',
};
function applySettings() {
  localStorage.setItem('harness.fs', String(SET.fs));
  localStorage.setItem('harness.ff', SET.ff);
  for (const p of slots) {
    if (p && p.term) {
      p.term.options.fontSize = SET.fs;
      p.term.options.fontFamily = FONT_STACKS[SET.ff];
    }
  }
  requestAnimationFrame(fitAll);
  renderSettingsUI();
}
function renderSettingsUI() {
  $('#sgFs').querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.fs) === SET.fs));
  $('#sgFf').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.ff === SET.ff));
}

// ═══ 侧栏：轨道 + 面板 ═══
function toggleSidebar(force) {
  const off = force !== undefined ? force : !document.body.classList.contains('sboff');
  document.body.classList.toggle('sboff', off);
  $('#topSb').classList.toggle('on', !off);
  localStorage.setItem('harness.sboff', off ? '1' : '0');
  requestAnimationFrame(() => { moveThumb(false); fitAll(); });
}

// ═══ 布局 ═══
const CAP_NEXT = {1: 2, 2: 4, 4: 6};
// 分隔比例（fr 权重），按容量存
let ratios = null;
try { ratios = JSON.parse(localStorage.getItem('harness.ratios') || 'null'); } catch {}
if (!ratios) ratios = {c2: [1, 1], c4: [1, 1], r4: [1, 1], c6: [1, 1, 1], r6: [1, 1]};
function saveRatios() { localStorage.setItem('harness.ratios', JSON.stringify(ratios)); }
const colKey = () => ({2: 'c2', 4: 'c4', 6: 'c6'})[capacity];
const rowKey = () => ({4: 'r4', 6: 'r6'})[capacity];
function applyGridTracks() {
  const ck = colKey(), rk = rowKey();
  grid.style.gridTemplateColumns = ck ? ratios[ck].map(r => r + 'fr').join(' ') : '';
  grid.style.gridTemplateRows = rk ? ratios[rk].map(r => r + 'fr').join(' ') : '';
}
function makeDivider(axis, idx) {
  const d = document.createElement('div');
  d.className = 'divider ' + axis;
  d.onpointerdown = e => {
    e.preventDefault();
    d.setPointerCapture(e.pointerId);
    d.classList.add('drag');
    const key = axis === 'col' ? colKey() : rowKey();
    const r0 = [...ratios[key]];
    const rect = grid.getBoundingClientRect();
    const span = axis === 'col' ? rect.width : rect.height;
    const total = r0.reduce((a, b) => a + b, 0);
    const start = axis === 'col' ? e.clientX : e.clientY;
    d.onpointermove = ev => {
      const pos = axis === 'col' ? ev.clientX : ev.clientY;
      const delta = (pos - start) / span * total;
      const sum = r0[idx] + r0[idx + 1];
      const a = Math.min(Math.max(r0[idx] + delta, sum * 0.12), sum * 0.88);
      ratios[key][idx] = a;
      ratios[key][idx + 1] = sum - a;
      applyGridTracks();
      positionDividers();
    };
    d.onpointerup = () => { d.classList.remove('drag'); d.onpointermove = null; saveRatios(); fitAll(); };
  };
  return d;
}
function positionDividers() {
  const ck = colKey(), rk = rowKey();
  grid.querySelectorAll('.divider.col').forEach((d, i) => {
    const arr = ratios[ck], total = arr.reduce((a, b) => a + b, 0);
    const cum = arr.slice(0, i + 1).reduce((a, b) => a + b, 0);
    d.style.left = `calc(${(cum / total * 100).toFixed(2)}% - 4px)`;
  });
  grid.querySelectorAll('.divider.row').forEach((d, i) => {
    const arr = ratios[rk], total = arr.reduce((a, b) => a + b, 0);
    const cum = arr.slice(0, i + 1).reduce((a, b) => a + b, 0);
    d.style.top = `calc(${(cum / total * 100).toFixed(2)}% - 4px)`;
  });
}
function renderDividers() {
  grid.querySelectorAll('.divider').forEach(d => d.remove());
  const cols = {2: 1, 4: 1, 6: 2}[capacity] || 0;
  const rows = {4: 1, 6: 1}[capacity] || 0;
  for (let i = 0; i < cols; i++) grid.appendChild(makeDivider('col', i));
  for (let i = 0; i < rows; i++) grid.appendChild(makeDivider('row', i));
  positionDividers();
}
const SEG_ICONS = {1:'square', 2:'columns-2', 4:'grid-2x2', 6:'layout-grid'};
function moveThumb(animate = true) {
  const seg = $('#seg'), thumb = $('#segThumb'), active = seg.querySelector('button.active');
  if (!active) return;
  if (!animate) seg.classList.add('no-anim');
  const r = active.getBoundingClientRect(), sr = seg.getBoundingClientRect();
  thumb.style.width = r.width + 'px';
  thumb.style.transform = `translateX(${r.left - sr.left - 3}px)`;
  if (!animate) requestAnimationFrame(() => seg.classList.remove('no-anim'));
}
function updateSeg(n) {
  segBtns.forEach(x => x.classList.toggle('active', Number(x.dataset.g) === n));
  moveThumb();
}
segBtns.forEach(b => b.onclick = () => setCapacity(Number(b.dataset.g)));
window.addEventListener('resize', () => { moveThumb(false); positionDividers(); });

function setCapacity(n) {
  if (n === capacity) return;
  if (maxed) unmax();
  for (let i = n; i < capacity; i++) if (slots[i]) destroyPane(slots[i]);
  capacity = n;
  slots.length = n;
  while (slots.length < n) slots.push(null);
  localStorage.setItem('harness.layout', String(n));
  updateSeg(n);
  { const hl = $('#hudLayout'); if (hl) hl.textContent = {1:'1×1', 2:'2×1', 4:'2×2', 6:'3×2'}[n]; }
  renderGrid();
  requestAnimationFrame(fitAll);
}
function fitAll() {
  for (const p of slots) {
    if (!p || !p.term) continue;
    try { p.fit.fit(); window.harness.resize(p.id, p.term.cols, p.term.rows); } catch {}
  }
}

// ═══ 网格 ═══
function renderGrid() {
  grid.className = 'g' + capacity;
  grid.innerHTML = '';
  for (let i = 0; i < capacity; i++) {
    const p = slots[i];
    if (p) grid.appendChild(p.el);
    else grid.appendChild(makeSlotEl(i));
  }
  applyGridTracks();
  renderDividers();
}
function makeSlotEl(i) {
  const d = document.createElement('div');
  d.className = 'slot';
  const quick = ['omp', 'codex', 'powershell'].filter(id => cliList.some(c => c.id === id));
  const chips = quick.map(id =>
    `<span class="qchip" data-cli="${id}">${brandIcon(id)}${escapeHtml(cliLabel(id))}</span>`).join('');
  d.innerHTML = `<span class="plus">${lu('plus')}</span><span class="lb">空窗格</span>
    <span class="hint">Ctrl+Shift+Enter 新建</span>` +
    (chips ? `<span class="qs">${chips}</span>` : '');
  d.onclick = e => {
    const b = e.target.closest('.qchip');
    if (b) return launchToSlot(b.dataset.cli, null, i);
    openPicker(d, cliId => launchToSlot(cliId, null, i));
  };
  return d;
}

// ═══ 窗格 ═══
function makePane(slotIdx, cliId, cwd) {
  const id = 'pane' + nextPane++;
  const cell = document.createElement('div');
  cell.className = 'pane';
  cell.innerHTML = `
    <div class="pane-bar">
      <span class="chip"></span>
      <select class="cli-sel"></select>
      <span class="bc-ind" title="广播模式已开启"></span>
      <span class="st"></span>
      <button class="ic maxb" title="最大化（双击标题栏）">${lu('maximize-2')}</button>
      <button class="ic restart" title="重启">${lu('rotate-ccw')}</button>
      <button class="ic kill" title="结束并清空">${lu('x')}</button>
    </div>
    <div class="pane-term"></div>
    <div class="dead" hidden></div>
    <div class="find" hidden>
      <input placeholder="查找…" spellcheck="false">
      <button class="prev" title="上一个 (Shift+Enter)">▲</button>
      <button class="next" title="下一个 (Enter)">▼</button>
      <button class="cls" title="关闭 (Esc)">✕</button>
    </div>`;
  const p = {id, cliId, cwd: cwd || null, slot: slotIdx, term: null, fit: null, ro: null,
             alive: false, record: false, el: cell,
             st: cell.querySelector('.st'), sel: cell.querySelector('.cli-sel'),
             act: [], lastData: 0,
             state: 'idle', waitingSince: null, lastTitle: null};
  for (const c of cliList) {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.label;
    p.sel.appendChild(o);
  }
  p.sel.value = cliId;
  p.sel.onchange = () => { p.cliId = p.sel.value; syncChip(p); p.record = AGENT_CLIS.has(p.cliId); restartPane(p); };
  cell.querySelector('.restart').onclick = e => {
    e.stopPropagation();
    p.record = AGENT_CLIS.has(p.cliId);
    restartPane(p);
  };
  cell.querySelector('.maxb').onclick = e => { e.stopPropagation(); toggleMax(p); };
  cell.querySelector('.pane-bar').ondblclick = e => {
    if (e.target.closest('.ic') || e.target.closest('select')) return;
    toggleMax(p);
  };
  cell.querySelector('.kill').onclick = e => { e.stopPropagation(); clearPane(p); };
  cell.onclick = () => focusPane(p);
  // 拖拽换位
  const bar = cell.querySelector('.pane-bar');
  bar.draggable = true;
  bar.ondragstart = e => { e.dataTransfer.setData('text/pane', p.id); e.dataTransfer.effectAllowed = 'move'; cell.style.opacity = '.45'; };
  bar.ondragend = () => { cell.style.opacity = ''; document.querySelectorAll('.pane.drop-hint').forEach(x => x.classList.remove('drop-hint')); };
  cell.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drop-hint'); };
  cell.ondragleave = () => cell.classList.remove('drop-hint');
  cell.ondrop = e => {
    e.preventDefault();
    cell.classList.remove('drop-hint');
    const srcId = e.dataTransfer.getData('text/pane');
    if (srcId && srcId !== p.id) swapPanes(srcId, p.id);
  };
  cell.querySelector('.bc-ind').innerHTML = lu('radio-tower', 'ic sm');
  p.deadEl = cell.querySelector('.dead');
  syncChip(p);
  return p;
}
function syncChip(p) {
  const chip = p.el.querySelector('.chip');
  chip.innerHTML = brandIcon(p.cliId);
  p.el.style.setProperty('--pane-c', cliMeta(p.cliId).color);
}
function destroyPane(p) {
  window.harness.kill(p.id);
  if (p.ro) { p.ro.disconnect(); p.ro = null; }
  if (p.term) { p.term.dispose(); p.term = null; }
  p.alive = false;
  if (focused === p) focused = null;
}
function clearPane(p) {
  if (maxed === p) unmax();
  destroyPane(p);
  slots[p.slot] = null;
  renderGrid();
  updateLive();
  toast(`${cliLabel(p.cliId)} 窗格已清空`, 'info', 2000);
}
function swapPanes(idA, idB) {
  const a = paneById(idA), b = paneById(idB);
  if (!a || !b) return;
  const sa = a.slot, sb = b.slot;
  slots[sa] = b; b.slot = sa;
  slots[sb] = a; a.slot = sb;
  renderGrid();
  requestAnimationFrame(fitAll);
  renderOps();
  toast(`窗格 ${sa + 1} ⇄ ${sb + 1} 已交换`, 'ok', 1800);
}

async function startPane(p) {
  hideDead(p);
  const host = p.el.querySelector('.pane-term');
  host.innerHTML = '';
  const term = new Terminal({
    cursorBlink: true, fontSize: SET.fs, lineHeight: 1.25,
    fontFamily: FONT_STACKS[SET.ff],
    theme: {background: '#0d0d10', foreground: '#d9dde3', cursor: '#4d9fff',
            selectionBackground: 'rgba(77,159,255,.28)'},
  });
  // Canvas 渲染器：GPU 加速，弱机型的主要性能来源
  if (window.CanvasAddon) {
    try { term.loadAddon(new window.CanvasAddon.CanvasAddon()); } catch {}
  }
  if (window.SearchAddon) {
    try { p.search = new window.SearchAddon.SearchAddon(); term.loadAddon(p.search); } catch {}
  }
  wireFind(p);
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try { fit.fit(); } catch {}
  term.onData(d => {
    if (p.waitingSince) { p.waitingSince = null; updatePaneState(p); }
    window.harness.input(p.id, d);
    if (bcOn) for (const q of slots) if (q && q.alive && q !== p) window.harness.input(q.id, d);
  });
  term.onResize(({cols, rows}) => window.harness.resize(p.id, cols, rows));
  term.onTitleChange(title => { if (p.alive) { p.lastTitle = title; updatePaneState(p); } });

  const cli = cliList.find(c => c.id === p.cliId) || cliList[0];
  if (!cli) { setSt(p, '无可用 CLI', 'err'); return; }
  setSt(p, '启动中…');
  const useArgs = p.args && p.args.length ? p.args : cli.args;
  const res = await window.harness.createPty(p.id, p.cliId, cli.cmd, useArgs, p.cwd,
                                             !!p.record, term.cols, term.rows);
  p.args = null;
  p.record = false;
  if (res && res.error) { setSt(p, '失败: ' + res.error, 'err'); toast('启动失败: ' + res.error, 'err'); return; }
  if (res && res.cwd && !p.cwd) p.cwd = res.cwd;
  p.term = term;
  p.fit = fit;
  p.alive = true;
  p.startedAt = Date.now();
  p.retried = false;
  setSt(p, '运行中', 'ok');
  updateLive();
  requestAnimationFrame(() => {
    try { fit.fit(); window.harness.resize(p.id, term.cols, term.rows); } catch {}
  });
  const ro = new ResizeObserver(() => {
    if (!p.term) return;
    try { fit.fit(); window.harness.resize(p.id, term.cols, term.rows); } catch {}
  });
  ro.observe(host);
  p.ro = ro;
  term.focus();
}
async function showDead(p, code) {
  if (!p.deadEl) return;
  let rec = null;
  try {
    const list = await window.harness.recList();
    rec = list.find(r => r.file.endsWith('-' + p.id + '.jsonl'));
  } catch {}
  p.deadEl.innerHTML = `
    <div class="dead-in">
      ${lu('x', 'ic')}
      <b>进程已退出</b>
      <span>exit code ${code}</span>
      <button data-act="retry">${lu('rotate-ccw', 'ic')}重试</button>
      ${rec ? `<button data-act="replay">${lu('activity', 'ic')}回放</button>` : ''}
    </div>`;
  p.deadEl.hidden = false;
  p.deadEl.querySelector('[data-act=retry]').onclick = e => {
    e.stopPropagation();
    hideDead(p);
    p.record = AGENT_CLIS.has(p.cliId);
    restartPane(p);
  };
  const rb = p.deadEl.querySelector('[data-act=replay]');
  if (rb && rec) rb.onclick = e => { e.stopPropagation(); replayPane(p, rec.file); };
}
function hideDead(p) { if (p.deadEl) { p.deadEl.hidden = true; p.deadEl.innerHTML = ''; } }

async function replayPane(p, file) {
  const content = await window.harness.recRead(file);
  if (!content || !p.term) return toast('回放数据不可用', 'err');
  hideDead(p);
  p.alive = false;
  setSt(p, '回放中', 'ok');
  if (p.term.options) p.term.options.disableStdin = true;
  const lines = content.split('\n').filter(l => l.trim());
  const events = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j.dt != null && j.d != null) events.push(j);
    } catch {}
  }
  if (!events.length) { setSt(p, '回放数据为空', 'err'); return; }
  p.term.write(`\x1b[36m── 回放 · ${events.length} 帧 ──\x1b[0m\r\n`);
  let i = 0;
  const speed = 3;
  const step = () => {
    if (i >= events.length || !p.term) {
      if (p.term && p.term.options) p.term.options.disableStdin = false;
      setSt(p, '回放完成', 'ok');
      return;
    }
    const ev = events[i];
    p.term.write(ev.d);
    i++;
    const next = events[i];
    const gap = next ? Math.max(0, Math.min((next.dt - ev.dt) / speed, 25)) : 0;
    setTimeout(step, gap);
  };
  step();
}

async function restartPane(p) {
  destroyPane(p);
  await startPane(p);
  updateLive();
}

// ═══ 启动 ═══
async function launchToSlot(cliId, cwd, slotIdx, args) {
  if (!cliList.find(c => c.id === cliId)) {
    return toast(`${cliId} 不可用（未安装或无终端界面）`, 'warn');
  }
  if (!args) {
    const running = slots.find(p => p && p.alive && p.cliId === cliId && cwd &&
                                     p.cwd && p.cwd.toLowerCase() === cwd.toLowerCase());
    if (running) {
      focusPane(running);
      return toast(`${cliLabel(cliId)} 已在窗格 ${running.slot + 1} 运行`, 'info', 2200);
    }
  }
  let idx = (slotIdx != null && slots[slotIdx] == null) ? slotIdx : slots.findIndex(s => s == null);
  if (idx === -1) {
    if (capacity < 6) {
      const next = CAP_NEXT[capacity];
      setCapacity(next);
      idx = slots.findIndex(s => s == null);
      toast(`宫格已满，已扩展至${next === 2 ? '双列' : next === 4 ? '四宫格' : '六宫格'}`, 'warn');
    } else {
      return toast('宫格已满（6/6）— 先结束一个窗格', 'err', 3800);
    }
  }
  const p = makePane(idx, cliId, cwd);
  p.args = args || null;
  slots[idx] = p;
  renderGrid();
  p.record = AGENT_CLIS.has(cliId);
  await startPane(p);
  focusPane(p);
  toast(`已在窗格 ${idx + 1} 打开 ${cliLabel(cliId)}${cwd ? ' · ' + baseName(cwd) : ''}${args ? '（恢复会话）' : ''}`, 'ok', 2600);
}

// ═══ picker ═══
function openPicker(anchor, cb, title) {
  const pk = $('#picker');
  pk.innerHTML = '';
  if (title) {
    const h = document.createElement('div');
    h.className = 'pt';
    h.textContent = title;
    pk.appendChild(h);
  }
  for (const c of cliList) {
    const it = document.createElement('div');
    it.className = 'it';
    it.innerHTML = `${brandIcon(c.id)}<span>${escapeHtml(c.label)}</span>`;
    it.onclick = () => { closePicker(); cb(c.id); };
    pk.appendChild(it);
  }
  const r = anchor.getBoundingClientRect();
  pk.hidden = false;
  const pw = pk.offsetWidth, ph = pk.offsetHeight;
  pk.style.left = Math.min(r.left, window.innerWidth - pw - 10) + 'px';
  pk.style.top = Math.min(r.bottom + 6, window.innerHeight - ph - 10) + 'px';
}
function closePicker() { $('#picker').hidden = true; }
document.addEventListener('mousedown', e => {
  const pk = $('#picker');
  if (!pk.hidden && !pk.contains(e.target)) closePicker();
});

// ═══ 窗格总览（Ctrl+Tab） ═══
let ovOpen = false, ovIdx = 0;
const fmtChars = n => !n ? '0' : n > 1e6 ? (n / 1e6).toFixed(1) + 'M' : n > 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const fmtDur = t => {
  if (!t) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h' + Math.floor((s % 3600) / 60) + 'm';
};
function lastLines(p) {
  if (!p.tail) return '';
  const lines = p.tail.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  return escapeHtml(lines.slice(-2).join('\n'));
}
function toggleOverview() { ovOpen ? closeOverview() : openOverview(); }
function openOverview() {
  const panes = slots.filter(Boolean);
  if (!panes.length) return toast('没有运行中的窗格', 'info');
  ovOpen = true;
  const cur = focused ? panes.indexOf(focused) : 0;
  ovIdx = cur >= 0 ? cur : 0;
  renderOverview();
  $('#overview').hidden = false;
}
function closeOverview() { ovOpen = false; $('#overview').hidden = true; }
function renderOverview() {
  const wrap = $('#ovWrap');
  const panes = slots.filter(Boolean);
  wrap.innerHTML = '';
  panes.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'ov-card' + (i === ovIdx ? ' on' : '') +
      (p.state === 'waiting' ? ' waiting' : p.state === 'working' ? ' working' : '');
    el.style.animationDelay = (i * 40) + 'ms';
    const stTxt = p.state === 'waiting' ? '待输入' : p.state === 'working' ? '工作中' : p.alive ? '运行中' : '已退出';
    el.innerHTML = `
      <div class="ov-head">
        <span class="chip">${brandIcon(p.cliId)}</span>
        <span class="nm">${escapeHtml(cliLabel(p.cliId))}${p.cwd ? ' · ' + escapeHtml(baseName(p.cwd)) : ''}</span>
        <span class="ov-state"><span class="dot"></span>${stTxt}</span>
      </div>
      <div class="ov-prev">${lastLines(p) || '<span class="dim">（无输出）</span>'}</div>
      <div class="ov-meta"><span>窗格 ${p.slot + 1}</span><span>${fmtChars(p.totalChars)}</span><span>${fmtDur(p.startedAt)}</span></div>`;
    el.onclick = () => { closeOverview(); if (maxed) unmax(); focusPane(p); };
    wrap.appendChild(el);
  });
}
$('#overview').addEventListener('mousedown', e => { if (e.target.id === 'overview') closeOverview(); });

// ═══ 广播模式 ═══
let bcOn = false;
function toggleBroadcast() {
  bcOn = !bcOn;
  document.body.classList.toggle('bc', bcOn);
  $('#dockBc').classList.toggle('on', bcOn);
  toast(bcOn ? '广播模式开启——输入将同步到所有运行中的窗格' : '广播模式关闭', bcOn ? 'warn' : 'info', 3000);
}
$('#dockBc').onclick = toggleBroadcast;

// ═══ 作战台 ═══
function renderOps() {
  const wrap = $('#ops');
  if (!wrap) return;
  const panes = slots.filter(Boolean);
  const waitings = panes.filter(p => p.alive && p.state === 'waiting');
  const workings = panes.filter(p => p.alive && p.state === 'working');
  const others = panes.filter(p => !waitings.includes(p) && !workings.includes(p));
  const ordered = [...waitings, ...workings, ...others];
  const opsN = $('#ops-n');
  if (opsN) opsN.textContent = ordered.length ? String(ordered.length) : '';
  wrap.innerHTML = '';
  if (!ordered.length) {
    wrap.innerHTML = '<div class="ops-empty">无运行中的窗格</div>';
    return;
  }
  for (const p of ordered) {
    const el = document.createElement('div');
    el.className = 'op' + (p.state === 'waiting' ? ' waiting' : p.state === 'working' ? ' working' : '');
    const stTxt = p.state === 'waiting' ? '待输入' : p.state === 'working' ? '工作中' : p.alive ? '运行中' : '已退出';
    el.innerHTML = `
      <span class="chip">${brandIcon(p.cliId)}</span>
      <div class="m">
        <div class="nm">${escapeHtml(cliLabel(p.cliId))}${p.cwd ? ' · ' + escapeHtml(baseName(p.cwd)) : ''}</div>
        <div class="sub">窗格 ${p.slot + 1} · ${fmtChars(p.totalChars)} · ${fmtDur(p.startedAt)}</div>
      </div>
      <div class="wst"><span class="dot"></span>${stTxt}</div>`;
    el.onclick = () => { if (maxed) unmax(); focusPane(p); };
    wrap.appendChild(el);
  }
}

// ═══ 类别 chips ═══
function renderCats() {
  const wrap = $('#cats');
  wrap.innerHTML = '';
  const ids = ['all', ...cliList.map(c => c.id)];
  if (projects.some(p => p.cli === 'dsh') && !ids.includes('dsh')) ids.push('dsh');
  for (const id of ids) {
    const n = id === 'all' ? projects.length
      : projects.filter(p => p.cli === id).length;
    if (id !== 'all' && !n) continue;
    const b = document.createElement('button');
    b.className = 'chip-c' + (catFilter === id ? ' on' : '');
    b.innerHTML = id === 'all'
      ? `全部<span class="n">${n}</span>`
      : `${brandIcon(id)}${escapeHtml(cliLabel(id))}<span class="n">${n}</span>`;
    b.onclick = () => { catFilter = id; renderCats(); renderProjs(); };
    wrap.appendChild(b);
  }
}

// ═══ 项目树 ═══
function relTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    const s = (now - t) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return hm;
  }
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return '昨天 ' + hm;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function buildSessions(raw) {
  const list = [];
  const seen = new Set();
  const push = (cli, cwd, t, title, recap, sid, n) => {
    if (!cwd) return;
    const key = cli + '|' + (sid || cwd + '@' + t);
    if (seen.has(key)) return;
    seen.add(key);
    list.push({cli, cwd, t: t || 0, title, recap, sid, n});
  };
  // omp：每会话一条（recap 即标题）
  for (const s of raw.omp || []) push('omp', s.cwd, s.t, null, s.recap, s.sid, s.n);
  // codex：每 rollout 一条（首条用户消息即标题）
  for (const s of raw.codex || []) push('codex', s.cwd, s.t, s.title, null, s.sid);
  // dsh：无标题可读，按目录记一条
  for (const s of raw.dsh || []) push('dsh', s.cwd, s.t, s.label, null, null);
  return list.sort((a, b) => b.t - a.t);
}
function renderProjs() {
  const wrap = $('#projs');
  wrap.innerHTML = '';
  const q = search.trim().toLowerCase();
  const list = projects.filter(p =>
    (catFilter === 'all' || p.cli === catFilter) &&
    (!q || (p.title || '').toLowerCase().includes(q) || (p.recap || '').toLowerCase().includes(q) || p.cwd.toLowerCase().includes(q)));
  const pjn = $('#pj-n'); if (pjn) pjn.textContent = list.length ? String(list.length) : '';
  if (!list.length) {
    wrap.innerHTML = '<div class="emptyl">暂无会话记录<br>开始干活后自动累计</div>';
    return;
  }
  // 日期分组：今天 / 昨天 / 更早
  const groups = [['今天', []], ['昨天', []], ['更早', []]];
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  for (const p of list) {
    const d = new Date(p.t);
    if (d.toDateString() === now.toDateString()) groups[0][1].push(p);
    else if (d.toDateString() === yest.toDateString()) groups[1][1].push(p);
    else groups[2][1].push(p);
  }
  const brRefs = [];
  for (const [gname, items] of groups) {
    if (!items.length) continue;
    const gh = document.createElement('div');
    gh.className = 'sess-g';
    gh.textContent = gname;
    wrap.appendChild(gh);
    for (const p of items.slice(0, 60)) {
      const title = p.recap || p.title || baseName(p.cwd);
      const el = document.createElement('div');
      el.className = 'sess';
      const resumable = p.sid && (p.cli === 'omp' || p.cli === 'codex');
      el.innerHTML = `
        <div class="t">${escapeHtml(title)}</div>
        <div class="m">${brandIcon(p.cli)}<span>${escapeHtml(cliLabel(p.cli))}</span><span class="dir">${escapeHtml(p.cwd)}</span>${p.n ? `<span class="nmsg">${p.n} 轮</span>` : ''}<span class="tm2">${relTime(p.t)}</span></div>
        <div class="acts">
          ${resumable ? `<button class="a-res" title="恢复该会话">${lu('archive-restore', 'ic')}恢复</button>` : ''}
          <button class="a-new" title="在该目录新开会话">${lu('plus', 'ic')}新开</button>
        </div>`;
      el.title = p.cwd;
      el.onclick = e => {
        const r = e.target.closest('.a-res'), n = e.target.closest('.a-new');
        if (r) {
          const args = p.cli === 'omp' ? ['--resume', p.sid] : ['resume', p.sid];
          return launchToSlot(p.cli, p.cwd, undefined, args);
        }
        if (n) return launchToSlot(p.cli, p.cwd);
        // 点击条目：有 sid 就恢复，否则新开
        if (resumable) {
          const args = p.cli === 'omp' ? ['--resume', p.sid] : ['resume', p.sid];
          return launchToSlot(p.cli, p.cwd, undefined, args);
        }
        launchToSlot(p.cli, p.cwd);
      };
      el.oncontextmenu = e => {
        e.preventDefault();
        window.harness.projectMenu({
          cwd: p.cwd,
          clis: [{cli: p.cli, label: cliLabel(p.cli), sid: p.sid}],
        }).then(r => {
          if (r === 'copy') toast('路径已复制', 'ok', 1800);
          if (r === 'open') toast('已在资源管理器中打开', 'ok', 1800);
        });
      };
      brRefs.push({cwd: p.cwd, el});
      wrap.appendChild(el);
    }
  }
  fillBranches(brRefs);
}
async function fillBranches(refs) {
  try {
    const cwds = [...new Set(refs.map(r => r.cwd))];
    const br = await window.harness.gitBranches(cwds);
    // 分支注入到该 cwd 的所有会话 meta 行
    for (const {cwd, el} of refs) {
      const b = br[cwd];
      if (!b || !el) continue;
      const m = el.querySelector('.m');
      if (m) {
        const span = document.createElement('span');
        span.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--t3)';
        span.textContent = '⑂ ' + b;
        m.appendChild(span);
      }
    }
  } catch {}
}
$('#q').addEventListener('input', e => { search = e.target.value; renderProjs(); });
// 侧栏分段标签
document.querySelectorAll('#sbTabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#sbTabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.sb-scroll .pnl').forEach(p => { p.hidden = p.dataset.t !== b.dataset.t; });
  localStorage.setItem('harness.sbtab', b.dataset.t);
});

// ═══ 额度圆环 ═══
function fmtReset(ts) {
  if (!ts) return '';
  const d = (ts - Date.now()) / 1000;
  if (d <= 0) return '即将重置';
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}
function windowShort(q) {
  const w = (q.window_label || q.label || q.limit_id || '').toLowerCase();
  if (/5[\s-]?h(our)?/.test(w)) return '5h';
  if (/week|7\s*d/.test(w)) return '周';
  if (/month|30\s*d/.test(w)) return '月';
  if (/balance|credit/.test(w)) return '余额';
  return (q.window_label || q.label || q.limit_id || '?').slice(0, 4);
}
function ringSvg(frac) {
  const off = frac == null;
  const pct = off ? 0 : Math.round(frac * 100);
  const cls = off ? 'off' : frac >= 0.85 ? 'crit' : frac >= 0.6 ? 'warn' : '';
  return `<svg class="ring ${cls}" viewBox="0 0 42 42">
    <circle class="bgc" cx="21" cy="21" r="15.9"/>
    <circle class="fgc" cx="21" cy="21" r="15.9" stroke-dasharray="${pct} 100" stroke-dashoffset="25"/>
    <text x="21" y="21.5">${off ? '—' : pct + '%'}</text>
  </svg>`;
}
const PROV_ALIAS = {commandcode: 'codex', 'kimi-code': 'kimi', 'opencode-go': 'opencode-go'};
const PROV_ICON = {codex: 'codex', kimi: 'kimi', 'opencode-go': 'opencode'};
const PROV_BRAND = {codex: 'Codex', kimi: 'Kimi', 'opencode-go': 'opencode'};
function renderQuota() {
  const wrap = $('#quota');
  wrap.innerHTML = '';
  if (!quotaItems.length) {
    wrap.innerHTML = '<div class="emptyl">暂无额度数据</div>';
    return;
  }
  const byProv = {};
  for (const q of quotaItems) (byProv[q.provider] ||= []).push(q);
  const provs = Object.entries(byProv);
  // pinned 优先
  provs.sort((a, b) => {
    const pa = quotaPinned.indexOf(PROV_ALIAS[a[0]] || a[0]);
    const pb = quotaPinned.indexOf(PROV_ALIAS[b[0]] || b[0]);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });
  for (const [prov, rows] of provs) {
    const alias = PROV_ALIAS[prov] || prov;
    const plan = quotaPlans[alias] || '';
    const brand = PROV_BRAND[alias] || prov;
    const iconId = PROV_ICON[alias];
    const withFrac = rows.filter(r => r.used_fraction != null);
    const bind = withFrac.sort((a, b) => b.used_fraction - a.used_fraction)[0];
    const frac = bind ? Math.max(0, Math.min(1, bind.used_fraction)) : null;
    const pct = frac == null ? null : Math.round(frac * 100);
    const cls = frac == null ? '' : frac >= 0.85 ? 'crit' : frac >= 0.6 ? 'warn' : '';
    const days = bind && bind.resets_at ? Math.max(0, (bind.resets_at - Date.now()) / 86400000) : null;
    const restTxt = days == null ? '' : days >= 1 ? `${days.toFixed(days < 2 ? 1 : 0)} 天剩余` : fmtReset(bind.resets_at) + '后重置';
    // 虚线段进度条（20 段）
    const filled = pct == null ? 0 : Math.round(pct / 5);
    const dashes = Array.from({length: 20}, (_, i) => `<i${i < filled ? ' class="f"' : ''}></i>`).join('');
    // 各窗口行
    const order = r => { const w = windowShort(r); return w === '5h' ? 0 : w === '周' ? 1 : w === '月' ? 2 : 3; };
    rows.sort((a, b) => order(a) - order(b));
    const winRows = rows.map(r => {
      const f = r.used_fraction == null ? null : Math.max(0, Math.min(1, r.used_fraction));
      const wcls = f == null ? '' : f >= 0.85 ? 'crit' : f >= 0.6 ? 'warn' : '';
      return `<div class="qw ${wcls}">
        <span class="lb">${windowShort(r)}</span>
        <span class="bar">${f == null ? '' : `<i style="width:${(f * 100).toFixed(0)}%"></i>`}</span>
        <span class="pc">${f == null ? '—' : (f * 100).toFixed(0) + '%'}</span>
        <span class="rs">${r.resets_at ? fmtReset(r.resets_at) + '后' : ''}</span>
      </div>`;
    }).join('');
    const el = document.createElement('div');
    el.className = 'qc' + (cls ? ' ' + cls : '') + (frac != null && frac >= 0.6 ? ' bad' : '');
    el.innerHTML = `
      <div class="qc-head">
        <span class="qc-icon">${iconId ? brandIcon(iconId) : lu('gauge')}</span>
        <span class="qc-name">${escapeHtml(brand)}${plan ? `<small>${escapeHtml(prov)} · ${escapeHtml(plan)}</small>` : `<small>${escapeHtml(prov)}</small>`}</span>
        ${frac != null && frac >= 0.6 ? '<span class="qc-badge">需要留意</span>' : ''}
      </div>
      <div class="qc-main">
        <span class="qc-pct ${cls}">${pct == null ? '—' : pct + '%'}</span>
        ${restTxt ? `<span class="qc-rest">${restTxt}</span>` : ''}
      </div>
      <div class="qc-dash">${dashes}</div>
      <div class="qc-wins">${winRows}</div>`;
    wrap.appendChild(el);
  }
}

// ═══ 命令面板 ═══
let palFiltered = [], palIdx = 0;
function palItems() {
  const it = [];
  for (const c of cliList) {
    it.push({ico: brandIcon(c.id), label: '打开 ' + c.label, sub: '新窗格', run: () => launchToSlot(c.id, null)});
  }
  for (const pj of projects.slice(0, 12)) {
    const label = (pj.recap || pj.title || baseName(pj.cwd)).slice(0, 30);
    it.push({ico: brandIcon(pj.cli), label, sub: pj.cwd, run: () => launchToSlot(pj.cli, pj.cwd)});
  }
  const LN = {1:'单窗', 2:'双列', 4:'四宫格', 6:'六宫格'};
  for (const n of [1, 2, 4, 6]) it.push({ico: lu(SEG_ICONS[n]), label: '布局：' + LN[n], sub: '', run: () => setCapacity(n)});
  it.push({ico: lu('x'), label: '清空聚焦窗格', sub: focused ? cliLabel(focused.cliId) : '', run: () => { if (focused) clearPane(focused); }});
  it.push({ico: lu('settings'), label: '设置…', sub: '字号与字体', run: openSettings});
  it.push({ico: lu('circle-help'), label: '快捷键帮助', sub: 'Ctrl+/', run: openHelp});
  it.push({ico: lu('folder-open'), label: '选择目录并启动…', sub: '原生目录选择', run: () => pickDirLaunch()});
  return it;
}
function renderPalette() {
  const q = $('#palQ').value.trim().toLowerCase();
  palFiltered = palItems().filter(i => !q || (i.label + ' ' + i.sub).toLowerCase().includes(q));
  palIdx = 0;
  const list = $('#palList');
  list.innerHTML = '';
  palFiltered.slice(0, 30).forEach((i, n) => {
    const el = document.createElement('div');
    el.className = 'pal-item' + (n === palIdx ? ' on' : '');
    el.innerHTML = `${i.ico}<span>${escapeHtml(i.label)}</span><span class="sb">${escapeHtml(i.sub)}</span>`;
    el.onmouseenter = () => { palIdx = n; renderPaletteSel(); };
    el.onclick = () => { closePalette(); i.run(); };
    list.appendChild(el);
  });
}
function renderPaletteSel() {
  $('#palList').querySelectorAll('.pal-item').forEach((el, n) => el.classList.toggle('on', n === palIdx));
}
function openPalette() {
  $('#palette').hidden = false;
  $('#palQ').value = '';
  renderPalette();
  $('#palQ').focus();
}
function closePalette() { $('#palette').hidden = true; }
function togglePalette() { $('#palette').hidden ? openPalette() : closePalette(); }

// ═══ help / settings ═══
function openHelp() { closeSettings(); $('#help').hidden = false; }
function closeHelp() { $('#help').hidden = true; }
function openSettings() {
  closeHelp();
  const st = $('#settings');
  st.hidden = false;
  renderSettingsUI();
  const r = $('#setBtn').getBoundingClientRect();
  st.style.top = Math.max(40, r.top - st.offsetHeight - 8) + 'px';
  st.style.left = Math.min(r.left - st.offsetWidth + r.width, window.innerWidth - st.offsetWidth - 10) + 'px';
}
function closeSettings() { $('#settings').hidden = true; }
function toggleSettings() { $('#settings').hidden ? openSettings() : closeSettings(); }

async function pickDirLaunch() {
  const dir = await window.harness.pickDir();
  if (!dir) return;
  openPicker($('#dockAdd'), cliId => launchToSlot(cliId, dir), '在所选目录启动： ' + baseName(dir));
}

// ═══ find ═══
function closeFind() {
  document.querySelectorAll('.find').forEach(f => { f.hidden = true; });
}
function wireFind(p) {
  const el = p.el.querySelector('.find');
  if (!el || el._wired) return;
  el._wired = true;
  const inp = el.querySelector('input');
  const run = (next = true, incremental = false) => {
    const q = inp.value;
    if (!q || !p.search) return;
    try { next ? p.search.findNext(q, {incremental}) : p.search.findPrevious(q, {incremental}); } catch {}
  };
  inp.addEventListener('input', () => run(true, true));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(!e.shiftKey); }
  });
  el.querySelector('.next').onclick = () => run(true);
  el.querySelector('.prev').onclick = () => run(false);
  el.querySelector('.cls').onclick = () => { el.hidden = true; if (p.term) p.term.focus(); };
}
function openFind() {
  const p = focused;
  if (!p || !p.search) return;
  const el = p.el.querySelector('.find');
  el.hidden = false;
  const inp = el.querySelector('input');
  inp.focus();
  inp.select();
}

// ═══ dock ═══
function toggleDock() {
  const off = !document.body.classList.contains('dockoff');
  document.body.classList.toggle('dockoff', off);
  $('#dockHandle').hidden = !off;
  localStorage.setItem('harness.dock', off ? '0' : '1');
}
$('#dockHandle').onclick = toggleDock;
$('#newPaneBtn').onclick = e => { e.stopPropagation(); openPicker(e.currentTarget, cliId => launchToSlot(cliId, null)); };
// 轨道 + Dock 按钮接线
$('#topSb').onclick = () => toggleSidebar();
$('#topOv').onclick = () => toggleOverview();
$('#dockAdd').onclick = e => {
  e.stopPropagation();
  openPicker(e.currentTarget, cliId => launchToSlot(cliId, null));
};
$('#helpBtn').onclick = () => ($('#help').hidden ? openHelp() : closeHelp());
$('#setBtn').onclick = e => { e.stopPropagation(); toggleSettings(); };
$('#sgFs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  SET.fs = Number(b.dataset.fs); applySettings();
});
$('#sgFf').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  SET.ff = b.dataset.ff; applySettings();
});

// ═══ keyboard ═══
document.addEventListener('keydown', e => {
  const k = (e.key || '').toLowerCase();
  // 总览层优先
  if (ovOpen) {
    const panes = slots.filter(Boolean);
    if (e.key === 'Escape') { e.preventDefault(); closeOverview(); }
    else if (e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); ovIdx = (ovIdx + 1) % panes.length; renderOverview(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); ovIdx = (ovIdx - 1 + panes.length) % panes.length; renderOverview(); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = panes[ovIdx]; if (p) { closeOverview(); if (maxed) unmax(); focusPane(p); } }
    return;
  }
  if (!$('#palette').hidden) return;
  if (e.ctrlKey && e.shiftKey && k === 'p') { e.preventDefault(); togglePalette(); }
  else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); toggleOverview(); }
  else if (e.ctrlKey && e.shiftKey && k === 'b') { e.preventDefault(); toggleSidebar(); }
  else if (e.ctrlKey && e.shiftKey && k === 'w') { e.preventDefault(); if (focused) clearPane(focused); }
  else if (e.ctrlKey && e.shiftKey && e.key === 'Enter') { e.preventDefault(); openPicker($('#dockAdd'), cliId => launchToSlot(cliId, null)); }
  else if (e.ctrlKey && !e.shiftKey && k === 'f') { e.preventDefault(); openFind(); }
  else if (e.ctrlKey && !e.shiftKey && k === 'd') { e.preventDefault(); toggleDock(); }
  else if (e.ctrlKey && !e.shiftKey && e.key === ',') { e.preventDefault(); toggleSettings(); }
  else if (e.ctrlKey && k === '/') { e.preventDefault(); $('#help').hidden ? openHelp() : closeHelp(); }
  else if (e.ctrlKey && !e.shiftKey && /^[1-6]$/.test(e.key)) {
    const p = slots[Number(e.key) - 1];
    if (p) { e.preventDefault(); if (maxed) unmax(); focusPane(p); }
  } else if (e.key === 'Escape') {
    closePalette(); closeHelp(); closeSettings(); closePicker(); closeFind(); closeOverview();
  }
}, true);
$('#palQ').addEventListener('input', renderPalette);
$('#palQ').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palFiltered.length - 1); renderPaletteSel(); scrollPalSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); renderPaletteSel(); scrollPalSel(); }
  else if (e.key === 'Enter') {
    const it = palFiltered[palIdx];
    if (it) { closePalette(); it.run(); }
  }
});
function scrollPalSel() {
  const el = $('#palList').querySelectorAll('.pal-item')[palIdx];
  if (el) el.scrollIntoView({block: 'nearest'});
}
$('#palette').addEventListener('mousedown', e => { if (e.target.id === 'palette') closePalette(); });
$('#help').addEventListener('mousedown', e => { if (e.target.id === 'help') closeHelp(); });
document.addEventListener('mousedown', e => {
  const st = $('#settings');
  if (!st.hidden && !st.contains(e.target) && !e.target.closest('#setBtn')) closeSettings();
});

// ═══ 图标注入到静态元素 ═══
function injectStaticIcons() {
  $('#topMark').innerHTML = lu('terminal', 'ic');
  $('#topSb').innerHTML = lu('panel-left-close');
  $('#topOv').innerHTML = lu('layers');
  $('#searchIco').innerHTML = lu('search', 'ic sm');
  $('#newPaneBtn').innerHTML = lu('plus', 'ic') + '<span>新建窗格</span>';
  $('#dockAdd').innerHTML = lu('plus');
  $('#dockBc').innerHTML = lu('radio-tower');
  $('#helpBtn').innerHTML = lu('circle-help');
  $('#setBtn').innerHTML = lu('settings');
  $('#dockHandle').innerHTML = lu('chevron-down', 'ic sm');
  segBtns.forEach(b => { b.innerHTML = lu(SEG_ICONS[Number(b.dataset.g)]); });
}

// ═══ 数据 ═══
async function loadSide() {
  try {
    const [raw, q] = await Promise.all([window.harness.listHistory(), window.harness.listQuota()]);
    projects = buildSessions(raw || {});
    quotaItems = q?.quota || [];
    quotaSeries = q?.series || {};
    quotaPlans = q?.plans || {};
    quotaPinned = q?.pinned || [];
    usageDaily = raw?.usageDaily || [];
    usageBySource = raw?.usageBySource || [];
  } catch {}
  renderCats(); renderProjs(); renderQuota(); renderQuotaAlerts(); renderUsage();
}

// ═══ 用量（Metera 数据） ═══
const fmtTok = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n);
function renderUsage() {
  const wrap = $('#usage');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!usageDaily.length && !usageBySource.length) {
    wrap.innerHTML = '<div class="emptyl">暂无用量数据</div>';
    return;
  }
  // 大数字：最近一天
  const last = usageDaily[usageDaily.length - 1];
  const total = usageBySource.reduce((a, b) => a + b.tokens, 0);
  const head = document.createElement('div');
  head.className = 'use-big';
  head.innerHTML = `<span class="v">${fmtTok(last ? last.tokens : total)}</span>
    <span class="lb">tokens · ${last ? last.day.slice(5) : '合计'}</span>`;
  wrap.appendChild(head);
  // 14 天柱图
  if (usageDaily.length) {
    const chart = document.createElement('div');
    chart.className = 'use-chart';
    const max = Math.max(...usageDaily.map(d => d.tokens), 1);
    usageDaily.forEach((d, i) => {
      const bar = document.createElement('i');
      bar.style.height = Math.max(4, (d.tokens / max) * 100) + '%';
      bar.title = `${d.day} · ${fmtTok(d.tokens)}`;
      if (i === usageDaily.length - 1) bar.className = 'last';
      chart.appendChild(bar);
    });
    wrap.appendChild(chart);
    const dates = document.createElement('div');
    dates.className = 'use-dates';
    dates.innerHTML = `<span>${usageDaily[0].day.slice(5)}</span><span>${last.day.slice(5)}</span>`;
    wrap.appendChild(dates);
  }
  // 按来源
  if (usageBySource.length) {
    const sec = document.createElement('div');
    sec.className = 'use-sec';
    sec.textContent = '按来源（累计）';
    wrap.appendChild(sec);
    const maxS = usageBySource[0].tokens;
    for (const r of usageBySource.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'use-src';
      row.innerHTML = `<span class="nm">${escapeHtml(r.source)}</span>
        <span class="bar"><i style="width:${(r.tokens / maxS * 100).toFixed(0)}%"></i></span>
        <span class="v">${fmtTok(r.tokens)}</span>`;
      wrap.appendChild(row);
    }
  }
}

// ═══ boot ═══
(async () => {
  if (window.harness.platform === 'darwin') document.body.classList.add('is-mac');
  injectStaticIcons();
  cliList = await window.harness.listClis();
  await loadSide();
  if (localStorage.getItem('harness.sboff') === '1') { document.body.classList.add('sboff'); $('#topSb').classList.remove('on'); }
  const savedTab = localStorage.getItem('harness.sbtab');
  if (savedTab) {
    const tb = document.querySelector(`#sbTabs button[data-t="${savedTab}"]`);
    if (tb) tb.click();
  }
  if (localStorage.getItem('harness.dock') === '0') {
    document.body.classList.add('dockoff');
    $('#dockHandle').hidden = false;
  }
  moveThumb(false);
  renderSettingsUI();
  setInterval(() => { if (!document.body.classList.contains('sboff')) loadSide(); }, 90000);
  const saved = Number(localStorage.getItem('harness.layout'));
  capacity = [1, 2, 4, 6].includes(saved) ? saved : 4;
  slots = new Array(capacity).fill(null);
  updateSeg(capacity);
  renderGrid();
  const boot = ['codex', 'omp', 'powershell'].filter(id => cliList.some(c => c.id === id));
  for (let i = 0; i < Math.min(boot.length, capacity); i++) {
    const p = makePane(i, boot[i], null);
    slots[i] = p;
  }
  renderGrid();
  for (let i = 0; i < Math.min(boot.length, capacity); i++) if (slots[i]) await startPane(slots[i]);
  if (slots[0]) focusPane(slots[0]);
  renderOps();
  // 启动动效
  grid.classList.add('scanning');
  setTimeout(() => grid.classList.remove('scanning'), 900);
  document.querySelectorAll('.pane,.slot').forEach((el, i) => {
    el.style.animationDelay = (i * 70) + 'ms';
    el.classList.add('bootin');
  });
  setTimeout(() => {
    document.querySelectorAll('.bootin').forEach(el => { el.classList.remove('bootin'); el.style.animationDelay = ''; });
  }, 1400);
  // 侧栏时钟 + HUD 时钟
  const bootT = Date.now();
  setInterval(() => {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const hhmmss = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const ck = $('#ftClock'), up = $('#ftUp'), hc = $('#hudClock');
    if (ck) ck.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (hc) hc.textContent = hhmmss;
    const s = Math.floor((Date.now() - bootT) / 1000);
    if (up) {
      up.textContent = s < 3600 ? `运行 ${Math.floor(s / 60)}m` : `运行 ${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
    }
    const ht = $('#hudT');
    if (ht) {
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      ht.textContent = `${mm}:${ss}`;
    }
  }, 1000);
})();
