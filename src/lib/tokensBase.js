/**
 * BUNDLED BASELINE TOKENS
 * ---------------------------------------------------------------------------
 * The full universe (thousands per chain) comes from public token lists at
 * runtime. This file is the floor underneath that: the tokens people actually
 * trade, shipped inside the app so the picker is useful on a first launch with
 * no network, on a rate-limited CDN, or behind a filter that blocks the list
 * hosts.
 *
 * Every address here is a well-known, high-liquidity contract. They are
 * marked `verified: true`, which in this codebase means exactly one thing:
 * a human checked the address against the project's own documentation. It is
 * not a statement about whether the token is a good investment.
 *
 * If you add an entry, verify the address on the chain's explorer AND on the
 * project's official site. A single wrong character here routes real user
 * funds to a clone contract, and there is no undo on-chain.
 */

/** BNB Smart Chain (56) — the default chain. */
export const BSC_BASE = [
  ['CAKE', 'PancakeSwap', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 18],
  ['BTCB', 'Bitcoin BEP20', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 18],
  ['ETH', 'Ethereum Token', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 18],
  ['XRP', 'XRP Token', '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', 18],
  ['ADA', 'Cardano Token', '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', 18],
  ['DOGE', 'Dogecoin', '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', 8],
  ['DOT', 'Polkadot Token', '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', 18],
  ['LINK', 'Chainlink Token', '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', 18],
  ['LTC', 'Litecoin Token', '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94', 18],
  ['MATIC', 'Matic Token', '0xCC42724C6683B7E57334c4E856f4c9965ED682bD', 18],
  ['AVAX', 'Avalanche Token', '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', 18],
  ['ATOM', 'Cosmos Token', '0x0Eb3a705fc54725037CC9e008bDede697f62F335', 18],
  ['UNI', 'Uniswap', '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', 18],
  ['TRX', 'TRON', '0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3', 6],
  ['NEAR', 'NEAR Protocol', '0x1Fa4a73a3F0133f0025378af00236f3aBDEE5D63', 18],
  ['FIL', 'Filecoin', '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153', 18],
  ['SHIB', 'Shiba Inu', '0x2859e4544C4bB03966803b044A93563Bd2D0DD4D', 18],
  ['TWT', 'Trust Wallet Token', '0x4B0F1812e5Df2A09796481Ff14017e6005508003', 18],
  ['XVS', 'Venus', '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63', 18],
  ['ALPACA', 'Alpaca Finance', '0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F', 18],
  ['INJ', 'Injective', '0xa2B726B1145A4773F68593CF171187d8EBe4d495', 18],
  ['FLOKI', 'FLOKI', '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E', 9],
  ['BAKE', 'BakeryToken', '0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5', 18],
  ['SFP', 'SafePal', '0xD41FDb03Ba84762dD66a0af1a6C8540FF1ba5dfb', 18],
  ['BSW', 'Biswap', '0x965F527D9159dCe6288a2219DB51fc6Eef120dD1', 18],
  ['TUSD', 'TrueUSD', '0x40af3827F39D0EAcBF4A168f8D4ee67c121D11c9', 18],
  ['FDUSD', 'First Digital USD', '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', 18],
  ['DAI', 'Dai Token', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', 18],
  ['UST', 'Wrapped UST', '0x23396cF899Ca06c4472205fC903bDB4de249D6fC', 18],
  ['LDO', 'Lido DAO', '0x986854779804799C1d68867F5E03e601E781e41b', 18],
  ['GMT', 'STEPN', '0x3019BF2a2eF8040C242C9a4c5c4BD4C81678b2A1', 8],
  ['C98', 'Coin98', '0xaEC945e04baF28b135Fa7c640f624f8D90F1C3a6', 18],
  ['HIGH', 'Highstreet', '0x5f4Bde007Dc06b867f86EBFE4802e34A1fFEEd63', 18],
  ['MBOX', 'Mobox', '0x3203c9E46cA618C8C1cE5dC67e7e9D75f5da2377', 18],
  ['ANKR', 'Ankr', '0xf307910A4c7bbc79691fD374889b36d8531B08e3', 18],
  ['AAVE', 'Aave Token', '0xfb6115445Bff7b52FeB98650C87f44907E58f802', 18],
  ['1INCH', '1inch', '0x111111111117dC0aa78b770fA6A738034120C302', 18],
  ['SXP', 'Swipe', '0x47BEAd2563dCBf3bF2c9407fEa4dC236fAbA485A', 18],
  ['ALICE', 'MyNeighborAlice', '0xAC51066d7bEC65Dc4589368da368b212745d63E8', 6],
  ['CHR', 'Chroma', '0xf9CeC8d50f6c8ad3Fb6dcCEC577e05aA32B224FE', 6]
];

/** Ethereum (1). */
export const ETH_BASE = [
  ['WBTC', 'Wrapped Bitcoin', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8],
  ['LINK', 'Chainlink', '0x514910771AF9Ca656af840dff83E8264EcF986CA', 18],
  ['UNI', 'Uniswap', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 18],
  ['AAVE', 'Aave', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', 18],
  ['SHIB', 'Shiba Inu', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 18],
  ['PEPE', 'Pepe', '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 18],
  ['MKR', 'Maker', '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', 18],
  ['LDO', 'Lido DAO', '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', 18],
  ['CRV', 'Curve DAO', '0xD533a949740bb3306d119CC777fa900bA034cd52', 18],
  ['ARB', 'Arbitrum', '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1', 18],
  ['GRT', 'The Graph', '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', 18],
  ['SAND', 'The Sandbox', '0x3845badAde8e6dFF049820680d1F14bD3903a5d0', 18],
  ['MANA', 'Decentraland', '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', 18],
  ['APE', 'ApeCoin', '0x4d224452801ACEd8B2F0aebE155379bb5D594381', 18],
  ['ENS', 'Ethereum Name Service', '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', 18],
  ['stETH', 'Lido Staked Ether', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 18]
];

/** Polygon (137). */
export const POLYGON_BASE = [
  ['WBTC', 'Wrapped Bitcoin', '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', 8],
  ['LINK', 'Chainlink', '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', 18],
  ['AAVE', 'Aave', '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', 18],
  ['QUICK', 'QuickSwap', '0xB5C064F955D8e7F38fE0460C556a72987494eE17', 18],
  ['SAND', 'The Sandbox', '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683', 18],
  ['MANA', 'Decentraland', '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4', 18]
];

/** Arbitrum (42161). */
export const ARBITRUM_BASE = [
  ['LINK', 'Chainlink', '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 18],
  ['GMX', 'GMX', '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', 18],
  ['UNI', 'Uniswap', '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', 18],
  ['DAI', 'Dai', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 18],
  ['PENDLE', 'Pendle', '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8', 18]
];

/** Base (8453). */
export const BASE_BASE = [
  ['USDT', 'Tether USD', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6],
  ['AERO', 'Aerodrome', '0x940181a94A35A4569E4529A3CDfB74e38FD98631', 18],
  ['DEGEN', 'Degen', '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', 18]
];

/** Optimism (10). */
export const OPTIMISM_BASE = [
  ['DAI', 'Dai', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 18],
  ['WBTC', 'Wrapped Bitcoin', '0x68f180fcCe6836688e9084f035309E29Bf0A2095', 8],
  ['VELO', 'Velodrome', '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', 18]
];

/** Avalanche C-Chain (43114). */
export const AVALANCHE_BASE = [
  ['JOE', 'Trader Joe', '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', 18],
  ['WBTC', 'Wrapped Bitcoin', '0x50b7545627a5162F82A992c33b87aDc75187B218', 8],
  ['DAI', 'Dai', '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', 18]
];

/** Linea (59144). */
export const LINEA_BASE = [
  ['WETH', 'Wrapped Ether', '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', 18],
  ['USDC', 'USD Coin', '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', 6],
  ['USDT', 'Tether USD', '0xA219439258ca9da29E9Cc4cE5596924745e12B93', 6],
  ['FOXY', 'Foxy', '0x5FBDF89403270a1846F5ae7D113A989F850d1566', 18]
];

/** Sonic (146). */
export const SONIC_BASE = [
  ['wS', 'Wrapped Sonic', '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38', 18],
  ['USDC', 'USD Coin', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', 6],
  ['WETH', 'Wrapped Ether', '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b', 18]
];

const expand = (rows, coingeckoIds = {}) =>
  rows.map(([symbol, name, address, decimals]) => ({
    symbol,
    name,
    address,
    decimals,
    verified: true,
    source: 'bundled',
    coingeckoId: coingeckoIds[symbol]
  }));

/** chainId -> extra verified tokens, merged on top of TOKENS in chains.js. */
export const BASE_TOKENS = {
  56: expand(BSC_BASE),
  1: expand(ETH_BASE),
  137: expand(POLYGON_BASE),
  42161: expand(ARBITRUM_BASE),
  8453: expand(BASE_BASE),
  10: expand(OPTIMISM_BASE),
  43114: expand(AVALANCHE_BASE),
  59144: expand(LINEA_BASE),
  146: expand(SONIC_BASE)
};
