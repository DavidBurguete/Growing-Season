// Pinta el estado de la partida en el DOM. Cada interacción vuelve a pintar todo
// (el DOM es pequeño); los clics se recogen por delegación con data-act.

import { circlesOf } from './game.js';

// Las rutas de los datos apuntan a los originales (assets/img/*.png);
// en pantalla se usan las copias ligeras generadas por scripts/optimize-images.sh.
export const asset = (path) => path && path.replace(/^assets\/img\//, 'assets/web/').replace(/\.png$/, '.webp');

const IMG = {
  seedBack: 'assets/img/seeds/seeds-back.png',
  toolBack: 'assets/img/tools/tools-back.png',
  farmBack: 'assets/img/farm/farm-upgrades-back.png',
  mineBack: 'assets/img/mining/mine-back.png',
  landPlot: 'assets/img/farm/land-plot.png',
  arrow: 'assets/img/arrow.png',
  coin1: 'assets/img/coins/coin-one.png',
  coin5: 'assets/img/coins/coin-five.png',
  coin10: 'assets/img/coins/coin-ten.png',
  water: 'assets/img/tokens/water-token.png',
};

// Centro de cada hueco del tablero, en % sobre la imagen board.png
const BOARD_SPACES = [
  [8.75, 56.5], [18, 45.2], [27.4, 35.9], [36.5, 46], [45.75, 56.5],
  [55.25, 62.8], [64.5, 72.9], [73.75, 62.8], [83, 56.5], [92.25, 41],
];

// Geometría del mercado (debe coincidir con style.css) para animar el reparto desde el mazo
const M_CARD = 92, M_GAP = 8, M_ARROW = 40;
const PITCH = M_CARD + M_GAP;
const FROM_DECK_LEFT = (i) => -(M_CARD + M_GAP + M_ARROW + M_GAP + i * PITCH);
const FROM_DECK_RIGHT = (n, i) => n * PITCH + M_ARROW + M_GAP - i * PITCH;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function card({ img, cls = '', act = '', i = '', badge = '', extra = '', tip = '', deal = null, back = '' }) {
  const data = `${act ? `data-act="${act}" data-i="${i}"` : ''} ${tip ? `data-tip="${esc(tip)}"` : ''}`;
  if (!img) return `<div class="card empty ${cls}" ${data}>${extra}</div>`;
  const face = deal === null
    ? `<img class="face" src="${asset(img)}" alt="">`
    : `<div class="flip"><img class="face" src="${asset(img)}" alt=""><img class="face back" src="${asset(back)}" alt=""></div>`;
  return `<div class="card ${deal !== null ? 'deal' : ''} ${cls}" ${data} ${deal !== null ? `style="--from-x:${deal}px"` : ''}>
    ${face}${badge}${extra}</div>`;
}
const countBadge = (n) => `<span class="count-badge">${n}</span>`;
const arrow = (dir = '') => `<img class="arrow ${dir}" src="${asset(IMG.arrow)}" alt="">`;
const farmTip = (def) => def && `<b>${esc(def.name)}</b><br>${esc(def.description ?? '')}`;

export function renderAll(game) {
  const fresh = new Set(game.fresh);
  game.fresh = [];
  renderMarket(game, fresh);
  game.players.forEach((p, i) => renderPlayer(game, p, i));
  renderLog(game);
}

// ---------- mercado ----------

function renderMarket(game, fresh) {
  const m = game.market;
  const buy = game.phase === 'buy' && !game.prompts.length;
  const pr = game.prompts[0];
  const dealt = (key, i, offset) => (fresh.has(`${key}:${i}`) ? offset : null);

  const seeds = m.seeds.map((d, i) => {
    const can = game.canBuySeed(i);
    return card({
      img: d?.image, act: can ? 'buySeed' : '', i, cls: can ? 'hl' : buy && d ? 'dim' : '',
      deal: dealt('seeds', i, FROM_DECK_LEFT(i)), back: IMG.seedBack,
    });
  }).join('');

  const assorted = game.canUseAssorted();
  const seedDeck = card({
    img: IMG.seedBack, act: assorted ? 'assorted' : '', cls: assorted ? 'hl' : '',
    badge: countBadge(m.seedDeck.length),
    tip: assorted ? '<b>Semillas varias</b><br>Compra por 1 moneda la carta de arriba' : '',
  });
  const reveal = m.assortedReveal
    ? `<div class="assorted-reveal">${card({ img: m.assortedReveal.image, deal: dealt('assorted', 0, 0), back: IMG.seedBack })}</div>`
    : '';

  const choosingFarm = pr?.type === 'chooseFarm';
  const farm = m.farm.map((d, i) => card({
    img: d?.image, act: choosingFarm && d ? 'chooseFarm' : '', i, cls: choosingFarm && d ? 'hl' : '',
    tip: farmTip(d), deal: dealt('farm', i, FROM_DECK_RIGHT(m.farm.length, i)), back: IMG.farmBack,
  })).join('');
  const farmDeck = card({ img: IMG.farmBack, badge: countBadge(m.farmDeck.length) });

  const canMine = game.canMine();
  const mineDeck = card({
    img: IMG.mineBack, act: canMine ? 'mine' : '', cls: canMine ? 'hl' : '',
    badge: countBadge(m.mineDeck.length),
  });
  // Mientras la carta nueva se anima, la anterior sigue visible debajo
  const mineDeal = dealt('mine', 0, FROM_DECK_LEFT(0));
  const mineUnder = mineDeal !== null && m.mineUnder ? card({ img: m.mineUnder.image, cls: 'under' }) : '';
  const mineRevealed = `<div class="mine-slot">${mineUnder}${card({ img: m.mineRevealed?.image, deal: mineDeal, back: IMG.mineBack })}</div>`;

  const tools = m.tools.map((d, i) => {
    const can = game.canBuyTool(i);
    return card({
      img: d?.image, act: can ? 'buyTool' : '', i, cls: can ? 'hl' : buy && d ? 'dim' : '',
      deal: dealt('tools', i, FROM_DECK_LEFT(i)), back: IMG.toolBack,
    });
  }).join('');
  const toolDeck = card({ img: IMG.toolBack, badge: countBadge(m.toolDeck.length) });

  document.getElementById('market').innerHTML = `
    <div class="market-group"><span class="label">Semillas</span><div class="deck-col">${seedDeck}${reveal}</div>${arrow()}${seeds}</div>
    <div class="market-group"><span class="label">Mejoras de granja</span>${farm}${arrow('left')}${farmDeck}</div>
    <div class="market-group"><span class="label">Mina</span>${mineDeck}${arrow()}${mineRevealed}</div>
    <div class="market-group"><span class="label">Herrería</span>${toolDeck}${arrow()}${tools}</div>`;
}

// ---------- jugador ----------

// Ficha sobre un círculo de la carta ([x%, y%, diámetro%]) y contador "x/n" debajo
const tokenOn = (c) => (c
  ? `<img class="water-token" src="${asset(IMG.water)}" alt="" style="left:${c[0]}%;top:${c[1]}%;width:${c[2] * 0.85}%">`
  : '');
const counter = (text, ready = false) =>
  `<span class="water-badge ${ready ? 'ready' : ''}"><img src="${asset(IMG.water)}" alt="">${text}</span>`;

function cropCard(game, crop, plotIndex, active) {
  const max = circlesOf(crop.def);
  const ready = crop.water >= max;
  const action = active ? game.cropAction(plotIndex) : null;
  // Ficha de agua sobre el círculo del estado actual (círculos listados de abajo a arriba)
  const c = crop.water > 0 ? crop.def.circles?.[crop.water - 1] : null;
  return card({
    img: crop.def.image, cls: `crop ${action ? 'hl' : ''}`, act: action ? 'crop' : '', i: plotIndex,
    extra: tokenOn(c) + counter(ready ? '¡Lista!' : `${crop.water}/${max}`, ready),
  });
}

function plotCell(game, p, plotIndex, active, { tip = '', uidForStore = null } = {}) {
  const pl = p.plots[plotIndex];
  const pr = active ? game.prompts[0] : null;
  const choosable = !pl.crop && pr?.type === 'choosePlot' && pr.options.includes(plotIndex);
  return `<div class="plot ${pl.def ? 'has-bonus' : ''}">
    ${card({ img: pl.def?.image ?? IMG.landPlot, act: choosable ? 'plot' : '', i: plotIndex, cls: choosable ? 'hl' : '', tip })}
    ${pl.crop ? cropCard(game, pl.crop, plotIndex, active) : ''}</div>`;
}

function upgradeCell(game, p, u, active) {
  if (!u) return card({});
  if (u.def.type === 'plot') return plotCell(game, p, u.plotIndex, active, { tip: farmTip(u.def) });
  const pr = active ? game.prompts[0] : null;
  let extra = '';
  let act = '';
  let hl = false;
  if (u.def.type === 'warehouse') {
    if (p.warehouse.length) extra = countBadge(p.warehouse.length);
    if (active && game.canOpenWarehouse()) { act = 'warehouse'; hl = true; }
    if (pr?.source === 'warehouse' || pr?.type === 'chooseStored') { act = 'cancel'; hl = true; }
  }
  if (u.def.type === 'animal') {
    // Igual que los cultivos: la ficha marca el último círculo cobrado
    const n = u.def.values.length;
    const idx = u.step > 0 ? (u.step - 1) % n : -1;
    extra = tokenOn(u.def.circles?.[idx]) + counter(`${idx + 1}/${n}`);
  }
  const upgradeCard = card({ img: u.def.image, act, i: u.uid, cls: hl ? 'hl' : '', extra, tip: farmTip(u.def) });
  // Encurtidora / semilladora: el cultivo guardado, boca abajo, encima como en una parcela
  if (!u.stored) return upgradeCard;
  return `<div class="plot">${upgradeCard}${card({ img: IMG.seedBack, cls: 'crop', tip: `<b>${esc(u.stored.def.name)}</b><br>guardado en ${esc(u.def.name.toLowerCase())}` })}</div>`;
}

function renderPlayer(game, p, index) {
  const el = document.getElementById(`player-${index}`);
  const active = index === game.current && game.phase !== 'gameOver';
  el.className = `player-area ${active ? 'active' : 'inactive'}`;
  const color = game.cfg.colors[p.color]?.hex ?? '#fff';

  let button = '';
  if (active && !game.prompts.length) {
    if (game.phase === 'action') button = `<button class="btn" data-act="endActions">Terminar acciones</button>`;
    if (game.phase === 'buy') button = `<button class="btn" data-act="pass">Pasar turno</button>`;
  }

  const banner = `
    <div class="banner" style="--banner:${color}">
      <span class="name">${esc(p.name)}</span>
      <span class="coins">
        <span class="coin-stack"><img src="${asset(IMG.coin1)}"><img src="${asset(IMG.coin5)}"><img src="${asset(IMG.coin10)}"></span>
        x ${p.coins}
      </span>
      ${button}
    </div>`;

  // Mano
  const slots = [];
  for (let i = 0; i < game.cfg.handSize; i++) {
    const c = p.hand[i];
    if (!c) { slots.push(card({})); continue; }
    const selected = active && game.selection.includes(c.uid);
    const left = [];
    if (c.used && c.def.water) left.push(`💧${c.waterLeft}`);
    if (c.used && c.def.sickle) left.push(`🌾${c.sickleLeft}`);
    slots.push(card({
      img: c.image, act: active && game.phase === 'action' ? 'select' : '', i: c.uid,
      cls: `clickable ${selected ? 'selected' : ''} ${c.used ? 'used' : ''}`,
      extra: left.length ? `<span class="uses-badge">${left.join(' ')}</span>` : '',
    }));
  }
  const deck = card({ img: p.deck.length ? IMG.toolBack : null, badge: countBadge(p.deck.length) });
  const top = p.discard[p.discard.length - 1];
  const canDiscard = active && game.canDiscardSelected();
  const pending = p.pendingReplace.watering + p.pendingReplace.sickle;
  const pile = p.discard.length
    ? `<div class="pile-popover">${p.discard.map((c) => `<img src="${asset(c.image)}" alt="">`).join('')}</div>`
    : '';
  const discard = `<div class="discard">${card({
    img: top?.image, act: canDiscard ? 'discard' : '', cls: canDiscard ? 'hl' : '',
    badge: p.discard.length ? countBadge(p.discard.length) : '',
    extra: pending ? `<span class="uses-badge">sustituciones: ${pending}</span>` : '',
  })}${pile}</div>`;

  // Tablero
  const spaces = game.cfg.board.map((s, i) => {
    const [x, y] = BOARD_SPACES[i] ?? [0, 0];
    const filled = i < p.board;
    const next = active && i === p.board && game.canAdvanceBoard();
    return `<div class="space ${next ? 'hl' : ''}" ${next ? 'data-act="advance"' : ''} style="left:${x}%;top:${y}%">
      ${filled ? `<img src="${asset(IMG.coin10)}" alt="10">` : ''}</div>`;
  }).join('');

  // Granja: 3 huecos de mejora · 3 parcelas base · 3 huecos de mejora
  const half = game.cfg.maxUpgrades / 2;
  const ups = Array.from({ length: game.cfg.maxUpgrades }, (_, i) => p.upgrades[i] ?? null);
  const upgradeCells = (list) => list.map((u) => upgradeCell(game, p, u, active)).join('');
  const basePlots = [];
  for (let i = 0; i < game.cfg.basePlots; i++) basePlots.push(plotCell(game, p, i, active));

  el.innerHTML = `
    ${banner}
    <div class="hand-row">${deck}${arrow()}<div class="hand-slots">${slots.join('')}</div>${arrow()}${discard}</div>
    <div class="board-row"><div class="board" style="background-image:url('${asset('assets/img/boards/board.png')}')">${spaces}</div></div>
    <div class="farm-row">
      ${upgradeCells(ups.slice(0, half))}
      ${basePlots.join('')}
      ${upgradeCells(ups.slice(half))}
    </div>`;
}

// ---------- registro ----------

function renderLog(game) {
  const lines = game.log.slice().reverse().map((l) => `<div class="${l.kind}">${esc(l.msg)}</div>`).join('');
  const el = document.getElementById('log');
  el.innerHTML = lines;
  el.scrollTop = 0;
}

// ---------- diálogos ----------

const overlay = () => document.getElementById('overlay');

export function showDialog(html) {
  overlay().innerHTML = `<div class="dialog">${html}</div>`;
  overlay().classList.add('show');
}
export function hideDialog() {
  overlay().classList.remove('show');
  overlay().innerHTML = '';
}

export function setupDialogHtml(cfg, defaults) {
  const opts = (sel) => Object.entries(cfg.colors)
    .map(([k, v]) => {
      const taken = k !== sel && defaults.some((d) => d.color === k);
      return `<option value="${k}" ${k === sel ? 'selected' : ''} ${taken ? 'disabled' : ''}>${v.label}</option>`;
    }).join('');
  return `
    <h1>Growing Season</h1>
    <p>Partida de 2 jugadores en el mismo ordenador</p>
    ${defaults.map((d, i) => `
      <div class="setup-player">
        <input id="name-${i}" value="${esc(d.name)}" maxlength="16" aria-label="Nombre del jugador ${i + 1}">
        <select id="color-${i}" class="color-select" aria-label="Color del jugador ${i + 1}">${opts(d.color)}</select>
      </div>`).join('')}
    <button class="btn" data-act="start">Empezar partida</button>`;
}

const choice = (img, act, i, caption) => `<div data-act="${act}" data-i="${i}">
  ${card({ img })}<div class="caption">${caption}</div></div>`;

export function replaceDialogHtml(game, pr) {
  const t = game.data.tools.starters[game.player.color];
  return `
    <h2>¿Qué carta inicial sustituye ${esc(pr.tool.name)}?</h2>
    <div class="choice-cards">
      ${pr.options.map((o) => choice(t[o], 'replace', o, `${o === 'watering' ? 'Regadera' : 'Hoz'} (quedan ${game.replaceableCount(game.player, o)})`)).join('')}
    </div>`;
}

export function harvestStoreDialogHtml(game, pr) {
  const ups = pr.options.map((id) => game.player.upgrades.find((u) => u.uid === id));
  return `
    <h2>¿Dónde guardas ${esc(pr.crop.def.name)}?</h2>
    <div class="store-source">${card({ img: pr.crop.def.image })}${arrow('down')}</div>
    <div class="choice-cards">
      ${ups.map((u) => choice(u.def.image, 'store', u.uid, esc(u.def.name))).join('')}
    </div>
    <button class="btn secondary" data-act="storeNone">No guardar</button>`;
}

export function warehouseDialogHtml(game) {
  return `
    <h2>Almacén: ¿qué semilla quieres plantar?</h2>
    <div class="choice-cards">
      ${game.player.warehouse.map((d, i) => choice(d.image, 'stored', i, esc(d.name))).join('')}
    </div>
    <button class="btn secondary" data-act="cancel">No plantar</button>`;
}

export function gameOverHtml(game) {
  const rows = game.players.map((p) => `<p><b>${esc(p.name)}</b>: ${p.board}/${game.cfg.board.length} casillas, ${p.coins} monedas, ${p.plots.filter((pl) => pl.crop).length} cultivos</p>`).join('');
  const title = game.winners.length === 1
    ? `¡Gana ${esc(game.winners[0].name)}!`
    : `¡Victoria compartida!`;
  return `<h1>${title}</h1>${rows}<button class="btn" data-act="restart">Nueva partida</button>`;
}
