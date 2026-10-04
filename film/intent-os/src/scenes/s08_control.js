/* SCENE 08 · 05:50–06:45 · THE USER REMAINS IN CONTROL
   The film's quietest moment. An action is prepared, then everything stops.
   The interface will not move without the user — and the wallet, not the AI,
   is what signs. */
import { el, brandLockup, actionCard, walletSheet, stagePoint, stageToWorld, cursorSprite } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, room } from '../lib/fx.js';

export default {
  id: 'sc08',
  title: 'The User Remains in Control',
  t0: 350, t1: 405,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    const top = el('div', { position: 'absolute', top: '0', left: '0', right: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.7)' });
    top.appendChild(brandLockup(22, { sub: 'INTENT SESSION' }));
    const hb = el('div', { display: 'flex', gap: '12px' });
    hb.appendChild(el('div', 'badge blue', '<span class="led"></span>REVIEW'));
    const hold = el('div', 'badge', 'NOT EXECUTED');
    hb.appendChild(hold);
    top.appendChild(hb);
    world.appendChild(top);
    this.hold = hold;

    // the proposed action
    const card = actionCard({ compact: false });
    card.style.cssText += ';position:absolute;left:50%;top:118px;transform:translateX(-50%);width:700px;opacity:0';
    world.appendChild(card);
    this.card = card;

    // the pause copy
    const pause = el('div', { position: 'absolute', left: '0', right: '0', top: '132px', textAlign: 'center', opacity: '0' });
    pause.innerHTML = `<div class="kicker" style="letter-spacing:.44em;color:#7cbaff">REVIEW ACTION</div>`;
    world.appendChild(pause);
    this.pause = pause;

    // the authorization sheet
    const gate = el('div', { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(3,5,10,0)', opacity: '0' });
    const sheet = walletSheet({ compact: false });
    sheet.style.width = '560px';
    gate.appendChild(sheet);
    world.appendChild(gate);
    this.gate = gate; this.sheet = sheet;

    const approved = el('div', 'card');
    approved.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:26px 30px;text-align:center;opacity:0';
    approved.innerHTML = `<div style="font-size:44px;line-height:1">✓</div>
      <div style="font-size:20px;font-weight:700;margin-top:12px">Authorized by the wallet</div>
      <div class="tiny" style="margin-top:10px">Signature received · the action may now enter execution</div>`;
    world.appendChild(approved);
    this.approved = approved;

    const caption = el('div', { position: 'absolute', left: '0', right: '0', bottom: '66px', textAlign: 'center', opacity: '0' });
    caption.innerHTML = `<div class="display sm">USER APPROVAL REQUIRED</div>`;
    world.appendChild(caption);
    this.caption = caption;

    const cursor = cursorSprite();
    root.appendChild(cursor);

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, cursor });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(24,52,104,0.55)', keyY: 0.18 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // camera: settle, then a slow, deliberate push toward CONFIRM
    const push = kf(t, [[0, 1.06], [10, 1.0], [20, 1.03], [30, 1.1], [36, 1.16], [44, 1.02], [55, 1.0]]);
    const dx = kf(t, [[0, 0], [22, 0], [34, 20], [46, 0], [55, 0]]);
    const dy = kf(t, [[0, 6], [12, 0], [30, -10], [44, 0], [55, 0]]);
    this.world.style.transform = `translate3d(${dx}px,${dy}px,0) scale(${push})`;

    // dim everything except the decision
    const dim = smooth(inv(t, 12.5, 18));
    this.world.style.filter = `brightness(${1 - 0.42 * dim})`;
    const others = this.world.querySelectorAll('.card, .badge');
    void others;

    // the action card arrives
    const cardK = smooth(inv(t, 0.4, 2.0));
    this.card.style.opacity = String(cardK);
    this.card.style.transform = `translateX(-50%) translateY(${(1 - cardK) * 26}px)`;

    // REVIEW ACTION first, then the authorization gate
    const reviewK = smooth(inv(t, 1.6, 3.2));
    this.pause.style.opacity = String(reviewK * (1 - smooth(inv(t, 19, 21))));

    // the interface holds still: nothing moves between 18 and 30 except light
    const breath = 1 + 0.004 * Math.sin(t * 1.6);
    if (t > 18 && t < 34) this.card.style.transform = `translateX(-50%) scale(${breath})`;

    const captionK = smooth(inv(t, 19.5, 22.5));
    this.caption.style.opacity = String(captionK * (1 - smooth(inv(t, 33, 35))));
    this.caption.style.transform = `translateY(${(1 - captionK) * 12}px)`;

    // the CONFIRM button breathes
    const confirm = this.card.querySelector('[data-confirm]');
    if (confirm) {
      const p = 0.5 + 0.5 * Math.sin((t - 20) * 2.6);
      confirm.style.boxShadow = `0 ${10 + 10 * p}px ${26 + 26 * p}px rgba(38,105,230,${0.34 + 0.34 * p})`;
      const clickK = smooth(inv(t, 31.4, 31.65)) * (1 - smooth(inv(t, 31.7, 32.0)));
      confirm.style.transform = `scale(${1 - 0.05 * clickK})`;
    }

    // ── the authorization sheet ────────────────────────────────────────
    const gateK = smooth(inv(t, 33.6, 35.2)) * (1 - smooth(inv(t, 41.5, 43.0)));
    this.gate.style.opacity = String(gateK);
    this.gate.style.background = `rgba(3,5,10,${0.66 * gateK})`;
    const sheetK = smooth(inv(t, 33.8, 35.6));
    this.sheet.style.transform = `translateY(${(1 - sheetK) * 40}px) scale(${lerp(0.96, 1, sheetK)})`;
    this.card.style.opacity = String(cardK * (1 - 0.75 * gateK));

    // the cursor walks to CONFIRM, then to the wallet's Approve
    const confirmPt = confirm ? stagePoint(confirm) : { x: 960, y: 700 };
    const approveBtn = this.sheet.querySelector('.btn:not(.ghost)');
    const approvePt = approveBtn ? stagePoint(approveBtn) : { x: 960, y: 720 };
    let cx, cy;
    const ck1 = smooth(inv(t, 26.5, 30.6));
    cx = lerp(1420, confirmPt.x, ck1); cy = lerp(880, confirmPt.y, ck1) + Math.sin(ck1 * Math.PI) * 60;
    const ck2 = smooth(inv(t, 35.4, 38.6));
    if (ck2 > 0) {
      cx = lerp(confirmPt.x, approvePt.x, ck2);
      cy = lerp(confirmPt.y, approvePt.y, ck2) + Math.sin(ck2 * Math.PI) * 50;
    }
    const click2 = smooth(inv(t, 38.8, 39.05)) * (1 - smooth(inv(t, 39.1, 39.4)));
    const w = stageToWorld({ x: cx, y: cy }, { dx, dy, scale: push });
    this.cursor.style.left = (w.x - 3) + 'px';
    this.cursor.style.top = (w.y - 2) + 'px';
    this.cursor.style.transform = `scale(${(1 - 0.16 * (click2)) / push})`;
    this.cursor.style.opacity = String(smooth(inv(t, 25, 26.5)) * (1 - smooth(inv(t, 46, 48))));
    void click2;

    // ── authorized ─────────────────────────────────────────────────────
    const authK = smooth(inv(t, 40.4, 42.2));
    this.approved.style.opacity = String(authK * (1 - smooth(inv(t, 48, 50.5))));
    this.approved.style.transform = `translate(-50%,-50%) scale(${lerp(0.96, 1, smooth(inv(t, 40.4, 43)))})`;
    this.hold.innerHTML = authK > 0.5 ? '<span class="led" style="background:#46d9a8"></span>AUTHORIZED' : 'NOT EXECUTED';
    this.hold.className = 'badge' + (authK > 0.5 ? ' mint' : '');

    // a single deep bloom as the wallet signs — the film's loudest beat so far
    front.save();
    front.globalAlpha = Math.sin(clamp(inv(t, 40.1, 44)) * Math.PI) * 0.30;
    const g = front.createRadialGradient(960 * 2, 540 * 2, 0, 960 * 2, 540 * 2, 1100 * 2);
    g.addColorStop(0, 'rgba(120,180,255,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    front.fillStyle = g; front.fillRect(0, 0, 1920 * 2, 1080 * 2);
    front.restore();

    // dust: the room is real
    dustField(back, camera({ px: 0, py: 0, pz: 0, fov: 40 }), t, { count: 70, seed: 63, spread: 900, focus: 900, color: 'rgba(150,200,255,1)' });
    void sprite; void drawSprite; void addBlend;
  }
};
