/* SCENE 01 · 00:00–00:45 · THE COMPLEXITY OF FINANCE
   Black. A single point of light. Then the whole financial world, flowing.
   Camera: 50mm (27° vertical) at first, shallow, then widening to 24mm (53°)
   as the environment becomes enormous. No logo, no text until 00:25. */
import { TAU, clamp, lerp, inv, smooth, kf, rng, sprite, drawSprite, addBlend, camera, project, text, orb, dustField } from '../lib/fx.js';
import { dataField, ribbons, marketRing, worldGrid } from '../lib/kit.js';

const S = 2; // stage px → canvas px

export default {
  id: 'sc01',
  title: 'The Complexity of Finance',
  t0: 0, t1: 45,

  build(env) {
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    const cap = document.createElement('div');
    cap.style.cssText = 'position:absolute;left:0;right:0;bottom:190px;text-align:center;opacity:0;transform:translateY(24px)';
    cap.innerHTML = `<div class="display md" style="letter-spacing:-.03em;color:#fff;text-shadow:0 0 60px rgba(80,150,255,.45)">THE FINANCIAL WORLD NEVER STOPS.</div>
      <div class="kicker" style="margin-top:22px;color:#5d6c8c">MARKETS · LIQUIDITY · WALLETS · OPPORTUNITY</div>`;
    root.appendChild(cap);
    env.scenesEl.appendChild(root);
    this.cap = cap;
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(S, 0, 0, S, 0, 0);
    back.clearRect(0, 0, 1920, 1080);
    front.setTransform(S, 0, 0, S, 0, 0);
    front.clearRect(0, 0, 1920, 1080);

    // ── the camera path: slow dolly forward, then a wide orbit ──────────
    const pz = kf(t, [[0, -420], [3, -180], [8, 60], [14, 420], [22, 1150], [30, 2050], [38, 2600], [45, 3450]]);
    const yaw = kf(t, [[2, 0], [14, 0.12], [24, 0.46], [34, 0.92], [45, 1.34]]);
    const pitch = kf(t, [[4, 0.00], [20, -0.03], [32, 0.015], [45, 0.05]]);
    const fov = kf(t, [[0, 27], [8, 29], [18, 42], [28, 52], [38, 56], [45, 52]]);
    const cam = camera({ px: Math.sin(t * 0.045) * 120, py: 40 + Math.sin(t * 0.03) * 30, pz, yaw, pitch, fov });

    const born = clamp(t / 2);
    const world = clamp(inv(t, 1.2, 4.2));

    // ── the whole environment ───────────────────────────────────────────
    worldGrid(back, camera({ ...cam }), t, { alpha: 0.05 * world, y: -520 });
    dataField(back, cam, t, { count: 2900, spread: 1400 + 1000 * world, depth: 4200, color: 'rgba(126,182,255,1)' });
    ribbons(back, cam, t, { count: 18, span: 2400, alpha: 0.34 * world });

    // market ring grows out of the field around 00:20 — "the environment
    // gradually becomes enormous"
    const ringK = smooth(inv(t, 16, 27));
    if (ringK > 0.01) {
      back.save();
      back.globalAlpha = ringK;
      marketRing(back, cam, t, { radius: 1080 + 260 * ringK, radiusY: 300, alpha: ringK });
      back.restore();
    }

    dustField(back, cam, t, { count: 200, seed: 7, spread: 1500, focus: 1400, color: 'rgba(150,200,255,1)' });

    // ── the first point of light ────────────────────────────────────────
    if (t < 24) {
      const k = smooth(inv(t, 1.4, 3.2));
      const p = project(cam, { x: 0, y: 0, z: 760 });
      if (p) {
        addBlend(back, true);
        drawSprite(back, sprite('rgba(200,230,255,1)', 0.42), p.x, p.y, 14 + 320 * k, 1.0 * k * (1 - clamp(inv(t, 20, 24))));
        addBlend(back, false);
      }
      if (t < 4.4) {
        front.save();
        front.fillStyle = `rgba(2,4,8,${(1 - k) * 0.96})`;
        front.fillRect(0, 0, 1920, 1080);
        front.restore();
      }
    }

    // ── 00:40 — the camera flies into one data point ────────────────────
    if (t > 39.5) {
      const k = smooth(inv(t, 39.8, 44.4));
      const p = project(cam, { x: 40, y: -20, z: Math.max(cam.pz + 40, 900 + 900 * (1 - k)) });
      if (p) {
        addBlend(front, true);
        drawSprite(front, sprite('rgba(215,235,255,1)', 0.35), p.x, p.y, 20 + 2600 * Math.pow(k, 2.2), 0.55 + 0.45 * k);
        addBlend(front, false);
      }
      front.save();
      front.fillStyle = `rgba(226,238,255,${Math.pow(clamp(inv(t, 44.35, 44.85)), 1.6) * 0.9})`;
      front.fillRect(0, 0, 1920, 1080);
      front.fillStyle = `rgba(0,0,0,${clamp(inv(t, 44.6, 44.95))})`;
      front.fillRect(0, 0, 1920, 1080);
      front.restore();
    }

    // subtle anamorphic streak once the field is open
    const streak = 0.05 + 0.05 * Math.sin(t * 0.7);
    front.save();
    front.globalAlpha = clamp(inv(t, 8, 20)) * streak;
    const g = front.createLinearGradient(0, 540 * S, 1920 * S, 540 * S);
    g.addColorStop(0, 'rgba(60,120,255,0)');
    g.addColorStop(0.5, 'rgba(120,180,255,0.5)');
    g.addColorStop(1, 'rgba(60,120,255,0)');
    front.fillStyle = g;
    front.fillRect(0, 536 * S, 1920 * S, 8 * S);
    front.restore();

    // ── 00:25 on-screen text ────────────────────────────────────────────
    const inK = smooth(inv(t, 25, 27.2));
    const outK = 1 - smooth(inv(t, 40.4, 42.6));
    const k = inK * outK;
    this.cap.style.opacity = k;
    this.cap.style.transform = `translateY(${(1 - smooth(inv(t, 25, 27.4))) * 26}px)`;

    void born;
  }
};
