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
  /**
   * Build a search-optimized marketplace listing title (section 17). Unlike
   * {@link formatCardTitle} (which uses `·` separators for the UI), this returns
   * a space-separated, buyer-searchable title with NO duplicated keywords, e.g.
   * `Charizard ex 125/197 Obsidian Flames Ultra Rare Pokemon TCG NM`.
   */
  formatListingTitle(card: CardLike, condition?: string | null): string;
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

  formatListingTitle(card: CardLike, condition?: string | null): string {
    // Section-17 target:
    //   Charizard ex 125/197 Obsidian Flames Ultra Rare Pokemon TCG NM
    // Search-optimized, space separated, and DE-DUPLICATED: no token (word)
    // is repeated, so we never keyword-stuff.
    const parts: string[] = [];
    const push = (value: string | null | undefined) => {
      if (value && value.trim()) parts.push(value.trim());
    };

    push(card.name);
    push(card.number);
    push(card.set_name ?? card.set_abbreviation);
    if (card.is_reverse_holo) push('Reverse Holo');
    else if (card.is_holo) push('Holo');
    push(card.rarity);
    push('Pokemon TCG');
    // Condition code (e.g. NM) is a valuable, searched keyword.
    push(condition ?? undefined);

    // De-duplicate individual words case-insensitively while preserving order,
    // so a card named "Pikachu" in the "Pikachu" set never stutters and the
    // trailing "Pokemon TCG" never repeats a word already in the name.
    const seen = new Set<string>();
    const words: string[] = [];
    for (const word of parts.join(' ').split(/\s+/)) {
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
    }
    return words.join(' ');
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

/** Human label for a condition code (e.g. 'NM' -> 'Near Mint'), else the code. */
export function conditionLabel(code: string | null | undefined, game?: string | null): string {
  if (!code) return '';
  const match = strategyFor(game).conditionOptions().find((c) => c.code === code);
  return match ? match.label : code;
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
