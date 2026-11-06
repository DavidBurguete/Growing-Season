// Pinta el estado de la partida en el DOM. Cada interacción vuelve a pintar todo
// (el DOM es pequeño); los clics se recogen por delegación con data-act.

import { circlesOf } from './game.js';

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

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function card({ img, cls = '', act = '', i = '', badge = '', extra = '', preview = true, style = '' }) {
  if (!img) return `<div class="card empty ${cls}" ${act ? `data-act="${act}" data-i="${i}"` : ''} style="${style}">${extra}</div>`;
  return `<div class="card ${cls}" ${act ? `data-act="${act}" data-i="${i}"` : ''} ${preview ? `data-preview="${img}"` : ''} style="${style}">
    <img class="face" src="${img}" alt="">${badge}${extra}</div>`;
}
const countBadge = (n) => `<span class="count-badge">${n}</span>`;
const arrow = (dir = '') => `<img class="arrow ${dir}" src="${IMG.arrow}" alt="">`;

export function renderAll(game) {
  renderMarket(game);
  game.players.forEach((p, i) => renderPlayer(game, p, i));
  renderLog(game);
  renderPrompt(game);
}

// ---------- mercado ----------

function renderMarket(game) {
  const m = game.market;
  const buy = game.phase === 'buy' && !game.prompts.length;
  const pr = game.prompts[0];

  const seeds = m.seeds.map((d, i) => {
    const can = game.canBuySeed(i);
    return card({ img: d?.image, act: can ? 'buySeed' : '', i, cls: can ? 'hl' : buy && d ? 'dim' : '' });
  }).join('');

  const assorted = game.canUseAssorted();
  const seedDeck = card({
    img: IMG.seedBack, preview: false, act: assorted ? 'assorted' : '', cls: assorted ? 'hl' : '',
    badge: countBadge(m.seedDeck.length),
  });

  const choosingFarm = pr?.type === 'chooseFarm';
  const farm = m.farm.map((d, i) => card({ img: d?.image, act: choosingFarm && d ? 'chooseFarm' : '', i, cls: choosingFarm && d ? 'hl' : '' })).join('');
  const farmDeck = card({ img: IMG.farmBack, preview: false, badge: countBadge(m.farmDeck.length) });

  const canMine = game.canMine();
  const mineDeck = card({
    img: IMG.mineBack, preview: false, act: canMine ? 'mine' : '', cls: canMine ? 'hl' : '',
    badge: countBadge(m.mineDeck.length),
  });
  const mineRevealed = card({ img: m.mineRevealed?.image });

  const tools = m.tools.map((d, i) => {
    const can = game.canBuyTool(i);
    return card({ img: d?.image, act: can ? 'buyTool' : '', i, cls: can ? 'hl' : buy && d ? 'dim' : '' });
  }).join('');
  const toolDeck = card({ img: IMG.toolBack, preview: false, badge: countBadge(m.toolDeck.length) });

  document.getElementById('market').innerHTML = `
    <div class="market-group"><span class="label">Semillas</span>${seedDeck}${arrow()}${seeds}</div>
    <div class="market-group"><span class="label">Mejoras de granja</span>${farm}${arrow('left')}${farmDeck}</div>
    <div class="market-group"><span class="label">Mina</span>${mineDeck}${arrow()}${mineRevealed}</div>
    <div class="market-group"><span class="label">Herrería</span>${toolDeck}${arrow()}${tools}</div>`;
}

// ---------- jugador ----------

function renderPlayer(game, p, index) {
  const el = document.getElementById(`player-${index}`);
  const active = index === game.current && game.phase !== 'gameOver';
  el.className = `player-area ${active ? 'active' : 'inactive'}`;
  const color = game.cfg.colors[p.color]?.hex ?? '#fff';
  const pr = active ? game.prompts[0] : null;

  // Botón de fase
  let button = '';
  if (active && !game.prompts.length) {
    if (game.phase === 'action') button = `<button class="btn" data-act="endActions">Terminar acciones</button>`;
    if (game.phase === 'buy') button = `<button class="btn" data-act="pass">Pasar turno</button>`;
  }

  const banner = `
    <div class="banner">
      <span class="swatch" style="background:${color}"></span>
      <span class="name">${esc(p.name)}</span>
      <span class="coins">
        <span class="coin-stack"><img src="${IMG.coin1}"><img src="${IMG.coin5}"><img src="${IMG.coin10}"></span>
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
  const deck = card({ img: p.deck.length ? IMG.toolBack : null, preview: false, badge: countBadge(p.deck.length) });
  const top = p.discard[p.discard.length - 1];
  const canEnd = active && game.phase === 'action' && !game.prompts.length;
  const discard = card({
    img: top?.image, act: canEnd ? 'endActions' : '', cls: canEnd ? 'clickable' : '',
    badge: p.discard.length ? countBadge(p.discard.length) : '',
  });

  // Tablero
  const spaces = game.cfg.board.map((s, i) => {
    const [x, y] = BOARD_SPACES[i] ?? [0, 0];
    const filled = i < p.board;
    const next = active && i === p.board && game.canAdvanceBoard();
    return `<div class="space ${next ? 'hl' : ''}" ${next ? 'data-act="advance"' : ''} style="left:${x}%;top:${y}%">
      ${filled ? `<img src="${IMG.coin10}" alt="10">` : ''}</div>`;
  }).join('');

  // Mejoras de granja
  const storing = pr?.type === 'harvestStore';
  const n = p.upgrades.length;
  const overlap = n > 3 ? (300 - n * 96) / (n - 1) : 6;
  const upgrades = p.upgrades.map((u) => {
    let extra = '';
    if (u.stored) extra = `<img class="stored" src="${u.stored.def.image}" alt="">`;
    if (u.def.type === 'warehouse' && p.warehouse.length) extra = countBadge(p.warehouse.length);
    if (u.def.type === 'animal') {
      const v = u.def.values[Math.min(u.step, u.def.values.length - 1)];
      extra = `<span class="uses-badge">próx. +${v}</span>`;
    }
    const opt = storing && pr.options.includes(u.uid);
    return card({ img: u.def.image, act: opt ? 'store' : '', i: u.uid, cls: opt ? 'hl' : '', extra });
  }).join('');

  // Parcelas
  const choosingPlot = pr?.type === 'choosePlot';
  const plots = [];
  for (let i = 0; i < game.cfg.maxPlots; i++) {
    const pl = p.plots[i];
    if (!pl) { plots.push(card({})); continue; }
    let crop = '';
    let act = '';
    let hl = false;
    if (pl.crop) {
      const max = circlesOf(pl.crop.def);
      const ready = pl.crop.water >= max;
      const action = active ? game.cropAction(i) : null;
      hl = !!action;
      if (action) act = 'crop';
      crop = card({
        img: pl.crop.def.image, cls: `crop ${hl ? 'hl' : ''}`, act, i,
        extra: `<span class="water-badge ${ready ? 'ready' : ''}"><img src="${IMG.water}" alt="">${ready ? '¡Lista!' : `${pl.crop.water}/${max}`}</span>`,
      });
    } else if (choosingPlot && pr.options.includes(i)) {
      hl = true;
      act = 'plot';
    }
    plots.push(`<div class="plot ${pl.def ? 'has-bonus' : ''}">
      ${card({ img: pl.def?.image ?? IMG.landPlot, act: !pl.crop && act ? act : '', i, cls: !pl.crop && hl ? 'hl' : '' })}
      ${crop}</div>`);
  }

  el.innerHTML = `
    ${banner}
    <div class="hand-row">${deck}${arrow()}<div class="hand-slots">${slots.join('')}</div>${arrow()}${discard}</div>
    <div class="board-row"><div class="board">${spaces}</div></div>
    <div class="farm-row">
      <div class="upgrades" style="--overlap:${overlap}px">${upgrades}</div>
      <div class="plots">${plots.join('')}</div>
    </div>`;
}

// ---------- registro y avisos ----------

function renderLog(game) {
  const lines = game.log.slice(-6).map((l) => `<div class="${l.kind}">${esc(l.msg)}</div>`).join('');
  document.getElementById('log').innerHTML = lines;
}

function hintFor(game) {
  const pr = game.prompts[0];
  const p = game.player;
  if (pr?.type === 'choosePlot') return `Elige una parcela libre para plantar ${esc(pr.seed.name)}`;
  if (pr?.type === 'chooseFarm') return 'Elige una mejora de granja';
  if (pr?.type === 'harvestStore') return `¿Guardar ${esc(pr.crop.def.name)} en la encurtidora / semilladora? <button class="btn secondary" data-act="storeNone">No, descartar</button>`;
  if (game.phase === 'action') {
    const sel = game.selectedCards().length;
    const mine = game.mineCost(p);
    if (!sel) return `Selecciona 1 herramienta para regar o cosechar, o ${mine} para ir a la mina`;
    if (game.canMine() && sel === 1) return 'Haz clic en un cultivo o en la mina';
    if (game.canMine()) return 'Haz clic en la mina para revelar una carta';
    return 'Haz clic en un cultivo resaltado';
  }
  if (game.phase === 'buy') return `Fase de compra: ${p.coins} moneda${p.coins === 1 ? '' : 's'} disponibles`;
  return '';
}

function renderPrompt(game) {
  const el = document.getElementById('prompt');
  const hint = game.phase === 'gameOver' ? '' : hintFor(game);
  el.innerHTML = hint;
  el.classList.toggle('show', !!hint);
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
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');
  return `
    <h1>Growing Season</h1>
    <p>Partida de 2 jugadores en el mismo ordenador</p>
    ${defaults.map((d, i) => `
      <div class="setup-player">
        <input id="name-${i}" value="${esc(d.name)}" maxlength="16" aria-label="Nombre del jugador ${i + 1}">
        <select id="color-${i}" aria-label="Color del jugador ${i + 1}">${opts(d.color)}</select>
      </div>`).join('')}
    <button class="btn" data-act="start">Empezar partida</button>`;
}

export function replaceDialogHtml(game, pr) {
  const t = game.data.tools.starters[game.player.color];
  return `
    <h2>¿Qué carta inicial sustituye ${esc(pr.tool.name)}?</h2>
    <div class="choice-cards">
      ${pr.options.map((o) => `<div data-act="replace" data-i="${o}">
        ${card({ img: t[o], preview: false })}
        <div class="caption">${o === 'watering' ? 'Regadera' : 'Hoz'} (quedan ${game.starterCount(game.player, o)})</div>
      </div>`).join('')}
    </div>`;
}

export function gameOverHtml(game) {
  const rows = game.players.map((p) => `<p><b>${esc(p.name)}</b>: ${p.board}/${game.cfg.board.length} casillas, ${p.coins} monedas</p>`).join('');
  return `
    <h1>${game.winner ? `¡Gana ${esc(game.winner.name)}!` : '¡Empate!'}</h1>
    ${rows}
    <button class="btn" data-act="restart">Nueva partida</button>`;
}
