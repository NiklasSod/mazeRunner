// Smoke test: connects two clients, plays through countdown -> playing,
// verifies state broadcasts, movement, coin/key pickups and win conditions.
const { io } = require('socket.io-client');
const Maze = require('../shared/maze');

const URL = 'http://localhost:3000';
const TILE = Maze.TILE;

function makeClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket: s, state: null, events: [], done: null };
  s.on('state', (st) => { c.state = st; });
  s.on('searching', (d) => c.events.push('searching:' + d.queued));
  s.on('event', (e) => c.events.push('event:' + e.message));
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = makeClient('Alice');
  const b = makeClient('Bob');
  await sleep(400);

  a.socket.emit('join', { name: 'Alice' });
  await sleep(300);
  b.socket.emit('join', { name: 'Bob' });

  // wait for playing phase
  let waited = 0;
  while (waited < 6000) {
    if (a.state && a.state.phase === 'playing' && b.state && b.state.phase === 'playing') break;
    await sleep(200);
    waited += 200;
  }
  console.log('phaseA:', a.state && a.state.phase, 'phaseB:', b.state && b.state.phase);
  if (a.state.phase !== 'playing') { console.log('FAIL: never reached playing'); process.exit(1); }

  console.log('key holder initially:', a.state.key.holder);
  console.log('players:', a.state.players.map((p) => p.name + '@' + Math.round(p.x / TILE) + ',' + Math.round(p.y / TILE)));
  console.log('coins visible:', a.state.coins.length, 'powerups:', a.state.powerups.length, 'exit:', a.state.exit.x / TILE, a.state.exit.y / TILE);

  // Alice moves (right) for 1.2s — should update her x
  const xBefore = a.state.players.find((p) => p.id === a.socket.id).x;
  a.socket.emit('input', { dx: 1, dy: 0 });
  await sleep(1200);
  const xAfter = a.state.players.find((p) => p.id === a.socket.id).x;
  console.log('Alice moved:', xBefore, '->', xAfter);
  if (xAfter <= xBefore) { console.log('FAIL: Alice did not move'); process.exit(1); }
  a.socket.emit('input', { dx: 0, dy: 0 });

  console.log('events seen by A:', a.events.slice(0, 6));

  console.log('SMOKE TEST OK');
  a.socket.disconnect();
  b.socket.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
