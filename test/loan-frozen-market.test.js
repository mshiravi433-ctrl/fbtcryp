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
