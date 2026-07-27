import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import {
  createVault,
  generateMnemonic,
  hasVault,
  passwordStrength,
  validateMnemonic
} from '../lib/localWallet';

/**
 * Wallet onboarding. Deliberately ordered so the safest option is first and
 * visually dominant; the in-app wallet is presented with its real trade-offs
 * rather than as the friendly default.
 */
export default function WalletConnectSheet({ open, onClose }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const [view, setView] = useState('choose'); // choose | create | backup | confirm | import | unlock
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const strength = passwordStrength(password);

  const reset = () => {
    setView('choose');
    setMnemonic('');
    setImportPhrase('');
    setPassword('');
    setPassword2('');
    setAck(false);
    setErr(null);
  };

  const close = () => {
    reset();
    onClose?.();
  };

  const startCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const phrase = await generateMnemonic();
      setMnemonic(phrase);
      setView('backup');
    } catch {
      setErr('GENERATE_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const finishCreate = async (phrase) => {
    if (password.length < 8) return setErr('PASSWORD_SHORT');
    if (password !== password2) return setErr('PASSWORD_MISMATCH');
    if (!ack) return setErr('MUST_ACK');
    setBusy(true);
    setErr(null);
    try {
      await createVault(phrase, password);
      await wallet.unlockLocal(password);
      haptic?.('success');
      close();
    } catch {
      setErr('CREATE_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    const phrase = importPhrase.trim().replace(/\s+/g, ' ');
    if (!(await validateMnemonic(phrase))) return setErr('BAD_MNEMONIC');
    return finishCreate(phrase);
  };

  const doUnlock = async () => {
    setBusy(true);
    setErr(null);
    const ok = await wallet.unlockLocal(password);
    setBusy(false);
    if (ok) {
      haptic?.('success');
      close();
    } else {
      setErr('BAD_PASSWORD');
    }
  };

  return (
    <Sheet open={open} onClose={close}>
      {/* ------------------------------ choose ------------------------------ */}
      {view === 'choose' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.connectTitle')}</h2>
          <p className="muted" style={{ marginBottom: 14 }}>{t('wallet.connectSubtitle')}</p>

          <div className="stack" style={{ gap: 10 }}>
            <motion.button
              className="card card-rgb"
              whileTap={{ scale: 0.985 }}
              onClick={() => wallet.connectWalletConnect().then((ok) => ok && close())}
              disabled={wallet.connecting}
              style={{ textAlign: 'start', cursor: 'pointer' }}
            >
              <div className="sheen" />
              <div className="row-between">
                <div className="row" style={{ gap: 10 }}>
                  <div className="coin-logo" style={{ fontSize: 17 }}>🔗</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('wallet.wc')}</div>
                    <div className="faint">{t('wallet.wcDesc')}</div>
                  </div>
                </div>
                <span className="pill pill-up">{t('wallet.recommended')}</span>
              </div>
            </motion.button>

            {typeof window !== 'undefined' && window.ethereum && (
              <motion.button
                className="card"
                whileTap={{ scale: 0.985 }}
                onClick={() => wallet.connectInjected().then((ok) => ok && close())}
                disabled={wallet.connecting}
                style={{ textAlign: 'start', cursor: 'pointer' }}
              >
                <div className="row" style={{ gap: 10 }}>
                  <div className="coin-logo" style={{ fontSize: 17 }}>🦊</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('wallet.injected')}</div>
                    <div className="faint">{t('wallet.injectedDesc')}</div>
                  </div>
                </div>
              </motion.button>
            )}

            {hasVault() ? (
              <motion.button
                className="card"
                whileTap={{ scale: 0.985 }}
                onClick={() => setView('unlock')}
                style={{ textAlign: 'start', cursor: 'pointer' }}
              >
                <div className="row" style={{ gap: 10 }}>
                  <div className="coin-logo" style={{ fontSize: 17 }}>🔓</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('wallet.unlockLocal')}</div>
                    <div className="faint">{t('wallet.unlockLocalDesc')}</div>
                  </div>
                </div>
              </motion.button>
            ) : (
              <>
                <motion.button
                  className="card"
                  whileTap={{ scale: 0.985 }}
                  onClick={startCreate}
                  disabled={busy}
                  style={{ textAlign: 'start', cursor: 'pointer' }}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <div className="coin-logo" style={{ fontSize: 17 }}>✨</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('wallet.createLocal')}</div>
                      <div className="faint">{t('wallet.createLocalDesc')}</div>
                    </div>
                  </div>
                </motion.button>

                <motion.button
                  className="card"
                  whileTap={{ scale: 0.985 }}
                  onClick={() => setView('import')}
                  style={{ textAlign: 'start', cursor: 'pointer' }}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <div className="coin-logo" style={{ fontSize: 17 }}>📥</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('wallet.importLocal')}</div>
                      <div className="faint">{t('wallet.importLocalDesc')}</div>
                    </div>
                  </div>
                </motion.button>
              </>
            )}
          </div>

          <p className="notice notice-danger" style={{ marginTop: 14 }}>{t('wallet.localRisk')}</p>

          {wallet.error === 'NO_WC_PROJECT_ID' && (
            <p className="notice" style={{ marginTop: 10 }}>{t('wallet.noWcProject')}</p>
          )}
          {wallet.error === 'CONNECT_FAILED' && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.connectFailed')}</p>
          )}
        </>
      )}

      {/* ------------------------------ backup ------------------------------ */}
      {view === 'backup' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.backupTitle')}</h2>
          <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('wallet.backupWarning')}</p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 7,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(255,255,255,.04)',
              border: '1px solid var(--line-strong)'
            }}
          >
            {mnemonic.split(' ').map((w, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="mono"
                style={{ fontSize: 11.5, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,.4)' }}
              >
                <span style={{ color: 'var(--text-3)', marginInlineEnd: 5 }}>{i + 1}</span>
                {w}
              </motion.div>
            ))}
          </div>

          <button
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={() => {
              navigator.clipboard?.writeText(mnemonic);
              haptic?.('success');
            }}
          >
            {t('common.copy')}
          </button>

          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setView('confirm')}>
            {t('wallet.savedIt')}
          </button>
        </>
      )}

      {/* --------------------------- set password --------------------------- */}
      {(view === 'confirm' || view === 'import') && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            {view === 'import' ? t('wallet.importTitle') : t('wallet.setPassword')}
          </h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('wallet.passwordDesc')}</p>

          {view === 'import' && (
            <>
              <label className="field-label">{t('wallet.seedPhrase')}</label>
              <textarea
                value={importPhrase}
                onChange={(e) => setImportPhrase(e.target.value)}
                rows={3}
                placeholder="word1 word2 word3 …"
                style={{
                  width: '100%',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  color: 'var(--text-1)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  padding: 12,
                  resize: 'vertical',
                  marginBottom: 10
                }}
              />
            </>
          )}

          <label className="field-label">{t('wallet.password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />

          <div className="progress" style={{ marginTop: 7 }}>
            <motion.div
              className="progress-fill"
              animate={{ width: `${(strength.score / 5) * 100}%` }}
              style={{
                background:
                  strength.score <= 1
                    ? 'var(--down)'
                    : strength.score <= 3
                      ? 'var(--rgb-5)'
                      : 'linear-gradient(90deg,var(--rgb-4),var(--rgb-1))'
              }}
            />
          </div>
          <div className="faint" style={{ marginTop: 4 }}>{t(`wallet.strength.${strength.label}`)}</div>

          <label className="field-label" style={{ marginTop: 10 }}>{t('wallet.passwordConfirm')}</label>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />

          <label
            className="row"
            style={{ gap: 9, marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              style={{ width: 17, height: 17, marginTop: 2, accentColor: '#00e5ff', flexShrink: 0 }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>{t('wallet.ackText')}</span>
          </label>

          {err && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`wallet.err.${err}`)}</p>}

          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={reset}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => (view === 'import' ? doImport() : finishCreate(mnemonic))}
            >
              {busy ? t('common.loading') : t('wallet.createConfirm')}
            </button>
          </div>
        </>
      )}

      {/* ------------------------------ unlock ------------------------------ */}
      {view === 'unlock' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.unlockTitle')}</h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('wallet.unlockDesc')}</p>

          <label className="field-label">{t('wallet.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doUnlock()}
            autoComplete="current-password"
          />

          {err && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`wallet.err.${err}`)}</p>}

          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={reset}>{t('common.back')}</button>
            <button className="btn btn-primary" disabled={busy || !password} onClick={doUnlock}>
              {busy ? t('common.loading') : t('wallet.unlock')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
