import { bulkLotsRepository, type BulkLot } from '../repositories/bulkLotsRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { skuGenerator } from './skuGenerator.js';
import { settingsService, BULK_CATEGORY_LABELS, type BulkCategory, type BulkGuarantees } from './settings.js';
import { strategyFor } from '../domain/tcg.js';

/**
 * Bulk listing generator (FEAT-006, sections 13, 14).
 *
 * Turns a {@link BulkLot} into a marketplace-ready listing draft, reusing the
 * FEAT-005 listings repository. The title follows the section-13 pattern
 * ("Pokemon TCG 500 Card Bulk Lot - English Commons Uncommons Rares Holos"),
 * the description is assembled from the lot contents PLUS the configured
 * guarantees rendered as bullet lines (section 14), the quantity equals the
 * lot's card_count, the price comes from the per-card bulk rate, and a bulk
 * SKU is assigned. The draft is editable before publish; publishing goes
 * through the same mock MarketplacePublisher as single listings.
 */

const CATEGORY = 'Pokemon TCG Bulk Lots';

/** The category keywords included in a section-13 title, in canonical order. */
const CATEGORY_TITLE_WORDS: Record<BulkCategory, string> = {
  commons: 'Commons',
  uncommons: 'Uncommons',
  regular_rares: 'Rares',
  holos: 'Holos',
  reverse_holos: 'Reverse Holos',
  energy: 'Energy',
  mixed_bulk: 'Mixed',
  playable_bulk: 'Playable',
};

/**
 * Which category keywords a lot's title advertises. A commons lot still tends
 * to include the lower tiers, so we advertise the lot's category plus the ones
 * commonly bundled beneath it, matching the section-13 example
 * (a commons lot -> "Commons Uncommons Rares Holos").
 */
function titleCategoryWords(category: BulkCategory): string[] {
  switch (category) {
    case 'commons':
      return ['Commons', 'Uncommons', 'Rares', 'Holos'];
    case 'uncommons':
      return ['Uncommons', 'Rares', 'Holos'];
    case 'regular_rares':
      return ['Rares', 'Holos'];
    case 'holos':
      return ['Holos'];
    case 'reverse_holos':
      return ['Reverse Holos'];
    case 'energy':
      return ['Energy'];
    case 'playable_bulk':
      return ['Playable', 'Commons', 'Uncommons'];
    case 'mixed_bulk':
    default:
      return ['Mixed', 'Commons', 'Uncommons', 'Rares', 'Holos'];
  }
}

/** Parse a lot's stored guarantees blob onto the defaults. */
export function parseGuarantees(json: string | null | undefined): BulkGuarantees {
  const base: BulkGuarantees = {
    minRares: 0,
    minHolos: 0,
    noEnergy: false,
    englishOnly: false,
    noDamaged: false,
    noDuplicates: false,
    mixedSets: false,
  };
  if (!json) return base;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      const g = parsed as Record<string, unknown>;
      return {
        minRares: Math.max(0, Math.floor(Number(g.minRares) || 0)),
        minHolos: Math.max(0, Math.floor(Number(g.minHolos) || 0)),
        noEnergy: Boolean(g.noEnergy),
        englishOnly: Boolean(g.englishOnly),
        noDamaged: Boolean(g.noDamaged),
        noDuplicates: Boolean(g.noDuplicates),
        mixedSets: Boolean(g.mixedSets),
      };
    }
  } catch {
    /* ignore */
  }
  return base;
}

/**
 * Render the configured guarantees as description bullet lines (section 14).
 * Only active guarantees appear. Exported for testing.
 */
export function guaranteeLines(g: BulkGuarantees): string[] {
  const lines: string[] = [];
  if (g.minRares > 0) lines.push(`Minimum ${g.minRares} rare${g.minRares === 1 ? '' : 's'} guaranteed`);
  if (g.minHolos > 0) lines.push(`Minimum ${g.minHolos} holo${g.minHolos === 1 ? '' : 's'} guaranteed`);
  if (g.noEnergy) lines.push('No energy cards');
  if (g.englishOnly) lines.push('English only');
  if (g.noDamaged) lines.push('No damaged cards');
  if (g.noDuplicates) lines.push('No duplicates');
  if (g.mixedSets) lines.push('Cards from a mix of sets');
  return lines;
}

/**
 * Build the section-13 bulk lot title, e.g.
 * "Pokemon TCG 500 Card Bulk Lot - English Commons Uncommons Rares Holos".
 * Exported for testing.
 */
export function buildBulkTitle(lot: { category: string | null; card_count: number; guarantees_json?: string | null }): string {
  const category = (lot.category ?? 'mixed_bulk') as BulkCategory;
  const g = parseGuarantees(lot.guarantees_json);
  const words = titleCategoryWords(category);
  const prefix = g.englishOnly ? 'English ' : '';
  return `Pokemon TCG ${lot.card_count} Card Bulk Lot - ${prefix}${words.join(' ')}`.trim();
}

/** Build the bulk lot description from contents + guarantees (section 14). */
export function buildBulkDescription(lot: {
  category: string | null;
  card_count: number;
  guarantees_json?: string | null;
}): string {
  const category = (lot.category ?? 'mixed_bulk') as BulkCategory;
  const label = BULK_CATEGORY_LABELS[category] ?? 'Mixed Bulk';
  const lines: string[] = [];
  lines.push(`${lot.card_count} card Pokemon TCG bulk lot (${label}).`);
  lines.push('');
  lines.push('Lot contents:');
  lines.push(`- ${lot.card_count} ${label.toLowerCase()} cards`);

  const guarantees = guaranteeLines(parseGuarantees(lot.guarantees_json));
  if (guarantees.length > 0) {
    lines.push('');
    lines.push('Guarantees:');
    for (const line of guarantees) lines.push(`- ${line}`);
  }

  lines.push('');
  lines.push('Cards are shipped securely. Bundled shipping available on multiple purchases.');
  return lines.join('\n');
}

/** Simple shipping recommendation scaling with the card count. */
export function recommendShipping(cardCount: number): number {
  if (cardCount >= 500) return 8.0;
  if (cardCount >= 250) return 5.0;
  if (cardCount >= 100) return 4.0;
  return 3.5;
}

export interface BulkListingDraft {
  bulkLotId: string;
  marketplace: string;
  title: string;
  description: string;
  category: string;
  quantity: number;
  price: number;
  shippingCost: number;
  sku: string;
  guarantees: BulkGuarantees;
}

export const bulkListingGenerator = {
  /** Build (but do not persist) a bulk listing draft for a lot. */
  buildDraft(userId: string, lot: BulkLot): BulkListingDraft {
    const gen = settingsService.getGenerationSettings(userId);
    const guarantees = parseGuarantees(lot.guarantees_json);

    const title = buildBulkTitle(lot);
    const description = buildBulkDescription(lot);
    const price =
      lot.suggested_price != null && lot.suggested_price > 0
        ? lot.suggested_price
        : bulkPriceFor(userId, lot.card_count);

    const sku = lot.sku && lot.sku.trim()
      ? lot.sku
      : skuGenerator.generateForBulkLot(userId, { category: lot.category, cardCount: lot.card_count }).sku;

    return {
      bulkLotId: lot.id,
      marketplace: gen.defaultMarketplace,
      title,
      description,
      category: CATEGORY,
      quantity: lot.card_count,
      price,
      shippingCost: recommendShipping(lot.card_count),
      sku,
      guarantees,
    };
  },

  /**
   * Build a draft AND persist it as a `draft` listing linked to the bulk lot.
   * Assigns a bulk SKU to the lot if it lacks one, marks the lot 'listed', and
   * returns the created listing id (or null if the lot is missing).
   */
  generateForLot(userId: string, bulkLotId: string): string | null {
    const lot = bulkLotsRepository.getById(userId, bulkLotId);
    if (!lot) return null;

    // Ensure the lot carries a stable, unique SKU.
    let sku = lot.sku && lot.sku.trim() ? lot.sku : '';
    if (!sku) {
      sku = skuGenerator.generateForBulkLot(userId, { category: lot.category, cardCount: lot.card_count }).sku;
    }

    const draft = this.buildDraft(userId, { ...lot, sku });
    const gen = settingsService.getGenerationSettings(userId);

    const specifics: Record<string, string> = {
      Game: strategyFor('pokemon').label,
      'Lot Size': String(lot.card_count),
      Type: 'Bulk Lot',
      Language: draft.guarantees.englishOnly ? 'English' : 'Mixed',
    };

    const listing = listingsRepository.create({
      user_id: userId,
      bulk_lot_id: lot.id,
      marketplace: draft.marketplace || gen.defaultMarketplace,
      title: draft.title,
      description: draft.description,
      price: draft.price,
      condition: null,
      sku,
      quantity: draft.quantity,
      item_specifics_json: JSON.stringify(specifics),
      status: 'draft',
      shipping_cost: draft.shippingCost,
    });

    // Persist the SKU + generated title/description back onto the lot and mark
    // it as listed so it is not re-packaged.
    bulkLotsRepository.update(userId, lot.id, {
      sku,
      title: draft.title,
      description: draft.description,
      suggested_price: draft.price,
      status: 'listed',
    });

    return listing.id;
  },
};

/** Suggested bulk price for a card count using the user's per-card rate. */
function bulkPriceFor(userId: string, cardCount: number): number {
  const settings = settingsService.getBulkSettings(userId);
  return Math.round(Math.max(0, cardCount) * settings.perCardRate * 100) / 100;
}
