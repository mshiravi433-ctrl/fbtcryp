/**
 * PHASE 77 — HUMAN-READABLE TERMS DIFF
 * "termsHash changed" tells a user nothing. "amount changed from 100 to 500"
 * tells them everything. Material changes always force re-confirmation.
 */
import { readFileSync } from 'node:fs';
import {
  diffTerms, summarizeDiff, assertTermsUnchanged,
  MATERIAL_FIELDS, COSMETIC_FIELDS, TERMS_DIFF_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const APPROVED = {
  amount: 100, tokenIn: 'USDC', tokenOut: 'ETH', recipient: '0xabc',
  slippageBps: 50, chainId: 1, label: 'My swap', route: { venue: 'uniswap' }
};

try {
  /* ---------- the sentence the user needs ---------- */
  const d = diffTerms({ approved: APPROVED, current: { ...APPROVED, amount: 500 } });
  check('a diff is produced', d.ok === true && d.schema === TERMS_DIFF_SCHEMA);
  check('exactly one change is found', d.changes.length === 1);
  check('the changed field is named', d.changes[0].field === 'amount');
  check('the before value is kept', d.changes[0].before === 100);
  check('the after value is kept', d.changes[0].after === 500);
  check('the row is a translatable sentence, not a hash', d.changes[0].i18nKey === 'intentAI.termsDiff.row.changed');
  check('the params carry both values as text', d.changes[0].i18nParams.before === '100' && d.changes[0].i18nParams.after === '500');
  check('the field gets its own label key', d.changes[0].i18nParams.fieldLabelKey === 'intentAI.termsDiff.field.amount');
  check('the direction is stated', d.changes[0].direction === 'increased');
  check('the size of the move is computed', d.changes[0].percentChange === 400);
  check('a decrease is called a decrease', diffTerms({ approved: APPROVED, current: { ...APPROVED, amount: 25 } }).changes[0].direction === 'decreased');
  const summary = summarizeDiff(d);
  check('the one-line summary names the field and both values',
    summary.i18nKey === 'intentAI.termsDiff.summary' && summary.i18nParams.before === '100' && summary.i18nParams.after === '500');
  check('the summary counts the rest', summary.i18nParams.more === 0);

  /* ---------- material vs cosmetic ---------- */
  check('a money change is material', d.hasMaterialChange === true);
  check('a label change is not material',
    diffTerms({ approved: APPROVED, current: { ...APPROVED, label: 'Other' } }).hasMaterialChange === false);
  check('a cosmetic diff says so', diffTerms({ approved: APPROVED, current: { ...APPROVED, label: 'Other' } }).i18nKey === 'intentAI.termsDiff.cosmetic');
  check('a recipient change is material', diffTerms({ approved: APPROVED, current: { ...APPROVED, recipient: '0xdef' } }).hasMaterialChange === true);
  check('a network change is material', diffTerms({ approved: APPROVED, current: { ...APPROVED, chainId: 137 } }).hasMaterialChange === true);
  check('a slippage change is material', diffTerms({ approved: APPROVED, current: { ...APPROVED, slippageBps: 900 } }).hasMaterialChange === true);
  check('a nested venue change is material',
    diffTerms({ approved: APPROVED, current: { ...APPROVED, route: { venue: 'sushi' } } }).hasMaterialChange === true);
  check('the nested path is preserved',
    diffTerms({ approved: APPROVED, current: { ...APPROVED, route: { venue: 'sushi' } } }).changes[0].path === 'route.venue');
  check('an UNKNOWN field is treated as material, not ignored',
    diffTerms({ approved: APPROVED, current: { ...APPROVED, someNewKnob: 7 } }).hasMaterialChange === true);
  check('an added field is called added',
    diffTerms({ approved: APPROVED, current: { ...APPROVED, deadline: 999 } }).changes[0].kind === 'added');
  const removed = { ...APPROVED }; delete removed.recipient;
  check('a removed field is called removed', diffTerms({ approved: APPROVED, current: removed }).changes[0].kind === 'removed');
  check('the material fields cover the money-moving ones',
    ['amount', 'recipient', 'chainId', 'slippageBps', 'allowance'].every((f) => MATERIAL_FIELDS.includes(f)));
  check('cosmetic fields are genuinely cosmetic', COSMETIC_FIELDS.includes('label') && !COSMETIC_FIELDS.includes('amount'));

  /* ---------- identical and unreadable ---------- */
  const same = diffTerms({ approved: APPROVED, current: { ...APPROVED } });
  check('identical terms produce no rows', same.changes.length === 0 && same.unchanged === true);
  check('identical terms need no re-confirmation', same.requiresReconfirmation === false);
  check('identical terms say so', same.i18nKey === 'intentAI.termsDiff.identical');
  const unreadable = diffTerms({ approved: null, current: APPROVED });
  check('unreadable terms are NOT reported as unchanged', unreadable.ok === false && unreadable.hasMaterialChange === true);
  check('unreadable terms force re-confirmation', unreadable.requiresReconfirmation === true);
  check('unreadable terms carry a classified error', typeof unreadable.error?.code === 'string');

  /* ---------- the gate ---------- */
  const blocked = assertTermsUnchanged({ approved: APPROVED, current: { ...APPROVED, amount: 500 } });
  check('a material change blocks execution', blocked.mayProceed === false);
  check('a blocked gate never authorizes', blocked.executionAuthorized === false);
  check('the block demands a fresh confirmation', blocked.requiresReconfirmation === true);
  check('the block carries the readable summary', blocked.summary.i18nParams.after === '500');
  check('the block is a TERMS_CHANGED failure', blocked.error.code === 'TERMS_CHANGED');
  check('the block names the offending field', blocked.error.detail === 'amount');
  const passed = assertTermsUnchanged({ approved: APPROVED, current: { ...APPROVED } });
  check('unchanged terms may proceed', passed.mayProceed === true);
  check('proceeding is still NOT authorization', passed.executionAuthorized === false);
  const cosmetic = assertTermsUnchanged({ approved: APPROVED, current: { ...APPROVED, label: 'x' } });
  check('a cosmetic change may proceed', cosmetic.mayProceed === true && cosmetic.requiresReconfirmation === false);
  const unexplained = assertTermsUnchanged({ approved: APPROVED, current: { ...APPROVED }, approvedHash: '0xaaa', currentHash: '0xbbb' });
  check('a hash change with no visible diff STOPS', unexplained.mayProceed === false);
  check('the unexplained change is named', unexplained.i18nKey === 'intentAI.termsDiff.unexplained');
  check('a matching hash with no diff passes',
    assertTermsUnchanged({ approved: APPROVED, current: { ...APPROVED }, approvedHash: '0xaaa', currentHash: '0xaaa' }).mayProceed === true);
  check('a null comparison fails closed', assertTermsUnchanged({ approved: null, current: null }).mayProceed === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the diff copy is translated in en, fa and ar',
    locales.every((loc) => ['identical', 'cosmetic', 'material', 'unexplained', 'unreadable', 'summary']
      .every((k) => typeof loc?.intentAI?.termsDiff?.[k] === 'string')));
  check('every row kind is translated everywhere',
    locales.every((loc) => ['changed', 'added', 'removed'].every((k) => typeof loc?.intentAI?.termsDiff?.row?.[k] === 'string')));
  check('every material field has a label in all three languages',
    locales.every((loc) => MATERIAL_FIELDS.every((f) => typeof loc?.intentAI?.termsDiff?.field?.[f] === 'string')));
  check('the english summary interpolates before and after',
    /\{\{before\}\}/.test(locales[0].intentAI.termsDiff.summary) && /\{\{after\}\}/.test(locales[0].intentAI.termsDiff.summary));

  console.log(JSON.stringify({ probe: 'phase77-terms-diff', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
