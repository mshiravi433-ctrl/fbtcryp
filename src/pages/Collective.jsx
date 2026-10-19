import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import WalletConnectSheet from '../components/WalletConnectSheet';
import { useWallet } from '../context/WalletContext';
import {
  IconActivity,
  IconChevronLeft,
  IconInfo,
  IconPools,
  IconShield,
  IconWallet
} from '../components/Icons';
import { collectiveApi } from '../lib/collective/api';
import { collectiveChainFromPayload } from '../lib/collective/constants';
import {
  claimCollectiveIncome,
  depositIntoCollective,
  parseCollectiveAmount,
  previewCollectiveWithdrawal,
  requestCollectiveWithdrawal
} from '../lib/collective/transactions';
import '../styles/collective.css';

const localizeAmount = (raw, decimals = 6, locale = 'en', digits = 4) => {
  try {
    const value = BigInt(raw || 0);
    const sign = value < 0n ? '−' : '';
    const abs = value < 0n ? -value : value;
    const scale = 10n ** BigInt(Math.max(0, Number(decimals) || 0));
    const whole = abs / scale;
    const fractional = abs % scale;
    const wholeText = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
    if (!fractional || digits <= 0) return `${sign}${wholeText}`;
    const fractionText = fractional.toString().padStart(Number(decimals), '0').slice(0, digits).replace(/0+$/, '');
    return fractionText ? `${sign}${wholeText}${locale.startsWith('fa') ? '٫' : '.'}${fractionText}` : `${sign}${wholeText}`;
  } catch {
    return '—';
  }
};

const formatUsdE8 = (raw, locale) => `${localizeAmount(raw, 8, locale, 2)} USD`;
const formatBps = (raw, locale) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format((Number(raw) || 0) / 100)}%`;
const shortAddress = (value) => value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—';
const displayTime = (seconds, locale) => {
  const timestamp = Number(seconds || 0);
  if (!timestamp) return '—';
  try { return new Date(timestamp * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return new Date(timestamp * 1000).toISOString(); }
};

function stateLabel(module, t) {
  if (module?.enabled) return t('collective.module.readConfigured', { defaultValue: 'Read configuration verified' });
  return t('collective.module.disabled', { defaultValue: 'Disabled' });
}

function reasonLabel(reason, t) {
  const key = `collective.reason.${String(reason || 'UNKNOWN')}`;
  const defaults = {
    READS_DISABLED: 'Public chain reads are disabled until an operator verifies deployment settings.',
    RPC_NOT_CONFIGURED: 'A verified read-only RPC endpoint is not configured.',
    FACTORY_ADDRESS_NOT_CONFIGURED: 'No factory address is configured.',
    ASSET_ADDRESS_NOT_CONFIGURED: 'No accounting-asset address is configured.',
    DEPLOYMENT_BLOCK_NOT_CONFIGURED: 'The factory deployment block is not configured for bounded history indexing.',
    UNSUPPORTED_CHAIN: 'The Collective supports Robinhood Chain (4663) and Robinhood Chain Testnet (46630) only.',
    CHAIN_ID_MISMATCH: 'The configured RPC did not verify as the expected chain.',
    FACTORY_HAS_NO_CODE: 'No contract code was found at the configured factory address.',
    ASSET_HAS_NO_CODE: 'No contract code was found at the configured accounting-asset address.',
    FACTORY_ASSET_MISMATCH: 'The factory accounting asset does not match the configured asset.',
    COLLECTIVE_NOT_CONFIGURED: 'Public chain reads are not configured for this deployment.',
    VERIFIED_DEPLOYMENT_CONFIGURATION_REQUIRED: 'A deployment must be verified before this module can be used.',
    DEDICATED_LP_ADAPTER_AND_ORACLE_REVIEW_REQUIRED: 'Disabled pending a dedicated liquidity/farming adapter and oracle review.',
    DEDICATED_TRADING_ACCOUNTING_AND_INDEPENDENT_REVIEW_REQUIRED: 'Disabled pending separate trading accounting and independent review.',
    EVENT_INDEX_NOT_CONFIGURED: 'The bounded public event index is not configured.',
    COLLECTIVE_READ_FAILED: 'A safe read from the configured chain endpoint failed.'
  };
  return t(key, { defaultValue: defaults[reason] || String(reason || 'Configuration is not ready.') });
}

export default function Collective() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const [connectOpen, setConnectOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState(null);
  const [vaults, setVaults] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [vault, setVault] = useState(null);
  const [position, setPosition] = useState(null);
  const [events, setEvents] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [apiError, setApiError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [depositInput, setDepositInput] = useState('');
  const [withdrawInput, setWithdrawInput] = useState('');
  const [withdrawalQuote, setWithdrawalQuote] = useState(null);
  const [activation, setActivation] = useState(null);
  const [activationError, setActivationError] = useState('');

  const loadDeployment = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setApiError('');
    try {
      const nextStatus = await collectiveApi.status();
      setStatus(nextStatus);
      if (!nextStatus.ready) {
        setVaults([]);
        setSelectedAddress('');
        setVault(null);
        setPosition(null);
        setEvents([]);
        setProposals([]);
        return;
      }
      const result = await collectiveApi.vaults();
      const rows = Array.isArray(result?.vaults) ? result.vaults : [];
      setVaults(rows);
      setSelectedAddress((current) => rows.some((row) => row.address.toLowerCase() === current.toLowerCase())
        ? current
        : rows[0]?.address || '');
    } catch (cause) {
      setApiError(String(cause?.code || 'COLLECTIVE_API_UNAVAILABLE'));
      setVaults([]);
      setVault(null);
      setPosition(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDeployment();
    const timer = window.setInterval(() => void loadDeployment({ quiet: true }), 60_000);
    return () => window.clearInterval(timer);
  }, [loadDeployment]);

  // The activation status comes from the public GitHub Actions API (through
  // our own read-only endpoint) and is independent of our wallet. A failure
  // here must never block the rest of the page: the panel degrades to the last
  // committed evidence and says so.
  const loadActivation = useCallback(async () => {
    setActivationError('');
    try {
      setActivation(await collectiveApi.activation());
    } catch (cause) {
      setActivationError(String(cause?.code || 'ACTIVATION_STATUS_UNAVAILABLE'));
    }
  }, []);

  useEffect(() => {
    void loadActivation();
    const timer = window.setInterval(() => void loadActivation(), 300_000);
    return () => window.clearInterval(timer);
  }, [loadActivation]);

  const loadVaultData = useCallback(async () => {
    if (!selectedAddress) {
      setVault(null);
      setPosition(null);
      setEvents([]);
      setProposals([]);
      return;
    }
    try {
      const [nextVault, nextProposals, history, nextPosition] = await Promise.all([
        collectiveApi.vault(selectedAddress),
        collectiveApi.proposals(selectedAddress),
        collectiveApi.events(selectedAddress, wallet.isConnected && wallet.address ? { wallet: wallet.address } : {}),
        wallet.isConnected && wallet.address
          ? collectiveApi.position(selectedAddress, wallet.address)
          : Promise.resolve(null)
      ]);
      setVault(nextVault);
      setProposals(Array.isArray(nextProposals?.proposals) ? nextProposals.proposals : []);
      setEvents(Array.isArray(history?.events) ? history.events.slice(-12).reverse() : []);
      setPosition(nextPosition);
    } catch (cause) {
      setApiError(String(cause?.code || 'COLLECTIVE_READ_FAILED'));
      setVault(null);
      setPosition(null);
      setEvents([]);
      setProposals([]);
    }
  }, [selectedAddress, wallet.address, wallet.isConnected]);

  useEffect(() => { void loadVaultData(); }, [loadVaultData]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadVaultData(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadVaultData]);

  const asset = vault?.asset;
  const chain = collectiveChainFromPayload(status) || collectiveChainFromPayload(activation);
  const collectiveChainId = Number(chain?.id);
  const supportedChain = chain?.supported === true && Number.isSafeInteger(collectiveChainId) && collectiveChainId > 0;
  const chainName = chain?.name || '';
  const onCollectiveChain = wallet.isConnected && supportedChain && Number(wallet.chainId) === collectiveChainId;
  const depositsOpen = Boolean(vault?.epoch?.depositsOpen && !vault?.emergency?.paused);
  const withdrawalOpen = Boolean(vault?.epoch?.withdrawalWindowOpen);
  const claimable = BigInt(position?.claimableIncomeRaw || 0);
  const shares = BigInt(position?.shareBalanceRaw || 0);
  const address = selectedAddress;

  const ensureCollectiveChain = async () => {
    if (!wallet.isConnected || !wallet.address) throw new Error('WALLET_NOT_CONNECTED');
    if (!supportedChain) throw new Error('UNSUPPORTED_CHAIN');
    if (Number(wallet.chainId) !== collectiveChainId) {
      const changed = await wallet.switchChain?.(collectiveChainId);
      if (!changed) throw new Error('WRONG_CHAIN');
    }
  };

  const runAction = async (work, successKey) => {
    setBusy(true);
    setActionError('');
    setActionNote('');
    try {
      await ensureCollectiveChain();
      const result = await work();
      const txHash = result?.deposit?.hash || result?.request?.hash || result?.hash || '';
      setActionNote(t(successKey, { hash: txHash, defaultValue: txHash ? `Transaction confirmed: ${txHash}` : 'Transaction confirmed.' }));
      await loadDeployment({ quiet: true });
      await loadVaultData();
      return result;
    } catch (cause) {
      const code = String(cause?.code || cause?.message || 'TRANSACTION_FAILED');
      setActionError(t(`collective.actionError.${code}`, { defaultValue: code }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleDeposit = async (event) => {
    event.preventDefault();
    if (!vault || !asset || !depositsOpen) return;
    let amountRaw;
    try { amountRaw = parseCollectiveAmount(depositInput, asset.decimals); }
    catch { setActionError(t('collective.actionError.INVALID_AMOUNT', { defaultValue: 'Enter a valid amount greater than zero.' })); return; }
    await runAction(() => depositIntoCollective({
      wallet,
      chainId: collectiveChainId,
      assetAddress: asset.address,
      vaultAddress: vault.address,
      amountRaw
    }), 'collective.action.depositSent');
  };

  const previewWithdrawal = async (event) => {
    event.preventDefault();
    if (!vault || !asset || !withdrawalOpen) return;
    setBusy(true);
    setActionError('');
    setWithdrawalQuote(null);
    try {
      await ensureCollectiveChain();
      const assetsRaw = parseCollectiveAmount(withdrawInput, asset.decimals);
      const quote = await previewCollectiveWithdrawal({ wallet, chainId: collectiveChainId, vaultAddress: vault.address, assetsRaw });
      if (BigInt(quote.sharesRaw) > shares) throw new Error('INSUFFICIENT_SHARES');
      setWithdrawalQuote(quote);
    } catch (cause) {
      const code = String(cause?.code || cause?.message || 'WITHDRAWAL_PREVIEW_FAILED');
      setActionError(t(`collective.actionError.${code}`, { defaultValue: code }));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithdrawal = async () => {
    if (!vault || !withdrawalQuote) return;
    const quote = withdrawalQuote;
    setWithdrawalQuote(null);
    await runAction(() => requestCollectiveWithdrawal({
      wallet,
      chainId: collectiveChainId,
      vaultAddress: vault.address,
      sharesRaw: quote.sharesRaw
    }), 'collective.action.withdrawalSent');
  };

  const claimIncome = async () => {
    if (!vault || (claimable === 0n && !position?.claimScanTruncated)) return;
    await runAction(() => claimCollectiveIncome({ wallet, chainId: collectiveChainId, vaultAddress: vault.address, maxEpochs: 12 }), 'collective.action.claimSent');
  };

  const modules = status?.modules || {};
  const showEmpty = status?.ready && !vaults.length;
  const lastSettlementLabel = vault ? t('collective.accounting.epoch', {
    n: vault.epoch.number,
    defaultValue: `Epoch ${vault.epoch.number}`
  }) : '';

  return (
    <PageTransition>
      <div className="collective-page">
        <header className="collective-header">
          <button className="icon-btn" type="button" onClick={() => navigate(-1)} aria-label={t('common.back', { defaultValue: 'Back' })}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <div className="collective-heading">
            <span className="collective-eyebrow"><IconActivity width={14} height={14} /> FBT Swap{chainName ? ` · ${chainName}` : ''}</span>
            <h1>{t('collective.title', { defaultValue: 'FBT AI Collective' })}</h1>
            <p>{t('collective.subtitle', { defaultValue: 'A separate, public vault module. User-owned principal only; every transaction is visible on-chain.' })}</p>
          </div>
          <button type="button" className="collective-refresh" onClick={async () => { await Promise.all([loadDeployment({ quiet: true }), loadActivation()]); await loadVaultData(); }} disabled={refreshing}>
            {refreshing ? '…' : t('collective.refresh', { defaultValue: 'Refresh' })}
          </button>
        </header>

        <div className="collective-publicbar">
          <span className="collective-pill">{t('collective.public.badge', { defaultValue: 'Public module' })}</span>
          <span>{t('collective.public.gas', { defaultValue: 'Every transaction is signed by your connected wallet, and your wallet pays the network gas. No sponsor, paymaster or company subsidy is enabled.' })}</span>
        </div>

        {chain?.testnet === true && (
          <section className="collective-testnet-banner" role="alert" aria-live="polite">
            <strong>{t('collective.testnet.title', { defaultValue: 'TESTNET' })}</strong>
            <span>{t('collective.testnet.body', { defaultValue: 'This is a test network. Test assets have no real-world value.' })}</span>
          </section>
        )}

        <section className="collective-banner" role="note">
          <IconInfo width={18} height={18} />
          <div>
            <strong>{t('collective.disclosure.title', { defaultValue: 'Risk and liquidity disclosure' })}</strong>
            <p>{t('collective.disclosure.body', { defaultValue: 'Returns are variable and not guaranteed. Principal may be lost. Withdrawals use a liquidity-aware queue and are not instant. Network gas is paid by the transacting wallet. The contracts are not independently audited.' })}</p>
          </div>
        </section>

        <ActivationPanel activation={activation} error={activationError} locale={locale} t={t} />

        {loading ? (
          <section className="collective-state-card"><span className="collective-spinner" />{t('collective.loading', { defaultValue: 'Checking verified Collective configuration…' })}</section>
        ) : apiError ? (
          <section className="collective-state-card collective-state-error" role="alert">
            <IconShield width={19} height={19} />
            <div><strong>{t('collective.readError', { defaultValue: 'Collective data is unavailable.' })}</strong><p>{reasonLabel(apiError, t)}</p></div>
            <button className="btn btn-ghost btn-sm" onClick={() => loadDeployment()}>{t('collective.retry', { defaultValue: 'Retry' })}</button>
          </section>
        ) : !status?.ready ? (
          <section className="collective-state-card collective-state-pending" role="status">
            <div className="collective-state-icon"><IconShield width={23} height={23} /></div>
            <div>
              <strong>{t('collective.notConfigured.title', { defaultValue: 'No verified Collective deployment is configured here.' })}</strong>
              <p>{reasonLabel(status?.reason, t)}</p>
              <p className="collective-smallprint">{t('collective.notConfigured.body', { defaultValue: 'Addresses, RPC, and deployment height must be independently verified before public reads or deposits are enabled. No live-chain deployment or funding was performed by this build.' })}</p>
            </div>
          </section>
        ) : showEmpty ? (
          <section className="collective-state-card">
            <div><strong>{t('collective.empty.title', { defaultValue: 'The factory is verified, but it has no registered vaults.' })}</strong><p>{t('collective.empty.body', { defaultValue: 'Vaults appear only after an approved on-chain deployment.' })}</p></div>
          </section>
        ) : (
          <>
            <section className="collective-modules" aria-label={t('collective.modules.title', { defaultValue: 'Vault modules' })}>
              <ModuleCard icon={<IconShield width={18} height={18} />} title={t('collective.modules.stable', { defaultValue: 'Stable-yield vault' })} state={stateLabel(modules.stableYield, t)} active={Boolean(modules.stableYield?.enabled)} />
              <ModuleCard icon={<IconPools width={18} height={18} />} title={t('collective.modules.farming', { defaultValue: 'Farming & liquidity' })} state={reasonLabel(modules.farmingLiquidity?.reason, t)} />
              <ModuleCard icon={<IconActivity width={18} height={18} />} title={t('collective.modules.trading', { defaultValue: 'Approved-token trading' })} state={reasonLabel(modules.approvedTokenTrading?.reason, t)} />
            </section>

            <div className="collective-walletbar">
              <div className="collective-walletinfo">
                <IconWallet width={18} height={18} />
                {wallet.isConnected ? (
                  <span>{shortAddress(wallet.address)}{chainName ? ` · ${chainName}` : ''}{!onCollectiveChain ? ` · ${t('collective.wallet.wrongChain', { chain: chainName, defaultValue: 'Switch network to transact' })}` : ''}</span>
                ) : <span>{t('collective.wallet.readOnly', { defaultValue: 'Read-only until you connect a wallet' })}</span>}
              </div>
              {wallet.isConnected ? (
                !onCollectiveChain && supportedChain && <button className="btn btn-ghost btn-sm" type="button" onClick={() => wallet.switchChain?.(collectiveChainId)}>{t('collective.wallet.switch', { chain: chainName, defaultValue: chainName ? `Switch to ${chainName}` : 'Switch network' })}</button>
              ) : (
                <button className="btn btn-primary btn-sm" type="button" onClick={() => setConnectOpen(true)}>{t('collective.wallet.connect', { defaultValue: 'Connect wallet' })}</button>
              )}
            </div>

            {vault && (
              <>
                <section className="collective-overview card">
                  <div className="collective-section-heading">
                    <div>
                      <span className="collective-eyebrow">{t('collective.overview.eyebrow', { defaultValue: 'LIVE ON-CHAIN ACCOUNTING' })}</span>
                      <h2>{vault.name}</h2>
                      <p>{vault.symbol} · {asset?.symbol} · {lastSettlementLabel}</p>
                    </div>
                    <a className="collective-address" href={`${status.chain.explorer}/address/${vault.address}`} target="_blank" rel="noreferrer">{shortAddress(vault.address)} ↗</a>
                  </div>

                  {vault.emergency?.paused && <div className="collective-pause" role="alert">{t('collective.paused', { defaultValue: 'Emergency pause is active. Deposits and investments are blocked.' })}</div>}

                  <div className="collective-metrics">
                    <Metric label={t('collective.metric.nav', { defaultValue: 'Net asset value' })} value={`${localizeAmount(vault.accounting.totalAssetsRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.pendingIncome', { defaultValue: 'Realized income awaiting settlement' })} value={`${localizeAmount(vault.accounting.realizedIncomeAccruedRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.realizedIncome', { defaultValue: 'Income reserved for claims' })} value={`${localizeAmount(vault.accounting.incomeLiabilityRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.queued', { defaultValue: 'Withdrawal liability' })} value={`${localizeAmount(vault.accounting.withdrawalLiabilityRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                  </div>

                  <div className="collective-epochline">
                    <span className={`collective-dot ${vault.epoch.started ? 'is-active' : ''}`} />
                    <span>{vault.epoch.started ? t('collective.epoch.active', { defaultValue: 'Active epoch' }) : (vault.epoch.withdrawalWindowOpen || vault.epoch.depositsOpen) ? t('collective.epoch.window', { defaultValue: 'Subscription / withdrawal window' }) : t('collective.epoch.closed', { defaultValue: 'Epoch not active' })}</span>
                    <span>·</span><span>{t('collective.epoch.end', { defaultValue: 'Ends' })}: {displayTime(vault.epoch.end || vault.epoch.subscriptionDeadline, locale)}</span>
                    <span>·</span><span>{t('collective.strategy.target', { defaultValue: 'Fixed strategy target' })}: {shortAddress(vault.strategy.target)}</span>
                  </div>
                  <p className="collective-help collective-epoch-policy">{t('collective.epoch.policy', { defaultValue: 'Epochs run for 30 days. Principal requests can open once the period ends; if the strategy is illiquid, settlement may be delayed. Deposits open only for up to seven days after settlement.' })}</p>

                  <div className="collective-metrics collective-metrics-secondary">
                    <Metric label={t('collective.metric.strategyAssets', { defaultValue: 'Strategy position value' })} value={`${localizeAmount(vault.strategy.totalAssetsRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.targetLiquidity', { defaultValue: 'Target-reported withdrawable value' })} value={`${localizeAmount(vault.strategy.maxWithdrawRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.idle', { defaultValue: 'Unencumbered idle principal' })} value={`${localizeAmount(vault.accounting.availablePrincipalIdleRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.reserve', { defaultValue: 'Risk reserve' })} value={`${localizeAmount(vault.accounting.riskReserveRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.expenses', { defaultValue: 'Accrued operating expenses' })} value={`${localizeAmount(vault.accounting.accruedExpensesRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.lossCarry', { defaultValue: 'Unrecovered realized losses' })} value={`${localizeAmount(vault.accounting.realizedLossCarryRaw, asset?.decimals, locale)} ${asset?.symbol}`} />
                    <Metric label={t('collective.metric.oracle', { defaultValue: 'Asset price feed' })} value={vault.risk.assetOracleFresh ? t('collective.risk.fresh', { defaultValue: 'Fresh' }) : t('collective.risk.stale', { defaultValue: 'Stale / unavailable' })} />
                    <Metric label={t('collective.metric.guard', { defaultValue: 'On-chain risk policy' })} value={vault.risk.limits.enabled && vault.risk.kindEnabled ? t('collective.risk.enabled', { defaultValue: 'Enabled' }) : t('collective.risk.blocked', { defaultValue: 'Blocked' })} />
                  </div>

                  <div className="collective-policy-block">
                    <strong>{t('collective.policy.title', { defaultValue: 'Active on-chain limits' })}</strong>
                    <div className="collective-policy-grid">
                      <Metric label={t('collective.policy.maxTrade', { defaultValue: 'Maximum investment' })} value={formatUsdE8(vault.risk.limits.maxTradeUsdE8, locale)} />
                      <Metric label={t('collective.policy.maxAllocation', { defaultValue: 'Allocation cap' })} value={formatBps(vault.risk.limits.maxAllocationBps, locale)} />
                      <Metric label={t('collective.policy.maxSlippage', { defaultValue: 'Maximum slippage' })} value={formatBps(vault.risk.limits.maxSlippageBps, locale)} />
                      <Metric label={t('collective.policy.minLiquidity', { defaultValue: 'Minimum target liquidity' })} value={formatUsdE8(vault.risk.limits.minLiquidityUsdE8, locale)} />
                      <Metric label={t('collective.policy.maxCost', { defaultValue: 'Transaction-cost ceiling' })} value={formatUsdE8(vault.risk.limits.maxTxCostUsdE8, locale)} />
                      <Metric label={t('collective.policy.reserve', { defaultValue: 'Realized-income reserve' })} value={formatBps(vault.risk.limits.reserveBps, locale)} />
                      <Metric label={t('collective.policy.concentration', { defaultValue: 'Concentration cap' })} value={formatBps(vault.risk.limits.maxConcentrationBps, locale)} />
                      <Metric label={t('collective.policy.oracleAge', { defaultValue: 'Maximum oracle age' })} value={`${vault.risk.limits.maxOracleAgeSeconds} sec`} />
                    </div>
                  </div>
                </section>

                <section className="collective-columns">
                  <div className="card collective-action-card">
                    <div className="collective-card-title"><IconWallet width={18} height={18} /><h2>{t('collective.position.title', { defaultValue: 'Your position' })}</h2></div>
                    {position ? (
                      <div className="collective-position-grid">
                        <div><span>{t('collective.position.shares', { defaultValue: 'Vault shares' })}</span><strong>{localizeAmount(position.shareBalanceRaw, vault.shareDecimals, locale)}</strong></div>
                        <div><span>{t('collective.position.principal', { defaultValue: 'Current redemption estimate' })}</span><strong>{localizeAmount(position.redeemableAssetsRaw, asset?.decimals, locale)} {asset?.symbol}</strong></div>
                        <div><span>{t('collective.position.income', { defaultValue: 'Claimable realized income' })}</span><strong>{localizeAmount(position.claimableIncomeRaw, asset?.decimals, locale)} {asset?.symbol}</strong></div>
                      </div>
                    ) : <p className="collective-muted">{t('collective.position.connectToRead', { defaultValue: 'Connect a wallet to read its shares and income claims. No personal data is sent to the API beyond the public address.' })}</p>}
                    {position?.claimScanTruncated && <p className="collective-help">{t('collective.claim.scanMore', { defaultValue: 'More settled epochs remain to scan. Continue the claim checkpoint in batches of up to 12 epochs.' })}</p>}

                    {wallet.isConnected && (
                      <>
                        <form className="collective-form" onSubmit={handleDeposit}>
                          <label htmlFor="collective-deposit">{t('collective.deposit.label', { asset: asset?.symbol || 'stable asset', defaultValue: `Deposit ${asset?.symbol || 'stable asset'}` })}</label>
                          <div className="collective-input-row"><input id="collective-deposit" inputMode="decimal" autoComplete="off" value={depositInput} onChange={(event) => setDepositInput(event.target.value)} placeholder="0.00" disabled={busy || !depositsOpen || !onCollectiveChain} /><span>{asset?.symbol}</span></div>
                          <button className="btn btn-primary" type="submit" disabled={busy || !onCollectiveChain || !depositsOpen || !depositInput}>{busy ? t('collective.action.working', { defaultValue: 'Waiting for wallet…' }) : depositsOpen ? t('collective.deposit.submit', { defaultValue: 'Approve exact amount & deposit' }) : t('collective.deposit.closed', { defaultValue: 'Deposits closed during active epoch' })}</button>
                          <p className="collective-help">{t('collective.deposit.note', { defaultValue: 'The wallet is asked for an exact token approval only. Deposits are open in the launch cohort or post-settlement window, never mid-epoch.' })}</p>
                        </form>

                        <form className="collective-form" onSubmit={previewWithdrawal}>
                          <label htmlFor="collective-withdraw">{t('collective.withdraw.label', { defaultValue: 'Request principal withdrawal' })}</label>
                          <div className="collective-input-row"><input id="collective-withdraw" inputMode="decimal" autoComplete="off" value={withdrawInput} onChange={(event) => { setWithdrawInput(event.target.value); setWithdrawalQuote(null); }} placeholder="0.00" disabled={busy || !withdrawalOpen || !onCollectiveChain} /><span>{asset?.symbol}</span></div>
                          <button className="btn btn-ghost" type="submit" disabled={busy || !onCollectiveChain || !withdrawalOpen || !withdrawInput || shares === 0n}>{t('collective.withdraw.preview', { defaultValue: 'Preview queue request' })}</button>
                          {!withdrawalOpen && <p className="collective-help">{t('collective.withdraw.closed', { defaultValue: 'Principal requests open after the 30-day period ends and for up to seven days after settlement. Requests enter a queue; strategy illiquidity can delay payment.' })}</p>}
                        </form>
                        {withdrawalQuote && (
                          <div className="collective-confirm" role="group">
                            <p>{t('collective.withdraw.confirm', { amount: localizeAmount(withdrawalQuote.quotedAssetsRaw, asset?.decimals, locale), symbol: asset?.symbol, defaultValue: `Request a queued redemption estimated at ${localizeAmount(withdrawalQuote.quotedAssetsRaw, asset?.decimals, locale)} ${asset?.symbol}?` })}</p>
                            <div className="btn-row"><button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={confirmWithdrawal}>{t('collective.withdraw.confirmButton', { defaultValue: 'Confirm request' })}</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => setWithdrawalQuote(null)}>{t('common.cancel', { defaultValue: 'Cancel' })}</button></div>
                          </div>
                        )}
                        <button className="btn btn-ghost collective-claim" type="button" disabled={busy || (claimable === 0n && !position?.claimScanTruncated) || !onCollectiveChain} onClick={claimIncome}>
                          {claimable === 0n && position?.claimScanTruncated
                            ? t('collective.claim.continue', { defaultValue: 'Continue claim scan (gas required)' })
                            : t('collective.claim.button', { amount: localizeAmount(position?.claimableIncomeRaw, asset?.decimals, locale), symbol: asset?.symbol, defaultValue: `Claim realized income · ${localizeAmount(position?.claimableIncomeRaw, asset?.decimals, locale)} ${asset?.symbol}` })}
                        </button>
                      </>
                    )}
                    {actionError && <p className="collective-action-error" role="alert">{actionError}</p>}
                    {actionNote && <p className="collective-action-note" role="status">{actionNote}</p>}
                  </div>

                  <div className="card collective-agent-card">
                    <div className="collective-card-title"><IconActivity width={18} height={18} /><h2>{t('collective.agent.title', { defaultValue: 'Policy proposals' })}</h2></div>
                    <p className="collective-muted">{t('collective.agent.body', { defaultValue: 'A deterministic read-only planner proposes bounded operations from current contract state. It cannot sign, choose arbitrary calldata, or override on-chain risk checks.' })}</p>
                    {proposals.length ? (
                      <div className="collective-proposals">
                        {proposals.map((proposal) => (
                          <article className="collective-proposal" key={proposal.id}>
                            <div><strong>{proposal.action}</strong><span>{proposal.reason}</span></div>
                            <code>{proposal.args.length ? proposal.args.join(', ') : t('collective.agent.noArgs', { defaultValue: 'No arguments' })}</code>
                            <small>{t('collective.agent.signatureRequired', { defaultValue: 'Requires an authorized keeper or user wallet signature.' })}</small>
                          </article>
                        ))}
                      </div>
                    ) : <p className="collective-muted">{t('collective.agent.none', { defaultValue: 'No action is currently proposed.' })}</p>}
                    <p className="collective-help">{t('collective.agent.boundary', { defaultValue: 'Farm/LP and approved-token-trading adapters are disabled pending dedicated accounting and independent review.' })}</p>
                  </div>
                </section>

                <section className="card collective-queue-card">
                  <div className="collective-card-title"><IconPools width={18} height={18} /><h2>{t('collective.queue.title', { defaultValue: 'Liquidity-aware withdrawal queue' })}</h2></div>
                  <div className="collective-queue-summary">
                    <span>{t('collective.queue.pending', { defaultValue: 'Pending principal liability' })}</span>
                    <strong>{localizeAmount(vault.accounting.withdrawalLiabilityRaw, asset?.decimals, locale)} {asset?.symbol}</strong>
                    <span>{t('collective.queue.available', { defaultValue: 'Available for funded payouts' })}</span>
                    <strong>{localizeAmount(vault.accounting.queuedPayoutAvailableRaw, asset?.decimals, locale)} {asset?.symbol}</strong>
                  </div>
                  {vault.queue.requests?.length ? (
                    <div className="collective-queue-list">
                      {vault.queue.requests.map((request) => <div key={request.id} className="collective-queue-row"><span>#{request.id} · {shortAddress(request.owner)}</span><strong>{localizeAmount(request.remainingAssets, asset?.decimals, locale)} {asset?.symbol}</strong></div>)}
                    </div>
                  ) : <p className="collective-muted">{t('collective.queue.empty', { defaultValue: 'No outstanding withdrawal requests.' })}</p>}
                  <p className="collective-help">{t('collective.queue.note', { defaultValue: 'Requests burn vault shares and become FIFO principal liabilities. Income claims and reserves are protected from queue payouts; a blocked head is not skipped.' })}</p>
                </section>

                <section className="card collective-history-card">
                  <div className="collective-card-title"><IconActivity width={18} height={18} /><h2>{t('collective.history.title', { defaultValue: 'Recent on-chain activity' })}</h2></div>
                  {events.length ? events.map((event, index) => <div className="collective-event-row" key={`${event.transactionHash}-${event.logIndex}-${index}`}><span className="collective-event-type">{event.event}</span><code>{shortAddress(event.transactionHash)}</code><span>#{event.blockNumber}</span><a href={`${status.chain.explorer}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">↗</a></div>) : <p className="collective-muted">{t('collective.history.empty', { defaultValue: 'No matching events in the indexed range yet.' })}</p>}
                  <p className="collective-help">{t('collective.history.note', { defaultValue: 'Event history is read from bounded, public chain logs. The connected address filter only changes which public events are displayed.' })}</p>
                </section>
              </>
            )}
          </>
        )}

        <footer className="collective-footer">
          <strong>{t('collective.footer.title', { defaultValue: 'No guaranteed return. No company principal.' })}</strong>
          <span>{t('collective.footer.body', { defaultValue: 'All on-chain actions cost gas. Strategy addresses and risk limits must be verified before deployment. This software is not audited.' })}</span>
        </footer>
      </div>
      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
    </PageTransition>
  );
}

function Metric({ label, value }) {
  return <div className="collective-metric"><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}

function ModuleCard({ icon, title, state, active = false }) {
  return (
    <article className={`collective-module ${active ? 'is-enabled' : 'is-disabled'}`}>
      <span className="collective-module-icon">{icon}</span>
      <div><strong>{title}</strong><span>{state}</span></div>
      <i aria-label={active ? 'enabled' : 'disabled'} />
    </article>
  );
}


/* ------------------------------------------------------------------ */
/* Activation console                                                  */
/* ------------------------------------------------------------------ */

const ACTIVATION_STEP_IDS = ['compile', 'contract', 'api', 'rehearsal', 'live', 'evidence'];
const ACTIVATION_TONE = {
  passed: 'ok',
  failed: 'bad',
  blocked: 'bad',
  running: 'busy',
  queued: 'busy',
  cancelled: 'muted',
  skipped: 'muted',
  unknown: 'muted',
  'never-run': 'muted'
};

function relativeTime(iso, locale) {
  const value = Date.parse(String(iso || ''));
  if (!Number.isFinite(value)) return '';
  const diffSeconds = Math.round((value - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);
  const units = [['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]];
  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, seconds] of units) {
      if (absolute >= seconds || unit === 'second') return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  } catch {
    return '';
  }
  return '';
}

function ActivationPanel({ activation, error, locale, t }) {
  const pipeline = activation?.pipeline || null;
  const deployment = activation?.deployment || null;
  const state = error && !pipeline ? 'unknown' : String(pipeline?.state || 'never-run');
  const steps = (Array.isArray(pipeline?.steps) ? pipeline.steps : [])
    .filter((step) => ACTIVATION_STEP_IDS.includes(step.id));
  const nextStep = String(deployment?.nextStep || 'run-deployment');
  const tone = ACTIVATION_TONE[state] || 'muted';
  const installMissing = pipeline?.installed === false;
  const sourceNote = error
    ? t('collective.activation.unavailable', { defaultValue: 'Activation status could not be fetched from GitHub; showing the last committed evidence.' })
    : pipeline?.evidenceSource === 'local-rehearsal' || pipeline?.evidenceSource === 'local'
      ? t('collective.activation.localNote', { defaultValue: 'This evidence comes from a full local rehearsal in this repository, not from CI yet. Add the workflow once to make the run automatic.' })
      : pipeline?.source === 'snapshot'
        ? t('collective.activation.snapshotNote', { defaultValue: 'GitHub is rate-limiting this read, so the last committed run evidence is shown instead.' })
        : '';

  return (
    <section className="collective-activation" aria-label={t('collective.activation.title', { defaultValue: 'Activation' })}>
      <header className="collective-activation-head">
        <div>
          <span className="collective-eyebrow"><IconActivity width={13} height={13} />{t('collective.activation.eyebrow', { defaultValue: 'ACTIVATION · GITHUB ACTIONS' })}</span>
          <h2>{t('collective.activation.title', { defaultValue: 'Keyless, gas-free activation pipeline' })}</h2>
          <p>{t('collective.activation.body', { defaultValue: 'Build, contract probe, API tests and the full local rehearsal run on GitHub Actions with no secret and no gas. A real chain deployment still needs a funded wallet — it signs inside the runner and is never shared.' })}</p>
        </div>
        <div className="collective-activation-badges">
          <span className="collective-activation-badge is-on">{t('collective.activation.badge.keyless', { defaultValue: 'No key' })}</span>
          <span className="collective-activation-badge is-on">{t('collective.activation.badge.gasFree', { defaultValue: 'Pipeline: no gas' })}</span>
          <span className="collective-activation-badge">{t('collective.activation.badge.actions', { defaultValue: 'GitHub Actions' })}</span>
        </div>
      </header>

      <div className="collective-activation-grid">
        <div className="collective-activation-run">
          <span className={`collective-activation-dot is-${tone}`} aria-hidden="true" />
          <div>
            <strong>{t(`collective.activation.state.${state}`, { defaultValue: state })}</strong>
            {pipeline?.createdAt ? (
              <span>{t('collective.activation.lastRun', { defaultValue: 'Last run' })} · {relativeTime(pipeline.updatedAt || pipeline.createdAt, locale)}</span>
            ) : (
              <span>{t('collective.activation.never', { defaultValue: 'The keyless pipeline has not run yet.' })}</span>
            )}
          </div>
          {pipeline?.url && (
            <a className="collective-activation-link" href={pipeline.url} target="_blank" rel="noreferrer">
              {t('collective.activation.viewRun', { defaultValue: 'View run' })} ↗
            </a>
          )}
        </div>

        <div className="collective-activation-steps" role="list" aria-label={t('collective.activation.steps', { defaultValue: 'Pipeline steps' })}>
          {steps.length ? steps.map((step) => (
            <span
              key={`${step.number}-${step.id}-${step.name}`}
              role="listitem"
              title={step.name}
              className={`collective-activation-step is-${ACTIVATION_TONE[step.status] || 'muted'}`}
            >
              <i aria-hidden="true" />
              {t(`collective.activation.step.${step.id}`, { defaultValue: step.id })}
            </span>
          )) : (
            <span className="collective-activation-step is-muted" role="listitem">
              {t('collective.activation.step.none', { defaultValue: 'No step evidence yet' })}
            </span>
          )}
        </div>

        <div className="collective-activation-next">
          <strong>{t('collective.activation.next.title', { defaultValue: 'Next step' })}</strong>
          <p>{t(`collective.activation.next.${nextStep}`, { defaultValue: nextStep })}</p>
          {deployment?.command && <code>{deployment.command}</code>}
        </div>
      </div>

      <p className="collective-activation-honesty">
        <IconInfo width={14} height={14} />
        {t('collective.activation.honesty', { defaultValue: 'This pipeline spends no key and no gas. A real deployment on Robinhood Chain always pays gas from the deploying wallet; there is no sponsor or paymaster.' })}
      </p>

      {installMissing && (
        <div className="collective-activation-install" role="note">
          <strong>{t('collective.activation.install.title', { defaultValue: 'One-time workflow install' })}</strong>
          <p>{t('collective.activation.install.body', { defaultValue: 'GitHub blocks automation tokens from writing under .github/workflows. The ready file lives at ci/collective-activation.yml — copy it into that folder once and the weekly run starts by itself.' })}</p>
          <div className="collective-activation-install-links">
            {deployment?.installUrl && <a href={deployment.installUrl} target="_blank" rel="noreferrer">{t('collective.activation.install.action', { defaultValue: 'Create the file on GitHub' })} ↗</a>}
            {deployment?.sourceUrl && <a href={deployment.sourceUrl} target="_blank" rel="noreferrer">{t('collective.activation.install.source', { defaultValue: 'Open the ready file' })} ↗</a>}
          </div>
        </div>
      )}
      {sourceNote && <p className="collective-activation-note">{sourceNote}</p>}
    </section>
  );
}
