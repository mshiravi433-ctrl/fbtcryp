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
    publicFlag: 'VITE_AAVE_BASE_SUPPLY_PUBLIC'
  }),
  'compound-base': Object.freeze({
    label: 'Compound v3 Base native USDC',
    flag: 'VITE_ENABLE_COMPOUND_BASE_SUPPLY',
    allowlist: 'VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST',
    publicFlag: 'VITE_COMPOUND_BASE_SUPPLY_PUBLIC'
  }),
  'aave-arbitrum': Object.freeze({
    label: 'Aave v3 Arbitrum native USDC',
    flag: 'VITE_ENABLE_AAVE_ARBITRUM_SUPPLY',
    allowlist: 'VITE_AAVE_ARB_SUPPLY_ALLOWLIST',
    publicFlag: 'VITE_AAVE_ARB_SUPPLY_PUBLIC'
  }),
  lido: Object.freeze({
    label: 'Lido Ethereum ETH',
    flag: 'VITE_ENABLE_LIDO_STAKE',
    allowlist: 'VITE_LIDO_STAKE_ALLOWLIST',
    publicFlag: 'VITE_LIDO_STAKE_PUBLIC'
  }),
  'morpho-base': Object.freeze({
    label: 'Morpho Blue Base selected USDC/cbBTC market',
    flag: 'VITE_ENABLE_MORPHO_BASE_SUPPLY',
    allowlist: 'VITE_MORPHO_BASE_SUPPLY_ALLOWLIST',
    publicFlag: 'VITE_MORPHO_BASE_SUPPLY_PUBLIC'
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

/**
 * Inspect a build environment without mutating it.
 *
 * Capital-off builds require no evidence marker. The moment any money-in flag
 * is true, the selected rollout ids must match the enabled flags exactly, the
 * strict-fork marker is mandatory, and that protocol's allowlist must be
 * non-empty. There are no amount caps anymore: the owner removed them after
 * the fork evidence passed («با هر مقدار انجام بپذیر»), so the only ceilings
 * left are the protocols' own on-chain limits and the user's balance.
 */
export function inspectFarmRollout(env = process.env) {
  const errors = [];
  const selected = parseSelection(value(env, 'FARM_ROLLOUT_PROTOCOLS'), errors);
  const knownSelected = selected.filter((id) => FARM_ROLLOUT_PROTOCOLS[id]);
  const enabled = [];

  const publicEnabled = [];
  for (const [id, protocol] of Object.entries(FARM_ROLLOUT_PROTOCOLS)) {
    const rawFlag = value(env, protocol.flag);
    if (rawFlag && rawFlag !== 'true' && rawFlag !== 'false') {
      errors.push(`${protocol.flag} must be exactly "true", "false", or unset.`);
    }
    if (rawFlag === 'true') enabled.push(id);

    const rawPublic = value(env, protocol.publicFlag);
    if (rawPublic && rawPublic !== 'true' && rawPublic !== 'false') {
      errors.push(`${protocol.publicFlag} must be exactly "true", "false", or unset.`);
    }
    if (rawPublic === 'true') {
      if (rawFlag !== 'true') {
        errors.push(`${protocol.publicFlag}=true requires ${protocol.flag}=true.`);
      } else {
        publicEnabled.push(id);
      }
    }
  }

  // Public capital is a deliberate post-canary override. It must never open on
  // the strength of the flag alone: once any protocol is public the build has
  // to assert that a successful canary already happened.
  if (publicEnabled.length > 0 && value(env, 'FARM_CANARY_CONFIRMED') !== 'true') {
    errors.push('Public rollout requires FARM_CANARY_CONFIRMED=true after a successful canary.');
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
      protocols[id] = Object.freeze({
        id,
        label: protocol.label,
        flag: protocol.flag,
        allowlistName: protocol.allowlist,
        allowlist: Object.freeze(allowlist),
        public: publicEnabled.includes(id)
      });
    }
  }

  const anyPublic = enabled.some((id) => publicEnabled.includes(id));
  return Object.freeze({
    ok: errors.length === 0,
    mode: enabled.length === 0 ? 'capital-off' : (anyPublic ? 'public-open' : 'limited-canary'),
    selected: Object.freeze(knownSelected),
    enabled: Object.freeze(enabled),
    public: Object.freeze(publicEnabled),
    canaryConfirmed: value(env, 'FARM_CANARY_CONFIRMED') === 'true',
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
    const scope = row.public ? 'public' : `${row.allowlist.length} canary wallet${row.allowlist.length === 1 ? '' : 's'}`;
    return `${id} (${scope}, uncapped)`;
  }).join(', ');
  const mode = result.mode === 'public-open' ? 'public-open rollout' : 'limited canary';
  return `Farm rollout gate passed: ${mode} for ${summary}.`;
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
