import { inventoryRepository, type InventoryRow } from '../repositories/inventoryRepository.js';
import { listingsRepository } from '../repositories/listingsRepository.js';
import { mockPricingEngine } from './mock/mockPricingEngine.js';
import { skuGenerator } from './skuGenerator.js';
import { settingsService } from './settings.js';
import { strategyFor, conditionLabel } from '../domain/tcg.js';
import type { PricingEngine } from './interfaces/pricing.js';
import type {
  ListingGenerator,
  GeneratedListingDraft,
  GenerateOptions,
} from './interfaces/listingGenerator.js';

/**
 * In-process {@link ListingGenerator} (sections 17, 18).
 *
 * Builds a search-optimized listing from an inventory row using the TCG
 * strategy for the title, the {@link PricingEngine} for price + shipping, and
 * the SKU generator for the SKU. The pricing engine is injected (defaulting to
 * the mock) so pricing stays swap-safe.
 */

const CATEGORY = 'Pokemon TCG Individual Cards';

function boolish(v: number | boolean | null | undefined): boolean {
  return v === 1 || v === true;
}

/** Build the human-readable description from card details + condition. */
export function buildDescription(row: InventoryRow, conditionText: string): string {
  const lines: string[] = [];
  const name = row.card_name ?? 'Pokemon card';
  const setLine = [row.set_name, row.set_abbreviation ? `(${row.set_abbreviation})` : '', row.card_number]
    .filter(Boolean)
    .join(' ');
  lines.push(`${name}${setLine ? ` — ${setLine}` : ''}.`);
  if (row.rarity) lines.push(`Rarity: ${row.rarity}.`);
  const finish = boolish(row.is_reverse_holo) ? 'Reverse Holo' : boolish(row.is_holo) ? 'Holo' : 'Non-holo';
  lines.push(`Finish: ${finish}.`);
  lines.push(`Condition: ${conditionText}.`);
  lines.push('Card is stored in a penny sleeve and top loader.');
  lines.push('Ships within 1 business day with tracking. Bundled shipping available on multiple purchases.');
  return lines.join('\n');
}

/** Build the item-specifics map surfaced on the listing preview. */
export function buildItemSpecifics(row: InventoryRow): Record<string, string> {
  const specifics: Record<string, string> = {};
  if (row.set_name) specifics.Set = row.set_name;
  if (row.card_number) specifics.Number = row.card_number;
  if (row.rarity) specifics.Rarity = row.rarity;
  specifics.Language = 'English';
  specifics.Finish = boolish(row.is_reverse_holo) ? 'Reverse Holo' : boolish(row.is_holo) ? 'Holo' : 'Non-holo';
  if (row.card_type) specifics.Type = row.card_type;
  specifics.Game = strategyFor('pokemon').label;
  return specifics;
}

/** Factory so a caller can inject a different pricing engine (swap-safe). */
export function createListingGenerator(pricingEngine: PricingEngine = mockPricingEngine): ListingGenerator {
  function draftFrom(row: InventoryRow, userId: string, opts?: GenerateOptions): GeneratedListingDraft | null {
    if (!row.card_id) return null;

    const gen = settingsService.getGenerationSettings(userId);
    const pricingSettings = settingsService.getPricingSettings(userId);
    const mode = opts?.mode ?? gen.generationMode;
    const marketplace = opts?.marketplace ?? gen.defaultMarketplace;

    const strategy = strategyFor('pokemon');
    const title = strategy.formatListingTitle(
      {
        name: row.card_name ?? '',
        pokemon_name: row.pokemon_name,
        number: row.card_number,
        rarity: row.rarity,
        is_holo: row.is_holo,
        is_reverse_holo: row.is_reverse_holo,
        set_name: row.set_name,
        set_abbreviation: row.set_abbreviation,
      },
      row.condition,
    );

    const pricing = pricingEngine.priceCard(
      { cardId: row.card_id, condition: row.condition, mode },
      pricingSettings,
    );
    const price = pricing?.suggestedPrice ?? row.target_price ?? row.market_value ?? 0;
    const shippingCost = pricing?.estimatedShipping ?? pricingSettings.shippingCost;

    const conditionText = conditionLabel(row.condition) || row.condition;

    // Prefer an existing SKU; otherwise compute (but do not persist here).
    const sku =
      row.sku && row.sku.trim()
        ? row.sku
        : skuGenerator.generateForUser(
            userId,
            {
              game: 'pokemon',
              setAbbreviation: row.set_abbreviation,
              cardNumber: row.card_number,
              condition: row.condition,
            },
            gen.skuFormat,
          ).sku;

    return {
      inventoryId: row.id,
      marketplace,
      title,
      description: buildDescription(row, conditionText),
      condition: row.condition,
      category: CATEGORY,
      itemSpecifics: buildItemSpecifics(row),
      price,
      shippingCost,
      sku,
      quantity: row.quantity,
      mode,
    };
  }

  return {
    buildDraft(userId, inventoryId, opts): GeneratedListingDraft | null {
      const row = inventoryRepository.getById(userId, inventoryId);
      if (!row) return null;
      return draftFrom(row, userId, opts);
    },

    generateForInventory(userId, inventoryId, opts): string | null {
      const row = inventoryRepository.getById(userId, inventoryId);
      if (!row) return null;
      const draft = draftFrom(row, userId, opts);
      if (!draft) return null;

      // Ensure the inventory row carries the SKU we used, so the SKU is stable
      // and unique across inventory + listings (section 21).
      let sku = draft.sku;
      if (!row.sku || !row.sku.trim()) {
        const assigned = skuGenerator.assignToInventory(userId, inventoryId, settingsService.getGenerationSettings(userId).skuFormat);
        if (assigned) sku = assigned;
      }

      const listing = listingsRepository.create({
        user_id: userId,
        inventory_id: inventoryId,
        marketplace: draft.marketplace,
        title: draft.title,
        description: draft.description,
        price: draft.price,
        condition: draft.condition,
        sku,
        quantity: draft.quantity,
        item_specifics_json: JSON.stringify(draft.itemSpecifics),
        status: 'draft',
        shipping_cost: draft.shippingCost,
      });
      return listing.id;
    },
  };
}

/** Default generator wired to the mock pricing engine. */
export const listingGenerator: ListingGenerator = createListingGenerator();
