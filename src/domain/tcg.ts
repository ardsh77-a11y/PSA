/**
 * TCG-agnostic strategy layer (section 47).
 *
 * PokeOps is designed to eventually support multiple trading card games. All
 * game-specific formatting and knowledge (how to render a card title, how to
 * rank rarities, which conditions/grades are valid, what SKU code identifies
 * the game) is isolated behind the {@link GameStrategy} interface. The rest of
 * the app talks to a strategy, never to Pokemon-specific literals.
 *
 * Cards and Sets carry a `game` field ('pokemon' for now). `strategyFor(game)`
 * returns the matching strategy, defaulting to Pokemon.
 */

export type GameId = 'pokemon';

/** The minimal shape a strategy needs to format a card title. */
export interface CardLike {
  name: string;
  pokemon_name?: string | null;
  number?: string | null;
  rarity?: string | null;
  is_holo?: number | boolean | null;
  is_reverse_holo?: number | boolean | null;
  set_name?: string | null;
  set_abbreviation?: string | null;
}

export interface GameStrategy {
  readonly game: GameId;
  /** Human display label for the game. */
  readonly label: string;
  /** Build a canonical, human-readable card title. */
  formatCardTitle(card: CardLike): string;
  /** Numeric rank for a rarity (higher = rarer). Unknown rarities rank 0. */
  rarityRank(rarity: string | null | undefined): number;
  /** Ordered list of valid condition codes for this game. */
  conditionOptions(): ConditionOption[];
  /** The short code used in generated SKUs to identify this game. */
  readonly skuGameCode: string;
}

export interface ConditionOption {
  code: string;
  label: string;
}

/** Shared condition grades used by Pokemon (and most TCGs). */
const POKEMON_CONDITIONS: ConditionOption[] = [
  { code: 'M', label: 'Mint' },
  { code: 'NM', label: 'Near Mint' },
  { code: 'LP', label: 'Lightly Played' },
  { code: 'MP', label: 'Moderately Played' },
  { code: 'HP', label: 'Heavily Played' },
  { code: 'DMG', label: 'Damaged' },
  { code: 'GRADED', label: 'Graded' },
];

/**
 * Rarity ordering from bulk commons up to chase cards. The ranks are used for
 * sorting and for classifying single-vs-bulk later.
 */
const POKEMON_RARITY_RANK: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  'rare holo': 4,
  'reverse holo': 4,
  'holo rare': 4,
  'double rare': 5,
  'ultra rare': 6,
  'full art': 7,
  'illustration rare': 8,
  'special illustration rare': 9,
  'hyper rare': 9,
  'secret rare': 9,
  'gold rare': 9,
  promo: 3,
};

export const pokemonStrategy: GameStrategy = {
  game: 'pokemon',
  label: 'Pokémon TCG',
  skuGameCode: 'PKM',

  formatCardTitle(card: CardLike): string {
    const parts: string[] = [card.name];
    if (card.number) {
      const total = card.set_abbreviation ? '' : '';
      parts.push(card.number + total);
    }
    if (card.set_name) {
      parts.push(card.set_name);
    } else if (card.set_abbreviation) {
      parts.push(card.set_abbreviation);
    }
    if (card.is_reverse_holo) parts.push('Reverse Holo');
    else if (card.is_holo) parts.push('Holo');
    if (card.rarity) parts.push(card.rarity);
    return parts.filter(Boolean).join(' · ');
  },

  rarityRank(rarity: string | null | undefined): number {
    if (!rarity) return 0;
    return POKEMON_RARITY_RANK[rarity.trim().toLowerCase()] ?? 0;
  },

  conditionOptions(): ConditionOption[] {
    return POKEMON_CONDITIONS.slice();
  },
};

const STRATEGIES: Record<GameId, GameStrategy> = {
  pokemon: pokemonStrategy,
};

/** Return the strategy for a game id, defaulting to Pokemon. */
export function strategyFor(game: string | null | undefined): GameStrategy {
  if (game && game in STRATEGIES) return STRATEGIES[game as GameId];
  return pokemonStrategy;
}

/** Inventory statuses used across the app (section 9). */
export const INVENTORY_STATUSES = [
  'Unprocessed',
  'Identified',
  'Reviewed',
  'Ready to List',
  'Listed',
  'Sold',
] as const;

export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

/** Map a status to a badge tone for the UI. */
export function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'Sold':
      return 'success';
    case 'Listed':
      return 'info';
    case 'Ready to List':
      return 'warning';
    default:
      return 'neutral';
  }
}
