// agent-harness main process: grid of real PTY terminals + sidebar data sources.
const {app, BrowserWindow, ipcMain, Menu} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {spawn, spawnSync} = require('child_process');
const {dialog, shell, clipboard} = require('electron');
const pty = require('node-pty');

let win = null;
const ptys = new Map();   // paneId -> pty process
const isWin = process.platform === 'win32';

// ---------- CLI detection ----------
const EXTRA_BIN_DIRS = isWin ? [] : [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.kimi-code', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
];
function runWhere(name) {
  try {
    const r = spawnSync(isWin ? 'where' : 'which', [name], {encoding: 'utf8', timeout: 3000, windowsHide: true});
    if (r.status === 0) return r.stdout.split(/\r?\n/).filter(Boolean)[0];
  } catch {}
  for (const d of EXTRA_BIN_DIRS) {
    const p = path.join(d, name);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

// Note: dsh has no terminal TUI (only `web` / one-shot `headless`), so it is not
// offered as a pane CLI. Its on-disk sessions still appear in project history.
function detectClis() {
  const candidates = isWin ? [
    // codex needs --no-daemon when many instances run side-by-side
    {id: 'codex', label: 'Codex', cmd: 'codex.exe', args: ['--no-daemon']},
    {id: 'omp', label: 'omp', cmd: 'omp.exe', args: []},
    {id: 'kimi', label: 'Kimi', cmd: 'kimi.exe', args: []},
    {id: 'opencode', label: 'opencode', cmd: 'opencode.exe', args: []},
    {id: 'powershell', label: 'PowerShell', cmd: 'powershell.exe', args: []},
    {id: 'cmd', label: 'cmd', cmd: 'cmd.exe', args: []},
  ] : process.platform === 'darwin' ? [
    {id: 'codex', label: 'Codex', cmd: 'codex', args: ['--no-daemon']},
    {id: 'omp', label: 'omp', cmd: 'omp', args: []},
    {id: 'kimi', label: 'Kimi', cmd: 'kimi', args: []},
    {id: 'opencode', label: 'opencode', cmd: 'opencode', args: []},
    {id: 'zsh', label: 'zsh', cmd: 'zsh', args: []},
    {id: 'bash', label: 'bash', cmd: 'bash', args: []},
  ] : [
    {id: 'codex', label: 'Codex', cmd: 'codex', args: ['--no-daemon']},
    {id: 'omp', label: 'omp', cmd: 'omp', args: []},
    {id: 'kimi', label: 'Kimi', cmd: 'kimi', args: []},
    {id: 'opencode', label: 'opencode', cmd: 'opencode', args: []},
    {id: 'bash', label: 'bash', cmd: 'bash', args: []},
  ];
  const out = [];
  for (const c of candidates) {
    const abs = runWhere(c.cmd);
    if (abs) out.push({...c, cmd: abs});
  }
  return out;
}

// ---------- codex update-prompt fix (auto-heal) ----------
function healCodexConfig() {
  try {
    const p = path.join(os.homedir(), '.codex', 'config.toml');
    if (!fs.existsSync(p)) return;
    const t = fs.readFileSync(p, 'utf8');
    if (/^\s*check_for_update_on_startup\s*=/m.test(t)) return;
    fs.writeFileSync(p, 'check_for_update_on_startup = false\n' + t);
  } catch {}
}

// ---------- 会话录制 ----------
function recDir() {
  const d = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(d, {recursive: true});
  return d;
}
function pruneRecordings() {
  try {
    const files = fs.readdirSync(recDir()).filter(f => f.endsWith('.jsonl'))
      .map(f => ({f, mtime: fs.statSync(path.join(recDir(), f)).mtimeMs}))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(24)) {
      try { fs.unlinkSync(path.join(recDir(), old.f)); } catch {}
    }
  } catch {}
}

// ---------- pty ----------
function createPty(paneId, cliId, cmd, args, cwd, record, cols, rows) {
  if (ptys.has(paneId)) return {error: 'already running'};
  const needsShell = isWin && /\.(cmd|bat)$/i.test(cmd);
  const shell = needsShell ? 'cmd.exe' : cmd;
  const shellArgs = needsShell ? ['/c', cmd, ...(args || [])] : (args || []);
  const workdir = (cwd && fs.existsSync(cwd)) ? cwd : (isWin ? 'D:\\omp' : os.homedir());
  let p;
  try {
    p = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80, rows: rows || 24,
      cwd: workdir,
      env: {...process.env, TERM: 'xterm-256color',
        PATH: isWin ? process.env.PATH : (process.env.PATH || '') + ':' + EXTRA_BIN_DIRS.join(':')},
    });
  } catch (e) {
    return {error: e.message};
  }
  ptys.set(paneId, p);
  // 录制输出流（回放用）
  let recStream = null, recBytes = 0;
  const t0 = Date.now();
  try {
    pruneRecordings();
    const rf = path.join(recDir(), `rec-${t0}-${paneId}.jsonl`);
    recStream = fs.createWriteStream(rf);
    recStream.write(JSON.stringify({meta: {cli: cliId, cwd: workdir, t0}}) + '\n');
    p._recFile = rf;
  } catch {}
  p.onData(d => {
    win?.webContents.send('pty:data', paneId, d);
    if (recStream && recBytes < 2 * 1024 * 1024) {
      recBytes += d.length;
      recStream.write(JSON.stringify({dt: Date.now() - t0, d}) + '\n');
    }
  });
  p.onExit(({exitCode}) => {
    if (recStream) { try { recStream.end(); } catch {} }
    // ignore stale exits: the pane may already host a newer pty (restart race)
    if (ptys.get(paneId) !== p) return;
    ptys.delete(paneId);
    win?.webContents.send('pty:exit', paneId, exitCode);
  });
  if (record) logSpawn(cliId, workdir);
  return {ok: true, cwd: workdir};
}

function killPty(paneId) {
  const p = ptys.get(paneId);
  if (p) { try { p.kill(); } catch {} ptys.delete(paneId); }
}

// ---------- spawn log (self-recorded project history) ----------
function spawnLogFile() { return path.join(app.getPath('userData'), 'spawn-log.json'); }
function logSpawn(cli, cwd) {
  try {
    const f = spawnLogFile();
    let arr = [];
    if (fs.existsSync(f)) arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    const AGENT = ['codex', 'omp', 'kimi', 'dsh', 'opencode'];
    arr = arr.filter(x => AGENT.includes(x.cli));   // shells never enter project history
    if (!AGENT.includes(cli)) return;
    arr = arr.filter(x => !(x.cli === cli && x.cwd === cwd));
    arr.unshift({cli, cwd, t: Date.now()});
    fs.writeFileSync(f, JSON.stringify(arr.slice(0, 200)));
  } catch {}
}
function readSpawnLog() {
  try { return JSON.parse(fs.readFileSync(spawnLogFile(), 'utf8')); } catch { return []; }
}

// ---------- codex sessions (rollout jsonl: cwd in first line) ----------
function codexSessions() {
  const out = [];
  try {
    const root = path.join(os.homedir(), '.codex', 'sessions');
    const walk = (dir, depth) => {
      if (depth > 4) return;
      let entries;
      try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        if (!e.name.endsWith('.jsonl')) continue;
        try {
          const fd = fs.openSync(p, 'r');
          const buf = Buffer.alloc(8192);
          const n = fs.readSync(fd, buf, 0, 8192, 0);
          fs.closeSync(fd);
          const head = buf.toString('utf8', 0, n);
          const cwdM = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          const tsM = head.match(/"timestamp"\s*:\s*"([^"]+)"/);
          if (!cwdM) continue;
          const cwd = JSON.parse('"' + cwdM[1] + '"');
          const t = tsM ? Date.parse(tsM[1]) : fs.statSync(p).mtimeMs;
          const sidM = e.name.match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
          // 首条真实用户消息作为会话标题（跳过 <app-context> 等注入内容）
          let title = null;
          try {
            const fd2 = fs.openSync(p, 'r');
            const buf2 = Buffer.alloc(262144);
            const n2 = fs.readSync(fd2, buf2, 0, 262144, 0);
            fs.closeSync(fd2);
            for (const line of buf2.toString('utf8', 0, n2).split('\n')) {
              if (!line.includes('"role":"user"')) continue;
              try {
                const j2 = JSON.parse(line);
                const pl2 = j2.payload || {};
                if (pl2.type !== 'message' || pl2.role !== 'user') continue;
                const c = pl2.content;
                let text = Array.isArray(c) ? (c.find(x => x && x.text)?.text || '') : (typeof c === 'string' ? c : '');
                text = String(text).trim();
                if (text && !text.startsWith('<')) { title = text.slice(0, 120); break; }
              } catch {}
            }
          } catch {}
          out.push({cli: 'codex', cwd, t, sid: sidM ? sidM[1] : null, title});
        } catch {}
      }
    };
    walk(root, 0);
  } catch {}
  return out;
}

// ---------- dsh sessions (encoded dir name; zstd body, not parsed) ----------
function dshSessions() {
  const out = [];
  try {
    const root = path.join(os.homedir(), '.dsh', 'sessions');
    for (const e of fs.readdirSync(root, {withFileTypes: true})) {
      if (!e.isDirectory()) continue;
      const p = path.join(root, e.name);
      const st = fs.statSync(p);
      let s = e.name.replace(/^--/, '').replace(/-+$/, '');
      s = s.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const label = s.split(/_?\d{4}-\d{2}-\d{2}/)[0];
      let cwd = null;
      const c1 = label.replace(/_/g, '\\').replace(/^([A-Za-z])-/, (m, d) => d + ':\\');
      const c2 = c1.replace(/-/g, '\\');
      for (const c of [c1, c2]) { if (c && fs.existsSync(c)) { cwd = c; break; } }
      out.push({cli: 'dsh', cwd, label: label || e.name, t: st.mtimeMs});
    }
  } catch {}
  return out;
}

// ---------- omp sqlite data via python (WAL-safe) ----------
const PY = isWin ? 'python' : 'python3';
const PY_SCRIPT = `
import sqlite3, json, sys, os.path
import time
out = {"sessions": [], "quota": [], "series": {}}
try:
    h = sqlite3.connect(sys.argv[1])
    rows = h.execute("select cwd, session_id, max(created_at) t, count(*) n from history group by cwd, session_id").fetchall()
    rec = {}
    for sid, recap, ca in h.execute("select session_id, recap, created_at from session_recaps order by created_at"):
        rec[sid] = recap
    for cwd, sid, t, n in rows:
        out["sessions"].append({"cwd": cwd, "t": (t or 0) * 1000, "sid": sid, "recap": rec.get(sid), "n": n})
except Exception as e:
    out["err1"] = str(e)
try:
    a = sqlite3.connect(sys.argv[2])
    a.row_factory = sqlite3.Row
    sql = """select u.provider, u.limit_id, u.label, u.window_label, u.used_fraction, u.resets_at, u.recorded_at
             from usage_history u
             join (select provider, limit_id, max(recorded_at) m from usage_history group by provider, limit_id) t
             on u.provider = t.provider and u.limit_id = t.limit_id and u.recorded_at = t.m
             order by u.provider, u.limit_id"""
    for r in a.execute(sql):
        out["quota"].append({k: r[k] for k in ("provider", "limit_id", "label", "window_label", "used_fraction", "resets_at", "recorded_at")})
except Exception as e:
    out["err2"] = str(e)
try:
    cutoff = int(time.time() * 1000) - 48 * 3600 * 1000
    ser = {}
    for prov, lid, t, f in a.execute("select provider, limit_id, recorded_at, used_fraction from usage_history where used_fraction is not null and recorded_at >= ? order by recorded_at", (cutoff,)):
        ser.setdefault(prov + "|" + lid, []).append([t, round(f, 4)])
    for k, v in ser.items():
        step = max(1, len(v) // 40)
        out["series"][k] = v[::step][-40:]
except Exception as e:
    out["err3"] = str(e)
# metera 用量：近7天每日总量 + 按来源汇总
try:
    mpath = r"D:\\MeteraData\\metera.db"
    if os.path.exists(mpath):
        m = sqlite3.connect(mpath)
        daily = m.execute("select substr(bucket_start,1,10) d, sum(total_tokens) t from usage_buckets group by d order by d desc limit 14").fetchall()
        daily.reverse()
        out["usageDaily"] = [{"day": d, "tokens": t} for d, t in daily]
        bysrc = m.execute("select source, sum(total_tokens) t from usage_buckets group by source order by t desc").fetchall()
        out["usageBySource"] = [{"source": s, "tokens": t} for s, t in bysrc]
except Exception as e:
    out["err4"] = str(e)
print(json.dumps(out))
`;

function readOmpData() {
  return new Promise(resolve => {
    const histDb = path.join(os.homedir(), '.omp', 'agent', 'history.db');
    const agentDb = path.join(os.homedir(), '.omp', 'agent', 'agent.db');
    if (!fs.existsSync(histDb) && !fs.existsSync(agentDb)) return resolve(null);
    let child;
    try {
      child = spawn(PY, ['-c', PY_SCRIPT, histDb, agentDb], {windowsHide: true});
    } catch { return resolve(null); }
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(null); }, 15000);
    child.stdout.on('data', d => out += d);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

let ompCache = {t: 0, v: undefined, inflight: null};
function readOmpDataCached() {
  if (ompCache.v !== undefined && Date.now() - ompCache.t < 30000) return Promise.resolve(ompCache.v);
  if (ompCache.inflight) return ompCache.inflight;
  ompCache.inflight = readOmpData().then(v => {
    ompCache = {t: Date.now(), v, inflight: null};
    return v;
  });
  return ompCache.inflight;
}

// ---------- window ----------
function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1560, height: 940,
    backgroundColor: '#121214',
    autoHideMenuBar: true,
    ...(isMac
      ? {titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 14, y: 12}}
      : {titleBarStyle: 'hidden',
         titleBarOverlay: {color: '#121214', symbolColor: '#c6cad2', height: 38}}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  try { require('electron').nativeTheme.themeSource = 'dark'; } catch {}
  healCodexConfig();
  createWindow();
  // macOS 需要保留应用菜单（Cmd+Q 等系统行为）；Windows/Linux 隐藏
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  ipcMain.handle('clis:list', () => detectClis());
  ipcMain.handle('pick:dir', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择项目目录',
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('pty:create', (e, paneId, cliId, cmd, args, cwd, record, cols, rows) => createPty(paneId, cliId, cmd, args, cwd, record, cols, rows));
  ipcMain.on('pty:input', (e, paneId, data) => ptys.get(paneId)?.write(data));
  ipcMain.on('pty:resize', (e, paneId, cols, rows) => {
    const p = ptys.get(paneId);
    if (p) { try { p.resize(cols, rows); } catch {} }
  });
  ipcMain.on('pty:kill', (e, paneId) => killPty(paneId));

  ipcMain.handle('rec:list', () => {
    try {
      return fs.readdirSync(recDir()).filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const p2 = path.join(recDir(), f);
          const st = fs.statSync(p2);
          let meta = null;
          try {
            const fd = fs.openSync(p2, 'r');
            const buf = Buffer.alloc(4096);
            const n = fs.readSync(fd, buf, 0, 4096, 0);
            fs.closeSync(fd);
            meta = JSON.parse(buf.toString('utf8', 0, n).split('\n')[0]).meta;
          } catch {}
          return {file: f, size: st.size, mtime: st.mtimeMs, ...meta};
        })
        .sort((a, b) => b.mtime - a.mtime).slice(0, 24);
    } catch { return []; }
  });
  ipcMain.handle('rec:read', (e, file) => {
    try {
      const p2 = path.join(recDir(), path.basename(file));
      const st = fs.statSync(p2);
      const cap = Math.min(st.size, 512 * 1024);
      const fd = fs.openSync(p2, 'r');
      const buf = Buffer.alloc(cap);
      fs.readSync(fd, buf, 0, cap, 0);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch { return null; }
  });
  ipcMain.handle('hist:list', async () => {
    const omp = await readOmpDataCached();
    return {
      codex: codexSessions(),
      dsh: dshSessions(),
      omp: omp?.sessions || [],
      spawns: readSpawnLog(),
      usageDaily: omp?.usageDaily || [],
      usageBySource: omp?.usageBySource || [],
    };
  });
  ipcMain.handle('quota:list', async () => {
    const omp = await readOmpDataCached();
    let plans = {}, pinned = [];
    try {
      const ms = JSON.parse(fs.readFileSync('D:\\MeteraData\\settings.json', 'utf8'));
      plans = ms.planOverrides || {};
      pinned = ms.pinnedQuotaProviders || [];
    } catch {}
    return {quota: omp?.quota || [], series: omp?.series || {}, plans, pinned};
  });

  ipcMain.handle('git:branches', (e, cwds) => {
    const out = {};
    for (const c of (cwds || []).slice(0, 60)) {
      try {
        const head = fs.readFileSync(path.join(c, '.git', 'HEAD'), 'utf8').trim();
        const m = head.match(/ref:\s*refs\/heads\/(.+)/);
        out[c] = m ? m[1] : head.slice(0, 7);
      } catch { out[c] = null; }
    }
    return out;
  });

  ipcMain.handle('menu:project', (e, payload) => new Promise(resolve => {
    const {cwd, clis} = payload || {};
    if (!cwd) return resolve(null);
    const template = [
      {label: '在资源管理器中打开', click: () => { shell.openPath(cwd); resolve('open'); }},
      {label: '复制路径', click: () => { clipboard.writeText(cwd); resolve('copy'); }},
    ];
    const resumable = (clis || []).filter(c => c.sid && (c.cli === 'omp' || c.cli === 'codex'));
    if (resumable.length) {
      template.push({type: 'separator'});
      for (const c of resumable) {
        template.push({
          label: `恢复最近的 ${c.cli === 'omp' ? 'omp' : 'Codex'} 会话`,
          click: () => { win?.webContents.send('menu:launch', {cli: c.cli, cwd, sid: c.sid}); resolve('resume'); },
        });
      }
    }
    if ((clis || []).length) {
      template.push({type: 'separator'});
      for (const c of clis) {
        if (c.cli === 'dsh') continue;
        template.push({
          label: `打开 ${c.label}`,
          click: () => { win?.webContents.send('menu:launch', {cli: c.cli, cwd}); resolve('launch'); },
        });
      }
    }
    const menu = Menu.buildFromTemplate(template);
    menu.popup({window: win, callback: () => resolve(null)});
  }));
});

app.on('window-all-closed', () => { app.quit(); });
