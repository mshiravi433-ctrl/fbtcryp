/**
 * APP IMAGE — contract probe (Dockerfile + ci/docker-image.yml + .dockerignore)
 * ============================================================================
 *
 * The mirror image is insurance against the Vercel soft block: it exists so
 * there is a way to serve the real app on a host that does not meter CPU. That
 * makes three files load-bearing to a degree no other file in this repo is:
 *
 *   · `Dockerfile` — if it loses the build.env hookup, the image LOOKS fine and
 *     silently ships a bundle without WalletConnect, web-push or fee display.
 *   · `Dockerfile` — if it loses the `ci/*.env.sh` sourcing, every Farm adapter
 *     compiles to null and the mirror serves a read-only Farm. That exact bug
 *     is documented at the top of ci/farm-rollout.env.sh, so it is not
 *     hypothetical: it already happened once, on the website build.
 *   · `ci/docker-image.yml` — it is copied to `.github/workflows` BY HAND (app
 *     tokens may not write there), which means it is edited in a place nothing
 *     executes. A broken workflow would be discovered at the worst moment:
 *     when the site is already down and the image is the way back up.
 *
 * Nothing here needs Docker. It reads the files and asserts the contract, so it
 * runs in a second and fails on the commit that breaks the image, not the night
 * someone needs it.
 *
 *   node test/docker-image-probe.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: Boolean(ok), extra });
};

/* ═══════════════════════════════ Dockerfile ═══════════════════════════════ */

const dockerfile = read('Dockerfile');
/* Comments explain WHY; they must not be able to satisfy a rule about what the
   image actually does. So every assertion below reads code, not prose. */
const dockerCode = dockerfile
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

check('Dockerfile is a multi-stage build (builder needs ~4 GB, runtime does not)',
  (dockerfile.match(/^FROM\s+/gm) || []).length >= 2);

check('runtime never runs as root',
  /^USER\s+node\s*$/m.test(dockerCode) && !/^USER\s+root\s*$/m.test(dockerCode));

check('runtime serves on the container port the hosts expect',
  /^ENV[\s\S]*?PORT=8787/m.test(dockerCode) && /^EXPOSE\s+8787\s*$/m.test(dockerCode));

check('server binds all interfaces (a container behind a proxy needs 0.0.0.0)',
  /^ENV[\s\S]*?HOST=0\.0\.0\.0/m.test(dockerCode));

check('HEALTHCHECK asks the app’s own /api/health',
  /HEALTHCHECK[\s\S]*?\/api\/health/.test(dockerCode));

check('the built frontend is copied from the build stage into the runtime image',
  /COPY\s+--from=build\s+\/app\/dist\s+\.\/dist/.test(dockerCode));

check('the API’s runtime sources are present (server/ + src/lib + api/)',
  /COPY\s+server\s+\.\/server/.test(dockerCode) &&
  /COPY\s+src\s+\.\/src/.test(dockerCode) &&
  /COPY\s+api\s+\.\/api/.test(dockerCode));

const npmCiLines = dockerCode.split('\n').filter((line) => /npm ci\b/.test(line));
check('both npm ci calls pass --force (the lockfile pins macOS-only fsevents)',
  npmCiLines.length >= 2 && npmCiLines.every((line) => line.includes('--force')),
  npmCiLines.filter((line) => !line.includes('--force')).join(' | '));

/* ── build-time public configuration ─────────────────────────────────────── */

check('build.env is turned into .env.production inside the build stage (VITE_* are compile-time)',
  /build\.env/.test(dockerCode) && /\.env\.production/.test(dockerCode) && /\bmv\b/.test(dockerCode));

check('a missing build.env WARNs instead of failing the build',
  /no build\.env/i.test(dockerCode));

check('the log prints VITE key NAMES only (values are not echoed)',
  /cut -d= -f1/.test(dockerCode) && !/cat \.env\.production/.test(dockerCode));

/* ── parity with the production web build ────────────────────────────────── */

check('build sources ci/farm-rollout.env.sh (or every Farm adapter compiles to null)',
  /\.\s+\.\/ci\/farm-rollout\.env\.sh/.test(dockerCode));

check('build sources ci/web-season.env.sh (futures history gating)',
  /\.\s+\.\/ci\/web-season\.env\.sh/.test(dockerCode));

check('the two flags build:full passes inline are passed here too',
  /VITE_ENABLE_SPECULATION=true/.test(dockerCode) && /VITE_ENABLE_SPOT_TRADE=true/.test(dockerCode));

check('VERCEL_ENV and FARM_CAPITAL are build-args, not hard-coded',
  /ARG\s+VERCEL_ENV=production/.test(dockerCode) && /ARG\s+FARM_CAPITAL=on/.test(dockerCode));

check('runtime CMD is the long-running server (not the serverless handler)',
  /CMD\s+\[\s*"node"\s*,\s*"server\/index\.js"\s*\]/.test(dockerCode));

check('the Mission Control data dir exists before chown (first boot must not need mkdir rights)',
  /mkdir -p \/app\/data/.test(dockerCode));

/* ═════════════════════════════ .dockerignore ══════════════════════════════ */

const ignore = read('.dockerignore');
const ignoreLines = ignore
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

for (const entry of ['node_modules', 'dist', '.git', '.env', '.env.*', 'test', 'docs', 'public/whats-new.json']) {
  check(`.dockerignore excludes ${entry}`, ignoreLines.includes(entry));
}

/* The two most dangerous over-exclusions: the build reads both. */
for (const entry of ['ci', 'CHANGELOG.md', 'scripts', 'public']) {
  check(`.dockerignore does NOT exclude ${entry} (the build reads it)`, !ignoreLines.includes(entry));
}

/* ══════════════════════════ ci/docker-image.yml ═══════════════════════════ */

const workflow = read('ci/docker-image.yml');
const wfCode = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

check('the workflow can push packages', /packages:\s*write/.test(wfCode));
check('it is runnable by hand (workflow_dispatch) — that is how the first image is built',
  /workflow_dispatch:/.test(wfCode));
check('it also runs on main when the image inputs change',
  /branches:\s*\n\s*-\s*main/.test(wfCode));
check('it pins linux/amd64 (Render and Koyeb do not run arm images)',
  /platforms:\s*linux\/amd64/.test(wfCode));
check('it tags the image with both latest and the commit sha (rollback needs the sha)',
  /:latest/.test(wfCode) && /github\.sha/.test(wfCode));
check('build-time config comes from the repository variable VITE_ENV_FILE',
  /vars\.VITE_ENV_FILE/.test(wfCode));
check('the variable is written to build.env for the Dockerfile',
  />\s*build\.env/.test(wfCode));
check('a malformed or secret-looking VITE_ENV_FILE fails before the build burns 20 minutes',
  /Malformed VITE_ENV_FILE/.test(wfCode) && /Secret-looking VITE_ key/.test(wfCode));
check('the image is smoke-tested for a real boot, not just for existing',
  /Smoke test/.test(wfCode) && /api\/health/.test(wfCode) && /docker run/.test(wfCode));

/* The only file allowed to carry build-time values into the context. */
check('the workflow writes build.env and nothing else into the context',
  !/echo[^\n]*>\s*\.env/.test(wfCode));

/* ═════════════════════════════════ report ═════════════════════════════════ */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.extra ? ` — ${r.extra}` : ''}`);
}
console.log(`\napp-image probe: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('The mirror image is the fallback for a paused deployment — a rule above exists because breaking it is silent.');
  process.exit(1);
}
console.log('✓ Dockerfile, .dockerignore and ci/docker-image.yml agree on the contract');
