/**
 * Loan page copy + layout pins (2026-11-26).
 *
 *   • the two sentences the user asked to DELETE must not be rendered again
 *   • liquidation / smart-contract / architecture / general risk must be ONE
 *     warning box below «چطور کار میکند», never three folded boxes per tab
 *   • «پوزیشن من» has neither the how-it-works section nor any info box
 *   • the collateral-loop panel expands to a real full-screen popup
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const loan = read('src/pages/Loan.jsx');
const loop = read('src/components/CollateralLoopPanel.jsx');
const loopCss = read('src/styles/loan-loop.css');
const riskCss = read('src/styles/loan-risk.css');
const fa = JSON.parse(read('src/i18n/locales/fa.json'));

/* 1 · exact sentences removed from the rendered page */
assert.ok(!loan.includes("t('loan.supplyDesc')"), 'loan.supplyDesc must not be rendered');
assert.ok(!loan.includes("t('loan.rateSource'"), 'loan.rateSource must not be rendered');
assert.ok(fa.loan.supplyDesc && fa.loan.rateSource, 'the translation keys may stay for other locales');

/* 2 · four folded boxes collapsed into one warning card */
for (const id of ['supply-liq-warn', 'supply-sc-warn', 'supply-arch', 'borrow-liq-warn', 'borrow-sc-warn', 'borrow-arch', 'pos-arch']) {
  assert.ok(!loan.includes(id), `the ${id} box must be gone`);
}
assert.ok(loan.includes('function LoanRiskNotice'), 'one consolidated warning component');
assert.equal((loan.match(/data-testid="loan-risk-global"/g) || []).length, 1);
for (const key of ['loan.warningLiqTitle', 'loan.warningLiqBorrowBody', 'loan.warningScTitle', 'loan.riskBody2', 'loan.archTitle', 'loan.archBody']) {
  assert.ok(loan.includes(`t('${key}')`), `the warning card must contain ${key}`);
}
assert.ok(/\.loan-risk-notice\b/.test(riskCss), 'the warning card has a modern visual treatment');

/* 3 · no explainer or warning on the positions tab */
assert.ok(/tab !== 'positions' && \(/.test(loan), 'the explainer + warning gate exists');
const gated = loan.slice(loan.indexOf("tab !== 'positions'"), loan.indexOf('<ExecutionSheet'));
assert.ok(gated.includes('<HowItWorks') && gated.includes('<LoanRiskNotice'), 'both live on lend/borrow');
assert.ok(!gated.includes('<InfoBox'), 'no folded info box on either tab');

/* 4 · collateral loop is a full-screen popup */
assert.ok(loop.includes('createPortal('), 'the expanded shell is portalled out of clipped ancestors');
assert.ok(loop.includes('data-testid="loan-loop-backdrop"'), 'a backdrop closes the popup');
assert.ok(loop.includes('data-testid="loop-box-close"'), 'an explicit close control exists');
assert.ok(loop.includes("e.key === 'Escape'"), 'Escape dismisses the popup');
assert.ok(/\.loan-loop-portal\s*\{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/.test(loopCss));
assert.ok(/\.loan-loop-shell\.loop-box\.is-open\s*\{[\s\S]*?block-size: 100%;/.test(loopCss));

console.log('PASS 18 loan copy + layout assertions');
