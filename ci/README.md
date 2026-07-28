# Building the APK from your phone

> ### ⚠️ Builds failing? Read [`docs/APK-FA.md`](../docs/APK-FA.md) first
> The most common failure is pasting the *filename* instead of the file
> *contents* into the workflow editor. That produces a 17-byte file and every
> run dies in 0 seconds. Use the 26-line minimal config in
> [`ci/build-apk-minimal.yml`](build-apk-minimal.yml) — far easier to copy on
> a phone than the 105-line full version.


You don't need a computer. GitHub compiles the APK on its own servers — you
just need to add one file, which you can do from a mobile browser.

This repository is **public**, so GitHub Actions minutes are **free and
unlimited**. The build takes roughly 5–8 minutes.

---

## Step 1 — Create the workflow file (once, ~2 minutes)

GitHub blocks apps from adding workflow files, so you have to create this one
yourself. Do it from your phone's browser:

1. Open the repo: **github.com/mshiravi433-ctrl/fbtcryp**
2. Make sure the branch selector shows **`arena/019fa427-fbtcryp`**
3. Tap **Add file** → **Create new file**
4. In the filename box type exactly:

   ```
   .github/workflows/build-apk.yml
   ```

   (Typing `/` creates folders automatically.)
5. Open **`ci/build-apk.yml`** in another tab, tap the **copy** (⧉) button,
   and paste the whole contents into the editor.
6. Scroll down, tap **Commit changes** → **Commit directly to the
   `arena/019fa427-fbtcryp` branch**.

> Tip: on the GitHub mobile *app* you can't easily create files. Use a browser
> (Chrome/Safari) and, if the editor is awkward, tap **Aa** → *Request desktop
> site*.

The build starts the moment you commit.

---

## Step 2 — Download the APK

1. Go to the **Actions** tab
2. Tap the newest run — wait for the green ✓ (5–8 min; you can close the page
   and come back)
3. Scroll to **Artifacts** → tap **`FBT-Swap-apk`**
4. It downloads a `.zip`. Open it with your phone's file manager and extract
   the `.apk` inside.

**Prefer a direct download with no unzipping?** Publish a Release instead:

- **Actions** → *Build Android APK* → **Run workflow** → tick
  **Also publish a GitHub Release** → **Run workflow**
- When it finishes, the APK is attached to the
  [Releases](../../releases) page and installs with one tap.

Android will warn about installing from an unknown source — that's normal for
any APK outside the Play Store. Allow it for your browser, install, then turn
the permission back off.

---

## Step 3 (optional) — Wire up your keys

Without these the app still builds and runs; it just won't collect fees or
offer WalletConnect. Add them under
**Settings → Secrets and variables → Actions → Variables → New repository
variable**, then re-run the workflow.

| Variable | What it does |
|---|---|
| `VITE_FEE_ROUTER_ADDRESS` | Your deployed FeeRouter — **required for the 0.5% revenue**. The fee wallet (`0xaf5C…24d6`) is already baked into the contract; this variable is the *contract* address you get after deploying. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables MetaMask/Trust connect (free at cloud.reown.com) |
| `VITE_FIREBASE_API_KEY` | Firebase web config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase web config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase web config |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase web config |
| `VITE_FIREBASE_SENDER_ID` | Firebase web config |
| `VITE_FIREBASE_APP_ID` | Firebase web config |

All of these are **public client-side values** — they get compiled into the JS
bundle and anyone can read them. That is normal and expected. Never put a
private key or a Firebase service-account key here.

---

## Why not Vercel / Netlify?

They build **websites**, not Android apps — there's no Android SDK or JDK on
their runners, so they cannot produce an `.apk`. They're excellent for hosting
the web version (and the Telegram Mini App), and you should use them for that.
Only GitHub Actions, Codemagic, Bitrise, Expo EAS or similar CI services can
compile Android binaries.

Recommended split:

- **Vercel** → hosts the web app + Telegram Mini App URL
- **GitHub Actions** → builds the APK

---

## Troubleshooting

**Build fails at "Install dependencies"** — usually a lockfile mismatch. Re-run
the job; if it persists, check that `package-lock.json` was committed.

**Build fails at `assembleDebug`** — open the failed step and read the last
~20 lines. The most common cause is a JDK/Gradle mismatch; this workflow pins
JDK 17 because Capacitor 6 ships Gradle 8.2.1, which does not support JDK 21.

**"Resource not accessible by integration"** — the workflow needs
`contents: write` (already set) for the Release step. If it still fails, go to
**Settings → Actions → General → Workflow permissions** and choose
**Read and write permissions**.

**App installs but shows a blank screen** — the web build failed silently.
Check the *Build web bundle* step in the log.
