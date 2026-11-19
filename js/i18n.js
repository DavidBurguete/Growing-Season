// Idiomas de la interfaz: español (por defecto) e inglés.
// t(clave, parámetros) traduce un texto. Las entradas del diccionario son cadenas con huecos
// {nombre} o funciones (f, p) => cadena, donde f son los parámetros ya formateados y p los originales
// (útil para plurales). Los nombres de cartas salen de los JSON: campo `name` (español) y
// `name_en` (inglés); lo mismo con `description`, `descriptionFishing` y `label`.

export const LANGS = {
  es: { label: 'Español', flag: 'assets/web/flags/es.webp' },
  en: { label: 'English', flag: 'assets/web/flags/en.webp' },
};

let lang = 'es';
try { if (LANGS[localStorage.getItem('gs-lang')]) lang = localStorage.getItem('gs-lang'); } catch { /* sin almacenamiento */ }

export const getLang = () => lang;
export function setLang(l) {
  if (!LANGS[l]) return;
  lang = l;
  try { localStorage.setItem('gs-lang', l); } catch { /* sin almacenamiento */ }
  document.documentElement.lang = l;
}

// Campo traducido de un objeto de datos: obj[field + '_en'] en inglés, si existe
export const loc = (obj, field = 'name') => (obj ? (lang !== 'es' && obj[`${field}_${lang}`]) || obj[field] || '' : '');
export const cardName = (def) => loc(def, 'name');

// 2.5 → "2,5" en español y "2.5" en inglés
export const fmtNum = (n) => (lang === 'es' ? String(n).replace('.', ',') : String(n));

const s = (n, one, many) => (n === 1 ? one : many);
const join = (names, and) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}` : names[0] ?? '');

const DICT = {
  es: {
    // ---------- registro ----------
    'log.gain': (f, p) => `${f.name} gana ${f.coins} moneda${s(p.coins, '', 's')} (${f.why})`,
    'why.animal': (f, p) => `${f.animal}${p.fodder ? ' + pienso' : ''}`,
    'why.pickler': 'encurtidora: {crop}',
    'why.water': 'riego: {crop}',
    'why.sprinkler': 'aspersor: {crop}',
    'why.harvest': (f, p) => `${p.how === 'harvester' ? 'cosechadora' : 'cosecha'}: ${f.crop}${p.fert ? ' + abono' : ''}${p.plot ? ' + parcela' : ''}`,
    'why.mine': 'mina',
    'why.dogcat': 'perro y gato',
    'why.dogcatFish': 'perro y gato: pesca',
    'why.fishing': (f, p) => `pesca: ${p.n} ${s(p.n, 'pez', 'peces')}`,
    'log.replacePending': (f, p) => `Se retira una ${TOOL.es[p.tool]} inicial (sustitución pendiente)`,
    'log.turn': '— Turno de {name} —',
    'log.shuffle': '{name} baraja su descarte',
    'log.seedmakerToWarehouse': '{crop} pasa de la semilladora al almacén',
    'log.seedmakerPlant': (f, p) => `La semilladora replanta ${f.crop}${p.plot ? ` en la ${f.plot.toLowerCase()}` : ''}`,
    'log.ready': '{crop} está listo para cosechar',
    'log.store': (f) => `${f.crop} va a ${f.upgrade.toLowerCase()}`,
    'log.mineNothing': '{name} no encuentra nada en la mina ({why})',
    'log.fishOut': '{name} sale a pescar con un valor de pesca de {power}',
    'log.fishNoCards': 'No quedan cartas de pesca',
    'log.fishCaught': (f, p) => `${f.name} pesca un pez de ${f.coins} moneda${s(p.coins, '', 's')} (le queda ${f.left} de valor de pesca)`,
    'log.fishCapsize': '¡Se escapa un pez de {fish}, vuelca la barca y se escapa también el anterior!',
    'log.fishEscape': 'Se escapa el pez (necesitaba {fish} de valor de pesca)',
    'log.catEscape': 'El gato no puede con un pez de {fish} y se escapa',
    'log.toWarehouse': '{seed} se guarda en el almacén',
    'log.buy': '{name} compra {card} por {cost}',
    'log.assorted': '{name} usa Semillas varias y obtiene {seed}',
    'log.plantStored': '{name} planta {seed} desde el almacén',
    'log.replaced': (f, p) => `${f.card} sustituye a una ${TOOL.es[p.tool]} inicial`,
    'log.replaceLater': (f, p) => `${f.card} sustituirá a la próxima ${TOOL.es[p.tool]} inicial que llegue al descarte`,
    'log.advance': '{name} coloca una moneda de 10 en la casilla {n}',
    'log.smithEmpty': 'La herrería está vacía: no hay cartas que llevarse',
    'log.smithGift': '{name} se lleva gratis las cartas de la herrería',
    'log.giftStays': '{card} se queda en la herrería (no queda ninguna carta inicial que sustituir)',
    'log.upgrade': '{name} consigue la mejora {card}',
    'log.boardDone': '¡{name} ha completado el tablero! Última ronda.',
    'log.surrender': '{name} se rinde',
    'log.wins': (f, p) => `¡${join(p.names, 'y')} gana${s(p.names.length, '', 'n')} la partida!`,
    'log.sharedWin': (f, p) => `¡Victoria compartida entre ${join(p.names, 'y')}!`,
    'log.order': (f, p) => `Orden de juego (por sorteo): ${p.names.join(', ')}`,
    'log.reconnected': '{name} se ha vuelto a conectar',
    'log.disconnected': '{name} se ha desconectado (puede volver con el mismo código y nombre)',

    // ---------- mercado y jugadores ----------
    'market.seeds': 'Semillas',
    'market.farm': 'Mejoras de granja',
    'market.mine': 'Mina',
    'market.fishing': 'Pesca',
    'market.smith': 'Herrería',
    'tip.assorted': '<b>Semillas varias</b><br>Compra por 1 moneda la carta de arriba',
    'tip.fishing': 'Pesca',
    'tip.fishLeft': 'Valor de pesca restante: {power}',
    'tip.fishWith': 'Pescar con valor {power}',
    'tip.fishSelect': 'Selecciona las cartas sin usar con las que quieras pescar',
    'badge.fishLeft': 'queda {power}',
    'badge.replacements': 'sustituciones: {n}',
    'crop.ready': '¡Lista!',
    'stored.when': 'se replanta al empezar el turno o en la fase de compra',
    'stored.in': 'guardado en {upgrade}',
    'btn.endActions': 'Terminar acciones',
    'btn.pass': 'Pasar turno',
    'btn.surrender': 'Rendirse',
    'player.you': 'tú',
    'player.cpu': 'CPU {level}',
    'cpu.easy': 'fácil',
    'cpu.medium': 'media',
    'cpu.hard': 'difícil',
    'cpu.human': 'Humano',

    // ---------- menús ----------
    'menu.local': 'Partida local',
    'menu.host': 'Crear partida online',
    'menu.join': 'Unirse a una partida',
    'menu.language': 'Idioma',
    'btn.back': 'Volver',
    'btn.cancel': 'Cancelar',
    'btn.start': 'Empezar partida',
    'btn.backToMenu': 'Volver al menú',
    'setup.subtitle': 'Partida de 2 jugadores en el mismo ordenador (o contra la CPU)',
    'setup.defaultName': 'Jugador {n}',
    'setup.nameLabel': 'Nombre del jugador {n}',
    'setup.colorLabel': 'Color del jugador {n}',
    'setup.cpuLabel': 'Quién controla al jugador {n}',
    'setup.sameColor': 'Cada jugador debe tener un color distinto.',
    'options.length': 'Duración de la partida',
    'options.extras': 'Jugar con las mejoras extra (★) de granja y herrería',
    'options.fishing': 'Jugar con pesca en lugar de mina',
    'net.defaultName': 'Jugador',
    'net.guestName': 'Invitado',
    'net.yourName': 'Tu nombre',
    'net.yourColor': 'Tu color',
    'host.title': 'Crear partida online',
    'host.text': 'Tu navegador hará de anfitrión: mientras dure la partida, no cierres esta pestaña.',
    'host.create': 'Crear sala',
    'host.creating': 'Creando la sala…',
    'join.title': 'Unirse a una partida',
    'join.code': 'CÓDIGO',
    'join.codeLabel': 'Código de la sala',
    'join.connect': 'Conectar',
    'join.connecting': 'Conectando con la sala…',
    'join.badCode': 'El código de la sala tiene 5 caracteres.',
    'lobby.title': 'Sala de espera',
    'lobby.code': 'Código de la sala',
    'lobby.invite': 'Dirección para invitar (IP pública:puerto)',
    'lobby.copy': 'Copiar enlace',
    'lobby.copied': '¡Copiado!',
    'lobby.invitePlaceholder': 'Escribe aquí tu IP pública y el puerto',
    'lobby.host': 'anfitrión',
    'lobby.waiting': 'Esperando a otro jugador…',
    'lobby.spectators': (f, p) => `${p.n} espectador${s(p.n, '', 'es')} conectado${s(p.n, '', 's')}`,
    'lobby.close': 'Cerrar sala',
    'lobby.full': 'La partida está completa: la verás como espectador.',
    'lobby.waitHost': 'Esperando a que el anfitrión empiece la partida…',
    'lobby.leave': 'Salir',
    'lost.title': 'Conexión perdida',
    'lost.text': 'Se ha perdido la conexión con el anfitrión. Puedes volver a unirte con el mismo código y nombre.',
    'net.err.peerjs': 'No se pudo cargar PeerJS (¿sin conexión a internet?)',
    'net.err.peer-unavailable': 'No existe ninguna sala con ese código (o el anfitrión la ha cerrado).',
    'net.err.unavailable-id': 'Ese código de sala ya está en uso.',
    'net.err.network': 'No se pudo contactar con el servidor de conexión. Revisa tu conexión a internet.',
    'net.err.server-error': 'El servidor de conexión no responde. Inténtalo de nuevo en un rato.',
    'net.err.browser-incompatible': 'Este navegador no permite conexiones WebRTC.',
    'load.title': 'No se pudieron cargar los datos',
    'load.hint': 'Abre el juego desde un servidor local, por ejemplo:',

    // ---------- diálogos de la partida ----------
    'replace.title': '¿Qué carta inicial sustituye {card}?',
    'replace.option': (f, p) => `${TOOL_CAP.es[p.tool]} (quedan ${p.n})`,
    'store.title': '¿Dónde guardas {crop}?',
    'store.none': 'No guardar',
    'warehouse.title': 'Almacén: ¿qué semilla quieres plantar?',
    'warehouse.none': 'No plantar',
    'fish.title': '¡Has pescado!',
    'fish.text': (f, p) => `Llevas <b>${f.coins}</b> moneda${s(p.coins, '', 's')} y te queda un valor de pesca de <b>${f.power}</b>.<br>
    Si sigues y el siguiente pez supera tu valor, se escapará junto con el último que has pescado.`,
    'fish.stop': 'Parar y cobrar',
    'fish.more': 'Seguir pescando',
    'surrender.title': '¿Seguro que {name} se rinde?',
    'surrender.text': 'La partida terminará y ganará el otro jugador.',
    'over.row': (f, p) => `<b>${f.name}</b>: ${p.board}/${p.spaces} casillas, ${p.coins} moneda${s(p.coins, '', 's')}, ${p.crops} cultivo${s(p.crops, '', 's')}`,
    'over.wins': '¡Gana {name}!',
    'over.shared': '¡Victoria compartida!',
    'over.restart': 'Nueva partida',
    'over.hostRestarts': 'El anfitrión puede empezar una nueva partida.',
    'over.gaveUp': '{name} se ha rendido.',
  },

  en: {
    'log.gain': (f, p) => `${f.name} earns ${f.coins} coin${s(p.coins, '', 's')} (${f.why})`,
    'why.animal': (f, p) => `${f.animal}${p.fodder ? ' + fodder' : ''}`,
    'why.pickler': 'pickler: {crop}',
    'why.water': 'watering: {crop}',
    'why.sprinkler': 'sprinkler: {crop}',
    'why.harvest': (f, p) => `${p.how === 'harvester' ? 'harvester' : 'harvest'}: ${f.crop}${p.fert ? ' + fertiliser' : ''}${p.plot ? ' + plot' : ''}`,
    'why.mine': 'mine',
    'why.dogcat': 'dog/cat',
    'why.dogcatFish': 'dog/cat: fishing',
    'why.fishing': (f, p) => `fishing: ${p.n} fish`,
    'log.replacePending': (f, p) => `A starter ${TOOL.en[p.tool]} is removed (pending replacement)`,
    'log.turn': "— {name}'s turn —",
    'log.shuffle': '{name} shuffles their discard pile',
    'log.seedmakerToWarehouse': '{crop} moved from the seed maker to the warehouse',
    'log.seedmakerPlant': (f, p) => `The seed maker replants ${f.crop}${p.plot ? ` on the ${f.plot.toLowerCase()}` : ''}`,
    'log.ready': '{crop}: ready to harvest',
    'log.store': (f) => `${f.crop} stored in ${f.upgrade.toLowerCase()}`,
    'log.mineNothing': '{name} finds nothing in the mine ({why})',
    'log.fishOut': '{name} goes fishing with a fishing value of {power}',
    'log.fishNoCards': 'There are no fishing cards left',
    'log.fishCaught': (f, p) => `${f.name} catches a ${f.coins}-coin fish (${f.left} fishing value left)`,
    'log.fishCapsize': 'A fish needing {fish} fishing value escapes, knocks the boat over and the previous fish escapes too!',
    'log.fishEscape': 'The fish escapes (it needed a fishing value of {fish})',
    'log.catEscape': "The cat can't catch a fish needing {fish} fishing value and it escapes",
    'log.toWarehouse': '{seed} stored in the warehouse',
    'log.buy': '{name} buys {card} for {cost}',
    'log.assorted': '{name} uses Assorted Seeds and gets {seed}',
    'log.plantStored': '{name} plants {seed} from the warehouse',
    'log.replaced': (f, p) => `${f.card} replaces a starter ${TOOL.en[p.tool]}`,
    'log.replaceLater': (f, p) => `${f.card} will replace the next starter ${TOOL.en[p.tool]} that reaches the discard pile`,
    'log.advance': '{name} places a 10 coin on space {n}',
    'log.smithEmpty': 'The blacksmith is empty: there are no cards to take',
    'log.smithGift': "{name} takes the blacksmith's cards for free",
    'log.giftStays': '{card} stays at the blacksmith (no starter card left to replace)',
    'log.upgrade': '{name} gets the {card} upgrade',
    'log.boardDone': '{name} has completed the board! Last round.',
    'log.surrender': '{name} surrenders',
    'log.wins': (f, p) => `${join(p.names, 'and')} win${s(p.names.length, 's', '')} the game!`,
    'log.sharedWin': (f, p) => `Shared victory between ${join(p.names, 'and')}!`,
    'log.order': (f, p) => `Turn order (drawn at random): ${p.names.join(', ')}`,
    'log.reconnected': '{name} has reconnected',
    'log.disconnected': '{name} has disconnected (they can come back with the same code and name)',

    'market.seeds': 'Store',
    'market.farm': 'Farm upgrades',
    'market.mine': 'Mine',
    'market.fishing': 'Fishing',
    'market.smith': 'Blacksmith',
    'tip.assorted': '<b>Assorted Seeds</b><br>Buy the top card of the crop deck for 1 coin',
    'tip.fishing': 'Fishing',
    'tip.fishLeft': 'Fishing value left: {power}',
    'tip.fishWith': 'Go fishing with a value of {power}',
    'tip.fishSelect': 'Select the unused cards you want to go fishing with',
    'badge.fishLeft': '{power} left',
    'badge.replacements': 'replacements: {n}',
    'crop.ready': 'Ready!',
    'stored.when': 'replanted at the start of the turn or in the buying phase',
    'stored.in': 'stored in {upgrade}',
    'btn.endActions': 'End actions',
    'btn.pass': 'End turn',
    'btn.surrender': 'Surrender',
    'player.you': 'you',
    'player.cpu': '{level} CPU',
    'cpu.easy': 'Easy',
    'cpu.medium': 'Medium',
    'cpu.hard': 'Hard',
    'cpu.human': 'Human',

    'menu.local': 'Local game',
    'menu.host': 'Create online game',
    'menu.join': 'Join a game',
    'menu.language': 'Language',
    'btn.back': 'Back',
    'btn.cancel': 'Cancel',
    'btn.start': 'Start game',
    'btn.backToMenu': 'Back to menu',
    'setup.subtitle': '2-player game on the same computer (or against the CPU)',
    'setup.defaultName': 'Player {n}',
    'setup.nameLabel': 'Player {n} name',
    'setup.colorLabel': 'Player {n} colour',
    'setup.cpuLabel': 'Who controls player {n}',
    'setup.sameColor': 'Each player must have a different colour.',
    'options.length': 'Game length',
    'options.extras': 'Play with the advanced (★) farm and blacksmith upgrades',
    'options.fishing': 'Play with fishing instead of the mine',
    'net.defaultName': 'Player',
    'net.guestName': 'Guest',
    'net.yourName': 'Your name',
    'net.yourColor': 'Your colour',
    'host.title': 'Create online game',
    'host.text': 'Your browser will be the host: keep this tab open for the whole game.',
    'host.create': 'Create room',
    'host.creating': 'Creating the room…',
    'join.title': 'Join a game',
    'join.code': 'CODE',
    'join.codeLabel': 'Room code',
    'join.connect': 'Connect',
    'join.connecting': 'Connecting to the room…',
    'join.badCode': 'The room code has 5 characters.',
    'lobby.title': 'Waiting room',
    'lobby.code': 'Room code',
    'lobby.invite': 'Invite address (public IP:port)',
    'lobby.copy': 'Copy link',
    'lobby.copied': 'Copied!',
    'lobby.invitePlaceholder': 'Type your public IP and port here',
    'lobby.host': 'host',
    'lobby.waiting': 'Waiting for another player…',
    'lobby.spectators': (f, p) => `${p.n} spectator${s(p.n, '', 's')} connected`,
    'lobby.close': 'Close room',
    'lobby.full': 'The game is full: you will watch it as a spectator.',
    'lobby.waitHost': 'Waiting for the host to start the game…',
    'lobby.leave': 'Leave',
    'lost.title': 'Connection lost',
    'lost.text': 'The connection with the host has been lost. You can join again with the same code and name.',
    'net.err.peerjs': 'PeerJS could not be loaded (no internet connection?)',
    'net.err.peer-unavailable': 'There is no room with that code (or the host has closed it).',
    'net.err.unavailable-id': 'That room code is already in use.',
    'net.err.network': 'Could not reach the connection server. Check your internet connection.',
    'net.err.server-error': 'The connection server is not responding. Try again in a while.',
    'net.err.browser-incompatible': 'This browser does not support WebRTC connections.',
    'load.title': 'The game data could not be loaded',
    'load.hint': 'Open the game from a local server, for example:',

    'replace.title': 'Which starter card does {card} replace?',
    'replace.option': (f, p) => `${TOOL_CAP.en[p.tool]} (${p.n} left)`,
    'store.title': 'Where do you store {crop}?',
    'store.none': "Don't store",
    'warehouse.title': 'Warehouse: which crop do you want to plant?',
    'warehouse.none': "Don't plant",
    'fish.title': 'You caught a fish!',
    'fish.text': (f, p) => `You have <b>${f.coins}</b> coin${s(p.coins, '', 's')} and a fishing value of <b>${f.power}</b> left.<br>
    If you continue and the next fish exceeds your value, it will escape along with the last fish you caught.`,
    'fish.stop': 'Stop and collect',
    'fish.more': 'Keep fishing',
    'surrender.title': 'Are you sure {name} surrenders?',
    'surrender.text': 'The game will end and the other player will win.',
    'over.row': (f, p) => `<b>${f.name}</b>: ${p.board}/${p.spaces} spaces, ${p.coins} coin${s(p.coins, '', 's')}, ${p.crops} crop${s(p.crops, '', 's')}`,
    'over.wins': '{name} wins!',
    'over.shared': 'Shared victory!',
    'over.restart': 'New game',
    'over.hostRestarts': 'The host can start a new game.',
    'over.gaveUp': '{name} has surrendered.',
  },
};

const TOOL = { es: { watering: 'regadera', sickle: 'hoz' }, en: { watering: 'watering can', sickle: 'sickle' } };
const TOOL_CAP = { es: { watering: 'Regadera', sickle: 'Hoz' }, en: { watering: 'Watering can', sickle: 'Sickle' } };

// Formatea un parámetro: números con la coma o el punto del idioma, cartas con su nombre
// traducido y { key, params } como un texto traducido anidado.
function fmtParam(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmtNum(v);
  if (Array.isArray(v)) return v.map(fmtParam).join(', ');
  if (typeof v === 'object') {
    if (v.key) return t(v.key, v.params);
    if ('name' in v) return cardName(v);
    return '';
  }
  return String(v);
}

export function t(key, params = {}) {
  const entry = DICT[lang][key] ?? DICT.es[key];
  if (entry === undefined) return key;
  const f = {};
  for (const [k, v] of Object.entries(params)) f[k] = fmtParam(v);
  if (typeof entry === 'function') return entry(f, params);
  return entry.replace(/\{(\w+)\}/g, (m, k) => (k in f ? f[k] : m));
}

// Línea del registro: { key, params } (o, por compatibilidad, un texto ya hecho en msg)
export const logText = (l) => (l.key ? t(`log.${l.key}`, l.params) : l.msg ?? '');
