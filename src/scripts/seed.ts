/**
 * Demo seed. Creates a demo user and a large, realistic Pokemon TCG dataset so
 * the app is never empty. Every user-owned demo row is flagged is_demo=1 and is
 * clearly labeled in the UI.
 *
 * Idempotent: re-running clears the demo user's existing demo-flagged rows and
 * re-inserts sets/cards with INSERT OR IGNORE keyed by deterministic ids, so a
 * second run does not duplicate anything. Prints a summary + the demo login.
 *
 * Run with: `npm run seed` (after `npm run build`).
 */
import { getDb, closeDb } from '../db/connection.js';
import { userRepository } from '../repositories/userRepository.js';
import { setsRepository } from '../repositories/setsRepository.js';
import { cardsRepository } from '../repositories/cardsRepository.js';
import { storageLocationsRepository } from '../repositories/storageLocationsRepository.js';
import { priceSnapshotsRepository } from '../repositories/priceSnapshotsRepository.js';
import { inventoryRepository } from '../repositories/inventoryRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { ordersRepository } from '../repositories/ordersRepository.js';
import { salesRepository } from '../repositories/salesRepository.js';

export const DEMO_EMAIL = 'demo@pokeops.local';
export const DEMO_PASSWORD = 'pokeops-demo';
export const DEMO_NAME = 'Demo Seller';

/** Tiny deterministic PRNG (mulberry32) so seeding is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface SetSeed {
  id: string;
  name: string;
  abbreviation: string;
  series: string;
  release_date: string;
  total_cards: number;
}

const SETS: SetSeed[] = [
  { id: 'set-svi', name: 'Scarlet & Violet Base', abbreviation: 'SVI', series: 'Scarlet & Violet', release_date: '2023-03-31', total_cards: 198 },
  { id: 'set-pal', name: 'Paldea Evolved', abbreviation: 'PAL', series: 'Scarlet & Violet', release_date: '2023-06-09', total_cards: 279 },
  { id: 'set-obf', name: 'Obsidian Flames', abbreviation: 'OBF', series: 'Scarlet & Violet', release_date: '2023-08-11', total_cards: 197 },
  { id: 'set-mew', name: '151', abbreviation: 'MEW', series: 'Scarlet & Violet', release_date: '2023-09-22', total_cards: 165 },
  { id: 'set-par', name: 'Paradox Rift', abbreviation: 'PAR', series: 'Scarlet & Violet', release_date: '2023-11-03', total_cards: 182 },
  { id: 'set-paf', name: 'Paldean Fates', abbreviation: 'PAF', series: 'Scarlet & Violet', release_date: '2024-01-26', total_cards: 245 },
  { id: 'set-tef', name: 'Temporal Forces', abbreviation: 'TEF', series: 'Scarlet & Violet', release_date: '2024-03-22', total_cards: 162 },
  { id: 'set-twm', name: 'Twilight Masquerade', abbreviation: 'TWM', series: 'Scarlet & Violet', release_date: '2024-05-24', total_cards: 167 },
  { id: 'set-sfa', name: 'Shrouded Fable', abbreviation: 'SFA', series: 'Scarlet & Violet', release_date: '2024-08-02', total_cards: 99 },
  { id: 'set-scr', name: 'Stellar Crown', abbreviation: 'SCR', series: 'Scarlet & Violet', release_date: '2024-09-13', total_cards: 142 },
];

const POKEMON = [
  'Pikachu', 'Charizard', 'Bulbasaur', 'Squirtle', 'Gengar', 'Snorlax', 'Mewtwo', 'Gardevoir',
  'Greninja', 'Lucario', 'Sylveon', 'Umbreon', 'Tinkaton', 'Miraidon', 'Koraidon', 'Chien-Pao',
  'Roaring Moon', 'Iron Valiant', 'Meowscarada', 'Skeledirge', 'Quaquaval', 'Dragapult', 'Baxcalibur',
  'Charmander', 'Eevee', 'Jigglypuff', 'Machamp', 'Alakazam', 'Dragonite', 'Tyranitar', 'Metagross',
  'Garchomp', 'Rayquaza', 'Lugia', 'Ho-Oh', 'Arceus', 'Zacian', 'Zamazenta', 'Mimikyu', 'Grimmsnarl',
];

const TYPES = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'];

interface RarityTier {
  rarity: string;
  weight: number; // relative frequency in generation
  holo: boolean;
  reverse: boolean;
  valueMin: number;
  valueMax: number;
  classification: string;
}

const RARITY_TIERS: RarityTier[] = [
  { rarity: 'Common', weight: 40, holo: false, reverse: false, valueMin: 0.05, valueMax: 0.25, classification: 'bulk' },
  { rarity: 'Uncommon', weight: 24, holo: false, reverse: false, valueMin: 0.1, valueMax: 0.5, classification: 'bulk' },
  { rarity: 'Reverse Holo', weight: 12, holo: false, reverse: true, valueMin: 0.25, valueMax: 2, classification: 'single' },
  { rarity: 'Rare', weight: 10, holo: false, reverse: false, valueMin: 0.5, valueMax: 3, classification: 'single' },
  { rarity: 'Rare Holo', weight: 6, holo: true, reverse: false, valueMin: 1, valueMax: 8, classification: 'single' },
  { rarity: 'Double Rare', weight: 4, holo: true, reverse: false, valueMin: 2, valueMax: 20, classification: 'single' },
  { rarity: 'Ultra Rare', weight: 2, holo: true, reverse: false, valueMin: 8, valueMax: 60, classification: 'single' },
  { rarity: 'Illustration Rare', weight: 1.4, holo: true, reverse: false, valueMin: 10, valueMax: 90, classification: 'single' },
  { rarity: 'Special Illustration Rare', weight: 0.8, holo: true, reverse: false, valueMin: 30, valueMax: 200, classification: 'single' },
  { rarity: 'Hyper Rare', weight: 0.6, holo: true, reverse: false, valueMin: 25, valueMax: 150, classification: 'single' },
];

function weightedRarity(rng: () => number): RarityTier {
  const total = RARITY_TIERS.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of RARITY_TIERS) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return RARITY_TIERS[0];
}

const STATUSES = ['Unprocessed', 'Identified', 'Reviewed', 'Ready to List', 'Listed', 'Sold'];
const CONDITIONS = ['NM', 'NM', 'NM', 'LP', 'M', 'MP'];

interface GeneratedCard {
  id: string;
  name: string;
  pokemon_name: string;
  set_id: string;
  number: string;
  rarity: string;
  card_type: string;
  is_holo: boolean;
  is_reverse_holo: boolean;
  baseValue: number;
  classification: string;
}

/** Deterministically generate the card catalog. */
function generateCards(): GeneratedCard[] {
  const rng = makeRng(0xc0ffee);
  const cards: GeneratedCard[] = [];

  // A guaranteed named chase card required by the spec.
  cards.push({
    id: 'card-charizard-ex-obf-125',
    name: 'Charizard ex',
    pokemon_name: 'Charizard',
    set_id: 'set-obf',
    number: '125/197',
    rarity: 'Ultra Rare',
    card_type: 'Fire',
    is_holo: true,
    is_reverse_holo: false,
    baseValue: 42.0,
    classification: 'single',
  });

  // A few more marquee chase cards.
  const marquee: Array<Partial<GeneratedCard> & { id: string; name: string; pokemon_name: string; set_id: string; number: string; rarity: string; baseValue: number }> = [
    { id: 'card-mewtwo-ex-mew-150', name: 'Mewtwo ex', pokemon_name: 'Mewtwo', set_id: 'set-mew', number: '150/165', rarity: 'Special Illustration Rare', baseValue: 120, card_type: 'Psychic', is_holo: true },
    { id: 'card-pikachu-mew-173', name: 'Pikachu', pokemon_name: 'Pikachu', set_id: 'set-mew', number: '173/165', rarity: 'Illustration Rare', baseValue: 65, card_type: 'Lightning', is_holo: true },
    { id: 'card-gardevoir-ex-svi-245', name: 'Gardevoir ex', pokemon_name: 'Gardevoir', set_id: 'set-svi', number: '245/198', rarity: 'Special Illustration Rare', baseValue: 55, card_type: 'Psychic', is_holo: true },
    { id: 'card-miraidon-ex-svi-244', name: 'Miraidon ex', pokemon_name: 'Miraidon', set_id: 'set-svi', number: '244/198', rarity: 'Ultra Rare', baseValue: 22, card_type: 'Lightning', is_holo: true },
  ];
  for (const m of marquee) {
    cards.push({
      id: m.id,
      name: m.name,
      pokemon_name: m.pokemon_name,
      set_id: m.set_id,
      number: m.number,
      rarity: m.rarity,
      card_type: m.card_type ?? 'Colorless',
      is_holo: m.is_holo ?? true,
      is_reverse_holo: false,
      baseValue: m.baseValue,
      classification: 'single',
    });
  }

  // Bulk-generate the rest of the catalog across all sets.
  let counter = 1;
  for (const set of SETS) {
    const cardsInSet = 13; // 10 sets * ~13 = ~130 generated + marquee > 120 distinct
    for (let i = 0; i < cardsInSet; i++) {
      const tier = weightedRarity(rng);
      const poke = pick(rng, POKEMON);
      const suffix = tier.classification === 'single' && rng() > 0.6 ? ' ex' : '';
      const num = `${(i + 1) * 3 + 4}/${set.total_cards}`;
      const value = round2(tier.valueMin + rng() * (tier.valueMax - tier.valueMin));
      cards.push({
        id: `card-${set.abbreviation.toLowerCase()}-${counter++}`,
        name: `${poke}${suffix}`,
        pokemon_name: poke,
        set_id: set.id,
        number: num,
        rarity: tier.rarity,
        card_type: pick(rng, TYPES),
        is_holo: tier.holo,
        is_reverse_holo: tier.reverse,
        baseValue: value,
        classification: tier.classification,
      });
    }
  }
  return cards;
}

/** Remove all demo-flagged data for the demo user (idempotency). */
function clearDemoData(userId: string): void {
  const db = getDb();
  // Order matters for FKs: sales/order_items -> orders, listings, inventory.
  db.prepare('DELETE FROM sales WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM listings WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM inventory WHERE user_id = ? AND is_demo = 1').run(userId);
  db.prepare('DELETE FROM inventory_lots WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM expenses WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM storage_locations WHERE user_id = ?').run(userId);
}

export interface SeedSummary {
  sets: number;
  cards: number;
  priceSnapshots: number;
  storageLocations: number;
  inventory: number;
  inventoryLots: number;
  listings: number;
  orders: number;
  sales: number;
  expenses: number;
}

export function runSeed(): SeedSummary {
  getDb(); // ensures schema exists

  // 1) Demo user (idempotent).
  let user = userRepository.findByEmail(DEMO_EMAIL);
  if (!user) {
    user = userRepository.create({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: DEMO_NAME });
  }
  const userId = user.id;

  // 2) Reference data: sets + cards (shared, INSERT OR IGNORE by id).
  for (const s of SETS) setsRepository.upsertById(s);
  const cards = generateCards();
  for (const c of cards) {
    cardsRepository.upsertById({
      id: c.id,
      set_id: c.set_id,
      name: c.name,
      pokemon_name: c.pokemon_name,
      number: c.number,
      rarity: c.rarity,
      card_type: c.card_type,
      is_holo: c.is_holo,
      is_reverse_holo: c.is_reverse_holo,
    });
  }

  // 3) Price snapshots for valuable cards (idempotent: clear this card set first).
  const db = getDb();
  const valuable = cards.filter((c) => c.baseValue >= 3);
  const cardIds = valuable.map((c) => `'${c.id}'`).join(',');
  if (cardIds) {
    db.prepare(`DELETE FROM price_snapshots WHERE card_id IN (${cardIds})`).run();
  }
  const rng = makeRng(0x5eed);
  let priceSnapshotCount = 0;
  for (const c of valuable) {
    // Generate a short history (6 weekly points) trending around baseValue.
    for (let w = 6; w >= 0; w--) {
      const drift = 1 + (rng() - 0.5) * 0.18;
      const market = round2(c.baseValue * drift);
      const capturedAt = new Date(Date.now() - w * 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      priceSnapshotsRepository.create({
        card_id: c.id,
        source: 'mock-market',
        market_price: market,
        low: round2(market * 0.8),
        high: round2(market * 1.25),
        recent_sold_low: round2(market * 0.85),
        recent_sold_high: round2(market * 1.15),
        competition_count: Math.floor(rng() * 40) + 1,
        captured_at: capturedAt,
      });
      priceSnapshotCount++;
    }
  }

  // 4) Clear user-owned demo data, then rebuild.
  clearDemoData(userId);

  // 5) Storage locations.
  const locations = [
    { id: 'loc-box-a-2-14', box: 'BOX-A', shelf: '2', slot: '14', label: null },
    { id: 'loc-box-a-2-15', box: 'BOX-A', shelf: '2', slot: '15', label: null },
    { id: 'loc-box-b-1-3', box: 'BOX-B', shelf: '1', slot: '3', label: null },
    { id: 'loc-binder-holo', box: null, shelf: null, slot: null, label: 'Holo Binder' },
    { id: 'loc-graded-safe', box: null, shelf: null, slot: null, label: 'Graded Safe' },
  ];
  for (const l of locations) {
    storageLocationsRepository.upsertById({ id: l.id, user_id: userId, box: l.box, shelf: l.shelf, slot: l.slot, label: l.label });
  }

  // 6) Inventory: a realistic mix.
  const invRng = makeRng(0xa11ce);
  let inventoryCount = 0;
  const soldInventoryIds: Array<{ id: string; card: GeneratedCard; salePrice: number; cost: number }> = [];

  // Ensure every status appears at least once by cycling deterministically.
  let statusCycle = 0;

  for (const c of cards) {
    if (c.classification === 'bulk') {
      // High-quantity bulk rows to represent thousands of commons/uncommons.
      const qty = 50 + Math.floor(invRng() * 400);
      const id = `inv-${c.id}-bulk`;
      inventoryRepository.create({
        id,
        user_id: userId,
        card_id: c.id,
        condition: 'NM',
        quantity: qty,
        acquisition_cost: round2(c.baseValue * 0.4),
        market_value: c.baseValue,
        status: invRng() > 0.5 ? 'Unprocessed' : 'Identified',
        classification: 'bulk',
        storage_location_id: 'loc-box-b-1-3',
        is_demo: 1,
      });
      inventoryCount++;
      continue;
    }

    // Singles: create 1-3 copies across various statuses.
    const copies = 1 + Math.floor(invRng() * 3);
    for (let k = 0; k < copies; k++) {
      const status = STATUSES[statusCycle % STATUSES.length];
      statusCycle++;
      const condition = CONDITIONS[Math.floor(invRng() * CONDITIONS.length)];
      const marketValue = round2(c.baseValue * (0.9 + invRng() * 0.3));
      const cost = round2(marketValue * (0.3 + invRng() * 0.3));
      const id = `inv-${c.id}-${k}`;
      const location =
        c.baseValue >= 20 ? 'loc-graded-safe' : c.is_holo || c.is_reverse_holo ? 'loc-binder-holo' : 'loc-box-a-2-14';
      inventoryRepository.create({
        id,
        user_id: userId,
        card_id: c.id,
        condition,
        quantity: 1,
        acquisition_cost: cost,
        market_value: marketValue,
        target_price: round2(marketValue * 1.1),
        status,
        classification: 'single',
        storage_location_id: location,
        sku: `PKM-${c.set_id.replace('set-', '').toUpperCase()}-${inventoryCount + 1}`,
        is_demo: 1,
      });
      inventoryCount++;
      if (status === 'Sold') {
        soldInventoryIds.push({ id, card: c, salePrice: round2(marketValue * 1.05), cost });
      }
    }
  }

  // 7) Inventory lots (aggregate bulk).
  let inventoryLotCount = 0;
  const lots = [
    { id: 'lot-bulk-commons', category: 'Bulk commons/uncommons', quantity: 4200, estimated_value: 42.0, notes: 'Mixed SV-era bulk' },
    { id: 'lot-energy', category: 'Energy cards', quantity: 800, estimated_value: 8.0, notes: 'Basic energy' },
    { id: 'lot-reverse-bulk', category: 'Reverse holo bulk', quantity: 350, estimated_value: 70.0, notes: 'Assorted reverse holos' },
  ];
  for (const lot of lots) {
    db.prepare(
      'INSERT INTO inventory_lots (id, user_id, category, quantity, estimated_value, notes) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lot.id, userId, lot.category, lot.quantity, lot.estimated_value, lot.notes);
    inventoryLotCount++;
  }

  // 8) Listings for a handful of "Listed" singles.
  let listingCount = 0;
  const listedRows = db
    .prepare("SELECT id, card_id, market_value, sku, condition FROM inventory WHERE user_id = ? AND status = 'Listed' LIMIT 8")
    .all(userId) as Array<{ id: string; card_id: string; market_value: number; sku: string; condition: string }>;
  for (const r of listedRows) {
    const card = cards.find((c) => c.id === r.card_id);
    listingsRepository.create({
      id: `listing-${r.id}`,
      user_id: userId,
      inventory_id: r.id,
      marketplace: 'eBay',
      title: card ? `${card.name} ${card.number} ${card.rarity}` : 'Pokemon Card',
      description: 'Listed via PokeOps demo data.',
      price: round2((r.market_value ?? 1) * 1.1),
      condition: r.condition,
      sku: r.sku,
      quantity: 1,
      status: 'active',
      published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    listingCount++;
  }

  // 9) Orders + sales in various statuses.
  let orderCount = 0;
  let salesCount = 0;
  const orderStatuses = ['pending', 'paid', 'shipped', 'completed'];
  let si = 0;
  for (const sold of soldInventoryIds.slice(0, 12)) {
    const fees = round2(sold.salePrice * 0.13);
    const shipping = 1.25;
    const net = round2(sold.salePrice - fees - shipping);
    const order = ordersRepository.create({
      id: `order-${sold.id}`,
      user_id: userId,
      marketplace: 'eBay',
      external_order_id: `EBY-${1000 + si}`,
      buyer: `buyer${si}`,
      sale_price: sold.salePrice,
      fees,
      shipping,
      net_revenue: net,
      status: orderStatuses[si % orderStatuses.length],
    });
    db.prepare(
      'INSERT INTO order_items (id, order_id, inventory_id, card_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`oi-${sold.id}`, order.id, sold.id, sold.card.id, 1, sold.salePrice);
    orderCount++;

    salesRepository.create({
      id: `sale-${sold.id}`,
      user_id: userId,
      order_id: order.id,
      inventory_id: sold.id,
      card_id: sold.card.id,
      sale_price: sold.salePrice,
      fees,
      shipping,
      cost_basis: sold.cost,
      net_profit: round2(net - sold.cost),
      sold_at: new Date(Date.now() - si * 3 * 86400000).toISOString().slice(0, 19).replace('T', ' '),
    });
    salesCount++;
    si++;
  }

  // 10) Expenses.
  let expenseCount = 0;
  const expenses = [
    { id: 'exp-supplies-1', type: 'Supplies', description: 'Card sleeves & toploaders', amount: 34.99 },
    { id: 'exp-shipping-1', type: 'Shipping', description: 'Bubble mailers (100 ct)', amount: 22.5 },
    { id: 'exp-boxes-1', type: 'Product', description: 'Booster box - Obsidian Flames', amount: 119.0 },
    { id: 'exp-fees-1', type: 'Fees', description: 'Marketplace store subscription', amount: 21.95 },
  ];
  for (const e of expenses) {
    db.prepare(
      "INSERT INTO expenses (id, user_id, type, description, amount, incurred_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    ).run(e.id, userId, e.type, e.description, e.amount);
    expenseCount++;
  }

  return {
    sets: SETS.length,
    cards: cards.length,
    priceSnapshots: priceSnapshotCount,
    storageLocations: locations.length,
    inventory: inventoryCount,
    inventoryLots: inventoryLotCount,
    listings: listingCount,
    orders: orderCount,
    sales: salesCount,
    expenses: expenseCount,
  };
}

function main(): void {
  const summary = runSeed();
  console.log('PokeOps demo seed complete.');
  console.log('----------------------------------------');
  console.log(`  Sets ............... ${summary.sets}`);
  console.log(`  Cards .............. ${summary.cards}`);
  console.log(`  Price snapshots .... ${summary.priceSnapshots}`);
  console.log(`  Storage locations .. ${summary.storageLocations}`);
  console.log(`  Inventory rows ..... ${summary.inventory}`);
  console.log(`  Inventory lots ..... ${summary.inventoryLots}`);
  console.log(`  Listings ........... ${summary.listings}`);
  console.log(`  Orders ............. ${summary.orders}`);
  console.log(`  Sales .............. ${summary.sales}`);
  console.log(`  Expenses ........... ${summary.expenses}`);
  console.log('----------------------------------------');
  console.log(`  Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  closeDb();
}

// Only auto-run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('seed.js') || invokedPath.endsWith('seed.ts')) {
  main();
}
