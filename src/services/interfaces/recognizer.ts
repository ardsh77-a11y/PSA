/**
 * Card recognition seam (sections 7, 38, 39, 40).
 *
 * The Scan feature turns an uploaded photo of one or more cards into a list of
 * structured {@link RecognitionResult}s. Recognition is deliberately hidden
 * behind this interface so a real computer-vision model can drop in later
 * without touching a single view or route: the UI, API and scan service only
 * ever talk to a {@link Recognizer}.
 *
 * Pipeline stages (each a REPLACEABLE step in a real implementation):
 *   1. preprocess   - normalize/orient/denoise the image bytes.
 *   2. detect       - locate individual card bounding boxes in the image.
 *   3. crop         - extract each card into its own image (referenced by cropRef).
 *   4. ocr / visual - read the card name/number/set and/or run a visual match
 *                     against a card-image embedding index.
 *   5. DB match     - resolve the read/visual signal to a catalog card row
 *                     (matchedCardId) via cardsRepository.
 *   6. confidence   - score each detection 0..1; low scores flag 'needs_review'.
 *
 * The deterministic mock in ../mock/mockRecognizer.ts implements the same
 * interface using seeded pseudo-randomness (so tests are repeatable) and by
 * sampling real seeded catalog cards. Swapping in a CV model is purely an
 * implementation change behind this type.
 */

/** A single detected card and the identity fields recognition produced. */
export interface RecognitionResult {
  pokemonName?: string | null;
  cardName?: string | null;
  setName?: string | null;
  setAbbreviation?: string | null;
  cardNumber?: string | null;
  rarity?: string | null;
  cardType?: string | null;
  language?: string | null;
  isHolo?: boolean;
  isReverseHolo?: boolean;
  estimatedCondition?: string | null;
  /** Confidence in the identification, 0..1. */
  confidence: number;
  /** The catalog card id this detection resolved to, if any. */
  matchedCardId?: string | null;
  /** A reference (path/id) to the cropped image for this detection, if any. */
  cropRef?: string | null;
}

/** Input to a recognition pass. */
export interface RecognizeInput {
  /** A stable reference to the uploaded image (path/id). Drives the mock seed. */
  imageRef: string;
  /** The raw image bytes, when available (a real model needs these). */
  bytes?: Buffer;
  /** Optional hints (e.g. the user says every card is from one set). */
  hints?: { setId?: string };
}

/** Identifies cards from an uploaded image. */
export interface Recognizer {
  recognize(input: RecognizeInput): Promise<RecognitionResult[]>;
}
