/**
 * Fail-closed privacy-mode decisions shared by Intent OS and Swap.
 *
 * A URL flag is a security boundary here, not a cosmetic preference. The
 * ordinary Swap screen must not quote or execute when an Intent requested a
 * confidential transport that is not operational.
 */

export const CONFIDENTIAL_PRIVACY = 'confidential';

export function privacyModeFromSearch(search = '') {
  try {
    const params = search instanceof URLSearchParams
      ? search
      : new URLSearchParams(String(search).replace(/^\?/, ''));
    /* Duplicate query keys must not make enforcement order-dependent. If any
       exact privacy value requests confidential handling, fail closed. */
    return params.getAll('privacy').includes(CONFIDENTIAL_PRIVACY)
      ? CONFIDENTIAL_PRIVACY
      : 'standard';
  } catch {
    return 'standard';
  }
}

export function isConfidentialPrivacy(search = '') {
  return privacyModeFromSearch(search) === CONFIDENTIAL_PRIVACY;
}

/**
 * Confidential selection is enabled only when every prerequisite is reported
 * positively by the server. Missing/older capability fields therefore disable
 * the option instead of being interpreted as support.
 */
export function confidentialSwapReadiness(capabilities) {
  const status = capabilities?.commitReveal;
  const available = Boolean(
    capabilities?.ok
    && status?.available === true
    && status?.frontendIntegrated === true
    && status?.durablePrivateStorage === true
    && status?.requesterAuthentication === true
    && status?.earlyRevealProtection === true
  );

  return {
    available,
    code: available ? null : String(status?.unavailableReason || 'CONFIDENTIAL_MODE_UNAVAILABLE')
  };
}
