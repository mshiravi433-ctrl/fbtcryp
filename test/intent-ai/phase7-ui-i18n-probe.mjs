import { readFileSync, existsSync, readdirSync } from 'node:fs';

export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);

  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const have = (path) => {
    let cur = en;
    for (const p of path.split('.')) {
      if (!cur || typeof cur !== 'object' || !(p in cur)) return false;
      cur = cur[p];
    }
    return true;
  };

  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  const intentOs = readFileSync('src/pages/IntentOS.jsx', 'utf8');

  // Every static t() key in the Intent AI panel + Intent OS must exist in en.json.
  const staticKeys = (src) => [...src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
  const missing = [...new Set([...staticKeys(panel), ...staticKeys(intentOs)])].filter((k) => !have(k));
  t(`every static t() key exists in en.json${missing.length ? ` — missing: ${missing.slice(0, 4).join(', ')}` : ''}`, missing.length === 0);

  /*
   * No hardcoded Persian/Arabic in the panel or the Intent OS entry — meaning
   * no user-facing copy. Comments are exempt, and deliberately so: this repo
   * quotes the reporter's own words at each fix site (see server/app.js,
   * src/index.css, src/styles/intent-os.css), and a Persian quote inside a
   * comment is documentation, not a string a reader will ever be shown.
   *
   * Strip comments rather than skipping the check: real JSX copy such as
   * <span>سلام</span> survives the strip and is still caught.
   */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  t('IntentAIPanel holds no hardcoded fa/ar', !/[\u0600-\u06ff]/.test(stripComments(panel)));
  t('Intent OS entry holds no hardcoded fa/ar', !/[\u0600-\u06ff]/.test(stripComments(intentOs)));

  // The panel exposes the full Confirmation Gate actions.
  for (const action of ['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE']) {
    t(`IntentAIPanel offers ${action}`, panel.includes(`'${action}'`));
  }
  t('IntentAIPanel renders an honest receipt', panel.includes('intentAI.receipt.') || panel.includes("t(`intentAI.receipt."));

  // The panel uses the Confirmation Gate + honest venue + reconcile modules.
  t('IntentAIPanel uses the real confirmation gate', panel.includes('openConfirmationGate') && panel.includes('decideGate') && panel.includes('assertGateAllowsSubmit'));
  t('IntentAIPanel uses venueHealth (honest config)', panel.includes('venueHealth'));
  t('IntentAIPanel uses honest reconcile', panel.includes('reconcile'));

  // Activation honesty: SecureMemoryMap is a Phase-2 stand-in, not a real Secret Manager.
  t('readiness admits SecureMemoryMap is a stand-in', panel.includes('secretManagerStandIn'));
  const secureMap = readFileSync('src/lib/intent-ai/secureMemoryMap.js', 'utf8');
  t('SecureMemoryMap doc is explicit stand-in', /stand-in|standin|Phase-2/i.test(secureMap));

  // The external agent catalog never carries an execute/sign control.
  const catalogClient = readFileSync('src/lib/ecosystemCatalog.js', 'utf8');
  t('catalog client never writes', !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(catalogClient));
  t('Intent OS hero links to the assistant, not a catalog execute', /navigate\('\/intent-ai'\)/.test(intentOs));

  // Route exists for the panel.
  const appSrc = readFileSync('src/App.jsx', 'utf8');
  t('panel has a route', /path="\/intent-ai"/.test(appSrc) && /IntentAIPanel/.test(appSrc));

  // Locale key parity is maintained (fa/ar carry the new keys). Just check the new namespace.
  for (const code of ['fa', 'ar']) {
    const locale = JSON.parse(readFileSync(`src/i18n/locales/${code}.json`, 'utf8'));
    t(`${code} carries intentAI namespace`, !!locale.intentAI && !!locale.intentOS?.aiAssistant);
  }

  return rows;
}
