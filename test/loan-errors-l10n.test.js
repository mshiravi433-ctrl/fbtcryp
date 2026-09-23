// @vitest-environment jsdom
/**
 * THE LOAN PAGE SPEAKS THE DEVICE LANGUAGE.
 *
 * Two defects from the 2026-09-23 report are pinned here, and both were
 * *content* bugs: the code ran perfectly and printed something the user could
 * not read.
 *
 *   A. «سه‌جا با استرینگ هست به جای زبان درست» — raw machine strings.
 *      The page rendered `t(\`loan.error.${code}\`, { defaultValue: code })`,
 *      so any code without a key printed ITSELF (`BORROWING_DISABLED`), and the
 *      toast host resolved `toast.${key}` with `defaultValue: key`, so every
 *      loan toast printed its own key path (`loan.error.HEALTH_FACTOR_TOO_LOW`,
 *      `loan.chooseAssetFirst`) because `toast.loan.*` does not exist.
 *
 *   B. A frozen Sonic market could not be told apart from a broken app.
 *      The codes for that state (MARKET_FROZEN, MARKET_PAUSED, the frozen
 *      reserve hint) must exist in the words the user reads, or the honest
 *      state is once again a raw string.
 *
 * Three contracts, in the order they fail:
 *   1. every code the loan surface can render has a sentence in en/fa/ar;
 *   2. `loanErrorText` NEVER returns a bare code — an unknown one comes back
 *      inside a translated generic that still carries the code for support;
 *   3. the toast door turns a loan key into a sentence (and leaves every
 *      non-loan toast exactly as it was);
 *   4. no loan source file renders a code with `defaultValue: <code>` again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import ar from '../src/i18n/locales/ar.json';
import { loanErrorText, loanErrorKey, loanLookupKeys, isKnownLoanError } from '../src/lib/loanErrors';
import { toastTextForTest } from '../src/components/Toasts.jsx';

const root = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const makeT = (dict) => (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], dict) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
const tEn = makeT(en);
const tFa = makeT(fa);
const tAr = makeT(ar);

/* ── every code the loan surface can put in front of a user ─────────────────
   Blocks/warnings from the decision engine, read failures, the Solana/Kamino
   builder, the wallet layer and the RPC classifier. A code reachable from the
   page that is missing here is a code that will render raw — which is exactly
   what this list exists to prevent. */
const LOAN_SURFACE_CODES = [
  /* engine: blocks and warnings */
  'UNSUPPORTED_CHAIN', 'NOT_A_RESERVE', 'TOKEN_NOT_ALLOWED', 'POOL_NOT_ALLOWED',
  'BAD_ADDRESS', 'NO_TOKEN_REGISTRY', 'MARKET_PAUSED', 'MARKET_FROZEN',
  'SUPPLY_CAP_EXCEEDED', 'INSUFFICIENT_BALANCE', 'BORROWING_DISABLED',
  'BORROW_LIMIT_EXCEEDED', 'HEALTH_FACTOR_TOO_LOW', 'ORACLE_PRICE_UNAVAILABLE',
  'ORACLE_STALE', 'ORACLE_ANOMALY', 'RESERVE_STATE_UNKNOWN', 'DECIMALS_MISMATCH',
  'BALANCE_UNKNOWN', 'READ_ONLY_MODE', 'TRANSACT_DISABLED', 'NOT_CONNECTED',
  'ACCOUNT_UNAVAILABLE', 'WRONG_NETWORK', 'AMOUNT_REQUIRED', 'ZERO_PRICE',
  'INSUFFICIENT_ALLOWANCE', 'INSUFFICIENT_LIQUIDITY', 'EXCEEDS_DEBT',
  'BORROW_CAP_EXCEEDED', 'LIQUIDATION_RISK', 'MAX_BORROW_UNAVAILABLE',
  'SIMULATION_FAILED', 'TRANSACTION_REVERTED', 'TRANSACTION_FAILED',
  'TRANSACTION_NOT_FOUND', 'TRANSACTION_DROPPED', 'GAS_ESTIMATION_FAILED',
  'INSUFFICIENT_GAS', 'RISK_DATA_UNAVAILABLE', 'RISK_PROJECTION_UNAVAILABLE',
  'USER_REJECTED', 'APPROVE_FAILED', 'SUPPLY_FAILED', 'BORROW_FAILED',
  'REPAY_FAILED', 'WITHDRAW_FAILED', 'PROTOCOL_UNAVAILABLE', 'UNKNOWN',
  /* read / RPC */
  'RPC_ERROR', 'RPC_BLOCKED', 'RPC_RATE_LIMITED', 'RPC_UNAVAILABLE',
  'ORACLE_UNAVAILABLE', 'RESERVE_READ_FAILED', 'POSITION_READ_FAILED',
  'ACCOUNT_READ_FAILED', 'USER_CONFIGURATION_READ_FAILED', 'PRICE_UNREADABLE',
  'BFF_UNAVAILABLE', 'NO_FETCH', 'BAD_RESPONSE', 'BAD_PAYLOAD',
  /* Solana / Kamino */
  'KAMINO_MARKET_UNAVAILABLE', 'KAMINO_SDK_MISSING', 'KAMINO_SDK_FAILED',
  'KAMINO_SDK_TRUNCATED', 'KAMINO_SDK_INIT_FAILED', 'KAMINO_SDK_UNAVAILABLE',
  'KAMINO_SDK_MIME', 'KAMINO_SDK_RECOVERED', 'KAMINO_TX_BUILD_FAILED',
  'KAMINO_TX_BUILD_EMPTY', 'SOLANA_WALLET_REQUIRED', 'SOLANA_ASSET_REQUIRED',
  'SOLANA_COLLATERAL_REQUIRED', 'SOLANA_POSITION_REQUIRED',
  'SOLANA_SIGN_UNAVAILABLE', 'SOLANA_SEND_FAILED', 'SOLANA_TX_FAILED',
  'SOLANA_CONFIRMATION_TIMEOUT', 'UNKNOWN_ACTION',
  /* the wallet layer's own vocabulary (src/lib/solana/walletLayer.js) */
  'REJECTED', 'ACTION_REJECTED', 'NO_WALLET', 'WALLET_NOT_FOUND', 'NO_ACCOUNT', 'NO_SESSION',
  'TIMEOUT', 'UNSUPPORTED', 'UNSUPPORTED_TRANSACTION', 'SIGN_FAILED',
  'SEND_FAILED', 'CONNECT_FAILED', 'IN_WALLET', 'NO_SIGNATURE',
  'BAD_TRANSACTION', 'REVERTED', 'UNKNOWN_STEP',
  /* the loan page's own toasts (not error codes, but toast keys) */
  'UNKNOWN_WITH_CODE'
];

const LOAN_TOAST_KEYS = [
  'loan.chooseAssetFirst', 'loan.enterAmount', 'loan.amountOverWallet',
  'loan.needCollateralFirst', 'loan.error.READ_ONLY_MODE',
  'loan.error.HEALTH_FACTOR_TOO_LOW'
];

const hasCode = (text, code) => new RegExp(`\\b${code}\\b`).test(String(text));

describe('loan error sentences — one door, every language', () => {
  it.each(['en', 'fa', 'ar'])('has a %s sentence for every code the loan page can show', (lang) => {
    const dict = { en, fa, ar }[lang];
    const missing = LOAN_SURFACE_CODES.filter((code) => {
      const text = code.split('.').reduce((o, k) => o?.[k], dict?.loan?.error);
      return !text || typeof text !== 'string';
    });
    expect(missing, `${lang}.loan.error is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('never returns a bare code — a known one, an alias, or an unknown one', () => {
    for (const [dict, name] of [[en, 'en'], [fa, 'fa'], [ar, 'ar']]) {
      const t = makeT(dict);
      for (const code of LOAN_SURFACE_CODES.filter((c) => c !== 'UNKNOWN_WITH_CODE')) {
        const text = loanErrorText(t, code);
        expect(typeof text, `${name} ${code}`).toBe('string');
        expect(hasCode(text, code), `${name} ${code} → «${text}»`).toBe(false);
      }
    }
  });

  it('keeps the machine code INSIDE a translated generic for an unknown code', () => {
    for (const [dict, name] of [[en, 'en'], [fa, 'fa'], [ar, 'ar']]) {
      const t = makeT(dict);
      const text = loanErrorText(t, 'SOMETHING_THE_PAGE_NEVER_HEARD_OF');
      expect(text, name).toContain('SOMETHING_THE_PAGE_NEVER_HEARD_OF');
      expect(text, name).not.toBe('SOMETHING_THE_PAGE_NEVER_HEARD_OF');
      expect(text.length, name).toBeGreaterThan(20);
    }
    /* the Persian generic must be Persian — the report's language */
    expect(loanErrorText(tFa, 'SOMETHING_THE_PAGE_NEVER_HEARD_OF')).toMatch(/[\u0600-\u06FF]/);
  });

  it('resolves a fully-qualified loan key as well as a bare code', () => {
    expect(loanErrorText(tEn, 'loan.error.MARKET_FROZEN')).toContain('frozen');
    expect(loanErrorText(tEn, 'MARKET_FROZEN')).toBe(loanErrorText(tEn, 'loan.error.MARKET_FROZEN'));
    expect(loanErrorText(tFa, 'loan.chooseAssetFirst')).not.toBe('loan.chooseAssetFirst');
    expect(isKnownLoanError(tEn, 'MARKET_PAUSED')).toBe(true);
    expect(isKnownLoanError(tEn, 'NOPE_NOT_A_CODE')).toBe(false);
  });

  it('maps the wallet layer’s own names onto the page’s codes', () => {
    /* The wallet layer answers with names the page does not own. Where the page
       has its own sentence for the same event, both must reach it. */
    expect(loanErrorText(tEn, 'ACTION_REJECTED')).not.toContain('ACTION_REJECTED');
    expect(loanErrorText(tEn, 'CANNOT_SIGN')).toBe(loanErrorText(tEn, 'UNSUPPORTED'));
    expect(loanErrorText(tEn, 'DECRYPT_FAILED')).toBe(loanErrorText(tEn, 'SIGN_FAILED'));
    expect(loanErrorText(tEn, 'HTTP_403')).toBe(loanErrorText(tEn, 'RPC_BLOCKED'));
    expect(loanErrorText(tEn, 'HTTP_401')).toBe(loanErrorText(tEn, 'RPC_BLOCKED'));
    expect(loanErrorText(tEn, 'HTTP_451')).toBe(loanErrorText(tEn, 'RPC_BLOCKED'));
    expect(loanErrorText(tEn, 'RATE_LIMIT')).toBe(loanErrorText(tEn, 'RPC_RATE_LIMITED'));
    expect(loanErrorText(tEn, 'TOO_MANY_REQUESTS')).toBe(loanErrorText(tEn, 'RPC_RATE_LIMITED'));
    expect(loanErrorText(tEn, 'IN_WALLET_PENDING')).toBe(loanErrorText(tEn, 'IN_WALLET'));
  });

  it('offers the lookup chain in one place, in the order it is tried', () => {
    expect(loanLookupKeys('loan.error.MARKET_PAUSED')[0]).toBe('loan.error.MARKET_PAUSED');
    expect(loanLookupKeys('MARKET_PAUSED')).toContain('loan.error.MARKET_PAUSED');
    expect(loanLookupKeys('MARKET_PAUSED')).toContain('loan.error.UNKNOWN_WITH_CODE');
    expect(loanErrorKey('market_paused')).toBe('loan.error.MARKET_PAUSED');
  });
});

describe('the toast door turns a loan key into a sentence', () => {
  it.each(LOAN_TOAST_KEYS)('renders %s as text, not as its own key', (key) => {
    for (const [dict, name] of [[en, 'en'], [fa, 'fa'], [ar, 'ar']]) {
      const text = toastTextForTest(makeT(dict), key, {});
      expect(text, `${name} ${key}`).not.toBe(key);
      expect(text, `${name} ${key}`).not.toContain(key);
    }
  });

  it('leaves the shared toast namespace exactly as it was', () => {
    const tShared = (key, values = {}) => (key === 'toast.investmentOpened' ? 'Plan opened' : values.defaultValue ?? key);
    expect(toastTextForTest(tShared, 'investmentOpened', {})).toBe('Plan opened');
    /* an unknown, non-loan key still falls back to itself — unchanged behaviour */
    const tNone = (key, values = {}) => values.defaultValue ?? key;
    expect(toastTextForTest(tNone, 'someUnknownToastKey', {})).toBe('someUnknownToastKey');
  });

  it('never shows a raw loan key, even one that does not exist yet', () => {
    const text = toastTextForTest(makeT(fa), 'loan.error.A_CODE_FROM_THE_FUTURE', {});
    expect(text).toContain('A_CODE_FROM_THE_FUTURE');
    expect(text).not.toBe('loan.error.A_CODE_FROM_THE_FUTURE');
  });
});

describe('the raw-code fallback cannot come back', () => {
  const files = ['src/pages/Loan.jsx', 'src/components/SolanaLendingPanel.jsx'];
  /* Comments explain the old defect and quote the old line, so they are
     stripped before scanning — this test is about what the page RENDERS. */
  const codeOnly = (file) => read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it.each(files)('%s renders every loan code through the door', (file) => {
    const source = codeOnly(file);
    const offenders = [...source.matchAll(/defaultValue:\s*(item\.code|entry\.code|\bcode\b|\w+\.reason|\w+\.message|projection\.reason|exec\?\.code|exec\?\.message)/g)]
      .map((m) => m[0]);
    expect(offenders, `raw-code fallbacks left in ${file}: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has a sheet title for every action the sheet can open', () => {
    const actions = ['supply', 'borrow', 'repay', 'withdraw', 'collateral', 'approve'];
    for (const [dict, name] of [[en, 'en'], [fa, 'fa'], [ar, 'ar']]) {
      for (const action of actions) {
        const text = dict?.loan?.sheetTitle?.[action];
        expect(typeof text, `${name} loan.sheetTitle.${action}`).toBe('string');
        expect(text.length, `${name} loan.sheetTitle.${action}`).toBeGreaterThan(2);
      }
    }
  });

  it.each(files)('%s resolves localised codes through loanErrorText', (file) => {
    const source = codeOnly(file);
    /* The one place a code may still be printed verbatim is the small LTR
       diagnostic badge in the panel (data-code / the visible chip) — that is
       evidence for support, not the explanation. Everywhere else the door. */
    const inlineLookups = [...source.matchAll(/t\(`loan\.error\.\$\{[^}]+\}`/g)].map((m) => m[0]);
    expect(inlineLookups, `inline code lookups left in ${file}: ${inlineLookups.join(', ')}`).toEqual([]);
  });
});
