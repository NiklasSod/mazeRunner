const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const Maze = require('./shared/maze');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

const PORT = process.env.PORT || 3000;
const TICK_MS = 1000 / 30;          // 30 Hz simulation

const TILE = Maze.TILE;
const MAP_W = Maze.MAP_W;
const MAP_H = Maze.MAP_H;
const WIDTH = Maze.WIDTH;
const HEIGHT = Maze.HEIGHT;

// --- tuning ---
const MATCH_TIME = 180;             // seconds
const HELP_TIME = 30;               // show guide arrows in the last N seconds + overtime
const BASE_SPEED = 140;             // px / s
const SPEED_BOOST = 1.6;
const PLAYER_R = 12;                // collision radius (px)
const STEAL_COOLDOWN = 1500;        // ms before another contact steal is allowed
const COIN_RESPAWN = 20000;         // ms
const POWER_RESPAWN = 12000;        // ms
const SPEED_DURATION = 6000;
const FREEZE_DURATION = 3000;
const REVERSE_DURATION = 5000;
const COIN_SCORE = 10;
const TIME_BONUS_RATE = 2;          // points per remaining second
const INVENTORY_SIZE = 2;

const POWER_TYPES = ['speed', 'freeze', 'steal', 'reverse'];
const PLAYER_COLORS = ['#4fc3f7', '#ffb74d'];

// --- parse static map markers ---
function parseMap() {
  const start1 = { x: 0, y: 0 }, start2 = { x: 0, y: 0 };
  const keySpots = [], exitSpots = [], coinSpots = [], powerSpots = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = Maze.charAt(x, y);
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
      if (c === '1') { start1.x = cx; start1.y = cy; }
      else if (c === '2') { start2.x = cx; start2.y = cy; }
      else if (c === 'K') keySpots.push({ x: cx, y: cy });
      else if (c === 'E') exitSpots.push({ x: cx, y: cy });
      else if (c === 'C') coinSpots.push({ x: cx, y: cy });
      else if (c === 'P') powerSpots.push({ x: cx, y: cy });
    }
  }
  return { start1, start2, keySpots, exitSpots, coinSpots, powerSpots };
}
const SPAWNS = parseMap();

// --- helpers ---
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clampAxis = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const randomPower = () => pick(POWER_TYPES);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function boxCollides(x, y, r) {
  const x0 = x - r, x1 = x + r, y0 = y - r, y1 = y + r;
  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (Maze.isWall(tx, ty)) return true;
    }
  }
  return false;
}

// --- rooms / matchmaking ---
const rooms = new Map();      // roomId -> room
const socketRoom = new Map(); // socketId -> roomId
let queue = [];               // [{socket, name}]
let matchCounter = 0;
const recentMatches = [];     // in-memory match history (no database)

function makePlayer(socket, name, x, y, color) {
  return {
    id: socket.id,
    socket,
    name,
    x, y,
    facing: 0,
    input: { dx: 0, dy: 0 },
    speedUntil: 0,
    frozenUntil: 0,
    reversedUntil: 0,
    hasKey: false,
    coins: 0,
    inv: [],
    color
  };
}

function createRoom(a, b) {
  const id = 'room_' + (++matchCounter);
  const now = Date.now();

  const keyPos = pick(SPAWNS.keySpots);
  const exitPos = pick(SPAWNS.exitSpots);

  // randomize which hardcoded start each player gets
  const swap = Math.random() < 0.5;
  const sA = swap ? SPAWNS.start2 : SPAWNS.start1;
  const sB = swap ? SPAWNS.start1 : SPAWNS.start2;

  const room = {
    id,
    phase: 'countdown',
    countdownEnd: now + 3000,
    matchStart: null,
    elapsed: 0,
    remaining: MATCH_TIME,
    overtime: false,
    now,
    key: { x: keyPos.x, y: keyPos.y, holder: null },
    exit: { x: exitPos.x, y: exitPos.y },
    coins: SPAWNS.coinSpots.map((p, i) => ({ id: i, x: p.x, y: p.y, active: true, respawnAt: 0 })),
    powerups: SPAWNS.powerSpots.map((p, i) => ({ id: i, x: p.x, y: p.y, type: randomPower(), active: true, respawnAt: 0 })),
    players: {},
    stealCooldownUntil: 0,
    winner: null,
    reason: null
  };

  room.players[a.socket.id] = makePlayer(a.socket, a.name, sA.x, sA.y, PLAYER_COLORS[0]);
  room.players[b.socket.id] = makePlayer(b.socket, b.name, sB.x, sB.y, PLAYER_COLORS[1]);

  rooms.set(id, room);
  socketRoom.set(a.socket.id, id);
  socketRoom.set(b.socket.id, id);
  a.socket.join(id);
  b.socket.join(id);

  broadcastEvent(room, a.socket.id, a.name + ' möter ' + b.name + '!');
}

function transferKey(from, to, room) {
  if (!from.hasKey) return;
  from.hasKey = false;
  to.hasKey = true;
  room.key.holder = to.id;
  room.stealCooldownUntil = room.now + STEAL_COOLDOWN;
}

function otherPlayer(room, p) {
  for (const id in room.players) {
    if (id !== p.id) return room.players[id];
  }
  return null;
}

function activatePower(room, p, slot) {
  const type = p.inv[slot];
  if (!type) return;
  p.inv.splice(slot, 1);
  const opp = otherPlayer(room, p);
  switch (type) {
    case 'speed':
      p.speedUntil = room.now + SPEED_DURATION;
      broadcastEvent(room, p.id, p.name + ' använde Speed Boost!');
      break;
    case 'freeze':
      if (opp) {
        opp.frozenUntil = room.now + FREEZE_DURATION;
        broadcastEvent(room, p.id, p.name + ' frös ' + opp.name + '!');
      }
      break;
    case 'steal':
      if (opp && opp.hasKey) {
        transferKey(opp, p, room);
        broadcastEvent(room, p.id, p.name + ' stal nyckeln från ' + opp.name + '!');
      } else {
        broadcastEvent(room, p.id, p.name + ' hittade ingen nyckel att stjäla.');
      }
      break;
    case 'reverse':
      if (opp) {
        opp.reversedUntil = room.now + REVERSE_DURATION;
        broadcastEvent(room, p.id, p.name + ' vände på ' + opp.name + 's kontroller!');
      }
      break;
  }
}

function endMatch(room, winnerId, reason) {
  room.phase = 'ended';
  room.winner = winnerId;
  room.reason = reason;
  const timeBonus = Math.floor(room.remaining) * TIME_BONUS_RATE;
  const summary = { winner: null, loser: null };
  for (const id in room.players) {
    const p = room.players[id];
    p.finalScore = p.coins * COIN_SCORE + timeBonus;
    if (id === winnerId) summary.winner = p;
    else summary.loser = p;
  }
  recentMatches.unshift({
    winnerName: summary.winner ? summary.winner.name : '?',
    loserName: summary.loser ? summary.loser.name : '?',
    winnerScore: summary.winner ? summary.winner.finalScore : 0,
    loserScore: summary.loser ? summary.loser.finalScore : 0,
    duration: Math.round(room.elapsed),
    reason,
    at: Date.now()
  });
  if (recentMatches.length > 50) recentMatches.length = 50;
  sendState(room);

  // keep the room around briefly so clients can read the result, then clean up
  const rid = room.id;
  setTimeout(() => {
    if (rooms.get(rid) === room) {
      rooms.delete(rid);
      for (const pid of Object.keys(room.players)) {
        if (socketRoom.get(pid) === rid) socketRoom.delete(pid);
      }
    }
  }, 15000);
}

function broadcastEvent(room, fromId, message) {
  io.to(room.id).emit('event', { from: fromId, message });
}

// --- simulation ---
function update(room, now) {
  const ps = Object.values(room.players);

  for (const p of ps) movePlayer(p, room);

  if (ps.length === 2) playerCollision(ps[0], ps[1], room);

  for (const p of ps) {
    // key pickup from floor
    if (!room.key.holder && dist(p, room.key) < PLAYER_R + 14) {
      p.hasKey = true;
      room.key.holder = p.id;
      broadcastEvent(room, p.id, p.name + ' hittade nyckeln!');
    }

    // coins
    for (const c of room.coins) {
      if (c.active && dist(p, c) < PLAYER_R + 12) {
        c.active = false;
        c.respawnAt = now + COIN_RESPAWN;
        p.coins += 1;
      }
    }

    // power-ups
    for (const pu of room.powerups) {
      if (pu.active && dist(p, pu) < PLAYER_R + 14 && p.inv.length < INVENTORY_SIZE) {
        pu.active = false;
        pu.respawnAt = now + POWER_RESPAWN;
        p.inv.push(pu.type);
        broadcastEvent(room, p.id, p.name + ' plockade upp ' + powerLabel(pu.type) + '!');
      }
    }

    // exit win condition (must hold the key)
    if (p.hasKey && dist(p, room.exit) < TILE * 0.8) {
      endMatch(room, p.id, 'exit');
      return;
    }
  }

  // respawns
  for (const c of room.coins) if (!c.active && now >= c.respawnAt) c.active = true;
  for (const pu of room.powerups) {
    if (!pu.active && now >= pu.respawnAt) {
      pu.active = true;
      pu.type = randomPower();
    }
  }
}

function movePlayer(p, room) {
  if (room.now < p.frozenUntil) return;

  let dx = p.input.dx, dy = p.input.dy;
  if (room.now < p.reversedUntil) { dx = -dx; dy = -dy; }

  if (dx === 0 && dy === 0) return;

  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;
  const speed = BASE_SPEED * (room.now < p.speedUntil ? SPEED_BOOST : 1);
  const step = speed * room.dt;

  p.facing = Math.atan2(ny, nx);

  p.x += nx * step;
  if (boxCollides(p.x, p.y, PLAYER_R)) p.x -= nx * step;

  p.y += ny * step;
  if (boxCollides(p.x, p.y, PLAYER_R)) p.y -= ny * step;

  p.x = Math.max(PLAYER_R, Math.min(WIDTH - PLAYER_R, p.x));
  p.y = Math.max(PLAYER_R, Math.min(HEIGHT - PLAYER_R, p.y));
}

function playerCollision(a, b, room) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const minDist = PLAYER_R * 2;
  if (d < minDist && d > 0.0001) {
    const overlap = (minDist - d) / 2;
    const nx = dx / d, ny = dy / d;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;
  }
  // contact key steal
  if (d < minDist + 2 && room.now >= room.stealCooldownUntil) {
    if (a.hasKey && !b.hasKey) {
      transferKey(a, b, room);
      broadcastEvent(room, b.id, b.name + ' stal nyckeln!');
    } else if (b.hasKey && !a.hasKey) {
      transferKey(b, a, room);
      broadcastEvent(room, a.id, a.name + ' stal nyckeln!');
    }
  }
}

function powerLabel(type) {
  return { speed: 'Speed', freeze: 'Frys', steal: 'Nyckelstöld', reverse: 'Reversering' }[type] || type;
}

// --- state serialization ---
function sendState(room) {
  const now = room.now;
  const base = {
    phase: room.phase,
    remaining: room.remaining,
    overtime: room.overtime,
    help: room.overtime || room.remaining <= HELP_TIME,
    key: { x: room.key.x, y: room.key.y, holder: room.key.holder },
    exit: { x: room.exit.x, y: room.exit.y },
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      facing: p.facing,
      color: p.color,
      hasKey: p.hasKey,
      coins: p.coins,
      score: p.coins * COIN_SCORE,
      inv: p.inv,
      speed: now < p.speedUntil,
      frozen: now < p.frozenUntil,
      reversed: now < p.reversedUntil,
      finalScore: p.finalScore || 0
    })),
    coins: room.coins.filter((c) => c.active).map((c) => ({ id: c.id, x: c.x, y: c.y })),
    powerups: room.powerups.filter((pu) => pu.active).map((pu) => ({ id: pu.id, x: pu.x, y: pu.y, type: pu.type })),
    winner: room.winner,
    reason: room.reason
  };

  for (const id in room.players) {
    const p = room.players[id];
    const payload = Object.assign({}, base, { you: id, countdown: Math.max(0, Math.ceil((room.countdownEnd - now) / 1000)) });
    p.socket.emit('state', payload);
  }
}

// --- main loop ---
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  for (const [id, room] of rooms) {
    room.now = now;
    room.dt = dt;
    if (room.phase === 'countdown') {
      if (now >= room.countdownEnd) {
        room.phase = 'playing';
        room.matchStart = now;
      }
      sendState(room);
    } else if (room.phase === 'playing') {
      room.elapsed = (now - room.matchStart) / 1000;
      room.remaining = Math.max(0, MATCH_TIME - room.elapsed);
      room.overtime = room.elapsed > MATCH_TIME;
      update(room, now);
      if (room.phase !== 'ended') sendState(room);
    }
  }
}, TICK_MS);

// --- socket handlers ---
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const cur = socketRoom.get(socket.id);
    if (cur) {
      const r = rooms.get(cur);
      if (r && r.phase !== 'ended') return; // still in a live match
      socketRoom.delete(socket.id); // stale ended room, allow rejoin
    }
    const name = (typeof (data && data.name) === 'string' ? data.name : '').trim().slice(0, 12) || 'Spelare';
    queue = queue.filter((q) => q.socket.id !== socket.id);
    queue.push({ socket, name });
    socket.emit('searching', { queued: queue.length });
    tryMatch();
  });

  socket.on('input', (d) => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing') return;
    const p = room.players[socket.id];
    if (!p) return;
    p.input = {
      dx: clampAxis((d && d.dx) | 0),
      dy: clampAxis((d && d.dy) | 0)
    };
  });

  socket.on('usePower', (slot) => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'playing') return;
    const p = room.players[socket.id];
    if (!p) return;
    if (slot === 0 || slot === 1) activatePower(room, p, slot);
  });

  socket.on('disconnect', () => {
    // remove from queue
    queue = queue.filter((q) => q.socket.id !== socket.id);
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.phase === 'playing' || room.phase === 'countdown') {
      const opp = otherPlayer(room, room.players[socket.id] || { id: socket.id });
      if (opp) endMatch(room, opp.id, 'disconnect');
    }
    // cleanup room + mappings
    rooms.delete(roomId);
    for (const pid of Object.keys(room.players)) socketRoom.delete(pid);
  });
});

function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift(), b = queue.shift();
    if (a.socket.connected && b.socket.connected) {
      createRoom(a, b);
    } else {
      if (a.socket.connected) queue.unshift(a);
      if (b.socket.connected) queue.unshift(b);
    }
  }
}

// --- REST: recent matches (in-memory only) ---
app.get('/api/recent', (req, res) => {
  res.json(recentMatches.slice(0, 10));
});

server.listen(PORT, () => {
  console.log('Maze Runner server listening on http://localhost:' + PORT);
});
