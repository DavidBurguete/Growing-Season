// Pinta el estado de la partida en el DOM. Cada interacción vuelve a pintar todo
// (el DOM es pequeño); los clics se recogen por delegación con data-act.

import { circlesOf, forcesExtras } from './game.js';
import { CPU_LEVELS } from './cpu.js';
import { t, loc, cardName, fmtNum, logText, LANGS, getLang } from './i18n.js';

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
  if (active && !game.prompts.length && !p.cpu && (me === null || me === index)) {
    if (game.phase === 'action') button = `<button class="btn" data-act="endActions">${t('btn.endActions')}</button>`;
    if (game.phase === 'buy') button = `<button class="btn" data-act="pass">${t('btn.pass')}</button>`;
  }

  // Rendirse: en local, el jugador al que le toca (contra la CPU, el humano en cualquier momento);
  // online, cada uno desde su ordenador
  const vsCpu = game.players.some((o) => o.cpu);
  const canSurrender = game.phase !== 'gameOver' && !p.cpu && (me === null ? active || vsCpu : me === index);
  const surrender = canSurrender
    ? `<button class="btn small surrender" data-act="surrender" data-i="${index}" title="${t('btn.surrender')}">🏳</button>` : '';

  const banner = `
    <div class="banner" style="--banner:${color}">
      <span class="name">${esc(p.name)}${me === index ? ` <small>(${t('player.you')})</small>` : ''}${p.cpu ? ` <small>(${t('player.cpu', { level: t(`cpu.${p.cpu}`) })})</small>` : ''}</span>
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

// Quién controla a cada jugador en la partida local: una persona o la CPU de un nivel
const cpuOptions = (sel) => [['', t('cpu.human')], ...Object.keys(CPU_LEVELS).map((k) => [k, t('player.cpu', { level: t(`cpu.${k}`) })])]
  .map(([k, v]) => `<option value="${k}" ${k === (sel ?? '') ? 'selected' : ''}>${v}</option>`).join('');

export function setupDialogHtml(cfg, defaults, options) {
  const opts = (sel) => Object.entries(cfg.colors)
    .map(([k, v]) => {
      const taken = k !== sel && defaults.some((d) => d.color === k);
      return `<option value="${k}" ${k === sel ? 'selected' : ''} ${taken ? 'disabled' : ''}>${esc(loc(v, 'label'))}</option>`;
    }).join('');
  return `
    <h1>Growing Season</h1>
    <p>${t('setup.subtitle')}</p>
    ${defaults.map((d, i) => `
      <div class="setup-player">
        <input id="name-${i}" value="${esc(d.name || t('setup.defaultName', { n: i + 1 }))}" maxlength="16" aria-label="${t('setup.nameLabel', { n: i + 1 })}">
        <select id="color-${i}" class="color-select" aria-label="${t('setup.colorLabel', { n: i + 1 })}">${opts(d.color)}</select>
        <select id="cpu-${i}" aria-label="${t('setup.cpuLabel', { n: i + 1 })}">${cpuOptions(d.cpu)}</select>
      </div>`).join('')}
    ${optionsHtml(cfg, options)}
    <button class="btn secondary" data-act="menu">${t('btn.back')}</button>
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
    <h2>${t('surrender.title', { name: esc(game.players[index].name) })}</h2>
    <p>${t('surrender.text')}</p>
    <button class="btn secondary" data-act="surrenderNo">${t('btn.cancel')}</button>
    <button class="btn danger" data-act="surrenderYes" data-i="${index}">${t('btn.surrender')}</button>`;
}

export function gameOverHtml(game, { canRestart = true } = {}) {
  const rows = game.players.map((p) => `<p>${t('over.row', { name: esc(p.name), board: p.board, spaces: game.boardSpaces.length, coins: p.coins, crops: p.plots.filter((pl) => pl.crop).length })}</p>`).join('');
  const title = game.winners.length === 1
    ? t('over.wins', { name: esc(game.winners[0].name) })
    : t('over.shared');
  const button = canRestart
    ? `<button class="btn" data-act="restart">${t('over.restart')}</button>`
    : `<p>${t('over.hostRestarts')}</p>`;
  const gaveUp = game.surrendered !== null && game.surrendered !== undefined
    ? `<p>${t('over.gaveUp', { name: esc(game.players[game.surrendered].name) })}</p>` : '';
  return `<h1>${title}</h1>${gaveUp}${rows}${button}`;
}
