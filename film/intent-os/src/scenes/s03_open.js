/* SCENE 03 · 01:20–02:00 · ENTERING INTENT OS
   Someone opens fbtswap.ir on a desktop and a phone. The cursor finds
   Intent OS, and the product answers with a single question.
   The interface here is the same interface the app actually ships: nav,
   chips, input, footer — nothing invented for the camera. */
import { el, browserWindow, phoneShell, brandMark, appNav, intentHome, stageToWorld, stagePoint, cursorSprite } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, room } from '../lib/fx.js';

const TYPE_TEXT = 'I want to grow my portfolio over the next three years while managing risk.';

export default {
  id: 'sc03',
  title: 'Entering Intent OS',
  t0: 80, t1: 120,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    

    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    // phone — the mobile surface of the same product
    const ph = phoneShell({ w: 372, h: 762, x: 132, y: 172 });
    const phoneInner = el('div', { position: 'absolute', left: 0, top: 0, width: '690px', height: '1400px', transformOrigin: '0 0', transform: 'scale(0.539)' });
    phoneInner.appendChild(intentHome({ compact: true }).root);
    ph.screen.appendChild(phoneInner);
    world.appendChild(ph.root);

    // desktop
    const win = browserWindow({ w: 1180, h: 726, x: 596, y: 176, url: 'fbtswap.ir' });
    const home = fbtHome();
    const osScreen = intentHome({ compact: true });
    osScreen.root.style.opacity = '0';
    win.body.appendChild(home);
    win.body.appendChild(osScreen.root);
    world.appendChild(win.root);

    // cursor
    const cursor = cursorSprite();
    root.appendChild(cursor);

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, win, ph, home, osScreen, cursor });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(34,70,140,0.60)' });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // appear
    const appear = smooth(inv(t, 0.2, 1.6));
    this.root.style.opacity = appear;

    // camera: over-the-shoulder, then a slow push toward the screen
    const push = kf(t, [[0, 0], [6, 0.5], [11, 0.9], [16, 1.0], [30, 1.06], [40, 1.12]]);
    const scale = lerp(0.965, 1.055, push);
    const dx = lerp(-10, 26, push), dy = lerp(6, -6, push);
    this.world.style.transform = `translate3d(${dx}px,${dy}px,0) scale(${scale})`;

    // the phone drifts slightly, staying a supporting element
    this.ph.root.style.transform = `translate3d(${lerp(-16, -46, push)}px, ${lerp(10, -8, push)}px, 0) rotate(-1.6deg)`;

    // ── the cursor: find Intent OS, then click ──────────────────────────
    const navItem = this.win.body.querySelector('.nav-item.on');
    const targetStage = navItem ? stagePoint(navItem) : { x: 1100, y: 232 };
    const startStage = { x: 1500, y: 880 };
    const ck = smooth(inv(t, 2.2, 6.0));
    let sx = lerp(startStage.x, targetStage.x, ck), sy = lerp(startStage.y, targetStage.y, ck);
    sy += Math.sin(ck * Math.PI) * 120;

    const box = this.osScreen.box;
    const inputStage = box ? stagePoint(box) : targetStage;
    const ck2 = smooth(inv(t, 13.5, 16.6));
    const click = smooth(inv(t, 10.2, 10.45)) * (1 - smooth(inv(t, 10.5, 10.8)));
    if (ck2 > 0) {
      sx = lerp(targetStage.x, inputStage.x, ck2);
      sy = lerp(targetStage.y, inputStage.y, ck2) + Math.sin(ck2 * Math.PI) * 40;
    }
    const wpt = stageToWorld({ x: sx, y: sy }, { dx, dy, scale });
    this.cursor.style.left = (wpt.x - 3) + 'px';
    this.cursor.style.top = (wpt.y - 2) + 'px';
    this.cursor.style.transform = `scale(${(1 - 0.16 * click) / scale})`;
    this.cursor.style.opacity = t > 1.6 && t < 38 ? 1 : 0;

    // click ripple on the nav item
    if (navItem) {
      navItem.style.transform = `scale(${1 - 0.05 * click})`;
      navItem.style.background = `rgba(47,125,255,${0.16 + 0.3 * click})`;
    }

    // ── the click transitions the window into Intent OS ────────────────
    const swap = smooth(inv(t, 10.35, 11.5));
    this.home.style.opacity = String(1 - swap);
    this.home.style.transform = `scale(${1 - 0.02 * swap})`;
    this.osScreen.root.style.opacity = String(swap);
    this.osScreen.root.style.transform = `translateY(${(1 - swap) * 18}px)`;

    // ── the one question, then the chips ───────────────────────────────
    const qk = smooth(inv(t, 12.4, 14.6));
    const hero = this.osScreen.root.querySelector('.display');
    if (hero) { hero.style.opacity = qk; hero.style.transform = `translateY(${(1 - qk) * 22}px)`; }
    const sub = this.osScreen.root.querySelector('.lead');
    if (sub) { sub.style.opacity = smooth(inv(t, 13.4, 15.4)); }

    this.osScreen.chips.forEach((chip, i) => {
      const k = smooth(inv(t, 15.2 + i * 0.42, 16.6 + i * 0.42));
      chip.style.opacity = k;
      chip.style.transform = `translateY(${(1 - k) * 16}px)`;
    });
    const kicker = this.osScreen.root.querySelector('.kicker');
    if (kicker) kicker.style.opacity = smooth(inv(t, 11.8, 13.2));

    // ── typing the goal ────────────────────────────────────────────────
    const typeK = clamp((t - 18.4) * 11);
    const shown = TYPE_TEXT.slice(0, Math.floor(typeK));
    this.osScreen.input.textContent = shown;
    this.osScreen.input.appendChild(this.osScreen.caret);
    this.osScreen.caret.style.opacity = shown.length === TYPE_TEXT.length ? '1' : '1';

    // the interpret button breathes once the sentence is complete
    const done = typeK >= TYPE_TEXT.length;
    const btn = this.osScreen.box.querySelector('[data-interpret]');
    if (btn) {
      const p = done ? 0.5 + 0.5 * Math.sin((t - 25.5) * 3.2) : 0;
      btn.style.boxShadow = `0 ${8 + 6 * p}px ${24 + 20 * p}px rgba(38,105,230,${0.34 + 0.3 * p})`;
    }
  }
};

/* the marketing home page of fbtswap.ir, only ever seen for a second or two */
function fbtHome() {
  const root = el('div', { position: 'absolute', inset: '0', transition: 'none', background: 'radial-gradient(100% 80% at 70% -10%, rgba(34,72,140,.45), transparent 60%), #05080f' });
  root.appendChild(appNav({ active: '' }));
  const body = el('div', { position: 'absolute', inset: '58px 0 0 0', padding: '46px 56px' });
  body.innerHTML = `
    <div class="kicker">INITIAL DESK · LIVE</div>
    <div class="display md" style="margin-top:18px;max-width:900px">One desk for every market<br/>you actually trade.</div>
    <div class="lead" style="margin-top:20px;max-width:620px;font-size:17px">Swap, earn, lend and analyze across chains — then let Intent OS structure the decision.</div>
    <div style="display:flex;gap:14px;margin-top:30px">
      <div class="btn big">Open Intent OS</div>
      <div class="btn ghost big">Explore markets</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:44px">
      ${[['TOTAL LIQUIDITY', '$412.8M', '+4.2%'], ['24H VOLUME', '$86.4M', '+1.8%'], ['ACTIVE INTENTS', '18,402', '+312']]
      .map(([k, v, d]) => `<div class="card" style="padding:20px"><div class="label">${k}</div>
        <div style="font-size:26px;font-weight:700;margin-top:10px;font-family:'JetBrains Mono',monospace">${v}</div>
        <div style="font-size:12.5px;color:#46d9a8;margin-top:6px">${d}</div></div>`).join('')}
    </div>`;
  const nav = root.querySelector('.nav');
  if (nav) nav.remove();
  root.appendChild(appNav({ active: '' }));
  root.appendChild(body);
  return root;
}
