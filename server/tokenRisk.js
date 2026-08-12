/**
 * Token security proxy.
 *
 * GoPlus is free and keyless for the basic token-security endpoint. We still
 * proxy it so the browser never talks to a third-party security API (a leak
 * of which tokens a user is about to buy) and so one cache serves everyone
 * looking at the same contract.
 *
 * Failures return { report: null } rather than 502: the swap screen must
 * still work when a scanner is down, and a red banner that says "we could
 * not check" is the honest answer.
 */

const GOPLUS = 'https://api.gopluslabs.io/api/v1/token_security';

const ALLOWED = new Set(['1', '56', '137', '42161', '10', '8453', '43114', '59144']);

function isAddr(s) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || ''));
}

function yes(v) {
  return v === '1' || v === 1 || v === true || String(v).toLowerCase() === 'true';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Shape the GoPlus payload into the report the client scorer expects. */
export function shapeGoplus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const buyTax = num(raw.buy_tax);
  const sellTax = num(raw.sell_tax);
  const holders = Array.isArray(raw.holders) ? raw.holders : [];
  const top10 = num(raw.top10_holder_rate);
  const topShare =
    top10 != null
      ? top10 > 1
        ? top10 / 100
        : top10
      : holders.length
        ? holders.slice(0, 10).reduce((a, h) => a + (num(h.percent) ?? 0), 0)
        : null;

  const lpHolders = Array.isArray(raw.lp_holders) ? raw.lp_holders : [];
  const lockedShare = lpHolders
    .filter((h) => yes(h.is_locked))
    .reduce((a, h) => a + (num(h.percent) ?? 0), 0);

  return {
    honeypot: yes(raw.is_honeypot) || yes(raw.cannot_sell_all),
    cannotBuy: yes(raw.cannot_buy),
    cannotSell: yes(raw.cannot_sell_all) || yes(raw.is_honeypot),
    buyTax: buyTax != null ? (buyTax > 1 ? buyTax : buyTax * 100) : null,
    sellTax: sellTax != null ? (sellTax > 1 ? sellTax : sellTax * 100) : null,
    mintable: yes(raw.is_mintable),
    pausable: yes(raw.transfer_pausable),
    blacklist: yes(raw.is_blacklisted),
    proxy: yes(raw.is_proxy),
    openSource: raw.is_open_source == null ? null : yes(raw.is_open_source),
    ownerChangeBalance: yes(raw.owner_change_balance) || yes(raw.can_take_back_ownership),
    hiddenOwner: yes(raw.hidden_owner),
    selfDestruct: yes(raw.selfdestruct),
    externalCall: yes(raw.external_call),
    holderCount: num(raw.holder_count),
    top10Share: topShare != null && topShare > 1 ? topShare / 100 : topShare,
    lpLocked: lpHolders.length ? lockedShare >= 50 : null,
    liquidityUsd: num(raw.dex?.[0]?.liquidity),
    buyTaxModifiable: yes(raw.slippage_modifiable),
    tradingCooldown: yes(raw.trading_cooldown),
    isInDex: raw.is_in_dex == null ? null : yes(raw.is_in_dex)
  };
}

export async function fetchTokenRisk(chainId, address) {
  const chain = String(chainId || '');
  if (!ALLOWED.has(chain)) return { error: 'UNSUPPORTED_CHAIN' };
  if (!isAddr(address)) return { error: 'BAD_ADDRESS' };

  const url = `${GOPLUS}/${chain}?contract_addresses=${address.toLowerCase()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { error: 'UPSTREAM', status: res.status };
    const body = await res.json();
    const raw = body?.result?.[address.toLowerCase()] ?? null;
    return { report: shapeGoplus(raw), raw };
  } catch (err) {
    return { error: 'UPSTREAM', detail: String(err?.message || err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
