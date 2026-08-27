/**
 * PHASE 83 — APPROVAL HYGIENE
 * An allowance is not forever. Every permission is visible with the exposure
 * it represents, a swap asks for the minimum it needs and never MaxUint256,
 * and every entry has a revoke path that still goes through confirmation.
 */
import { readFileSync } from 'node:fs';
import {
  classifyAllowance, approvalInventory, minimalApproval, revokePlan,
  assertNoUnlimitedApproval, MAX_UINT256, EFFECTIVELY_UNLIMITED,
  STALE_APPROVAL_MS, APPROVAL_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const SPENDER = '0x1111111254eeb25477b68fb85ed929f73a960582';
const ONE = 10n ** 6n;
const row = (over = {}) => ({
  token: TOKEN, spender: SPENDER, symbol: 'usdc', decimals: 6,
  allowance: (1000n * ONE).toString(), balance: (500n * ONE).toString(),
  priceUsd: 1, approvedAt: NOW - 1000, spenderKnown: true, ...over
});

try {
  /* ---------- classification ---------- */
  const bounded = classifyAllowance(row(), { now: NOW });
  check('a bounded allowance is classified bounded', bounded.kind === 'bounded' && bounded.unlimited === false);
  check('exposure is capped by the balance actually held', bounded.exposureUsd === 500);
  check('a known spender with a bounded allowance is low risk', bounded.risk === 'low');
  const unlimited = classifyAllowance(row({ allowance: MAX_UINT256.toString() }), { now: NOW });
  check('MaxUint256 is classified unlimited', unlimited.unlimited === true && unlimited.kind === 'unlimited');
  check('an unlimited allowance to a known spender is at least medium risk', unlimited.risk === 'medium');
  check('an unlimited allowance to an unknown spender is high risk',
    classifyAllowance(row({ allowance: MAX_UINT256.toString(), spenderKnown: false }), { now: NOW }).risk === 'high');
  check('an unlimited allowance exposes the whole balance', unlimited.exposureUsd === 500);
  check('a huge but not maximum allowance still counts as unlimited in practice',
    classifyAllowance(row({ allowance: EFFECTIVELY_UNLIMITED.toString() }), { now: NOW }).unlimited === true);
  check('a zero allowance is no permission', classifyAllowance(row({ allowance: '0' }), { now: NOW }).kind === 'none');
  check('a zero allowance is nothing to revoke', classifyAllowance(row({ allowance: '0' }), { now: NOW }).revocable === false);
  const stale = classifyAllowance(row({ approvedAt: NOW - STALE_APPROVAL_MS - 1 }), { now: NOW });
  check('an untouched old permission is flagged stale', stale.stale === true);
  check('a stale permission is raised to high risk', stale.risk === 'high');
  const unreadable = classifyAllowance(row({ allowance: 'unknown' }), { now: NOW });
  check('an unreadable allowance is NOT reported as zero', unreadable.kind === 'unknown');
  check('an unreadable allowance is treated as risky', unreadable.risk === 'high');
  check('an unreadable allowance has no invented exposure', unreadable.exposureUsd === null);
  check('a row with no spender is refused', classifyAllowance({ token: TOKEN }).ok === false);
  check('every classification carries a translatable reason', bounded.reasonKey.startsWith('intentAI.approvals.reason.'));

  /* ---------- the inventory ---------- */
  const inv = approvalInventory([
    row(),
    row({ spender: '0x2222222222222222222222222222222222222222', allowance: MAX_UINT256.toString(), spenderKnown: false }),
    row({ spender: '0x3333333333333333333333333333333333333333', allowance: '0' }),
    row({ spender: '0x4444444444444444444444444444444444444444', approvedAt: NOW - STALE_APPROVAL_MS - 1 })
  ], { now: NOW });
  check('the inventory lists every readable row', inv.entries.length === 4);
  check('the inventory counts only active permissions as active', inv.activeCount === 3);
  check('the inventory counts the unlimited ones', inv.unlimitedCount === 1);
  check('the inventory counts the stale ones', inv.staleCount === 1);
  check('the worst rows come first', inv.entries[0].risk === 'high');
  check('the rows needing attention are called out', inv.needsAttention.length >= 2);
  check('the total exposure is real money', inv.totalExposureUsd === 1500);
  check('the inventory declares its schema', inv.schema === APPROVAL_SCHEMA);
  const partial = approvalInventory([row(), row({ spender: '0x5555555555555555555555555555555555555555', priceUsd: null })], { now: NOW });
  check('a total that would be partial is not shown at all', partial.totalExposureUsd === null);
  check('the incompleteness is stated', partial.exposureComplete === false);
  check('an empty inventory is empty, not an error', approvalInventory([], { now: NOW }).activeCount === 0);

  /* ---------- minimal approval: never MaxUint256 ---------- */
  const minimal = minimalApproval({ amountWei: (100n * ONE).toString() });
  check('a swap approval is sized to the swap', minimal.ok === true);
  check('a swap approval is never unlimited', minimal.unlimited === false && minimal.isMaxUint === false);
  check('the required amount is far below MaxUint256', BigInt(minimal.required) < EFFECTIVELY_UNLIMITED);
  check('the required amount covers the swap', BigInt(minimal.required) >= 100n * ONE);
  check('the headroom is small and disclosed', BigInt(minimal.required) <= 102n * ONE && minimal.headroomPct === 2);
  check('an existing sufficient allowance needs no new approval',
    minimalApproval({ amountWei: (100n * ONE).toString(), currentAllowance: (500n * ONE).toString() }).approvalNeeded === false);
  check('an existing small allowance still needs a new approval',
    minimalApproval({ amountWei: (100n * ONE).toString(), currentAllowance: (10n * ONE).toString() }).approvalNeeded === true);
  const replacing = minimalApproval({ amountWei: (100n * ONE).toString(), currentAllowance: MAX_UINT256.toString() });
  check('an existing UNLIMITED allowance is not treated as "already fine"', replacing.replaceUnlimited === true);
  check('a swap with no amount cannot size an approval', minimalApproval({}).ok === false);

  /* ---------- revoking ---------- */
  const plan = revokePlan(row(), { now: NOW });
  check('a revoke plan targets zero', plan.ok === true && plan.targetAllowance === '0');
  check('a revoke plan names the spender', plan.spender === SPENDER);
  check('a revoke is still a transaction that needs confirmation', plan.requiresConfirmation === true);
  check('a revoke plan authorizes nothing by itself', plan.executionAuthorized === false);
  check('the revoke prompt is a translatable key', plan.i18nKey === 'intentAI.approvals.revokePrompt');
  check('the revoke prompt states the exposure removed', plan.i18nParams.exposure === 500);
  check('there is nothing to revoke on a zero allowance', revokePlan(row({ allowance: '0' }), { now: NOW }).ok === false);

  /* ---------- the fail-closed guard ---------- */
  check('the guard accepts a minimal approval', assertNoUnlimitedApproval(minimal).ok === true);
  check('the guard rejects an explicit unlimited request', assertNoUnlimitedApproval({ unlimited: true, required: '1' }).ok === false);
  check('the guard rejects a MaxUint256 amount', assertNoUnlimitedApproval({ required: MAX_UINT256.toString() }).ok === false);
  check('the guard rejects an amount that is unlimited in practice',
    assertNoUnlimitedApproval({ required: EFFECTIVELY_UNLIMITED.toString() }).ok === false);
  check('the guard rejects an unreadable amount', assertNoUnlimitedApproval({ required: 'lots' }).ok === false);
  check('the guard rejects an empty request', assertNoUnlimitedApproval({}).ok === false);

  /* ---------- the UI ---------- */
  const ui = readFileSync('src/components/TokenApprovals.jsx', 'utf8');
  check('the approvals UI exists and renders the inventory', /approvalInventory\(/.test(ui));
  check('the UI marks unlimited permissions visibly', /data-testid="approval-unlimited"/.test(ui));
  check('the UI offers a revoke path', /data-testid="approval-revoke"/.test(ui));
  check('revoking from the UI only raises a plan', /revokePlan\(/.test(ui) && !/sendTransaction|signer|eth_sendTransaction/.test(ui));
  check('the UI shows unreadable exposure honestly', /exposureUnknown/.test(ui));
  check('an unreadable inventory is not rendered as an empty list', /approvals-unavailable/.test(ui));
  check('the UI holds no hardcoded Persian or Arabic string', !/[\u0600-\u06FF]/.test(ui));
  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  check('the panel can render the approvals section', /TokenApprovals/.test(panel));
  check('the panel only renders it when an inventory was supplied', /Array\.isArray\(tokenApprovals\)/.test(panel));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every approval reason is translated in en, fa and ar',
    locales.every((loc) => ['unlimited', 'bounded', 'none', 'stale', 'unreadable', 'sufficient', 'needed']
      .every((k) => typeof loc?.intentAI?.approvals?.reason?.[k] === 'string')));
  check('the approvals UI strings are translated in en, fa and ar',
    locales.every((loc) => ['title', 'subtitle', 'empty', 'unavailable', 'revoke', 'revokePrompt', 'unlimitedBadge', 'exposureUnknown']
      .every((k) => typeof loc?.intentAI?.approvals?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase83-approval-hygiene', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
