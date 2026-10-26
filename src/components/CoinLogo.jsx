import { useEffect, useId, useMemo, useState } from 'react';
import { coinHue, coinImage, tickerLogo } from '../lib/coinImage';
import { symbolSvg } from './AssetIcon';

function scopeSvg(svg, scope) {
  if (!svg) return null;
  const sized = /^<svg(?![^>]*\swidth=)/.test(svg)
    ? svg.replace('<svg ', '<svg width="100%" height="100%" ')
    : svg;
  if (!scope || !sized.includes('id="')) return sized;
  return sized
    .replace(/\bid="([^"]+)"/g, `id="${scope}_$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${scope}_$1)`);
}

/**
 * Shared coin & equity avatar with instant frame-0 offline vector / colour
 * underlay so Market, Stories, Ticker and CoinRow icons never appear blank on
 * slow or filtered connections, plus `preferVector` full-bleed mode for square
 * hero tiles such as the Bitcoin hero card.
 */
export default function CoinLogo({
  coin,
  ticker,
  name: _name,
  size = 'small',
  px,
  preferVector = false,
  className = 'coin-logo',
  style
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const rawSym = coin?.symbol ?? ticker;
  const rawSvg = useMemo(() => symbolSvg(rawSym), [rawSym]);
  const scopedSvg = useMemo(() => scopeSvg(rawSvg, uid), [rawSvg, uid]);

  const src = (preferVector && scopedSvg)
    ? null
    : (coinImage(coin?.image, size) ?? (ticker ? tickerLogo(ticker) : null));

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const symbol = String(rawSym ?? '?').slice(0, 3).toUpperCase();
  const box = px ? { width: px, height: px, ...style } : style;
  const hue = coinHue(rawSym);

  if (!src || failed) {
    if (scopedSvg) {
      return (
        <span
          className={className}
          style={{ ...box, display: 'block', background: 'none', padding: 0 }}
          dangerouslySetInnerHTML={{ __html: scopedSvg }}
          aria-hidden="true"
        />
      );
    }
    return (
      <span
        className={className}
        style={{
          ...box,
          background: `linear-gradient(140deg, hsl(${hue} 60% 30%), hsl(${(hue + 40) % 360} 60% 22%))`,
          color: '#fff'
        }}
      >
        {symbol}
      </span>
    );
  }

  const preloadStyle = !loaded && !scopedSvg
    ? {
        ...box,
        background: `linear-gradient(140deg, hsl(${hue} 58% 28%), hsl(${(hue + 38) % 360} 58% 20%))`
      }
    : box;

  return (
    <span className={className} style={preloadStyle}>
      {!loaded && scopedSvg && (
        <span
          className="coin-logo-underlay"
          dangerouslySetInnerHTML={{ __html: scopedSvg }}
          aria-hidden="true"
        />
      )}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        referrerPolicy="no-referrer"
        className={loaded ? 'coin-logo-net is-loaded' : 'coin-logo-net'}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
