/* SCENE 11 · 08:20–09:10 · THE COMPLETE INTENT OS LOOP
   Nine words appear exactly as the narrator says them, then close into a
   circle. The loop is the product's argument: nothing here is a one-shot
   answer, and when the environment changes the process can begin again. */
import { room, clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, text, TAU, rng, project } from '../lib/fx.js';
import { el } from '../lib/ui.js';

const WORDS = ['INTENT', 'CONTEXT', 'ANALYSIS', 'STRATEGY', 'ACTION', 'AUTHORIZATION', 'EXECUTION', 'VERIFICATION', 'MONITORING'];

export default {
  id: 'sc11',
  title: 'The Complete Intent OS Loop',
  t0: 500, t1: 550,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    const ring = el('div', { position: 'absolute', left: '50%', top: '50%', width: '1500px', height: '820px', transform: 'translate(-50%,-50%)' });
    world.appendChild(ring);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '1500'); svg.setAttribute('height', '820');
    svg.style.cssText = 'position:absolute;inset:0';
    ring.appendChild(svg);

    const CX = 750, CY = 410, R = 330;
    const labels = WORDS.map((w, i) => {
      const a = (i / WORDS.length) * TAU - Math.PI / 2;
      const n = el('div');
      n.style.cssText = `position:absolute;left:${CX + Math.cos(a) * R * 1.55}px;top:${CY + Math.sin(a) * R}px;transform:translate(-50%,-50%);text-align:center;opacity:0`;
      n.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:.26em;color:#e8eeff;white-space:nowrap">${w}</div>
        <div style="width:6px;height:6px;border-radius:50%;background:#4d9bff;margin:9px auto 0;box-shadow:0 0 12px #4d9bff" data-dot></div>`;
      ring.appendChild(n);
      return n;
    });

    // the connecting circle is drawn as an SVG path with a dash offset
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    circle.setAttribute('cx', CX); circle.setAttribute('cy', CY);
    circle.setAttribute('rx', R * 1.55); circle.setAttribute('ry', R);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'rgba(90,150,240,.34)');
    circle.setAttribute('stroke-width', '1.2');
    circle.setAttribute('stroke-dasharray', '2000');
    circle.setAttribute('stroke-dashoffset', '2000');
    svg.appendChild(circle);
    this.circle = circle;

    const centre = el('div', { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', opacity: '0' });
    centre.innerHTML = `<div class="kicker" style="letter-spacing:.42em">THE INTENT OS LOOP</div>
      <div class="tiny" style="margin-top:14px;max-width:420px">Each pass begins with a goal and ends with evidence — never with an assumption.</div>`;
    world.appendChild(centre);
    this.centre = centre;

    const again = el('div', { position: 'absolute', left: '0', right: '0', bottom: '84px', textAlign: 'center', opacity: '0' });
    again.innerHTML = `<div class="display xs" style="color:#cfe2ff;letter-spacing:.02em">AND WHEN THE ENVIRONMENT CHANGES, THE PROCESS CAN BEGIN AGAIN.</div>`;
    world.appendChild(again);
    this.again = again;

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, ring, svg, labels, CX, CY, R });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(26,58,124,0.62)', keyY: 0.48, keyR: 0.9 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // the words appear one at a time, in step with the narration
    const wordTimes = [2.6, 3.5, 4.3, 5.1, 5.9, 6.7, 7.5, 8.3, 9.1];
    this.labels.forEach((n, i) => {
      const k = smooth(inv(t, wordTimes[i], wordTimes[i] + 0.9));
      n.style.opacity = String(k);
      n.style.transform = `translate(-50%,-50%) scale(${lerp(0.94, 1, k)})`;
      const dot = n.querySelector('[data-dot]');
      // the dot lights when the loop starts running, in order
      const runStart = 16.5, runLen = 0.85;
      const lit = t > runStart ? smooth(inv(t, runStart + i * runLen, runStart + i * runLen + 0.5)) : 0;
      const passing = t > runStart + (i + 1) * runLen ? 0.25 : 1;
      dot.style.background = lit > 0.5 ? '#46d9a8' : '#4d9bff';
      dot.style.boxShadow = lit > 0.5 ? '0 0 16px #46d9a8' : '0 0 12px #4d9bff';
      dot.style.opacity = String(0.5 + 0.5 * lit + (1 - passing) * 0.2);
    });

    // the circle closes once the ninth word lands
    const closeK = smooth(inv(t, 10.2, 14.5));
    this.circle.setAttribute('stroke-dashoffset', String(2000 * (1 - closeK)));
    this.circle.setAttribute('stroke', t > 16.5 ? 'rgba(110,180,255,.5)' : 'rgba(90,150,240,.34)');

    const centreK = smooth(inv(t, 11.0, 13.5)) * (1 - smooth(inv(t, 34, 38)));
    this.centre.style.opacity = String(centreK);

    // camera orbits the completed loop, slowly, for the rest of the scene
    const orbit = t > 14 ? (t - 14) * 0.16 : 0;
    const zoom = kf(t, [[0, 1.16], [12, 1.06], [22, 1.0], [34, 1.06], [44, 1.14], [50, 1.06]]);
    this.ring.style.transform = `translate(-50%,-50%) perspective(1600px) rotateY(${Math.sin(orbit) * 16}deg) rotateX(${Math.sin(orbit * 0.7) * 7}deg) scale(${zoom})`;

    // packets travel the loop when it runs
    if (t > 16.5) {
      const cycleT = ((t - 16.5) * 0.52) % 1;
      const r = this.R;
      const cx = this.CX, cy = this.CY;
      const svgNS = 'http://www.w3.org/2000/svg';
      if (!this._pkt) {
        this._pkt = [];
        for (let i = 0; i < 3; i++) {
          const c = document.createElementNS(svgNS, 'circle');
          c.setAttribute('r', '4.5');
          c.setAttribute('fill', i === 0 ? '#eaf3ff' : '#7cbaff');
          this.svg.appendChild(c);
          this._pkt.push(c);
        }
      }
      this._pkt.forEach((c, i) => {
        const k = (cycleT + i * 0.33) % 1;
        const a = k * TAU - Math.PI / 2;
        c.setAttribute('cx', String(cx + Math.cos(a) * r * 1.55));
        c.setAttribute('cy', String(cy + Math.sin(a) * r));
        c.setAttribute('opacity', String(0.85 - i * 0.22));
      });
    }

    // "and the process can begin again" — the loop restarts, visibly
    const againK = smooth(inv(t, 30, 33)) * (1 - smooth(inv(t, 46, 49)));
    this.again.style.opacity = String(againK);

    // the restart itself: a pulse runs the circle from INTENT once more
    if (t > 33 && t < 40) {
      const k = (t - 33) / 7;
      back.save();
      back.globalAlpha = (1 - k) * 0.28;
      back.strokeStyle = 'rgba(120,190,255,0.9)';
      back.lineWidth = 2.4;
      back.beginPath();
      back.ellipse(960, 540, this.R * 1.55 * 1.0, this.R, 0, -Math.PI / 2, -Math.PI / 2 + k * TAU);
      back.stroke();
      back.restore();
    }

    // ambient depth behind the loop
    const cam = camera({ px: 0, py: 0, pz: 0, fov: 40 });
    dustField(back, cam, t, { count: 90, seed: 111, spread: 1200, focus: 1000, color: 'rgba(140,190,255,1)' });
    back.save();
    back.globalAlpha = 0.10;
    const r2 = rng(112);
    addBlend(back, true);
    for (let i = 0; i < 140; i++) {
      const a = r2() * TAU, d = 200 + r2() * 900;
      drawSprite(back, sprite('rgba(110,170,255,1)', 0.5),
        960 + Math.cos(a + t * 0.02) * d, 540 + Math.sin(a + t * 0.02) * d * 0.6, 30 + r2() * 90, 0.06 + 0.05 * r2());
    }
    addBlend(back, false);
    back.restore();
    void front;
  }
};
