/**
 * PHASE 100 — USER SOVEREIGNTY AND CLOSING
 * The last phase, and the one that makes the earlier ninety-nine honest: the
 * user can take everything and leave in an open format, in two steps, with no
 * fee and no waiting period — and the exit is PROVEN to leave nothing behind.
 */
import { readFileSync } from 'node:fs';
import {
  describeExitPath, buildExitPackage, performExit, verifyNoResidue, assertNoLockIn,
  EXIT_SURFACES, PORTABLE_FORMATS, LOCK_IN_PATTERNS, DATA_STORES, SOVEREIGNTY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const USER = 'user-42';

/** A store set that starts full and is genuinely emptied by the erasers. */
function makeStores({ refuse = [], unreadable = [], sticky = [] } = {}) {
  const state = {};
  for (const s of DATA_STORES) state[s] = { [`${s}-row`]: 1 };
  const readers = {};
  const erasers = {};
  for (const store of DATA_STORES) {
    if (unreadable.includes(store)) continue;
    readers[store] = async () => state[store];
    if (refuse.includes(store)) continue;
    erasers[store] = async () => {
      if (!sticky.includes(store)) state[store] = {};
      return { ok: true, removed: 1 };
    };
  }
  return { state, readers, erasers };
}

try {
  /* ---------- the exit path, explained before it is taken ---------- */
  const path = describeExitPath({ now: NOW });
  check('the exit path is described', path.ok === true && path.schema === SOVEREIGNTY_SCHEMA);
  check('the export format is open JSON', path.format === 'application/json' && PORTABLE_FORMATS.includes(path.format));
  check('leaving needs no support ticket', path.requiresSupportTicket === false);
  check('leaving costs nothing', path.requiresFee === false);
  check('there is no cooling-off period', path.coolingOffPeriodMs === 0);
  check('there is no retention offer to sit through', path.retentionOfferShown === false);
  check('leaving is two steps', path.stepsRequired === 2);
  check('every exit surface is covered', EXIT_SURFACES.every((s) => path.surfaces.includes(s)));
  check('every data store is named in the path', DATA_STORES.every((s) => path.stores.includes(s)));
  check('the lock-in patterns are named so they can be tested for', LOCK_IN_PATTERNS.length >= 5);

  /* ---------- the take-everything package ---------- */
  const full = makeStores();
  const pkg = await buildExitPackage({ userId: USER, readers: full.readers, now: NOW });
  check('a complete export is built', pkg.ok === true && pkg.complete === true);
  check('the package covers every store', pkg.payload.stores.length === DATA_STORES.length);
  check('the package is in an open format', pkg.openFormat === true && pkg.proprietaryFormat === false);
  check('the package can be re-read as plain JSON', JSON.parse(JSON.stringify(pkg.payload)).userId === USER);
  check('the package has a checksum', typeof pkg.checksum === 'string' && pkg.checksum.startsWith('0x'));
  check('the package holds no secrets', pkg.containsSecrets === false);
  check('the package is a translatable notice', pkg.i18nKey === 'intentAI.sovereignty.packageReady');
  const holed = makeStores({ unreadable: ['audit'] });
  const partial = await buildExitPackage({ userId: USER, readers: holed.readers, now: NOW });
  check('an incomplete export is refused, not offered as everything', partial.ok === false && partial.complete === false);
  check('the missing store is named', (partial.failedStores || []).some((f) => f.store === 'audit'));
  check('the incomplete export is a translatable notice', partial.i18nKey === 'intentAI.sovereignty.exportIncomplete');
  check('an export with no user is refused', (await buildExitPackage({ readers: full.readers, now: NOW })).ok === false);

  /* ---------- leaving ---------- */
  const clean = makeStores();
  const exited = await performExit({ userId: USER, readers: clean.readers, erasers: clean.erasers, confirmed: true, now: NOW });
  check('a confirmed exit completes', exited.ok === true && exited.exited === true);
  check('the exit hands the data over first', exited.package !== null && exited.package.userId === USER);
  check('the exit state is complete', exited.state === 'complete');
  check('the deletion ran across every store', exited.deletion.clearedStores.length === DATA_STORES.length);
  check('the deletion was verified by reading back', exited.verification.proven === true);
  check('nothing was left behind', exited.leftovers.length === 0 && exited.unverifiable.length === 0);
  check('a proof receipt is issued only for a clean exit', exited.receipt !== null && typeof exited.receipt.proof === 'string');
  check('the exit receipt is frozen', Object.isFrozen(exited.receipt));
  check('the exit is a translatable notice', exited.i18nKey === 'intentAI.sovereignty.exitComplete');

  /* THE PROBE THIS PHASE CLOSES ON: the stores really are empty afterwards. */
  const residueAfter = await verifyNoResidue({ userId: USER, readers: clean.readers, now: NOW });
  check('after the exit every store reads back empty', residueAfter.clean === true);
  check('the residue check read every store', residueAfter.storesChecked === DATA_STORES.length);
  check('the residue check found nothing', residueAfter.residue.length === 0);
  check('no store was left unread', residueAfter.unreadable.length === 0);
  check('the clean result is a translatable notice', residueAfter.i18nKey === 'intentAI.sovereignty.noResidue');
  for (const store of DATA_STORES) {
    check(`the ${store} store is genuinely empty after the exit`, Object.keys(clean.state[store]).length === 0);
  }

  /* ---------- the ways it can go wrong, told honestly ---------- */
  const unconfirmed = await performExit({ userId: USER, readers: clean.readers, erasers: clean.erasers, now: NOW });
  check('an unconfirmed exit deletes nothing', unconfirmed.exited === false);
  check('the unconfirmed exit is an authorization failure', unconfirmed.error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('the unconfirmed exit asks for a confirmation', unconfirmed.i18nKey === 'intentAI.sovereignty.needsConfirmation');
  const cannotExport = makeStores({ unreadable: ['memory'] });
  const abortedExit = await performExit({ userId: USER, readers: cannotExport.readers, erasers: cannotExport.erasers, confirmed: true, now: NOW });
  check('if the export fails nothing is deleted', abortedExit.deletionStarted === false && abortedExit.exited === false);
  check('the data survives a failed export', Object.keys(cannotExport.state.preferences).length === 1);
  const stubborn = makeStores({ sticky: ['receipts'] });
  const messy = await performExit({ userId: USER, readers: stubborn.readers, erasers: stubborn.erasers, confirmed: true, now: NOW });
  check('a store that would not clear makes the exit incomplete', messy.exited === false && messy.state === 'incomplete');
  check('the surviving store is named', messy.leftovers.some((l) => l.store === 'receipts'));
  check('no proof receipt is issued for an incomplete exit', messy.receipt === null);
  check('the incomplete exit is a translatable notice', messy.i18nKey === 'intentAI.sovereignty.exitIncomplete');
  check('the residue is found by a fresh check',
    (await verifyNoResidue({ userId: USER, readers: stubborn.readers, now: NOW })).clean === false);
  const refusing = makeStores({ refuse: ['alerts'] });
  const refused = await performExit({ userId: USER, readers: refusing.readers, erasers: refusing.erasers, confirmed: true, now: NOW });
  check('a store with no eraser makes the exit incomplete', refused.exited === false);
  check('the un-erasable store is named', (refused.deletion.failedStores || []).some((f) => f.store === 'alerts'));
  check('an exit with no user is refused', (await performExit({ readers: clean.readers, erasers: clean.erasers, confirmed: true, now: NOW })).exited === false);
  check('a residue check with no user is honest', (await verifyNoResidue({ readers: clean.readers, now: NOW })).ok === false);
  check('an unreadable store is not counted as empty',
    (await verifyNoResidue({ userId: USER, readers: {}, now: NOW })).clean === false);

  /* ---------- the guard ---------- */
  check('an honest exit passes the guard',
    assertNoLockIn({ exitPath: path, exitPackage: pkg, exit: exited, residue: residueAfter }).ok === true);
  check('an exit fee is caught', assertNoLockIn({ exitPath: { ...path, requiresFee: true } }).reasons.includes('EXIT_FEE'));
  check('a support ticket requirement is caught',
    assertNoLockIn({ exitPath: { ...path, requiresSupportTicket: true } }).reasons.includes('SUPPORT_TICKET_REQUIRED'));
  check('a cooling-off period is caught',
    assertNoLockIn({ exitPath: { ...path, coolingOffPeriodMs: 1 } }).reasons.includes('COOLING_OFF_PERIOD'));
  check('a mandatory retention offer is caught',
    assertNoLockIn({ exitPath: { ...path, retentionOfferShown: true } }).reasons.includes('RETENTION_OFFER_REQUIRED'));
  check('a proprietary export format is caught',
    assertNoLockIn({ exitPath: { ...path, format: 'application/x-fbt-blob' } }).reasons.includes('PROPRIETARY_FORMAT'));
  check('a missing exit surface is caught',
    assertNoLockIn({ exitPath: { ...path, surfaces: ['data'] } }).reasons.includes('EXIT_SURFACE_MISSING'));
  check('a package claiming complete with failures is caught',
    assertNoLockIn({ exitPackage: { complete: true, failedStores: [{ store: 'audit' }] } }).reasons.includes('PACKAGE_CLAIMS_COMPLETE'));
  check('a package containing secrets is caught',
    assertNoLockIn({ exitPackage: { ok: true, openFormat: true, containsSecrets: true } }).reasons.includes('PACKAGE_CONTAINS_SECRETS'));
  check('an exit claimed without proof is caught',
    assertNoLockIn({ exit: { exited: true, verification: { proven: false }, package: {} } }).reasons.includes('EXIT_CLAIMED_WITHOUT_PROOF'));
  check('an exit with leftovers is caught',
    assertNoLockIn({ exit: { exited: true, verification: { proven: true }, leftovers: [{ store: 'cache' }], package: {} } }).reasons.includes('EXIT_WITH_LEFTOVERS'));
  check('deleting without exporting first is caught',
    assertNoLockIn({ exit: { exited: true, verification: { proven: true }, package: null } }).reasons.includes('DELETED_WITHOUT_EXPORT'));
  check('a receipt without an exit is caught',
    assertNoLockIn({ exit: { exited: false, receipt: { proof: '0x1' } } }).reasons.includes('RECEIPT_WITHOUT_EXIT'));
  check('claiming clean with residue is caught',
    assertNoLockIn({ residue: { clean: true, residue: [{ store: 'memory' }] } }).reasons.includes('CLEAN_WITH_RESIDUE'));
  check('claiming clean without reading everything is caught',
    assertNoLockIn({ residue: { clean: true, residue: [], unreadable: [{ store: 'audit' }] } }).reasons.includes('CLEAN_WITHOUT_READING_EVERYTHING'));
  check('the guard rejection is a guardian rejection',
    assertNoLockIn({ exitPath: { ...path, requiresFee: true } }).error.code === 'GUARDIAN_REJECTED');

  /* ---------- copy ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the sovereignty copy is translated in en, fa and ar',
    locales.every((loc) => ['exitExplained', 'packageReady', 'exportIncomplete', 'needsConfirmation', 'exitComplete', 'noResidue', 'residueFound']
      .every((k) => typeof loc?.intentAI?.sovereignty?.[k] === 'string')));
  check('the english copy promises no fee and no waiting',
    /no fee, no waiting period/i.test(locales[0].intentAI.sovereignty.exitExplained));
  check('the english copy states nothing remains',
    /nothing of yours remains/i.test(locales[0].intentAI.sovereignty.exitComplete));

  console.log(JSON.stringify({ probe: 'phase100-user-sovereignty', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
