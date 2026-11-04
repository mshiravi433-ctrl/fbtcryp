#!/usr/bin/env node
/**
 * Unit tests for the «AI ترید» slice: key format check, caps settings
 * validation, feature flag default, and copy rules. No network, no storage.
 * Run: node test/hyperliquid-aitrade-units.mjs
 */
import { AGENT_KEY_CODES, maskAgentKey, validateAgentKeyFormat } from '../src/lib/hyperliquid/agentKey.js';
import {
  HL_SETTINGS_CODES,
  HL_SYSTEM_LIMITS,
  defaultCapsSettings,
  validateCapsSettings
} from '../src/lib/hyperliquid/capsSettings.js';
import { AI_TRADE_COPY, AI_TRADE_TAB_LABEL } from '../src/lib/hyperliquid/aiTradeCopy.js';
import { AI_TRADE_ENABLED } from '../src/lib/features.js';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.error(`FAIL ${name} ${detail}`); }
};

// ── agent key format ───────────────────────────────────────────────────────
const GOOD = '0x' + 'ab12'.repeat(16);
check('good key accepted', validateAgentKeyFormat(GOOD).ok === true);
check('surrounding spaces trimmed', validateAgentKeyFormat(`  ${GOOD}  `).ok === true);
check('empty refused', validateAgentKeyFormat('').code === AGENT_KEY_CODES.EMPTY);
check('null refused', validateAgentKeyFormat(null).code === AGENT_KEY_CODES.EMPTY);
check('no 0x refused', validateAgentKeyFormat(GOOD.slice(2)).code === AGENT_KEY_CODES.BAD_FORMAT);
check('short refused', validateAgentKeyFormat('0x1234').code === AGENT_KEY_CODES.BAD_FORMAT);
check('non-hex refused', validateAgentKeyFormat('0x' + 'z'.repeat(64)).code === AGENT_KEY_CODES.BAD_FORMAT);
check('all-zero refused', validateAgentKeyFormat('0x' + '0'.repeat(64)).code === AGENT_KEY_CODES.ZERO);
check('mask hides the middle', maskAgentKey(GOOD).includes('…') && !maskAgentKey(GOOD).includes(GOOD.slice(10, 20)));
check('mask of short value is empty', maskAgentKey('0x12') === '');

// ── caps settings ──────────────────────────────────────────────────────────
const base = { totalExposureUsd: 20000, maxOrderUsd: 20000, dailyLossUsd: 1000, maxLeverage: 3, allowedCoins: ['BTC', 'ETH'], killSwitch: false };
const okRes = validateCapsSettings(base);
check('default-like settings accepted', okRes.ok === true && okRes.errors.length === 0);
check('defaults from caps.js are themselves valid', validateCapsSettings(defaultCapsSettings()).ok === true);
check('string numbers from a form accepted', validateCapsSettings({ ...base, maxOrderUsd: '25' }).ok === true);

check('order at 20000 accepted', validateCapsSettings({ ...base, maxOrderUsd: 20000, totalExposureUsd: 20000 }).ok === true);
check('order above 20000 refused',
  validateCapsSettings({ ...base, maxOrderUsd: 20001, totalExposureUsd: 50000 }).errors.includes(HL_SETTINGS_CODES.ORDER_OVER_SYSTEM_LIMIT));
check('total below per-order refused',
  validateCapsSettings({ ...base, maxOrderUsd: 500, totalExposureUsd: 100 }).errors.includes(HL_SETTINGS_CODES.EXPOSURE_BELOW_ORDER));
check('empty field refused as NOT_A_NUMBER',
  validateCapsSettings({ ...base, dailyLossUsd: '' }).errors.includes(HL_SETTINGS_CODES.NOT_A_NUMBER));
check('garbage text refused as NOT_A_NUMBER',
  validateCapsSettings({ ...base, maxOrderUsd: 'abc' }).errors.includes(HL_SETTINGS_CODES.NOT_A_NUMBER));
check('zero refused as NOT_POSITIVE',
  validateCapsSettings({ ...base, dailyLossUsd: 0 }).errors.includes(HL_SETTINGS_CODES.NOT_POSITIVE));
check('negative refused as NOT_POSITIVE',
  validateCapsSettings({ ...base, maxOrderUsd: -5 }).errors.includes(HL_SETTINGS_CODES.NOT_POSITIVE));
check('fractional leverage refused',
  validateCapsSettings({ ...base, maxLeverage: 2.5 }).errors.includes(HL_SETTINGS_CODES.LEVERAGE_NOT_INTEGER));
check('leverage above system limit refused',
  validateCapsSettings({ ...base, maxLeverage: HL_SYSTEM_LIMITS.maxLeverage + 1 }).errors.includes(HL_SETTINGS_CODES.LEVERAGE_OVER_SYSTEM_LIMIT));
check('coin outside universe refused',
  validateCapsSettings({ ...base, allowedCoins: ['DOGE'] }).errors.includes(HL_SETTINGS_CODES.COIN_OUTSIDE_UNIVERSE));
check('refused settings return no value', validateCapsSettings({ ...base, maxOrderUsd: 0 }).value === null);
check('kill switch is strictly boolean true', validateCapsSettings({ ...base, killSwitch: 'yes' }).value.killSwitch === false);

// ── feature flag: off by default ───────────────────────────────────────────
check('AI trade tab is OFF without the explicit env flag', AI_TRADE_ENABLED === false);

// ── copy rules ─────────────────────────────────────────────────────────────
const allCopy = JSON.stringify({ AI_TRADE_COPY, AI_TRADE_TAB_LABEL });
const FORBIDDEN = ['سود تضمینی', 'درآمد قطعی', 'ربات پرسود', 'بازده تضمینی', 'تضمین سود'];
for (const word of FORBIDDEN) {
  check(`no forbidden phrase "${word}"`, !allCopy.includes(word));
}
check('main-key warning present', AI_TRADE_COPY.connect.mainKeyWarning.includes('کلید اصلی'));
check('risk notice says loss is possible', AI_TRADE_COPY.riskNotice.includes('از دست'));
check('every key error code has copy',
  Object.values(AGENT_KEY_CODES).every((c) => typeof AI_TRADE_COPY.connect.errors[c] === 'string'));
check('every settings error code has copy',
  Object.values(HL_SETTINGS_CODES).every((c) => typeof AI_TRADE_COPY.limits.errors[c] === 'string'));

// ── the slice cannot sign or send anything ─────────────────────────────────
const slice = ['agentKey.js', 'capsSettings.js', 'aiTradeCopy.js']
  .map((f) => readFileSync(new URL(`../src/lib/hyperliquid/${f}`, import.meta.url), 'utf8')).join('\n');
check('no signing code in slice', !/signTypedData|new Wallet\(|privateKey\s*=/.test(slice));
check('no /exchange call in slice', !slice.includes('/exchange'));

console.log(`hyperliquid-aitrade-units: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
