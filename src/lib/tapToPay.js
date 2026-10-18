/**
 * TAP TO PAY — bring two phones together, send crypto, take a fee.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *   «در قسمت p2p ببین میشه با nfc یا کنار هم گذاشتن دو تلفن و تایید دستی
 *    انتقال بدی ... یعنی تلفن را نزدیک که کنی سوال کنه ارز به این ولت تلفن
 *    انتقال پیدا کنه و ما کارمزد بگیریم»
 *
 * Yes — but NOT the way it first sounds, and the difference is the whole
 * design. Two facts had to be established before writing any of this:
 *
 * ─── FACT 1: PHONE-TO-PHONE NFC IS DEAD ─────────────────────────────────────
 * Android Beam, the feature that let two phones touch and exchange data, was
 * deprecated in Android 10 and REMOVED COMPLETELY IN ANDROID 14. Google
 * replaced it with Quick Share, which uses Bluetooth and Wi-Fi Direct — NFC is
 * no longer part of it at all.
 *
 * So "hold two phones together and NFC moves the data" is not something we
 * declined to build. On a modern Android phone it does not exist.
 *
 * ─── FACT 2: WEB NFC READS TAGS, NOT PHONES ─────────────────────────────────
 * The browser API (`NDEFReader`) is real and we can use it, but its scope is
 * passive NFC TAGS. The spec explicitly excludes host card emulation, which is
 * the mode that would be required to make a phone impersonate a tag. And it is
 * Chrome-on-Android only: no iOS, no desktop, ~6% of browsers.
 *
 * ─── WHAT ACTUALLY WORKS, AND IS BETTER ─────────────────────────────────────
 * Separate the two halves of the problem:
 *
 *   1. GET THE RECIPIENT'S ADDRESS ONTO THE PAYER'S PHONE.
 *      This is the only part that needs proximity, and it moves 42 characters
 *      of PUBLIC data. NFC tag, QR code — either is fine.
 *
 *   2. AUTHORISE THE TRANSFER.
 *      This must happen in the payer's own wallet, with the payer reading the
 *      amount and the destination and pressing confirm. Non-negotiable: we
 *      hold no keys, and a payment that could be triggered by proximity alone
 *      would be a robbery mechanism, not a feature. Someone brushing past you
 *      in a queue must never be able to move your money.
 *
 * So: tap to FILL IN, confirm to SEND. The tap saves the address typing, which
 * is the genuinely hard and dangerous part — a mistyped address is an
 * unrecoverable loss.
 *
 * ─── HOW THIS EARNS ─────────────────────────────────────────────────────────
 * A plain wallet-to-wallet transfer pays us nothing, and we should not pretend
 * otherwise by bolting a fee onto a send.
 *
 * The version that DOES earn is honest, because it does real work: the payer
 * holds USDC and the recipient wants ETH — or they are simply on different
 * assets. 0x's `recipient` parameter performs the swap and delivers the bought
 * token straight to the other person in ONE transaction, and our normal
 * 0.70% swap fee applies exactly as it does anywhere else.
 *
 * Verified live before building this, on our own production key:
 *
 *   GET /api/gasless/price?...&recipient=0xaf5C...24d6
 *   -> "integratorFee": { "amount": "70000", ... }      (70 bps of 10 USDC)
 *
 * With the gasless path the payer does not even need the chain's native coin,
 * which is the common case for someone holding only USDT.
 *
 * If both sides want the SAME token, this module says so and routes to a plain
 * transfer with no fee. Charging a swap fee for a swap that did not happen
 * would be taking money for nothing.
 */

/** Is the Web NFC API usable in this browser, right now? */
export function nfcSupported() {
  return typeof window !== 'undefined' && 'NDEFReader' in window;
}

/**
 * Why NFC is unavailable, in a form a UI can turn into a real sentence.
 *
 * "Not supported" is useless to someone on an iPhone who can see the feature
 * advertised. The reason determines the advice: an iOS user should be told to
 * use the QR code, not told to update their browser.
 */
export function nfcUnavailableReason() {
  if (typeof window === 'undefined') return 'NO_WINDOW';
  if (nfcSupported()) return null;

  const ua = String(window.navigator?.userAgent ?? '');
  if (/iPhone|iPad|iPod/i.test(ua)) return 'IOS_UNSUPPORTED';
  if (!/Android/i.test(ua)) return 'DESKTOP_UNSUPPORTED';
  /*
   * Android without NDEFReader is almost always Firefox — Mozilla lists Web
   * NFC as "harmful" in its standards positions and has no plans to ship it.
   */
  if (/Firefox/i.test(ua)) return 'BROWSER_UNSUPPORTED';
  return 'BROWSER_UNSUPPORTED';
}

/** EVM address shape. Deliberately the same guard used by payout.js. */
export const isEvmAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || '').trim());

/**
 * Build the payload written to a tag or shown as a QR code.
 *
 * EIP-681 (`ethereum:0x...@chainId`) rather than a bare address or a private
 * format. It is the URI scheme every major wallet already understands, so the
 * same tag works if the other person scans it with MetaMask instead of us —
 * and a payment standard nobody else implements is a payment standard that
 * strands its users.
 *
 * ─── WHY ONLY THE NATIVE COIN CAN RIDE IN THE CODE ─────────────────────────
 * `amount` is emitted as EIP-681's `?value=<wei>`, and `value` means the
 * chain's NATIVE coin in that standard. There is a second EIP-681 form for
 * tokens — `ethereum:<tokenContract>@<chain>/transfer?address=<recipient>` —
 * and it is deliberately NOT used here, because in that form the address
 * directly after `ethereum:` is the TOKEN, not the person being paid. Every
 * parser in this app (including `parsePayLink` below) reads that position as
 * the destination; emitting it would hand a payer's wallet the token contract
 * as the recipient and the money would be gone.
 *
 * So: an amount is only encoded when the request is in the chain's own coin.
 * A USDT request is still shown on screen — it simply travels as text next to
 * the code rather than inside it, which is the honest thing to do with a
 * number no wallet would read correctly.
 *
 * @param {string} address
 * @param {number|string} chainId
 * @param {object} [opts]
 * @param {string}  [opts.amount]   human amount, e.g. "0.05"
 * @param {number}  [opts.decimals] decimals of the coin the amount is in
 * @param {boolean} [opts.native]   MUST be true for the amount to be emitted.
 *        The guard lives here rather than in the caller on purpose: the safe
 *        default is "do not encode", so a future call site that passes an
 *        amount and forgets to say which kind of coin it is cannot emit a
 *        dangerous URI. Silence is the recoverable mistake; a misread
 *        recipient is not.
 */
export function buildPayLink(address, chainId, { amount, decimals, native = false } = {}) {
  if (!isEvmAddress(address)) throw new Error('BAD_ADDRESS');
  const chain = Number(chainId);
  const base = Number.isFinite(chain) && chain > 0
    ? `ethereum:${address}@${chain}`
    : `ethereum:${address}`;

  if (!native) return base;
  const wei = parseUnits(amount, decimals);
  if (wei === null || wei === 0n) return base;
  return `${base}?value=${wei.toString()}`;
}

/**
 * "0.05" with 18 decimals -> 50000000000000000n, as a BigInt.
 *
 * BigInt, not `Number(amount) * 10 ** decimals`: in floating point
 * `0.07 * 1e18` is 70000000000000000.000000000001 and friends, and rounding a
 * payment amount is how someone is quietly over- or under-charged.
 *
 * Returns null for anything that is not a plain non-negative decimal. Two
 * deliberate calls in there:
 *   — "1." reads as 1, not as an error. It is a number mid-keystroke on the
 *     way to "1.5", and treating it as invalid would blink the amount out of
 *     the code and back on the way there.
 *   — "1e3", "-1" and "1.2.3" are rejected outright rather than truncated.
 *     Silence is the recoverable mistake; a confidently wrong number is not.
 */
export function parseUnits(value, decimals = 18) {
  const d = Number.isFinite(Number(decimals)) ? Math.max(0, Math.trunc(Number(decimals))) : 18;
  const s = String(value ?? '').trim();
  if (!s || !/^\d*(?:\.\d*)?$/.test(s)) return null;

  const [whole = '0', frac = ''] = s.split('.');
  if (!whole && !frac) return null;

  const padded = (frac + '0'.repeat(d)).slice(0, d);
  const joined = `${whole || '0'}${padded}`.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(joined)) return null;
  try {
    return BigInt(joined);
  } catch {
    return null;
  }
}

/** Turn a base-unit BigInt/string back into a human amount, for display. */
export function formatUnits(value, decimals = 18) {
  const d = Number.isFinite(Number(decimals)) ? Math.max(0, Math.trunc(Number(decimals))) : 18;
  let s = '';
  try {
    s = BigInt(value ?? 0).toString();
  } catch {
    return null;
  }
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  s = s.padStart(d + 1, '0');
  const whole = s.slice(0, s.length - d) || '0';
  const frac = d ? s.slice(s.length - d).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Pull an address out of whatever the tag or QR actually contained.
 *
 * Handles the EIP-681 form, a bare address, and the common case of a wallet
 * app writing a full URL with the address in a query parameter. Anything that
 * does not yield a valid address returns null rather than a guess — guessing
 * here means sending money to a wrong address.
 *
 * `value` (the requested amount, in base units) comes along when it was
 * present, so the payer can be shown what is being asked for rather than
 * having to be told in person.
 */
export function parsePayLink(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  if (isEvmAddress(text)) return { address: text, chainId: null, value: null };

  const m = /(?:ethereum:|pay-)?(0x[a-fA-F0-9]{40})(?:@(\d+))?/.exec(text);
  if (m && isEvmAddress(m[1])) {
    let value = null;
    const q = text.indexOf('?');
    if (q !== -1) {
      const rawValue = new URLSearchParams(text.slice(q + 1)).get('value');
      if (rawValue && /^\d+$/.test(rawValue)) value = rawValue;
    }
    return { address: m[1], chainId: m[2] ? Number(m[2]) : null, value };
  }
  return null;
}

/**
 * Read one NFC tag.
 *
 * ─── WHY IT RESOLVES AFTER A SINGLE READ ────────────────────────────────────
 * `NDEFReader.scan()` streams every tag it sees until aborted. For a payment
 * that is wrong: the address must be captured once and the scan stopped, or a
 * second tag brought near mid-flow could silently replace the destination
 * after the user has read it. First valid read wins, then we stop listening.
 *
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]  cancel from the UI
 * @param {number} [opts.timeout]      give up rather than scan forever
 * @param {any} [opts.reader]          injected for tests; the real NDEFReader
 *        cannot be constructed in jsdom, and leaving the core of a
 *        money-moving feature unverifiable is not acceptable.
 */
export function readNfcAddress({ signal, timeout = 30000, reader } = {}) {
  return new Promise((resolve, reject) => {
    let Ctor = null;
    if (reader) {
      Ctor = null;
    } else if (nfcSupported()) {
      Ctor = window.NDEFReader;
    } else {
      reject(new Error(nfcUnavailableReason() || 'NFC_UNSUPPORTED'));
      return;
    }

    const ndef = reader ?? new Ctor();
    const ctrl = new AbortController();
    let done = false;

    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ctrl.abort();
      } catch {
        /* already aborted */
      }
      fn(arg);
    };

    const timer = setTimeout(() => finish(reject, new Error('NFC_TIMEOUT')), timeout);
    if (signal) signal.addEventListener('abort', () => finish(reject, new Error('CANCELLED')));

    ndef.onreading = (event) => {
      /*
       * A tag can hold several records. Every one is checked and the first
       * that yields a valid address wins; a tag that also carries a URL or a
       * text label must not defeat the scan.
       */
      for (const record of event?.message?.records ?? []) {
        let text = '';
        try {
          const dec = new TextDecoder(record.encoding || 'utf-8');
          text = dec.decode(record.data);
        } catch {
          continue;
        }
        const parsed = parsePayLink(text);
        if (parsed) {
          finish(resolve, parsed);
          return;
        }
      }
      finish(reject, new Error('NO_ADDRESS_ON_TAG'));
    };

    ndef.onreadingerror = () => finish(reject, new Error('NFC_READ_FAILED'));

    Promise.resolve(ndef.scan({ signal: ctrl.signal })).catch((err) => {
      // A refused permission is the common case and deserves its own message.
      const name = String(err?.name || '');
      finish(reject, new Error(name === 'NotAllowedError' ? 'NFC_DENIED' : 'NFC_SCAN_FAILED'));
    });
  });
}

/**
 * Does this transfer earn anything, and should it?
 *
 * The honest split, and the reason this function exists rather than a fee
 * being applied everywhere:
 *
 *   SAME token  -> a plain transfer. No swap happens, so no swap fee. Charging
 *                  one would be taking money for work not done.
 *   DIFFERENT   -> a real swap, delivered to the other person in the same
 *                  transaction. Our standard 0.70% applies, exactly as it
 *                  would if they swapped and sent separately.
 */
export function paymentPlan({ sellToken, buyToken, feeBps = 70 }) {
  const same =
    String(sellToken || '').toLowerCase() === String(buyToken || '').toLowerCase();
  return same
    ? { mode: 'transfer', earns: false, feeBps: 0 }
    : { mode: 'swap-and-send', earns: true, feeBps };
}
