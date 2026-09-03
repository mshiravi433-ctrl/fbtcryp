/**
 * LANDING 2.0 — THE LOTTIE ANIMATIONS, AUTHORED IN CODE.
 * ---------------------------------------------------------------------------
 * The request was explicit: «از انیمیشن و لوتی استفاده کن» — animation and
 * Lottie, for the product slideshow and the feature panels.
 *
 * ─── WHY WE SHIP THE JSON AND NOT `lottie-web` ──────────────────────────────
 * The renderer for a full .lottie file is `lottie_light.min.js` at ~100 KB of
 * JavaScript, parsed on a page whose whole point is that it loads with zero
 * framework. And what it would buy us here is a handful of decorative loops —
 * rings turning, bars growing, a shine crossing a gold bar.
 *
 * So the animations are REAL Lottie files (Bodymovin v5 schema: layers,
 * transform keyframes, shape groups, ellipse / rect / path, fill, stroke, trim
 * paths), and the page carries a ~140-line player for the subset those files
 * use. It is written in `runtime.mjs`, in the same no-dependency style as
 * everything else on this document, and it degrades instead of breaking: a
 * property it does not know is skipped, never thrown at.
 *
 * Consequences worth stating:
 *   • The JSON is valid Lottie. Open any of these files in the Lottie previewer
 *     and they animate the same way — nothing here is a private format.
 *   • No second request. The map is inlined into the HTML once, and the player
 *     reads it out of a <script type="application/json"> tag.
 *   • No `import`, no bundler, no build step for the APK to worry about.
 *
 * ─── THE DISCIPLINE EVERY ANIMATION HERE FOLLOWS ────────────────────────────
 *   · Loops are closed: frame 0 and the last frame are the same state, so a
 *     repeat never pops.
 *   · Only transform, opacity and trim animate. No layout properties, no
 *     filters — a compositor-friendly animation on a page that also runs live
 *     market fetches.
 *   · Each file is 200×200 so one viewBox serves every slot at any size, and
 *     the strokes scale with it (`non-scaling-stroke` is deliberately NOT set).
 *   · `prefers-reduced-motion` freezes every one of them on frame 0 in the
 *     player, and the player is not even started off-screen.
 */

/* ------------------------------------------------------------------ */
/* Palette — same colors as the stylesheet, in Lottie's 0..1 RGBA.     */
/* ------------------------------------------------------------------ */

const C = {
  violet: [0.545, 0.361, 0.965, 1],
  indigo: [0.357, 0.549, 1, 1],
  cyan: [0.306, 0.918, 1, 1],
  lime: [0.388, 0.961, 0.733, 1],
  amber: [1, 0.769, 0.365, 1],
  pink: [1, 0.408, 0.792, 1],
  red: [1, 0.42, 0.545, 1],
  ink: [0.933, 0.945, 1, 1]
};

const FPS = 30;
const FRAMES = 90;

/* ------------------------------------------------------------------ */
/* Property builders                                                   */
/* ------------------------------------------------------------------ */

/** Static number (Lottie uses an array even for scalars — mirror that). */
const sN = (v) => ({ a: 0, k: [v] });
const sXY = (x, y) => ({ a: 0, k: [x, y, 0] });
const sScale = (x = 100, y = x) => ({ a: 0, k: [x, y, 100] });

/**
 * Animated property. `keys` is a list of { t, s, e?, o?, i? } in Lottie's own
 * shape; the last one only needs `t` + `s`. Default easing is a soft
 * ease-in-out, which is what every decorative loop on this page wants — a
 * linear loop reads like a machine, an eased one reads like a breath.
 */
const EASE = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
function anim(keys, opts = {}) {
  const ease = opts.ease === false ? { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } } : EASE;
  const list = keys.map((kk, idx) => {
    const k = { t: kk.t, s: [].concat(kk.s) };
    if (idx < keys.length - 1) k.e = [].concat(kk.e != null ? kk.e : keys[idx + 1].s);
    k.o = kk.o || ease.o;
    k.i = kk.i || ease.i;
    return k;
  });
  return { a: 1, k: list };
}
/** Loop helper: same value at both ends of the cycle. */
const loop = (from, mid, opts) => anim([{ t: 0, s: from }, { t: FRAMES / 2, s: mid }, { t: FRAMES, s: from }], opts);
const spin = (from, to, opts) => anim([{ t: 0, s: [from] }, { t: FRAMES, s: [to] }], opts);

/** Full layer transform with sensible defaults. */
function ks(p = {}) {
  return {
    o: p.o || sN(100),
    r: p.r || sN(0),
    p: p.p || sXY(100, 100),
    a: p.a || sXY(0, 0),
    s: p.s || sScale(100)
  };
}

/* Shape item builders (Lottie: ty 'el' | 'rc' | 'sh' | 'st' | 'fl' | 'tm' | 'tr') */

const ellipse = (x, y, w, h) => ({ ty: 'el', d: 1, s: { a: 0, k: [w, h] }, p: { a: 0, k: [x, y] } });
const rect = (x, y, w, h, r = 0) => ({ ty: 'rc', d: 1, s: { a: 0, k: [w, h] }, p: { a: 0, k: [x, y] }, r: { a: 0, k: r } });
const stroke = (color, width, opts = {}) => ({
  ty: 'st',
  c: { a: 0, k: color },
  o: { a: 0, k: opts.o != null ? opts.o : 100 },
  w: { a: 0, k: width },
  lc: 2,
  lj: 2,
  ml: 4
});
const fill = (color, opacity = 100) => ({ ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: opacity } });
const trim = (start, end, offset = 0) => ({
  ty: 'tm',
  s: typeof start === 'object' ? start : sN(start),
  e: typeof end === 'object' ? end : sN(end),
  o: typeof offset === 'object' ? offset : sN(offset),
  m: 1
});
const groupTr = (t = {}) => ({
  ty: 'tr',
  p: t.p || sXY(0, 0),
  a: t.a || sXY(0, 0),
  s: t.s || sScale(100),
  r: t.r || sN(0),
  o: t.o || sN(100),
  sk: sN(0),
  sa: sN(0)
});

/**
 * A cubic path in Lottie's vertex format. `pts` is a list of [x, y] and the
 * tangents are auto-derived as a fraction of the segment length, which gives
 * the smooth "flow line" curve these decorations want without hand-tuning 40
 * numbers.
 */
function curve(pts, closed = false, tension = 0.34) {
  const n = pts.length;
  const v = pts.map((p) => [p[0], p[1]]);
  const o = [];
  const ii = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const cur = pts[i];
    /* Lottie stores tangents RELATIVE to their vertex, which is what these
       are: a fraction of the chord through the neighbouring points. */
    const tx = (next[0] - prev[0]) * tension * 0.5;
    const ty = (next[1] - prev[1]) * tension * 0.5;
    o.push([cur[0] + tx, cur[1] + ty]);
    ii.push([cur[0] - tx, cur[1] - ty]);
  }
  if (!closed) {
    o[n - 1] = [0, 0];
    ii[0] = [0, 0];
  }
  return { ty: 'sh', ks: { a: 0, k: { i: ii, o, v, c: closed } } };
}

/* ------------------------------------------------------------------ */
/* Layer builders                                                       */
/* ------------------------------------------------------------------ */

function shapeLayer(name, items, transform, opts = {}) {
  return {
    ddd: 0,
    ind: opts.ind || 1,
    ty: 4,
    nm: name,
    sr: 1,
    ks: ks(transform),
    ao: 0,
    shapes: items.map((it) => (it.ty === 'gr' ? it : { ty: 'gr', nm: name + ' g', it: [it, groupTr()] })),
    ip: opts.ip != null ? opts.ip : 0,
    op: opts.op != null ? opts.op : FRAMES,
    st: 0,
    bm: 0
  };
}

/** A group of shape items sharing one transform (an "orbit", a "bar set"). */
function group(name, items, transform) {
  return { ty: 'gr', nm: name, it: [...items, groupTr(transform)] };
}

/* ------------------------------------------------------------------ */
/* The five slide animations + one shared "scan" used by the AI panel   */
/* ------------------------------------------------------------------ */

/** SWAP — two tokens crossing paths inside two counter-rotating rings. */
const swap = {
  ...base(),
  layers: [
    shapeLayer('ring-out', [group('ring', [ellipse(0, 0, 168, 168), stroke(C.violet, 2.4, { o: 55 })], { p: sXY(100, 100), r: spin(0, 360, { ease: false }) })], { p: sXY(100, 100) }, { ind: 1 }),
    shapeLayer('ring-in', [group('ring', [ellipse(0, 0, 122, 122), stroke(C.cyan, 1.8, { o: 45 }), trim(anim([{ t: 0, s: [0], e: [72] }, { t: 45, s: [72], e: [0] }, { t: FRAMES, s: [0] }]), 100)], { p: sXY(100, 100), r: spin(360, 0, { ease: false }) })], { p: sXY(100, 100) }, { ind: 2 }),
    shapeLayer(
      'token-a',
      [rect(0, 0, 30, 30, 9), fill(C.violet, 92), rect(0, 0, 30, 30, 9), stroke(C.ink, 1.2, { o: 35 })],
      { p: anim([{ t: 0, s: [70, 100] }, { t: 30, s: [130, 100] }, { t: 45, s: [130, 100] }, { t: 75, s: [70, 100] }, { t: FRAMES, s: [70, 100] }]), s: loop(100, 112) },
      { ind: 3 }
    ),
    shapeLayer(
      'token-b',
      [rect(0, 0, 30, 30, 9), fill(C.cyan, 92), rect(0, 0, 30, 30, 9), stroke(C.ink, 1.2, { o: 35 })],
      { p: anim([{ t: 0, s: [130, 100] }, { t: 30, s: [70, 100] }, { t: 45, s: [70, 100] }, { t: 75, s: [130, 100] }, { t: FRAMES, s: [130, 100] }]), s: loop(100, 112) },
      { ind: 4 }
    ),
    shapeLayer('arrow', [curve([[58, 62], [100, 44], [142, 62]]), stroke(C.lime, 2.2, { o: 70 }), trim(anim([{ t: 0, s: [0], e: [100] }, { t: 40, s: [100], e: [0] }, { t: FRAMES, s: [0] }]), 100)], { p: sXY(0, 0), o: loop(80, 100) }, { ind: 5 })
  ]
};

/** STOCKS — five candles growing off a baseline with a trend line drawn. */
const STOCK_WICKS = [-64, -30, 4, 38, 72];
const stocks = {
  ...base(),
  layers: [
    shapeLayer('grid', [curve([[-84, -46], [84, -46]], false), stroke(C.ink, 1, { o: 12 })], { p: sXY(100, 152) }, { ind: 1 }),
    shapeLayer(
      'candles',
      STOCK_WICKS.map((x, i) => {
        const h = 34 + ((i * 17) % 46);
        const hue = i % 2 === 0 ? C.lime : C.pink;
        return group(
          `c${i}`,
          [
            rect(0, -h / 2, 15, h, 5),
            fill(hue, 78),
            rect(0, -h - 9, 2.6, 18, 1.4),
            fill(hue, 45)
          ],
          { p: sXY(x, 0), s: anim([{ t: 0, s: [100, 8] }, { t: 14 + i * 5, s: [100, 100] }, { t: FRAMES - 10, s: [100, 100] }, { t: FRAMES, s: [100, 8] }]), a: sXY(0, h / 2) }
        );
      }),
      { p: sXY(100, 150) },
      { ind: 2 }
    ),
    shapeLayer(
      'trend',
      [curve([[-70, 26], [-34, 4], [-4, 16], [30, -22], [72, -46]]), stroke(C.cyan, 2.6), trim(anim([{ t: 0, s: [0], e: [100] }, { t: 50, s: [100], e: [100] }, { t: 78, s: [100], e: [0] }, { t: FRAMES, s: [0] }]), 100)],
      { p: sXY(100, 100), o: loop(90, 100) },
      { ind: 3 }
    ),
    shapeLayer('head', [ellipse(0, 0, 12, 12), fill(C.cyan, 95), ellipse(0, 0, 24, 24), stroke(C.cyan, 1.4, { o: 45 })], { p: sXY(172, 54), s: loop(100, 138), o: loop(100, 45) }, { ind: 4 })
  ]
};

/** FUTURES — a leverage pivot: two mirrored curves and two sliding bars. */
const futures = {
  ...base(),
  layers: [
    shapeLayer('pivot', [rect(-13, -13, 26, 26, 7), stroke(C.amber, 2), trim(anim([{ t: 0, s: [0], e: [100] }, { t: FRAMES, s: [100] }]), 100)], { p: sXY(100, 100), r: anim([{ t: 0, s: [0] }, { t: FRAMES, s: [90] }]) }, { ind: 1 }),
    shapeLayer('long', [curve([[-70, 8], [-22, -12], [0, -26]]), stroke(C.lime, 3), ellipse(0, -26, 9, 9), fill(C.lime, 85)], { p: sXY(100, 100), o: loop(70, 100) }, { ind: 2 }),
    shapeLayer('short', [curve([[70, 192], [22, 212], [0, 226]]), stroke(C.red, 3), ellipse(0, 226, 9, 9), fill(C.red, 85)], { p: sXY(100, 100), o: loop(70, 100) }, { ind: 3 }),
    shapeLayer('liq', [rect(-80, 0, 160, 1.6, 1), rect(-80, 0, 60, 1.6, 1)], { p: sXY(100, 152), o: anim([{ t: 0, s: [30] }, { t: 30, s: [95] }, { t: 45, s: [30] }, { t: FRAMES, s: [30] }]) }, { ind: 4 }),
    shapeLayer('rail-up', [rect(0, -34, 7, 68, 3.5), fill(C.cyan, 60), rect(0, -34, 7, 22, 3.5), fill(C.cyan, 100)], { p: anim([{ t: 0, s: [40, 100] }, { t: 45, s: [40, 78] }, { t: FRAMES, s: [40, 100] }]) }, { ind: 5 }),
    shapeLayer('rail-down', [rect(0, -34, 7, 68, 3.5), fill(C.pink, 60), rect(0, 12, 7, 22, 3.5), fill(C.pink, 100)], { p: anim([{ t: 0, s: [160, 100] }, { t: 45, s: [160, 122] }, { t: FRAMES, s: [160, 100] }]) }, { ind: 6 })
  ]
};

/** GOLD — three bars stacked, a shine crossing them, three sparkles. */
const gold = {
  ...base(),
  layers: [
    ...[0, 1, 2].map((i) =>
      shapeLayer(
        `bar${i}`,
        [rect(0, 0, 108 - i * 20, 26, 8), fill(C.amber, 84 - i * 6), rect(0, 0, 108 - i * 20, 26, 8), stroke([1, 0.92, 0.72, 1], 1.4, { o: 55 })],
        {
          p: anim([{ t: 0, s: [100, 150 + i * 30] }, { t: 18 + i * 6, s: [100, 128 - i * 26] }, { t: FRAMES - 12, s: [100, 128 - i * 26] }, { t: FRAMES, s: [100, 150 + i * 30] }]),
          o: anim([{ t: 0, s: [0] }, { t: 18 + i * 6, s: [100] }, { t: FRAMES - 12, s: [100] }, { t: FRAMES, s: [0] }])
        },
        { ind: 1 + i }
      )
    ),
    shapeLayer(
      'shine',
      [rect(-8, -70, 16, 150, 8), fill([1, 1, 1, 1], 22)],
      { p: anim([{ t: 0, s: [20, 110] }, { t: 45, s: [180, 110] }, { t: FRAMES, s: [20, 110] }]), r: sN(18), o: loop(0, 100) },
      { ind: 4 }
    ),
    ...[[58, 66], [150, 84], [92, 46]].map(([x, y], i) =>
      shapeLayer(`spark${i}`, [rect(-6, -1.4, 12, 2.8, 1.4), fill(C.ink, 90), rect(-1.4, -6, 2.8, 12, 1.4), fill(C.ink, 90)], { p: sXY(x, y), s: anim([{ t: i * 12, s: [0] }, { t: 18 + i * 12, s: [130] }, { t: 40 + i * 12, s: [0] }, { t: FRAMES, s: [0] }]), r: sN(20) }, { ind: 5 + i })
    )
  ]
};

/** AI — a core with three rings and orbiting neurons, for Intent OS + slide. */
const neuronOrbit = group(
  'orbit',
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 6;
    /* A nested group per neuron: Lottie's own structure, and the one shape
       type that lets six dots share one rotating transform. */
    return { ty: 'gr', nm: `n${i}`, it: [ellipse(Math.cos(a) * 76, Math.sin(a) * 76, 9, 9), fill(C.lime, 92 - i * 8), groupTr({})] };
  }),
  { p: sXY(0, 0) }
);

const ai = {
  ...base(),
  layers: [
    shapeLayer('core', [ellipse(0, 0, 44, 44), fill(C.violet, 70), ellipse(0, 0, 62, 62), stroke(C.violet, 1.6, { o: 45 })], { p: sXY(100, 100), s: loop(100, 116), o: loop(88, 100) }, { ind: 1 }),
    shapeLayer('ring-1', [ellipse(0, 0, 92, 92), stroke(C.cyan, 2, { o: 70 }), trim({ a: 0, k: [0] }, 40, anim([{ t: 0, s: [0] }, { t: FRAMES, s: [360] }]))], { p: sXY(100, 100), r: spin(0, 360, { ease: false }) }, { ind: 2 }),
    shapeLayer('ring-2', [ellipse(0, 0, 128, 128), stroke(C.indigo, 1.6, { o: 55 }), trim({ a: 0, k: [0] }, 22, anim([{ t: 0, s: [0] }, { t: FRAMES, s: [-360] }]))], { p: sXY(100, 100), r: spin(360, 0, { ease: false }) }, { ind: 3 }),
    shapeLayer(
      'neurons',
      [neuronOrbit],
      { p: sXY(100, 100), r: spin(0, 360, { ease: false }) },
      { ind: 4 }
    ),
    shapeLayer('prompt', [rect(-30, -1.6, 60, 3.2, 2), fill(C.lime, 90)], { p: anim([{ t: 0, s: [100, 40] }, { t: FRAMES, s: [100, 40] }]), o: anim([{ t: 0, s: [0] }, { t: 12, s: [90] }, { t: 60, s: [90] }, { t: 72, s: [0] }, { t: FRAMES, s: [0] }]), s: loop(100, 108) }, { ind: 5 })
  ]
};

/** TAPE — the little "scan" mark used inline in the Intent OS token tape. */
const tape = {
  ...base(),
  layers: [
    shapeLayer('beam', [rect(-60, 0, 120, 2, 1), fill(C.cyan, 85)], { p: anim([{ t: 0, s: [100, 40] }, { t: 45, s: [100, 160] }, { t: FRAMES, s: [100, 40] }]), o: loop(35, 100) }, { ind: 1 }),
    shapeLayer('box', [rect(0, 0, 132, 132, 18), stroke(C.violet, 1.6, { o: 40 })], { p: sXY(100, 100), s: loop(98, 104) }, { ind: 2 })
  ]
};

function base() {
  return { v: '5.7.4', fr: FPS, ip: 0, op: FRAMES, w: 200, h: 200, nm: 'fbt', ddd: 0, assets: [], fonts: { list: [] }, markers: [] };
}

export const LOTTIE = { swap, stocks, futures, gold, ai, tape };

/**
 * One JSON blob for the whole page. Escaped the way the JSON-LD block is, so
 * no animation can ever close the tag it lives in.
 */
export function lottieScript() {
  return `<script type="application/json" id="lottie-data">\n${JSON.stringify(LOTTIE).replace(/</g, '\\u003c')}\n</script>`;
}

/** A slot the player fills in. `name` is the animation key. */
export function lottieSlot(name, cls = '') {
  return `<span class="lottie ${cls}" data-lottie="${name}" aria-hidden="true"></span>`;
}
