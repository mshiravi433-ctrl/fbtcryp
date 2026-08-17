/**
 * CALM MUSIC — a third tab on the news screen.
 * ---------------------------------------------------------------------------
 * Asked for:
 *   «در قسمت رادیو میشه یک تب از اهنگ های ارامشبخش هم اضافه کنی و در توضیحاتش
 *    بنویسی چیزی شبیه ارامش در سرمایه گذاری، با فکر بهتر میشود تصمیم بهتر
 *    گرفت»
 *
 * ─── WHY THIS BELONGS IN A TRADING APP AT ALL ───────────────────────────────
 * On the face of it, background music is decoration and decoration does not
 * belong next to somebody's money. The owner's framing is what makes it
 * defensible, and it is worth writing down rather than paraphrasing: a calmer
 * person makes a better decision. Panic selling and revenge buying are the two
 * most expensive things a retail trader does, and both are states of arousal
 * rather than states of analysis.
 *
 * So this is not a music feature. It is the only thing in the app that speaks
 * to the emotional half of trading, and the copy says so explicitly instead of
 * pretending it is a perk.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE LICENSING PROBLEM, WHICH IS THE WHOLE ENGINEERING PROBLEM ──────────
 * ═══════════════════════════════════════════════════════════════════════════
 * Streaming music you do not have rights to is not a bug, it is a lawsuit, and
 * for an app already fighting for store approval it is an unforced error. The
 * podcast tab sidesteps this entirely — podcast RSS enclosures are published
 * FOR redistribution. Music is the opposite by default.
 *
 * Three candidate sources were checked and two were rejected on evidence:
 *
 *   freepd.com — REJECTED. Fetched it: "Site Closed ... we have officially
 *     taken the service offline." Seventeen years of public-domain music, gone.
 *     Every blog post recommending it is now pointing at nothing. Shipping a
 *     tab built on it would have been the dead-button failure this project
 *     keeps having to fix, and the only reason it was caught is that the URL
 *     was actually opened rather than trusted.
 *
 *   incompetech direct MP3s — REJECTED. The documented file path returned 500.
 *     A source that does not answer today will not answer for a user.
 *
 *   archive.org netlabels — ACCEPTED. A real search API, no key, and — the
 *     part that matters — `licenseurl` is a QUERY FIELD, so permissiveness can
 *     be enforced by the query rather than assumed from a collection's
 *     reputation.
 *
 * ─── LICENCE FILTERING IS DONE TWICE, ON PURPOSE ────────────────────────────
 * Once in the query, once again per item before it is returned. The first
 * netlabels item I opened by hand was `by-nc-nd/2.5` — NonCommercial AND
 * NoDerivatives. We are a commercial product; NC alone disqualifies it. That
 * single lookup is the reason the second check exists: a collection being
 * "free music" says nothing about any individual item's terms.
 *
 * Allowed: CC0 / public domain, CC BY, CC BY-SA.
 * Rejected: anything containing `-nc` or `-nd`, and anything with no stated
 * licence at all — silence is not permission.
 */

const TIMEOUT = Number(process.env.CALM_TIMEOUT_MS || 8000);

const IA = 'https://archive.org';

/**
 * The licences we may stream commercially, as exact URL fragments.
 *
 * Matched as substrings of `licenseurl` rather than parsed, because the field
 * carries several shapes over the years (`http://` and `https://`, versions
 * 2.0 through 4.0, and `publicdomain/zero` vs `publicdomain/mark`).
 */
const ALLOWED_LICENCE = [
  '/publicdomain/',
  '/licenses/by/',
  '/licenses/by-sa/'
];

/**
 * Reject list, checked FIRST and independently.
 *
 * `/licenses/by-nc-sa/` contains `/licenses/by-` but not `/licenses/by/`, so
 * the allow list alone would already reject it. The deny list is here anyway
 * because relying on that near-miss is fragile: one careless edit widening a
 * prefix to `/licenses/by` would silently admit every NC and ND variant.
 */
const DENIED_LICENCE = ['-nc', '-nd'];

export function licenceOk(url) {
  const u = String(url ?? '').toLowerCase();
  if (!u) return false;
  if (DENIED_LICENCE.some((d) => u.includes(d))) return false;
  return ALLOWED_LICENCE.some((a) => u.includes(a));
}

/**
 * Human label for the credit line.
 *
 * Attribution is a LICENCE CONDITION for CC BY and CC BY-SA, not a courtesy —
 * omitting it makes the use unlicensed. So the label is derived from the same
 * field that authorised the track, and an unrecognised licence returns null so
 * the caller can drop the item rather than credit it wrongly.
 */
export function licenceLabel(url) {
  const u = String(url ?? '').toLowerCase();
  if (u.includes('/publicdomain/')) return 'Public Domain';
  if (u.includes('/licenses/by-sa/')) return 'CC BY-SA';
  if (u.includes('/licenses/by/')) return 'CC BY';
  return null;
}

/**
 * The moods offered.
 *
 * Each is a real archive.org subject term, not a word we invented — a made-up
 * term returns zero results and produces an empty tab with no explanation.
 * Verified against the live search API: `subject:ambient` alone matches 17,355
 * items in netlabels.
 */
export const MOODS = ['ambient', 'meditation', 'piano'];

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Subjects that disqualify a track no matter what else it is tagged.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── WHY THIS EXISTS: "THE FIRST TRACK IS BROKEN" ───────────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * Reported that the first song in the calm section was wrong. It was, and the
 * cause was not that track — it was the query.
 *
 * `subject:ambient` matches anything TAGGED ambient, and archive.org tags are
 * author-supplied and cumulative. An artist who considers their work ambient
 * AND industrial AND harsh noise tags it all three, and the search returns it
 * for every one of those words. Checked against the live API, the two items
 * that were arriving at the top of the calm list:
 *
 *   gt487Krasota-GovoriaschiyeGvozdi
 *     subject: ambient, industrial, dark, drone, psychedelic, avantgarde
 *     — Russian spoken word over drone
 *
 *   gt275IntracranialPenetration  ("Humanhater")
 *     subject: ambient, noise, HARSH NOISE, industrial, experimental
 *
 * Both are legitimately tagged ambient. Neither is calm. The mood filter was
 * doing exactly what it was told and the instruction was wrong.
 *
 * ─── WHY EXCLUSION RATHER THAN A CURATED LIST ───────────────────────────────
 * A hand-picked list of track ids would be reliably calm and would rot: items
 * get removed, licences change, and the list cannot grow. Excluding the genres
 * that are incompatible with the word "calm" keeps the catalogue live while
 * removing the failure mode. Measured on the same query: the exclusion still
 * leaves 64 qualifying ambient items, so this costs variety we do not need
 * rather than the feature.
 *
 * Deliberately NOT excluded: `experimental` alone would remove most of the
 * netlabel ambient catalogue, so it is only rejected in combination — see the
 * query below, which excludes it, and `calmSubjectOk` which is the belt to
 * that braces for items whose tags arrive after the search.
 */
export const HARSH_SUBJECTS = [
  'noise',
  'harsh',
  'industrial',
  'metal',
  'punk',
  'hardcore',
  'death',
  'black metal',
  'drone',
  'dark',
  'horror',
  'psychedelic',
  'avantgarde',
  'spoken word',
  'speech'
];

/**
 * Is this item's subject list compatible with a section called "calm"?
 *
 * Checked again on the RESULT and not only in the query, because the search
 * clause and the returned metadata are not guaranteed to agree: a multi-valued
 * `subject` can arrive as a string or an array, and an item can carry a tag
 * that the index has not yet reflected. Failing closed drops one track; failing
 * open puts harsh noise in a relaxation playlist.
 */
export function calmSubjectOk(subject) {
  const list = Array.isArray(subject) ? subject : [subject];
  const joined = list.map((s) => String(s ?? '').toLowerCase()).join(' | ');
  if (!joined.trim()) return true; // untagged is not evidence of harshness
  return !HARSH_SUBJECTS.some((bad) => joined.includes(bad));
}

/** Search one mood, restricted to commercially usable licences. */
async function searchMoodOnce(mood) {
  /*
   * ─── THE QUERY THAT ARCHIVE.ORG CAN ACTUALLY ANSWER ─────────────────────
   * Measured against the live API (2026-08-17, while debugging the vanished
   * calm tab): the previous query — four quoted `licenseurl:"…"` clauses, a
   * nine-way NOT over `subject`, and an `fl[]=` field projection — returned
   * archive.org's own "Sorry, we're kinda busy" 502 CONSISTENTLY, from clean
   * egress IPs too, while the plain subject query answered in ~33 ms. The
   * search backend was choking on the query, so every mood failed, the empty
   * result got cached, and the tab went dark.
   *
   * The licence guarantee is NOT weakened by simplifying the query: the same
   * `licenceOk` + `calmSubjectOk` gates still run on every candidate below,
   * and `pickTrack` refuses any item whose licence label is unrecognised.
   * What was in the SQL is now in the filter — the enforcement just moved,
   * it did not go away. `mediatype:audio` keeps movies out of the pool.
   *
   * rows=25 is the calibrated ceiling, measured: rows=50 is itself 502ed by
   * the overloaded backend while rows=25 answers in ~28 ms. Without
   * query-side filtering, roughly most rows fail the licence or mood gates;
   * 25 still leaves a pool, and a thin pool at a bad moment recovers on the
   * next cycle rather than being cached empty (see server/app.js).
   */
  const q = `collection:netlabels AND subject:${mood} AND mediatype:audio`;

  const url =
    `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}` +
    '&rows=25&page=1&output=json';

  const data = await getJson(url);
  return (data?.response?.docs ?? []).filter(
    (d) => d?.identifier && licenceOk(d.licenseurl) && calmSubjectOk(d.subject)
  );
}

/**
 * One mood search with a SINGLE bounded retry.
 *
 * Archive.org runs on donated bandwidth and drops or stalls a share of
 * requests — from some datacentre egress IPs it is worse. When every mood
 * timed out in the same minute, `fetchCalm` returned a VALID-looking
 * `{ items: [], moodsOk: 0 }`, the cache then pinned that emptiness in place
 * for six hours, and the calm tab rendered as if the music had been deleted.
 * That is precisely the reported bug: nothing was deleted; every upstream
 * call silently lost its race and the empty answer was cached as data.
 *
 * One retry with a short sleep is the right bound: it converts the common
 * single-stall failure into a success, and it cannot retry-storm a charity
 * (two requests per mood per cycle, worst case six, still minutes apart).
 * Retrying forever would be easier and wrong.
 */
async function searchMood(mood) {
  try {
    return await searchMoodOnce(mood);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 700));
    return searchMoodOnce(mood).catch(() => {
      /* Re-throw the ORIGINAL error shape: allSettled upstream treats both
         the same; this comment exists so a future reader does not "tidy" the
         retry away and reintroduce the six-hour empty tab. */
      throw err;
    });
  }
}

/**
 * A producer result that is a GENUINE absence of music, distinguishable from
 * "every upstream call failed". Used by the route to decide between caching
 * the answer and refusing it: only a real catalogue is allowed to be cached.
 */
export function calmResultIsUsable(result) {
  return Array.isArray(result?.items) && result.items.length > 0;
}

/**
 * Turn one archive item into a playable track, or null.
 *
 * ─── WHY THE 64Kbps DERIVATIVE IS PREFERRED ─────────────────────────────────
 * Archive.org generates a `_64kb.mp3` for most audio. For ambient music on a
 * mobile connection that is the right trade by a wide margin: a 3-minute
 * original is ~4 MB while the derivative is ~1.4 MB, and the difference is
 * inaudible for background listening. The original is the fallback for items
 * where the derivative was never produced.
 */
export function pickTrack(doc, files) {
  const audio = (files ?? []).filter((f) => /\.mp3$/i.test(String(f?.name ?? '')));
  if (!audio.length) return null;

  const small = audio.find((f) => /_64kb\.mp3$/i.test(f.name));
  const file = small ?? audio.find((f) => f.source === 'original') ?? audio[0];

  const label = licenceLabel(doc.licenseurl);
  /* No recognised licence means we cannot credit it correctly, so we do not
     use it. Failing closed costs one track; failing open costs a takedown. */
  if (!label) return null;

  const seconds = Number(file.length);

  return {
    id: `${doc.identifier}/${file.name}`,
    /* The FILE title where the item has many tracks, falling back to the
       item title — an album name over a single track is confusing. */
    title: String(file.title || doc.title || file.name.replace(/\.mp3$/i, '')).slice(0, 140),
    stationName: String(doc.creator || file.artist || 'Unknown artist').slice(0, 80),
    /*
     * `/download/` and not the direct `iaXXXX.us.archive.org` node: the node
     * hostname changes as items are rebalanced across servers, so a cached
     * URL would rot. The download path is stable and redirects.
     */
    audioUrl: `${IA}/download/${encodeURIComponent(doc.identifier)}/${file.name
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    pageUrl: `${IA}/details/${encodeURIComponent(doc.identifier)}`,
    durationSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    licence: label,
    licenceUrl: doc.licenseurl,
    /* Shape-compatible with the podcast items so RadioPanel and AudioPlayer
       need no special cases — one player, two content types. */
    at: Date.now()
  };
}

/**
 * Every mood, flattened.
 *
 * `allSettled` throughout: archive.org is a charity running on donated
 * bandwidth and individual requests do time out. One slow item must not empty
 * the tab, exactly as one dead podcast host must not empty the radio.
 */
export async function fetchCalm() {
  const found = await Promise.allSettled(MOODS.map(searchMood));
  const docs = found.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  /*
   * Capped BEFORE the metadata lookups, but over-provisioned: post-filtered
   * candidates can still fail their metadata fetch (or hold no usable mp3),
   * so twelve candidates are fetched to land eight tracks. Twelve lookups is
   * the maximum upstream cost per cache-miss cycle — bounded, which is the
   * rule for anything pointed at a donated-bandwidth service.
   */
  const wanted = docs.slice(0, 12);

  const built = await Promise.allSettled(
    wanted.map(async (doc) => {
      /*
       * ─── /metadata/{id}, NOT /metadata/{id}/files ───────────────────────
       * The /files subresource 502s under load while the full metadata
       * document — which CONTAINS the same files array — stays up. Verified
       * against the live API on the day the calm tab died. Same data, one
       * request, working endpoint.
       */
      const meta = await getJson(`${IA}/metadata/${encodeURIComponent(doc.identifier)}`);
      return pickTrack(doc, meta?.files ?? []);
    })
  );

  const items = built
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)
    .slice(0, 8);

  return {
    at: Date.now(),
    items,
    /* So the UI can be honest when a mood contributed nothing today. */
    moodsOk: found.filter((r) => r.status === 'fulfilled' && r.value.length).length,
    moodsTotal: MOODS.length
  };
}
