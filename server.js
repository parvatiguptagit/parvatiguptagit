const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const W = require('./world.js');   // the multi-floor structures, shared with the browser

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const TAG_RANGE = 18; // a little looser than the client's 15 to forgive lag
const MAP = 30;
const TICK = 0.066;  // seconds per server tick (~15 Hz)
const RESULT_SECONDS = 7;   // how long the results screen stays up
const nowSec = () => Date.now() / 1000;   // lifts are animated from the wall clock so everyone sees them in the same place

// one entry per theme: which building it uses and which surprises ("twists") happen during the seek phase
const THEMES = [
  { layout: 'glass', twists: [{ kind: 'dim', label: 'POWER CUT', sub: 'The lights went out! Everyone is harder to spot.', dur: 9, dark: true, every: [28, 40] }] },
  { layout: 'mushroom', twists: [{ kind: 'dim', label: 'MIST ROLLS IN', sub: 'Thick mist drifts through the forest. Visibility is low.', dur: 12, dark: false, every: [28, 40] }] },
  { layout: 'ruins', twists: [{ kind: 'sonar', label: 'WHALE SONG', sub: 'A deep song echoes. Every hider is revealed for a moment!', every: [30, 45] }] },
  { layout: 'manor', haunt: true, twists: [] },
  { layout: 'graveyard', haunt: true, twists: [{ kind: 'dim', label: 'GRAVEYARD FOG', sub: 'Green fog rises from the graves.', dur: 11, dark: false, every: [40, 55] }] },
  { layout: 'forest', twists: [{ kind: 'dim', label: 'MORNING FOG', sub: 'Fog drifts between the trees. Visibility is low.', dur: 12, dark: false, every: [30, 42] }] },
  { layout: 'house', twists: [{ kind: 'dim', label: 'BLACKOUT', sub: 'A fuse blew and the lights went out! Everyone is harder to spot.', dur: 9, dark: true, every: [28, 40] }] },
  { layout: 'office', twists: [{ kind: 'sonar', label: 'FIRE ALARM', sub: 'The alarm sounds and everyone runs! Every hider is revealed for a moment.', every: [30, 45] }] }
];

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } else if (url === '/world.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(path.join(__dirname, 'world.js')));
  } else if (/^\/avatars\/[a-z0-9]{2,4}\.jpg$/.test(url) && fs.existsSync(path.join(__dirname, url))) {   // the profile pictures
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.end(fs.readFileSync(path.join(__dirname, url)));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});
const wss = new WebSocketServer({ server });

const rooms = new Map();
let nextId = 1;

// set by online.js (or PUBLIC_URL) when the game is reachable from the internet, e.g. through a tunnel
const hostedUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;   // Render sets RENDER_EXTERNAL_URL by itself
let publicUrl = hostedUrl ? hostedUrl.replace(/\/+$/, '') : null;

// this PC's network addresses, real LAN first (virtual adapters like WSL/Hyper-V usually sit in 172.x)
function lanIps() {
  const out = [];
  for (const list of Object.values(require('os').networkInterfaces()))
    for (const n of list) if ((n.family === 'IPv4' || n.family === 4) && !n.internal) out.push(n.address);
  const rank = a => a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2;
  return out.sort((a, b) => rank(a) - rank(b));
}

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
function broadcast(room, o) {
  const s = JSON.stringify(o);
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}
function roomInfo(room) {
  return {
    t: 'room', code: room.code, phase: room.phase, host: room.host, theme: room.theme,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, pic: p.pic }))
  };
}
// profile pictures 0-3 are the boys, 4-11 the girls (same order as PROFILES in index.html); the picture decides the character's look
const PICS = 12, genderOf = pic => pic < 4 ? 'boy' : 'girl';
// everyone in the current round: humans plus computer players
const everyone = room => [...room.players.values(), ...room.bots.values()].filter(p => p.inRound);
const count = (room, role) => everyone(room).filter(p => p.role === role).length;
const rand = (a, b) => a + Math.random() * (b - a);
const TWIST_SCALE = +process.env.TWIST_SCALE || 1;   // test helper: 0.1 makes surprises ten times more frequent

// ================= ground scenery (mirrors buildWorld() in index.html) =================
// Must consume rng() in exactly the same order as the client so bots see the same obstacles.
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function genObstacles(seed, L) {
  const r = rng(seed), t = 1;
  const obs = [
    { x: 0, z: -MAP - t, hw: MAP + t, hd: t }, { x: 0, z: MAP + t, hw: MAP + t, hd: t },
    { x: -MAP - t, z: 0, hw: t, hd: MAP + t }, { x: MAP + t, z: 0, hw: t, hd: MAP + t }
  ];
  let placed = 0, tries = 0;
  while (placed < 46 && tries++ < 1200) {
    const x = (r() * 2 - 1) * (MAP - 4), z = (r() * 2 - 1) * (MAP - 4);
    if (Math.hypot(x, z) < 7 || L.inZone(x, z)) continue;   // clear spawn area, and keep the structure free of clutter
    const kind = r() < 0.4 ? 'tree' : r() < 0.5 ? 'crate' : 'stone';
    const hw = kind === 'tree' ? 0.45 : 0.8 + r() * 2, hd = kind === 'tree' ? 0.45 : 0.8 + r() * 2;
    r(); // height
    if (obs.some(o => Math.abs(o.x - x) < o.hw + hw + 2.5 && Math.abs(o.z - z) < o.hd + hd + 2.5)) continue;
    if (kind === 'tree') { r(); r(); r(); } else r(); // tree height + 2 leaf colours / box tint
    obs.push({ x, z, hw, hd });
    placed++;
  }
  return obs;
}
// obstacles without y0/h are full height (ground clutter); the structure's pieces have a vertical extent
function collides(obs, x, z, rad, feet = 0) {
  for (const o of obs) {
    if (o.y0 !== undefined && (feet + W.BODY_H <= o.y0 + 0.02 || feet >= o.y0 + o.h - 0.02)) continue;
    const cx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw));
    const cz = Math.max(o.z - o.hd, Math.min(z, o.z + o.hd));
    if ((x - cx) ** 2 + (z - cz) ** 2 < rad * rad) return true;
  }
  return false;
}
// 3D line of sight: walls, crates, columns and floor slabs block it
function los3(room, ax, ay, az, bx, by, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.5);
  for (let i = 1; i < n; i++) {
    const f = i / n, px = ax + (bx - ax) * f, py = ay + (by - ay) * f, pz = az + (bz - az) * f;
    for (const o of room.blockers) if (Math.abs(px - o.x) < o.hw && Math.abs(pz - o.z) < o.hd && py > o.y0 && py < o.y0 + o.h) return false;
  }
  return true;
}
const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), a.z - b.z);
// bots only climb when their route says so (b.climb), and never step onto a lift pad, so a bot crossing a floor cannot drift onto a ramp by accident
function moveBy(room, b, dx, dz, rad) {
  const floorTop = W.levelTop[W.levelOf(b.y)];
  const solids = b.climb ? room.botObsClimb : room.botObs;
  const ok = (x, z) => !collides(solids, x, z, rad, b.y) && (b.climb || room.L.surfaceY(x, z, b.y, nowSec()) <= floorTop + 0.15);
  if (ok(b.x + dx, b.z)) b.x += dx;
  if (ok(b.x, b.z + dz)) b.z += dz;
}

// ================= computer players =================
const BOT_NAMES = ['Ava', 'Ben', 'Cleo', 'Dax', 'Eli', 'Fay', 'Gus'];
function addBots(room, role, n) {
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    const used = new Set([...room.players.values(), ...room.bots.values()].map(p => p.pic)), free = [...Array(PICS).keys()].filter(k => !used.has(k)), pic = (free.length ? free : [...Array(PICS).keys()])[Math.floor(Math.random() * (free.length || PICS))];
    room.bots.set(id, { id, bot: true, pic, gender: genderOf(pic), name: '🤖 ' + BOT_NAMES[id % BOT_NAMES.length], team: role, role, inRound: true,
      x: 0, y: 0, vy: 0, z: 0, yaw: 0, m: 0, c: 0, spot: null, panic: 0, wp: null, route: null, stuck: 0, revealUntil: 0, scaredUntil: 0 });
  }
}
// a hiding place: next to a structure piece (any floor) about half the time, otherwise behind ground clutter
function pickHideSpot(room) {
  const L = room.L, cover = L.blocks.filter(b => !b.seeThrough && !b.rail);
  if (cover.length && Math.random() < 0.55) {
    for (let i = 0; i < 40; i++) {
      const o = cover[Math.floor(Math.random() * cover.length)], top = o.y0;
      const side = Math.random() < 0.5 ? -1 : 1, alongX = Math.random() < 0.5;
      const x = o.x + (alongX ? side * (o.hw + 1.1) : (Math.random() - 0.5) * 1.5);
      const z = o.z + (alongX ? (Math.random() - 0.5) * 1.5 : side * (o.hd + 1.1));
      if (Math.abs(x) > MAP - 1.5 || Math.abs(z) > MAP - 1.5) continue;
      if (L.surfaceY(x, z, top + 0.1, 0) !== top) continue;     // must be solid floor at that height, not a ramp or a gap
      if (collides(room.botObs, x, z, 0.8, top) || !inMain(room, top, x, z)) continue;
      return { x, z, y: top };
    }
  }
  for (let i = 0; i < 60; i++) {   // behind ground clutter, on the far side from the map centre
    const o = room.ground[4 + Math.floor(Math.random() * (room.ground.length - 4))];
    if (!o) break;
    const d = Math.hypot(o.x, o.z) || 1;
    const x = o.x + o.x / d * (o.hw + 1.2) + (Math.random() - 0.5) * 2;
    const z = o.z + o.z / d * (o.hd + 1.2) + (Math.random() - 0.5) * 2;
    if (Math.abs(x) < MAP - 1.5 && Math.abs(z) < MAP - 1.5 && L.surfaceY(x, z, 0.1, 0) === 0 && !collides(room.botObs, x, z, 0.8, 0) && inMain(room, 0, x, z)) return { x, z, y: 0 };
  }
  return { x: (Math.random() - 0.5) * 40, z: 20, y: 0 };
}
// a random free point on a random floor
function pickFreePoint(room) {
  const L = room.L;
  for (let i = 0; i < 80; i++) {
    let top = 0, x, z;
    if (Math.random() < 0.4 || !L.slabs.length) { x = (Math.random() * 2 - 1) * (MAP - 3); z = (Math.random() * 2 - 1) * (MAP - 3); }
    else { const s = L.slabs[Math.floor(Math.random() * L.slabs.length)]; top = s.top; x = s.x + (Math.random() * 2 - 1) * s.hw; z = s.z + (Math.random() * 2 - 1) * s.hd; }
    if (L.surfaceY(x, z, top + 0.1, 0) !== top || collides(room.botObs, x, z, 0.8, top) || !inMain(room, top, x, z)) continue;
    return { x, z, y: top };
  }
  return { x: 0, z: 0, y: 0 };
}
// a point on the bot's own floor, away from a threat
function fleePoint(room, b, threat) {
  const L = room.L, top = W.levelTop[W.levelOf(b.y)];
  let best = null, bd = -1;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, len = rand(6, 11), x = b.x + Math.cos(a) * len, z = b.z + Math.sin(a) * len;
    if (Math.abs(x) > MAP - 1.5 || Math.abs(z) > MAP - 1.5) continue;
    if (L.surfaceY(x, z, top + 0.1, 0) !== top || collides(room.botObs, x, z, 0.8, top) || !inMain(room, top, x, z)) continue;
    const d = threat ? Math.hypot(x - threat.x, z - threat.z) : Math.random();
    if (d > bd) { bd = d; best = { x, z }; }
  }
  return best || { x: b.x, z: b.z };
}
// move one step toward (tx,tz) on the current floor; the floor height under the bot is followed automatically
function stepBot(room, b, tx, tz, speed, dt) {
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
  if (d < 0.3) { b.m = 0; return d; }
  const step = Math.min(d, speed * dt), vx = dx / d * step, vz = dz / d * step, ox = b.x, oz = b.z;
  moveBy(room, b, vx, vz, 0.5);
  if (Math.hypot(b.x - ox, b.z - oz) < step * 0.3) { moveBy(room, b, -vz, vx, 0.5); b.stuck += dt; } else b.stuck = 0;
  if (Math.hypot(b.x - ox, b.z - oz) < step * 0.3) b.stall = (b.stall || 0) + dt; else b.stall = 0;   // blocked even after sliding along the wall
  b.x = Math.max(-MAP + 1, Math.min(MAP - 1, b.x));
  b.z = Math.max(-MAP + 1, Math.min(MAP - 1, b.z));
  const st = { y: b.y, vy: b.vy }; room.L.stepY(st, b.x, b.z, dt, nowSec()); b.y = st.y; b.vy = st.vy;
  b.yaw = Math.atan2(dx, dz) - Math.PI; // client draws avatars facing yaw + PI
  b.m = 1;
  return d;
}
// ---- path finding: one 1-unit grid per floor (cells blocked by walls, crates, ramps, lift pads or empty air), searched with A* ----
const GN = 60;
function buildGrids(room) {
  room.grids = W.levelTop.map(top => {
    const g = new Uint8Array(GN * GN);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const x = i - GN / 2 + 0.5, z = j - GN / 2 + 0.5;
      if (Math.abs(x) > MAP - 1 || Math.abs(z) > MAP - 1 || room.L.surfaceY(x, z, top + 0.1, 0) !== top || collides(room.botObs, x, z, 0.62, top)) g[j * GN + i] = 1;
    }
    return g;
  });
  markMain(room);
}
// the biggest connected walkable region of each floor: bots only pick spots inside it, so they never choose a pocket they cannot reach
function markMain(room) {
  const L = room.L;
  // points where bots enter each floor: the ends of every ramp
  const anchors = W.levelTop.map(() => []);
  L.ramps.forEach(r => {
    const dx = r.x1 - r.x0, dz = r.z1 - r.z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    anchors[W.levelOf(r.y0)].push([r.x0 - ux * r.app, r.z0 - uz * r.app]);
    anchors[W.levelOf(r.y1)].push([r.x1 + ux * 1.8, r.z1 + uz * 1.8]);
  });
  room.main = room.grids.map((g, lvl) => {
    const lab = new Int16Array(GN * GN), sizes = [0];
    let next = 0;
    for (let s0 = 0; s0 < GN * GN; s0++) {
      if (g[s0] || lab[s0]) continue;
      const id = ++next; let size = 0; const st = [s0]; lab[s0] = id;
      while (st.length) {
        const n = st.pop(); size++;
        const ci = n % GN, cj = Math.floor(n / GN);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= GN || nj >= GN) continue;
          const m = nj * GN + ni; if (!g[m] && !lab[m]) { lab[m] = id; st.push(m); }
        }
      }
      sizes[id] = size;
    }
    const keep = new Set();
    if (lvl === 0) { let best = 1; for (let i = 1; i <= next; i++) if (sizes[i] > sizes[best]) best = i; keep.add(best); }
    for (const [x, z] of anchors[lvl]) {                       // any region that a ramp reaches counts too
      const ci = Math.floor(x + GN / 2), cj = Math.floor(z + GN / 2);
      let found = 0;
      for (let r = 0; r <= 3 && !found; r++) for (let dj = -r; dj <= r && !found; dj++) for (let di = -r; di <= r && !found; di++) {
        const ni = ci + di, nj = cj + dj;
        if (ni >= 0 && nj >= 0 && ni < GN && nj < GN && lab[nj * GN + ni]) found = lab[nj * GN + ni];
      }
      if (found) keep.add(found);
    }
    const mask = new Uint8Array(GN * GN); for (let i = 0; i < GN * GN; i++) mask[i] = keep.has(lab[i]) ? 1 : 0;
    return mask;
  });
}
const inMain = (room, top, x, z) => {
  const i = Math.floor(x + GN / 2), j = Math.floor(z + GN / 2);
  return i >= 0 && j >= 0 && i < GN && j < GN && room.main[W.levelOf(top)][j * GN + i] === 1;
};
function findPath(room, sx, sz, gx, gz, lvl) {
  const g = room.grids[lvl];
  const cell = (x, z) => [Math.max(0, Math.min(GN - 1, Math.floor(x + GN / 2))), Math.max(0, Math.min(GN - 1, Math.floor(z + GN / 2)))];
  const free = (i, j) => i >= 0 && j >= 0 && i < GN && j < GN && !g[j * GN + i];
  const near = (i, j) => {
    if (free(i, j)) return [i, j];
    for (let r = 1; r <= 5; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  };
  const s = near(...cell(sx, sz)), t = near(...cell(gx, gz));
  if (!s || !t) return null;
  const S = s[1] * GN + s[0], T = t[1] * GN + t[0], gs = new Float32Array(GN * GN).fill(1e9), from = new Int32Array(GN * GN).fill(-1), done = new Uint8Array(GN * GN);
  const heap = [];   // binary min-heap of [f, index]
  const push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const hh = n => Math.hypot((n % GN) - t[0], Math.floor(n / GN) - t[1]);
  gs[S] = 0; push(hh(S), S);
  while (heap.length) {
    const [, n] = pop(); if (done[n]) continue; done[n] = 1;
    if (n === T) break;
    const ci = n % GN, cj = Math.floor(n / GN);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!free(ni, nj) || (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj)))) continue;   // no cutting corners
      const m = nj * GN + ni, c = gs[n] + (di && dj ? 1.414 : 1);
      if (c < gs[m]) { gs[m] = c; from[m] = n; push(c + hh(m), m); }
    }
  }
  if (!done[T]) return null;
  const pts = [];
  for (let n = T; n !== -1; n = from[n]) pts.push({ x: (n % GN) - GN / 2 + 0.5, z: Math.floor(n / GN) - GN / 2 + 0.5 });
  pts.reverse();
  const out = [];   // keep only the corners
  pts.forEach((p, i) => { const a = out[out.length - 1], pr = pts[i - 1], nx = pts[i + 1]; if (!a || !nx || (p.x - pr.x) * (nx.z - p.z) !== (p.z - pr.z) * (nx.x - p.x)) out.push(p); });
  out.shift();   // we are already in the first cell
  return out;
}
// walk to (tx,tz) around obstacles on the bot's current floor; returns the distance still to go
function walkTo(room, b, tx, tz, speed, dt, coarse) {
  const lvl = W.levelOf(b.y), q = coarse ? 2 : 0.5, key = Math.round(tx / q) + ',' + Math.round(tz / q) + ',' + lvl;
  if (b.pathKey !== key || b.stuck > 0.6) { b.path = findPath(room, b.x, b.z, tx, tz, lvl) || []; b.pathKey = key; b.stuck = 0; }
  while (b.path.length && Math.hypot(b.path[0].x - b.x, b.path[0].z - b.z) < 0.6) b.path.shift();
  const p = b.path[0];
  if (p) stepBot(room, b, p.x, p.z, speed, dt); else stepBot(room, b, tx, tz, speed, dt);
  return Math.hypot(tx - b.x, tz - b.z);
}
// walk to a target that may be on another floor or platform: follow the ramp waypoints first, then walk straight to the target
function goTo(room, b, tgt, speed, dt, chase) {
  const L = room.L;
  const tn = L.nodeAt(tgt.x, tgt.z, tgt.y) || 'g', cn = L.nodeAt(b.x, b.z, b.y);   // cn is null while on a ramp
  if (cn !== null && cn !== tn) {
    if (!b.route || b.route.to !== tn || !b.route.pts.length) b.route = { to: tn, pts: (L.navPath(cn, tn) || []).map(p => Object.assign({}, p)) };
  } else if (b.route && !b.route.pts.length) b.route = null;
  const wp = b.route && b.route.pts[0];
  b.climb = !!wp && !wp.walk;   // only the ramp itself needs the freedom to climb
  if (wp) {
    if (wp.walk) { if (walkTo(room, b, wp.x, wp.z, speed, dt, false) < 1) b.route.pts.shift(); }
    else if (stepBot(room, b, wp.x, wp.z, speed, dt) < 0.8) b.route.pts.shift();
  } else walkTo(room, b, tgt.x, tgt.z, speed, dt, chase);
  return Math.hypot(tgt.x - b.x, tgt.z - b.z);
}

function hiderAI(room, b, all, dt) {
  if (!b.spot) { b.spot = pickHideSpot(room); b.route = null; }
  if (room.phase === 'seek') {
    const vis = Date.now() < room.dimUntil ? 0.55 : 1;   // a power cut or fog also hides you from far away
    let threat = null, best = 7 * vis;
    for (const s of all) {
      if (s.role !== 'seeker') continue;
      const d = dist3(s, b);
      if (d < best && los3(room, s.x, s.y + 1.2, s.z, b.x, b.y + 1.2, b.z)) { best = d; threat = s; }
    }
    if (threat) { b.panic = 1.5; b.flee = fleePoint(room, b, threat); }
  }
  if (b.panic > 0) {
    b.panic -= dt;
    stepBot(room, b, b.flee.x, b.flee.z, 6.5, dt);
    if (b.stuck > 0.3) b.flee = fleePoint(room, b, null);
    if (b.panic <= 0) { b.spot = pickHideSpot(room); b.route = null; }
    b.c = 0;
  } else {
    if (b.stall > 2) { b.spot = pickHideSpot(room); b.route = null; b.stall = 0; }   // wedged in a corner: pick another hiding place
    const d = goTo(room, b, b.spot, 5.5, dt);
    b.c = d < 0.4 && W.levelOf(b.y) === W.levelOf(b.spot.y) ? 1 : 0;
  }
}
function seekerAI(room, b, all, dt) {
  if (room.phase !== 'seek') { b.m = 0; return; }
  if (Date.now() < b.scaredUntil) { b.m = 0; return; }       // frozen by a ghost
  const now = Date.now(), vis = now < room.dimUntil ? 0.5 : 1;
  let target = null, best = 1e9;
  for (const h of all) {
    if (h.role !== 'hider') continue;
    const d = dist3(h, b);
    const revealed = now < h.revealUntil;                    // a haunted point or whale song gave this hider away
    if (d < best && (revealed ? d < 45 : (d < (h.c ? 5 : 10) * vis && los3(room, b.x, b.y + 1.2, b.z, h.x, h.y + 1.2, h.z)))) { best = d; target = h; }
  }
  if (target) {
    goTo(room, b, target, 5.2, dt, true);
    if (best < 1.8) tagTarget(room, b, target);
    return;
  }
  if (b.stall > 2) { b.wp = null; b.stall = 0; }
  if (!b.wp || b.stuck > 0.5 || (Math.hypot(b.wp.x - b.x, b.wp.z - b.z) < 1 && W.levelOf(b.y) === W.levelOf(b.wp.y))) { b.wp = pickFreePoint(room); b.route = null; }
  goTo(room, b, b.wp, 4, dt);
}
function tickBots(room, dt) {
  if (!room.bots.size) return;
  const all = everyone(room);
  for (const b of room.bots.values()) {
    if (b.role === 'out') { b.m = 0; b.c = 0; continue; }
    b.climb = false;
    if (b.role === 'hider') hiderAI(room, b, all, dt); else seekerAI(room, b, all, dt);
  }
}

// ================= surprises: power cuts, mist, whale song, haunted points =================
function scheduleTwist(room) {
  const cfg = THEMES[room.theme].twists;
  room.twistAt = cfg.length ? Date.now() + 1000 * TWIST_SCALE * rand(...cfg[Math.floor(Math.random() * cfg.length)].every) : Infinity;
}
function tickTwists(room) {
  const now = Date.now(), cfgT = THEMES[room.theme];
  if (now > room.twistAt) {
    const tw = cfgT.twists[Math.floor(Math.random() * cfgT.twists.length)];
    if (tw.kind === 'dim') {
      room.dimUntil = now + tw.dur * 1000;
      broadcast(room, { t: 'twist', kind: 'dim', label: tw.label, sub: tw.sub, dur: tw.dur, dark: tw.dark });
    } else if (tw.kind === 'sonar') {
      const list = everyone(room).filter(p => p.role === 'hider').map(p => [p.id, +p.x.toFixed(1), +(p.y || 0).toFixed(1), +p.z.toFixed(1)]);
      everyone(room).forEach(p => { if (p.role === 'hider') p.revealUntil = now + 3500; });
      broadcast(room, { t: 'twist', kind: 'sonar', label: tw.label, sub: tw.sub, list });
    }
    scheduleTwist(room);
  }
  if (cfgT.haunt) {
    for (const [id, h] of room.haunts) {                          // expire old haunted points
      if (now > h.until) { room.haunts.delete(id); broadcast(room, { t: 'haunt_end', id }); }
    }
    if (now > room.hauntAt && room.haunts.size < 4) {             // a new haunted point suddenly appears
      const p = pickFreePoint(room), id = nextId++, life = 22;
      room.haunts.set(id, { id, x: p.x, y: p.y, z: p.z, until: now + life * 1000 });
      broadcast(room, { t: 'haunt', id, x: +p.x.toFixed(2), y: p.y, z: +p.z.toFixed(2), life });
      room.hauntAt = now + 1000 * TWIST_SCALE * rand(13, 21);
    }
    for (const h of room.haunts.values()) {                       // anyone who steps on one gets a ghost in the face
      const v = everyone(room).find(p => (p.role === 'hider' || p.role === 'seeker') && Math.hypot(p.x - h.x, p.z - h.z) < 2.2 && Math.abs((p.y || 0) - h.y) < 2.5);
      if (!v) continue;
      room.haunts.delete(h.id);
      if (v.role === 'hider') v.revealUntil = now + 7000; else v.scaredUntil = now + 2500;
      broadcast(room, { t: 'spook', hid: h.id, pid: v.id, role: v.role, x: +h.x.toFixed(2), y: h.y, z: +h.z.toFixed(2) });
      break;
    }
  }
}

// ================= round flow =================
function startRound(room, hideTime, seekTime) {
  const humans = [...room.players.values()];
  room.bots.clear();
  // one side empty (e.g. a solo player)? the computer plays it
  if (!humans.some(p => p.team === 'seeker')) addBots(room, 'seeker', 2);
  if (!humans.some(p => p.team === 'hider')) addBots(room, 'hider', 3);
  room.phase = 'hide';
  room.seed = 1 + Math.floor(Math.random() * 1e9);
  const L = room.L = W.make(THEMES[room.theme].layout);
  room.ground = genObstacles(room.seed, L);
  room.obs = room.ground.concat(L.colliders());                                                  // what stops walking
  room.botObsClimb = room.obs.concat(L.lifts.map(l => ({ x: l.x, z: l.z, hw: l.hw + 0.3, hd: l.hd + 0.3, y0: 0, h: 6 })));   // bots keep off the lift pads...
  room.botObs = room.botObsClimb.concat(L.rampBlocks);                                           // ...and off the ramps unless their route uses one
  buildGrids(room);
  room.blockers = room.ground.map(o => Object.assign({}, o, { y0: 0, h: 60 })).concat(L.blockers());   // what blocks sight
  room.dimUntil = 0; room.twistAt = Infinity; room.hauntAt = Infinity; room.haunts = new Map();
  const ps = [...humans, ...room.bots.values()];
  const hiders = ps.filter(p => p.team === 'hider');
  ps.forEach(p => {
    p.inRound = true; p.role = p.team; p.m = 0; p.c = 0; p.yaw = 0; p.y = 0; p.vy = 0; p.revealUntil = 0; p.scaredUntil = 0;
    if (p.role === 'seeker') { p.x = 0; p.z = 0; }
    else {
      const a = hiders.indexOf(p) / hiders.length * Math.PI * 2;
      p.x = Math.cos(a) * 4.5; p.z = Math.sin(a) * 4.5;
    }
  });
  // per-round record used for the end-of-round dashboard
  room.roster = new Map(ps.map(p => [p.id, { id: p.id, name: p.name, pic: p.pic, bot: !!p.bot, orig: p.team, caughtAt: null, caughtBy: null, tags: 0, left: false }]));
  room.seekStart = null;
  broadcast(room, {
    t: 'start', seed: room.seed, theme: room.theme, hideTime, seekTime, serverNow: Date.now(),
    players: ps.map(p => ({ id: p.id, name: p.name, gender: p.gender, pic: p.pic, role: p.role, x: p.x, z: p.z }))
  });
  room.seekTime = seekTime;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => beginSeek(room), hideTime * 1000);
}
function beginSeek(room) {
  room.phase = 'seek';
  room.seekStart = Date.now();
  scheduleTwist(room);
  if (THEMES[room.theme].haunt) room.hauntAt = Date.now() + 9000 * TWIST_SCALE;
  broadcast(room, { t: 'phase', phase: 'seek', seekTime: room.seekTime });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endRound(room, 'hiders'), room.seekTime * 1000);
}
function endRound(room, winner) {
  if (room.phase !== 'hide' && room.phase !== 'seek') return;
  clearTimeout(room.timer);
  room.phase = 'over';
  broadcast(room, {
    t: 'end', winner,
    duration: room.seekStart ? +((Date.now() - room.seekStart) / 1000).toFixed(1) : 0,
    players: room.roster ? [...room.roster.values()] : []
  });
  room.timer = setTimeout(() => {
    room.phase = 'lobby';
    room.bots.clear();
    room.players.forEach(p => { p.inRound = false; });
    broadcast(room, roomInfo(room));
  }, RESULT_SECONDS * 1000);
}
function checkEnd(room) {
  if (room.phase !== 'hide' && room.phase !== 'seek') return;
  if (count(room, 'hider') === 0) endRound(room, 'seekers');
  else if (count(room, 'seeker') === 0) endRound(room, 'hiders');
}
function tagTarget(room, tagger, target) {
  if (target.role !== 'hider') return;
  target.role = 'out'; target.m = 0; target.c = 0; // eliminated: the body stays where it was caught
  const at = room.seekStart ? +((Date.now() - room.seekStart) / 1000).toFixed(1) : 0;
  const tr = room.roster && room.roster.get(target.id), gr = room.roster && room.roster.get(tagger.id);
  if (tr) { tr.caughtAt = at; tr.caughtBy = tagger.name; }
  if (gr) gr.tags++;
  broadcast(room, { t: 'caught', id: target.id, by: tagger.id, at });
  checkEnd(room);
}

wss.on('connection', ws => {
  let me = null, room = null;

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'OFFICE';
      let r = rooms.get(code);
      if (!r) { r = { code, players: new Map(), bots: new Map(), host: null, phase: 'lobby', timer: null, obs: [], ground: [], blockers: [], theme: 0, L: W.make('glass'), dimUntil: 0, twistAt: Infinity, hauntAt: Infinity, haunts: new Map() }; rooms.set(code, r); }
      if (r.players.size >= MAX_PLAYERS) return send(ws, { t: 'err', msg: `Room is full (${MAX_PLAYERS} players)` });
      room = r;
      me = { id: nextId++, ws, name: String(m.name || 'Player').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player',
             pic: Number.isInteger(m.pic) && m.pic >= 0 && m.pic < PICS ? m.pic : (m.gender === 'girl' ? 4 : 0),
             team: 'hider', inRound: false, role: null, x: 0, y: 0, z: 0, yaw: 0, m: 0, c: 0, revealUntil: 0, scaredUntil: 0 };
      me.gender = genderOf(me.pic);
      room.players.set(me.id, me);
      if (!room.host) room.host = me.id;
      send(ws, { t: 'joined', id: me.id, lan: lanIps(), port: +PORT, publicUrl });
      broadcast(room, roomInfo(room));
      return;
    }
    if (!me) return;

    if (m.t === 'team' && room.phase === 'lobby' && (m.team === 'hider' || m.team === 'seeker')) {
      me.team = m.team; broadcast(room, roomInfo(room));
    } else if (m.t === 'theme' && me.id === room.host && room.phase === 'lobby') {
      room.theme = Math.max(0, Math.min(THEMES.length - 1, m.theme | 0));
      broadcast(room, roomInfo(room));
    } else if (m.t === 'random' && me.id === room.host && room.phase === 'lobby') {
      const n = Math.max(1, Math.min(4, m.seekers | 0));
      const ps = [...room.players.values()].sort(() => Math.random() - 0.5);
      ps.forEach((p, i) => { p.team = i < n && ps.length > 1 ? 'seeker' : 'hider'; });
      broadcast(room, roomInfo(room));
    } else if (m.t === 'start' && me.id === room.host && room.phase === 'lobby') {
      startRound(room, Math.max(10, Math.min(60, m.hideTime | 0 || 20)), Math.max(60, Math.min(600, m.seekTime | 0 || 180)));
    } else if (m.t === 'pos' && me.inRound && (room.phase === 'hide' || room.phase === 'seek')) {
      if (me.role === 'seeker' && room.phase === 'hide') return; // seekers wait
      if (me.role === 'out') return;                              // eliminated players leave their body where it fell
      me.x = +m.x || 0; me.z = +m.z || 0; me.yaw = +m.y || 0; me.m = m.m ? 1 : 0; me.c = m.c ? 1 : 0;
      me.y = Math.max(0, Math.min(10, +m.h || 0));                // height above the ground floor
    } else if (m.t === 'tag' && room.phase === 'seek' && me.inRound && me.role === 'seeker') {
      const target = room.players.get(m.target) || room.bots.get(m.target);
      if (!target || !target.inRound || target.role !== 'hider') return;
      if (dist3(target, me) > TAG_RANGE) return;
      tagTarget(room, me, target);
    }
  });

  ws.on('close', () => {
    if (!me || !room) return;
    room.players.delete(me.id);
    const entry = room.roster && room.roster.get(me.id);
    if (entry) entry.left = true;
    if (room.players.size === 0) { clearTimeout(room.timer); rooms.delete(room.code); return; }
    if (room.host === me.id) room.host = room.players.keys().next().value;
    broadcast(room, { t: 'left', id: me.id });
    broadcast(room, roomInfo(room));
    checkEnd(room);
  });
});

// ~15 Hz: move computer players, run the surprises, then broadcast positions for rooms mid-round
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase !== 'hide' && room.phase !== 'seek') continue;
    tickBots(room, TICK);
    if (room.phase === 'seek') tickTwists(room);
    broadcast(room, {
      t: 'state',
      p: everyone(room).map(p => [p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), p.m, p.c, +(p.y || 0).toFixed(2), now < p.revealUntil ? 1 : 0])
    });
  }
}, TICK * 1000);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Hide & Seek 3D running:\n  This PC:  http://localhost:${PORT}`);
    for (const ip of lanIps()) console.log(`  Other PCs on the same WiFi/office network:  http://${ip}:${PORT}`);
  });
} else {
  module.exports = { W, THEMES, buildGrids, findPath, inMain, genObstacles, collides, goTo, stepBot, pickHideSpot, pickFreePoint, tickBots, addBots, los3 };   // for offline tests
}
