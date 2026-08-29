import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * STRIP LOCALE COPY FOR FEATURES THAT ARE NOT IN THIS BUILD.
 * ---------------------------------------------------------------------------
 * ─── WHY A BUILD PLUGIN AND NOT A RUNTIME FILTER ────────────────────────────
 * APKPure rejected the app: "Not involve illegal sensitive words."
 *
 * Gating the routes behind __SPECULATION_ENABLED__ removed the screens and
 * their chunks — verified, zero Predict/Perp/Invest chunks are emitted. But
 * the WORDS survived, because the locale files are STATIC imports: Rollup
 * inlines the whole JSON long before any runtime code could delete a key. I
 * tried the runtime filter first and measured that it changed nothing —
 * "Price prediction" and "Call the next candle — up or down" were still
 * sitting in the entry chunk.
 *
 * A content filter scans strings, not routes. Shipping a build with the
 * screens removed but their vocabulary intact would fail review for exactly
 * the same reason, while looking like the problem had been fixed.
 *
 * So the keys are removed from the JSON as it is loaded, before bundling.
 *
 * ─── WHY THIS CANNOT BREAK A SCREEN ─────────────────────────────────────────
 * The same flag controls the route and the copy, so they can never disagree:
 * text is only ever removed for a screen that does not exist in that build.
 * With the flag on, nothing is stripped at all.
 */
function stripDisabledLocaleCopy() {
  const speculation = process.env.VITE_ENABLE_SPECULATION === 'true';

  /*
   * The arcade is no longer a flag — the code and its locale namespace were
   * deleted outright (see src/lib/features.js). Nothing to strip for it.
   */

  /* Top-level namespaces to drop, and the nav labels that point at them. */
  const drop = speculation ? [] : ['predict', 'perp', 'invest', 'ostium', 'dydx', 'derivatives'];
  const navDrop = speculation ? [] : ['predict', 'perp', 'invest', 'ostium', 'dydx', 'derivatives'];

  return {
    name: 'strip-disabled-locale-copy',
    // `pre` so this runs before Vite's own JSON handling turns the file into
    // an ES module; at that point it is still plain text we can parse.
    enforce: 'pre',
    transform(code, id) {
      if (!drop.length && !navDrop.length) return null;
      if (!/\/src\/i18n\/locales\/[a-z-]+\.json$/.test(id)) return null;

      let data;
      try {
        data = JSON.parse(code);
      } catch {
        // A malformed locale is a different problem; let the normal loader
        // report it rather than failing here with a confusing message.
        return null;
      }

      for (const key of drop) delete data[key];
      if (data.nav) for (const key of navDrop) delete data.nav[key];

      /*
       * Quest copy referencing removed screens. These are dead keys — no code
       * reads them — but a content filter reads STRINGS, not call graphs, and
       * "ثبت یک پیش‌بینی قیمت" ("place a price prediction") survived in the
       * Persian chunk after everything else was clean. Found by grepping the
       * built output rather than by reasoning about it.
       */
      if (data.earn?.quest) {
        data.earn = { ...data.earn, quest: { ...data.earn.quest } };
        if (!speculation) delete data.earn.quest.firstPredict;
      }

      return { code: JSON.stringify(data), map: null };
    }
  };
}

/**
 * STRIP THE SPECULATIVE INTENT VOCABULARY FROM A STORE BUILD.
 * ---------------------------------------------------------------------------
 * Same problem, same answer as the locale strip above: a content filter reads
 * strings, and the Persian word for "leverage" in an intent parser's
 * vocabulary fails review exactly like the word in a screen title does.
 *
 * The difference is that this vocabulary is real and needed — on the website
 * build, where the margin venue exists. So it is not deleted, it is gated:
 * when the flag is off the module is replaced with an inert stub, and a build
 * that cannot offer leverage also cannot recognise a request for it. The
 * customer is told the venue is unavailable instead of being shown a route
 * into a screen that is not in the binary.
 */
function stripSpeculativeVocabulary() {
  const speculation = process.env.VITE_ENABLE_SPECULATION === 'true';
  const STUB = `
export const SPECULATIVE_SCHEMA = 'fbt.speculative-lexicon.v1';
export const FUTURES_ACTION_STEMS = Object.freeze([]);
export const SPECULATE_RISK_STEMS = Object.freeze([]);
export function leveragePattern() { return /(?!)/; }
export function detectLeverageText() { return null; }
export const PERPS_LABELS = Object.freeze({});
export const SPECULATIVE_VOCABULARY_PRESENT = false;
`;
  return {
    name: 'strip-speculative-vocabulary',
    enforce: 'pre',
    transform(code, id) {
      if (speculation) return null;
      if (!/\/src\/lib\/intent-ai\/speculativeLexicon\.js$/.test(id)) return null;
      return { code: STUB, map: null };
    }
  };
}

export default defineConfig({
  plugins: [react(), stripDisabledLocaleCopy(), stripSpeculativeVocabulary()],

  /*
   * `@dydxprotocol/v4-client-js` imports `https-proxy-agent` even though the
   * browser order path never supplies a Node proxy. Alias that optional helper
   * to a tiny browser-only implementation so Vite does not pull `net`, `tls`
   * and `assert` into the dYdX lazy chunk.
   */
  resolve: {
    alias: {
      'https-proxy-agent': fileURLToPath(new URL('./src/shims/https-proxy-agent.js', import.meta.url))
    }
  },

  /**
   * Build-time literals.
   *
   * These must be bare `true`/`false`, not `import.meta.env` lookups. Vite
   * substitutes those too, but the result is a STRING comparison and Rollup
   * cannot then prove a `lazy(() => import(...))` branch is dead — which is
   * how a 22KB chunk once shipped inside a build that was supposed to exclude
   * it. A literal lets Rollup drop the dynamic import entirely, verified by
   * asserting on the emitted filenames in test/run.mjs.
   *
   * There is no arcade flag any more: the games were deleted from the
   * repository rather than gated, so there is no branch left to prove dead.
   */
  define: {
    /*
     * Prediction / perpetuals / invest. Off unless explicitly enabled — see
     * the long note in src/lib/features.js: these are what got the app
     * rejected by APKPure for "illegal sensitive words", they earn nothing
     * because they run on virtual credits, and a literal here is what lets
     * Rollup prove the lazy imports are unreachable and drop the chunks.
     */
    __SPECULATION_ENABLED__: JSON.stringify(process.env.VITE_ENABLE_SPECULATION === 'true'),
    /*
     * Version string, read from package.json at build time.
     *
     * Settings used to print a hardcoded 'v1.0.0' while the app shipped 1.5.x.
     * A version nobody remembers to update is worse than none: a bug report
     * quoting it points at the wrong build entirely.
     */
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
    )
  },
  server: {
    host: true, // so a tunnel (ngrok/cloudflared) can reach the dev server
    port: 5173,
    /*
     * Vite 5 rejects Host headers it does not recognise, which is the right
     * default (it prevents DNS-rebinding against a dev server) but breaks
     * every tunnelling setup: ngrok, cloudflared and hosted preview sandboxes
     * all serve the dev server under a hostname Vite has never seen, and the
     * failure is an opaque 403 rather than anything that names the cause.
     *
     * DEV SERVER ONLY. `vite preview` and the production build ignore this
     * entirely, and nothing here is reachable from a deployed site.
     */
    allowedHosts: ['.e2b.app', '.ngrok-free.app', '.ngrok.io', '.trycloudflare.com', 'localhost'],
    proxy: {
      // keep API keys server-side even in dev
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          charts: ['recharts'],
          i18n: ['i18next', 'react-i18next']
        }
      }
    }
  }
});
