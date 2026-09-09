/**
 * Self-contained payment-gateway links.
 *
 * The landing page must work from the URL alone — a customer opening a
 * shared link is not a signed-in merchant, and there is no server lookup
 * for the payload. The code after `/#/pay/` is URL-safe base64 JSON.
 *
 * The fee is the same 70 bps as the rest of the app (`FEE_BPS`). It is
 * split in wei so decimal formatting cannot round a satoshi of USDT the
 * wrong way, then sent as two sequential transfers: merchant first
 * (99.3%), platform second. The second transfer is skipped when the fee
 * rounds to 0.
 */
import { FEE_BPS } from './feeBps';
import { ERC20_ABI, feeRecipientFor } from './chains';
import { publicAppUrl } from './nativeShell';

export const PAY_THEMES = Object.freeze({
  mint: { id: 'mint', accent: '#00e5a8', bg: '#071510', fg: '#e8fff6' },
  cyan: { id: 'cyan', accent: '#00e5ff', bg: '#061418', fg: '#e6fbff' },
  violet: { id: 'violet', accent: '#7c4dff', bg: '#0e0818', fg: '#f0e9ff' },
  rose: { id: 'rose', accent: '#ff2d95', bg: '#16080f', fg: '#ffe8f4' },
  gold: { id: 'gold', accent: '#f0b90b', bg: '#141006', fg: '#fff6d8' },
  night: { id: 'night', accent: '#8ab4ff', bg: '#07090e', fg: '#e8eefc' }
});

export const PAY_THEME_ORDER = Object.freeze(Object.keys(PAY_THEMES));

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const STORE_KEY = 'fbt-pay-links-v1';
const MAX_SAVED = 20;

function utf8ToB64Url(str) {
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToUtf8(code) {
  const b64 = String(code || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const raw = b64 + pad;
  if (typeof atob === 'function') {
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(raw, 'base64').toString('utf8');
}

/**
 * Trust Wallet in this browser: the in-app WebView sets `ethereum.isTrust`,
 * EIP-6963 announces `com.trustwallet.app`, and the mobile UA still names it
 * when the provider object is wrapped. Used to pick connectInjected vs
 * WalletConnect — never as a WalletContext field, which does not exist.
 */
export function isTrustWallet() {
  if (typeof window === 'undefined') return false;
  const eth = window.ethereum;
  if (eth?.isTrust || eth?.isTrustWallet) return true;
  const list = Array.isArray(eth?.providers) ? eth.providers : [];
  if (list.some((p) => p?.isTrust || p?.isTrustWallet)) return true;
  return /TrustWallet|Trust\//i.test(String(navigator?.userAgent || ''));
}

export function encodePayPayload(input) {
  const to = String(input.to || '').trim();
  if (!ADDR.test(to)) throw new Error('INVALID_ADDRESS');
  const chainId = Number(input.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('INVALID_CHAIN');
  const token = String(input.token || '').trim().toUpperCase();
  if (!token) throw new Error('INVALID_TOKEN');
  const amount = input.amount == null || input.amount === '' ? '' : String(input.amount).trim();
  if (amount && !/^\d+(\.\d+)?$/.test(amount)) throw new Error('INVALID_AMOUNT');
  const lang = String(input.lang || 'en').slice(0, 8);
  const theme = PAY_THEMES[input.theme] ? input.theme : 'mint';
  const name = String(input.name || '').slice(0, 48);
  return utf8ToB64Url(JSON.stringify({
    v: 1,
    to,
    c: chainId,
    t: token,
    a: amount,
    l: lang,
    th: theme,
    n: name
  }));
}

export function decodePayPayload(code) {
  try {
    const json = JSON.parse(b64UrlToUtf8(code));
    if (!json || json.v !== 1) return null;
    if (!ADDR.test(json.to)) return null;
    const chainId = Number(json.c);
    if (!Number.isInteger(chainId) || chainId <= 0) return null;
    const token = String(json.t || '').trim();
    if (!token) return null;
    const amount = json.a == null ? '' : String(json.a);
    return {
      v: 1,
      to: json.to,
      chainId,
      token,
      amount,
      lang: String(json.l || 'en'),
      theme: PAY_THEMES[json.th] ? json.th : 'mint',
      name: String(json.n || '')
    };
  } catch {
    return null;
  }
}

export function payLandingPath(code) {
  return `/#/pay/${code}`;
}

export function payLandingUrl(code) {
  return publicAppUrl(payLandingPath(code));
}

/** Split `wei` into merchant (10000 − FEE_BPS) and platform (FEE_BPS). */
export function splitPayWei(wei, bps = FEE_BPS) {
  const total = typeof wei === 'bigint' ? wei : BigInt(wei);
  if (total <= 0n) return { merchant: 0n, fee: 0n, total: 0n };
  const fee = (total * BigInt(bps)) / 10000n;
  return { merchant: total - fee, fee, total };
}

/**
 * Integer-safe decimal → wei. Rejects extra fractional digits rather than
 * rounding them, which is how `parseUnits` + a second format can drift.
 */
export function parseAmountWei(amount, decimals) {
  const s = String(amount ?? '').trim().replace(',', '.');
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > dec) return null;
  try {
    return BigInt((whole.replace(/^0+(?=\d)/, '') || '0') + frac.padEnd(dec, '0'));
  } catch {
    return null;
  }
}

export function formatWei(wei, decimals) {
  const n = typeof wei === 'bigint' ? wei : BigInt(wei);
  const neg = n < 0n;
  const v = neg ? -n : n;
  const dec = Number(decimals);
  const s = v.toString().padStart(dec + 1, '0');
  const w = s.slice(0, s.length - dec);
  const f = s.slice(s.length - dec).replace(/0+$/, '');
  return `${neg ? '-' : ''}${w}${f ? `.${f}` : ''}`;
}

/**
 * Merchant first, then the platform.
 * Skip the fee transfer if it rounds to 0, or if the recipient is the
 * merchant (would just be a second send to the same address).
 */
export async function sendPayTransfers({ signer, token, merchant, amountWei, chainId }) {
  const { Contract, isAddress } = await import('ethers');
  if (!isAddress(merchant)) throw new Error('INVALID_ADDRESS');
  const split = splitPayWei(amountWei);
  if (split.merchant <= 0n) throw new Error('BAD_AMOUNT');

  const sendWei = async (to, value) => {
    if (token.native) {
      return signer.sendTransaction({ to, value });
    }
    const c = new Contract(token.address, ERC20_ABI, signer);
    return c.transfer(to, value);
  };

  const merchantTx = await sendWei(merchant, split.merchant);
  await merchantTx.wait?.();

  let feeHash = null;
  const feeTo = feeRecipientFor(chainId);
  const same = Boolean(feeTo) && String(feeTo).toLowerCase() === String(merchant).toLowerCase();
  if (split.fee > 0n && feeTo && isAddress(feeTo) && !same) {
    try {
      const feeTx = await sendWei(feeTo, split.fee);
      await feeTx.wait?.();
      feeHash = feeTx.hash;
    } catch {
      /* Merchant already paid — do not report the customer's payment as failed. */
    }
  }
  return { hash: merchantTx.hash, feeHash, split };
}

function readStore() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function loadSavedPayLinks() {
  return readStore();
}

export function savePayLink(entry) {
  const list = readStore().filter((row) => row.id !== entry.id);
  list.unshift(entry);
  const next = list.slice(0, MAX_SAVED);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch { /* quota — the link still works from the URL the merchant copied */ }
  return next;
}

export function removePayLink(id) {
  const next = readStore().filter((row) => row.id !== id);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}
