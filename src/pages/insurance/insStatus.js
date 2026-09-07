/** Shared insurance UI helpers (translation-safe statuses etc.). */

/** status/health/band -> locale label via i18n (raw value as fallback). */
export function statusLabel(t, v) {
  if (v == null || v === '') return '—';
  return t(`insurance.status.${v}`, { defaultValue: v });
}

/** Protection-type id -> translated name (raw id fallback). */
export function typeLabel(t, typeId) {
  if (!typeId) return '—';
  return t(`insurance.types.${typeId}`, { defaultValue: String(typeId).replace(/-/g, ' ') });
}

/** Settlement model code -> translated label (raw code fallback). */
export function settlementLabel(t, model) {
  const m = String(model || '').toUpperCase();
  if (m === 'DIRECT' || m === 'NON_CUSTODIAL') return t('insurance.providers.settlementDirect');
  if (m === 'CUSTODIAL') return t('insurance.providers.settlementCustodial');
  if (!m || m === '—') return '—';
  return t('insurance.providers.settlementOther', { model });
}

/** Claim-method code -> translated label. Free-form provider wording is kept
 *  verbatim (server-controlled certificate text). */
export function claimLabel(t, method) {
  const s = String(method || '');
  if (/nexus/i.test(s) || /assessment/i.test(s)) return t('insurance.market.claimMethods.nexus-assessment');
  if (/insurace/i.test(s)) return t('insurance.market.claimMethods.insurace-claim');
  const m = s.toLowerCase();
  if (m.includes('on-chain') || m.includes('proof-of-loss') || m === 'on-chain-proof') return t('insurance.market.claimMethods.on-chain-proof');
  if (/user-signed|personal_sign/.test(m)) return t('insurance.market.claimMethods.user-signed');
  return s || '—';
}

/**
 * Translate a provider failure reason (NO_ELIGIBLE_PROTECTION detail list)
 * without leaking raw network errors to the user. Known codes are mapped;
 * anything else becomes a single honest "no answer" line.
 */
export function reasonLabel(t, reason) {
  const s = String(reason || '');
  const known = ['NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_HTTP_ERROR', 'CHAIN_UNSUPPORTED', 'PRODUCT_UNAVAILABLE', 'QUOTE_FAILED', 'QUOTE_ERROR', 'QUOTE_REJECTED_BY_PROVIDER', 'QUOTE_UNAVAILABLE', 'QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'QUOTE_MALFORMED', 'TERMS_ACCEPTANCE_REQUIRED', 'ADAPTER_ERROR', 'DURATION_OUT_OF_RANGE', 'ASSET_UNSUPPORTED', 'COVERAGE_AMOUNT_REQUIRED', 'VALID_WALLET_REQUIRED', 'PRODUCT_REQUIRED', 'CAPACITY_UNAVAILABLE', 'HEALTH_UNKNOWN', 'ACTIVATION_FAILED', 'COVERAGE_NOT_VERIFIED', 'PURCHASE_INPUTS_UNAVAILABLE', 'NO_ELIGIBLE_PROTECTION', 'INTENT_FAILED', 'TIMEOUT'];
  const hit = known.find((k) => s.toUpperCase().includes(k));
  if (hit) return t(`insurance.reason.${hit}`, { defaultValue: s });
  // Network/timeout English leaks (ENOTFOUND / HTTP 4xx / timeout…) → honest generic line.
  if (/timeout|timed out|fetch|enetrefused|enotfound|network|ECONN/i.test(s)) return t('insurance.reason.PROVIDER_UNAVAILABLE');
  if (/HTTP \d|status|4\d\d|5\d\d/i.test(s)) return t('insurance.reason.QUOTE_REJECTED_BY_PROVIDER');
  // Bare internal codes (e.g. QUOTE_NOT_FOUND) must never leak as UI text.
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(s)) return t('insurance.reason.QUOTE_UNAVAILABLE');
  return s; // provider-specific certificate text; kept verbatim (server-controlled)
}
