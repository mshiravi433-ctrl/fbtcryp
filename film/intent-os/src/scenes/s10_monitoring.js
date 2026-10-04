/* SCENE 10 · 07:35–08:20 · MONITORING
   Hours pass in seconds, then the film drops into slow motion the moment a
   condition changes. Monitoring is what turns an action into a workflow. */
import { el, brandLockup, monitorPanel, portfolioPanel } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, text, series, rng, TAU, room } from '../lib/fx.js';
import { marketWall } from '../lib/kit.js';

export default {
  id: 'sc10',
  title: 'Monitoring',
  t0: 455, t1: 500,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    const top = el('div', { position: 'absolute', top: '0', left: '0', right: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.7)' });
    top.appendChild(brandLockup(22, { sub: 'MONITORING' }));
    const hb = el('div', { display: 'flex', gap: '12px' });
    const clock = el('div', 'mono');
    clock.style.cssText = 'font-size:12.5px;letter-spacing:.18em;color:#93a3c4;padding:8px 14px;border:1px solid rgba(255,255,255,.12);border-radius:9px';
    hb.appendChild(clock);
    hb.appendChild(el('div', 'badge blue', '<span class="led"></span>LIVE'));
    top.appendChild(hb);
    world.appendChild(top);
    this.clock = clock;

    const port = portfolioPanel({ compact: true });
    port.style.cssText = 'position:absolute;left:46px;top:112px;width:520px;opacity:0';
    world.appendChild(port);
    this.port = port;

    const mon = monitorPanel({ compact: false });
    mon.style.cssText = 'position:absolute;right:46px;top:112px;opacity:0';
    world.appendChild(mon);
    this.mon = mon;

    // the alert
    const alert = el('div', 'card');
    alert.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);padding:26px 32px;width:640px;opacity:0;border-color:rgba(255,180,87,.35)';
    alert.innerHTML = `<div class="row between"><div class="label" style="color:#ffb457">MARKET CONDITION CHANGED</div><div class="badge amber"><span class="led"></span>REVIEW RECOMMENDED</div></div>
      <div style="font-size:21px;line-height:1.5;margin-top:18px">Volatility has increased. Your current exposure has changed.</div>
      <div class="row between" style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07)">
        <div class="tiny">A condition changed — not a recommendation to trade.</div>
        <div class="btn ghost">Review in Intent OS</div>
      </div>`;
    world.appendChild(alert);
    this.alert = alert;

    // the assistant's explanation — the same session, still running
    const ask = el('div', 'card');
    ask.style.cssText = 'position:absolute;left:46px;top:620px;width:520px;padding:20px 22px;opacity:0';
    ask.innerHTML = `<div class="row between"><div class="label">INTENT OS</div><div class="badge blue"><span class="led"></span>SESSION ACTIVE</div></div>
      <div style="font-size:17px;line-height:1.5;margin-top:14px">Volatility has increased. Your current exposure has changed.</div>
      <div class="tiny" style="margin-top:10px">Largest position drifted above the band you approved.</div>`;
    world.appendChild(ask);
    this.ask = ask;

    // the workflow picks itself back up
    const resume = el('div', 'card flat');
    resume.style.cssText = 'position:absolute;right:46px;top:420px;width:520px;padding:20px 22px;opacity:0';
    resume.innerHTML = `<div class="row between"><div class="label" data-pass>MONITORING PASS #1</div><div class="badge mint"><span class="led"></span>RUNNING</div></div>
      <div style="margin-top:14px">
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;opacity:0" data-check><span data-d style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.16)"></span><span style="font-size:13.5px">Exposure above approved band</span></div>
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;opacity:0" data-check><span data-d style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.16)"></span><span style="font-size:13.5px">Liquidity within tolerance</span></div>
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;opacity:0" data-check><span data-d style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.16)"></span><span style="font-size:13.5px">Next review queued — user decides</span></div>
      </div>`;
    world.appendChild(resume);
    this.resume = resume;

    const cap = el('div', { position: 'absolute', left: '0', right: '0', bottom: '58px', textAlign: 'center', opacity: '0' });
    cap.innerHTML = `<div class="kicker" style="letter-spacing:.4em">A WORKFLOW DOESN'T END WHEN A TRANSACTION DOES</div>`;
    world.appendChild(cap);
    this.cap = cap;

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(28,62,128,0.58)' });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    /* BEATS
       0–2    the desk arrives: portfolio, monitoring, volatility
       2–10   time-lapse: the market wall runs, hours pass in seconds
       10–13  HARD SLOW-DOWN — the world nearly stops
       12.5–  MARKET CONDITION CHANGED, then the explanation
       20–    REVIEW RECOMMENDED → the session resumes
       30–    the thesis line                                             */
    const slowK = smooth(inv(t, 10.0, 12.4));         // 0 = time-lapse, 1 = real time
    const wt = t < 10 ? t : 10 + (t - 10) * 0.10;      // world time
    const hours = 7 + Math.floor(wt * 2.1);
    const mins = Math.floor((wt * 37.3) % 60);
    this.clock.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} UTC · ${slowK > 0.6 ? 'LIVE' : '×60 TIMELAPSE'}`;

    const push = kf(t, [[0, 1.05], [10, 1.02], [16, 1.0], [24, 1.04], [34, 1.01], [45, 1.0]]);
    this.world.style.transform = `translate3d(${lerp(-14, 8, smooth(inv(t, 0, 28)))}px, 0, 0) scale(${push})`;

    // ── 0–10 · the time-lapse wall ─────────────────────────────────────
    const wallK = smooth(inv(t, 0.6, 2.2)) * (1 - smooth(inv(t, 13.5, 16.5)));
    if (wallK > 0.01) {
      back.save();
      back.globalAlpha = wallK;
      marketWall(back, 120, 118, 1680, 570, wt * 3.4, { rows: 3, cols: 5, alpha: wallK });
      // the wall itself accelerates then stops
      back.globalAlpha = wallK * 0.5 * (1 - slowK);
      for (let i = 0; i < 5; i++) {
        const y = 130 + i * 110;
        back.strokeStyle = 'rgba(120,180,255,0.35)';
        back.lineWidth = 1;
        const x = 120 + ((wt * (900 + i * 260)) % 1600);
        back.beginPath(); back.moveTo(x, y); back.lineTo(x + 90, y); back.stroke();
      }
      back.restore();
    }

    // smart-money flows streaming while the world runs fast
    if (t > 1.4 && t < 13) {
      const k = smooth(inv(t, 1.4, 3.0)) * (1 - smooth(inv(t, 11, 13)));
      const r = rng(91);
      back.save();
      back.globalAlpha = k * 0.55 * (1 - 0.5 * slowK);
      addBlend(back, true);
      const spr = sprite('rgba(120,200,255,1)', 0.5);
      for (let i = 0; i < 70; i++) {
        const y = 140 + r() * 520;
        const x0 = 160 + ((wt * (320 + r() * 620)) % 1520);
        drawSprite(back, spr, x0, y, 26 + r() * 90, 0.10 + 0.14 * r());
      }
      addBlend(back, false);
      back.restore();
    }

    // volatility line: calm, then a step up as the condition changes
    const volK = smooth(inv(t, 2.4, 5.0));
    if (volK > 0.01) {
      const base = series(131, 90, { base: 22, vol: 1.5, drift: 0.05 });
      const jump = smooth(inv(t, 12.6, 15.5)) * 9;
      back.save();
      back.globalAlpha = volK * 0.95;
      const pts = base.map((v, i) => ({ x: 1180 + i * 7.2, y: 790 - ((v + (i > 62 ? jump * (i - 62) / 28 : 0)) - 20) * 6 }));
      back.strokeStyle = t > 12.4 ? 'rgba(255,180,87,0.95)' : 'rgba(90,170,255,0.85)';
      back.lineWidth = 2;
      back.beginPath();
      pts.forEach((p, i) => i ? back.lineTo(p.x, p.y) : back.moveTo(p.x, p.y));
      back.stroke();
      text(back, 'VOLATILITY · 24H', 1180, 845, { size: 13, weight: 600, family: "'JetBrains Mono'", ls: '0.18em', color: '#7c8fb5', alpha: volK });
      back.restore();
    }

    // ── panels ─────────────────────────────────────────────────────────
    const portK = smooth(inv(t, 0.6, 2.0));
    this.port.style.opacity = String(portK);
    this.port.style.transform = `translateY(${(1 - portK) * 18}px)`;
    const monK = smooth(inv(t, 1.6, 3.2));
    this.mon.style.opacity = String(monK);
    this.mon.style.transform = `translateY(${(1 - monK) * 18}px)`;

    const valueNode = this.port.querySelector('div[style*="font-size:32px"], div[style*="font-size:22px"]');
    if (valueNode) {
      const wob = Math.sin(wt * 1.4) * 130 + Math.sin(wt * 3.1) * 45;
      const v = 44922 + wob + smooth(inv(t, 12, 16)) * 260;
      valueNode.textContent = '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '.00';
      valueNode.style.color = t > 12.4 ? '#ffd9a3' : '';
    }

    // ── 12.5– · the alert, then the explanation ────────────────────────
    const alertK = smooth(inv(t, 12.6, 14.2));
    this.alert.style.opacity = String(alertK);
    this.alert.style.transform = `translate(-50%,-50%) scale(${lerp(0.96, 1, smooth(inv(t, 12.6, 15.4)))})`;
    this.alert.style.boxShadow = `0 30px 90px rgba(0,0,0,.7), 0 0 ${30 + 26 * (0.5 + 0.5 * Math.sin(t * 2.2))}px rgba(255,180,87,.12)`;
    this.port.style.opacity = String(portK * (1 - 0.35 * alertK));
    this.mon.style.opacity = String(monK * (1 - 0.35 * alertK));

    // notification ring
    if (t > 12.5 && t < 18) {
      const k = inv(t, 12.5, 18);
      back.save();
      back.globalAlpha = (1 - k) * 0.30;
      back.strokeStyle = 'rgba(255,180,87,0.9)';
      back.lineWidth = 1.5;
      back.beginPath(); back.arc(960, 540, 130 + k * 820, 0, TAU); back.stroke();
      back.globalAlpha = (1 - k) * 0.16;
      back.beginPath(); back.arc(960, 540, 60 + k * 560, 0, TAU); back.stroke();
      back.restore();
    }

    // the assistant's line, from the session that is being monitored
    const askK = smooth(inv(t, 15.6, 17.4));
    this.ask.style.opacity = String(askK * (1 - smooth(inv(t, 26.5, 29))));
    this.ask.style.transform = `translateX(${(1 - askK) * 26}px)`;

    // ── 20– · the session resumes ──────────────────────────────────────
    const resumeK = smooth(inv(t, 20.6, 22.6));
    this.resume.style.opacity = String(resumeK * (1 - smooth(inv(t, 33, 36))));
    this.resume.style.transform = `translateY(${(1 - resumeK) * 22}px)`;
    const pass = Math.min(3, 1 + Math.floor(Math.max(0, t - 22) / 6));
    this.resume.querySelector('[data-pass]').textContent = `MONITORING PASS #${pass}`;
    this.resume.querySelectorAll('[data-check]').forEach((n, i) => {
      const k = smooth(inv(t, 22.6 + i * 0.9, 23.8 + i * 0.9));
      n.style.opacity = String(k);
      const dot = n.querySelector('[data-d]');
      if (dot && k > 0.6) { dot.style.background = i === 0 ? '#ffb457' : '#46d9a8'; dot.style.boxShadow = `0 0 12px ${i === 0 ? '#ffb457' : '#46d9a8'}`; }
    });

    const capK = smooth(inv(t, 31, 33.6));
    this.cap.style.opacity = String(capK * (1 - smooth(inv(t, 43, 45))));
    this.cap.style.transform = `translateY(${(1 - capK) * 12}px)`;

    dustField(back, camera({ px: 0, py: 0, pz: 0, fov: 42 }), t, { count: 60, seed: 93, spread: 1000, focus: 950, color: 'rgba(150,200,255,1)' });
    void front; void kf; void clamp;
  }
};
