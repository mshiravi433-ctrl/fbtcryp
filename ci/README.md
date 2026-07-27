# Activating the APK build workflow

GitHub blocks apps from creating workflow files without the `workflows`
permission, so this file ships here instead of in `.github/workflows/`.
**You** can add it in one command (your own account has the permission):

```bash
mkdir -p .github/workflows
git mv ci/build-apk.yml .github/workflows/build-apk.yml
git commit -m "ci: enable Android APK build"
git push
```

Or via the GitHub web UI: **Actions → New workflow → set up a workflow
yourself**, then paste the contents of `build-apk.yml` and commit.

The first run starts automatically on push. When it finishes, the APK is under
**Actions → the run → Artifacts → FBT-Swap-apk**.

## Optional repository variables

Set these under **Settings → Secrets and variables → Actions → Variables** so
the built APK has WalletConnect, the fee contract and Firebase wired up. All of
them are public client-side values — do not put private keys here.

| Variable | Purpose |
|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables WalletConnect (free at cloud.reown.com) |
| `VITE_FEE_ROUTER_ADDRESS` | Your deployed FeeRouter — **required for the 0.5% fee** |
| `VITE_FIREBASE_API_KEY` | Firebase web config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase web config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase web config |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase web config |
| `VITE_FIREBASE_SENDER_ID` | Firebase web config |
| `VITE_FIREBASE_APP_ID` | Firebase web config |

Without `VITE_FEE_ROUTER_ADDRESS` the app still works — it just swaps directly
against PancakeSwap and collects no fee.
