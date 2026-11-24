// Estadísticas de la pantalla final: títulos (solo se ven al acabar la partida) y logros
// (de momento también solo se ven aquí; se guardarán en el perfil cuando haya cuentas).
// No toca el DOM: lee game.stats (lo rellena game.js) y el estado final de los jugadores.

// Orígenes del dinero, en el orden de la gráfica de tarta
export const INCOME = ['crops', 'animals', 'expedition', 'plots', 'pickler', 'dogcat'];

// Mejoras de granja automáticas (título/logro Autómata)
const AUTOMATIC = new Set(['sprinkler', 'harvester', 'seedmaker', 'dogcat', 'fodder', 'animal']);

// Cartas de la herrería que tiene el jugador (todas las que no son iniciales)
export const shopTools = (p) => [...p.deck, ...p.discard, ...p.hand].filter((c) => !c.starter).length;
export const automaticUpgrades = (p) => p.upgrades.filter((u) => AUTOMATIC.has(u.def.type)).length;
const max = (arr) => arr.reduce((m, v) => Math.max(m, v ?? 0), 0);

// Mejor turno: el turno propio (1, 2, 3…) en el que más ganó y cuánto
export function bestTurn(st) {
  let turn = 0, coins = 0;
  st.turnIncome.forEach((c, i) => { if ((c ?? 0) > coins) { coins = c; turn = i + 1; } });
  return { turn, coins };
}

// Títulos: kind 'max' (gana quien más, si es más de 0) o 'min' (gana quien menos).
// Si hay empate, el título es para todos los empatados. mode: solo en la mina o solo en la pesca.
export const TITLES = [
  { id: 'efficientFarmer', kind: 'min', value: (p, st) => st.wasted },
  { id: 'recklessMiner', mode: 'mine', kind: 'max', value: (p, st) => st.emptyTrips },
  { id: 'naturalMiner', mode: 'mine', kind: 'max', value: (p, st) => max(st.turnExpedition) },
  { id: 'recklessFisher', mode: 'fishing', kind: 'max', value: (p, st) => st.emptyTrips },
  { id: 'naturalFisher', mode: 'fishing', kind: 'max', value: (p, st) => max(st.turnExpedition) },
  { id: 'rancher', kind: 'max', value: (p, st) => st.income.animals },
  { id: 'automaton', kind: 'max', value: (p) => automaticUpgrades(p), achievement: true },
  { id: 'ironman', kind: 'max', value: (p) => shopTools(p), achievement: true },
];

// Logros que no son títulos: se consiguen al cumplir la condición durante la partida
const ACHIEVEMENTS = [
  { id: 'wateringDays', test: (st) => st.wateringDays },
  { id: 'howDidWeGetHere', test: (st) => st.sickleDays },
  { id: 'seizing', test: (st) => st.seizing },
];

// Devuelve, para cada jugador, { titles: [id], achievements: [id] }
export function computeAwards(game) {
  const mode = game.options?.mode ?? 'mine';
  const out = game.players.map(() => ({ titles: [], achievements: [] }));
  for (const title of TITLES) {
    if (title.mode && title.mode !== mode) continue;
    const values = game.players.map((p, i) => title.value(p, game.stats.players[i]));
    const best = title.kind === 'min' ? Math.min(...values) : Math.max(...values);
    if (title.kind === 'max' && best <= 0) continue;
    values.forEach((v, i) => {
      if (v !== best) return;
      out[i].titles.push(title.id);
      if (title.achievement) out[i].achievements.push(title.id);
    });
  }
  game.players.forEach((p, i) => {
    for (const a of ACHIEVEMENTS) if (a.test(game.stats.players[i])) out[i].achievements.push(a.id);
  });
  return out;
}
