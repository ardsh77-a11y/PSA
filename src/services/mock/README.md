# Mock services

Deterministic, offline implementations of the interfaces defined in
`../interfaces`. External APIs (CV, price feeds, marketplaces, LLMs) are not
reachable in this environment, so these mocks provide seeded, repeatable
behavior. Later features implement each one here (e.g. `mockRecognizer.ts`,
`mockPricingEngine.ts`) and wire them in behind the interfaces.

## Marketplace publishing (`mockMarketplacePublisher.ts`)

Publishing a listing to an external marketplace (eBay, TCGplayer, Whatnot,
Mercari, Shopify, ...) is defined entirely behind the `MarketplacePublisher`
interface in `../interfaces/marketplace.ts`. The app only ever talks to that
interface via `../listingService.ts`; it never imports a concrete marketplace
client. That guarantees a real integration can drop in later with ZERO UI
changes.

The mock:

- performs NO network I/O and holds NO credentials, so it is safe in this
  sandbox;
- fabricates a stable, marketplace-prefixed external id from the listing id
  (republishing the same listing yields the same id) plus a timestamp;
- supports `unpublish` so a listing can be ended / returned to inventory.

A real implementation would hold OAuth tokens SERVER-SIDE and call the
marketplace API. Credentials are NEVER exposed to the frontend — the browser
only ever sees the returned `externalId`/`publishedAt`.
