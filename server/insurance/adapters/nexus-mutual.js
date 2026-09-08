/**
 * FBT Insurance OS — Nexus Mutual adapter (LIVE provider integration).
 *
 * Everything here is wired against the OFFICIAL Nexus Mutual surfaces only
 * (re-verified against the live API and @nexusmutual/sdk@3.1.1 on 2026-09-08):
 *
 *   - Public API v2 ............ https://api.nexusmutual.io/v2
 *       GET  /products          (product discovery — real product ids)
 *       GET  /product-types     (product type ids → names + commission defaults)
 *       POST /cover-metadata    (proof-of-loss cover metadata → ipfs cid)
 *       GET  /quote             (real premium quote + pool allocations)
 *       GET  /capacity/{id}     (real available capacity per product)
 *     (base URL and paths match `@nexusmutual/sdk` `NexusSDKBase.apiUrl` and
 *      its ProductAPI / Quote / CoverData REST calls.)
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
 *   - products that require proof-of-loss input: the PoS retail flow records
 *     the policyholder's own wallet as the covered address (the wallet that
 *     would suffer the loss). Products requiring non-address inputs (AUM /
 *     quota-share / validator lists) need a dedicated input UI, so the
 *     marketplace does not surface them — no guessed metadata.
 */
import { Interface, getAddress } from 'ethers';
import { InsuranceProviderAdapter } from '../adapter.js';
import { httpGet, httpPost } from '../http.js';
import * as store from '../store.js';
import {
  NEXUS_API_BASE_URL, NEXUS_ENABLED, NEXUS_CHAIN_ALLOWLIST,
  NEXUS_PRODUCT_IDS, NEXUS_TERMS_REQUIRED, NEXUS_POS_ENABLED, PROVIDER_HTTP_TIMEOUT_MS
} from '../env.js';
import { parseMicro, fromMicro, CHAIN_IDS } from '../constants.js';
import configData from './config/nexus-mainnet.json' with { type: 'json' };

/** EIP-55 checksum. Nexus cover-metadata / buyCover owner reject lowercase-only on some paths. */
export function checksumAddress(addr) {
  try { return getAddress(String(addr || '')); } catch { return null; }
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

function mapPoolAllocations(list) {
  return (Array.isArray(list) ? list : []).map((r) => {
    if (Array.isArray(r)) {
      return { poolId: String(r[0] ?? ''), coverAmountInAsset: String(r[1] ?? '0'), skip: r[2] === true };
    }
    return {
      poolId: String(r?.poolId ?? ''),
      coverAmountInAsset: String(r?.coverAmountInAsset ?? r?.coverAmount ?? '0'),
      skip: r?.skip === true
    };
  });
}

function quoteFailureCode(err) {
  const code = String(err?.code || '');
  if (['CAPACITY_UNAVAILABLE', 'DURATION_OUT_OF_RANGE', 'ASSET_UNSUPPORTED', 'QUOTE_MALFORMED', 'PRODUCT_REQUIRED', 'VALID_WALLET_REQUIRED', 'TERMS_ACCEPTANCE_REQUIRED'].includes(code)) {
    return code;
  }
  if (code === 'PROVIDER_HTTP_ERROR') return 'QUOTE_REJECTED_BY_PROVIDER';
  return 'PROVIDER_UNAVAILABLE';
}

/**
 * Map a Nexus HTTP failure to a stable insurance error code.
 *
 * Honesty: CAPACITY_UNAVAILABLE is used ONLY when the /quote endpoint itself
 * reports a real pool shortage. Swagger/HTML 4xx that merely mention the
 * `/capacity` path, and cover-metadata 4xx, must never be labelled as a
 * capacity shortage — that lie is what the marketplace showed after wallet
 * connect (`insurance.reason.CAPACITY_UNAVAILABLE`).
 */
export function classifyNexusHttpError({ kind, body, action } = {}) {
  if (kind !== 'status') return 'PROVIDER_UNAVAILABLE';
  const act = String(action || '').split('?')[0].replace(/\/+$/, '');
  const isQuote = act === '/quote' || act === 'quote';
  // cover-metadata (and every non-quote path) must never become CAPACITY_UNAVAILABLE
  if (!isQuote) return 'PROVIDER_HTTP_ERROR';
  const raw = String(body || '');
  // Swagger / HTML error pages list GET /v2/capacity/{productId} — not a shortage.
  if (/<!doctype|<html[\s>]|swagger/i.test(raw) || /GET\s+\/(?:v2\/)?capacity\b/i.test(raw)) {
    return 'PROVIDER_HTTP_ERROR';
  }
  const b = raw.toLowerCase();
  const realShortage = /not enough(?: available)? capacity/.test(b)
    || /insufficient(?: available)? capacity/.test(b)
    || /unable to allocate/.test(b)
    || /no available capacity/.test(b)
    || /out of capacity/.test(b)
    || /capacity (?:is )?(?:unavailable|insufficient|exhausted|too low)/.test(b);
  return realShortage ? 'CAPACITY_UNAVAILABLE' : 'PROVIDER_HTTP_ERROR';
}

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
const PRODUCT_TYPES_TTL_MS = 10 * 60_000;

/**
 * Map a Nexus product row to an FBT protection kind. Uses the product's own
 * `category` when it is meaningful and only falls back to product-type-name
 * heuristics (single-protocol etc.) for uncategorised rows — never guessed.
 */
function kindFromProduct(p, typeName) {
  const cat = String(p?.category || '').toLowerCase();
  const tname = String(typeName || '').toLowerCase();
  if (cat === 'custody' || cat === 'smart-wallet' || tname.includes('custody')) return 'wallet';
  if (cat === 'depeg' || cat === 'stablecoin' || tname.includes('depeg') || tname.includes('stablecoin')) return 'stablecoin';
  if (cat === 'lending') return 'lending';
  if (cat === 'bridge') return 'bridge';
  if (cat === 'oracle') return 'oracle';
  if (cat === 'lp') return 'lp';
  if (cat === 'yield-token' || cat === 'yield-optimizer' || tname.includes('yield token')) return 'defi-protocol';
  return 'smart-contract'; // dex / protocol / bundled / uncategorised families
}

/** Operator-verified address overrides beat the pinned provenance file. */
function addressOf(name, envVar) {
  const override = process.env[envVar];
  if (override) return override;
  return configData.addresses[name] || null;
}

/** Products the PoS retail flow can quote honestly: no input, or only the
 *  buyer's own wallet address as proof-of-loss metadata. Everything else
 *  (AUM / quota-share / validator forms) is excluded until a matching input
 *  UI exists — the marketplace never guesses provider-specific metadata. */
function quoteableProofOfLoss(types) {
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.every((t) => String(t || '').toLowerCase() === 'address');
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
    this._productTypesCache = null; // { at, rows }
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

  _httpError(res, action) {
    const body = String(res.error?.body || '').slice(0, 400);
    const detail = res.error?.kind === 'status'
      ? `Nexus API HTTP ${res.status}${action ? ` (${action})` : ''}`
      : `Nexus API unreachable (${res.error?.kind || 'network error'})`;
    const err = new Error(detail);
    err.httpStatus = res.status;
    err.code = classifyNexusHttpError({ kind: res.error?.kind, body, action });
    if (err.code === 'PROVIDER_HTTP_ERROR') {
      const b = body.toLowerCase();
      if (/period|duration/.test(b) && /invalid|must|range|minimum|maximum/.test(b)) err.code = 'DURATION_OUT_OF_RANGE';
      else if (/asset/.test(b) && /invalid|unsupported|not supported/.test(b)) err.code = 'ASSET_UNSUPPORTED';
    }
    err.providerStatus = err.code === 'PROVIDER_UNAVAILABLE' ? 'UNAVAILABLE' : 'DEGRADED';
    return err;
  }

  async _get(path, params) {
    const res = await httpGet(`${this.apiBase}${path}`, { timeoutMs: this.timeoutMs, query: params });
    if (!res.ok) throw this._httpError(res, path);
    return res.data;
  }

  /* ------------------------------ discovery ------------------------------ */

  /** Product-type id → type row cache (small list; refreshed hourly). */
  async getProductTypes() {
    if (!this.configured) return [];
    const cached = this._productTypesCache;
    if (cached && Date.now() - cached.at < PRODUCT_TYPES_TTL_MS) return cached.rows;
    const raw = await this._get('/product-types');
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.productTypes) ? raw.productTypes : [];
    const rows = [];
    for (const t of arr) {
      const id = Number(t?.id);
      if (!Number.isFinite(id)) continue;
      rows.push({
        id,
        name: String(t?.name || 'UNKNOWN'),
        claimMethod: String(t?.claimMethod ?? '0'),
        gracePeriodDays: Number.isFinite(Number(t?.gracePeriod)) ? Math.round(Number(t.gracePeriod) / 86400) : null,
        commissionRatioBps: Number.isFinite(Number(t?.commissionRatio)) ? Number(t.commissionRatio) : null,
        commissionDestination: t?.commissionDestination || null,
        ipfsContentType: t?.ipfsContentType || null
      });
    }
    this._productTypesCache = { at: Date.now(), rows };
    return rows;
  }

  async getProducts() {
    if (!this.configured) return [];
    const cached = this._productsCache;
    if (cached && Date.now() - cached.at < PRODUCTS_TTL_MS) return cached.rows;

    // Narrow the discovery server-side (same filters @nexusmutual/sdk exposes).
    const [rawRes, typesRes] = await Promise.allSettled([
      this._get('/products', { 'filters[isDeprecated]': false, 'filters[isPrivate]': false }),
      this.getProductTypes()
    ]);
    const raw = rawRes.status === 'fulfilled' ? rawRes.value : null;
    if (!raw) throw (rawRes.reason || new Error('Nexus API unreachable (product discovery failed)'));
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.products) ? raw.products : [];
    const types = typesRes.status === 'fulfilled' ? typesRes.value : [];
    const typeById = new Map(types.map((t) => [t.id, t]));
    const rows = [];
    for (const p of arr) {
      const id = Number(p?.id);
      if (!Number.isFinite(id)) continue;
      if (p?.isDeprecated === true || p?.isPrivate === true) continue;
      if (this.productIdAllowlist.length && !this.productIdAllowlist.includes(id)) continue;
      // Specialised cover forms (AUM/quota-share/validators…) need their own
      // input UI — only products a retail wallet can quote are surfaced.
      if (!quoteableProofOfLoss(p?.proofOfLossInputTypes)) continue;
      // The product must be purchasable in one of the operator's cover assets.
      const coverAssets = Array.isArray(p?.coverAssets)
        ? p.coverAssets.map((a) => ({ assetId: Number(a?.assetId), symbol: String(a?.assetSymbol || 'UNKNOWN') }))
        : [];
      if (!coverAssets.some((a) => this.coverAssetAllowlist.includes(a.symbol))) continue;
      const ptId = Number(p?.productType);
      const pt = Number.isFinite(ptId) ? (typeById.get(ptId) || null) : null;
      const ptName = pt?.name || 'UNKNOWN';
      const metadata = (typeof p?.metadata === 'object' && p.metadata) ? p.metadata : {};
      const exclusions = Array.isArray(metadata?.exclusions)
        ? metadata.exclusions.map((x) => (typeof x === 'string' ? x : stringifyJson(x)))
        : [];
      rows.push({
        providerProductId: String(id),
        id: `nexus-${id}`,
        kind: kindFromProduct(p, ptName),
        label: p?.name || `Nexus Product #${id}`,
        name: p?.name || `Nexus Product #${id}`,
        nexusProductTypeId: pt?.id ?? null,
        productTypeName: ptName,
        supportedChains: this.supportedChains,
        coverAssets,
        minPrice: p?.minPrice != null && p?.minPrice !== '' ? Number(p.minPrice) : null,
        claimMethod: 'nexus-assessment',
        claimMembershipRequired: true,
        gracePeriodDays: pt?.gracePeriodDays ?? null,
        proofOfLossInputTypes: Array.isArray(p?.proofOfLossInputTypes) ? p.proofOfLossInputTypes : [],
        requiresProofOfLoss: (p?.proofOfLossInputTypes || []).length > 0,
        exclusions,
        annexUrl: `https://app.nexusmutual.io/cover/product/${id}/annex`,
        termsUrl: `https://app.nexusmutual.io/cover/product/${id}/cover-wording`,
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
    const micro = parseMicro(microAmount);
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
    const owner = checksumAddress(params.walletAddress);
    if (!owner) {
      return { ok: false, error: 'VALID_WALLET_REQUIRED' };
    }
    if (this.termsRequired && params.termsAccepted !== true) {
      return { ok: false, error: 'TERMS_ACCEPTANCE_REQUIRED', detail: 'Nexus Mutual wording + annex and the membership/KYC notice must be accepted before quoting for purchase.' };
    }

    // Official v2 flow (@nexusmutual/sdk 3.1.1): products that require
    // proof-of-loss metadata get it created first (POST /cover-metadata,
    // creator = the buyer), then the Cover Router /quote prices the cover.
    let cid = '';
    try {
      const products = await this.getProducts().catch(() => []);
      const product = products.find((x) => x.providerProductId === String(productId));
      if (product && (product.proofOfLossInputTypes || []).length > 0) {
        const meta = {
          creatorAddress: owner,
          proofOfLoss: [{ type: 'address', content: [{ address: owner }] }]
        };
        const metaRes = await httpPost(`${this.apiBase}/cover-metadata`, meta, { timeoutMs: this.timeoutMs });
        if (!metaRes.ok) throw this._httpError(metaRes, 'cover-metadata');
        cid = metaRes.data?.cid || '';
        if (!cid) return { ok: false, error: 'QUOTE_MALFORMED', detail: 'cover-metadata response carried no cid' };
      }
    } catch (err) {
      return { ok: false, error: quoteFailureCode(err), detail: err.message, providerStatus: err.providerStatus };
    }

    let q;
    try {
      q = await this._get('/quote', {
        productId: Number(productId),
        amount: amountBase,
        period: days,
        coverAsset: asset.id,
        paymentAsset: asset.id,
        ...(cid ? { ipfsCid: cid } : {})
      });
    } catch (err) {
      return { ok: false, error: quoteFailureCode(err), detail: err.message, providerStatus: err.providerStatus };
    }

    // Official response shape: { quote: { premiumInAsset, annualPrice, poolAllocationRequests } }.
    const quote = q?.quote || q;
    const premiumBase = quote?.premiumInAsset ?? null;
    if (premiumBase == null) return { ok: false, error: 'QUOTE_MALFORMED', detail: 'quote response carried no premiumInAsset' };

    const premiumInAsset = String(premiumBase);
    const premiumMicro = this.baseUnitsToMicro(premiumInAsset, asset);
    const poolAllocationRequests = mapPoolAllocations(quote?.poolAllocationRequests);
    // Slippage guard: the unsigned buy caps the premium at (1 + slippage) × price.
    const maxPremium = BigInt(premiumInAsset) + (BigInt(premiumInAsset) * BigInt(this.slippageBps)) / 10000n;

    let maxCapacityBase = null;
    try {
      const capRes = await this._get(`/capacity/${Number(productId)}`, { period: days });
      const list = Array.isArray(capRes?.availableCapacity) ? capRes.availableCapacity : [];
      const capRow = list.find((av) => Number(av?.assetId) === asset.id);
      maxCapacityBase = capRow?.amount != null ? String(capRow.amount) : null;
    } catch { /* display-only — a priced quote never fails on capacity */ }

    // buyCoverParams mirrors @nexusmutual/sdk (period in SECONDS on-chain).
    const buyCoverParams = {
      coverId: 0,
      owner,
      productId: Number(productId),
      coverAsset: asset.id,
      amount: amountBase,
      period: days * 86400,
      maxPremiumInAsset: maxPremium.toString(),
      paymentAsset: asset.id,
      commissionRatio: this.commissionRatioBps, // 0 unless a real agreement exists
      commissionDestination: this.commissionRatioBps > 0 ? this.commissionDestination : '0x0000000000000000000000000000000000000000',
      ipfsData: cid
    };

    return {
      ok: true,
      premiumMicro, // USD-stable micro-units (exact when asset decimals == 6)
      premiumUsd: fromMicro(premiumMicro),
      productId: `nexus-${productId}`,
      providerProductId: String(productId),
      currency: asset.symbol,
      coverAssetId: asset.id,
      yearlyCostPerc: null, // annualPrice is provider-internal; never displayed as a made-up %
      maxCapacityBase,
      estimatedGas: null, // filled at prepare time; never fabricated here
      at: Date.now(),
      purchaseReady: poolAllocationRequests.length > 0 && BigInt(premiumInAsset) > 0n,
      // Keep the provider's own quote artefacts as JSON-safe strings for the unsigned tx.
      raw: { buyCoverParams, poolAllocationRequests, premiumInAsset, coverAmount: amountBase }
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
    const owner = checksumAddress(params.walletAddress || buyCoverParams.owner);
    if (!owner) return { ok: false, error: 'VALID_WALLET_REQUIRED' };

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
    const allocations = mapPoolAllocations(poolAllocationRequests);
    const data = iface.encodeFunctionData('buyCover', [finalParams, allocations.map((r) => [r.poolId, r.coverAmountInAsset])]);

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
      // Liveness probe on the light product-types endpoint — never downloads
      // the whole product catalogue just to answer "is the API up?".
      await this._get('/product-types');
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
