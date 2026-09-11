/**
 * FBT INTENT AI — AUTONOMY CARDS
 * ---------------------------------------------------------------------------
 * The two surfaces that make the autonomy core visible in the chat:
 *
 *   GoalPlanCard   «سودم دو برابر شود» → the arithmetic. Required APY against
 *                  the best rate that exists right now, the verdict, and a
 *                  plan whose steps the venue executors can actually sign.
 *   AutonomyCard   the loop: strategies with their real backtest, the mode it
 *                  will run in, arm/stop, and the live position list.
 *
 * Both are deliberately dumb about money. They render a plan object and call
 * the handlers they are given; nothing here computes a price, a fee or a
 * success. The card that cannot run says why, in the venue's own words.
 */
import { useMemo, useState } from 'react';

const pct = (v, d = 2) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}%` : '—');
const usd = (v, d = 0) => (Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: d })}` : '—');

const RISK_FA = Object.freeze({ low: 'کم‌ریسک', medium: 'ریسک متوسط', high: 'پرریسک' });
const MODE_FA = Object.freeze({ PAPER: 'کاغذی', ARMED: 'مسلح', LIVE: 'واقعی' });

/*
 * Venue action labels are built in the compiler in English
 * ("Supply USDC @ 4.20% APY"). The shapes are closed, so the card re-words
 * each one for a Persian reader instead of leaking raw English.
 */
function actionLabelFa(a) {
  const label = String(a?.label || '');
  const num = (label.match(/-?[\d.]+/) || [])[0];
  const asset = a?.asset || '';
  if (/^Supply\s/i.test(label)) return `سپرده ${asset}${num ? ` با نرخ ${num}٪ سالانه` : ''}`;
  if (/^Buy\s/i.test(label)) return `خرید ${asset}${num ? ` با سود ${num}٪ سالانه` : ''}`;
  if (/^Deposit into\s/i.test(label)) {
    const m = label.match(/^Deposit into\s+(.+?)\s+@/i);
    return `سپرده در ${m ? m[1] : (a?.venue || '')}${num ? ` با سود ${num}٪ سالانه` : ''}`;
  }
  if (/^Open\s/i.test(label)) {
    const m = label.match(/^Open\s+(\w+)\s+(\w+)\s+([\d.]+)x/i);
    if (m) return `باز کردن پوزیشن ${m[1] === 'short' ? 'شورت' : 'لانگ'} ${m[2]} ${m[3]}x — پرریسک`;
  }
  return label;
}

/* ══════════════════════════════════════════════════════════════════════════
   GOAL PLAN
   ══════════════════════════════════════════════════════════════════════════ */

export function GoalPlanCard({ plan, capital, locale = 'fa', busy = false, onExecute = null, onOpenRoute = null, error = null }) {
  const fa = String(locale).startsWith('fa');
  const [picked, setPicked] = useState(null);

  const option = useMemo(() => {
    if (!plan?.options?.length) return null;
    return plan.options.find((o) => o.id === picked) || plan.chosen || plan.options[0];
  }, [plan, picked]);

  if (error) {
    return (
      <div className="iaos-goal-card iaos-goal-error" data-testid="goal-plan-error">
        <p>{error}</p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="iaos-goal-card iaos-goal-loading" data-testid="goal-plan-loading">
        <p>{fa ? 'در حال خواندن نرخ‌های زنده…' : 'Reading live rates…'}</p>
      </div>
    );
  }
  if (plan.ok === false) {
    /* A refusal is an answer. It names the reason and what would unblock it. */
    const reason = {
      NO_LIVE_RATES: fa
        ? 'هیچ نرخ زنده‌ای در دسترس نیست. بدون نرخ واقعی، برنامه نمی‌سازم — چون هر عددی که بگویم حدس است.'
        : 'No live rate is available. Without a real rate I will not build a plan — any number I gave you would be a guess.',
      CAPITAL_REQUIRED: fa
        ? 'سرمایه‌ای که بتوانم رویش حساب کنم پیدا نکردم. کیف پول را وصل کن یا مبلغ را بنویس.'
        : 'I found no capital to plan against. Connect the wallet or type the amount.',
      NO_TARGET: fa
        ? 'هدفی نگفتی. مثلاً بنویس «سودم دو برابر شود» یا «۲۰٪ سود در شش ماه».'
        : 'No target given. Try "double my profit" or "20% in six months".'
    }[plan.code] || plan.code;
    return (
      <div className="iaos-goal-card iaos-goal-error" data-testid="goal-plan-refused" data-code={plan.code}>
        <p className="iaos-goal-refusal">{reason}</p>
        {plan.requiredApyPct != null ? (
          <p className="iaos-goal-meta" dir="ltr">
            required APY: {pct(plan.requiredApyPct)} · horizon: {plan.horizonDays}d
          </p>
        ) : null}
      </div>
    );
  }

  const v = plan.verdict || {};
  return (
    <div className="iaos-goal-card" data-testid="goal-plan-card" data-verdict={plan.code}>
      <div className="iaos-goal-head">
        <span className="iaos-goal-target">
          {fa ? `${Number(plan.target?.multiple || 1).toFixed(2)}× در ${plan.horizonDays} روز` : `${Number(plan.target?.multiple || 1).toFixed(2)}× in ${plan.horizonDays} days`}
        </span>
        {/* The verdict is carried as data, not only as colour: a screen reader
            and a test both need the state without parsing a class name. This
            is the same rule the settings region-availability rows are held to. */}
        <span
          className={`iaos-goal-verdict ${v.reachable ? 'is-ok' : 'is-bad'}`}
          data-verdict={v.reachable ? 'reachable' : 'not-reachable'}
          data-code={plan.code || null}
        >
          {v.reachable ? (fa ? 'شدنی' : 'Reachable') : (fa ? 'با نرخ واقعی شدنی نیست' : 'Not reachable at live rates')}
        </span>
      </div>

      <dl className="iaos-goal-nums">
        <div>
          <dt>{fa ? 'سرمایه' : 'Capital'}</dt>
          <dd>{usd(plan.capitalUsd)}</dd>
        </div>
        <div>
          <dt>{fa ? 'سود سالانه لازم' : 'APY required'}</dt>
          <dd>{pct(plan.requiredApyPct)}</dd>
        </div>
        <div>
          <dt>{fa ? 'بهترین نرخ واقعی' : 'Best live rate'}</dt>
          <dd>{pct(plan.bestAvailableApyPct)}</dd>
        </div>
        <div>
          <dt>{fa ? v.reachable ? 'زمان تا هدف' : 'نتیجه در این بازه' : v.reachable ? 'Time to target' : 'Result in horizon'}</dt>
          <dd>{v.reachable
            ? (fa ? `${Math.round(v.daysToTargetAtBestRate || 0)} روز` : `${Math.round(v.daysToTargetAtBestRate || 0)} days`)
            : `${Number(v.multipleAtHorizon || 1).toFixed(2)}× · ${usd(v.usdAtHorizon)}`}
          </dd>
        </div>
      </dl>

      <p className="iaos-goal-honesty">{plan.honesty}</p>

      {Array.isArray(plan.options) && plan.options.length ? (
        <div className="iaos-goal-options" role="list">
          {plan.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="listitem"
              className={`iaos-goal-option ${option?.id === o.id ? 'is-picked' : ''}`}
              onClick={() => setPicked(o.id)}
              data-testid={`goal-option-${o.id}`}
            >
              <span className="iaos-goal-opt-title">{o.title}</span>
              <span className="iaos-goal-opt-meta">
                <bdi dir="ltr">{pct(o.apyPct)}</bdi> · {fa ? (RISK_FA[o.risk] || o.risk) : o.risk} · {o.actions?.length || 0} {fa ? 'گام' : 'step(s)'}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {option?.actions?.length ? (
        <ol className="iaos-goal-steps">
          {option.actions.map((a, i) => (
            <li key={`${a.venue || 'step'}-${i}`}>
              <span className="iaos-goal-step-venue" dir="ltr">{a.venue || a.type}</span>
              <span className="iaos-goal-step-label">{fa ? actionLabelFa(a) : (a.label || `${a.type} ${a.asset || ''}`)}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="iaos-goal-actions">
        {onExecute && option?.actions?.length ? (
          <button
            type="button"
            className="iaos-btn iss-solid"
            disabled={busy}
            onClick={() => onExecute(option)}
            data-testid="goal-plan-execute"
          >
            {busy ? (fa ? 'در حال اجرا…' : 'Running…') : (fa ? 'اجرا با تأیید من' : 'Execute with my confirmation')}
          </button>
        ) : null}
        {onOpenRoute && option?.actions?.[0]?.chainId ? (
          <button type="button" className="iaos-btn iss-ghost" onClick={() => onOpenRoute(option.actions[0].chainId === 501 ? '/solana' : '/farm')}>
            {fa ? 'صفحه‌اش' : 'Its page'} ↗
          </button>
        ) : null}
      </div>
      <p className="iaos-goal-note">
        {fa
          ? 'هیچ تراکنشی بدون امضای تو ارسال نمی‌شود. نرخ‌ها از منبع زنده خوانده شده‌اند، نه از حافظه.'
          : 'Nothing is broadcast without your signature. Rates were read live, not remembered.'}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   AUTONOMY
   ══════════════════════════════════════════════════════════════════════════ */

export function AutonomyCard({
  strategies = [],
  engine = null,
  locale = 'fa',
  busy = false,
  onArm = null,
  onDisarm = null,
  onMode = null,
  onStart = null,
  onStop = null,
  onTick = null,
  onOpenRoute = null
}) {
  const fa = String(locale).startsWith('fa');
  const [asset, setAsset] = useState('BTC');
  const [stake, setStake] = useState(100);
  const status = engine?.status?.() || null;
  const profit = engine?.profit?.() || null;

  return (
    <div className="iaos-auto-card" data-testid="autonomy-card">
      <div className="iaos-goal-head">
        <span className="iaos-goal-target">{fa ? 'اتوماسیون' : 'Automation'}</span>
        {/* State as data, for the same reason as the goal card's verdict. */}
        <span
          className={`iaos-goal-verdict ${status?.running ? 'is-ok' : ''}`}
          data-state={status?.running ? 'running' : 'stopped'}
          data-mode={status?.mode || null}
        >
          {status?.running ? (fa ? 'در حال اجرا' : 'Running') : (fa ? 'متوقف' : 'Stopped')}
          {status?.mode ? ` · ${fa ? (MODE_FA[status.mode] || status.mode) : status.mode}` : ''}
        </span>
      </div>

      {profit ? (
        <dl className="iaos-goal-nums">
          <div><dt>{fa ? 'معامله بسته' : 'Closed'}</dt><dd>{profit.closedTrades}</dd></div>
          <div><dt>{fa ? 'نرخ برد' : 'Win rate'}</dt><dd>{profit.winRatePct == null ? '—' : `${profit.winRatePct.toFixed(0)}%`}</dd></div>
          <div><dt>{profit.paper ? (fa ? 'سود کاغذی' : 'Paper PnL') : (fa ? 'سود' : 'PnL')}</dt><dd>{usd(profit.totalUsd, 2)}</dd></div>
          <div><dt>{fa ? 'بیشترین افت' : 'Max DD'}</dt><dd>{pct(profit.maxDrawdownPct, 1)}</dd></div>
        </dl>
      ) : null}

      {profit?.paper ? (
        <p className="iaos-goal-note" data-testid="autonomy-paper-note">
          {fa
            ? 'این عدد کاغذی است: قیمت‌ها واقعی‌اند، پر شدن سفارش شبیه‌سازی شده. پولی جابه‌جا نشده.'
            : 'This number is paper: the prices are real, the fills are simulated. No money moved.'}
        </p>
      ) : null}

      {status?.protections?.haltedUntil && status.protections.haltedUntil > Date.now() ? (
        <p className="iaos-goal-refusal" data-testid="autonomy-halted">
          {fa ? `محافظ فعال شد: ${status.protections.haltReason || 'protection'} — تا کمی دیگر معامله جدید باز نمی‌شود.` : `Protection tripped: ${status.protections.haltReason || 'protection'} — no new entries until it clears.`}
        </p>
      ) : null}

      <div className="iaos-auto-strategies">
        {strategies.map((s) => (
          <div className="iaos-auto-strategy" key={s.id} data-testid={`autonomy-strategy-${s.id}`}>
            <div className="iaos-auto-strategy-head">
              <strong>{fa ? (s.titleFa || s.title) : s.title}</strong>
              {s.backtest ? (
                <span className="iaos-goal-opt-meta" dir="ltr">
                  {s.backtest.trades} {fa ? 'معامله' : 'trades'} · {s.backtest.returnPct >= 0 ? '+' : ''}{Number(s.backtest.returnPct).toFixed(1)}% · DD {Number(s.backtest.maxDrawdownPct).toFixed(1)}%
                </span>
              ) : null}
            </div>
            <p className="iaos-auto-strategy-desc">{s.description}</p>
            <div className="iaos-auto-controls">
              <input
                className="iaos-auto-input"
                value={asset}
                onChange={(e) => setAsset(e.target.value.toUpperCase().slice(0, 8))}
                aria-label={fa ? 'دارایی' : 'Asset'}
                data-testid="autonomy-asset"
              />
              <input
                className="iaos-auto-input"
                type="number"
                min="1"
                value={stake}
                onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 1))}
                aria-label={fa ? 'مبلغ هر معامله (دلار)' : 'Stake per trade (USD)'}
                data-testid="autonomy-stake"
              />
              {onArm ? (
                <button type="button" className="iaos-btn iss-solid" disabled={busy} onClick={() => onArm({ strategy: s, asset, stakeUsd: stake })} data-testid={`autonomy-arm-${s.id}`}>
                  {fa ? 'مسلح کن' : 'Arm'}
                </button>
              ) : null}
              {onDisarm && status?.automations?.some((a) => a.strategyId === s.id && a.active) ? (
                <button
                  type="button"
                  className="iaos-btn iss-ghost"
                  onClick={() => onDisarm(status.automations.find((a) => a.strategyId === s.id && a.active))}
                  data-testid={`autonomy-disarm-${s.id}`}
                >
                  {fa ? 'خلع سلاح' : 'Disarm'}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="iaos-goal-actions">
        {onMode ? (
          <select className="iaos-auto-input" value={status?.mode || 'PAPER'} onChange={(e) => onMode(e.target.value)} data-testid="autonomy-mode">
            <option value="PAPER">{fa ? 'کاغذی (بدون امضا)' : 'Paper (no signature)'}</option>
            <option value="ARMED">{fa ? 'نیمه‌خودکار (هر بار تأیید)' : 'Armed (confirm each run)'}</option>
            <option value="LIVE">{fa ? 'زنده (اجرا با امضای تو)' : 'Live (executes, you sign)'}</option>
          </select>
        ) : null}
        {onStart && !status?.running ? (
          <button type="button" className="iaos-btn iss-solid" onClick={onStart} data-testid="autonomy-start">{fa ? 'شروع حلقه' : 'Start loop'}</button>
        ) : null}
        {onStop && status?.running ? (
          <button type="button" className="iaos-btn iss-ghost" onClick={onStop} data-testid="autonomy-stop">{fa ? 'توقف' : 'Stop'}</button>
        ) : null}
        {onTick && status?.running ? (
          <button type="button" className="iaos-btn iss-ghost" onClick={onTick} disabled={busy} data-testid="autonomy-tick">{fa ? 'یک گام حالا' : 'Tick now'}</button>
        ) : null}
        {onOpenRoute ? (
          <button type="button" className="iaos-btn iss-ghost" onClick={() => onOpenRoute('/intent?tab=ops')}>{fa ? 'مرکز عملیات' : 'Ops Center'} ↗</button>
        ) : null}
      </div>

      {status?.positions?.length ? (
        <ul className="iaos-auto-positions" data-testid="autonomy-positions">
          {status.positions.map((p) => (
            <li key={p.id}>
              <span dir="ltr">{p.asset}</span>
              <span>{p.pnlPct >= 0 ? '+' : ''}{Number(p.pnlPct).toFixed(2)}%</span>
              <span className="iaos-goal-opt-meta">{usd(p.valueUsd, 2)} · {p.paper ? (fa ? 'کاغذی' : 'paper') : (fa ? 'واقعی' : 'live')}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {status?.pendingRuns ? (
        <p className="iaos-goal-note">
          {status.pendingRuns > 0
            ? (fa ? `${status.pendingRuns} اجرای در انتظار تأیید توست.` : `${status.pendingRuns} run(s) waiting for your confirmation.`)
            : (fa ? 'هیچ اجرایی در انتظار تأیید نیست.' : 'No run is waiting for confirmation.')}
        </p>
      ) : null}

      <p className="iaos-goal-note">
        {fa
          ? 'محافظ‌ها قبل از هر ورود بررسی می‌شوند: حد ضرر روزانه، بیشترین افت و دوره سکون بعد از استاپ. این اپ هیچ کلیدی نگه نمی‌دارد، پس امضا همیشه با توست.'
          : 'Protections run before any entry: daily loss cap, max drawdown, and a cooldown after a stop. This app holds no key, so the signature is always yours.'}
      </p>
    </div>
  );
}

export default GoalPlanCard;
