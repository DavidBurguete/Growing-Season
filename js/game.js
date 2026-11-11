// Motor de reglas de Growing Season (modo 2 jugadores).
// No toca el DOM: la interfaz llama a los métodos públicos y vuelve a pintar.

let uidCounter = 0;
const uid = () => ++uidCounter;

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function expand(defs) {
  const out = [];
  for (const def of defs) for (let i = 0; i < (def.count ?? 1); i++) out.push(def);
  return out;
}

export const circlesOf = (seedDef) => seedDef.waterRewards.length + 1;
const TOOL_NAME = { watering: 'regadera', sickle: 'hoz' };
// 2.5 → "2,5"
export const fmtFish = (n) => String(n).replace('.', ',');

// Opciones de la partida: extras = usar las mejoras con estrella; mode = 'mine' o 'fishing';
// length = duración ('short', 'normal' o 'long'), que decide el tablero
export const DEFAULT_OPTIONS = { extras: false, mode: 'mine', length: 'normal' };

// En la partida larga hay más casillas de granero que mejoras sin estrella: se juega con todas
export const forcesExtras = (length) => length === 'long';

export class Game {
  constructor(data, playerSetup, options = {}) {
    this.data = data;
    this.cfg = data.config;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!this.cfg.boards[this.options.length]) this.options.length = DEFAULT_OPTIONS.length;
    if (forcesExtras(this.options.length)) this.options.extras = true;
    this.toolGift = []; // cartas de herrería ganadas en el tablero, pendientes de colocar
    this.surrendered = null;
    this.fishing = null; // salida de pesca en curso: { power, caught: [defs] }
    this.log = [];
    this.prompts = [];
    this.selection = [];
    this.current = 0;
    this.phase = 'action';
    this.lastRound = false;
    this.winners = [];
    this.turnNumber = 0;
    this.farmStep = null; // paso de las mejoras de inicio de turno (se reanuda tras cada pregunta)
    // Huecos del mercado recién repuestos (la interfaz los anima y vacía la lista)
    this.fresh = [];

    const seedDefs = data.seeds.cards.filter((c) => !c.starter);
    const allowed = (c) => this.options.extras || !c.extra;
    const expedition = this.fishingMode ? data.fishing.cards : data.mine.cards;
    this.market = {
      seedDeck: shuffle(expand(seedDefs)),
      seedDiscard: [],
      seeds: Array(this.cfg.market.seeds).fill(null),
      toolDeck: shuffle(expand(data.tools.shop.filter(allowed))),
      tools: Array(this.cfg.market.tools).fill(null),
      farmDeck: shuffle(expand(data.farm.cards.filter(allowed))),
      farm: Array(this.cfg.market.farm).fill(null),
      // En modo pesca, el mazo de la mina es el de pesca
      mineDeck: shuffle(expand(expedition)),
      mineDiscard: [],
      mineRevealed: null,
      assortedReveal: null, // carta sacada con Semillas varias, pendiente de colocar
    };
    this.refillMarket();

    const rewards = this.startingRewards(playerSetup.length);
    this.players = playerSetup.map((p, i) => this.createPlayer(p, rewards[i]));
    this.startTurn();
  }

  // ---------- creación ----------

  startingRewards(n) {
    const sr = this.cfg.startingRewards;
    const list = sr.list.slice(0, n);
    const k = Math.min(sr.randomize ?? 0, list.length);
    return [...shuffle(list.slice(0, k)), ...list.slice(k)];
  }

  createPlayer({ name, color }, reward = {}) {
    const t = this.data.tools;
    const deck = [];
    for (const type of ['watering', 'sickle']) {
      for (let i = 0; i < t.starterDeck[type]; i++) {
        deck.push(this.makeTool({
          id: `starter-${type}`,
          name: type === 'watering' ? 'Regadera' : 'Hoz',
          image: t.starters[color][type],
          ...t.starterValues[type],
          starter: type,
        }));
      }
    }
    const plots = [];
    for (let i = 0; i < this.cfg.basePlots; i++) plots.push({ uid: uid(), def: null, crop: null });
    const p = {
      name, color, coins: this.cfg.startingCoins + (reward.coins ?? 0),
      deck: shuffle(deck), discard: [], hand: [],
      plots, upgrades: [], warehouse: [], board: 0,
      pendingReplace: { watering: 0, sickle: 0 },
    };
    const seed = reward.seed && this.data.seeds.cards.find((c) => c.id === reward.seed);
    if (seed) plots[1].crop = this.makeCrop(seed);
    return p;
  }

  makeTool(def) {
    return {
      uid: uid(), def, image: def.image,
      starter: def.starter ?? null,
      waterLeft: def.water, sickleLeft: def.sickle, used: false,
    };
  }

  makeCrop(def) { return { uid: uid(), def, water: 0 }; }

  // ---------- utilidades ----------

  get player() { return this.players[this.current]; }
  get fishingMode() { return this.options.mode === 'fishing'; }
  get boardDef() { return this.cfg.boards[this.options.length]; }
  get boardSpaces() { return this.boardDef.spaces; }
  // La partida larga tiene más huecos de mejora (7.º y 8.º)
  get maxUpgrades() { return this.boardDef.maxUpgrades ?? this.cfg.maxUpgrades; }
  // who: índice del jugador al que se refiere la línea (para pintarla de su color)
  say(msg, kind = 'info', who = this.players ? this.current : null) {
    this.log.push({ msg, kind, turn: this.turnNumber, who });
  }
  has(p, type) { return p.upgrades.some((u) => u.def.type === type); }
  findUpgrade(p, type) { return p.upgrades.find((u) => u.def.type === type); }
  freePlots(p) { return p.plots.map((pl, i) => (pl.crop ? -1 : i)).filter((i) => i >= 0); }
  isMature(crop) { return crop.water >= circlesOf(crop.def); }
  idle() { return !this.prompts.length && (this.phase === 'action' || this.phase === 'buy'); }
  gain(p, coins, why) {
    if (!coins) return;
    p.coins += coins;
    this.say(`${p.name} gana ${coins} moneda${coins === 1 ? '' : 's'} (${why})`, 'coin', this.players.indexOf(p));
  }

  drawFrom(deckKey, discardKey) {
    const m = this.market;
    if (!m[deckKey].length && discardKey && m[discardKey].length) {
      m[deckKey] = shuffle(m[discardKey]);
      m[discardKey] = [];
    }
    return m[deckKey].pop() ?? null;
  }

  refillMarket() {
    const m = this.market;
    const fill = (key, deck, discard) => {
      for (let i = 0; i < m[key].length; i++) {
        if (m[key][i]) continue;
        m[key][i] = this.drawFrom(deck, discard);
        if (m[key][i]) this.fresh.push(`${key}:${i}`);
      }
    };
    fill('seeds', 'seedDeck', 'seedDiscard');
    fill('tools', 'toolDeck');
    fill('farm', 'farmDeck');
  }

  // Toda carta que va al descarte del jugador pasa por aquí: si hay una sustitución
  // de herrería pendiente y llega una carta inicial de ese tipo, se retira del juego.
  toDiscard(p, card) {
    if (card.starter && p.pendingReplace[card.starter] > 0) {
      p.pendingReplace[card.starter]--;
      this.say(`Se retira una ${TOOL_NAME[card.starter]} inicial (sustitución pendiente)`);
      return;
    }
    p.discard.push(card);
  }

  // ---------- turno ----------

  startTurn() {
    this.turnNumber++;
    const p = this.player;
    this.phase = 'action';
    this.selection = [];
    this.say(`— Turno de ${p.name} —`, 'turn');

    for (let i = 0; i < this.cfg.handSize; i++) {
      if (!p.deck.length) {
        if (!p.discard.length) break;
        p.deck = shuffle(p.discard);
        p.discard = [];
        this.say(`${p.name} baraja su descarte`);
      }
      const card = p.deck.pop();
      card.waterLeft = card.def.water;
      card.sickleLeft = card.def.sickle;
      card.used = false;
      p.hand.push(card);
    }

    this.processFarm(p);
  }

  processFarm(p) {
    const fodder = this.has(p, 'fodder') ? 1 : 0;
    for (const u of p.upgrades) {
      if (u.def.type !== 'animal') continue;
      const v = u.def.values[u.step % u.def.values.length];
      u.step++;
      this.gain(p, v + fodder, `${u.def.name}${fodder ? ' + pienso' : ''}`);
    }

    for (const u of p.upgrades) {
      if (u.def.type === 'pickler' && u.stored) {
        const c = circlesOf(u.stored.def);
        const row = u.def.table.find((r) => r.circles.includes(c));
        this.gain(p, row ? row.coins : 0, `encurtidora: ${u.stored.def.name}`);
        this.market.seedDiscard.push(u.stored.def);
        u.stored = null;
      }
      // A partir de ahora la semilladora puede replantar (al inicio del turno o en la compra)
      if (u.def.type === 'seedmaker' && u.stored) u.armed = true;
    }
    this.farmStep = 0;
    this.continueFarm();
  }

  // Semilladora → almacén → resto de mejoras. Si un paso hace una pregunta, se para
  // y afterPrompt() lo reanuda en el paso siguiente.
  continueFarm() {
    const p = this.player;
    while (this.farmStep !== null && this.farmStep < 3) {
      const step = this.farmStep++;
      if (step === 0) this.runSeedmaker(p);
      if (step === 1 && this.has(p, 'warehouse') && p.warehouse.length && this.freePlots(p).length) {
        this.prompts.push({ type: 'chooseStored' });
      }
      if (step === 2) this.processFarmRest(p);
      if (this.prompts.length) return;
    }
    this.farmStep = null;
  }

  processFarmRest(p) {
    const sprinklers = p.upgrades.filter((u) => u.def.type === 'sprinkler').length;
    for (let s = 0; s < sprinklers; s++) {
      for (const pl of p.plots) if (pl.crop && !this.isMature(pl.crop)) this.water(p, pl.crop, 'aspersor');
    }

    if (this.has(p, 'harvester')) {
      p.plots.forEach((pl, i) => { if (pl.crop && this.isMature(pl.crop)) this.harvest(p, i, 'cosechadora'); });
    }

    if (this.has(p, 'dogcat')) {
      if (this.fishingMode) this.revealFishFree(p);
      else this.revealMine(p, 'perro y gato');
    }
  }

  // Mejor parcela libre para un cultivo: primero una parcela extra cuyo bonus le corresponda,
  // después una normal y, si no queda otra, cualquier parcela extra.
  bestPlot(p, def) {
    const free = this.freePlots(p);
    const c = circlesOf(def);
    return free.find((i) => p.plots[i].def?.circles.includes(c))
      ?? free.find((i) => !p.plots[i].def)
      ?? free[0] ?? null;
  }

  // Semilladora: solo actúa al empezar el turno y en la fase de compra, con un cultivo
  // guardado en un turno anterior. Con almacén, el jugador puede elegir guardarlo allí.
  runSeedmaker(p) {
    const u = this.findUpgrade(p, 'seedmaker');
    if (!u?.stored || !u.armed) return;
    const canPlant = this.bestPlot(p, u.stored.def) !== null;
    const warehouse = this.has(p, 'warehouse');
    const askKey = `${this.turnNumber}:${this.phase}`;
    if (warehouse && u.asked !== askKey) {
      u.asked = askKey; // una pregunta por fase como mucho
      this.prompts.push({ type: 'seedmaker', crop: u.stored, canPlant });
      return;
    }
    if (canPlant && !warehouse) this.seedmakerPlant(p, u);
  }

  seedmakerPlant(p, u) {
    const i = this.bestPlot(p, u.stored.def);
    if (i === null) return;
    p.plots[i].crop = this.makeCrop(u.stored.def);
    this.say(`La semilladora replanta ${u.stored.def.name}${p.plots[i].def ? ` en la ${p.plots[i].def.name.toLowerCase()}` : ''}`);
    u.stored = null;
    u.armed = false;
  }

  // Respuesta a la semilladora: 'plant', 'warehouse' o 'keep'
  resolveSeedmaker(choice) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'seedmaker') return;
    const p = this.player;
    const u = this.findUpgrade(p, 'seedmaker');
    if (choice === 'plant' && !pr.canPlant) return;
    this.prompts.shift();
    if (u?.stored) {
      if (choice === 'plant') this.seedmakerPlant(p, u);
      if (choice === 'warehouse') {
        p.warehouse.push(u.stored.def);
        this.say(`${u.stored.def.name} pasa de la semilladora al almacén`);
        u.stored = null;
        u.armed = false;
      }
    }
    this.afterPrompt();
  }

  // ---------- fase de acciones ----------

  mineCost(p = this.player) {
    return this.has(p, 'equipment') ? this.cfg.mineCardsPerTripWithEquipment : this.cfg.mineCardsPerTrip;
  }

  selectedCards() {
    return this.selection.map((id) => this.player.hand.find((c) => c.uid === id)).filter(Boolean);
  }

  toggleSelect(cardUid) {
    if (this.phase !== 'action' || this.prompts.length) return;
    if (this.selection.includes(cardUid)) {
      this.selection = this.selection.filter((id) => id !== cardUid);
      return;
    }
    // En modo pesca se puede salir con tantas cartas como se quiera
    const max = this.fishingMode ? this.player.hand.length : Math.max(2, this.mineCost());
    if (this.selection.length >= max) this.selection.shift();
    this.selection.push(cardUid);
  }

  cropAction(plotIndex) {
    if (this.phase !== 'action' || this.prompts.length) return null;
    const sel = this.selectedCards();
    if (sel.length !== 1) return null;
    const crop = this.player.plots[plotIndex]?.crop;
    if (!crop) return null;
    const card = sel[0];
    if (!this.isMature(crop) && card.waterLeft > 0) return 'water';
    if (this.isMature(crop) && card.sickleLeft > 0) return 'harvest';
    return null;
  }

  canMine() {
    if (this.fishingMode || this.phase !== 'action' || this.prompts.length) return false;
    const sel = this.selectedCards();
    return sel.length === this.mineCost() && sel.every((c) => !c.used);
  }

  canDiscardSelected() {
    return this.phase === 'action' && !this.prompts.length && this.selection.length > 0;
  }

  useOnCrop(plotIndex) {
    const action = this.cropAction(plotIndex);
    if (!action) return;
    const p = this.player;
    const card = this.selectedCards()[0];
    card.used = true;
    if (action === 'water') {
      card.waterLeft--;
      this.water(p, p.plots[plotIndex].crop, 'riego');
    } else {
      card.sickleLeft--;
      this.harvest(p, plotIndex, 'cosecha');
    }
    if (card.waterLeft <= 0 && card.sickleLeft <= 0) this.discardFromHand(p, card);
    this.checkHandEmpty();
  }

  discardFromHand(p, card) {
    p.hand = p.hand.filter((c) => c !== card);
    this.toDiscard(p, card);
    this.selection = this.selection.filter((id) => id !== card.uid);
  }

  // Clic en el montón de descarte: descarta solo las cartas seleccionadas
  discardSelected() {
    if (!this.canDiscardSelected()) return;
    const p = this.player;
    for (const c of this.selectedCards()) this.discardFromHand(p, c);
    this.checkHandEmpty();
  }

  checkHandEmpty() {
    if (this.phase === 'action' && !this.player.hand.length) this.toBuyPhase();
  }

  water(p, crop, why) {
    crop.water++;
    const max = circlesOf(crop.def);
    if (crop.water < max) {
      this.gain(p, crop.def.waterRewards[crop.water - 1], `${why}: ${crop.def.name}`);
    } else {
      this.say(`${crop.def.name} está listo para cosechar`);
    }
  }

  harvest(p, plotIndex, why) {
    const plot = p.plots[plotIndex];
    const crop = plot.crop;
    plot.crop = null;
    let coins = crop.def.harvest;
    const extras = [];
    if (this.has(p, 'fertiliser')) { coins += 1; extras.push('abono'); }
    if (plot.def && plot.def.circles.includes(circlesOf(crop.def))) { coins += plot.def.bonus; extras.push('parcela'); }
    this.gain(p, coins, `${why}: ${crop.def.name}${extras.length ? ' + ' + extras.join(' + ') : ''}`);

    const storages = p.upgrades.filter((u) => (u.def.type === 'pickler' || u.def.type === 'seedmaker') && !u.stored);
    if (storages.length) {
      this.prompts.push({ type: 'harvestStore', crop, options: storages.map((u) => u.uid) });
    } else {
      this.market.seedDiscard.push(crop.def);
    }
  }

  resolveHarvestStore(upgradeUid) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'harvestStore') return;
    this.prompts.shift();
    const u = this.player.upgrades.find((x) => x.uid === upgradeUid);
    if (u && !u.stored) {
      u.stored = pr.crop;
      u.armed = false; // se replanta a partir del próximo turno
      this.say(`${pr.crop.def.name} va a ${u.def.name.toLowerCase()}`);
    } else {
      this.market.seedDiscard.push(pr.crop.def);
    }
    this.afterPrompt();
  }

  goMine() {
    if (!this.canMine()) return;
    const p = this.player;
    for (const c of this.selectedCards()) this.discardFromHand(p, c);
    this.selection = [];
    this.revealMine(p, 'mina');
    this.checkHandEmpty();
  }

  revealMine(p, why) {
    const m = this.market;
    if (m.mineRevealed) m.mineDiscard.push(m.mineRevealed);
    m.mineUnder = m.mineRevealed; // la interfaz la deja debajo mientras se anima la nueva
    m.mineRevealed = this.drawFrom('mineDeck', 'mineDiscard');
    if (!m.mineRevealed) return;
    this.fresh.push('mine:0');
    if (m.mineRevealed.coins) this.gain(p, m.mineRevealed.coins, why);
    else this.say(`${p.name} no encuentra nada en la mina (${why})`);
  }

  // ---------- pesca ----------

  // Valor de pesca de unas cartas (las iniciales valen medio pez) + medio pez con el equipo
  fishPower(cards, p = this.player) {
    const base = cards.reduce((s, c) => s + (c.def.fish ?? 0), 0);
    return base + (this.has(p, 'equipment') ? 0.5 : 0);
  }

  canFish() {
    if (!this.fishingMode || this.phase !== 'action' || this.prompts.length) return false;
    const sel = this.selectedCards();
    return sel.length > 0 && sel.every((c) => !c.used);
  }

  goFish() {
    if (!this.canFish()) return;
    const p = this.player;
    const cards = this.selectedCards();
    const power = this.fishPower(cards);
    for (const c of cards) this.discardFromHand(p, c);
    this.selection = [];
    this.fishing = { power, caught: [] };
    this.say(`${p.name} sale a pescar con un valor de pesca de ${fmtFish(power)}`);
    this.castLine();
  }

  // Voltea la carta de arriba del mazo de pesca y resuelve si se pesca o se escapa
  castLine() {
    const p = this.player;
    const f = this.fishing;
    const m = this.market;
    m.mineUnder = m.mineRevealed;
    const fish = this.drawFrom('mineDeck', 'mineDiscard');
    if (!fish) { this.say('No quedan cartas de pesca'); this.endFishing(); return; }
    m.mineRevealed = fish;
    this.fresh.push('mine:0');
    if (fish.fish <= f.power) {
      f.power -= fish.fish;
      f.caught.push(fish);
      this.say(`${p.name} pesca un pez de ${fish.coins} moneda${fish.coins === 1 ? '' : 's'} (le queda ${fmtFish(f.power)} de valor de pesca)`);
      const more = f.power > 0 && (m.mineDeck.length + m.mineDiscard.length) > 0;
      if (more) this.prompts.push({ type: 'fish' });
      else this.endFishing();
    } else {
      m.mineDiscard.push(fish);
      const lost = f.caught.pop();
      if (lost) {
        m.mineDiscard.push(lost);
        this.say(`¡Se escapa un pez de ${fmtFish(fish.fish)}, vuelca la barca y se escapa también el anterior!`);
      } else {
        this.say(`Se escapa el pez (necesitaba ${fmtFish(fish.fish)} de valor de pesca)`);
      }
      this.endFishing();
    }
  }

  // Respuesta durante la pesca: seguir (true) o parar y cobrar (false)
  resolveFish(keepGoing) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'fish') return;
    this.prompts.shift();
    if (keepGoing) this.castLine();
    else this.endFishing();
    this.afterPrompt();
    this.checkHandEmpty();
  }

  endFishing() {
    const p = this.player;
    const f = this.fishing;
    this.fishing = null;
    if (!f) return;
    const coins = f.caught.reduce((s, c) => s + c.coins, 0);
    this.gain(p, coins, `pesca: ${f.caught.length} pez${f.caught.length === 1 ? '' : 'es'}`);
    this.market.mineDiscard.push(...f.caught);
    if (!this.prompts.length) this.checkHandEmpty();
  }

  // Perro y gato en modo pesca: revela una carta y cobra sus monedas sin más
  revealFishFree(p) {
    const m = this.market;
    m.mineUnder = m.mineRevealed;
    const fish = this.drawFrom('mineDeck', 'mineDiscard');
    if (!fish) return;
    m.mineRevealed = fish;
    m.mineDiscard.push(fish);
    this.fresh.push('mine:0');
    this.gain(p, fish.coins, 'perro y gato: pesca');
  }

  // Botón "Terminar acciones": descarta toda la mano
  endActions() {
    if (this.phase !== 'action' || this.prompts.length) return;
    const p = this.player;
    for (const c of [...p.hand]) this.discardFromHand(p, c);
    this.selection = [];
    this.toBuyPhase();
  }

  toBuyPhase() {
    this.selection = [];
    this.phase = 'buy';
    this.runSeedmaker(this.player);
    this.checkAutoEnd();
  }

  // ---------- fase de compra ----------

  // Cartas iniciales de un tipo que aún se pueden sustituir (descarte + mazo, menos las ya comprometidas)
  replaceableCount(p, type) {
    const n = [...p.discard, ...p.deck].filter((c) => c.starter === type).length;
    return n - p.pendingReplace[type];
  }

  toolReplaceOptions(p, def) {
    const types = [];
    if (def.water > 0) types.push('watering');
    if (def.sickle > 0) types.push('sickle');
    return types.filter((t) => this.replaceableCount(p, t) > 0);
  }

  canPlantNew(p) { return this.freePlots(p).length > 0 || this.has(p, 'warehouse'); }

  canBuySeed(i) {
    const d = this.market.seeds[i];
    const p = this.player;
    return this.phase === 'buy' && !this.prompts.length && d && p.coins >= d.cost && this.canPlantNew(p);
  }

  canBuyTool(i) {
    const d = this.market.tools[i];
    const p = this.player;
    return this.phase === 'buy' && !this.prompts.length && d && p.coins >= d.cost && this.toolReplaceOptions(p, d).length > 0;
  }

  canAdvanceBoard() {
    const p = this.player;
    return this.phase === 'buy' && !this.prompts.length && p.board < this.boardSpaces.length && p.coins >= this.cfg.coinsPerBoardSpace;
  }

  canUseAssorted() {
    const p = this.player;
    const u = this.findUpgrade(p, 'assorted');
    const m = this.market;
    return this.phase === 'buy' && !this.prompts.length && u &&
      p.coins >= (u.def.cost ?? 1) && (m.seedDeck.length + m.seedDiscard.length) > 0 && this.canPlantNew(p);
  }

  canOpenWarehouse() {
    const p = this.player;
    return this.idle() && p.warehouse.length > 0 && this.freePlots(p).length > 0;
  }

  anyBuyOption() {
    if (this.canAdvanceBoard() || this.canUseAssorted()) return true;
    return this.market.seeds.some((_, i) => this.canBuySeed(i)) || this.market.tools.some((_, i) => this.canBuyTool(i));
  }

  // Coloca una semilla: si no hay sitio va al almacén; si lo hay, el jugador elige parcela
  placeSeed(p, def, { alwaysAsk = false, source = 'shop' } = {}) {
    const free = this.freePlots(p);
    if (free.length === 0) {
      p.warehouse.push(def);
      this.say(`${def.name} se guarda en el almacén`);
      return;
    }
    if (free.length === 1 && !alwaysAsk) {
      p.plots[free[0]].crop = this.makeCrop(def);
      return;
    }
    this.prompts.push({ type: 'choosePlot', seed: def, options: free, source });
  }

  buySeed(i) {
    if (!this.canBuySeed(i)) return;
    const p = this.player;
    const def = this.market.seeds[i];
    this.market.seeds[i] = null;
    p.coins -= def.cost;
    this.say(`${p.name} compra ${def.name} por ${def.cost}`);
    this.placeSeed(p, def);
    this.afterPrompt();
  }

  useAssorted() {
    if (!this.canUseAssorted()) return;
    const p = this.player;
    const u = this.findUpgrade(p, 'assorted');
    const def = this.drawFrom('seedDeck', 'seedDiscard');
    p.coins -= u.def.cost ?? 1;
    this.say(`${p.name} usa Semillas varias y obtiene ${def.name}`);
    // Se muestra bajo el mazo hasta colocarla (o, si va al almacén, hasta el final del turno)
    this.market.assortedReveal = def;
    this.fresh.push('assorted:0');
    this.placeSeed(p, def, { alwaysAsk: true, source: 'assorted' });
    this.afterPrompt();
  }

  // Almacén: el jugador elige qué semilla plantar (y luego dónde), o cancela
  openWarehouse() {
    if (!this.canOpenWarehouse()) return;
    this.prompts.push({ type: 'chooseStored' });
  }

  chooseStored(index) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'chooseStored') return;
    this.prompts.shift();
    const p = this.player;
    const def = p.warehouse[index];
    if (def) this.prompts.unshift({ type: 'choosePlot', seed: def, options: this.freePlots(p), source: 'warehouse', storedIndex: index });
    this.afterPrompt();
  }

  cancelPrompt() {
    const pr = this.prompts[0];
    if (!pr || !(pr.type === 'chooseStored' || (pr.type === 'choosePlot' && pr.source === 'warehouse'))) return;
    this.prompts.shift();
    this.afterPrompt();
  }

  choosePlot(plotIndex) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'choosePlot' || !pr.options.includes(plotIndex)) return;
    this.prompts.shift();
    const p = this.player;
    p.plots[plotIndex].crop = this.makeCrop(pr.seed);
    if (pr.source === 'warehouse') {
      p.warehouse.splice(pr.storedIndex, 1);
      this.say(`${p.name} planta ${pr.seed.name} desde el almacén`);
    }
    if (pr.source === 'assorted') this.market.assortedReveal = null;
    this.afterPrompt();
  }

  buyTool(i) {
    if (!this.canBuyTool(i)) return;
    const p = this.player;
    const def = this.market.tools[i];
    this.market.tools[i] = null;
    p.coins -= def.cost;
    this.say(`${p.name} compra ${def.name} por ${def.cost}`);
    const opts = this.toolReplaceOptions(p, def);
    if (opts.length === 1) this.replaceStarter(p, opts[0], def);
    else this.prompts.push({ type: 'chooseReplace', tool: def, options: opts });
    this.afterPrompt();
  }

  chooseReplace(type) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'chooseReplace' || !pr.options.includes(type)) return;
    this.prompts.shift();
    if (pr.giftSlot !== undefined) this.market.tools[pr.giftSlot] = null;
    this.replaceStarter(this.player, type, pr.tool);
    if (pr.giftSlot !== undefined) this.continueToolGift();
    this.afterPrompt();
  }

  // Sustituye una carta inicial: primero en el descarte; si no hay, deja pendiente
  // la sustitución de una que siga en el mazo (se retirará cuando llegue al descarte).
  replaceStarter(p, type, def) {
    const idx = p.discard.findIndex((c) => c.starter === type);
    if (idx >= 0) {
      p.discard.splice(idx, 1);
      this.say(`${def.name} sustituye a una ${TOOL_NAME[type]} inicial`);
    } else {
      p.pendingReplace[type]++;
      this.say(`${def.name} sustituirá a la próxima ${TOOL_NAME[type]} inicial que llegue al descarte`);
    }
    p.discard.push(this.makeTool(def));
  }

  advanceBoard() {
    if (!this.canAdvanceBoard()) return;
    const p = this.player;
    p.coins -= this.cfg.coinsPerBoardSpace;
    const space = this.boardSpaces[p.board];
    p.board++;
    this.say(`${p.name} coloca una moneda de 10 en la casilla ${p.board}`, 'coin');
    if (space.reward === 'farm' && this.market.farm.some(Boolean) && p.upgrades.length < this.maxUpgrades) {
      this.prompts.push({ type: 'chooseFarm' });
    }
    if (space.reward === 'tools') this.takeShopTools(p);
    this.afterPrompt();
  }

  // Casilla de hoz/regadera x3: el jugador se lleva gratis las cartas que haya en la herrería
  takeShopTools(p) {
    const slots = this.market.tools.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
    if (!slots.length) { this.say('La herrería está vacía: no hay cartas que llevarse'); return; }
    this.say(`${p.name} se lleva gratis las cartas de la herrería`);
    this.toolGift.push(...slots);
    this.continueToolGift();
  }

  // Recorre los huecos de la herrería uno a uno. Cada carta tiene que sustituir a una inicial:
  // si no queda ninguna de su tipo, se queda en la herrería; si puede sustituir a una regadera
  // o a una hoz, se pregunta cuál y se para hasta la respuesta (chooseReplace la reanuda).
  continueToolGift() {
    const p = this.player;
    while (this.toolGift.length) {
      const slot = this.toolGift.shift();
      const def = this.market.tools[slot];
      if (!def) continue;
      const opts = this.toolReplaceOptions(p, def);
      if (!opts.length) {
        this.say(`${def.name} se queda en la herrería (no queda ninguna carta inicial que sustituir)`);
        continue;
      }
      if (opts.length > 1) {
        this.prompts.push({ type: 'chooseReplace', tool: def, options: opts, giftSlot: slot });
        return;
      }
      this.market.tools[slot] = null;
      this.replaceStarter(p, opts[0], def);
    }
  }

  chooseFarm(i) {
    const pr = this.prompts[0];
    const def = this.market.farm[i];
    if (!pr || pr.type !== 'chooseFarm' || !def) return;
    this.prompts.shift();
    this.market.farm[i] = null;
    const p = this.player;
    const upgrade = { uid: uid(), def, step: 0, stored: null, armed: false, plotIndex: null };
    if (def.type === 'plot') {
      p.plots.push({ uid: uid(), def, crop: null });
      upgrade.plotIndex = p.plots.length - 1;
    }
    p.upgrades.push(upgrade);
    this.say(`${p.name} consigue la mejora ${def.name}`);
    this.runSeedmaker(p); // una parcela nueva también cuenta como parcela libre
    this.afterPrompt();
  }

  afterPrompt() {
    if (this.prompts.length || this.phase === 'gameOver') return;
    if (this.farmStep !== null) this.continueFarm();
    if (this.prompts.length) return;
    if (this.phase === 'buy') this.checkAutoEnd();
  }

  checkAutoEnd() {
    if (this.phase === 'buy' && !this.prompts.length && !this.anyBuyOption()) this.endTurn();
  }

  passTurn() {
    if (this.phase !== 'buy' || this.prompts.length) return;
    this.endTurn();
  }

  endTurn() {
    const p = this.player;
    this.market.assortedReveal = null;
    this.refillMarket();
    if (p.board >= this.boardSpaces.length && !this.lastRound) {
      this.lastRound = true;
      this.say(`¡${p.name} ha completado el tablero! Última ronda.`, 'turn');
    }
    const next = (this.current + 1) % this.players.length;
    if (this.lastRound && next === 0) return this.finish();
    this.current = next;
    this.startTurn();
  }

  // Rendirse: en 2 jugadores gana el otro
  surrender(index) {
    if (this.phase === 'gameOver' || !this.players[index]) return;
    this.surrendered = index;
    this.prompts = [];
    this.fishing = null;
    this.farmStep = null;
    this.phase = 'gameOver';
    this.winners = this.players.filter((_, i) => i !== index);
    this.say(`${this.players[index].name} se rinde`, 'turn', index);
    this.say(`¡${this.winners.map((p) => p.name).join(' y ')} gana${this.winners.length > 1 ? 'n' : ''} la partida!`, 'turn', this.players.indexOf(this.winners[0]));
  }

  // Gana quien haya completado el tablero. Desempates: más monedas sobrantes,
  // después más cultivos plantados; si persiste, comparten la victoria.
  finish() {
    this.phase = 'gameOver';
    const crops = (p) => p.plots.filter((pl) => pl.crop).length;
    let cands = this.players.filter((p) => p.board >= this.boardSpaces.length);
    const maxCoins = Math.max(...cands.map((p) => p.coins));
    cands = cands.filter((p) => p.coins === maxCoins);
    const maxCrops = Math.max(...cands.map(crops));
    this.winners = cands.filter((p) => crops(p) === maxCrops);
    this.say(this.winners.length === 1
      ? `¡${this.winners[0].name} gana la partida!`
      : `¡Victoria compartida entre ${this.winners.map((p) => p.name).join(' y ')}!`, 'turn',
    this.winners.length === 1 ? this.players.indexOf(this.winners[0]) : null);
  }
}
