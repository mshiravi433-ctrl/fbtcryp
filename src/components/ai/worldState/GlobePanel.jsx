/**
 * PANEL 2 — THE GLOBE: a real 3-D dot globe that turns slowly and can be spun.
 * ---------------------------------------------------------------------------
 * REPORTED: «کره زمین به صورت سه بعدی و قابل حرکت آرام و اینکه داده‌های همه
 * کشورها باشد — در صورت امکان فقط چند کشور هست و ناقص».
 *
 * What changed:
 *   · it is a genuine 3-D render — every land cell of a baked 2° land mask is
 *     projected through a yaw/pitch rotation matrix on a canvas, so the sphere
 *     can be DRAGGED (with inertia, pitch limits) and turns slowly by itself
 *     when idle (stopped under prefers-reduced-motion);
 *   · the board carries every economy with a defined mechanism (46 of them —
 *     the original twelve plus the wider world), each linked only to
 *     instruments this app really reads, with the link kind printed
 *     (direct · proxy · reference) and the mechanism named;
 *   · the accessible country rail below the canvas is the tap surface (the
 *     canvas itself is also hit-tested), so the globe works with a keyboard
 *     and a screen reader too.
 *
 * The land mask is baked at build time (scripts/gen-globe-landmask.mjs) — no
 * tiles, no GeoJSON and no network read at runtime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildGlobeModel, COUNTRIES } from './worldModel.js';
import { landCells } from './landMask.js';
import { WIcon, DirMark } from './icons.jsx';
import { faNum, pct } from './format.jsx';

const DEG = Math.PI / 180;
const SPEED = 0.042;           // rad/s — a full turn in ~2.5 minutes («آرام»)
const TILT0 = -0.32;           // initial pitch (looking slightly down)
const MIN_PITCH = -1.05;
const MAX_PITCH = 1.05;

/** lat/lon → unit vector (x right, y up, z toward the viewer). */
function vec(lat, lon) {
  const la = lat * DEG; const lo = lon * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/* the land matrix is projected every frame — build the vectors once */
let LAND_VECTORS = null;
function landVectors() {
  if (!LAND_VECTORS) LAND_VECTORS = landCells().map(([lat, lon]) => vec(lat, lon));
  return LAND_VECTORS;
}

const MOOD_COLOR = { up: '#00ff9d', down: '#ff3b6b', flat: '#38bdf8', unread: '#5b647f' };

export function GlobePanel({ world, L, isPersian }) {
  const [sel, setSel] = useState('us');
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const stateRef = useRef({ yaw: -1.9, pitch: TILT0, vy: 0, size: 320, markers: [], dragging: false, last: null, moved: 0 });

  const model = useMemo(() => buildGlobeModel(world, { isPersian }), [world, isPersian]);
  const snap = model.byId.get(sel) || model.byId.get('us');
  const countryVectors = useMemo(() => COUNTRIES.map((c) => ({ c, v: vec(c.lat, c.lon) })), []);
  const arcs = useMemo(() => model.arcs.map((a) => {
    const from = COUNTRIES.find((c) => c.id === a.from);
    const to = COUNTRIES.find((c) => c.id === a.to);
    return { ...a, from, to };
  }).filter((a) => a.from && a.to), [model.arcs]);

  const reducedMotion = useMemo(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false
  ), []);

  /* ── the render loop ─────────────────────────────────────────────────── */
  const draw = useCallback((dt) => {
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return; // jsdom / no-canvas environments: the DOM rail below still works

    const size = st.size || 320;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    /* auto-rotation (slow) + inertia after a drag */
    if (!st.dragging) {
      if (Math.abs(st.vy) > 0.0005) {
        st.yaw += st.vy * dt * 60;
        st.vy *= 0.94;
      } else if (!reducedMotion) {
        st.yaw += SPEED * dt;
      }
    }

    const cx = size / 2; const cy = size / 2; const R = size * 0.42;
    const cosY = Math.cos(st.yaw); const sinY = Math.sin(st.yaw);
    const cosP = Math.cos(st.pitch); const sinP = Math.sin(st.pitch);
    const project = (v) => {
      const x1 = v[0] * cosY + v[2] * sinY;
      const z1 = -v[0] * sinY + v[2] * cosY;
      const y2 = v[1] * cosP - z1 * sinP;
      const z2 = v[1] * sinP + z1 * cosP;
      return [cx + x1 * R, cy - y2 * R, z2];
    };

    /* the sphere */
    const sphere = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    sphere.addColorStop(0, 'rgba(56,189,248,0.28)');
    sphere.addColorStop(0.55, 'rgba(30,64,175,0.16)');
    sphere.addColorStop(1, 'rgba(2,6,23,0.55)');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = sphere;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(125,211,252,0.35)';
    ctx.stroke();

    /* the land dot matrix — three brightness bins, one path each */
    const vecs = landVectors();
    const bins = [[], [], []];
    for (let i = 0; i < vecs.length; i += 1) {
      const p = project(vecs[i]);
      if (p[2] <= 0.06) continue;
      const depth = p[2];
      bins[depth > 0.72 ? 2 : depth > 0.38 ? 1 : 0].push(p);
    }
    const dot = Math.max(1.1, size / 210);
    const styles = ['rgba(125,211,252,0.16)', 'rgba(125,211,252,0.34)', 'rgba(186,230,253,0.72)'];
    bins.forEach((bin, bi) => {
      if (!bin.length) return;
      ctx.beginPath();
      for (const p of bin) ctx.rect(p[0] - dot / 2, p[1] - dot / 2, dot, dot);
      ctx.fillStyle = styles[bi];
      ctx.fill();
    });

    /* graticule: the equator + two tropics, faded behind */
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(148,197,255,0.16)';
    for (const lat of [0, 23.4, -23.4, 60, -60]) {
      ctx.beginPath();
      let started = false;
      for (let lon = -180; lon <= 180; lon += 4) {
        const p = project(vec(lat, lon));
        if (p[2] <= 0.06) { started = false; continue; }
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    /* trade/finance arcs between read hubs */
    for (const a of arcs) {
      if (!a.lit) continue;
      const A = vec(a.from.lat, a.from.lon); const B = vec(a.to.lat, a.to.lon);
      ctx.beginPath();
      let started = false;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const m = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
        const norm = Math.hypot(m[0], m[1], m[2]) || 1;
        const lift = 1 + 0.16 * Math.sin(Math.PI * t) * a.strength;
        const p = project([(m[0] / norm) * lift, (m[1] / norm) * lift, (m[2] / norm) * lift]);
        if (p[2] <= 0) { started = false; continue; }
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.stroke();
    }

    /* country markers + hit map */
    const markers = [];
    for (const { c, v } of countryVectors) {
      const s = model.byId.get(c.id);
      const p = project(v);
      const front = p[2] > 0.02;
      markers.push({ id: c.id, x: p[0], y: p[1], front, status: s?.status });
      if (!front) continue;
      const active = sel === c.id;
      const color = s?.status === 'unread' ? MOOD_COLOR.unread : MOOD_COLOR[s?.mood] || MOOD_COLOR.flat;
      const alpha = 0.45 + 0.55 * p[2];
      if (active) {
        ctx.beginPath();
        const beat = typeof performance !== 'undefined' && performance.now ? performance.now() / 320 : 0;
        ctx.arc(p[0], p[1], 9 + Math.sin(beat) * 1.6, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(p[0], p[1], active ? 5.4 : 3.4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (active) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], active ? 2.2 : 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
        /* the label of the selected country */
        const label = isPersian ? c.fa : c.en;
        ctx.font = `800 ${Math.max(10, size / 30)}px Vazirmatn, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(6,10,24,0.82)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(p[0] - w / 2, p[1] - 26, w, 17, 9) : ctx.rect(p[0] - w / 2, p[1] - 26, w, 17);
        ctx.fill();
        ctx.fillStyle = '#eaf2ff';
        ctx.fillText(label, p[0], p[1] - 11);
      }
    }
    stateRef.current.markers = markers;
  }, [arcs, countryVectors, isPersian, model.byId, reducedMotion, sel]);

  /* size + loop */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const measure = () => {
      const w = (wrap && wrap.clientWidth) || 320;
      const st = stateRef.current;
      st.size = Math.max(240, Math.min(380, w));
      if (canvas) { canvas.style.height = `${st.size}px`; }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    let raf = 0; let last = 0;
    const tick = (t) => {
      const st = stateRef.current;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      last = t;
      draw(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  /* ── pointer interaction: drag to spin, tap to select ───────────────── */
  const onPointerDown = (e) => {
    const st = stateRef.current;
    st.dragging = true;
    st.moved = 0;
    st.last = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const st = stateRef.current;
    if (!st.dragging || !st.last) return;
    const dx = e.clientX - st.last.x; const dy = e.clientY - st.last.y;
    st.moved += Math.abs(dx) + Math.abs(dy);
    st.yaw = st.last.yaw + dx * 0.007;
    st.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, st.last.pitch - dy * 0.006));
    st.vy = dx * 0.007 * 0.5;
  };
  const onPointerUp = (e) => {
    const st = stateRef.current;
    const wasTap = st.moved < 6;
    st.dragging = false;
    st.last = null;
    setDragging(false);
    if (!wasTap) return;
    /* hit-test the markers we drew this frame */
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getBoundingClientRect) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    let best = null;
    for (const m of st.markers) {
      if (!m.front) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < 18 && (!best || d < best.d)) best = { id: m.id, d };
    }
    if (best) setSel(best.id);
  };

  const coverage = model.coverage;

  return (
    <div className="aigw-panel acc-globe">
      <div ref={wrapRef} className="aigw-globe-wrap" style={{ maxWidth: 380 }}>
        <canvas
          ref={canvasRef}
          className={`aigw-globe ${dragging ? 'dragging' : ''}`}
          style={{ height: 320 }}
          role="img"
          aria-label={L('کرهٔ اقتصاد جهانی سه‌بعدی', '3-D global economy globe')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {/* a decorative orbit layer over the canvas (no pointer capture) */}
        <svg className="aigw-globe-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g className="aigw-orbit-a" fill="none" stroke="rgba(125,211,252,0.35)" strokeWidth="0.25" strokeDasharray="2 6">
            <ellipse cx="50" cy="50" rx="47" ry="17" />
          </g>
          <g className="aigw-orbit-b" fill="none" stroke="rgba(129,140,248,0.32)" strokeWidth="0.22" strokeDasharray="1.4 7">
            <ellipse cx="50" cy="50" rx="17" ry="47" />
          </g>
        </svg>

        <div className="aigw-globe-hud">
          <span className="aigw-pill info">
            {isPersian
              ? `${faNum(coverage.read)} کشور با خوانش · ${faNum(coverage.partial)} ناقص · ${faNum(coverage.total)} در تخته`
              : `${coverage.read} read · ${coverage.partial} partial · ${coverage.total} on board`}
          </span>
          <span className="aigw-pill ghost">
            <WIcon name="globe" size={11} />
            {L('بکش تا بچرخد', 'drag to spin')}
          </span>
        </div>
      </div>

      <div className="aigw-globe-legend">
        {[
          ['up', L('برآیند صعودی', 'net positive')],
          ['down', L('برآیند نزولی', 'net negative')],
          ['flat', L('خنثی', 'neutral')],
          ['unread', L('خوانده نشد', 'unread')]
        ].map(([k, label]) => (
          <span key={k} className="aigw-hint">
            <span className="aigw-dot" style={{ background: MOOD_COLOR[k] }} />
            {label}
          </span>
        ))}
      </div>

      {/* the accessible tap rail — also the keyboard path to any economy */}
      <div className="aigw-chips" style={{ marginTop: 10 }} role="tablist" aria-label={L('اقتصادها', 'Economies')}>
        {COUNTRIES.map((c) => {
          const s = model.byId.get(c.id);
          const dotColor = s?.status === 'unread' ? MOOD_COLOR.unread : MOOD_COLOR[s?.mood] || MOOD_COLOR.flat;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={sel === c.id}
              aria-label={c.en}
              className={`aigw-chip aigw-globe-dot ${sel === c.id ? 'active' : ''}`}
              onClick={() => setSel(c.id)}
            >
              <span className="aigw-dot" style={{ background: dotColor }} />
              {isPersian ? c.fa : c.en}
            </button>
          );
        })}
      </div>

      {/* the snapshot card */}
      {snap ? (
        <div className="aigw-country-card" key={snap.country.id}>
          <div className="aigw-country-head">
            <span className="aigw-country-name">
              <WIcon name="globe" size={16} style={{ color: 'var(--acc1)' }} />
              {isPersian ? snap.country.fa : snap.country.en}
              <span className="aigw-ltr" style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 700 }}>
                {snap.country.lat.toFixed(1)}°, {snap.country.lon.toFixed(1)}°
              </span>
            </span>
            {snap.status === 'unread'
              ? <span className="aigw-pill ghost">{L('خوانده نشد', 'unread')}</span>
              : (
                <span className={`aigw-pill ${snap.mood === 'up' ? 'up' : snap.mood === 'down' ? 'down' : 'flat'}`}>
                  <DirMark dir={snap.mood} size={9} />
                  {snap.net !== null ? pct(snap.net, isPersian) : L('خوانده شد', 'read')}
                </span>
              )}
          </div>

          <div className="aigw-country-sum">{isPersian ? snap.summaryFa : snap.summaryEn}</div>

          {snap.rows.length ? snap.rows.map((r, i) => (
            <div key={`${r.sym}-${i}`} className="aigw-country-row">
              <div style={{ minWidth: 0 }}>
                <div className="aigw-country-sym">
                  <span className="aigw-ltr">{r.sym}</span>
                  {r.name ? <span style={{ color: 'var(--text-2)', fontWeight: 650, fontSize: 10 }}>{r.name}</span> : null}
                  <span className={`aigw-pill ${r.kind === 'proxy' ? 'warn' : r.kind === 'reference' ? 'flat' : 'info'}`} style={{ fontSize: 9, padding: '1px 6px' }}>
                    {r.kind === 'proxy' ? L('پروکسی', 'proxy') : r.kind === 'reference' ? L('نرخ مرجع', 'reference') : L('مستقیم', 'direct')}
                  </span>
                </div>
                <div className="aigw-country-sub">
                  {r.source ? `${L('منبع', 'source')}: ${r.source}` : ''}
                  {r.note ? `${r.source ? ' · ' : ''}${r.note}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                {r.change !== null ? (
                  <span className="aigw-country-bar" aria-hidden="true">
                    <i className={r.dir === 'down' ? 'down' : 'up'} style={{ width: `${Math.min(48, Math.abs(r.change) * 16)}%` }} />
                  </span>
                ) : null}
                <span className="aigw-country-val aigw-ltr">
                  {r.change !== null ? pct(r.change, isPersian) : (r.value || '—')}
                </span>
              </div>
            </div>
          )) : (
            <div className="aig-empty">{L('در این دور خوانشی برای این کشور ثبت نشد.', 'No reading was recorded for this country in this pass.')}</div>
          )}

          <div className="aigw-note" style={{ marginTop: 8 }}>
            {isPersian ? snap.country.mechFa : snap.country.mechEn}
          </div>
        </div>
      ) : null}

      <div className="aigw-note">
        {L(
          'هر کشور فقط به سازوکارهایی وصل است که این اپ واقعاً می‌خواند (شاخص دلار، بازده‌ها، کالاها، برابری ارزها، نرخ مرجع ریال)؛ نوع هر پیوند — مستقیم، پروکسی یا نرخ مرجع — روی همان ردیف نوشته شده و هرچه خوانده نشد «خوانده نشد» می‌ماند. ماتریس نقطه‌ها کل خشکی‌های زمین است (از Natural Earth، بدون تایل و بدون درخواست شبکه) و کره آرام می‌چرخد؛ ریل بالا اقتصادهای پوشش‌داده‌شدهٔ همین دور را نشان می‌دهد.',
          'Each country links only to mechanisms this app actually reads (dollar index, yields, commodities, FX parities, the rial reference); every link is labelled direct, proxy or reference on its row, and whatever was not read stays explicitly unread. The dot matrix is the whole planet\u2019s land (baked from Natural Earth, no tiles and no fetch) and the sphere turns slowly — the rail above lists the covered economies of this pass.'
        )}
      </div>
    </div>
  );
}

export default GlobePanel;
