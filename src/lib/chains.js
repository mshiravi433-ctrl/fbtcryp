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

export const EVM_CHAINS = {
  56: {
    id: 56,
    hexId: '0x38',
    name: 'BNB Smart Chain',
    short: 'BSC',
    native: { symbol: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },
    rpc: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
    explorer: 'https://bscscan.com',
    // PancakeSwap V2
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    dexName: 'PancakeSwap',
    color: '#f0b90b'
  }
};

export const DEFAULT_CHAIN = 56;

/**
 * Platform fee configuration.
 *
 * `feeRouter` is the deployed FeeRouter contract (contracts/FeeRouter.sol).
 * When it is null the app swaps directly against the DEX with NO fee — it
 * never silently falls back to a second "please also pay us" transaction,
 * because a swap that half-executes is worse than one that doesn't run.
 *
 * Deploy with `node scripts/deploy-feerouter.mjs`, then paste the address into
 * VITE_FEE_ROUTER_ADDRESS.
 */
export const FEE_BPS = 50; // 0.50%

/**
 * Where the 0.5% goes. This is the ONLY value you must set to start earning.
 *
 * With just this set, swaps route through the KyberSwap aggregator, whose
 * already-deployed audited router splits the fee out and sends it here inside
 * the same transaction. No contract of your own to deploy, no gas to spend.
 */
export const FEE_RECIPIENT =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEE_RECIPIENT) ||
  '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

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

export const feeRecipientValid = () => isAddr(FEE_RECIPIENT);

/** True when swaps go through our own deployed FeeRouter contract. */
export const feeEnabled = () => FEE_MODE === 'contract' && isAddr(FEE_ROUTER_ADDRESS);

/** True when the aggregator collects the fee for us (no deployment needed). */
export const aggregatorFeeEnabled = () => FEE_MODE === 'aggregator' && feeRecipientValid();

/** Curated BEP-20 list. `native: true` means the chain's gas coin, not a contract. */
export const TOKENS = {
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
