const probes = [
  'walletconnect-wiring.mjs',
  'wc-connect-probe.mjs',
  'wc-timeout-probe.mjs',
  'wc-storage-probe.mjs',
  'wc-chain-probe.mjs',
  'wc-wallets-probe.mjs',
  'wc-deeplink-probe.mjs',
  'wc-uri-hygiene-probe.mjs',
  'wc-pairing-surface-probe.mjs',
  'wallet-health-probe.mjs',
  'email-social-probe.mjs'
];
let fails = 0, total = 0;
for (const p of probes) {
  try {
    const { default: run } = await import(`./${p}`);
    const rows = await run();
    const bad = rows.filter(([, ok]) => !ok);
    total += rows.length; fails += bad.length;
    console.log(`${bad.length ? '✗' : '✓'} ${p}: ${rows.length - bad.length}/${rows.length}`);
    for (const [label] of bad) console.log(`    FAIL: ${label}`);
  } catch (e) {
    console.log(`✗ ${p}: THREW — ${e?.message}`);
    console.log(String(e?.stack || '').split('\n').slice(0, 6).join('\n'));
    fails += 1;
  }
}
console.log(`\n${total} assertions, ${fails} failures`);
