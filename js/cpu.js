// Jugadores controlados por el ordenador (CPU) de nivel fácil, medio y difícil.
// No toca el DOM: cpuStep() hace UNA acción del jugador al que le toca (o responde a
// la pregunta pendiente) usando los mismos métodos públicos que la interfaz.
import { circlesOf } from './game.js';

export const CPU_LEVELS = { easy: 'fácil', medium: 'media', hard: 'difícil' };

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const chance = (p) => Math.random() < p;

// Memoria del turno en curso (objetivo de riego, tiradas ya hechas…)
const memory = new WeakMap();
function mem(game) {
  let m = memory.get(game);
  if (!m || m.turn !== game.turnNumber) {
    m = { turn: game.turnNumber };
    memory.set(game, m);
  }
  return m;
}

// ---------- valoraciones ----------

// Monedas totales que da un cultivo (riegos + cosecha)
const seedMoney = (def) => def.waterRewards.reduce((s, v) => s + v, 0) + def.harvest;
// Ganancia: monedas totales menos lo que cuesta
const seedProfit = (def) => seedMoney(def) - def.cost;

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

const cropIndices = (p) => p.plots.map((pl, i) => (pl.crop ? i : -1)).filter((i) => i >= 0);

// ¿Se puede hacer algo con este cultivo (regarlo si le falta agua, cosecharlo si está listo)?
function actionable(game, p, i, W, S) {
  const crop = p.plots[i]?.crop;
  if (!crop) return false;
  return game.isMature(crop) ? S > 0 : W > 0;
}

function moveOn(game, p, i) {
  return { plot: i, kind: game.isMature(p.plots[i].crop) ? 'harvest' : 'water' };
}

// Fácil: elige un cultivo al azar y lo riega hasta el final; si puede, lo cosecha
// antes de pasar a otro cultivo (también al azar).
function easyCropMove(game, p) {
  const m = mem(game);
  const W = units(p, 'waterLeft'), S = units(p, 'sickleLeft');
  const valid = m.target != null && p.plots[m.target]?.crop?.uid === m.targetUid && actionable(game, p, m.target, W, S);
  if (!valid) {
    const opts = cropIndices(p).filter((i) => actionable(game, p, i, W, S));
    if (!opts.length) return null;
    m.target = pick(opts);
    m.targetUid = p.plots[m.target].crop.uid;
  }
  return moveOn(game, p, m.target);
}

// Media: de los cultivos que puede llevar hasta la cosecha con las regaderas y hoces de la mano,
// elige el que más dinero da en total; cuando lo cosecha, elige el siguiente con lo que sobre.
// Si no puede terminar ninguno, riega el que más dinero le queda por dar.
function mediumCropMove(game, p) {
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

// Difícil: reparte las regaderas y hoces de la mano entre sus cultivos para ganar el máximo
// de monedas este turno. Para desempatar, prefiere avanzar los cultivos (cada riego suma una
// fracción mínima de lo que le queda por dar al cultivo, siempre menos de 1 moneda en total).
const EPS = 0.001;
function hardCropMove(game, p) {
  const W = units(p, 'waterLeft'), S = units(p, 'sickleLeft');
  // dp: clave "agua,hoz" usadas → { v, plan: [{ i, k, h }] }
  let dp = new Map([['0,0', { w: 0, s: 0, v: 0, plan: [] }]]);
  for (const i of cropIndices(p)) {
    const crop = p.plots[i].crop;
    const need = needWater(crop);
    const per = (seedMoney(crop.def) + 1) / circlesOf(crop.def);
    const next = new Map();
    const put = (st) => {
      const key = `${st.w},${st.s}`;
      if (!next.has(key) || next.get(key).v < st.v) next.set(key, st);
    };
    for (const st of dp.values()) {
      for (let k = 0; k <= Math.min(need, W - st.w); k++) {
        const base = st.v + waterCoins(crop, k) + EPS * k * per;
        put({ w: st.w + k, s: st.s, v: base, plan: k ? [...st.plan, { i, k, h: false }] : st.plan });
        if (k === need && st.s < S) {
          put({ w: st.w + k, s: st.s + 1, v: base + harvestValue(game, p, i), plan: [...st.plan, { i, k, h: true }] });
        }
      }
    }
    dp = next;
  }
  const top = best([...dp.values()], (st) => st.v);
  if (!top || !top.plan.length) return null;
  // Primero lo que ya se puede cosechar (deja la parcela libre); después, los riegos
  const ready = top.plan.find((x) => x.h && x.k === 0);
  if (ready) return { plot: ready.i, kind: 'harvest' };
  const step = top.plan.find((x) => x.k > 0);
  return { plot: step.i, kind: 'water' };
}

// Mina o pesca con las cartas que han quedado sin usar
function expedition(game, p, level) {
  const m = mem(game);
  const free = p.hand.filter((c) => !c.used);
  if (game.fishingMode) {
    if (!free.length || m.fished) return false;
    m.fished = true;
    if (level === 'easy' && !chance(0.5)) return false;
    game.selection = free.map((c) => c.uid);
    game.goFish();
    return true;
  }
  const cost = game.mineCost();
  if (free.length < cost || m.noMine) return false;
  if (level === 'easy' && !chance(0.5)) { m.noMine = true; return false; }
  game.selection = free.slice(0, cost).map((c) => c.uid);
  game.goMine();
  return true;
}

function actionStep(game, level) {
  const p = game.player;
  // Si se ha quedado una parcela libre y hay algo en el almacén, lo planta (y así lo puede regar)
  if (game.canOpenWarehouse()) { game.openWarehouse(); return true; }
  const move = level === 'easy' ? easyCropMove(game, p)
    : level === 'medium' ? mediumCropMove(game, p) : hardCropMove(game, p);
  if (move && doCropMove(game, p, move)) return true;
  if (expedition(game, p, level)) return true;
  game.endActions();
  return true;
}

// ---------- fase de compra ----------

const MEDIUM_TOOL_RANK = { wc5: 0, mix2: 1, wc3: 1, wc2: 2, mix1: 3, sk2: 4 };
const HARD_TOOL_RANK = { wc5: 0, mix2: 1, wc3: 2, wc2: 3, mix1: 4, sk2: 5 };

function buyStep(game, level) {
  const p = game.player;
  const m = game.market;
  const memo = mem(game);
  const seeds = m.seeds.map((_, i) => i).filter((i) => game.canBuySeed(i));
  let tools = m.tools.map((_, i) => i).filter((i) => game.canBuyTool(i));
  const adv = game.canAdvanceBoard();
  const assorted = game.canUseAssorted();

  if (level === 'easy') {
    // Si puede poner una moneda de 10, un 75 % de probabilidad de hacerlo
    if (adv && !memo.farmDeclined) {
      if (chance(0.75)) { game.advanceBoard(); return true; }
      memo.farmDeclined = true;
    }
    const opts = [
      ...seeds.map((i) => () => game.buySeed(i)),
      ...tools.map((i) => () => game.buyTool(i)),
      ...(assorted ? [() => game.useAssorted()] : []),
    ];
    if (!opts.length) { game.passTurn(); return true; }
    pick(opts)();
    return true;
  }

  // Media y difícil: primero el tablero si tiene más de 12 monedas (sin cultivos) o de 10 (con alguno)
  const planted = p.plots.filter((pl) => pl.crop).length;
  if (adv && p.coins > (planted ? 10 : 12)) { game.advanceBoard(); return true; }
  const free = game.freePlots(p).length;

  if (level === 'medium') {
    if (free && seeds.length) { game.buySeed(best(seeds, (i) => seedMoney(m.seeds[i]))); return true; }
    if (free && assorted) { game.useAssorted(); return true; }
    if (tools.length) { game.buyTool(bestRandom(tools, (i) => -MEDIUM_TOOL_RANK[toolKind(m.tools[i])])); return true; }
  } else {
    const buySeed = () => {
      if (seeds.length) {
        game.buySeed(best(seeds, (i) => seedProfit(m.seeds[i]) * 100 - circlesOf(m.seeds[i])));
        return true;
      }
      if (assorted) { game.useAssorted(); return true; }
      return false;
    };
    // Semillas hasta cubrir al menos la mitad de las parcelas, luego herrería y luego el resto de parcelas
    if (free && planted < Math.ceil(p.plots.length / 2) && buySeed()) return true;
    // Hoz + regadera x1 solo si queda alguna hoz inicial que sustituir
    if (game.replaceableCount(p, 'sickle') <= 0) tools = tools.filter((i) => toolKind(m.tools[i]) !== 'mix1');
    if (tools.length) { game.buyTool(best(tools, (i) => -HARD_TOOL_RANK[toolKind(m.tools[i])])); return true; }
    if (free && buySeed()) return true;
  }
  if (adv) { game.advanceBoard(); return true; }
  game.passTurn();
  return true;
}

// ---------- preguntas ----------

// Orden de prioridad de las mejoras de granja de la CPU difícil (menor = mejor)
function hardFarmRank(p, def) {
  const count = (type) => p.upgrades.filter((u) => u.def.type === type).length;
  const animals = count('animal');
  const n = p.upgrades.length; // mejoras que ya tiene (esta sería la n + 1)
  switch (def.type) {
    case 'animal': return 0;
    case 'fodder': return animals ? 1 : 12;
    case 'seedmaker': return 2;
    case 'sprinkler': return 3;
    case 'harvester': return count('sprinkler') >= 2 || n < 3 ? 4 : 13;
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

function replaceChoice(level, def, options) {
  if (options.length === 1) return options[0];
  if (level === 'easy') return pick(options);
  const k = toolKind(def);
  if (level === 'medium') return k === 'mix1' ? 'sickle' : pick(options);
  return 'sickle'; // difícil: las mixtas sustituyen siempre a las hoces
}

// ¿Sigue pescando después de un pez?
function keepFishing(game, level) {
  const f = game.fishing;
  if (!f) return false;
  if (level === 'easy') return chance(0.5);
  if (level === 'medium') return f.power >= 2;
  // Difícil: cuenta las cartas que quedan y sigue si lo que espera ganar supera lo que arriesga
  const m = game.market;
  const pool = m.mineDeck.length ? m.mineDeck : m.mineDiscard;
  if (!pool.length) return false;
  const risk = f.caught[f.caught.length - 1]?.coins ?? 0;
  let gain = 0, fail = 0;
  for (const c of pool) if (c.fish <= f.power) gain += c.coins; else fail++;
  return gain > fail * risk;
}

function answerPrompt(game, level, pr) {
  const p = game.player;
  switch (pr.type) {
    case 'choosePlot': {
      const b = game.bestPlot(p, pr.seed);
      const i = level === 'easy' ? pick(pr.options) : pr.options.includes(b) ? b : pr.options[0];
      game.choosePlot(i);
      break;
    }
    case 'chooseFarm': {
      const slots = game.market.farm.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
      const i = level === 'hard' ? best(slots, (s) => -hardFarmRank(p, game.market.farm[s])) : pick(slots);
      game.chooseFarm(i);
      break;
    }
    case 'chooseReplace':
      game.chooseReplace(replaceChoice(level, pr.tool, pr.options));
      break;
    case 'harvestStore': {
      const opts = pr.options.map((uid) => p.upgrades.find((u) => u.uid === uid)).filter(Boolean);
      let u;
      if (level === 'easy') u = pick([...opts, null]);
      else u = opts.find((x) => x.def.type === 'seedmaker') ?? opts[0];
      game.resolveHarvestStore(u ? u.uid : null);
      break;
    }
    case 'chooseStored': {
      const idx = p.warehouse.map((_, i) => i);
      const i = level === 'easy' ? pick(idx)
        : level === 'medium' ? best(idx, (j) => seedMoney(p.warehouse[j]))
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
