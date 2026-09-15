# CI is not producing an APK — one file you must paste yourself

## What is actually broken

Every recent **Build APK** run has failed at step **5 of 8**:

```
✓ Set up job
✓ actions/checkout@v4
✓ actions/setup-node@v4
✓ actions/setup-java@v4
X android-actions/setup-android@v3     <-- dies here
- bash ci/build-both.sh                (skipped)
- actions/upload-artifact@v4           (skipped)
- softprops/action-gh-release@v2       (skipped)
```

Runs 34897787077, 34913374862, 34913510957, 34914591474 — all the same.

The job dies **before npm, Vite, Capacitor or Gradle run at all**. Nothing in
this repository's own code is involved. That is why:

* no new APK has been published — the `latest` release still holds an **old**
  binary;
* the Trust Wallet deep-link fix (commit `dd09bdc`) looks like it "did not
  work" on the phone. It was never in a build you installed. The source fix is
  correct and unchanged; it simply has not shipped.

The upstream action re-downloads the Android command-line tools from
`dl.google.com` on every run and hard-fails when Google rotates the archive
name (upstream issue android-actions/setup-android#536).

## The fix (already committed)

* `ci/ensure-android-sdk.sh` — new. Uses the Android SDK **already installed on
  the GitHub runner image** and only downloads anything if none exists, trying
  several known archive revisions so one rotated filename cannot stop the build.
* `ci/build-apk.sh` — self-heals: if no `sdkmanager` is visible it provisions
  one itself, so the build survives even a hand-edited workflow file.
* `ci/build-apk.yml` — the workflow, updated and ready to copy.

## The one manual step

GitHub **refuses** to let this agent's token write anything under
`.github/workflows/`:

```
! [remote rejected] refusing to allow a GitHub App to create or update
  workflow `.github/workflows/build-apk.yml` without `workflows` permission
```

So please apply these two edits to `.github/workflows/build-apk.yml` yourself
(GitHub web editor is fine — it is a two-line change). Replace:

```yaml
      - uses: android-actions/setup-android@v3
```

with:

```yaml
      - uses: android-actions/setup-android@v3
        continue-on-error: true
      - name: Ensure Android SDK
        run: bash ci/ensure-android-sdk.sh
```

Everything else in the file stays as it is. `ci/build-apk.yml` in this repo is
the complete, already-patched version if you prefer to copy the whole file.

Once that lands, the build reaches Gradle and publishes a fresh APK, and the
Trust Wallet fix will finally be in the binary you install.
