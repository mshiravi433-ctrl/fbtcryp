/**
 * DISCOVERY SECURITY — URL validation and anti-phishing checks for the
 * Web3 Discovery Center's internal browser flow.
 *
 * All external dApps open through the existing FBT Swap browser (browser.js:
 * Custom Tabs). This module adds the pre-navigation validation the spec
 * requires: domain display, phishing warnings, unsupported-chain notices,
 * and suspicious-URL detection.
 *
 * Never claims a site is safe merely because it opens in the internal browser.
 */

import { isSafeUrl } from './browser.js';

const KNOWN_PHISHING_HINTS = [
  // Common lookalikes — substring triggers a warning, not a block
  'pancakeswaap', 'pancake-swap', 'uniswap-', 'uniiswaap', 'aavee', 'lido-',
  'curve-', 'sushi-', '1inch-', 'balancer-', 'compound-', 'morpho-',
  'opensea-', 'blur-', 'metamask-', 'trustwallet-', 'walletconnect-',
];

const SUSPICIOUS_TLDS = new Set(['.tk','.ml','.ga','.cf','.gq','.zip','.mov','.click','.country']);

export function validateDiscoveryUrl(raw) {
  const url = String(raw || '').trim();
  const res = { raw: url, valid: false, https: false, domain: '', warnings: [], looksPhishy: false, blocked: false };

  if (!url) {
    res.warnings.push({ level: 'error', code: 'empty', message: 'No URL provided.' });
    return res;
  }

  // Must be https
  res.https = isSafeUrl(url);
  if (!res.https) {
    res.warnings.push({ level: 'error', code: 'not-https', message: 'Only HTTPS URLs are allowed. This destination is not secure.' });
    res.blocked = true;
    return res;
  }

  let parsed;
  try { parsed = new URL(url); } catch {
    res.warnings.push({ level: 'error', code: 'bad-url', message: 'Invalid URL format.' });
    res.blocked = true;
    return res;
  }

  res.valid = true;
  res.domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const host = parsed.hostname.toLowerCase();

  // Punycode / xn--
  if (host.includes('xn--')) {
    res.warnings.push({ level: 'warn', code: 'punycode', message: 'This domain uses punycode — it may visually impersonate another site. Verify the spelling carefully.' });
    res.looksPhishy = true;
  }

  // Suspicious TLD
  for (const tld of SUSPICIOUS_TLDS) {
    if (host.endsWith(tld)) {
      res.warnings.push({ level: 'warn', code: 'suspicious-tld', message: `Uncommon domain ending (${tld}) often used for phishing. Double-check the address.`, tld });
      res.looksPhishy = true;
      break;
    }
  }

  // Lookalike check
  const lower = url.toLowerCase();
  for (const hint of KNOWN_PHISHING_HINTS) {
    if (lower.includes(hint)) {
      res.warnings.push({ level: 'warn', code: 'lookalike', message: `This URL resembles a popular site but uses a different spelling. It may be a lookalike domain.` });
      res.looksPhishy = true;
      break;
    }
  }

  // Too many subdomains or excessive hyphens
  const dots = (host.match(/\./g) || []).length;
  const hyphens = (host.match(/-/g) || []).length;
  if (dots > 3 || hyphens > 3) {
    res.warnings.push({ level: 'info', code: 'complex-host', message: 'This address has an unusual structure (many subdomains or hyphens). Verify it is the official domain.' });
  }

  // Mixed case / homoglyph light check
  if (/[а-яА-ЯёЁ]/.test(host)) {
    res.warnings.push({ level: 'warn', code: 'cyrillic', message: 'This domain contains non-Latin characters — a common impersonation technique.' });
    res.looksPhishy = true;
  }

  return res;
}

export function chainSupportWarnings(protocol, activeChainId) {
  const warns = [];
  if (!protocol || !activeChainId) return warns;
  if (!Array.isArray(protocol.chainIds) || protocol.chainIds.length === 0) return warns;
  if (!protocol.chainIds.includes(Number(activeChainId))) {
    const name = protocol.chains?.join(', ') || String(protocol.chainIds.join(', '));
    warns.push({ level: 'info', code: 'unsupported-chain', message: `This dApp runs on ${name}. Your wallet is on a different network — you can still browse, but transactions will need a network switch.`, chains: name });
  }
  return warns;
}

export function auditNotice(protocol) {
  if (!protocol) return null;
  if (protocol.audits == null) return { level: 'info', code: 'no-audit-info', text: 'No audit information available for this protocol. This does not mean it is unsafe — only that no audit was reported in the registry.' };
  if (Number(protocol.audits) === 0) return { level: 'warn', code: 'zero-audits', text: 'No audits reported for this protocol. Review contracts and permissions before approving transactions.' };
  return null;
}

/**
 * Is this domain in the curated registry's allowlist?
 */
export function isRegistryDomain(domain, registry) {
  if (!domain || !Array.isArray(registry)) return false;
  const needle = String(domain).toLowerCase().replace(/^www\./, '');
  return registry.some(p => String(p.domain).toLowerCase() === needle);
}
