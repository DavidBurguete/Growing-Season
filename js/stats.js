// Estadísticas de la pantalla final: títulos (solo se ven al acabar la partida) y logros
// (de momento también solo se ven aquí; se guardarán en el perfil cuando haya cuentas).
// No toca el DOM: lee game.stats (lo rellena game.js) y el estado final de los jugadores.

// Orígenes del dinero, en el orden de la gráfica de tarta
export const INCOME = ['crops', 'animals', 'expedition', 'plots', 'pickler', 'dogcat'];

// Mejoras de granja automáticas (título/logro Autómata)
const AUTOMATIC = new Set(['sprinkler', 'harvester', 'seedmaker', 'dogcat', 'fodder', 'animal']);
// Todos los animales (logro ¡Serás animal!): sin las mejoras extra no hay perro y gato y no se puede conseguir
const ANIMALS = ['cow', 'pig', 'sheep', 'chicken', 'dogcat'];
const IRONMAN_TOOLS = 12;

// Cartas de la herrería que tiene el jugador (todas las que no son iniciales)
export const shopTools = (p) => [...p.deck, ...p.discard, ...p.hand].filter((c) => !c.starter).length;
export const automaticUpgrades = (p) => p.upgrades.filter((u) => AUTOMATIC.has(u.def.type)).length;
// Autómata: todos los huecos de mejora llenos y todas las mejoras de la lista
const isAutomaton = (game, p) => p.upgrades.length >= game.maxUpgrades && automaticUpgrades(p) === p.upgrades.length;
const max = (arr) => arr.reduce((m, v) => Math.max(m, v ?? 0), 0);

// Mejor turno: el turno propio (1, 2, 3…) en el que más ganó y cuánto
export function bestTurn(st) {
  let turn = 0, coins = 0;
  st.turnIncome.forEach((c, i) => { if ((c ?? 0) > coins) { coins = c; turn = i + 1; } });
  return { turn, coins };
}

// Títulos: kind 'max' (gana quien más, si es más de 0), 'min' (gana quien menos) o 'test'
// (lo consiguen todos los que cumplan la condición; además es logro).
// Si hay empate, el título es para todos los empatados. mode: solo en la mina o solo en la pesca.
export const TITLES = [
  { id: 'efficientFarmer', kind: 'min', value: (p, st) => st.wasted },
  { id: 'recklessMiner', mode: 'mine', kind: 'max', value: (p, st) => st.emptyTrips },
  { id: 'naturalMiner', mode: 'mine', kind: 'max', value: (p, st) => max(st.turnExpedition) },
  { id: 'recklessFisher', mode: 'fishing', kind: 'max', value: (p, st) => st.emptyTrips },
  { id: 'naturalFisher', mode: 'fishing', kind: 'max', value: (p, st) => max(st.turnExpedition) },
  { id: 'rancher', kind: 'max', value: (p, st) => st.income.animals },
  { id: 'automaton', kind: 'test', test: (game, p) => isAutomaton(game, p) },
  { id: 'ironman', kind: 'test', test: (game, p) => shopTools(p) >= IRONMAN_TOOLS },
];

// Logros que no son títulos: se consiguen al cumplir la condición durante la partida
const ACHIEVEMENTS = [
  { id: 'wateringDays', test: (game, p, st) => st.wateringDays },
  { id: 'howDidWeGetHere', test: (game, p, st) => st.sickleDays },
  { id: 'seizing', test: (game, p, st) => st.seizing },
  { id: 'wheatness', test: (game, p, st) => st.initialCrop != null && p.plots.some((pl) => pl.crop?.uid === st.initialCrop) },
  { id: 'withered', test: (game, p, st) => st.harvested === 0 },
  { id: 'youAnimal', test: (game, p) => ANIMALS.every((id) => p.upgrades.some((u) => u.def.id === id)) },
];

// Devuelve, para cada jugador, { titles: [id], achievements: [id] }.
// Si alguien se ha rendido no se da ningún logro (los títulos sí se muestran).
export function computeAwards(game) {
  const surrendered = game.surrendered !== null && game.surrendered !== undefined;
  const mode = game.options?.mode ?? 'mine';
  const out = game.players.map(() => ({ titles: [], achievements: [] }));
  for (const title of TITLES) {
    if (title.mode && title.mode !== mode) continue;
    if (title.kind === 'test') {
      game.players.forEach((p, i) => {
        if (!title.test(game, p)) return;
        out[i].titles.push(title.id);
        if (!surrendered) out[i].achievements.push(title.id);
      });
      continue;
    }
    const values = game.players.map((p, i) => title.value(p, game.stats.players[i]));
    const best = title.kind === 'min' ? Math.min(...values) : Math.max(...values);
    if (title.kind === 'max' && best <= 0) continue;
    values.forEach((v, i) => {
      if (v !== best) return;
      out[i].titles.push(title.id);
    });
  }
  if (surrendered) return out;
  game.players.forEach((p, i) => {
    for (const a of ACHIEVEMENTS) if (a.test(game, p, game.stats.players[i])) out[i].achievements.push(a.id);
  });
  return out;
}

// Listas para el perfil de la cuenta: todos los títulos y todos los logros
export const TITLE_IDS = TITLES.map((x) => x.id);
export const ACHIEVEMENT_IDS = [...TITLES.filter((x) => x.kind === 'test').map((x) => x.id), ...ACHIEVEMENTS.map((x) => x.id)];
