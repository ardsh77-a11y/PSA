# PokeOps

**PokeOps** is an AI-powered Pokemon TCG Seller Operating System: a premium,
multi-user SaaS dashboard that takes a seller from a shoebox of cards to
fulfilled, profit-tracked orders. It models the full seller loop end to end:

```
Scan -> Identify -> Value -> Single / Bulk -> Listing -> Sell -> Fulfill -> Track Profit
```

A seller photographs cards, PokeOps recognizes them, values them against market
data, decides whether each card is worth selling individually or belongs in a
bulk lot, generates marketplace-ready listings, publishes them, records the
sale, walks the order through fulfillment, and reports realized profit, all in
one place.

---

## Tech stack and why

PokeOps is a **zero-dependency TypeScript application** that runs entirely on
**Node.js 22 built-ins**. It has no runtime dependencies and no dev
dependencies (`package.json` `dependencies` and `devDependencies` are both
empty).

| Concern            | Built on                                    |
| ------------------ | ------------------------------------------- |
| HTTP server        | `node:http` (hand-written router + middleware) |
| Database           | `node:sqlite` (`DatabaseSync`)              |
| Auth / crypto      | `node:crypto` (`scrypt`, `randomBytes`, `timingSafeEqual`) |
| Tests              | `node:test` + `node:assert`                 |
| Compilation        | Global TypeScript compiler (`tsc`)          |
| Frontend           | Server-rendered HTML from TS template functions + vanilla CSS/JS in `public/` |
| Charts             | Hand-drawn inline SVG (`src/views/components/charts.ts`) |

**Why zero dependencies?** This project is built and run in a
network-restricted sandbox (`INTEGRATIONS_ONLY`) where the npm registry is not
reachable (returns HTTP 403). Nothing can be `npm install`ed. Every capability
therefore uses only Node.js standard-library modules and the globally available
`tsc`. No bundler, no framework, no UI library, no ORM. The frontend is
server-rendered HTML and the charts are drawn as SVG by hand for the same
reason.

The same constraint means every external integration (computer vision, price
feeds, marketplace APIs, an LLM assistant) is unreachable at runtime. Those
capabilities are defined as **interfaces** and shipped with **deterministic
mock implementations** so the app is fully functional offline. See
[Modular architecture](#modular-architecture--interface-boundaries).

---

## Requirements

- **Node.js 22+** is required. PokeOps uses `node:sqlite`, which is a Node.js
  22 built-in (experimental). Older Node versions do not ship it.
- The global TypeScript compiler (`tsc`) must be on your `PATH`.
- Nothing else. There are no packages to install.

> **Experimental warning:** `node:sqlite` emits an `ExperimentalWarning`. The
> npm scripts run node with `--no-warnings` to keep output clean.

---

## The critical `NODE_OPTIONS` caveat (read this first)

In this build environment the shell sets:

```
NODE_OPTIONS=--require /opt/amazon/kiro-agent/proxy-bootstrap.js
```

That bootstrap file **does not exist**, so *every* `node`, `npm`, and `tsc`
invocation crashes before it can do anything. You **must clear it** before
building, seeding, testing, or running:

```bash
unset NODE_OPTIONS
```

Do this once per shell (or prefix each command). Setting it inside the npm
scripts is not sufficient, because `npm` itself is a Node process and would
crash on startup. If you see an error about a missing `proxy-bootstrap.js`,
this is the cause.

---

## Setup and run

No install step exists or is needed (zero dependencies). From a clean checkout:

```bash
unset NODE_OPTIONS        # required in this environment (see caveat above)
npm run build             # tsc -p tsconfig.json  -> compiles src/ into dist/
npm run seed              # populate the SQLite demo database
npm start                 # start the server (default port 4000)
```

Then open **http://localhost:4000** and log in with the seeded demo account:

- **Email:** `demo@pokeops.local`
- **Password:** `pokeops-demo`

(These are defined as `DEMO_EMAIL` / `DEMO_PASSWORD` in
`src/scripts/seed.ts`, and the seed script prints them on completion.)

### Configuration

Everything has an offline-first default (`src/config/index.ts`), overridable via
environment variables:

| Variable              | Default            | Purpose                        |
| --------------------- | ------------------ | ------------------------------ |
| `PORT`                | `4000`             | HTTP listen port               |
| `DB_PATH`             | `data/pokeops.db`  | SQLite database file path      |
| `SESSION_COOKIE_NAME` | `pokeops_sid`      | Session cookie name            |
| `NODE_ENV`            | `development`      | Environment label              |

---

## Testing

The test suite uses the Node.js built-in test runner (`node --test`) with
`node:assert`. Test files are named `*.test.ts` and live next to the code they
cover; they compile to `dist/**/*.test.js`.

```bash
unset NODE_OPTIONS
npm test          # tsc -p tsconfig.json && node --no-warnings --test "dist/**/*.test.js"
```

This builds and then runs the full suite (currently **119 tests**, all
passing), covering the schema, repositories, pricing engine, single-vs-bulk
classifier, listing/SKU generation, recognizer, seller assistant, analytics,
profit, import/export, the router, and password hashing.

---

## npm scripts

All scripts are defined in `package.json`:

| Script          | Command                                                    | Purpose                     |
| --------------- | ---------------------------------------------------------- | --------------------------- |
| `npm run build` | `tsc -p tsconfig.json`                                     | Compile `src/` -> `dist/`   |
| `npm start`     | `node --no-warnings dist/main.js`                          | Start the HTTP server       |
| `npm run dev`   | `node --no-warnings dist/main.js`                          | Same entry point            |
| `npm run seed`  | `node --no-warnings dist/scripts/seed.js`                  | Seed the demo database      |
| `npm test`      | `tsc -p tsconfig.json && node --no-warnings --test "dist/**/*.test.js"` | Build + run tests |

---

## Offline / network-restricted build

To reproduce the build with no network access:

1. Ensure Node.js 22+ and a global `tsc` are available (no registry needed).
2. `unset NODE_OPTIONS`.
3. `npm run build` (pure `tsc`, no downloads).
4. `npm run seed` then `npm start`.

There is no `npm install` step because there are no dependencies. `dist/` and
`data/` are generated and git-ignored (`.gitignore`); regenerate them anytime
with `npm run build` and `npm run seed`.

---

## Directory structure

```
PSA/
├── package.json            # scripts, zero deps, "type": "module"
├── tsconfig.json           # strict, ES2022, NodeNext, rootDir src -> outDir dist
├── .gitignore              # dist/, data/, node_modules/, *.log
├── README.md
├── public/                 # static assets served directly (CSS/JS)
├── src/
│   ├── main.ts             # server entry: builds router, starts node:http server
│   ├── config/             # central config (port, db path, cookie name)
│   ├── db/                 # schema (all 16 tables) + DatabaseSync connection singleton
│   ├── repositories/       # typed, per-entity data access (user-scoped)
│   ├── services/           # business logic (pricing, classification, listing, scan, ...)
│   │   ├── interfaces/     # the six pluggable capability seams (see below)
│   │   └── mock/           # deterministic offline implementations of those seams
│   ├── domain/             # TCG-agnostic strategy (game field, formatting)
│   ├── server/             # http router, middleware (session/cookies/body/static), routes/
│   ├── api/                # JSON endpoints consumed by vanilla-JS frontend enhancements
│   ├── views/              # server-rendered HTML: layout, components, pages/
│   ├── util/               # password hashing, ids, session store, html helpers
│   └── scripts/            # seed.ts (demo data)
├── dist/                   # compiled output (generated, git-ignored)
└── data/                   # runtime SQLite database (generated, git-ignored)
```

The architecture is layered: **db -> repositories -> services -> server/api ->
views**. Views only render strings; routes call services; services call
repositories; repositories own SQL. External capabilities sit behind
`services/interfaces` with implementations in `services/mock`.

---

## Database schema

The complete schema lives in `src/db/schema.ts` and runs idempotently
(`CREATE TABLE IF NOT EXISTS`) on every boot. Every user-owned table carries a
`user_id` that repositories scope all queries by, enforcing per-user data
isolation.

The schema defines **16 tables** (15 core entities plus the `rips` table added
in FEAT-007):

| Entity              | Purpose                                                          | Key relationships |
| ------------------- | ---------------------------------------------------------------- | ----------------- |
| `users`             | Accounts, hashed credentials, pricing mode, settings JSON        | root of all user data |
| `sets`              | Catalog sets (game-agnostic via `game` field, default `pokemon`) | referenced by `cards` |
| `cards`             | Catalog cards (name, number, rarity, holo flags, set)            | `set_id -> sets` |
| `storage_locations` | Physical box/shelf/slot/label locations                          | `user_id -> users` |
| `inventory`         | Owned copies: condition, qty, cost, market/target value, status, SKU, classification, `is_demo` | `user_id -> users`, `card_id -> cards`, `storage_location_id -> storage_locations` |
| `inventory_lots`    | Aggregate bulk holdings (e.g. "4,200 commons")                   | `user_id -> users` |
| `listings`          | Marketplace listing drafts / published listings                  | `user_id -> users`, `inventory_id -> inventory`, `bulk_lot_id -> bulk_lots` |
| `bulk_lots`         | Generated bulk listings with guarantees JSON                     | `user_id -> users` |
| `price_snapshots`   | Historical market data points per card (feeds the pricing engine)| `card_id -> cards` |
| `orders`            | Sales orders through the fulfillment lifecycle                   | `user_id -> users` |
| `order_items`       | Line items on an order                                           | `order_id -> orders`, `inventory_id`, `listing_id`, `card_id` |
| `sales`             | Realized sales with cost basis + net profit                      | `user_id -> users`, `order_id -> orders`, `inventory_id`, `card_id` |
| `expenses`          | Business expenses (supplies, shipping, product, fees)            | `user_id -> users` |
| `scans`             | An uploaded scan job and its status                              | `user_id -> users` |
| `scan_results`      | Per-card detections produced by a scan                           | `scan_id -> scans`, `card_id -> cards` |
| `rips`              | Pack/box "rip" logs: cost vs. pulled value vs. profit            | `user_id -> users`, `expense_id -> expenses` |

Foreign keys use `ON DELETE CASCADE` for owned children (e.g. a deleted user's
inventory/orders) and `ON DELETE SET NULL` for catalog references, so deleting a
catalog card does not destroy the seller's inventory history. Supporting indexes
back the common user-scoped queries.

---

## Modular architecture / interface boundaries

The four "AI / external" capabilities and their supporting seams are the heart
of PokeOps' design. Each is a **TypeScript interface** in
`src/services/interfaces/`, and the app (routes, API, views) depends **only on
the interface**, never on a concrete client. The current implementations are
**deterministic mocks** in `src/services/mock/`, chosen because no external
service is reachable offline. A real implementation drops in behind the same
interface **without touching the UI, routes, or API**.

There are **six interfaces**:

### 1. `Recognizer` — `src/services/interfaces/recognizer.ts`
Turns an uploaded photo into structured `RecognitionResult[]` (card name,
number, set, rarity, holo, condition, confidence, matched catalog id). The
interface documents a replaceable pipeline: preprocess -> detect -> crop ->
OCR/visual match -> DB match -> confidence.
- **Mock:** `mock/mockRecognizer.ts` uses seeded pseudo-randomness keyed off the
  image reference and samples real seeded catalog cards, so scans are
  repeatable.
- **Real drop-in:** a **computer-vision model** implements `recognize()` using
  the raw `bytes`; the Scan UI and `/api/scan` never change.

### 2. `PricingEngine` — `src/services/interfaces/pricing.ts`
Provides `getMarketData(cardId)` and `priceCard(input, settings)` returning a
suggested price, estimated fees, shipping, and net. Enforces a mode-ordering
contract: `fast_sale <= balanced <= max_profit` for the same card.
- **Mock:** `mock/mockPricingEngine.ts` derives everything from seeded
  `price_snapshots` plus deterministic math.
- **Real drop-in:** a **real price feed** (eBay Terapeak, TCGplayer,
  PriceCharting) implements the same two methods; the Card Detail price panel,
  the Pricing dashboard, and the pricing JSON API are unchanged.

### 3. `ClassificationService` — `src/services/interfaces/classification.ts`
Decides `SELL_INDIVIDUALLY` / `BULK` / `REVIEW` using a **multi-factor score**
(value, net-after-fees, demand, competition, and the seller's own weights and
thresholds), not a single price cutoff.
- **Mock:** `mock/mockClassificationService.ts` is pure and deterministic.
- **Real drop-in:** an **ML classifier** with richer demand signals implements
  `classify()`; the UI consumes only the decision, score, and reason.

### 4. `ListingGenerator` — `src/services/interfaces/listingGenerator.ts`
Turns an inventory row into a marketplace-ready draft (SEO title, description,
condition, category, item specifics, price/shipping from the pricing engine,
generated SKU, quantity) via `buildDraft()` / `generateForInventory()`.
- **Mock/current:** `src/services/listingGenerator.ts` builds deterministic
  drafts.
- **Real drop-in:** an **LLM-assisted generator** (smarter titles/specifics)
  implements the same interface; routes, API, and preview UI are unchanged.

### 5. `MarketplacePublisher` — `src/services/interfaces/marketplace.ts`
Publishes and unpublishes listings on an external marketplace via
`publish()` / `unpublish()`, returning only an `externalId` + timestamp.
- **Mock:** `mock/mockMarketplacePublisher.ts` fabricates a stable,
  marketplace-prefixed fake id and does **zero network I/O** and holds **no
  credentials** (safe offline).
- **Real drop-in:** a **real eBay / TCGplayer / Whatnot API** client holds OAuth
  tokens **server-side** and calls the marketplace API. Credentials are never
  exposed to the frontend; the browser only ever sees the returned
  `externalId` / `publishedAt`.

### 6. `SellerAssistant` — `src/services/interfaces/sellerAssistant.ts`
Answers a seller's natural-language questions from their own data via
`ask(userId, question)`, returning an answer plus optional structured data and
follow-up suggestions.
- **Mock:** `mock/mockSellerAssistant.ts` parses intent from keywords and
  answers from **real aggregates** over the user's data (no canned text, no
  network).
- **Real drop-in:** an **LLM-backed assistant** implements `ask()` (translating
  questions into a plan over the same repositories/services); the dashboard
  question box and `POST /api/assistant` consume only the `AssistantAnswer`
  shape.

All six are re-exported from `src/services/interfaces/index.ts`, and the mock
package is documented in `src/services/mock/README.md`.

---

## Feature status matrix (P0 / P1 / P2)

Honest status against the actual code. **Implemented** = built and working with
real UI + data. **Stubbed behind interface** = the seam exists and is exercised
by a deterministic mock (a real external service is out of scope offline).

### P0 — core (items 1–12): all implemented

| # | Feature | Status |
| - | ------- | ------ |
| 1 | Multi-user accounts, auth, per-user data isolation | Implemented (scrypt auth, session cookies, `user_id`-scoped repos) |
| 2 | Inventory core (add/edit, condition, qty, cost, status, SKU) | Implemented |
| 3 | Catalog of sets + cards (game-agnostic) | Implemented (seeded) |
| 4 | Card scanning / recognition | Implemented (UI + pipeline) behind the `Recognizer` interface (mock recognizer) |
| 5 | Market pricing display + history | Implemented behind `PricingEngine` (mock from seeded snapshots) |
| 6 | Pricing modes (fast_sale / balanced / max_profit) | Implemented (mode-ordering contract enforced + tested) |
| 7 | Single-vs-bulk classification | Implemented behind `ClassificationService` (multi-factor mock) |
| 8 | Listing generation (title, description, specifics, SKU) | Implemented behind `ListingGenerator` |
| 9 | Marketplace publish / unpublish | Implemented behind `MarketplacePublisher` (mock, no network) |
| 10 | Bulk lot management + bulk listing generator with guarantees | Implemented |
| 11 | Storage locations | Implemented |
| 12 | Order management + fulfillment lifecycle | Implemented (New -> Picking -> Packed -> Shipped -> Delivered) |

### P1 — high value (items 13–20): implemented where done

| # | Feature | Status |
| - | ------- | ------ |
| 13 | Profit tracking (cost basis, fees, shipping, net) | Implemented |
| 14 | Analytics dashboard with charts | Implemented (hand-drawn SVG charts) |
| 15 | Dashboard command center / KPIs | Implemented |
| 16 | Attention / "needs review" surfacing | Implemented |
| 17 | Expenses tracking | Implemented |
| 18 | Pack/box rip tracking (cost vs. pulled value vs. profit) | Implemented |
| 19 | CSV import / export | Implemented |
| 20 | Seller assistant (natural-language Q&A over your data) | Implemented behind `SellerAssistant` (mock over real aggregates) |

### P2 — future / advanced (items 21–27): stubbed behind interfaces or not built

| # | Feature | Status |
| - | ------- | ------ |
| 21 | Real computer-vision recognition | Stubbed behind `Recognizer` (real CV model out of scope offline) |
| 22 | Real live price feed (Terapeak/TCGplayer) | Stubbed behind `PricingEngine` (real feed out of scope offline) |
| 23 | Real marketplace API publishing (eBay etc.) | Stubbed behind `MarketplacePublisher` (real API out of scope offline) |
| 24 | Real LLM-backed assistant | Stubbed behind `SellerAssistant` (real LLM out of scope offline) |
| 25 | Multi-game support beyond Pokemon | Partial: schema/domain are game-agnostic (`game` field); only `pokemon` seeded |
| 26 | Persistent / shared session store | Not built (sessions are in-memory; see limitations) |
| 27 | Grading / consignment integrations | Not built |

---

## Demo data

`npm run seed` populates a large, realistic Pokemon TCG dataset (defined in
`src/scripts/seed.ts`) so the app is never empty: 10 Scarlet & Violet-era sets,
~135 catalog cards (including marquee chase cards like Charizard ex and Mewtwo
ex), price-snapshot history, storage locations, a mix of single and bulk
inventory, listings, orders across the fulfillment lifecycle, realized sales,
expenses, and pack/rip logs.

Every user-owned demo row is flagged **`is_demo = 1`** and is clearly labeled in
the UI. Seeding is **idempotent**: re-running clears the demo user's existing
demo-flagged rows and re-inserts reference data with deterministic ids, so a
second run never duplicates anything.

---

## Security notes

- **Passwords** are hashed with **scrypt + a per-user random salt**
  (`src/util/password.ts`, using `node:crypto`). Verification uses a
  constant-time comparison (`timingSafeEqual`). Plaintext passwords are never
  stored.
- **Sessions** are cookie-based (`pokeops_sid`, name configurable). The server
  resolves the session on every request and scopes all data access by the
  authenticated `user_id`.
- **No marketplace credentials in the frontend.** Publishing is entirely behind
  the `MarketplacePublisher` interface; the mock does no network I/O and holds
  no credentials. A real integration would keep OAuth tokens server-side, and
  the browser would only ever see a returned `externalId` / timestamp.
- Per-user data isolation is enforced at the repository layer via `user_id`
  scoping.

---

## Known limitations and future work

- **Real external integrations are out of scope offline.** Recognition, live
  pricing, marketplace publishing, and the assistant are deterministic mocks
  behind their interfaces because the sandbox has no network access. Each is
  designed to be replaced by a real implementation without UI changes.
- **In-memory session store.** Sessions live in process memory
  (`src/util/session.ts`), so restarting the server logs users out and the app
  does not yet scale horizontally. A persistent/shared store is future work.
- **`node:sqlite` is experimental** in Node.js 22 and emits an
  `ExperimentalWarning` (suppressed via `--no-warnings` in the npm scripts). It
  may change in future Node releases.
- **`NODE_OPTIONS` must be unset** in this environment before any node/npm/tsc
  command (see the caveat above).
- **Single-game seed.** The schema and domain layer are game-agnostic, but only
  Pokemon data is seeded today.
