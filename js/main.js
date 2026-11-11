import { Game, DEFAULT_OPTIONS } from './game.js';
import {
  renderAll, showDialog, hideDialog, setupDialogHtml, replaceDialogHtml,
  harvestStoreDialogHtml, warehouseDialogHtml, gameOverHtml,
  seedmakerDialogHtml, fishDialogHtml, surrenderDialogHtml,
  menuHtml, hostFormHtml, joinFormHtml, connectingHtml, lobbyHtml, messageHtml,
} from './render.js';
import {
  randomCode, normalizeCode, errorText, openRoom, joinRoom, send, snapshot, hydrate,
} from './net.js';

const DATA_FILES = {
  config: 'data/config.json',
  seeds: 'data/seeds.json',
  tools: 'data/tools.json',
  farm: 'data/farm-upgrades.json',
  mine: 'data/mine.json',
  fishing: 'data/fishing.json',
};

const W = 1920, H = 923;
let data;
let game;
let lastSetup = [
  { name: 'Jugador 1', color: 'rojo' },
  { name: 'Jugador 2', color: 'verde' },
];
let lastOptions = { ...DEFAULT_OPTIONS };
let confirmSurrender = null; // jugador que ha pulsado "rendirse" y aún no lo ha confirmado

// Lee las casillas de opciones del diálogo abierto
function readOptions(prev) {
  const extras = document.getElementById('opt-extras');
  const fishing = document.getElementById('opt-fishing');
  if (!extras || !fishing) return prev;
  return { extras: extras.checked, mode: fishing.checked ? 'fishing' : 'mine' };
}

// ---------- estado de la red ----------
// mode: 'local' (todos en este ordenador), 'host' (este navegador ejecuta la partida)
// o 'guest' (este navegador solo pinta lo que manda el anfitrión).
const net = {
  mode: 'local',
  peer: null,
  code: '',
  me: null, // asiento de este ordenador (0 = anfitrión); null = espectador / local
  hostConn: null, // invitado: conexión con el anfitrión
  // anfitrión: jugadores de la sala (el 0 es él mismo) y espectadores
  players: [], // [{ name, color, conn }]
  spectators: [], // [conn]
  options: { ...DEFAULT_OPTIONS }, // opciones elegidas por el anfitrión en la sala
};
const online = () => net.mode !== 'local';
function myName() {
  try { return localStorage.getItem('gs-name') || 'Jugador'; } catch { return 'Jugador'; }
}
function rememberName(n) {
  try { localStorage.setItem('gs-name', n); } catch { /* sin almacenamiento */ }
}

async function loadData() {
  const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, url]) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
    return [key, await res.json()];
  }));
  return Object.fromEntries(entries);
}

// ---------- escalado ----------
// El tablero de juego se escala para caber entero; el fondo se escala para cubrir
// toda la ventana, pegado abajo (la hierba siempre se ve y el cielo se recorta).

function fit() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = Math.min(vw / W, vh / H);
  const stage = document.getElementById('stage');
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(vw - W * s) / 2}px`;
  stage.style.top = `${(vh - H * s) / 2}px`;

  const c = Math.max(vw / W, vh / H);
  const bg = document.getElementById('bg');
  bg.style.transform = `scale(${c})`;
  bg.style.left = `${(vw - W * c) / 2}px`;
  bg.style.top = `${vh - H * c}px`;
}

// ---------- ciclo de pintado ----------

// ¿Puede este ordenador actuar ahora mismo?
const myTurn = () => !online() || (game && game.current === net.me);

function update() {
  if (net.mode === 'host') broadcastState(); // antes de pintar: renderAll consume game.fresh
  renderAll(game, { me: online() ? net.me : null });
  document.body.classList.toggle('watching', game.phase !== 'gameOver' && !myTurn());
  const pr = game.prompts[0];
  if (game.phase === 'gameOver') { confirmSurrender = null; showDialog(gameOverHtml(game, { canRestart: net.mode !== 'guest' })); }
  else if (confirmSurrender !== null) showDialog(surrenderDialogHtml(game, confirmSurrender));
  else if (!myTurn()) hideDialog();
  else if (pr?.type === 'seedmaker') showDialog(seedmakerDialogHtml(game, pr));
  else if (pr?.type === 'fish') showDialog(fishDialogHtml(game));
  else if (pr?.type === 'chooseReplace') showDialog(replaceDialogHtml(game, pr));
  else if (pr?.type === 'harvestStore') showDialog(harvestStoreDialogHtml(game, pr));
  else if (pr?.type === 'chooseStored') showDialog(warehouseDialogHtml(game));
  else hideDialog();
}

function clearBoard() {
  game = null;
  document.body.classList.remove('watching');
  for (const id of ['market', 'player-0', 'player-1', 'log']) document.getElementById(id).innerHTML = '';
}

// ---------- partida local ----------

function showSetup() {
  showDialog(setupDialogHtml(data.config, lastSetup, lastOptions));
}

function startLocalGame() {
  const setup = [0, 1].map((i) => ({
    name: document.getElementById(`name-${i}`).value.trim() || `Jugador ${i + 1}`,
    color: document.getElementById(`color-${i}`).value,
  }));
  if (setup[0].color === setup[1].color) {
    alert('Cada jugador debe tener un color distinto.');
    return;
  }
  lastSetup = setup;
  lastOptions = readOptions(lastOptions);
  confirmSurrender = null;
  game = new Game(data, setup, lastOptions);
  window.game = game; // útil para depurar desde la consola
  update();
}

// ---------- menú ----------

function leaveOnline() {
  net.peer?.destroy();
  Object.assign(net, { mode: 'local', peer: null, code: '', me: null, hostConn: null, players: [], spectators: [], options: { ...lastOptions } });
}

function showMenu() {
  leaveOnline();
  clearBoard();
  showDialog(menuHtml());
}

// ---------- anfitrión ----------

function showHostForm(error = '') {
  showDialog(hostFormHtml(data.config, { name: myName(), color: 'rojo' }, error));
}

function createRoom(code = randomCode(), retry = null) {
  const name = retry?.name ?? (document.getElementById('net-name')?.value.trim() || myName());
  const color = retry?.color ?? (document.getElementById('net-color')?.value || 'rojo');
  rememberName(name);
  leaveOnline();
  net.mode = 'host';
  net.code = code;
  net.me = 0;
  net.players = [{ name, color, conn: null }];
  showDialog(connectingHtml('Creando la sala…'));
  net.peer = openRoom(code, {
    onOpen: () => showLobby(),
    onConnect: () => {}, // se espera al mensaje "hello" con el nombre
    onMessage: hostMessage,
    onClose: hostConnClosed,
    onError: (err) => {
      if (net.mode !== 'host') return;
      if (err.type === 'unavailable-id') { createRoom(randomCode(), { name, color }); return; }
      if (err.type === 'peer-unavailable') return; // un invitado que ya no está
      if (!game && net.players.length === 1) { leaveOnline(); showHostForm(errorText(err)); }
    },
  });
}

// Dirección que se pone en el enlace de invitación. Si el anfitrión ha abierto el juego
// por localhost, ese enlace no sirve a nadie más: se usa la que escribió la última vez.
const LOCAL_HOSTS = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/;
function inviteHost() {
  let saved = '';
  try { saved = localStorage.getItem('gs-invite-host') || ''; } catch { /* sin almacenamiento */ }
  return LOCAL_HOSTS.test(location.hostname) ? saved : location.host;
}
function copyInviteLink() {
  const input = document.getElementById('invite-host');
  const host = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) { input.focus(); input.placeholder = 'Escribe aquí tu IP pública y el puerto'; return; }
  try { localStorage.setItem('gs-invite-host', host); } catch { /* sin almacenamiento */ }
  const link = `${location.protocol}//${host}${location.pathname}?sala=${net.code}`;
  const btn = document.querySelector('[data-act=copyLink]');
  const done = () => { btn.textContent = '¡Copiado!'; };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done);
  else { input.value = link; input.select(); document.execCommand('copy'); done(); }
}

const freeColor = () => Object.keys(data.config.colors).find((c) => !net.players.some((p) => p.color === c));
const seatOf = (conn) => net.players.findIndex((p) => p.conn && p.conn === conn);

function lobbyState(forSeat) {
  return {
    code: net.code,
    inviteHost: inviteHost(),
    players: net.players.map((p) => ({ name: p.name, color: p.color })),
    spectators: net.spectators.length,
    options: net.options,
    me: forSeat,
    isHost: forSeat === 0,
  };
}

function showLobby() {
  if (net.mode !== 'host') return;
  showDialog(lobbyHtml(data.config, lobbyState(0)));
  net.players.forEach((p, i) => send(p.conn, { t: 'lobby', lobby: lobbyState(i) }));
  net.spectators.forEach((c) => send(c, { t: 'lobby', lobby: lobbyState(null) }));
}

function hostMessage(conn, msg) {
  if (msg.t === 'hello') {
    const name = String(msg.name ?? '').trim().slice(0, 16) || 'Invitado';
    if (game) {
      // Partida empezada: si vuelve un jugador desconectado (mismo nombre), recupera su sitio
      const seat = net.players.findIndex((p, i) => i > 0 && !p.conn && p.name === name);
      if (seat > 0) {
        net.players[seat].conn = conn;
        game.say(`${name} se ha vuelto a conectar`);
      } else {
        net.spectators.push(conn);
      }
      update();
      return;
    }
    if (net.players.length < 2) net.players.push({ name, color: freeColor(), conn });
    else net.spectators.push(conn);
    showLobby();
    return;
  }
  const seat = seatOf(conn);
  if (msg.t === 'color' && !game && seat > 0 && data.config.colors[msg.color]
      && !net.players.some((p) => p.color === msg.color)) {
    net.players[seat].color = msg.color;
    showLobby();
  }
  // Rendirse: cada jugador solo puede rendirse a sí mismo, sea o no su turno
  if (msg.t === 'act' && msg.act === 'surrenderYes' && game && seat >= 0) {
    game.surrender(seat);
    update();
    return;
  }
  // Solo se aceptan acciones del jugador al que le toca
  if (msg.t === 'act' && game && seat >= 0 && seat === game.current && GAME_ACTIONS[msg.act]) {
    GAME_ACTIONS[msg.act](msg.arg);
    hideTip();
    update();
  }
}

function hostConnClosed(conn) {
  if (net.mode !== 'host') return;
  net.spectators = net.spectators.filter((c) => c !== conn);
  const seat = seatOf(conn);
  if (seat < 0) { if (!game) showLobby(); return; }
  if (!game) {
    net.players.splice(seat, 1);
    showLobby();
  } else {
    net.players[seat].conn = null;
    game.say(`${net.players[seat].name} se ha desconectado (puede volver con el mismo código y nombre)`);
    update();
  }
}

function startOnlineGame() {
  if (net.mode !== 'host' || net.players.length < 2) return;
  const setup = net.players.map((p) => ({ name: p.name, color: p.color }));
  lastOptions = { ...net.options };
  confirmSurrender = null;
  game = new Game(data, setup, net.options);
  window.game = game;
  update();
}

function broadcastState() {
  const state = snapshot(game);
  net.players.forEach((p, i) => send(p.conn, { t: 'state', state, me: i }));
  net.spectators.forEach((c) => send(c, { t: 'state', state, me: null }));
}

// ---------- invitado ----------

function showJoinForm(error = '', code = '') {
  showDialog(joinFormHtml({ code, name: myName() }, error));
}

function joinGame() {
  const code = normalizeCode(document.getElementById('net-code').value);
  const name = document.getElementById('net-name').value.trim() || myName();
  if (code.length !== 5) { showJoinForm('El código de la sala tiene 5 caracteres.', code); return; }
  rememberName(name);
  leaveOnline();
  net.mode = 'guest';
  net.code = code;
  showDialog(connectingHtml('Conectando con la sala…'));
  let connected = false;
  net.peer = joinRoom(code, {
    onOpen: (conn) => {
      connected = true;
      net.hostConn = conn;
      send(conn, { t: 'hello', name });
    },
    onMessage: guestMessage,
    onClose: () => {
      if (net.mode !== 'guest') return;
      leaveOnline();
      clearBoard();
      showDialog(messageHtml('Conexión perdida', 'Se ha perdido la conexión con el anfitrión. Puedes volver a unirte con el mismo código y nombre.'));
    },
    onError: (err) => {
      if (net.mode !== 'guest' || connected) return;
      leaveOnline();
      showJoinForm(errorText(err), code);
    },
  });
}

function guestMessage(msg) {
  if (msg.t === 'lobby') {
    clearBoard();
    net.me = msg.lobby.me;
    showDialog(lobbyHtml(data.config, msg.lobby));
  }
  if (msg.t === 'state') {
    net.me = msg.me;
    game = hydrate(data, msg.state);
    window.game = game;
    update();
  }
}

// ---------- acciones ----------

const GAME_ACTIONS = {
  select: (i) => game.toggleSelect(i),
  crop: (i) => game.useOnCrop(i),
  mine: () => game.goMine(),
  discard: () => game.discardSelected(),
  endActions: () => game.endActions(),
  pass: () => game.passTurn(),
  buySeed: (i) => game.buySeed(i),
  buyTool: (i) => game.buyTool(i),
  assorted: () => game.useAssorted(),
  advance: () => game.advanceBoard(),
  chooseFarm: (i) => game.chooseFarm(i),
  plot: (i) => game.choosePlot(i),
  replace: (type) => game.chooseReplace(type),
  store: (i) => game.resolveHarvestStore(i),
  storeNone: () => game.resolveHarvestStore(null),
  warehouse: () => game.openWarehouse(),
  stored: (i) => game.chooseStored(i),
  cancel: () => game.cancelPrompt(),
  fish: () => game.goFish(),
  fishMore: () => game.resolveFish(true),
  fishStop: () => game.resolveFish(false),
  smPlant: () => game.resolveSeedmaker('plant'),
  smWarehouse: () => game.resolveSeedmaker('warehouse'),
  smKeep: () => game.resolveSeedmaker('keep'),
};

// Rendirse: pide confirmación en este ordenador y, si se confirma, se aplica
// (en local, al jugador del botón; online, siempre a este ordenador)
const SURRENDER_ACTIONS = {
  surrender: (i) => { if (game && game.phase !== 'gameOver') { confirmSurrender = online() ? net.me : i; update(); } },
  surrenderNo: () => { confirmSurrender = null; update(); },
  surrenderYes: (i) => {
    confirmSurrender = null;
    if (!game) return;
    if (net.mode === 'guest') { send(net.hostConn, { t: 'act', act: 'surrenderYes' }); update(); return; }
    game.surrender(net.mode === 'host' ? net.me : i);
    update();
  },
};

const MENU_ACTIONS = {
  menu: () => showMenu(),
  menuLocal: () => showSetup(),
  menuHost: () => showHostForm(),
  menuJoin: () => showJoinForm(),
  start: () => startLocalGame(),
  createRoom: () => createRoom(),
  joinRoom: () => joinGame(),
  startOnline: () => startOnlineGame(),
  copyLink: () => copyInviteLink(),
  restart: () => {
    if (net.mode === 'host') {
      net.players = net.players.filter((p, i) => i === 0 || p.conn); // fuera los desconectados
      clearBoard();
      showLobby();
    }
    if (net.mode === 'local') { clearBoard(); showSetup(); }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const raw = el.dataset.i;
  const arg = raw !== undefined && raw !== '' && !isNaN(raw) ? Number(raw) : raw;
  if (MENU_ACTIONS[act]) { MENU_ACTIONS[act](arg); return; }
  if (SURRENDER_ACTIONS[act]) { hideTip(); SURRENDER_ACTIONS[act](arg); return; }
  if (!game || !GAME_ACTIONS[act] || !myTurn()) return;
  hideTip();
  if (net.mode === 'guest') { send(net.hostConn, { t: 'act', act, arg }); return; }
  GAME_ACTIONS[act](arg);
  update();
});

document.addEventListener('change', (e) => {
  // Configuración local: un color elegido por un jugador queda deshabilitado para el otro
  if (e.target.matches('.color-select')) {
    const selects = [...document.querySelectorAll('.color-select')];
    for (const sel of selects) {
      const taken = selects.filter((o) => o !== sel).map((o) => o.value);
      for (const opt of sel.options) opt.disabled = taken.includes(opt.value);
    }
  }
  // Sala de espera: recordar la dirección de invitación aunque se repinte la sala
  if (e.target.id === 'invite-host') {
    try { localStorage.setItem('gs-invite-host', e.target.value.trim()); } catch { /* sin almacenamiento */ }
  }
  // Opciones de partida: en la configuración local o en la sala del anfitrión
  if (e.target.id === 'opt-extras' || e.target.id === 'opt-fishing') {
    if (net.mode === 'host' && !game) { net.options = readOptions(net.options); showLobby(); }
    if (net.mode === 'local') lastOptions = readOptions(lastOptions);
  }
  // Sala de espera: cambiar mi color
  if (e.target.id === 'lobby-color') {
    if (net.mode === 'host') { net.players[0].color = e.target.value; showLobby(); }
    if (net.mode === 'guest') send(net.hostConn, { t: 'color', color: e.target.value });
  }
});

// ---------- descripción de mejoras al pasar el ratón ----------

const tip = document.getElementById('tooltip');
function hideTip() { tip.classList.remove('show'); }
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { hideTip(); return; }
  tip.innerHTML = el.dataset.tip;
  tip.classList.add('show');
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
  const top = r.top - t.height - 10 > 8 ? r.top - t.height - 10 : r.bottom + 10;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
});

// ---------- arranque ----------

window.addEventListener('resize', fit);
window.addEventListener('beforeunload', (e) => {
  // Si el anfitrión cierra la pestaña se acaba la partida de todos: se pide confirmación
  if (net.mode === 'host' && game && game.phase !== 'gameOver') e.preventDefault();
});
fit();

try {
  data = await loadData();
  const sala = normalizeCode(new URLSearchParams(location.search).get('sala'));
  if (sala) showJoinForm('', sala);
  else showDialog(menuHtml());
} catch (err) {
  showDialog(`<h2>No se pudieron cargar los datos</h2>
    <p>${err.message}</p>
    <p>Abre el juego desde un servidor local, por ejemplo:<br><code>python3 scripts/serve.py</code></p>`);
}
