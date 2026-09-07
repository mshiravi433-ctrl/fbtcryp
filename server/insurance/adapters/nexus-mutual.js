/**
 * FBT Insurance OS — Nexus Mutual adapter (LIVE provider integration).
 *
 * Everything here is wired against the OFFICIAL Nexus Mutual surfaces only:
 *
 *   - Public API v2 ............ https://api.nexusmutual.io/v2
 *       GET /products            (product discovery — real product ids)
 *       GET /capacity/{id}       (real available capacity per product)
 *       GET /pricing/products/{id}
 *       GET /quote               (real premium quote + buyCoverInput)
 *     (verified against https://api.nexusmutual.io/v2/api/docs/ and the
 *      official @nexusmutual/sdk v3 — `NexusSDKBase.apiUrl` default.)
 *
 *   - PoS purchase flow ........ https://docs.nexusmutual.io/developers/pos-integrations/
 *       CoverBroker.buyCover(buyCoverParams, poolAllocationRequests)
 *       The user's own wallet signs and broadcasts; FBT builds the UNSIGNED
 *       transaction only (§54 non-custodial).
 *
 *   - Contract addresses ....... @nexusmutual/deployments (see config/nexus-mainnet.json
 *     for provenance) — overridable by NEXUS_COVER_BROKER_ADDRESS / NEXUS_COVER_NFT_ADDRESS
 *     after independent operator verification.
 *
 * HONESTY RULE: no product, price, capacity, address or term is ever invented.
 * If the API is unreachable or a field is unverified the adapter answers
 * UNKNOWN / NOT_CONFIGURED / NOT_AVAILABLE and the router suppresses the offer.
 *
 * Verified constraints (docs.nexusmutual.io):
 *   - cover period: min 28 days, max 365 days
 *   - cover assets: ETH(0), DAI(1), USDC(6), cbBTC(7)
 *   - claims require Nexus Mutual MEMBERSHIP; purchase does not (PoS)
 *   - KYC-restricted jurisdictions apply (membership docs)
 */
import { Interface } from 'ethers';
import { InsuranceProviderAdapter } from '../adapter.js';
import { httpGet } from '../http.js';
import * as store from '../store.js';
import {
  NEXUS_API_BASE_URL, NEXUS_ENABLED, NEXUS_CHAIN_ALLOWLIST,
  NEXUS_PRODUCT_IDS, NEXUS_TERMS_REQUIRED, NEXUS_POS_ENABLED, PROVIDER_HTTP_TIMEOUT_MS
} from '../env.js';
import { toMicro, fromMicro, CHAIN_IDS } from '../constants.js';
import configData from './config/nexus-mainnet.json' with { type: 'json' };

/** CoverAsset enum — verified from @nexusmutual/sdk v3 (index.d.ts). */
export const COVER_ASSETS = Object.freeze({
  ETH: { id: 0, symbol: 'ETH', decimals: 18, contract: null },
  DAI: { id: 1, symbol: 'DAI', decimals: 18, contract: configData.addresses.DAI },
  USDC: { id: 6, symbol: 'USDC', decimals: 6, contract: configData.addresses.USDC },
  cbBTC: { id: 7, symbol: 'cbBTC', decimals: 8, contract: configData.addresses.cbBTC }
});

const PAYMENT_ASSETS = Object.freeze({ ...COVER_ASSETS, NXM: { id: 255, symbol: 'NXM', decimals: 18, contract: configData.addresses.NXMToken } });

export const MIN_PERIOD_DAYS = 28;
export const MAX_PERIOD_DAYS = 365;

const PRODUCTS_TTL_MS = 60_000;

/** Operator-verified address overrides beat the pinned provenance file. */
function addressOf(name, envVar) {
  const override = process.env[envVar];
  if (override) return override;
  return configData.addresses[name] || null;
}

function classificationFromProductType(productType) {
  const label = String(productType || '').toLowerCase();
  if (label.includes('custody')) return 'wallet';
  if (label.includes('depeg') || label.includes('stablecoin')) return 'stablecoin';
  if (label.includes('yield token')) return 'defi-protocol';
  return 'smart-contract'; // protocol / bundled-protocol / SLM family
}

export class NexusMutualAdapter extends InsuranceProviderAdapter {
  constructor(opts = {}) {
    super();
    this.apiBase = opts.apiBase || NEXUS_API_BASE_URL;
    this.enabled = opts.enabled ?? NEXUS_ENABLED;
    this.timeoutMs = opts.timeoutMs || PROVIDER_HTTP_TIMEOUT_MS;
    this.chainAllowlist = (opts.chainAllowlist || NEXUS_CHAIN_ALLOWLIST).map(Number);
    this.productIdAllowlist = opts.productIdAllowlist || NEXUS_PRODUCT_IDS; // [] = all
    this.termsRequired = opts.termsRequired ?? NEXUS_TERMS_REQUIRED;
    this.posEnabled = opts.posEnabled ?? NEXUS_POS_ENABLED;
    this.configured = this.enabled && !!this.apiBase && this.chainAllowlist.length > 0;
    this._productsCache = null; // { at, rows }
    this.coverAssetAllowlist = (process.env.NEXUS_COVER_ASSETS || 'USDC').split(',')
      .map((s) => s.trim().toUpperCase()).filter((s) => s in COVER_ASSETS);
    this.slippageBps = Math.max(0, Number(process.env.NEXUS_PREMIUM_SLIPPAGE_BPS || 100)); // 1% default, operator-tunable
    this.commissionRatioBps = Math.max(0, Number(process.env.NEXUS_COMMISSION_RATIO_BPS || 0)); // 0 — no agreement
    this.commissionDestination = process.env.NEXUS_COMMISSION_DESTINATION || '0x0000000000000000000000000000000000000000';
  }

  get addresses() {
    return {
      CoverBroker: addressOf('CoverBroker', 'NEXUS_COVER_BROKER_ADDRESS'),
      Cover: addressOf('Cover', 'NEXUS_COVER_ADDRESS'),
      CoverNFT: addressOf('CoverNFT', 'NEXUS_COVER_NFT_ADDRESS'),
      CoverProducts: addressOf('CoverProducts', 'NEXUS_COVER_PRODUCTS_ADDRESS')
    };
  }

  get supportedChains() {
    // Nexus cover purchase executes on Ethereum mainnet; the allowlist is the
    // operator's verifiable decision (NEXUS_CHAIN_ALLOWLIST).
    return this.chainAllowlist.filter((c) => c === CHAIN_IDS.ethereum);
  }

  getProviderInfo() {
    const addr = this.addresses;
    return {
      providerId: 'nexus-mutual',
      name: 'Nexus Mutual',
      displayName: 'Nexus Mutual',
      status: this.configured ? 'LIVE' : 'NOT_CONFIGURED',
      configured: this.configured,
      apiBase: this.apiBase,
      documentationUrl: 'https://docs.nexusmutual.io/developers/pos-integrations/',
      apiDocsUrl: 'https://api.nexusmutual.io/v2/api/docs/',
      supportedChains: this.supportedChains,
      coverAssets: this.coverAssetAllowlist,
      contractAddresses: {
        chainId: CHAIN_IDS.ethereum,
        CoverBroker: addr.CoverBroker,
        Cover: addr.Cover,
        CoverNFT: addr.CoverNFT,
        CoverProducts: addr.CoverProducts,
        source: configData._provenance.source,
        packageVersion: configData._provenance.packageVersion,
        verifiedAt: configData._provenance.verifiedAt
      },
      claimMethod: 'Nexus Mutual assessment — claimant must join as a member',
      claimMembershipRequired: true,
      kycJurisdictionNotice: 'Purchasers confirm they do not reside in Nexus Mutual KYC-restricted jurisdictions (see Nexus docs).',
      minPeriodDays: MIN_PERIOD_DAYS,
      maxPeriodDays: MAX_PERIOD_DAYS,
      posEnabled: this.posEnabled,
      disclaimer: 'Coverage is underwritten solely by Nexus Mutual. FBT is a non-custodial interface and never guarantees payout.'
    };
  }

  /* ------------------------------ transport ------------------------------ */

  async _get(path, params) {
    const res = await httpGet(`${this.apiBase}${path}`, { timeoutMs: this.timeoutMs, query: params });
    if (!res.ok) {
      const detail = res.error?.kind === 'status'
        ? `Nexus API HTTP ${res.status}`
        : `Nexus API unreachable (${res.error?.kind || 'network error'})`;
      const err = new Error(detail);
      err.code = res.error?.kind === 'status' ? 'PROVIDER_HTTP_ERROR' : 'PROVIDER_UNAVAILABLE';
      err.providerStatus = res.error?.kind === 'status' ? 'DEGRADED' : 'UNAVAILABLE';
      err.httpStatus = res.status;
      throw err;
    }
    return res.data;
  }

  /* ------------------------------ discovery ------------------------------ */

  async getProducts() {
    if (!this.configured) return [];
    const cached = this._productsCache;
    if (cached && Date.now() - cached.at < PRODUCTS_TTL_MS) return cached.rows;

    const raw = await this._get('/products');
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.products) ? raw.products : [];
    const rows = [];
    for (const p of arr) {
      const id = Number(p?.id);
      if (!Number.isFinite(id)) continue;
      if (p?.isDeprecated === true || p?.isPrivate === true) continue;
      if (this.productIdAllowlist.length && !this.productIdAllowlist.includes(id)) continue;
      // productType may arrive as an expanded object or a bare id — never guess.
      const ptId = typeof p?.productType === 'object' ? p?.productType?.id : p?.productType;
      const ptName = typeof p?.productType === 'object' ? (p?.productType?.name || 'UNKNOWN') : 'UNKNOWN';
      const coverAssets = Array.isArray(p?.coverAssets)
        ? p.coverAssets.map((a) => ({ assetId: Number(a?.assetId), symbol: String(a?.assetSymbol || 'UNKNOWN') }))
        : [];
      const metadata = typeof p?.metadata === 'object' && p.metadata ? p.metadata : {};
      rows.push({
        providerProductId: String(id),
        id: `nexus-${id}`,
        kind: classificationFromProductType(ptName),
        label: p?.name || `Nexus Product #${id}`,
        name: p?.name || `Nexus Product #${id}`,
        nexusProductTypeId: Number.isFinite(Number(ptId)) ? Number(ptId) : null,
        productTypeName: ptName,
        supportedChains: this.supportedChains,
        coverAssets,
        minPrice: p?.minPrice ?? null,
        claimMethod: 'nexus-assessment',
        claimMembershipRequired: true,
        gracePeriodDays: typeof p?.productType === 'object' && p?.productType?.gracePeriod ? Number(p.productType.gracePeriod) : null,
        proofOfLossInputTypes: Array.isArray(p?.proofOfLossInputTypes) ? p.proofOfLossInputTypes : [],
        requiresProofOfLoss: (p?.proofOfLossInputTypes || []).length > 0,
        exclusions: metadata?.exclusions ? [{ source: 'nexus-mutual-metadata', url: metadata.exclusions }] : [],
        annexUrl: metadata?.annex || `https://app.nexusmutual.io/cover/product/${id}/annex`,
        termsUrl: metadata?.schedule || `https://app.nexusmutual.io/cover/product/${id}/cover-wording`,
        sandbox: false,
        sandboxProduct: false
      });
    }
    this._productsCache = { at: Date.now(), rows };
    return rows;
  }

  async capacity(productId, periodDays) {
    if (!this.configured) return { ok: false, error: 'NOT_CONFIGURED' };
    try {
      const data = await this._get(`/capacity/${Number(productId)}`, periodDays ? { period: Number(periodDays) } : undefined);
      return { ok: true, capacity: data, at: Date.now() };
    } catch (err) {
      return { ok: false, error: err.code || 'CAPACITY_UNAVAILABLE', detail: err.message, at: Date.now() };
    }
  }

  /* -------------------------------- quoting ------------------------------- */

  resolveCoverAsset(symbol) {
    const key = String(symbol || 'USDC').toUpperCase();
    if (!this.coverAssetAllowlist.includes(key)) return null;
    return COVER_ASSETS[key] || null;
  }

  /** micro-units (1e6 USD-stable convention) -> cover asset base units (string). */
  amountToBaseUnits(microAmount, asset) {
    const micro = typeof microAmount === 'bigint' ? microAmount : toMicro(microAmount);
    if (micro === null) return null;
    if (asset.decimals === 6) return micro.toString();
    const scale = 10n ** BigInt(asset.decimals - 6);
    return (micro * scale).toString();
  }

  /** asset base units -> micro-units string (for display/fee engine). */
  baseUnitsToMicro(value, asset) {
    try {
      const v = BigInt(value);
      if (asset.decimals === 6) return v;
      const scale = 10n ** BigInt(asset.decimals - 6);
      return v / scale; // floor — display only, never custody math
    } catch { return 0n; }
  }

  async getQuote(params) {
    if (!this.configured) return { ok: false, notConfigured: true, error: 'NOT_CONFIGURED' };
    const chainId = Number(params.chainId);
    if (!this.supportedChains.includes(chainId)) {
      return { ok: false, error: 'CHAIN_UNSUPPORTED', detail: `Nexus Mutual cover is offered on: ${this.supportedChains.join(', ')}` };
    }
    const productId = params.productId != null
      ? String(params.productId).replace(/^nexus-/, '')
      : null;
    if (!productId) return { ok: false, error: 'PRODUCT_REQUIRED', detail: 'Select a concrete Nexus Mutual product (no fabricated default).' };
    const asset = this.resolveCoverAsset(params.currency || params.coverAsset || 'USDC');
    if (!asset) return { ok: false, error: 'ASSET_UNSUPPORTED', detail: `Cover asset must be one of ${this.coverAssetAllowlist.join(', ')} (operator allowlist)` };
    const days = Math.round(Number(params.durationDays ?? 28));
    if (!(days >= MIN_PERIOD_DAYS && days <= MAX_PERIOD_DAYS)) {
      return { ok: false, error: 'DURATION_OUT_OF_RANGE', detail: `Nexus Mutual cover period must be ${MIN_PERIOD_DAYS}–${MAX_PERIOD_DAYS} days` };
    }
    const amountBase = this.amountToBaseUnits(params.coverageAmountMicro, asset);
    if (!amountBase || amountBase === '0') return { ok: false, error: 'COVERAGE_AMOUNT_REQUIRED' };
    if (!params.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(params.walletAddress)) {
      return { ok: false, error: 'VALID_WALLET_REQUIRED' };
    }
    if (this.termsRequired && params.termsAccepted !== true) {
      return { ok: false, error: 'TERMS_ACCEPTANCE_REQUIRED', detail: 'Nexus Mutual wording + annex and the membership/KYC notice must be accepted before quoting for purchase.' };
    }

    let q;
    try {
      q = await this._get('/quote', {
        productId: Number(productId),
        amount: amountBase,
        period: days,
        coverAsset: asset.id,
        buyerAddress: params.walletAddress
      });
    } catch (err) {
      return { ok: false, error: err.code === 'PROVIDER_HTTP_ERROR' ? 'QUOTE_REJECTED_BY_PROVIDER' : 'PROVIDER_UNAVAILABLE', detail: err.message, providerStatus: err.providerStatus };
    }

    // Response shape per official SDK types: { displayInfo, buyCoverInput }.
    const displayInfo = q?.displayInfo || {};
    const buyCoverInput = q?.buyCoverInput || null;
    const premiumBase = displayInfo?.premiumInAsset ?? buyCoverInput?.buyCoverParams?.maxPremiumInAsset ?? null;
    if (premiumBase == null) return { ok: false, error: 'QUOTE_MALFORMED', detail: 'quote response carried no premiumInAsset' };

    const premiumMicro = this.baseUnitsToMicro(premiumBase, asset);
    const poolAllocationRequests = Array.isArray(buyCoverInput?.poolAllocationRequests) ? buyCoverInput.poolAllocationRequests : null;
    const buyCoverParams = buyCoverInput?.buyCoverParams || null;

    return {
      ok: true,
      premiumMicro, // USD-stable micro-units (exact when asset decimals == 6)
      premiumUsd: fromMicro(premiumMicro),
      productId: `nexus-${productId}`,
      providerProductId: String(productId),
      currency: asset.symbol,
      coverAssetId: asset.id,
      yearlyCostPerc: displayInfo?.yearlyCostPerc ?? null,
      maxCapacityBase: displayInfo?.maxCapacity ?? null,
      estimatedGas: null, // filled at prepare time; never fabricated here
      at: Date.now(),
      purchaseReady: !!(buyCoverParams && poolAllocationRequests),
      // Keep the provider's own quote artefacts verbatim for the unsigned tx.
      raw: { buyCoverParams, poolAllocationRequests, premiumInAsset: premiumBase, coverAmount: displayInfo?.coverAmount ?? amountBase }
    };
  }

  checkEligibility(params) {
    if (!this.configured) return Promise.resolve({ eligible: false, reason: 'NOT_CONFIGURED' });
    if (!this.supportedChains.includes(Number(params.chainId))) return Promise.resolve({ eligible: false, reason: 'CHAIN_UNSUPPORTED' });
    return Promise.resolve({ eligible: true, reason: 'OK' });
  }

  /* ------------------------------- purchase ------------------------------- */

  async createPurchaseIntent(params) {
    if (!this.configured) return { ok: false, notConfigured: true, error: 'NOT_CONFIGURED' };
    const intentId = `nexus-intent-${params.quoteId || params.coverageId}`;
    await store.set('provider-ledger', intentId, {
      kind: 'purchase-intent', provider: 'nexus-mutual', params,
      status: 'OPEN', unsignedOnly: true, at: Date.now()
    });
    return { ok: true, intentId, providerReference: intentId };
  }

  /**
   * Build the UNSIGNED CoverBroker.buyCover transaction for the user's wallet.
   * FBT never signs, never broadcasts, never holds the premium (§54).
   */
  async buildPurchaseTransaction(params) {
    if (!this.configured) return { ok: false, notConfigured: true, error: 'NOT_CONFIGURED' };
    const addr = this.addresses;
    if (!addr.CoverBroker || !/^0x[a-fA-F0-9]{40}$/.test(addr.CoverBroker)) {
      return { ok: false, error: 'NOT_CONFIGURED', detail: 'CoverBroker address not verified — purchase disabled.' };
    }
    const raw = params.raw || params.quoteRaw || null;
    const buyCoverParams = raw?.buyCoverParams ? { ...raw.buyCoverParams } : null;
    const poolAllocationRequests = raw?.poolAllocationRequests || null;
    if (!buyCoverParams || !poolAllocationRequests) {
      return { ok: false, error: 'PURCHASE_INPUTS_UNAVAILABLE', detail: 'live quote did not include buyCoverInput; obtain a fresh quote' };
    }
    const owner = String(params.walletAddress || buyCoverParams.owner || '').toLowerCase();
    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) return { ok: false, error: 'VALID_WALLET_REQUIRED' };

    const coverAssetId = Number(buyCoverParams.coverAsset);
    const assetEntry = Object.values(COVER_ASSETS).find((a) => a.id === coverAssetId) || null;
    if (!assetEntry) return { ok: false, error: 'ASSET_UNSUPPORTED' };

    // Slippage-guard the premium: maxPremiumInAsset = premium * (1 + slippage).
    const premiumBase = BigInt(raw.premiumInAsset ?? buyCoverParams.maxPremiumInAsset ?? '0');
    const maxPremium = premiumBase + (premiumBase * BigInt(this.slippageBps)) / 10000n;

    const commissionRatioBps = this.commissionRatioBps; // 0 unless a real agreement exists
    const finalParams = {
      ...buyCoverParams,
      coverId: 0,
      owner,
      maxPremiumInAsset: maxPremium.toString(),
      paymentAsset: coverAssetId,
      commissionRatio: commissionRatioBps,
      commissionDestination: commissionRatioBps > 0 ? this.commissionDestination : '0x0000000000000000000000000000000000000000'
    };

    const iface = new Interface([configData.abi.CoverBroker.buyCover]);
    const data = iface.encodeFunctionData('buyCover', [finalParams, poolAllocationRequests.map((r) => [r.poolId, r.coverAmountInAsset])]);

    const isNativePayment = coverAssetId === COVER_ASSETS.ETH.id;
    const tx = {
      unsigned: true,
      kind: 'evm-contract-call',
      chainId: CHAIN_IDS.ethereum,
      to: addr.CoverBroker,
      data,
      value: isNativePayment ? maxPremium.toString() : '0',
      from: owner,
      gasEstimate: null, // wallet/RLP estimates; never invented server-side
      provider: 'nexus-mutual',
      contractAddress: addr.CoverBroker,
      contractProvenance: {
        source: configData._provenance.source,
        packageVersion: configData._provenance.packageVersion,
        verifiedAt: configData._provenance.verifiedAt
      },
      settlementModel: 'DIRECT',
      custody: 'none — premium moves wallet → CoverBroker on-chain'
    };

    const approvalTx = isNativePayment ? null : {
      unsigned: true,
      kind: 'erc20-approve',
      chainId: CHAIN_IDS.ethereum,
      tokenAddress: assetEntry.contract,
      spender: addr.CoverBroker,
      amount: maxPremium.toString(),
      note: 'Wallet approval so CoverBroker can pull the premium. Revoke-able any time.'
    };

    return {
      ok: true,
      sandbox: false,
      unsigned: true,
      tx,
      approvalTx,
      coverNft: { address: addr.CoverNFT, note: 'Cover minted as an NFT owned by the buyer; tokenId == coverId' },
      reference: {
        quoteId: params.quoteId, termsHash: params.termsHash,
        coverageAmountMicro: params.coverageAmountMicro,
        premiumInAsset: premiumBase.toString(),
        maxPremiumInAsset: maxPremium.toString(),
        providerProductId: params.providerProductId ?? null
      },
      note: 'Unsigned CoverBroker.buyCover prepared from the live Nexus Mutual quote. Your wallet signs; FBT never touches keys.'
    };
  }

  async getCoverage(params) {
    return { ok: false, error: 'NOT_AVAILABLE', detail: 'Nexus coverage state is verified on-chain via the CoverNFT receipt — see verification.js' };
  }

  async submitClaim() {
    // Claims are filed with Nexus Mutual directly by the member. FBT records
    // the claim locally for tracking but never adjudicates it.
    return {
      ok: true,
      claimMethod: 'nexus-assessment',
      detail: 'File the claim with Nexus Mutual as a member (their assessment process). FBT tracks and independently verifies the payout on-chain.',
      howTo: 'https://docs.nexusmutual.io/overview/claims'
    };
  }

  async getClaimStatus() { return { ok: false, error: 'NOT_AVAILABLE', detail: 'status lives with Nexus Mutual assessment; check their app' }; }
  async getPayout() { return { ok: false, error: 'NOT_AVAILABLE', detail: 'payout is verified on-chain from CoverNFT/Pool events, not from an API' }; }
  async cancelCoverage() { return { ok: false, error: 'NOT_AVAILABLE', detail: 'Nexus covers run to expiry (no mid-term cancellation API)' }; }

  async health() {
    if (!this.configured) return { ok: false, status: 'NOT_CONFIGURED', at: Date.now() };
    const t0 = Date.now();
    try {
      await this._get('/products');
      return { ok: true, status: 'HEALTHY', latencyMs: Date.now() - t0, at: Date.now(), live: true };
    } catch (err) {
      return {
        ok: false,
        status: err.code === 'PROVIDER_HTTP_ERROR' ? 'DEGRADED' : 'UNAVAILABLE',
        latencyMs: Date.now() - t0, at: Date.now(),
        reason: err.message,
        live: false
      };
    }
  }
}
