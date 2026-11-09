// Partidas online entre ordenadores de distintas redes, con WebRTC (PeerJS).
// El navegador del anfitrión ejecuta el motor de reglas y es la única fuente de verdad:
// los invitados le envían las acciones que pulsan y él les reenvía el estado completo.
// El servidor público de PeerJS solo se usa para que los navegadores se encuentren
// (y como repetidor TURN si la conexión directa no es posible).

import { Game, shuffle } from './game.js';

const PREFIX = 'growing-season-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para que el código se dicte bien

export const randomCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const normalizeCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function peerLib() {
  if (!window.Peer) throw new Error('No se pudo cargar PeerJS (¿sin conexión a internet?)');
  return window.Peer;
}

const ERRORS = {
  'peer-unavailable': 'No existe ninguna sala con ese código (o el anfitrión la ha cerrado).',
  'unavailable-id': 'Ese código de sala ya está en uso.',
  network: 'No se pudo contactar con el servidor de conexión. Revisa tu conexión a internet.',
  'server-error': 'El servidor de conexión no responde. Inténtalo de nuevo en un rato.',
  'browser-incompatible': 'Este navegador no permite conexiones WebRTC.',
};
export const errorText = (err) => ERRORS[err?.type] ?? err?.message ?? String(err);

// Anfitrión: abre la sala con el código dado y avisa de cada conexión/mensaje/desconexión
export function openRoom(code, { onOpen, onConnect, onMessage, onClose, onError }) {
  const Peer = peerLib();
  const peer = new Peer(PREFIX + code);
  peer.on('open', () => onOpen());
  peer.on('connection', (conn) => {
    conn.on('open', () => onConnect(conn));
    conn.on('data', (d) => onMessage(conn, typeof d === 'string' ? JSON.parse(d) : d));
    conn.on('close', () => onClose(conn));
    conn.on('error', () => onClose(conn));
  });
  peer.on('error', onError);
  return peer;
}

// Invitado: se conecta a la sala del anfitrión
export function joinRoom(code, { onOpen, onMessage, onClose, onError }) {
  const Peer = peerLib();
  const peer = new Peer();
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => onOpen(conn));
    conn.on('data', (d) => onMessage(typeof d === 'string' ? JSON.parse(d) : d));
    conn.on('close', () => onClose());
    conn.on('error', () => onClose());
  });
  peer.on('error', onError);
  return peer;
}

export const send = (conn, msg) => { if (conn?.open) conn.send(JSON.stringify(msg)); };

// ---------- estado de la partida ----------

const hidden = (arr) => Array(arr.length).fill(null);

// Copia del estado para enviar: sin los datos estáticos (cada navegador carga los suyos)
// y sin revelar el orden de los mazos (del mercado solo viaja cuántas cartas quedan).
export function snapshot(game) {
  const s = {};
  for (const [k, v] of Object.entries(game)) if (k !== 'data' && k !== 'cfg') s[k] = v;
  const m = game.market;
  s.market = {
    ...m,
    seedDeck: hidden(m.seedDeck), toolDeck: hidden(m.toolDeck),
    farmDeck: hidden(m.farmDeck), mineDeck: hidden(m.mineDeck), mineDiscard: hidden(m.mineDiscard),
  };
  s.players = game.players.map((p) => ({ ...p, deck: shuffle([...p.deck]) }));
  return s;
}

// Reconstruye en el invitado un objeto Game de solo lectura para pintar
export function hydrate(data, s) {
  return Object.assign(Object.create(Game.prototype), s, { data, cfg: data.config });
}
