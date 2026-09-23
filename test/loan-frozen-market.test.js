/**
 * A FROZEN MARKET IS STILL A MARKET YOU CAN LEAVE.
 *
 * The report: «در شبکه سونیک اصلا فریز و قابل وام نیست توکن‌ها» — on Sonic the
 * tokens are frozen and cannot be lent or borrowed at all.
 *
 * Both halves of that sentence are true, and the page only said the first one:
 *
 *   · every Sonic reserve IS frozen — Aave's 2026 wind-down (Sonic, Scroll,
 *     zkSync, Metis, Soneium, Aptos; ARFC 2026-07-30) freezes the reserves,
 *     cuts the caps and raises the reserve factor to 99%, and there is no
 *     admin path by which this page can make new deposits possible;
 *   · «cannot be lent» is only half of what frozen means. Aave's frozen state
 *     (bit 57 of the reserve configuration) closes NEW supply and NEW borrow
 *     while REPAY and WITHDRAW stay open on-chain — by design, because that is
 *     how an open position is unwound. The page treated frozen exactly like
 *     paused (bit 60, which does stop everything) and disabled the card, so a
 *     user with a position could not even select the asset to repay against.
 *
 * So this file pins the two things that make the state usable instead of
 * mysterious: WHICH ACTIONS each state blocks, and that the state is SAID in
 * the user's language — on the card, in the decision, and once at the top of
 * the market.
 *
 * The page itself is not mounted here (it needs a provider, an RPC and a wallet
 * — see test/vite.loan.mjs for that); the rules that decide inertness are
 * pinned against the source, and every sentence against the locale files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as S from '../src/lib/lending-service.js';
import { lendingSupported, lendingAssetsFor } from '../src/lib/lending.js';
import { enabledNetworks } from '../src/lib/lending-engine/index.js';

const root = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const LANGS = ['en', 'fa', 'ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh'];
const SONIC = 146;
const dict = (lang) => JSON.parse(read(`src/i18n/locales/${lang}.json`));
const at = (obj, path) => path.split('.').reduce((node, key) => node?.[key], obj);

/* ── market fixtures, through the same door the app uses ─────────────────── */
const CHAIN = 42161; // Arbitrum — a wired Aave V3 venue
const ASSETS = lendingAssetsFor(CHAIN);
const USDT = ASSETS.find((a) => a.symbol === 'USDT');
const units = (n) => BigInt(Math.round(n * 1e6)).toString();

const reserve = (over = {}) => ({
  ok: true, listed: true, status: 'active', decimals: 6, decimalsMatch: true,
  supplyApyPct: 4.6, borrowApyPct: 5.2,
  supplyCapWei: null, totalSupplyWei: null,
  borrowCapWei: null, totalDebtWei: null,
  availableLiquidityWei: null, borrowingEnabled: true,
  ...over
});

const market = (over = {}) => ({
  chainId: CHAIN,
  reserves: { [USDT.id]: reserve() },
  positions: { [USDT.id]: { walletWei: units(1000), suppliedWei: units(100), borrowedWei: units(10), debtWei: units(10) } },
  prices: { [USDT.id]: { ok: true, usd: 1, base: (10n ** 8n).toString() } },
  account: { ok: true, healthFactor: 2, totalCollateralUsd: 1000, totalDebtUsd: 400, availableBorrowsUsd: 400, liquidationThresholdPct: 80, ltvPct: 40 },
  userConfiguration: { entries: {} },
  oracleStatus: 'ok',
  ...over
});

const withStatus = (status) => market({ reserves: { [USDT.id]: reserve({ status }) } });
const codes = (list) => (list || []).map((entry) => entry.code);

describe('frozen ≠ paused — the state decides which actions stay open', () => {
  it.each(['supply', 'borrow'])('refuses %s on a frozen reserve, and says WHY', (action) => {
    const d = S.evaluateAction({ market: withStatus('frozen'), action, asset: USDT, amount: '1', amountWei: units(1) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('MARKET_FROZEN');
    expect(codes(d.blocked)).not.toContain('MARKET_PAUSED');
    /* The sentence shown inline names what is still possible — that is the
       difference between «broken» and «closed to new positions». */
    const detail = d.blocked.find((entry) => entry.code === 'MARKET_FROZEN').detail;
    expect(detail).toMatch(/repay/i);
    expect(detail).toMatch(/withdraw/i);
  });

  it('keeps repay and withdraw open on a frozen reserve, and warns instead of blocking', () => {
    const repay = S.evaluateAction({ market: withStatus('frozen'), action: 'repay', asset: USDT, amount: '1', amountWei: units(1), debtWei: units(10) });
    expect(repay.ok).toBe(true);
    expect(repay.blocked).toHaveLength(0);
    expect(codes(repay.warnings)).toContain('MARKET_FROZEN');

    const withdraw = S.evaluateAction({ market: withStatus('frozen'), action: 'withdraw', asset: USDT, amount: '1', amountWei: units(1), suppliedWei: units(100) });
    expect(withdraw.ok).toBe(true);
    expect(withdraw.blocked).toHaveLength(0);
    expect(codes(withdraw.warnings)).toContain('MARKET_FROZEN');
  });

  it('still stops EVERYTHING on a paused reserve', () => {
    for (const action of ['supply', 'borrow', 'repay', 'withdraw']) {
      const d = S.evaluateAction({
        market: withStatus('paused'), action, asset: USDT, amount: '1', amountWei: units(1),
        debtWei: units(10), suppliedWei: units(100)
      });
      expect(d.ok, action).toBe(false);
      expect(codes(d.blocked), action).toContain('MARKET_PAUSED');
    }
  });

  it('names the freeze from getMaxBorrow instead of borrowing the paused wording', () => {
    const max = S.getMaxBorrow({ market: withStatus('frozen'), asset: USDT });
    expect(max.ok).toBe(false);
    expect(max.reason).toBe('MARKET_FROZEN');
    expect(S.getMaxBorrow({ market: withStatus('paused'), asset: USDT }).reason).toBe('MARKET_PAUSED');
  });
});

describe('the page lets a frozen asset be selected, and says what it is', () => {
  const page = read('src/pages/Loan.jsx');

  it('decides inertness from «unlisted or paused» — never from «frozen»', () => {
    /* `blocked` drives `disabled` on the asset card. Frozen must stay out of
       it: a frozen reserve is the only way to reach repay/withdraw. */
    expect(page).toMatch(/const blocked = unavailable \|\| paused;/);
    expect(page).not.toMatch(/const blocked = [^;]*frozen/);
  });

  it('marks the card frozen in the user’s language, with the one-line hint', () => {
    expect(page).toContain('loan-asset-frozen-badge');
    expect(page).toContain("t('loan.reserveStatus.frozen')");
    expect(page).toContain("t('loan.reserveFrozenHint')");
  });

  it('states the closed market once, from reserves that were actually read', () => {
    expect(page).toContain('loan-market-halted');
    expect(page).toMatch(/listedReserves[\s\S]{0,400}listed !== false/);
    expect(page).toMatch(/marketHaltedKind && !loading/);
    /* and it is a fact about the protocol, not an instruction to stop: the
       notice carries the unwind path. */
    expect(page).toContain("t('loan.marketHalted.repayHint')");
  });
});

describe('every language can say it', () => {
  const KEYS = [
    'loan.error.MARKET_FROZEN', 'loan.error.MARKET_PAUSED',
    'loan.reserveFrozenHint', 'loan.reserveStatus.frozen', 'loan.reserveStatus.paused',
    'loan.marketHalted.title', 'loan.marketHalted.body', 'loan.marketHalted.frozen',
    'loan.marketHalted.paused', 'loan.marketHalted.mixed',
    'loan.marketHalted.otherMarkets', 'loan.marketHalted.repayHint'
  ];

  it.each(LANGS)('%s has real text for the frozen/reserve/halted vocabulary', (lang) => {
    const d = dict(lang);
    for (const key of KEYS) {
      const text = at(d, key);
      expect(typeof text, `${lang}.${key}`).toBe('string');
      expect(String(text).length, `${lang}.${key}`).toBeGreaterThan(2);
      /* A copy-paste stub is not a translation: no key path may appear as the
         value, which is exactly how «استرینگ» reached the screen before. */
      expect(String(text), `${lang}.${key}`).not.toContain(key);
    }
  });

  it.each(LANGS.filter((l) => l !== 'en'))('%s translates rather than shipping the English string', (lang) => {
    const d = dict(lang);
    const en = dict('en');
    for (const key of ['loan.marketHalted.title', 'loan.error.MARKET_FROZEN', 'loan.reserveFrozenHint']) {
      expect(at(d, key), `${lang}.${key}`).not.toBe(at(en, key));
    }
  });
});

describe('Sonic is a market the page can read — the freeze is the protocol’s', () => {
  it('keeps Sonic wired, listed and enabled so a freeze is REPORTED, not hidden', () => {
    /* If Sonic were un-wired or disabled, the report («tokens are frozen») would
       have been a config bug we could fix. It is not: the venue is configured
       and the reserves are read, and the protocol has frozen them. Turning the
       network off would hide a legitimately unwound market — and its repay
       path — which is worse than showing the truth. */
    expect(lendingSupported(SONIC)).toBe(true);
    expect(lendingAssetsFor(SONIC).map((a) => a.symbol)).toEqual(['USDC', 'wS', 'stS']);
    expect(enabledNetworks().some((n) => Number(n.chainId) === SONIC)).toBe(true);
    expect(read('server/lending.js')).toMatch(/146:\s*'0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3'/);
  });

  it('does not silently drop a frozen asset from the list', () => {
    /* The frozen reserves of a wound-down market must still be listed — that is
       how a user with a position finds the repay button. */
    expect(lendingAssetsFor(SONIC).length).toBe(3);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   THE SAME DISTINCTION, ONE LEVEL DOWN: the error taxonomy.

   The card says which actions are open. The error layer has to agree, because
   three more places meet the same state:

     · Aave's Pool reverts with code 28 / RESERVE_FROZEN when a frozen reserve
       refuses an action, and `mapAaveError` had no entry for it — so the on-chain
       refusal of a FROZEN reserve was reported as MARKET_PAUSED, i.e. as «the
       whole market is down», which tells the user to wait when the truth is that
       their repay is fine and their supply is not;
     · a wallet or a provider message that merely says «reserve frozen» was
       bucketed with «paused» for the same reason;
     · MARKET_FROZEN was not a member of the client taxonomy at all, so anything
       that produced it degraded to UNKNOWN — and UNKNOWN is documented in
       errors.js as the bucket for «a state we did not model», which is exactly
       the sentence a frozen market must not be.

   These assertions are the ones that keep the card, the plan and the error
   sentence telling the user the same story.
   ════════════════════════════════════════════════════════════════════════════ */
describe('the frozen state reaches the error taxonomy intact', () => {
  it('MARKET_FROZEN is a modelled state, not an UNKNOWN', async () => {
    const { LENDING_ERRORS, isRetryable } = await import('../src/lib/lending-engine/errors.js');
    const frozen = LENDING_ERRORS.MARKET_FROZEN;
    expect(frozen, 'MARKET_FROZEN must be a member of the taxonomy').toBeTruthy();
    /* Protocol truth, not a transport failure: nothing to retry, nothing to fix
       by switching an RPC. The key IS the code — the table carries behaviour. */
    expect(frozen.retryable).toBe(false);
    expect(frozen.kind).toBe('protocol');
    expect(isRetryable('MARKET_FROZEN')).toBe(false);
    /* A member of the taxonomy is what keeps mapRawError from degrading a freeze
       into the «a state we did not model» bucket. */
    expect(Object.keys(LENDING_ERRORS)).toContain('MARKET_FROZEN');
    expect(LENDING_ERRORS.MARKET_FROZEN).not.toBe(LENDING_ERRORS.UNKNOWN);
    /* And the ERROR_KINDS derivation must have survived the new member. */
    const { ERROR_KINDS } = await import('../src/lib/lending-engine/errors.js');
    expect(ERROR_KINDS).toContain('protocol');
  });

  it('frozen and paused are said differently, in the user’s language', async () => {
    const { describeError } = await import('../src/lib/lending-engine/errors.js');
    const frozenFa = describeError('MARKET_FROZEN', 'fa');
    const pausedFa = describeError('MARKET_PAUSED', 'fa');
    const frozenEn = describeError('MARKET_FROZEN', 'en');
    expect(frozenFa).toBeTruthy();
    expect(frozenFa).not.toBe(pausedFa);
    /* A Persian sentence, not a fallback English one — this is the string that
       lands under a Sonic card. */
    expect(/[\u0600-\u06FF]/.test(frozenFa)).toBe(true);
    expect(frozenFa).not.toBe(frozenEn);
    /* Neither sentence may leak the enum at the user. */
    expect(frozenFa).not.toContain('MARKET_FROZEN');
    expect(frozenEn).not.toContain('MARKET_FROZEN');
    /* And the frozen sentence must say what still works — that is the whole
       point of distinguishing it from paused. */
    expect(frozenEn.toLowerCase()).toMatch(/repay|withdraw/);
  });

  it('a «reserve frozen» message is no longer reported as a paused market', async () => {
    const { mapRawError } = await import('../src/lib/lending-engine/errors.js');
    const frozenFrom = (message) => mapRawError(message)?.code;
    expect(frozenFrom('execution reverted: RESERVE_FROZEN')).toBe('MARKET_FROZEN');
    expect(frozenFrom('reverted with custom error ReservesErrors(28) // reserve frozen')).toBe('MARKET_FROZEN');
    expect(frozenFrom('The reserve is frozen and cannot accept new deposits')).toBe('MARKET_FROZEN');
    /* Paused keeps its own bucket — the two must not collapse back together. */
    expect(frozenFrom('execution reverted: MARKET_PAUSED')).toBe('MARKET_PAUSED');
    expect(frozenFrom('The market is paused by the protocol')).toBe('MARKET_PAUSED');
    /* And a frozen reserve still refuses BOTH new directions: that is the state. */
    expect(frozenFrom('execution reverted: RESERVE_FROZEN')).not.toBe('INSUFFICIENT_LIQUIDITY');
  });

  it('Aave’s own frozen revert (code 28) maps to MARKET_FROZEN, not MARKET_PAUSED', async () => {
    const { explainAaveRevert, AAVE_REVERT_NUMERIC, AAVE_REVERT_SELECTORS } = await import('../src/lib/lending.js');
    /* Both tables — the numeric one a legacy node reports, the selector one a
       v3.4+ custom error carries. */
    expect(AAVE_REVERT_NUMERIC[28]).toBe('MARKET_FROZEN');
    expect(AAVE_REVERT_SELECTORS['0x6d305815']).toBe('MARKET_FROZEN');
    expect(explainAaveRevert({ data: '0x6d305815' })).toMatchObject({ code: 'MARKET_FROZEN', known: true });
    expect(explainAaveRevert('execution reverted with code 28')).toMatchObject({ code: 'MARKET_FROZEN', known: true });
    /* The neighbour still means what it always meant, and is a different code. */
    expect(AAVE_REVERT_NUMERIC[29]).toBe('MARKET_PAUSED');
    expect(explainAaveRevert({ data: '0xd37f5f1c' })).toMatchObject({ code: 'MARKET_PAUSED', known: true });
    expect(explainAaveRevert('execution reverted with code 29')).toMatchObject({ code: 'MARKET_PAUSED', known: true });
    /* An unrecognised revert stays UNKNOWN rather than being given a
       plausible-sounding cause — the rule the tables are documented by. */
    expect(explainAaveRevert('execution reverted: something nobody documented')).toMatchObject({ code: null, known: false });
  });

  it('the banner a frozen market raises offers a way to the open actions', () => {
    /* MarketHaltedNotice cannot be mounted here (it needs the page’s provider
       tree), so the wiring is pinned at the source: a frozen/paused market is
       announced at the top, and for a FROZEN market the notice must hand the
       user to the positions tab, because that is where repay and withdraw — the
       two actions a frozen reserve still allows — actually live. */
    const loan = read('src/pages/Loan.jsx');
    const notice = loan.slice(loan.indexOf('function MarketHaltedNotice'), loan.indexOf('/* ── the market card'));
    expect(notice).toContain('onGoToPositions');
    expect(notice).toContain('kind !== \'paused\'');
    expect(notice).toContain('loan.tabPositions');
    /* The page hands the notice the live tab and the switch, and only raises it
       for a market whose reserves were actually read — a paused market stops
       everything, so the notice itself is what withholds the button there. */
    expect(loan).toContain('kind={marketHaltedKind}');
    expect(loan).toContain('onGoToPositions={() => { haptic?.(\'select\'); setTab(\'positions\'); }}');
  });
});
