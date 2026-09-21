/**
 * @fbt/intent-sdk
 * ---------------------------------------------------------------------------
 * Official Client SDK for the FBT Intent Protocol.
 * Non-custodial, cryptographic, multi-chain (EVM + Solana).
 */

import {
  createCanonicalIntent,
  validateCanonicalIntent,
  computeIntentId,
  verifyIntentSignature,
  verifyExecutionReceipt,
  buildEIP712IntentPayload,
  buildSolanaSignMessage,
  PROTOCOL_VERSION,
  INTENT_SCHEMA_VERSION
} from '../src/lib/protocol/index.js';

export class FBTIntentSDK {
  constructor({ baseUrl = 'http://localhost:3000', chainId = 8453, fetchFn = null } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultChainId = chainId;
    this.fetch = fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.version = PROTOCOL_VERSION;

    this.intent = {
      create: (params) => this.createIntent(params),
      sign: (intent, signer) => this.signIntent(intent, signer),
      submit: (signedIntent) => this.submitIntent(signedIntent),
      get: (intentId) => this.getIntent(intentId),
      cancel: (intentId, options) => this.cancelIntent(intentId, options),
      getQuotes: (intentId) => this.getQuotes(intentId),
      getExecution: (intentId) => this.getExecution(intentId),
      getProof: (intentId) => this.getProof(intentId)
    };

    this.solvers = {
      list: (filter) => this.listSolvers(filter),
      get: (solverId) => this.getSolver(solverId),
      register: (metadata) => this.registerSolver(metadata)
    };

    this.protocol = {
      getHealth: () => this.getHealth(),
      getVersion: () => this.getVersion()
    };
  }

  createIntent(params) {
    return createCanonicalIntent({
      sourceChain: params.sourceChain || this.defaultChainId,
      ...params
    });
  }

  async signIntent(intent, signer) {
    if (!signer) throw new Error('Signer required to authorize intent');

    // EVM EIP-712 signing
    if (typeof signer.signTypedData === 'function') {
      const { domain, types, message } = buildEIP712IntentPayload(intent, intent.sourceChain);
      const signature = await signer.signTypedData(domain, types, message);
      return { ...intent, signature, status: 'SIGNED' };
    }

    // Solana signing
    if (typeof signer.signMessage === 'function') {
      const msg = buildSolanaSignMessage(intent);
      const sig = await signer.signMessage(msg);
      const signatureStr = typeof sig === 'string' ? sig : Buffer.from(sig).toString('hex');
      return { ...intent, signature: signatureStr, status: 'SIGNED' };
    }

    throw new Error('Unsupported signer interface');
  }

  async submitIntent(intent) {
    if (!intent.signature) {
      throw new Error('Intent must be signed before submission');
    }

    const res = await this._post('/api/intents', intent);
    return res;
  }

  async getIntent(intentId) {
    return this._get(`/api/intents/${encodeURIComponent(intentId)}`);
  }

  async cancelIntent(intentId, options = {}) {
    return this._post(`/api/intents/${encodeURIComponent(intentId)}/cancel`, options);
  }

  async getQuotes(intentId) {
    return this._get(`/api/intents/${encodeURIComponent(intentId)}/quotes`);
  }

  async getExecution(intentId) {
    return this._get(`/api/intents/${encodeURIComponent(intentId)}/execution`);
  }

  async getProof(intentId) {
    return this._get(`/api/intents/${encodeURIComponent(intentId)}/proof`);
  }

  async listSolvers(filter = {}) {
    const params = new URLSearchParams(filter).toString();
    const query = params ? `?${params}` : '';
    return this._get(`/api/solvers${query}`);
  }

  async getSolver(solverId) {
    return this._get(`/api/solvers/${encodeURIComponent(solverId)}`);
  }

  async registerSolver(metadata) {
    return this._post('/api/solvers/register', metadata);
  }

  async getHealth() {
    return this._get('/api/protocol/health');
  }

  async getVersion() {
    return this._get('/api/protocol/version');
  }

  async _get(path) {
    if (!this.fetch) throw new Error('No fetch implementation available');
    const resp = await this.fetch(`${this.baseUrl}${path}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(err.message || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async _post(path, body) {
    if (!this.fetch) throw new Error('No fetch implementation available');
    const resp = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(err.message || `HTTP ${resp.status}`);
    }
    return resp.json();
  }
}

export default FBTIntentSDK;
