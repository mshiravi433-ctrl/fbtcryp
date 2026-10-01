# Intent OS operational repair

## User-visible changes

- The structured OS card is the sole renderer of its transcript and option explanations. The same text remains in conversation history, without being printed twice.
- Human↔agent risk choices and short replies are bound to their originating negotiation. Persian `متوسط / متعادل` selects balanced. Negated or conflicting risk answers are not treated as a grant. Consumed, expired and superseded offers cannot open another plan; stable event IDs avoid timestamp collisions.
- Choices preserve capital, target, minimum-return floor, horizon and risk. Missing fields use validated seeded intake rather than fabricated examples. Emergency/new-topic requests can interrupt intake.
- Persian strategy presentation is immutable: limits, feasibility, variable APYs, stress proxies, missing gas/bridge reads, comparison explanations, stages and stage handoff messages are localized. Executable routes, amounts, capabilities and receipt contracts stay canonical. Language changes apply at render time.
- Previewing a comparison row is not adopting it. The explicit build button re-reads sources and creates a separate selected-blueprint plan. Previous progress and receipts stay intact; unavailable/out-of-band choices are refused.
- Operations have a primary action and, where useful, a separate related-page button. Analysis and quotes run in chat; goals open actual intake; monitor lists open monitoring history; orders/monitors open their real forms. Wallet-required actions open connection instead of becoming dead disabled buttons.
- Reward operations call the existing scoped summary/missions/referral clients and display returned values. Missing values are not fabricated as zero. Points are explicitly not cash or guaranteed yield. ETH/SOL staking and tokenized-gold shortcuts open supported in-app product surfaces.
- Opening Operations Center/history/status by a direct chat command is deterministic and does not depend on a remote navigation provider.

## Safety and scope

- Council roles are rule-based internal checks, not a claim that independent remote models were contacted. Guardian/risk vetoes cannot be overridden by explicit approvals. Null evidence is unknown, not zero. Incomplete costs, stale quotes and excessive estimated drawdown require revision.
- Human↔human confirmation records only local acceptance. It does not contact a counterparty, verify their signature, open escrow or begin execution.
- Emergency stop requires explicit confirmation. It invokes owned server control-job pause clients and atomically halts/disarms local controls, clears queued unsigned proposals and waiting local execution state, and preserves open positions/cash/receipts. Partial/unavailable reads or pauses are reported. It cannot cancel a transaction already sent to a chain or close an open trade.
- Strategy capital is bounded at $10M and return targets at the existing product ceiling. Generated signed actions above $400k are split into exact capped USD chunks with matching prefilled routes, additional gas transaction counts and separate receipt indices. Every chunk requires its own fresh venue quote, confirmation and signature. Legacy oversized or unknown-amount signed actions cannot advance or produce an armed handoff.
- The wallet lease had a re-export but no local binding for its default duration. The missing import is restored, with a regression for writing a lease without `minutes`; shared duration policy is unchanged.
- No mock signer, auto-broadcast, guaranteed-return claim or fabricated upstream source is introduced. An unavailable external agent remains unavailable. This is an application repair, not permission to execute financial actions.

## Reproducible verification

```sh
npm run test:intent-os-repair
npm run test:phase213-all
npm run test:strategy-loop
node test/intent-ai/strategy-brain-probe.mjs
node test/intent-ai/strategy-locales-probe.mjs
node test/intent-ai/ops-center-probe.mjs
node test/intent-ai/ops-i18n-probe.mjs
node test/intent-ai/chat-route-contract-probe.mjs
npm run build:full
```

The focused repair command passed 88 Vitest assertions (7 files) and 20 mounted-page checks. The mounted probe drives the real main handlers, persists a $1,000 / 20% / 20-day balanced plan, builds a fresh alternative while preserving the old record, opens monitoring history (including a shared section URL), interrupts intake with an emergency, reads Rewards through the real client, and reaches the real pause clients only after consent. Only network/chain responses are fixtures; these tests are not proof of a real wallet signature or live upstream availability.

Additional executed suites: phase213 pure 103/103 and mounted 27/27; strategy brain 168/168; strategy locales 27/27; operations 51/51; operations translations 33/33; route contract 18/18; guided flow/limits 48/48. The strategy execution/return suite passed its receipt/preflight/venue unit checks and mounted chat/wallet/return/venue-return checks; the added Persian stage-handoff regression also passed.

Full production `build:full` completed, including API-function load verification. IndexNow was unreachable and the existing script reported that as nonfatal. Existing Vite chunk/namespace/deprecation warnings remain.

**The monolithic `npm test` is not claimed green.** After the wallet-lease import repair it progressed through the wallet stack and mounted connect sheet, but the classic IIFE child build was killed with exit 137 on this 4GB sandbox. It also printed two unrelated existing source-layout assertions (equity `.btn-row`, Perp CTA icon) in files unchanged by this repair. The runner documents `FBT_TEST_PREBUILT`/heap options for constrained hosts. Focused suites and actual production builds are separate successful checks, not a substitute claim that the entire repository passed.

The focused repair command is also wired into the default runner in an isolated child process, so its network fixtures do not pollute other suites. Deployment must be established from the merged commit's production deployment status and public assets, not inferred from a local build or a pushed branch.
