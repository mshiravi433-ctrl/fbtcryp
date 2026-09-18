import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { EVM_CHAINS } from '../lib/chains';
import { securityScore, approvalCheckerUrl } from '../lib/walletRisk';
import { IconShield, IconExternal, IconChevronRight } from './Icons';

/**
 * SECURITY CENTER — a compact card on the wallet screen opening a bottom
 * sheet. Deliberately NOT a menu page.
 *
 * ─── HONEST SOURCES ONLY ────────────────────────────────────────────────────
 * The score is built from real local signals: 2FA, biometrics, auto-lock and
 * the current wallet mode/lock state. There is no approval indexer, so the
 * approvals row says `not scanned` — never "✓ no suspicious approvals".
 * Revoking approvals is a user-initiated transaction through the chain
 * explorer's own tool; this card only links to it.
 */
function Row({ label, children }) {
  return (
    <div className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="faint" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'end' }}>{children}</span>
    </div>
  );
}

export default function SecurityCenterCard() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const biometricEnabled = useSettingsStore((s) => s.biometricEnabled);
  const twoFactorEnabled = useSettingsStore((s) => s.twoFactorEnabled);
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const [open, setOpen] = useState(false);

  const score = securityScore({
    biometricEnabled,
    twoFactorEnabled,
    autoLockMinutes,
    lockedNow: Boolean(wallet.locked)
  });

  const connected = Boolean(wallet.address) && !wallet.locked;
  const chainCfg = EVM_CHAINS[wallet.chainId];
  const revokeUrl = approvalCheckerUrl(wallet.chainId, EVM_CHAINS);

  return (
    <>
      <button
        type="button"
        className="wallet-pie-card wal-sec-card"
        onClick={() => setOpen(true)}
      >
        <span className="row" style={{ gap: 10, flex: 1 }}>
          <span className="wal-sec-ico"><IconShield width={18} height={18} /></span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
            <strong style={{ fontSize: 13 }}>{t('wallet.security.title')}</strong>
            <small className="faint" style={{ display: 'block', fontSize: 10.5, marginTop: 2 }}>
              {score.score != null
                ? `${score.score} · ${t(`wallet.security.band.${score.band}`)}`
                : t('wallet.security.notConfigured')}
            </small>
          </span>
        </span>
        <IconChevronRight width={14} height={14} />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('wallet.security.title')} anchor="bottom">
        <div className="stack" style={{ gap: 12 }}>
          {/* score */}
          <div className="wallet-pie-card" style={{ padding: 14, borderRadius: 16 }}>
            <div className="row-between">
              <span className="faint" style={{ fontSize: 11.5 }}>{t('wallet.security.score')}</span>
              <span className="mono" style={{ fontWeight: 900, fontSize: 18 }}>
                {score.score != null
                  ? <span style={{ color: score.band === 'high' ? 'var(--up)' : score.band === 'medium' ? 'var(--rgb-5)' : 'var(--down)' }}>{score.score}<span style={{ fontSize: 11, opacity: 0.7 }}>/95</span></span>
                  : <span className="faint">—</span>}
              </span>
            </div>
            {score.score == null && (
              <p className="muted" style={{ fontSize: 11, margin: '8px 2px 0', lineHeight: 1.7 }}>{t('wallet.security.scoreNote')}</p>
            )}
          </div>

          {/* facts */}
          <div className="wallet-pie-card" style={{ padding: 14, borderRadius: 16 }}>
            <Row label={t('wallet.security.connection')}>
              {wallet.mode === 'wc' ? t('wallet.security.wcSession') : wallet.mode === 'local' ? t('wallet.mode.local') : t('wallet.security.injected')}
              {connected && <span className="pill pill-up" style={{ fontSize: 9, marginInlineStart: 6 }}>{t('wallet.active.title')}</span>}
              {wallet.locked && <span className="pill" style={{ fontSize: 9, marginInlineStart: 6 }}>🔒 {t('wallet.lock')}</span>}
            </Row>
            <Row label={t('wallet.security.twoFactor')}>
              {twoFactorEnabled ? <span className="up" style={{ fontWeight: 800 }}>{t('common.on')}</span> : <span className="faint">{t('common.off')}</span>}
            </Row>
            <Row label={t('wallet.security.biometric')}>
              {biometricEnabled ? <span className="up" style={{ fontWeight: 800 }}>{t('common.on')}</span> : <span className="faint">{t('common.off')}</span>}
            </Row>
            <Row label={t('wallet.security.autoLock')}>
              {Number.isFinite(Number(autoLockMinutes)) && Number(autoLockMinutes) > 0
                ? `${autoLockMinutes} ${t('wallet.security.minutes')}`
                : <span className="faint">—</span>}
            </Row>
            <Row label={t('wallet.security.network')}>
              {chainCfg ? `${chainCfg.short} (${wallet.chainId})` : <span className="faint">—</span>}
            </Row>
            <Row label={t('wallet.security.approvals')}>
              <span className="wal-note" style={{ fontSize: 10 }}>{t('wallet.security.notScanned')}</span>
            </Row>
          </div>

          <p className="muted" style={{ fontSize: 11, lineHeight: 1.75, margin: 0 }}>{t('wallet.security.body')}</p>

          {revokeUrl ? (
            <button
              className="btn btn-ghost"
              style={{ minHeight: 46, borderRadius: 14, width: '100%' }}
              onClick={() => window.open(revokeUrl, '_blank', 'noopener,noreferrer')}
            >
              <IconExternal width={14} height={14} /> {t('wallet.security.revoke')} ↗
            </button>
          ) : (
            <p className="notice" style={{ fontSize: 11.5 }}>{t('wallet.security.noRevokeTool')}</p>
          )}
        </div>
      </Sheet>
    </>
  );
}
