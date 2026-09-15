# Mock services

Deterministic, offline implementations of the interfaces defined in
`../interfaces`. External APIs (CV, price feeds, marketplaces, LLMs) are not
reachable in this environment, so these mocks provide seeded, repeatable
behavior. Later features implement each one here (e.g. `mockRecognizer.ts`,
`mockPricingEngine.ts`) and wire them in behind the interfaces.
