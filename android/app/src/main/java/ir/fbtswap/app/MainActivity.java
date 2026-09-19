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
   * Try the protocol URI first (`wc:topic@2?...`), as recommended for native
   * Android dapps. Some wallets register only their branded scheme, so the
   * second attempt builds `trust://wc?uri=...` / `metamask://wc?uri=...`
   * directly with Uri.Builder. Neither path uses an HTTPS redirector.
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

      Intent protocolIntent = walletIntent(Uri.parse(pairingUri), packageName);
      if (canOpen(protocolIntent)) return launch(protocolIntent);

      Uri nativeUri = new Uri.Builder()
        .scheme(walletScheme)
        .authority("wc")
        .appendQueryParameter("uri", pairingUri)
        .build();
      Intent nativeIntent = walletIntent(nativeUri, packageName);
      return canOpen(nativeIntent) && launch(nativeIntent);
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
}
