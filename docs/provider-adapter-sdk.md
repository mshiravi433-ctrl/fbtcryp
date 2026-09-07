# Provider adapter SDK

Adapters are the only source of provider products and quotes. Implement discovery, quote, health and terms retrieval; validate responses before registration. Never add an address, fee, capacity, chain or coverage term without provider evidence. Unconfigured adapters must report `NOT_CONFIGURED` and cannot quote.

Adapters are registered through `server/insurance/provider-registry.js`. Health states are `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `PAUSED`, and `UNKNOWN`. Existing coverage remains visible when a provider is disabled.