/**
 * SECURITY INTELLIGENCE — the evidence engine behind the Security page.
 *
 * ─── THE ONE IDEA ───────────────────────────────────────────────────────────
 * Every number on the Security screen must trace to an observable fact: an RPC
 * read, a scanner report, an explorer answer, a dated incident entry, or a
 * recorded feed success/failure. This module computes those facts into
 * evidence and scores, and it is architecturally incapable of two things the
 * old static page was also incapable of — which is the point:
 *
 *   1. It never returns "SAFE". The output vocabulary is
 *      PASS / INFO / LOW / MEDIUM / HIGH / UNKNOWN, and UNKNOWN is the
 *      correct answer whenever evidence is missing. A missing check lowers
 *      confidence and dataQuality; it never raises the score.
 *   2. It never blocks. Nothing exported here is consulted by Swap, Bridge,
 *      Lending, Futures, signing or broadcasting code, and nothing in this
 *      module reads, modifies or gates an execution path. The routes mount
 *      GET handlers only. If this whole directory were deleted tomorrow, every
 *      trade in FBT Swap would execute identically.
 *
 * Audit ≠ safe: an "audited" protocol renders as `auditEvidence: PASS` — a
 * dated fact — alongside admin/upgrade/oracle rows, and the disclaimer is part
 * of the payload, not a tooltip.
 *
 * No Intent OS anywhere in here, and none of its outputs feed into it either.
 */

import {
  CHAIN_IDS, EVM_CHAINS, IntelError, cachedMeta, decodeUint, encodeCall,
  ethCall, explorerConfigured, healthSnapshot, isAddress, normAddr,
  recordIntelEvent, registryToken, SELECTORS, tokenMeta
} from './chainIntel.js';
import { fetchTokenRisk } from './tokenRisk.js';
import { hacksIndex, protocolDetail, contractProfile } from './explorerData.js';
import { storeGet, storeSet } from './store.js';

const SEC_TTL = {
  overview: 30_000,
  analysis: 3 * 60_000,
  approvals: 90_000,
  alerts: 30_000
};

/* -------------------------------------------------------------------------- */
/* The score engine — pure, exported for tests, no network                     */
/* -------------------------------------------------------------------------- */

/*
 * Factor weights. Total is normalized at compute time over the factors that
 * actually have evidence, so a contract where only 3 of 10 checks were
 * possible still gets a score — with confidence 0.3 and dataQuality LOW, and
 * with `level: 'UNKNOWN'` forced when coverage drops below 0.3. The weights
 * are a documented judgment about *relative importance*, not a guarantee, and
 * the UI is required to render confidence next to the score.
 */
export const SECURITY_FACTORS = [
  { key: 'auditEvidence', weight: 14, label: 'Audit coverage' },
  { key: 'sourceVerification', weight: 14, label: 'Contract verification' },
  { key: 'adminRisk', weight: 14, label: 'Admin / ownership' },
  { key: 'upgradeability', weight: 10, label: 'Upgradeability' },
  { key: 'oracleHealth', weight: 8, label: 'Oracle dependency' },
  { key: 'liquidity', weight: 12, label: 'Liquidity depth' },
  { key: 'holderConcentration', weight: 8, label: 'Holder concentration' },
  { key: 'contractAge', weight: 6, label: 'Contract age' },
  { key: 'incidentHistory', weight: 12, label: 'Incident history' },
  { key: 'activityAnomaly', weight: 8, label: 'Recent activity' }
];

/* How much of a factor's weight earns score at each status. */
const STATUS_RATIO = { PASS: 1, INFO: 0.85, LOW: 0.7, MEDIUM: 0.45, HIGH: 0.1, UNKNOWN: 0 };
const VALID_STATUSES = new Set(Object.keys(STATUS_RATIO));

/**
 * SecurityScoreEngine — deterministic, stateless, testable.
 *
 * Inputs: one evidence object per factor key, shape
 *   { status: 'PASS'|'INFO'|'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN', detail, source, checkedAt }
 * Unknown keys are folded into `factors` as INFO notes, never dropped — a
 * reviewer reading the payload sees every check that ran.
 *
 * Output follows the product spec:
 *   { score, level, confidence, dataQuality, factors }
 * score is null when nothing is known; it is NEVER 100 by default.
 */
export function computeSecurityScore(evidence = {}) {
  const factors = [];
  let weightSum = 0;
  let scoreSum = 0;
  let totalWeight = 0;
  for (const f of SECURITY_FACTORS) totalWeight += f.weight;
  const seen = new Set();
  for (const f of SECURITY_FACTORS) {
    const e = evidence[f.key];
    seen.add(f.key);
    if (!e) {
      factors.push({ key: f.key, label: f.label, status: 'UNKNOWN', weight: f.weight, detail: 'No data source answered this check.', source: null, checkedAt: null });
      continue;
    }
    const status = VALID_STATUSES.has(e.status) ? e.status : 'UNKNOWN';
    factors.push({ key: f.key, label: f.label, status, weight: f.weight, detail: e.detail || null, source: e.source || null, checkedAt: e.checkedAt || null });
    if (status !== 'UNKNOWN') {
      weightSum += f.weight;
      scoreSum += f.weight * STATUS_RATIO[status];
    }
  }
  for (const [k, e] of Object.entries(evidence)) {
    if (!seen.has(k) && e && VALID_STATUSES.has(e.status)) {
      factors.push({ key: k, label: k, status: e.status, weight: 0, detail: e.detail || null, source: e.source || null, checkedAt: e.checkedAt || null });
    }
  }
  const coverage = weightSum / totalWeight;
  if (weightSum === 0) {
    return { score: null, level: 'UNKNOWN', confidence: 0, dataQuality: 'NONE', factors, disclaimer: DISCLOSURE };
  }
  const score = Math.round((scoreSum / weightSum) * 100);
  let level = score >= 80 ? 'LOW' : score >= 55 ? 'MEDIUM' : 'HIGH';
  if (coverage < 0.3) level = 'UNKNOWN';
  const confidence = Math.round(coverage * 100) / 100;
  const dataQuality = coverage >= 0.8 ? 'HIGH' : coverage >= 0.5 ? 'MEDIUM' : 'LOW';
  return { score, level, confidence, dataQuality, factors, disclaimer: DISCLOSURE };
}

export const DISCLOSURE =
  'This score reflects the evidence currently observable to FBT monitoring. It is not a guarantee of safety, and it does not block anything — the decision is always yours.';

/* -------------------------------------------------------------------------- */
/* Evidence builders — each check records what it could see, or that it could  */
/* not. All reads are read-only.                                               */
/* -------------------------------------------------------------------------- */

function ev(status, detail, source, extra = {}) {
  return { status, detail, source, checkedAt: new Date().toISOString(), ...extra };
}

/** Contract security analysis: proxy/admin/pause/verification/ownership/incidents. */
export async function analyzeContract(chainId, address) {
  const c = Number(chainId);
  if (!EVM_CHAINS[c]) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${c}`);
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  const a = normAddr(address);
  return cachedMeta(`sec:contract:${c}:${a}`, SEC_TTL.analysis, async () => {
    const notices = [];
    const evidence = {};

    // 1. Direct on-chain facts via the contract profile (cached inside).
    let profile = null;
    try {
      profile = (await contractProfile(c, a)).data;
    } catch (err) {
      if (err?.code === 'RPC_UNAVAILABLE') {
        notices.push({ code: 'RPC_UNAVAILABLE', detail: 'Data temporarily unavailable — the chain did not answer this analysis window.' });
      } else notices.push({ code: 'ANALYSIS_PARTIAL', detail: String(err?.message || err).slice(0, 120) });
    }

    if (profile) {
      if (!profile.hasCode) {
        return {
          data: {
            subject: { type: 'contract', address: a, chainId: c, chainName: EVM_CHAINS[c].name },
            verdict: 'NOT_A_CONTRACT',
            score: computeSecurityScore(evidence),
            checks: [],
            evidence: {},
            profile,
            notices: [{ code: 'NO_CODE', detail: 'No contract code exists at this address on this network.' }]
          },
          cachedAt: new Date().toISOString()
        };
      }
      evidence.sourceVerification = profile.verified === true
        ? ev('PASS', `Source verified on ${EVM_CHAINS[c].explorer.replace('https://', '')}.`, 'explorer-api')
        : profile.verified === false
          ? ev('MEDIUM', 'The explorer reports this contract source as unverified.', 'explorer-api')
          : ev('UNKNOWN', profile.verificationNote === 'no-explorer-key'
            ? 'Verification status is not checkable — no explorer API key is configured on this server.'
            : 'The explorer API did not answer.', 'explorer-api');
      if (profile.isProxy) {
        evidence.upgradeability = ev('MEDIUM', `Upgradeable proxy (${profile.proxyKind}). Implementation ${profile.implementation || 'set via beacon'} can be changed by its admin.`, 'storage-read');
        evidence.adminRisk = profile.admin
          ? ev('MEDIUM', `Proxy admin ${profile.admin}. Whoever holds it controls the implementation.`, 'storage-read')
          : ev('UNKNOWN', 'Proxy detected but the admin slot did not resolve to an address.', 'storage-read');
      } else {
        evidence.upgradeability = ev('INFO', 'No EIP-1967 implementation slot set; this address is not a standard proxy. Non-EIP-1967 patterns are not detectable from here.', 'storage-read');
        evidence.adminRisk = profile.owner
          ? ev('MEDIUM', `owner() returns ${profile.owner} — a single address with privileged control, if it is an EOA or multisig cannot be read from here.`, 'eth_call')
          : ev('INFO', 'owner() returned no address on this contract.', 'eth_call');
      }
      evidence.activityAnomaly = profile.activity
        ? ev('INFO', `${profile.activity.transfersSeen} token transfer event(s) touched this contract in the scanned window${profile.activity.lastAt ? `, most recent ${new Date(profile.activity.lastAt).toISOString().slice(0, 16)}Z` : ''}.`, 'log-scan', { window: profile.activity.window })
        : ev('UNKNOWN', 'The log scan did not complete; recent activity is unknown.', 'log-scan');
      if (profile.createdAt) {
        const ageDays = (Date.now() - profile.createdAt) / 86_400_000;
        evidence.contractAge = ev(ageDays > 365 ? 'PASS' : ageDays > 90 ? 'INFO' : 'LOW', `${Math.floor(ageDays)} days old since creation tx ${profile.creationTx?.slice(0, 18) || 'unknown'}.`, 'explorer-api');
      } else {
        evidence.contractAge = ev('UNKNOWN', 'Creation date needs the explorer indexer; unavailable without a key.', 'explorer-api');
      }
    }

    // 2. Pause / mint / blacklist surface — direct calls, UNKNOWN on revert.
    const [pausedRaw, ownerRaw] = await Promise.all([
      ethCall(c, a, SELECTORS.paused),
      ethCall(c, a, SELECTORS.owner)
    ]);
    evidence.paused = pausedRaw && pausedRaw !== '0x'
      ? (decodeUint(pausedRaw) === 1n
        ? ev('HIGH', 'The contract reports paused() = true: transfers may be suspended right now.', 'eth_call')
        : ev('PASS', 'The contract exposes pause() and it is currently not paused.', 'eth_call'))
      : ev('INFO', 'No pause() surface detected (a reversion is evidence, not certainty — custom names exist).', 'eth_call');

    // 3. GoPlus enrichment when available (token-security also answers for contracts).
    let risk = null;
    try {
      const g = await fetchTokenRisk(c, a);
      risk = g?.report || null;
      if (g?.error) notices.push({ code: 'SECURITY_FEED_UNAVAILABLE', detail: 'The external token-security feed did not answer; those rows stay UNKNOWN.' });
    } catch { notices.push({ code: 'SECURITY_FEED_UNAVAILABLE', detail: 'The external token-security feed is unavailable.' }); }
    if (risk) {
      if (risk.pausable != null) evidence.pauseCapability = risk.pausable ? ev('MEDIUM', 'Token contract has a transfer-pause capability.', 'goplus') : ev('PASS', 'No transfer-pause capability reported.', 'goplus');
      if (risk.blacklist != null) evidence.blacklist = risk.blacklist ? ev('HIGH', 'Token has an address blacklist capability.', 'goplus') : ev('PASS', 'No blacklist capability reported.', 'goplus');
      if (risk.mintable != null) evidence.mintRisk = risk.mintable ? ev('MEDIUM', 'Token supply can be increased by a mint function.', 'goplus') : ev('PASS', 'No mint function reported.', 'goplus');
      if (risk.honeypot != null) evidence.transferRestrictions = risk.honeypot ? ev('HIGH', 'The scanner flagged this token as unsellable (honeypot pattern).', 'goplus') : risk.cannotBuy ? ev('HIGH', 'The scanner flagged buys as blocked.', 'goplus') : ev('PASS', 'The scanner saw normal buy/sell behavior.', 'goplus');
      if (risk.ownerChangeBalance != null) evidence.ownerBehavior = risk.ownerChangeBalance || risk.hiddenOwner ? ev('HIGH', 'Scanner reports owner-side balance manipulation or a hidden owner.', 'goplus') : ev('INFO', 'No owner-manipulation pattern reported.', 'goplus');
    }

    // 4. Incident history by explorer-verified creation? Contracts have no name;
    //    incidents match by token symbol when this is a token (see analyzeToken).
    evidence.incidentHistory = ev('UNKNOWN', 'Incident matching needs a named protocol; for a bare contract address this stays unknown — which is not the same as clean.', 'incident-feed');

    // 5. Watch-diff: persist what we saw, alert if the next analysis disagrees.
    const watch = await watchContract(c, a, {
      implementation: profile?.implementation || null,
      admin: profile?.admin || null,
      owner: profile?.owner || (ownerRaw && ownerRaw !== '0x' ? '0x' + ownerRaw.slice(-40).toLowerCase() : null),
      verified: profile?.verified ?? null
    });

    const score = computeSecurityScore(evidence);
    const checks = score.factors;
    return {
      data: {
        subject: { type: 'contract', address: a, chainId: c, chainName: EVM_CHAINS[c].name, explorer: `${EVM_CHAINS[c].explorer}/address/${a}` },
        score,
        checks,
        evidence,
        risk,
        profile,
        watch: watch.notes,
        notices
      },
      dataStatus: profile ? 'live' : 'unavailable',
      cachedAt: new Date().toISOString()
    };
  }, 'mixed:rpc+goplus+explorer');
}

/** Token security analysis — the scanner report shaped into evidence rows. */
export async function analyzeToken(chainId, address) {
  const c = Number(chainId);
  if (!EVM_CHAINS[c]) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${c}`);
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  const a = normAddr(address);
  return cachedMeta(`sec:token:${c}:${a}`, SEC_TTL.analysis, async () => {
    const notices = [];
    const evidence = {};
    const meta = await tokenMeta(c, a).catch(() => null);
    const reg = registryToken(c, a);
    let risk = null;
    try {
      const g = await fetchTokenRisk(c, a);
      risk = g?.report || null;
      if (g?.error) notices.push({ code: 'SECURITY_FEED_UNAVAILABLE', detail: 'The external token-security feed did not answer; risk rows stay UNKNOWN.' });
    } catch { notices.push({ code: 'SECURITY_FEED_UNAVAILABLE', detail: 'Token-security feed unavailable.' }); }

    if (reg) evidence.registryListing = ev('PASS', `Listed in FBT's curated registry as ${reg.symbol}. That means the contract address matches the project's published one — nothing more.`, 'fbt-registry');
    if (risk) {
      if (risk.honeypot != null) evidence.transferRestrictions = risk.honeypot ? ev('HIGH', 'Flagged as a honeypot: buying may succeed while selling cannot.', 'goplus') : ev('PASS', 'No honeypot pattern reported.', 'goplus');
      const tax = Math.max(Number(risk.buyTax ?? 0), Number(risk.sellTax ?? 0));
      evidence.tokenTax = Number.isFinite(tax) && (risk.buyTax != null || risk.sellTax != null)
        ? (tax >= 10 ? ev('HIGH', `Tax up to ${tax.toFixed(1)}%.`, 'goplus') : tax > 2 ? ev('MEDIUM', `Tax ${tax.toFixed(1)}%.`, 'goplus') : ev('PASS', `Tax ≈ ${tax.toFixed(1)}%.`, 'goplus'))
        : ev('UNKNOWN', 'The feed returned no tax numbers.', 'goplus');
      evidence.mintRisk = risk.mintable ? ev('MEDIUM', 'Supply is mintable by an owner.', 'goplus') : ev('PASS', 'No mint capability reported.', 'goplus');
      evidence.pauseCapability = risk.pausable ? ev('MEDIUM', 'Transfers can be paused by an owner.', 'goplus') : ev('INFO', 'No pause capability reported.', 'goplus');
      evidence.blacklist = risk.blacklist ? ev('HIGH', 'Addresses can be blacklisted — transfers can be blocked selectively.', 'goplus') : ev('PASS', 'No blacklist reported.', 'goplus');
      evidence.holderConcentration = risk.top10Share != null
        ? (risk.top10Share >= 0.6 ? ev('HIGH', `Top-10 holders control ~${Math.round(risk.top10Share * 100)}% of supply.`, 'goplus') : risk.top10Share >= 0.35 ? ev('MEDIUM', `Top-10 holders control ~${Math.round(risk.top10Share * 100)}%.`, 'goplus') : ev('PASS', `Top-10 concentration ~${Math.round(risk.top10Share * 100)}%.`, 'goplus'))
        : ev('UNKNOWN', 'No holder distribution data.', 'goplus');
      evidence.liquidity = risk.liquidityUsd != null
        ? (risk.liquidityUsd >= 500_000 ? ev('PASS', `DEX liquidity ≈ $${Math.round(risk.liquidityUsd / 1000)}k.`, 'goplus') : risk.liquidityUsd >= 30_000 ? ev('MEDIUM', `Thin liquidity ≈ $${Math.round(risk.liquidityUsd / 1000)}k — exits will move the price.`, 'goplus') : ev('HIGH', 'Liquidity is very thin or not found in DEX pools.', 'goplus'))
        : ev('UNKNOWN', 'Liquidity could not be measured.', 'goplus');
      evidence.sourceVerification = risk.openSource === true ? ev('PASS', 'Scanner reports verified/open source.', 'goplus') : risk.openSource === false ? ev('MEDIUM', 'Scanner reports unverified source.', 'goplus') : ev('UNKNOWN', 'No verification data.', 'goplus');
      evidence.upgradeability = risk.proxy ? ev('MEDIUM', 'The token itself is a proxy — implementation can change.', 'goplus') : ev('INFO', 'No proxy pattern reported for the token contract.', 'goplus');
      evidence.adminRisk = risk.ownerChangeBalance || risk.hiddenOwner
        ? ev('HIGH', 'Scanner reports owner-side balance manipulation or hidden ownership.', 'goplus')
        : ev('INFO', 'No owner-manipulation pattern reported.', 'goplus');
      evidence.lpLocked = risk.lpLocked === true ? ev('PASS', 'LP tokens locked (majority share).', 'goplus') : risk.lpLocked === false ? ev('MEDIUM', 'LP tokens not locked.', 'goplus') : ev('UNKNOWN', 'LP lock status unknown.', 'goplus');
      evidence.holders = risk.holderCount != null ? ev('INFO', `${risk.holderCount} holders reported.`, 'goplus') : null;
      if (evidence.holders) delete evidence.holders; // kept as info on the card, not a score factor
    }
    if (meta?.data?.registry) evidence.sourceVerification = evidence.sourceVerification || ev('PASS', 'Registry-listed token; address cross-checked against project docs at listing time.', 'fbt-registry');
    if (reg && !risk) {
      notices.push({ code: 'KNOWN_TOKEN_FEED_DOWN', detail: 'This is a curated registry token; the external feed being down does not change its listing status.' });
    }

    const score = computeSecurityScore(evidence);
    return {
      data: {
        subject: { type: 'token', address: a, chainId: c, chainName: EVM_CHAINS[c].name, symbol: meta?.data?.symbol || reg?.symbol || null, name: meta?.data?.name || reg?.name || null, decimals: meta?.data?.decimals ?? reg?.decimals ?? null },
        score,
        checks: score.factors,
        evidence,
        risk,
        registry: reg || null,
        notices
      },
      dataStatus: risk || reg ? 'live' : 'partial',
      cachedAt: new Date().toISOString()
    };
  }, 'mixed:goplus+registry+rpc');
}

/** Protocol security — audits/TVL/incidents/listing age; audit ≠ safe stated. */
export async function analyzeProtocol(slug) {
  const s = String(slug || '').trim();
  return cachedMeta(`sec:protocol:${s}`, SEC_TTL.analysis, async () => {
    const notices = [];
    const evidence = {};
    let detail = null;
    try {
      detail = (await protocolDetail(s)).data;
    } catch (err) {
      notices.push({ code: 'FEED_UNAVAILABLE', detail: 'The protocol feed did not answer; this analysis is unavailable, not clean.' });
      return { data: { subject: { type: 'protocol', slug: s }, score: computeSecurityScore({}), evidence: {}, incidents: [], detail: null, notices }, dataStatus: 'unavailable', cachedAt: new Date().toISOString() };
    }
    const auditCount = Number(detail.audits ?? 0);
    evidence.auditEvidence = Number.isFinite(auditCount) && auditCount > 0
      ? ev('INFO', `${auditCount} audit${auditCount > 1 ? 's' : ''} recorded${detail.auditLinks?.length ? ` (${detail.auditLinks.length} link${detail.auditLinks.length > 1 ? 's' : ''} attached)` : ''}. Audits are dated snapshots, not a guarantee — see the incident row.`, 'defillama')
      : ev('MEDIUM', 'No audits recorded on the protocol feed.', 'defillama');
    evidence.liquidity = detail.currentChainTvls?.chainTvls || detail.tvl != null
      ? (detail.tvl >= 100_000_000 ? ev('PASS', `TVL ≈ $${Math.round((detail.tvl || 0) / 1e6)}M across ${detail.chains?.length || 0} chain(s).`, 'defillama') : detail.tvl >= 2_000_000 ? ev('LOW', `TVL ≈ $${(detail.tvl / 1e6).toFixed(1)}M — small pools can be moved.`, 'defillama') : ev('MEDIUM', 'TVL is very small; exit liquidity will be thin.', 'defillama'))
      : ev('UNKNOWN', 'No TVL reported.', 'defillama');
    evidence.activityAnomaly = detail.change_7d != null
      ? (detail.change_7d <= -30 ? ev('HIGH', `TVL fell ${detail.change_7d.toFixed(1)}% in 7 days — large withdrawals in flight.`, 'defillama') : detail.change_7d <= -15 ? ev('MEDIUM', `TVL down ${detail.change_7d.toFixed(1)}% this week.`, 'defillama') : ev('INFO', `7-day TVL change ${detail.change_7d >= 0 ? '+' : ''}${detail.change_7d.toFixed(1)}%.`, 'defillama'))
      : ev('UNKNOWN', 'No weekly TVL change available.', 'defillama');
    evidence.contractAge = detail.listingDate
      ? (() => {
          const years = (Date.now() / 1000 - detail.listingDate) / (365 * 86_400);
          return years >= 3 ? ev('PASS', `Listed ${years.toFixed(1)} years ago — multiple market cycles of history.`, 'defillama') : years >= 1 ? ev('LOW', `Listed ${years.toFixed(1)} years ago.`, 'defillama') : ev('MEDIUM', 'Listed less than a year ago.', 'defillama');
        })()
      : ev('UNKNOWN', 'No listing date available.', 'defillama');
    if (detail.deadUrl) evidence.activityAnomaly = ev('HIGH', `The project's primary site is marked dead on the feed (→ ${detail.deadUrl}). Treat as a serious red flag.`, 'defillama');
    evidence.sourceVerification = detail.address ? ev('INFO', 'Token contract published on the feed; source-verification per contract is analyzed separately.', 'defillama') : ev('UNKNOWN', 'No token contract published on the feed.', 'defillama');
    evidence.adminRisk = ev('UNKNOWN', 'Admin key control is not observable from the protocol feed; run the contract analysis on its deployed address for a per-contract view.', 'defillama');
    evidence.oracleHealth = ev('UNKNOWN', 'Oracle dependencies are not observable from here.', 'defillama');
    evidence.upgradeability = ev('UNKNOWN', 'Proxy/upgrade posture needs the contract analysis of its addresses.', 'defillama');
    evidence.holderConcentration = ev('UNKNOWN', 'Holder data is per-token; not evaluated at protocol level here.', 'defillama');

    // Real incident rows matched by name against the dated hacks feed.
    let incidents = [];
    let incidentEvidence = null;
    try {
      const hacks = (await hacksIndex()).data.incidents || [];
      const needle = (detail.name || s).toLowerCase();
      incidents = hacks.filter((h) => (h.protocol || '').toLowerCase().includes(needle) || needle.includes((h.protocol || '').toLowerCase())).slice(0, 25);
      incidentEvidence = incidents.length
        ? ev('HIGH', `${incidents.length} incident${incidents.length > 1 ? 's' : ''} in the public incident log (most recent ${incidents[0].dateLabel || 'undated'}).`, 'defillama:hacks', { items: incidents.slice(0, 5) })
        : ev('LOW', 'No incident for this protocol in the feed-backed incident log — the log covers reported exploits, not silence-proof.', 'defillama:hacks');
    } catch {
      incidentEvidence = ev('UNKNOWN', 'The incident feed is unreachable right now — incident data unavailable, which is not the same as none.', 'defillama:hacks');
      notices.push({ code: 'INCIDENT_FEED_UNAVAILABLE', detail: 'Incident history could not be checked.' });
    }
    if (incidentEvidence) evidence.incidentHistory = incidentEvidence;

    const score = computeSecurityScore(evidence);
    return {
      data: {
        subject: { type: 'protocol', slug: s, name: detail.name, category: detail.category, chains: detail.chains || [], url: detail.url || null, icon: detail.icon || null },
        detail: { tvl: detail.tvl, change_7d: detail.change_7d, change_1d: detail.change_1d, volume_24h: detail.volume_24h, audits: detail.audits, auditLinks: detail.auditLinks, listingDate: detail.listingDate, deadUrl: detail.deadUrl },
        score,
        checks: score.factors,
        incidents,
        notices,
        policy: { auditsDifferFromSafety: true, note: 'Audit availability and overall risk are reported as separate rows on purpose.' }
      },
      dataStatus: 'live',
      cachedAt: new Date().toISOString()
    };
  }, 'mixed:defillama+incidents');
}

/* -------------------------------------------------------------------------- */
/* Approvals — wallet allowance analysis. Read-only everywhere.                */
/* -------------------------------------------------------------------------- */

const GOPLUS_V1 = 'https://api.gopluslabs.io/api/v1';
const GOPLUS_CHAINS = new Set(['1', '56', '137', '42161', '10', '8453', '43114', '59144']);

async function httpJson(url, timeout = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

function shapeApprovalRisk(allowance, daysSinceUse) {
  // The rule the spec asks for: unlimited + long-until-now-unused approvals are
  // "review", unlimited live ones are "watch", finite recent ones are informational.
  if (allowance == null) return { level: 'UNKNOWN', why: 'Allowance could not be read.' };
  if (allowance.unlimited) {
    if (daysSinceUse != null && daysSinceUse > 90) return { level: 'HIGH', why: 'Unlimited allowance with no use in over 90 days — the classic revocation candidate.' };
    if (daysSinceUse != null && daysSinceUse > 14) return { level: 'MEDIUM', why: 'Unlimited allowance, unused for over two weeks.' };
    return { level: 'LOW', why: 'Unlimited allowance with recent use; likely an active position.' };
  }
  return { level: 'INFO', why: 'Finite allowance; it is spent down by normal use.' };
}

/**
 * My Approvals. Primary source is GoPlus's approve-security feed (an indexer,
 * real timestamps, real allowance amounts). When it fails — or for a chain it
 * doesn't cover — the fallback reads ERC-20 allowances directly against the
 * small set of spenders FBT's own registry knows (the chain DEX routers). The
 * fallback is explicitly labeled `coverage: 'known-spenders'` so the UI says
 * "this scan covers N known contracts", never "you have no other approvals".
 */
export async function approvalsForWallet(chainId, address) {
  const c = Number(chainId);
  if (!isAddress(address)) throw new IntelError('BAD_ADDRESS', 'not a 0x address');
  if (!EVM_CHAINS[c]) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${c}`);
  const a = normAddr(address);
  return cachedMeta(`sec:approvals:${c}:${a}`, SEC_TTL.approvals, async () => {
    const notices = [];
    let rows = null;
    let source = 'goplus:approve-security';
    if (GOPLUS_CHAINS.has(String(c))) {
      try {
        const body = await httpJson(`${GOPLUS_V1}/approve_security/${c}?wallet_address=${a}`);
        const raw = body?.result?.[a] || body?.result?.[address] || null;
        if (raw) {
          rows = Object.entries(raw).map(([tokenAddr, t]) => {
            const info = t.token_info || {};
            const list = Array.isArray(t.allowance_data) ? t.allowance_data : [];
            return {
              token: normAddr(tokenAddr),
              symbol: info.token_symbol || null,
              name: info.token_name || null,
              decimals: Number(info.token_decimals ?? 18),
              infinite: t.infinite_approval === '1',
              approvals: list.map((ap) => ({
                spender: normAddr(ap.approve_address || ap.spender),
                allowanceRaw: String(ap.allowance ?? ap.approve_amount ?? ''),
                unlimited: ap.infinite_approval === '1' || BigInt(ap.allowance ?? ap.approve_amount ?? '0') >= (2n ** 255n),
                lastUsedAt: ap.approve_time ? Number(ap.approve_time) * 1000 : null,
                isValid: ap.is_valid !== '0'
              })).filter((x) => x.isValid)
            };
          }).filter((t) => t.approvals.length);
        }
      } catch (err) {
        notices.push({ code: 'APPROVAL_FEED_UNAVAILABLE', detail: `Approval feed unavailable (${String(err.message).slice(0, 60)}); falling back to known-spender reads.` });
      }
    } else {
      notices.push({ code: 'FEED_NOT_COVERED', detail: 'The approval indexer does not cover this network; scanning known spenders directly instead.' });
    }

    if (!rows) {
      source = `rpc:known-spenders`;
      rows = [];
      const spenders = [{ address: normAddr(EVM_CHAINS[c].router), label: EVM_CHAINS[c].dexName || 'DEX router' }].filter((s) => s.address);
      const tokens = (await import('./chainsLite.js')).TOKENS[c] || [];
      for (const t of tokens.filter((x) => x.address)) {
        for (const sp of spenders) {
          try {
            const data = encodeCall(SELECTORS.allowance, [a, sp.address]);
            const hex = await ethCall(c, normAddr(t.address), data);
            if (hex == null || hex === '0x') continue;
            const wei = decodeUint(hex);
            if (wei == null || wei === 0n) continue;
            rows.push({
              token: normAddr(t.address), symbol: t.symbol, name: t.name, decimals: t.decimals,
              infinite: wei >= (2n ** 255n),
              approvals: [{ spender: sp.address, spenderLabel: sp.label, allowanceRaw: wei.toString(), unlimited: wei >= (2n ** 255n), lastUsedAt: null, isValid: true }]
            });
          } catch { /* keep going; coverage note below says what was scannable */ }
        }
      }
      if (spenders.length === 0) notices.push({ code: 'NO_KNOWN_SPENDERS', detail: 'This network has no configured spender set to scan; approval coverage is unavailable.' });
    }

    const shaped = rows.map((r) => ({
      ...r,
      approvals: r.approvals.map((ap) => {
        const days = ap.lastUsedAt ? (Date.now() - ap.lastUsedAt) / 86_400_000 : null;
        const risk = shapeApprovalRisk({ unlimited: ap.unlimited }, days);
        return { ...ap, daysSinceUse: days != null ? Math.round(days) : null, risk: risk.level, riskWhy: risk.why, revokeAvailable: true };
      })
    }));
    const unlimited = shaped.reduce((n, r) => n + r.approvals.filter((x) => x.unlimited).length, 0);
    return {
      data: {
        wallet: a, chainId: c, chainName: EVM_CHAINS[c].name,
        coverage: source === 'goplus:approve-security' ? 'indexed-feed' : 'known-spenders',
        spendersScanned: source === 'rpc:known-spenders' ? [{ label: EVM_CHAINS[c].dexName || 'chain router', address: normAddr(EVM_CHAINS[c].router) || null }] : null,
        approvals: shaped,
        unlimitedCount: unlimited
      },
      dataStatus: shaped.length || source === 'goplus:approve-security' ? 'live' : 'partial',
      notices,
      cachedAt: new Date().toISOString()
    };
  }, 'mixed:goplus+rpc');
}

/* -------------------------------------------------------------------------- */
/* Alerts + watch system — real change detection, never enforcement            */
/* -------------------------------------------------------------------------- */

/**
 * Contract watch records. Each time a contract is analyzed we persist the
 * security-relevant surface (implementation, admin, owner, verification). The
 * NEXT analysis compares and, on a real change, records an alert with the
 * before/after values and actual timestamps. Storage follows the store.js
 * honesty rules: durable when a blob store is configured, per-process
 * otherwise, and the payload says which.
 */

async function watchContract(c, a, next) {
  const key = `secwatch:${c}:${a}`;
  const notes = [];
  let prev = null;
  try { prev = await storeGet(key, null); } catch { prev = null; }
  const snapshot = { ...(prev || {}), ...next, address: a, chainId: c, seenAt: new Date().toISOString() };
  const changes = [];
  if (prev) {
    if ((prev.implementation || null) !== (next.implementation || null)) changes.push({ field: 'implementation', from: prev.implementation || null, to: next.implementation || null, at: new Date().toISOString() });
    if ((prev.admin || null) !== (next.admin || null)) changes.push({ field: 'admin', from: prev.admin || null, to: next.admin || null, at: new Date().toISOString() });
    if ((prev.owner || null) !== (next.owner || null)) changes.push({ field: 'owner', from: prev.owner || null, to: next.owner || null, at: new Date().toISOString() });
    if (prev.verified !== next.verified && prev.verified != null && next.verified != null) changes.push({ field: 'verification', from: prev.verified, to: next.verified, at: new Date().toISOString() });
  } else {
    changes.push({ field: 'first-seen', from: null, to: a, at: new Date().toISOString() });
  }
  if (changes.length) {
    await pushAlerts(changes.map((ch) => ({
      id: `watch:${c}:${a}:${ch.field}:${ch.at}`,
      at: ch.at,
      type: ch.field === 'implementation' ? 'proxy-implementation-changed'
        : ch.field === 'admin' ? 'contract-admin-changed'
          : ch.field === 'owner' ? 'contract-owner-changed'
            : ch.field === 'verification' ? 'contract-verification-changed'
              : 'contract-first-seen',
      severity: ch.field === 'first-seen' ? 'INFO' : 'MEDIUM',
      chainId: c,
      subject: a,
      detail: `${ch.field}: ${ch.from ?? 'none'} → ${ch.to ?? 'none'}`
    })));
    notes.push(...changes.map((ch) => ({ kind: 'watch-change', ...ch })));
    recordIntelEvent('watch.change', `${changes.length} field(s) changed for ${a} on chain ${c}`, 'security-watch');
  }
  try {
    await storeSet(key, snapshot);
  } catch { notes.push({ kind: 'watch-not-persisted', detail: 'Durable store unavailable; the watch snapshot is kept in memory only for this instance.' }); }
  return { notes };
}

const ALERT_CAP = 200;
const alertsMem = []; // in-process; unioned with stored when the blob store exists
const ALERTS_STORE_KEY = 'secalerts:v1';

async function pushAlerts(list) {
  if (!list.length) return;
  alertsMem.push(...list);
  while (alertsMem.length > ALERT_CAP) alertsMem.shift();
  try {
    const stored = (await storeGet(ALERTS_STORE_KEY, [])) || [];
    const seen = new Set(stored.map((a) => a.id));
    for (const a of list) if (!seen.has(a.id)) stored.push(a);
    while (stored.length > ALERT_CAP) stored.shift();
    await storeSet(ALERTS_STORE_KEY, stored);
  } catch { /* memory-only; the response labels durability honestly */ }
  recordIntelEvent('alert.recorded', list.map((a) => a.type).join(', '), 'security-alerts');
}

/**
 * The alerts feed. Sources, all real: (1) contract-watch diffs recorded by
 * this server, (2) the dated public incident log — recent entries surface as
 * "protocol incident detected", (3) approval findings from the most recent
 * scan of the requesting wallet. Alerts describe; they do not gate. There is
 * deliberately no `blocked`, `prevented` or `disabled` field anywhere in this
 * payload shape, and the probe suite asserts it.
 */
export async function securityAlerts({ wallet = null, chainId = null, limit = 40 } = {}) {
  const notices = [];
  const alerts = [];
  // 1. watch diffs (memory + durable)
  let durable = [];
  let durableMode = 'in-memory';
  try {
    durable = (await storeGet(ALERTS_STORE_KEY, [])) || [];
    if (durable.length) durableMode = 'store';
  } catch { notices.push({ code: 'ALERT_STORE_UNAVAILABLE', detail: 'Alert storage is unavailable; showing this instance\'s in-memory alerts.' }); }
  const seenIds = new Set();
  for (const a of [...durable, ...alertsMem].sort((x, y) => String(y.at).localeCompare(String(x.at)))) {
    if (seenIds.has(a.id)) continue;
    seenIds.add(a.id);
    alerts.push({ ...a, source: a.source || 'security-watch' });
  }
  // 2. incident feed, last 30 days
  try {
    const hacks = (await hacksIndex()).data.incidents || [];
    const cutoff = Date.now() - 30 * 86_400_000;
    for (const h of hacks.filter((x) => x.at && x.at >= cutoff).slice(0, 25)) {
      alerts.push({
        id: `incident:${h.protocol}:${h.at}`,
        at: new Date(h.at).toISOString(),
        type: 'protocol-incident-detected',
        severity: 'HIGH',
        subject: h.protocol,
        detail: `Public incident log: ${h.protocol}${h.amountUsd ? ` — ~$${Math.round(h.amountUsd / 1e6)}M` : ''}${h.technique ? ` (${h.technique})` : ''}`,
        link: h.link || null,
        source: 'defillama:hacks'
      });
    }
  } catch { notices.push({ code: 'INCIDENT_FEED_UNAVAILABLE', detail: 'The incident feed is unreachable right now.' }); }
  // 3. wallet approval findings
  if (wallet && chainId) {
    try {
      const ap = (await approvalsForWallet(chainId, wallet)).data;
      for (const row of ap.approvals || []) {
        for (const a of row.approvals.filter((x) => x.unlimited && (x.daysSinceUse == null || x.daysSinceUse > 90))) {
          alerts.push({
            id: `approval:${chainId}:${row.token}:${a.spender}:${a.unlimited ? 'u' : 'f'}`,
            at: new Date().toISOString(),
            type: 'approval-risk-detected',
            severity: 'MEDIUM',
            chainId: Number(chainId),
            subject: `${row.symbol || row.token} → ${a.spenderLabel || a.spender}`,
            detail: `Unlimited allowance${a.daysSinceUse != null ? `, unused for ${a.daysSinceUse} day(s)` : ''}. Reviewing or revoking is recommended; nothing here is revoked for you.`,
            source: ap.coverage
          });
        }
      }
    } catch (err) { notices.push({ code: 'APPROVAL_SCAN_FAILED', detail: String(err?.message || err).slice(0, 120) }); }
  }
  alerts.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  return {
    data: {
      alerts: alerts.slice(0, Math.max(1, Math.min(limit, ALERT_CAP))),
      total: alerts.length,
      durability: durableMode
    },
    meta: { source: 'security-watch+incident-feed+approval-scan', updatedAt: new Date().toISOString(), freshness: 'EXACT', notes: ['Alerts are informational. No alert changes what a user can do.'] },
    notices
  };
}

/* -------------------------------------------------------------------------- */
/* Overview — the dashboard's six component cards, computed from health        */
/* -------------------------------------------------------------------------- */

function pctOk(list) {
  const good = list.filter(Boolean).length;
  return list.length ? Math.round((good / list.length) * 100) : null;
}

/**
 * Dashboard metrics. Every component's number is derived from the health map
 * chainIntel records as calls actually succeed or fail: reachable chains,
 * feed freshness, explorer coverage, alert load. On a cold instance that
 * hasn't observed anything yet, components report null with
 * `insufficient-evidence` — the UI shows "—", not 100.
 */
export async function securityOverview() {
  return cachedMeta('sec:overview', SEC_TTL.overview, async () => {
    const startedAt = new Date();
    const snapshot = healthSnapshot();
    const chainKeys = CHAIN_IDS.map((id) => snapshot[`rpc:${id}`] || null);
    const observedChains = chainKeys.filter(Boolean);
    const infraScore = observedChains.length
      ? pctOk(observedChains.map((h) => h.okCount > 0 && (!h.lastFailureAt || (h.lastSuccessAt && h.lastSuccessAt >= h.lastFailureAt))))
      : null;
    const explorerCoverage = pctOk(CHAIN_IDS.map((id) => explorerConfigured(id)));
    const feeds = ['llama:protocols', 'llama:hacks', 'llama:protocol'].map((k) => snapshot[k]).filter(Boolean);
    const feedScore = feeds.length ? pctOk(feeds.map((f) => f.okCount > 0 && (!f.lastFailureAt || (f.lastSuccessAt && f.lastSuccessAt >= f.lastFailureAt)))) : null;
    let alerts24 = null;
    try {
      const { data } = await securityAlerts({ limit: ALERT_CAP });
      const cutoff = Date.now() - 86_400_000;
      alerts24 = (data.alerts || []).filter((a) => a.at && Date.parse(a.at) >= cutoff);
    } catch { /* alert count stays null → component UNKNOWN */ }
    const threatScore = alerts24 != null ? Math.max(0, 100 - alerts24.filter((a) => a.severity === 'HIGH').length * 10 - alerts24.filter((a) => a.severity === 'MEDIUM').length * 5) : null;
    const contractCoverage = observedChains.length ? pctOk(observedChains.map((h) => h.latencyMs != null && h.latencyMs < 6000)) : null;

    const label = (s) => s == null ? 'INSUFFICIENT_EVIDENCE' : s >= 90 ? 'OPERATIONAL' : s >= 60 ? 'DEGRADED' : 'IMPAIRED';
    const components = [
      { key: 'infrastructure', label: 'Infrastructure', score: infraScore, status: label(infraScore), basis: observedChains.length ? `${observedChains.filter((h) => h.okCount > 0).length}/${observedChains.length} chains answering` : 'No chain calls observed yet in this process.', evidence: CHAIN_IDS.length },
      { key: 'contractMonitoring', label: 'Smart contract monitoring', score: contractCoverage, status: label(contractCoverage), basis: 'Chain latency within budget across observed RPC calls.', evidence: observedChains.length },
      { key: 'protocolMonitoring', label: 'Protocol monitoring', score: feedScore, status: label(feedScore), basis: feeds.length ? `${feeds.length} protocol feed(s) checked` : 'Protocol feeds not yet exercised in this process.', evidence: feeds.length },
      { key: 'threatMonitoring', label: 'Threat monitoring', score: threatScore, status: label(threatScore), basis: alerts24 != null ? `${alerts24.length} alert(s) in the last 24h` : 'Alert engine not yet exercised.', evidence: alerts24?.length ?? 0 },
      { key: 'dataProviders', label: 'Data providers', score: explorerCoverage, status: explorerCoverage == null ? 'INSUFFICIENT_EVIDENCE' : explorerCoverage >= 50 ? 'OPERATIONAL' : 'PARTIAL', basis: `${CHAIN_IDS.filter((id) => explorerConfigured(id)).length}/${CHAIN_IDS.length} chains have an explorer API key (verification, creation dates, indexed history depend on it).`, evidence: CHAIN_IDS.length }
    ];
    const systemStatus = components.some((c) => c.status === 'IMPAIRED') ? 'DEGRADED' : components.every((c) => c.status === 'INSUFFICIENT_EVIDENCE') ? 'STARTING' : components.some((c) => c.status === 'DEGRADED' || c.status === 'PARTIAL') ? 'OPERATIONAL_WITH_GAPS' : 'OPERATIONAL';
    return {
      data: {
        system: { status: systemStatus, startedAt: startedAt.toISOString(), note: 'Status reflects monitoring health observed by this API instance, not a guarantee about any contract.' },
        components,
        walletNote: { localOnly: true, note: 'Wallet-local posture (lock, biometrics, 2FA) is computed on the device and shown in the wallet security card; the server never receives those settings.' }
      },
      cachedAt: new Date().toISOString()
    };
  }, 'observed-health');
}

/**
 * The unified score endpoint from the spec. With a chain+address it analyzes
 * the contract; with a slug it analyzes the protocol; bare = overview scores.
 * The frontend never sends a score — only identifiers — and the backend
 * computes authoritatively (§41).
 */
export async function securityScoreQuery({ chain = null, address = null, protocol = null } = {}) {
  if (protocol) return analyzeProtocol(String(protocol));
  if (address && chain) return analyzeContract(chain, address);
  return securityOverview();
}

/** Timeline endpoint: the recorded events with their real timestamps. */
export async function securityActivity({ limit = 40 } = {}) {
  const { intelActivity } = await import('./chainIntel.js');
  const res = intelActivity({ limit: Math.max(1, Math.min(200, Number(limit) || 40)) });
  return {
    data: {
      events: res.events.map((e) => ({ at: e.at, type: e.type, detail: e.detail, source: e.source })),
      meta: { scope: res.meta.scope, since: res.meta.since, note: 'Per-process activity ring: it lists events this API instance actually observed since it started.' }
    }
  };
}

export { recordIntelEvent };
