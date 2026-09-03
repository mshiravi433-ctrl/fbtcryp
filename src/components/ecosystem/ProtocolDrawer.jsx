import { motion } from 'framer-motion';
import { IconExternal } from '../Icons';

/**
 * PROTOCOL DETAIL DRAWER
 * ---------------------------------------------------------------------------
 * Displays detailed information about a selected protocol, network, or provider.
 * Lazy-loaded for performance. Shows:
 *   - Header with logo, name, status
 *   - Type, networks, usage, capabilities
 *   - Integration type and health info
 *   - Capability list (read/quote/prepare/simulate/execute/verify)
 */

const STATUS_COLORS = {
  OPERATIONAL: '#00ff9d',
  DEGRADED: '#ffb300',
  OFFLINE: '#ff3b6b',
  UNKNOWN: '#5b647f'
};

function monogram(name) {
  return String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
}

export default function ProtocolDrawer({ item, onClose, onOpenUrl, t }) {
  if (!item) return null;

  const status = item.status || 'UNKNOWN';
  const statusColor = STATUS_COLORS[status];
  const capabilities = item.capabilities || [];

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="eco-drawer-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* Drawer */}
      <motion.div
        className="eco-drawer"
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} details`}
      >
        {/* Handle */}
        <div className="eco-drawer-handle" />

        {/* Header */}
        <div className="eco-drawer-header">
          <div className="eco-drawer-logo" style={{ '--card-hue': item.hue || '#7c4dff' }}>
            {item.url || item.homepage ? (
              <img
                src={`https://www.google.com/s2/favicons?sz=64&domain=${extractDomain(item.url || item.homepage)}`}
                alt=""
                width={28}
                height={28}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.textContent = monogram(item.name);
                }}
              />
            ) : (
              <span style={{ color: '#000', fontWeight: 700, fontSize: 11 }}>{monogram(item.name)}</span>
            )}
          </div>
          <div className="eco-drawer-header-text">
            <h3 className="eco-drawer-name">{item.name}</h3>
            <div className="eco-drawer-status">
              <span className="eco-drawer-dot" style={{ background: statusColor }} />
              <span style={{ color: statusColor }}>{t(`eco.status.${status.toLowerCase()}`, status)}</span>
            </div>
          </div>
          <button className="eco-drawer-close" onClick={onClose} aria-label={t('common.close', 'Close')}>
            ✕
          </button>
        </div>

        {/* Details */}
        <div className="eco-drawer-body">
          {/* Type */}
          {item.type && (
            <div className="eco-drawer-row">
              <span className="eco-drawer-label">{t('eco.drawer.type', 'Type')}</span>
              <span className="eco-drawer-value">{item.type}</span>
            </div>
          )}

          {/* Category */}
          {item.category && (
            <div className="eco-drawer-row">
              <span className="eco-drawer-label">{t('eco.drawer.category', 'Category')}</span>
              <span className="eco-drawer-value">{item.category}</span>
            </div>
          )}

          {/* Networks */}
          {item.networks?.length > 0 && (
            <div className="eco-drawer-row eco-drawer-row--full">
              <span className="eco-drawer-label">{t('eco.drawer.networks', 'Networks')}</span>
              <div className="eco-drawer-networks">
                {item.networks.map(n => (
                  <span key={n.id || n.short} className="eco-drawer-network-tag">
                    {n.name || n.short}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Role / Purpose */}
          {(item.role || item.purpose || item.description) && (
            <div className="eco-drawer-row eco-drawer-row--full">
              <span className="eco-drawer-label">{t('eco.drawer.usage', 'FBT Usage')}</span>
              <span className="eco-drawer-desc">{item.role || item.purpose || item.description}</span>
            </div>
          )}

          {/* Capabilities */}
          {capabilities.length > 0 && (
            <div className="eco-drawer-row eco-drawer-row--full">
              <span className="eco-drawer-label">{t('eco.drawer.capabilities', 'Capabilities')}</span>
              <div className="eco-drawer-capabilities">
                {['read', 'quote', 'prepare', 'simulate', 'execute', 'verify'].map(cap => {
                  const has = capabilities.includes(cap);
                  return (
                    <span key={cap} className={`eco-drawer-cap ${has ? 'eco-drawer-cap--active' : ''}`}>
                      {has ? '✓' : '—'} {cap.toUpperCase()}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* FBT commission — the money relationship for this integration */}
          {item.fee && (
            <div className="eco-drawer-row eco-drawer-row--full">
              <span className="eco-drawer-label">{t('eco.drawer.fee', 'FBT Commission')}</span>
              <div className="eco-drawer-fee">
                <span className={item.fee.active ? 'eco-fee-chip' : 'eco-drawer-fee-muted'}>
                  {item.fee.active
                    ? t('eco.drawer.feeLive', '{{pct}}% ({{bps}} bps) → FBT', { pct: item.fee.percent, bps: item.fee.bps })
                    : t('eco.drawer.feeNotLive', '{{pct}}% configured when enabled', { pct: item.fee.percent })}
                </span>
                {item.fee.active && item.fee.providerCutPercent > 0 && (
                  <span className="eco-drawer-fee-net">
                    {t('eco.drawer.feeNet', 'net {{net}} bps after provider {{cut}}% share', { net: item.fee.netBps, cut: item.fee.providerCutPercent })}
                  </span>
                )}
                {item.fee.active && (
                  <span className="eco-drawer-fee-receiver mono">
                    {t('eco.drawer.feeReceiver', 'Receiver')}: {shortAddress(item.fee.receiver)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Health Info */}
          {item.lastSuccessAt && (
            <div className="eco-drawer-row">
              <span className="eco-drawer-label">{t('eco.drawer.lastSuccess', 'Last Success')}</span>
              <span className="eco-drawer-value mono">{formatDate(item.lastSuccessAt)}</span>
            </div>
          )}

          {item.lastFailureAt && (
            <div className="eco-drawer-row">
              <span className="eco-drawer-label">{t('eco.drawer.lastFailure', 'Last Failure')}</span>
              <span className="eco-drawer-value mono">{formatDate(item.lastFailureAt)}</span>
            </div>
          )}

          {/* Chain type for networks */}
          {item.chainType && (
            <div className="eco-drawer-row">
              <span className="eco-drawer-label">{t('eco.drawer.chainType', 'Chain Type')}</span>
              <span className="eco-drawer-value">{item.chainType}</span>
            </div>
          )}

          {item.type === 'EVM' && item.chainId && (
            <div className="eco-drawer-row">
              <span className="eco-drawer-label">{t('eco.drawer.chainId', 'Chain ID')}</span>
              <span className="eco-drawer-value mono">{item.chainId}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        {(item.url || item.homepage) && (
          <div className="eco-drawer-footer">
            <button
              className="eco-drawer-link-btn"
              onClick={() => onOpenUrl(item.url || item.homepage)}
            >
              <span>{t('eco.drawer.visitSite', 'Visit Official Site')}</span>
              <IconExternal width={14} height={14} />
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function shortAddress(addr) {
  const s = String(addr || '');
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
