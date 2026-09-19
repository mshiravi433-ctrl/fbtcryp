#!/usr/bin/env node
/**
 * IS ANY WALLET-SECURITY FEED CURRENTLY NAMING OUR DOMAIN?
 * ---------------------------------------------------------------------------
 * Asked for: «والت می‌گوید این dApp به نظر می‌رسد کلاهبرداری باشد و باید خارج
 * شوی». That sentence comes from a domain blocklist, not from our code — and a
 * blocklist is invisible from the browser. This script asks the public ones
 * that answer without an account, so the next report starts with evidence
 * instead of a guess.
 *
 * ─── WHAT IT CHECKS, AND WHY EACH ONE ───────────────────────────────────────
 *   MetaMask eth-phishing-detect   the open list MetaMask, Rabby, Frame and
 *                                  several wallets read directly. A domain in
 *                                  its `blacklist` shows «Deceptive site ahead».
 *   ScamSniffer domain list        a widely mirrored drainer/phishing feed.
 *   ChainPatrol                   the feed WalletConnect's own Verify service
 *                                  leans on for its THREAT verdict.
 *   Google Safe Browsing          optional (`--gsb-key=` or GSB_API_KEY): what
 *                                  Chrome, and therefore the dApp browsers,
 *                                  warn from.
 *   the two URLs a wallet fetches  the prompt ICON and the Reown verification
 *                                  file. A wallet that cannot fetch the icon
 *                                  shows a blank/generic entry, and the Verify
 *                                  service cannot confirm ownership without the
 *                                  file — both read as "unknown dApp".
 *
 * ─── WHAT IT CANNOT DO ──────────────────────────────────────────────────────
 * Blowfish (Phantom, Backpack, Solflare, and the feed inside Trust Wallet) has
 * no public lookup: their verdict is only visible to the wallet itself, and a
 * whitelisting request is an email. The script prints that path at the end
 * with the address to write to. Nothing here can remove a listing — only the
 * list's own maintainers can, and there is no automation for that.
 *
 * Best effort by design: a feed that is unreachable reports UNKNOWN, never a
 * pass. Run it after every deploy, and any time a wallet prompt changes.
 *
 *     node scripts/wallet-reputation-check.mjs
 *     node scripts/wallet-reputation-check.mjs --domain=fbtswap.ir
 *     GSB_API_KEY=... node scripts/wallet-reputation-check.mjs
 */

const args = process.argv.slice(2);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(hit.indexOf('=') + 1).trim() : null;
};

const DOMAIN = (valueOf('domain') || 'fbtswap.ir').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
const GSB_KEY = valueOf('gsb-key') || process.env.GSB_API_KEY || '';
const TIMEOUT_MS = 15_000;

const results = [];
const record = (name, status, detail, fix) => {
  results.push({ name, status, detail, fix });
  const mark = status === 'FLAGGED' ? '❌' : status === 'CLEAR' ? '✅' : '⚠️';
  console.log(`${mark} ${name} — ${status}`);
  if (detail) console.log(`      ${detail}`);
};

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** `host.tld` and every subdomain of it, matched on a label boundary so
 *  `evil-fbtswap.ir.example.com` is never read as a hit. */
const hitsDomain = (text, domain) => {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*${escaped}(?![a-z0-9-])`, 'i').test(text);
};

/* ── 1. MetaMask eth-phishing-detect ─────────────────────────────────────── */
async function checkMetaMask() {
  const url = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return record('MetaMask eth-phishing-detect', 'UNKNOWN', `HTTP ${res.status}`);
    const config = await res.json();
    const inList = (key) => (Array.isArray(config?.[key]) ? config[key] : []).some((host) => hitsDomain(String(host), DOMAIN));
    const blacklisted = inList('blacklist') || inList('fuzzylist');
    const whitelisted = inList('whitelist');
    if (blacklisted) {
      record('MetaMask eth-phishing-detect', 'FLAGGED',
        `listed in blacklist/fuzzylist (${inList('blacklist') ? 'blacklist' : 'fuzzylist'})`,
        'MetaMask/eth-phishing-detect: open a PR removing the domain, with evidence (docs/WALLET-SCAM-WARNING-FA.md §4)');
      return;
    }
    record('MetaMask eth-phishing-detect', 'CLEAR',
      whitelisted ? 'present on the whitelist' : 'not listed (also not whitelisted)');
  } catch (error) {
    record('MetaMask eth-phishing-detect', 'UNKNOWN', String(error?.message || error));
  }
}

/* ── 2. ScamSniffer ──────────────────────────────────────────────────────── */
async function checkScamSniffer() {
  const url = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return record('ScamSniffer domain list', 'UNKNOWN', `HTTP ${res.status}`);
    const text = await res.text();
    if (hitsDomain(text, DOMAIN)) {
      record('ScamSniffer domain list', 'FLAGGED', 'the domain appears in the raw feed',
        'mail support@scamsniffer.io / open an issue on scamsniffer/scam-database with the evidence package');
    } else {
      record('ScamSniffer domain list', 'CLEAR', `${text.length} bytes searched`);
    }
  } catch (error) {
    record('ScamSniffer domain list', 'UNKNOWN', String(error?.message || error));
  }
}

/* ── 3. ChainPatrol (the feed behind WalletConnect Verify's THREAT verdict) ─ */
async function checkChainPatrol() {
  const url = `https://app.chainpatrol.io/api/v2/asset/check?content=${encodeURIComponent(DOMAIN)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return record('ChainPatrol', 'UNKNOWN', `HTTP ${res.status}`);
    const body = await res.json().catch(() => null);
    const status = String(body?.status || '').toUpperCase();
    if (status === 'BLOCK') {
      record('ChainPatrol', 'FLAGGED', JSON.stringify(body?.asset || body),
        'https://app.chainpatrol.io/ → report a false positive (this is what puts the THREAT verdict in WalletConnect Verify)');
    } else if (status) {
      record('ChainPatrol', 'CLEAR', `status=${status}`);
    } else {
      record('ChainPatrol', 'UNKNOWN', 'the endpoint answered in an unexpected shape');
    }
  } catch (error) {
    record('ChainPatrol', 'UNKNOWN', String(error?.message || error));
  }
}

/* ── 4. Google Safe Browsing (optional; needs a key) ─────────────────────── */
async function checkSafeBrowsing() {
  if (!GSB_KEY) {
    return record('Google Safe Browsing', 'UNKNOWN',
      'no API key — set GSB_API_KEY or pass --gsb-key= (or use the manual report page)');
  }
  try {
    const res = await fetchWithTimeout(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GSB_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'fbt-swap', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url: `https://${DOMAIN}/` }]
        }
      })
    });
    if (!res.ok) return record('Google Safe Browsing', 'UNKNOWN', `HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (Array.isArray(body?.matches) && body.matches.length) {
      record('Google Safe Browsing', 'FLAGGED', body.matches.map((m) => m.threatType).join(', '),
        'https://safebrowsing.google.com/safebrowsing/report_error/ — request a review');
    } else {
      record('Google Safe Browsing', 'CLEAR', 'no match');
    }
  } catch (error) {
    record('Google Safe Browsing', 'UNKNOWN', String(error?.message || error));
  }
}

/* ── 5 & 6. The two URLs a wallet itself fetches ─────────────────────────── */
async function checkWalletFetchedUrls() {
  for (const [name, path, why] of [
    ['dApp icon (wallet prompt)', '/icon-512.png', 'a wallet that cannot fetch it shows a blank entry'],
    ['Reown verification file', '/.well-known/walletconnect.txt', 'without it the domain stays UNVERIFIED in every wallet prompt']
  ]) {
    const url = `https://${DOMAIN}${path}`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        record(name, 'FLAGGED', `${url} → HTTP ${res.status} (${why})`);
      } else {
        const bytes = Number(res.headers.get('content-length') || 0);
        record(name, 'CLEAR', `${url} → ${res.status}${bytes ? ` (${bytes} bytes)` : ''}`);
      }
    } catch (error) {
      record(name, 'UNKNOWN', `${url} → ${String(error?.message || error)}`);
    }
  }
}

console.log(`\nWallet reputation check — ${DOMAIN}\n${'-'.repeat(60)}`);
await checkMetaMask();
await checkScamSniffer();
await checkChainPatrol();
await checkSafeBrowsing();
await checkWalletFetchedUrls();

const flagged = results.filter((r) => r.status === 'FLAGGED');
const unknown = results.filter((r) => r.status === 'UNKNOWN');

console.log(`\n${'-'.repeat(60)}`);
console.log(`${results.length - flagged.length - unknown.length} clear · ${flagged.length} flagged · ${unknown.length} unknown`);

if (flagged.length) {
  console.log('\nWhat to do about each ❌:');
  for (const row of flagged) console.log(`  · ${row.name}: ${row.fix || 'see docs/WALLET-SCAM-WARNING-FA.md'}`);
}

/*
 * Blowfish is printed unconditionally: it has no public lookup, so a silent
 * pass here would suggest the most common source of the report has been
 * checked when it has not.
 */
console.log(`
Not checkable from here, and the most common source of «این dApp به نظر می‌رسد
کلاهبرداری باشد» (Phantom, Backpack, Solflare, and the scanner inside Trust
Wallet):
  · Blowfish / Phantom — email review@blowfish.xyz AND review@phantom.com with
    the evidence package; @blowfishxyz on X only if a known Solana developer
    vouches. https://github.com/orgs/phantom/discussions (open a discussion).
  · Blockaid (Trust Wallet, MetaMask, Coinbase) —
    https://report.blockaid.io/ → "Developer" to verify the project,
    "Mistake" to appeal a false positive.
  · WalletConnect Verify — dashboard.reown.com → Domains (run
    scripts/walletconnect-domain-verify.mjs).`);

console.log('\nFull playbook: docs/WALLET-SCAM-WARNING-FA.md\n');
