package ir.fbtswap.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

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

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applySystemBarTheme(false);
    wireThemeBridge();
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
  private void wireThemeBridge() {
    Bridge bridge = getBridge();
    if (bridge == null) return;
    WebView webView = bridge.getWebView();
    if (webView == null) return;
    webView.addJavascriptInterface(new SystemUi(this), "FBTSystemUI");
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
        }
      });
    }
  }
}
