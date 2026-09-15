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
};
