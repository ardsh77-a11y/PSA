import { scansRepository, type Scan } from '../repositories/scansRepository.js';
import {
  scanResultsRepository,
  type ScanResult,
} from '../repositories/scanResultsRepository.js';
import { cardsRepository } from '../repositories/cardsRepository.js';
import { inventoryRepository, type InventoryRow } from '../repositories/inventoryRepository.js';
import { mockRecognizer, CONFIDENCE_THRESHOLD } from './mock/mockRecognizer.js';
import type { Recognizer, RecognitionResult } from './interfaces/recognizer.js';

/**
 * Orchestrates the scan lifecycle (sections 6, 39, 40). It is the single seam
 * between the API/UI and the pluggable {@link Recognizer}: routes never call a
 * recognizer directly. The default recognizer is the deterministic mock, but a
 * real CV model can be injected (see the `recognizer` argument) with zero
 * changes elsewhere.
 *
 * Data-loss safety (section 40): recognition runs INSIDE a try/catch AFTER the
 * scan row is already persisted. If recognition throws, the scan is marked
 * 'error' but the scan (and any results already written) are never dropped.
 */

/** A scan status a result maps to based on its confidence. */
export type ScanResultStatus = 'confirmed' | 'needs_review';

export interface RunScanInput {
  userId: string;
  imageRef: string;
  bytes?: Buffer;
  hints?: { setId?: string };
}

export interface RunScanOutput {
  scan: Scan;
  results: ScanResult[];
  error?: string;
}

/** Map a confidence to the initial review status. */
export function statusForConfidence(confidence: number | null | undefined): ScanResultStatus {
  return (confidence ?? 0) >= CONFIDENCE_THRESHOLD ? 'confirmed' : 'needs_review';
}

function recognitionToRow(r: RecognitionResult) {
  return {
    card_id: r.matchedCardId ?? null,
    pokemon_name: r.pokemonName ?? null,
    card_name: r.cardName ?? null,
    set_name: r.setName ?? null,
    set_abbreviation: r.setAbbreviation ?? null,
    card_number: r.cardNumber ?? null,
    rarity: r.rarity ?? null,
    card_type: r.cardType ?? null,
    language: r.language ?? null,
    is_holo: r.isHolo ? 1 : 0,
    is_reverse_holo: r.isReverseHolo ? 1 : 0,
    estimated_condition: r.estimatedCondition ?? null,
    confidence: r.confidence,
    status: statusForConfidence(r.confidence),
    crop_ref: r.cropRef ?? null,
    raw_json: JSON.stringify(r),
  };
}

export const scanService = {
  /**
   * Persist a scan (status 'processing'), run recognition, persist the mapped
   * results, then finalize the scan (detected_count + status 'ready'). A
   * recognizer failure leaves the scan/results rows intact.
   */
  async runScan(input: RunScanInput, recognizer: Recognizer = mockRecognizer): Promise<RunScanOutput> {
    const scan = scansRepository.create({
      user_id: input.userId,
      image_ref: input.imageRef,
      status: 'processing',
    });

    try {
      const detections = await recognizer.recognize({
        imageRef: input.imageRef,
        bytes: input.bytes,
        hints: input.hints,
      });
      const results = scanResultsRepository.bulkInsert(
        scan.id,
        detections.map(recognitionToRow),
      );
      const updated = scansRepository.update(input.userId, scan.id, {
        status: 'ready',
        detected_count: results.length,
      });
      return { scan: updated ?? scan, results };
    } catch (err) {
      // Recognition failed: keep the scan (and any partial results) but mark it
      // 'error'. Never throw away the persisted row.
      const updated = scansRepository.update(input.userId, scan.id, { status: 'error' });
      return {
        scan: updated ?? scan,
        results: scanResultsRepository.listByScan(scan.id),
        error: err instanceof Error ? err.message : 'Recognition failed.',
      };
    }
  },

  /** Fetch a scan (user-scoped) plus its results, or null if not owned. */
  getScan(userId: string, scanId: string): { scan: Scan; results: ScanResult[] } | null {
    const scan = scansRepository.getById(userId, scanId);
    if (!scan) return null;
    return { scan, results: scanResultsRepository.listByScan(scanId) };
  },

  /** Load a result only if its parent scan belongs to the user. */
  getOwnedResult(userId: string, scanResultId: string): { scan: Scan; result: ScanResult } | null {
    const result = scanResultsRepository.getById(scanResultId);
    if (!result) return null;
    const scan = scansRepository.getById(userId, result.scan_id);
    if (!scan) return null;
    return { scan, result };
  },

  /**
   * Commit one confirmed scan result to inventory. If the result has no matched
   * card it upserts a card from the corrected identity fields first, then
   * creates a user-scoped inventory row (status 'Identified', qty 1, condition
   * from the estimated/corrected condition) and marks the result 'committed'.
   * Returns the created inventory row, or null with a reason.
   */
  commitScanResult(userId: string, scanResultId: string): { inventory?: InventoryRow; error?: string } {
    const owned = this.getOwnedResult(userId, scanResultId);
    if (!owned) return { error: 'Scan result not found.' };
    const { result } = owned;

    if (result.status === 'committed') {
      return { error: 'This detection is already in inventory.' };
    }

    // Resolve or create the card this detection represents.
    let cardId = result.card_id;
    if (!cardId) {
      const name = (result.card_name ?? result.pokemon_name ?? '').trim();
      if (!name) {
        return { error: 'Match this detection to a card before adding it to inventory.' };
      }
      const card = cardsRepository.create({
        name,
        pokemon_name: result.pokemon_name ?? null,
        number: result.card_number ?? null,
        rarity: result.rarity ?? null,
        card_type: result.card_type ?? null,
        language: result.language ?? 'en',
        is_holo: result.is_holo,
        is_reverse_holo: result.is_reverse_holo,
      });
      cardId = card.id;
    } else if (!cardsRepository.getById(cardId)) {
      return { error: 'The matched card no longer exists.' };
    }

    const inventory = inventoryRepository.create({
      user_id: userId,
      card_id: cardId,
      condition: result.estimated_condition ?? 'NM',
      quantity: 1,
      status: 'Identified',
      classification: 'single',
    });

    scanResultsRepository.update(result.id, { card_id: cardId, status: 'committed' });
    return { inventory };
  },

  /**
   * Commit every confirmed (non-needs_review, non-committed) result of a scan.
   * Needs-review results are intentionally skipped. Returns counts.
   */
  commitAllConfirmed(userId: string, scanId: string): { committed: number; skipped: number; errors: string[] } {
    const scan = scansRepository.getById(userId, scanId);
    if (!scan) return { committed: 0, skipped: 0, errors: ['Scan not found.'] };

    const results = scanResultsRepository.listByScan(scanId);
    let committed = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const r of results) {
      if (r.status !== 'confirmed') {
        skipped++;
        continue;
      }
      const res = this.commitScanResult(userId, r.id);
      if (res.inventory) committed++;
      else if (res.error) errors.push(res.error);
    }
    return { committed, skipped, errors };
  },
};
