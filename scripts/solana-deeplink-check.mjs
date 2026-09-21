#!/usr/bin/env node
/**
 * SOLANA DEEPLINK READINESS — the other side, measured.
 * ---------------------------------------------------------------------------
 * The reported bug: «سولنا برای وصل شدن به کیف پول ما با دیپ لینک کار
 * نمی‌ده» — the connect request is built correctly (test/solana-deeplink-probe
 * proves the exchange end to end), but the request can only be DELIVERED if
 * the wallet's own infrastructure answers:
 *
 *   · Android hands an https URL to the app only when the host's
 *     /.well-known/assetlinks.json claims it — and the claim must name the
 *     package the code's intent URL scopes to (`package=app.phantom`);
 *   · iOS does the same with /.well-known/apple-app-site-association, and the
 *     component must cover the path the code builds (`/ul/*`);
 *   · the endpoint itself must answer — a dead /ul/v1/connect renders as
 *     «wallet opens, nothing to approve».
 *
 * Nothing in this repo controls any of that, so the only honest answer is a
 * measurement: run this after a deploy, or the next time the report arrives,
 * and the output says WHICH half of the bridge is broken — ours or the
 * wallet's — instead of guessing on a phone.
 *
 *     node scripts/solana-deeplink-check.mjs
 *     node scripts/solana-deeplink-check.mjs --wallet=phantom
 *     node scripts/solana-deeplink-check.mjs --check     # CI gate
 *
 * Best effort by design: an unreachable endpoint reports UNKNOWN, never a
 * pass. The code side stays network-free (see the probe); only this script
 * leaves the machine.
 */

import {
  DEEPLINK_WALLETS,
  connectRequestUrl,
  deeplinkWallet
} from '../src/lib/solana/deeplinkUri.js';

const args = process.argv.slice(2);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(hit.indexOf('=') + 1).trim() : null;
};
const hasCheck = args.includes('--check');
const ONLY = valueOf('wallet');
const TIMEOUT_MS = 15_000;

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  const mark = status === 'OK' ? '✅' : status === 'BROKEN' ? '❌' : '⚠️';
  console.log(`${mark} ${name} — ${status}`);
  if (detail) console.log(`      ${detail}`);
};

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

const wallets = ONLY ? DEEPLINK_WALLETS.filter((w) => w.id === ONLY) : DEEPLINK_WALLETS;
if (ONLY && !wallets.length) {
  console.error(`unknown wallet: ${ONLY} (known: ${DEEPLINK_WALLETS.map((w) => w.id).join(', ')})`);
  process.exit(2);
}

for (const wallet of wallets) {
  const host = new URL(wallet.base).host;

  /* ── Android: the assetlinks claim, and the package the intent names ── */
  const aaUrl = `https://${host}/.well-known/assetlinks.json`;
  let aaBody = null;
  let aaStatus = null;
  try {
    const res = await fetchWithTimeout(aaUrl);
    aaStatus = res.status;
    if (res.ok) aaBody = await res.json();
  } catch (err) {
    record(`${wallet.label} · Android app links`, 'UNKNOWN', `${aaUrl} unreachable (${String(err?.message || err).slice(0, 80)})`);
  }
  if (aaStatus !== null) {
    const entries = Array.isArray(aaBody) ? aaBody : [];
    const claims = entries.filter(
      (e) => Array.isArray(e?.relation) && e?.relation.includes('delegate_permission/common.handle_all_urls')
    );
    const namesPackage = claims.some((e) => e?.target?.package_name === wallet.androidPackage);
    if (!entries.length) {
      record(`${wallet.label} · Android app links`, 'BROKEN',
        `no .well-known/assetlinks.json on ${host} (HTTP ${aaStatus}) — Android will never hand the connect URL to the app; the user sees the wallet's web page instead of an approval screen`);
    } else if (!namesPackage) {
      record(`${wallet.label} · Android app links`, 'BROKEN',
        `assetlinks.json lists ${claims.map((e) => e?.target?.package_name).filter(Boolean).join(', ') || 'nothing'} but the code scopes the intent to ${wallet.androidPackage} — the package names must agree`);
    } else {
      record(`${wallet.label} · Android app links`, 'OK', `${host} claims handle_all_urls for ${wallet.androidPackage}`);
    }
  }

  /* ── iOS: the AASA claim, and the /ul/* component the request lives in ── */
  const aasaUrl = `https://${host}/.well-known/apple-app-site-association`;
  let aasaBody = null;
  let aasaStatus = null;
  try {
    const res = await fetchWithTimeout(aasaUrl);
    aasaStatus = res.status;
    if (res.ok) aasaBody = await res.json();
  } catch (err) {
    record(`${wallet.label} · iOS universal links`, 'UNKNOWN', `${aasaUrl} unreachable (${String(err?.message || err).slice(0, 80)})`);
  }
  if (aasaStatus !== null) {
    const details = aasaBody?.applinks?.details ?? [];
    const covers = details.some((d) =>
      (d?.components ?? []).some((c) => {
        const comp = String(Object.keys(c)?.[0] ?? '');
        return comp.startsWith('/ul') || comp === '/';
      })
    );
    if (!details.length) {
      record(`${wallet.label} · iOS universal links`, 'BROKEN',
        `no apple-app-site-association on ${host} (HTTP ${aasaStatus}) — Safari will never open the app for the connect URL`);
    } else if (!covers) {
      record(`${wallet.label} · iOS universal links`, 'BROKEN',
        `AASA components do not cover /ul/*: ${JSON.stringify(details.map((d) => d?.components)).slice(0, 140)}`);
    } else {
      record(`${wallet.label} · iOS universal links`, 'OK',
        `AASA on ${host} covers the /ul/* paths the requests use`);
    }
  }

  /* ── the endpoint itself, with a request shaped exactly like ours ── */
  const probeUrl = connectRequestUrl({
    walletId: wallet.id,
    dappPublicKey: '11111111111111111111111111111111',
    redirectLink: `https://fbtswap.ir/?sol=1&rid=${'1'.repeat(11)}`,
    appUrl: 'https://fbtswap.ir/',
    cluster: 'mainnet-beta'
  });
  try {
    const res = await fetchWithTimeout(probeUrl, { method: 'GET' });
    const text = (await res.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
    const live = res.status >= 200 && res.status < 400;
    record(`${wallet.label} · connect endpoint`, live ? 'OK' : 'BROKEN',
      `${new URL(probeUrl).origin}${new URL(probeUrl).pathname} → HTTP ${res.status}${text ? ` · «${text}»` : ''}`);
  } catch (err) {
    record(`${wallet.label} · connect endpoint`, 'UNKNOWN',
      `${new URL(probeUrl).origin} unreachable (${String(err?.message || err).slice(0, 80)})`);
  }
}

/* ── the code's own table, stated next to the measurement ────────────────── */
console.log('');
console.log('Code side (src/lib/solana/deeplinkUri.js):');
for (const wallet of DEEPLINK_WALLETS) {
  console.log(`  ${wallet.id.padEnd(9)} base=${wallet.base}  package=${wallet.androidPackage}`);
}

const broken = results.filter((r) => r.status === 'BROKEN');
const unknown = results.filter((r) => r.status === 'UNKNOWN');
console.log('');
if (broken.length) {
  console.log(`VERDICT: BROKEN — ${broken.length} check(s) fail. The delivery side is broken; ` +
    'the request the app builds is correct (see test/solana-deeplink-probe.mjs), so fix or report the wallet-side entry above.');
} else if (unknown.length) {
  console.log(`VERDICT: UNMEASURED — ${unknown.length} check(s) could not be reached from this network. ` +
    'Re-run on a machine with ordinary connectivity before blaming the code.');
} else {
  console.log('VERDICT: OK — every wallet-side hop answers and matches the package names the code ships. ' +
    'If a phone still shows no approval screen, the next suspect is the device itself (wallet version, «open links in apps» setting); the sheet\'s stuck card offers the wallet\'s own browser as the route that survives that case.');
}
process.exit(hasCheck && broken.length ? 1 : 0);
