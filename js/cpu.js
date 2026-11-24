// Jugadores controlados por el ordenador (CPU) de nivel fácil, medio y difícil.
// No toca el DOM: cpuStep() hace UNA acción del jugador al que le toca (o responde a
// la pregunta pendiente) usando los mismos métodos públicos que la interfaz.
//
// - Fácil: termina el cultivo que más dinero da con la mano; compra la semilla que más da.
// - Media: reparte la mano entre todos sus cultivos para ganar lo máximo este turno.
// - Difícil: como la media, pero hace trampas (ve la siguiente carta de la mina o de la pesca)
//   y juega con estrategias que combinan mejoras (ver README).
import { circlesOf, shuffle } from './game.js';

export const CPU_LEVELS = { easy: 'fácil', medium: 'media', hard: 'difícil' };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Memoria del turno en curso (objetivo de riego, salidas ya hechas…)
const memory = new WeakMap();
function mem(game) {
  let m = memory.get(game);
  if (!m || m.turn !== game.turnNumber) {
    m = { turn: game.turnNumber };
    memory.set(game, m);
  }
  return m;
}

// Memoria de cada jugador durante toda la partida (estrategias activas, almacén…)
const longMemory = new WeakMap();
function pmem(game, p) {
  let all = longMemory.get(game);
  if (!all) { all = new Map(); longMemory.set(game, all); }
  const key = game.players.indexOf(p);
  if (!all.has(key)) all.set(key, { since: {}, warehouse: 'fill' });
  return all.get(key);
}

// ---------- valoraciones ----------

// Monedas totales que da un cultivo (riegos + cosecha)
const seedMoney = (def) => def.waterRewards.reduce((s, v) => s + v, 0) + def.harvest;
// Ganancia: monedas totales menos lo que cuesta
const seedProfit = (def) => seedMoney(def) - def.cost;
const isCoffee = (def) => def?.id === 'coffee';

// Monedas al cosechar el cultivo de una parcela (con abono y bonus de parcela extra)
function harvestValue(game, p, plotIndex) {
  const pl = p.plots[plotIndex];
  const def = pl.crop.def;
  let v = def.harvest;
  if (game.has(p, 'fertiliser')) v += 1;
  if (pl.def && pl.def.circles.includes(circlesOf(def))) v += pl.def.bonus;
  return v;
}

// Monedas de regar k veces un cultivo desde su estado actual (sin contar la cosecha)
function waterCoins(crop, k) {
  const c = circlesOf(crop.def);
  let s = 0;
  for (let w = crop.water; w < crop.water + k && w < c; w++) if (w + 1 < c) s += crop.def.waterRewards[w];
  return s;
}

const needWater = (crop) => Math.max(0, circlesOf(crop.def) - crop.water);
const units = (p, key) => p.hand.reduce((s, c) => s + c[key], 0);

// Tipo de carta de herrería: wc5, wc3, wc2 (regaderas), mix2, mix1 (hoz + regadera), sk2 (hoz)
const toolKind = (def) => (def.water && def.sickle ? `mix${def.water}` : def.water ? `wc${def.water}` : `sk${def.sickle}`);

// Argmax: devuelve el elemento con mayor puntuación (en empate, el primero)
function best(items, score) {
  let out = null, top = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > top) { top = s; out = it; }
  }
  return out;
}
// Igual, pero en empate elige al azar
function bestRandom(items, score) {
  if (!items.length) return null;
  const top = Math.max(...items.map(score));
  return pick(items.filter((it) => score(it) === top));
}

// ---------- estrategias de la CPU difícil ----------

const count = (p, type) => p.upgrades.filter((u) => u.def.type === type).length;
const cropIndices = (p) => p.plots.map((pl, i) => (pl.crop ? i : -1)).filter((i) => i >= 0);

// Café + semilladora: se activa al comprar el café y dura mientras lo tenga (plantado,
// en la semilladora o en el almacén)
function hasCoffee(game, p) {
  return p.plots.some((pl) => isCoffee(pl.crop?.def))
    || isCoffee(game.findUpgrade(p, 'seedmaker')?.stored?.def)
    || p.warehouse.some(isCoffee);
}
// La semilladora tiene el café guardado y aún no lo ha replantado: se le reserva una parcela
function coffeeReserve(game, p) {
  const sm = game.findUpgrade(p, 'seedmaker');
  return sm && isCoffee(sm.stored?.def) ? 1 : 0;
}
const seedmakerFree = (game, p) => { const sm = game.findUpgrade(p, 'seedmaker'); return !!sm && !sm.stored; };

// Cartas que hacen falta para cada estrategia: si coinciden varias que deciden qué semillas
// comprar, manda la que necesita menos cartas (la de menos riesgo); en empate, la más antigua.
const STRATEGY_CARDS = { warehouse: 2, expedition: 3, twoState: 3 };

function strategies(game, p) {
  const pm = pmem(game, p);
  const active = {
    coffee: hasCoffee(game, p),
    // Dos aspersores + cosechadora: cultivos de dos riegos que se riegan y cosechan solos
    twoState: count(p, 'sprinkler') >= 2 && game.has(p, 'harvester'),
    // Equipo de mina/pesca + perro y gato: deja de comprar semillas y va a la mina/pesca
    expedition: game.has(p, 'equipment') && game.has(p, 'dogcat'),
    // Almacén + semillas varias: llena el almacén con semillas varias y lo vacía antes de volver a comprar
    warehouse: game.has(p, 'warehouse') && game.has(p, 'assorted'),
  };
  for (const [k, on] of Object.entries(active)) {
    if (on) pm.since[k] ??= game.turnNumber;
    else delete pm.since[k];
  }
  const seedStrategies = Object.keys(STRATEGY_CARDS).filter((k) => active[k])
    .sort((a, b) => (STRATEGY_CARDS[a] - STRATEGY_CARDS[b]) || (pm.since[a] - pm.since[b]));
  return {
    ...active,
    harvester: game.has(p, 'harvester'), // las hoces solo sirven para la mina o la pesca
    seeds: seedStrategies[0] ?? 'default',
    reserve: coffeeReserve(game, p),
  };
}

// ---------- fase de acciones ----------

// Carta con la que regar o cosechar: primero las ya usadas (no pueden ir a la mina/pesca)
// y, entre las demás, la que más usos tenga (así quedan más cartas libres para la mina).
function cardFor(p, key) {
  const cands = p.hand.filter((c) => c[key] > 0);
  cands.sort((a, b) => (b.used - a.used) || (b[key] - a[key]));
  return cands[0] ?? null;
}

function doCropMove(game, p, move) {
  const card = cardFor(p, move.kind === 'water' ? 'waterLeft' : 'sickleLeft');
  if (!card) return false;
  game.selection = [];
  game.toggleSelect(card.uid);
  game.useOnCrop(move.plot);
  return true;
}

// ¿Se puede hacer algo con este cultivo (regarlo si le falta agua, cosecharlo si está listo)?
function actionable(game, p, i, W, S) {
  const crop = p.plots[i]?.crop;
  if (!crop) return false;
  return game.isMature(crop) ? S > 0 : W > 0;
}

function moveOn(game, p, i) {
  return { plot: i, kind: game.isMature(p.plots[i].crop) ? 'harvest' : 'water' };
}

// Fácil: de los cultivos que puede llevar hasta la cosecha con las regaderas y hoces de la mano,
// elige el que más dinero da en total; cuando lo cosecha, elige el siguiente con lo que sobre.
// Si no puede terminar ninguno, riega el que más dinero le queda por dar.
function easyCropMove(game, p) {
  const m = mem(game);
  const W = units(p, 'waterLeft'), S = units(p, 'sickleLeft');
  const valid = m.target != null && p.plots[m.target]?.crop?.uid === m.targetUid && actionable(game, p, m.target, W, S);
  if (!valid) {
    const crops = cropIndices(p);
    const total = (i) => { const c = p.plots[i].crop; return waterCoins(c, needWater(c)) + harvestValue(game, p, i); };
    let target = best(crops.filter((i) => needWater(p.plots[i].crop) <= W && S > 0), total);
    if (target == null && W > 0) target = best(crops.filter((i) => !game.isMature(p.plots[i].crop)), total);
    if (target == null) return null;
    m.target = target;
    m.targetUid = p.plots[target].crop.uid;
  }
  return moveOn(game, p, m.target);
}

// Reparto óptimo de W riegos y S cosechas entre los cultivos. Valor = monedas de este turno
// + progress × (lo que vale cada riego del cultivo) por cada riego. opts.cap(crop) limita los
// riegos de un cultivo y opts.canHarvest(i) dice si se puede cosechar.
const EPS = 0.001; // la media solo usa el progreso para desempatar
const PROGRESS = 0.5; // la difícil valora así lo que avanza un cultivo al compararlo con la mina/pesca
function cropPlan(game, p, W, S, { progress = EPS, cap = null, canHarvest = null } = {}) {
  let dp = new Map([['0,0', { w: 0, s: 0, v: 0, plan: [] }]]);
  for (const i of cropIndices(p)) {
    const crop = p.plots[i].crop;
    const need = needWater(crop);
    const maxK = cap ? Math.min(need, cap(crop)) : need;
    const harvestable = !canHarvest || canHarvest(i);
    const per = (seedMoney(crop.def) + 1) / circlesOf(crop.def);
    const next = new Map();
    const put = (st) => {
      const key = `${st.w},${st.s}`;
      if (!next.has(key) || next.get(key).v < st.v) next.set(key, st);
    };
    for (const st of dp.values()) {
      for (let k = 0; k <= Math.min(maxK, W - st.w); k++) {
        const base = st.v + waterCoins(crop, k) + progress * k * per;
        put({ w: st.w + k, s: st.s, v: base, plan: k ? [...st.plan, { i, k, h: false }] : st.plan });
        if (k === need && st.s < S && harvestable) {
          put({ w: st.w + k, s: st.s + 1, v: base + harvestValue(game, p, i), plan: [...st.plan, { i, k, h: true }] });
        }
      }
    }
    dp = next;
  }
  return best([...dp.values()], (st) => st.v);
}

// Media (y difícil): sigue el reparto óptimo. Primero lo que ya se puede cosechar (deja la
// parcela libre); después, los riegos.
function planMove(game, p, opts = {}) {
  const W = units(p, 'waterLeft');
  const S = opts.noSickles ? 0 : units(p, 'sickleLeft');
  const top = cropPlan(game, p, W, S, opts);
  if (!top || !top.plan.length) return null;
  const ready = top.plan.find((x) => x.h && x.k === 0);
  if (ready) return { plot: ready.i, kind: 'harvest' };
  const step = top.plan.find((x) => x.k > 0);
  return step ? { plot: step.i, kind: 'water' } : null;
}

// Reglas de cultivo de la difícil según sus estrategias
function hardCropOpts(game, p, strat) {
  return {
    noSickles: strat.harvester,
    // Con dos aspersores y cosechadora deja los cultivos a dos riegos: los terminan los aspersores
    cap: strat.twoState ? (crop) => Math.max(0, needWater(crop) - 2) : null,
    // El café solo se cosecha cuando la semilladora está libre para guardarlo
    canHarvest: strat.coffee ? (i) => !isCoffee(p.plots[i].crop.def) || seedmakerFree(game, p) : null,
  };
}

// Mina o pesca con las cartas que han quedado sin usar (fácil y media)
function expedition(game, p) {
  const m = mem(game);
  const free = p.hand.filter((c) => !c.used);
  if (game.fishingMode) {
    if (!free.length || m.fished) return false;
    m.fished = true;
    game.selection = free.map((c) => c.uid);
    game.goFish();
    return true;
  }
  const cost = game.mineCost();
  if (free.length < cost) return false;
  game.selection = free.slice(0, cost).map((c) => c.uid);
  game.goMine();
  return true;
}

// Trampa de la difícil: mira la siguiente carta del mazo de mina/pesca sin voltearla.
// Si el mazo está vacío, baraja antes el descarte (lo mismo que haría al robar).
function peek(game) {
  const m = game.market;
  if (!m.mineDeck.length && m.mineDiscard.length) {
    m.mineDeck = shuffle(m.mineDiscard);
    m.mineDiscard = [];
  }
  return m.mineDeck[m.mineDeck.length - 1] ?? null;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  const out = [];
  arr.forEach((x, i) => { for (const rest of combinations(arr.slice(i + 1), k - 1)) out.push([x, ...rest]); });
  return out;
}

// Difícil: antes de cada acción compara lo que darían las cartas en los cultivos con lo que da
// la siguiente carta de la mina/pesca (que puede ver). Va si la carta da más de lo que se pierde.
function cheatExpedition(game, p, opts) {
  const unused = p.hand.filter((c) => !c.used);
  if (!unused.length) return false;
  const W = units(p, 'waterLeft');
  const S = opts.noSickles ? 0 : units(p, 'sickleLeft');
  const valueOf = (w, s) => cropPlan(game, p, w, s, { ...opts, progress: PROGRESS })?.v ?? 0;
  const full = valueOf(W, S);
  const loss = (cards) => full - valueOf(
    W - cards.reduce((s, c) => s + c.waterLeft, 0),
    S - (opts.noSickles ? 0 : cards.reduce((s, c) => s + c.sickleLeft, 0)),
  );
  const next = peek(game);
  if (!next) return false;
  const go = (cards) => {
    game.selection = cards.map((c) => c.uid);
    if (game.fishingMode) game.goFish(); else game.goMine();
    return true;
  };

  if (game.fishingMode) {
    // Cartas que ya no sirven para los cultivos: salen todas juntas (como la media)
    if (loss(unused) <= 1e-9) return next.fish <= game.fishPower(unused) ? go(unused) : false;
    // Si no, la carta que más peces da (en empate, la que menos se pierde en los cultivos)
    const card = best(unused, (c) => game.fishPower([c]) * 1000 - loss([c]));
    return next.fish <= game.fishPower([card]) && next.coins > loss([card]) ? go([card]) : false;
  }
  const cost = game.mineCost();
  if (unused.length < cost) return false;
  // Las cartas que menos darían en los cultivos
  const cards = best(combinations(unused, cost), (cs) => -loss(cs));
  return next.coins > loss(cards) ? go(cards) : false;
}

function actionStep(game, level) {
  const p = game.player;
  if (level === 'hard') {
    const strat = strategies(game, p);
    // Planta desde el almacén si queda sitio (sin ocupar la parcela reservada para el café)
    if (game.canOpenWarehouse() && game.freePlots(p).length > strat.reserve) { game.openWarehouse(); return true; }
    const opts = hardCropOpts(game, p, strat);
    if (cheatExpedition(game, p, opts)) return true;
    const move = planMove(game, p, opts);
    if (move && doCropMove(game, p, move)) return true;
    game.endActions();
    return true;
  }
  // Si se ha quedado una parcela libre y hay algo en el almacén, lo planta (y así lo puede regar)
  if (game.canOpenWarehouse()) { game.openWarehouse(); return true; }
  const move = level === 'easy' ? easyCropMove(game, p) : planMove(game, p);
  if (move && doCropMove(game, p, move)) return true;
  if (expedition(game, p)) return true;
  game.endActions();
  return true;
}

// ---------- fase de compra ----------

const EASY_TOOL_RANK = { wc5: 0, mix2: 1, wc3: 1, wc2: 2, mix1: 3, sk2: 4 };
const TOOL_RANK = { wc5: 0, mix2: 1, wc3: 2, wc2: 3, mix1: 4, sk2: 5 };

// Herramienta preferida (media y difícil). En la pesca, entre dos del mismo tipo, la que más peces da.
function toolScore(game, def) {
  return -TOOL_RANK[toolKind(def)] * 100 + (game.fishingMode ? def.fish : 0);
}

// Bonus de una parcela extra libre que corresponda a la semilla (estrategia de la difícil)
function plotBonusFor(game, p, def) {
  const c = circlesOf(def);
  return game.freePlots(p).reduce((b, i) => (p.plots[i].def?.circles.includes(c) ? Math.max(b, p.plots[i].def.bonus) : b), 0);
}

function buyStep(game, level) {
  const p = game.player;
  const m = game.market;
  const seeds = m.seeds.map((_, i) => i).filter((i) => game.canBuySeed(i));
  let tools = m.tools.map((_, i) => i).filter((i) => game.canBuyTool(i));
  const adv = game.canAdvanceBoard();
  const assorted = game.canUseAssorted();

  // Todas: en cuanto puede pagar la última casilla, la compra (y se acaba su turno)
  if (adv && p.board === game.boardSpaces.length - 1) { game.advanceBoard(); return true; }
  // Difícil, última ronda: el rival ya ha completado el tablero; solo pone monedas en el
  // tablero y guarda el resto para el desempate
  if (level === 'hard' && game.lastRound) {
    if (adv) game.advanceBoard(); else game.passTurn();
    return true;
  }

  // Primero el tablero si tiene más de 12 monedas (sin cultivos) o de 10 (con alguno)
  const planted = p.plots.filter((pl) => pl.crop).length;
  if (adv && p.coins > (planted ? 10 : 12)) { game.advanceBoard(); return true; }
  const free = game.freePlots(p).length;

  if (level === 'easy') {
    if (free && seeds.length) { game.buySeed(best(seeds, (i) => seedMoney(m.seeds[i]))); return true; }
    if (free && assorted) { game.useAssorted(); return true; }
    if (tools.length) { game.buyTool(bestRandom(tools, (i) => -EASY_TOOL_RANK[toolKind(m.tools[i])])); return true; }
  } else {
    const strat = level === 'hard' ? strategies(game, p) : null;
    const room = free - (strat?.reserve ?? 0); // parcelas libres sin contar la reservada para el café
    const policy = strat?.seeds ?? 'default';
    const growing = policy === 'default' || policy === 'twoState';
    const seedScore = (def) => seedProfit(def) * 100 - circlesOf(def)
      + (strat ? plotBonusFor(game, p, def) * 100 : 0)
      // Dos aspersores + cosechadora: prefiere los cultivos de dos riegos (si no hay, compra como siempre)
      + (policy === 'twoState' && circlesOf(def) === 2 ? 1e6 : 0);
    const buySeed = () => {
      if (seeds.length) { game.buySeed(best(seeds, (i) => seedScore(m.seeds[i]))); return true; }
      if (assorted) { game.useAssorted(); return true; }
      return false;
    };

    if (policy === 'warehouse') {
      // Llena el almacén con semillas varias hasta tener al menos 5 y no vuelve a comprar
      // semillas hasta vaciarlo (siempre semillas varias: a 1 moneda no hay riesgo)
      const pm = pmem(game, p);
      if (!p.warehouse.length) pm.warehouse = 'fill';
      if (p.warehouse.length >= 5) pm.warehouse = 'drain';
      if (pm.warehouse === 'fill' && assorted) { game.useAssorted(); return true; }
    }
    // Semillas hasta cubrir al menos la mitad de las parcelas, luego herrería y luego el resto
    if (growing && room > 0 && planted < Math.ceil(p.plots.length / 2) && buySeed()) return true;
    if (policy === 'expedition') {
      // Solo herramientas que pesquen más que una carta inicial (en la mina no le sirven)
      tools = game.fishingMode ? tools.filter((i) => m.tools[i].fish > 0.5) : [];
    }
    // Hoz + regadera x1 solo si queda alguna hoz inicial que sustituir
    if (game.replaceableCount(p, 'sickle') <= 0) tools = tools.filter((i) => toolKind(m.tools[i]) !== 'mix1');
    if (tools.length) { game.buyTool(best(tools, (i) => toolScore(game, m.tools[i]))); return true; }
    if (growing && room > 0 && buySeed()) return true;
  }
  if (adv) { game.advanceBoard(); return true; }
  game.passTurn();
  return true;
}

// ---------- preguntas ----------

// Orden de prioridad de las mejoras de granja de la media y la difícil (menor = mejor)
function farmRank(game, p, def, level) {
  const animals = count(p, 'animal');
  const n = p.upgrades.length; // mejoras que ya tiene (esta sería la n + 1)
  switch (def.type) {
    case 'animal': return 0;
    case 'fodder': return animals ? 1 : 12;
    // Difícil: con café y sin semilladora, la semilladora pasa a ser lo primero
    case 'seedmaker': return level === 'hard' && hasCoffee(game, p) && !game.has(p, 'seedmaker') ? -1 : 2;
    case 'sprinkler': return 3;
    case 'harvester': return count(p, 'sprinkler') >= 2 || n < 3 ? 4 : 13;
    case 'plot': return 5;
    case 'pickler': return 6;
    case 'equipment': return 7;
    case 'fertiliser': return 8;
    case 'dogcat': return 9;
    case 'assorted': return 10;
    case 'warehouse': return 11;
    default: return 14;
  }
}

function chooseFarmSlot(game, p, level) {
  const m = game.market;
  const slots = m.farm.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  if (level === 'easy') return pick(slots);
  const rank = (s) => farmRank(game, p, m.farm[s], level);
  if (level === 'medium') return best(slots, (s) => -rank(s));
  // Difícil: entre las de prioridad parecida (hasta un puesto de diferencia), se queda con la
  // que más le serviría al rival
  const top = Math.min(...slots.map(rank));
  const rival = game.players.find((o) => o !== p);
  const cands = slots.filter((s) => rank(s) <= top + 1);
  const rivalRank = (s) => (rival && rival.upgrades.length < game.maxUpgrades ? farmRank(game, rival, m.farm[s], 'hard') : 0);
  return best(cands, (s) => -rivalRank(s) * 100 - rank(s));
}

function replaceChoice(level, def, options) {
  if (options.length === 1) return options[0];
  if (level === 'easy') return toolKind(def) === 'mix1' ? 'sickle' : pick(options);
  return 'sickle'; // media y difícil: las mixtas sustituyen siempre a las hoces
}

// ¿Sigue pescando después de un pez?
function keepFishing(game, level) {
  const f = game.fishing;
  if (!f) return false;
  if (level === 'easy') return f.power >= 2;
  // Difícil: ve el siguiente pez y solo sigue si lo puede pescar
  if (level === 'hard') {
    const next = peek(game);
    return !!next && next.fish <= f.power;
  }
  // Media: cuenta las cartas que quedan y sigue si lo que espera ganar supera lo que arriesga
  const m = game.market;
  const pool = m.mineDeck.length ? m.mineDeck : m.mineDiscard;
  if (!pool.length) return false;
  const risk = f.caught[f.caught.length - 1]?.coins ?? 0;
  let gain = 0, fail = 0;
  for (const c of pool) if (c.fish <= f.power) gain += c.coins; else fail++;
  return gain > fail * risk;
}

// Monedas que da la encurtidora por un cultivo
function pickleCoins(p, def) {
  const u = p.upgrades.find((x) => x.def.type === 'pickler');
  return u?.def.table.find((r) => r.circles.includes(circlesOf(def)))?.coins ?? 0;
}

// Difícil: dónde guarda un cultivo recién cosechado. Con semilladora y encurtidora, el mejor
// cultivo del turno va a la semilladora (el café siempre) y el segundo a la encurtidora; sin
// semilladora, la encurtidora se queda el que más monedas le daría.
function hardStoreChoice(game, p, pr, opts) {
  const sm = opts.find((u) => u.def.type === 'seedmaker');
  const pk = opts.find((u) => u.def.type === 'pickler');
  const def = pr.crop.def;
  const W = units(p, 'waterLeft');
  // Otros cultivos que todavía se pueden cosechar este turno
  const later = cropIndices(p).map((i) => p.plots[i].crop).filter((c) => needWater(c) <= W);
  if (sm && isCoffee(def)) return sm;
  if (sm && pk) {
    const rival = later.some((c) => isCoffee(c.def)) ? Infinity : Math.max(-Infinity, ...later.map((c) => seedProfit(c.def)));
    return seedProfit(def) >= rival ? sm : pk;
  }
  if (sm) {
    // No ocupa la semilladora si el café ya está listo para cosecharse
    const coffeeReady = p.plots.some((pl) => isCoffee(pl.crop?.def) && game.isMature(pl.crop));
    return coffeeReady ? null : sm;
  }
  if (pk) {
    if (game.has(p, 'seedmaker')) return pk;
    const top = Math.max(-Infinity, ...later.map((c) => pickleCoins(p, c.def)));
    return pickleCoins(p, def) >= top ? pk : null;
  }
  return null;
}

function answerPrompt(game, level, pr) {
  const p = game.player;
  switch (pr.type) {
    case 'choosePlot': {
      // Difícil: lo de semillas varias va al almacén si no queda sitio libre (sin la parcela del café)
      if (level === 'hard' && pr.source === 'assorted' && game.canStoreAssorted()
          && game.freePlots(p).length <= strategies(game, p).reserve) {
        game.storeAssorted();
        break;
      }
      const b = game.bestPlot(p, pr.seed);
      game.choosePlot(pr.options.includes(b) ? b : pr.options[0]);
      break;
    }
    case 'chooseFarm':
      game.chooseFarm(chooseFarmSlot(game, p, level));
      break;
    case 'chooseReplace':
      game.chooseReplace(replaceChoice(level, pr.tool, pr.options));
      break;
    case 'harvestStore': {
      const opts = pr.options.map((uid) => p.upgrades.find((u) => u.uid === uid)).filter(Boolean);
      const u = level === 'hard' ? hardStoreChoice(game, p, pr, opts)
        : opts.find((x) => x.def.type === 'seedmaker') ?? opts[0];
      game.resolveHarvestStore(u ? u.uid : null);
      break;
    }
    case 'chooseStored': {
      if (level === 'hard' && game.freePlots(p).length <= strategies(game, p).reserve) { game.cancelPrompt(); break; }
      const idx = p.warehouse.map((_, i) => i);
      // La difícil saca primero lo que más beneficio da
      const i = level === 'easy' ? best(idx, (j) => seedMoney(p.warehouse[j]))
        : best(idx, (j) => seedProfit(p.warehouse[j]) * 100 - circlesOf(p.warehouse[j]));
      game.chooseStored(i);
      break;
    }
    case 'fish':
      game.resolveFish(keepFishing(game, level));
      break;
    default:
      break;
  }
}

// Hace una acción de la CPU a la que le toca. Devuelve false si no es turno de una CPU.
export function cpuStep(game) {
  const p = game.player;
  const level = p?.cpu;
  if (!level || game.phase === 'gameOver') return false;
  const pr = game.prompts[0];
  if (pr) {
    answerPrompt(game, level, pr);
    // Red de seguridad: una pregunta que no se ha podido responder no debe bloquear la partida
    if (game.prompts[0] === pr) {
      if (pr.type === 'chooseStored' || pr.type === 'choosePlot') game.cancelPrompt();
      if (game.prompts[0] === pr) { game.prompts.shift(); game.afterPrompt(); }
    }
    return true;
  }
  game.selection = [];
  if (game.phase === 'action') return actionStep(game, level);
  if (game.phase === 'buy') return buyStep(game, level);
  return false;
}
