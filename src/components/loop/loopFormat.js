import { formatWeiFloor } from '../../lib/spot/spotMath.js';

/** Translation that degrades to the key when no `t` is wired (tests, storybook). */
export const tr = (t, key, options) => (typeof t === 'function' ? t(key, options) : key);

export function formatUsd(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : 2;
  return `${n < 0 ? '−' : ''}$${abs.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatFactor(value) {
  if (value === Infinity) return '∞';
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(2);
}

export function formatPct(value, digits = 2, { signed = false } = {}) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = signed && n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function formatMultiple(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(2)}×`;
}

/** Token amount from base units, floored (never shows more than exists). */
export function formatToken(wei, decimals, symbol = '') {
  if (wei == null || wei === '' || decimals == null) return '—';
  let raw;
  try { raw = BigInt(String(wei)); } catch { return '—'; }
  const whole = Number(raw / 10n ** BigInt(decimals));
  const maxFrac = whole >= 1000 ? 2 : whole >= 1 ? 4 : 6;
  const text = formatWeiFloor(raw, Number(decimals), Math.min(maxFrac, Number(decimals)));
  const [int, frac] = String(text).split('.');
  const grouped = Number(int).toLocaleString(undefined);
  const body = frac ? `${grouped}.${frac}` : grouped;
  return symbol ? `${body} ${symbol}` : body;
}

/** Health-factor band for colour: safe ≥ 1.5, watch ≥ 1.2, danger below. */
export function hfTone(value) {
  if (value === Infinity) return 'safe';
  if (value == null || !Number.isFinite(Number(value))) return 'none';
  const n = Number(value);
  if (n >= 1.5) return 'safe';
  if (n >= 1.2) return 'watch';
  return 'danger';
}

export const shortHash = (hash) => (hash ? `${String(hash).slice(0, 6)}…${String(hash).slice(-4)}` : '');
