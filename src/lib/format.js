/** Number / date formatting helpers shared by every screen. */

const nf = (opts) => new Intl.NumberFormat('en-US', opts);

export function fmtPrice(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs < 0.00001) return v.toExponential(3);
  if (abs < 0.01) return nf({ maximumFractionDigits: 8 }).format(v);
  if (abs < 1) return nf({ maximumFractionDigits: 5 }).format(v);
  if (abs < 1000) return nf({ maximumFractionDigits: 2 }).format(v);
  return nf({ maximumFractionDigits: 0 }).format(v);
}

export function fmtUsd(v, opts = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  return `$${fmtPrice(v, opts)}`;
}

export function fmtCompact(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function fmtNum(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return nf({ maximumFractionDigits: digits }).format(v);
}

export function fmtPct(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function fmtQty(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return nf({ maximumFractionDigits: 2 }).format(v);
  if (abs >= 1) return nf({ maximumFractionDigits: 4 }).format(v);
  return nf({ maximumFractionDigits: 8 }).format(v);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function timeAgo(ts, lang = 'en') {
  const s = Math.floor((Date.now() - ts) / 1000);
  const units = [
    [60, 's'],
    [3600, 'm'],
    [86400, 'h'],
    [Infinity, 'd']
  ];
  if (s < 60) return lang === 'fa' ? 'همین حالا' : 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
  void units;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
