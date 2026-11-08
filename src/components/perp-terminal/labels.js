/**
 * The words the terminal uses for facts the engine produces.
 *
 * Kept out of the components so a label cannot drift between the ticket, the
 * position list and the risk panel — the same reason the numbers come from one
 * module. Every entry falls back to a default when the translation is missing,
 * so a locale that has not been filled in still prints a truthful English
 * sentence rather than a raw key.
 */

/**
 * How a liquidation price was derived — the one label that must never be
 * skipped, because an exact venue number and a 100%-loss bound are otherwise
 * the same shape on screen.
 *
 *   venue-maintenance-margin  the venue published the maintenance fraction
 *   venue-rule                a rule the venue documents (Ostium)
 *   upper-bound               nothing published: 100% loss, must be named
 *   unavailable               there is no price to label
 */
export function liquidationProvenanceLabel(t, provenance) {
  const key = `perpTerminal.liq.provenance.${provenance || 'unavailable'}`;
  const defaults = {
    'venue-maintenance-margin': 'exact · venue maintenance margin',
    'venue-rule': 'exact · venue documented rule',
    'upper-bound': 'approximate · 100% loss bound',
    unavailable: 'not available'
  };
  return t(key, { defaultValue: defaults[provenance] || defaults.unavailable });
}

/** A venue's status in the words a trader expects, from the provider registry. */
export function venueStatusLabel(t, status) {
  const s = String(status || '').toUpperCase();
  const defaults = {
    AVAILABLE: 'live',
    DEGRADED: 'degraded',
    READ_ONLY: 'read only',
    MAINTENANCE: 'maintenance',
    UNREACHABLE: 'unreachable',
    NOT_CONFIGURED: 'not configured'
  };
  if (!s) return t('perpTerminal.venue.status.unknown', { defaultValue: 'status unknown' });
  return t(`perpTerminal.venue.status.${s}`, { defaultValue: defaults[s] || s.toLowerCase() });
}

/** Why a ticket refused, in a sentence. The code is kept for logs and tests. */
export function blockReasonLabel(t, code) {
  if (!code) return null;
  const defaults = {
    UNKNOWN_VENUE: 'This venue is not in the catalogue.',
    EXECUTION_NOT_MOUNTED: 'This build does not send orders to this venue yet.',
    NO_SIZE: 'Enter a collateral amount and a leverage.',
    NO_PRICE: 'The venue has not returned a price for this market.',
    PRICE_REQUIRED: 'A limit order needs a price.',
    STOP_PRICE_REQUIRED: 'A stop order needs a trigger price.',
    ORDER_TYPE_NOT_SUPPORTED: 'This venue does not accept that order type.',
    POST_ONLY_NOT_SUPPORTED: 'This venue cannot rest a maker-only order here.',
    POST_ONLY_REQUIRES_LIMIT: 'Post-only only applies to limit orders.',
    POST_ONLY_REQUIRES_GTC: 'Post-only must be Good-Til-Cancelled.',
    TIME_IN_FORCE_NOT_SUPPORTED: 'This venue does not accept that time in force.',
    REDUCE_ONLY_NOT_SUPPORTED: 'This venue does not accept reduce-only here.',
    TPSL_NOT_SUPPORTED: 'This venue cannot attach a TP/SL leg.',
    LEVERAGE_ABOVE_VENUE_MAX: 'The leverage is above what this market allows.',
    BELOW_MIN_NOTIONAL: 'The order is below the venue minimum notional.'
  };
  return t(`perpTerminal.ticket.blocked.${code}`, { defaultValue: defaults[code] || code });
}
