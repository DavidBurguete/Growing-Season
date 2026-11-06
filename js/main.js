import { Game } from './game.js';
import { renderAll, showDialog, hideDialog, setupDialogHtml, replaceDialogHtml, gameOverHtml } from './render.js';

const DATA_FILES = {
  config: 'data/config.json',
  seeds: 'data/seeds.json',
  tools: 'data/tools.json',
  farm: 'data/farm-upgrades.json',
  mine: 'data/mine.json',
};

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

// ---------- escalado del lienzo ----------

function fitStage() {
  const stage = document.getElementById('stage');
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 923);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(window.innerWidth - 1920 * s) / 2}px`;
  stage.style.top = `${(window.innerHeight - 923 * s) / 2}px`;
}

// ---------- ciclo de pintado ----------

function update() {
  renderAll(game);
  const pr = game.prompts[0];
  if (game.phase === 'gameOver') showDialog(gameOverHtml(game));
  else if (pr?.type === 'chooseReplace') showDialog(replaceDialogHtml(game, pr));
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
  update();
}

const ACTIONS = {
  start: () => startGame(),
  restart: () => showSetup(),
  select: (i) => game.toggleSelect(i),
  crop: (i) => game.useOnCrop(i),
  mine: () => game.goMine(),
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
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const raw = el.dataset.i;
  const arg = raw !== undefined && raw !== '' && !isNaN(raw) ? Number(raw) : raw;
  ACTIONS[act]?.(arg);
  if (game && act !== 'restart') update();
});

// ---------- vista ampliada al pasar el ratón ----------

const preview = document.getElementById('preview');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-preview]');
  if (!el) { preview.classList.remove('show'); return; }
  preview.querySelector('img').src = el.dataset.preview;
  const r = el.getBoundingClientRect();
  const w = 300, h = 420;
  const left = r.left + r.width / 2 < window.innerWidth / 2 ? Math.min(r.right + 16, window.innerWidth - w - 8) : Math.max(r.left - w - 16, 8);
  const top = Math.min(Math.max(r.top + r.height / 2 - h / 2, 8), window.innerHeight - h - 8);
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
  preview.classList.add('show');
});

// ---------- arranque ----------

window.addEventListener('resize', fitStage);
fitStage();

try {
  data = await loadData();
  showSetup();
} catch (err) {
  showDialog(`<h2>No se pudieron cargar los datos</h2>
    <p>${err.message}</p>
    <p>Abre el juego desde un servidor local, por ejemplo:<br><code>python3 -m http.server 8000</code></p>`);
}
