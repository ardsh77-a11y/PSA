import { getDb } from '../db/connection.js';
import { newId } from '../util/ids.js';
import type { SqlValue } from 'node:sqlite';

/** A raw scan_result row. Owned via its parent scan (scan.user_id). */
export interface ScanResult {
  id: string;
  scan_id: string;
  card_id: string | null;
  pokemon_name: string | null;
  card_name: string | null;
  set_name: string | null;
  set_abbreviation: string | null;
  card_number: string | null;
  rarity: string | null;
  card_type: string | null;
  language: string | null;
  is_holo: number;
  is_reverse_holo: number;
  estimated_condition: string | null;
  confidence: number | null;
  status: string;
  crop_ref: string | null;
  raw_json: string;
}

export interface CreateScanResultInput {
  id?: string;
  /** Set by bulkInsert from its scanId argument; not required by callers. */
  scan_id?: string;
  card_id?: string | null;
  pokemon_name?: string | null;
  card_name?: string | null;
  set_name?: string | null;
  set_abbreviation?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  card_type?: string | null;
  language?: string | null;
  is_holo?: boolean | number;
  is_reverse_holo?: boolean | number;
  estimated_condition?: string | null;
  confidence?: number | null;
  status?: string;
  crop_ref?: string | null;
  raw_json?: string;
}

/** Fields correctable by a manual review. Only provided keys are written. */
export interface UpdateScanResultInput {
  card_id?: string | null;
  pokemon_name?: string | null;
  card_name?: string | null;
  set_name?: string | null;
  set_abbreviation?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  card_type?: string | null;
  language?: string | null;
  is_holo?: boolean | number;
  is_reverse_holo?: boolean | number;
  estimated_condition?: string | null;
  status?: string;
}

function toInt(v: boolean | number | undefined): number {
  return v ? 1 : 0;
}

const UPDATABLE: (keyof UpdateScanResultInput)[] = [
  'card_id',
  'pokemon_name',
  'card_name',
  'set_name',
  'set_abbreviation',
  'card_number',
  'rarity',
  'card_type',
  'language',
  'is_holo',
  'is_reverse_holo',
  'estimated_condition',
  'status',
];

/**
 * Data access for scan_results. Rows are scoped to a user through their parent
 * scan: mutating methods take a scanId (the caller must first verify the scan
 * belongs to the user).
 */
export const scanResultsRepository = {
  /** Insert many results for one scan (used right after recognition). */
  bulkInsert(scanId: string, inputs: CreateScanResultInput[]): ScanResult[] {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO scan_results
        (id, scan_id, card_id, pokemon_name, card_name, set_name, set_abbreviation, card_number, rarity, card_type, language, is_holo, is_reverse_holo, estimated_condition, confidence, status, crop_ref, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ids: string[] = [];
    for (const input of inputs) {
      const id = input.id ?? newId();
      ids.push(id);
      stmt.run(
        id,
        scanId,
        input.card_id ?? null,
        input.pokemon_name ?? null,
        input.card_name ?? null,
        input.set_name ?? null,
        input.set_abbreviation ?? null,
        input.card_number ?? null,
        input.rarity ?? null,
        input.card_type ?? null,
        input.language ?? null,
        toInt(input.is_holo),
        toInt(input.is_reverse_holo),
        input.estimated_condition ?? null,
        input.confidence ?? null,
        input.status ?? 'detected',
        input.crop_ref ?? null,
        input.raw_json ?? '{}',
      );
    }
    return ids.map((id) => this.getById(id)!);
  },

  getById(id: string): ScanResult | undefined {
    return getDb().prepare('SELECT * FROM scan_results WHERE id = ?').get(id) as ScanResult | undefined;
  },

  /** All results for a scan, in insertion order. */
  listByScan(scanId: string): ScanResult[] {
    return getDb()
      .prepare('SELECT * FROM scan_results WHERE scan_id = ? ORDER BY rowid ASC')
      .all(scanId) as ScanResult[];
  },

  /** Apply a correction to a result. Only provided (defined) keys are written. */
  update(id: string, patch: UpdateScanResultInput): ScanResult | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const sets: string[] = [];
    const params: SqlValue[] = [];
    for (const key of UPDATABLE) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        if (key === 'is_holo' || key === 'is_reverse_holo') {
          sets.push(`${key} = ?`);
          params.push(toInt(patch[key] as boolean | number));
        } else {
          sets.push(`${key} = ?`);
          params.push(patch[key] as SqlValue);
        }
      }
    }
    if (sets.length === 0) return existing;
    params.push(id);
    getDb().prepare(`UPDATE scan_results SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },

  delete(id: string): boolean {
    const res = getDb().prepare('DELETE FROM scan_results WHERE id = ?').run(id);
    return res.changes > 0;
  },
};
