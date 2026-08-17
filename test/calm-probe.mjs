/**
 * CALM MUSIC PROBE — the HTTP-level half of "the calm tab lost its music".
 * ---------------------------------------------------------------------------
 * Reported: the music in News → آرامش/Calm vanished completely.
 *
 * The mechanism, pinned end to end:
 *
 *   archive.org stalls   →   fetchCalm() used to return a VALID-LOOKING
 *   `{ items: [], moodsOk: 0 }`   →   withPersistentCache() saved that
 *   EMPTINESS to memory AND Blob for six hours   →   CalmPanel rendered
 *   `null` for both "error" and "empty"   →   a tab with no tracks, no
 *   message, no way back, for every visitor, for six hours.
 *
 * Nothing was ever "deleted". The empty answer was mistaken for data.
 *
 * What this probe locks down:
 *
 *   A. the licence filter still fails CLOSED (NC/ND/unstated rejected),
 *      because a tab that fixes an outage by streaming unlicensed music is
 *      not a fix, it is a lawsuit;
 *   B. the harsh-subject filter still excludes mistagged netlabel noise;
 *   C. the route refuses to cache an empty catalogue — empty means 502
 *      CALM_UNAVAILABLE, and the NEXT request regenerates instead of
 *      re-serving;
 *   D. a real catalogue is served 200 and then really cached;
 *   E. ?force=1 bypasses the READ so a Retry/refresh can always reach the
 *      upstream even while a stale entry exists.
 *
 * Standalone: `node test/calm-probe.mjs` prints the table. The shared runner
 * (test/run.mjs) imports the default export of rows.
 *
 * The fetch stub is installed ONLY around this file's own requests and always
 * restored — other probes in the shared process keep global fetch.
 */

import { readFileSync } from 'node:fs';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
delete process.env.BLOB_READ_WRITE_TOKEN; // memory tier only, deterministic

/* ------------------------- A/B: the pure filters ------------------------- */

const { licenceOk, calmSubjectOk, pickTrack, calmResultIsUsable, fetchCalm } =
  await import('../server/calm.js');

t('CC BY is usable', licenceOk('http://creativecommons.org/licenses/by/4.0/'));
t('CC BY-SA is usable', licenceOk('https://creativecommons.org/licenses/by-sa/3.0/'));
t('public domain is usable', licenceOk('http://creativecommons.org/publicdomain/zero/1.0/'));
t('CC BY-NC is REJECTED (commercial use)', !licenceOk('http://creativecommons.org/licenses/by-nc/4.0/'));
t('CC BY-NC-SA is REJECTED', !licenceOk('http://creativecommons.org/licenses/by-nc-sa/2.5/'));
t('CC BY-ND is REJECTED', !licenceOk('http://creativecommons.org/licenses/by-nd/3.0/'));
t('an unstated licence is REJECTED (silence is not permission)', !licenceOk(''));
t('a missing licence is REJECTED', !licenceOk(null));

t('ambient stays', calmSubjectOk('ambient'));
t('the original mistagged item would still be excluded', !calmSubjectOk('ambient, industrial, dark, drone'));
t('harsh noise is excluded even beside ambient', !calmSubjectOk('ambient, noise, harsh noise'));
t('an untagged item is not punished', calmSubjectOk(undefined));

{
  const doc = {
    identifier: 'ia-demo',
    title: 'Falling Asleep At The Riverbank',
    creator: 'Demo Artist',
    licenseurl: 'http://creativecommons.org/licenses/by/4.0/'
  };
  const files = [
    { name: 'river.mp3', source: 'original', length: '200', title: 'River (original)' },
    { name: 'river_64kb.mp3', length: '198', title: 'River' }
  ];
  const built = pickTrack(doc, files);
  t('the 64kb derivative is preferred over the original', built && built.id.endsWith('river_64kb.mp3'));
  t('the track points at archive.org/download over HTTPS', built?.audioUrl.startsWith('https://archive.org/download/ia-demo/'));
  t('the licence label is carried onto the row', built?.licence === 'CC BY');
  t('the duration parses', built?.durationSec === 198);
  t('no mp3 at all means no track', pickTrack(doc, [{ name: 'cover.jpg' }]) === null);
  t('a doc whose licence lost its label yields no track', pickTrack({ ...doc, licenseurl: 'http://example.org/none' }, files) === null);
  t('an empty result is not usable', !calmResultIsUsable({ items: [] }));
  t('one track makes the result usable', calmResultIsUsable({ items: [built] }));
}

/* --------------------- C/D/E: the route, over real HTTP ------------------ */

const realFetch = globalThis.fetch;

/** A controlled archive.org stand-in. `mode` decides the upstream weather. */
function installArchiveStub(mode, counter) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('https://archive.org/')) return realFetch(url, init);
    counter.n += 1;
    if (mode === 'down') throw new Error('archive stall');
    if (u.includes('/advancedsearch.php')) {
      return new Response(
        JSON.stringify({
          response: {
            docs: [
              {
                identifier: 'ia-demo',
                title: 'Falling Asleep At The Riverbank',
                creator: 'Demo Artist',
                licenseurl: 'http://creativecommons.org/licenses/by/4.0/',
                subject: 'ambient'
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (u.includes('/metadata/ia-demo/files')) {
      return new Response(
        JSON.stringify({
          result: [{ name: 'river_64kb.mp3', length: '198', title: 'River' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('not found', { status: 404 });
  };
}

const { default: app } = await import('../server/app.js');
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const counter = { n: 0 };

try {
  /* ---- C. outage: empty is an error, never a cached answer ---- */
  installArchiveStub('down', counter);
  {
    const r1 = await realFetch(`${base}/api/calm`);
    const b1 = await r1.json();
    t('an upstream outage answers 502 CALM_UNAVAILABLE, not an empty 200',
      r1.status === 502 && b1.error === 'CALM_UNAVAILABLE');

    const afterFirst = counter.n;
    const r2 = await realFetch(`${base}/api/calm`);
    t('the empty answer was NOT cached (second request regenerates)',
      r2.status === 502 && counter.n > afterFirst);
  }

  /* ---- D. a real catalogue: 200, then genuinely cached ---- */
  installArchiveStub('ok', counter);
  {
    const r1 = await realFetch(`${base}/api/calm`);
    const b1 = await r1.json();
    t('a working upstream serves the catalogue as 200', r1.status === 200);
    t('the catalogue carries shaped tracks with a real archive.org URL',
      Array.isArray(b1.items)
        && b1.items.length >= 1
        && b1.items[0].audioUrl.startsWith('https://archive.org/download/')
        && b1.items[0].licence === 'CC BY');

    const afterWarm = counter.n;
    const r2 = await realFetch(`${base}/api/calm`);
    t('the real catalogue IS served from cache on the second request',
      r2.status === 200 && counter.n === afterWarm);

    /* ---- E. force=1 bypasses the read ---- */
    const r3 = await realFetch(`${base}/api/calm?force=1`);
    t('?force=1 bypasses the cached read and regenerates',
      r3.status === 200 && counter.n > afterWarm);
    t('the bypass response advertises itself', r3.headers.get('x-cache') === 'BYPASS');
  }

  /* ---- F. the poisoned legacy cache entry is evicted on READ ----
     The pre-fix server cached an empty catalogue for six hours, and Blob
     survives deploys — so an upgrade alone would keep serving the poison to
     whoever still had it warm. Seed exactly that entry and prove the route
     regenerates instead of re-serving it. */
  {
    const { memoryStore } = await import('../server/cache.js');
    memoryStore.set('calm', { value: { at: Date.now(), items: [], moodsOk: 0, moodsTotal: 3 }, expires: Date.now() + 3600_000, at: Date.now() });
    const before = counter.n;
    const r = await realFetch(`${base}/api/calm`);
    const b = await r.json();
    t('a cached-but-empty catalogue is regenerated, not re-served',
      r.status === 200 && counter.n > before && Array.isArray(b.items) && b.items.length >= 1);
    t('the regeneration is announced', r.headers.get('x-cache') === 'REGENERATED');
    /* and the replacement is good: the NEXT request serves it from cache */
    const afterRegen = counter.n;
    const r2 = await realFetch(`${base}/api/calm`);
    t('the regenerated catalogue replaced the poison in cache',
      r2.status === 200 && counter.n === afterRegen);
  }
} finally {
  globalThis.fetch = realFetch;
  server.close();
}

/* --------------- the panel half, pinned at the source level --------------- */
/* jsdom-level mounting lives in the screens suite; the specific regression —
   `return null` on exactly the two states the tab must now explain — is a
   one-line revert away, and only a source assertion guards that line. */
{
  const panel = readFileSync('src/components/CalmPanel.jsx', 'utf8');
  t('the panel no longer renders nothing on fetch failure', !/if \(failed\) return null/.test(panel));
  t('the panel no longer renders nothing on an empty list', !/if \(!items\.length\) return null/.test(panel));
  t('the error state exists and offers Retry', /calm\.error/.test(panel) && /common\.retry/.test(panel));
  t('the empty state is distinct and honest', /calm\.empty/.test(panel));
  t('the panel re-fetches on soft refresh (force)', /onSoftRefresh/.test(panel) && /force: true/.test(panel));

  /*
   * AND THE REAL TARGET: getCalm must never resolve against a localhost
   * origin inside the packaged app — the module must go through apiBase(),
   * which is relative on the web and the canonical origin in the APK.
   */
  const audio = readFileSync('src/lib/audio.js', 'utf8');
  t('audio.js resolves the API through apiBase() (never a bare /api in the APK)',
    /apiBase/.test(audio) && !/const API_BASE =/.test(audio));
  t('the client does not cache a trackless payload', !/calmCache = \{ at: Date\.now\(\), data \}/.test(audio) || /data\.items\.length > 0/.test(audio));
}

/* One more fan-out safety: a stubbed ALL-DOWN upstream must make fetchCalm
   settle (not throw) so the route can classify the emptiness itself. */
{
  installArchiveStub('down', counter);
  try {
    const r = await fetchCalm();
    t('fetchCalm settles on a full outage (does not reject)', Array.isArray(r?.items) && r.items.length === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

export default rows;

/* Standalone run: node test/calm-probe.mjs */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} FAILED\n` : '\nAll calm checks passed.\n');
  process.exit(failed ? 1 : 0);
}
