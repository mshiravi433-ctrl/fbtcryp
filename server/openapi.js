/**
 * OPENAPI — the ecosystem, developer and trust surface, and nothing else.
 *
 * WHY NOT THE WHOLE API
 * ---------------------------------------------------------------------------
 * Most of this server is a cache in front of public market data whose shapes
 * come from upstream providers and change without us. Committing those to a
 * spec would produce a document that is wrong within a month, and a wrong spec
 * is worse than none: integrators generate clients from it. What is described
 * here is the surface WE own and WE version — the registry, its lifecycle, the
 * developer credentials, and the read-only trust/discovery reads.
 *
 * HONESTY RULES BAKED IN
 * ---------------------------------------------------------------------------
 *   · Every path listed here is asserted to exist by test/wiring.mjs, the same
 *     way the Developers page is. The spec cannot advertise a route nobody
 *     implemented.
 *   · The `x-fbt-boundary` block states, in the document itself, that no
 *     endpoint can sign, execute, settle or withdraw — because the first
 *     question an integrator asks a registry API is "can it move my funds",
 *     and the answer should be in the contract, not in a blog post.
 *   · Configuration truth is injected at request time (`durableStore`,
 *     `certificationIssuerConfigured`) so the document says what THIS
 *     deployment can currently do, not what the code could do if configured.
 */

const json = (schema) => ({ 'application/json': { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const ERROR_RESPONSE = {
  400: { description: 'Invalid or unsafe input', content: json(ref('Error')) },
  401: { description: 'Authentication required, or the API key is unknown or revoked', content: json(ref('Error')) },
  403: { description: 'Authenticated but not permitted (ownership, scope or reviewer allowlist)', content: json(ref('Error')) },
  409: { description: 'Conflicting state (lifecycle, idempotency, duplicate id, missing certification)', content: json(ref('Error')) },
  429: { description: 'Rate limited', content: json(ref('Error')) },
  503: { description: 'No durable store is configured, so the write was refused rather than lost', content: json(ref('Error')) }
};

const listResponse = (description) => ({
  200: { description, content: json(ref('ResourceList')) },
  ...ERROR_RESPONSE
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', maxLength: 64 },
  description: 'The listing id chosen at creation.'
};

const writeOp = (summary, description, { params = [], body = 'ListingWrite', auth = true } = {}) => ({
  summary,
  description,
  ...(auth ? { security: [{ telegramInitData: [] }, { developerApiKey: [] }] } : {}),
  parameters: [
    ...params,
    {
      name: 'idempotency-key',
      in: 'header',
      required: true,
      schema: { type: 'string', minLength: 8, maxLength: 128 },
      description: 'Replays return the original response instead of creating a second record.'
    }
  ],
  ...(body ? { requestBody: { required: true, content: json(ref(body)) } } : {}),
  responses: {
    200: { description: 'Applied (or replayed from the idempotency key)', content: json(ref('ListingEnvelope')) },
    201: { description: 'Created', content: json(ref('ListingEnvelope')) },
    ...ERROR_RESPONSE
  }
});

const lifecycleOp = (action, description) => writeOp(`${action[0].toUpperCase()}${action.slice(1)} a listing`, description, { params: [idParam], body: null });

export function openApiDocument({ certificationIssuerConfigured = false, durableStore = false } = {}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'FBT ecosystem registry API',
      version: '1.0.0',
      summary: 'Agent and strategy catalog, developer credentials, certifications and observed reputation.',
      description: [
        'Public reads need nothing. Writes need a Telegram Mini App session or a developer API key holding the `manage_listings` scope.',
        '',
        'A listing is self-reported until an allowlisted reviewer issues a certification for it, and it appears in the public catalog only while that certification is active and not older than the listing content.',
        '',
        'Market-data endpoints are intentionally not described here: their shapes come from upstream providers and a spec that cannot be kept true is worse than no spec.'
      ].join('\n')
    },
    servers: [{ url: '/api', description: 'Same-origin API' }],
    'x-fbt-boundary': {
      /* The answer to "can this API move my money": no, and there is no route
         to add it to without changing this document. */
      canSign: false,
      canExecute: false,
      canSettle: false,
      canWithdraw: false,
      custody: false,
      automaticExecution: false,
      userSignatureRequired: true,
      publishRequiresCertification: true,
      deployment: { durableStore, certificationIssuerConfigured }
    },
    components: {
      securitySchemes: {
        telegramInitData: {
          type: 'apiKey',
          in: 'header',
          name: 'x-telegram-init-data',
          description: 'The signed Telegram Mini App initData string. Its HMAC is re-verified on every request.'
        },
        developerApiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'A `fbt_sandbox_…` secret from POST /developer/projects/{id}/keys. Only its sha256 hash is stored; scopes are checked per route.'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', examples: ['FORBIDDEN_PERMISSION', 'CERTIFICATION_REQUIRED', 'SCOPE_NOT_ALLOWED'] },
                message: { type: 'string' },
                retryable: { type: 'boolean' },
                requestId: { type: 'string' }
              }
            }
          }
        },
        ResourceList: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object' } },
            pagination: { type: 'object', properties: { cursor: { type: ['string', 'null'] }, hasMore: { type: 'boolean' } } },
            meta: {
              type: 'object',
              properties: {
                schema: { type: 'string', const: 'fbt.resource-list.v1' },
                generatedAt: { type: 'string', format: 'date-time' },
                dataStatus: {
                  type: 'string',
                  enum: ['live', 'unavailable'],
                  description: '`unavailable` means no durable registry is configured — an empty list is an absence of storage, not an absence of listings.'
                },
                resourceSchema: { type: 'string' },
                limitations: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        },
        ListingEnvelope: {
          type: 'object',
          properties: { data: ref('Listing'), meta: { type: 'object' } }
        },
        Listing: {
          type: 'object',
          properties: {
            schema: { type: 'string', examples: ['fbt.agent.v1', 'fbt.strategy.v1'] },
            id: { type: 'string' },
            name: { type: 'object', additionalProperties: { type: 'string' }, description: 'Localized: { en, fa, ar }.' },
            description: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
            status: { type: 'string', enum: ['draft', 'submitted', 'published', 'revoked', 'deleted'] },
            supportedChains: { type: 'array', items: { type: 'integer' } },
            executionMode: { type: 'string', enum: ['manual', 'simulation-only'], description: 'Agents only. There is no autonomous mode.' },
            permissions: {
              type: 'object',
              description: 'Always false/true as shown — the validator rejects any other value.',
              properties: {
                withdrawFunds: { type: 'boolean', const: false },
                executeWithoutUser: { type: 'boolean', const: false },
                requiresUserApproval: { type: 'boolean', const: true }
              }
            },
            verification: ref('Verification'),
            reputation: ref('Reputation')
          }
        },
        ListingWrite: {
          type: 'object',
          required: ['id', 'name'],
          description: 'Ownership, status, verification and permissions are set by the server and ignored if sent.',
          properties: {
            id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{1,63}$' },
            name: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }] },
            description: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }] },
            supportedChains: { type: 'array', items: { type: 'integer' } },
            executionMode: { type: 'string', enum: ['manual', 'simulation-only'] },
            policy: {
              type: 'object',
              description: 'Strategies only. Bounds are mandatory.',
              properties: {
                maxAmountUsd: { type: 'number', exclusiveMinimum: 0 },
                maxSlippageBps: { type: 'number', minimum: 0 },
                allowedChains: { type: 'array', items: { type: 'integer' } }
              }
            }
          }
        },
        Verification: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['unverified', 'certified'] },
            method: { type: 'string', enum: ['self_reported', 'reviewer_certified'] },
            types: { type: 'array', items: { type: 'string' } },
            issuers: { type: 'array', items: { type: 'string' }, description: 'Reviewer labels. Never an account id.' },
            issuedAt: { type: 'integer' },
            expiresAt: { type: ['integer', 'null'] }
          }
        },
        Reputation: {
          type: 'object',
          description: 'Derived from opt-in bucketed execution observations. Under five decided samples both numbers are null.',
          properties: {
            status: { type: 'string', enum: ['observed', 'insufficient_data'] },
            sampleSize: { type: ['integer', 'null'] },
            successRate: { type: ['number', 'null'] },
            confidence: { type: 'string', enum: ['none', 'low', 'medium', 'high'] }
          }
        },
        Certification: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            subjectId: { type: 'string' },
            subjectType: { type: 'string', enum: ['agent', 'strategy', 'liquidity', 'project', 'solver'] },
            certificationType: { type: 'string', enum: ['api_verified', 'sandbox_reviewed', 'security_reviewed', 'identity_verified'] },
            issuer: { type: 'string', description: 'The reviewer’s public label.' },
            status: { type: 'string', enum: ['active', 'revoked', 'expired', 'superseded'] },
            issuedAt: { type: 'integer' },
            expiresAt: { type: ['integer', 'null'] },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['sandbox_test_run', 'code_review', 'documentation', 'signed_attestation'] },
                  uri: { type: ['string', 'null'], format: 'uri' },
                  sha256: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' }
                }
              }
            }
          }
        },
        CertificationWrite: {
          type: 'object',
          required: ['subjectId', 'subjectType', 'certificationType', 'evidence'],
          properties: {
            subjectId: { type: 'string' },
            subjectType: { type: 'string', enum: ['agent', 'strategy', 'liquidity', 'project', 'solver'] },
            certificationType: { type: 'string', enum: ['api_verified', 'sandbox_reviewed', 'security_reviewed', 'identity_verified'] },
            expiresAt: { type: 'integer', description: 'Capped at one year from issuance.' },
            evidence: { type: 'array', minItems: 1, items: { type: 'object' }, description: 'Each item needs an https uri or a sha256 digest. Free text is refused.' }
          }
        },
        PortfolioAgent: {
          type: 'object',
          properties: {
            allocations: { type: 'array', items: { type: 'object', properties: { asset: { type: 'string' }, targetPct: { type: 'number' }, chainId: { type: ['integer', 'null'] } } } },
            rebalance: { type: 'object', properties: { maxTradeUsd: { type: 'number' }, maxSlippageBps: { type: 'number' }, mode: { type: 'string', const: 'approval_required' } } },
            permissions: { type: 'object', properties: { withdrawFunds: { type: 'boolean', const: false }, executeWithoutUser: { type: 'boolean', const: false } } }
          }
        }
      }
    },
    paths: {
      '/intents/v1/external-agents': {
        get: {
          summary: 'Discover approved external agents',
          description: 'Public and read-only. The response preserves unavailable registry status; a candidate is never an execution permission, capability token or session key.',
          parameters: [
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }
          ],
          responses: {
            200: {
              description: 'External-agent discovery with an honest live/unavailable status',
              content: json({
                type: 'object',
                required: ['schema', 'dataStatus', 'candidates'],
                properties: {
                  schema: { type: 'string', const: 'fbt.external-agent-discovery.v1' },
                  dataStatus: { type: 'string', enum: ['live', 'unavailable'] },
                  candidates: { type: 'array', items: { type: 'object' } },
                  pagination: { type: 'object' }
                }
              })
            },
            ...ERROR_RESPONSE
          }
        }
      },
      '/ecosystem/agents': {
        get: { summary: 'List published agents', description: 'Public. Only listings that are published AND currently certified appear.', responses: listResponse('Published agent listings') },
        post: writeOp('Register an agent', 'Creates a draft owned by the caller. Requests for withdrawFunds or executeWithoutUser are refused before storage is touched.')
      },
      '/ecosystem/strategies': {
        get: { summary: 'List published strategies', description: 'Public. Policy bounds and approval requirements are part of every row.', responses: listResponse('Published strategy listings') },
        post: writeOp('Register a strategy', 'Creates a draft. `action.automaticExecution: true` is refused; every strategy proposes an intent the user signs.')
      },
      '/ecosystem/liquidity': {
        get: { summary: 'List liquidity providers', description: 'Read-only catalog. There is no write path while RFQ settlement and custody do not exist.', responses: listResponse('Liquidity provider listings') }
      },
      '/ecosystem/agents/{id}': { post: writeOp('Edit an agent draft', 'Allowed only while draft or submitted, and always returns the listing to draft.', { params: [idParam] }) },
      '/ecosystem/strategies/{id}': { post: writeOp('Edit a strategy draft', 'Allowed only while draft or submitted, and always returns the listing to draft.', { params: [idParam] }) },
      '/ecosystem/agents/{id}/submit': { post: lifecycleOp('submit', 'Send the draft for review. Owner only.') },
      '/ecosystem/agents/{id}/publish': { post: lifecycleOp('publish', 'Requires an active certification not older than the listing content.') },
      '/ecosystem/agents/{id}/revoke': { post: lifecycleOp('revoke', 'Removes it from the catalog; the record and id are kept.') },
      '/ecosystem/agents/{id}/delete': { post: lifecycleOp('delete', 'Soft delete from draft. Nothing is erased.') },
      '/ecosystem/agents/{id}/draft': { post: lifecycleOp('draft', 'Return a submitted or revoked listing to draft for rework.') },
      '/ecosystem/strategies/{id}/submit': { post: lifecycleOp('submit', 'Send the draft for review. Owner only.') },
      '/ecosystem/strategies/{id}/publish': { post: lifecycleOp('publish', 'Requires an active certification not older than the listing content.') },
      '/ecosystem/strategies/{id}/revoke': { post: lifecycleOp('revoke', 'Removes it from the catalog; the record and id are kept.') },
      '/ecosystem/strategies/{id}/delete': { post: lifecycleOp('delete', 'Soft delete from draft. Nothing is erased.') },
      '/ecosystem/strategies/{id}/draft': { post: lifecycleOp('draft', 'Return a submitted or revoked listing to draft for rework.') },
      '/ecosystem/mine/agents': {
        get: { summary: 'Your own agent listings', description: 'Every state except deleted, plus why a published listing is not visible.', security: [{ telegramInitData: [] }, { developerApiKey: [] }], responses: listResponse('Owner-scoped listings') }
      },
      '/ecosystem/mine/strategies': {
        get: { summary: 'Your own strategy listings', description: 'Owner-scoped by construction; there is no parameter that widens it.', security: [{ telegramInitData: [] }, { developerApiKey: [] }], responses: listResponse('Owner-scoped listings') }
      },
      '/ecosystem/certifications': {
        get: {
          summary: 'Certifications for a subject',
          description: 'Public. Evidence is an https link or a sha256 digest.',
          parameters: [{ name: 'subjectId', in: 'query', schema: { type: 'string' } }, { name: 'subjectType', in: 'query', schema: { type: 'string' } }],
          responses: listResponse('Certifications, newest first')
        },
        post: writeOp('Issue a certification', 'Allowlisted reviewers only (ECOSYSTEM_CERTIFIERS). API keys cannot issue: a delegated credential must not vouch for its own owner.', { body: 'CertificationWrite' })
      },
      '/ecosystem/certifications/{id}/revoke': {
        post: writeOp('Revoke a certification', 'Takes effect on the next catalog read: the listing leaves the public catalog immediately.', { params: [idParam], body: null })
      },
      '/ecosystem/certifier': {
        get: { summary: 'Am I a reviewer?', description: 'Convenience for rendering a reviewer console. Every write re-checks the allowlist server-side.', security: [{ telegramInitData: [] }], responses: { 200: { description: 'Reviewer status for the caller' }, ...ERROR_RESPONSE } }
      },
      '/ecosystem/review/queue': {
        get: { summary: 'Listings awaiting review', description: 'Reviewer-only. Deliberately does not include who submitted a listing.', security: [{ telegramInitData: [] }], responses: listResponse('Submitted listings, oldest first') }
      },
      '/ecosystem/status': {
        get: { summary: 'Registry status', description: 'Public counts per lifecycle state plus the configuration flags that explain an empty catalog.', responses: { 200: { description: 'Registry status' }, ...ERROR_RESPONSE } }
      },
      '/reputation/{id}': {
        get: {
          summary: 'Observed reputation for a subject',
          description: 'Aggregate-only, derived from opt-in execution observations. Nothing accepts a posted reputation.',
          parameters: [idParam],
          responses: { 200: { description: 'Reputation summary or an honest unavailable', content: json(ref('Reputation')) }, ...ERROR_RESPONSE }
        }
      },
      '/portfolio/agent': {
        get: { summary: 'Read your portfolio agent', description: 'Approval-only allocation target. No scheduler or signer reads it.', security: [{ telegramInitData: [] }], responses: { 200: { description: 'Portfolio agent or null', content: json(ref('PortfolioAgent')) }, ...ERROR_RESPONSE } },
        post: writeOp('Save your portfolio agent', 'Rebalance mode is forced to approval_required; withdrawal and act-alone permissions are refused.', { body: 'PortfolioAgent' })
      },
      '/developer/projects': {
        get: { summary: 'Your sandbox projects', security: [{ telegramInitData: [] }], responses: listResponse('Projects owned by the caller') },
        post: writeOp('Create a sandbox project', 'Sandbox only. Scopes are filtered to the allowed set.', { body: null })
      },
      '/environments': {
        get: { summary: 'Environment discovery', description: 'Configuration and health only. Never implies funded testnet or mainnet access.', responses: listResponse('Environments') }
      }
    }
  };
}
