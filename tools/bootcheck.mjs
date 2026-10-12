// One-off: install error hooks, reload page, report captured errors.
import http from 'http';
import net from 'net';
import crypto from 'crypto';

const httpGet = path => new Promise((res, rej) => {
  http.get({host: '127.0.0.1', port: 9222, path}, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
  }).on('error', rej);
});

class CDP {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.buf = Buffer.alloc(0); }
  async connect() {
    const u = new URL(this.url);
    this.sock = net.connect(Number(u.port), u.hostname);
    await new Promise(r => this.sock.once('connect', r));
    const key = crypto.randomBytes(16).toString('base64');
    this.sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await new Promise((resolve, reject) => {
      let acc = Buffer.alloc(0);
      const onData = chunk => {
        acc = Buffer.concat([acc, chunk]);
        const idx = acc.indexOf('\r\n\r\n');
        if (idx === -1) return;
        if (!/ 101 /.test(acc.slice(0, idx).toString())) return reject(new Error('handshake failed'));
        this.sock.off('data', onData);
        const rest = acc.slice(idx + 4);
        this.sock.on('data', d => this._parse(d));
        this.sock.on('error', () => {});
        if (rest.length) this._parse(rest);
        resolve();
      };
      this.sock.on('data', onData);
    });
  }
  _parse(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (b.length < off + len) return;
      const payload = b.slice(off, off + len);
      this.buf = b.slice(off + len);
      if (opcode >= 8) continue;
      if (opcode === 1 || opcode === 2) { this.frag = payload; }
      else if (opcode === 0 && this.frag) this.frag = Buffer.concat([this.frag, payload]);
      else continue;
      if (!fin || !this.frag) continue;
      const full = this.frag; this.frag = null;
      let msg; try { msg = JSON.parse(full.toString('utf8')); } catch { continue; }
      if (msg.id && this.pending.has(msg.id)) {
        const {resolve, reject} = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg);
      }
    }
  }
  _send(payload) {
    const data = Buffer.from(payload, 'utf8');
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this._send(JSON.stringify({id, method, params}));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')); } }, 20000);
    });
  }
  close() { try { this.sock.end(); } catch {} }
}

const targets = JSON.parse(await httpGet('/json'));
const page = targets.find(t => t.type === 'page');
const cdp = new CDP(page.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: `
  window.__errs = [];
  window.addEventListener('error', e => __errs.push((e.message||'')+' @'+(e.filename||'').split('/').pop()+':'+(e.lineno||0)));
  window.addEventListener('unhandledrejection', e => __errs.push('promise: '+((e.reason&&e.reason.message)||e.reason)));
`});
await cdp.send('Page.reload', {});
await new Promise(r => setTimeout(r, 9000));
const r = await cdp.send('Runtime.evaluate', {expression: 'JSON.stringify({errs: window.__errs, slots: (typeof slots!=="undefined"?slots.length:"?"), sessions: document.querySelectorAll(".sess").length})', returnByValue: true});
console.log(r.result?.result?.value);
cdp.close();
process.exit(0);
