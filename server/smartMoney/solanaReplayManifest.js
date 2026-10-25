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
,
{
  "id": "raydium-amm-v4-titan2",
  "file": "test/fixtures/solana-replay/raydium-amm-v4-titan2.json",
  "sha256": "841642151ac876435b942a879e7903b62b49463f88eb59f0e2120e42a6f87441",
  "signature": "2pbFktFoaNbT7WuoqtsY4C7onBuntwazTjVbadbzZxyh49yVBH5szn4igTgqSgp2jS9S3S2ryFivXAegopaheKSs",
  "wallet": "EmDewJpfQaxWqxthX1FUyBCCPNGt8Ac5ek4M4pnGTgxC",
  "dexProgram": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "dex": "Raydium AMM v4",
  "encoding": "base64",
  "corroborated": true,
  "source": {
    "repository": "jowency-me/solana-tx-parser",
    "commit": "71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca",
    "path": "testdata/transactions/swap_titan_2.json",
    "license": "MIT",
    "url": "https://github.com/jowency-me/solana-tx-parser/blob/71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca/testdata/transactions/swap_titan_2.json"
  },
  "normalization": "Wire-format base64 envelope via normalizeSolanaWireTransaction.",
  "expected": {
    "side": "SELL",
    "token": "74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump",
    "amount": 5239.4,
    "amountRaw": "5239400000",
    "tokenDecimals": 6,
    "quoteToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "quoteSymbol": "USDC",
    "quoteAmount": 115.239349,
    "quoteAmountRaw": "115239349",
    "quoteDecimals": 6,
    "valueUsd": 115.239349,
    "timestamp": 1777314530000,
    "instructionFillCount": 1,
    "instructionTransfers": {
      "target": 1,
      "quote": 1
    }
  }
},
{
  "id": "raydium-stable-amm-1",
  "file": "test/fixtures/solana-replay/raydium-stable-amm-1.json",
  "sha256": "ef89fec76eb20a0fe96eb4669bbb97bdc9e59edcb9b92fa34c170130355b7235",
  "signature": "3KueivTTEPCgUM3i6KrAjx1TJf2tn6VzhJE4wGCcnCaB6eR2LaPdFifq4rjsYkuG6WJf9qtWnPdPnxtS3mreENEe",
  "wallet": "3uaZBfHPfmpAHW7dsimC1SnyR61X4bJqQZKWmRSCXJxv",
  "dexProgram": "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h",
  "dex": "Raydium Stable AMM",
  "encoding": "base64",
  "corroborated": true,
  "source": {
    "repository": "jowency-me/solana-tx-parser",
    "commit": "71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca",
    "path": "testdata/transactions/swap_raydium_amm_1.json",
    "license": "MIT",
    "url": "https://github.com/jowency-me/solana-tx-parser/blob/71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca/testdata/transactions/swap_raydium_amm_1.json"
  },
  "normalization": "Wire-format base64 envelope via normalizeSolanaWireTransaction.",
  "expected": {
    "side": "BUY",
    "token": "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
    "amount": 16.772752,
    "amountRaw": "16772752",
    "tokenDecimals": 6,
    "quoteToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "quoteSymbol": "USDC",
    "quoteAmount": 16.723744,
    "quoteAmountRaw": "16723744",
    "quoteDecimals": 6,
    "valueUsd": 16.723744,
    "timestamp": 1777370994000,
    "instructionFillCount": 1,
    "instructionTransfers": {
      "target": 1,
      "quote": 1
    }
  }
},
{
  "id": "raydium-clmm-route1",
  "file": "test/fixtures/solana-replay/raydium-clmm-route1.json",
  "sha256": "e7ea3b656964a05aafd5e5039df273bc6fd3b83faf753f9c77cd04d16a94ee05",
  "signature": "2QKwmn6Bsev4Z8kDYc9XwCZLje17PmW1Ar91nBmpA5VXFC7WYMZnrCmnqvhVNV9r6xBFtzsRV6dnMwxnF3oCatfi",
  "wallet": "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV",
  "dexProgram": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "dex": "Raydium CLMM",
  "encoding": "base64",
  "corroborated": false,
  "source": {
    "repository": "jowency-me/solana-tx-parser",
    "commit": "71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca",
    "path": "testdata/transactions/swap_raydium_route_1.json",
    "license": "MIT",
    "url": "https://github.com/jowency-me/solana-tx-parser/blob/71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca/testdata/transactions/swap_raydium_route_1.json"
  },
  "normalization": "Wire-format base64 envelope via normalizeSolanaWireTransaction (balance-delta replay only).",
  "expected": {
    "side": "SELL",
    "token": "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    "amount": 0.32539102,
    "amountRaw": "32539102",
    "tokenDecimals": 8,
    "quoteToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "quoteSymbol": "USDC",
    "quoteAmount": 30.098851,
    "quoteAmountRaw": "30098851",
    "quoteDecimals": 6,
    "valueUsd": 30.098851,
    "timestamp": 1777380323000,
    "instructionFillCount": 0,
    "instructionTransfers": {
      "target": 0,
      "quote": 0
    }
  }
},
{
  "id": "meteora-dlmm-titan1",
  "file": "test/fixtures/solana-replay/meteora-dlmm-titan1.json",
  "sha256": "ca3121a188384ff63f9fdd348bd0ae37e1484c3e706a9f6b5387439bbef8db40",
  "signature": "44pxrtZzwAMMdLyKgSASFzAXrmRSPALAQ9zmmxUUrfpb5KrhbMhn9EYh5Befoe2JNezEatQnHfc2R8U4sgGEJFio",
  "wallet": "EmDewJpfQaxWqxthX1FUyBCCPNGt8Ac5ek4M4pnGTgxC",
  "dexProgram": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "dex": "Meteora DLMM",
  "encoding": "base64",
  "corroborated": true,
  "source": {
    "repository": "jowency-me/solana-tx-parser",
    "commit": "71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca",
    "path": "testdata/transactions/swap_titan_1.json",
    "license": "MIT",
    "url": "https://github.com/jowency-me/solana-tx-parser/blob/71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca/testdata/transactions/swap_titan_1.json"
  },
  "normalization": "Wire-format base64 envelope via normalizeSolanaWireTransaction.",
  "expected": {
    "side": "SELL",
    "token": "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    "amount": 7570.9,
    "amountRaw": "7570900000",
    "tokenDecimals": 6,
    "quoteToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "quoteSymbol": "USDC",
    "quoteAmount": 120.063156,
    "quoteAmountRaw": "120063156",
    "quoteDecimals": 6,
    "valueUsd": 120.063156,
    "timestamp": 1777314530000,
    "instructionFillCount": 1,
    "instructionTransfers": {
      "target": 1,
      "quote": 1
    }
  }
},
{
  "id": "meteora-pools-stabble1",
  "file": "test/fixtures/solana-replay/meteora-pools-stabble1.json",
  "sha256": "63d9da97888889f40bb7de5cd4ee623be2b58f948f3c83aab1c424e448b5c8aa",
  "signature": "5HAPqNLdEbMwkwgE2fASofTZJrUxKRZa32etFLAQHxZRoaHxPBF75WwhbgLdi2eFXBgZoGtPwc8Q2Ss8tyA299eR",
  "wallet": "96VWJ77yLMaTQ4xxceiJ84P8ngLmTNifWwvgjjpNo676",
  "dexProgram": "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
  "dex": "Meteora Pools",
  "encoding": "base64",
  "corroborated": true,
  "source": {
    "repository": "jowency-me/solana-tx-parser",
    "commit": "71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca",
    "path": "testdata/transactions/swap_stabble_1.json",
    "license": "MIT",
    "url": "https://github.com/jowency-me/solana-tx-parser/blob/71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca/testdata/transactions/swap_stabble_1.json"
  },
  "normalization": "Wire-format base64 envelope via normalizeSolanaWireTransaction; amounts are dust-level but real (corroborated).",
  "expected": {
    "side": "BUY",
    "token": "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    "amount": 0.174361,
    "amountRaw": "174361",
    "tokenDecimals": 6,
    "quoteToken": "TTU7rVYfhCG7pZqGVZ1E9x8nDq9x5XkMvLjz4wKw3H3V",
    "quoteSymbol": "USDT",
    "quoteAmount": 0.002869,
    "quoteAmountRaw": "2869",
    "quoteDecimals": 6,
    "valueUsd": 0.002869,
    "timestamp": 1777380355000,
    "instructionFillCount": 1,
    "instructionTransfers": {
      "target": 1,
      "quote": 1
    }
  }
},
{
  "id": "pumpswap-exa6gyh2",
  "file": "test/fixtures/solana-replay/pumpswap-exa6gyh2.json",
  "sha256": "d18c9a7e9bffa5a5791c9f32dd6e46aa5579ac6154058d4fa35b41c4a84c0a11",
  "signature": "uyEeVWMnHBCKGhAg4oaBhVa2aJrtp8Vhh1xrkCbR9aMViLEjSjpEmoZBKM86sbyZ55pi89aJNgMZYQX9B61tCXL",
  "wallet": "FGSkBxz7rPpchZqZgao2qWHx73mJB6WH9nfzcWHTVyQS",
  "dexProgram": "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "dex": "PumpSwap",
  "encoding": "base64",
  "corroborated": true,
  "source": {
    "repository": "jowency-me/solana-tx-parser",
    "commit": "71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca",
    "path": "testdata/transactions/swap_exa6gyh_2.json",
    "license": "MIT",
    "url": "https://github.com/jowency-me/solana-tx-parser/blob/71ba8bd960b2a7c74a5f9cec69f2ed597dedc1ca/testdata/transactions/swap_exa6gyh_2.json"
  },
  "normalization": "Wire-format base64 envelope via normalizeSolanaWireTransaction.",
  "expected": {
    "side": "BUY",
    "token": "DXcwhg1MwrResr1CoaBuhnnHmcx222ntZAgRd28Jpump",
    "amount": 302184.87654,
    "amountRaw": "302184876540",
    "tokenDecimals": 6,
    "quoteToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "quoteSymbol": "USDC",
    "quoteAmount": 49.5,
    "quoteAmountRaw": "49500000",
    "quoteDecimals": 6,
    "valueUsd": 49.5,
    "timestamp": 1777315297000,
    "instructionFillCount": 1,
    "instructionTransfers": {
      "target": 1,
      "quote": 1
    }
  }
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
