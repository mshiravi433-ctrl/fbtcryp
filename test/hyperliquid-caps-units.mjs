import { validateCaps, checkCaps, checkOrder, HYPERLIQUID_PER_TX_CAP_USD, HYPERLIQUID_CAP_ERROR } from '../src/lib/hyperliquid/caps.js';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  t('per-tx cap is 20000', HYPERLIQUID_PER_TX_CAP_USD === 20000);

  // fail-closed unknown
  t('unknown value rejected (null)', validateCaps(null).ok === false);
  t('unknown value rejected (string)', validateCaps('x').ok === false);
  t('unknown perTx rejected', validateCaps({ perTxCapUsd: 'abc', totalExposureCapUsd: 20000 }).ok === false);
  t('unknown total rejected', validateCaps({ perTxCapUsd: 20000, totalExposureCapUsd: NaN }).ok === false);

  // total exposure must be >= per-tx
  t('total lower rejected', validateCaps({ perTxCapUsd: 20000, totalExposureCapUsd: 10000 }).ok === false);
  t('total equal accepted', validateCaps({ perTxCapUsd: 20000, totalExposureCapUsd: 20000 }).ok === true);
  t('total higher accepted', validateCaps({ perTxCapUsd: 20000, totalExposureCapUsd: 50000 }).ok === true);

  // per-tx cannot exceed 20000
  t('perTx over ceiling rejected', validateCaps({ perTxCapUsd: 30000, totalExposureCapUsd: 30000 }).ok === false);

  // incompatibility error code
  t('incompatibility code present', validateCaps({ perTxCapUsd: 20000, totalExposureCapUsd: 10000 }).errors.includes(HYPERLIQUID_CAP_ERROR.TOTAL_EXPOSURE_TOO_LOW));

  // kill switch
  const caps = { perTxCapUsd: 20000, totalExposureCapUsd: 20000, killSwitch: true };
  t('kill switch blocks order', checkOrder(caps, { notionalUsd: 100 }).ok === false);
  t('kill switch code', checkOrder(caps, { notionalUsd: 100 }).code === HYPERLIQUID_CAP_ERROR.KILL_SWITCH);

  // per-tx exceeded
  t('per-tx exceeded rejected', checkOrder({ perTxCapUsd: 20000, totalExposureCapUsd: 20000 }, { notionalUsd: 25000 }).ok === false);
  t('within cap accepted', checkOrder({ perTxCapUsd: 20000, totalExposureCapUsd: 20000 }, { notionalUsd: 10000 }).ok === true);

  // unknown notional rejected
  t('unknown notional rejected', checkOrder({ perTxCapUsd: 20000, totalExposureCapUsd: 20000 }, { notionalUsd: 'x' }).ok === false);

  // total exposure
  t('total exposure exceeded rejected', checkOrder({ perTxCapUsd: 20000, totalExposureCapUsd: 20000 }, { notionalUsd: 5000 }, { currentExposureUsd: 18000 }).ok === false);

  // checkCaps alias
  t('checkCaps alias works', checkCaps({ caps: { perTxCapUsd: 20000, totalExposureCapUsd: 20000 }, intent: { notionalUsd: 100 } }).ok === true);

  return rows;
}

