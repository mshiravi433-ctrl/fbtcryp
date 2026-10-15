/**
 * THE CLIMATE SKY — the financial climate as a weather window behind glass.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10-15): «باکس اقلیم مالی این دور خیلی مدرن‌تر و زیباتر شود با
 * رنگ‌بندی و تم درست؛ اگر آفتابی است پشت شیشه خورشید باشد، اگر بارانی است
 * پشت شیشه باران بیاید».
 *
 * The scene is a PICTURE OF A NUMBER THAT ALREADY EXISTS: it is drawn from the
 * tone the climate index produced (worldModel.buildClimate → sun · partly ·
 * cloud · rain · storm, and «na» when too few inputs were read). It reads no
 * data of its own and invents no weather:
 *
 *   · sun    — a golden sun with turning rays, a breathing halo and a glint;
 *   · partly — a smaller sun behind a drifting white cloud;
 *   · cloud  — three clouds drifting at parallax speeds;
 *   · rain   — slate clouds and slanted rain; drops run down the glass;
 *   · storm  — an indigo sky, heavy rain, a lightning bolt and a sky flash;
 *   · na     — a quiet dashed ring: no reading, so no weather.
 *
 * Every animation is transform/opacity only and stops under
 * prefers-reduced-motion (the rain then stands still as streaks). The frosted
 * pane in front of the scene (`.gw-glass`) is the console's one real
 * backdrop-filter — a fixed count of one on screen, never one per list item
 * (see index.css, «THE EXPENSIVE ONE»).
 */
import { CLOUD_D, useSvgId } from './icons.jsx';

export const SKY_TONES = Object.freeze(['sun', 'partly', 'cloud', 'rain', 'storm', 'windy', 'na']);

/* deterministic «random» spreads — no Math.random in render, so the scene is
   identical on every render and in every test */
const spread = (n, a, b) => Array.from({ length: n }, (_, i) => ((i * a + b) % 100) / 100);

const RAIN = (() => {
  const n = 40;
  const x = spread(n, 37, 11); const d = spread(n, 53, 7); const t = spread(n, 29, 3); const h = spread(n, 17, 5); const y = spread(n, 61, 23);
  return x.map((_, i) => ({ x: Math.round(x[i] * 1000) / 10, d: d[i], t: 0.6 + t[i] * 0.4, h: 14 + Math.round(h[i] * 18), y: Math.round(y[i] * 100) }));
})();

const DROPS = [
  { x: 10, y: 16, s: 9, t: 7.5, d: 0.4 }, { x: 30, y: 54, s: 6.5, t: 9, d: 2.6 }, { x: 52, y: 22, s: 10, t: 8.2, d: 4.1 },
  { x: 71, y: 60, s: 6.5, t: 10, d: 1.2 }, { x: 87, y: 28, s: 8, t: 8.8, d: 5.3 }, { x: 42, y: 80, s: 5.5, t: 0, d: 0 },
  { x: 19, y: 72, s: 5, t: 0, d: 0 }, { x: 63, y: 10, s: 4.5, t: 0, d: 0 }, { x: 93, y: 76, s: 6, t: 0, d: 0 },
  { x: 78, y: 44, s: 4, t: 0, d: 0 }, { x: 4, y: 46, s: 4.5, t: 0, d: 0 }
];

function Cloud({ cls }) {
  const id = useSvgId('sc');
  return (
    <span className={`gw-sky-cloud ${cls}`}>
      <svg viewBox="8 10 34 26" width="100%" height="100%" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="11" x2="0" y2="34">
            <stop offset="0%" style={{ stopColor: 'var(--cloud-a)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--cloud-b)' }} />
          </linearGradient>
          {/* a soft top-light, so the cloud has volume instead of a flat fill */}
          <radialGradient id={`${id}l`} gradientUnits="userSpaceOnUse" cx="22" cy="15" r="15">
            <stop offset="0%" style={{ stopColor: 'var(--cloud-lit)' }} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={CLOUD_D} fill={`url(#${id})`} stroke="var(--cloud-edge)" strokeWidth=".45" />
        <path d={CLOUD_D} fill={`url(#${id}l)`} />
      </svg>
    </span>
  );
}

function Sun({ small }) {
  const id = useSvgId('ss');
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <span className={`gw-sky-sun ${small ? 'small' : ''}`}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${id}h`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFE58A" stopOpacity=".75" />
            <stop offset="45%" stopColor="#FFC93D" stopOpacity=".28" />
            <stop offset="100%" stopColor="#FFB020" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFF3B0" stopOpacity="0" />
            <stop offset="100%" stopColor="#FFC83D" />
          </linearGradient>
          <radialGradient id={`${id}c`} cx="42%" cy="38%" r="62%">
            <stop offset="0%" stopColor="#FFFDF0" />
            <stop offset="38%" stopColor="#FFE071" />
            <stop offset="78%" stopColor="#FFB321" />
            <stop offset="100%" stopColor="#FF8A00" />
          </radialGradient>
        </defs>
        <circle className="gw-sky-halo" cx="50" cy="50" r="50" fill={`url(#${id}h)`} />
        <g className="gw-sky-rays">
          {rays.map((a) => (
            <path key={a} d="M50 4.5 52.6 24h-5.2Z" fill={`url(#${id}r)`} transform={`rotate(${a} 50 50)`} opacity={a % 60 ? 0.7 : 1} />
          ))}
        </g>
        <circle cx="50" cy="50" r="22" fill={`url(#${id}c)`} />
        <circle cx="50" cy="50" r="21.2" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth=".8" />
        <ellipse cx="43" cy="42" rx="7" ry="4.6" fill="rgba(255,255,255,.55)" transform="rotate(-28 43 42)" />
      </svg>
    </span>
  );
}

function Bolt() {
  const id = useSvgId('sb');
  return (
    <span className="gw-sky-bolt">
      <svg viewBox="0 0 24 48" width="100%" height="100%" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFEF0" />
            <stop offset="45%" stopColor="#FDE047" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <path d="M14.5 1 3 26h8l-4 21L21.5 18h-8.2L18 1Z" fill={`url(#${id})`} stroke="#FFF7C2" strokeWidth=".6" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Wind() {
  return (
    <span className="gw-sky-wind">
      <svg viewBox="0 0 120 60" width="100%" height="100%" fill="none" stroke="rgba(214,245,255,.75)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
        <path className="w1" d="M6 18h70a10 10 0 1 0-9.6-12.6" />
        <path className="w2" d="M14 32h88a10 10 0 1 1-9.6 12.6" />
        <path className="w3" d="M2 46h46a8 8 0 1 1-7.7 10" />
      </svg>
    </span>
  );
}

function Unread() {
  return (
    <span className="gw-sky-na">
      <svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" aria-hidden="true" focusable="false">
        <circle className="gw-sky-na-ring" cx="50" cy="50" r="30" stroke="rgba(203,213,225,.55)" strokeWidth="2" strokeDasharray="5 9" strokeLinecap="round" />
        <circle className="gw-sky-na-pulse" cx="50" cy="50" r="18" stroke="rgba(148,163,184,.5)" strokeWidth="1.4" />
        <circle cx="50" cy="50" r="3.2" fill="rgba(203,213,225,.75)" />
      </svg>
    </span>
  );
}

/**
 * The sky itself. Absolutely positioned: the parent supplies the frame
 * (`position: relative; overflow: hidden`) and puts its content on a
 * `.gw-glass` pane in front of it.
 */
export function WeatherScene({ tone = 'na', className = '' }) {
  const t = SKY_TONES.includes(tone) ? tone : 'na';
  const rainy = t === 'rain' || t === 'storm';
  const streaks = t === 'storm' ? RAIN : t === 'rain' ? RAIN.filter((_, i) => i % 4 !== 0) : [];
  return (
    <span className={`gw-sky sky-${t} ${className}`.trim()} aria-hidden="true">
      <span className="gw-sky-glow" />
      {t === 'sun' ? <><Sun /><span className="gw-sky-flare f1" /><span className="gw-sky-flare f2" /><span className="gw-sky-flare f3" /></> : null}
      {t === 'partly' ? <><Sun small /><Cloud cls="c1" /><Cloud cls="c3" /></> : null}
      {t === 'cloud' ? <><Cloud cls="c2" /><Cloud cls="c1" /><Cloud cls="c3" /></> : null}
      {rainy ? <><Cloud cls="c2" /><Cloud cls="c1" /></> : null}
      {t === 'storm' ? <><span className="gw-sky-flash" /><Bolt /></> : null}
      {rainy ? (
        <span className="gw-sky-rain">
          {streaks.map((r, i) => (
            <i key={i} style={{ '--x': `${r.x}%`, '--y': `${r.y}%`, '--h': `${r.h}px`, '--t': `${(t === 'storm' ? r.t * 0.8 : r.t).toFixed(2)}s`, '--d': `${(-r.d * r.t).toFixed(2)}s` }} />
          ))}
        </span>
      ) : null}
      {t === 'windy' ? <Wind /> : null}
      {t === 'na' ? <Unread /> : null}
    </span>
  );
}

/** Drops beading and running down the glass pane — rain and storm only. */
export function GlassDrops({ tone }) {
  if (tone !== 'rain' && tone !== 'storm') return null;
  return (
    <span className="gw-glass-drops" aria-hidden="true">
      {DROPS.map((d, i) => (
        <i key={i} className={d.t ? 'run' : 'bead'}
          style={{ '--x': `${d.x}%`, '--y': `${d.y}%`, '--s': `${d.s}px`, '--t': `${d.t || 6}s`, '--d': `${d.d}s` }} />
      ))}
    </span>
  );
}

export default WeatherScene;
