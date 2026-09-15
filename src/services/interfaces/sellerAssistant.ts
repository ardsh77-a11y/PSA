/**
 * SellerAssistant seam (FEAT-008, sections 28 + 38).
 *
 * The assistant answers a seller's natural-language questions about their own
 * operation ("what's my most valuable unlisted inventory?", "which set makes me
 * the most money?", "how much is sitting in boxes?"). The MOCK implementation
 * ({@link ../mock/mockSellerAssistant.ts}) parses intent from keywords and
 * answers from REAL aggregates computed over the user's data — no canned text,
 * no LLM, no network.
 *
 * A real LLM-backed assistant implements this SAME interface with zero UI
 * changes: the Dashboard question box and the POST /api/assistant route consume
 * only the {@link AssistantAnswer} shape defined here. The real implementation
 * would translate the question to a plan over the same repositories/services
 * (or expose them as tools) and return an answer plus optional structured data.
 */

/** Optional structured payload backing an answer (rows, totals, links). */
export interface AssistantData {
  /** A short machine-readable intent label the mock resolved. */
  intent: string;
  /** Tabular rows relevant to the answer (already display-ready). */
  rows?: Array<Record<string, string | number>>;
  /** Headline metrics keyed by label. */
  stats?: Record<string, string | number>;
  /** A link the UI can offer to drill into the answer. */
  href?: string;
  linkLabel?: string;
}

export interface AssistantAnswer {
  /** The natural-language answer to show the user. */
  answer: string;
  /** Optional structured data behind the answer. */
  data?: AssistantData;
  /** Suggested follow-up prompts the UI can render as chips. */
  suggestions?: string[];
}

export interface SellerAssistant {
  /**
   * Answer a question for a specific user. Always resolves (never throws): an
   * unrecognized question yields a helpful fallback that lists what it can do.
   */
  ask(userId: string, question: string): Promise<AssistantAnswer>;
}
