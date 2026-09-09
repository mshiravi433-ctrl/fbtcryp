const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

/**
 * The only execution protocols a staged Farm build may select.
 *
 * Keep the rollout id separate from the client flag: the id is an operator
 * declaration, while the VITE_* value is what is compiled into the browser and
 * Android bundle. Requiring both prevents `VITE_ENABLE_*=true npm run build`
 * from bypassing the release gate.
 */
export const FARM_ROLLOUT_PROTOCOLS = Object.freeze({
  'aave-base': Object.freeze({
    label: 'Aave v3 Base native USDC',
    flag: 'VITE_ENABLE_AAVE_BASE_SUPPLY',
    allowlist: 'VITE_AAVE_BASE_SUPPLY_ALLOWLIST',
    perTxCap: 'VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX',
    totalCap: 'VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL',
    maxPerTx: 1000,
    maxTotal: 10000
  }),
  'compound-base': Object.freeze({
    label: 'Compound v3 Base native USDC',
    flag: 'VITE_ENABLE_COMPOUND_BASE_SUPPLY',
    allowlist: 'VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST',
    perTxCap: 'VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX',
    totalCap: 'VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL',
    maxPerTx: 1000,
    maxTotal: 10000
  }),
  'aave-arbitrum': Object.freeze({
    label: 'Aave v3 Arbitrum native USDC',
    flag: 'VITE_ENABLE_AAVE_ARBITRUM_SUPPLY',
    allowlist: 'VITE_AAVE_ARB_SUPPLY_ALLOWLIST',
    perTxCap: 'VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX',
    totalCap: 'VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL',
    maxPerTx: 1000,
    maxTotal: 10000
  }),
  lido: Object.freeze({
    label: 'Lido Ethereum ETH',
    flag: 'VITE_ENABLE_LIDO_STAKE',
    allowlist: 'VITE_LIDO_STAKE_ALLOWLIST',
    perTxCap: 'VITE_LIDO_STAKE_MAX_ETH_PER_TX',
    totalCap: 'VITE_LIDO_STAKE_MAX_ETH_TOTAL',
    maxPerTx: 1,
    maxTotal: 10
  }),
  'morpho-base': Object.freeze({
    label: 'Morpho Blue Base selected USDC/cbBTC market',
    flag: 'VITE_ENABLE_MORPHO_BASE_SUPPLY',
    allowlist: 'VITE_MORPHO_BASE_SUPPLY_ALLOWLIST',
    perTxCap: 'VITE_MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX',
    totalCap: 'VITE_MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL',
    maxPerTx: 1000,
    maxTotal: 10000
  })
});

const value = (env, name) => String(env?.[name] ?? '').trim();

function parseSelection(raw, errors) {
  if (!raw) return [];
  const entries = raw.split(',').map((item) => item.trim());
  if (entries.some((item) => !item)) {
    errors.push('FARM_ROLLOUT_PROTOCOLS contains an empty entry. Use comma-separated rollout ids.');
  }
  const selected = entries.filter(Boolean);
  if (new Set(selected).size !== selected.length) {
    errors.push('FARM_ROLLOUT_PROTOCOLS contains a duplicate rollout id.');
  }
  for (const id of selected) {
    if (!FARM_ROLLOUT_PROTOCOLS[id]) {
      errors.push(`FARM_ROLLOUT_PROTOCOLS contains unknown id "${id}".`);
    }
  }
  return [...new Set(selected)];
}

function parseAllowlist(raw, name, errors) {
  if (!raw) {
    errors.push(`${name} must contain at least one public canary wallet address.`);
    return [];
  }
  const entries = raw.split(',').map((item) => item.trim());
  if (entries.some((item) => !item)) {
    errors.push(`${name} contains an empty entry.`);
  }
  const invalid = entries.filter((item) => !ADDRESS_RE.test(item) || ZERO_ADDRESS.test(item));
  if (invalid.length) {
    errors.push(`${name} contains an invalid or zero 0x address.`);
  }
  const normalized = entries
    .filter((item) => ADDRESS_RE.test(item) && !ZERO_ADDRESS.test(item))
    .map((item) => item.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    errors.push(`${name} contains the same address more than once.`);
  }
  return [...new Set(normalized)];
}

function capValue(env, name, fallback, errors) {
  const raw = value(env, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${name} must be a finite number greater than zero.`);
    return fallback;
  }
  return parsed;
}

/**
 * Inspect a build environment without mutating it.
 *
 * Capital-off builds require no evidence marker. The moment any money-in flag
 * is true, the selected rollout ids must match the enabled flags exactly, the
 * strict-fork marker is mandatory, that protocol's allowlist must be non-empty,
 * and canary caps may not exceed the reviewed defaults.
 */
export function inspectFarmRollout(env = process.env) {
  const errors = [];
  const selected = parseSelection(value(env, 'FARM_ROLLOUT_PROTOCOLS'), errors);
  const knownSelected = selected.filter((id) => FARM_ROLLOUT_PROTOCOLS[id]);
  const enabled = [];

  for (const [id, protocol] of Object.entries(FARM_ROLLOUT_PROTOCOLS)) {
    const rawFlag = value(env, protocol.flag);
    if (rawFlag && rawFlag !== 'true' && rawFlag !== 'false') {
      errors.push(`${protocol.flag} must be exactly "true", "false", or unset.`);
    }
    if (rawFlag === 'true') enabled.push(id);
  }

  for (const id of enabled) {
    if (!knownSelected.includes(id)) {
      errors.push(`${FARM_ROLLOUT_PROTOCOLS[id].flag}=true requires FARM_ROLLOUT_PROTOCOLS to include "${id}".`);
    }
  }
  for (const id of knownSelected) {
    if (!enabled.includes(id)) {
      errors.push(`FARM_ROLLOUT_PROTOCOLS includes "${id}" but ${FARM_ROLLOUT_PROTOCOLS[id].flag} is not true.`);
    }
  }

  const protocols = {};
  if (enabled.length > 0) {
    if (value(env, 'FARM_STRICT_FORK_EVIDENCE') !== 'true') {
      errors.push('FARM_STRICT_FORK_EVIDENCE=true is required after successful strict fork probes.');
    }

    for (const id of enabled) {
      const protocol = FARM_ROLLOUT_PROTOCOLS[id];
      const allowlist = parseAllowlist(value(env, protocol.allowlist), protocol.allowlist, errors);
      const perTx = capValue(env, protocol.perTxCap, protocol.maxPerTx, errors);
      const total = capValue(env, protocol.totalCap, protocol.maxTotal, errors);
      if (perTx > protocol.maxPerTx) {
        errors.push(`${protocol.perTxCap} may not exceed the reviewed canary cap ${protocol.maxPerTx}.`);
      }
      if (total > protocol.maxTotal) {
        errors.push(`${protocol.totalCap} may not exceed the reviewed canary cap ${protocol.maxTotal}.`);
      }
      if (perTx > total) {
        errors.push(`${protocol.perTxCap} may not exceed ${protocol.totalCap}.`);
      }
      protocols[id] = Object.freeze({
        id,
        label: protocol.label,
        flag: protocol.flag,
        allowlistName: protocol.allowlist,
        allowlist: Object.freeze(allowlist),
        perTxCap: perTx,
        totalCap: total
      });
    }
  }

  return Object.freeze({
    ok: errors.length === 0,
    mode: enabled.length === 0 ? 'capital-off' : 'limited-canary',
    selected: Object.freeze(knownSelected),
    enabled: Object.freeze(enabled),
    protocols: Object.freeze(protocols),
    errors: Object.freeze(errors)
  });
}

export function formatFarmRollout(result) {
  if (result.mode === 'capital-off') {
    return 'Farm rollout gate passed: no money-in protocol is enabled (capital-off build).';
  }
  const summary = result.enabled.map((id) => {
    const row = result.protocols[id];
    return `${id} (${row.allowlist.length} canary wallet${row.allowlist.length === 1 ? '' : 's'}, caps ${row.perTxCap}/${row.totalCap})`;
  }).join(', ');
  return `Farm rollout gate passed: limited canary for ${summary}.`;
}

/** Throw during config evaluation so every Vite entry point fails closed. */
export function assertFarmRollout(env = process.env) {
  const result = inspectFarmRollout(env);
  if (!result.ok) {
    const detail = result.errors.map((error) => `  - ${error}`).join('\n');
    throw new Error(`Farm rollout gate rejected this build:\n${detail}`);
  }
  return result;
}
