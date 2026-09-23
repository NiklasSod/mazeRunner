// Dev tool: generates and validates the hardcoded 16:9 maze map.
// Prints the map rows for pasting into shared/maze.js.
const W = 64, H = 36;

// Vertical wall columns and their open rows (corridor gaps)
const V = {
  10: [3, 4, 12, 21, 22, 29, 30],
  20: [5, 6, 14, 15, 23, 24, 31, 32],
  30: [3, 12, 13, 21, 22, 29, 30],
  40: [5, 6, 14, 15, 23, 24, 31, 32],
  50: [3, 4, 12, 21, 22, 29, 30],
};
// Horizontal wall rows and their open columns (corridor gaps)
const HH = {
  8:  [6, 7, 16, 17, 26, 27, 36, 37, 46, 47, 56, 57],
  16: [6, 7, 16, 17, 26, 27, 36, 37, 46, 47, 56, 57],
  24: [6, 7, 16, 17, 26, 27, 36, 37, 46, 47, 56, 57],
};

const g = Array.from({ length: H }, () => Array(W).fill('.'));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { g[y][x] = '#'; continue; }
    if (HH[y] && !HH[y].includes(x)) g[y][x] = '#';
    else if (V[x] && !V[x].includes(y)) g[y][x] = '#';
  }
}

const S = (x, y, c) => {
  if (g[y][x] !== '.') console.log('MARKER ON NON-FLOOR:', x, y, c, 'was', g[y][x]);
  g[y][x] = c;
};

// Start positions (hardcoded)
S(4, 31, '1');
S(57, 4, '2');

// Key candidates (1 picked randomly per match)
[[26, 20], [12, 12], [48, 28]].forEach(([x, y]) => S(x, y, 'K'));
// Exit candidates (1 picked randomly per match)
[[32, 2], [32, 33], [2, 17], [61, 17]].forEach(([x, y]) => S(x, y, 'E'));

// Coins
const coins = [
  [5, 2], [15, 2], [25, 2], [35, 2], [45, 2], [55, 2],
  [5, 5], [15, 5], [25, 5], [35, 5], [45, 5], [55, 5],
  [5, 10], [15, 10], [35, 10], [45, 10], [55, 10],
  [5, 13], [15, 13], [35, 13], [45, 13], [55, 13],
  [5, 19], [15, 19], [35, 19], [45, 19], [55, 19],
  [5, 22], [15, 22], [35, 22], [45, 22], [55, 22],
  [5, 26], [15, 26], [25, 26], [35, 26], [45, 26], [55, 26],
  [5, 30], [15, 30], [25, 30], [35, 30], [45, 30], [55, 30],
  [5, 33], [15, 33], [35, 33], [45, 33], [55, 33],
];
coins.forEach(([x, y]) => S(x, y, 'C'));

// Power-up spawn points (type randomized per spawn)
const pows = [[15, 3], [45, 3], [15, 33], [45, 33], [32, 17], [32, 23]];
pows.forEach(([x, y]) => S(x, y, 'P'));

// Scattered pillars to break up the open rooms (kept off corridors)
const pillars = [
  [4, 4], [6, 3], [14, 12], [16, 14], [24, 3], [26, 14],
  [34, 12], [36, 14], [44, 3], [46, 12], [54, 12], [56, 14],
];
pillars.forEach(([x, y]) => S(x, y, '#'));

// ---- validation ----
const rows = g.map(r => r.join(''));
console.log('rows:', rows.length, 'all length 64:', rows.every(r => r.length === W));

let floor = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] !== '#') floor++;

const seen = new Set();
const q = [{ x: 4, y: 31 }];
seen.add('4,31');
while (q.length) {
  const { x, y } = q.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const k = nx + ',' + ny;
    if (seen.has(k)) continue;
    if (g[ny][nx] === '#') continue;
    seen.add(k); q.push({ x: nx, y: ny });
  }
}
console.log('floor cells:', floor, 'reachable:', seen.size, 'fully connected:', floor === seen.size);

const counts = {};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = g[y][x];
  if (c !== '.' && c !== '#') counts[c] = (counts[c] || 0) + 1;
}
console.log('markers:', counts);

console.log('--- ROWS ---');
for (const r of rows) console.log("'" + r + "',");
