/* SCENE 04 · 02:00–02:50 · UNDERSTANDING INTENT
   The sentence stops being a sentence and becomes structure — four named
   layers, then an engine, then the one question the system still needs
   answered. The film never shows the AI inventing a missing fact: when
   something is missing, it says so. */
import { el, brandLockup, stagePoint, stageToWorld, cursorSprite } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, room } from '../lib/fx.js';
import { vortex } from '../lib/kit.js';

const SENTENCE = 'I want to grow my portfolio over the next three years while managing risk.';
const LAYERS = [
  { k: 'GOAL', v: 'Portfolio Growth', c: '#4d9bff' },
  { k: 'TIME HORIZON', v: '3 Years', c: '#5cc9ff' },
  { k: 'RISK', v: 'Controlled', c: '#9a86ff' },
  { k: 'CONTEXT', v: 'Portfolio', c: '#46d9a8' }
];
const RISK_CHOICES = ['Conservative', 'Balanced', 'Growth', 'Aggressive'];

export default {
  id: 'sc04',
  title: 'Understanding Intent',
  t0: 120, t1: 170,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    

    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    // session chrome
    const top = el('div', { position: 'absolute', left: '0', right: '0', top: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.72)' });
    top.appendChild(brandLockup(22, { sub: 'INTENT SESSION' }));
    const right = el('div', { display: 'flex', alignItems: 'center', gap: '12px' });
    const stateBadge = el('div', 'badge blue', '<span class="led"></span>ANALYSING');
    stateBadge.dataset.state = '1';
    right.appendChild(stateBadge);
    right.appendChild(el('div', 'badge', 'SESSION #41-C'));
    top.appendChild(right);
    world.appendChild(top);

    const body = el('div', { position: 'absolute', left: '0', right: '0', top: '74px', bottom: '0', display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '30px', padding: '34px 46px' });
    world.appendChild(body);

    // ── left: the conversation ─────────────────────────────────────────
    const left = el('div', { display: 'flex', flexDirection: 'column', gap: '18px', opacity: '0' });
    const goal = el('div', 'card');
    goal.style.padding = '24px 26px';
    goal.innerHTML = `<div class="label">YOUR GOAL</div>
      <div data-sentence style="font-size:25px;line-height:1.45;margin-top:14px;color:#e8eeff">${SENTENCE}</div>
      <div class="row between" style="margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.07)">
        <div class="badge blue"><span class="led"></span>INTERPRET INTENT</div>
        <div class="tiny">Reviewed by you · nothing is executed automatically</div>
      </div>`;
    left.appendChild(goal);

    const ask = el('div', 'card active');
    ask.style.padding = '24px 26px';
    ask.style.opacity = '0';
    ask.innerHTML = `<div class="row between"><div class="label">INTENT OS</div><div class="badge amber" data-clar><span class="led"></span>CLARIFICATION REQUIRED</div></div>
      <div style="font-size:22px;margin-top:16px;line-height:1.45">What level of risk are you comfortable with?</div>
      <div class="tiny" style="margin-top:10px">Risk tolerance changes the allocation framework, not the goal.</div>
      <div data-chips style="display:flex;gap:12px;flex-wrap:wrap;margin-top:20px"></div>`;
    left.appendChild(ask);
    const chips = [];
    RISK_CHOICES.forEach((c, i) => {
      const chip = el('div', 'chip', `<span class="dot"></span>${c}`);
      chip.dataset.chip = c;
      ask.querySelector('[data-chips]').appendChild(chip);
      chips.push(chip);
    });

    const answer = el('div', 'card flat');
    answer.style.padding = '20px 24px';
    answer.style.opacity = '0';
    answer.innerHTML = `<div class="label">YOUR ANSWER</div>
      <div style="font-size:19px;margin-top:10px;color:#e8eeff">Balanced — I can accept moderate drawdown for long-term growth.</div>`;
    left.appendChild(answer);

    // ── right: the structure the system derived ────────────────────────
    const rightCol = el('div', { display: 'flex', flexDirection: 'column', gap: '14px' });
    const structHead = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' });
    structHead.innerHTML = `<div class="label">STRUCTURED INTENT</div><div class="badge" data-status>READING</div>`;
    rightCol.appendChild(structHead);

    const cards = LAYERS.map((l) => {
      const c = el('div', 'card');
      c.style.padding = '18px 20px';
      c.style.opacity = '0';
      c.innerHTML = `<div class="row between"><div class="label" style="color:${l.c}">${l.k}</div>
        <div style="width:7px;height:7px;border-radius:50%;background:${l.c};box-shadow:0 0 12px ${l.c}"></div></div>
        <div data-v style="font-size:23px;font-weight:600;letter-spacing:-.02em;margin-top:11px">${l.v}</div>
        <div data-sub class="tiny" style="margin-top:6px;opacity:0">derived from the request</div>`;
      rightCol.appendChild(c);
      return c;
    });
    const confidence = el('div', 'card flat');
    confidence.style.padding = '18px 20px';
    confidence.style.opacity = '0';
    confidence.innerHTML = `<div class="label">CONFIDENCE · STATED SOURCES ONLY</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:14px">
        <div class="meter" style="flex:1"><i data-conf style="width:0%"></i></div>
        <div class="mono" style="font-size:13px;color:#93a3c4" data-confv>0%</div>
      </div>
      <div class="tiny" style="margin-top:12px">Nothing below is inferred from private data. Missing values are requested, never invented.</div>`;
    rightCol.appendChild(confidence);
    body.appendChild(left);
    body.appendChild(rightCol);

    const cursor = cursorSprite();
    root.appendChild(cursor);

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, left, goal, ask, answer, chips, cards, confidence, cursor, stateBadge, structHead });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, keyX: 0.62, keyY: 0.0 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // camera: a slow macro push into the interface
    const push = kf(t, [[0, 1.0], [12, 1.03], [26, 1.05], [40, 1.02], [50, 1.0]]);
    const dx = kf(t, [[0, 0], [18, -14], [34, 8], [50, 0]]);
    this.world.style.transform = `translate3d(${dx}px, ${lerp(0, -4, smooth(inv(t, 0, 20)))}px, 0) scale(${push})`;

    // ── the engine, behind the interface ───────────────────────────────
    const engK = smooth(inv(t, 1.2, 4.2)) * (1 - smooth(inv(t, 30, 36)));
    if (engK > 0.01) {
      back.save();
      back.globalAlpha = engK;
      vortex(back, 1180 * 2 / 2 + 330, 560, t, { count: 620, radius: 400, alpha: 0.85 * engK });
      back.restore();
      dustField(back, camera({ px: 0, py: 0, pz: 0, fov: 40 }), t, { count: 80, seed: 21, spread: 800, focus: 800, color: 'rgba(150,190,255,1)' });
    }

    // ── 0.0–2.0 : the sentence is taken apart ──────────────────────────
    const sentEl = this.goal.querySelector('[data-sentence]');
    const breakK = smooth(inv(t, 0.9, 2.4));
    sentEl.style.filter = `blur(${breakK * 5}px)`;
    sentEl.style.transform = `translateY(${-breakK * 6}px) scale(${1 - 0.02 * breakK})`;
    sentEl.style.opacity = String(1 - 0.55 * breakK);
    this.goal.style.borderColor = `rgba(77,155,255,${0.18 + 0.4 * breakK})`;

    this.left.style.opacity = smooth(inv(t, 0.15, 1.1));
    this.ask.style.opacity = smooth(inv(t, 11.5, 13.6));
    this.ask.style.transform = `translateY(${(1 - smooth(inv(t, 11.5, 13.6))) * 20}px)`;

    // ── the four layers rise out of the request ────────────────────────
    this.cards.forEach((c, i) => {
      const k = smooth(inv(t, 2.2 + i * 0.55, 3.6 + i * 0.55));
      c.style.opacity = k;
      c.style.transform = `translateX(${(1 - k) * 46}px) translateY(${(1 - k) * 10}px)`;
      const sub = c.querySelector('[data-sub]');
      if (sub) sub.style.opacity = String(smooth(inv(t, 4.6 + i * 0.3, 6.0 + i * 0.3)) * 0.9);
    });

    // ── reading → structured ───────────────────────────────────────────
    const readingK = smooth(inv(t, 4.2, 5.2)) * (1 - smooth(inv(t, 8.4, 9.2)));
    const structK = smooth(inv(t, 8.4, 9.6));
    this.stateBadge.innerHTML = structK > 0.5
      ? '<span class="led" style="background:#46d9a8"></span>STRUCTURED'
      : '<span class="led"></span>ANALYSING';
    this.stateBadge.style.borderColor = structK > 0.5 ? 'rgba(70,217,168,.42)' : '';
    this.stateBadge.style.color = structK > 0.5 ? '#46d9a8' : '';
    const status = this.structHead.querySelector('[data-status]');
    status.textContent = structK > 0.5 ? 'INTENT STRUCTURED' : (readingK > 0.2 ? 'UNDERSTANDING YOUR INTENT…' : 'READING');
    status.className = 'badge' + (structK > 0.5 ? ' mint' : '');

    // sweep line while reading
    if (readingK > 0.02) {
      this.confidence.style.opacity = String(smooth(inv(t, 4.6, 5.6)));
      this.confidence.querySelector('[data-conf]').style.width = `${Math.round(72 * smooth(inv(t, 5.0, 8.6)))}%`;
      this.confidence.querySelector('[data-confv]').textContent = `${Math.round(72 * smooth(inv(t, 5.0, 8.6)))}%`;
    }

    // ── the question, and the answer that unlocks risk ─────────────────
    const chipsK = smooth(inv(t, 13.6, 15.2));
    const clar = this.ask.querySelector('[data-clar]');
    clar.style.opacity = String(smooth(inv(t, 12.6, 13.8)) * (1 - smooth(inv(t, 27.5, 29.5))));
    const chipPick = smooth(inv(t, 22.4, 22.8));
    this.chips.forEach((c, i) => {
      c.style.opacity = String(chipsK);
      c.style.transform = `translateY(${(1 - chipsK) * 14}px)`;
      const chosen = i === 1;
      const sel = chosen ? chipPick : 0;
      c.style.borderColor = sel > 0.5 ? 'rgba(90,165,255,.6)' : '';
      c.style.background = sel > 0.5 ? 'rgba(47,125,255,.14)' : '';
      c.style.transform += ` scale(${1 + 0.04 * sel * (1 - smooth(inv(t, 23.2, 23.6)))})`;
    });
    const ans = smooth(inv(t, 22.8, 24.2));
    this.answer.style.opacity = String(ans);
    this.answer.style.transform = `translateY(${(1 - ans) * 16}px)`;

    // the RISK card resolves to what the user actually chose
    const riskCard = this.cards[2];
    const rv = riskCard.querySelector('[data-v]');
    const resolved = smooth(inv(t, 28.5, 30.2));
    rv.textContent = resolved > 0.5 ? 'Balanced · Controlled' : 'Controlled';
    rv.style.color = resolved > 0.5 ? '#ffffff' : '';

    // ── the cursor picks a chip ─────────────────────────────────────────
    const chip = this.chips[1];
    const cp = stagePoint(chip);
    const stageT = { x: 980, y: 760 };
    const ck = smooth(inv(t, 19.0, 22.2));
    const click = smooth(inv(t, 22.5, 22.75)) * (1 - smooth(inv(t, 22.8, 23.1)));
    const cx = lerp(stageT.x, cp.x, ck), cy = lerp(stageT.y, cp.y, ck) + Math.sin(ck * Math.PI) * 26;
    const w = stageToWorld({ x: cx, y: cy }, { dx, dy: 0, scale: push });
    this.cursor.style.left = (w.x - 3) + 'px';
    this.cursor.style.top = (w.y - 2) + 'px';
    this.cursor.style.transform = `scale(${(1 - 0.16 * click) / push})`;
    this.cursor.style.opacity = String(smooth(inv(t, 17.6, 18.6)) * (1 - smooth(inv(t, 31, 33))));

    // the engine keeps a faint heartbeat in the canvas after the answer
    if (t > 30) {
      back.save();
      back.globalAlpha = clamp(inv(t, 30, 34)) * 0.25 * (1 - smooth(inv(t, 44, 50)));
      vortex(back, 1290, 540, t, { count: 240, radius: 260, alpha: 0.7 });
      back.restore();
    }
  }
};
