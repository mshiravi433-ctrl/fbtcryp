/*
 * DISPLAY-ONLY SOLANA QUOTE HELPERS
 * ---------------------------------------------------------------------------
 * These functions format information already returned by a quote provider.
 * They never choose a transaction or alter the signing/build path.
 */

function asPositiveBigInt(value) {
  if (value == null || !/^\d+$/.test(String(value))) return null;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalize provider price impact to percentage points.
 *
 * OpenOcean and explicit percent strings already use percentage points
 * (`"0.01%"` means 0.01%). LI.FI and both Jupiter quote APIs return a unit
 * fraction when the value has no percent sign (`0.01` means 1%), so those are
 * converted here. Unknown providers and malformed values remain unknown
 * instead of being displayed as 0.
 */
export function solanaPriceImpactPercent(value, provider) {
  if (value == null || value === '') return null;
  const source = String(value).trim().replace(/\s+/g, '');
  const explicitPercent = source.endsWith('%');
  let numeric = source.replace(/%$/, '');
  if (/^-?\d+,\d+$/.test(numeric)) numeric = numeric.replace(',', '.');
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return null;

  const alreadyPercent = explicitPercent || provider === 'openocean';
  if (!alreadyPercent && !['lifi', 'jupfee', 'jupiter'].includes(provider)) return null;
  const percent = alreadyPercent ? parsed : parsed * 100;
  return Number.isFinite(percent) ? percent : null;
}

/**
 * Return the route's actual minimum-output threshold when supplied. If the
 * route omitted it, derive the configured slippage floor from its quoted
 * output. The UI does not invent a minimum when either source is invalid.
 */
export function solanaMinimumReceivedRaw({ outAmount, minOutAmount, slippageBps }) {
  const output = asPositiveBigInt(outAmount);
  if (output == null) return null;

  const routeMinimum = asPositiveBigInt(minOutAmount);
  if (routeMinimum != null && routeMinimum <= output) return routeMinimum.toString();

  if (slippageBps == null || slippageBps === '') return null;
  const bps = Number(slippageBps);
  if (!Number.isFinite(bps)) return null;
  const boundedBps = Math.min(10000, Math.max(0, Math.round(bps)));
  const floor = (output * BigInt(10000 - boundedBps)) / 10000n;
  return floor > 0n ? floor.toString() : null;
}

/**
 * Rank quotes by raw output without floating-point comparison. `provider` is
 * retained so the row that the page actually selected can be marked as such.
 */
export function compareSolanaQuotes(quotes = [], selectedProvider = null) {
  const valid = (Array.isArray(quotes) ? quotes : [])
    .map((quote, index) => ({ quote, index, output: asPositiveBigInt(quote?.outAmount) }))
    .filter((row) => row.output != null)
    .sort((a, b) => {
      if (a.output === b.output) return a.index - b.index;
      return a.output > b.output ? -1 : 1;
    });

  if (!valid.length) return [];
  const highest = valid[0].output;
  const selected = valid.find((row) => row.quote?.provider === selectedProvider) ?? valid[0];

  return valid.map(({ quote, output }) => {
    const difference = highest - output;
    const differenceBps = highest > 0n ? Number((difference * 10000n) / highest) : 0;
    return {
      quote,
      isSelected: quote?.provider === selected.quote?.provider,
      isHighestOutput: output === highest,
      differenceRaw: difference.toString(),
      differencePct: differenceBps / 100
    };
  });
}

/**
 * Format a base-unit-derived decimal string without converting it through a
 * binary float. This keeps small SPL values and large balances readable.
 */
export function formatSolanaAmount(value, locale = 'en', maxFractionDigits = 9) {
  if (value == null || value === '') return '—';
  const text = String(value).trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return text;

  const [, sign, rawWhole, rawFraction = ''] = match;
  const decimals = Math.min(18, Math.max(0, Number.isInteger(Number(maxFractionDigits)) ? Number(maxFractionDigits) : 9));
  const fraction = rawFraction.slice(0, decimals).replace(/0+$/, '');
  const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0';
  let groupedWhole = whole;
  let decimalSeparator = '.';
  let minusSign = '-';
  let digitMap = '0123456789';

  try {
    const wholeFormatter = new Intl.NumberFormat(locale || 'en', {
      useGrouping: true,
      maximumFractionDigits: 0
    });
    groupedWhole = wholeFormatter.format(BigInt(whole));
    const parts = new Intl.NumberFormat(locale || 'en', { useGrouping: false }).formatToParts(1.1);
    decimalSeparator = parts.find((part) => part.type === 'decimal')?.value || '.';
    minusSign = parts.find((part) => part.type === 'minusSign')?.value || '-';
    const digitFormatter = new Intl.NumberFormat(locale || 'en', { useGrouping: false, maximumFractionDigits: 0 });
    digitMap = Array.from({ length: 10 }, (_, digit) => digitFormatter.format(digit)).join('');
  } catch {
    /* A legacy or malformed locale falls back to the exact ASCII string. */
  }

  const localizeDigits = (digits) => digits.replace(/\d/g, (digit) => digitMap[Number(digit)] ?? digit);
  return `${sign ? minusSign : ''}${groupedWhole}${fraction ? `${decimalSeparator}${localizeDigits(fraction)}` : ''}`;
}

/** Percentage points are localized as a number; the caller supplies the
 * locale's translated percent sign so every route uses the same notation. */
export function formatSolanaPercent(value, locale = 'en', maximumFractionDigits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  try {
    return new Intl.NumberFormat(locale || 'en', {
      minimumFractionDigits: 0,
      maximumFractionDigits
    }).format(numeric);
  } catch {
    return numeric.toFixed(maximumFractionDigits);
  }
}
