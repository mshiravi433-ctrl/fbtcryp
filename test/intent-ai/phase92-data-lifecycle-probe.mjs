/**
 * PHASE 92 — DATA LIFECYCLE
 * A deletion request is not a deletion. Erasure is confirmed, executed across
 * every store, verified by reading back, and anything left over is named.
 */
import { readFileSync } from 'node:fs';
import {
  exportUserData, deleteUserData, verifyDeletion, assertErasureProven,
  DATA_STORES, LIFECYCLE_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const USER = 'tg:987654';

const makeState = () => {
  const state = {};
  for (const s of DATA_STORES) state[s] = { rows: [{ id: 1 }] };
  return state;
};
const readersFor = (state) => Object.fromEntries(DATA_STORES.map((s) => [s, async () => state[s]]));
const erasersFor = (state) => Object.fromEntries(DATA_STORES.map((s) => [s, async () => { state[s] = {}; return { ok: true, removed: 1 }; }]));

try {
  /* ---------- export ---------- */
  const state = makeState();
  state.memory = { rows: [{ id: 1, note: 'likes eth', privateKey: '0xdead' }] };
  const exported = await exportUserData({ userId: USER, readers: readersFor(state), now: NOW });
  check('an export is produced', exported.ok === true && exported.schema === LIFECYCLE_SCHEMA);
  check('every store is included', Object.keys(exported.data).length === DATA_STORES.length);
  check('the export is complete', exported.complete === true);
  check('the export is checksummed', typeof exported.checksum === 'string');
  check('the export never contains a key', JSON.stringify(exported.data).includes('privateKey') === false);
  check('the export says it holds no secret', exported.containsSecrets === false);
  check('the export is a translatable notice', exported.i18nKey === 'intentAI.lifecycle.exportReady');
  const partialExport = await exportUserData({
    userId: USER, readers: { ...readersFor(state), audit: async () => { throw new Error('io'); } }, now: NOW
  });
  check('an unreadable store makes the export incomplete', partialExport.complete === false);
  check('NO partial file is offered', partialExport.data === null);
  check('the failing store is named', partialExport.failedStores.some((f) => f.store === 'audit'));
  check('the partial export is a distinct notice', partialExport.i18nKey === 'intentAI.lifecycle.exportPartial');
  check('a missing reader also makes it incomplete',
    (await exportUserData({ userId: USER, readers: {}, now: NOW })).complete === false);
  check('an export without a user is refused', (await exportUserData({ readers: readersFor(state), now: NOW })).ok === false);

  /* ---------- deletion needs a confirmation ---------- */
  const s2 = makeState();
  const unconfirmed = await deleteUserData({ userId: USER, erasers: erasersFor(s2), now: NOW });
  check('deleting without confirmation does nothing', unconfirmed.deleted === false);
  check('the missing confirmation is an authorization failure', unconfirmed.error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('the confirmation prompt is translatable', unconfirmed.i18nKey === 'intentAI.lifecycle.deleteNeedsConfirmation');
  check('nothing was actually touched', Object.keys(s2.memory).length > 0);
  check('deleting without a user is refused', (await deleteUserData({ erasers: erasersFor(s2), confirmed: true, now: NOW })).ok === false);

  /* ---------- a real deletion ---------- */
  const s3 = makeState();
  const deleted = await deleteUserData({ userId: USER, erasers: erasersFor(s3), confirmed: true, now: NOW });
  check('a confirmed deletion runs', deleted.deleted === true && deleted.complete === true);
  check('every store was cleared', deleted.clearedStores.length === DATA_STORES.length);
  check('nothing failed', deleted.failedStores.length === 0);
  check('the deletion is a translatable notice', deleted.i18nKey === 'intentAI.lifecycle.deleted');
  const verified = await verifyDeletion({ userId: USER, readers: readersFor(s3), deletion: deleted, now: NOW });
  check('the deletion is verified by reading back', verified.proven === true);
  check('a proof receipt is issued', typeof verified.receipt.proof === 'string' && Object.isFrozen(verified.receipt));
  check('the proof is a translatable notice', verified.i18nKey === 'intentAI.lifecycle.deletionProven');
  check('the honest run passes the guard', assertErasureProven({ deletion: deleted, verification: verified, exportResult: exported }).ok === true);

  /* ---------- a deletion that did not fully work ---------- */
  const s4 = makeState();
  const stubborn = { ...erasersFor(s4), audit: async () => { throw new Error('locked'); }, cache: async () => false };
  const partial = await deleteUserData({ userId: USER, erasers: stubborn, confirmed: true, now: NOW });
  check('a partly failed deletion is NOT reported as done', partial.deleted === false && partial.complete === false);
  check('the stores that resisted are named', partial.failedStores.map((f) => f.store).includes('audit'));
  check('a store that refused is named too', partial.failedStores.map((f) => f.store).includes('cache'));
  check('the partial deletion is a distinct notice', partial.i18nKey === 'intentAI.lifecycle.deletePartial');
  check('the counts are honest', partial.i18nParams.remaining === 2);
  const leftover = await verifyDeletion({ userId: USER, readers: readersFor(s4), deletion: partial, now: NOW });
  check('verification finds the leftovers', leftover.proven === false && leftover.leftovers.length > 0);
  check('the leftover store is named', leftover.leftovers.some((l) => l.store === 'audit'));
  check('no proof receipt is issued for a partial deletion', leftover.receipt === null);
  check('an unverifiable store also blocks the proof',
    (await verifyDeletion({ userId: USER, readers: {}, deletion: deleted, now: NOW })).proven === false);

  /* ---------- the guard ---------- */
  check('claiming deletion without proof is caught',
    assertErasureProven({ deletion: { deleted: true }, verification: { proven: false } }).reasons.includes('DELETION_CLAIMED_WITHOUT_PROOF'));
  check('complete-with-failures is caught',
    assertErasureProven({ deletion: { complete: true, failedStores: [{ store: 'audit' }] } }).reasons.includes('COMPLETE_WITH_FAILED_STORES'));
  check('proven-with-leftovers is caught',
    assertErasureProven({ verification: { proven: true, leftovers: [{ store: 'cache' }] } }).reasons.includes('PROVEN_WITH_LEFTOVERS'));
  check('proven without reading everything is caught',
    assertErasureProven({ verification: { proven: true, leftovers: [], unverifiable: [{ store: 'cache' }] } }).reasons.includes('PROVEN_WITHOUT_READING_EVERYTHING'));
  check('an export claiming completeness with failures is caught',
    assertErasureProven({ exportResult: { complete: true, failedStores: [{ store: 'x' }] } }).reasons.includes('EXPORT_CLAIMS_COMPLETE'));
  check('an export carrying secrets is caught',
    assertErasureProven({ exportResult: { containsSecrets: true } }).reasons.includes('EXPORT_CONTAINS_SECRETS'));
  check('the store list covers memory, sessions and personal audit',
    ['memory', 'sessions', 'audit'].every((s) => DATA_STORES.includes(s)));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the lifecycle copy is translated in en, fa and ar',
    locales.every((loc) => ['exportReady', 'exportPartial', 'deleted', 'deletePartial', 'deleteNeedsConfirmation', 'deletionProven', 'deletionUnproven']
      .every((k) => typeof loc?.intentAI?.lifecycle?.[k] === 'string')));
  check('the english deletion copy claims verification, not just deletion',
    /verified/i.test(locales[0].intentAI.lifecycle.deleted));

  console.log(JSON.stringify({ probe: 'phase92-data-lifecycle', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
