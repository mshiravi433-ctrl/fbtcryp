/**
 * chartGuideTeacher — THE ON-DEVICE TEACHER FOR «راهنمای نمودار»
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── WHY THIS IS NOT A NETWORK CALL ───────────────────────────────────────
 * The screen is a tutorial that must work on a phone in a tunnel, in a
 * classroom with the wifi off, and in the embedded WebView where the app's AI
 * routes may be unreachable. A teacher that answers "شبکه در دسترس نیست" on
 * the page whose whole job is to explain is worse than no teacher at all.
 *
 * So the teacher is a small, deterministic reasoner: it classifies the
 * question, resolves which tool the reader is asking about (the open one, or
 * one they named), and answers from the SAME five fields the lesson card is
 * built from — plus the live numbers of the chart on screen. Every sentence it
 * can say is in the locale files, so it speaks the reader's language and can be
 * audited; nothing is invented at runtime.
 *
 * ─── WHAT IT IS HONEST ABOUT ──────────────────────────────────────────────
 *   · It is labelled «روی دستگاه» on the panel: no message leaves the phone.
 *   · It will not give a buy/sell call. A question that asks for one is
 *     answered with the risk framing and a shortcut to the P&L tool, not with
 *     a direction. That refusal is a feature and is tested.
 *   · Its numbers are the chart's numbers. If it quotes an RSI, that RSI is on
 *     the strip two inches above the sentence.
 */
import { RANGE_SPEC, TOOL_BY_ID, TOOL_IDS } from './chartGuideData';

/**
 * Words that name a tool, in the reader's own language and in the trading
 * shorthand people actually type. The localized label is checked too (see
 * `detectTool`), so a Persian label "میانگین متحرک" works without being listed
 * here; these are the extras that make "rsi" or "بولینگر" work while the
 * reader is looking at the candle lesson.
 */
const TOOL_ALIASES = {
  candle: ['شمع', 'کندل', 'candle', 'body', 'بدنه', 'سایه', 'wick'],
  trend: ['میانگین', 'ma', 'ma7', 'ma25', 'sma', 'متوسط', 'کراس', 'cross'],
  ema: ['ema', 'ema21', 'ema55', 'اکسپوننشیال', 'نمایی'],
  band: ['bb', 'bollinger', 'bolinger', 'بولینگر', 'باند', 'squeeze', 'فشردگی'],
  rsi: ['rsi', 'اشباع', 'قدرت نسبی', 'oscillator'],
  volume: ['حجم', 'volume', 'vol'],
  fib: ['fib', 'فیبو', 'فیبوناچی', 'fibonacci', 'ریتریس'],
  pnl: ['سود', 'ضرر', 'حد ضرر', 'stop', 'target', 'هدف', 'rr', 'ریسک'],
  log: ['log', 'لگاریتم', 'مقیاس', 'scale'],
  future: ['آینده', 'future', 'پیشبینی', 'forecast', 'predict', 'بعد']
};

/** Persian/Arabic normalisation: one shape per letter, no zero-width joiner. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[؟?!.,،:؛;"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intent, most specific first. A question can contain several of these words
 * ("این چیه و کِی سود میده"); the FIRST match wins, and the order below is the
 * order a reader cares about: money before definition, time before method.
 */
const INTENT_RULES = [
  { id: 'signal', words: ['سیگنال', 'بخرم', 'بفروشم', 'بخرم؟', 'خرید کنم', 'بفروشم؟', 'کدوم رو', 'چی بخرم', 'should i buy', 'buy or sell', 'entry now'] },
  { id: 'profit', words: ['سود', 'پروفیت', 'profit', 'target', 'تارگت', 'هدف', 'سودده', 'پول در'] },
  { id: 'loss', words: ['ضرر', 'لاس', 'loss', 'ریسک', 'risk', 'stop', 'استاپ', 'حد ضرر', 'میافتم', 'افت'] },
  { id: 'time', words: ['آینده', 'گذشته', 'future', 'past', 'قبلی', 'پیشبینی', 'forecast', 'predict', 'بعد', 'کِی', 'کی'] },
  { id: 'how', words: ['چطور', 'چگونه', 'how', 'استفاده', 'بزنم', 'تنظیم', 'کار میکنه', 'کار میکند'] },
  { id: 'what', words: ['چیه', 'چیست', 'یعنی', 'what', 'توضیح', 'یعنی چی', 'چی کار'] }
];

/** Which intent does this question carry? Defaults to `what`. */
export function classifyIntent(question) {
  const q = normalize(question);
  if (!q) return 'what';
  for (const rule of INTENT_RULES) {
    if (rule.words.some((w) => q.includes(normalize(w)))) return rule.id;
  }
  return 'what';
}

/** Does the reader name a tool other than the open one? */
export function detectTool(question, t = (k) => k) {
  const q = normalize(question);
  if (!q) return null;
  for (const id of TOOL_IDS) {
    const label = normalize(t(`lab2.cgx.tools.${id}.label`));
    if (label && label.length > 2 && q.includes(label)) return id;
    if ((TOOL_ALIASES[id] ?? []).some((a) => q.includes(normalize(a)))) return id;
  }
  return null;
}

/** The window a tool ranges over, in the reader's language. */
const rangeLabel = (t, range) => t(`lab2.cgx.range.${range}`, { defaultValue: range });

/**
 * Build one live sentence about the chart, in the tool's own terms.
 *
 * These are the numbers the teacher quotes back. They come from the SAME
 * derived state the page hands the chart, so the teacher cannot drift from the
 * pixels — a mismatch here would read as the AI hallucinating.
 */
export function liveSentence(toolId, live, t) {
  const l = live ?? {};
  const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const key = `lab2.cgx.teacher.live.${toolId}`;
  return t(key, {
    defaultValue: t('lab2.cgx.teacher.live.generic', {
      defaultValue: 'قیمت {{price}} است و تغییر این بازه {{change}}٪.',
      price: n(l.price),
      change: n(l.change, 1)
    }),
    price: n(l.price),
    change: n(l.change, 1),
    open: n(l.open),
    close: n(l.close),
    high: n(l.high),
    low: n(l.low),
    range: n(l.range, 1),
    ma7: n(l.ma7),
    ma25: n(l.ma25),
    gap: n(l.gap, 2),
    ema21: n(l.ema21),
    ema55: n(l.ema55),
    rsi: n(l.rsi, 1),
    volume: n(l.volume, 0),
    volumeMax: n(l.volumeMax, 0),
    fib: n(l.fib),
    entry: n(l.entry),
    stop: n(l.stop),
    target: n(l.target),
    rr: n(l.rr, 1),
    atr: n(l.atr, 2),
    window: rangeLabel(t, l.rangeId)
  });
}

/**
 * The greeting the teacher posts when a tool opens. Short on purpose: the
 * lesson card already carries the full explanation, so the teacher's opening
 * line is the *live* reading — the one thing the card cannot know.
 */
export function briefing(toolId, live, t) {
  const tool = TOOL_BY_ID[toolId] ?? TOOL_BY_ID.candle;
  return {
    role: 'teacher',
    kind: 'briefing',
    text: liveSentence(tool.id, live, t),
    chips: buildChips(tool.id, live, t),
    toolId: tool.id
  };
}

/** Three numbers that make the sentence checkable. */
export function buildChips(toolId, live, t) {
  const l = live ?? {};
  const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const map = {
    candle: [
      { label: t('lab2.cgx.facts.price'), value: n(l.price) },
      { label: t('lab2.cgx.facts.change'), value: `${n(l.change, 1)}%`, tone: l.change >= 0 ? 'up' : 'down' },
      { label: t('lab2.cgx.facts.range'), value: `${n(l.low, 1)}–${n(l.high, 1)}` }
    ],
    trend: [
      { label: 'MA7', value: n(l.ma7) },
      { label: 'MA25', value: n(l.ma25) },
      { label: t('lab2.cgx.facts.gap'), value: `${n(l.gap, 2)}%` }
    ],
    ema: [
      { label: 'EMA21', value: n(l.ema21) },
      { label: 'EMA55', value: n(l.ema55) },
      { label: t('lab2.cgx.facts.price'), value: n(l.price) }
    ],
    band: [
      { label: t('lab2.cgx.facts.bandLow'), value: n(l.low, 1) },
      { label: t('lab2.cgx.facts.bandHigh'), value: n(l.high, 1) },
      { label: t('lab2.cgx.facts.width'), value: `${n(l.range, 1)}%` }
    ],
    rsi: [
      { label: 'RSI', value: n(l.rsi, 1) },
      { label: t('lab2.cgx.facts.price'), value: n(l.price) },
      { label: t('lab2.cgx.facts.change'), value: `${n(l.change, 1)}%`, tone: l.change >= 0 ? 'up' : 'down' }
    ],
    volume: [
      { label: t('lab2.cgx.facts.volume'), value: n(l.volume, 0) },
      { label: t('lab2.cgx.facts.volumeMax'), value: n(l.volumeMax, 0) },
      { label: t('lab2.cgx.facts.price'), value: n(l.price) }
    ],
    fib: [
      { label: t('lab2.cgx.facts.fib'), value: n(l.fib) },
      { label: t('lab2.cgx.facts.low'), value: n(l.low, 1) },
      { label: t('lab2.cgx.facts.high'), value: n(l.high, 1) }
    ],
    pnl: [
      { label: t('lab2.cgx.facts.entry'), value: n(l.entry) },
      { label: t('lab2.cgx.facts.stop'), value: n(l.stop) },
      { label: t('lab2.cgx.facts.rr'), value: `${n(l.rr, 1)}×` }
    ],
    log: [
      { label: t('lab2.cgx.facts.low'), value: n(l.low, 1) },
      { label: t('lab2.cgx.facts.high'), value: n(l.high, 1) },
      { label: t('lab2.cgx.facts.change'), value: `${n(l.change, 1)}%` }
    ],
    future: [
      { label: t('lab2.cgx.facts.atr'), value: n(l.atr) },
      { label: t('lab2.cgx.facts.price'), value: n(l.price) },
      { label: t('lab2.cgx.facts.window'), value: rangeLabel(t, l.rangeId) }
    ]
  };
  return map[toolId] ?? map.candle;
}

/**
 * Answer one question.
 *
 * Returns an object the panel can render directly:
 *   { role:'reader' | 'teacher', text, chips, action, toolId }
 *
 * `action` is offered as a button — "show me that on the chart" — which is how
 * the teacher becomes useful instead of merely chatty: asking about RSI while
 * the candle lesson is open switches the chart to RSI in one tap.
 */
export function ask(question, context, t) {
  const { toolId: openTool = 'candle', live = {} } = context ?? {};
  const intent = classifyIntent(question);
  const named = detectTool(question, t);
  const toolId = named ?? openTool;
  const tool = TOOL_BY_ID[toolId] ?? TOOL_BY_ID.candle;
  const name = t(`lab2.cgx.tools.${tool.id}.label`, { defaultValue: tool.id });

  /* A reader asking for a call gets the risk framing, never a direction. */
  if (intent === 'signal') {
    return {
      role: 'teacher',
      intent,
      toolId,
      text: t('lab2.cgx.teacher.reply.signal', {
        defaultValue:
          'من سیگنال خرید و فروش نمی‌دهم و این صفحه هم جای توصیهٔ معاملاتی نیست. کاری که می‌توانم بکنم این است: با «سود و ضرر» ببین حد ضرر و هدف کجای نمودار می‌افتند و نسبت پاداش به ریسک چقدر می‌شود.',
        name
      }),
      action: named ? null : { tool: 'pnl', label: t('lab2.cgx.teacher.showOnChart', { defaultValue: 'روی نمودار نشانم بده' }) }
    };
  }

  const body = t(`lab2.cgx.tools.${tool.id}.${intent === 'how' ? 'how' : intent}`, {
    defaultValue: t(`lab2.cgx.tools.${tool.id}.what`, { defaultValue: '' })
  });

  const lead = t(`lab2.cgx.teacher.reply.${intent}`, {
    defaultValue: t('lab2.cgx.teacher.reply.what', { defaultValue: '{{name}}: {{body}}' }),
    name,
    body
  });

  /* The live line is appended only when it adds something: a definition does
     not need today's price, but "when does it go wrong" does. */
  const withLive = intent === 'profit' || intent === 'loss' || intent === 'time' || intent === 'how';
  const text = withLive ? `${lead} ${liveSentence(tool.id, live, t)}` : lead;

  return {
    role: 'teacher',
    intent,
    toolId,
    text,
    chips: intent === 'what' ? [] : buildChips(tool.id, live, t),
    /* Offering the jump is only honest when the chart is showing something
       else; a button that switches the chart to what is already on it is a
       dead control, which is the exact defect this round exists to remove. */
    action:
      tool.id !== openTool
        ? { tool: tool.id, label: t('lab2.cgx.teacher.showOnChart', { defaultValue: 'روی نمودار نشانم بده' }) }
        : null
  };
}

/** The quick prompts the panel offers — one per intent that has a real answer. */
export const QUICK_PROMPTS = ['what', 'profit', 'loss', 'time', 'how'];

export function quickPromptText(id, toolId, t) {
  return t(`lab2.cgx.teacher.quick.${id}`, {
    defaultValue: id,
    name: t(`lab2.cgx.tools.${toolId}.label`, { defaultValue: toolId })
  });
}

/** Re-exported for the page: the bars per range, mirrored from the chart. */
export const BARS_PER_RANGE = Object.fromEntries(
  Object.entries(RANGE_SPEC).map(([id, spec]) => [id, spec.bars])
);
