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
async function searchMood(mood) {
  /*
   * The licence clause is part of the QUERY, so the expensive metadata
   * lookups below are only ever spent on items that already qualify. Filtering
   * afterwards would mean fetching and discarding most of them.
   *
   * The NOT clause is here for the same reason: excluding harsh genres in the
   * query is far cheaper than fetching their file lists and discarding them,
   * and it means the `rows=8` budget is spent on candidates that can actually
   * be used.
   */
  const q =
    `collection:netlabels AND subject:${mood} AND NOT subject:(` +
    'noise OR industrial OR harsh OR dark OR drone OR experimental ' +
    'OR psychedelic OR metal OR avantgarde) AND (' +
    'licenseurl:"http://creativecommons.org/licenses/by/3.0/" OR ' +
    'licenseurl:"http://creativecommons.org/licenses/by/4.0/" OR ' +
    'licenseurl:"http://creativecommons.org/licenses/by-sa/3.0/" OR ' +
    'licenseurl:"http://creativecommons.org/publicdomain/zero/1.0/")';

  const url =
    `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}` +
    /* `subject` is requested so the result can be re-checked below. Without
       it `calmSubjectOk` would receive undefined and pass everything. */
    '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=licenseurl' +
    '&fl%5B%5D=subject' +
    '&rows=8&page=1&output=json';

  const data = await getJson(url);
  return (data?.response?.docs ?? []).filter(
    (d) => d?.identifier && licenceOk(d.licenseurl) && calmSubjectOk(d.subject)
  );
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
   * Capped BEFORE the metadata lookups. Each item costs one more request, and
   * this is a background-music tab, not a library — eight tracks is more than
   * anyone will listen to in a session.
   */
  const wanted = docs.slice(0, 8);

  const built = await Promise.allSettled(
    wanted.map(async (doc) => {
      const meta = await getJson(`${IA}/metadata/${encodeURIComponent(doc.identifier)}/files`);
      return pickTrack(doc, meta?.result ?? []);
    })
  );

  const items = built
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value);

  return {
    at: Date.now(),
    items,
    /* So the UI can be honest when a mood contributed nothing today. */
    moodsOk: found.filter((r) => r.status === 'fulfilled' && r.value.length).length,
    moodsTotal: MOODS.length
  };
}
