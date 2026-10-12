/**
 * FANCY QR — THE BOX MUST CONTAIN THE MEDALLION.
 * ---------------------------------------------------------------------------
 * The receive QR is shown inside <Sheet>, and `.sheet-body` is an
 * `overflow-y: auto` scroll container. A scroll container clips anything that
 * paints ABOVE its content box, and no amount of scrolling brings it back. So
 * a decorative medallion anchored to the stage but lifted by its own transform
 * is not «a bit tight» in that context — it renders sliced off, which is
 * exactly what was reported on the receive box:
 *
 *   «لوگو بالایی خیلی بالا قرار گرفته و رفته زیر صفحه، اندازه باکس اشتباهه»
 *
 * jsdom does not do layout, so the geometry is checked against the source of
 * truth — the shipped stylesheet — the same way this suite checks the other
 * things a headless browser cannot see. The invariants:
 *
 *   1. NOTHING OVERHANGS. The medallion's top edge (`top` − 38% of its height)
 *      must land at or below the stage's own top edge, so no ancestor can
 *      clip it. Same for the four corner brackets.
 *
 *   2. IT STILL SITS ON THE PLATE. The part dipping below the plate's top
 *      edge must stay inside the plate's 15px QUIET-ZONE padding — never over
 *      a module. A QR with a logo stamped over its data is a deposit to an
 *      address nobody controls; test/fancy-qr.test.jsx proves the decoding
 *      half of that contract, this file proves the painting half.
 *
 *   3. THE COMPACT (BITCOIN) LEG IS UNCHANGED. It hides the medallion and
 *      keeps its own tighter band; its brackets must fit inside THAT box.
 *
 * Nothing here asserts a look. It asserts that the box actually holds what is
 * drawn in it — the part that was wrong.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, '..', 'src', 'styles', 'fancy-qr.css'), 'utf8');

/**
 * The declarations of one rule, keyed by property. Comments are stripped
 * first, so a `top: 0` written inside prose can never satisfy an assertion,
 * and the selector is anchored at the start of a line so `.fqr-badge` never
 * resolves to `.fqr-compact .fqr-badge`.
 */
function rule(selector) {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = new RegExp(`^${selector.replace(/[.:()\s]/g, (ch) => (ch === ' ' ? ' ' : `\\${ch}`))} \\{`, 'm');
  const start = clean.search(pattern);
  assert.notEqual(start, -1, `rule ${selector} not found in fancy-qr.css`);
  const open = clean.indexOf('{', start);
  const body = clean.slice(open + 1, clean.indexOf('}', open));
  const out = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const px = (v, what) => {
  const n = Number.parseFloat(String(v));
  assert.ok(Number.isFinite(n), `expected a px value for ${what}, got ${JSON.stringify(v)}`);
  return n;
};

/** top / right / bottom / left of a `padding` shorthand (CSS 1-to-4 values). */
function padding(box) {
  const parts = String(box.padding).trim().split(/\s+/).map((v) => px(v, 'padding'));
  const [t, r = t, b = t, l = r] = parts;
  return { top: t, right: r, bottom: b, left: l };
}

/** The percentage in `translate(-50%, -38%)` that lifts the medallion. */
function liftFraction() {
  const { transform } = rule('.fqr-badge');
  const match = String(transform).match(/translate\(\s*[^,]+,\s*(-?[\d.]+)%\s*\)/);
  assert.ok(match, `no translateY percentage in .fqr-badge transform: ${transform}`);
  return Math.abs(Number.parseFloat(match[1])) / 100;
}

describe('fancy QR medallion geometry', () => {
  const stage = padding(rule('.fqr-stage'));
  const badge = rule('.fqr-badge');
  const plate = rule('.fqr-plate');

  const badgeTop = px(badge.top, '.fqr-badge top');
  const badgeSize = px(badge.height, '.fqr-badge height');
  const lift = badgeSize * liftFraction();
  const quietZone = px(plate.padding, '.fqr-plate padding');

  it('reserves the medallion overhang inside the stage box', () => {
    assert.ok(
      stage.top >= lift,
      `top padding ${stage.top}px must reserve at least the ${lift}px the medallion rises — otherwise a scroll container clips it`
    );
  });

  it('never paints above its own box', () => {
    const topEdge = badgeTop - lift;
    assert.ok(
      topEdge >= 0,
      `the medallion's top edge sits at ${topEdge}px relative to the stage; a scroll container clips that (reported as «رفته زیر صفحه»)`
    );
  });

  it('still sits on the plate and never covers a module', () => {
    const dip = badgeTop + (badgeSize - lift) - stage.top;
    assert.ok(dip > 0, 'the medallion must still overlap the plate top edge — that overlap is the look');
    assert.ok(
      dip <= quietZone,
      `the medallion dips ${dip}px into the plate but the quiet zone is only ${quietZone}px — it would cover QR modules`
    );
  });

  it('keeps every corner bracket inside its own box', () => {
    /* Each bracket carries its own offset: (1)+(2) lift above the plate,
       (3)+(4) drop below it. Checked for the full-size stage AND for the
       compact Bitcoin variant, which has its own tighter padding. */
    const variants = [
      { stage: stage, base: '.fqr-brackets i', up: ':nth-child(1)', down: ':nth-child(3)' },
      { stage: padding(rule('.fqr-compact')), base: '.fqr-compact .fqr-brackets i', up: ':nth-child(1)', down: ':nth-child(3)' }
    ];
    for (const v of variants) {
      const size = px(rule(v.base).height, `${v.base} height`);
      const up = rule(`${v.base}${v.up}`);
      const down = rule(`${v.base}${v.down}`);
      const upLift = Math.abs(px(up.top, `${v.base}${v.up} top`));
      const downDrop = size - Math.abs(px(down.bottom, `${v.base}${v.down} bottom`));
      assert.ok(
        v.stage.top >= upLift,
        `${v.base}${v.up} lifts ${upLift}px but its box only reserves ${v.stage.top}px above the plate`
      );
      assert.ok(
        v.stage.bottom >= downDrop + 1,
        `${v.base}${v.down} drops ${downDrop}px below the plate; its box only reserves ${v.stage.bottom}px`
      );
    }
  });

  it('leaves the compact (Bitcoin) QR without the medallion', () => {
    assert.equal(rule('.fqr-compact .fqr-badge').display, 'none');
  });
});
