# Intent OS — FBT Neural Command (2026-10-11)

## Scope / integration audit

`/#/intent` mounts `src/components/IntentAIUnified.jsx` (`/intent-ai` redirects there). `src/pages/IntentOS.jsx` is a legacy, unrouted surface. This change adds `src/styles/neural-command.css`, scoped beneath `.iaos-page.nc-page`, and the lightweight `NeuralCore` mark. It does not change the wallet, authentication, server API, transaction signing, router configuration, message persistence, conversation engine or global app design tokens. The existing four tabs, action drawer, question ledger, quote review, approval gate, agents, operations, history and system-status panels remain connected to their existing handlers.

### Truthful states

- Header availability comes from the existing `serverReachable` probe; model count only appears after the providers request reports `ready` and names `ACTIVE` providers.
- Automation/monitor status comes from the returned record, not an `ACTIVE` fallback. Creation templates are separate from running agents. Last execution and errors appear only when supplied. Agent details expose only backend-provided permissions and tools.
- The live analysis timeline shows started steps, not planned steps; a produced answer does not retroactively mark every step complete. Pending approval and in-flight execution have separate labels. The existing receipt/quote review continues to determine actual execution results.
- Timeline timestamps are shown only if the source step supplies a timestamp. No invented progress percentage, confidence metric or transaction outcome is added.

### Navigation / unsupported modules

More links to existing `/global`, `/smart-money`, `/`, `/portfolio`, `/wallet`, `/swap`, `/bridge`, `/farm`, `/loan`, `/security`, `/settings`, and existing operations/history/status/intelligence/ecosystem panels. Futures links are shown only when `SPECULATION_ENABLED` is true (matching `App.jsx`). Goals/strategies initiate the existing chat flow. There is no dedicated Risk Center or RWA route in `App.jsx`; these are disclosed, not linked. A dedicated agent permissions editor, universal agent-progress backend, and separately verifiable 9-stage execution endpoint are not exposed by the current integrations, so the UI does not pretend they exist. Attachment means the existing action/context sheet; file uploads are not supported by this chat API.

### Verification

- `npm run build` passes (with the local native optional npm bindings installed for this sandbox). The existing bundle-size warning remains.
- `npm run test:phase213-ui`: 32/32; `npm run test:activity-tab`: 6/6; `npm run test:intent-os-repair`: 88 unit checks + 20/20 UI; `npm run test:strategy-chat`: 20/20; `npx vitest run test/neural-command.test.jsx test/intent-os-actions-ui.test.jsx`: 11/11; `npm run test:ai-theme` passes.
- The broad `node test/run.mjs` reached its IIFE build but the sandbox killed that child for memory (exit 137). Earlier in the run, an unrelated pre-existing Perp virtual-credit icon check failed. `test:goal-chat` fails 3 assertions on both this branch and the original commit: the input lacks capital and the existing multi-slot collector asks the user for it instead of inventing a plan. Neither issue was “fixed” by changing financial behavior in this visual redesign.
