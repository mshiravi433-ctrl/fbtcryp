/**
 * Chain + token registry for the decentralized (non-custodial) layer.
 *
 * Only public infrastructure lives here: RPC endpoints, router addresses and
 * well-known token contracts. No keys, no operator-owned addresses.
 *
 * VERIFY THESE ADDRESSES YOURSELF before sending real value. Token contract
 * addresses are the #1 phishing vector in crypto — a single wrong character
 * routes funds to an attacker's clone. Cross-check every one against the
 * project's official docs and BscScan/Tonviewer.
 */

import { FAMILY, PAYOUT_ADDRESSES, payoutAddress } from './payout';

/**
 * Supported chains.
 *
 * The KyberSwap aggregator routes across every DEX on each of these, so a user
 * can swap essentially any liquid token on the chain — not just a curated
 * list. `router`/`wrapped` are the direct-DEX fallback used only when the
 * aggregator can't quote.
 *
 * Cross-CHAIN swaps (e.g. BNB -> ETH on Ethereum) are a different problem:
 * they need a bridge, which carries its own custody and failure modes. Users
 * switch networks instead, which is honest about what's actually happening.
 */
export const EVM_CHAINS = {
  56: {
    id: 56,
    hexId: '0x38',
    name: 'BNB Smart Chain',
    short: 'BSC',
    native: { symbol: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },
    rpc: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
    explorer: 'https://bscscan.com',
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2
    wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    dexName: 'PancakeSwap',
    color: '#f0b90b'
  },
  1: {
    id: 1,
    hexId: '0x1',
    name: 'Ethereum',
    short: 'ETH',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
    explorer: 'https://etherscan.io',
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
    wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    dexName: 'Uniswap',
    color: '#627eea'
  },
  137: {
    id: 137,
    hexId: '0x89',
    name: 'Polygon',
    short: 'POL',
    native: { symbol: 'POL', decimals: 18, coingeckoId: 'matic-network' },
    rpc: ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon'],
    explorer: 'https://polygonscan.com',
    router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap
    wrapped: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    dexName: 'QuickSwap',
    color: '#8247e5'
  },
  42161: {
    id: 42161,
    hexId: '0xa4b1',
    name: 'Arbitrum One',
    short: 'ARB',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
    explorer: 'https://arbiscan.io',
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
    wrapped: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    dexName: 'SushiSwap',
    color: '#28a0f0'
  },
  8453: {
    id: 8453,
    hexId: '0x2105',
    name: 'Base',
    short: 'BASE',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    explorer: 'https://basescan.org',
    router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Uniswap V2 on Base
    wrapped: '0x4200000000000000000000000000000000000006', // WETH
    dexName: 'Uniswap',
    color: '#0052ff'
  },
  10: {
    id: 10,
    hexId: '0xa',
    name: 'Optimism',
    short: 'OP',
    native: { symbol: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
    rpc: ['https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'],
    explorer: 'https://optimistic.etherscan.io',
    router: '0x9c12939390052919aF3155f41Bf4160Fd3666A6f', // Velodrome-compatible
    wrapped: '0x4200000000000000000000000000000000000006', // WETH
    dexName: 'Velodrome',
    color: '#ff0420'
  },
  43114: {
    id: 43114,
    hexId: '0xa86a',
    name: 'Avalanche',
    short: 'AVAX',
    native: { symbol: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },
    rpc: ['https://api.avax.network/ext/bc/C/rpc'],
    explorer: 'https://snowtrace.io',
    router: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4', // TraderJoe
    wrapped: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    dexName: 'Trader Joe',
    color: '#e84142'
  }
};

export const DEFAULT_CHAIN = 56;

/**
 * Platform fee — always charged, on every chain.
 *
 * Collected on-chain by the KyberSwap aggregator's audited router and paid to
 * FEE_RECIPIENT inside the same transaction the user signs. There is no
 * zero-fee path: if the aggregator can't quote, the swap fails with a retry
 * rather than executing without our cut.
 */
/**
 * Default 50 bps (0.50%), overridable with VITE_FEE_BPS.
 *
 * ─── WHY THIS IS A DIAL AND WHERE IT SHOULD SIT ─────────────────────────────
 * Measured in-wallet swap fees, 2026: MetaMask 0.875%, Phantom 0.85%,
 * Rainbow 0.85%, Trust Wallet 0.70%, ZenGo 0.50%, Rabby 0.25%. The median is
 * 0.70%, so 0.50% is BELOW market for this product category — a wallet
 * interface, not a DEX protocol. (Comparing against Uniswap's 0.25% pool fee
 * was the wrong benchmark: that is the protocol's cut, not an interface's.)
 *
 * Moving 0.50% → 0.70% is +40% revenue on identical volume and still cheaper
 * than MetaMask, Phantom and Rainbow.
 *
 * ─── THE CAP IS NOT NEGOTIABLE ──────────────────────────────────────────────
 * Hard-limited to 100 bps (1%). A misconfigured environment variable must
 * never be able to quietly take 10% of someone's swap, and a fee that high
 * would also breach the "fees shown before you sign" promise in the listing —
 * the number would be shown, but no user reads a 10% fee as intended
 * behaviour. Out-of-range values fall back to the default rather than
 * clamping silently, because a typo'd 700 meaning 7.00% should not become
 * 1.00% without anyone noticing.
 */
const FEE_BPS_DEFAULT = 50;
const FEE_BPS_MAX = 100;

function resolveFeeBps() {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_FEE_BPS : undefined;
  if (raw == null || raw === '') return FEE_BPS_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > FEE_BPS_MAX) {
    // Loud, because a silently-ignored fee setting is a silently-wrong invoice.
    // eslint-disable-next-line no-console
    console.warn(
      `[fee] VITE_FEE_BPS="${raw}" is invalid (want an integer 0-${FEE_BPS_MAX}); using ${FEE_BPS_DEFAULT}`
    );
    return FEE_BPS_DEFAULT;
  }
  return n;
}

export const FEE_BPS = resolveFeeBps();
export { FEE_BPS_MAX, FEE_BPS_DEFAULT };

/**
 * Where the 0.5% goes.
 *
 * Resolution is per-chain and lives in `lib/payout.js`: each network has its
 * own receiving address, and if one isn't configured the resolver falls back
 * to the next valid address **of the same address family**. It never falls
 * back across families — an EVM address on Tron is a burn, not a payment.
 *
 * `FEE_RECIPIENT` stays exported as the EVM default so existing callers and
 * the deploy script keep working unchanged.
 */
export const FEE_RECIPIENT =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEE_RECIPIENT) ||
  PAYOUT_ADDRESSES.evm;

/** Per-chain fee recipient with fallback. Use this in new code. */
export function feeRecipientFor(chainId) {
  // An explicit VITE_FEE_RECIPIENT override wins everywhere — one knob for
  // anyone who just wants all EVM revenue in a single wallet.
  const override = typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEE_RECIPIENT;
  if (override && /^0x[a-fA-F0-9]{40}$/.test(override)) return override;
  return payoutAddress(chainId, FAMILY.EVM);
}

/**
 * Optional: your own deployed FeeRouter (contracts/FeeRouter.sol).
 * Only needed if you'd rather not depend on a third-party aggregator.
 */
export const FEE_ROUTER_ADDRESS =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEE_ROUTER_ADDRESS) || null;

const isAddr = (a) => Boolean(a) && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * 'aggregator' (default) | 'contract' (self-deployed FeeRouter)
 *
 * There is intentionally no 'none'. This is a commercial product: every swap
 * carries the 0.5% platform fee. Removing it would require editing this file.
 */
export const FEE_MODE =
  isAddr(FEE_ROUTER_ADDRESS) ? 'contract' : 'aggregator';

export const feeRecipientValid = (chainId = 56) => isAddr(feeRecipientFor(chainId));

/** True when swaps go through our own deployed FeeRouter contract. */
export const feeEnabled = () => FEE_MODE === 'contract' && isAddr(FEE_ROUTER_ADDRESS);

/** True when the aggregator collects the fee for us (no deployment needed). */
export const aggregatorFeeEnabled = (chainId = 56) => FEE_MODE === 'aggregator' && feeRecipientValid(chainId);

/** Curated BEP-20 list. `native: true` means the chain's gas coin, not a contract. */
export const TOKENS = {
  1: [
    { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18, native: true, coingeckoId: 'ethereum' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, coingeckoId: 'usd-coin' },
    { symbol: 'DAI', name: 'Dai', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, coingeckoId: 'dai' },
    { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, coingeckoId: 'bitcoin' },
    { symbol: 'LINK', name: 'Chainlink', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, coingeckoId: 'chainlink' },
    { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, coingeckoId: 'uniswap' }
  ],
  137: [
    { symbol: 'POL', name: 'Polygon', address: null, decimals: 18, native: true, coingeckoId: 'matic-network' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, coingeckoId: 'usd-coin' },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18, coingeckoId: 'ethereum' },
    { symbol: 'DAI', name: 'Dai', address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18, coingeckoId: 'dai' }
  ],
  42161: [
    { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18, native: true, coingeckoId: 'ethereum' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, coingeckoId: 'usd-coin' },
    { symbol: 'ARB', name: 'Arbitrum', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18, coingeckoId: 'arbitrum' },
    { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, coingeckoId: 'bitcoin' }
  ],
  8453: [
    { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18, native: true, coingeckoId: 'ethereum' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, coingeckoId: 'usd-coin' },
    { symbol: 'DAI', name: 'Dai', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, coingeckoId: 'dai' },
    { symbol: 'cbBTC', name: 'Coinbase BTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8, coingeckoId: 'bitcoin' }
  ],
  10: [
    { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18, native: true, coingeckoId: 'ethereum' },
    { symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, coingeckoId: 'usd-coin' },
    { symbol: 'OP', name: 'Optimism', address: '0x4200000000000000000000000000000000000042', decimals: 18, coingeckoId: 'optimism' }
  ],
  43114: [
    { symbol: 'AVAX', name: 'Avalanche', address: null, decimals: 18, native: true, coingeckoId: 'avalanche-2' },
    { symbol: 'USDT', name: 'Tether USD', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6, coingeckoId: 'usd-coin' },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', decimals: 18, coingeckoId: 'ethereum' }
  ],
  56: [
    { symbol: 'BNB', name: 'BNB', address: null, decimals: 18, native: true, coingeckoId: 'binancecoin' },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0x55d398326f99059fF775485246999027B3197955',
      decimals: 18,
      coingeckoId: 'tether'
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      decimals: 18,
      coingeckoId: 'usd-coin'
    },
    {
      symbol: 'BUSD',
      name: 'BUSD',
      address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      decimals: 18,
      coingeckoId: 'binance-usd'
    },
    {
      symbol: 'CAKE',
      name: 'PancakeSwap',
      address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      decimals: 18,
      coingeckoId: 'pancakeswap-token'
    },
    {
      symbol: 'ETH',
      name: 'Ethereum Token',
      address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      decimals: 18,
      coingeckoId: 'ethereum'
    },
    {
      symbol: 'BTCB',
      name: 'Bitcoin BEP20',
      address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
      decimals: 18,
      coingeckoId: 'bitcoin'
    }
  ]
};

/* -------------------------------------------------------------------------- */
/* TON                                                                        */
/* -------------------------------------------------------------------------- */

export const TON_CHAIN = {
  name: 'TON',
  short: 'TON',
  native: { symbol: 'TON', decimals: 9, coingeckoId: 'the-open-network' },
  explorer: 'https://tonviewer.com',
  dexName: 'STON.fi',
  color: '#0098ea'
};

export const TON_TOKENS = [
  { symbol: 'TON', name: 'Toncoin', address: null, decimals: 9, native: true, coingeckoId: 'the-open-network' },
  {
    symbol: 'USDT',
    name: 'Tether USD (Jetton)',
    address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    decimals: 6,
    coingeckoId: 'tether'
  }
];

/* -------------------------------------------------------------------------- */

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)'
];

export const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)'
];

export const getToken = (chainId, symbol) => (TOKENS[chainId] ?? []).find((t) => t.symbol === symbol);

/** Build a swap path, routing through the wrapped native token when needed. */
export function buildPath(chainId, fromToken, toToken) {
  const { wrapped } = EVM_CHAINS[chainId];
  const a = fromToken.native ? wrapped : fromToken.address;
  const b = toToken.native ? wrapped : toToken.address;
  if (a.toLowerCase() === b.toLowerCase()) return [a];
  // direct pair if one side is the wrapped native, otherwise hop through it
  if (a.toLowerCase() === wrapped.toLowerCase() || b.toLowerCase() === wrapped.toLowerCase()) return [a, b];
  return [a, wrapped, b];
}

export const FEE_ROUTER_ABI = [
  'function feeBps() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function quoteFee(uint256 amountIn) view returns (uint256 fee, uint256 amountAfterFee)',
  'function totalFeesCollected(address token) view returns (uint256)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'
];

export const explorerTx = (chainId, hash) => `${EVM_CHAINS[chainId].explorer}/tx/${hash}`;
export const explorerAddr = (chainId, addr) => `${EVM_CHAINS[chainId].explorer}/address/${addr}`;
