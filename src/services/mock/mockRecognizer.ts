import { createHash } from 'node:crypto';
import { cardsRepository, type CardWithSet } from '../../repositories/cardsRepository.js';
import type {
  Recognizer,
  RecognitionResult,
  RecognizeInput,
} from '../interfaces/recognizer.js';

/**
 * Deterministic mock {@link Recognizer}.
 *
 * Everything is seeded from a stable hash of the image reference (its filename
 * / imageRef), so the same upload ALWAYS yields the same detections. That makes
 * the scan flow testable and demos reproducible. A real computer-vision model
 * would implement the same interface (see ../interfaces/recognizer.ts) reading
 * `input.bytes`; nothing upstream changes when it is swapped in.
 *
 * Behavior:
 *  - count: a filename hinting a number (e.g. "12cards.jpg") yields that many
 *    detections (clamped 1..24); otherwise a seeded 1..6.
 *  - identity: sampled from real seeded catalog cards (cards with price
 *    snapshots preferred) so results reference genuine rows.
 *  - confidence: a realistic spread — most high (0.90..0.99), some low
 *    (0.55..0.80). Detections below CONFIDENCE_THRESHOLD are meant to be
 *    flagged 'needs_review' by the scan service.
 */

/** Detections at or above this confidence are auto-confirmable. */
export const CONFIDENCE_THRESHOLD = 0.85;

const CONDITIONS = ['NM', 'NM', 'NM', 'LP', 'M', 'MP'];

/** Deterministic 32-bit seed from an arbitrary string via SHA-256. */
export function seedFromRef(imageRef: string): number {
  const hex = createHash('sha256').update(imageRef).digest('hex').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

/** mulberry32 PRNG — same generator the seed script uses, for consistency. */
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

/**
 * Determine how many cards to "detect". A filename hinting a count (a number
 * immediately followed by the word "card") wins; otherwise a seeded 1..6.
 */
export function detectionCount(imageRef: string, rng: () => number): number {
  const base = imageRef.split('/').pop() ?? imageRef;
  const hint = /(\d{1,3})\s*cards?/i.exec(base);
  if (hint) {
    const n = parseInt(hint[1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(24, n);
  }
  return 1 + Math.floor(rng() * 6);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Assign a confidence with a realistic spread. Roughly one in three detections
 * is "low" (0.55..0.80) to exercise the Needs Review UX; the rest are high
 * (0.90..0.99).
 */
function pickConfidence(rng: () => number): number {
  if (rng() < 0.34) {
    return round2(0.55 + rng() * 0.25); // 0.55..0.80 (below threshold)
  }
  return round2(0.9 + rng() * 0.09); // 0.90..0.99
}

function toResult(card: CardWithSet, confidence: number, condition: string, cropRef: string): RecognitionResult {
  return {
    pokemonName: card.pokemon_name,
    cardName: card.name,
    setName: card.set_name,
    setAbbreviation: card.set_abbreviation,
    cardNumber: card.number,
    rarity: card.rarity,
    cardType: card.card_type,
    language: card.language,
    isHolo: !!card.is_holo,
    isReverseHolo: !!card.is_reverse_holo,
    estimatedCondition: condition,
    confidence,
    matchedCardId: card.id,
    cropRef,
  };
}

export const mockRecognizer: Recognizer = {
  async recognize(input: RecognizeInput): Promise<RecognitionResult[]> {
    const rng = makeRng(seedFromRef(input.imageRef));
    const count = detectionCount(input.imageRef, rng);

    // Sample real seeded cards (snapshot-bearing first). If a set hint is
    // provided, restrict to that set when possible.
    let pool = cardsRepository.sampleCandidates(200);
    if (input.hints?.setId) {
      const filtered = pool.filter((c) => c.set_id === input.hints!.setId);
      if (filtered.length) pool = filtered;
    }

    const results: RecognitionResult[] = [];
    for (let i = 0; i < count; i++) {
      const confidence = pickConfidence(rng);
      const condition = CONDITIONS[Math.floor(rng() * CONDITIONS.length)];
      const cropRef = `${input.imageRef}#${i}`;

      if (pool.length === 0) {
        // No catalog to sample from: emit an unmatched, low-confidence guess so
        // the pipeline still produces a reviewable detection.
        results.push({
          pokemonName: null,
          cardName: 'Unrecognized card',
          confidence: Math.min(confidence, 0.6),
          matchedCardId: null,
          estimatedCondition: condition,
          cropRef,
        });
        continue;
      }

      const card = pool[Math.floor(rng() * pool.length)];
      results.push(toResult(card, confidence, condition, cropRef));
    }

    return results;
  },
};
