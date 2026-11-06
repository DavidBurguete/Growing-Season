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

export class Game {
  constructor(data, playerSetup) {
    this.data = data;
    this.cfg = data.config;
    this.log = [];
    this.prompts = [];
    this.selection = [];
    this.current = 0;
    this.phase = 'action';
    this.lastRound = false;
    this.winner = null;
    this.turnNumber = 0;

    const seedDefs = data.seeds.cards.filter((c) => !c.starter);
    this.market = {
      seedDeck: shuffle(expand(seedDefs)),
      seedDiscard: [],
      seeds: Array(this.cfg.market.seeds).fill(null),
      toolDeck: shuffle(expand(data.tools.shop)),
      tools: Array(this.cfg.market.tools).fill(null),
      farmDeck: shuffle(expand(data.farm.cards)),
      farm: Array(this.cfg.market.farm).fill(null),
      mineDeck: shuffle(expand(data.mine.cards)),
      mineDiscard: [],
      mineRevealed: null,
    };
    this.refillMarket();

    this.players = playerSetup.map((p, i) => this.createPlayer(p, i));
    this.startTurn();
  }

  // ---------- creación ----------

  createPlayer({ name, color }, index) {
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
    const starterId = this.cfg.starterSeeds[index % this.cfg.starterSeeds.length];
    const starterSeed = this.data.seeds.cards.find((c) => c.id === starterId);
    if (starterSeed) plots[0].crop = this.makeCrop(starterSeed);

    return {
      name, color, coins: this.cfg.startingCoins,
      deck: shuffle(deck), discard: [], hand: [],
      plots, upgrades: [], warehouse: [], board: 0,
      usedAssorted: false,
    };
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
  say(msg, kind = 'info') { this.log.push({ msg, kind, turn: this.turnNumber }); }
  has(p, type) { return p.upgrades.some((u) => u.def.type === type); }
  countOf(p, type) { return p.upgrades.filter((u) => u.def.type === type).length; }
  freePlots(p) { return p.plots.map((pl, i) => (pl.crop ? -1 : i)).filter((i) => i >= 0); }
  isMature(crop) { return crop.water >= circlesOf(crop.def); }
  gain(p, coins, why) {
    if (!coins) return;
    p.coins += coins;
    this.say(`${p.name} gana ${coins} moneda${coins === 1 ? '' : 's'} (${why})`, 'coin');
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
    for (let i = 0; i < m.seeds.length; i++) if (!m.seeds[i]) m.seeds[i] = this.drawFrom('seedDeck', 'seedDiscard');
    for (let i = 0; i < m.tools.length; i++) if (!m.tools[i]) m.tools[i] = this.drawFrom('toolDeck');
    for (let i = 0; i < m.farm.length; i++) if (!m.farm[i]) m.farm[i] = this.drawFrom('farmDeck');
  }

  // ---------- turno ----------

  startTurn() {
    this.turnNumber++;
    const p = this.player;
    p.usedAssorted = false;
    this.phase = 'action';
    this.selection = [];
    this.say(`— Turno de ${p.name} —`, 'turn');

    // Robar 5 cartas (rebarajando el descarte si hace falta)
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
      const v = u.def.values[Math.min(u.step, u.def.values.length - 1)];
      u.step++;
      this.gain(p, v + fodder, u.def.name);
    }

    for (const u of p.upgrades) {
      if (u.def.type === 'pickler' && u.stored) {
        const c = circlesOf(u.stored.def);
        const row = u.def.table.find((r) => r.circles.includes(c));
        this.gain(p, row ? row.coins : 0, `encurtidora: ${u.stored.def.name}`);
        this.market.seedDiscard.push(u.stored.def);
        u.stored = null;
      }
      if (u.def.type === 'seedmaker' && u.stored) {
        const free = this.freePlots(p);
        if (free.length) {
          p.plots[free[0]].crop = this.makeCrop(u.stored.def);
          this.say(`La semilladora replanta ${u.stored.def.name}`);
          u.stored = null;
        }
      }
    }

    this.plantFromWarehouse(p);

    const sprinklers = this.countOf(p, 'sprinkler');
    for (let s = 0; s < sprinklers; s++) {
      for (const pl of p.plots) if (pl.crop && !this.isMature(pl.crop)) this.water(p, pl.crop, 'aspersor');
    }

    if (this.has(p, 'harvester')) {
      p.plots.forEach((pl, i) => { if (pl.crop && this.isMature(pl.crop)) this.harvest(p, i, 'cosechadora'); });
    }

    if (this.has(p, 'dogcat')) this.revealMine(p, 'perro y gato');
  }

  plantFromWarehouse(p) {
    while (p.warehouse.length && this.freePlots(p).length) {
      const def = p.warehouse.shift();
      p.plots[this.freePlots(p)[0]].crop = this.makeCrop(def);
      this.say(`${p.name} planta ${def.name} desde el almacén`);
    }
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
    const max = Math.max(2, this.mineCost());
    if (this.selection.length >= max) this.selection.shift();
    this.selection.push(cardUid);
  }

  // Qué puede hacer la carta seleccionada sobre un cultivo
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
    if (this.phase !== 'action' || this.prompts.length) return false;
    const sel = this.selectedCards();
    return sel.length === this.mineCost() && sel.every((c) => !c.used);
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
  }

  discardFromHand(p, card) {
    p.hand = p.hand.filter((c) => c !== card);
    p.discard.push(card);
    this.selection = this.selection.filter((id) => id !== card.uid);
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
    this.plantFromWarehouse(p);
  }

  resolveHarvestStore(upgradeUid) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'harvestStore') return;
    this.prompts.shift();
    const u = this.player.upgrades.find((x) => x.uid === upgradeUid);
    if (u && !u.stored) {
      u.stored = pr.crop;
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
  }

  revealMine(p, why) {
    const m = this.market;
    if (m.mineRevealed) m.mineDiscard.push(m.mineRevealed);
    m.mineRevealed = this.drawFrom('mineDeck', 'mineDiscard');
    if (!m.mineRevealed) return;
    if (m.mineRevealed.coins) this.gain(p, m.mineRevealed.coins, why);
    else this.say(`${p.name} no encuentra nada en la mina (${why})`);
  }

  endActions() {
    if (this.phase !== 'action' || this.prompts.length) return;
    const p = this.player;
    p.discard.push(...p.hand);
    p.hand = [];
    this.selection = [];
    this.phase = 'buy';
    this.checkAutoEnd();
  }

  // ---------- fase de compra ----------

  starterCount(p, type) {
    return [...p.deck, ...p.discard, ...p.hand].filter((c) => c.starter === type).length;
  }

  toolReplaceOptions(p, def) {
    const opts = [];
    if (def.water > 0 && this.starterCount(p, 'watering') > 0) opts.push('watering');
    if (def.sickle > 0 && this.starterCount(p, 'sickle') > 0) opts.push('sickle');
    if (def.water > 0 && def.sickle > 0) return opts; // mixta: cualquiera de las dos
    return opts.length === 1 ? opts : [];
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
    return this.phase === 'buy' && !this.prompts.length && p.board < this.cfg.board.length && p.coins >= this.cfg.coinsPerBoardSpace;
  }

  canUseAssorted() {
    const p = this.player;
    const u = p.upgrades.find((x) => x.def.type === 'assorted');
    const m = this.market;
    return this.phase === 'buy' && !this.prompts.length && u && !p.usedAssorted &&
      p.coins >= (u.def.cost ?? 1) && (m.seedDeck.length + m.seedDiscard.length) > 0 && this.canPlantNew(p);
  }

  anyBuyOption() {
    if (this.canAdvanceBoard() || this.canUseAssorted()) return true;
    return this.market.seeds.some((_, i) => this.canBuySeed(i)) || this.market.tools.some((_, i) => this.canBuyTool(i));
  }

  placeSeed(p, def) {
    const free = this.freePlots(p);
    if (free.length === 0) {
      p.warehouse.push(def);
      this.say(`${def.name} se guarda en el almacén`);
    } else if (free.length === 1) {
      p.plots[free[0]].crop = this.makeCrop(def);
    } else {
      this.prompts.push({ type: 'choosePlot', seed: def, options: free });
    }
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
    const u = p.upgrades.find((x) => x.def.type === 'assorted');
    const def = this.drawFrom('seedDeck', 'seedDiscard');
    p.coins -= u.def.cost ?? 1;
    p.usedAssorted = true;
    this.say(`${p.name} usa Semillas varias y obtiene ${def.name}`);
    this.placeSeed(p, def);
    this.afterPrompt();
  }

  choosePlot(plotIndex) {
    const pr = this.prompts[0];
    if (!pr || pr.type !== 'choosePlot' || !pr.options.includes(plotIndex)) return;
    this.prompts.shift();
    this.player.plots[plotIndex].crop = this.makeCrop(pr.seed);
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
    this.replaceStarter(this.player, type, pr.tool);
    this.afterPrompt();
  }

  replaceStarter(p, type, def) {
    for (const pile of ['discard', 'deck', 'hand']) {
      const idx = p[pile].findIndex((c) => c.starter === type);
      if (idx >= 0) { p[pile].splice(idx, 1); break; }
    }
    p.discard.push(this.makeTool(def));
    this.say(`${def.name} sustituye a una ${type === 'watering' ? 'regadera' : 'hoz'} inicial`);
  }

  advanceBoard() {
    if (!this.canAdvanceBoard()) return;
    const p = this.player;
    p.coins -= this.cfg.coinsPerBoardSpace;
    const space = this.cfg.board[p.board];
    p.board++;
    this.say(`${p.name} coloca una moneda de 10 en la casilla ${p.board}`, 'coin');
    if (space.barn && this.market.farm.some(Boolean)) {
      this.prompts.push({ type: 'chooseFarm' });
    }
    this.afterPrompt();
  }

  chooseFarm(i) {
    const pr = this.prompts[0];
    const def = this.market.farm[i];
    if (!pr || pr.type !== 'chooseFarm' || !def) return;
    this.prompts.shift();
    this.market.farm[i] = null;
    const p = this.player;
    if (def.type === 'plot' && p.plots.length < this.cfg.maxPlots) {
      p.plots.push({ uid: uid(), def, crop: null });
      this.plantFromWarehouse(p);
    } else {
      p.upgrades.push({ uid: uid(), def, step: 0, stored: null });
    }
    this.say(`${p.name} consigue la mejora ${def.name}`);
    this.afterPrompt();
  }

  afterPrompt() {
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
    this.refillMarket();
    if (p.board >= this.cfg.board.length && !this.lastRound) {
      this.lastRound = true;
      this.say(`¡${p.name} ha completado el tablero! Última ronda.`, 'turn');
    }
    const next = (this.current + 1) % this.players.length;
    if (this.lastRound && next === 0) return this.finish();
    this.current = next;
    this.startTurn();
  }

  finish() {
    this.phase = 'gameOver';
    // Gana quien haya completado el tablero; si son varios, quien tenga más monedas sobrantes.
    const done = this.players.filter((p) => p.board >= this.cfg.board.length);
    const best = Math.max(...done.map((p) => p.coins));
    const winners = done.filter((p) => p.coins === best);
    this.winner = winners.length === 1 ? winners[0] : null;
    this.say(this.winner ? `¡${this.winner.name} gana la partida!` : '¡Empate!', 'turn');
  }
}
