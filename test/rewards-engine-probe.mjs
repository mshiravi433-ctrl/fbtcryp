/**
 * FBT REWARDS ENGINE PROBE — real-activity → reward rules.
 * ---------------------------------------------------------------------------
 * Pure logic only: an in-memory KV + an injected verifier stand in for the
 * network and storage, so the probe pins the engine's own contracts:
 *
 *   1. IDEMPOTENCY — one credit per fingerprint, forever; a duplicated event
 *      (same txHash/wallet/chainId or same eventId) never double-rewards.
 *   2. VERIFICATION GATES — an RPC failure or a failed receipt is never a
 *      credit; the same event is credited once the chain can confirm it.
 *   3. LEVELS — configurable bands; boundaries are exact.
 *   4. MISSIONS / ACHIEVEMENTS — derived from real counters, paid once, and
 *      the streak survives a one-day gap but resets after a skip.
 *   5. REFERRAL — wallet-signature binding, self-referral refused, one
 *      reward per invitee, duplicate invitee never re-rewarded.
 *   6. CLAIM — not launched unless a distributor is configured; when it is,
 *      prepare issues a single-use nonce and a replay is refused.
 *   7. BOUNDED STORAGE — history ≤ 25, seen ≤ 300, day counters pruned.
 */
import { Wallet } from 'ethers';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const engine = await import('../server/rewards/engine.js');
const { LEVELS } = await import('../server/rewards/config.js');

/* ------------------------------ memory store ------------------------------ */

/* Direct port of the kv surface used by engine.ioDefault + claim nonces. */
function makeKv() {
  const m = new Map();
  const get = (k, fb) => (m.has(k) ? m.get(k) : fb);
  const set = (k, v) => m.set(k, v);

  const newLedger = (owner) => ({
    schema: 'x', owner, points: 0, byAction: {}, days: {}, firsts: {},
    history: [], missionsDone: {}, streak: { lastDay: null, count: 0 },
    referrals: 0, refCode: null, created: null, updated: null
  });
  return {
    kv: m,
    getLedger: async (o) => { const v = get(`ledger:${o}`); return v || newLedger(o); },
    saveLedger: async (o, l) => set(`ledger:${o}`, l),
    getSeen: async (o) => get(`seen:${o}`, []),
    saveSeen: async (o, s) => set(`seen:${o}`, s),
    getRefcode: async (c) => get(`refcode:${c}`, null),
    bindRefcode: async (x) => set(`refcode:${x.code}`, x) || set(`refbind:${x.wallet || x.owner}`, x),
    getRefbind: async (w) => get(`refbind:${w}`, null),
    getRefattr: async (c) => get(`refattr:${c}`, []),
    addRefattr: async (c, w, at) => {
      const l = get(`refattr:${c}`, []);
      if (!l.some((r) => r.wallet === w)) l.push({ wallet: w, at });
      set(`refattr:${c}`, l);
      return l;
    },
    getPendingNonces: async (o) => get(`nonce:${o}`, []),
    savePendingNonces: async (o, n) => set(`nonce:${o}`, n)
  };
}

const io = (kv) => engine.ioDefault(kv);
const okVerify = async () => ({ ok: true, source: 'fake-rpc' });
const failVerify = async () => ({ ok: false, code: 'RPC_UNAVAILABLE' });

const DAY = 86400_000;
const now = Date.now();
const today = engine.dayKey(now);

/* ------------------------------ levels ----------------------------------- */

t('levelFor: 0 points is bronze', engine.levelState(0).current.id === 'bronze');
t('levelFor: 499 points is still bronze', engine.levelState(499).current.id === 'bronze');
t('levelFor: 500 points is silver', engine.levelState(500).current.id === 'silver');
t('levelFor: 2000 is gold, 6000 platinum, 15000 diamond', ['gold', 'platinum', 'diamond']
  .every((id, i) => engine.levelState([2000, 6000, 15000][i]).current.id === id));
t('levelFor: above the top band stays diamond and is maxed', (() => {
  const s = engine.levelState(999999);
  return s.current.id === 'diamond' && s.maxed === true && s.next === null;
})());
t('levelFor: the level table is configurable', (() => {
  const custom = [{ id: 'a', index: 0, min: 0 }, { id: 'b', index: 1, min: 10 }];
  return engine.levelState(9, custom).current.id === 'a' && engine.levelState(10, custom).current.id === 'b';
})());
t('LEVELS exposes the five spec levels in order', LEVELS.map((l) => l.id).join(',') === 'bronze,silver,gold,platinum,diamond');

/* ------------------------------ ingestion --------------------------------- */

const kv1 = makeKv();
const io1 = io(kv1);
const owner1 = 'dev:probe-account-1';
const swapEv = (i, at = now) => ({
  id: `ev-${i}`, action: 'swap', wallet: '0x1111111111111111111111111111111111111111',
  chainId: 8453, txHash: `0x${String(i).padStart(64, '0')}`, at
});

/* NOTE: the first swap of a day also completes the swap1 daily mission
   (+10 bonus), so exact totals below include it. */
let r = await engine.ingestEvents({ owner: owner1, events: [swapEv('a')], io: io1, verify: okVerify });
t('a real verified swap event is credited (1pt + first-swap-of-day mission)', r.results[0]?.credited === true && r.results[0]?.pts === 1 && r.ledger.points === 11);

r = await engine.ingestEvents({ owner: owner1, events: [swapEv('a')], io: io1, verify: okVerify });
t('replaying the SAME txHash never double-rewards', r.results[0]?.duplicate === true && r.ledger.points === 11);

r = await engine.ingestEvents({ owner: owner1, events: [{ ...swapEv('b'), wallet: '0x2222222222222222222222222222222222222222' }], io: io1, verify: okVerify });
t('the same txHash from another wallet is a separate fingerprint and is credited', r.ledger.points === 12);

const labFirst = await engine.ingestEvents({ owner: owner1, events: [{ id: 'same-id', action: 'lab', at: now - 1000 }], io: io1, verify: okVerify });
const labSecond = await engine.ingestEvents({ owner: owner1, events: [{ id: 'same-id', action: 'lab', at: now - 500 }], io: io1, verify: okVerify });
t('two events with the same eventId credit once', labFirst.results[0]?.credited === true && labSecond.results[0]?.duplicate === true && labSecond.ledger.points === labFirst.ledger.points);

/* RPC failure → no credit, safe retry */
const kvR = makeKv();
const ioR = io(kvR);
const ownerR = 'dev:probe-rpc';
let rr = await engine.ingestEvents({ owner: ownerR, events: [swapEv('x')], io: ioR, verify: failVerify });
t('RPC failure is never a credit', rr.results[0]?.ok === false && rr.results[0]?.code === 'RPC_UNAVAILABLE' && rr.ledger.points === 0);
rr = await engine.ingestEvents({ owner: ownerR, events: [swapEv('x')], io: ioR, verify: okVerify });
t('the same event is credited once the RPC answers (safe retry)', rr.results[0]?.credited === true && rr.results[0]?.pts === 1 && rr.ledger.points === 11);
rr = await engine.ingestEvents({ owner: ownerR, events: [swapEv('x')], io: ioR, verify: okVerify });
t('...and still never twice', rr.results[0]?.duplicate === true && rr.ledger.points === 11);

/* unknown action refused */
rr = await engine.ingestEvents({ owner: ownerR, events: [{ id: 'zz', action: 'teleport', at: now }], io: ioR, verify: okVerify });
t('an unknown action is refused, not invented', rr.results[0]?.ok === false && rr.results[0]?.code === 'UNKNOWN_ACTION');

/* once-ever */
const kvOnce = makeKv();
const ioOnce = io(kvOnce);
let ro = await engine.ingestEvents({ owner: 'dev:once', events: [{ id: 'fs-1', action: 'firstSwap', at: now }], io: ioOnce, verify: okVerify });
ro = await engine.ingestEvents({ owner: 'dev:once', events: [{ id: 'fs-2', action: 'firstSwap', at: now + 1 }], io: ioOnce, verify: okVerify });
t('a once-ever action pays once even with a second event', ro.ledger.points === 300 && ro.results[0]?.duplicate === true);

/* daily cap */
const kvCap = makeKv();
const ioCap = io(kvCap);
const many = Array.from({ length: 55 }, (_, i) => swapEv(`cap-${i}`));
let rc = await engine.ingestEvents({ owner: 'dev:cap', events: many, io: ioCap, verify: okVerify });
const cappedCount = rc.results.filter((x) => x.capped).length;
t('the swap daily cap stops credits at 50 (mission bonuses: swap1 +10, swap5 +25)', rc.ledger.points === 85 && cappedCount === 5);
rc = await engine.ingestEvents({ owner: 'dev:cap', events: [{ id: 'cap-next', action: 'swap', txHash: `0x${'9'.repeat(64)}`, wallet: '0x1111111111111111111111111111111111111111', chainId: 1, at: now + DAY }], io: ioCap, verify: okVerify });
t('the cap resets on the next local day', rc.ledger.points === 86);

/* streak */
const kvS = makeKv();
const ioS = io(kvS);
const ownerS = 'dev:streak';
const checkin = (at) => ({ id: `ci-${at}`, action: 'dailyCheckin', at });
await engine.ingestEvents({ owner: ownerS, events: [checkin(now)], io: ioS, verify: okVerify });
let ledgerS = await kvS.getLedger(ownerS);
t('first check-in starts the streak at 1', ledgerS.streak.count === 1);
await engine.ingestEvents({ owner: ownerS, events: [checkin(now + DAY)], io: ioS, verify: okVerify });
ledgerS = await kvS.getLedger(ownerS);
t('a check-in on the next day continues the streak to 2', ledgerS.streak.count === 2);
await engine.ingestEvents({ owner: ownerS, events: [checkin(now + 3 * DAY)], io: ioS, verify: okVerify });
ledgerS = await kvS.getLedger(ownerS);
t('a skipped day resets the streak to 1', ledgerS.streak.count === 1);

/* missions: swap1 pays a 10pt bonus once per day */
const kvM = makeKv();
const ioM = io(kvM);
const ownerM = 'dev:mission';
let rm = await engine.ingestEvents({ owner: ownerM, events: [swapEv('m1')], io: ioM, verify: okVerify });
t('a first swap completes the swap1 mission and pays its bonus', (() => {
  const b = rm.results[0]?.missionBonuses || [];
  return rm.ledger.points === 11 && b.some((x) => x.missionId === 'swap1' && x.pts === 10);
})());
rm = await engine.ingestEvents({ owner: ownerM, events: [swapEv('m2')], io: ioM, verify: okVerify });
t('a second swap the same day pays the swap again but not the mission twice', rm.ledger.points === 12 && rm.results[0]?.missionBonuses?.length === 0);
rm = await engine.ingestEvents({ owner: ownerM, events: [swapEv('m3', now + DAY)], io: ioM, verify: okVerify });
t('an event is counted on the day it happened, not the day it arrived', rm.ledger.points === 13 && rm.results[0]?.missionBonuses?.length === 0);

/* achievements + summary */
const summaryM = await engine.buildSummary({ owner: ownerM, io: ioM });
t('summary reports points, level, fbt not-launched, missions, history', (() => {
  const s = summaryM;
  return s.points === 13
    && s.level.current.id === 'bronze'
    && s.fbt.market === 'not_launched'
    && Array.isArray(s.missions.today)
    && s.missions.today.find((m) => m.id === 'swap1')?.done === true
    && s.claim.status === 'NOT_LAUNCHED'
    && s.rank.available === false
    && s.history.length <= 25;
})());
t('summary utility rows are all NOT_LAUNCHED (backend runs none yet)', summaryM.utilities.length > 0 && summaryM.utilities.every((u) => u.launched === false));

/* bounded storage */
t('history is capped at 25 rows', kvM.kv.get(`ledger:${ownerM}`).history.length <= 25);
const kvSeen = makeKv();
const ioSeen = io(kvSeen);
const flood = Array.from({ length: 400 }, (_, i) => ({ id: `flood-${i}`, action: 'lab', at: now - i * 1000 }));
await engine.ingestEvents({ owner: 'dev:seen', events: flood, io: ioSeen, verify: okVerify });
t('the seen-set is capped (bounded storage)', (await kvSeen.getSeen('dev:seen')).length <= 300);
{
  const kvP = makeKv();
  const ioP = io(kvP);
  const events = Array.from({ length: 60 }, (_, i) => ({
    id: `old-${i}`, action: 'lab', at: now - (59 - i) * DAY
  }));
  await engine.ingestEvents({ owner: 'dev:prune', events, io: ioP, verify: okVerify });
  const ledgerP = await kvP.getLedger('dev:prune');
  t('day counters are pruned after 45 days', Object.keys(ledgerP.days).length <= 45);
}

/* ------------------------------ referral ---------------------------------- */

const signer = Wallet.createRandom();
const signer2 = Wallet.createRandom();
const kvRef = makeKv();
const ioRef = io(kvRef);
const ownerA = 'dev:ref-owner-a';
const bindMsg = `FBT Rewards referral code A7B9 for ${signer.address.toLowerCase()}`;

let bind = await engine.bindCode({ code: 'A7B9', wallet: signer.address, owner: ownerA, via: 'wallet', signature: '', message: bindMsg, io: ioRef });
t('a referral code binding without a signature is refused', bind.ok === false && bind.code === 'SIGNATURE_REQUIRED');

const sig = await signer.signMessage(bindMsg);
bind = await engine.bindCode({ code: 'A7B9', wallet: signer.address, owner: ownerA, via: 'wallet', signature: sig, message: bindMsg, io: ioRef });
t('a wallet-signature binding succeeds', bind.ok === true);

bind = await engine.bindCode({ code: 'A7B9', wallet: signer.address, owner: ownerA, via: 'wallet', signature: sig, message: bindMsg, io: ioRef });
t('binding the same code to the same owner is a duplicate, not a conflict', bind.ok === true && bind.duplicate === true);

const otherSig = await signer2.signMessage(`FBT Rewards referral code A7B9 for ${signer2.address.toLowerCase()}`);
bind = await engine.bindCode({ code: 'A7B9', wallet: signer2.address, owner: 'dev:thief', via: 'wallet', signature: otherSig, message: `FBT Rewards referral code A7B9 for ${signer2.address.toLowerCase()}`, io: ioRef });
t('a taken code cannot be squatted by another wallet', bind.ok === false && bind.code === 'CODE_TAKEN');

/* owner shares invite; invitee qualifies with a REAL verified swap */
const inviteeWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const inviteeEv = {
  id: 'inv-1', action: 'swap', wallet: inviteeWallet, chainId: 8453,
  txHash: `0x${'a'.repeat(64)}`, at: now, refCode: 'A7B9'
};
const rIng = await engine.ingestEvents({
  owner: 'dev:invitee-1', events: [inviteeEv], io: ioRef, verify: okVerify,
  opts: { onReferralOpportunity: (ctx) => engine.referralOpportunity({ ...ctx, io: ioRef }) }
});
const refLedger = await ioRef.getLedger(ownerA);
t('an invitee qualifying activity credits the code owner +250', (() => {
  const opp = rIng.results[0]?.referral;
  return opp?.credited === true && refLedger.points === 250 && refLedger.referrals === 1;
})());

/* the same invitee wallet qualifying again → duplicate, no double reward */
await engine.ingestEvents({
  owner: 'dev:invitee-1', events: [{ ...inviteeEv, id: 'inv-1b', txHash: `0x${'b'.repeat(64)}` }],
  io: ioRef, verify: okVerify,
  opts: { onReferralOpportunity: (ctx) => engine.referralOpportunity({ ...ctx, io: ioRef }) }
});
const refLedger1b = await ioRef.getLedger(ownerA);
t('a duplicate invitee wallet is never rewarded twice', refLedger1b.points === 250 && refLedger1b.referrals === 1);

/* self-referral via the OWNER's own wallet from another account */
const rSelfWallet = await engine.ingestEvents({
  owner: 'dev:other', events: [{ ...inviteeEv, id: 'inv-self-w', wallet: signer.address.toLowerCase(), txHash: `0x${'c'.repeat(64)}` }],
  io: ioRef, verify: okVerify,
  opts: { onReferralOpportunity: (ctx) => engine.referralOpportunity({ ...ctx, io: ioRef }) }
});
const ledgerAfterSelfWallet = await ioRef.getLedger(ownerA);
t('self-referral (the code owner\u2019s own wallet) is detected and refused', (() => {
  const opp = rSelfWallet.results[0]?.referral;
  return opp?.skipped === 'self-wallet' && ledgerAfterSelfWallet.points === 250;
})());

/* self-referral via the OWNER account itself */
const rSelf = await engine.ingestEvents({
  owner: ownerA, events: [{ ...inviteeEv, id: 'inv-self', wallet: signer2.address.toLowerCase(), txHash: `0x${'d'.repeat(64)}` }],
  io: ioRef, verify: okVerify,
  opts: { onReferralOpportunity: (ctx) => engine.referralOpportunity({ ...ctx, io: ioRef }) }
});
const ledgerAfterSelf = await ioRef.getLedger(ownerA);
t('self-referral (owner account) is detected and refused', (() => {
  const opp = rSelf.results[0]?.referral;
  return opp?.skipped === 'self' && ledgerAfterSelf.referrals === 1;
})());

/* ------------------------------ claim ------------------------------------- */

const kvC = makeKv();
const ioC = io(kvC);
const ownerC = 'dev:claim';
const claimCfg = {
  distributorChain: 8453,
  distributorAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
  tokenAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
  nonceTtlMs: 900000, maxPendingNonces: 10, cooldownMs: 86400000
};
let prep = await engine.prepareClaim({ owner: ownerC, wallet: signer.address, io: ioC });
t('claim prepare without a distributor contract is NOT_LAUNCHED', prep.ok === false && prep.code === 'FBT_TOKEN_NOT_LAUNCHED');

prep = await engine.prepareClaim({ owner: ownerC, wallet: signer.address, io: ioC, claimCfg });
t('claim prepare with a configured distributor issues a single-use nonce', prep.ok === true && prep.claim.nonce?.length === 48 && prep.claim.custodial === false);

let sim = await engine.simulateClaim({ owner: ownerC, wallet: signer.address, nonce: prep.claim.nonce, io: ioC, claimCfg });
t('claim simulate accepts the fresh nonce', sim.ok === true && sim.simulated.replayProtected === true);

sim = await engine.simulateClaim({ owner: ownerC, wallet: signer.address, nonce: prep.claim.nonce, io: ioC, claimCfg });
t('claim simulate refuses a replayed nonce', sim.ok === false && sim.code === 'UNKNOWN_NONCE');

prep = await engine.prepareClaim({ owner: ownerC, wallet: 'not-a-wallet', io: ioC, claimCfg });
t('claim prepare requires a real EVM wallet', prep.ok === false && prep.code === 'WALLET_REQUIRED');

/* ------------------------------ done --------------------------------------- */

/* Run directly or via run.mjs (same rows). */
const invokedDirectly = Boolean(process.argv?.[1] && process.argv[1].endsWith('rewards-engine-probe.mjs'));
if (invokedDirectly) {
  const fails = rows.filter(([, ok]) => !ok);
  for (const [name, ok] of rows) console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}`);
  console.log(`\npassed ${rows.length - fails.length}/${rows.length}`);
  process.exitCode = fails.length ? 1 : 0;
}

export default rows;
