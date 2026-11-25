// Conexión con Supabase para las cuentas de jugador (ver SUPABASE.md).
// Se rellena con los datos del proyecto: Project Settings → API. La URL es solo la base
// (https://xxxx.supabase.co), sin /rest/v1/ al final.
// La "anon public key" es pública por diseño (las tablas están protegidas con Row Level Security);
// la "service_role key" NUNCA se pone aquí.
// Si se dejan vacíos, el botón de iniciar sesión no aparece y el juego funciona igual.
export const SUPABASE_URL = 'https://jjqnwqlphkcapggfrezw.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_fp62lr_-0Ke0t103UtEzrQ_UEBSbX-I';
