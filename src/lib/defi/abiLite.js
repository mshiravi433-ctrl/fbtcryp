/**
 * FBT DEFI — A SYNCHRONOUS ABI CODER FOR THE SPLIT ROUTER.
 * ===========================================================================
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The cold-start work made `Interface` lazy: `server/ethersLite.js` loads the
 * ethers ABI machinery on demand and returns a PROMISE, so the caller awaits
 * it. That is right for a server module whose whole function is async.
 *
 * But the split router's plan builder is NOT async:
 *
 *   routeSupplyPlan(plan, opts)   → sync, called from five React panels
 *   splitRouterStep(protocol, amt) → sync, called from the same panels
 *   parseRoutedEvent(receipt, addr) → sync, called from the receipt parser
 *
 * Making them async would change every call site AND every test, for four
 * ABI entries whose encoding is not cryptography — it is a 4-byte selector
 * followed by 32-byte words.
 *
 * So this module implements exactly that, synchronously, with no dependency:
 *
 *   • the 4-byte selector  = keccak256(signature)[0..4]
 *   • a static `uint256`   = one 32-byte big-endian word
 *   • a static `address`   = one 32-byte word, left-padded
 *   • a dynamic event      = the three indexed addresses in the topics, and
 *                            the three uint256s in the data
 *
 * The Keccak-256 comes from `server/keccak.js`, which is the same
 * implementation `ethersLite` uses and which the test suite checks against
 * `ethers` directly. So the selectors this file produces are the selectors
 * the chain expects — and the test file proves it by comparing against
 * `ethers` on every function and event it encodes.
 *
 * WHAT THIS IS NOT: a general ABI coder. It handles static arguments of type
 * `uint256` and `address`, and one event shape. Anything else throws, loudly,
 * rather than encoding something wrong.
 */

import { keccak256 } from '../../../server/keccak.js';

/** The 4-byte selector of a canonical function signature. */
export function functionSelector(signature) {
  const digest = keccak256Bytes(canonicalSignature(signature));
  return `0x${Buffer.from(digest.subarray(0, 4)).toString('hex')}`;
}

/** The 32-byte topic of a canonical event signature. */
export function eventTopic(signature) {
  const digest = keccak256Bytes(canonicalSignature(signature));
  return `0x${Buffer.from(digest).toString('hex')}`;
}

function keccak256Bytes(text) {
  /* `keccak256` takes bytes; a canonical signature is a UTF-8 string, and
     UTF-8 is the encoding `ethers`'s `toUtf8Bytes` uses — so the digest is
     byte-identical to ethers's. */
  return keccak256(new TextEncoder().encode(String(text)));
}

/* ── word encoding ─────────────────────────────────────────────────────── */

const WORD = 32;

function uint256Word(value) {
  let v = BigInt(value);
  if (v < 0n) throw new Error('ABI_UINT256_NEGATIVE');
  if (v >= 1n << 256n) throw new Error('ABI_UINT256_OVERFLOW');
  return v.toString(16).padStart(WORD * 2, '0');
}

function addressWord(value) {
  const text = String(value || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) throw new Error('ABI_ADDRESS_INVALID');
  return text.slice(2).toLowerCase().padStart(WORD * 2, '0');
}

function encodeArgs(types, values) {
  if (types.length !== values.length) throw new Error('ABI_ARGUMENT_COUNT_MISMATCH');
  return types
    .map((type, index) => {
      const value = values[index];
      if (type === 'uint256') return uint256Word(value);
      if (type === 'address') return addressWord(value);
      throw new Error(`ABI_UNSUPPORTED_TYPE:${type}`);
    })
    .join('');
}

/* ── decoding ──────────────────────────────────────────────────────────── */

function readWord(data, index) {
  const word = data.slice(index * WORD * 2, (index + 1) * WORD * 2);
  if (word.length < WORD * 2) throw new Error('ABI_DATA_TRUNCATED');
  return BigInt(`0x${word}`);
}

function readAddressWord(data, index) {
  const word = data.slice(index * WORD * 2, (index + 1) * WORD * 2);
  if (word.length < WORD * 2) throw new Error('ABI_DATA_TRUNCATED');
  return `0x${word.slice(24).toLowerCase()}`;
}

/* ── the coder ─────────────────────────────────────────────────────────── */

/**
 * Build a synchronous, ethers-shaped coder for a small set of functions.
 *
 * @param {{ functions: Array<{ signature: string, outputs: string[] }>, events?: Array<{ signature: string, inputs: Array<{ name: string, type: string, indexed: boolean }> }> }} spec
 * @returns {{ encodeFunctionData: Function, decodeFunctionResult: Function, parseLog: Function }}
 */
export function buildCoder(spec) {
  const functions = new Map();
  for (const fn of spec.functions || []) {
    functions.set(canonicalSignature(fn.signature), {
      selector: functionSelector(fn.signature),
      outputs: fn.outputs || []
    });
  }

  const events = new Map();
  for (const event of spec.events || []) {
    const key = canonicalSignature(event.signature);
    events.set(key, {
      topic: eventTopic(event.signature),
      /* The event NAME is the part before the parenthesis. */
      name: key.replace(/\(.*$/, '').trim(),
      inputs: event.inputs || []
    });
  }

  /*
   * A caller may name a function without its types (`approve`). The coder
   * knows the types, so a bare name resolves to the ONE entry whose bare
   * name matches — and if there is more than one such entry, the lookup is
   * ambiguous and must fail rather than guess.
   */
  const resolveKey = (name) => {
    const text = String(name || '').trim();
    const direct = canonicalSignature(text);
    if (functions.has(direct)) return direct;
    const bare = direct.replace(/\(.*$/, '').trim();
    const matches = [...functions.keys()].filter((key) => key.replace(/\(.*$/, '').trim() === bare);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`ABI_AMBIGUOUS_FUNCTION:${bare}`);
    return direct;
  };

  return {
    /**
     * @param {string} name the canonical signature
     * @param {unknown[]} values the arguments
     * @returns {string} the hex call data
     */
    encodeFunctionData(name, values = []) {
      const key = resolveKey(name);
      const entry = functions.get(key);
      if (!entry) throw new Error(`ABI_UNKNOWN_FUNCTION:${key}`);
      const types = typesFromSignature(key);
      return `${entry.selector}${encodeArgs(types, values)}`;
    },

    /**
     * Decode the arguments of an encoded call.
     *
     * @param {string} name the canonical signature
     * @param {string} data the hex call data (selector + words)
     * @returns {unknown[]} the decoded arguments
     */
    decodeFunctionData(name, data) {
      const key = resolveKey(name);
      const entry = functions.get(key);
      if (!entry) throw new Error(`ABI_UNKNOWN_FUNCTION:${key}`);
      const body = String(data || '').replace(/^0x/, '');
      if (!body.toLowerCase().startsWith(entry.selector.slice(2).toLowerCase())) {
        throw new Error('ABI_SELECTOR_MISMATCH');
      }
      const words = body.slice(entry.selector.length - 2);
      const types = typesFromSignature(key);
      const values = [];
      let offset = 0;
      for (const type of types) {
        if (type === 'uint256') {
          values.push(readWord(words, offset));
          offset += 1;
        } else if (type === 'address') {
          values.push(readAddressWord(words, offset));
          offset += 1;
        } else {
          throw new Error(`ABI_UNSUPPORTED_TYPE:${type}`);
        }
      }
      return values;
    },

    /**
     * @param {string} name the canonical signature
     * @param {string} data the hex return data
     * @returns {unknown[]} the decoded values
     */
    decodeFunctionResult(name, data) {
      const key = resolveKey(name);
      const entry = functions.get(key);
      if (!entry) throw new Error(`ABI_UNKNOWN_FUNCTION:${key}`);
      const body = String(data || '').replace(/^0x/, '');
      const values = [];
      let offset = 0;
      for (const type of entry.outputs) {
        if (type === 'uint256') {
          values.push(readWord(body, offset));
          offset += 1;
        } else if (type === 'address') {
          values.push(readAddressWord(body, offset));
          offset += 1;
        } else {
          throw new Error(`ABI_UNSUPPORTED_TYPE:${type}`);
        }
      }
      return values;
    },

    /**
     * @param {{ topics: string[], data: string }} log
     * @returns {{ name: string, args: object }}
     */
    parseLog(log) {
      const topics = Array.isArray(log?.topics) ? log.topics : [];
      for (const event of events.values()) {
        if (String(topics[0] || '').toLowerCase() !== event.topic.toLowerCase()) continue;
        const body = String(log?.data || '').replace(/^0x/, '');
        const args = {};
        let topicIndex = 1;
        let wordIndex = 0;
        for (const input of event.inputs) {
          if (input.indexed) {
            const topic = topics[topicIndex] || '';
            topicIndex += 1;
            /* A single indexed static type is stored in the topic itself. */
            if (input.type === 'address') {
              args[input.name] = `0x${String(topic).replace(/^0x/, '').slice(24).toLowerCase()}`;
            } else if (input.type === 'uint256') {
              args[input.name] = BigInt(topic);
            } else {
              throw new Error(`ABI_UNSUPPORTED_INDEXED_TYPE:${input.type}`);
            }
          } else {
            if (input.type === 'uint256') {
              args[input.name] = readWord(body, wordIndex);
              wordIndex += 1;
            } else if (input.type === 'address') {
              args[input.name] = readAddressWord(body, wordIndex);
              wordIndex += 1;
            } else {
              throw new Error(`ABI_UNSUPPORTED_TYPE:${input.type}`);
            }
          }
        }
        return { name: event.name, args };
      }
      throw new Error('ABI_UNKNOWN_EVENT_TOPIC');
    },

    /** The event signature this coder knows, for callers that need it. */
    eventSignatures() {
      return [...events.keys()];
    }
  };
}

/**
 * Pull the argument TYPES out of a canonical signature.
 *
 * A canonical signature carries only types (`supplyAave(uint256)`), but a
 * human writes the ABI with names (`supplyAave(uint256 amount)`). The
 * selector is computed over the NAME-LESS form, so the names are stripped
 * here — otherwise the selector would be wrong, which is the one failure
 * this module must never have.
 */
function typesFromSignature(signature) {
  const open = String(signature).indexOf('(');
  const close = String(signature).lastIndexOf(')');
  if (open < 0 || close < 0) return [];
  const body = String(signature).slice(open + 1, close).trim();
  if (!body) return [];
  return body
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * ABI-encode a list of STATIC values.
 *
 * The EIP-712 hashes are the other place a synchronous ABI coder is
 * needed: `computeDomainSeparator()` and `computeEIP712IntentStructHash()`
 * hash a tuple of `bytes32`, `address` and `uint256`, and `ethers`'s
 * `AbiCoder` is behind the lazy boundary — so it arrives as a promise and
 * cannot be used in a synchronous hash.
 *
 * Every type here is STATIC, so the encoding is exactly one 32-byte word
 * per value, in order:
 *
 *   • `bytes32` — the 32 bytes, unchanged;
 *   • `address` — the 20 bytes, LEFT-padded to 32;
 *   • `uint256` — the number, big-endian, 32 bytes.
 *
 * A dynamic type (`string`, `bytes`, arrays, tuples) is NOT supported and
 * throws, because encoding one wrong would produce a hash the chain does
 * not recognise — which is exactly the failure this module exists to
 * prevent.
 *
 * @param {string[]} types
 * @param {unknown[]} values
 * @returns {string} the hex-encoded call data
 */
export function abiEncodeStatic(types, values) {
  if (!Array.isArray(types) || !Array.isArray(values) || types.length !== values.length) {
    throw new Error('ABI_ARGUMENT_COUNT_MISMATCH');
  }
  const words = types.map((type, index) => {
    const value = values[index];
    if (type === 'bytes32') {
      const hex = String(value || '').replace(/^0x/, '');
      if (hex.length !== 64) throw new Error('ABI_BYTES32_INVALID');
      return hex.toLowerCase();
    }
    if (type === 'address') return addressWord(value);
    if (type === 'uint256') return uint256Word(value);
    throw new Error(`ABI_UNSUPPORTED_TYPE:${type}`);
  });
  return `0x${words.join('')}`;
}

/**
 * The canonical, name-less form of a signature.
 *
 * `supplyAave(uint256 amount)` → `supplyAave(uint256)`
 */
export function canonicalSignature(signature) {
  const text = String(signature || '').trim();
  const open = text.indexOf('(');
  /*
   * The closing parenthesis is found by DEPTH, not by `lastIndexOf(')')`.
   *
   * A human-written ABI line continues after the argument list —
   * `function feeBps() view returns (uint256)` — and the last `)` on that
   * line belongs to the RETURN clause, not to the arguments. Taking it
   * would hash `feeBps())` and produce a selector the chain has never
   * heard of.
   */
  let close = -1;
  if (open >= 0) {
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
      const ch = text[index];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { close = index; break; }
      }
    }
  }
  /* A bare name (`feeBps`) is the same function as `feeBps()`. */
  if (open < 0 || close < 0) {
    const bare = text.replace(/^(?:event|function)\s+/i, '').trim();
    return bare.includes('(') ? bare : `${bare}()`;
  }
  /* The `event`/`function` keyword is not part of the hashed name. */
  const name = text.slice(0, open).trim().replace(/^(?:event|function)\s+/i, '');
  /* The canonical form drops parameter NAMES and the `indexed` modifier:
     `event Routed(address indexed target, …)` hashes as
     `Routed(address,address,address,uint256,uint256,uint256)`. */
  const types = typesFromSignature(text.slice(open, close + 1))
    .map((type) => type.replace(/\s+indexed$/i, '').trim())
    .filter(Boolean);
  return `${name}(${types.join(',')})`;
}
