import { Game } from './game.js';
import {
  renderAll, showDialog, hideDialog, setupDialogHtml, replaceDialogHtml,
  harvestStoreDialogHtml, warehouseDialogHtml, gameOverHtml,
} from './render.js';

const DATA_FILES = {
  config: 'data/config.json',
  seeds: 'data/seeds.json',
  tools: 'data/tools.json',
  farm: 'data/farm-upgrades.json',
  mine: 'data/mine.json',
};

const W = 1920, H = 923;
let data;
let game;
let lastSetup = [
  { name: 'Jugador 1', color: 'rojo' },
  { name: 'Jugador 2', color: 'verde' },
];

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

function update() {
  renderAll(game);
  const pr = game.prompts[0];
  if (game.phase === 'gameOver') showDialog(gameOverHtml(game));
  else if (pr?.type === 'chooseReplace') showDialog(replaceDialogHtml(game, pr));
  else if (pr?.type === 'harvestStore') showDialog(harvestStoreDialogHtml(game, pr));
  else if (pr?.type === 'chooseStored') showDialog(warehouseDialogHtml(game));
  else hideDialog();
}

function showSetup() {
  showDialog(setupDialogHtml(data.config, lastSetup));
}

function startGame() {
  const setup = [0, 1].map((i) => ({
    name: document.getElementById(`name-${i}`).value.trim() || `Jugador ${i + 1}`,
    color: document.getElementById(`color-${i}`).value,
  }));
  if (setup[0].color === setup[1].color) {
    alert('Cada jugador debe tener un color distinto.');
    return;
  }
  lastSetup = setup;
  game = new Game(data, setup);
  window.game = game; // útil para depurar desde la consola
}

const ACTIONS = {
  start: () => startGame(),
  restart: () => showSetup(),
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
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const raw = el.dataset.i;
  const arg = raw !== undefined && raw !== '' && !isNaN(raw) ? Number(raw) : raw;
  ACTIONS[act]?.(arg);
  hideTip();
  if (game && act !== 'restart') update();
});

// Configuración: un color elegido por un jugador queda deshabilitado para los demás
document.addEventListener('change', (e) => {
  if (!e.target.matches('.color-select')) return;
  const selects = [...document.querySelectorAll('.color-select')];
  for (const sel of selects) {
    const taken = selects.filter((o) => o !== sel).map((o) => o.value);
    for (const opt of sel.options) opt.disabled = taken.includes(opt.value);
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
fit();

try {
  data = await loadData();
  showSetup();
} catch (err) {
  showDialog(`<h2>No se pudieron cargar los datos</h2>
    <p>${err.message}</p>
    <p>Abre el juego desde un servidor local, por ejemplo:<br><code>python3 -m http.server 8000</code></p>`);
}
