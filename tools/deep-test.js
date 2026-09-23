// Deep test: navigates Alice to the key, then to the exit, verifying
// key pickup, coin pickup and the exit win condition end-to-end.
const { io } = require('socket.io-client');
const Maze = require('../shared/maze');

const URL = 'http://localhost:3000';
const TILE = Maze.TILE, W = Maze.MAP_W, H = Maze.MAP_H;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket: s, state: null, events: [] };
  s.on('state', (st) => { c.state = st; });
  s.on('event', (e) => c.events.push(e.message));
  return c;
}

function bfsPath(sx, sy, tx, ty) {
  const k = (x, y) => x + ',' + y;
  const prev = new Map();
  const q = [{ x: sx, y: sy }];
  prev.set(k(sx, sy), null);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const c = q.shift();
    if (c.x === tx && c.y === ty) break;
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (Maze.isWall(nx, ny)) continue;
      const key = k(nx, ny);
      if (prev.has(key)) continue;
      prev.set(key, c);
      q.push({ x: nx, y: ny });
    }
  }
  if (!prev.has(k(tx, ty))) return null;
  const path = [];
  let cur = { x: tx, y: ty };
  while (cur && !(cur.x === sx && cur.y === sy)) {
    path.unshift({ x: cur.x * TILE + TILE / 2, y: cur.y * TILE + TILE / 2 });
    cur = prev.get(k(cur.x, cur.y));
  }
  return path;
}

async function gotoCardinal(client, txPx, tyPx, stopDist = 14, timeoutMs = 20000) {
  const t0 = Date.now();
  let lastX = null, lastY = null, stuck = 0;
  while (Date.now() - t0 < timeoutMs) {
    const s = client.state;
    if (!s || s.phase !== 'playing') return false;
    const me = s.players.find((p) => p.id === client.socket.id);
    if (!me) return false;
    const dx = txPx - me.x, dy = tyPx - me.y;
    const d = Math.hypot(dx, dy);
    if (d < stopDist) { client.socket.emit('input', { dx: 0, dy: 0 }); return true; }
    // move along the dominant axis only (4-dir, like a human sliding along walls)
    const input = Math.abs(dx) >= Math.abs(dy)
      ? { dx: Math.sign(dx), dy: 0 }
      : { dx: 0, dy: Math.sign(dy) };
    client.socket.emit('input', input);
    const moved = lastX !== null ? Math.hypot(me.x - lastX, me.y - lastY) : 1;
    if (moved < 0.5) {
      stuck++;
      if (stuck > 120) { client.socket.emit('input', { dx: 0, dy: 0 }); return false; }
      // jiggle perpendicular to free the player from a corner
      if (stuck % 15 === 0) {
        const perp = input.dx !== 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
        client.socket.emit('input', perp); await sleep(80);
        client.socket.emit('input', { dx: -perp.dx, dy: -perp.dy }); await sleep(80);
      }
    } else stuck = 0;
    lastX = me.x; lastY = me.y;
    await sleep(40);
  }
  client.socket.emit('input', { dx: 0, dy: 0 });
  return false;
}

async function followPath(client, path) {
  let idx = 0;
  while (idx < path.length) {
    const s = client.state;
    const me = s.players.find((p) => p.id === client.socket.id);
    // skip waypoints already reached
    while (idx < path.length) {
      const w = path[idx];
      if (Math.hypot(w.x - me.x, w.y - me.y) < 24) idx++;
      else break;
    }
    if (idx >= path.length) break;
    const wp = path[idx];
    const ok = await gotoCardinal(client, wp.x, wp.y, 14, 20000);
    if (!ok) { console.log('stuck at waypoint', idx, 'of', path.length, '->', wp.x / TILE, wp.y / TILE); return false; }
  }
  return true;
}

(async () => {
  const a = makeClient('Alice');
  const b = makeClient('Bob');
  await sleep(300);
  a.socket.emit('join', { name: 'Alice' });
  await sleep(200);
  b.socket.emit('join', { name: 'Bob' });

  let waited = 0;
  while (waited < 6000) {
    if (a.state && a.state.phase === 'playing' && b.state && b.state.phase === 'playing') break;
    await sleep(200); waited += 200;
  }
  if (!a.state || a.state.phase !== 'playing') { console.log('FAIL: no playing phase'); process.exit(1); }

  const aliceId = a.socket.id;
  const me = () => a.state.players.find((p) => p.id === aliceId);
  const coinsBefore = me().coins;

  // 1) go to the key
  const kx = a.state.key.x, ky = a.state.key.y;
  const path1 = bfsPath(Math.floor(me().x / TILE), Math.floor(me().y / TILE), Math.floor(kx / TILE), Math.floor(ky / TILE));
  if (!path1) { console.log('FAIL: no path to key'); process.exit(1); }
  console.log('path to key length:', path1.length);
  const ok1 = await followPath(a, path1);
  console.log('reached key waypoints:', ok1, 'dist to key now:', Math.hypot(me().x - kx, me().y - ky).toFixed(1));
  await sleep(300);

  console.log('after key: holder =', a.state.key.holder, 'alice hasKey =', me().hasKey);
  if (a.state.key.holder !== aliceId) { console.log('FAIL: Alice did not pick up the key'); process.exit(1); }
  console.log('coins collected en route:', me().coins - coinsBefore);

  // 2) go to the exit
  const ex = a.state.exit.x, ey = a.state.exit.y;
  const path2 = bfsPath(Math.floor(me().x / TILE), Math.floor(me().y / TILE), Math.floor(ex / TILE), Math.floor(ey / TILE));
  if (!path2) { console.log('FAIL: no path to exit'); process.exit(1); }
  console.log('path to exit length:', path2.length);
  await followPath(a, path2);
  await sleep(400);

  console.log('final phase:', a.state.phase, 'winner:', a.state.winner, 'reason:', a.state.reason);
  if (a.state.phase !== 'ended' || a.state.winner !== aliceId) {
    console.log('FAIL: Alice did not win by exit'); process.exit(1);
  }
  console.log('final scores:', a.state.players.map((p) => p.name + '=' + p.finalScore));
  console.log('events:', a.events);
  console.log('DEEP TEST OK');
  a.socket.disconnect(); b.socket.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
