/**
 * FBT LAUNCH — official SDK (ESM, browser + Node 18+).
 * ============================================================================
 * The thin, wallet-AGNOSTIC client for the FBT Launch API. It does what the
 * API does: fetch config, prepare byte-exact plans, verify on-chain, record
 * public results. It does NOT do what the API never does: sign.
 *
 *   Signing authority is injected by the caller as an `Eip1193Like` signer —
 *   the exact same object the FBT app hands to its launch page
 *   (wallet.getSigner()). MetaMask, WalletConnect, Solflare-for-EVM test
 *   harnesses, a CI signer: if it speaks sendTransaction, it works here.
 *
 * NON-CUSTODIAL CONTRACT (read this before you integrate)
 *   · This module never accepts, stores or transmits a private key or seed.
 *   · It never calls eth_sendTransaction with anyone else's authority.
 *   · It sends only the prepared `to`/`data`/`value` of each step to the
 *     caller's signer, and records only PUBLIC facts (hashes, addresses,
 *     status).
 *
 * USAGE
 *   import { FBTLaunch } from './sdk/fbt-launch.mjs';
 *
 *   const launch = new FBTLaunch({
 *     apiBase: 'https://your-fbt-host/api',
 *     signer: myWallet.getSigner(),           // ethers v6 Signer (your wallet)
 *     provider: myWallet.getReadProvider(),   // ethers v6 Provider (reads)
 *     address: myWallet.address
 *   });
 *
 *   const cfg = await launch.config();                    // networks + fees
 *   const plan = await launch.prepare({                   // phase one bytes
 *     chainId: 56, name: 'FBT Gold', symbol: 'FBTG',
 *     decimals: 18, supply: '1000000000',
 *     quote: { symbol: 'USDT', address: '0x…', decimals: 6, native: false },
 *     tokenAmount: '100000', quoteAmount: '10000'
 *   });
 *   // plan.plan.steps[0] = { to, data, value, id, description } …
 *   // plan.risk = { score, band, findings, blocked } …
 *
 *   const result = await launch.run(plan.plan, { onStep: (s) => console.log(s) });
 *   // result = { state: 'LIVE'|'RETRYABLE'|…, token, pool, partial }
 */

const DEFAULT_DEADLINE_SECONDS = 600;

/**
 * @typedef {object} LaunchPlan the plan object from the API (schema fbt.launch-plan.v1)
 * @typedef {object} Step { id:string, to:string, data:string, value?:string, description?:string, gasLimit?:bigint }
 */

export class FBTLaunchError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'FBTLaunchError';
    this.code = code;
    this.detail = detail;
  }
}

export class FBTLaunch {
  /**
   * @param {object} opts
   * @param {string} [opts.apiBase] default '/api' (same origin as the app)
   * @param {object} opts.signer   ethers v6 Signer — the USER'S wallet.
   * @param {object} opts.provider ethers v6 Provider — read-only chain access.
   * @param {string} opts.address  the creator's public address.
   * @param {number} [opts.gasHeadroomPct=20]  gasLimit headroom over estimateGas
   * @param {number} [opts.confirmations=1]    block confirmations per receipt
   * @param {(step:object)=>void} [opts.onStep]  live step-state callback
   */
  constructor({ apiBase = '/api', signer, provider, address, gasHeadroomPct = 20, confirmations = 1, onStep = null } = {}) {
    if (!signer || typeof signer.sendTransaction !== 'function') {
      throw new FBTLaunchError('SIGNER_REQUIRED', 'An ethers v6 Signer (sendTransaction) is required — the SDK never signs on its own.');
    }
    if (!provider || typeof provider.estimateGas !== 'function') {
      throw new FBTLaunchError('PROVIDER_REQUIRED', 'An ethers v6 Provider (estimateGas/getCode) is required.');
    }
    this.apiBase = String(apiBase).replace(/\/$/, '');
    this.signer = signer;
    this.provider = provider;
    this.address = address || null;
    this.gasHeadroomPct = gasHeadroomPct;
    this.confirmations = confirmations;
    this.onStep = onStep;
  }

  /** GET /launch/config — networks, DEX registry, fee schedule, custody statement. */
  async config() {
    return this._get('/launch/config');
  }

  /**
   * GET /launch/prepare — byte-exact plan + risk verdict for one phase.
   * Phase one: pass name/symbol/decimals/supply (+ quote/amounts for the full
   * review). Phase two (retry the pool): pass tokenAddress + quote/amounts.
   *
   * @returns {{ok:true, noCustody:object, dex:{verified:boolean}, plan:object, risk:object}}
   */
  async prepare(params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue;
      q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return this._get(`/launch/prepare?${q.toString()}`);
  }

  /**
   * GET /launch/verify — read-only on-chain readback of a finished launch.
   * The same checks the app runs before it may claim LIVE.
   */
  async verify(params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue;
      q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return this._get(`/launch/verify?${q.toString()}`);
  }

  /**
   * POST /launch/record — optional public record. The server refuses (503)
   * when its deployment has no durable store; local truth is never affected.
   */
  async record(record) {
    return this._post('/launch/record', record);
  }

  /** GET /launch/records/:chainId — public launch records for a chain. */
  async records(chainId) {
    return this._get(`/launch/records/${encodeURIComponent(String(chainId))}`);
  }

  /**
   * Execute a prepared plan: estimate → sign (in the USER'S wallet) → wait →
   * read the chain back. This is the only function that touches the chain
   * with money on the line, and it delegates every signature to the caller's
   * signer — the SDK can be killed mid-flight and the wallet state is still
   * the source of truth.
   *
   * @param {LaunchPlan} plan
   * @param {object} [opts]
   * @param {boolean} [opts.createPairNeeded]  phase two: whether the pool must be created
   * @param {string} [opts.pairAddress]        phase two: existing pair, when any
   * @returns {Promise<{state:string, token?:object, pool?:object, partial?:object, steps:object[]}>}
   */
  async run(plan, { createPairNeeded = null, pairAddress = null } = {}) {
    const steps = (plan.steps || []).map((s) => ({ ...s }));
    const emit = (s) => { if (this.onStep) this.onStep({ ...s }); };
    const out = { state: 'RUNNING', token: null, pool: null, partial: null, steps: [] };

    for (let i = 0; i < steps.length; i += 1) {
      const st = steps[i];
      // Deferred pool intent: materialise real bytes with the token address
      // the chain gave us (honest two-phase — never fake zero-address bytes).
      // The plan pins the full phase-two intent on the deferred step itself.
      if (st.deferred) {
        if (!out.token?.address) throw new FBTLaunchError('TOKEN_MISSING_BEFORE_POOL', 'The token step must confirm before the pool phase can be prepared.');
        const intent = st.intent || {};
        const prepared = await this.prepare({
          chainId: plan.chainId,
          tokenAddress: out.token.address,
          quote: intent.quote || null,
          tokenAmount: intent.tokenAmount,
          quoteAmount: intent.quoteAmount,
          slippageBps: intent.slippageBps ?? 100,
          creator: intent.creator || this.address,
          createPairNeeded: intent.createPairNeeded == null ? true : intent.createPairNeeded,
          pairAddress: intent.pairAddress || pairAddress || null
        });
        if (!prepared.ok) throw new FBTLaunchError(prepared.code || 'POOL_PREPARE_FAILED', prepared.errors);
        steps.splice(i, 1, ...prepared.plan.steps);
        i -= 1; // re-scan the materialised steps
        continue;
      }

      st.status = 'estimating';
      emit(st);
      try {
        const gas = await this.provider.estimateGas({
          from: this.address,
          to: st.to,
          data: st.data,
          value: st.value && st.value !== '0' ? st.value : undefined
        });
        st.gasLimit = (gas * BigInt(100 + this.gasHeadroomPct)) / 100n;
      } catch (e) {
        st.status = 'failed';
        st.error = `SIMULATION_FAILED: ${String(e?.shortMessage || e?.message || 'REVERT').slice(0, 160)}`;
        emit(st);
        out.state = out.token?.address ? 'RETRYABLE' : 'FAILED';
        if (out.token?.address) {
          out.partial = { token: 'SUCCESS', tokenAddress: out.token.address, pool: 'FAILED', failedStep: st.id, reason: st.error, recovery: 'retry-pool' };
        }
        return out;
      }

      st.status = 'signing';
      emit(st);
      let sent;
      try {
        sent = await this.signer.sendTransaction({
          to: st.to,
          data: st.data,
          value: st.value && st.value !== '0' ? st.value : undefined,
          gasLimit: st.gasLimit
        });
      } catch (e) {
        const msg = String(e?.shortMessage || e?.message || e?.code || 'SIGN_FAILED');
        st.status = 'failed';
        st.error = /user rejected|USER_REJECTED|request rejected|4001/i.test(msg) || e?.code === 4001 ? 'USER_REJECTED' : msg.slice(0, 160);
        emit(st);
        out.state = out.token?.address ? 'RETRYABLE' : 'CANCELLED';
        if (out.token?.address) {
          out.partial = { token: 'SUCCESS', tokenAddress: out.token.address, pool: 'NOT_STARTED', failedStep: null, reason: st.error, recovery: 'retry-pool' };
        }
        return out;
      }

      st.txHash = sent.hash;
      st.status = 'submitted';
      emit(st);

      const receipt = await sent.wait(this.confirmations);
      if (!receipt || receipt.status === 0) {
        st.status = 'failed';
        st.error = 'TX_REVERTED';
        emit(st);
        out.state = out.token?.address ? 'RETRYABLE' : 'FAILED';
        if (out.token?.address) {
          out.partial = { token: 'SUCCESS', tokenAddress: out.token.address, pool: 'FAILED', failedStep: st.id, reason: 'TX_REVERTED', recovery: 'retry-pool' };
        }
        return out;
      }

      st.status = 'confirmed';
      st.receipt = { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed?.toString() };

      // Read the chain's own word on what happened.
      if (st.id === 'create-token') {
        const facts = await this._readTokenCreated(receipt);
        if (!facts) {
          st.status = 'failed';
          st.error = 'TOKEN_EVENT_NOT_FOUND';
          emit(st);
          out.state = 'FAILED';
          return out;
        }
        out.token = { ...facts, txHash: receipt.transactionHash };
      }
      if (st.id === 'create-pair') {
        out.pool = out.pool || {};
        out.pool.txHash = receipt.transactionHash;
      }
      if (st.id === 'add-liquidity') {
        out.pool = out.pool || {};
        if (plan.summary?.lpToCreator === true) out.pool.lpToCreator = true;
      }
      emit(st);
      out.steps.push({ ...st });
    }

    out.state = out.token?.address ? 'CONFIRMED' : 'FAILED';
    out.steps = steps.map((s) => ({ ...s }));
    return out;
  }

  /** Parse the factory's TokenCreated log from a receipt (event readback). */
  async _readTokenCreated(receipt) {
    // The factory ABI is identical to the one in the app (contracts/
    // FBTTokenFactory.sol); embed the minimal event signature here so the SDK
    // stays dependency-light.
    const { Interface } = await import('ethers');
    const iface = new Interface([
      'event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint8 decimals, uint256 totalSupply, uint256 capabilities)'
    ]);
    const factoryTopic = iface.getEvent('TokenCreated').topicHash;
    for (const log of receipt.logs || []) {
      if (!log.topics || log.topics[0] !== factoryTopic) continue;
      try {
        const parsed = iface.parseLog(log);
        if (!parsed || parsed.name !== 'TokenCreated') continue;
        const [token, creator, name, symbol, decimals, totalSupply, capabilities] = parsed.args;
        return {
          address: token.toString ? token.toString() : String(token),
          creator: creator.toString ? creator.toString() : String(creator),
          name, symbol,
          decimals: Number(decimals),
          supply: totalSupply.toString(),
          capabilities: Number(capabilities)
        };
      } catch {
        /* not our event */
      }
    }
    return null;
  }

  /* ── HTTP ─────────────────────────────────────────────────────────── */

  async _get(path) {
    const res = await fetch(`${this.apiBase}${path}`, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new FBTLaunchError(body?.code || `HTTP_${res.status}`, body?.detail || body?.errors || null);
    }
    return body;
  }

  async _post(path, body) {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new FBTLaunchError(data?.code || `HTTP_${res.status}`, data?.detail || null);
    }
    return data;
  }
}

export { DEFAULT_DEADLINE_SECONDS };
export default FBTLaunch;
