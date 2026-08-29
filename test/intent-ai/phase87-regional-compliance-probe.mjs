/**
 * PHASE 87 — REGIONAL COMPLIANCE GATE
 * A feature is not legal everywhere. Unknown region = strictest policy, a
 * legal hold beats every allow, the availability map is complete and visible,
 * and geo-gating can only ever subtract.
 */
import { readFileSync } from 'node:fs';
import {
  featureState, legalHoldCovers, availabilityMap, assertFeaturePermitted, assertGateOnlyRestricts,
  GATED_FEATURES, FEATURE_STATES, REGION_POLICY, REGIONAL_COMPLIANCE_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HOLD = { active: true, ref: 'HOLD-7', features: ['swap'], regions: ['DE'] };

try {
  /* ---------- per-feature state ---------- */
  check('an allowed feature is available', featureState({ feature: 'swap', region: 'AE', now: NOW }).state === 'available');
  check('a blocked feature is blocked', featureState({ feature: 'fiat-onramp', region: 'US', now: NOW }).state === 'blocked');
  check('a restricted feature is restricted', featureState({ feature: 'automation', region: 'US', now: NOW }).state === 'restricted');
  check('a restricted feature asks for an acknowledgement',
    featureState({ feature: 'automation', region: 'US', now: NOW }).requiresAcknowledgement === true);
  check('every state is a known state',
    GATED_FEATURES.every((f) => FEATURE_STATES.includes(featureState({ feature: f, region: 'EU', now: NOW }).state)));
  check('an unknown feature is unknown, not allowed', featureState({ feature: 'teleport', region: 'EU', now: NOW }).state === 'unknown');
  check('every state carries a translatable key',
    GATED_FEATURES.every((f) => String(featureState({ feature: f, region: 'US', now: NOW }).i18nKey).startsWith('intentAI.compliance.')));

  /* ---------- unknown region is the STRICTEST, not the loosest ---------- */
  const unknown = featureState({ feature: 'agent-market', region: 'ZZ', now: NOW });
  check('an unknown region falls back to the default policy', unknown.state !== 'available');
  check('the strictness is named', unknown.reason === 'REGION_UNKNOWN_STRICT');
  check('the unknown region is admitted, not hidden', unknown.regionKnown === false);
  check('no region at all is treated the same as unknown',
    featureState({ feature: 'fiat-onramp', now: NOW }).state === 'blocked');
  check('the default policy is at least as strict as any named one',
    REGION_POLICY.DEFAULT.blocked.length >= REGION_POLICY.AE.blocked.length);
  check('a fiat ramp is blocked by default', REGION_POLICY.DEFAULT.blocked.includes('fiat-onramp'));

  /* ---------- legal hold beats everything ---------- */
  check('a hold covering the feature and region holds', legalHoldCovers(HOLD, 'swap', 'DE').held === true);
  check('the hold reference travels', legalHoldCovers(HOLD, 'swap', 'DE').ref === 'HOLD-7');
  check('a hold for another feature does not hold', legalHoldCovers(HOLD, 'send', 'DE').held === false);
  check('a hold for another region does not hold', legalHoldCovers(HOLD, 'swap', 'AE').held === false);
  check('an inactive hold does not hold', legalHoldCovers({ ...HOLD, active: false }, 'swap', 'DE').held === false);
  check('a wildcard hold covers everything', legalHoldCovers({ active: true, features: ['*'], regions: ['*'], ref: 'H' }, 'send', 'AE').held === true);
  const held = featureState({ feature: 'swap', region: 'DE', legalHold: HOLD, now: NOW });
  check('a legal hold BLOCKS an otherwise allowed feature', held.state === 'blocked');
  check('the block names the legal hold', held.reason === 'LEGAL_HOLD' && held.holdRef === 'HOLD-7');
  check('the hold is explained, not hidden', held.i18nKey === 'intentAI.compliance.legalHold');
  check('a held feature carries a classified error', held.error.code === 'GUARDIAN_REJECTED');
  check('no hold means no hold', legalHoldCovers(null, 'swap', 'DE').held === false);

  /* ---------- the user-visible map ---------- */
  const map = availabilityMap({ region: 'US', now: NOW });
  check('the map is built', map.ok === true && map.schema === REGIONAL_COMPLIANCE_SCHEMA);
  check('every gated feature appears', map.features.length === GATED_FEATURES.length && map.complete === true);
  check('the map is meant for the user', map.userVisible === true);
  check('the blocked list is explicit', map.blocked.includes('fiat-onramp'));
  check('the restricted list is explicit', map.restricted.includes('automation'));
  check('every row has a reason or is available',
    map.features.every((f) => f.state === 'available' || typeof f.reason === 'string'));
  const unknownMap = availabilityMap({ region: null, now: NOW });
  check('an unknown region still produces a complete map', unknownMap.complete === true);
  check('the unknown region is stated in the title', unknownMap.i18nKey === 'intentAI.compliance.regionUnknown');
  const heldMap = availabilityMap({ region: 'DE', legalHold: HOLD, now: NOW });
  check('a held feature shows as blocked on the map',
    heldMap.features.find((f) => f.feature === 'swap').state === 'blocked');

  /* ---------- the gate ---------- */
  check('an available feature is permitted', assertFeaturePermitted({ feature: 'swap', region: 'AE', now: NOW }).permitted === true);
  check('being permitted is not being authorized',
    assertFeaturePermitted({ feature: 'swap', region: 'AE', now: NOW }).executionAuthorized === false);
  check('a blocked feature is not permitted', assertFeaturePermitted({ feature: 'fiat-onramp', region: 'US', now: NOW }).permitted === false);
  check('a restricted feature needs the acknowledgement',
    assertFeaturePermitted({ feature: 'automation', region: 'US', now: NOW }).permitted === false);
  check('an acknowledged restriction may proceed',
    assertFeaturePermitted({ feature: 'automation', region: 'US', acknowledged: true, now: NOW }).permitted === true);
  check('acknowledging a BLOCKED feature changes nothing',
    assertFeaturePermitted({ feature: 'fiat-onramp', region: 'US', acknowledged: true, now: NOW }).permitted === false);
  check('acknowledging a legal hold changes nothing',
    assertFeaturePermitted({ feature: 'swap', region: 'DE', legalHold: HOLD, acknowledged: true, now: NOW }).permitted === false);
  check('an unknown feature is never permitted', assertFeaturePermitted({ feature: 'teleport', region: 'AE', now: NOW }).permitted === false);
  check('the refusal is translatable', assertFeaturePermitted({ feature: 'fiat-onramp', region: 'US', now: NOW }).i18nKey === 'intentAI.compliance.blocked');

  /* ---------- gating only subtracts ---------- */
  check('a subset passes', assertGateOnlyRestricts({ base: ['swap', 'send'], gated: ['swap'] }).ok === true);
  check('an identical set passes', assertGateOnlyRestricts({ base: ['swap'], gated: ['swap'] }).ok === true);
  check('a feature granted BY the geo gate is caught',
    assertGateOnlyRestricts({ base: ['swap'], gated: ['swap', 'fiat-onramp'] }).ok === false);
  check('the granted feature is named',
    assertGateOnlyRestricts({ base: [], gated: ['swap'] }).reasons.includes('GRANTED_BY_GEO:swap'));

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the compliance copy is translated in en, fa and ar',
    locales.every((loc) => ['mapTitle', 'regionUnknown', 'available', 'restricted', 'blocked', 'legalHold']
      .every((k) => typeof loc?.intentAI?.compliance?.[k] === 'string')));

  /* ------------------------------------------------------------------ */
  /* UI WIRING — the availability map is on screen, complete and honest.  */
  /* ------------------------------------------------------------------ */
  const settings = readFileSync('src/pages/Settings.jsx', 'utf8');

  check('settings imports availabilityMap', /availabilityMap/.test(settings));
  check('settings renders the region availability section',
    settings.includes('data-testid="region-availability-section"')
    && settings.includes('intentAI.compliance.sectionTitle'));
  check('the map is rendered from availabilityMap, not a hand-written list',
    /regionMap\.features\.map\(/.test(settings));
  check('every gated feature gets its own row',
    GATED_FEATURES.every((f) => settings.includes('data-testid={`region-feature-')
      || settings.includes(`region-feature-${f}`)));
  check('each row carries its state as data, not only as colour',
    /data-state=\{feature\.state\}/.test(settings));
  check('each row states its reason in words',
    /sub=\{t\(feature\.i18nKey\)\}/.test(settings));
  /*
   * Every row must render EXACTLY ONE state chip, whichever state it is in.
   *
   * The acknowledged chip is a REPLACEMENT for the "restricted" one, so it
   * belongs in the other arm of a ternary — not in a second `&&` block beside
   * the ordinary chip. Two independent conditions left a hole in the middle:
   * an AVAILABLE feature is permitted and NOT restricted, so neither block
   * matched and swap, bridge and send rendered with no state at all. The
   * wiring probe only greps for the attribute, so it stayed green while the
   * three most common rows on the screen went blank.
   */
  check('every row renders exactly one state chip, in every state',
    (settings.match(/data-testid=\{`region-feature-/g) || []).length === 2
    && /\? \([\s\S]{0,700}?region-feature-[\s\S]{0,700}?\) : \([\s\S]{0,700}?region-feature-/.test(settings));

  check('an unknown region is admitted rather than silently strict',
    /!regionMap\.regionKnown/.test(settings) && settings.includes('data-testid="region-unknown-note"'));
  check('the region is derived from a locale hint, never asserted as legal fact',
    /navigator\.language/.test(settings));
  /*
   * The screen may only READ the gate, never the policy table it is derived
   * from — importing REGION_POLICY (or the grant-side assertGateOnlyRestricts)
   * would let a screen widen what the policy allows.
   *
   * Scoped to the import block rather than the whole file: the acknowledgement
   * flow below describes the invariant in a comment, and a comment naming
   * `assertGateOnlyRestricts` is not the same risk as importing it. Test what
   * the rule means, not every occurrence of the word.
   */
  const settingsImports = settings.slice(0, settings.indexOf('export default function Settings'));
  check('the UI cannot grant a feature the policy denies (render-only)',
    !/REGION_POLICY/.test(settingsImports) && !/assertGateOnlyRestricts/.test(settingsImports));

  /* The extra confirmation the settings row offers (see pages/Settings.jsx).
     Acknowledgement is honoured by the gate for a RESTRICTED feature — and
     must do nothing at all for a blocked one. */
  check('the acknowledgement is checked against the gate, not asserted by the UI',
    /assertFeaturePermitted\(\{/.test(settings) && /acknowledged:/.test(settings));
  check('acknowledging a restricted feature permits it, scoped and unexecuted',
    assertFeaturePermitted({ feature: 'automation', region: 'US', acknowledged: true, now: NOW }).permitted === true
    && assertFeaturePermitted({ feature: 'automation', region: 'US', acknowledged: true, now: NOW }).executionAuthorized === false);
  check('an acknowledgement never unlocks a feature the region blocks',
    assertFeaturePermitted({ feature: 'fiat-onramp', region: 'US', acknowledged: true, now: NOW }).permitted === false
    && assertFeaturePermitted({ feature: 'fiat-offramp', region: null, acknowledged: true, now: NOW }).permitted === false);
  check('an unacknowledged restricted feature stays refused',
    assertFeaturePermitted({ feature: 'automation', region: 'US', acknowledged: false, now: NOW }).permitted === false);

  /* The rendered map must cover the same features the module gates. */
  const uiMap = availabilityMap({ region: null });
  check('the rendered map is complete for an unknown region', uiMap.complete === true);
  check('an unknown region falls back to the strictest policy',
    uiMap.regionKnown === false
    && uiMap.blocked.includes('fiat-onramp') && uiMap.blocked.includes('fiat-offramp'));
  check('every feature in the rendered map has a state chip key',
    uiMap.features.every((f) => FEATURE_STATES.includes(f.state)));

  check('the section title and feature names exist in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.compliance?.sectionTitle === 'string'
      && GATED_FEATURES.every((f) => typeof loc?.intentAI?.compliance?.feature?.[f] === 'string')));
  check('every feature state chip is translated in en, fa and ar',
    locales.every((loc) => FEATURE_STATES.every((s) => typeof loc?.intentAI?.compliance?.state?.[s] === 'string')));

  console.log(JSON.stringify({ probe: 'phase87-regional-compliance', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
