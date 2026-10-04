/* SCENE 09 · 06:45–07:35 · EXECUTION & VERIFICATION
   The transaction is followed through the network. Verification is presented
   as the point, not the afterthought: what happened, not what was requested.
   The hash on screen is labelled as an example in the frame itself. */
import { el, brandLockup, execPanel, stagePoint, stageToWorld, cursorSprite } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, project, text, TAU, rng, room } from '../lib/fx.js';
import { chainLattice, txFlow, travellingTx } from '../lib/kit.js';

const CHAIN4 = ['ACTION', 'TRANSACTION', 'BLOCKCHAIN', 'VERIFICATION'];

export default {
  id: 'sc09',
  title: 'Execution & Verification',
  t0: 405, t1: 455,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    const top = el('div', { position: 'absolute', top: '0', left: '0', right: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.7)' });
    top.appendChild(brandLockup(22, { sub: 'EXECUTION' }));
    const hb = el('div', { display: 'flex', gap: '12px' });
    hb.appendChild(el('div', 'badge blue', '<span class="led"></span>ON-CHAIN'));
    hb.appendChild(el('div', 'badge mint', '<span class="led"></span>VERIFIED'));
    top.appendChild(hb);
    world.appendChild(top);

    const exec = execPanel({ compact: false });
    exec.root.style.cssText += ';position:absolute;right:120px;top:150px;width:600px;opacity:0';
    world.appendChild(exec.root);
    this.exec = exec;

    // verification chain, shown after confirmation
    const chainRow = el('div', { position: 'absolute', left: '50%', bottom: '96px', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '14px', opacity: '0' });
    CHAIN4.forEach((c, i) => {
      const n = el('div', 'card flat');
      n.style.cssText = 'padding:14px 20px;text-align:center;min-width:190px';
      n.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:11.5px;letter-spacing:.2em;color:#93a3c4">${c}</div>`;
      chainRow.appendChild(n);
      if (i < CHAIN4.length - 1) chainRow.appendChild(el('div', { color: '#3b4761', fontSize: '20px' }, '→'));
    });
    world.appendChild(chainRow);
    this.chainRow = chainRow;
    this.chainNodes = [...chainRow.querySelectorAll('.card')];

    const cap = el('div', { position: 'absolute', left: '0', right: '0', top: '120px', textAlign: 'center', opacity: '0' });
    cap.innerHTML = `<div class="kicker" style="letter-spacing:.4em">VERIFICATION IS THE POINT</div>`;
    world.appendChild(cap);
    this.cap = cap;

    const cursor = cursorSprite();
    root.appendChild(cursor);

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, cursor });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(24,56,118,0.52)', keyY: 0.4, keyR: 1.0 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // camera follows the transaction, then pulls back to reveal the network
    const pz = kf(t, [[0, 2350], [8, 1500], [18, 600], [28, -200], [36, -1200], [46, -2400], [55, -2000]]);
    const cam = camera({ px: Math.sin(t * 0.05) * 160, py: 30 + Math.cos(t * 0.04) * 26, pz, yaw: Math.sin(t * 0.035) * 0.2, fov: kf(t, [[0, 50], [20, 42], [36, 48], [55, 54]]) });

    // the blockchain volume
    back.save();
    back.globalAlpha = 0.9;
    chainLattice(back, cam, t, { cols: 9, rows: 6, gap: 250, z0: 200, zN: 3600, alpha: 1.0, hot: { x: 0, y: 0, z: 1150 } });
    txFlow(back, cam, t, { count: 1400, alpha: 1.0, highlightIdx: 3 });
    travellingTx(back, cam, t, { from: { x: 0, y: 0, z: 260 }, to: { x: 0, y: 0, z: 1150 }, k: clamp(inv(t, 0.4, 26)), trail: 40 });
    back.restore();
    dustField(back, cam, t, { count: 160, seed: 71, spread: 1800, focus: 1400, color: 'rgba(150,200,255,1)' });

    // the highlighted transaction keeps a reticle once it lands
    const landK = smooth(inv(t, 24, 28));
    if (landK > 0.02) {
      const p = project(cam, { x: 0, y: 0, z: 1150 });
      if (p) {
        const r = 90 * clamp(p.s * 300, 0.4, 2.2);
        back.save();
        back.globalAlpha = landK * 0.9;
        back.strokeStyle = 'rgba(150,210,255,0.9)';
        back.lineWidth = 1.6;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          back.beginPath();
          back.moveTo(p.x + sx * r, p.y + sy * r - sy * r * 0.4);
          back.lineTo(p.x + sx * r, p.y + sy * r);
          back.lineTo(p.x + sx * r - sx * r * 0.4, p.y + sy * r);
          back.stroke();
        }
        text(back, 'YOUR TRANSACTION', p.x, p.y - r - 24, { size: 16, weight: 600, align: 'center', color: '#e8eeff', alpha: landK });
        back.restore();
      }
    }

    // ── the execution rail ─────────────────────────────────────────────
    const execK = smooth(inv(t, 1.2, 3.0));
    this.exec.root.style.opacity = String(execK);
    this.exec.root.style.transform = `translateX(${(1 - execK) * 30}px)`;

    const times = [2.5, 8.5, 14.5, 25.5]; // PREPARING, SUBMITTED, CONFIRMING, CONFIRMED
    const execRows = [...this.exec.root.querySelectorAll('[data-exec]')];
    execRows.forEach((row, i) => {
      const reached = t >= times[i];
      const dot = row.querySelector('[data-dot]');
      const txt = row.querySelector('[data-txt]');
      const meta = row.querySelector('[data-meta]');
      if (reached) {
        dot.style.background = i === 3 ? '#46d9a8' : '#4d9bff';
        dot.style.boxShadow = `0 0 14px ${i === 3 ? '#46d9a8' : '#4d9bff'}`;
        txt.style.color = i === 3 ? '#46d9a8' : '#e8eeff';
        meta.style.color = i === 3 ? '#46d9a8' : '#93a3c4';
        meta.textContent = ['…', '0x9c41…17b3', '12 of 12 conf.', '✓ verified'][i];
      }
      // an active shimmer on the current step
      const active = reached && (i === 3 || t < times[i + 1]);
      if (active) {
        txt.style.opacity = String(0.6 + 0.4 * Math.sin(t * 4 + i));
      } else txt.style.opacity = '1';
    });

    const hashK = smooth(inv(t, 26.5, 28.5));
    const h = this.exec.hash;
    h.querySelector('[data-hash]').style.opacity = String(hashK);
    h.querySelector('[data-note]').style.opacity = String(hashK * 0.9);

    // ── pull back: thousands of other transactions ─────────────────────
    const wideK = smooth(inv(t, 36, 42));
    if (wideK > 0.01) {
      back.save();
      back.globalAlpha = wideK * 0.5;
      text(back, 'THOUSANDS OF TRANSACTIONS · YOURS REMAINS HIGHLIGHTED', 960, 1010, {
        size: 15, weight: 500, align: 'center', color: '#7c8fb5', ls: '0.28em', alpha: wideK
      });
      back.restore();
    }

    // ── the verification chain ─────────────────────────────────────────
    const chainK = smooth(inv(t, 41, 44));
    this.chainRow.style.opacity = String(chainK);
    this.chainRow.style.transform = `translateX(-50%) translateY(${(1 - chainK) * 20}px)`;
    this.chainNodes.forEach((n, i) => {
      const k = smooth(inv(t, 41.4 + i * 0.6, 42.6 + i * 0.6));
      n.style.opacity = String(k);
      n.style.transform = `translateY(${(1 - k) * 14}px)`;
      n.style.borderColor = i === 3 && k > 0.6 ? 'rgba(70,217,168,.45)' : '';
      const t2 = n.querySelector('div');
      if (t2) t2.style.color = i === 3 && k > 0.6 ? '#46d9a8' : '';
    });
    this.cap.style.opacity = String(smooth(inv(t, 44, 46.5)));

    this.cursor.style.opacity = '0';
    void sprite; void drawSprite; void addBlend; void rng; void TAU; void stagePoint; void stageToWorld; void kf;
  }
};
