(() => {
  'use strict';

  const Maze = window.Maze;
  const TILE = Maze.TILE;
  const MAP_W = Maze.MAP_W;
  const MAP_H = Maze.MAP_H;
  const WIDTH = Maze.WIDTH;
  const HEIGHT = Maze.HEIGHT;
  const VIEW_W = 20;                 // visible tiles (zoomed-in view)
  const VIEW_H = VIEW_W * 9 / 16;    // 11.25 tiles -> 16:9
  const VIEW_WPX = VIEW_W * TILE;
  const VIEW_HPX = VIEW_H * TILE;
  const PLAYER_R = 12;

  const POWER_INFO = {
    speed:   { color: '#76ff03', letter: 'S', label: 'Speed',   desc: 'Extra fart' },
    freeze:  { color: '#40c4ff', letter: 'F', label: 'Frys',    desc: 'Fryser motståndaren' },
    steal:   { color: '#ff4081', letter: 'T', label: 'Stöld',   desc: 'Stjäl nyckeln' },
    reverse: { color: '#ab47bc', letter: 'R', label: 'Revers.', desc: 'Vänder kontrollerna' }
  };

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const menu = $('menu'), game = $('game');
  const nameInput = $('nameInput'), playBtn = $('playBtn');
  const recentList = $('recentList');
  const canvas = $('canvas'), ctx = canvas.getContext('2d');
  const timerEl = $('timer');
  const meName = $('meName'), meScore = $('meScore'), meKey = $('meKey'), meDot = $('meDot');
  const oppName = $('oppName'), oppScore = $('oppScore'), oppKey = $('oppKey'), oppDot = $('oppDot');
  const inventory = $('inventory');
  const toastEl = $('toast');
  const overlay = $('overlay'), overlayText = $('overlayText'), overlaySub = $('overlaySub');
  const againBtn = $('againBtn'), menuBtn = $('menuBtn');

  // ---- state ----
  let socket = null;
  let state = null;
  let myId = null;
  let myName = '';
  let keys = {};
  let lastSentInput = '0,0';
  let toastTimer = null;
  let camX = 0, camY = 0, scale = 2;
  let time = 0;

  // ---- touch / virtual joystick -------
  let touchId = null;        // active touch identifier
  let touchActive = false;   // joystick engaged (dragged past deadzone)
  let touchStartCX = 0, touchStartCY = 0;
  let touchCurCX = 0, touchCurCY = 0;
  let touchDir = { dx: 0, dy: 0 };
  let touchStartTime = 0;
  const TAP_MAX_MOVE = 12;   // px (canvas space) before a touch counts as a drag
  const TAP_MAX_MS = 350;    // ms before it's no longer a tap
  const JOY_DEADZONE = 10;   // px (canvas space) before movement engages

  // ---- helpers ----
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadRecent() {
    fetch('/api/recent')
      .then((r) => r.json())
      .then((list) => {
        recentList.innerHTML = '';
        if (!list.length) {
          recentList.innerHTML = '<li>Inga matcher ännu</li>';
          return;
        }
        for (const m of list) {
          const li = document.createElement('li');
          li.innerHTML =
            '<span class="win">' + esc(m.winnerName) + ' (' + m.winnerScore + ')</span>' +
            '<span>' + secToTime(m.duration) + '</span>' +
            '<span class="lose">' + esc(m.loserName) + ' (' + m.loserScore + ')</span>';
          recentList.appendChild(li);
        }
      })
      .catch(() => {});
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function secToTime(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return m + ':' + String(ss).padStart(2, '0');
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function ensureSocket() {
    if (socket) return socket;
    socket = io();

    socket.on('searching', () => {
      showOverlay('Söker motståndare…', 'Du hamnar i kö för nästa match.');
    });

    socket.on('state', (s) => {
      state = s;
      if (!myId) myId = s.you;
      handleState();
    });

    socket.on('event', (e) => showToast(e.message));

    socket.on('disconnect', () => {
      showOverlay('Anslutningen bröts', 'Prova att ladda om sidan.');
    });

    return socket;
  }

  // ---- screens ----
  function showMenu() {
    menu.classList.remove('hidden');
    game.classList.add('hidden');
    loadRecent();
  }

  function showGame() {
    menu.classList.add('hidden');
    game.classList.remove('hidden');
  }

  function showOverlay(text, sub) {
    overlay.classList.remove('hidden');
    overlayText.textContent = text || '';
    overlaySub.textContent = sub || '';
    againBtn.classList.add('hidden');
    menuBtn.classList.add('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function handleState() {
    if (!state) return;
    if (state.phase === 'countdown') {
      showGame();
      inventory.classList.add('hidden');
      showOverlay('Matchen startar om ' + (state.countdown > 0 ? state.countdown : '…'), '');
    } else if (state.phase === 'playing') {
      hideOverlay();
      inventory.classList.remove('hidden');
    } else if (state.phase === 'ended') {
      showResult();
    }
    updateHud();
  }

  function showResult() {
    const me = state.players.find((p) => p.id === myId);
    const opp = state.players.find((p) => p.id !== myId);
    const iWon = state.winner === myId;

    let text = 'Oavgjort', sub = '';
    if (state.reason === 'disconnect') {
      text = iWon ? 'Du vann!' : 'Motståndaren lämnade';
      sub = 'Motståndaren kopplade ifrån.';
    } else if (state.winner) {
      text = iWon ? 'Du vann! 🎉' : 'Du förlorade';
      sub = (iWon ? 'Du ' : (opp ? opp.name + ' ' : '') + '') + 'nådde utgången först.';
    }

    if (me && opp) {
      sub = (me.name + ' ' + me.finalScore + ' — ' + opp.finalScore + ' ' + opp.name);
    }

    overlayText.textContent = text;
    overlaySub.textContent = sub;
    againBtn.classList.remove('hidden');
    menuBtn.classList.remove('hidden');
    inventory.classList.add('hidden');
    overlay.classList.remove('hidden');
  }

  function updateHud() {
    if (!state || !state.players) return;
    const me = state.players.find((p) => p.id === myId);
    const opp = state.players.find((p) => p.id !== myId);

    if (me) {
      meName.textContent = me.name;
      meScore.textContent = me.score;
      meKey.classList.toggle('hidden', !me.hasKey);
      meDot.style.background = me.color;
      renderInventory(me);
    }
    if (opp) {
      oppName.textContent = opp.name;
      oppScore.textContent = opp.score;
      oppKey.classList.toggle('hidden', !opp.hasKey);
      oppDot.style.background = opp.color;
    }

    const t = Math.max(0, Math.ceil(state.remaining));
    timerEl.textContent = secToTime(t);
    timerEl.classList.toggle('ot', !!state.overtime);
  }

  function renderInventory(me) {
    inventory.innerHTML = '';
    for (let i = 0; i < 1; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (me.inv[i] ? '' : ' empty');
      const type = me.inv[i];
      if (type && POWER_INFO[type]) {
        const pi = POWER_INFO[type];
        slot.innerHTML =
          '<div style="color:' + pi.color + '">' + pi.letter + '</div>' +
          '<div class="lbl">' + pi.label + '</div>';
      } else {
        slot.textContent = '·';
      }
      slot.innerHTML += '<div class="key-hint">[Q]</div>';
      inventory.appendChild(slot);
    }
  }

  // ---- input ----
  function dirFromVector(dx, dy) {
    if (Math.hypot(dx, dy) < 1) return { dx: 0, dy: 0 };
    const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const d = dirs[((oct % 8) + 8) % 8];
    return { dx: d[0], dy: d[1] };
  }

  function currentInput() {
    if (touchActive) return { dx: touchDir.dx, dy: touchDir.dy };
    let dx = 0, dy = 0;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    return { dx, dy };
  }

  function sendInput() {
    if (!socket || !state || state.phase !== 'playing') return;
    const i = currentInput();
    const k = i.dx + ',' + i.dy;
    if (k !== lastSentInput) {
      lastSentInput = k;
      socket.emit('input', i);
    }
  }

  function usePower(slot) {
    if (!socket || !state || state.phase !== 'playing') return;
    const me = state.players.find((p) => p.id === myId);
    if (me && me.inv[slot]) socket.emit('usePower', slot);
  }

  // ---- touch / virtual joystick -------
  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function onTouchStart(e) {
    if (touchId !== null) return; // already tracking one finger
    const t = e.changedTouches[0];
    touchId = t.identifier;
    touchActive = false;
    const p = canvasPoint(t.clientX, t.clientY);
    touchStartCX = p.x; touchStartCY = p.y;
    touchCurCX = p.x; touchCurCY = p.y;
    touchStartTime = Date.now();
    touchDir = { dx: 0, dy: 0 };
    e.preventDefault();
  }

  function onTouchMove(e) {
    if (touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      const p = canvasPoint(t.clientX, t.clientY);
      touchCurCX = p.x; touchCurCY = p.y;
      const dx = touchCurCX - touchStartCX, dy = touchCurCY - touchStartCY;
      const d = Math.hypot(dx, dy);
      if (!touchActive && d > JOY_DEADZONE) touchActive = true;
      if (touchActive) touchDir = dirFromVector(dx, dy);
      e.preventDefault();
      return;
    }
  }

  function onTouchEnd(e) {
    if (touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touchId) continue;
      const dx = touchCurCX - touchStartCX, dy = touchCurCY - touchStartCY;
      const moved = Math.hypot(dx, dy);
      const dur = Date.now() - touchStartTime;
      if (!touchActive && moved < TAP_MAX_MOVE && dur < TAP_MAX_MS) {
        usePower(0); // tap anywhere activates the power-up
      }
      touchId = null;
      touchActive = false;
      touchDir = { dx: 0, dy: 0 };
      return;
    }
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'q' || k === '1') usePower(0);
    if (k === 'enter' && overlay.classList.contains('hidden') === false && state && state.phase === 'ended') playAgain();
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // ---- actions ----
  function tryFullscreen() {
    const el = document.documentElement;
    try {
      let p = null;
      if (el.requestFullscreen) p = el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* not supported, ignore */ }
  }

  function playAgain() {
    myId = null;
    state = null;
    lastSentInput = '0,0';
    hideOverlay();
    showOverlay('Söker motståndare…', 'Du hamnar i kö för nästa match.');
    ensureSocket().emit('join', { name: myName });
  }

  playBtn.addEventListener('click', () => {
    myName = nameInput.value.trim() || 'Spelare';
    showGame();
    tryFullscreen();
    showOverlay('Söker motståndare…', 'Du hamnar i kö för nästa match.');
    ensureSocket().emit('join', { name: myName });
  });

  againBtn.addEventListener('click', playAgain);
  menuBtn.addEventListener('click', showMenu);

  // ---- rendering ----
  function toScreen(wx, wy) {
    return { x: (wx - camX) * scale, y: (wy - camY) * scale };
  }

  function drawKeyIcon(sx, sy, size) {
    ctx.save();
    ctx.font = size + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur = 14;
    ctx.fillText('🔑', sx, sy + size * 0.06);
    ctx.restore();
  }

  function drawExit(exit) {
    const p = toScreen(exit.x, exit.y);
    const s = TILE * scale;
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time / 300);
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(p.x - s * 0.4, p.y - s * 0.4, s * 0.8, s * 0.8);
    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth = 3;
    ctx.strokeRect(p.x - s * 0.4, p.y - s * 0.4, s * 0.8, s * 0.8);
    ctx.restore();
    ctx.fillStyle = '#a5d6a7';
    ctx.font = 'bold ' + (s * 0.32) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('UT', p.x, p.y);
  }

  function drawCoin(c) {
    const p = toScreen(c.x, c.y);
    const r = 4 * scale;
    const pulse = 1 + 0.18 * Math.sin(time / 220 + c.id);
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd54f';
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  function drawPowerup(pu) {
    const pi = POWER_INFO[pu.type];
    if (!pi) return;
    const p = toScreen(pu.x, pu.y);
    const s = TILE * scale * 0.42;
    const pulse = 1 + 0.1 * Math.sin(time / 250 + pu.id);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(10,14,26,0.85)';
    roundRect(-s, -s, s * 2, s * 2, 6);
    ctx.fill();
    ctx.strokeStyle = pi.color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = pi.color;
    ctx.shadowBlur = 10;
    roundRect(-s, -s, s * 2, s * 2, 6);
    ctx.stroke();
    ctx.fillStyle = pi.color;
    ctx.font = 'bold ' + (s * 1.4) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pi.letter, 0, 1);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayer(p, me) {
    const s = toScreen(p.x, p.y);
    const r = PLAYER_R * scale;

    // effect rings
    if (p.speed) ring(s.x, s.y, r + 5 * scale, '#76ff03');
    if (p.frozen) ring(s.x, s.y, r + 7 * scale, '#40c4ff', 0.8);
    if (p.reversed) ring(s.x, s.y, r + 7 * scale, '#ab47bc', 0.8);

    // body
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.lineWidth = p.id === myId ? 3 : 1.5;
    ctx.strokeStyle = p.id === myId ? '#ffffff' : 'rgba(0,0,0,0.5)';
    ctx.stroke();
    ctx.restore();

    // facing nose
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(p.facing);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(r * 0.4, -r * 0.45);
    ctx.lineTo(r * 0.4, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // name
    ctx.fillStyle = '#eaf1ff';
    ctx.font = 'bold ' + Math.max(11, 13 * scale) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(p.name, s.x, s.y - r - 6 * scale);

    // key badge
    if (p.hasKey) drawKeyIcon(s.x, s.y - r - 20 * scale, 16 * scale);
  }

  function ring(x, y, r, color, alpha = 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawCompass(me, target) {
    const ang = Math.atan2(target.y - me.y, target.x - me.x);
    const s = toScreen(me.x, me.y);
    const rad = (PLAYER_R + 16) * scale;
    const ax = s.x + Math.cos(ang) * rad;
    const ay = s.y + Math.sin(ang) * rad;
    drawArrow(ax, ay, ang, '#ffd54f', 12 * scale);
  }

  function drawArrow(x, y, ang, color, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, -size * 0.6);
    ctx.lineTo(-size * 0.6, size * 0.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  // Place an arrow at the edge of the screen pointing from origin toward target.
  function drawEdgeArrow(originWx, originWy, targetWx, targetWy, color, label) {
    const o = toScreen(originWx, originWy);
    const t = toScreen(targetWx, targetWy);
    const dx = t.x - o.x, dy = t.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const ang = Math.atan2(dy, dx);
    const margin = 70;
    const minX = margin, maxX = canvas.width - margin;
    const minY = margin, maxY = canvas.height - margin;
    let k = Infinity;
    const candidates = [];
    if (dx > 0) candidates.push((maxX - o.x) / dx);
    if (dx < 0) candidates.push((minX - o.x) / dx);
    if (dy > 0) candidates.push((maxY - o.y) / dy);
    if (dy < 0) candidates.push((minY - o.y) / dy);
    for (const c of candidates) if (c > 0 && c < k) k = c;
    if (!isFinite(k)) return;
    const ex = o.x + dx * k, ey = o.y + dy * k;
    drawArrow(ex, ey, ang, color, 15 * scale);
    ctx.fillStyle = color;
    ctx.font = 'bold ' + Math.max(11, 14 * scale) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label + ' ' + Math.round(dist / TILE) + 'm', ex, ey + 18 * scale);
  }

  function render() {
    time += 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!state || state.phase === 'ended' || state.phase === 'countdown') {
      // still draw a subtle background grid behind overlay
      return;
    }

    const me = state.players.find((p) => p.id === myId);
    if (!me) return;

    scale = canvas.width / VIEW_WPX;
    camX = clamp(me.x - VIEW_WPX / 2, 0, WIDTH - VIEW_WPX);
    camY = clamp(me.y - VIEW_HPX / 2, 0, HEIGHT - VIEW_HPX);

    // tiles
    const tx0 = Math.floor(camX / TILE), tx1 = Math.ceil((camX + VIEW_WPX) / TILE);
    const ty0 = Math.floor(camY / TILE), ty1 = Math.ceil((camY + VIEW_HPX) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const sx = (tx * TILE - camX) * scale, sy = (ty * TILE - camY) * scale, sz = TILE * scale;
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) {
          ctx.fillStyle = '#05070d';
          ctx.fillRect(sx, sy, sz, sz);
          continue;
        }
        if (Maze.isWall(tx, ty)) {
          ctx.fillStyle = '#2b3554';
          ctx.fillRect(sx, sy, sz, sz);
          ctx.fillStyle = '#3d4a75';
          ctx.fillRect(sx, sy, sz, sz * 0.16);
          ctx.fillStyle = '#1c2440';
          ctx.fillRect(sx, sy + sz * 0.86, sz, sz * 0.14);
        } else {
          ctx.fillStyle = '#151b30';
          ctx.fillRect(sx, sy, sz, sz);
          ctx.strokeStyle = 'rgba(255,255,255,0.025)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
        }
      }
    }

    // exit pad
    drawExit(state.exit);

    // pickups
    for (const c of state.coins) drawCoin(c);
    for (const pu of state.powerups) drawPowerup(pu);

    // key on floor
    if (!state.key.holder) drawKeyIcon(
      (state.key.x - camX) * scale,
      (state.key.y - camY) * scale - 4 * scale,
      26 * scale
    );

    // players (me last so I'm on top)
    const opp = state.players.find((p) => p.id !== myId);
    if (opp) drawPlayer(opp, me);
    drawPlayer(me, me);

    // compass to key holder (shown to the player who doesn't hold the key)
    if (state.key.holder && state.key.holder !== myId && opp) {
      drawCompass(me, opp);
    }

    // guide arrows in endgame / overtime
    if (state.help) {
      const keyTarget = state.key.holder
        ? state.players.find((p) => p.id === state.key.holder)
        : state.key;
      if (keyTarget) drawEdgeArrow(me.x, me.y, keyTarget.x, keyTarget.y, '#ffd54f', 'K');
      drawEdgeArrow(me.x, me.y, state.exit.x, state.exit.y, '#66bb6a', 'E');
    }

    drawJoystick();
  }

  function drawJoystick() {
    if (touchId === null) return;
    const baseR = 46;
    ctx.save();
    ctx.beginPath();
    ctx.arc(touchStartCX, touchStartCY, baseR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    let kx = touchCurCX - touchStartCX, ky = touchCurCY - touchStartCY;
    const kd = Math.hypot(kx, ky);
    const maxR = baseR * 0.6;
    if (kd > maxR) { kx = kx / kd * maxR; ky = ky / kd * maxR; }
    ctx.beginPath();
    ctx.arc(touchStartCX + kx, touchStartCY + ky, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    ctx.restore();
  }

  function loop() {
    sendInput();
    render();
    requestAnimationFrame(loop);
  }

  // ---- init ----
  loadRecent();
  requestAnimationFrame(loop);
})();
