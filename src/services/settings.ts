import { getDb } from '../db/connection.js';
import { userRepository } from '../repositories/userRepository.js';

/**
 * Per-user pricing preferences (section 16). These drive both the
 * {@link PricingEngine} and the {@link ClassificationService}: fees/shipping
 * feed the net-profit math, the pricing mode nudges the suggested price up or
 * down, and the classifier weights/thresholds decide single-vs-bulk.
 *
 * Settings are persisted on the users row: `pricing_mode` in its own column and
 * everything else inside the `settings_json` blob, so adding a preference never
 * requires a migration.
 */

/** The three pricing strategies from section 16. */
export type PricingMode = 'fast_sale' | 'balanced' | 'max_profit';

export const PRICING_MODES: PricingMode[] = ['fast_sale', 'balanced', 'max_profit'];

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  fast_sale: 'Fast Sale',
  balanced: 'Balanced',
  max_profit: 'Maximum Profit',
};

/** Weights applied to the single-vs-bulk score factors (sum need not be 1). */
export interface ClassifierWeights {
  /** Weight on net profit after fees/shipping. */
  net: number;
  /** Weight on raw market value. */
  value: number;
  /** Weight on demand (recent sold volume, inverse competition). */
  demand: number;
  /** Weight on low competition. */
  competition: number;
}

export interface PricingSettings {
  pricingMode: PricingMode;
  /** Marketplace fee percentage as a fraction, e.g. 0.129 for 12.9%. */
  feePct: number;
  /** Fixed per-order fee in dollars, e.g. 0.30. */
  fixedFee: number;
  /** Default shipping cost the seller pays per order. */
  shippingCost: number;
  /** Packaging/materials cost per order. */
  packagingCost: number;
  /** Score at/above which a card is recommended to SELL_INDIVIDUALLY. */
  sellThreshold: number;
  /** Score at/below which a card is recommended for BULK. */
  bulkThreshold: number;
  /** Multi-factor scoring weights. */
  weights: ClassifierWeights;
  /**
   * A soft hint (dollars): cards whose expected net is at/below this are
   * strong bulk candidates. Feeds the score, not a hard cutoff.
   */
  bulkValueCutoff: number;
}

/**
 * Listing-generation preferences (FEAT-005). These drive the
 * {@link ListingGenerator} and {@link SkuGenerator}: the SKU format string, the
 * marketplace a new draft defaults to, and the pricing mode used when a listing
 * is generated. Persisted alongside pricing settings inside `settings_json`.
 */
export interface GenerationSettings {
  /**
   * SKU format template. Supported tokens: {game} {set} {number} {condition}
   * {seq}. Defaults to the section-22 example `{game}-{set}-{number}-{condition}-{seq}`.
   */
  skuFormat: string;
  /** Marketplace a newly generated draft targets (e.g. 'eBay'). */
  defaultMarketplace: string;
  /** Pricing mode used when generating listings (defaults to the pricing mode). */
  generationMode: PricingMode;
}

/**
 * Bulk-management preferences (FEAT-006, sections 11, 12, 14). These drive the
 * {@link ../services/bulkService.ts} and {@link ../services/bulkListingGenerator.ts}:
 * which bulk categories are surfaced on the Bulk page, the default lot sizes
 * the lot generator packs into, the per-card bulk rate used for suggested
 * pricing, and the default guarantees applied to a generated bulk listing.
 * Persisted alongside pricing/generation settings inside `settings_json`.
 */

/** The canonical bulk categories (section 11). Order is intentional. */
export const BULK_CATEGORIES = [
  'commons',
  'uncommons',
  'regular_rares',
  'holos',
  'reverse_holos',
  'energy',
  'mixed_bulk',
  'playable_bulk',
] as const;

export type BulkCategory = (typeof BULK_CATEGORIES)[number];

/** Human labels for each bulk category. */
export const BULK_CATEGORY_LABELS: Record<BulkCategory, string> = {
  commons: 'Commons',
  uncommons: 'Uncommons',
  regular_rares: 'Regular Rares',
  holos: 'Holos',
  reverse_holos: 'Reverse Holos',
  energy: 'Energy',
  mixed_bulk: 'Mixed Bulk',
  playable_bulk: 'Playable Bulk',
};

/** The lot guarantees a seller can attach to a bulk lot (section 14). */
export interface BulkGuarantees {
  /** Minimum number of rares guaranteed in the lot (0 = none). */
  minRares: number;
  /** Minimum number of holos guaranteed in the lot (0 = none). */
  minHolos: number;
  /** No energy cards included. */
  noEnergy: boolean;
  /** English cards only. */
  englishOnly: boolean;
  /** No damaged cards. */
  noDamaged: boolean;
  /** No duplicate cards. */
  noDuplicates: boolean;
  /** Cards drawn from a mix of sets. */
  mixedSets: boolean;
}

export interface BulkSettings {
  /** Which categories are surfaced/summarized on the Bulk page. */
  includedCategories: BulkCategory[];
  /** Default lot sizes the generator packs bulk into (section 12). */
  defaultLotSizes: number[];
  /** Per-card bulk rate (dollars) used to suggest a lot price. */
  perCardRate: number;
  /** Default guarantees applied when generating a lot listing. */
  guarantees: BulkGuarantees;
}

export const DEFAULT_BULK_GUARANTEES: BulkGuarantees = {
  minRares: 0,
  minHolos: 0,
  noEnergy: false,
  englishOnly: true,
  noDamaged: true,
  noDuplicates: false,
  mixedSets: false,
};

export const DEFAULT_BULK_SETTINGS: BulkSettings = {
  includedCategories: [...BULK_CATEGORIES],
  defaultLotSizes: [100, 250, 500],
  perCardRate: 0.03,
  guarantees: { ...DEFAULT_BULK_GUARANTEES },
};

/** Marketplaces the mock publisher understands (real ones plug in later). */
export const MARKETPLACES = ['eBay', 'TCGplayer', 'Whatnot', 'Mercari', 'Shopify'] as const;

export const DEFAULT_SKU_FORMAT = '{game}-{set}-{number}-{condition}-{seq}';

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  skuFormat: DEFAULT_SKU_FORMAT,
  defaultMarketplace: 'eBay',
  generationMode: 'balanced',
};

/** Sensible defaults (12.9% + $0.30, $1.00 shipping, $0.25 packaging). */
export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  pricingMode: 'balanced',
  feePct: 0.129,
  fixedFee: 0.3,
  shippingCost: 1.0,
  packagingCost: 0.25,
  sellThreshold: 55,
  bulkThreshold: 35,
  weights: { net: 1, value: 0.6, demand: 0.8, competition: 0.6 },
  bulkValueCutoff: 2.0,
};

function toModeFromColumn(raw: string | null | undefined): PricingMode | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === 'fast_sale' || v === 'fast' || v === 'fast sale') return 'fast_sale';
  if (v === 'max_profit' || v === 'maximum profit' || v === 'max') return 'max_profit';
  if (v === 'balanced') return 'balanced';
  return undefined;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * Merge a raw settings_json blob + pricing_mode column onto the defaults.
 * Pure and defensive: unknown or malformed values fall back to defaults.
 * Exported for testing so the pricing/classifier tests can build settings
 * without touching the database.
 */
export function parsePricingSettings(
  settingsJson: string | null | undefined,
  pricingModeColumn?: string | null,
): PricingSettings {
  let blob: Record<string, unknown> = {};
  if (settingsJson) {
    try {
      const parsed = JSON.parse(settingsJson);
      if (parsed && typeof parsed === 'object') blob = parsed as Record<string, unknown>;
    } catch {
      blob = {};
    }
  }
  const pricing = (blob.pricing && typeof blob.pricing === 'object' ? blob.pricing : {}) as Record<
    string,
    unknown
  >;
  const weightsRaw = (pricing.weights && typeof pricing.weights === 'object'
    ? pricing.weights
    : {}) as Record<string, unknown>;

  const d = DEFAULT_PRICING_SETTINGS;
  const mode =
    toModeFromColumn(pricingModeColumn) ??
    toModeFromColumn(typeof pricing.pricingMode === 'string' ? (pricing.pricingMode as string) : undefined) ??
    d.pricingMode;

  return {
    pricingMode: mode,
    feePct: num(pricing.feePct, d.feePct),
    fixedFee: num(pricing.fixedFee, d.fixedFee),
    shippingCost: num(pricing.shippingCost, d.shippingCost),
    packagingCost: num(pricing.packagingCost, d.packagingCost),
    sellThreshold: num(pricing.sellThreshold, d.sellThreshold),
    bulkThreshold: num(pricing.bulkThreshold, d.bulkThreshold),
    weights: {
      net: num(weightsRaw.net, d.weights.net),
      value: num(weightsRaw.value, d.weights.value),
      demand: num(weightsRaw.demand, d.weights.demand),
      competition: num(weightsRaw.competition, d.weights.competition),
    },
    bulkValueCutoff: num(pricing.bulkValueCutoff, d.bulkValueCutoff),
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

/**
 * Merge the `generation` slot of a settings_json blob onto the defaults. Pure
 * and defensive. `pricingModeColumn` supplies the fallback generation mode when
 * none is stored, so generation defaults to the user's pricing mode.
 */
export function parseGenerationSettings(
  settingsJson: string | null | undefined,
  pricingModeColumn?: string | null,
): GenerationSettings {
  let blob: Record<string, unknown> = {};
  if (settingsJson) {
    try {
      const parsed = JSON.parse(settingsJson);
      if (parsed && typeof parsed === 'object') blob = parsed as Record<string, unknown>;
    } catch {
      blob = {};
    }
  }
  const gen = (blob.generation && typeof blob.generation === 'object' ? blob.generation : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_GENERATION_SETTINGS;
  const mode =
    toModeFromColumn(typeof gen.generationMode === 'string' ? (gen.generationMode as string) : undefined) ??
    toModeFromColumn(pricingModeColumn) ??
    d.generationMode;
  const marketplace = str(gen.defaultMarketplace, d.defaultMarketplace);
  return {
    skuFormat: str(gen.skuFormat, d.skuFormat),
    defaultMarketplace: (MARKETPLACES as readonly string[]).includes(marketplace)
      ? marketplace
      : d.defaultMarketplace,
    generationMode: mode,
  };
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'on' || t === 'yes') return true;
    if (t === 'false' || t === '0' || t === 'off' || t === 'no' || t === '') return false;
  }
  return fallback;
}

/**
 * Merge the `bulk` slot of a settings_json blob onto the defaults. Pure and
 * defensive: unknown categories are dropped, malformed lot sizes fall back to
 * the default, and guarantee flags are coerced. Exported for testing.
 */
export function parseBulkSettings(settingsJson: string | null | undefined): BulkSettings {
  let blob: Record<string, unknown> = {};
  if (settingsJson) {
    try {
      const parsed = JSON.parse(settingsJson);
      if (parsed && typeof parsed === 'object') blob = parsed as Record<string, unknown>;
    } catch {
      blob = {};
    }
  }
  const bulk = (blob.bulk && typeof blob.bulk === 'object' ? blob.bulk : {}) as Record<string, unknown>;
  const d = DEFAULT_BULK_SETTINGS;

  let includedCategories: BulkCategory[] = [...d.includedCategories];
  if (Array.isArray(bulk.includedCategories)) {
    const filtered = bulk.includedCategories
      .map((c) => String(c))
      .filter((c): c is BulkCategory => (BULK_CATEGORIES as readonly string[]).includes(c));
    // Preserve canonical order regardless of stored order.
    includedCategories = BULK_CATEGORIES.filter((c) => filtered.includes(c));
  }

  let defaultLotSizes = [...d.defaultLotSizes];
  if (Array.isArray(bulk.defaultLotSizes)) {
    const sizes = bulk.defaultLotSizes
      .map((n) => Math.floor(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (sizes.length > 0) {
      // Descending, de-duplicated so the greedy packer prefers larger lots.
      defaultLotSizes = Array.from(new Set(sizes)).sort((a, b) => b - a);
    }
  }

  const guaranteesRaw = (bulk.guarantees && typeof bulk.guarantees === 'object'
    ? bulk.guarantees
    : {}) as Record<string, unknown>;
  const g = d.guarantees;

  return {
    includedCategories,
    defaultLotSizes,
    perCardRate: num(bulk.perCardRate, d.perCardRate),
    guarantees: {
      minRares: Math.max(0, Math.floor(num(guaranteesRaw.minRares, g.minRares))),
      minHolos: Math.max(0, Math.floor(num(guaranteesRaw.minHolos, g.minHolos))),
      noEnergy: bool(guaranteesRaw.noEnergy, g.noEnergy),
      englishOnly: bool(guaranteesRaw.englishOnly, g.englishOnly),
      noDamaged: bool(guaranteesRaw.noDamaged, g.noDamaged),
      noDuplicates: bool(guaranteesRaw.noDuplicates, g.noDuplicates),
      mixedSets: bool(guaranteesRaw.mixedSets, g.mixedSets),
    },
  };
}

/** Serialize bulk settings into the `bulk` slot of a settings_json blob. */
function serializeBulkSettings(existingJson: string | null | undefined, s: BulkSettings): string {
  let blob: Record<string, unknown> = {};
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object') blob = parsed as Record<string, unknown>;
    } catch {
      blob = {};
    }
  }
  blob.bulk = {
    includedCategories: s.includedCategories,
    defaultLotSizes: s.defaultLotSizes,
    perCardRate: s.perCardRate,
    guarantees: { ...s.guarantees },
  };
  return JSON.stringify(blob);
}

/** Serialize generation settings into the `generation` slot of a blob. */
function serializeGenerationSettings(existingJson: string | null | undefined, s: GenerationSettings): string {
  let blob: Record<string, unknown> = {};
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object') blob = parsed as Record<string, unknown>;
    } catch {
      blob = {};
    }
  }
  blob.generation = {
    skuFormat: s.skuFormat,
    defaultMarketplace: s.defaultMarketplace,
    generationMode: s.generationMode,
  };
  return JSON.stringify(blob);
}

/** Serialize pricing settings into the `pricing` slot of a settings_json blob. */
function serializePricingSettings(existingJson: string | null | undefined, s: PricingSettings): string {
  let blob: Record<string, unknown> = {};
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (parsed && typeof parsed === 'object') blob = parsed as Record<string, unknown>;
    } catch {
      blob = {};
    }
  }
  blob.pricing = {
    pricingMode: s.pricingMode,
    feePct: s.feePct,
    fixedFee: s.fixedFee,
    shippingCost: s.shippingCost,
    packagingCost: s.packagingCost,
    sellThreshold: s.sellThreshold,
    bulkThreshold: s.bulkThreshold,
    weights: { ...s.weights },
    bulkValueCutoff: s.bulkValueCutoff,
  };
  return JSON.stringify(blob);
}

/** Read/write per-user pricing settings. */
export const settingsService = {
  /** Load a user's pricing settings, falling back to defaults. */
  getPricingSettings(userId: string): PricingSettings {
    const user = userRepository.findById(userId);
    if (!user) return { ...DEFAULT_PRICING_SETTINGS };
    return parsePricingSettings(user.settings_json, user.pricing_mode);
  },

  /**
   * Persist a full pricing settings object for a user. Writes the pricing_mode
   * column (so existing code that reads it stays correct) and the settings_json
   * blob together.
   */
  savePricingSettings(userId: string, settings: PricingSettings): PricingSettings {
    const user = userRepository.findById(userId);
    if (!user) return { ...DEFAULT_PRICING_SETTINGS };
    const json = serializePricingSettings(user.settings_json, settings);
    getDb()
      .prepare('UPDATE users SET pricing_mode = ?, settings_json = ? WHERE id = ?')
      .run(settings.pricingMode, json, userId);
    return settings;
  },

  /** Update just the pricing mode (used by the quick mode-switcher). */
  setPricingMode(userId: string, mode: PricingMode): PricingSettings {
    const current = this.getPricingSettings(userId);
    return this.savePricingSettings(userId, { ...current, pricingMode: mode });
  },

  /** Load a user's listing-generation settings, falling back to defaults. */
  getGenerationSettings(userId: string): GenerationSettings {
    const user = userRepository.findById(userId);
    if (!user) return { ...DEFAULT_GENERATION_SETTINGS };
    return parseGenerationSettings(user.settings_json, user.pricing_mode);
  },

  /** Persist a user's listing-generation settings into the settings_json blob. */
  saveGenerationSettings(userId: string, settings: GenerationSettings): GenerationSettings {
    const user = userRepository.findById(userId);
    if (!user) return { ...DEFAULT_GENERATION_SETTINGS };
    const json = serializeGenerationSettings(user.settings_json, settings);
    getDb().prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(json, userId);
    return settings;
  },

  /** Load a user's bulk-management settings, falling back to defaults. */
  getBulkSettings(userId: string): BulkSettings {
    const user = userRepository.findById(userId);
    if (!user) return { ...DEFAULT_BULK_SETTINGS, guarantees: { ...DEFAULT_BULK_GUARANTEES } };
    return parseBulkSettings(user.settings_json);
  },

  /** Persist a user's bulk-management settings into the settings_json blob. */
  saveBulkSettings(userId: string, settings: BulkSettings): BulkSettings {
    const user = userRepository.findById(userId);
    if (!user) return { ...DEFAULT_BULK_SETTINGS, guarantees: { ...DEFAULT_BULK_GUARANTEES } };
    const json = serializeBulkSettings(user.settings_json, settings);
    getDb().prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(json, userId);
    return settings;
  },

  /** Update just which bulk categories are included (used by the config control). */
  setIncludedCategories(userId: string, categories: BulkCategory[]): BulkSettings {
    const current = this.getBulkSettings(userId);
    const included = BULK_CATEGORIES.filter((c) => categories.includes(c));
    return this.saveBulkSettings(userId, { ...current, includedCategories: included });
  },

  /** Update just the default guarantees for generated bulk lots. */
  setBulkGuarantees(userId: string, guarantees: BulkGuarantees): BulkSettings {
    const current = this.getBulkSettings(userId);
    return this.saveBulkSettings(userId, { ...current, guarantees });
  },
};
