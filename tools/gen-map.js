// Dev tool: generates and validates the hardcoded 48x27 (16:9) maze map.
// Mostly 1-tile corridors with a few rooms, so players can block each other.
const W = 48, H = 27;

// deterministic RNG (mulberry32) for a reproducible layout
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260923);

const grid = Array.from({ length: H }, () => Array(W).fill('#'));
const inMaze = (x, y) => x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2;

// recursive backtracker over odd cells -> perfect maze of 1-tile corridors
const stack = [[1, 1]];
grid[1][1] = '.';
const order = [[2, 0], [-2, 0], [0, 2], [0, -2]];
while (stack.length) {
  const [x, y] = stack[stack.length - 1];
  const dirs = [];
  for (const [dx, dy] of order) {
    const nx = x + dx, ny = y + dy;
    if (inMaze(nx, ny) && grid[ny][nx] === '#') dirs.push([dx, dy]);
  }
  if (dirs.length === 0) { stack.pop(); continue; }
  const [dx, dy] = dirs[Math.floor(rnd() * dirs.length)];
  grid[y + dy / 2][x + dx / 2] = '.';
  grid[y + dy][x + dx] = '.';
  stack.push([x + dx, y + dy]);
}

// add loops: remove ~22% of internal walls between two already-open cells
const walls = [];
for (let y = 1; y <= H - 2; y += 2) {
  for (let x = 2; x <= W - 2; x += 2) {
    if (grid[y][x - 1] === '.' && grid[y][x + 1] === '.') walls.push([x, y]);
  }
}
for (let y = 2; y <= H - 2; y += 2) {
  for (let x = 1; x <= W - 2; x += 2) {
    if (grid[y - 1][x] === '.' && grid[y + 1][x] === '.') walls.push([x, y]);
  }
}
for (let i = walls.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [walls[i], walls[j]] = [walls[j], walls[i]];
}
const loops = Math.floor(walls.length * 0.22);
for (let i = 0; i < loops; i++) { const [x, y] = walls[i]; grid[y][x] = '.'; }

// carve rooms (open areas) centred on corridor cells
function room(x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = '.';
}
room(3, 19, 8, 22);    // start-1 room (bottom-left)
room(39, 3, 43, 6);    // start-2 room (top-right)
room(22, 11, 26, 15);  // central room

// markers
const markers = {};
function mark(x, y, c) {
  const k = x + ',' + y;
  if (grid[y][x] === '#') console.log('MARKER ON WALL:', x, y, c);
  if (markers[k]) console.log('MARKER OVERLAP:', x, y, c, 'vs', markers[k]);
  markers[k] = c;
  grid[y][x] = c;
}

mark(5, 21, '1');
mark(41, 5, '2');
mark(24, 13, 'K');
mark(11, 11, 'K');
mark(35, 15, 'K');
mark(23, 1, 'E');
mark(23, 25, 'E');
mark(1, 13, 'E');
mark(45, 13, 'E');

// coins + power-ups on remaining floor cells
const floor = [];
for (let y = 1; y <= H - 2; y++) for (let x = 1; x <= W - 2; x++) {
  if (grid[y][x] === '.' && !markers[x + ',' + y]) floor.push([x, y]);
}
for (let i = floor.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [floor[i], floor[j]] = [floor[j], floor[i]];
}
for (const [x, y] of floor.slice(0, 16)) mark(x, y, 'C');
for (const [x, y] of floor.slice(16, 22)) mark(x, y, 'P');

// ---- validation ----
const rows = grid.map(r => r.join(''));
console.log('rows:', rows.length, 'all length 48:', rows.every(r => r.length === W));

let borderOk = true;
for (let x = 0; x < W; x++) { if (grid[0][x] !== '#' || grid[H - 1][x] !== '#') borderOk = false; }
for (let y = 0; y < H; y++) { if (grid[y][0] !== '#' || grid[y][W - 1] !== '#') borderOk = false; }
console.log('border ok:', borderOk);

let floorCount = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x] !== '#') floorCount++;

const seen = new Set();
const q = [{ x: 5, y: 21 }];
seen.add('5,21');
while (q.length) {
  const { x, y } = q.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const k = nx + ',' + ny;
    if (seen.has(k)) continue;
    if (grid[ny][nx] === '#') continue;
    seen.add(k); q.push({ x: nx, y: ny });
  }
}
console.log('floor cells:', floorCount, 'reachable:', seen.size, 'fully connected:', floorCount === seen.size);

const counts = {};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = grid[y][x];
  if (c !== '.' && c !== '#') counts[c] = (counts[c] || 0) + 1;
}
console.log('markers:', counts);

console.log('--- ROWS ---');
for (const r of rows) console.log("'" + r + "',");
