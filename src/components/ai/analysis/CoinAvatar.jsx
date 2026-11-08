import { useMemo } from 'react';
import CoinLogo from '../../CoinLogo.jsx';
import { symbolSvg } from '../../AssetIcon.jsx';
import { iconCandidates } from '../../../lib/tokenIcon.jsx';

/**
 * Market intelligence uses CRYPTO artwork, never the equity-logo endpoint.
 * Bundled marks paint on frame zero; a feed image / curated crypto catalogue
 * covers the rest. CoinLogo still owns the readable, non-empty last resort.
 */
export default function CoinAvatar({ coin, px = 32, priority = false }) {
  const symbol = coin?.symbol;
  const artwork = useMemo(() => {
    const supplied = String(coin?.image || '').trim();
    return /^https:\/\//i.test(supplied)
      ? supplied
      : iconCandidates({ symbol })[0] || null;
  }, [coin?.image, symbol]);

  return (
    <CoinLogo
      coin={{ ...coin, image: artwork }}
      px={px}
      preferVector={Boolean(symbolSvg(symbol))}
      priority={priority}
      className="coin-logo aix-coin-avatar"
    />
  );
}
