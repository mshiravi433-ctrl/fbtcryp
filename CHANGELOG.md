## Unreleased — Intent OS Arc I (phases 95-100): governance and closing

- **95 — public Intent OS API.** `publicApi.js` opens the intent surface to
  third-party developers under exactly the internal rules. Every key is scoped
  at issue time and revocable instantly; `assertKeyUsable` refuses a revoked
  key on every path, so revocation is not a flag somebody can forget to check.
  `authorizeApiCall` refuses `intent.execute` and `intent.sign` outright with
  `EXECUTION_NEVER_DELEGATED` — a third party can prepare and read, never sign.
  `handleApiCall` strips `txHash`, `receipt` and `signature` from whatever a
  handler returns, so an integrator cannot manufacture a receipt through us.
- **96 — community parameter governance.** `paramGovernance.js` puts policy
  parameters (caps, fees) up for proposal and vote, with a 25-vote quorum and a
  60% approval threshold. What a vote can never do is remove a security proof:
  the phase-50 rules, the confirmation gate, simulation and the guardian are
  outside the governable set, and a proposal touching them is rejected before
  it is ever tallied. `GOVERNED_PARAMETERS.feeBps.max` is pinned to the same
  `FEE_BPS_MAX` the fee code enforces, so governance cannot vote past the cap.
- **97 — gradual autonomy.** `gradualAutonomy.js` moves a user L1 → L2 → L3 on
  their own confirmation history and demonstrated risk comprehension. Promotion
  is never automatic: it requires an explicit `userConfirmed` decision with a
  timestamp, levels cannot be skipped, and a cooldown separates them. Returning
  to L1 always works, immediately, and resets the cooldown — the way down is
  never harder than the way up.
- **98 — human oversight charter.** `humanOversight.js` gives every long-running
  program (DCA, goal) a mandatory periodic check-in. The three answers are
  continue, pause and stop. Silence past the grace window is not consent: the
  program auto-pauses and `mayRun` becomes false. A program nobody is watching
  stops on its own rather than running unattended.
- **99 — long-term survival.** `longTermSurvival.js` converts the phase-40
  one-year stability proof into conditions the product must actually meet:
  update path, key rotation, recovery drill, data portability and a named
  accountable owner. `rotateAndRevoke` proves the retired key is dead through
  the phase-68 `assertKeyUsable` tombstone path rather than asserting it.
- **100 — user sovereignty and closure.** `userSovereignty.js` makes leaving a
  first-class operation: a two-step exit with no fee, no cooling-off period and
  no retention hook, producing a portable `application/json` package of memory,
  history and settings. `verifyNoResidue` re-reads every store afterwards and
  the probe proves the exit path leaves nothing behind. `assertNoLockIn`
  refuses the patterns that make leaving expensive.

Arc I adds 420 probe checks (95 → 72, 96 → 81, 97 → 68, 98 → 63, 99 → 60,
100 → 76), registered in `test/run.mjs` and `npm run test:phases95-100`.

### UI wiring — five modules brought to the surface

156 intent-ai modules existed and 16 were reachable from the UI. Five that
change what the user sees are now wired, each with new checks in its own phase
probe rather than a separate test file:

- **Fee integrity (90) in the Intent AI panel.** The confirmation preview shows
  the fee percentage, the fee amount and the net amount, derived from the
  amount currently in the field so an edit moves the fee in the same render.
  The receipt restates the same fee. If the charged fee drifts from the quoted
  one beyond `FEE_TOLERANCE`, the flow halts with `TERMS_CHANGED` and asks for
  reauthorization instead of printing a success nobody agreed to.
- **Data lifecycle (92) in settings.** A "My data" section exports everything
  we hold or deletes it. Deletion sits behind an explicit confirmation dialog,
  and the proof receipt appears only after `verifyDeletion` has read every
  store back and found it empty; an unproven or partial deletion names what is
  left instead. `src/lib/userDataStores.js` maps the seven logical stores onto
  real localStorage keys and deliberately excludes the wallet vault — no
  settings button may destroy the only copy of somebody's keys.
- **Offline queue (94) in the panel and the service worker.** The panel shows
  real connection state and, offline, parks a confirmed intent as `queued`:
  no hash, no receipt, no authority, and no auto-send on reconnect. `sw.js`
  now consults a `cachePolicyFor` mirror before writing anything to the cache,
  so only public static routes are cached; the probe asserts the mirrored route
  list is byte-identical to `CACHEABLE_ROUTES`.
- **Fiat ramp boundary (88) in the panel.** A request about a bank, a card or a
  national currency that produces no crypto draft gets the plain answer: we do
  not move real money, here is what we can do instead. No hopeful link.
- **Regional compliance (87) in settings.** A "what is available in your region"
  map rendered from `availabilityMap`, every gated feature listed with its
  state and reason. The region is a locale hint, so an unrecognised one falls
  back to the strictest policy and says so.

Phase 93 accessibility is enforced on the new surfaces: real buttons with
visible labels, dialogs through `Sheet` (role, `aria-modal`, Escape), no
positive tabindex, no removed focus outlines, and region state exposed as data
rather than colour alone. Wiring added 61 checks across phases 87, 88, 90, 92,
93 and 94.

### Environment variable documentation

`.env.example` is rewritten from a source scan of every `VITE_*` read in `src`
and every `process.env.*` read in `server`, `api`, `scripts` and `ci` — 170
variables, grouped as required-for-activation, required-for-one-capability,
optional-with-a-default, and never-put-in-Vercel. Each carries a Persian line,
the real default read from the code with its file, and exactly which capability
turns off when it is empty. No real values; placeholders only. `docs/ENV-FA.md`
now points at it, references `scripts/validate-activation-env.mjs`, and lists
the three variables whose absence stops a script (`RPC_URL`, `CHAIN_ID`, and
`DEPLOYER_PRIVATE_KEY`/`DEPLOYER_KMS_KEY_ID`) — all three in local deploy
scripts, none in the app or server.

New copy is translated in English, Persian and Arabic. `npm run build` is clean
and the full suite is green.

## Unreleased — Intent OS Arc H (phases 90-94): product durability

- **90 — fee integrity.** `feeIntegrity.js` turns `VITE_FEE_BPS` into a fee the
  user can check: every quote carries its basis points, its amount, its net
  amount and the formula that produced them. Quoted must equal charged — any
  drift stops the flow as `TERMS_CHANGED` instead of silently taking more. Fee
  accounting counts only fees on confirmed receipts with a real transaction
  hash; anything pending, unhashed or undisclosed is excluded by name, and an
  accounting with exclusions reports itself as partial rather than complete.
- **91 — plan governance.** `planGovernance.js` states the rule in code: a plan
  buys analysis, never permission. Entitlements are drawn from an analytical
  list only; a forbidden list (higher caps, skipping the confirmation gate,
  skipping simulation, bypassing the guardian, L3 autonomy, longer session
  keys) is refused on every tier including the most expensive one. The
  execution policy is read from the session and is byte-identical across free,
  plus and pro. The probe asserts the claim "a more expensive plan grants more
  authority" fails, for every forbidden entitlement.
- **92 — data lifecycle.** `dataLifecycle.js` makes export and erasure real
  operations with evidence. Export enumerates every store, scrubs anything
  key-like, and refuses to hand over a partial file dressed up as everything.
  Deletion needs an explicit confirmation, runs across all seven stores, and is
  then verified by reading each store back; leftovers and unverifiable stores
  are named, and only a fully verified run produces a proof receipt.
- **93 — accessibility.** `accessibilityAudit.js` adds an automated a11y probe:
  WCAG contrast computed rather than eyeballed, accessible names required for
  every interactive control, icon-only buttons required to carry `aria-label`,
  clickable non-buttons flagged as mouse-only, and dialogs checked for role,
  name, focus trapping, focus restoration and Escape. The probe also scans the
  real Intent AI panel source — every control is a native focusable element,
  every `aria-label` comes from i18n, no positive tabindex, no removed focus
  outlines, and the modal is a named, modal dialog.
- **94 — offline-first.** `offlineQueue.js` keeps public pages available from
  cache (never personal or price-bearing routes) and lets a confirmed intent
  wait for the network. Queuing is not executing: a queued item has no
  transaction hash, no receipt, no execution authority, and it expires. On
  reconnect every item is re-diffed against current terms, and anything that
  moved goes back to the user for a fresh confirmation instead of being sent.

Arc H adds 252 probe checks (90 → 47, 91 → 45, 92 → 44, 93 → 58, 94 → 58),
registered in `test/run.mjs` and `npm run test:phases90-94`. New copy is
translated in English, Persian and Arabic. `npm run build` is clean and the
full suite is green.

## Unreleased — Intent OS Arc G (phases 85-89): scale and globalisation

- **85 — multi-region edge, product level.** `regionalEdge.js` measures the
  latency the user actually experiences and reports percentiles from real
  samples. Fewer than five fresh samples is "unknown", never a comforting
  default; a slow or erroring region is drained; a failover is announced to the
  user with its reason instead of happening silently; and zero healthy regions
  is an honest "no region available".
- **86 — parser language parity.** The UI shipped twelve languages while the
  intent box understood three. `parserLocales.js` canonicalises an utterance in
  any of the twelve into the vocabulary `intentParser.js` already knows:
  Persian, Arabic-Indic and Devanagari digits become ASCII, action verbs, chain
  names and connectors are mapped per language, and every substitution is
  recorded so an audit can see nothing was invented. A language with no lexicon
  hands over to the guided flow rather than guessing an English word out of a
  foreign sentence. The probe asserts each of the twelve separately.
- **87 — regional compliance gate.** `regionalCompliance.js` gates features by
  region and wires that to the phase-36 legal hold. An unknown region gets the
  STRICTEST policy, a legal hold overrides every allow and is explained rather
  than hidden behind a disabled button, the availability map is complete and
  user-visible, and `assertGateOnlyRestricts()` proves geo-gating can only
  subtract features, never grant one.
- **88 — honest fiat ramp boundary.** `fiatRampBoundary.js` detects a fiat
  request — card, wire, IBAN, "cash out", a fiat currency symbol — and answers
  plainly that this app only swaps crypto you already hold, offering what we DO
  support instead of a dead end. Routes that need a ramp are removed, a
  third-party provider is only shown when explicitly configured over https and
  is labelled as somebody else's service, and `assertNoRampPromise()` blocks
  any copy that implies we touch a bank account.
- **89 — chaos testing for the intent plane.** `intentChaos.js` injects ten
  faults — RPC down, dead feed, disconnected wallet, quote timeout, missing
  receipt, revoked session key, corrupt storage and more — and demands exactly
  one outcome from each: honest-unavailable. A crash, a fabricated COMPLETED
  receipt, an invented price, a silent authorization or an untranslated message
  all fail the drill, one failure fails the whole drill, and a partial run is
  never reported as a pass.
- Probes `phase85`-`phase89` (224 checks) cover measured latency, all twelve
  parser languages, unknown-region strictness, the ramp refusal and every fault
  drill; en/fa/ar copy added for every new string.

## Unreleased — Intent OS Arc D (phases 69-74): the agent ecosystem at scale

- **69 — agent protocol v2.** `agentHandshake.js` replaces "we list this agent"
  with a real, signed, versioned handshake: fresh nonce, echoed nonce, highest
  common version or no session at all. An unsigned message is rejected
  fail-closed — not accepted with a warning — as are forged signatures,
  tampered payloads, replayed nonces, stale timestamps and unknown versions. A
  session carries only capabilities we chose to grant, expires, and
  `executionAuthorized` is false by construction.
- **70 — agent payment rail with escrow.** `agentEscrow.js` holds the fee. The
  buyer funds it explicitly; the agent claiming "done" releases nothing.
  Release requires a delivery receipt issued by someone other than the agent,
  matching the hash of what was agreed. A dispute freezes the funds and
  defaults to refunding the buyer — including when a release is requested with
  insufficient evidence — an undelivered escrow refunds when the window ends,
  and `assertEscrowSound()` keeps funded = released + refunded + held.
- **71 — real agent sandbox.** `agentSandboxRuntime.js` runs external agents
  behind capability tokens minted from a closed list; `sign`, `submit`,
  `transfer` and `*` are refused at mint time. Every call is checked before it
  happens, including the host on a fetch. The first escape ends the run: the
  remaining calls never execute, an incident is recorded and the agent is cut
  automatically until a human reinstates it. An agent that returns
  `executionAuthorized: true` is itself treated as an escape.
- **72 — agent dispute resolution.** `agentDispute.js` gives a score somewhere
  to be contested. Scores start provisional with a stated appeal window; an
  agent appeals with evidence; a decision taken without reviewed evidence
  finalises nothing. Slashing is transparent, capped at half the stake, tied to
  an appealable case and time-limited — `assertDueProcess()` rejects a penalty
  that is secret, uncapped, caseless or permanent.
- **73 — live venue federation.** `liveVenueRouting.js` probes venues in
  parallel with a deadline and timestamps every answer. Dead, degraded,
  unknown and stale venues are removed from routing rather than ranked last,
  quotes that cannot carry the order are not candidates, and when nothing is
  routable the answer is an honest "no venue" instead of a remembered one.
- **74 — live marketplace.** `liveMarketplace.js` computes real supply and
  demand. An agent is only suggested with enough recent jobs in that exact
  capability, each attested by somebody other than itself; unproven, suspended
  and at-capacity agents are absent from the list rather than ranked low, and
  an empty market says so instead of padding.
- Probes `phase69`-`phase74` (323 checks) cover unsigned-message rejection,
  escrow proof-of-delivery, sandbox escapes, due process, dead-venue removal
  and unproven-agent exclusion; en/fa/ar copy added for every new string.

## Unreleased — Intent OS Arc E (phases 75-79): trust and proof

- **75 — on-chain receipt.** `onchainReceipt.js` commits a hash of the agreed
  terms and the observed outcome to a chain, so a receipt stops being this
  app's word about itself. Only hashes travel — never the terms, never an
  address — and receipts are Merkle-batched so one transaction anchors many
  and gas never prices honesty out of the product. A submitted anchor is
  `pending`, not `anchored`: the verification link appears only once there is a
  mined transaction. `verifyAgainstAnchor()` recomputes the leaf from the
  receipt on screen, so a receipt altered after the fact fails to verify.
- **76 — user-visible audit timeline.** `auditTimeline.js` turns the
  append-only `audit.js` log into something a person reads: one translatable
  row per event, grouped and newest-first. Own events only — an entry with
  another owner, or with no owner at all, is dropped rather than assumed, and
  the count of what was withheld is stated out loud. `assertAppendOnly()`
  catches a removed or rewritten entry, and `assertTimelineSafe()` refuses to
  render duplicates, foreign rows, raw prose or a leaked address.
- **77 — human-readable terms diff.** `termsDiff.js` replaces "termsHash
  changed" with "amount changed from 100 to 500": every change becomes a row
  with field, before, after, direction and percentage, expressed as i18n keys
  so translators write the sentence. Anything that moves money, risk or
  destination is MATERIAL and forces a fresh confirmation; an unknown field is
  material too, because fail-closed. A hash that moved with no visible diff
  stops execution rather than being waved through.
- **78 — independent third-party verification.** `thirdPartyVerification.js`
  publishes a hashes-only packet to the phase-29 assurance network. Quorum is
  two *independent* operators — the same operator answering twice is one voice
  — and a single disagreement makes the whole result `disputed`; majority does
  not win when the question is whether something happened. Verifiers that
  throw, time out or answer about a different receipt are discarded, never
  counted as agreement, and `assertVerificationHonest()` gates the badge.
- **79 — bug bounty and disclosure policy.** `bugBounty.js` publishes a
  machine-readable policy on top of `phase35PublicDisclosure.js`: explicit safe
  harbour, published scope, banded and capped rewards, and stated acknowledge,
  triage and fix windows. Rewards are discretionary thank-yous —
  `financialLiabilityAccepted` and `compensatesLosses` are false by
  construction and `assertNoLiabilityPromise()` blocks any document that flips
  them. Coordinated disclosure publishes either way: fixed, or after the
  window with exploit details withheld.
- Probes `phase75`-`phase79` (248 checks) cover anchoring, timeline ownership,
  material diffs, verifier quorum and the liability guard; en/fa/ar copy added
  for every new string.

## Unreleased — Intent OS Arc C (phases 63-68): the user and their memory

- **63 — session persistence.** `sessionPersistence.js` saves and restores a
  session client-side under PBKDF2 + AES-GCM. Secrets are stripped before the
  snapshot is built, a STOPPED session and its permissions come back exactly as
  they were, and any failure — wrong passphrase, corrupt blob, stale snapshot —
  is a clean start with a translatable notice, never a crash and never an
  escalation of what the user had authorised.
- **64 — cross-device continuity.** `crossDeviceContinuity.js` links a session
  to the existing Telegram login, so the work resumes on a second device — but
  authority does not travel. Session keys, signatures, gate decisions,
  confirmations and approvals are stripped from the handoff and re-taken on the
  new device; the handoff expires in ten minutes and is single-use.
- **65 — portfolio and history from receipts.** `portfolioLedger.js` builds
  positions only from confirmed receipts that carry a real transaction hash.
  Pending, submitted and failed appear as themselves and never move a balance;
  a confirmed receipt without proof is excluded and the view reports itself
  incomplete rather than quietly totalling less than the truth.
- **66 — consented memory.** `consentedMemory.js` keeps `adaptiveMemory.js`
  across sessions only with dated, scoped, revocable opt-in. Off means nothing
  is produced at all — not stored-then-hidden — export hands everything back or
  refuses, and a revoke that could not wipe is reported as a failed revoke.
- **67 — notification and handing control back.** `intentNotifications.js`
  delivers completion, failure and re-authorization over web-push, Telegram or
  in-app. An authorization request always carries a deadline, and a lapsed
  deadline HALTS: silence is never a yes. A user who could not be reached on
  any channel stops a long-running program.
- **68 — access recovery.** `accessRecovery.js` lets a proven identity revoke
  keys from another device. Tombstones are frozen and permanent, they kill
  every key issued before them — including one a stale client still holds — and
  `assertNothingSurvives()` proves that after a revoke, nothing works.
- Probes `phase63`-`phase68` (256 checks) cover restore-from-corrupt, authority
  stripping, receipt-only ledgers, memory-off, authorization timeouts and
  post-revoke key death; en/fa/ar copy added for every new string.

## Unreleased — Intent OS Arc F (phases 80-84): product risk and security

- **80 — real-time risk engine.** `adaptiveRisk.js` makes the ceilings a
  function of the market that is actually happening: realised volatility picks
  a tier, and each tier tightens the slippage cap and the position size. The
  factors are all ≤ 1, so the engine can only ratchet DOWN — never above the
  session policy — and unknown or stale volatility selects the STRICTEST tier,
  because not knowing is the riskiest state. Every adjustment is recorded with
  the number that caused it, its source, its observation time and a
  translatable reason.
- **81 — asset screening.** A ticker is not an asset. `assetScreening.js` runs
  before a quote is offered: a contract wearing a known symbol at the wrong
  address is a hard reject naming both addresses, as are blocklisted
  contracts, honeypots and pools that cannot fill the size. A token on no list
  is not waved through either — it needs an explicit acknowledgement, and
  acknowledging never overrides a hard reject.
- **82 — address poisoning shield.** `addressShield.js` compares the head and
  tail a human actually reads: an address that mimics one in your history, or
  that only ever arrived as dust, blocks the send outright with both addresses
  shown in full. A never-paid address gets its own confirmation, separate from
  the transaction confirmation and reset whenever the address changes. Wired
  into `SendSheet` with `sendHistory.js` as the local counterparty record; the
  gate is re-asserted at send time, not only in the button's disabled state.
- **83 — approval hygiene.** `approvalHygiene.js` plus the new `TokenApprovals`
  panel answer "what did I allow, and to whom?" with real addresses, real
  exposure and a revoke path. Swaps ask for the minimum allowance that covers
  the trade — `assertNoUnlimitedApproval()` refuses `MaxUint256` and anything
  unlimited in practice — an existing unlimited approval is flagged for
  replacement rather than accepted as "already fine", and an allowance that
  could not be read is reported as unreadable, never as zero.
- **84 — simulation before signature.** `simulationGate.js` makes the phase-24
  simulator a precondition of signing. A detected revert means no signature
  request at all, plus the decoded reason in the user's language. A missing,
  busy or throwing provider is `unavailable` — which is not clean: continuing
  needs an explicit user override that is recorded and never claims the
  transaction is proven safe. Each result is bound to the exact transaction it
  ran, so changing the calldata, value, sender or chain invalidates it.
- Probes `phase80`–`phase84` (261 checks) registered in the aggregate runner;
  `npm run build` clean and `npm test` fully green.
- Hardened the shared numeric helper across all Arc B and Arc F modules:
  `Number(null) === 0`, so an absent value is now rejected before the finite
  check instead of silently reading as zero.

## Unreleased — Intent OS Arc B (phases 58-62): real market data

- **58 — live market regime.** `liveMarketRegime.js` builds the Spec-65
  regime detector's evidence from real price series instead of a hand-written
  array: trend, volatility and liquidity are computed from the actual points,
  every answer carries its source, its observation time and its sample size,
  and points older than the window are excluded rather than smoothed over. A
  dead feed is `dataStatus: 'unavailable'` — never a remembered regime.
- **59 — price alert to intent proposal.** A triggered alert can now produce
  exactly one thing: a proposal (`alertProposals.js`) carrying
  `executionAuthorized: false` and `requiresConfirmationScreen: true`.
  Accepting it returns an *utterance* that goes back through the normal
  chat → draft → confirmation-gate pipeline; there is no function in the
  module that submits or signs. A stale or unsourced price produces an honest
  "unavailable" notice instead of a proposal.
- **60 — explainable analysis on real data.** `liveWhy.js` screens every data
  point before it is allowed to support an answer: no source, no timestamp, no
  number, or too old means dropped and counted. With nothing checkable left,
  the recommendation is not made at all. What survives is handed to the
  existing `whyThisDecision()`, so each figure in the reply can be traced to a
  source, a time and a value.
- **61 — real goal progress.** `liveGoalProgress.js` values real holdings at
  real prices and turns that into the *attested* balance the goal engine
  requires. `GoalCountdown` now renders an actual progress bar from it — and
  when the valuation cannot be attested it renders an explicit "progress
  unknown" state, never a bar sitting at 0% that would read as "no progress".
- **62 — honest backtest.** `honestBacktest.js` runs a strategy over real
  history with no look-ahead (the decision for bar *i* only ever sees bars
  ≤ *i*, and `assertNoLookAhead()` proves it by replaying against a truncated
  series). Fees and slippage are applied to every simulated fill and disclosed
  separately. Every result is labelled `SIMULATION`, carries its window, its
  source and three disclosures, and `futureReturnClaim` is always false.
- Probes `phase58`–`phase62` (213 checks) registered in the aggregate runner;
  `npm run build` clean and `npm test` fully green.

## Unreleased — Intent OS Arc A (phases 51-57): real execution

- **51 — real wallet signing.** A connected wallet is now the signer.
  `walletRuntime.js` asks the real EIP-1193 wallet to sign the locked terms
  (`eth_signTypedData_v4`, `personal_sign` fallback) and hands that signature
  to the existing synchronous pipeline; `WalletContext` exposes the raw
  provider through `getWalletRuntime()` and the new `IntentAIRoute` wrapper
  passes it to the panel (which stays free of wallet-library imports so the
  suite can still mount it headless). The stub signer is now test-only:
  `stubSignerAllowed()` is false in any browser-like runtime, so a real user
  can never receive a stub signature dressed up as an execution. `venueHealth`
  no longer reports NO_SIGNER/NO_PROVIDER against a wallet that is connected.
- **52 — live rate and slippage re-check.** `liveQuote.js` takes a real,
  sourced, non-stale quote, freezes it into the locked terms, and re-checks it
  at the instant of the final confirm. An adverse move past the slippage limit
  is refused and routed back through the EXISTING Confirmation Gate as
  REAUTHORIZE; a favourable move never blocks.
- **53 — real broadcast and tracking.** `broadcastAdapter.js` only reports
  `submitted` with a real 32-byte transaction hash and only `confirmed` with a
  real receipt and enough confirmations counted from the chain head. A dead RPC
  leaves the transaction at `submitted`; a revert is `failed`. COMPLETED is
  never fabricated, and the hash now appears on the receipt.
- **54 — bridge execution.** `bridgeExecution.js` is the real adapter seam:
  `BRIDGE_EXECUTE_UNAVAILABLE` disappears only when an adapter with `execute`
  is actually attached, a bridge never rides on the swap step's approval
  (its approval is scoped `bridge` and bound to the bridge terms hash), and
  source-chain submission is never reported as destination-chain delivery.
- **55 — MEV and slippage shield.** Every transaction now carries an explicit
  deadline, an explicit slippage ceiling (policy can only tighten it; a hard
  cap bounds everything), a derived `minAmountOut`, and a declared submission
  channel with real private-relay support. `assertProtected()` runs
  fail-closed immediately before signing.
- **56 — receipt error taxonomy (the reported bug).** Every execution failure
  used to collapse into "Unavailable — no live venue".
  `executionErrorTaxonomy.js` maps Guardian reasons, permission errors,
  emergency stops, dead feeds and reverts onto their own translatable receipt
  lines, and the interactive confirmation screen now shows the ACTIVE SESSION
  POLICY ceilings under the fields next to the product ceilings, locking the
  final confirm on a breach. Reproduction now proven in the panel probe: a
  $100 swap edited to $500 (under the $5k product cap, over the $200 L3 policy
  cap) says «above the session policy limit of $200», not «no live venue».
- **57 — live DCA.** `liveDcaTrigger.js` turns the Phase-13 recurring
  lifecycle into a real trigger: every run needs a prior explicit, bounded
  authorization plus a policy re-check AT TRIGGER TIME, and the first
  violation halts the whole program with a translated user notice — there is
  no "skip and continue", and a halted program never resumes on its own.
- Tests: seven new probes (`test/intent-ai/phase51..57-*.mjs`, 156 checks)
  registered in `test/run.mjs` and as `npm run test:phaseNN`, plus three new
  interaction checks in the panel probe. All new user-facing copy is en/fa/ar
  only through i18n keys.

## Unreleased — Intent AI panel: glass session controls, live mode cards, en↔fa sync

- Reported: «شکل بعضی از دکمه‌ها مثل توقف/توقف موقت/قطع اتصال/لغو مجوز/
  خروج اضطراری خرابه — شیشه‌ای نیست و ریلی هم نیست»، «فیلد حرف زدن با
  ایجنت سایزش بده» و «انگلیسی و فارسی سینک نیست».
- ROOT CAUSE (buttons and chat field): the panel used the global `.btn`
  class inside plain `.row` flex containers. `.btn` is `width: 100%` — the
  exact trap documented on `.btn-row` in index.css — so each of the five
  session controls claimed the full row as its flex-basis and rendered as
  stacked full-width bars, while in the composer the Send and Stop buttons
  squeezed the chat input to nothing. A bare `.btn` also carries no
  background at all, so every control was invisible glass-less text.
- The panel now has its own scoped control set in `intent-os.css`: `.ia-ctl`
  glass buttons sized to content (`flex: 0 1 auto`), with severity variants —
  danger (STOP, EMERGENCY EXIT), warn (PAUSE), cool (REVOKE, DISCONNECT) and
  go (confirm actions) — each a layered translucent gradient + 16px backdrop
  blur + inner highlight, with full light-theme counterparts. The composer is
  `.ia-composer`: the chat input takes the free space first, Send/Stop size
  to content. The policy-settings `.field` labels finally have a layout
  (the class had no definition anywhere in the app).
- The three primary modes (HUMAN ↔ AI, AI ↔ AI INSIDE FBT, FBT AI ↔ EXTERNAL
  AI AGENT) are no longer text-only chips: each mode card carries its real
  participants from `MODE_DEFINITIONS`, and a live mode card shows the active
  session's participants plus — in external mode — the actual discovery
  result from the server catalog, moved out of the collapsed details block
  into view with compatible/incompatible, score-or-withheld and trust status
  badges. Discovery still grants no permission; every boundary is unchanged.
- Language sync: the eleven `intentOS.*` keys that existed only in English
  (the whole execution-policy block, the confirm sheet and the launch banner)
  are now translated in fa, and the missing `intentAI.authorization`,
  `mode.boundary`, `external`, `capabilities`, `controls` and `msg.*` groups
  are filled in ar. en↔fa key parity on these screens is asserted in the
  wiring tests (which also un-broke the pre-existing "static t() key exists
  in en.json" failure for `intentOS.launchBanner.*`).

## Unreleased — Intent AI Spec 65 Gap-Fill: every incomplete 65-item contract, fail-closed

- Filled the remaining gaps of the 65-item Intent AI specification with 21 new
  fail-closed contracts in `src/lib/intent-ai/`, all exported from `index.js`
  and all carrying `noExecutionPermission`. Nothing new claims live,
  production, ready or verified status; the Phase 21–50 control plane gained
  no new phase.
- Priority 1: `goalNegotiation` (unrealistic goals get reasons + Keep/Reduce/
  Extend, acceptance never authorizes), `costToGoal` + `predictNetOutcome`
  (unknown costs are unavailable, never zero; net is a lower bound),
  `whyTransparency` (Why-This-Decision with no unevidenced "better", and
  Why-This-Permission whose decline is a safe replan, not a dead end or an
  auto-enable), `shadowExecution` (attested paper sandbox; timeout ≠ quote;
  paper-passed ≠ live-ready; real execution still needs the full gate chain).
- Priority 2: capability catalog completed (RWA/Payment/P2P/Shop/Risk-Engine
  added, honestly not-implemented), `scanSummary`/`assertScanBeforeStart`
  (scan ≠ activation), `capabilityActivation` (one click = permission request;
  Activate stays pending-evidence without operational proof),
  `discoverForCapability` (listing ≠ permission ≠ execution), `autoRevoke`
  (intent end sweeps dYdX/external/smart-wallet grants; permanent access is a
  violation).
- Priority 3: `specialistAgents` — explicit input/output/cannot-execute
  contracts for all 15 roles (only Strategy and Execution are internal-real
  engines), council quorum for important trades, voting thresholds with a
  hard Guardian veto; the council can still only recommend the authorization
  screen.
- Priority 4: honest adapters — `marketRegime` (no evidence → unavailable),
  `eventRiskAdapter` (unverified sources can only raise risk; high risk only
  lowers confidence), `smartMoneyAdapter` (existing whale panel payload →
  strategy evidence, no fabricated numbers), `confidenceDecay` (stale data
  blocks execution).
- Priority 5–6: `parallelStrategies` (fail-closed policy compatibility),
  `goalProgress` (attested balance or null) + `buildGoalTree` (tree ≠
  execution), `intentOptimizer` + `suggestIntentOptions` (futures off without
  explicit opt-in; suggestions never activate), `chatReplay` (structured
  events only; private chain-of-thought dropped), `disasterMode` +
  `smartPause` (evidenced defensive posture; pause ≠ permission to continue),
  `dynamicRouteSwitch` (material delta mid-execution requires
  re-authorization).
- Priority 7–8: `agentReputation` + `agentLeaderboard` + appreciation
  (observed-only, insufficient_data on thin samples, Guardian-blind),
  `personalityLayer` + `agentAvatar` (tone and visuals only; exported
  `personalityCannotChangeRisk` proof helper), `agentProtocol` envelope +
  passport completeness gate + multi-agent chain (any link halts, no link
  signs), `agentPayment` (withdrawal cap enforced; displayed fee ≠ paid),
  `agentLearningExchange` (opt-in, structured, local-only, no chat text).
- Six new probes (`npm run test:spec65`, 170 assertions) prove the required
  invariants: paper≠live, score without evidence stays null, council cannot
  execute, personality cannot change risk, decline causes a safe replan, and
  the scheduler prepares but never signs. Phase 2–50 + phase-status probes
  still pass.
- Intent OS now shows the contractual launch banner (from `LAUNCH_BANNER`)
  as a permanent honest status strip; no green execution button was added.
  Docs: `docs/INTENT-AI-SPEC65-GAPS-FA.md`.

## Unreleased — Intent AI Phase 8: production activation and Secret Manager boundary

- Added `GET /api/intents/v1/activation`, a public, cacheable report that keeps
  implementation, adapter wiring, runtime configuration and operational proof
  separate. It confirms phases 1–7 are complete without claiming phases 9–20
  are done.
- Added the server-only `intentSecretManager` boundary. It stores only scoped
  opaque-handle metadata, refuses raw secret-shaped fields, requires an
  injected provider with durable and attested health, and exposes secrets only
  inside an internal callback. The default is unavailable; no env flag can
  manufacture a green KMS status.
- Added a read-only activation client and a localized Phase 8 status line in
  the Intent AI panel. `en`, `fa` and `ar` remain key-parity checked.
- Added `docs/INTENT-AI-PHASE8-FA.md` and
  `docs/INTENT-AI-ROADMAP-8-20-FA.md`. Phases 9–20 are defined, not falsely
  marked complete. The Phase 8 boundary probe is part of `npm test`.

## Unreleased — Solana route moves to De¹ Enterprise (the rebranded OpenOcean)

- Production was earning nothing on Solana and looked healthy while doing it.
  `/api/solana/oo/status` reported `keyConfigured: true, feeReady: true`, but
  a real quote through `/api/solana/oo/quote` (SOL→USDC, 0.01 SOL) came back
  `{"error":"UPSTREAM_FAILED","detail":"<!DOCTYPE html>…<title>Just a
  moment...</title>…"}` — a Cloudflare interstitial served to our serverless
  egress by `open-api.openocean.finance`, not an API answer. Every Solana
  swap was therefore falling through to the fee-less Jupiter fallback. The
  same URL answers a normal v4 body from a residential IP, which is why the
  status endpoint never noticed.
- OpenOcean has rebranded to **De¹ Exchange**; `docs.de1.exchange` documents
  the identical v4 contract (same paths, same `amountDecimals`, same
  `referrer` / `referrerFee`, same documented 20% provider share). The Solana
  path in `server/solanaOcean.js` now calls the enterprise gateway issued by
  the `enterprise.de1.exchange` dashboard,
  `https://open-api-enterprise.de1.exchange/v4/solana`, overridable with the
  non-secret `OPENOCEAN_BASE_URL`. The fee wallet, the 70 bps rate, the
  server-side-only fee fields, the `feeRatio` echo check and the Jupiter
  fallback are all untouched.
- The gateway authenticates rather than IP-challenges, verified against the
  live host: no key → `No API key found in request.`, wrong key →
  `Unauthorized.`. Neither is a v4 body, so both are classified UPSTREAM_FAILED
  and the swap screen falls back to Jupiter exactly as it does on a timeout —
  a missing key costs us the fee, never the user's trade. The key travels as
  the documented `x-api-key` header **and** as the `apikey` query parameter,
  which is the form proven to reach this gateway's authenticator.
- `/api/solana/oo/status` now reports `endpoint` (and `brand: "de1"`), so a
  host change or a rollback is visible in one field instead of only in a
  failing quote — the exact blind spot that hid this bug. It contains no
  secret; the key is still server-side only, never echoed, with no VITE_ twin.
- The EVM paths (`server/swapProxy.js`, `src/lib/openocean.js`) deliberately
  stay on the old host: the enterprise gateway could not be exercised for EVM
  slugs without spending the production key, and the browser client has no key
  to send. They keep their KyberSwap/Velora competition, so an OpenOcean miss
  there costs a second opinion, not a swap.
- `test/solana-price-probe.mjs` now stubs the enterprise host and fails if a
  call ever goes back to the challenged public domain, asserts the key travels
  in both forms keyed and in neither form keyless, and pins the new `endpoint`
  field. `.env.example` documents De¹, the dashboard, and the new base URL knob
  without carrying any value.

## Unreleased — Solana price fixed for real: parsing what Jupiter actually answers

- Reported «قیمت در سولنا نشان داده نمیشود — مشکل باقی مانده» AFTER the
  OpenOcean→Jupiter fallback shipped: the fallback was live and Jupiter was
  answering (measured through our own keyless proxy: 1 SOL ≈ 94.18 USDC),
  but the screen threw NO_ROUTE on every healthy answer. Jupiter's V2
  `/order` responds FLAT — `outAmount`, `otherAmountThreshold` and
  `priceImpactPct` at the top level, next to `transaction` — while the
  client read `jo.quote.outAmount`, a nested shape that only ever existed
  in the test stubs. `orderQuote()` in `src/lib/solana.js` now reads the
  real shape (and tolerates the legacy nested one), and the Solana swap
  screen and its transaction builder both parse through it.
- Same family of bug, caught alongside: `/execute` returns the on-chain
  signature in the documented `signature` field, not `transaction`; reading
  the invented field reported SEND_FAILED for swaps that had already
  landed. `executeSignature()` reads the documented field, both names
  accepted.
- The probes (`test/solana-price-probe.mjs`, `test/solana-client-probe.mjs`)
  stubbed the fabricated shapes and were the reason this survived its own
  fix — code and tests agreed with each other, not with the API. Their
  Jupiter payloads now match the live V2 contract, verified against a real
  keyless call and Jupiter's order-and-execute docs, and lock the flat
  parse end to end.
- `docs/SOLANA-PRICE-BUG-FA.md` gains the second-bug walkthrough, and its
  verify link moves off the retired lawpoetics.ir host to fbtswap.ir.

## Unreleased — Ready to switch on: paging, reviewer setup path, go-live runbook

- Catalog tabs page through the registry with the server's cursor instead of
  showing only the first twenty rows; a failed page keeps what is already on
  screen and says so.
- An operator can now actually turn certification on. `GET /api/ecosystem/certifier`
  returns the caller's OWN Telegram id (and only theirs), and the Developers
  page renders the exact `ECOSYSTEM_CERTIFIERS=<id>:Label` line to paste when
  no reviewer is configured — the one question an empty catalog would
  otherwise turn into a bug report.
- `docs/ECOSYSTEM-GO-LIVE-FA.md`: the five-minute runbook from `curl
  /api/ecosystem/status` to a published, certified listing, with the error
  table for every refusal the registry can answer with.

## Unreleased — Machine-readable contract, write rate limit, checkable evidence

- `GET /api/openapi.json` describes the ecosystem/developer/trust surface in
  OpenAPI 3.1, including an `x-fbt-boundary` block that states in the contract
  itself that nothing can sign, execute, settle or withdraw, and the live
  configuration of the deployment answering. Market-data routes are
  deliberately excluded rather than documented into fiction, and the probe
  calls every documented path so the spec cannot advertise a missing endpoint.
- Registry writes got their own budget (`ECOSYSTEM_WRITE_RATE_LIMIT`, 12/min,
  keyed by identity then IP) with a named, retryable 429; reads are untouched.
- Catalog cards can now show the evidence behind a badge: issuer, dates,
  status and the artefact (https link or sha256 digest), read from the public
  certification endpoint. Links are re-proved https client-side before they
  are rendered.
- Fixed a real flake in the pre-existing intent API probe: it built an account
  binding from its own clock while the wallet had signed the server's
  challenge, so the proof failed whenever a second ticked between them. It now
  echoes the challenge back, which is what a real client must do anyway.

## Unreleased — Developer and reviewer consoles, registry operations

- The registry stopped being curl-only. `src/components/DeveloperConsole.jsx`
  creates real server-side projects and API keys (secret shown once, in
  memory), lists the owner's drafts/submissions/published listings with the
  reason a published one is invisible, and drives the lifecycle through the
  server's state machine. There is no run, sign or execute control.
- `src/components/ReviewerConsole.jsx` renders only for accounts in
  `ECOSYSTEM_CERTIFIERS` (checked again on every write server-side): a review
  queue that deliberately does not say who submitted a listing, certification
  issuing with checkable evidence, and revocation.
- New endpoints: `GET /api/ecosystem/certifier`, `GET /api/ecosystem/review/queue`
  (reviewer-only) and public `GET /api/ecosystem/status` with per-state listing
  counts, active certification count and the configuration flags that explain
  an empty catalog. `/api/health` gained a config-only `ecosystem` block.
- The existing daily cron now sweeps expired certifications into storage and
  rebuilds the reputation snapshot, so no visitor pays for a thirty-bucket
  walk on the request path. Both are settled and cannot break notifications.
- Client auth has one home: `src/lib/telegramSession.js` sends the signed
  `initData` and never `initDataUnsafe`; with no session the console asks the
  user to open Telegram instead of firing requests that would 401.
- Console strings added to en, fa and ar.

## Unreleased — Registry lifecycle, real API keys, certification and observed reputation

- Listings gained a lifecycle (`draft → submitted → published → revoked`,
  plus `draft → deleted` and `revoked → draft`). Only the owner moves an
  entry, only `published` rows can reach the public catalog, nothing is
  hard-deleted, and editing a published or revoked entry is refused rather
  than silently changing what a reviewer certified.
- Developer API keys are verified for the first time: a hash → owner index,
  `authenticateApiKey()`, throttled `lastUsedAt`, and revocation that takes
  effect. `Authorization: Bearer fbt_sandbox_…` authenticates as the same
  owner and no more; every state-changing route requires the new
  `manage_listings` scope. No scope can sign, execute, settle or withdraw.
- Certifications (`ecosystem-certifications:v1`) are the only source of a
  verified badge. They are issued only by accounts in `ECOSYSTEM_CERTIFIERS`,
  store the reviewer's public label rather than their account id, and require
  evidence that is an https link or a sha256 digest. Publishing requires an
  active certification, and the catalog re-checks it on every read, so
  revoking a certificate removes the listing immediately.
- `GET /api/reputation/:id` is no longer a stub: it aggregates the existing
  opt-in, bucketed execution observations. No endpoint accepts a reputation;
  under five decided samples the count and rate are null; no address, tx hash
  or identity is stored or exposed.
- `GET/POST /api/portfolio/agent` stores an approval-only allocation target
  with no scheduler, job or signer able to act on it.
- Intent OS cards show the certifying reviewer's name or stay unverified, and
  an observed success rate only when there is enough of it (en/fa/ar).
- No automatic execution, custody, RFQ settlement or mainnet onboarding was
  added; stage 5 (real agent execution) remains deliberately out of scope.

## Unreleased — Authenticated ecosystem registry (agents / strategies)

The Agent and Strategy catalogs were an empty stub: `catalogList()` returned
`data: []` with `dataStatus: 'unavailable'` and never looked at storage, and
the two Intent OS tabs rendered a static empty state without fetching
anything. Both halves are now real.

- `server/ecosystemRegistry.js` reads and writes the durable Blob-backed store
  used by developer projects, under versioned keys `ecosystem-agents:v1`,
  `ecosystem-strategies:v1` and `ecosystem-liquidity:v1`, with per-record
  `ownerId` ownership that never leaves the server.
- `catalogList()` now reports the truth: `live` when a durable registry
  answered (even with zero rows) and `unavailable` when none is configured,
  with cursor pagination and the resource schema unchanged.
- Authenticated writes: `POST /api/ecosystem/{agents,strategies}` plus
  owner-only `/:id` (edit) and `/:id/unlist`, each requiring Telegram
  authentication and a durable idempotency key, mirroring the developer
  project routes. Liquidity stays read-only (405): with no RFQ settlement and
  no custody, a self-service listing could not claim anything honest.
- Fail-closed on both sides of storage. Writes are screened by
  `validateAgent` / `validateStrategy` **before** an idempotency key is
  claimed, so `withdrawFunds`, `executeWithoutUser` and
  `action.automaticExecution` are refused whether or not the store is up; only
  the validated output — projected onto a field whitelist — is persisted, and
  reads re-validate every stored row and drop anything that no longer passes.
- Nothing is ever presented as verified: `verification.status` is forced to
  `unverified` on write and again on read, and the client hardcodes
  `verified: false`.
- Intent OS Agents/Strategies tabs fetch the catalog on open and render
  read-only cards (name, description, chains, execution mode / policy bounds,
  unverified badge) with four honest states — loading, error, unavailable and
  live. No run, sign, install or enable control exists.
- Added `test/ecosystem-registry-probe.mjs` (module + real HTTP) and an
  `ecosystem catalog UI` suite; docs in `docs/ECOSYSTEM-REGISTRY-FA.md`.
- No custody, signer, automatic execution, withdrawal, RFQ settlement or
  mainnet onboarding was added.

## Unreleased — FBT Network ecosystem safety layer

- Added read-only Agent, Strategy and Liquidity catalog boundaries with honest unavailable states.
- Added authenticated sandbox Developer Projects and scoped, one-time API keys with hash-only storage.
- Added durable idempotency for project creation, API key creation and revocation.
- Added fail-closed validators for agents, strategies, portfolio agents, intent graphs, certification and reputation evidence.
- Added sandbox-only local project drafts and embedded Agent/Strategy tabs in Intent OS; no new page or automatic execution path was introduced.
- No custody, signer, withdrawal, payout, billing, mainnet onboarding, fake metrics or fabricated reputation was added.

## Unreleased — Notifications

- Fix FCM token rotation by keeping a native registration listener active and re-syncing order watches after a new token is registered.
- Route native notification taps to validated internal order, intent, and swap routes.
- Clarify the live Firebase project as `fbtswap-36b13` and document the end-to-end notification audit.

# Changelog

## Unreleased — WalletConnect relay failover (wss://relay.walletconnect.org)

The "relay unreachable" report was real and network-side: pairing hard-
depended on the default relay hostname `wss://relay.walletconnect.com`,
which some ISPs filter (SNI/DNS). The project id is valid (verified against
the WalletConnect explorer), the SDK is current (2.23.10), and no CSP blocks
the socket — the path to that one hostname was simply closed.

A new `initWcProvider()` helper in `WalletContext` now walks
`WC_RELAY_URLS` (lib/wcTimeout.js): the primary relay gets a short 8s fuse
(`WC_PRIMARY_RELAY_TIMEOUT_MS`), then the officially documented fallback
`wss://relay.walletconnect.org` gets the full 20s budget. On a network that
blocks only the default hostname, pairing now succeeds in ~8s instead of
only failing politely; a network blocking both still lands on the named
`WC_RELAY_UNREACHABLE` error — far sooner than the SDK's 60-90s retry loop.
Two latent stalls are fixed along the way: `EthereumProvider.init()` opens
the relay socket itself and had NO outer bound (only `wc.connect()` was
timed), and an init attempt abandoned by our timeout left a zombie socket
behind — late-settling attempts now self-disconnect. Session restore uses
the same failover, so returning to the app revives sessions over the
fallback relay instead of silently dying on the primary. Non-relay
failures (user cancel, origin/project rejection) are never retried.
Docs: docs/WALLETCONNECT-FIX-FA.md (Persian) gained the full walkthrough.

## Unreleased — Three-stage order/intent OS notifications

Auto-orders and Intent OS now emit three OS-shade alerts (pending /
target reached / position closed), each with its own colour, vibrate
pattern and in-app chime — distinct from the daily promo. Delivery is
web-push or FCM to the registering device so the shade still updates
when the site or APK is closed. The Hobby cron remains once a day for
background price checks; opening the app still fires `ready` immediately.

## Unreleased — APK FCM tokens actually reach the server

The packaged Android WebView serves from `https://localhost`, so
`notify.js` and `orders.js` posting to a relative `/api` never hit
`fbtswap.ir`. Both now go through `apiBase()`. Settings no longer claims
push is active without a real token/subscription. The news bell POSTs
registration instead of only flipping a local flag. After a successful
register, existing auto-orders are mirrored so they do not have to be
re-saved. Headline-by-headline news push is still not a thing — that
channel is the daily promo cron (Hobby: once a day).

## Unreleased — Execution-observation empirical model

The durable `intent-observations:<dayBucket>` dataset is now consumed. A new
trainer (`server/learning/execObservation.js`) publishes
`fbt.intent-execution-model.v1`: completion rate, per-route rates
(chain × policy × solver) with sample counts, failure-code frequencies, and
gas / output-error / latency bucket distributions. It is not a classifier, not
an LLM, and it claims no MEV protection, atomicity, escrow or route
optimisation. `modelTrained` is true only with ≥50 records and at least one
route with ≥5 samples; otherwise the endpoint and capabilities stay
fail-closed. Served from memory at `GET /api/intents/v1/execution-observation-model`;
the existing `/api/cron/train` job trains both this model and the verdict
params. `mlOptimizationClaimed` remains `false`. `/api/learning/params` is a
separate surface and still reports `model:false` without its own dataset.

## Unreleased — Intent Execution Core v2: multi-RPC quorum, replacement-tx tracking, durable observations

**Durable observation storage (priority 1).** `POST /api/intents/v1/observations`
persists each accepted observation to the day-bucket Blob store when Blob is
configured and still fails CLOSED (`503 NOT_CONFIGURED`) otherwise. The payload
schema (`fbt.intent-execution-observation.v1`) is unchanged; no address, amount,
tx hash or free text is ever written to logs, git or the bundle, and no ML is
claimed until the dataset actually exists. `simulationStatus` now also carries
`rpc-disagreement` (with `failureCode: RPC_DISAGREEMENT`).

**Multi-RPC preflight quorum (priority 3).** The exact bytes are re-simulated
on several independent read-only RPC nodes (`simulateIntentTransactionQuorum`).
`RPC_DISAGREEMENT` is only reported on a genuine passed-vs-reverted split; an
unreachable node is never counted as a vote. The wallet now exposes the raw read
nodes (`getReadProviders`) alongside the fail-over wrapper, and capabilities
advertise `multiRpcPreflightQuorum: true`.

**Replacement-tx UI tracking (priority 2).** A replaced pending transaction is
now named, shown and followed to completion in the swap UI instead of collapsing
into a generic failure. ethers v6 `TRANSACTION_REPLACED` (repriced / cancelled /
replaced) yields the replacement hash + reason + receipt; the UI shows a
"replaced" stage with an explorer link to the new hash, and `trackReplacement`
polls it to settlement. No hash is ever invented — a missing hash falls back to
normal recovery, and a follow that times out reports `CONFIRMATION_TIMEOUT`.
New module `src/lib/intentReplacement.js`; capabilities advertise
`replacementTxTracking: true`.

## Unreleased — Reown project rotation

- Rotated every WalletConnect integration and wiring guard to Reown project
  `8e36eccabebf5a4567f4e974fafd6b20`.
- Recorded the verified web origins (`https://fbtswap.ir`,
  `https://localhost`) and Android app ID (`ir.fbtswap.app`) in the security
  runbooks and corrected the origin-blocked guidance in every locale.
- Kept the Dashboard API Secret out of source and client configuration; the
  current app does not consume the private Dashboard API.

## 1.39.0 — WalletConnect identity, chain-sync and stale-session fixes; docs for every level

**The fake "Security risk / flagged unsafe by multiple security providers"
screen.** Root cause was in the app, not a blacklist: `repairSignClientMetadata()`
mutated `wc.signer.client.metadata`, but in sign-client 2.23.10 the Core has no
`metadata` property — the repair was a silent no-op and `populateAppMetadata()`
overwrote the configured identity with the page origin. Inside the APK that
origin is `https://localhost`, and wallet security scanners flag a dapp that
claims to be localhost. The repair now targets `wc.signer.metadata` (the object
the proposal is actually serialized from), verifies its own result and records
`metadata_repaired`/`metadata_repair_failed` in the event trace. Domain
verification on the WalletConnect dashboard remains an owner-only step —
runbook in `docs/WALLETCONNECT-VERIFY-FA.md`.

**Trust Wallet balances "missing" (e.g. Bitcoin).** The SDK reports the
REQUIRED chain after connect (BNB Chain, 56) regardless of the network the
wallet actually approved, so the Wallet tab filtered to BSC and WBTC on
Ethereum vanished — and Swap/Bridge/Send built requests tagged `eip155:56`
against a session the wallet approved on another chain. The real chain is now
derived from the approved session (`src/lib/wcChain.js`), both React state and
the SDK's internal chainId are aligned with it, and `chainChanged` events are
parsed defensively (hex / CAIP-2 / numeric).

**WalletConnect dead after disconnecting the in-app wallet.** Disconnects
nulled refs but left the SDK/AppKit localStorage artifacts behind
(`wc@2:client:*//session`, `WALLETCONNECT_DEEPLINK_CHOICE`, recent-wallet
keys). The next `init()` resurrected the old session, AppKit answered
`isConnected()=true` and refused to open the modal, and the stored mobile
deep-link funnelled the user into a wallet app with a dead pairing.
`src/lib/wcStorage.js` purges exactly those connection artifacts on every
disconnect/forget and before every explicit connect; entering local mode
releases a live WalletConnect session; a local vault wins the cold-start race
against the async session restore.

**Docs + offline FAQ at every level.** Five new Docs sections (IntentOS,
Smart Wallet, Portfolio, P2P, Orders) with beginner/intermediate/pro badges on
all fourteen sections and complete 12-language translations (the ten locales
that previously fell back to English now carry the full docs). Twenty-two new
offline-FAQ entries with en/fa/ar keywords and answers, including the
"WalletConnect without a project ID" question, plus `help.q` titles in all
twelve locales. No new pages were added.

**Unreported bugs fixed in the same audit:** send/swap/bridge request-chain
mismatch (same chainId lie), cold-start vault-vs-session race, dual-connection
state leak when creating/unlocking the vault while WalletConnect was live, and
the Wallet page mislabelling EIP-6963 wallets as MetaMask/Trust. Details in
`docs/PRELAUNCH-AUDIT-2026-08-18-FA.md`.

## 1.38.0 — WalletConnect actually connects, and pull-to-refresh replaces the header button

**The "spins forever" / "fail connection" bug — an unbounded relay wait.**
`wc.connect()` / `EthereumProvider.init()` had no outer timeout of their own.
Inside the SDK, `Relayer.connect()` retries the relay socket up to 5 times
with growing backoff BEFORE it ever rejects — on a network that blocks
`relay.walletconnect.com` outright (the Iranian case), that meant 60-90+
seconds of a spinner with zero feedback before an unlabelled failure, which
read exactly like "the app is broken". `src/lib/wcTimeout.js`
(`withTimeout`, 20s) now bounds both the connect and the session-restore
path; on timeout the abandoned SignClient/modal instance is disconnected so
it cannot outlive the attempt and confuse the next tap, and the failure is
classified as the existing actionable `WC_RELAY_UNREACHABLE` message
(switch network / VPN) instead of a bare `CONNECT_FAILED`.

**Wallet deep links no longer depend on a third WalletConnect-operated API.**
`mobileWallets` (explicit `metamask://` / `trust://` / `rainbow://` + universal
links) was iOS-only; Android fell back to resolving deep links from
`api.web3modal.org` at pairing time — a dependency that can be filtered
alongside the relay, producing "the wallet list shows but tapping does
nothing". Supplied on every platform now, removing that dependency entirely
for the three wallets the app promotes.

**The wallet screen "flickers like a fluorescent tube".** The same mechanism
already fixed once for the sheet backdrop and the More menu — a
`backdrop-filter` re-sampling a drifting animated background every
compositor frame, nested under its own looping `filter: blur()` aurora
layers — was reintroduced by `wallet-modern.css` for the Wallet screen
specifically (the screen the Connect button lives on) and never gated for
native. Both are now frozen/dropped under `:root[data-native='true']`,
matching the existing pattern.

**Velora gets the same reachability fallback Kyber/OpenOcean already had.**
A same-origin proxy retry (`server/swapProxy.js` → `/api/swap/velora/prices`)
for users whose network cannot reach `api.velora.xyz` directly — previously
missing, and invisible because Velora is quote-only: losing it silently
dropped a price comparison rather than breaking anything visible, for
exactly the users (Iranian networks already filtering Kyber/OpenOcean) this
third opinion exists for.

**The header Refresh button is gone; pull-to-refresh replaces it.**
`src/components/PullToRefresh.jsx` wraps the routed content and runs the
IDENTICAL `requestSoftRefresh()` contract (`lib/refresh.js`: no reload, no
remount, no new SignClient, guard-respecting, single-flight) on a downward
drag. It only attaches its touch listeners inside the packaged Capacitor app
or an installed/home-screen PWA (`isNativeShell() || isStandalone()`) —
where there was previously no refresh affordance at all — and is a complete
no-op on the web, where the browser's own pull-to-refresh / F5 already work
and must not be double-triggered underneath a second gesture. A currently
open sheet or a held refresh guard (wallet pairing, a swap in flight)
suppresses the drag entirely, same safety the old disabled button had.

Tests: `test/wc-timeout-probe.mjs` (new, 11 checks — a runtime probe proving
a promise that never resolves is actually bounded, not just a grep),
`test/wc-connect-probe.mjs` grew to 47, `test/refresh-probe.mjs` re-pins the
button's removal and the new pull gesture's safety contract, `test/units.mjs`
and `test/wiring.mjs` cover the Velora proxy and the native wallet-screen
blur fix.

## 1.37.0 — WalletConnect lifecycle, the calm tab, and a safe Refresh

Five related incidents, fixed at their causes; nothing is hidden or suppressed.

**WalletConnect on Android — modal choreography and the missing session.**
- The internal wallet sheet now WITHDRAWS (`WalletConnectSheet`, one controlled
  exit) while the AppKit modal owns pairing: two modal stacks, two scroll locks
  and two full-screen blurred backdrops no longer composite on top of each
  other, which on the Android WebView was the "flickering grey box". A failure
  re-opens the sheet with the failure NAMED (the modal-cancel is now
  correctly `USER_REJECTED`, not a scary `CONNECT_FAILED`).
- `restoreWcSession()` re-attaches a persisted WC session on cold start and on
  foreground return without a new pairing — the "Trust disconnected me"
  report. The probe reads only key names + an array length in localStorage.
- Session-handling policy: transient `accountsChanged: []` no longer tears a
  WC session down; relay drop/reconnect is traced, never treated as teardown;
  every handler is instance-scoped so a replaced provider can never wipe the
  live connection; listeners attach exactly once per instance.
- `src/lib/wcTrace.js` — a ring buffer of WC lifecycle events (names +
  timestamps only, never URIs/topics/accounts), dev-console only.
- Metadata lives in ONE function shared by connect and restore
  (`buildWcInitConfig`), still canonical `https://fbtswap.ir`, icon +
  redirect rules unchanged and pinned by tests.

**The Calm tab music "disappearing".** Never a deletion — TWO stacked
upstream failures, both proven against the live archive.org API on the day of
the fix: (1) the search query itself was too heavy — four quoted
`licenseurl:"…"` clauses plus a nine-way NOT plus an `fl[]=` field projection
is answered by archive.org's backend with a ConSISTENT "kinda busy" 502,
while the projection-free subject query answers in ~33 ms (verified); the
licence/mood gates now run where they were already duplicated — on the
results, with identical legal posture (`licenceOk`, `calmSubjectOk`,
`pickTrack` unchanged). (2) `/metadata/{id}/files` 502s under load while the
full `/metadata/{id}` document — which contains the same `files` array —
stays up. And the original amplifier: the route cached an EMPTY catalogue for
six hours while the panel `return null`ed on both error and empty. Now: empty
is never cached (502 `CALM_UNAVAILABLE`), a poisoned legacy entry is evicted
on read, `?force=1` bypasses the read for Retry/refresh, each mood search
gets one bounded retry, twelve candidates land up to eight tracks, and the
panel has distinct loading / error+Retry / honest-empty states. The APK
additionally used to call `https://localhost/api/...` for this and the other
News tabs: they now resolve through `src/lib/apiBase.js` (canonical origin in
the native shell, relative on the web).

**The More menu.** Close-then-navigate ordering (no more route swap beneath
an exiting drawer), the nav More button toggles instead of re-opening on top,
and the per-tile `backdrop-filter: blur(10px)` is dropped on native — the
eighteen simultaneous blurs inside an animating panel were the menu flicker.

**Safe Refresh.** A header Refresh button running a soft cycle through
`src/lib/refresh.js`: invalidates the API + calm caches, re-runs every
`usePoll`, News, Calm and the wallet balance — no reload, no remount, no new
SignClient, no storage writes. Guards make it a no-op during wallet pairing
and across every swap stage (preparing…pending). `hardReload()` exists as a
guarded recovery export (one-shot per incident, storage-untouched). News tabs
deep-link (`#/news?tab=calm`) so any refresh returns to the same tab.

Tests: new `test/calm-probe.mjs` (37 checks incl. real HTTP against the route
with a stubbed archive.org) and `test/refresh-probe.mjs` (30 checks);
`test/wc-connect-probe.mjs` grew to 46 structural checks; `test/wiring.mjs`
pins the modal pointer/z-index contract, the native blur kill, and the new
i18n keys across all twelve locales.

## 1.36.0 — The learning core: daily, zero-cost, opt-in model calibration

The signal engine now improves itself every day from other users' anonymized
outcomes — without spending a single extra rial on hosting or AI APIs.

**Backend (`server/learning/`) — runs entirely inside what the app already pays for.**
- `schema.js` — the data model: `learning/buckets.ndjson` (append-only
  anonymized outcomes, <120 bytes per record, rolls to
  `learning/buckets-YYYYMMDD.ndjson` at 100K records), immutable
  `learning/params-YYYY-MM-DD.json`, and a tiny `learning/manifest.json`
  pointer `{ version, paramsKey, trainedAt, recordCount, calibrationAuc,
  fallbackHardcoded }`. All model output is bounded: per-layer weight
  multipliers live in [0.85, 1.15], order defaults in their own bands.
- `train.js` — the daily closed-form trainer (no tfjs/ONNX/LLM/gradient
  descent): logistic calibration of confidence (binned least-squares in logit
  space), rank-sum AUC, a Beta-Bernoulli "contrast" term that steps each
  layer's weight toward whichever weights-snapshot is empirically winning,
  a bounded attribution seed for the first runs, and volatility-driven
  trailing-stop / stop-buffer / ladder-step defaults. Runs in well under 2 s.
- `store.js` / `params.js` — Vercel Blob is the parameter store + rolling
  data window (no new KV/Redis/DB); published params are served FROM MEMORY
  on the hot path (Blob at most once per cold start, never per request), and
  params older than 90 days are pruned inside the same cron run.
- New endpoints: `POST /api/telemetry/signal`, `POST /api/telemetry/resolve`
  (both strictly opt-in — 401 without the device consent token), the
  memory-served `GET /api/learning/params`, and the second Hobby cron slot
  `GET /api/cron/train` (03:17 UTC, `vercel.json`).

**Privacy — non-negotiable.**
- `settings.contributeTelemetry` defaults to **false** and lives under
  Settings › Privacy behind a collapsed "data contributes to model
  improvements" box (en + fa via `scripts/add-i18n.mjs`). Enabling mints a
  device-local consent token that every submission must carry; disabling
  wipes it.
- Records carry NO address, NO public key, NO IP, NO user identifier — only
  a hash of the coin's public id, the read (stance, confidence, regime,
  weights-snapshot id) and the outcome that later occurred. No fingerprinting.

**Honesty — the words never change.**
- The model may only modulate (a) per-layer verdict weights inside hard
  bounds and (b) the volatility/trailing-pct/ladder-step defaults used by
  orderAdvisor and autopilot. Stance sentences, thresholds, confidence
  ceilings and levels are untouched by construction.
- If the model is missing, stale, or not trained yet, the engine falls back
  to today's hardcoded weights — identical behaviour. VerdictPanel shows a
  faint "Calibrated on the last N outcomes — model v{date}" footnote when
  tuned weights are in effect and keeps the full layer-weights breakdown.

## 1.35.0 — Real cross-chain leg verification (Phase 4c) + honest Phase 6 operations

**Phase 4c — multi-RPC on-chain verification of cross-chain legs.**
- New `fbt.cross-chain-account-binding.v1`: a party binds an on-chain address
  to the SAME Ed25519 key pinned in `fbt.cross-chain-state.v1`
  (`partyPublicKey`), with issued/expiry windows, a `walletProof` and strict
  claims. An address arriving in an API body proves nothing; only the party
  key can produce an acceptable binding.
- Real EIP-191 wallet proofs for EOAs: `binding-challenge` builds a public,
  deterministic challenge that binds domain + schema + stateId + partyId +
  chainId + address + Ed25519 public key + issuedAt + expiresAt + nonce. The
  wallet signs it with `personal_sign` in the user's own wallet (the private
  key is NEVER requested or received); the server verifies with
  `ethers.verifyMessage` and requires the recovered address to equal the
  bound address. A verified proof sets `walletSignatureScheme:"EIP-191"` and
  `walletSignatureVerified:true`; without it the binding stays a signed
  self-assertion (`walletSignatureScheme:null`,
  `walletSignatureVerified:false`) and a leg can never reach
  `onchain-verified` (`wallet-proof-required`). EIP-1271 (smart-contract
  wallets) is explicitly unsupported — `WALLET_PROOF_SCHEME_UNSUPPORTED`,
  no fake fallback, `eip1271Supported:false` in capabilities.
- New `fbt.cross-chain-tx-verification.v1`: a registered verifier reads each
  leg through a per-network quorum (minimum 2) of HTTPS RPC endpoints with
  distinct hostnames and signs a bounded report pinned to `stateId`,
  `receiptId`, leg, exact chain/token/amount, bound sender/recipient
  addresses and binding ids, block number/hash, receipt status,
  confirmations, per-endpoint normalized observations, quorum, verdict,
  reasonCodes and evaluatedAt. ERC-20 legs require a successful receipt with
  a `Transfer` event emitted by EXACTLY the planned token contract carrying
  the exact from/to/amount (a similar event from another contract, malformed
  logs, and ambiguous duplicate events are never accepted;
  fee-on-transfer/rebasing tokens surface as `WRONG_AMOUNT`); native legs
  check transaction from/to/value plus receipt success.
- Fail-closed everywhere: RPC disagreement, reorg (`REORG_DETECTED` for block
  hash/number drift or tx/receipt block mismatch), failed receipt, missing
  tx, insufficient confirmations, wrong token contract/sender/recipient/
  amount, expired or mis-keyed binding, invalid wallet proof, and fewer than
  the required agreeing endpoints all refuse verification. Outages answer
  `verification-unavailable` and are never converted into "verified" or a
  valid empty result. Bounded RPC transport: per-call timeout, 512KiB
  response cap, strict receipt/log shape; raw responses are never stored.
- The server stores a report ONLY after re-checking the verifier key against
  the registry, re-verifying both bindings and wallet proofs, re-reading the
  chain through its own configured endpoints and reproducing the exact
  signed verdict (`VERIFICATION_NOT_RECOMPUTABLE` otherwise). Stored records
  carry `serverRecomputedBeforeStorage:true`. Pending/disagreement reports
  are storable only as honest non-final snapshots (claims
  `multiRpcQuorumReached:false`, `transactionObservedOnChain:false`) and are
  superseded once a final outcome reproduces (`VERIFICATION_SUPERSEDED`).
- Historical `fbt.cross-chain-state.v1` states and
  `fbt.cross-chain-leg-receipt.v1` receipts are untouched and keep verifying;
  receipts keep `onChainVerified:false` forever because they are party
  claims. Verification appears only in a DERIVED public block:
  `legVerification` per leg (`signed-only`, `binding-required`,
  `wallet-proof-required`, `verification-pending`, `confirmations-pending`,
  `rpc-disagreement`, `reorg-detected`, `verification-unavailable`,
  `verification-rejected`, `onchain-verified`) plus `accountBindings` /
  `verificationReports` and `allSubmittedLegsOnChainVerified`. Even then
  `atomic`, `globalAtomicity`, `custody`, `escrow`, `automaticSettlement`
  and `refundEnforcedByFbt` stay false — two verified transactions are still
  two separate transactions — and the envelope stays draft-only under
  `ATOMIC_CROSS_CHAIN_UNAVAILABLE`.
- RPC endpoints live ONLY in server-side `INTENT_CROSS_CHAIN_RPC_NETWORKS`
  (spec shape: chainId + quorum + minConfirmations + providers with id and
  rpcUrl). No URL appears in public responses, logs or `VITE_*`. Capabilities
  publish the new top-level `crossChainVerification` block
  (`configured`, `bindingSchema`, `verificationSchema`, `walletProof`,
  `multiRpcRequired:true`, `minimumQuorum:2`, `configuredChains`,
  `providerIndependenceProven:false`, `serverRecomputesBeforeStorage:true`,
  `onChainTxVerification`, `atomic:false`, `custody:false`) — without a real
  env: `configured:false`, `configuredChains:0`, `onChainTxVerification:false`.
  Because distinct hostnames are plumbing, not an audit,
  `providerIndependenceProven` stays false; nothing is labelled
  "confidential". A dedicated `INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT`
  budgets the expensive RPC paths.
- New APIs: `POST /cross-chain/states/{stateId}/account-binding-challenge`,
  `POST/GET /cross-chain/states/{stateId}/account-bindings`,
  `POST/GET /cross-chain/states/{stateId}/verification-reports`, and
  receipt-scoped
  `POST/GET /cross-chain/states/{stateId}/receipts/{receiptId}/verification-reports`.
  CLI additions in `scripts/intent-cross-chain.mjs`: `binding-challenge`,
  `bind-account` (optional public `--wallet-signature`), `verify-binding`,
  `verify-tx`, `sign-verification`, `verify-report` (party/verifier private
  keys and RPC URLs stay in the local env and are never printed).
- New `docs/PHASE4C-ACTIVATE-FA.md` activation guide: schemas, binding
  challenge, wallet signing without a private key, Ed25519 attestation, RPC
  env template, Vercel setup, capabilities/report testing,
  disagreement/reorg/pending handling, the non-atomic boundary and the
  CLI-only variables that must never reach Vercel.

**Phase 6 — honest operational completion, no fabricated green lights.**
- `/operators` now documents precise blockers: any registered watcher/verifier
  key without a CURRENT signed `fbt.operator-attestation.v1` is listed with
  the exact offline command its real key owner must run. The server never
  invents substitute keys or operators; without real attestations in the
  environment, `independentVerification.configured` stays false, and
  `registryProvesOrganizationalIndependence:false` /
  `organizationalIndependenceProven:false` are published unconditionally.
- Coordinator rotation remains gated on a REAL dual-signed
  `fbt.coordinator-key-rotation.v1` record produced by the offline ceremony;
  no ceremonial rotation is fabricated to flip the capability, so
  `coordinatorRotationConfigured:false` remains the honest live answer until
  one exists. Old keys verify history only; new keys sign new documents.
- New `IntentMerkleRootAnchor` tooling compiled with Solidity 0.8.24:
  `scripts/compile-merkle-anchor.mjs` (artifact with deployed bytecode) and
  `scripts/deploy-merkle-anchor.mjs` (deploy + exact runtime-bytecode and
  event-interface verification, plus a `verify <address>` mode). Deployment
  runs only where a deployer credential and RPC already exist in the
  operator's own environment; the key is never committed, printed or pasted
  into chat. Without a real verified deployment,
  `INTENT_MERKLE_ANCHOR_NETWORKS` stays empty and capabilities keep
  `merkleRootAnchors.configured:false` / `externallyAnchored:false`.
- fa/en Intent OS copy for the Phase 4c layer, `.env.example` documentation
  separating code capability from operational configuration, and tests in
  `test/units.mjs` + `test/intent-api-probe.mjs` covering: valid/expired/
  wrong-key/tampered bindings, correct and wrong ERC-20 transfers, correct
  and wrong native transfers, failed receipts, insufficient confirmations,
  block-hash disagreement, reorgs, single-RPC vs quorum, provider outage,
  unregistered verifiers, signed-but-non-recomputable reports, replay/
  idempotency/conflict, RPC-URL and private-key non-disclosure, and the
  non-atomic guarantee after full verification.

## 1.34.0 — Cross-chain signed state + independent verification standards (Phases 4b/6)

**Phase 4b — honest cross-chain state machine.**
- New immutable `fbt.cross-chain-state.v1`: exact source/destination chain,
  token and integer amount; initiator/counterparty Ed25519 identities; bounded
  source, destination and refund windows; and an explicit source-chain refund
  route. State IDs are deterministic SHA-256 commitments to the full plan.
- New `fbt.cross-chain-leg-receipt.v1`: the initiator signs the source transfer;
  the counterparty then signs either the destination transfer or, after the
  destination timeout, the refund transfer. Every receipt binds the prior
  receipt, exact transfer facts, transaction hash and party public key. The
  server verifies and immutably stores each transition before deriving public
  state (`awaiting-*`, `settled-sequential`, `refund-*`).
- Honesty is signed into every state/receipt and capability:
  `atomic:false`, `globalAtomicity:false`, `custody:false`, `escrow:false`,
  `automaticSettlement:false`, `onChainVerified:false`. A receipt is a
  verifiable party statement, not RPC transaction verification. FBT cannot
  force settlement or refund.
- The existing envelope/Risk Engine is intentionally unchanged: every bridge
  or second chain remains `draft-only` with
  `ATOMIC_CROSS_CHAIN_UNAVAILABLE`; `unavailable.atomicCrossChainWorkflows`
  remains true. No global-atomic claim and no escrow contract were added.
- Public API: `POST/GET /api/intents/v1/cross-chain/states[/:stateId]` and
  `POST /cross-chain/states/:stateId/receipts`, with bounded writes and
  immutable Blob persistence when actually configured. Offline CLI:
  `scripts/intent-cross-chain.mjs` (`create`, `sign`, `verify-receipt`,
  `verify-state`). Party private keys remain CLI-only.

**Phase 6 — operator bindings, safe rotation and optional root publication.**
- `fbt.operator-attestation.v1` is an expiring Ed25519 statement signed by the
  watcher/verifier key itself. Phase 6 `configured:true` requires every active
  observer key to have a current matching attestation and to be distinct from
  solver/coordinator keys. This proves key control and registry binding only:
  `organizationalIndependenceProven:false` is unconditional because a registry
  cannot prove corporate independence. Real independent operation and audit
  remain an off-protocol requirement. Public endpoint `/operators`; offline
  `scripts/intent-operator.mjs`.
- Safe Coordinator rotation uses dual-signed
  `fbt.coordinator-key-rotation.v1` records: retiring and incoming keys both
  authorize the transition. Only `INTENT_COORDINATOR_PRIVATE_KEY` signs new
  documents; retired keys are verification-only in
  `fbt.coordinator-keyring.v1`. Historical receipts/closes continue verifying
  against their own embedded public key. Completeness reports can carry the
  dual-signed rotation chain when admission and close span a rotation. Offline
  ceremony: `scripts/intent-coordinator.mjs`.
- Optional live-log root publication adds `fbt.merkle-root-manifest.v1`,
  permissionless `IntentMerkleRootAnchor`, calldata/claim APIs and exact EVM
  event + confirmation verification. `externallyAnchored` becomes true only
  for the exact current root after a verified configured-contract event;
  absent `INTENT_MERKLE_ANCHOR_NETWORKS`, `configured:false` and
  `externallyAnchored:false`. An anchor timestamps a set commitment; it does
  not prove completeness, execution, settlement or custody. Offline CLI:
  `scripts/intent-root-anchor.mjs`.
- Capabilities publish versioned schemas/standardisation, explicit operator
  limits, keyring state and root-anchor configuration. New fa/en UI copy and
  `.env.example` document public-only configuration; no private key is placed
  in a registry, `VITE_*`, source, docs or logs.
- Tests cover state/receipt tampering, signer/transition/refund rules, API state
  lifecycle, attestation expiry/binding/key separation, dual-signature
  rotation with historical receipt validity, root recomputation and exact
  confirmed anchor events, plus CLI secret non-disclosure.

## 1.33.0 — Outcome Marketplace + Confidential Intent transport (Phase 5)

Two honest slices on top of the Phase 3 bonded-solver machinery, each pinned
so it never over-claims.

**Outcome Marketplace (`fbt.outcome-bid.v1`).**
- Signed, bounded outcome bids: `guaranteedMinimum`, `totalMaxCost`, `expiry`,
  `settlementChainId` and `partialFillPolicy` are all validated server-side
  before any signature or storage work. A solver can never widen a field the
  protocol has not defined.
- Outcome bids are admitted ONLY from a registered solver that is declared
  **bonded** at admission time (`SOLVER_NOT_BONDED` otherwise). Each 201
  admission is transactionally paired with a coordinator-signed
  `fbt.outcome-admission-receipt.v1` and a replay-proof nonce.
- Immutable outcome log + Merkle root + deterministic close under
  `MAX_GUARANTEED_MINIMUM_V1` (highest `guaranteedMinimum`; tie → lowest
  `totalMaxCost` → fee → hash). The public `POST /bids` path stays closed.
- Independent completeness watcher reports
  (`fbt.outcome-completeness-report.v1`) re-grade the sealed set against the
  observed admission receipts with the same deterministic rules as Phase 2c.
- Execution claims / disputes / adjudications / settlement reports are reused
  for outcome bids via explicit schema branching (no module duplication): the
  graded floor is the solver's declared `guaranteedMinimum`, the claim executes
  on the bid's `settlementChainId`, and any failure penalty is DERIVED from the
  deterministic Phase 3 penalty table — never a free value from the solver.
- Envelope + Risk Engine: a **single-chain** outcome (funding chain ===
  settlement chain) compiles to `ready-for-client-review` with user-signed
  settlement and `executable: false`; a **cross-chain** outcome stays
  `draft-only` (`OUTCOME_CROSS_CHAIN_UNAVAILABLE`). No automatic settlement and
  no custody: `custody: false`, `automaticSettlement: false`.
- New CLI `scripts/intent-outcome.mjs` (example / sign) + fa/en locale strings
  + `.env.example` (`INTENT_OUTCOME_RATE_LIMIT`).

**Confidential Intent transfer (Phase 5).**
- Real commit–reveal (`fbt.intent-commitment.v1`): only a hash is placed in the
  open log before the deadline; after close a reveal is verified by solvers /
  watchers against the committed hash. Honesty pinned in every record:
  `preimageHolder: 'fbt-server'` and `commitRevealMetadataPrivacy: false`.
- Envelope + Risk Engine: a single-chain swap travelling through the
  commit-reveal path may declare `privacy: 'confidential'` and reach
  ready-for-client-review. Threshold/TEE claims still block
  (`THRESHOLD_TEE_UNAVAILABLE`); Private RPC is never relabelled confidential.
- Honest threshold-encryption skeleton (`fbt.confidential-envelope.v1`):
  hybrid AES-256-GCM + X25519 ECDH key wrap with N-of-N XOR shares. Decryption
  is only possible after close (enforced at the route layer). Operator public
  keys come from `INTENT_CONFIDENTIAL_OPERATOR_KEYS` (X25519, strict
  base64url); `capabilities.confidential.thresholdEncryption.configured` is
  true ONLY when real operator keys exist, and `tee` is ALWAYS false.
- `.env.example` documents `INTENT_CONFIDENTIAL_OPERATOR_KEYS`.

## 1.32.0 — Intent OS Phase 4a: claim/dispute CLI + single-chain workflow DAG

Phase 3 made outcomes claimable and independently checkable. Phase 4a adds
the two missing settler commands and the first honest slice of composable
workflows: a same-chain DAG that the user still signs.

- **Settler CLI `claim` + `dispute`** (`scripts/intent-settler.mjs`): the
  winning solver signs `fbt.execution-claim.v1` with
  `INTENT_SOLVER_PRIVATE_KEY` (plus optional `INTENT_SOLVER_ID` /
  `INTENT_SOLVER_NAME`); an independent verifier signs `fbt.dispute.v1` with
  `INTENT_VERIFIER_PRIVATE_KEY`. Both call the existing server builders.
  Private keys are never printed.
- **Workflow schema** (`server/intentWorkflow.js`, `fbt.workflow.v1`): a
  bounded DAG of 2–8 nodes (`swap|deposit|borrow|send|approve|bridge`) with
  per-node chain, asset, minOutput, maxInput, deadline, allowedContracts,
  revertPolicy and approvalScope, plus typed edges. Cycles, unknown actions
  and mixed undeclared fields fail closed.
- **Same-chain vs cross-chain honesty**: all nodes on one chain and no
  `bridge` action compile to `ready-for-review` (`WORKFLOW_SINGLE_CHAIN_ATOMIC`,
  `executable: false` — the user still signs). A second chain or any bridge
  stays `draft-only` with `ATOMIC_CROSS_CHAIN_UNAVAILABLE`. The blanket
  `ATOMIC_WORKFLOW_UNAVAILABLE` / `unavailable.atomicComposableWorkflows`
  flags are replaced by `unavailable.atomicCrossChainWorkflows`.
- **IntentWorkflowBatch** (`contracts/IntentWorkflowBatch.sol`):
  `execute(workflowId, Call[], RevertPolicy)` with AbortAll / Continue /
  SkipRemaining, leftover-ETH refund, no owner and no token rescue. The
  contract does **not** verify call outputs. Calldata is a planned SHA-256
  of each canonical node (`liveRouterCalldata: false`).
- Capabilities gain the `workflows` block (`configured` only when
  `INTENT_WORKFLOW_BATCH_ADDRESS` is a real public address). New live
  adapter `fbt-single-chain-workflow` (settlement `user-signed-batch`).
  Receipt schema `fbt.workflow-execution-proof.v1` claims
  `SINGLE_CHAIN_BATCH_EXECUTED` with `globalAtomicity: false` and
  `outputVerified: false`.
- UI: Compose defaults to a same-chain swap+deposit DAG; per-step chain,
  asset, min/max and revert policy; a banner when any step is a bridge or
  another chain; Network tab workflow block (fa + en).
- `.env.example` documents `INTENT_WORKFLOW_BATCH_ADDRESS` (public). Solver
  and verifier private keys stay CLI-only and are never added as server env.

## 1.31.0 — Intent OS Phase 3b: outcome settlement reports + independent re-grading

Phase 3a made outcomes claimable and adjudicable. Phase 3b makes both
independently CHECKABLE: any registered verifier publishes a recomputable
settlement report over the same embedded evidence the coordinator graded,
connecting the selection receipt to the actual delivered amount — the last
item of the Phase 3 promise «bonded open solver network + outcome
settlement».

- **Settlement reports** (`server/intentSettlement.js`,
  `fbt.settlement-report.v1`): a report re-grades one sealed outcome from
  embedded evidence (selected commitment, claim, disputes, adjudication) with
  the shared deterministic engine, and publishes the settlement arithmetic —
  `quotedMinOut`, `promisedOut`, `deliveredOut`, exact `shortfallUnits` and
  `shortfallBps`. The evaluation time is embedded, so a stored report always
  recomputes. Verdicts: `fulfilled` / `short-filled` / `failed` /
  `unexecuted` / `pending` / `contested`.
- **Adjudication cross-check**: if a report embeds a stored coordinator
  adjudication whose verdict does not reproduce from the same evidence, the
  report verdict becomes `adjudication-mismatch` — hard misconduct evidence,
  like a censored admission receipt. `POST/GET
  /api/intents/v1/auctions/:intentHash/settlement-reports`; the server
  re-evaluates every report before storing (a verdict that does not
  recompute is rejected even with a valid verifier key), storage is
  immutable and reportId replay is idempotent.
- **Live per-auction settlement status**: auction state gains the
  `settlement` block (`unmonitored` → `fulfilled` / `pending` / `adverse` /
  `adjudication-mismatch`), with scope honestly declared as
  `observed-evidence-only`. An adjudication mismatch dominates every other
  verdict; adverse verdicts dominate fulfilled; zero reports never reads as
  settled.
- **Offline settlement CLI** (`scripts/intent-settler.mjs`): `min-out`,
  `verify-claim`, `grade`, `report` (signed with the verifier key),
  `verify-report`, `collect` — full independent verification of claims,
  grades and reports without contacting FBT.
- Client + UI: `intentNetwork` gains the settlement-reports getter; the
  Network tab shows the settlement protocol block — report schema, server
  recompute, adjudication cross-check and the never-custody flag (fa + en).
  Capabilities gain the `settlement` section with `configured`-honest
  fields.
- Tests: 24 new unit rows (settlement evaluation matrix, shortfall
  arithmetic, adjudication cross-check, recompute/claims rejection, summary
  precedence, storage idempotency) and 11 new HTTP probe rows (report
  lifecycle, tamper and rogue-verifier refusals, end-to-end
  adjudication-mismatch evidence dominating public state, consistent
  `unexecuted` → `adverse` settlement).

## 1.30.0 — Intent OS Phase 3a: bonded solver registry + execution claims, disputes and deterministic penalty adjudication

Phase 2c proved a sealed set was complete; it deliberately never answered
what happened AFTER the close. Phase 3a (first half of «bonded open solver
network + outcome settlement») closes that gap with economics expressed as
evidence, under the same honesty rules as the rest of the protocol: bonds are
declared public statements, disputes are signed observations, penalties are
deterministic grades — and FBT still holds nothing.

- **Declared solver bonds** (`server/intentBonds.js`, `fbt.solver-bond.v1`):
  `INTENT_SOLVER_BONDS` is a public-statement registry (solverId, amount,
  asset, expiry, terms) with a public board at `GET /api/intents/v1/bonds`.
  A solver is `bonded` only when the declaration is above the protocol
  minimum (1000 USD), the solver is registered and the bond is unexpired.
  The board and capabilities say `enforcement: 'out-of-protocol-declared'`,
  `custody: false`, `onChainEscrow: false` — FBT never receives bond funds.
- **Signed execution claims** (`server/intentExecution.js`,
  `fbt.execution-claim.v1`): the winning solver signs what happened after the
  sealed close — tx hash, received amount, fee, timing — bound to the close,
  the selected entry and the winner's registry key. Claims pin their own
  solver key, verify offline, and can never widen the quote: the graded
  outcome is recomputed from the signed commitment's `amountOut` and
  `slippageBps` (`minOutFor`), never from anything the claim asserts.
  Claims honestly state `onChainVerified: false` — they are signed evidence,
  not machine-verified settlement. One immutable claim slot per close;
  idempotent replay, conflict on drift (`POST/GET
  /api/intents/v1/auctions/:intentHash/execution-claim(s)`).
- **Verifier disputes** (`server/intentDisputes.js`, `fbt.dispute.v1`):
  `INTENT_VERIFIER_KEYS` registers independent verifier public keys (same
  registry shape as solvers/watchers, no secrets). A dispute is a bounded
  signed observation — `no-execution`, `short-fill`, `false-claim`,
  `late-execution` — never a verdict by itself.
- **Deterministic penalty adjudication** (`server/intentAdjudication.js`,
  `fbt.adjudication.v1`): guarded by the same operator bearer secret as
  close, the coordinator re-reads the immutable evidence, grades it with the
  shared deterministic engine and signs the result. Penalty table:
  `fulfilled` 0, self-reported short 25% of bond, caught short 50%,
  self-reported failure 50%, mislabelled/late failure 100%, `unexecuted`
  100%, `contested` 50%. Adjudication is refused while the execution window
  is open (`EXECUTION_WINDOW_OPEN`, `INTENT_EXECUTION_GRACE_SECONDS`,
  default 300s). The record embeds every input, so any third party can
  recompute grade, penalty and bonding; `verifyAdjudication` rejects a
  record whose grade does not reproduce, even with a valid signature.
  Unbonded solvers get `bonded: false` and `penaltyUsd: null` — never an
  invented penalty.
- **Live per-auction execution state**: `GET /api/intents/v1/auctions/:intentHash`
  now exposes the verified claim, disputes and adjudication (`execution`,
  `disputes`, `adjudication`, `adjudicationVerified`), each re-verified
  against the signed close on every read. Capabilities gain `bonds` and
  `execution` blocks; everything flips to `configured: false` when the
  registries are empty.
- Client + UI: `intentNetwork` gains bond-board, execution-claim and
  adjudication getters; the Network tab shows the bonded-network status,
  minimum bond, registered verifiers and the never-custody flag (fa + en).
  `.env.example` documents `INTENT_SOLVER_BONDS`, `INTENT_VERIFIER_KEYS`,
  `INTENT_EXECUTION_GRACE_SECONDS`, `INTENT_SETTLEMENT_RATE_LIMIT`.
- Tests: 48 new unit rows (bond registry honesty, min-out derivation, claim
  and dispute signature/binding attacks, the full grading matrix, adjudication
  recompute rejection, storage idempotency/conflicts) and 15 new HTTP probe
  rows (public bond board, claim/dispute/adjudication lifecycle, tamper and
  rogue-key refusals, window-open refusal, end-to-end `unexecuted` penalty at
  the full declared bond, configured:false without registries).

## 1.29.0 — Intent OS Phase 2c: transactional admission + independent completeness watcher

Phase 2c closes the last honesty gap of the signed auction protocol documented
in `docs/INTENT-OS-FA.md`: before this phase, a coordinator could verify a
quote at admission and silently drop it from the sealed close, and nobody
could prove it. Now omission is cryptographic evidence.

- **Transactional admission receipts** (`server/intentAdmissions.js`,
  `fbt.admission-receipt.v1`): every 201 from `POST /api/intents/v1/commitments`
  now embeds a coordinator-signed receipt binding exactly
  `intentHash · entryHash · acceptedAt · solverId`, minted inside the admission
  lock after the post-write seal re-check. Receipts are deterministic (same
  stored row + Ed25519 → same bytes), so they are **reclaimable** from the new
  immutable `GET /api/intents/v1/admissions/{intentHash}/{entryHash}` and
  watchtowers can re-derive them for every logged entry. A receipt never
  claims execution, close inclusion, or fund authority.
- **Independent completeness watcher protocol** (`server/intentWatcher.js`,
  `fbt.completeness-report.v1`): registered watcher keys submit verdicts
  comparing observed admission receipts to the signed close — `complete`,
  `inconclusive`, `misconduct-evident`, `unmonitored`. A receipted bid from
  before the seal window missing from the close (or marked late) is hard
  misconduct evidence; receipts inside the ±skew boundary (`INTENT_WATCHER_SKEW_MS`,
  default 2000ms) stay honestly inconclusive. The server **re-evaluates
  deterministically** before storing: signature, close binding, per-receipt
  classifications, counts and verdict must recompute or the report is
  rejected even with a valid key. Storage is immutable; reportId replay is
  idempotent.
- **Live per-auction status**: `GET /api/intents/v1/auctions/:intentHash` now
  surfaces `completeness` (`watcher-verified` / `misconduct-reported` /
  `inconclusive` / `unmonitored`) plus the watcher report feed, re-verified
  against the signed close on every read. The close's own
  `auctionCompletenessProof` stays `false` by design — completeness is
  per-auction watcher evidence, never a close-time claim.
- **Offline watchtower CLI** (`scripts/intent-watchtower.mjs`):
  `verify-receipt`, `verify`, `report`, `verify-report`, `collect` — full
  verification of closes, receipts and reports without contacting FBT.
- Client + UI: `intentNetwork` gains receipt/watcher getters; the Network tab
  shows admission-receipt status, registered watcher count and the
  evidence-based completeness model (fa + en). `.env.example` documents
  `INTENT_WATCHER_KEYS`, `INTENT_WATCHER_RATE_LIMIT`, `INTENT_WATCHER_SKEW_MS`.
- Tests: 26 new unit rows (receipt determinism, skew-boundary verdicts,
  report recompute rejection, summary precedence) and 13 new HTTP probe rows
  (byte-identical reclaim, 404 for non-admissions, idempotent replay, rogue
  watcher refusal, end-to-end misconduct evidence on public state).

## 1.28.4 — swap "no route" bug fixed: OpenOcean executable, proxy fallback, Iran-friendly RPCs

Reported: «در سواپ اصلی وقتی دوتا توکن را انتخاب کردی و مقدار را وارد کردی
میگه مسیری برای این تراکنش وجود ندارد». The swap screen's entire quoting
stack rested on ONE executable aggregator (KyberSwap); OpenOcean and Velora
were quoted but could never win the comparison because they were marked
non-executable. So whenever KyberSwap's API was unreachable — geo-filtering,
ISP blocks, national censorship, the exact conditions Iranian customers hit —
the app answered "no route between these two tokens" even though OpenOcean
had found one. Every aggregator outage was a total swap outage.

- **OpenOcean is now executable** (`lib/openocean.js`): its quote can win the
  comparison and `executeSwap` signs its calldata. The 0.7% platform fee
  survives via `referrer` + `referrerFee`, and it is VERIFIED before signing
  by decoding the calldata (their `/decodeInputData`) and checking the
  referrer is our payout address — fail-closed, same discipline as the
  KyberSwap extraFee echo. `minOutput` is passed on BSC/ETH/Base for
  on-chain slippage protection; gasLimit gets the documented 1.25–2.5×
  headroom.
- **Same-origin proxy fallback** (`server/swapProxy.js` + new `/api/swap/*`
  routes): when a direct call to KyberSwap or OpenOcean fails at the NETWORK
  layer, the identical request is retried through our own server, which
  forwards it from a datacenter. The app's origin is reachable by anyone who
  can open the app at all, so this turns a hard "no route" into a working
  quote for exactly the users who were locked out. No open proxy: fixed
  upstream allowlist, no SSRF.
- **BSC RPCs are Iran-friendly** (`lib/chains.js`): the list now leads with
  neutral community endpoints (PublicNode, Ankr, 1RPC, ninicoin.io) and keeps
  the Binance-hosted seeds as tail redundancy — Binance's domains are blocked
  for Iranian users, and blocked RPCs meant every on-chain read stalled and
  the direct path failed.
- **Honest errors + retry** (`lib/swap.js`, `Swap.jsx`, locales): when every
  routing source is unreachable the app now says so (`QUOTE_NETWORK`, with a
  VPN hint) instead of a false "no route", and a retry button re-quotes
  without retyping the amount. Genuine no-route verdicts are still reported
  as no-route.
- **Approval fix** (`Swap.jsx`): the pre-signing re-quote can now come from a
  different executable router than the one approved; the spender is
  re-checked and approved if it changed, so a source flip can no longer
  revert at the transfer step after the user paid gas.

## 1.28.3 — SOL tradeable from the market, modern Lab/Trade/Buy/Swap surfaces, revenue roadmap

### SOL is no longer "not on this network"

Reported: «در بازار بعضی از کویین ها میگه هنوز روی این شبکه نداری مثل توکن
سولنا». SOL is the native coin of Solana — it sat in every market list, but
the curated swap table (`coinToSwap.js`) only covered EVM tokens, so the
market showed no swap button for it and the coin page fell back to
«قابل سواپ نیست … روی شبکهای که پشتیبانی نمیکنیم». We have a working Solana
swap screen (Jupiter/OpenOcean routing), so that refusal was a leak:

- `swapTargetFor('solana')` now resolves instantly and offline to a curated
  Solana target; the market list shows the swap button and the coin page's
  Buy/Sell go straight to `/solana?to=SOL&side=…`.
- **Sell handoff bug fixed on the Solana screen**: `side=sell` was read and
  then discarded, so every "Sell" tap on a coin page opened a BUY order.
  Both the `?to=` and `?toMint=` handoffs now honour the side and flip the
  pair (asset leaves, stablecoin received).
- The wallet's "no token balances on this network" empty state now says
  balances are per-network and offers a one-tap route to the Solana swap
  instead of ending the conversation.

### Lab — prediction & invest, modernised

- New `lab-modern.css` language (glass cards, aurora glow, lit rims) shared
  by Lab, Trade and Swap.
- Predict: live-price hero with aurora, big tabular price, 24h badge,
  full-width ▲/▼ direction cards with payout sub-labels, duration segmented
  control, payout preview bar against balance, live countdown chips and
  status dots on open rounds.
- Invest: gradient summary hero, plan cards with per-plan glow tiles and APR
  display, chips for lock/min/risk, progress bars tinted per plan.

### Buy & Sell — both tabs, both screens

- Trade (practice spot): glass order ticket, gradient buy/sell segmented
  indicator, tinted CTA (mint for buy / pink for sell), cleaner fee rows and
  a modernised portfolio hero.
- Buy (fiat in/out): the two tabs share a new hero, glass route rows with
  tinted icon tiles, and the address/safety cards are in the new surface
  language.

### Swap — modern ticket, fee confirmed on both sides

- The EVM ticket is now a glass card with the signature gradient rim, an
  aurora wash, focused field glow, and a dominant cyan→violet CTA.
- Platform fee verified end-to-end on every path: EVM swap 70 bps
  (KyberSwap integrator), gasless 70 bps (0x), Solana 70 bps (OpenOcean
  referrer), bridge 30 bps (LI.FI). The quote card and the review sheet
  both itemise the exact amount before anything is signed.

### Revenue — what is still missing

- New `docs/REVENUE-REMAINING-FA.md` answers «چه راههای درآمدی هنوز
  نداریم»: what is already live (table), what remains (THORName ~$9 for
  native BTC, GMX referral ~2¢, Morpho vault ~$25, Hyperliquid builder code
  $100 lock, Ledger affiliate, AADS ads, own P2P escrow, staking doorway),
  and what is permanently blocked and why.

### Tests

All suites pass; wiring audit now at 1807 checks, including the new
predict/invest translation keys and the SOL curated-target + sell-handoff
assertions (section 103).

- Rebuilt the Settings screen (`Settings.jsx`) with a modern hero summary banner featuring interactive status badges for network, slippage, deadline, and security, plus one-tap controls for theme and balance visibility.
- Expanded EVM Networks default chain selection from 5 to all 9 active chains: BNB Smart Chain (BSC), Ethereum, Polygon, Arbitrum One, Base, Optimism, Avalanche, Linea, and Sonic, synchronized across Settings and Swap (`EVM_CHAIN_ORDER`).
- Added Default Transaction Deadline (`defaultDeadlineMin`) to Trading Settings with options for 5, 10, 20, 30, and 60 minutes, automatically protecting swaps on congested networks from delayed execution at outdated prices.
- Added a new Data & Storage (`settings.dataStorage`) section with safe cache clearing (`clearAppCache`) for prices, charts, and token lists without affecting wallet keys or security preferences.
- Added Backup Settings (`exportSettingsBackup`) allowing users to download a portable JSON file containing their Watchlist, theme, username, and display preferences.
- Updated bilingual translations (`fa.json` and `en.json`) for all new titles, subtitles, and confirmation toast notifications.

## 1.28.1 — Ostium, dYdX and storefront refresh

- Rebuilt the Shop as a modern mobile storefront: image-first campaign hero,
  five-item icon navigation, trust chips, integrated search, two-column mobile
  product grid (three on wide web), cleaner brand cards and stronger product
  hierarchy. The existing country restrictions and external-checkout honesty
  remain unchanged.
- Added `/dydx`: official EVM-signature onboarding, memory-only dYdX signing
  session, 200+ live markets, account/position reads and IOC market orders with
  the supplied `dydx1…` Builder Code at 500 ppm. The official client is pinned
  exactly to known-good 3.4.0 because multiple adjacent npm releases were
  compromised in the January 2026 supply-chain incident.
- Added full Ostium position management: partial/full close, TP, SL, exact-
  approval collateral top-up and collateral removal.
- Added a public derivatives dashboard for funding, perp basis, open interest,
  spread, and bid/ask depth within 1%.
- Fixed the Ostium → Swap handoff: it now selects Arbitrum USDC, and the generic
  network-reset effect can no longer overwrite a token supplied by a deep link.
- Fixed Solana Mobile Wallet Adapter end-to-end. The app now uses the current
  Wallet Standard registry and can sign/send after connecting instead of
  looking only for `window.solana` and reporting that the transaction was not
  signed.
- Added exact Solana source/SOL balance checks before opening the signing
  prompt, plus always-visible Phantom, Solflare and Backpack launch links.
- Wallet identity links now reject the retired `lawpoetics.ir` environment
  value and always identify the production dapp as `fbtswap.ir`.
- Added the complete `/ostium` wallet-signed order flow for gold, oil, forex,
  stocks, indices, ETFs and crypto: live prices and market hours, current
  pair-specific leverage limits, long/short ticket, TP/SL, and an itemised fee
  preview.
- Added exact-amount Arbitrum USDC approval, a final real-money confirmation,
  fresh-price revalidation immediately before signing, Arbiscan tracking and a
  read-only open-position list.
- Kept the leveraged route and its locale copy out of store-safe builds. It is
  included by `build:full` with `VITE_ENABLE_SPECULATION=true`, matching the
  existing app-store vocabulary policy.
- Fixed local-wallet network switching: the in-memory ethers signer now
  reconnects to the target RPC instead of merely changing the network label.

## 1.27.0 — versionCode 55

### The white box around the logo — three causes, all fixed

Reported as a PWA problem. It was three separate defects that produced the same
white plate, and each was measured before being touched.

**1 · No maskable icon at the size a phone actually asks for.** The manifest
declared `purpose: maskable` at 512 only. The launcher requests 192 on almost
every phone, and at 192 the only candidates were `purpose: any`. Android Oreo
and later force one silhouette on every home-screen icon, and an icon it cannot
mask is shrunk and placed **on a white plate**. That plate is the report.

This survived a long time because the Lighthouse audit "has a maskable icon"
*passed* — it only checks that some entry declares the purpose, never that the
right size does. Added `icon-maskable-192.png` and `-384.png`, both flattened
onto the brand black so they carry **no alpha channel at all** (a transparent
maskable icon gets filled with the OS's own grey or white before masking, which
is the same bug by another route). The three long-press shortcuts pointed at
the full-bleed icon too, so a long-press menu showed three more white boxes;
they now use the maskable file.

**2 · The native app's launch screen was a white Capacitor placeholder.** Every
`splash.png` under `android/` measured **98.8% pure #FFFFFF** and carried the
stock blue Capacitor "X" — not our mark, never replaced since `cap add android`.
Cold start was: white screen, a stranger's logo, then a black app. Replaced with
a layer-list (flat brand colour + centred mark at each density), so nothing is
stretched and one definition covers every screen — the eleven fixed-aspect
bitmaps distorted the artwork on any phone that did not match one of their
hard-coded ratios.

**3 · Android 12 and later ignored all of the above.** From API 31 the system
draws its own splash and does not read `android:windowBackground` when it is a
drawable. With no `windowSplashScreenBackground` set it derives the colour from
the theme — and the theme's parent was `Theme.AppCompat.**Light**.DarkActionBar`.
A Light parent under an all-black app is a white window background, so the flash
returned on exactly the devices most people own. The theme is now DayNight, the
Android 12 splash attributes are set explicitly, and `postSplashScreenTheme`
hands over to the running theme so the launch drawable does not linger behind
the WebView.

### One black instead of four

`#00030F` is now declared once and referenced by the adaptive icon background,
the launch screen, the app theme and Capacitor's `backgroundColor`. When those
drift the launch reads as a hand-off between different apps. `colorAccent` also
resolved to Capacitor's stock Material indigo `#3F51B5`, a colour that appears
nowhere in this product; it is now the brand cyan.

### Twenty-eight new guards

Section 92 of the wiring audit pins the literal sizes rather than asking
"is there a maskable icon" — the generic form is what passed while broken. It
also fails if a Light theme parent, an `any maskable` combined purpose, or the
fixed-aspect splash buckets ever come back. One of these guards caught a real
mistake during this change: the first pass at the 192 and 384 icons kept an
alpha channel.

## 1.22.0 — versionCode 50

### The Buy screen no longer complains about MoonPay

Removed the sentence naming the on-ramps that refuse this region. Naming
providers who rejected us is a complaint, not information: the reader learns
nothing they can act on, and it makes a first impression sound defensive. The
screen now just lists the routes that work.

### Six more companies, including SpaceX

Verified against the live API before listing: SPCXx (SpaceX), GOOGLx
(Alphabet), MSTRx (MicroStrategy), COINx (Coinbase), CRCLx (Circle), METAx
(Meta). Sixteen curated assets now.

**SpaceX is the interesting one.** It is a *private* company — no exchange
listing, no broker anywhere sells it, no public quote. The token is a claim on
pre-IPO shares held by the issuer, which makes it access that genuinely does
not otherwise exist, and also strictly riskier than the rest: everything else
here can be checked against a live market price and this cannot. The row says
so.

### What was left out, and why it matters more than what went in

Silver, copper and European stocks were all requested by name. Each was checked
against the live API and rejected on **measurement**:

| Asked for | What the API actually returns |
|---|---|
| Silver (XAG) | Eight results, **all** pump.fun clones with `mintAuthorityDisabled` and $1.5k–$6k of fake liquidity. No legitimate silver token exists on Solana. |
| Novo Nordisk | Real token, verified issuer, **$122 of liquidity**. A $200 order is larger than the entire book. |
| ASML / SAP / Nestlé | Same state as Novo Nordisk. European tokenized equity exists on paper with essentially no on-chain market. |
| Copper | Nothing with real depth. Every "XCU" candidate was a clone. |
| Bronze | An alloy. Not traded as a financial instrument anywhere, by anyone. |

These omissions are now **enforced by tests**, including one that asserts the
listing floor is high enough to have excluded Novo Nordisk's $122 book. That
guard exists because "the owner asked for it" is precisely the pressure under
which a scam token gets added six months from now.

A listing is a recommendation to consider something. Listing an asset nobody
can exit is worse than omitting it.

### On the futures engine

Not built, and it would be dishonest to ship a version of it. A real perpetuals
venue needs an oracle, a margin engine, a liquidation keeper and an insurance
fund. Jupiter Perps exists and works, but its integrator revenue runs through
the same referral programme our spot fee does — which is still unconfigured, so
wiring perps in today would add leverage to the product and earn exactly
nothing.

The speculation screens (`/perp`) already explain funding, liquidation and
leverage honestly, and remain the right shape until the referral account is set
up.

### Tests

1285 checks, up from 1276. Ten sabotages verified, including adding the real
Novo Nordisk token, adding a real silver clone, and dropping the listing floor
below $122 — all three caught.

## 1.21.0 — versionCode 49

### Two bugs on the tokenized-equity screen

**Profile pictures were blank.** `iconCandidates` only read `logoURI`, but
Jupiter's API spells the field `icon` — so every equity and staking token fell
straight through to the monogram. Both screens also rendered a bare `<img>`
with no `onError`, which leaves an *empty circle* when a CDN fails: worse than
the monogram, because it reads as broken rather than as a placeholder. That is
the exact failure documented at the top of `lib/tokenIcon.jsx`, reappearing
because a second data source names the field differently.

No symbol-keyed Solana icon CDN was added, deliberately. The EVM path can use
TrustWallet and CoinGecko because both are keyed by contract address; every
Solana equivalent available is keyed by symbol, which is precisely how a fake
AAPLx would inherit Apple's logo. A missing picture is cosmetic; a fake token
wearing the real one's face is financial.

**The $100 / $1,000 / $10,000 buttons showed nothing.** Two separate causes:

- On Farm the selector sat *inside* the pools section, several hundred pixels
  below the staking rows that already read `amount`. The control was driving
  numbers the user could not see without scrolling past them. It now sits above
  everything that depends on it.
- On Stocks the amount fed *only* the depth gate, so changing it silently
  toggled a button's enabled state and displayed no figure at all. Each row now
  states what the amount buys — the quantity, not a projected return, because
  inventing an expected return for Apple stock would be a forecast and this
  codebase does not emit those.

Wiring check 43 now asserts selector-before-content ordering on both screens,
so this cannot come back silently.

### Gold

Requested directly. Two tokens, each backed one-for-one by a troy ounce in a
vault: PAXG (Paxos, New York trust charter, OCC-regulated — listed first for
that reason, not for liquidity) and XAUt0 (Tether). Verified with a live quote:
`USDC → PAXG` returns `platformFee { feeBps: 70 }`.

Its own section rather than mixed into the equities, because gold is not a
company — no earnings, no dividend, no shareholder register — but inside the
same tab, under the same freeze warning. Splitting it into its own tab would
mean either repeating that warning or, worse, not repeating it.

The clone problem is identical: searching `PAXG` returns eight tokens including
"PAX Gold Punk", "Oro Tempis" and a Wormhole-bridged version with $308 of
liquidity trading 37% away from spot. Same defence — verified mints only,
issuer authority re-checked on every fetch. Commodities carry their *own*
authorities rather than a shared one, since Paxos and Tether are different
companies, and a missing authority fails closed.

Liquidity is thin (PAXG $471k, XAUt0 $268k — an order of magnitude below SPYx),
so the existing depth gate binds much sooner here. That is correct and visible
on the row.

### Tests

1276 checks, up from 1264. Changing `issuerMatches` from a boolean third
argument to a kind string broke two existing equity tests — which is what they
are for, and they were updated rather than the signature being worked around.
Eleven sabotages verified across icons, selector placement and the gold issuer
check.

## 1.20.0 — versionCode 48

### Tokenized equities and liquid staking

Two new ways to earn, both routed through the existing Solana swap so nothing
new touches custody.

**Liquid staking.** Swapping into jitoSOL or mSOL *is* staking — no deposit, no
lock-up, no impermanent loss. The token's rate against SOL grows every epoch and
swapping back out is how you stop. It is the only real yield this app can offer
without holding anyone's funds, and unlike the pool rows below it the user stays
inside the app instead of being sent to DefiLlama and lost.

Yields are **joined live** from the DefiLlama feed the Farm screen already
fetches, matched on both project and symbol. Hard-coding `apy: 7.5` would be
wrong within a week and nobody would notice — exactly the bug the old
"15–40%" ranges had. An asset with no matching pool shows no yield at all
rather than a stale one.

**Tokenized equities.** SPYx, QQQx, NVDAx, TSLAx, AAPLx and MSFTx — real shares
held 1:1 by a regulated Swiss custodian, issued by Backed Finance. Verified with
a live quote before any of this was built: `USDC → AAPLx` returns
`platformFee { feeBps: 70 }`.

This also corrects a false claim. The screen previously said "why you can't buy
Apple stock here" and linked out to three issuers. That stopped being true and
the copy is gone — a screen contradicting its own capability is the same class
of error as the old "9 Chains" claim.

#### The safety work, which is most of this release

Searching Jupiter for `AAPLx` returns **seven tokens**. One is real. The others
are pump.fun clones with the same name, the same symbol, and in two cases the
same logo scraped from Google:

| | mint | liquidity |
|---|---|---|
| real | `XsbEhLAtcf6…RLJzJp` | $79,912 |
| clone | `GQfQ2avnmJB…pxWh4` | $3.44 |
| clone | `2qAq8FC9B2y…pnnKA` | $0 |

There is no ranking that fixes this — the fakes copy whatever signal you rank
on. So:

- **A hard-coded mint list, never a search.** Every address verified against
  the live API before commit. This caught one of my own errors: the QQQx mint I
  first wrote shared a 20-character prefix with the real one and resolved to
  nothing.
- **Issuer verification on every fetch.** The server re-checks each mint's
  authority against Backed's own key. A clone cannot pass this because passing
  it requires the issuer's private key. Fails **closed** — a mismatch removes
  the row rather than showing it with a warning.
- **Handoffs carry the mint, never the symbol**, and `?to=` only accepts
  curated mints. Otherwise sharing a `?to=<scam mint>` link would be a one-tap
  phishing vector.
- **A depth gate.** SPYx has $2.8m of liquidity; AAPLx has $80k. A $2,000 order
  is nothing against one and 2.5% of the entire book on the other — thirty-five
  times the price impact, invisible from a $309 share price. Orders above 2% of
  pool depth are refused, and the message names the largest size that would
  work.

**The freeze warning renders above the buy list, not below it.** The issuer
holds a live freeze authority over these tokens, and issuers use it — Tether has
frozen over $5bn across ~10,000 wallets under the same kind of power. A risk
notice placed below the thing it warns about is the pattern that produced the
APKPure rejection.

### Correcting something I got wrong last session

I said the Solana fee was one config change away because Jupiter had dropped the
referral requirement. **That was wrong.** I had tested `/swap/v1/quote` and
generalised to `/swap/v2/order`, which this app actually uses. The current docs
for that endpoint are explicit:

> "Use the Jupiter Referral Program to earn fees on `/order` swaps. This
> requires setting up referral accounts before you can collect fees."

The existing `referralAccount` + `referralFee` parameters in `src/lib/solana.js`
are correct, and the trap documented at the top of that file is real: without an
initialised `referralTokenAccount` the swap succeeds and our fee is silently
zero. Fixing it needs on-chain setup with the owner's own key — it cannot be
done from here.

### A bug the new tests caught

`projectStake(null, 1000)` returned `{ year: 0 }` instead of `null`, because
`Number(null)` is `0` rather than `NaN` and slipped straight past
`Number.isFinite`. An unknown yield would have projected a confident "$0 a
year". Zero is a claim about the rate; null is the absence of one.

### Tests

1247 checks, up from 1194. Every new check verified by sabotage — eight
deliberate breakages of the safety layer, all caught. The clone fixtures are
copied verbatim from the live API rather than invented, because an invented fake
is fake in whatever way happens to make the test pass.

## 1.19.0 — versionCode 47

### The arcade is gone from every build

It used to be a build flag: off for the store APK, on for the website and the
direct-download APK. That was the wrong shape.

A gambling-styled screen sitting one tap from a screen that moves real money
damages the product wherever it appears, and the website is what Google indexes
and what a first-time user judges. It also earned nothing — every round ran on
virtual NX credits — so it was a permanent rejection risk and a permanent
maintenance cost with no upside on either side of the trade.

Deleted: `src/games/`, `src/pages/Play.jsx`, `src/lib/fairness.js`,
`src/hooks/useFairSession.js`, the whole `game.*` locale namespace in all twelve
languages, `nav.play`, the `firstGame` quest, and `VITE_ENABLE_GAMES` from
`package.json`, `vite.config.js`, `ci/build-full.sh` and `ci/build-both.sh`.

There is no flag to turn it back on. A flag would just be the same problem
waiting for someone to set an environment variable.

The build test was rewritten to match. Asserting "the default build excludes
the arcade" would pass forever while someone re-added a Play route, so it now
asserts the files are gone, that neither build emits an arcade chunk, and that
the **full** build ships none of the arcade vocabulary either — the locale JSON
is inlined by Rollup, which is exactly how "removed" screens kept shipping
their words last time.

This also surfaced a live bug: `Predict.jsx` was borrowing `game.stake` from
the arcade namespace. Deleting the namespace turned that label into the raw
string `game.stake` on screen, in the build where Predict is enabled — the
website. Caught by the i18n probe.

### The signal engine now looks past the chart

Everything the app computed before this read **one price series in isolation**.
RSI, MACD, Bollinger and the moving averages are all arithmetic transforms of
the same numbers, which is why they agree with each other and why "indicator
agreement" was a worthless measure of confidence: they agree loudest when they
are all wrong together.

Four independent layers now, and they are allowed to disagree:

| Layer | Source | Answers |
|---|---|---|
| Technical | `lib/ai.js` | what the chart is doing today |
| Historical | `lib/backtest.js` | how often this setup has actually paid, on this asset |
| Structural | `lib/history.js` | levels, drawdown, range position |
| Macro | `lib/macro.js` | market regime, beta to Bitcoin, cycle position |

**The macro layer is the new capability.** An altcoin does not move on its own
chart; the dominant term is what Bitcoin is doing and whether money is rotating
into or out of everything else. It measures the market regime (`riskOn` /
`btcLed` / `rotationOut` / `riskOff`), this asset's beta to Bitcoin with an R²
gate so a beta fitted to noise is never printed, and how far it is from its
all-time high.

`rotationOut` is the case that matters: a falling market with money moving into
Bitcoin is when altcoins are sold first and hardest, and **no chart of theirs
shows it coming**.

**Two horizons, computed differently rather than scaled.** Most "1D / 7D / 30D"
toggles are one number with three labels, which is a lie by presentation. The
monthly view drops the oscillators entirely — RSI is noise over a month — and
lets regime and cycle position dominate. Whether the two horizons agree is then
stated in a sentence, because nobody can derive "weak this week, constructive
over a month" by comparing two gauges.

Every output is a translation key plus numbers, never a sentence, so no claim
can be machine-translated into something we did not say. Stances are
deliberately non-directive — `tailwind` / `mildUp` / `unclear` / `mildDown` /
`headwind` — and **`unclear` is the default that requires evidence to move away
from**. A signal engine whose honest answer is usually "we don't know" is worth
more than one that always has an opinion, because the user learns which of the
two to act on.

#### Two real bugs, found by measuring rather than reading

Both surfaced from printing the numbers for a deliberately conflicted fixture.

1. **The disagreement override never fired.** It compared the standard
   deviation across layers to a threshold of 65. A +95 chart inside a
   rotation-out market — the single most dangerous configuration in the engine,
   and precisely what the macro layer was built to catch — produces a spread of
   59, so it came out as "slightly in its favour". Standard deviation is a poor
   detector here because it is scale-dependent. Replaced with a direct
   sign-conflict test between layers that clear both a weight bar and a
   magnitude bar.

2. **The confidence ceiling was dead code.** The formula's base was 72, so the
   product could never reach the clamp of 75 and the "ceiling" was a comment
   rather than a constraint — a promise the code was not keeping, it just
   happened to be true. The base is now 96 so the clamp actually binds, and the
   ceilings are exported and imported by both the UI and the tests instead of
   being copied.

### Farm shows live yields instead of figures from months ago

The screen was four hard-coded pools with hand-written APR ranges like
"15–40%". The ranges were honest about being ranges and completely disconnected
from what those pools actually paid. A yield figure that never moves is not a
yield figure, and a range that wide cannot be wrong — which is worse than being
wrong.

Live rates now, from DefiLlama through our own backend. The upstream is free
and needs no key, which is the only reason this is possible; it also returns
every pool DefiLlama tracks, 20,000+ of them and several megabytes, so the
server filters it to a few dozen rows and caches for an hour. One upstream
request per hour serves everybody.

**The filter is the entire feature.** An unfiltered yield list sorted by APY is
a list sorted by scam: anyone can deploy a pool advertising 90,000% paid in a
token that cannot be sold, and it will top any yield ranking on earth. Pools
must be on a protocol allow-list, on a chain the app supports, hold at least
$10m, pay between 0.5% and 60%, not be flagged as an outlier upstream, and be
no more than 70% token emissions.

Three things this shows that other yield screens do not:

- **The real/emissions split**, on every row. `apyBase` is interest and fees
  actually paid; `apyReward` is governance tokens minted and handed out. A
  "24%" that is 22% emissions is a countdown, not an income, and the combined
  headline gives you no way to tell.
- **Today versus the 30-day average.** A pool at 40% today with a 6% average is
  not a 40% pool.
- **How many pools were rejected.** "40 of 312 tracked" makes the filtering
  visible rather than implicit.

Ranking is *not* by APY — that would put the riskiest surviving row on top and
undo every filter above it. It is by yield weighted by how much of it is real
and by pool size, so a 12% all-revenue pool with a billion in deposits outranks
a 20% mostly-emissions pool with $12m.

**On revenue, honestly:** we take nothing from anyone's yield and the screen
says so — skimming it would require custody, which this app does not have and
will not take. The revenue is upstream of the deposit: you cannot enter a
CAKE-BNB pool without holding both tokens, and most people arriving here hold
neither. The "get the tokens" button routes that swap through our own screen at
the standard 0.7%. Single-asset pools get no such button, because there is
nothing to pair up and adding one would be manufacturing a swap the user does
not need.

### Tests

1189 checks, up from 1060 + 308. Every new check was verified by sabotage, and
five of them failed that verification on the first attempt and were rewritten:

- `confidence <= 75` passed on a fixture that scored 30, and passed with the
  clamp deleted. It now sweeps 400 synthetic markets and requires that
  something *reaches* the ceiling as well as that nothing exceeds it.
- The 90,000%-APY fixture was rejected by the emissions rule, not the ceiling —
  raising `MAX_APY` to a billion changed nothing. A separate fixture now claims
  300% and books all of it as real revenue, which only the ceiling stops.
- `/getYields/` matched the import line, so replacing the *call* with
  `Promise.resolve(null)` left a dead screen looking wired.

## 1.18.0 — versionCode 46

### The website is now the full version

`vercel.json` builds with `build:full`, so lawpoetics.ir carries every feature.
Only the app-store APK strips the speculation screens, because that is the
only place a content filter applies.

### Four screens became tabbed hubs

| Hub | Contains |
|---|---|
| **Lab** | prediction + invest |
| **Explore** | explorer + discover |
| **Learn** | help + docs |
| **Points & Ranking** | earn + leaderboard |

"Lab" is named that on purpose: both tabs run on virtual credits, and a
container name does the honest work that a disclaimer three paragraphs into
each screen cannot.

Built as one reusable shell rather than five rewrites — splicing pages into
each other risks a hook order or a dropped effect for a change that is purely
navigational. The originals are untouched and still routable, so bookmarks
keep working.

Only the active tab mounts. Rendering both and hiding one would run both
screens' polling at once, doubling API traffic for a tab nobody is looking at.

The tab lives in `?tab=`, so Android's back button steps between tabs, links
can target one, and a crash-reload returns where you were.

### Tab sizing

New `.seg-lg`. The base control is 12px text in 9px of padding — drawn for a
filter inside a card. As a page's primary navigation it read as a footnote and
the tap target was under the 44px minimum.

### Signals: confidence is now measured, not assumed

The old confidence came from **indicator agreement**. That was a bad number,
and worth explaining: every indicator here is a different arithmetic transform
of the *same* price series, so they are correlated by construction — in a
strong downtrend they all shout "oversold" in unison, agree perfectly, and are
wrong together. It reported "how similar are my formulas" as "how sure am I".

`lib/backtest.js` replays the signal over the coin's own history and counts.
Three rules make it honest:

- **No look-ahead.** Each historical signal uses only the bars that existed at
  that moment.
- **Compared against doing nothing.** A 60% hit rate is worthless if the coin
  rose on 62% of all days. `edge` is hit rate minus base rate, it is often
  negative, and it is shown.
- **Small samples are refused**, not rounded into a percentage.

The ceiling dropped from 88 to **75**. No chart rule on a volatile asset
deserves a figure that reads like certainty. With no history to measure,
confidence is capped at 40 — without evidence we are guessing, and the number
should say so.

### Perpetuals, properly explained

The page was honest about what we do not run, but taught nothing — and it
sends people to venues where real money is at stake. It now explains what a
perpetual is, what funding costs, what liquidation means, and what 100x
actually does, plus a table of how far price must move against you to
liquidate at each leverage. 50× is **2%**.

## 1.17.2 — versionCode 45

### I deleted the wallet button styles and did not notice

Reported: the refresh / lock / disconnect buttons were uneven, too small and
an ugly grey.

All true, and it was not a design choice. Rewriting a block of `index.css` two
commits ago dropped `.wal-utils` and `.wal-util` entirely while `Wallet.jsx`
kept using them — so those three buttons rendered **completely unstyled**:
browser-default size, browser-default grey, no spacing. Confirmed against git
history rather than guessed: the rules existed in `e269e7c` and were gone in
`f65a24e`.

Nothing caught it. The build passed, every render test passed, the class names
were spelled correctly — the styles simply were not there.

Restored and sized properly: **40px** min-height, `flex: 1 1 0` so all three
are exactly equal regardless of label width (Persian «بروزرسانی» is far wider
than «قفل», which is what made them uneven), and `--text-2` instead of the
faint caption grey.

**A new audit now fails the build if any project class used in JSX has no
styles.** It immediately found a second one I had missed —
`.wal-action-label`, the Send/Receive caption.

That check took three attempts to get right, and each failure is worth
recording: it passed on its own comment (the note names `.wal-utils`), it was
satisfied by `.wal-util:hover` surviving after the base rule was deleted, and
`includes('.wal-util')` was satisfied by `.wal-utils`. It now strips comments
and requires a real declaration block.

### The Start screen background was half missing

`.galaxy-neb` had **both** `inset: -12%` and `width/height: 124%`. Those fight:
`inset` already stretches the box to 124%, so the explicit width made it
resolve from the left edge and stop at 112% — off-centre, and no longer the
shape of the screen.

That is what made it look cut in half. The SVG uses a **square** viewBox with
`preserveAspectRatio="slice"`, so on a 9:19.5 phone a box of the wrong aspect
shows a narrow vertical band of the artwork instead of the middle of it.

`inset` alone now. The star planes also got an `-8%` overhang, because they
drift up to 5% and were pulling an empty edge into view at the end of each
cycle.

### …and why it may have looked frozen

A global rule sets `animation-duration: 0.001ms` under
`prefers-reduced-motion` — and **Android's battery saver forces that setting
on**. A star's brightness is carried by its twinkle keyframes, so with the
animation killed the dimmest stars sat at `opacity: 0.25` and effectively
vanished.

The stars now pin to `opacity: 0.7` when motion is reduced: the scene stays
visible, nothing moves.

## 1.17.1 — versionCode 44

### The full build existed but nothing ever built it

This is why "امکانات کم شده" was still true after the last release.

`ci/build-full.sh` was added, and it worked — but **CI only ever ran
`ci/build-apk.sh`**. So the only APK that reached GitHub Releases was the store
build, with prediction, perpetuals, invest and the arcade stripped out. A build
variant nothing executes is a deletion with extra steps.

`ci/build-both.sh` now produces both in one run:

| File | For |
|---|---|
| `app-release.apk` / `.aab` | app stores — no speculation screens |
| `FBT-Swap-full.apk` | GitHub Releases, direct download — **everything** |

The full build runs **first** and is renamed immediately, so the stable
`app-release.apk` name is left holding the store artifact. Reversed, an
automated upload grabbing that filename would send the full build to a store
and earn a second rejection.

The flags are exported inside a **subshell**, so they cannot leak into the
store build — a leak would silently produce two identical full builds, one of
them labelled as the store one. Verified.

⚠️ **One line to change** — in `.github/workflows/channel-post.yml`'s sibling
`build-apk.yml`, replace `bash ci/build-apk.sh` with `bash ci/build-both.sh`.
The upload globs are already `out/*.apk`, so they pick up both files with no
other edit.

### The wallet fixes were real — the APK was older than them

The panel work shipped in 1.17.0. A DOM probe now asserts the structure on
every test run, because the failure was a *cascade* outcome: `.card` and
`.wal-hero` each set a different padding while the divider hard-coded `-18px`,
so both rules were individually reasonable and only their combination was
wrong. Reading the CSS would not have caught it.

Verified in the DOM: the hero is no longer also a `.card`, the SVG mesh and
empty-state mark render, and there are **zero** inline `width: 100%` overrides
fighting the stylesheet.

## 1.17.0 — versionCode 43

### The wallet panel was broken by three sources of truth

Reported: the buttons were the wrong size and the screen looked wrong. It was,
and the cause was measurable rather than aesthetic:

- The panel carried **both** `.card` and `.wal-hero`. `.card` sets
  `padding: 15px`, `.wal-hero` set `18px`, and the divider under the balance
  used `margin: -18px` to reach the edges — so whichever won the cascade, the
  hairline **overhung or fell short by 3px on each side**.
- The Buy button was `.btn.btn-sm` with an inline `width: 100%`, while
  `.btn-sm` itself declares `width: auto`. An inline style fighting the
  stylesheet is exactly why it looked mis-sized.

There is now **one** source of truth, `--wal-pad`, and every child derives
from it. A test fails the build if the `.card` class or a literal `-18px`
comes back.

### And it is properly distinctive now

Built with SVG, as asked:

- **A perspective mesh** receding to a vanishing point. A CSS gradient cannot
  do this — parallel lines read as a floor tile, converging ones read as a
  plane.
- **Custom Receive / Send icons** drawn at this panel's weight. The shared
  nav set is stroked for 21px and looks coarse at 20px inside a filled tile.
- **An empty-state mark**: a wallet with a card lifting out, which says
  "nothing in here yet" before anyone reads a word.
- 28px corners against a card's 16px, a lit top rim, and a horizon line
  separating what you *have* from what you can *do*.

Nothing animates except the 7px connection dot. A balance behind moving
decoration is a balance that is hard to read.

### Everything removed is back — in a second build

`npm run build:full` and `ci/build-full.sh` produce an APK with prediction,
perpetuals, invest and the arcade all included.

The default build still leaves them out, because that vocabulary is what
APKPure rejected. **Do not upload the full build to a store** — the script
says so in a banner, and a test asserts the warning is there.

### Tutorials that actually open in Iran

Every tutorial link was a **YouTube search**, and YouTube does not load on
most Iranian networks. The button opened a page that never appeared, which
reads as a broken app rather than a blocked site.

Each section now offers **Aparat (Persian)** first and YouTube second, labelled
by language. Still searches rather than pinned videos: a pinned video can be
deleted or edited into something we would not endorse, and we would never know.

### A galaxy behind the Start screen

Drawn, not filmed — and the reasoning matters:

| A video file | This |
|---|---|
| 2–5 MB, on a 7.5 MB app | a few kB |
| still buffering on a slow connection, on the **first** screen | renders on frame one |
| iOS blocks autoplay in Low Power Mode | always plays |
| stock footage needs a licence | ours |

An SVG nebula with real cloud structure from `feTurbulence`, plus two parallax
star planes. **Individual stars never move** — only `opacity` on each star and
`transform` on the two planes, both compositor-only, so the browser animates
two elements rather than sixty. Positions come from a seeded PRNG so a
re-render cannot reshuffle the sky.

Reduced motion keeps the scene and stops the movement.

## 1.16.0 — versionCode 42

### APKPure rejected us. Here is exactly why, and what changed

> *"Not involve illegal sensitive words."*

That is the standard wording for an automated content filter, and the app was
giving it plenty to find:

| What the filter saw | Where |
|---|---|
| "Price prediction" · "Call the next candle — up or down" | an entire screen — that is a **binary option** |
| "Perpetuals" · "Leveraged futures" · 100x leverage | an entire screen |
| "Invest" · "fixed-term yield plans" | an entire screen |
| "gambling-style games" · "house edge" | arcade copy |

Every one of those was simulated and carried an honest risk notice saying so.
**That does not help.** A reviewer — and certainly an automated filter — reads
the words on the screen, not the disclaimer three paragraphs below them.

They were also earning **nothing**: every one runs on virtual credits, so they
could not produce a single unit of revenue while being the specific reason the
app could not be distributed. Bad trade in every direction.

Prediction, perpetuals and invest are now behind `SPECULATION_ENABLED`, off by
default, exactly like the arcade. A release build that forgets an env var fails
**safe**.

### Removing the screens was not enough

This is the part that would have caused a second rejection.

The routes were gated and **zero** Predict/Perp/Invest chunks were emitted —
that part worked first time. But the **words were still in the bundle**,
because locale files are *static imports*: Rollup inlines the whole JSON long
before any runtime code could delete a key. I tried the runtime filter first
and measured that it changed nothing.

A content filter scans strings, not routes. The keys are now stripped from the
JSON at **build** time, before bundling. Verified on the built output in all
twelve languages — including one Persian quest string
(«یک پیش‌بینی قیمت ثبت کن») that survived after everything else looked clean,
and was only found by grepping the compiled bundle.

A test now greps the built output for that vocabulary and fails the build if
any of it returns. Disabling the stripper makes it report all ten terms.

### The wallet, properly this time

The last attempt kept it a `.card` with a wash behind it, and the verdict was
that it still did not feel special. Correct — a card with a gradient behind it
is still a card, and every other surface in the app is one too.

Three changes, none of them "more colour":

- **A different shape.** 28px corners and a darker base than any card, so the
  eye reads it as a different *kind* of object.
- **Light with a source.** A glow at the top-left *plus* a lit rim along the
  top edge. That pairing is what makes a flat rectangle look like a physical
  panel; the wash alone was just a coloured smudge.
- **A horizon.** A hairline across the full width under the balance,
  separating what you *have* from what you can *do*. One pixel, and it does
  more for the structure than the gradient does.

### Auto Orders removed from the More menu

It is the raised centre button in the bottom nav. A menu entry for the same
destination makes the list worth reading less.

## 1.15.1 — versionCode 41

### We were advertising a chain that does not exist

The `<title>` said **"9 Chains"** and the description listed **Tron**. We
support seven EVM chains plus Solana — eight — and there is no Tron swap route
at all; `chains.js` mentions Tron only to warn that sending an EVM address to
it burns the funds.

This mattered more than a typo, because **that text was what Google had
indexed**. The one thing search engines knew about us was partly false, and
anyone arriving to swap on Tron would have found nothing and left. An
advertised capability that does not exist is also exactly what a store
reviewer checks.

A test now derives the real chain count from the source, so the claim cannot
drift again.

### The site had exactly one indexable page

Measured, not guessed: `site:lawpoetics.ir` on Google returns **one** result,
while the app has **33 routes**.

That is arithmetic. Every route is behind a hash (`/#/swap`), and nothing
after the `#` is ever sent to the server — so a crawler receives the identical
document for every screen. The sitemap honestly listed one URL, because
inventing hash entries would just resolve to the same page.

Meanwhile `watches: 0`. Zero real users. Search is the only arrival channel
that costs nothing and keeps working while nobody is watching it, so one
indexable page was the most expensive fact about this project.

There are now three real static pages, generated at build time:

- `/non-custodial-crypto-swap`
- `/crypto-price-alerts-and-dca`
- `/crypto-market-history-analysis`

Each is genuine prose about a feature that actually works, loads with **zero
external requests**, and links into the app with a normal anchor.

**Why not SSR:** a rendering server costs money every month. These are plain
files on hosting that already costs nothing.

**Why this is not cloaking:** a crawler and a person are served the same file.
There is no user-agent branching anywhere — a test asserts that — and no
meta-refresh, because an instant redirect turns a landing page into a doorway
page that Google penalises.

Three pages, not thirty. A handful about things people search for beats many
thin ones, which search engines count against the whole domain.

## 1.15.0 — versionCode 40

### The history engine

Requested: «سابقه روی این نمودار چی بوده و گذشته به ما چی میگه» — what has
happened on this chart before, and what does the past tell us.

The app already had `analyze()`: RSI, MACD, a moving average, one nearest
support and resistance. Every one of those is a **snapshot**. None can answer
*"has this level held before, and how often"* — which is the question a person
actually asks before setting a limit order at a price.

`lib/history.js` measures repeated behaviour across the whole series:

- **Levels the market keeps returning to**, with a touch count. Bands are a
  percentage of price, not a fixed amount — 1% of BTC and 1% of a sub-cent
  token are wildly different numbers, and a fixed step would give one coin
  three bands and another three thousand.
- **How each level behaved**: `held 3 of 4 tests`, counted, never a
  probability.
- **Worst fall in the window** — the number people most under-estimate before
  committing to a schedule of recurring buys.
- **Volume against this coin's own normal**, using the **median**. One listing
  pump can drag a mean so high that every later day looks quiet by comparison,
  which is exactly backwards.
- **A base rate**: "58 of 90 days were followed by a higher price 7 days
  later". Withheld below 30 samples, because a percentage from a dozen
  observations invites someone to treat noise as an edge.

### Nothing in it predicts anything

Every value is a count, a frequency or a distance measured from data that
already happened. *"This level was tested 4 times and held 3"* is a fact.
*"This level will hold"* is a forecast, and a forecast dressed as analysis is
how someone loses money believing they were told something reliable.

The `kind` field on each fact is `neutral | caution | notable` — for colour
only. It deliberately has no bullish/bearish value: the moment the module
emits "bullish", it has started forecasting. A test asserts that.

There is no green and red on the panel for the same reason. Colouring "price
held support 3 of 4 times" green would turn a measurement into a
recommendation.

### The one that mattered most

A price that *sits* at a level for twenty bars is **one** event, not twenty
tests. Counting each bar would turn a single sideways drift into a fabricated
pattern. Verified by sabotage: removing that guard makes the test report
`got 10` instead of `1`.

Two other sabotages were checked — swapping the median for a mean, and showing
a thin base rate — and both fail their tests.

### Where it appears

- **Coin detail**, between the metrics and the buy/sell buttons: the last
  thing read before a decision. Uses the chart already on screen, so no extra
  request, and follows whichever range is selected.
- **Automatic orders**, inside the limit-order form. This is where the
  question is really being asked — someone typing a target price was
  previously shown only the current rate, with no context at all. It follows
  whichever side of the pair they chose to watch.

When a coin has too little history, the panel renders **nothing** rather than
a spinner implying data that will never come, or filler.

## 1.14.3 — versionCode 39

### The drop looked stuck to the floor

Reported: «توپ به کف چسبیده، یکم فاصله بگیره».

Measuring first was worth it, because the geometry was already right: the
drop's bottom sat at 57px and the notch floor at 49px — eight clear pixels.
**The shadow was hiding them.** At `0 4px 12px` it fell four pixels downward
and blurred twelve, which spanned the entire gap and visually welded the drop
to the rim.

Two changes: the shadow is now `0 2px 6px` — half the drop, half the spread,
so it grounds the shape without bridging to the bar — and the hollow is 2px
wider at every breakpoint, taking the clearance to 10px. The drop stays
centred on the notch centre, so the ring of air is even all the way round.

### A test that had stopped testing

While fixing the above, the geometry test reported success on values it was
no longer reading — it had the small-phone and landscape numbers **hardcoded**
from an earlier version. It now parses every breakpoint out of the stylesheet
and fails loudly if a regex stops matching, rather than comparing against
`NaN` and passing.

The shadow check was hardcoded too, asserting exact pixels. It now asserts the
two properties that actually matter: the shadow must be neutral (a coloured
one reads as a glow) and tight (offset ≤ 2, blur ≤ 8), so any future value
that bridges the gap fails regardless of the exact numbers.

### Wallet: the disconnected state

The first thing a new user sees on this tab was **a single bare button on an
empty card** — on the screen that has to earn enough trust for someone to
connect a wallet holding real money.

It now uses the same hero surface as the connected state, so the page does not
change shape at the moment of connecting, and it answers the two questions
people actually have before tapping: what is this for, and are you going to
hold my keys. The reassurance sits next to the button rather than in a notice
below the fold.

### Wallet: housekeeping separated from money

Refresh, Lock and Disconnect were four same-weight ghost buttons directly
under the holdings, so **"disconnect" carried exactly as much visual weight as
"refresh"** — and one of them is destructive.

They are now a quieter row behind a hairline. Disconnect is tinted because it
is destructive, but not alarming: a red button on a wallet screen makes people
uneasy about the whole page, not just that control. Unlock stays primary when
the wallet is locked, because then it is the only thing worth doing.

## 1.14.2 — versionCode 38

### The centre button jumped right when tapped

Reported: «دکمه پس از زدن به سمت راست میرود، نمیخواد همونجا بمونه».

The button is centred with `transform: translateX(-50%)`. **Framer Motion does
not add to an existing transform — it writes the whole property.** So the
instant a tap began, `transform` became `scale(0.88)` and the `-50%` was gone,
shoving the button 21px to the right. Framer kept owning the property
afterwards, so it never came back.

The press now scales the inner `.nav-centre-drop`, which has no centring of
its own, so Framer can own *its* transform completely. Nothing in JS touches
the button's transform again.

The active state had the same latent bug — it used `transform: translateY(2px)`,
which the first tap would have wiped permanently. It is a brightness change
now.

Both are guarded by tests that fail against the old code.

### Everything else that was asked

- **RGB, like the rest of the app.** A single flat colour looked foreign next
  to the RGB spectrum every other accent uses. It is a two-stop
  `--rgb-1 → --rgb-2` ramp — the app palette in its calmest form. Two stops,
  not three: a busy ramp on a 42px circle is detail nobody can resolve, which
  is why the gradient came off in the first place. A test pins it at two.
- **Goes to Auto Orders**, not Buy & sell.
- **New icon** — two crossing arrows, the standard "scheduled / recurring"
  mark and the same family as the swap icon already in the bar. Stroked and
  17px rather than filled and 18: on a small circle a light outline reads as
  more delicate.
- **42px**, down from 44. Two pixels lighter without dropping below the
  comfortable-tap threshold.

### A test that was lying

While adding the checks above, one reported a failure on a correct
stylesheet: it sliced a fixed number of characters after the selector, and the
long comments inside these rules pushed the declarations outside the window.
Same brittle-window trap as the button-row check earlier. It now finds the
rule's real closing brace, so there is nothing to outgrow.

## 1.14.1 — versionCode 37

### The centre button is minimal now

The reference image made the gap obvious. Four things were making it heavy:

| | before | now |
|---|---|---|
| Fill | 3-stop neon gradient | one flat colour |
| Shape | teardrop, rotated 45° | plain circle |
| Shadow | coloured glow | neutral black |
| Size | 48px | **44px** |

A gradient on a 44px circle is detail nobody can resolve — it only makes the
shape look inflated. The coloured glow was the single heaviest thing on the
element. And the pointed corner was over-drawing the metaphor: the reference
reads as "a drop about to fall" purely from being round and sitting above the
surface.

The active state now *sinks* two pixels and changes hue instead of glowing
brighter, because a flat fill has nowhere brighter to go without becoming a
glow again.

### …and it was eight pixels out of place

Found while re-measuring: the drop's centre sat at 70px while the notch's
centre is at 78px, so it was **sinking into the bar** rather than resting in
the hollow — the same "merged into the menu" look that was reported, but
reintroduced by arithmetic rather than styling. It looked entirely plausible
in the CSS.

The relationship is now derived and asserted at all three breakpoints:

```
bottom + diameter/2  ===  barOffset + barHeight
56     + 44/2        ===  14        + 64        = 78 ✓
```

The test fails with the old value, so this cannot drift again.

### The glyph matches where it goes

The first pass put a home icon on a button that navigates to Buy & sell. It is
now a filled plus — and filled rather than stroked because a 2px stroke on a
saturated 44px circle reads as faint.

## 1.14.0 — versionCode 36

### The centre button now separates from the menu

Reported: «این بزرگه داخل منو ادغام شده جالب نیست» — the raised button looked
merged into the bar rather than resting in it.

It was a child of the bar, sitting on top of it with a ring painted in the
bar's own colour. That ring can never match: the bar is semi-transparent with
a backdrop blur, so an opaque patch over it reads as a lighter disc.

There is now a **real hollow**. A radial-gradient `mask` removes pixels from
the middle of the bar's top edge, so the page shows through and the droplet
floats in genuine empty space. Because it is a mask rather than a cover, the
blur, the border and the shadow all follow the new outline for free.

That forced a structural change worth knowing about: **a CSS mask clips every
descendant**, so a button inside the bar would have been sliced in half by the
very notch meant to frame it. The droplet is now a *sibling* of the bar,
positioned to the same centre line, with a zero-content spacer holding the gap
so the four tabs still space themselves evenly. A DOM test asserts it stays
outside the bar, because moving it back in would look subtly wrong rather than
throw.

Also smaller — 48px, down from 56. The old one filled the bar's height, which
is what made it read as part of the bar; at 48px inside a 64px hollow there is
8px of clear air all the way round, and that visible gap is what says
"separate".

### Wallet: a hero instead of a list of cards

Requested: a distinct treatment «مثل wallet connect».

Stripped of branding, that look is three things — one tall surface instead of
stacked cards, a soft colour wash *behind* the content rather than on it, and a
single bright pair of actions with nothing competing.

**The reordering is most of the design.** The old card led with a section
label, then a small address row, then the buttons, and the balance came
*fourth*. The number people open a wallet to see now leads.

- A blurred aurora sits in its own layer, so the blur never touches the text.
- The address became a bordered chip — it reads as an object you could copy
  rather than a stray string.
- A live wallet's status dot pulses slowly. It is the only looping animation
  on the screen and it is 7px wide; a locked wallet does not pulse, so the
  absence is information too.
- The balance uses `tabular-nums`, so digits stop jittering sideways as the
  value refreshes.

### Discover: live, and searchable

It was sixteen static links, so there was no reason to open it twice.

- **Trending now** — a live strip of the top movers. It reuses `getTrending`,
  which Market already polls and the server already caches for 120 seconds, so
  on a device that has visited Market this costs **zero** extra requests. It
  polls every 5 minutes, not 30 seconds: trending coins do not turn over in
  half a minute.
- **Search** over the curated list, with a proper empty state — an unexplained
  blank screen reads as broken rather than as a filter with no results.

Search deliberately **cannot** navigate to a typed address. A free-typing URL
field inside a wallet is a phishing delivery mechanism, and adding one would
undo the single most valuable property of this screen.

## 1.13.1 — versionCode 35

### The QR scanner's grey picture — found, and it was not the camera

Reported: «گاهی تصویر طوسی نشون میده».

The camera effect listed `onClose` and `onResult` in its dependency array, and
**both call sites pass inline arrow functions**:

```jsx
<QrScanner onClose={() => setScanOpen(false)} onResult={(p) => …} />
```

A new arrow function is a new identity on every render. So the effect re-ran on
every parent re-render — and its cleanup calls `stop()`, which sets
`video.srcObject = null` and stops the camera track. A `<video>` with no source
paints its own background: **grey**.

**Why it was intermittent, which is what made it hard to pin down:**
WalletContext refreshes the balance on a `setInterval(…, 30000)`, and every
refresh re-renders each consumer — SendSheet included. So the camera was torn
down and rebuilt roughly **every 30 seconds**. Scan quickly and you never saw
it; hesitate over the code and the camera died under you. On some Android
devices the reopen fails outright because the previous track has not released
yet — that is the "sometimes it never comes back" version of the same fault.

The callbacks now live in refs and the effect depends on `open` alone, so the
camera starts once and stops once.

A new probe suite drives the real component with an instrumented
`getUserMedia` and counts hardware opens. With the old dependency array it
measures **6 opens and 5 stops** across five re-renders; it now measures **1
and 0**. A static check on the dependency array could not have proved this —
it proves the array was *written* correctly, not that the camera survives.

Second half of the fix: even a legitimate cold start takes a second or two, and
an unexplained grey box during it is indistinguishable from a failure. There is
now a spinner and «در حال روشن کردن دوربین…» until the first real frame
arrives (`readyState >= 2` — `play()` resolves before any pixels exist), and
the reticle stays hidden until then, because brackets over a blank box imply a
running camera when there is none.

### The Share button that collapsed next to Copy

Reported: «دکمه اشتراک‌گذاری و کپی متناسب نیست و دکمه اشتراک‌گذاری خیلی کوچک و
جمع شده است».

`.btn` sets `width: 100%`. For a flex item, **`flex-basis: auto` resolves to
that width** — so a button with no flex declaration has a basis of the entire
row and `flex-grow: 0`, while its neighbour with `flex: 1` has a basis of `0`:

```
Share   flex: 1     → basis   0px, grow 1
Copy    (no flex)   → basis 340px, grow 0
```

The bases already exceed the container, so free space is **negative** and
`flex-grow` has nothing to distribute. Share stays at 0 and collapses to its
longest word; Copy keeps almost the whole row. **The button that asked to
expand is the one that got squeezed.**

New `.btn-row` helper sets `flex: 1 1 0` and `width: auto` on every child, so
the split is even regardless of label length — which matters across twelve
languages, where "Share", "اشتراک" and "Compartir" are very different widths.
Below 340px they stack instead of cramming.

Wiring check #31 fails any row that mixes the two styles. Its **first version
was itself buggy** — it capped the search at 900 characters and the invite row
is 1126, so it reported PASS while the bug was live. It now balances the `div`
tags instead of guessing a length, and correctly ignores `.btn-sm` rows
(`.btn-sm` sets `width: auto`, so the trap does not apply — the Orders action
row mixes the two styles *correctly*).

### Solana: the fee we quoted was not the fee we charged

The Solana screen unconditionally announced a **0.70% platform fee**. But the
fee is only requested when a Jupiter referral account is configured, and it is
deliberately not — setting one up costs SOL, and with no users there is nothing
to collect. So every visitor was told they would pay 0.70% while paying
**nothing**.

Overstating a fee is the safer direction to be wrong in, but "the fee I was
quoted is not the fee I paid" is exactly the discrepancy that makes someone
distrust a swap they cannot reverse. The notice is now gated on the *same*
flag that decides whether to request the fee, so the two cannot drift apart.
When a referral account is set, the 0.70% copy returns on its own.

## 1.13.0 — versionCode 34

### The selection that was invisible

Reported: on **Automatic Orders**, choosing "price falls to" or "price rises
to" appeared to change nothing.

`.segmented button.active` sets exactly one property: `color: #000`. The
coloured pill behind it is a *separate* component, `<SegIndicator>`, and each
screen has to render it. Orders never did — so a selected button was black text
on a near-black panel: **less** visible than the unselected state. The class was
being applied correctly the whole time, which is why nothing caught it.

Three independent fixes, because a selection indicator must not depend on any
one of them:

1. The missing indicator is now rendered.
2. `.segmented button.active` carries a flat background as a fallback, so a
   future omission degrades to "less pretty" rather than "invisible".
3. A **✓** before the label and `aria-pressed` on the button. Colour is not
   available to everyone.

**Wiring check #26** now fails the build if any `.segmented` control in the app
ships without an indicator, and a render test asserts the pill is really in the
DOM and moves when you tap — a check on the CSS class alone would have passed
while the bug was live.

### Is this order actually watching?

Every active or paused order now carries a state badge in its header:
**در حال پایش** / **آماده** / **متوقف**, with a dot that pulses only for a
ready one. Before this the pause/resume *button label* was the only clue, so
you had to read a button to learn a row's state — and a paused order that looks
live is the failure that costs a user the price they were waiting for.

### Three more bugs on the same screen

- **`--ink-dim` was never defined.** Not in `:root`, not in the light theme.
  The "paused" badge therefore had no colour of its own and looked identical to
  an active one. Two other rules already wrote `var(--ink-dim, #9aa3b2)` with a
  fallback, which is how it went unnoticed.
- **Paused rows were never dimmed.** The rule keyed off `.ord-paused`, a class
  that only appears on a badge which is rendered *exclusively* for orders that
  are neither active nor paused. It could never match.
- **The percentage was the wrong colour half the time.** It painted green when
  the price was above target — correct for "sell when it rises", exactly
  backwards for "buy when it falls", where a falling price is the good news.
  It also crashed on a legacy order with no target (`null.toFixed`).
- **`BAD_TRAIL` had no message.** An out-of-range trailing distance showed the
  literal string `orderErr.BAD_TRAIL` as the explanation. The text existed
  under `orders.err.BAD_TRAIL` — written, translated, read by nothing. Wiring
  check #30 now derives the code list from the source, so any future error code
  fails the build until it has a message.

### Sharing works outside Telegram

The **only** share implementation in the app built a `t.me/share/url` link and
opened it. On most Iranian networks t.me does not resolve, so the tap did
nothing; without Telegram installed you landed on an install-Telegram page; and
anyone whose friends use WhatsApp, iMessage, X or SMS had no route at all.

Sharing is the only zero-cost growth channel this project has, so every failed
tap was a user who tried to bring us another user and could not.

`lib/share.js` now walks a ladder: the **Capacitor share sheet** inside the
APK → the **Web Share API** (this is what makes Safari on iPhone work) →
Telegram, but only when genuinely running inside Telegram → an in-app list of
WhatsApp / Telegram / X / LinkedIn / email / SMS. Copy sits beside share and
never fails. A dismissed OS sheet is treated as a decision, not an error, so
nothing pops up behind it.

### iPhone and iPad are supported platforms now

There is no iOS build of this app and there cannot be one without an Apple
Developer account, so the home-screen PWA is the **only** way an iPhone user can
keep FBT Swap.

- Safari ignores the web manifest almost entirely. Without
  `apple-mobile-web-app-capable` the "installed" app opened in a normal Safari
  tab with the address bar; without `apple-mobile-web-app-title` the icon was
  captioned with the 60-character SEO `<title>`. Both are set.
- Safari **never** fires `beforeinstallprompt` — Apple has not implemented it —
  so the install banner rendered nothing at all on iOS. It now shows the
  Share → Add to Home Screen instruction, and only in real Safari: Chrome and
  Firefox on iOS cannot add to the home screen, so telling their users to look
  for the option would send them hunting for a menu item that does not exist.
- **iPadOS 13+ reports a Macintosh user-agent**, so every naive `/iPad/` test
  classifies an iPad as a desktop. `maxTouchPoints` is the reliable tell.
- `format-detection: telephone=no` stops Safari turning wallet addresses and
  token amounts into blue "call" links.

### Responsive: phone, tablet, desktop

The shell was 520px wide with breakpoints at 900px and 1400px. **An iPad in
portrait is 768–834px — below 900** — so every tablet got the phone layout: a
520px strip of content with the fixed bottom nav stretched across the full
820px beneath it. The nav and the content it belonged to were visibly different
widths.

- New breakpoints at **≤360px** (small phones: three-up grids become two-up),
  **600–899px** (tablet portrait) and **landscape phone** (a phone on its side
  has ~350px of height; full-height sheets swallowed the screen).
- Hover effects are gated on `@media (hover: none)` — the *capability*, not the
  screen size. A tapped card used to stay stuck in its hover state until you
  tapped elsewhere, and looked selected when it was not.
- Third-party images (token logos, NFT art) can no longer overflow and push the
  page sideways.
- Horizontal overflow uses `overflow-x: clip`, **not** `hidden`: `hidden` turns
  the element into a scroll container, and a scroll container between a sticky
  element and the viewport silently kills the stickiness — the header would
  have scrolled away.

### The maskable icon was being cropped

One square image was declared for both `purpose: "any"` and
`purpose: "maskable"`. A launcher crops a maskable icon to its own shape and
only the middle 80% is guaranteed to survive, so on Android the outer neon ring
— the entire recognisable part of the logo — was sliced off. There is now a
separate `icon-maskable-512.png` with the art inside the safe zone.

## 1.5.2 — versionCode 16

### Fake money removed from the chrome

The header showed `useAppStore.balance` — **NX credits**, the play money used
by the arcade and paper-trading screens — next to the brand on *every* page.
So the first number a user saw on a non-custodial exchange was a fake balance
that looked like theirs. On a product whose entire promise is "you hold your
own keys", that was the most misleading pixel in the app. It is gone.

On **/wallet**, the real on-chain wallet now renders **above** the virtual
balance, the allocation pie and the paper history. Order is a claim about what
matters, and the real one leads.

### Fixed: intermittent freezing

`AdBanner` ran **eight** `repeat: Infinity` animations plus a ninth CSS sweep —
and it renders on **nine pages**, including Market, Swap and Wallet. Every one
of those screens therefore carried nine permanent animation timers *on top of*
the three blurred background orbs fixed in 1.5.1.

`useStill()` already existed for exactly this purpose and the banner simply
never called it. Not a missing feature — an unused one. All nine now freeze on
native and under `prefers-reduced-motion`.

### Contact

- **Telegram removed**; email is the contact route, in Contact *and* Settings.
- Added **X** ([@CompanyFbt](https://x.com/CompanyFbt)) and **LinkedIn**, with
  a proper X logo — `IconX` is the close/dismiss cross, and reusing it would
  have put a "close" glyph on a social link.
- The LinkedIn URL is stored **without** its `utm_source`/`utm_content`/
  `utm_medium` parameters, which would have told LinkedIn every visit came
  from an Android share sheet.

### Fixed: stale version string

Settings printed a hardcoded **`v1.0.0`** while the app shipped 1.5.x — a
version nobody updates points bug reports at the wrong build. It now comes
from `package.json` at build time.

## 1.5.1 — versionCode 15

### Fixed: the app could lock you out permanently

Reported as *"I went into settings, the app crashed, and it never worked
again."* The crash and the lockout were two different things, and the second
was the serious one.

Enabling biometrics persists `biometricEnabled: true`, and `AppLock` mounts
before everything else on every launch. A user with **no in-app vault and no
2FA** then had no way past it once the sensor stopped recognising them — and
because the flag survives a restart, force-quitting did not help. The only
exit was reinstalling, which for anyone who *did* have a vault destroys the
encrypted seed.

The lock screen now offers **"turn off the lock and open the app"** when no
other factor exists. That is safe precisely *because* there is no vault and no
second factor: there is no secret the button could expose. A settings toggle
must never be able to brick the app.

### Fixed: severe slowness, and the More-menu jitter

Both had the same root cause, and it was not the menu.

Three background orbs sized 60/55/48vw, each with `filter: blur(70px)`, drift
**forever behind every screen** — `RgbBackground` sits above the router and
never unmounts. That is roughly **a million blurred pixels recomposited every
frame, for the entire session**. On top of that, `.sheet-backdrop` blurs the
whole viewport, so opening any sheet stacked a full-screen backdrop capture on
those moving orbs.

A browser tab absorbs this. A Capacitor WebView cannot: it composites through
the host app, shares a GPU with the native layer, and gets none of the
browser's page-visibility optimisations. **This is why the APK felt heavier
than the website while running identical code.**

On native the orbs now render static — same palette, same depth, zero
per-frame cost — and the full-screen backdrop blur is dropped. The More menu's
own animation was already reduced to opacity+y with no per-tile springs; the
cost was always in what sat behind it. `prefers-reduced-motion` now freezes
the field everywhere, which it should have done from the start.

### Splash

- The mark is now an **F** for FBT. It was drawing a **B**.
- **Social links** under Start — Telegram, Instagram, email, reusing the exact
  accounts Contact already links to rather than a second invented list.
  `mailto:` is handled separately because `openUrl` accepts https only by
  design, so that button would have looked live and done nothing.

## 1.5.0 — versionCode 14

### New first-run experience

- **Splash screen.** Logo, app name and a single **Start** button. Animated
  entrances plus one slow orbiting ring — deliberately restrained, because the
  Ecosystem page shipped with nine permanent blur pulses and felt broken on a
  mid-range phone. Nothing here keeps running once the screen unmounts, and
  `prefers-reduced-motion` is honoured: a spinning first screen is a real
  accessibility problem on the one screen nobody can skip.

- **The language question is no longer asked twice.** Welcome asked for a
  language, then onboarding asked again as step 0. Two consecutive screens
  posing the same question read as a bug — before the user had seen anything
  the product does. Onboarding now opens on the first feature slide, and the
  language switch in its header opens a sheet instead (it had briefly been
  left with no handler at all, which is precisely the dead-control failure
  this project keeps hitting).

- **Default language is now English.** It was Persian, which meant anyone
  whose device gave no usable hint opened a right-to-left app in a script they
  might not read, and had to find the language control before doing anything.
  English is already the fallback locale, so it is the one language guaranteed
  to have every key translated — and Persian is one tap away on the next
  screen.

Flow is now: **splash → language + name → features → wallet → terms → guide → app**
(six steps, down from seven).

### Testing

Three existing suites asserted the old behaviour and correctly failed:
`boot-e2e` demanded Persian on first paint, `first-launch-flow` expected
Welcome first, `i18n-probe` expected `fa` to autoload. All three were updated
to the new intent rather than relaxed. Verified non-vacuous by disabling the
splash — five checks fail, including the real-browser boot test.

## 1.4.1 — versionCode 12

### Fee raised to 0.70% — no configuration needed

The default was 50 bps with a comment saying "set `VITE_FEE_BPS=70`". That
variable was never set, so **every build ever shipped at 0.50%** while the
reasoning sat in the source unused. A default nobody changes *is* the
configuration, so the default is now the intended rate.

Measured in-wallet rates, 2026: MetaMask 0.875%, Phantom 0.85%, Rainbow 0.85%,
Trust 0.70%, ZenGo 0.50%, Rabby 0.25% — median **0.70%**. We are now at the
median and still cheaper than the three largest wallets. **+40% revenue on
identical volume.**

`VITE_FEE_BPS` still overrides it, and the 100 bps hard cap is unchanged. A
unit test now asserts the default, so a silent revert fails CI instead of
quietly costing money.

### Removed: the fiat on-ramp

Shipped in 1.4.0 and removed one version later, because it could not work for
this app's actual users. MoonPay, Transak and Ramp all block Iran under OFAC
sanctions — the screen would have been a dead end for the primary audience.

The alternative was worse. On **2 June 2026** OFAC designated Nobitex, Wallex,
Bitpin and Ramzinex with **secondary sanctions**, meaning any non-US
institution that processes for them risks being cut off from the US financial
system. Integrating an Iranian exchange would expose the app, Google Play
distribution and the company itself. Neither path is available, so the honest
move is to ship neither rather than a button that fails.

What remains is the P2P screen, which already routes users to external desks
without us holding funds or acting as an intermediary.

## 1.4.0 — versionCode 11

### New: Buy crypto (fiat on-ramp) — the second revenue stream

A swap-only app can only earn from people who **already hold crypto**. This is
the step where someone with none becomes someone with a funded wallet, and
every future swap fee depends on it happening.

Measured 2026 wallet monetisation: swap fees run 0.4–1.0% of volume, on-ramp
referral pays roughly 0.3–1% of purchase value — and card buyers move far more
per transaction than the same person swapping later. It costs nothing to
build: the provider handles KYC, payments, fraud and compliance.

Three providers (MoonPay, Transak, Ramp) so users can compare rates, which
differ substantially. **We never take custody** — the coins go straight to the
user's own address, which is why a non-custodial app may do this at all: we
are an introducer, not a money transmitter.

Safety rules enforced in code, not just copy:
- A malformed or non-EVM address **refuses to build a URL**. A widget opened
  with no destination lets the *provider* pick one, and the user would buy
  into an address they do not control — unrecoverable.
- Amounts are capped and negatives dropped before reaching the provider.
- Chains the providers cannot settle on are blocked, rather than producing a
  failed purchase *after* payment.
- Opens in a Custom Tab so the real domain is visible. A payment page inside a
  WebView we draw is indistinguishable from a phishing page.
- The disclosure — that a third party takes the money and we cannot refund,
  cancel or trace it — appears *before* the user leaves.

### Fixed

- **NFT screen showed a meaningless error.** The live cause is `Alchemy 403`
  (the API key is revoked), but `serve()` flattened every failure into
  `UPSTREAM_FAILED`, for which no translation existed — so it rendered as a
  generic "something went wrong". Now 401/403 → "our key needs renewing",
  429 → rate limited, 5xx → provider down, each translated.

  `serve()` also leaked the raw upstream message into `detail`, and for
  Alchemy **the API key sits in the URL path** — so an error string could
  carry it to the browser. This route now emits fixed codes only.

- **Ecosystem restyled as glass**, for both themes. Not with
  `backdrop-filter`: see the note above `.card` explaining why it was stripped
  from repeating elements — the compositor must capture and blur the region
  behind *every* instance, every frame, and the background never stops moving.
  17 tiles of that would reintroduce exactly that stutter. The frost is built
  from a translucent tint, a top-left sheen and a hairline highlight, which
  cost nothing to composite. Light theme is defined separately because
  translucent white over white is invisible.

### Testing

- 18 new checks (266 unit + 72 wiring). One wiring check initially **passed
  when the code was deliberately broken** — the env var is built from a
  template literal, which defeated the regex. Rewritten to scan string
  literals; now verified to fail on the sabotaged version. A check that cannot
  fail is worse than no check, because it is trusted.

## 1.3.1 — versionCode 10

### Ecosystem screen rebuilt

The "buggy" feel was real and measurable, not cosmetic:

- **Nine permanent GPU animations.** Every card pulsed a `repeat: Infinity`
  halo built on an 80px `filter: blur(30px)`. Blur is the most expensive
  filter to composite, and nine running forever kept the GPU busy the entire
  time the screen was open — visible scroll jank on a mid-range phone, plus a
  real battery cost. Replaced with a static border and a cheap gradient wash.

- **It bypassed the safe link path.** It called `window.open` directly instead
  of `openUrl` (Custom Tabs). Inside the packaged app that opens a WebView
  with no address bar, so the user cannot see which domain they landed on and
  we are implicitly vouching for it. In a wallet that is a phishing surface,
  not a styling preference.

- **Real logos** instead of letter tiles, with a monogram fallback so a failed
  icon never leaves a hole in the grid.

- **Search**, and **17 entries** instead of 9 — added Uniswap, Arbitrum, Base,
  DefiLlama, DEX Screener, Chainlist, Rabby and Safe.

### Fixed

- **No web manifest existed.** The site could not be installed to a home
  screen at all, and wallets that read a dapp's manifest when drawing the
  connection dialog found a 404 where the name and icon should be.

### Notes on the AI assistant

"Ask" is wired correctly — the server reports `{"enabled":false}` because no
AI key is set. It is not broken code: with no key it falls back to the
hand-written FAQ, which is deliberate (a generated answer about our own fee
would be worse than a checked one). Setting `GROQ_API_KEY` in Vercel turns on
the general-question path. Groq has a free tier and is not geo-blocked.

### Testing

- 10 new wiring checks: no permanent animations, links go through the safe
  helper, every entry named in both languages, all links https, manifest
  present with icons that exist on disk, and the WalletConnect metadata icon
  resolving to a real file. 63 checks pass.
- The first version of the animation check matched its own explanatory
  comment and failed on correct code; it now strips comments before scanning.
  A test that flags prose teaches people to ignore it.

## 1.3.0 — versionCode 9

**"Orders & plans" is now "Auto Orders"** (`سفارش خودکار`) — the old name
described a filing cabinet; the feature is an assistant that watches the market
while you don't.

### New

- **Trailing stop.** Follows the price up and sells only after it falls a set
  percentage from the best level seen. This is what people actually mean by
  "let it run but don't give the gains back" — a fixed limit either sells too
  early or never triggers.

  The dangerous parts are the ones tested hardest: the peak **only ever rises**
  (a feed hiccup must not ratchet the stop downward and quietly disable it),
  the first observation can never trigger a sale (no drawdown exists yet), and
  an unknown price neither updates the peak nor fires.

- **Pause / resume.** Previously the only way to silence an alert was to delete
  it, discarding the settings — so anyone waiting out a volatile week had to
  rebuild the order afterwards, and most wouldn't. Resuming resets a stale
  trailing peak, otherwise a week-old high would trigger an instant sell, and
  reschedules a DCA from *now* rather than firing every missed run at once.

- **Trade size and fee, shown per order.** A DCA reports the value of *all
  remaining runs* — "$600 over six weeks" is the number needed before
  committing, not "$100". Unpriced tokens show nothing rather than `$0.00`,
  because a confident wrong number about money is worse than an absent one.

- **Scheduled summary** — how many orders are live and their total value.

### Honest limitations

- Trailing stops are tracked **only while the app is open**, and the screen
  says so before you create one. A trailing peak needs per-order state the
  server would have to keep, and the free-plan cron runs once a day; a
  trailing stop checked daily would miss the entire move. Target-price orders
  are still watched server-side and reach you with the app closed.

### Fixed

- **WalletConnect metadata pointed at a dead host.** The fallback URL was
  `fbtcryp.vercel.app`, which now returns `DEPLOYMENT_NOT_FOUND`. Wallets
  *fetch* this URL to draw "who is asking to connect", and a 404 is grounds to
  reject the request outright — so an unset `VITE_PUBLIC_URL` would have broken
  every connection with no visible cause.

### Testing

- 30 new engine tests covering the ratchet, the first-tick guard, feed
  outages, pause/resume state, and fee maths. Verified non-vacuous: breaking
  the ratchet fails four unit tests and one wiring check; breaking peak
  persistence fails another.
- 10 new wiring checks: every order type must be labelled *and* creatable, the
  fee must be disclosed, the trailing limitation must be stated, and the WC
  fallback must not be the dead host. 53 checks pass.

## 1.2.5 — versionCode 8

Five device-reported bugs. Four share one root cause: **a native capability
gated behind a web-only API check**, now the seventh and eighth instance of
that class in this project.

### Fixed

- **Notifications said "not available on this device."** `notificationsSupported()`
  tested only `'Notification' in window`, which a Capacitor WebView does not
  have. `pushMode()` had already been fixed to check native first — but
  Settings calls `notificationsSupported()` **directly**, re-implementing the
  same gate one level above the fix. Fixing a helper is not enough when a
  caller repeats its logic. Native now reports supported and uses FCM.

- **The QR scanner never asked for the camera.** Two independent causes, either
  alone sufficient:
  1. `CAMERA` was missing from `AndroidManifest.xml` — an app cannot prompt for
     a permission it never declared, so the OS refuses `getUserMedia()` before
     any dialog can appear.
  2. `scannerSupported()` required `BarcodeDetector`, absent from Android's
     WebView, so it returned UNSUPPORTED before even reaching the camera call.

  `BarcodeDetector` is now an optimisation rather than a requirement, with a
  **jsQR** fallback that runs anywhere a canvas does. Frames are downscaled to
  640px before decoding — scanning a full 8 MP frame in JS stutters the preview
  badly enough to look frozen. Verified by decoding a QR produced by our own
  generator.

- **WalletConnect approved but never came back.** `metadata.redirect` was
  absent, so the wallet had no route back to us. The session really was
  established; the user was just left sitting in the wallet app while
  `wc.connect()` awaited in a backgrounded WebView that Android may freeze
  before it settles. Now declares `ir.fbt.swap://`, matching the manifest
  scheme, with an https universal link for wallets that reject custom schemes.

- **The lock screen could strand its owner.** The password fallback was gated
  on `hasVault()`. A WalletConnect-only user has no vault, so a failed
  fingerprint left *no* way in — and reinstalling, the only escape, destroys
  the encrypted seed for anyone who does have one.

- **Two-factor codes are now useful.** TOTP was set up in Settings and then
  never asked for anywhere. It is now the lock fallback when no vault exists.
  When neither is configured, the screen says so and explains that reinstalling
  is safe *because* there is no vault to lose, rather than silently trapping
  the user.

### Testing

- Nine new wiring checks covering the capability probes themselves (not just
  their callers), both Android permissions, the WC redirect matching the
  manifest scheme, and the lock's fallbacks. Verified non-vacuous by
  reintroducing all three regressions — each fails its own check. 43 pass.

## 1.2.4 — versionCode 7

Release build for Google Play.

### Build

- **A signed build now refuses to ship without a working API base.**
  `VITE_API_BASE` is inlined by Vite at build time. If it is unset — or set as
  a repository *secret* when the workflow reads `vars.*` — the bundle silently
  keeps its `/api` default. Inside the APK that resolves against
  `https://localhost`, i.e. the phone itself, so every market, push and order
  request fails on a device while working perfectly in a browser.

  The previous check printed a warning, which is invisible in a 200-line log
  on a phone. It now **fails the build**, and not by trusting the environment
  variable: it greps the built bundle for the actual origin, so a value that
  never reached Vite is caught rather than assumed. Verified in both
  directions — present when set, absent when not.

  Only enforced for signed builds. An unsigned local build against a relative
  `/api` is legitimate, because the dev server shares the origin.

## 1.2.3 — versionCode 6

### Fixed

- **Biometric unlock never locked anything.** Settings had a working toggle:
  flipping it really did read the fingerprint and really did persist
  `biometricEnabled: true`. That was the entire feature. The flag was read in
  exactly two places, both inside `Settings.jsx` — once to prompt on flip,
  once to draw the switch. **No lock screen existed anywhere in the codebase.**

  Both reported symptoms follow exactly:
  - *"it reads the finger but the screen never closes"* — that prompt was for
    **enabling** the toggle, not for unlocking. There was nothing to close.
  - *"it never asks me to log in"* — nothing asked, because nothing was built
    to ask.

  This is worse than a missing feature. The user believed the app was locked
  and behaved accordingly while it was not, which makes a security setting
  that silently does nothing an active hazard rather than a cosmetic gap.

  Adds `src/components/AppLock.jsx`, mounted **before** onboarding, the guide
  and the router — anything above it would be readable by whoever picked up
  the phone. Locks on app open only (chosen deliberately: re-locking on every
  return from background trains people to dismiss the prompt reflexively).

  Falls back to the **wallet password**, verified by actually decrypting the
  vault rather than comparing a stored hash. Without a second door, a broken
  sensor or a removed fingerprint would lock the owner out permanently, and
  reinstalling destroys the encrypted vault.

  A cancelled OS prompt is reported neutrally rather than as "authentication
  failed" — cancelling is the common case, and the rejection must never read
  as a successful unlock.

### Testing

- New wiring check: every persisted security flag must be consumed **outside**
  the screen that sets it, plus assertions that the lock is mounted, ordered
  before any content screen, has a non-biometric fallback, and does not unlock
  from a `catch`. Verified non-vacuous by unmounting the lock — two checks
  fail. 34 checks pass.

## 1.2.2 — versionCode 5

Three API routes the app calls every day did not exist on the server. All
three were verified live against the production domain, and all three returned
`{"error":"NOT_FOUND"}`.

### Fixed

- **`GET /api/search`** — `fetchSearch` was imported in `server/app.js` and
  never routed. Coin search silently fell through to the public CoinGecko
  endpoint, which is rate-limited per user IP, so search bypassed our cache
  and spent the user's own quota instead of ours.
- **`GET /api/news`** — same shape: `fetchNews` imported, no route. Every
  device fetched public RSS directly, which is precisely the per-user fan-out
  that aggregating on the server exists to prevent (one upstream request a day
  for everyone, not one per user per open).
- **`GET /api/push/status`** — never written at all, though `src/lib/notify.js`
  has always called it. The 404 read back as `undefined`, so **every web user
  was pinned to device-only notifications** even with push fully configured.
  This is a second, independent cause of "notifications don't work", separate
  from the Android WebView gating fixed in 1.2.1 — that one was native-only,
  this one was web-only, and each hid the other.

  The route reports the **web** channel only. Native Android short-circuits to
  server mode before ever calling it, so answering with `web || fcm` would
  tell a browser the server can reach it over a channel a browser cannot
  receive on.

Why none of this showed up as an error: the client degrades instead of
failing. Search still returned results, news still filled the page,
notifications still appeared to be "on". The app just quietly ran slower,
rate-limited, and undeliverable, with nothing in any log to say so.

### Testing

- New wiring check: every `${API_BASE}/...` template in `src/` must resolve to
  a real route in `server/app.js`, plus the mirror check for a handler that is
  imported but never mounted — the exact shape this bug takes in a diff.
  Verified non-vacuous by renaming a route and confirming the check fails.
  This is the sixth time this bug class has shipped (push subscribe/unsubscribe,
  leaderboard, OTC send, swap prefill, order watch, and now these three), so it
  is now enforced rather than remembered. 25 wiring checks pass.

## 1.2.0 — versionCode 3

The theme of this release is that several features looked finished and were
not. Each item below names the failure, because "improved notifications" would
hide the part worth knowing.

### New

- **Limit orders and DCA plans** (`/orders`). Set a target price, or buy a
  fixed amount on a schedule. Alerts arrive with the app closed; the swap is
  one tap from the notification, pre-filled.
  These are alerts, not automatic fills. The server holds no key and never
  will, so nothing can sign for a user — the screen says so before an order is
  created, because a limit order that silently does not fill is worse than no
  feature at all.
- **Receive** with a QR code, so the in-app wallet can be funded. Uses a tested
  encoder: a subtly wrong QR still scans, it just decodes to a different
  address, and the funds are gone. The generated code is verified against our
  own scanner's parser in the test suite.
- **NFT viewer** — read-only, over five networks. Every string is
  attacker-supplied (anyone can mint into any wallet), so markup, control
  characters and Unicode bidi overrides are stripped server-side, and images
  must be https.
- **Explorer** (`/explore`) — identifies what you pasted and opens the right
  chain's explorer. Deliberately not a real indexer: one that misses a
  transaction convinces a user their money vanished, and the usual reaction is
  to send again.
- **Discover** (`/discover`) — curated sites opened in the system browser via
  Custom Tabs, with no address bar. Free typing inside a wallet is a phishing
  delivery mechanism, and an embedded WebView is a window we draw, so we would
  be the ones vouching for a site's identity.
- **Ask** in Help now answers general crypto questions too, with web search,
  while staying locked to our own documentation for anything about this app.

### Fixed

- **Order alerts never worked in the Android app.** A Capacitor WebView has no
  Push API, so registration returned UNSUPPORTED and exited. The toggle
  appeared to succeed and no APK user ever registered anything. Now routed over
  FCM. Requires `android/app/google-services.json`.
- **The swap screen claimed "this app takes no fee"** twenty lines above a line
  reading "Platform fee 0.5%". A user who catches the app being wrong about its
  own fee has no reason to trust the irreversibility warnings either.
- **"Buy when it rises" was unusable.** The rate is always `1 FROM = ? TO`, so
  buying BNB above 700 meant entering `0.00142857` and picking *below*. The
  obvious attempt set the exact opposite. Targets can now be priced in either
  token.
- **P2P crashed on open** — `chain.tokens[0]`, but the token lists live in a
  separate map. The page was not in the smoke tests; eight more screens are now.
- **The leaderboard could never load.** `readLeaderboard` was imported but no
  route was ever mounted, so the client reported a network failure for an
  endpoint that did not exist. Push had the same bug.
- **Nested modals froze scrolling permanently.** The scroll lock restored a
  saved value, so out-of-order release left `overflow: hidden` forever.
  Reference-counted now.
- **A button showed the literal text `common.close`** after a successful
  transfer.

### Performance

- Entry chunk **528 KB → 168 KB**. All twelve locales were static imports, so a
  Persian user downloaded eleven languages before the first frame could paint.
- Removed a full-page `filter: blur()` on every navigation and eleven stacked
  `backdrop-filter`s per screen. Neither is a compositor property, so both
  forced a full repaint each frame.
- Fixed scrolling: `height: 100%` pinned the document to one viewport, so long
  pages were unreachable below the fold.

### Store & compliance

- targetSdk 35, `POST_NOTIFICATIONS`, AAB output.
- Arcade code is compiled out of the store build, verified by asserting on the
  emitted files rather than trusting a flag.
- Play listing copy, icon and feature graphic in `store/`.

### Revenue

- The platform fee is now configurable via `VITE_FEE_BPS`, capped at 1%.
  Measured peer fees: MetaMask 0.875%, Phantom 0.85%, Trust Wallet 0.70%. At
  0.50% we are below market; `VITE_FEE_BPS=70` is +40% on identical volume.
- Documented why Hyperliquid builder codes and an NFT revenue share are not
  viable for an Iranian company, with the arithmetic, rather than leaving them
  on a wishlist.

---

## 1.1.1 and earlier

See the GitHub releases page.
