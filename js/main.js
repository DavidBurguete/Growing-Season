import { Game, DEFAULT_OPTIONS, forcesExtras, shuffle } from './game.js';
import { cpuStep } from './cpu.js';
import { t, setLang, getLang, loc } from './i18n.js';
import { computeAwards } from './stats.js';
import {
  initAccount, submitResult, clearPending, resultInfo, refreshAccountUi,
} from './account.js';
import {
  renderAll, showDialog, hideDialog, setupDialogHtml, replaceDialogHtml,
  harvestStoreDialogHtml, warehouseDialogHtml, gameOverHtml, localChoiceHtml,
  fishDialogHtml, surrenderDialogHtml, renderLangPicker, goStatsSlide, statsSlideBy,
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
  { name: '', color: 'rojo' }, // nombre vacío = el de por defecto en el idioma elegido
  { name: '', color: 'verde' },
];
// Partida local: contra otra persona ('human') o contra la CPU ('cpu', con su nivel).
// El primer jugador (el "anfitrión") siempre es una persona.
let localMode = 'human';
let lastCpuLevel = 'medium';
let lastOptions = { ...DEFAULT_OPTIONS };
let confirmSurrender = null; // jugador que ha pulsado "rendirse" y aún no lo ha confirmado

// Lee las casillas de opciones del diálogo abierto
function readOptions(prev) {
  const extras = document.getElementById('opt-extras');
  const fishing = document.getElementById('opt-fishing');
  const length = document.getElementById('opt-length');
  if (!extras || !fishing || !length) return prev;
  return { extras: extras.checked || forcesExtras(length.value), mode: fishing.checked ? 'fishing' : 'mine', length: length.value };
}

// La partida larga obliga a jugar con las mejoras extra: se marca y bloquea la casilla
// sin repintar el diálogo (así no se pierden los nombres escritos)
function syncExtrasBox() {
  const extras = document.getElementById('opt-extras');
  const length = document.getElementById('opt-length');
  if (!extras || !length || length.disabled) return;
  const locked = forcesExtras(length.value);
  if (locked) extras.checked = true;
  extras.disabled = locked;
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
  order: [], // orden de juego sorteado: order[asiento] = índice en la sala
  options: { ...DEFAULT_OPTIONS }, // opciones elegidas por el anfitrión en la sala
};
const online = () => net.mode !== 'local';

// Latido: PeerJS no siempre avisa cuando el otro navegador se cierra de golpe. Cada ordenador
// manda un "ping" cada HEARTBEAT ms; si no llega nada en TIMEOUT ms, se da la conexión por perdida.
const HEARTBEAT = 2000, TIMEOUT = 10000;
let heartbeat = null;
function startHeartbeat(fn) {
  clearInterval(heartbeat);
  heartbeat = setInterval(fn, HEARTBEAT);
}
function myName() {
  try { return localStorage.getItem('gs-name') || t('net.defaultName'); } catch { return t('net.defaultName'); }
}
function rememberName(n) {
  try { localStorage.setItem('gs-name', n); } catch { /* sin almacenamiento */ }
}

async function loadData() {
  const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, url]) => {
    const res = await fetch(url, { cache: 'no-cache' }); // siempre la última versión de los datos
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

// ¿Puede este ordenador actuar ahora mismo? (en el turno de la CPU, nadie)
const myTurn = () => (!online() || (game && game.current === net.me)) && !game?.player?.cpu;

// ---------- CPU ----------
// En el turno de una CPU se hace una acción cada CPU_DELAY ms, para que se vea lo que hace.
// Se para mientras está abierta la confirmación de rendirse.
const CPU_DELAY = 750;
let cpuTimer = null;
// En una partida online la CPU solo aparece si se desconecta un invitado; la mueve el anfitrión.
function scheduleCpu() {
  if (cpuTimer || !game || net.mode === 'guest' || game.phase === 'gameOver' || !game.player.cpu || confirmSurrender !== null) return;
  const g = game;
  cpuTimer = setTimeout(() => {
    cpuTimer = null;
    if (game !== g || confirmSurrender !== null) return;
    hideTip();
    cpuStep(game);
    update();
  }, CPU_DELAY);
}
function stopCpu() {
  clearTimeout(cpuTimer);
  cpuTimer = null;
}

// Pantallas fuera de la partida (menú, formularios, sala…): se guarda cómo pintarlas
// para poder repintarlas al cambiar de idioma.
let screen = null;
function showScreen(fn) {
  screen = fn;
  showDialog(fn());
}

// Cambio de idioma: se repinta todo conservando lo que se haya escrito en el diálogo abierto
function switchLang(l) {
  if (l === getLang()) return;
  const form = readSetupForm();
  if (form) { lastSetup = form; lastOptions = readOptions(lastOptions); }
  const fields = [...document.querySelectorAll('#overlay input[id], #overlay select[id]')]
    .filter((el) => !/^name-\d$/.test(el.id))
    .map((el) => [el.id, el.type === 'checkbox' ? el.checked : el.value, el.disabled]);
  setLang(l);
  renderLangPicker();
  refreshAccountUi();
  if (game) { update(); return; }
  if (!screen) return;
  showDialog(screen());
  for (const [id, v, disabled] of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
    el.disabled = disabled;
  }
}

function update() {
  screen = null;
  if (net.mode === 'host') broadcastState(); // antes de pintar: renderAll consume game.fresh
  renderAll(game, { me: online() ? net.me : null });
  document.body.classList.toggle('watching', game.phase !== 'gameOver' && !myTurn());
  const pr = game.prompts[0];
  if (game.phase === 'gameOver') {
    confirmSurrender = null;
    const account = recordResult();
    showDialog(gameOverHtml(game, { canRestart: net.mode !== 'guest', me: online() ? net.me : null, account }));
  }
  else if (confirmSurrender !== null) showDialog(surrenderDialogHtml(game, confirmSurrender));
  else if (!myTurn()) hideDialog();
  else if (pr?.type === 'fish') showDialog(fishDialogHtml(game), 'fishing');
  else if (pr?.type === 'chooseReplace') showDialog(replaceDialogHtml(game, pr));
  else if (pr?.type === 'harvestStore') showDialog(harvestStoreDialogHtml(game, pr));
  else if (pr?.type === 'chooseStored') showDialog(warehouseDialogHtml(game));
  else hideDialog();
  scheduleCpu();
}

// Cuentas: solo cuentan las partidas online, para el jugador de este ordenador (no los espectadores).
// Devuelve el estado de guardado para la pantalla final (null si no hay nada que guardar).
function recordResult() {
  if (!online() || net.me === null || !game.players[net.me] || !game.id) return null;
  const me = game.players[net.me];
  const awards = computeAwards(game)[net.me];
  submitResult({
    gameId: game.id,
    length: game.options.length,
    mode: game.options.mode,
    won: game.winners.some((w) => w.color === me.color), // la victoria compartida cuenta como victoria
    titles: awards.titles,
    achievements: awards.achievements,
  });
  const info = resultInfo(game.id);
  return info && { ...info, me: net.me };
}

// Nombre de la cuenta: al iniciar sesión rellena los formularios; al cambiarlo desde el perfil
// (live) también cambia en la sala o en la partida en curso, para todos (sin anotarlo en el registro).
function applyAccountName(name, { live }) {
  rememberName(name);
  lastSetup[0].name = name;
  for (const id of ['net-name', 'name-0']) {
    const el = document.getElementById(id);
    if (el && !el.disabled) el.value = name;
  }
  if (!live) return;
  if (net.mode === 'guest') { send(net.hostConn, { t: 'rename', name }); return; }
  if (net.mode === 'host') { renamePlayer(0, name); return; }
  // Partida local contra la CPU: el jugador humano
  if (game && localMode === 'cpu') {
    const human = game.players.find((p) => !p.cpu);
    if (human) { human.name = name; update(); }
  }
}

// Anfitrión: cambia el nombre de un jugador de la sala (y de la partida, si ha empezado)
function renamePlayer(seat, raw) {
  const name = String(raw ?? '').trim().slice(0, 16);
  if (!name || !net.players[seat]) return;
  net.players[seat].name = name;
  if (!game) { showLobby(); return; }
  const gp = game.players[gameSeat(seat)];
  if (gp) gp.name = name;
  update();
}

function clearBoard() {
  stopCpu();
  game = null;
  document.body.classList.remove('watching');
  for (const id of ['market', 'player-0', 'player-1', 'log']) document.getElementById(id).innerHTML = '';
}

// ---------- partida local ----------

function showLocalChoice() {
  showScreen(() => localChoiceHtml());
}

function showSetup(mode = localMode) {
  localMode = mode;
  showScreen(() => setupDialogHtml(data.config, lastSetup, lastOptions, { cpu: localMode === 'cpu' ? lastCpuLevel : null }));
}

// Lee el formulario de partida local (si está abierto). Un nombre igual al de por defecto
// se guarda vacío, para que cambie con el idioma. Contra la CPU, el segundo jugador no tiene nombre.
function readSetupForm() {
  if (!document.getElementById('name-0')) return null;
  const level = document.getElementById('cpu-1')?.value;
  if (level) lastCpuLevel = level;
  return [0, 1].map((i) => {
    const name = document.getElementById(`name-${i}`)?.value.trim() ?? lastSetup[i].name;
    return {
      name: name === t('setup.defaultName', { n: i + 1 }) ? '' : name,
      color: document.getElementById(`color-${i}`).value,
    };
  });
}

// Nombre de un jugador CPU: se traduce al pintar (cambia con el idioma)
const cpuName = (level) => ({ key: 'player.cpu', params: { level: { key: `cpu.${level}` } } });

// Primera línea del registro (antes de "Turno de …"): el orden sorteado
function logOrder(g, setup) {
  g.log.unshift({ key: 'order', params: { names: setup.map((p) => p.name) }, kind: 'turn', turn: 0, who: null });
}

function startLocalGame() {
  const form = readSetupForm();
  if (form[0].color === form[1].color) {
    alert(t('setup.sameColor'));
    return;
  }
  lastSetup = form; // el formulario conserva el orden escrito
  const vsCpu = localMode === 'cpu';
  const setup = form.map((p, i) => (vsCpu && i === 1
    ? { color: p.color, name: cpuName(lastCpuLevel), cpu: lastCpuLevel }
    : { color: p.color, name: p.name || t('setup.defaultName', { n: i + 1 }), cpu: null }));
  lastOptions = readOptions(lastOptions);
  confirmSurrender = null;
  clearPending();
  stopCpu();
  // Orden aleatorio: cada jugador conserva su nombre y color, solo cambia quién empieza
  const order = shuffle([...setup]);
  game = new Game(data, order, lastOptions);
  logOrder(game, order);
  window.game = game; // útil para depurar desde la consola
  update();
}

// ---------- menú ----------

function leaveOnline() {
  clearInterval(heartbeat);
  heartbeat = null;
  net.peer?.destroy();
  Object.assign(net, { mode: 'local', peer: null, code: '', me: null, hostConn: null, players: [], spectators: [], order: [], options: { ...lastOptions } });
}

function showMenu() {
  leaveOnline();
  clearBoard();
  showScreen(() => menuHtml());
}

// ---------- anfitrión ----------

// Los errores se pasan como función para que se traduzcan de nuevo si cambia el idioma
const errorMsg = (error) => (typeof error === 'function' ? error() : error);

function showHostForm(error = '') {
  const name = document.getElementById('net-name')?.value.trim() || myName();
  const color = document.getElementById('net-color')?.value || 'rojo';
  showScreen(() => hostFormHtml(data.config, { name, color }, errorMsg(error)));
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
  showScreen(() => connectingHtml(t('host.creating')));
  startHeartbeat(() => {
    const now = Date.now();
    for (const conn of [...net.players.map((p) => p.conn), ...net.spectators]) {
      if (!conn) continue;
      send(conn, { t: 'ping' });
      if (now - (conn.lastSeen ?? now) > TIMEOUT) { conn.close(); hostConnClosed(conn); }
    }
  });
  net.peer = openRoom(code, {
    onOpen: () => showLobby(),
    onConnect: (conn) => { conn.lastSeen = Date.now(); }, // se espera al mensaje "hello" con el nombre
    onMessage: hostMessage,
    onClose: hostConnClosed,
    onError: (err) => {
      if (net.mode !== 'host') return;
      if (err.type === 'unavailable-id') { createRoom(randomCode(), { name, color }); return; }
      if (err.type === 'peer-unavailable') return; // un invitado que ya no está
      if (!game && net.players.length === 1) { leaveOnline(); showHostForm(() => errorText(err)); }
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
  if (!host) { input.focus(); input.placeholder = t('lobby.invitePlaceholder'); return; }
  try { localStorage.setItem('gs-invite-host', host); } catch { /* sin almacenamiento */ }
  const link = `${location.protocol}//${host}${location.pathname}?sala=${net.code}`;
  const btn = document.querySelector('[data-act=copyLink]');
  const done = () => { btn.textContent = t('lobby.copied'); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done);
  else { input.value = link; input.select(); document.execCommand('copy'); done(); }
}

const freeColor = () => Object.keys(data.config.colors).find((c) => !net.players.some((p) => p.color === c));
const seatOf = (conn) => net.players.findIndex((p) => p.conn && p.conn === conn);
// Los jugadores de la sala (net.players) conservan su índice; al empezar se sortea el orden
// de juego. net.order[asientoDeJuego] = índice en la sala.
const gameSeat = (lobbyIndex) => (game ? net.order.indexOf(lobbyIndex) : lobbyIndex);

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
  showScreen(() => lobbyHtml(data.config, lobbyState(0)));
  net.players.forEach((p, i) => send(p.conn, { t: 'lobby', lobby: lobbyState(i) }));
  net.spectators.forEach((c) => send(c, { t: 'lobby', lobby: lobbyState(null) }));
}

function hostMessage(conn, msg) {
  conn.lastSeen = Date.now();
  if (msg.t === 'ping') return;
  if (msg.t === 'bye') { hostConnClosed(conn); return; }
  if (msg.t === 'hello') {
    const name = String(msg.name ?? '').trim().slice(0, 16) || t('net.guestName');
    if (game) {
      // Partida empezada: si vuelve un jugador desconectado (mismo nombre), recupera su sitio
      const seat = net.players.findIndex((p, i) => i > 0 && !p.conn && p.name === name);
      if (seat > 0) {
        net.players[seat].conn = conn;
        // Recupera el control (aunque la CPU esté a mitad de su turno)
        const gp = game.players[gameSeat(seat)];
        if (gp.standIn) { gp.cpu = null; gp.standIn = false; }
        game.say('reconnected', { name });
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
  if (msg.t === 'rename' && seat > 0) { renamePlayer(seat, msg.name); return; }
  if (msg.t === 'color' && !game && seat > 0 && data.config.colors[msg.color]
      && !net.players.some((p) => p.color === msg.color)) {
    net.players[seat].color = msg.color;
    showLobby();
  }
  // Rendirse: cada jugador solo puede rendirse a sí mismo, sea o no su turno
  if (msg.t === 'act' && msg.act === 'surrenderYes' && game && seat >= 0) {
    game.surrender(gameSeat(seat));
    update();
    return;
  }
  // Solo se aceptan acciones del jugador al que le toca
  if (msg.t === 'act' && game && seat >= 0 && gameSeat(seat) === game.current && GAME_ACTIONS[msg.act]) {
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
    // Mientras no vuelva, juega por él una CPU de nivel medio
    const gp = game.players[gameSeat(seat)];
    if (game.phase !== 'gameOver' && !gp.cpu) {
      gp.cpu = 'medium';
      gp.standIn = true;
      game.say('disconnectedCpu', { name: net.players[seat].name, level: { key: 'cpu.medium' } }, 'turn', gameSeat(seat));
    } else {
      game.say('disconnected', { name: net.players[seat].name });
    }
    update();
  }
}

function startOnlineGame() {
  if (net.mode !== 'host' || net.players.length < 2) return;
  // Orden aleatorio: cada ordenador conserva su nombre y color, solo cambia quién empieza
  net.order = shuffle(net.players.map((_, i) => i));
  const setup = net.order.map((i) => ({ name: net.players[i].name, color: net.players[i].color }));
  lastOptions = { ...net.options };
  confirmSurrender = null;
  clearPending();
  game = new Game(data, setup, net.options);
  logOrder(game, setup);
  net.me = gameSeat(0);
  window.game = game;
  update();
}

function broadcastState() {
  const state = snapshot(game);
  net.players.forEach((p, i) => send(p.conn, { t: 'state', state, me: gameSeat(i) }));
  net.spectators.forEach((c) => send(c, { t: 'state', state, me: null }));
}

// ---------- invitado ----------

function showJoinForm(error = '', code = '') {
  const name = document.getElementById('net-name')?.value.trim() || myName();
  showScreen(() => joinFormHtml({ code, name }, errorMsg(error)));
}

function joinGame() {
  const code = normalizeCode(document.getElementById('net-code').value);
  const name = document.getElementById('net-name').value.trim() || myName();
  if (code.length !== 5) { showJoinForm(() => t('join.badCode'), code); return; }
  rememberName(name);
  leaveOnline();
  net.mode = 'guest';
  net.code = code;
  showScreen(() => connectingHtml(t('join.connecting')));
  let connected = false;
  net.peer = joinRoom(code, {
    onOpen: (conn) => {
      connected = true;
      net.hostConn = conn;
      conn.lastSeen = Date.now();
      send(conn, { t: 'hello', name });
      startHeartbeat(() => {
        send(conn, { t: 'ping' });
        if (Date.now() - conn.lastSeen > TIMEOUT) hostLost();
      });
    },
    onMessage: guestMessage,
    onClose: () => hostLost(),
    onError: (err) => {
      if (net.mode !== 'guest' || connected) return;
      leaveOnline();
      showJoinForm(() => errorText(err), code);
    },
  });
}

function hostLost() {
  if (net.mode !== 'guest') return;
  leaveOnline();
  clearBoard();
  showScreen(() => messageHtml(t('lost.title'), t('lost.text')));
}

function guestMessage(msg) {
  if (net.hostConn) net.hostConn.lastSeen = Date.now();
  if (msg.t === 'ping') return;
  if (msg.t === 'lobby') {
    clearBoard();
    net.me = msg.lobby.me;
    showScreen(() => lobbyHtml(data.config, msg.lobby));
  }
  if (msg.t === 'state') {
    net.me = msg.me;
    const prevId = game?.id;
    game = hydrate(data, msg.state);
    if (game.id !== prevId && game.phase !== 'gameOver') clearPending();
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
  storeAssorted: () => game.storeAssorted(),
  replace: (type) => game.chooseReplace(type),
  store: (i) => game.resolveHarvestStore(i),
  storeNone: () => game.resolveHarvestStore(null),
  warehouse: () => game.openWarehouse(),
  stored: (i) => game.chooseStored(i),
  cancel: () => game.cancelPrompt(),
  fish: () => game.goFish(),
  fishMore: () => game.resolveFish(true),
  fishStop: () => game.resolveFish(false),
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
  statsPrev: () => statsSlideBy(-1),
  statsNext: () => statsSlideBy(1),
  statsGo: (i) => goStatsSlide(i),
  menu: () => showMenu(),
  menuLocal: () => showLocalChoice(),
  localHuman: () => showSetup('human'),
  localCpu: () => showSetup('cpu'),
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
      net.order = [];
      net.me = 0; // en la sala el anfitrión vuelve a ser el primero
      showLobby();
    }
    if (net.mode === 'local') { clearBoard(); showSetup(); }
  },
};

document.addEventListener('click', (e) => {
  const flag = e.target.closest('[data-lang]');
  if (flag) { switchLang(flag.dataset.lang); return; }
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
  if (e.target.id === 'opt-extras' || e.target.id === 'opt-fishing' || e.target.id === 'opt-length') {
    if (e.target.id === 'opt-length') syncExtrasBox();
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
// El invitado que cierra la pestaña se despide: el anfitrión lo sabe al momento
window.addEventListener('pagehide', () => {
  if (net.mode === 'guest' && net.hostConn) { send(net.hostConn, { t: 'bye' }); net.hostConn.close(); }
});
window.addEventListener('beforeunload', (e) => {
  // Si el anfitrión cierra la pestaña se acaba la partida de todos: se pide confirmación
  if (net.mode === 'host' && game && game.phase !== 'gameOver') e.preventDefault();
});
fit();
setLang(getLang());
renderLangPicker();

try {
  data = await loadData();
  initAccount({
    currentName: () => myName(),
    onName: applyAccountName,
    onChange: () => { if (game?.phase === 'gameOver') update(); },
    lengths: () => Object.entries(data.config.boards).map(([k, b]) => [k, loc(b, 'label')]),
  });
  const sala = normalizeCode(new URLSearchParams(location.search).get('sala'));
  if (sala) showJoinForm('', sala);
  else showScreen(() => menuHtml());
} catch (err) {
  showScreen(() => `<h2>${t('load.title')}</h2>
    <p>${err.message}</p>
    <p>${t('load.hint')}<br><code>python3 scripts/serve.py</code></p>`);
}
