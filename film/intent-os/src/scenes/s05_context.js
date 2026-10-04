/* SCENE 05 · 02:50–03:45 · BUILDING CONTEXT
   Context is requested, authorized and then visualized. Every gate the real
   product has is on screen: the wallet asks for read access, the portfolio
   arrives read-only, and the film shows that the same goal over a different
   portfolio is a different decision. */
import { el, brandLockup, portfolioPanel, walletSheet, stagePoint, stageToWorld, cursorSprite, PORTFOLIO_ROWS, brandMark } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, project, text, path as pth, room } from '../lib/fx.js';
import { nodeGraph } from '../lib/kit.js';

const CONTEXT_ROWS = [
  ['Available capital', '$25,000.00 available · $9,240 idle', 'WALLET', true],
  ['Current portfolio', '5 assets · 2 chains', 'WALLET', true],
  ['Liquidity needs', 'No withdrawal inside 30 days', 'USER', true],
  ['Risk preference', 'Balanced · controlled drawdown', 'USER', true],
  ['Time horizon', '3 years, reviewed quarterly', 'DERIVED', true]
];

export default {
  id: 'sc05',
  title: 'Building Context',
  t0: 170, t1: 225,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    // header
    const top = el('div', { position: 'absolute', top: '0', left: '0', right: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.72)' });
    top.appendChild(brandLockup(22, { sub: 'INTENT SESSION' }));
    const hb = el('div', { display: 'flex', gap: '12px' });
    hb.appendChild(el('div', 'badge blue', '<span class="led"></span>CONTEXT'));
    const walletBadge = el('div', 'badge', 'WALLET NOT CONNECTED');
    hb.appendChild(walletBadge);
    top.appendChild(hb);
    world.appendChild(top);

    // ── context checklist ──────────────────────────────────────────────
    const ctx = el('div', 'card');
    ctx.style.cssText = 'position:absolute;left:46px;top:112px;width:640px;padding:26px';
    ctx.innerHTML = `<div class="row between"><div class="label">CONTEXT REQUIRED FOR THIS GOAL</div><div class="badge" data-count>0 / 5</div></div>`;
    const rows = CONTEXT_ROWS.map(([k, v, src]) => {
      const r = el('div', { display: 'flex', alignItems: 'center', gap: '14px', padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.055)', opacity: '0' });
      r.innerHTML = `<span data-dot style="width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.14);flex:0 0 auto"></span>
        <div style="flex:1"><div style="font-size:14.5px;font-weight:600">${k}</div>
        <div style="font-size:12px;color:#5d6c8c;margin-top:3px">${v}</div></div>
        <span class="mono" style="font-size:10px;letter-spacing:.16em;color:#3b4761">${src}</span>`;
      ctx.appendChild(r);
      return r;
    });
    world.appendChild(ctx);
    this.ctx = ctx; this.rows = rows;

    // ── wallet gate ────────────────────────────────────────────────────
    const gate = el('div', { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(3,5,10,.62)', opacity: '0' });
    const sheet = walletSheet({ compact: false });
    sheet.style.width = '560px';
    gate.appendChild(sheet);
    world.appendChild(gate);
    this.gate = gate; this.sheet = sheet;

    // ── portfolio ──────────────────────────────────────────────────────
    const port = portfolioPanel({ compact: true });
    port.style.cssText = 'position:absolute;right:46px;top:112px;width:520px;opacity:0';
    world.appendChild(port);
    this.port = port;

    const note = el('div', 'card flat');
    note.style.cssText = 'position:absolute;right:46px;top:520px;width:520px;padding:18px 20px;opacity:0';
    note.innerHTML = `<div class="row between"><div class="label">ACCESS LEVEL</div><div class="badge mint"><span class="led"></span>READ-ONLY</div></div>
      <div class="tiny" style="margin-top:12px">Balances and positions are readable. Signing rights stay with the wallet — Intent OS cannot move funds.</div>`;
    world.appendChild(note);
    this.note = note;

    // ── two goals, two contexts ────────────────────────────────────────
    const compare = el('div', { position: 'absolute', left: '50%', bottom: '96px', transform: 'translateX(-50%)', display: 'flex', gap: '22px', opacity: '0' });
    const mk = (title, mix, tone) => {
      const c = el('div', 'card');
      c.style.cssText = 'width:600px;padding:22px 24px';
      c.innerHTML = `<div class="label" style="color:${tone}">${title}</div>
        <div style="font-size:17px;margin-top:12px;line-height:1.45">"Grow my portfolio over the next three years while managing risk."</div>
        <div style="margin-top:16px;display:flex;gap:1px;height:10px;border-radius:5px;overflow:hidden">
          ${mix.map(([w, c2]) => `<div style="width:${w}%;background:${c2}"></div>`).join('')}
        </div>
        <div class="tiny" style="margin-top:12px">${mix.map(([, c2, l]) => `<span style="color:${c2}">■</span> ${l}`).join(' &nbsp; ')}</div>`;
      return c;
    };
    const a = mk('PORTFOLIO A · 92% ONE ASSET', [[92, '#ff5f78', 'Single asset'], [8, '#5d6c8c', 'Cash']], '#ff5f78');
    const b = mk('PORTFOLIO B · DIVERSIFIED', [[38, '#4d9bff', 'ETH'], [26, '#5cc9ff', 'BTC'], [21, '#46d9a8', 'USDC'], [15, '#9a86ff', 'RWA']], '#46d9a8');
    compare.appendChild(a); compare.appendChild(b);
    world.appendChild(compare);
    this.compare = compare;

    const cap = el('div', { position: 'absolute', left: '0', right: '0', bottom: '40px', textAlign: 'center', opacity: '0' });
    cap.innerHTML = `<div class="display sm">INTENT WITHOUT CONTEXT IS INCOMPLETE.</div>`;
    world.appendChild(cap);
    this.cap = cap;

    const cursor = cursorSprite();
    root.appendChild(cursor);

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, cursor, walletBadge });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(34,70,140,0.62)' });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    const push = kf(t, [[0, 1.0], [14, 1.02], [26, 1.0], [40, 1.03], [55, 1.0]]);
    const dx = kf(t, [[0, 0], [16, -10], [30, 12], [46, 0], [55, 0]]);
    this.world.style.transform = `translate3d(${dx}px,0,0) scale(${push})`;

    // ── context rows fill in ───────────────────────────────────────────
    this.rows.forEach((r, i) => {
      const k = smooth(inv(t, 0.6 + i * 0.5, 1.8 + i * 0.5));
      r.style.opacity = String(k);
      r.style.transform = `translateX(${(1 - k) * 26}px)`;
      const dot = r.querySelector('[data-dot]');
      const filled = smooth(inv(t, 1.4 + i * 0.5, 2.4 + i * 0.5));
      dot.style.background = filled > 0.5 ? '#46d9a8' : 'rgba(255,255,255,.20)';
      dot.style.boxShadow = filled > 0.5 ? '0 0 12px #46d9a8' : 'none';
    });
    const cnt = this.ctx.querySelector('[data-count]');
    cnt.textContent = `${Math.min(5, Math.max(0, Math.round(5 * smooth(inv(t, 1.2, 4.6)))))} / 5`;

    // ── the wallet gate ────────────────────────────────────────────────
    const gateK = smooth(inv(t, 5.4, 6.6)) * (1 - smooth(inv(t, 12.4, 13.4)));
    this.gate.style.opacity = String(gateK);
    this.gate.style.background = `rgba(3,5,10,${0.62 * gateK})`;
    const sheetPop = smooth(inv(t, 5.6, 7.0));
    this.sheet.style.transform = `scale(${lerp(0.94, 1, sheetPop)}) translateY(${(1 - sheetPop) * 14}px)`;

    // cursor approves the read-only request
    const approveBtn = this.sheet.querySelector('.btn:not(.ghost)');
    const ap = approveBtn ? stagePoint(approveBtn) : { x: 1180, y: 700 };
    const ck = smooth(inv(t, 8.4, 11.2));
    const click = smooth(inv(t, 11.4, 11.65)) * (1 - smooth(inv(t, 11.7, 12.0)));
    const cx = lerp(1180, ap.x, ck), cy = lerp(820, ap.y, ck) + Math.sin(ck * Math.PI) * 40;
    const wpt = stageToWorld({ x: cx, y: cy }, { dx, dy: 0, scale: push });
    this.cursor.style.left = (wpt.x - 3) + 'px';
    this.cursor.style.top = (wpt.y - 2) + 'px';
    this.cursor.style.transform = `scale(${(1 - 0.16 * click) / push})`;
    this.cursor.style.opacity = String(smooth(inv(t, 7.6, 8.4)) * (1 - smooth(inv(t, 24, 27))));
    if (approveBtn) approveBtn.style.transform = `scale(${1 - 0.04 * click})`;

    // ── connection confirmed, portfolio arrives ────────────────────────
    const connK = smooth(inv(t, 12.6, 14.0));
    this.walletBadge.textContent = connK > 0.5 ? 'WALLET CONNECTED · 0x7A3f…C4e1' : 'WALLET NOT CONNECTED';
    if (connK > 0.5) {
      this.walletBadge.className = 'badge mint';
      this.walletBadge.innerHTML = '<span class="led"></span>WALLET CONNECTED · 0x7A3f…C4e1';
    }
    const portK = smooth(inv(t, 13.6, 15.2));
    this.port.style.opacity = String(portK);
    this.port.style.transform = `translateX(${(1 - portK) * 40}px)`;
    this.note.style.opacity = String(smooth(inv(t, 16.4, 17.8)));
    this.note.style.transform = `translateY(${(1 - smooth(inv(t, 16.4, 17.8))) * 20}px)`;

    // rows of the portfolio tick once, then hold (a live read, not a mock)
    const pulse = 1 + 0.006 * Math.sin(t * 4.2);
    if (portK > 0.9) this.port.style.opacity = String(0.92 + 0.08 * smooth(inv(t, 16, 18)));
    void pulse;

    // ── the camera leaves the UI and enters the data ───────────────────
    const dim = smooth(inv(t, 27, 33)) * (1 - smooth(inv(t, 38, 43)));
    this.world.style.opacity = String(1 - 0.62 * dim);

    if (dim > 0.02) {
      const cam = camera({
        px: Math.sin(t * 0.08) * 260, py: 40 + Math.sin(t * 0.06) * 40, pz: lerp(-1150, -700, smooth(inv(t, 26, 44))),
        yaw: 0.16 * Math.sin(t * 0.1), fov: 50
      });
      back.save();
      back.globalAlpha = Math.min(0.95, dim * 1.15);

      const nodes = [
        { x: -520, y: 0, z: 700, r: 26, label: 'WALLET', hot: false },
        { x: -180, y: 150, z: 480, r: 30, label: 'PORTFOLIO' },
        { x: 140, y: -140, z: 620, r: 26, label: 'MARKET DATA' },
        { x: 470, y: 40, z: 880, r: 34, label: 'INTENT OS', hot: true }
      ];
      const links = [[0, 1], [1, 2], [2, 3], [1, 3], [0, 2]];
      nodeGraph(back, cam, t, nodes, links, { alpha: 0.95 * dim });

      // asset nodes orbiting the portfolio node
      const assets = PORTFOLIO_ROWS.map((r, i) => {
        const a = t * 0.22 + i * 1.25;
        return { x: -180 + Math.cos(a) * 320, y: 150 + Math.sin(a) * 190, z: 480 + Math.sin(a * 1.7) * 130, r: 14, label: r.s };
      });
      const alinks = assets.map((_, i) => [1, 4 + i]);
      nodeGraph(back, cam, t, [...nodes, ...assets], [...links, ...alinks], { alpha: 0.75 * dim });
      dustField(back, cam, t, { count: 140, seed: 5, spread: 1500, focus: 1200, color: 'rgba(150,200,255,1)' });
      back.restore();
    }

    // ── the same goal, two contexts ────────────────────────────────────
    const cmpK = smooth(inv(t, 42, 45.5));
    this.compare.style.opacity = String(cmpK);
    this.compare.style.transform = `translateX(-50%) translateY(${(1 - cmpK) * 30}px)`;
    this.cap.style.opacity = String(smooth(inv(t, 46, 48.5)));
    this.cap.style.transform = `translateY(${(1 - smooth(inv(t, 46, 48.5))) * 16}px)`;

    // a slow parallax on the two context panels so they read as objects
    const par = Math.sin(t * 0.5) * 4;
    this.compare.style.transform = `translateX(-50%) translateY(${(1 - cmpK) * 30 + par}px)`;
    void brandMark; void sprite; void drawSprite; void addBlend; void project; void text; void pth;
  }
};
