import { getHyperliquidAccount, parseClearinghouseState, HL_ERRORS } from '../src/lib/hyperliquid/readonly.js';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  // address validation
  t('bad address rejected', (await getHyperliquidAccount({ address: '0x123' })).code === HL_ERRORS.BAD_ADDRESS);
  t('missing fetch returns network error', (await getHyperliquidAccount({ address: '0x' + 'a'.repeat(40), fetchImpl: null })).code === HL_ERRORS.NETWORK);

  // mock fetch rate limit
  {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await getHyperliquidAccount({ address: '0x' + 'a'.repeat(40), fetchImpl });
    t('rate limited surfaced', r.code === HL_ERRORS.RATE_LIMITED);
  }

  // mock fetch timeout (abort)
  {
    const fetchImpl = async (_u, opts) => {
      if (opts?.signal) {
        // simulate abort
      }
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const r = await getHyperliquidAccount({ address: '0x' + 'a'.repeat(40), fetchImpl, timeout: 10 });
    t('timeout surfaced', r.code === HL_ERRORS.TIMEOUT);
  }

  // parse missing fields -> null not zero
  {
    const raw = { marginSummary: { accountValue: '100.5' }, assetPositions: [] };
    const r = parseClearinghouseState(raw, { address: '0xabc' });
    t('parse ok', r.ok === true);
    t('accountValue parsed', r.account.accountValue === 100.5);
    t('totalMarginUsed unknown null', r.account.totalMarginUsed === null);
    t('withdrawable unknown null', r.account.withdrawable === null);
  }

  // position parsing + liquidation price
  {
    const raw = {
      marginSummary: { accountValue: '1000', totalMarginUsed: '100', totalNtlPos: '500', totalRawUsd: '1000' },
      withdrawable: '900',
      assetPositions: [
        { position: { coin: 'BTC', szi: '0.1', entryPx: '50000', positionValue: '5100', unrealizedPnl: '100', liquidationPx: '45000', marginUsed: '50', maxLeverage: '50' } }
      ]
    };
    const r = parseClearinghouseState(raw);
    t('position coin', r.account.positions[0].coin === 'BTC');
    t('position side long', r.account.positions[0].side === 'long');
    t('liquidation price parsed', r.account.positions[0].liquidationPrice === 45000);
    t('missing field null not zero', r.account.maintenanceMargin === null);
  }

  // bad shape
  t('bad shape rejected', parseClearinghouseState(null).ok === false);
  t('bad shape code', parseClearinghouseState(42).code === HL_ERRORS.BAD_SHAPE);

  return rows;
}

