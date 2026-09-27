/**
 * dYdX onboarding chain probe — no wallet, relay, or network required.
 * The official dYdX onboarding signature uses EIP-712 chain id 1. This locks
 * the mobile-wallet chain switch, post-switch verification, and refusal paths.
 */
import { readFileSync } from 'node:fs';
import {
  DYDX_ONBOARDING_CHAIN_ID,
  parseWalletChainId,
  prepareDydxOnboardingNetwork
} from '../src/lib/dydxOnboarding.js';

const rows = [];
const check = (name, ok) => rows.push({ name, ok: Boolean(ok) });

check('the onboarding domain is Ethereum mainnet', DYDX_ONBOARDING_CHAIN_ID === 1);
check('wallet chain ids accept hex, decimal, and CAIP-2 values',
  parseWalletChainId('0x1') === 1 && parseWalletChainId('1') === 1
  && parseWalletChainId('eip155:1') === 1 && parseWalletChainId('eip155:56') === 56
  && parseWalletChainId('not-a-chain') === null);

{
  let switches = 0;
  const wallet = {
    chainId: 1,
    getEip1193Provider: () => ({ request: async () => '0x1' }),
    switchChain: async () => { switches += 1; return true; }
  };
  const chain = await prepareDydxOnboardingNetwork(wallet);
  check('an Ethereum wallet is ready without an unnecessary switch prompt', chain === 1 && switches === 0);
}

{
  let chainId = '0x38';
  const calls = [];
  const wallet = {
    chainId: 56,
    getEip1193Provider: () => ({ request: async ({ method }) => { calls.push(method); return chainId; } }),
    switchChain: async (target) => { calls.push(`switch:${target}`); chainId = '0x1'; return true; }
  };
  const chain = await prepareDydxOnboardingNetwork(wallet);
  check('a non-mainnet wallet switches to chain 1 and verifies eth_chainId',
    chain === 1 && calls.includes('switch:1') && calls.at(-1) === 'eth_chainId');
}

{
  let chainId = '0x89';
  const wallet = {
    chainId: 137,
    getEip1193Provider: () => ({ request: async () => chainId }),
    switchChain: async () => {
      setTimeout(() => { chainId = '0x1'; }, 20);
      return true;
    }
  };
  const switched = await prepareDydxOnboardingNetwork(wallet, { timeoutMs: 500, pollMs: 5 });
  check('a delayed mobile chainChanged event is waited for and verified', switched === 1);
}

{
  let threw = false;
  const wallet = {
    chainId: 137,
    getEip1193Provider: () => ({ request: async () => '0x89' }),
    switchChain: async () => false
  };
  try {
    await prepareDydxOnboardingNetwork(wallet);
  } catch (error) {
    threw = error.message === 'DYDX_NETWORK_REQUIRED';
  }
  check('a declined or unsupported network switch stops before signing', threw);
}

{
  let threw = false;
  const wallet = {
    chainId: 56,
    getEip1193Provider: () => ({ request: async () => '0x38' }),
    switchChain: async () => true
  };
  try {
    await prepareDydxOnboardingNetwork(wallet, { timeoutMs: 0 });
  } catch (error) {
    threw = error.message === 'DYDX_NETWORK_REQUIRED';
  }
  check('a wallet that claims success but stays on the old chain is not trusted', threw);
}

{
  const page = readFileSync(new URL('../src/pages/Dydx.jsx', import.meta.url), 'utf8');
  const networkIndex = page.indexOf('await prepareDydxOnboardingNetwork(wallet)');
  const signIndex = page.indexOf('await connectDydx(signer)');
  check('the dYdX screen verifies Ethereum Mainnet before calling the signer',
    networkIndex >= 0 && signIndex > networkIndex);
  check('the returned-unsigned WalletConnect error gets an actionable translation key',
    /WALLET_RETURNED_UNSIGNED/.test(page) && /WALLET_RETURNED_UNSIGNED/.test(
      readFileSync(new URL('../src/i18n/locales/fa.json', import.meta.url), 'utf8')
    ));
}

console.log(JSON.stringify({ probe: 'dydx-onboarding', passed: rows.filter((r) => r.ok).length, results: rows }, null, 2));
if (rows.some((r) => !r.ok)) process.exitCode = 1;
export default rows;
