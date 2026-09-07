# Insurance API

Mounted at `/api/insurance`. Discovery: `GET /providers`, `GET /products`, `POST /quote`, `POST /risk`, `GET /coverage`, `GET /claims`, `GET /provider-health`. Purchase is two phase: `POST /purchase-intent` returns an unsigned payload, then `POST /transaction/activate` verifies the wallet transaction. Claims use `POST /claim` and `/claim/:id/submit`. Admin actions require configured authorization and must be operationally multisig-gated.

Responses are server-authoritative; BigInt money values are serialized as strings. Source and freshness must be displayed for provider/oracle/blockchain data. Errors are structured and purchases never happen from a recommendation.