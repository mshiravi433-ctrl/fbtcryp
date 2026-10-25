/*
 * Phase-5 real-transaction replay manifest.
 *
 * These rows are deliberately boring: every payload is pinned by repository
 * path and SHA-256, every expected decode is stated before the decoder runs,
 * and a payload that must not decode is given the same first-class status as
 * a positive. Provenance is part of the evidence — a "golden" JSON file with
 * no source, commit or licence would ask us to trust exactly the thing replay
 * is supposed to remove.
 *
 * The four committed payloads validate the replay mechanism and Jupiter v6.
 * They do not validate all twelve supported programs: that distinction is
 * preserved by `coverageForSolanaProgram` and by the admission gate.
 */

export const SOLANA_REPLAY_NOW = Date.parse('2027-01-01T00:00:00.000Z');

const FREEZE = (rows) => Object.freeze(rows.map((row) => Object.freeze({
  ...row,
  source: Object.freeze({ ...row.source }),
  expected: row.expected == null ? null : Object.freeze({ ...row.expected })
})));

export const SOLANA_REPLAY_FIXTURES = FREEZE([
  {
    id: 'jupiter-v6-pyusd-usdc-2dyb2hr9',
    file: 'test/fixtures/solana-replay/jupiter-v6-pyusd-usdc-2dyb2hr9.json',
    sha256: 'd2a4376ed8c72a4e117fa84e98c4cad1fe90ee2e1910a0834b93d11843f25e2e',
    signature: '2dyb2hr9fzY2fmMh36krHww4BG9rRpRg5TpQ1bvS1mJHXeGq8qX4sLouTJpa2cW9jmS7hEB2YW2SXHvyUD6pmM4K',
    wallet: 'Go5EVXxV3ob4CJVaq6YiGGUKqPmEfDo32kSmbWsYevsF',
    dexProgram: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    dex: 'Jupiter v6',
    encoding: 'jsonParsed',
    corroborated: true,
    source: {
      repository: 'madlabs-tech/onchain-data-mcp',
      commit: 'c75576585761360f894cb227244a0ed3b3ba43c5',
      path: 'crates/protocols/fixtures/solana/mainnet_jupiter_pyusd_usdc.json',
      license: 'MIT',
      url: 'https://github.com/madlabs-tech/onchain-data-mcp/blob/c75576585761360f894cb227244a0ed3b3ba43c5/crates/protocols/fixtures/solana/mainnet_jupiter_pyusd_usdc.json'
    },
    normalization: 'Direct getTransaction result; no envelope unwrapping required.',
    expected: {
      side: 'SELL',
      token: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
      amount: 89.098536,
      amountRaw: '89098536',
      tokenDecimals: 6,
      quoteToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      quoteSymbol: 'USDC',
      quoteAmount: 88.208817,
      quoteAmountRaw: '88208817',
      quoteDecimals: 6,
      valueUsd: 88.208817,
      timestamp: 1790162367000,
      instructionFillCount: 3,
      instructionTransfers: { target: 1, quote: 2 }
    }
  },
  {
    id: 'jupiter-v6-jup-usdc-5fbwfqrm',
    file: 'test/fixtures/solana-replay/jupiter-v6-jup-usdc-5fbwfqrm.json',
    sha256: '88121c25eca4f21feb9f82198b607b0e6b18d12555d250405e7d54225f283014',
    signature: '5FBWfqrMYoYbqq6yBWJUtqbVmCDAcz79M7NrzB1yxNLibzMWjndHsVRvwDMkUNgwr58KdLP7pCBjkwhnHrbTre5k',
    wallet: '4Ui9QdDNuUaAGqCPcDSp191QrixLzQiLxJ1Gnqvz3szP',
    dexProgram: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    dex: 'Jupiter v6',
    encoding: 'jsonParsed',
    corroborated: true,
    source: {
      repository: 'hodgerpodger/staketaxcsv',
      commit: 'a99acd845a3409aa11d28bd2cb61ae652bea290d',
      path: 'src/tests/data/SOL/fetch_tx/wrapper-5FBWfqrMYoYbqq6yBWJUtqbVmCDAcz79M7NrzB1yxNLibzMWjndHsVRvwDMkUNgwr58KdLP7pCBjkwhnHrbTre5k.json',
      license: 'MIT',
      url: 'https://github.com/hodgerpodger/staketaxcsv/blob/a99acd845a3409aa11d28bd2cb61ae652bea290d/src/tests/data/SOL/fetch_tx/wrapper-5FBWfqrMYoYbqq6yBWJUtqbVmCDAcz79M7NrzB1yxNLibzMWjndHsVRvwDMkUNgwr58KdLP7pCBjkwhnHrbTre5k.json'
    },
    normalization: 'JSON-RPC result unwrapped to the direct getTransaction result.',
    expected: {
      side: 'SELL',
      token: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
      amount: 136.431176,
      amountRaw: '136431176',
      tokenDecimals: 6,
      quoteToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      quoteSymbol: 'USDC',
      quoteAmount: 182.560735,
      quoteAmountRaw: '182560735',
      quoteDecimals: 6,
      valueUsd: 182.560735,
      timestamp: 1710810376000,
      instructionFillCount: 2,
      instructionTransfers: { target: 1, quote: 1 }
    }
  },
  {
    id: 'raydium-amm-v4-usdc-3p36wgra',
    file: 'test/fixtures/solana-replay/raydium-amm-v4-usdc-3p36wgra.json',
    sha256: 'b31a94234757ffbb6c27c728825aa94b95d0fb8eaa7e922f47c5d2ee326200a9',
    signature: '3p36wGRa191szhME5kRbg41cv9sXPPYvozkkKvPMErwoakXGZNDbjgCtV3e7uzU9dSDABtAgpm7heoepNhDmxJwN',
    wallet: 'GKj54MVFppoYsxPU9jMn7CMniVRAuveFadyTtFhn1vXy',
    dexProgram: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    dex: 'Raydium AMM v4',
    encoding: 'json',
    corroborated: false,
    source: {
      repository: '0xjeffro/tx-parser',
      commit: '475b1ebff79a2f41ec966919fdefa01f11f6c5d7',
      path: 'solana/data/OKXDEX_commissionSplProxySwap.json',
      license: 'MPL-2.0',
      url: 'https://github.com/0xjeffro/tx-parser/blob/475b1ebff79a2f41ec966919fdefa01f11f6c5d7/solana/data/OKXDEX_commissionSplProxySwap.json'
    },
    normalization: 'One-element array unwrapped to the direct raw-json getTransaction result; parsed SPL instructions are absent, so this is balance-delta replay only.',
    expected: {
      side: 'BUY',
      token: 'DKu9kykSfbN5LBfFXtNNDPaX35o4Fv6vJ9FKk7pZpump',
      amount: 6373.264828,
      amountRaw: '6373264828',
      tokenDecimals: 6,
      quoteToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      quoteSymbol: 'USDC',
      quoteAmount: 250,
      quoteAmountRaw: '250000000',
      quoteDecimals: 6,
      valueUsd: 250,
      timestamp: 1731789673000,
      instructionFillCount: 0,
      instructionTransfers: { target: 0, quote: 0 }
    }
  },
  {
    id: 'jupiter-v6-usdt-usdc-4vug6xbf',
    file: 'test/fixtures/solana-replay/jupiter-v6-usdt-usdc-4vug6xbf.json',
    sha256: '953ef3a5e8b103d65eaa702bc540282d9c82afae5be349ec12ed596bc8fc5108',
    signature: '4vug6xbfY6xpk81oA6p2gJzoA8eb9nowdB3mnNiF97QWiW5cPRXWh3cRutKrGCFbonML7JjLo5xJzuXAntRzN3MZ',
    wallet: '5C1k9yV7y4CjMnKv8eGYDgWND8P89Pdfj79Trk2qmfGo',
    dexProgram: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    dex: 'Jupiter v6',
    encoding: 'jsonParsed',
    corroborated: false,
    source: {
      repository: 'hodgerpodger/staketaxcsv',
      commit: 'a99acd845a3409aa11d28bd2cb61ae652bea290d',
      path: 'src/tests/data/SOL/fetch_tx/wrapper-4vug6xbfY6xpk81oA6p2gJzoA8eb9nowdB3mnNiF97QWiW5cPRXWh3cRutKrGCFbonML7JjLo5xJzuXAntRzN3MZ.json',
      license: 'MIT',
      url: 'https://github.com/hodgerpodger/staketaxcsv/blob/a99acd845a3409aa11d28bd2cb61ae652bea290d/src/tests/data/SOL/fetch_tx/wrapper-4vug6xbfY6xpk81oA6p2gJzoA8eb9nowdB3mnNiF97QWiW5cPRXWh3cRutKrGCFbonML7JjLo5xJzuXAntRzN3MZ.json'
    },
    normalization: 'JSON-RPC result unwrapped to the direct getTransaction result.',
    expected: null,
    rejectionReason: 'canonical-usd-stable-target'
  }
]);

export const SOLANA_REPLAY_FIXTURE_BY_ID = Object.freeze(Object.fromEntries(
  SOLANA_REPLAY_FIXTURES.map((fixture) => [fixture.id, fixture])
));

export const SOLANA_CORROBORATED_REPLAY_PROGRAMS = Object.freeze([...new Set(
  SOLANA_REPLAY_FIXTURES
    .filter((fixture) => fixture.expected && fixture.corroborated === true)
    .map((fixture) => fixture.dexProgram)
)]);

export const SOLANA_BALANCE_REPLAY_PROGRAMS = Object.freeze([...new Set(
  SOLANA_REPLAY_FIXTURES
    .filter((fixture) => fixture.expected)
    .map((fixture) => fixture.dexProgram)
)]);

export function coverageForSolanaProgram(programId) {
  const fixtures = SOLANA_REPLAY_FIXTURES.filter((fixture) => fixture.dexProgram === programId);
  const corroborated = fixtures.filter((fixture) => fixture.expected && fixture.corroborated === true).length;
  const balanceOnly = fixtures.filter((fixture) => fixture.expected && fixture.corroborated !== true).length;
  const negatives = fixtures.filter((fixture) => fixture.expected == null).length;
  return {
    programId,
    fixtures: fixtures.length,
    corroboratedFixtures: corroborated,
    balanceOnlyFixtures: balanceOnly,
    negativeFixtures: negatives,
    status: corroborated ? 'instruction-corroborated-replay'
      : balanceOnly ? 'balance-delta-replay-only'
        : 'missing-replay-fixture'
  };
}
