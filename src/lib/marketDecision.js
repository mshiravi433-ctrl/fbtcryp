/** Breadth is a price-based proxy, NOT executed buy/sell volume or advice.
 * Risk is the mean observed intraday range / low, not a probability of loss.
 * Each ring has its own denominator; never normalise risk with breadth.
 */
export function marketDecision(coins = []) {
  const numeric = v => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v));
  const rows = coins.filter(c => c && !c.offline && c.dataProvenance !== 'offline');
  const moves = rows.filter(c => numeric(c.change24h));
  const ranges = rows.filter(c => numeric(c.high24h) && numeric(c.low24h) && Number(c.low24h) > 0 && Number(c.high24h) >= Number(c.low24h));
  return [
    { key: 'risk', label: 'ریسک نوسان', icon: '◈', color: '#ffad46', value: ranges.length ? ranges.reduce((sum, c) => sum + (Number(c.high24h) / Number(c.low24h) - 1) * 100, 0) / ranges.length : null, count: ranges.length },
    { key: 'buy', label: 'خرید · صعودی', icon: '↗', color: '#31e4aa', value: moves.length ? moves.filter(c => Number(c.change24h) > 0).length / moves.length * 100 : null, count: moves.length },
    { key: 'sell', label: 'فروش · نزولی', icon: '↘', color: '#ff6386', value: moves.length ? moves.filter(c => Number(c.change24h) < 0).length / moves.length * 100 : null, count: moves.length }
  ];
}
