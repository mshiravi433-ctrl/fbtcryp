// @vitest-environment node
/**
 * INSURANCE ERRORS SPEAK ONE SENTENCE (run: `npm run test:insurance-errors`,
 * also part of `npm run test:insurance-ui`).
 *
 * «وقتی می‌زنی امضا کنی و پول نداری، یک ارور چندخطی می‌آید به‌جای موجودی کم»
 *
 * The pages used to paste `e.message` — the deepest layer's raw text — into an
 * alert and a four-second toast. src/pages/insurance/insErrors.js is the single
 * door an error walks through, and this pins what comes out the other side:
 *
 *   · MetaMask's nested envelope (the real reason lives in
 *     `data.data[<hash>].message`, not in `message`) → the network-fee line;
 *   · a token-balance revert → insufficient balance, not «activation failed»;
 *   · a rejected request → a quiet cancellation, not a fault;
 *   · the server's own reason codes → the existing translated table, by code;
 *   · a stack dump → never shown, not even its first line;
 *   · and the guarantee that makes the report go away: NEVER a newline, NEVER
 *     a long paragraph, NEVER raw JSON — in EITHER language.
 *
 * Written with `join(NL)` and literal character classes on purpose: this file
 * asserts on escapes, so it must not depend on how a bundler re-quotes one.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import fa from '../../src/i18n/locales/fa.json';
import { insuranceError, insuranceErrorToast } from '../../src/pages/insurance/insErrors.js';

const NL = String.fromCharCode(10);
/** Persian/Arabic script — anything outside this in a fa sentence is a leak. */
const FA_SCRIPT = /[؀-ۿ]/;

/** A t() close enough to i18next for these cases: dotted path + {{var}}. */
const makeT = (dict) => (key, values = {}) => {
  const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);
  if (typeof v !== 'string') return values.defaultValue ?? '';
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ''));
};
const tEn = makeT(en);
const tFa = makeT(fa);

/** The provider envelopes, transcribed from real wallet rejections. */
const CASES = {
  'metamask empty wallet for gas': {
    err: {
      code: -32603,
      message: 'Internal JSON-RPC error.',
      data: {
        message: 'Insufficient funds.',
        data: { '0x2f9a1c4e': { message: 'insufficient funds for gas * price + value' } }
      }
    },
    en: /fee|gas/i
  },
  'token balance revert': {
    err: { code: -32603, message: 'Error: VM Exception while processing transaction: revert Transfer: transfer amount exceeds balance' },
    en: /balance/i
  },
  'user pressed reject': {
    err: { code: 4001, message: 'User rejected the request.' },
    en: /reject|cancel/i
  },
  'ethers action_rejected with dump': {
    err: { code: 'ACTION_REJECTED', message: 'user rejected action (action="signTypedData", info={})' },
    en: /reject|cancel/i
  },
  'missing allowance': {
    err: { code: 'INSUFFICIENT_ALLOWANCE', message: 'intrinsic fee requires allowance of 0' },
    en: /approve|allowance/i
  },
  'wrong network': {
    err: { code: 'UNRECOGNIZED_CHAIN_ID', message: 'Unrecognized chain id 56' },
    en: /network/i
  },
  'no wallet at all': {
    err: { message: 'no EIP-1193 provider found' },
    en: /wallet/i
  },
  'offline': {
    err: new TypeError('Failed to fetch'),
    en: /connection|network|offline|did not answer/i
  },
  'wallet cannot send the method': {
    err: { code: 'METHOD_MISSING', message: 'provider method personal_sign not found' },
    en: /wallet|request/i
  }
};

describe('insuranceError — one sentence per defect', () => {
  for (const [name, { err, en: wanted }] of Object.entries(CASES)) {
    it(`${name}: one line in English, one line in Persian, same diagnosis`, () => {
      const enOut = insuranceError(err, tEn);
      const faOut = insuranceError(err, tFa);
      /* the diagnosis is locale-independent: same code, same slot */
      expect(faOut.code).toBe(enOut.code);
      /* English carries the meaning; Persian must not fall back to English. */
      expect(enOut.text).toMatch(wanted);
      expect(faOut.text).toMatch(FA_SCRIPT);
      for (const out of [enOut, faOut]) {
        expect(out.text).toBeTruthy();
        expect(out.text).not.toContain(NL);
        expect(out.text.length).toBeLessThanOrEqual(160);
        expect(out.text).not.toMatch(/"code":|JSON-RPC|0x[0-9a-f]{16,}/);
        expect(out.text).not.toMatch(/{.{0,40}:/);
      }
    });
  }

  it('never leaks the raw code as the sentence itself', () => {
    for (const raw of ['VALID_WALLET_REQUIRED', 'QUOTE_UNAVAILABLE', 'ACTIVATION_FAILED', 'NO_ELIGIBLE_PROTECTION']) {
      const err = new Error(raw);
      err.code = raw;
      const out = insuranceError(err, tEn);
      expect(out.text).not.toBe(raw);
      expect(out.text).not.toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(out.code).toBe(raw);
    }
  });

  it('keeps the code for support instead of burying it in the sentence', () => {
    const out = insuranceError({ code: 'PROVIDER_UNAVAILABLE', message: 'upstream 502 from nexus' }, tEn);
    expect(out.text).not.toContain('PROVIDER_UNAVAILABLE');
    expect(out.code).toBe('PROVIDER_UNAVAILABLE');
    expect(typeof out.technical).toBe('string');
  });

  it('a multi-line dump never reaches the screen, first line or not', () => {
    const err = new Error(['Activation failed', 'while verifying transaction', '  at server/insurance/index.js:4412'].join(NL));
    const out = insuranceError(err, tFa);
    expect(out.text).not.toContain(NL);
    expect(out.text).not.toContain('index.js');
    /* and it must not invent a cause either: «:4412» looks like an HTTP 4xx to
       the reason matcher, which used to call a stack frame a refused quote. */
    expect(out.text).not.toMatch(/نپذیرفت|rejected/i);
    expect(out.technical).toContain('Activation failed');
  });

  it('tells a rejected signature apart from a real failure', () => {
    const rejected = insuranceError({ code: 4001, message: 'User rejected the request.' }, tFa);
    const broken = insuranceError({ code: 'ACTIVATION_FAILED', message: 'nope' }, tFa);
    expect(rejected.text).not.toBe(broken.text);
  });

  it('is Persian in the Persian app', () => {
    const out = insuranceError({ code: 'USER_REJECTED', message: 'User rejected the request.' }, tFa);
    expect(out.text).toMatch(FA_SCRIPT);
    expect(out.text).not.toMatch(/^[A-Za-z ]+$/);
  });

  it('the toast is the sentence and nothing else', () => {
    const err = { code: 4001, message: 'User rejected the request.' };
    const toast = insuranceErrorToast(err, tEn);
    expect(toast).toBe(insuranceError(err, tEn).text);
    expect(toast).not.toContain('4001');
  });
});

describe('insurance error copy', () => {
  const keys = Object.keys(en.insurance.errors);
  it.each(keys)('every error key exists in en and fa: %s', (k) => {
    expect(typeof en.insurance.errors[k]).toBe('string');
    expect(typeof fa.insurance.errors[k]).toBe('string');
    expect(fa.insurance.errors[k].length).toBeGreaterThan(3);
  });

  it('the Persian lines are Persian, not English echoes', () => {
    for (const k of keys) {
      if (k === 'detailToggle') continue;
      expect(fa.insurance.errors[k]).toMatch(FA_SCRIPT);
    }
  });

  it('every line is one line, in both locales', () => {
    for (const dict of [en, fa]) {
      for (const [k, v] of Object.entries(dict.insurance.errors)) {
        expect(String(v)).not.toContain(NL);
        expect(String(v).length).toBeLessThanOrEqual(180);
      }
    }
  });

  it('every code the insurance server can throw has a sentence', () => {
    /* «بقیه ارورها هم همین‌طور». The server throws 17 distinct codes; the UI
       rendered them verbatim, so a Persian user read COVERAGE_NOT_CANCELLABLE
       in a red box. The table that owns those strings is insurance.reason.*,
       and this pins that it is complete — a new server code cannot land on the
       screen as a code again without failing here first. */
    const dir = 'server/insurance';
    const codes = new Set();
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = `${d}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          for (const m of fs.readFileSync(full, 'utf8').matchAll(/code:\s*'([A-Z][A-Z0-9_]{3,})'/g)) codes.add(m[1]);
        }
      }
    };
    walk(dir);
    expect(codes.size).toBeGreaterThan(10);
    for (const c of codes) {
      expect(typeof en.insurance.reason[c]).toBe('string');
      expect(typeof fa.insurance.reason[c]).toBe('string');
      expect(fa.insurance.reason[c]).toMatch(FA_SCRIPT);
      expect(fa.insurance.reason[c]).not.toMatch(/\n/);
    }
  });

  it('the mapper does not fork the server reason table', () => {
    /* insurance.reason.* already covers the ENVELOPE codes in every shipped
       locale; forking them into CODE_KEYS is how two lists start disagreeing.
       PROVIDER_UNAVAILABLE / TIMEOUT are the deliberate exceptions: they arrive
       from the wallet as well as the API, and the wallet wording differs. */
    const reasons = new Set(Object.keys(en.insurance.reason));
    const src = fs.readFileSync('src/pages/insurance/insErrors.js', 'utf8');
    const body = src.split('const CODE_KEYS = {')[1].split('};')[0];
    const codes = [...body.matchAll(/^\s*([A-Z0-9_]+):/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(15);
    for (const c of ['ACTIVATION_FAILED', 'COVERAGE_NOT_VERIFIED', 'PURCHASE_INPUTS_UNAVAILABLE',
      'INTENT_FAILED', 'QUOTE_EXPIRED', 'QUOTE_UNAVAILABLE', 'TERMS_ACCEPTANCE_REQUIRED', 'NO_ELIGIBLE_PROTECTION']) {
      expect(reasons.has(c)).toBe(true);
      expect(codes).not.toContain(c);
    }
  });
});
