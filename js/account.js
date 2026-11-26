// Cuentas de jugador (opcionales) con Supabase: botón en la esquina, ventanas de inicio de
// sesión y de perfil, y guardado del resultado al acabar una partida online.
// La conexión se configura en js/supabase-config.js; sin ella este módulo no hace nada.
// No hay enlaces en los correos: para confirmar la cuenta y recuperar la contraseña se usa un
// código de 6 dígitos, así nunca se sale de la página (no se corta una partida online).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
import { t, getLang } from './i18n.js';
import { TITLE_IDS, ACHIEVEMENT_IDS } from './stats.js';

const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const NAME_MAX = 16;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  client: null,
  user: null,
  profile: null, // { name }
  games: [], // [{ length, won }]
  awards: [], // [{ kind, award, first_at }]
  pending: null, // resultado de la última partida, si se acabó sin sesión
  results: {}, // por partida: { status: 'pending' | 'saving' | 'saved' | 'error', fresh: Set('kind:id') }
  view: null, // ventana abierta: { name, ...datos }
};

// Lo que el módulo necesita del juego (lo pasa main.js)
let hooks = {
  currentName: () => '', // nombre escrito ahora mismo (para crear el perfil)
  onName: () => {}, // la cuenta tiene un nombre nuevo: (name, { live }) → rellenar formularios / partida
  onChange: () => {}, // cambia el estado de guardado: repintar la pantalla final
  lengths: () => [], // [[clave, nombre traducido]] de las duraciones de partida
};

// La URL debe ser la base del proyecto (https://xxxx.supabase.co): si se ha copiado con
// /rest/v1/ o /auth/v1/ al final, se quita (si no, todas las llamadas fallan)
const projectUrl = () => String(SUPABASE_URL).trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
export const accountConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const signedIn = () => Boolean(S.user);

export async function initAccount(h, { client = null } = {}) {
  hooks = { ...hooks, ...h };
  ensureElements();
  if (!client && !accountConfigured()) { renderAccountButton(); return; }
  try {
    if (!client) {
      const { createClient } = await import(SUPABASE_LIB);
      // La sesión se queda guardada en este navegador (localStorage) y se renueva sola: no hay
      // que volver a iniciarla al recargar ni otro día, hasta cerrar sesión.
      client = createClient(projectUrl(), String(SUPABASE_ANON_KEY).trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    }
  } catch (err) {
    console.warn('No se pudo cargar Supabase', err);
    return;
  }
  S.client = client;
  // Las llamadas a Supabase no se hacen dentro del aviso (la librería se bloquearía): van después
  client.auth.onAuthStateChange((event, session) => setTimeout(() => authChanged(event, session), 0));
  const { data } = await client.auth.getSession();
  await authChanged('INITIAL', data?.session ?? null);
}

async function authChanged(event, session) {
  const user = session?.user ?? null;
  if (user && S.user?.id === user.id && event !== 'INITIAL') { renderAccountButton(); return; }
  S.user = user;
  if (!user) {
    Object.assign(S, { profile: null, games: [], awards: [] });
    if (S.view?.name === 'profile' || S.view?.name === 'confirmDelete') closeView();
    renderAccountButton();
    hooks.onChange();
    return;
  }
  saveEmail(user.email);
  await loadProfile();
  renderAccountButton();
  if (S.profile?.name) hooks.onName(S.profile.name, { live: false });
  // Si había una partida acabada sin guardar, se guarda ahora
  if (S.pending) await sync(S.pending);
  else hooks.onChange();
}

async function loadProfile() {
  const c = S.client;
  const { data: prof } = await c.from('profiles').select('name').eq('id', S.user.id).maybeSingle();
  if (prof) S.profile = prof;
  else {
    const name = String(hooks.currentName() || '').trim().slice(0, NAME_MAX);
    S.profile = { name };
    await c.from('profiles').insert({ id: S.user.id, name });
  }
  await loadRecords();
}

async function loadRecords() {
  const c = S.client;
  const [games, awards] = await Promise.all([
    c.from('games').select('length, won'),
    c.from('awards').select('kind, award, first_at'),
  ]);
  S.games = games.data ?? [];
  S.awards = awards.data ?? [];
}

// ---------- resultado de la partida ----------

// result: { gameId, length, mode, won, titles: [id], achievements: [id] }
// Se llama al llegar a la pantalla final; solo cuenta la primera vez para cada partida.
export function submitResult(result) {
  if (!S.client || S.results[result.gameId]) return;
  S.results[result.gameId] = { status: 'pending', fresh: new Set() };
  if (S.user) sync(result);
  else S.pending = result;
}

// Empieza otra partida: el resultado sin guardar de la anterior se pierde
export function clearPending() { S.pending = null; }

// Estado de guardado de una partida para la pantalla final (null: no hay cuentas)
export function resultInfo(gameId) {
  if (!S.client) return null;
  const r = S.results[gameId];
  if (!r) return null;
  return { status: r.status === 'pending' && S.user ? 'saving' : r.status, fresh: r.fresh };
}

async function sync(result) {
  const r = S.results[result.gameId];
  r.status = 'saving';
  hooks.onChange();
  const { data, error } = await S.client.rpc('record_game', {
    p_game_id: result.gameId, p_length: result.length, p_mode: result.mode, p_won: result.won,
    p_titles: result.titles, p_achievements: result.achievements,
  });
  if (error) {
    console.warn('No se pudo guardar la partida', error);
    r.status = 'error';
    S.pending = result; // se puede reintentar
  } else {
    r.status = 'saved';
    r.fresh = new Set((data ?? []).map((x) => `${x.new_kind}:${x.new_award}`));
    if (S.pending?.gameId === result.gameId) S.pending = null;
    await loadRecords();
  }
  hooks.onChange();
  if (S.view?.name === 'profile') renderView();
}

// ---------- botón de la esquina ----------

function ensureElements() {
  if (!document.getElementById('account')) {
    const nav = document.createElement('nav');
    nav.id = 'account';
    document.body.appendChild(nav);
  }
  if (!document.getElementById('account-overlay')) {
    const ov = document.createElement('div');
    ov.id = 'account-overlay';
    document.body.appendChild(ov);
  }
}

export function renderAccountButton() {
  const el = document.getElementById('account');
  if (!el) return;
  if (!S.client) { el.innerHTML = ''; return; }
  el.innerHTML = S.user
    ? `<button class="account-btn signed" data-acc="profile" title="${t('acc.profile')}"><span aria-hidden="true">👤</span> ${esc(S.profile?.name || t('acc.profile'))}</button>`
    : `<button class="account-btn" data-acc="login">${t('acc.login')}</button>`;
}

// Repinta el botón y la ventana abierta (al cambiar de idioma)
export function refreshAccountUi() {
  renderAccountButton();
  if (S.view) renderView();
}

// ---------- ventanas ----------

// Último correo con el que se inició sesión en este navegador: rellena el formulario
const EMAIL_KEY = 'gs-account-email';
const savedEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };
const saveEmail = (e) => { try { if (e) localStorage.setItem(EMAIL_KEY, e); } catch { /* sin almacenamiento */ } };

function openView(name, extra = {}) {
  S.view = { name, ...extra };
  if (['login', 'signup', 'forgot'].includes(name) && !S.view.email) S.view.email = savedEmail();
  renderView();
  // Con el correo ya puesto se empieza por la contraseña
  const ov = document.getElementById('account-overlay');
  const first = [...ov.querySelectorAll('input')].find((i) => !i.value) ?? ov.querySelector('input');
  first?.focus();
}
function closeView() {
  S.view = null;
  const ov = document.getElementById('account-overlay');
  ov.className = '';
  ov.innerHTML = '';
}
function renderView() {
  const ov = document.getElementById('account-overlay');
  const v = S.view;
  if (!v) return;
  const html = { login: authHtml, signup: authHtml, verify: verifyHtml, forgot: forgotHtml, profile: profileHtml, confirmDelete: deleteHtml }[v.name](v);
  // El contenido va en su propia caja con scroll, para que la barra quede dentro del borde redondeado
  ov.innerHTML = `<div class="dialog account-dialog" role="dialog" aria-modal="true"><div class="acc-scroll">${html}</div></div>`;
  ov.className = 'show';
}

const field = (id, label, type = 'text', value = '', extra = '') => `<label class="acc-field">${label}
  <input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
// detail: mensaje técnico de Supabase (en pequeño, para poder diagnosticar el fallo)
const msgLine = (v) => (v.error ? `<p class="net-error">${esc(v.error)}${v.detail ? `<small class="acc-detail">${esc(v.detail)}</small>` : ''}</p>` : v.info ? `<p class="acc-info">${esc(v.info)}</p>` : '');

function authHtml(v) {
  const signup = v.name === 'signup';
  return `<h2>${t(signup ? 'acc.signupTitle' : 'acc.loginTitle')}</h2>
    ${v.reason === 'save' ? `<p>${t('acc.saveHint')}</p>` : ''}
    <form id="acc-form" data-form="${v.name}">
      ${field('acc-email', t('acc.email'), 'email', v.email, 'autocomplete="email" required')}
      ${field('acc-pass', t('acc.password'), 'password', '', `autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required`)}
      ${msgLine(v)}
      <div class="acc-buttons">
        <button type="button" class="btn secondary" data-acc="close">${t('acc.cancel')}</button>
        <button type="submit" class="btn" ${v.busy ? 'disabled' : ''}>${t(signup ? 'acc.submitSignup' : 'acc.submitLogin')}</button>
      </div>
    </form>
    <p class="acc-links">
      <button class="link" data-acc="${signup ? 'login' : 'signup'}">${t(signup ? 'acc.toLogin' : 'acc.toSignup')}</button>
      ${signup ? '' : `<button class="link" data-acc="forgot">${t('acc.forgot')}</button>`}
    </p>`;
}

// Código de confirmación de la cuenta (después de crearla)
function verifyHtml(v) {
  return `<h2>${t('acc.verifyTitle')}</h2>
    <p>${t('acc.verifyText', { email: v.email })}</p>
    <form id="acc-form" data-form="verify">
      ${field('acc-code', t('acc.code'), 'text', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="10" required')}
      ${msgLine(v)}
      <div class="acc-buttons">
        <button type="button" class="btn secondary" data-acc="close">${t('acc.cancel')}</button>
        <button type="submit" class="btn" ${v.busy ? 'disabled' : ''}>${t('acc.confirm')}</button>
      </div>
    </form>`;
}

// Recuperar la contraseña: primero el correo; después el código y la contraseña nueva
function forgotHtml(v) {
  const step2 = v.sent;
  return `<h2>${t('acc.forgotTitle')}</h2>
    <p>${t(step2 ? 'acc.forgotSent' : 'acc.forgotText', { email: v.email ?? '' })}</p>
    <form id="acc-form" data-form="${step2 ? 'reset' : 'forgot'}">
      ${step2 ? `${field('acc-code', t('acc.code'), 'text', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="10" required')}
        ${field('acc-pass', t('acc.newPassword'), 'password', '', 'autocomplete="new-password" minlength="6" required')}`
    : field('acc-email', t('acc.email'), 'email', v.email, 'autocomplete="email" required')}
      ${msgLine(v)}
      <div class="acc-buttons">
        <button type="button" class="btn secondary" data-acc="login">${t('btn.back')}</button>
        <button type="submit" class="btn" ${v.busy ? 'disabled' : ''}>${t(step2 ? 'acc.savePassword' : 'acc.sendCode')}</button>
      </div>
    </form>`;
}

function profileHtml(v) {
  const date = (iso) => new Date(iso).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const got = (kind) => new Map(S.awards.filter((a) => a.kind === kind).map((a) => [a.award, a]));
  const ach = got('achievement');
  const tit = got('title');
  const pct = (won, n) => (n ? `${Math.round((won / n) * 100)} %` : '—');
  const rows = hooks.lengths().map(([k, label]) => {
    const gs = S.games.filter((g) => g.length === k);
    const won = gs.filter((g) => g.won).length;
    return `<tr><th>${esc(label)}</th><td>${gs.length}</td><td>${won}</td><td>${pct(won, gs.length)}</td></tr>`;
  }).join('');
  const totalWon = S.games.filter((g) => g.won).length;
  // Logros sin conseguir: nombre en gris y descripción con interrogantes.
  // Títulos sin conseguir: en gris, pero con su descripción.
  const item = (id, a, kind) => `<li class="acc-award ${a ? 'got' : 'locked'}">
      <span class="acc-award-icon" aria-hidden="true">${kind === 'title' ? '🏅' : '🏆'}</span>
      <div><b>${t(`title.${id}`)}</b>
      <small>${a || kind === 'title' ? t(`titleDesc.${id}`) : t('acc.locked')}</small>
      ${a ? `<small class="acc-date">${t('acc.unlockedOn', { date: date(a.first_at) })}</small>` : ''}</div></li>`;
  return `<h2>${t('acc.profileTitle')}</h2>
    <p class="acc-email">${esc(S.user?.email ?? '')}</p>
    <label class="acc-field acc-name">${t('acc.name')}
      <input id="acc-name" value="${esc(S.profile?.name ?? '')}" maxlength="${NAME_MAX}" autocomplete="nickname">
      <span class="acc-name-state" aria-live="polite">${v.nameState ? t(`acc.name_${v.nameState}`) : ''}</span>
    </label>
    <h3>${t('acc.games')}</h3>
    <table class="acc-table">
      <thead><tr><th>${t('acc.length')}</th><th>${t('acc.played')}</th><th>${t('acc.won')}</th><th>${t('acc.winPct')}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>${t('acc.total')}</th><td>${S.games.length}</td><td>${totalWon}</td><td>${pct(totalWon, S.games.length)}</td></tr></tfoot>
    </table>
    <p class="acc-note">${t('acc.onlineOnly')}</p>
    <h3>${t('acc.achievements', { n: ACHIEVEMENT_IDS.filter((id) => ach.has(id)).length, total: ACHIEVEMENT_IDS.length })}</h3>
    <ul class="acc-awards">${ACHIEVEMENT_IDS.map((id) => item(id, ach.get(id), 'achievement')).join('')}</ul>
    <h3>${t('acc.titles', { n: TITLE_IDS.filter((id) => tit.has(id)).length, total: TITLE_IDS.length })}</h3>
    <ul class="acc-awards">${TITLE_IDS.map((id) => item(id, tit.get(id), 'title')).join('')}</ul>
    <div class="acc-buttons">
      <button class="btn danger small" data-acc="delete">${t('acc.delete')}</button>
      <button class="btn secondary" data-acc="logout">${t('acc.logout')}</button>
      <button class="btn" data-acc="close">${t('acc.close')}</button>
    </div>`;
}

function deleteHtml(v) {
  return `<h2>${t('acc.deleteTitle')}</h2>
    <p>${t('acc.deleteText')}</p>
    ${msgLine(v)}
    <div class="acc-buttons">
      <button class="btn secondary" data-acc="profile">${t('acc.cancel')}</button>
      <button class="btn danger" data-acc="deleteYes" ${v.busy ? 'disabled' : ''}>${t('acc.deleteYes')}</button>
    </div>`;
}

// Mensajes de error de Supabase → texto para el jugador. "El código no es correcto" solo
// se dice en los pasos en los que se escribe un código (kind: verify / reset).
function errorText(err, kind) {
  console.warn('Supabase:', err);
  const m = String(err?.message ?? err ?? '').toLowerCase();
  const code = String(err?.code ?? '').toLowerCase();
  if (code === 'invalid_credentials' || m.includes('invalid login')) return t('acc.err.credentials');
  if (code === 'email_not_confirmed' || m.includes('not confirmed')) return t('acc.err.notConfirmed');
  if (code === 'user_already_exists' || m.includes('already registered') || m.includes('already been registered')) return t('acc.err.exists');
  if (code === 'weak_password' || (m.includes('password') && (m.includes('6') || m.includes('short') || m.includes('weak')))) return t('acc.err.weak');
  if (code.includes('rate_limit') || m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return t('acc.err.rate');
  if (code === 'email_address_invalid' || m.includes('email address') && m.includes('invalid')) return t('acc.err.email');
  if (code.includes('email') && code.includes('send') || m.includes('sending') && m.includes('email')) return t('acc.err.mail');
  if ((kind === 'verify' || kind === 'reset') && (code === 'otp_expired' || m.includes('expired') || m.includes('token'))) return t('acc.err.code');
  return t('acc.err.generic');
}

// ---------- acciones ----------

const val = (id) => document.getElementById(id)?.value.trim() ?? '';

async function submitForm(kind) {
  const v = S.view;
  const auth = S.client.auth;
  // Se leen los campos antes de repintar la ventana (al repintar se vacían)
  const email = val('acc-email') || v.email;
  const password = val('acc-pass');
  const code = val('acc-code');
  const busy = async (fn) => {
    Object.assign(v, { busy: true, error: '', detail: '', info: '', email });
    renderView();
    try { await fn(); } catch (err) {
      v.error = errorText(err, kind);
      v.detail = [err?.code, err?.message].filter(Boolean).join(': ');
    }
    v.busy = false;
    if (S.view === v) renderView();
  };
  if (kind === 'login') {
    await busy(async () => {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) {
        // Cuenta creada sin confirmar: se pide el código
        if (/not confirmed/i.test(error.message)) { openView('verify', { email, error: t('acc.err.notConfirmed') }); return; }
        throw error;
      }
      closeView();
    });
  }
  if (kind === 'signup') {
    await busy(async () => {
      const { data, error } = await auth.signUp({ email, password });
      if (error) throw error;
      // Si el proyecto no pide confirmar el correo, ya hay sesión
      if (data.session) closeView();
      else openView('verify', { email });
    });
  }
  if (kind === 'verify') {
    await busy(async () => {
      const { error } = await auth.verifyOtp({ email, token: code, type: 'signup' });
      if (error) throw error;
      closeView();
    });
  }
  if (kind === 'forgot') {
    await busy(async () => {
      const { error } = await auth.resetPasswordForEmail(email);
      if (error) throw error;
      v.sent = true;
    });
  }
  if (kind === 'reset') {
    await busy(async () => {
      const { error } = await auth.verifyOtp({ email, token: code, type: 'recovery' });
      if (error) throw error;
      const { error: e2 } = await auth.updateUser({ password });
      if (e2) throw e2;
      closeView();
    });
  }
}

// Cambio de nombre: se guarda poco después de dejar de escribir y se aplica al momento al juego
let nameTimer = null;
function nameTyped() {
  clearTimeout(nameTimer);
  const name = val('acc-name').slice(0, NAME_MAX);
  const state = document.querySelector('.acc-name-state');
  if (!name) { if (state) state.textContent = t('acc.name_empty'); return; }
  if (state) state.textContent = t('acc.name_saving');
  nameTimer = setTimeout(async () => {
    if (!S.user || name === S.profile?.name) { if (state) state.textContent = ''; return; }
    const { error } = await S.client.from('profiles').update({ name, updated_at: new Date().toISOString() }).eq('id', S.user.id);
    const el = document.querySelector('.acc-name-state');
    if (error) { if (el) el.textContent = t('acc.name_error'); return; }
    S.profile.name = name;
    if (el) el.textContent = t('acc.name_saved');
    renderAccountButton();
    hooks.onName(name, { live: true });
  }, 600);
}

const ACTIONS = {
  login: () => openView('login', { email: S.view?.email }),
  signup: () => openView('signup', { email: S.view?.email }),
  forgot: () => openView('forgot', { email: val('acc-email') || S.view?.email }),
  save: () => openView('login', { reason: 'save' }),
  retry: () => { if (S.pending && S.user) sync(S.pending); },
  profile: () => openView('profile'),
  close: () => closeView(),
  logout: async () => { closeView(); await S.client.auth.signOut(); },
  delete: () => openView('confirmDelete'),
  deleteYes: async () => {
    const v = S.view;
    Object.assign(v, { busy: true, error: '' });
    renderView();
    const { error } = await S.client.rpc('delete_account');
    if (error) { Object.assign(v, { busy: false, error: t('acc.err.generic') }); renderView(); return; }
    closeView();
    await S.client.auth.signOut();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-acc]');
  if (el && !el.disabled && ACTIONS[el.dataset.acc] && S.client) { e.preventDefault(); ACTIONS[el.dataset.acc](); return; }
  // Clic fuera de la ventana: se cierra
  if (e.target.id === 'account-overlay') closeView();
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'acc-form') return;
  e.preventDefault();
  submitForm(e.target.dataset.form);
});
document.addEventListener('input', (e) => { if (e.target.id === 'acc-name') nameTyped(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.view) closeView(); });
