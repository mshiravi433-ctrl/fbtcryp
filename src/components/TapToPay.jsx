import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import {
  buildPayLink,
  isEvmAddress,
  nfcSupported,
  nfcUnavailableReason,
  parsePayLink,
  readNfcAddress
} from '../lib/tapToPay';

/**
 * TAP TO PAY — the "hold two phones together" feature, built the way it can
 * actually work.
 * ---------------------------------------------------------------------------
 * See lib/tapToPay.js for the two facts that shape this component:
 *
 *   • Android Beam (phone-to-phone NFC) was removed in Android 14. It is gone,
 *     not merely unfashionable.
 *   • Web NFC reads passive TAGS. Card emulation is explicitly out of scope,
 *     and the API exists only in Chrome on Android — no iOS at all.
 *
 * So the tap moves the ADDRESS, and the wallet moves the MONEY. That split is
 * not a compromise forced by the platform; it is the correct security model.
 * A payment that could be triggered by proximity alone would let a stranger in
 * a queue drain a phone. The user must read the amount and the destination and
 * press confirm in their own wallet, every time.
 *
 * ─── WHY QR IS FIRST AND NFC IS THE BONUS ───────────────────────────────────
 * NFC reaches roughly 6% of browsers and 0% of iPhones. Building the flow
 * around it would mean building a feature most people cannot use. QR works
 * everywhere, needs no permission, and solves the identical problem: getting
 * 42 characters from one phone to another without typing them.
 *
 * NFC is offered when it exists because it is genuinely faster. It is never
 * required.
 */
export default function TapToPay({ onAddress }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const { address: myAddress, chainId } = useWallet();

  const [mode, setMode] = useState('receive');
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState(null);
  const [got, setGot] = useState(null);
  const [manual, setManual] = useState('');

  const abortRef = useRef(null);

  /*
   * Stop any live NFC scan when this component goes away.
   *
   * Without it, a scan started here keeps listening after the user navigates
   * on, and a tag tapped later resolves a promise whose UI no longer exists.
   * The browser also keeps the NFC radio active, which is a battery cost the
   * user did not agree to.
   */
  useEffect(() => () => abortRef.current?.abort(), []);

  const supported = nfcSupported();
  const reason = supported ? null : nfcUnavailableReason();

  const scan = useCallback(async () => {
    setErr(null);
    setGot(null);
    setScanning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const parsed = await readNfcAddress({ signal: ctrl.signal });
      setGot(parsed);
      haptic?.('success');
      onAddress?.(parsed);
    } catch (e) {
      setErr(e.message || 'NFC_SCAN_FAILED');
      haptic?.('error');
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [haptic, onAddress]);

  const useManual = () => {
    const parsed = parsePayLink(manual);
    if (!parsed) {
      setErr('BAD_ADDRESS');
      haptic?.('error');
      return;
    }
    setErr(null);
    setGot(parsed);
    haptic?.('success');
    onAddress?.(parsed);
  };

  /*
   * The payload the OTHER phone reads. Built from OUR connected wallet, so
   * there is nothing to type and nothing to mistype — the address is the one
   * already proven to be ours by the wallet connection.
   */
  let payLink = null;
  try {
    payLink = myAddress ? buildPayLink(myAddress, chainId) : null;
  } catch {
    payLink = null;
  }

  return (
    <div className="card card-soft">
      <div className="row-between">
        <strong style={{ fontSize: 14 }}>{t('tap.title')}</strong>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.8 }}>
        {t('tap.intro')}
      </p>

      <div className="seg" style={{ marginTop: 12 }}>
        <button
          className={mode === 'receive' ? 'seg-on' : ''}
          onClick={() => {
            setMode('receive');
            haptic?.('select');
          }}
        >
          {t('tap.iReceive')}
        </button>
        <button
          className={mode === 'pay' ? 'seg-on' : ''}
          onClick={() => {
            setMode('pay');
            haptic?.('select');
          }}
        >
          {t('tap.iPay')}
        </button>
      </div>

      {mode === 'receive' ? (
        <div style={{ marginTop: 12 }}>
          {payLink ? (
            <>
              <div className="faint">{t('tap.showThis')}</div>
              <div
                className="mono"
                style={{ fontSize: 11, wordBreak: 'break-all', marginTop: 6, lineHeight: 1.7 }}
              >
                {payLink}
              </div>
              {/*
                Deliberately NOT offering "write this to an NFC tag".

                Writing needs a blank physical tag, which nobody has in a shop,
                and a tag written once keeps paying whoever wrote it. A shown
                code is read now and gone; a programmed tag left behind is a
                trap. The receive side is a code on screen.
              */}
              <p className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.8 }}>
                {t('tap.receiveHelp')}
              </p>
            </>
          ) : (
            <p className="notice" style={{ marginTop: 4 }}>{t('tap.connectFirst')}</p>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {supported ? (
            <button className="btn btn-primary" onClick={scan} disabled={scanning}>
              {scanning ? t('tap.holdNear') : t('tap.startScan')}
            </button>
          ) : (
            /*
              The REASON, not a generic "unsupported".

              An iPhone user cannot fix this by updating anything, and telling
              them to try another browser sends them in a circle — every iOS
              browser is WebKit underneath. They need to be told to use the
              code instead, which works perfectly.
            */
            <p className="notice" style={{ marginTop: 0 }}>
              {t(`tap.reason.${reason}`, t('tap.reason.BROWSER_UNSUPPORTED'))}
            </p>
          )}

          <div className="field-label" style={{ marginTop: 12 }}>{t('tap.orPaste')}</div>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="0x… / ethereum:0x…"
              spellCheck={false}
              style={{ flex: 1 }}
            />
            <button className="btn btn-ghost btn-sm" onClick={useManual}>
              {t('common.confirm')}
            </button>
          </div>

          {got && (
            <div className="notice" style={{ marginTop: 11 }}>
              {t('tap.gotAddress', { addr: shortAddress(got.address) })}
              {/*
                THE CONFIRMATION STEP, STATED WHERE IT CANNOT BE MISSED.

                Nothing has been sent at this point and the user must be
                certain of that. The tap filled in a destination; the transfer
                still has to be authorised in their own wallet, where they will
                see the amount and this address again before signing.
              */}
              <p className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.8 }}>
                {t('tap.nothingSentYet')}
              </p>
            </div>
          )}

          {err && (
            <p className="notice notice-danger" style={{ marginTop: 11 }}>
              {t(`tap.err.${err}`, t('tap.err.NFC_SCAN_FAILED'))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
