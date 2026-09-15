import type {
  SellerAssistant,
  AssistantAnswer,
} from '../interfaces/sellerAssistant.js';
import { dashboardService } from '../dashboardService.js';
import { recommendationService } from '../recommendationService.js';
import { analyticsService } from '../analyticsService.js';
import { bulkService } from '../bulkService.js';

/**
 * Deterministic mock SellerAssistant (FEAT-008, sections 28 + 38).
 *
 * It classifies the question into an intent by matching keywords, then answers
 * from REAL aggregates via the dashboard / recommendation / analytics / bulk
 * services — never canned text. Because it implements the {@link SellerAssistant}
 * interface, a real LLM-backed assistant can replace it without any UI change:
 * the Dashboard assistant box and POST /api/assistant only depend on the
 * returned {@link AssistantAnswer} shape.
 *
 * Supported intents (keyword-driven):
 *   - "most valuable unlisted"      -> top unlisted cards by value/score
 *   - "list today" / "list next"    -> the List-These-Next ranking
 *   - "sitting too long"            -> oldest unlisted stock
 *   - "singles vs bulk"             -> revenue split
 *   - "how much in boxes" / bulk    -> bulk holdings value
 *   - "which set makes the most"    -> best set by revenue
 *   - "revenue" / "profit"          -> headline performance
 */

function money(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

type Intent =
  | 'most_valuable_unlisted'
  | 'list_next'
  | 'sitting_too_long'
  | 'singles_vs_bulk'
  | 'bulk_value'
  | 'best_set'
  | 'performance'
  | 'unknown';

const SUGGESTIONS = [
  'What should I list next?',
  "What's my most valuable unlisted inventory?",
  'Which set is making me the most money?',
  'How much is sitting in boxes?',
  'Singles vs bulk revenue?',
  'What has been sitting too long?',
];

/** Classify a free-text question into an intent by keyword matching. */
export function classifyIntent(question: string): Intent {
  const q = question.toLowerCase();
  const has = (...words: string[]) => words.every((w) => q.includes(w));
  const any = (...words: string[]) => words.some((w) => q.includes(w));

  if (has('set') && any('most', 'best', 'top') && any('money', 'revenue', 'profit', 'sell', 'sales')) {
    return 'best_set';
  }
  if (any('singles vs bulk', 'bulk vs singles') || (any('single', 'singles') && q.includes('bulk'))) {
    return 'singles_vs_bulk';
  }
  if (any('box', 'boxes', 'bulk') && any('how much', 'value', 'worth', 'in ')) {
    return 'bulk_value';
  }
  if ((any('valuable', 'expensive', 'worth', 'highest') && q.includes('unlisted')) || has('most', 'valuable')) {
    return 'most_valuable_unlisted';
  }
  if (any('sitting', 'stale', 'too long', 'oldest', 'aging', 'aged')) {
    return 'sitting_too_long';
  }
  if (any('list next', 'list today', 'what should i list', 'what to list', 'list these')) {
    return 'list_next';
  }
  if (any('revenue', 'profit', 'how am i doing', 'performance', 'earnings')) {
    return 'performance';
  }
  if (q.includes('bulk')) return 'bulk_value';
  return 'unknown';
}

export const mockSellerAssistant: SellerAssistant = {
  async ask(userId: string, question: string): Promise<AssistantAnswer> {
    const intent = classifyIntent(question ?? '');

    switch (intent) {
      case 'most_valuable_unlisted': {
        const recs = recommendationService.listTheseNext(userId, 5);
        if (recs.length === 0) {
          return {
            answer: 'You have no unlisted cards right now — everything is either listed or sold.',
            data: { intent },
            suggestions: SUGGESTIONS,
          };
        }
        const top = recs.slice().sort((a, b) => b.marketValue - a.marketValue);
        const lead = top[0];
        return {
          answer: `Your most valuable unlisted card is ${lead.cardName}${lead.setName ? ` (${lead.setName})` : ''} at ${money(lead.marketValue)}. The top ${top.length} unlisted cards are worth ${money(top.reduce((s, r) => s + r.marketValue, 0))} combined.`,
          data: {
            intent,
            rows: top.map((r) => ({ card: r.cardName, set: r.setName ?? '', value: money(r.marketValue), net: money(r.estimatedNet) })),
            href: '/inventory?status=Ready to List',
            linkLabel: 'Open unlisted inventory',
          },
          suggestions: SUGGESTIONS,
        };
      }

      case 'list_next': {
        const recs = recommendationService.listTheseNext(userId, 5);
        if (recs.length === 0) {
          return { answer: 'Nothing to list next — your unlisted inventory is empty.', data: { intent }, suggestions: SUGGESTIONS };
        }
        return {
          answer: `Start with ${recs[0].cardName} (score ${recs[0].score}) — ${recs[0].rationale}. Here are the top ${recs.length} to list next.`,
          data: {
            intent,
            rows: recs.map((r) => ({ card: r.cardName, score: r.score, value: money(r.marketValue), why: r.rationale })),
            href: '/pricing',
            linkLabel: 'Price and list',
          },
          suggestions: SUGGESTIONS,
        };
      }

      case 'sitting_too_long': {
        const recs = recommendationService.listTheseNext(userId, 50);
        const oldest = recs.slice().sort((a, b) => b.daysSitting - a.daysSitting).slice(0, 5);
        if (oldest.length === 0 || oldest[0].daysSitting === 0) {
          return { answer: 'Nothing is sitting too long — your unlisted stock is fresh (or empty).', data: { intent }, suggestions: SUGGESTIONS };
        }
        return {
          answer: `${oldest[0].cardName} has been sitting the longest at ${oldest[0].daysSitting} days. These ${oldest.length} cards have aged the most in your unlisted inventory.`,
          data: {
            intent,
            rows: oldest.map((r) => ({ card: r.cardName, days: r.daysSitting, value: money(r.marketValue) })),
            href: '/inventory',
            linkLabel: 'Review aging stock',
          },
          suggestions: SUGGESTIONS,
        };
      }

      case 'singles_vs_bulk': {
        const a = analyticsService.getAnalytics(userId);
        const singles = a.bulkVsSingles.find((x) => x.label === 'Singles')?.value ?? 0;
        const bulk = a.bulkVsSingles.find((x) => x.label === 'Bulk')?.value ?? 0;
        const total = singles + bulk;
        const pct = total > 0 ? Math.round((singles / total) * 100) : 0;
        return {
          answer:
            total > 0
              ? `Singles have driven ${money(singles)} (${pct}%) of revenue and bulk ${money(bulk)} (${100 - pct}%).`
              : 'No sales recorded yet, so there is no singles-vs-bulk split to report.',
          data: {
            intent,
            stats: { Singles: money(singles), Bulk: money(bulk) },
            href: '/analytics',
            linkLabel: 'See analytics',
          },
          suggestions: SUGGESTIONS,
        };
      }

      case 'bulk_value': {
        const summary = bulkService.getBulkSummary(userId);
        return {
          answer: `You have about ${summary.totalCount.toLocaleString('en-US')} bulk cards in boxes, worth roughly ${money(summary.totalValue)}.`,
          data: {
            intent,
            stats: { 'Bulk cards': summary.totalCount, 'Estimated value': money(summary.totalValue) },
            rows: summary.categories
              .filter((c) => c.count > 0)
              .map((c) => ({ category: c.label, cards: c.count, value: money(c.estimatedValue) })),
            href: '/bulk',
            linkLabel: 'Manage bulk',
          },
          suggestions: SUGGESTIONS,
        };
      }

      case 'best_set': {
        const a = analyticsService.getAnalytics(userId);
        if (a.bestSets.length === 0) {
          return { answer: 'No sales yet, so no set has generated revenue to compare.', data: { intent }, suggestions: SUGGESTIONS };
        }
        const top = a.bestSets[0];
        return {
          answer: `${top.label} is making you the most money at ${money(top.value)} in revenue.`,
          data: {
            intent,
            rows: a.bestSets.map((s) => ({ set: s.label, revenue: money(s.value) })),
            href: '/analytics',
            linkLabel: 'See analytics',
          },
          suggestions: SUGGESTIONS,
        };
      }

      case 'performance': {
        const a = analyticsService.getAnalytics(userId);
        return {
          answer: `You have generated ${money(a.summary.revenue)} in revenue and ${money(a.summary.profit)} in net profit across ${a.summary.cardsSold} card${a.summary.cardsSold === 1 ? '' : 's'} sold, averaging ${money(a.summary.avgSalePrice)} per sale.`,
          data: {
            intent,
            stats: {
              Revenue: money(a.summary.revenue),
              Profit: money(a.summary.profit),
              'Cards sold': a.summary.cardsSold,
              'Avg sale': money(a.summary.avgSalePrice),
            },
            href: '/analytics',
            linkLabel: 'See analytics',
          },
          suggestions: SUGGESTIONS,
        };
      }

      default: {
        const kpis = dashboardService.getKpis(userId);
        return {
          answer:
            "I can answer questions about your inventory, pricing and sales. Try: \"what should I list next?\", \"what's my most valuable unlisted inventory?\", \"which set is making me the most money?\", or \"how much is sitting in boxes?\". " +
            `Right now you hold ${money(kpis.totalInventoryValue.value)} of inventory across ${kpis.cardsInInventory.value} cards.`,
          data: { intent: 'unknown' },
          suggestions: SUGGESTIONS,
        };
      }
    }
  },
};

export { SUGGESTIONS as ASSISTANT_SUGGESTIONS };
