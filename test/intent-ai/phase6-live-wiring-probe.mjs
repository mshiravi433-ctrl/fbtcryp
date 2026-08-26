export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const router = await import('../../src/lib/intent-ai/liveRouterBridge.js');
  const health = await import('../../src/lib/intent-ai/venueHealth.js');
  const pipeline = await import('../../src/lib/intent-ai/submitPipeline.js');

  // Routing picks the EXISTING adapter, never a new router.
  const swapRoute = router.routeForDraft({ kind: 'swap', chainId: 42161, protocol: 'swap' });
  t('swap routes to swap adapter', swapRoute.ok && swapRoute.venue === 'swap' && swapRoute.adapterName === 'swap');
  t('swap route requires signer + provider', swapRoute.requiresSigner === true && swapRoute.requiresProvider === true);

  const dydxRoute = router.routeForDraft({ kind: 'futures_open', chainId: 42161, protocol: 'dydx' });
  t('dydx routes to dydx adapter', dydxRoute.ok && dydxRoute.venue === 'dydx');
  t('dydx route requires dydx session', dydxRoute.requiresDydxSession === true);

  const brokerRoute = router.routeForDraft({ kind: 'broker' });
  t('broker routes to broker adapter', brokerRoute.ok && brokerRoute.venue === 'broker' && brokerRoute.requiresBrokerHandle === true);

  const dcaRoute = router.routeForDraft({ kind: 'dca' });
  t('dca routes to dcaExecution', dcaRoute.ok && dcaRoute.venue === 'dca');

  // Bridge is honest: quote exists, execute is NOT wired.
  const bridgeRoute = router.routeForDraft({ kind: 'bridge' });
  t('bridge is not wired for live execute', bridgeRoute.ok && bridgeRoute.venue === 'bridge' && bridgeRoute.implemented === false);

  // Unknown kind fails closed.
  t('unknown kind has no live adapter', router.routeForDraft({ kind: 'defi' }).ok === false);

  // venueHealth: configured swap needs signer + provider + supported chain.
  const okSwap = health.venueHealth({ kind: 'swap', chainId: 42161 }, { signer: true, provider: true, supportedChains: [42161] });
  t('configured swap is healthy', okSwap.ok && okSwap.status === 'configured');
  t('swap without provider is unavailable', health.venueHealth({ kind: 'swap', chainId: 42161 }, { signer: true, supportedChains: [42161] }).status === 'unavailable');
  t('swap without signer is unavailable', health.venueHealth({ kind: 'swap', chainId: 42161 }, { provider: true, supportedChains: [42161] }).status === 'unavailable');
  t('swap on unsupported chain is unavailable', health.venueHealth({ kind: 'swap', chainId: 999 }, { signer: true, provider: true, supportedChains: [42161] }).status === 'unavailable');
  t('broker without handle is unavailable', health.venueHealth({ kind: 'broker' }, {}).status === 'unavailable');

  // Full submit pipeline without config → unavailable, no fake success.
  const noCfg = await pipeline.submitPipeline({ draft: { kind: 'swap', chainId: 42161 }, venueCtx: {} });
  t('unconfigured venue → unavailable, not success', noCfg.ok === false && noCfg.status === 'unavailable');
  t('unconfigured venue is not signed', noCfg.signed === false);

  // Full submit with a clean simulation + sign + broadcast.
  const clean = await pipeline.submitPipeline({
    draft: { kind: 'swap', chainId: 42161 },
    venueCtx: { signer: true, provider: true, supportedChains: [42161] },
    unsignedTx: { from: '0x1', to: '0x2' },
    simulate: async () => ({ status: 'simulated-clean' }),
    signer: async () => ({ signedTx: '0xsigned', ok: true }),
    broadcast: async () => ({ ok: true, receiptRef: 'tx_live_1' })
  });
  t('clean pipeline submits', clean.ok && clean.status === 'submitted');
  t('clean pipeline was signed', clean.signed === true);

  // Broker path does not need on-chain simulation.
  const brokerOk = await pipeline.submitPipeline({
    draft: { kind: 'broker' },
    venueCtx: { brokerHandle: 'h1' },
    broadcast: async () => ({ ok: true, receiptRef: 'brk_live_1' })
  });
  t('broker submits without provider simulation', brokerOk.ok && brokerOk.status === 'submitted');

  // venueReadiness is honest about configured:false.
  const readiness = router.venueReadiness();
  t('readiness flags bridge as configured:false', readiness.bridge.wired === false && readiness.bridge.configured === false);
  t('readiness flags broker as needing handle', readiness.broker.wired === true && readiness.broker.configured === false);

  return rows;
}
