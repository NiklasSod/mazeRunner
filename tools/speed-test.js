// Speed test: verifies diagonal movement is the same speed as cardinal movement.
// Uses a fresh match and measures both directions in wall-free space.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket: s, state: null };
  s.on('state', (st) => { c.state = st; });
  return c;
}

async function startMatch() {
  const a = makeClient('A');
  const b = makeClient('B');
  await sleep(300);
  a.socket.emit('join', { name: 'A' });
  await sleep(200);
  b.socket.emit('join', { name: 'B' });
  let waited = 0;
  while (waited < 6000) {
    if (a.state && a.state.phase === 'playing') break;
    await sleep(200); waited += 200;
  }
  if (!a.state || a.state.phase !== 'playing') return null;
  return { a, b };
}

(async () => {
  const m = await startMatch();
  if (!m) { console.log('FAIL: no playing phase'); process.exit(1); }
  const { a, b } = m;
  const me = () => a.state.players.find((p) => p.id === a.socket.id);

  // leftHalf start = (4,31); rightHalf start = (57,4)
  const leftHalf = me().x < (64 * 32) / 2;

  // Direction pairs chosen so neither cardinal nor diagonal hits a wall in 1s:
  //  start1: right (clear 176px), then left+up (clear)
  //  start2: left  (clear 240px), then right+down (clear)
  const card = leftHalf ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
  const diag = leftHalf ? { dx: -1, dy: -1 } : { dx: 1, dy: 1 };

  async function measure(dir) {
    const before = { x: me().x, y: me().y };
    a.socket.emit('input', dir);
    await sleep(1000);
    a.socket.emit('input', { dx: 0, dy: 0 });
    await sleep(100);
    const after = { x: me().x, y: me().y };
    return Math.hypot(after.x - before.x, after.y - before.y);
  }

  const dCard = await measure(card);
  await sleep(300);
  const dDiag = await measure(diag);

  console.log('cardinal dist:', dCard.toFixed(1));
  console.log('diagonal dist:', dDiag.toFixed(1));
  const ratio = dDiag / dCard;
  console.log('ratio:', ratio.toFixed(3));
  console.log(ratio > 0.85 && ratio < 1.15 ? 'PASS: same speed' : 'FAIL: diagonal speed differs');

  a.socket.disconnect(); b.socket.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
