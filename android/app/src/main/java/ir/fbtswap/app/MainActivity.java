package ir.fbtswap.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.util.regex.Pattern;

import org.json.JSONObject;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/*
 * `Bridge` is a sibling class of BridgeActivity in com.getcapacitor, not a
 * nested type, so importing BridgeActivity alone does NOT bring it into scope.
 * Without this line wireThemeBridge() fails to compile with
 * "cannot find symbol: class Bridge" and takes the whole APK down.
 */
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/*
 * ─── THE MOBILE'S OWN HEADER AND FOOTER, MADE OF GLASS ─────────────────────
 *
 * «در اپ و سایت باید هیدر خود موبایل و فوتر خود موبایل — همان هیدری که
 * میزان شارژ را نشان می‌دهد و فوتری که دکمه‌های موبایل هست — با تم سیاه
 * و تم سفید هم‌رنگ سایت بشه و شیشه‌ای باشد»
 *
 * The "header that shows the battery level" and the "footer with the mobile
 * buttons" (back / home / recents) are the ANDROID SYSTEM BARS, not anything
 * this page draws. This class is the only place they can be restyled:
 *
 *   1. EDGE-TO-EDGE — `setDecorFitsSystemWindows(window, false)` makes the
 *      web content paint BEHIND both bars. Nothing else is possible on top
 *      of that: the app already ships `viewport-fit=cover` and pads its
 *      .top-bar with `env(safe-area-inset-top)` (see index.css), so no
 *      content hides under the glass.
 *
 *   2. GLASS TINT — each bar gets a TRANSLUCENT colour taken from the
 *      current theme's canvas (dark = brand black #00030F, light =
 *      #F4F5FA) at ~55% alpha. The site's animated RGB backdrop moves
 *      underneath it, so the bars read as frosted glass in the site's own
 *      colour instead of a solid strip. On Android 15+ the OS forces
 *      edge-to-edge and ignores the colour setters — the bars are fully
 *      transparent there, which is the same glass effect with the site
 *      fully visible through it.
 *
 *   3. THEME-AWARE ICONS — dark theme keeps WHITE clock/battery and white
 *      nav buttons (light icons on dark glass); light theme flips them to
 *      BLACK (light icons on light glass). This is the "هم‌رنگ سایت" part:
 *      the bar can never be a wrong-coloured slab while the site behind it
 *      is the other theme.
 *
 * The app's theme lives in the WEB layer (useSettingsStore.applyTheme,
 * which can also be 'auto'), so the native side does not guess: the web
 * calls `window.FBTSystemUI.setTheme('dark' | 'light')` on boot and on
 * every switch. Until that call lands, dark is the default — matching the
 * app's own default and the boot splash.
 */
public class MainActivity extends BridgeActivity {

  /*
   * 55% alpha of each theme's canvas colour. Kept here rather than in
   * res/values so the value next to the code that uses it: if the site's
   * canvas ever changes, only this file has to change.
   */
  private static final int GLASS_DARK = 0x8C00030F;  // 55% of #00030F
  private static final int GLASS_LIGHT = 0x8CF4F5FA; // 55% of #F4F5FA

  /*
   * ─── THE WALLET'S ANSWER, ON ITS WAY TO THE WEB LAYER ─────────────────────
   *
   * A Solana wallet approves a deeplink request by sending the user back to
   * `redirect_link`. Inside the APK that link is `ir.fbtswap.app://solconnect…`
   * (registered in AndroidManifest), so Android delivers it to THIS activity —
   * and until now nothing carried it any further. The WebView, still sitting
   * on «منتظر تأیید…», never learned that the wallet had answered, so an
   * approved connection died in the gap between the intent and the page.
   *
   * The URL is delivered twice on purpose:
   *
   *   • PUSHED into the running WebView as `window.FBTDeepLink(url)`, which is
   *     the normal case (launchMode="singleTask" keeps the WebView alive behind
   *     the wallet), and
   *   • KEPT for `FBTDeepLinkBridge.consume()`, which is the cold-start case: if
   *     the app was killed, the page is still booting when this arrives and a
   *     one-shot push would land in a document with no listener yet. The web
   *     layer drains that inbox on boot and matches by URL, so a double
   *     delivery is harmless.
   */
  private String pendingDeepLink = null;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applySystemBarTheme(false);
    getDelegate().setLocalNightMode(AppCompatDelegate.MODE_NIGHT_YES);
    wireNativeBridges();
    captureDeepLink(getIntent());
  }

  /*
   * The app was already running when the wallet redirected back. This is the
   * normal path for a connection: the WebView is untouched behind the wallet
   * and only needs to be told.
   */
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    captureDeepLink(intent);
  }

  /**
   * Tell the live WalletConnect attempt that Android brought this Activity back
   * to the foreground.
   *
   * `document.visibilitychange` is not reliable in every Android System
   * WebView when another Activity (Trust Wallet, MetaMask, …) covers ours. The
   * pending SignClient therefore used to keep the relay transport in its
   * suspended state after approval and the popup waited forever. The web layer
   * listens for this event and reopens the SAME Core relayer/subscriptions; it
   * never creates another pairing.
   */
  @Override
  protected void onResume() {
    super.onResume();
    Bridge bridge = getBridge();
    WebView webView = bridge == null ? null : bridge.getWebView();
    if (webView == null) return;
    webView.post(new Runnable() {
      @Override
      public void run() {
        try {
          webView.evaluateJavascript(
            "window.dispatchEvent(new Event('fbt:app-resume'));",
            null
          );
        } catch (Exception e) {
          /* The first onResume can precede page boot; a pairing does not exist
             then, and every later app return emits the event again. */
        }
      }
    });
  }

  /** The scheme the manifest registered for wallet returns. */
  private String deepLinkScheme() {
    try {
      return getString(R.string.custom_url_scheme);
    } catch (Exception e) {
      return "ir.fbtswap.app";
    }
  }

  /**
   * Accept only OUR scheme and only a URL of a sane length.
   *
   * An intent filter already narrows this to the scheme, but an intent can
   * also be delivered by an explicit component name from another app, so the
   * check is done here as well: this is a signing application, not a generic
   * URL forwarder, and whatever passes is handed to JavaScript.
   */
  private static final int MAX_DEEPLINK_LENGTH = 4096;

  private void captureDeepLink(Intent intent) {
    if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
    Uri data = intent.getData();
    if (data == null) return;
    String scheme = data.getScheme();
    if (scheme == null || !scheme.equalsIgnoreCase(deepLinkScheme())) return;
    String url = data.toString();
    if (url.length() > MAX_DEEPLINK_LENGTH) return;
    deliverDeepLink(url);
  }

  private synchronized void deliverDeepLink(String url) {
    if (url == null || url.isEmpty()) return;
    pendingDeepLink = url;
    Bridge bridge = getBridge();
    WebView webView = bridge == null ? null : bridge.getWebView();
    if (webView == null) return; // consume() will hand it over on boot
    final String js = "window.FBTDeepLink&&window.FBTDeepLink(" + JSONObject.quote(url) + ");";
    webView.post(new Runnable() {
      @Override
      public void run() {
        try {
          webView.evaluateJavascript(js, null);
        } catch (Exception e) {
          /* The inbox above is the fallback — never crash the app over a
             notification the page can also poll for. */
        }
      }
    });
  }

  /*
   * Restyle both system bars for the given theme. Idempotent — the web
   * layer calls it on boot and again on every theme switch, and a
   * no-op-when-same-theme check would cost a field the class does not
   * otherwise need.
   */
  void applySystemBarTheme(boolean light) {
    android.view.Window window = getWindow();
    if (window == null) return;

    // Content behind the bars is what the translucency shows through.
    WindowCompat.setDecorFitsSystemWindows(window, false);

    int tint = light ? GLASS_LIGHT : GLASS_DARK;
    window.setStatusBarColor(tint);
    window.setNavigationBarColor(tint);

    // Icon colour: WHITE icons on dark glass, BLACK icons on light glass.
    View decorView = window.getDecorView();
    if (decorView != null) {
      WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
      controller.setAppearanceLightStatusBars(light);
      controller.setAppearanceLightNavigationBars(light);
    }
  }

  /*
   * Expose setTheme to the web layer. The WebView exists only once the
   * bridge is up, which is after super.onCreate() has run — exactly where
   * this is called from.
   */
  private void wireNativeBridges() {
    Bridge bridge = getBridge();
    if (bridge == null) return;
    WebView webView = bridge.getWebView();
    if (webView == null) return;
    webView.addJavascriptInterface(new SystemUi(this), "FBTSystemUI");
    /*
     * A Custom Tab/universal-link redirect can open a wallet after dropping
     * WalletConnect's `uri` query. Give the web layer a tiny, package-scoped
     * ACTION_VIEW bridge so the raw pairing payload reaches Android intact.
     * WalletLink validates both arguments against fixed allowlists below; web
     * content can neither launch arbitrary packages nor arbitrary URI schemes.
     */
    webView.addJavascriptInterface(new WalletLink(this), "FBTWalletLink");
    webView.addJavascriptInterface(new DeepLinkInbox(), "FBTDeepLinkBridge");
    /*
     * The Solana half of the same problem, and the reason a Phantom connect
     * request never produced an approval screen inside this app.
     *
     * Phantom's request IS its query string —
     * `https://phantom.com/ul/v1/connect?app_url=…&dapp_encryption_public_key=…`
     * — and a Chrome Custom Tab (what @capacitor/browser opens) renders
     * http/https itself instead of handing an App Link to another app. So the
     * page was loaded inside our own WebView-backed tab and the wallet, when
     * the user did reach it, arrived with nothing to approve.
     *
     * This bridge fires an EXPLICIT ACTION_VIEW at the wallet's own package,
     * which is the one route inside an APK that delivers the URL intact and
     * leaves the WebView — with its pending request — alive underneath.
     *
     * AND IT IS HOST-EXACT, which is the second half of the fix. The host and
     * the package have to be the pair the WALLET declared, or Android finds
     * nothing to start and the wallet — installed, unlocked, right there —
     * simply does not open («اتفاقی نمی‌افتد»). Phantom's App Links live on
     * `phantom.com` (its `/.well-known/assetlinks.json` lists `app.phantom`);
     * `phantom.app` is an alias that only redirects and resolves to nothing.
     * Both are accepted below so a link that already exists cannot dead-end,
     * but the requests the web layer builds now use phantom.com.
     */
    webView.addJavascriptInterface(new SolanaLink(this), "FBTSolanaLink");
  }

  /**
   * The cold-start half of the deep link path: the web layer asks for any
   * wallet return that arrived before it was listening.
   *
   * `consume()` hands each URL over exactly once — the page processes it and
   * never sees it again, so a refresh cannot replay a connect.
   */
  private final class DeepLinkInbox {
    @JavascriptInterface
    public String consume() {
      synchronized (MainActivity.this) {
        String url = pendingDeepLink;
        pendingDeepLink = null;
        return url;
      }
    }
  }

  /*
   * JavascriptInterface methods run off the UI thread, so the tint flip is
   * posted back. A static nested class (not anonymous) keeps the lint
   * "inner class leaks activity" analysis away from the WebView's
   * retained reference to the injected object.
   */
  private static final class SystemUi {
    private final MainActivity activity;

    SystemUi(MainActivity activity) {
      this.activity = activity;
    }

    @JavascriptInterface
    public void setTheme(final String theme) {
      final boolean light = "light".equalsIgnoreCase(theme);
      activity.runOnUiThread(new Runnable() {
        @Override
        public void run() {
          activity.applySystemBarTheme(light);
          activity.getDelegate().setLocalNightMode(
            light ? AppCompatDelegate.MODE_NIGHT_NO : AppCompatDelegate.MODE_NIGHT_YES
          );
        }
      });
    }
  }

  /**
   * WalletConnect's native Android last metre.
   *
   * Open the selected wallet's branded URI first:
   * `trust://wc?uri=...` / `metamask://wc?uri=...`. A raw `wc:` URI is a
   * generic pairing intent; Trust can route it through its intermediate
   * “continue connecting” surface and make the same proposal look like it
   * needs a second approval. The branded route goes directly to that wallet's
   * WalletConnect handler. Raw `wc:` remains a package-scoped fallback for
   * wallet builds that only register the protocol URI. Neither path uses an
   * HTTPS redirector.
   */
  private static final class WalletLink {
    private static final Pattern PAIRING_URI = Pattern.compile(
      "^wc:[A-Za-z0-9_-]+@2\\?(?=[^#\\s]*relay-protocol=[^&#\\s]+(?:&|$))" +
      "(?=[^#\\s]*symKey=[0-9a-fA-F]{64}(?:&|$))[^#\\s]+$"
    );

    private final MainActivity activity;

    WalletLink(MainActivity activity) {
      this.activity = activity;
    }

    @JavascriptInterface
    public boolean openWallet(final String pairingUri, final String packageName) {
      if (pairingUri == null || pairingUri.length() > 4096 || !PAIRING_URI.matcher(pairingUri).matches()) {
        return false;
      }
      final String walletScheme = schemeForPackage(packageName);
      if (walletScheme == null) return false;

      Uri nativeUri = new Uri.Builder()
        .scheme(walletScheme)
        .authority("wc")
        .appendQueryParameter("uri", pairingUri)
        .build();
      Intent nativeIntent = walletIntent(nativeUri, packageName);
      if (canOpen(nativeIntent)) return launch(nativeIntent);

      Intent protocolIntent = walletIntent(Uri.parse(pairingUri), packageName);
      return canOpen(protocolIntent) && launch(protocolIntent);
    }

    private Intent walletIntent(Uri uri, String packageName) {
      Intent intent = new Intent(Intent.ACTION_VIEW, uri);
      intent.setPackage(packageName);
      intent.addCategory(Intent.CATEGORY_BROWSABLE);
      return intent;
    }

    private boolean canOpen(Intent intent) {
      return intent.resolveActivity(activity.getPackageManager()) != null;
    }

    private boolean launch(final Intent intent) {
      activity.runOnUiThread(new Runnable() {
        @Override
        public void run() {
          activity.startActivity(intent);
        }
      });
      return true;
    }

    /* Package + scheme are a pair. Never accept either value from JavaScript
       independently: this is a signing application, not a generic intent proxy. */
    private static String schemeForPackage(String packageName) {
      if ("io.metamask".equals(packageName)) return "metamask";
      if ("com.wallet.crypto.trustapp".equals(packageName)) return "trust";
      if ("com.uniswap.mobile".equals(packageName)) return "uniswap";
      if ("io.safepal.wallet".equals(packageName)) return "safepalwallet";
      if ("me.rainbow".equals(packageName)) return "rainbow";
      return null;
    }
  }

  /**
   * Solana wallet deep links — connect and sign requests, delivered to the
   * wallet app itself.
   *
   * ─── WHAT IT ACCEPTS ───────────────────────────────────────────────────────
   * An https URL on one of three known hosts, under `/ul/`, paired with the
   * package that host belongs to. Both halves have to agree, and neither is
   * trusted on its own: JavaScript cannot use this to launch an arbitrary
   * package, nor to point a known wallet at an arbitrary URL. The request can
   * be long (a base58 transaction, or an arbitrary message, rides in the
   * query), so the bound is 64 KB rather than the 4 KB a WalletConnect pairing
   * URI needs — still far below Phantom's own documented 500 KB Android
   * deep-link limit, and far above any transaction Solana itself would accept.
   *
   * ─── WHY IT RETURNS A BOOLEAN ──────────────────────────────────────────────
   * The web layer keeps a list of routes and falls through to the next one
   * (a Custom Tab, then Android's own routing) when this says no. Reporting a
   * hand-off that did not happen would leave the user looking at a wallet that
   * was never asked anything — the exact bug this class exists to end.
   */
  private static final class SolanaLink {
    private static final int MAX_REQUEST_LENGTH = 65536;

    private final MainActivity activity;

    SolanaLink(MainActivity activity) {
      this.activity = activity;
    }

    @JavascriptInterface
    public boolean openWalletLink(final String url, final String packageName) {
      if (url == null || url.length() > MAX_REQUEST_LENGTH) return false;
      if (packageName == null || !packageName.equals(packageForHost(hostOf(url)))) return false;

      Uri uri;
      try {
        uri = Uri.parse(url);
      } catch (Exception e) {
        return false;
      }
      if (!isWalletRequest(uri)) return false;

      /* Package-scoped first: this is the delivery that reaches the wallet's
         own handler rather than a browser or a chooser. */
      if (launch(uri, packageName)) return true;
      /* Not installed under that package, or a build that filters it: the URL
         is still host-scoped and validated above, so let Android route it. */
      return launch(uri, null);
    }

    private static String hostOf(String url) {
      try {
        return Uri.parse(url).getHost();
      } catch (Exception e) {
        return null;
      }
    }

    /**
     * Host and package are a pair, exactly like WalletLink's scheme table.
     *
     * `phantom.com` FIRST because that is the host Phantom's app declares
     * (`/.well-known/assetlinks.json` → `app.phantom`) and therefore the only
     * one an explicit ACTION_VIEW can actually resolve to; `phantom.app` stays
     * as a tolerated alias for links that predate the correction or arrive from
     * somewhere else. Both map to the same package, so neither can be used to
     * launch an app the other does not name.
     */
    private static String packageForHost(String host) {
      if (host == null) return null;
      String h = host.toLowerCase(java.util.Locale.ROOT);
      if ("phantom.com".equals(h) || "phantom.app".equals(h)) return "app.phantom";
      if ("solflare.com".equals(h)) return "com.solflare.mobile";
      if ("backpack.app".equals(h)) return "app.backpack.mobile";
      return null;
    }

    /** https, one of the three wallet hosts, and a `/ul/` deep-link path. */
    private boolean isWalletRequest(Uri uri) {
      if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
      if (packageForHost(uri.getHost()) == null) return false;
      String path = uri.getPath();
      return path != null && path.startsWith("/ul/");
    }

    /*
     * startActivity rather than resolveActivity-then-start.
     *
     * `resolveActivity` answers from the CALLER'S package visibility, and on
     * Android 11+ another app is invisible unless it was declared in
     * <queries> — so it returns null for a wallet that is installed, and a
     * "can I open this?" check would report no for the one case that matters.
     * Firing the intent and catching the failure is both correct and the
     * documented approach.
     */
    private boolean launch(Uri uri, String packageName) {
      Intent intent = new Intent(Intent.ACTION_VIEW, uri);
      intent.addCategory(Intent.CATEGORY_BROWSABLE);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (packageName != null) intent.setPackage(packageName);
      try {
        activity.startActivity(intent);
        return true;
      } catch (Exception e) {
        return false;
      }
    }
  }
}
