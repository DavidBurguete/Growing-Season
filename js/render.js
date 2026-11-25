// Pinta el estado de la partida en el DOM. Cada interacción vuelve a pintar todo
// (el DOM es pequeño); los clics se recogen por delegación con data-act.

import { circlesOf, forcesExtras } from './game.js';
import { CPU_LEVELS } from './cpu.js';
import { t, loc, cardName, fmtNum, logText, LANGS, getLang, pname } from './i18n.js';
import { INCOME, computeAwards, bestTurn } from './stats.js';

// Las rutas de los datos apuntan a los originales (assets/img/*.png);
// en pantalla se usan las copias ligeras generadas por scripts/optimize-images.sh.
export const asset = (path) => path && path.replace(/^assets\/img\//, 'assets/web/').replace(/\.png$/, '.webp');

const IMG = {
  seedBack: 'assets/img/seeds/seeds-back.png',
  toolBack: 'assets/img/tools/tools-back.png',
  farmBack: 'assets/img/farm/farm-upgrades-back.png',
  mineBack: 'assets/img/mining/mine-back.png',
  fishBack: 'assets/img/fishing/fishing-back.png',
  landPlot: 'assets/img/farm/land-plot.png',
  arrow: 'assets/img/arrow.png',
  coin1: 'assets/img/coins/coin-one.png',
  coin5: 'assets/img/coins/coin-five.png',
  coin10: 'assets/img/coins/coin-ten.png',
  water: 'assets/img/tokens/water-token.png',
};

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
// En modo pesca, algunas mejoras tienen otra descripción
let fishingTips = false;
const farmTip = (def) => def && `<b>${esc(cardName(def))}</b><br>${esc((fishingTips && loc(def, 'descriptionFishing')) || loc(def, 'description'))}`;

// me: asiento de este ordenador en una partida online (null en partida local)
export function renderAll(game, { me = null } = {}) {
  const fresh = new Set(game.fresh);
  game.fresh = [];
  fishingTips = game.options?.mode === 'fishing';
  renderMarket(game, fresh);
  game.players.forEach((p, i) => renderPlayer(game, p, i, me));
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
    tip: assorted ? t('tip.assorted') : '',
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

  // Mina o, en su lugar, pesca (mismo hueco del mercado)
  const fishing = game.options?.mode === 'fishing';
  const back = fishing ? IMG.fishBack : IMG.mineBack;
  const canGo = fishing ? game.canFish() : game.canMine();
  const power = fishing && canGo ? game.fishPower(game.selectedCards()) : 0;
  // Durante una salida de pesca, el valor que queda se ve sobre el mazo hasta que termina
  const trip = fishing ? game.fishing : null;
  const fishBadge = trip
    ? `<span class="uses-badge fish-left">🎣 ${t('badge.fishLeft', { power: trip.power })}</span>`
    : canGo && fishing ? `<span class="uses-badge">🎣 ${fmtNum(power)}</span>` : '';
  const mineDeck = card({
    img: back, act: canGo ? (fishing ? 'fish' : 'mine') : '', cls: canGo ? 'hl' : '',
    badge: countBadge(m.mineDeck.length),
    extra: fishBadge,
    tip: fishing ? `<b>${t('tip.fishing')}</b><br>${trip ? t('tip.fishLeft', { power: trip.power }) : canGo ? t('tip.fishWith', { power }) : t('tip.fishSelect')}` : '',
  });
  // Mientras la carta nueva se anima, la anterior sigue visible debajo
  const mineDeal = dealt('mine', 0, FROM_DECK_LEFT(0));
  const mineUnder = mineDeal !== null && m.mineUnder ? card({ img: m.mineUnder.image, cls: 'under' }) : '';
  const mineRevealed = `<div class="mine-slot">${mineUnder}${card({ img: m.mineRevealed?.image, deal: mineDeal, back })}</div>`;

  const tools = m.tools.map((d, i) => {
    const can = game.canBuyTool(i);
    return card({
      img: d?.image, act: can ? 'buyTool' : '', i, cls: can ? 'hl' : buy && d ? 'dim' : '',
      deal: dealt('tools', i, FROM_DECK_LEFT(i)), back: IMG.toolBack,
    });
  }).join('');
  const toolDeck = card({ img: IMG.toolBack, badge: countBadge(m.toolDeck.length) });

  document.getElementById('market').innerHTML = `
    <div class="market-group"><span class="label">${t('market.seeds')}</span><div class="deck-col">${seedDeck}${reveal}</div>${arrow()}${seeds}</div>
    <div class="market-group"><span class="label">${t('market.farm')}</span>${farm}${arrow('left')}${farmDeck}</div>
    <div class="market-group"><span class="label">${t(fishing ? 'market.fishing' : 'market.mine')}</span>${mineDeck}${arrow()}${mineRevealed}</div>
    <div class="market-group"><span class="label">${t('market.smith')}</span>${toolDeck}${arrow()}${tools}</div>`;
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
    extra: tokenOn(c) + counter(ready ? t('crop.ready') : `${crop.water}/${max}`, ready),
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
    if (active && game.canStoreAssorted()) { act = 'storeAssorted'; hl = true; }
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
  const when = u.def.type === 'seedmaker' && u.armed ? `<br>${t('stored.when')}` : '';
  return `<div class="plot">${upgradeCard}${card({ img: IMG.seedBack, cls: 'crop', tip: `<b>${esc(cardName(u.stored.def))}</b><br>${esc(t('stored.in', { upgrade: cardName(u.def).toLowerCase() }))}${when}` })}</div>`;
}

function renderPlayer(game, p, index, me) {
  const el = document.getElementById(`player-${index}`);
  const active = index === game.current && game.phase !== 'gameOver';
  el.className = `player-area ${active ? 'active' : 'inactive'}`;
  const color = game.cfg.colors[p.color]?.hex ?? '#fff';

  let button = '';
  // En partidas online, los botones solo aparecen en el ordenador del jugador al que le toca
  const mine = active && !p.cpu && (me === null || me === index);
  if (mine && !game.prompts.length) {
    if (game.phase === 'action') button = `<button class="btn" data-act="endActions">${t('btn.endActions')}</button>`;
    if (game.phase === 'buy') button = `<button class="btn" data-act="pass">${t('btn.pass')}</button>`;
  }
  // Semillas varias con almacén: guardar la semilla en lugar de plantarla
  if (mine && game.canStoreAssorted()) button = `<button class="btn" data-act="storeAssorted">${t('btn.toWarehouse')}</button>`;

  // Rendirse: en local, el jugador al que le toca (contra la CPU, el humano en cualquier momento);
  // online, cada uno desde su ordenador
  const vsCpu = game.players.some((o) => o.cpu);
  const canSurrender = game.phase !== 'gameOver' && !p.cpu && (me === null ? active || vsCpu : me === index);
  const surrender = canSurrender
    ? `<button class="btn small surrender" data-act="surrender" data-i="${index}" title="${t('btn.surrender')}">🏳</button>` : '';

  const banner = `
    <div class="banner" style="--banner:${color}">
      <span class="name">${esc(pname(p.name))}${me === index ? ` <small>(${t('player.you')})</small>` : ''}${p.standIn ? ` <small>(${t('player.cpu', { level: t(`cpu.${p.cpu}`) })})</small>` : ''}</span>
      <span class="coins">
        <span class="coin-stack"><img src="${asset(IMG.coin1)}"><img src="${asset(IMG.coin5)}"><img src="${asset(IMG.coin10)}"></span>
        x ${p.coins}
      </span>
      ${button}${surrender}
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
    if (!c.used && selected && game.options?.mode === 'fishing') left.push(`🐟${fmtNum(game.fishPower([c], p))}`);
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
    extra: pending ? `<span class="uses-badge">${t('badge.replacements', { n: pending })}</span>` : '',
  })}${pile}</div>`;

  // Tablero
  const board = game.boardDef;
  const spaces = board.spaces.map((s, i) => {
    const filled = i < p.board;
    const next = active && i === p.board && game.canAdvanceBoard();
    return `<div class="space ${next ? 'hl' : ''}" ${next ? 'data-act="advance"' : ''} style="left:${s.x}%;top:${s.y}%">${filled ? `<img src="${asset(IMG.coin10)}" alt="10">` : ''}</div>`;
  }).join('');

  // Granja: 3 huecos de mejora · 3 parcelas base · 3 huecos de mejora.
  // En la partida larga, los huecos 7.º y 8.º van debajo, en el lado exterior de cada jugador.
  const half = game.cfg.maxUpgrades / 2;
  const ups = Array.from({ length: game.maxUpgrades }, (_, i) => p.upgrades[i] ?? null);
  const moreUps = ups.slice(game.cfg.maxUpgrades);
  const upgradeCells = (list) => list.map((u) => upgradeCell(game, p, u, active)).join('');
  const basePlots = [];
  for (let i = 0; i < game.cfg.basePlots; i++) basePlots.push(plotCell(game, p, i, active));

  el.innerHTML = `
    ${banner}
    <div class="hand-row">${deck}${arrow()}<div class="hand-slots">${slots.join('')}</div>${arrow()}${discard}</div>
    <div class="board-row"><div class="board" style="background-image:url('${asset(board.image)}');aspect-ratio:${board.width}/${board.height};--space:${board.spaceSize}%">${spaces}</div></div>
    <div class="farm-row">
      ${upgradeCells(ups.slice(0, half))}
      ${basePlots.join('')}
      ${upgradeCells(ups.slice(half, game.cfg.maxUpgrades))}
    </div>
    ${moreUps.length ? `<div class="farm-row more-upgrades">${upgradeCells(moreUps)}</div>` : ''}`;
}

// ---------- registro ----------

function renderLog(game) {
  const hex = (who) => game.cfg.colors[game.players[who]?.color]?.hex;
  const lines = game.log.slice().reverse().map((l) => {
    const c = l.who !== null && l.who !== undefined ? hex(l.who) : null;
    return `<div class="${l.kind}" ${c ? `style="color:${c}"` : ''}>${esc(logText(l))}</div>`;
  }).join('');
  const el = document.getElementById('log');
  el.innerHTML = lines;
  el.scrollTop = 0;
}

// ---------- diálogos ----------

const overlay = () => document.getElementById('overlay');

// variant: clase extra del fondo (p. ej. 'fishing' deja ver el mercado mientras se pesca)
export function showDialog(html, variant = '') {
  overlay().innerHTML = `<div class="dialog">${html}</div>`;
  overlay().className = `show ${variant}`;
}
export function hideDialog() {
  overlay().className = '';
  overlay().innerHTML = '';
}

// ---------- menú inicial y partidas online ----------

export function menuHtml() {
  return `
    <h1>Growing Season</h1>
    <div class="menu-buttons">
      <button class="btn" data-act="menuLocal">${t('menu.local')}</button>
      <button class="btn" data-act="menuHost">${t('menu.host')}</button>
      <button class="btn" data-act="menuJoin">${t('menu.join')}</button>
    </div>`;
}

// Selector de idioma (banderas); siempre visible en la esquina
export function renderLangPicker() {
  const el = document.getElementById('lang');
  if (!el) return;
  el.setAttribute('aria-label', t('menu.language'));
  el.innerHTML = Object.entries(LANGS).map(([k, v]) => `<button class="lang-btn ${k === getLang() ? 'on' : ''}" data-lang="${k}" title="${v.label}" aria-label="${v.label}" aria-pressed="${k === getLang()}"><img src="${v.flag}" alt=""></button>`).join('');
}

const colorOptions = (cfg, sel, taken = []) => Object.entries(cfg.colors)
  .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''} ${taken.includes(k) ? 'disabled' : ''}>${esc(loc(v, 'label'))}</option>`).join('');
const errorLine = (msg) => (msg ? `<p class="net-error">${esc(msg)}</p>` : '');

export function hostFormHtml(cfg, d, error = '') {
  return `
    <h2>${t('host.title')}</h2>
    <p>${t('host.text')}</p>
    <div class="setup-player">
      <input id="net-name" value="${esc(d.name)}" maxlength="16" aria-label="${t('net.yourName')}">
      <select id="net-color" aria-label="${t('net.yourColor')}">${colorOptions(cfg, d.color)}</select>
    </div>
    ${errorLine(error)}
    <button class="btn secondary" data-act="menu">${t('btn.back')}</button>
    <button class="btn" data-act="createRoom">${t('host.create')}</button>`;
}

export function joinFormHtml(d, error = '') {
  return `
    <h2>${t('join.title')}</h2>
    <div class="setup-player">
      <input id="net-code" class="code-input" value="${esc(d.code ?? '')}" maxlength="5" placeholder="${t('join.code')}" aria-label="${t('join.codeLabel')}">
      <input id="net-name" value="${esc(d.name)}" maxlength="16" aria-label="${t('net.yourName')}">
    </div>
    ${errorLine(error)}
    <button class="btn secondary" data-act="menu">${t('btn.back')}</button>
    <button class="btn" data-act="joinRoom">${t('join.connect')}</button>`;
}

export function connectingHtml(text) {
  return `<h2>${esc(text)}</h2><p class="net-spinner">●●●</p><button class="btn secondary" data-act="menu">${t('btn.cancel')}</button>`;
}

// Sala de espera. lobby = { code, link, players: [{name, color, online}], spectators, me, isHost }
export function lobbyHtml(cfg, lobby) {
  const rows = lobby.players.map((p, i) => {
    const taken = lobby.players.filter((_, j) => j !== i).map((o) => o.color);
    const color = i === lobby.me
      ? `<select id="lobby-color" aria-label="${t('net.yourColor')}">${colorOptions(cfg, p.color, taken)}</select>`
      : `<span class="chip" style="background:${cfg.colors[p.color]?.hex}">${esc(loc(cfg.colors[p.color], 'label'))}</span>`;
    return `<div class="lobby-row"><span class="lobby-name">${esc(p.name)}${i === lobby.me ? ` (${t('player.you')})` : ''}${i === 0 ? ` · ${t('lobby.host')}` : ''}</span>${color}</div>`;
  }).join('');
  const full = lobby.players.length >= 2;
  const spect = lobby.spectators ? `<p>${t('lobby.spectators', { n: lobby.spectators })}</p>` : '';
  const actions = lobby.isHost
    ? `<button class="btn secondary" data-act="menu">${t('lobby.close')}</button>
       <button class="btn" data-act="startOnline" ${full ? '' : 'disabled'}>${t('btn.start')}</button>`
    : `<p>${t(lobby.me === null ? 'lobby.full' : 'lobby.waitHost')}</p>
       <button class="btn secondary" data-act="menu">${t('lobby.leave')}</button>`;
  return `
    <h2>${t('lobby.title')}</h2>
    <p>${t('lobby.code')}</p>
    <div class="room-code">${esc(lobby.code)}</div>
    ${lobby.isHost ? `
      <div class="invite">
        <label for="invite-host">${t('lobby.invite')}</label>
        <div><input id="invite-host" value="${esc(lobby.inviteHost)}" placeholder="81.0.0.1:8000" spellcheck="false">
        <button class="btn small" data-act="copyLink">${t('lobby.copy')}</button></div>
      </div>` : ''}
    <div class="lobby-list">${rows}${full ? '' : `<div class="lobby-row waiting">${t('lobby.waiting')}</div>`}</div>
    ${optionsHtml(cfg, lobby.options, { editable: lobby.isHost })}
    ${spect}
    ${actions}`;
}

export function messageHtml(title, text) {
  return `<h2>${esc(title)}</h2><p>${esc(text)}</p><button class="btn" data-act="menu">${t('btn.backToMenu')}</button>`;
}

// Opciones de partida (ids opt-length / opt-extras / opt-fishing).
// En la partida larga las mejoras extra son obligatorias: la casilla queda marcada y bloqueada.
export function optionsHtml(cfg, options, { editable = true } = {}) {
  const locked = forcesExtras(options.length);
  const box = (id, checked, label, lock = false) => `<label class="option"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${editable && !lock ? '' : 'disabled'}> ${label}</label>`;
  const lengths = Object.entries(cfg.boards)
    .map(([k, b]) => `<option value="${k}" ${k === options.length ? 'selected' : ''}>${esc(loc(b, 'label'))}</option>`).join('');
  return `<div class="options">
    <label class="option">${t('options.length')}
      <select id="opt-length" ${editable ? '' : 'disabled'}>${lengths}</select></label>
    ${box('opt-extras', options.extras || locked, t('options.extras'), locked)}
    ${box('opt-fishing', options.mode === 'fishing', t('options.fishing'))}
  </div>`;
}

// Partida local: contra otra persona o contra la CPU
export function localChoiceHtml() {
  return `
    <h2>${t('local.title')}</h2>
    <div class="menu-buttons">
      <button class="btn" data-act="localHuman">${t('local.human')}</button>
      <button class="btn" data-act="localCpu">${t('local.cpu')}</button>
    </div>
    <p></p>
    <button class="btn secondary" data-act="menu">${t('btn.back')}</button>`;
}

const cpuOptions = (sel) => Object.keys(CPU_LEVELS)
  .map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t('player.cpu', { level: t(`cpu.${k}`) })}</option>`).join('');

// cpu: nivel de la CPU si el segundo jugador es la CPU (sin nombre: solo nivel y color);
// el primer jugador siempre es una persona
export function setupDialogHtml(cfg, defaults, options, { cpu = null } = {}) {
  const opts = (sel) => Object.entries(cfg.colors)
    .map(([k, v]) => {
      const taken = k !== sel && defaults.some((d) => d.color === k);
      return `<option value="${k}" ${k === sel ? 'selected' : ''} ${taken ? 'disabled' : ''}>${esc(loc(v, 'label'))}</option>`;
    }).join('');
  const color = (i, d) => `<select id="color-${i}" class="color-select" aria-label="${t(cpu && i === 1 ? 'setup.cpuColor' : 'setup.colorLabel', { n: i + 1 })}">${opts(d.color)}</select>`;
  return `
    <h1>Growing Season</h1>
    <p>${t(cpu ? 'setup.subtitleCpu' : 'setup.subtitle')}</p>
    ${defaults.map((d, i) => (cpu && i === 1 ? `
      <div class="setup-player">
        <select id="cpu-1" class="cpu-level" aria-label="${t('setup.cpuLevel')}">${cpuOptions(cpu)}</select>
        ${color(i, d)}
      </div>` : `
      <div class="setup-player">
        <input id="name-${i}" value="${esc(d.name || t('setup.defaultName', { n: i + 1 }))}" maxlength="16" aria-label="${t('setup.nameLabel', { n: i + 1 })}">
        ${color(i, d)}
      </div>`)).join('')}
    ${optionsHtml(cfg, options)}
    <button class="btn secondary" data-act="menuLocal">${t('btn.back')}</button>
    <button class="btn" data-act="start">${t('btn.start')}</button>`;
}

const choice = (img, act, i, caption) => `<div data-act="${act}" data-i="${i}">
  ${card({ img })}<div class="caption">${caption}</div></div>`;

export function replaceDialogHtml(game, pr) {
  const imgs = game.data.tools.starters[game.player.color];
  return `
    <h2>${esc(t('replace.title', { card: pr.tool }))}</h2>
    <div class="choice-cards">
      ${pr.options.map((o) => choice(imgs[o], 'replace', o, t('replace.option', { tool: o, n: game.replaceableCount(game.player, o) }))).join('')}
    </div>`;
}

export function harvestStoreDialogHtml(game, pr) {
  const ups = pr.options.map((id) => game.player.upgrades.find((u) => u.uid === id));
  return `
    <h2>${esc(t('store.title', { crop: pr.crop.def }))}</h2>
    <div class="store-source">${card({ img: pr.crop.def.image })}${arrow('down')}</div>
    <div class="choice-cards">
      ${ups.map((u) => choice(u.def.image, 'store', u.uid, esc(cardName(u.def)))).join('')}
    </div>
    <button class="btn secondary" data-act="storeNone">${t('store.none')}</button>`;
}

export function warehouseDialogHtml(game) {
  return `
    <h2>${t('warehouse.title')}</h2>
    <div class="choice-cards">
      ${game.player.warehouse.map((d, i) => choice(d.image, 'stored', i, esc(cardName(d)))).join('')}
    </div>
    <button class="btn secondary" data-act="cancel">${t('warehouse.none')}</button>`;
}

export function fishDialogHtml(game) {
  const f = game.fishing;
  const coins = f.caught.reduce((s, c) => s + c.coins, 0);
  return `
    <h2>${t('fish.title')}</h2>
    <div class="choice-cards fish-caught">${f.caught.map((c) => card({ img: c.image })).join('')}</div>
    <p>${t('fish.text', { coins, power: f.power })}</p>
    <button class="btn secondary" data-act="fishStop">${t('fish.stop')}</button>
    <button class="btn" data-act="fishMore">${t('fish.more')}</button>`;
}

export function surrenderDialogHtml(game, index) {
  return `
    <h2>${t('surrender.title', { name: esc(pname(game.players[index].name)) })}</h2>
    <p>${t('surrender.text')}</p>
    <button class="btn secondary" data-act="surrenderNo">${t('btn.cancel')}</button>
    <button class="btn danger" data-act="surrenderYes" data-i="${index}">${t('btn.surrender')}</button>`;
}

// ---------- fin de partida y estadísticas ----------

// Colores de la tarta de ingresos (paleta categórica, en orden fijo)
const INCOME_COLORS = { crops: '#2a78d6', animals: '#eb6834', expedition: '#1baf7a', plots: '#eda100', pickler: '#e87ba4', dogcat: '#008300' };
const playerHex = (game, p) => game.cfg.colors[p.color]?.hex ?? '#444';

function fmtDuration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return t('stats.durationValue', { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60), s: sec % 60 });
}

// Gráfica de líneas: monedas de cada jugador (en mano + en el tablero) a lo largo de la partida.
// Cada ronda tiene una columna invisible con su descripción al pasar el ratón.
function coinsChart(game, extra = '') {
  const series = game.stats.series;
  const W = 640, H = 230, L = 40, R = 12, T = 12, B = 30;
  const n = game.players.length;
  const top = Math.max(10, ...series.flatMap((pt) => pt.v));
  const step = top <= 40 ? 10 : top <= 100 ? 20 : top <= 200 ? 50 : 100;
  const yMax = Math.ceil(top / step) * step;
  const x = (i) => L + (series.length > 1 ? (i / (series.length - 1)) * (W - L - R) : 0);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const round = (turn) => Math.max(1, Math.ceil(turn / n));
  const grid = [];
  for (let v = 0; v <= yMax; v += step) {
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`);
  }
  // Rondas: primer y último punto de cada una
  const rounds = new Map();
  series.forEach((pt, i) => {
    const r = round(pt.turn);
    if (!rounds.has(r)) rounds.set(r, { first: i, last: i });
    rounds.get(r).last = i;
  });
  const every = Math.max(1, Math.ceil(rounds.size / 10));
  const ticks = [...rounds].filter(([r]) => r === 1 || r % every === 0)
    .map(([r, o]) => `<text x="${x(o.first)}" y="${H - 10}" class="axis" text-anchor="middle">${r}</text>`).join('');
  const cols = [...rounds].map(([r, o], k, arr) => {
    const x0 = k ? (x(arr[k - 1][1].last) + x(o.first)) / 2 : L;
    const x1 = k < arr.length - 1 ? (x(o.last) + x(arr[k + 1][1].first)) / 2 : W - R;
    const tip = `<b>${t('stats.round', { n: r })}</b><br>${game.players.map((p, i) => `${esc(pname(p.name))}: ${series[o.last].v[i]}`).join('<br>')}`;
    return `<rect x="${x0}" y="${T}" width="${Math.max(1, x1 - x0)}" height="${H - T - B}" class="hover-col" data-tip="${esc(tip)}"/>`;
  }).join('');
  const lines = game.players.map((p, i) => {
    const pts = series.map((pt, k) => `${x(k).toFixed(1)},${y(pt.v[i]).toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${playerHex(game, p)}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join('');
  const legend = game.players.map((p) => `<span><i style="background:${playerHex(game, p)}"></i>${esc(pname(p.name))}</span>`).join('');
  return `<figure class="chart">
    <figcaption>${t('stats.coinsChart')}</figcaption>
    <div class="legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('stats.coinsChart')}">${grid.join('')}${lines}${ticks}${cols}</svg>
    <div class="axis-title">${t('stats.roundAxis')}</div>
    ${extra}
  </figure>`;
}

// Tarta con agujero: de dónde salen las monedas que ha ganado el jugador
function incomeDonut(st) {
  const total = INCOME.reduce((s, k) => s + st.income[k], 0);
  const R = 52, r = 32, C = 60;
  let a = -Math.PI / 2;
  const arcs = [];
  for (const k of INCOME) {
    const v = st.income[k];
    if (!v) continue;
    const da = (v / total) * Math.PI * 2;
    const tip = `<b>${t(`income.${k}`)}</b><br>${t('stats.coinsPct', { coins: v, pct: Math.round((v / total) * 100) })}`;
    if (da >= Math.PI * 2 - 1e-6) {
      arcs.push(`<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${INCOME_COLORS[k]}" stroke-width="${R - r}" data-tip="${esc(tip)}"/>`);
    } else {
      const p = (ang, rad) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
      const large = da > Math.PI ? 1 : 0;
      arcs.push(`<path d="M${p(a, R)} A${R},${R} 0 ${large} 1 ${p(a + da, R)} L${p(a + da, r)} A${r},${r} 0 ${large} 0 ${p(a, r)} Z" fill="${INCOME_COLORS[k]}" class="slice" data-tip="${esc(tip)}"/>`);
    }
    a += da;
  }
  const legend = INCOME.filter((k) => st.income[k]).map((k) => `<li><i style="background:${INCOME_COLORS[k]}"></i>${t(`income.${k}`)} <b>${st.income[k]}</b></li>`).join('');
  return `<div class="donut">
    <svg viewBox="0 0 120 120" role="img" aria-label="${t('stats.income')}">${arcs.join('') || `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="#d8cfb4" stroke-width="${R - r}"/>`}
      <text x="${C}" y="${C + 2}" text-anchor="middle" class="donut-total">${total}</text><text x="${C}" y="${C + 16}" text-anchor="middle" class="donut-sub">${t('stats.coinsShort')}</text></svg>
    <ul>${legend}</ul>
  </div>`;
}

// fresh: premios conseguidos por primera vez en la cuenta ('title:id' / 'achievement:id')
function playerStatsHtml(game, p, i, awards, fresh = null) {
  const st = game.stats.players[i];
  const fishing = game.options?.mode === 'fishing';
  const bt = bestTurn(st);
  const pct = st.flipped ? Math.round((st.won / st.flipped) * 100) : 0;
  const tile = (label, value) => `<div class="tile"><span>${label}</span><b>${value}</b></div>`;
  const isNew = (kind, id) => (fresh?.has(`${kind}:${id}`) ? ` <span class="new-badge">${t('acc.new')}</span>` : '');
  const titles = awards.titles.map((id) => `<li class="award" data-tip="${esc(t(`titleDesc.${id}`))}">🏅 ${t(`title.${id}`)}${isNew('title', id)}</li>`).join('');
  const achievements = awards.achievements.map((id) => `<li class="award ach" data-tip="${esc(t(`titleDesc.${id}`))}">🏆 ${t(`title.${id}`)}${isNew('achievement', id)}</li>`).join('');
  return `<section class="player-stats" style="--pc:${playerHex(game, p)}" aria-label="${esc(pname(p.name))}">
    <h3><i></i>${esc(pname(p.name))}</h3>
    <p class="final-row">${t('stats.final', { board: p.board, spaces: game.boardSpaces.length, coins: p.coins, crops: p.plots.filter((pl) => pl.crop).length })}</p>
    <div class="tiles">
      ${tile(t('stats.harvested'), st.harvested)}
      ${tile(t('stats.bestTurn'), bt.turn ? t('stats.bestTurnValue', { n: bt.turn, coins: bt.coins }) : '—')}
      ${tile(t(fishing ? 'stats.fishCards' : 'stats.mineCards'), st.flipped)}
      ${tile(t(fishing ? 'stats.winRateFishing' : 'stats.winRateMine'), st.flipped ? t('stats.winRateValue', { pct, won: st.won, total: st.flipped }) : '—')}
    </div>
    ${incomeDonut(st)}
    <div class="awards">
      <h4>${t('stats.titles')}</h4><ul>${titles || `<li class="none">${t('stats.none')}</li>`}</ul>
      <h4>${t('stats.achievements')}</h4><ul>${achievements || `<li class="none">${t('stats.none')}</li>`}</ul>
    </div>
  </section>`;
}

// Carrusel de estadísticas individuales: una tarjeta por jugador. Solo se mueve cuando el
// jugador pulsa las flechas o los puntos o arrastra la tarjeta, y no da la vuelta.
// La tarjeta visible se recuerda aunque se vuelva a pintar el diálogo (misma partida).
let slide = { key: null, index: 0, count: 0 };

function carouselHtml(game, awards, start, account) {
  const key = game.stats.start;
  if (slide.key !== key) slide = { key, index: start, count: game.players.length };
  const i = slide.index;
  const dots = game.players.map((p, k) => `<button class="dot${k === i ? ' on' : ''}" data-act="statsGo" data-i="${k}" style="--pc:${playerHex(game, p)}" aria-label="${esc(pname(p.name))}"></button>`).join('');
  return `<div class="stats-carousel">
    <div class="carousel-viewport">
      <div class="carousel-track" style="transform:translateX(${-i * 100}%)">${game.players.map((p, k) => playerStatsHtml(game, p, k, awards[k], account?.me === k ? account.fresh : null)).join('')}</div>
    </div>
    <div class="carousel-nav">
      <button class="nav-arrow" data-act="statsPrev" aria-label="${t('stats.prev')}" ${i === 0 ? 'disabled' : ''}>‹</button>
      <div class="dots">${dots}</div>
      <button class="nav-arrow" data-act="statsNext" aria-label="${t('stats.next')}" ${i === slide.count - 1 ? 'disabled' : ''}>›</button>
    </div>
  </div>`;
}

// Mueve el carrusel a la tarjeta i (sin volver a pintar el diálogo)
export function goStatsSlide(i) {
  const root = document.querySelector('.stats-carousel');
  if (!root) return;
  slide.index = Math.max(0, Math.min(slide.count - 1, i));
  const track = root.querySelector('.carousel-track');
  track.style.transition = '';
  track.style.transform = `translateX(${-slide.index * 100}%)`;
  root.querySelectorAll('.dot').forEach((d, k) => d.classList.toggle('on', k === slide.index));
  root.querySelector('[data-act=statsPrev]').disabled = slide.index === 0;
  root.querySelector('[data-act=statsNext]').disabled = slide.index === slide.count - 1;
}
export const statsSlideBy = (d) => goStatsSlide(slide.index + d);

// Arrastrar la tarjeta (ratón o dedo): si se mueve lo bastante, pasa a la siguiente o la anterior
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const vp = e.target.closest('.carousel-viewport');
  if (!vp || e.button > 0) return;
  drag = { x: e.clientX, dx: 0, w: vp.clientWidth, track: vp.querySelector('.carousel-track') };
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.dx = e.clientX - drag.x;
  if (Math.abs(drag.dx) < 6) return;
  // En los extremos se resiste (no hay bucle)
  const edge = (slide.index === 0 && drag.dx > 0) || (slide.index === slide.count - 1 && drag.dx < 0);
  const dx = edge ? drag.dx / 4 : drag.dx;
  drag.track.style.transition = 'none';
  drag.track.style.transform = `translateX(calc(${-slide.index * 100}% + ${dx}px))`;
});
const endDrag = () => {
  if (!drag) return;
  const { dx, w } = drag;
  drag = null;
  goStatsSlide(slide.index + (Math.abs(dx) > Math.min(80, w / 5) ? (dx < 0 ? 1 : -1) : 0));
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// me: índice del jugador de este ordenador (online); en local, la primera persona
// Guardado en la cuenta (solo partidas online): botón para iniciar sesión o estado del guardado.
// Los botones data-acc los gestiona js/account.js.
function accountLine(account) {
  if (!account) return '';
  if (account.status === 'pending') return `<div class="acc-save"><button class="btn" data-acc="save">${t('acc.saveProgress')}</button></div>`;
  if (account.status === 'saving') return `<p class="acc-save">${t('acc.saving')}</p>`;
  if (account.status === 'saved') return `<p class="acc-save ok">${t('acc.saved')}</p>`;
  return `<p class="acc-save err">${t('acc.saveError')} <button class="btn small" data-acc="retry">${t('acc.retry')}</button></p>`;
}

// account: { status, fresh, me } de js/account.js (null si no hay cuentas o no se guarda)
export function gameOverHtml(game, { canRestart = true, me = null, account = null } = {}) {
  const title = game.winners.length === 1
    ? t('over.wins', { name: esc(pname(game.winners[0].name)) })
    : t('over.shared');
  const button = canRestart
    ? `<button class="btn" data-act="restart">${t('over.restart')}</button>`
    : `<p>${t('over.hostRestarts')}</p>`;
  const gaveUp = game.surrendered !== null && game.surrendered !== undefined
    ? `<p>${t('over.gaveUp', { name: esc(pname(game.players[game.surrendered].name)) })}</p>` : '';
  if (!game.stats) return `<h1>${title}</h1>${gaveUp}${button}`;
  const awards = computeAwards(game);
  const st = game.stats;
  const turns = Math.max(...st.players.map((x) => x.turns));
  const tiles = `<div class="tiles">
        <div class="tile"><span>${t('stats.duration')}</span><b>${fmtDuration((st.end ?? Date.now()) - st.start)}</b></div>
        <div class="tile"><span>${t('stats.turns')}</span><b>${turns}</b></div>
      </div>`;
  const start = me ?? Math.max(0, game.players.findIndex((p) => !p.cpu));
  return `<div class="game-over">
    <h1>${title}</h1>${gaveUp}
    <div class="stats-layout">
      ${coinsChart(game, tiles)}
      ${carouselHtml(game, awards, start, account)}
    </div>
    ${accountLine(account)}
    ${button}
  </div>`;
}
