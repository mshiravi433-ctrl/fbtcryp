/**
 * SCREENSHOT + SHARE.
 * ---------------------------------------------------------------------------
 * «دکمهٔ اشتراک‌گذاری اسکرین‌شات هم اضافه کن (اسکرین‌شات + اشتراک‌گذاری)»
 * (2026-09-23, next to the request that every screenshot carry the logo and the
 * address at the bottom of the page.)
 *
 * Three steps, each with its own honest failure, and none of them allowed to
 * throw at the caller:
 *
 *   1. CAPTURE — `html-to-image` rasterizes the screen's own content node. It is
 *      imported lazily: ~7 kB gzip that only loads for somebody who taps the
 *      button, never for the 249 screens that do not.
 *   2. BRAND — a <canvas> crops the capture to what is actually on screen and
 *      composites the brand strip underneath it (coin, name, canonical domain).
 *      The strip is drawn even though the on-screen rail exists, for a reason
 *      that only shows up in the shared file: the rail is `position: fixed`, and
 *      a fixed element inside a cloned node does not land where the user saw it.
 *      Drawing it ourselves means the image ALWAYS states who made it — which is
 *      the entire point of the feature.
 *   3. SHARE — the same rung order `lib/share.js` already established: the
 *      packaged app's real Android sheet (Capacitor writes the PNG to its cache
 *      and shares the file), then the Web Share API with a File, then — where
 *      neither can hand over an image — save the PNG and copy the link, and SAY
 *      that is what happened rather than pretending the sheet opened.
 *
 * A dismissed sheet is a decision, not a failure (`reason: 'DISMISSED'`), exactly
 * as in `shareLink`: the caller must not turn it into a red toast.
 */
import { isNativeShell } from './nativeShell';
import { canWebShare, copyText, shareLink } from './share';
import { BRAND_NAME, brandDomain, brandMarkDataUrl, brandShareUrl } from './brand';

/** The attribute that keeps a control out of the image it is capturing. */
export const SCREENSHOT_IGNORE = 'data-screenshot-ignore';

/**
 * What never belongs in a shared screenshot: the fixed chrome (it would be
 * painted over the content at the wrong offset), the pull-to-refresh capsule
 * (mid-gesture), toasts (a transient state the reader did not choose), and
 * anything that opted out with the attribute above — the share button itself,
 * so the picture does not advertise the thing that took it.
 */
const EXCLUDED_FROM_CAPTURE = '[data-screenshot-ignore], .bottom-nav, .brand-rail, .ptr-indicator, .toast-host';

/** Widest image we build. 1080 is what every chat app displays full-bleed. */
const MAX_WIDTH = 1080;

/** Never rasterize finer than this: text stays crisp, memory stays sane. */
const MAX_PIXEL_RATIO = 3;

/** The strip's height as a fraction of the image width (~88px at 1080). */
const STRIP_RATIO = 0.082;

/**
 * The node that represents "this screen".
 *
 * `.ptr-content` when the native pull-to-refresh wrapper is present, otherwise
 * the page element itself, otherwise the shell. Never `document.body`: that
 * would include the fixed bottom nav and the toast host, and would size the
 * capture to the document rather than to the column the user is reading.
 */
export function screenshotSource(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return null;
  return doc.querySelector('.ptr-content')
    || doc.querySelector('.page')
    || doc.querySelector('.app-shell')
    || doc.body
    || null;
}

/** Which part of a node is on screen right now, in the node's own CSS pixels. */
export function visibleSliceOf(node, viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight) {
  const rect = node.getBoundingClientRect();
  const cssHeight = node.offsetHeight || Math.round(rect.height) || 1;
  const top = Math.max(0, Math.min(-rect.top, cssHeight - 1));
  const room = Math.max(1, Math.round(viewportHeight - Math.max(0, rect.top)));
  return { top, height: Math.max(1, Math.min(room, cssHeight - top)), cssWidth: node.offsetWidth || Math.round(rect.width) || 1 };
}

/** The renderer, loaded only when somebody asks for a picture. */
async function loadRenderer() {
  const mod = await import('html-to-image');
  return mod?.toBlob || mod?.default?.toBlob || null;
}

/** 1×1 transparent PNG: what a cross-origin coin image becomes in the capture. */
const IMAGE_PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const inCapture = (node) => !(node instanceof Element) || !node.matches?.(EXCLUDED_FROM_CAPTURE);

/**
 * The colour behind the screen: the node's own background if it has one, else
 * the body's, else nothing.
 *
 * Worth the four lines because the wrong answer is visible in every chat the
 * picture is sent to: a transparent PNG is painted white by viewers, so a dark
 * app shared as an image comes out as white text on white.
 */
export function pageBackground(node) {
  const read = (element) => {
    try {
      const value = typeof getComputedStyle === 'function' ? getComputedStyle(element).backgroundColor : '';
      return value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)' ? value : '';
    } catch { return ''; }
  };
  return read(node) || read(document.body) || read(document.documentElement) || null;
}

/**
 * Step 1 — rasterize the screen.
 *
 * @param {object}  [opts]
 * @param {Element} [opts.node]      what to capture (default: screenshotSource())
 * @param {number}  [opts.maxWidth]  widest raster to build
 * @param {Function}[opts.renderer]  injected `toBlob` — tests hand in a stub,
 *                                   since jsdom has no canvas to rasterize into
 * @returns {Promise<{ok:boolean, blob?:Blob, pixelRatio?:number, visible?:object, reason?:string}>}
 */
export async function captureScreen({ node = null, maxWidth = MAX_WIDTH, renderer = null } = {}) {
  const target = node || screenshotSource();
  if (!target) return { ok: false, reason: 'NO_TARGET' };

  let toBlob = renderer;
  if (!toBlob) {
    try { toBlob = await loadRenderer(); } catch { return { ok: false, reason: 'RENDERER_UNAVAILABLE' }; }
  }
  if (typeof toBlob !== 'function') return { ok: false, reason: 'RENDERER_UNAVAILABLE' };

  const visible = visibleSliceOf(target);
  /* Rasterize at the ratio that lands the image on `maxWidth`, clamped: a 390px
     phone gets 2.77 (a 1080-wide picture, crisp text), a desktop column gets 1. */
  const pixelRatio = Math.max(1, Math.min(MAX_PIXEL_RATIO, maxWidth / visible.cssWidth));
  const options = {
    pixelRatio,
    width: visible.cssWidth,
    height: target.offsetHeight || target.scrollHeight || visible.height,
    imagePlaceholder: IMAGE_PLACEHOLDER,
    filter: inCapture,
    /* The page's OWN background, so a dark theme does not come out transparent
       (which every viewer paints white) and the light AI theme does not come out
       black. `null` when the node has none, which means "let the app behind it
       show", and html-to-image then paints nothing at all. */
    backgroundColor: pageBackground(target)
  };

  let blob = null;
  try {
    blob = await toBlob(target, options);
  } catch {
    /* Web fonts are fetched and embedded by default, and that fetch is the part
       most likely to fail — offline, or a font server that will not CORS. The
       picture is worth more than its typeface, so retry without embedding
       before giving up. */
    try { blob = await toBlob(target, { ...options, skipFonts: true, fontEmbedCSS: '' }); } catch { blob = null; }
  }
  if (!blob) return { ok: false, reason: 'CAPTURE_FAILED' };
  return { ok: true, blob, pixelRatio, visible };
}

/** A blob as a data URL — what Capacitor's Filesystem writes. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    } catch (cause) { reject(cause); }
  });
}

/** Draw the strip: hairline, coin, name, address. Returns nothing; mutates ctx. */
function paintStrip(ctx, { width, height, name, domain }) {
  const pad = Math.round(height * 0.26);

  ctx.fillStyle = '#070910';
  ctx.fillRect(0, 0, width, height);

  /* The hairline is the brand's three stops — the same gradient the coin wears,
     which is what makes the strip read as part of the app and not as a stamp. */
  const hairline = ctx.createLinearGradient(0, 0, width, 0);
  hairline.addColorStop(0, '#00e5ff');
  hairline.addColorStop(0.5, '#7c4dff');
  hairline.addColorStop(1, '#ff2d95');
  ctx.fillStyle = hairline;
  ctx.fillRect(0, 0, width, Math.max(2, Math.round(height * 0.035)));

  /* A soft wash under it, so the strip is a surface and not a black bar. */
  const wash = ctx.createLinearGradient(0, 0, width, 0);
  wash.addColorStop(0, 'rgba(0,229,255,0.10)');
  wash.addColorStop(0.5, 'rgba(124,77,255,0.08)');
  wash.addColorStop(1, 'rgba(255,45,149,0.10)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  const markSize = Math.round(height * 0.46);
  return { pad, markSize };
}

/**
 * Step 2 — crop to the screen and composite the brand strip under it.
 *
 * Pure image work, no DOM beyond a canvas. When a canvas is not available (a
 * unit-test environment, or a webview that has been stripped) the answer is
 * `{ok:false}` and the caller shares the UNBRANDED capture: a picture of the
 * user's own screen is still worth more than no picture.
 */
export async function brandTheShot({ blob, pixelRatio = 1, visible, maxWidth = MAX_WIDTH, name = BRAND_NAME, domain = brandDomain() }) {
  if (!blob || !visible) return { ok: false, reason: 'NO_CAPTURE' };

  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext?.('2d') || null;
  if (!ctx) return { ok: false, reason: 'CANVAS_UNAVAILABLE' };

  let bitmap = null;
  try {
    bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(blob) : null;
  } catch { bitmap = null; }
  if (!bitmap) {
    /* Older webviews have no createImageBitmap: an <img> over an object URL is
       the same picture with one more step. */
    const url = URL.createObjectURL(blob);
    try {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      return { ok: false, reason: 'DECODE_FAILED' };
    }
    bitmap.width = bitmap.naturalWidth || bitmap.width;
    bitmap.height = bitmap.naturalHeight || bitmap.height;
    bitmap.__objectUrl = url;
  }

  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = Math.min(1, maxWidth / sourceWidth);

  /* Source rect: the slice of the raster that was on screen. `pixelRatio` maps
     CSS pixels inside the node to pixels inside the image. */
  const sy = Math.min(sourceHeight - 1, Math.round(visible.top * pixelRatio));
  const sh = Math.max(1, Math.min(sourceHeight - sy, Math.round(visible.height * pixelRatio)));

  const outWidth = Math.max(1, Math.round(sourceWidth * scale));
  const outHeight = Math.max(1, Math.round(sh * scale));
  const stripHeight = Math.max(48, Math.round(outWidth * STRIP_RATIO));

  canvas.width = outWidth;
  canvas.height = outHeight + stripHeight;

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, sy, sourceWidth, sh, 0, 0, outWidth, outHeight);
  if (bitmap.__objectUrl) URL.revokeObjectURL(bitmap.__objectUrl);
  if (typeof bitmap.close === 'function') { try { bitmap.close(); } catch { /* already closed */ } }

  const { pad, markSize } = paintStrip(ctx, { width: outWidth, height: stripHeight, name, domain });

  /* The coin: the same SVG the DOM draws, as a data URL — a data URL is
     same-origin, so it does not taint the canvas we are about to read back. */
  try {
    const mark = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('mark decode failed'));
      img.src = brandMarkDataUrl({ size: markSize * 2 });
    });
    ctx.drawImage(mark, pad, Math.round((stripHeight - markSize) / 2), markSize, markSize);
  } catch {
    /* A strip without its coin still names the app and its address. */
  }

  const textX = pad + markSize + Math.round(pad * 0.7);
  const centerY = Math.round(stripHeight / 2);
  const nameSize = Math.round(stripHeight * 0.26);
  const domainSize = Math.round(stripHeight * 0.21);

  ctx.textBaseline = 'middle';
  ctx.font = `800 ${nameSize}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#f4f6fb';
  ctx.fillText(name, textX, centerY - Math.round(nameSize * 0.42));

  const nameWidth = ctx.measureText(name).width;

  ctx.font = `600 ${domainSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = 'rgba(203,213,225,0.92)';
  ctx.fillText(domain, textX, centerY + Math.round(domainSize * 0.72));

  /* Everything is left-aligned in the image on purpose: the strip is Latin
     (name, address) and a right-to-left canvas would mirror the dot separators
     and the monospace host, which is how an address becomes unreadable. */
  const lineEnd = Math.max(nameWidth, ctx.measureText(domain).width);
  const hairline = ctx.createLinearGradient(textX, 0, textX + lineEnd, 0);
  hairline.addColorStop(0, 'rgba(0,229,255,0.55)');
  hairline.addColorStop(1, 'rgba(255,45,149,0.35)');
  ctx.fillStyle = hairline;
  ctx.fillRect(textX, centerY + Math.round(stripHeight * 0.3), Math.round(lineEnd), Math.max(1, Math.round(stripHeight * 0.012)));

  const out = await new Promise((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'));
  if (!out) return { ok: false, reason: 'ENCODE_FAILED' };
  return { ok: true, blob: out, width: outWidth, height: canvas.height };
}

/** Save a picture the platform will not let us hand over. */
export async function saveImage(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return true;
  } catch {
    return false;
  }
}

const dismissed = (cause) => String(cause?.message || '').match(/cancel/i) || String(cause?.name || '') === 'AbortError';

/**
 * Step 3 — hand the picture over, by the best rung this device has.
 *
 * @returns {Promise<{ok:boolean, via:'native'|'web'|'download'|'none', reason?:string}>}
 */
export async function shareScreenshot({ blob, title = BRAND_NAME, text = '', url = brandShareUrl('/'), filename = 'fbtswap-screen.png' }) {
  if (!blob) return { ok: false, via: 'none', reason: 'NO_IMAGE' };

  /* 1 ─ the packaged app: write the PNG to our cache and let Android share the
        FILE. Capacitor's Share cannot take a Blob, only a URI it can read. */
  if (isNativeShell()) {
    try {
      const [{ Share }, { Filesystem, Directory }] = await Promise.all([
        import('@capacitor/share'),
        import('@capacitor/filesystem')
      ]);
      const data = await blobToBase64(blob);
      const written = await Filesystem.writeFile({
        path: filename,
        data,
        directory: Directory.Cache,
        recursive: true
      });
      await Share.share({ title, text, files: [written.uri], dialogTitle: title });
      return { ok: true, via: 'native' };
    } catch (cause) {
      if (dismissed(cause)) return { ok: false, via: 'native', reason: 'DISMISSED' };
      /* An older plugin build without `files`, or a cache we may not write to:
         fall through to the browser's own sheet. */
    }
  }

  /* 2 ─ Web Share API with a File: iOS Safari, Chrome Android, Samsung Internet.
        `url` is deliberately NOT passed alongside `files` — Safari rejects the
        combination, and the address is already drawn into the picture. */
  let file = null;
  try { file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null; } catch { file = null; }
  const canSendFile = Boolean(file) && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (canWebShare() && canSendFile) {
    try {
      await navigator.share({ files: [file], title, text });
      return { ok: true, via: 'web' };
    } catch (cause) {
      if (dismissed(cause)) return { ok: false, via: 'web', reason: 'DISMISSED' };
    }
  }

  /* 3 ─ no way to hand over an image: save it, copy the link, and say exactly
        that happened. A silent "shared!" here would be the lie the whole module
        is written to avoid. */
  const saved = await saveImage(blob, filename);
  const copied = await copyText(url).then(() => true).catch(() => false);
  if (saved || copied) return { ok: true, via: 'download', reason: saved && copied ? 'SAVED_AND_COPIED' : saved ? 'SAVED' : 'COPIED' };
  return { ok: false, via: 'none', reason: 'NO_CHANNEL' };
}

/**
 * The whole flow, for the button: capture → brand → share.
 *
 * Never throws, and never invents success. `branded:false` means the picture was
 * shared without its strip (a canvas this environment would not give us) — the
 * caller may mention it, but the share still happened.
 */
export async function takeScreenshotAndShare({ screen = null, path = '/', url = null, title = BRAND_NAME, text = '', filename = null, node = null } = {}) {
  const link = url || brandShareUrl(path);
  const shot = await captureScreen({ node });
  if (!shot.ok) {
    /* No picture, so share the LINK by the rungs `shareLink` already owns — a
       button that does nothing at all is the one outcome this file exists to
       prevent, and the reason it could not take the picture is reported
       alongside so the UI can say which happened. */
    const linked = await shareLink({ url: link, text, title });
    /* A closed sheet stays a closed sheet. Overwriting its reason with the
       capture's would hand the caller a failure to toast about — and «the user
       changed their mind» is the one outcome that must never surface as an
       error (the rule `shareLink` itself is written around). */
    if (linked.reason === 'DISMISSED') {
      return { ok: false, via: linked.via, stage: 'capture', reason: 'DISMISSED', captureReason: shot.reason, branded: false };
    }
    if (linked.ok) return { ok: true, via: 'link', stage: 'capture', reason: shot.reason, branded: false };
    const copied = await copyText(link).then(() => true).catch(() => false);
    return { ok: copied, via: copied ? 'copy' : 'none', stage: 'capture', reason: shot.reason, branded: false };
  }

  const branded = await brandTheShot({ ...shot, name: BRAND_NAME, domain: brandDomain() });
  const blob = branded.ok ? branded.blob : shot.blob;
  const name = filename || `fbtswap-${String(screen || 'screen').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;

  const shared = await shareScreenshot({ blob, title, text, url: link, filename: name });
  return { ...shared, stage: 'share', branded: branded.ok, brandReason: branded.ok ? null : branded.reason };
}
