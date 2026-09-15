import { getDb } from '../db/connection.js';
import {
  settingsService,
  BULK_CATEGORIES,
  BULK_CATEGORY_LABELS,
  type BulkCategory,
} from './settings.js';

/**
 * Bulk management service (FEAT-006, sections 11, 12).
 *
 * Two responsibilities:
 *  1. {@link getBulkSummary} aggregates a user's bulk holdings into the
 *     canonical bulk categories (section 11), pulling from BOTH the itemized
 *     `inventory` rows classified as bulk AND the `inventory_lots` aggregate
 *     pools, returning a count + estimated value per category.
 *  2. {@link generateLots} proposes a packaging plan (section 12): given an
 *     available bulk count it greedily packs the cards into the requested (or
 *     default) lot sizes, e.g. 3,142 commons -> 30x100 + 6x250 + 3x500,
 *     returning editable draft lots with a suggested price each.
 *
 * All queries are user-scoped.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** One category's rolled-up bulk holdings. */
export interface BulkCategorySummary {
  category: BulkCategory;
  label: string;
  count: number;
  estimatedValue: number;
  /** Whether the seller has this category surfaced on the Bulk page. */
  included: boolean;
}

export interface BulkSummary {
  categories: BulkCategorySummary[];
  totalCount: number;
  totalValue: number;
}

/**
 * Classify an itemized bulk inventory row into a bulk category from its rarity
 * + holo flags. Pure; used both by the summary aggregation and by tests.
 */
export function categoryForCard(input: {
  rarity: string | null | undefined;
  card_type: string | null | undefined;
  is_holo: number | boolean | null | undefined;
  is_reverse_holo: number | boolean | null | undefined;
}): BulkCategory {
  const rarity = (input.rarity ?? '').trim().toLowerCase();
  const type = (input.card_type ?? '').trim().toLowerCase();
  const holo = input.is_holo === 1 || input.is_holo === true;
  const reverse = input.is_reverse_holo === 1 || input.is_reverse_holo === true;

  if (type === 'energy' || rarity.includes('energy')) return 'energy';
  if (reverse || rarity.includes('reverse')) return 'reverse_holos';
  if (holo || rarity.includes('holo')) return 'holos';
  if (rarity === 'common') return 'commons';
  if (rarity === 'uncommon') return 'uncommons';
  if (rarity.includes('rare')) return 'regular_rares';
  return 'mixed_bulk';
}

/**
 * Map an inventory_lot's free-text category onto a canonical bulk category.
 * Aggregate lots are seeded with human labels ("Bulk commons/uncommons",
 * "Energy cards", "Reverse holo bulk"), so we keyword-match.
 */
export function categoryForLotLabel(label: string | null | undefined): BulkCategory {
  const l = (label ?? '').trim().toLowerCase();
  if (!l) return 'mixed_bulk';
  if (l.includes('energy')) return 'energy';
  if (l.includes('reverse')) return 'reverse_holos';
  if (l.includes('holo')) return 'holos';
  if (l.includes('playable')) return 'playable_bulk';
  if (l.includes('rare')) return 'regular_rares';
  if (l.includes('uncommon') && !l.includes('common')) return 'uncommons';
  if (l.includes('common')) return 'commons';
  return 'mixed_bulk';
}

interface Accumulator {
  count: number;
  value: number;
}

/** A proposed lot in a packaging plan (draft, editable before commit). */
export interface ProposedLot {
  category: BulkCategory;
  cardCount: number;
  suggestedPrice: number;
}

export interface LotPlan {
  category: BulkCategory;
  label: string;
  available: number;
  allocated: number;
  remainder: number;
  lotSizes: number[];
  lots: ProposedLot[];
  perCardRate: number;
}

export interface GenerateLotsOptions {
  category: BulkCategory;
  /** Lot sizes to pack into; defaults to the user's configured sizes. */
  lotSizes?: number[];
  /**
   * Cap the number of cards to allocate (defaults to all available). Lets the
   * seller pack only part of a pool.
   */
  targetCount?: number;
}

export const bulkService = {
  /**
   * Aggregate a user's bulk holdings by category (section 11). Combines the
   * itemized bulk `inventory` rows (classified 'bulk' OR status 'Bulk') with
   * the `inventory_lots` aggregate pools.
   */
  getBulkSummary(userId: string): BulkSummary {
    const db = getDb();
    const settings = settingsService.getBulkSettings(userId);

    const acc = new Map<BulkCategory, Accumulator>();
    for (const c of BULK_CATEGORIES) acc.set(c, { count: 0, value: 0 });

    // 1) Itemized bulk inventory rows.
    const invRows = db
      .prepare(
        `SELECT i.quantity AS quantity,
                COALESCE(i.market_value, 0) AS market_value,
                c.rarity AS rarity,
                c.card_type AS card_type,
                c.is_holo AS is_holo,
                c.is_reverse_holo AS is_reverse_holo
         FROM inventory i
         LEFT JOIN cards c ON c.id = i.card_id
         WHERE i.user_id = ?
           AND (LOWER(i.classification) = 'bulk' OR LOWER(i.status) = 'bulk')`,
      )
      .all(userId) as Array<{
      quantity: number;
      market_value: number;
      rarity: string | null;
      card_type: string | null;
      is_holo: number | null;
      is_reverse_holo: number | null;
    }>;

    for (const row of invRows) {
      const cat = categoryForCard(row);
      const a = acc.get(cat)!;
      a.count += row.quantity;
      a.value += row.market_value * row.quantity;
    }

    // 2) Aggregate inventory_lot pools.
    const lotRows = db
      .prepare('SELECT category, quantity, estimated_value FROM inventory_lots WHERE user_id = ?')
      .all(userId) as Array<{ category: string | null; quantity: number; estimated_value: number | null }>;

    for (const lot of lotRows) {
      const cat = categoryForLotLabel(lot.category);
      const a = acc.get(cat)!;
      a.count += lot.quantity;
      a.value += lot.estimated_value ?? 0;
    }

    const categories: BulkCategorySummary[] = BULK_CATEGORIES.map((category) => {
      const a = acc.get(category)!;
      return {
        category,
        label: BULK_CATEGORY_LABELS[category],
        count: a.count,
        estimatedValue: round2(a.value),
        included: settings.includedCategories.includes(category),
      };
    });

    const totalCount = categories.reduce((s, c) => s + c.count, 0);
    const totalValue = round2(categories.reduce((s, c) => s + c.estimatedValue, 0));

    return { categories, totalCount, totalValue };
  },

  /** The number of cards available to package for a given category. */
  availableForCategory(userId: string, category: BulkCategory): number {
    const summary = this.getBulkSummary(userId);
    const match = summary.categories.find((c) => c.category === category);
    return match ? match.count : 0;
  },

  /**
   * Propose a packaging plan (section 12). Greedily fills the requested/default
   * lot sizes largest-first from the available pool, e.g. 3,142 commons packs
   * into 6x500 + 0x250 + 1x100 (then a 142-card remainder) when sizes are
   * [500,250,100]. Every proposed lot's card count is one of the requested
   * sizes and the total allocated never exceeds the available count. The
   * returned lots are drafts; quantities can be edited before commit.
   */
  generateLots(userId: string, opts: GenerateLotsOptions): LotPlan {
    const settings = settingsService.getBulkSettings(userId);
    const available = this.availableForCategory(userId, opts.category);

    // Normalize + sort the lot sizes descending, de-duplicated.
    const rawSizes = (opts.lotSizes && opts.lotSizes.length ? opts.lotSizes : settings.defaultLotSizes)
      .map((n) => Math.floor(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0);
    const lotSizes = Array.from(new Set(rawSizes)).sort((a, b) => b - a);

    const target =
      typeof opts.targetCount === 'number' && Number.isFinite(opts.targetCount)
        ? Math.max(0, Math.min(Math.floor(opts.targetCount), available))
        : available;

    const perCardRate = settings.perCardRate;
    const lots: ProposedLot[] = [];
    let remaining = target;

    if (lotSizes.length > 0) {
      for (const size of lotSizes) {
        const nLots = Math.floor(remaining / size);
        for (let i = 0; i < nLots; i++) {
          lots.push({
            category: opts.category,
            cardCount: size,
            suggestedPrice: round2(size * perCardRate),
          });
        }
        remaining -= nLots * size;
      }
    }

    const allocated = target - remaining;

    return {
      category: opts.category,
      label: BULK_CATEGORY_LABELS[opts.category],
      available,
      allocated,
      remainder: available - allocated,
      lotSizes,
      lots,
      perCardRate,
    };
  },

  /** Suggested price for an arbitrary card count using the per-card rate. */
  suggestedPriceFor(userId: string, cardCount: number): number {
    const settings = settingsService.getBulkSettings(userId);
    return round2(Math.max(0, cardCount) * settings.perCardRate);
  },
};
