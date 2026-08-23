// Does the debug panel render without throwing?
//
// It reads three dozen fields off half the client's state, and a typo in any
// one of them shows up nowhere except on the tablet, with the panel blank.
// Same approach as test/idle.js: lift the real function out of index.html and
// run it against stand-in state, so a copy cannot drift.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '..', 'web', 'index.html'), 'utf8');

const START = '  function dbgRow(k, v, cls) {';
const END = '  // Fast-moving fields already repaint';
const a = page.indexOf(START), b = page.indexOf(END);
if (a < 0 || b < 0) {
  console.error('[FAIL] blok paintDebug tidak ketemu di index.html — tes ini perlu diperbarui');
  process.exit(1);
}
const chunk = page.slice(a, b);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '[PASS] ' : '[FAIL] ') + m); };

// A DOM small enough to be obviously correct.
const box = { html: '', classList: { toggle() {}, contains: () => false } };
Object.defineProperty(box, 'innerHTML', { set(v) { box.html = v; }, get() { return box.html; } });
const el = (id) => (id === 'debug' ? box : { classList: { contains: () => false } });

const win = {
  innerWidth: 1280, innerHeight: 676, devicePixelRatio: 2, isSecureContext: true,
  matchMedia: () => ({ matches: false })
};
const doc = { fullscreenElement: null };

function render(state) {
  const build = new Function(
    'el', 'cfg', 'activeId', 'conns', 'activeHost', 'STATE_LABEL', 'hosts',
    'lastInputAt', 'ACTIVE_WINDOW', 'IDLE_PING', 'sentRate', 'sentTotal',
    'minSendGap', 'flushing', 'pointers', 'gestureMax', 'mode', 'dragging',
    'gx', 'gy', 'gestureFired', 'lastGesture', 'accX', 'accY', 'accSX', 'accSY',
    'activePage', 'AUTO', 'NO_PAGE', 'deckPages', 'autoPage', 'frontApp',
    'wakeLock', 'audio', 'holdTimer', 'layout', 'LAYOUT_LABEL',
    'edgeSide', 'edgePush', 'EDGE_PUSH', 'edgeReports', 'EDGE_REPORTS',
    'window', 'document',
    chunk + '\n return paintDebug();'
  );
  return build(
    el, state.cfg, state.activeId, state.conns, state.activeHost, state.STATE_LABEL,
    state.hosts, state.lastInputAt, 4000, 2000, state.sentRate, state.sentTotal,
    state.minSendGap, state.flushing, state.pointers, state.gestureMax, state.mode,
    state.dragging, state.gx, state.gy, state.gestureFired, state.lastGesture,
    state.accX, state.accY, state.accSX, state.accSY, state.activePage, -2, -1,
    state.deckPages, state.autoPage, state.frontApp, state.wakeLock, state.audio,
    null, state.layout, { pad: 'trackpad saja', both: 'keyboard atas + trackpad bawah',
      swap: 'trackpad atas + keyboard bawah', kb: 'keyboard saja' },
    state.edgeSide, state.edgePush, 90, state.edgeReports, 2,
    win, doc
  );
}

const base = {
  cfg: { debug: true, keepalive: 120 },
  activeId: null, conns: {}, hosts: [], activeHost: () => null,
  STATE_LABEL: { on: 'terhubung', connecting: 'menyambung', off: 'putus', rejected: 'perlu dipasangkan' },
  lastInputAt: 0, sentRate: 0, sentTotal: 0, minSendGap: 16.7, flushing: false,
  pointers: new Set(), gestureMax: 0, mode: null, dragging: false,
  gx: 0, gy: 0, gestureFired: false, lastGesture: '',
  accX: 0, accY: 0, accSX: 0, accSY: 0,
  activePage: 0, deckPages: [], autoPage: 0, frontApp: '', wakeLock: null, audio: null,
  layout: 'both', edgeSide: null, edgePush: 0, edgeReports: 0
};

// 1. Cold start: nothing paired, nothing connected. The panel that only works
//    once everything is fine is the one you cannot use to find out why it isn't.
try {
  box.html = '';
  render(base);
  ok(box.html.includes('koneksi') && box.html.includes('belum ada sampel'),
     'kondisi kosong (belum ada host) tetap tergambar, tidak melempar');
} catch (e) { ok(false, 'kondisi kosong melempar: ' + e.message); }

// 2. Connected, with latency samples, a deck, and a Mac in front.
const live = Object.assign({}, base, {
  activeId: 'm1',
  conns: { m1: { state: 'on', trusted: true, rtts: [8, 12, 9, 40, 11], refreshHz: 120 } },
  hosts: [{ id: 'm1', name: 'Mac mini', url: '192.168.1.50:8778', secure: true },
          { id: 'm2', name: 'MacBook', url: '192.168.1.51:8777', secure: false }],
  activeHost: () => ({ id: 'm1', name: 'Mac mini', url: '192.168.1.50:8778', secure: true }),
  lastInputAt: Date.now(), sentRate: 88, sentTotal: 4210, minSendGap: 8.3, flushing: true,
  deckPages: [{ name: 'Umum' }, { name: 'Media' }, { name: 'Xcode' }],
  activePage: -2, autoPage: 2, frontApp: 'Xcode',
  wakeLock: {}, audio: { state: 'running' }
});
try {
  box.html = '';
  render(live);
  const want = ['Mac mini', 'wss (tls)', 'terhubung', 'trusted', 'p50 / p95',
                '120 Hz', 'Auto → Xcode', 'Xcode', '88 f/s', 'JALAN', 'dipegang',
                'keyboard atas + trackpad bawah'];
  const missing = want.filter((w) => !box.html.includes(w));
  ok(missing.length === 0, 'kondisi hidup menampilkan semua field' + (missing.length ? ' — hilang: ' + missing.join(', ') : ''));
  ok(box.html.includes('120 ms · aktif'), 'ping dilaporkan mode aktif saat baru ada input');
} catch (e) { ok(false, 'kondisi hidup melempar: ' + e.message); }

// 3. Idle long enough that the ping should have backed off.
try {
  box.html = '';
  render(Object.assign({}, live, { lastInputAt: Date.now() - 60000 }));
  ok(box.html.includes('2000 ms · idle'), 'ping dilaporkan mundur ke idle setelah sepi');
} catch (e) { ok(false, 'kondisi idle melempar: ' + e.message); }

// 4. Mid-gesture: the state this panel exists to explain.
try {
  box.html = '';
  render(Object.assign({}, live, {
    pointers: new Set([1, 2, 3]), gestureMax: 3, mode: 'gesture',
    gx: -72, gy: 4, gestureFired: true, lastGesture: 'desktop sebelumnya',
    accX: 0.42, accY: -0.13
  }));
  ok(box.html.includes('ambang 55') && box.html.includes('KIRIM')
     && box.html.includes('desktop sebelumnya'),
     'gestur 3 jari: jarak, ambang, penanda kirim, dan gestur terakhir muncul');
  ok(box.html.includes('0.42'), 'sisa sub-piksel ikut dilaporkan');
} catch (e) { ok(false, 'kondisi gestur melempar: ' + e.message); }

// 5. Off means off: no markup at all, whatever the rest of the state says.
try {
  box.html = 'sisa lama';
  render(Object.assign({}, live, { cfg: { debug: false, keepalive: 120 } }));
  ok(box.html === 'sisa lama', 'debug mati: panel tidak digambar sama sekali');
} catch (e) { ok(false, 'kondisi mati melempar: ' + e.message); }

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
