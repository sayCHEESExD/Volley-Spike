// The Boxity environment this deploy runs in, as injected by Boxity hosting. Every Boxity
// URL on the server is built from here; the defaults apply only when nothing was told.
const strip = (u) => (typeof u === 'string' && u.trim() ? u.trim().replace(/\/+$/, '') : null);
export const BLOXITY = {
  env: process.env.BLOXITY_ENV || 'prod',
  apiUrl: strip(process.env.BLOXITY_API_URL) || 'https://api.bloxity.io',
  playUrl: strip(process.env.BLOXITY_MATCHMAKER_URL) || 'https://play.bloxity.io',
  portalUrl: strip(process.env.BLOXITY_PORTAL_URL) || 'https://bloxity.io',
  staticUrl: strip(process.env.BLOXITY_STATIC_URL) || 'https://static.bloxity.io',
};
export const GAME_HOSTING_ID = process.env.BLOXITY_GAME_ID || null;
export const REPORT_TOKEN = process.env.BLOXITY_REPORT_TOKEN || null;

// POST JSON with a timeout; never throws (returns { ok:false, status:0 } on network errors).
export async function postJson(url, body, headers = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { ok: res.ok, status: res.status, body: json };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(t); }
}
