import { getDb } from '../db/connection.js';

/**
 * Analytics aggregation service (FEAT-008, section 27).
 *
 * Computes the seller-performance metrics that power the Analytics page:
 * revenue, profit, cards sold, average sale price, average profit per card,
 * inventory turnover, average days-to-sale, best-performing sets / Pokemon /
 * rarities, and bulk-vs-singles revenue. Everything is scoped to the user and
 * computed with SQL; the results are shaped as series suitable for the
 * hand-drawn SVG charts.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface NamedValue {
  label: string;
  value: number;
}

export interface TimePoint {
  period: string;
  revenue: number;
  profit: number;
  count: number;
}

export interface AnalyticsSummary {
  revenue: number;
  profit: number;
  cardsSold: number;
  avgSalePrice: number;
  avgProfitPerCard: number;
  /** Cards sold / average inventory count (sold + on-hand). */
  inventoryTurnover: number;
  /** Average days between date_acquired and date_sold across sold rows. */
  avgDaysToSale: number;
  totalFees: number;
  totalShipping: number;
  totalCostBasis: number;
}

export interface Analytics {
  summary: AnalyticsSummary;
  revenueOverTime: TimePoint[];
  bestSets: NamedValue[];
  bestPokemon: NamedValue[];
  bestRarities: NamedValue[];
  /** Singles vs bulk revenue split (for the donut/stacked bar). */
  bulkVsSingles: NamedValue[];
}

export const analyticsService = {
  /** Compute the full analytics bundle for a user. */
  getAnalytics(userId: string): Analytics {
    const db = getDb();

    const agg = db
      .prepare(
        `SELECT COUNT(*) AS cardsSold,
                COALESCE(SUM(sale_price), 0) AS revenue,
                COALESCE(SUM(net_profit), 0) AS profit,
                COALESCE(SUM(fees), 0) AS fees,
                COALESCE(SUM(shipping), 0) AS shipping,
                COALESCE(SUM(cost_basis), 0) AS costBasis
         FROM sales WHERE user_id = ?`,
      )
      .get(userId) as {
      cardsSold: number;
      revenue: number;
      profit: number;
      fees: number;
      shipping: number;
      costBasis: number;
    };

    const cardsSold = agg.cardsSold;
    const revenue = round2(agg.revenue);
    const profit = round2(agg.profit);
    const avgSalePrice = cardsSold > 0 ? round2(revenue / cardsSold) : 0;
    const avgProfitPerCard = cardsSold > 0 ? round2(profit / cardsSold) : 0;

    // On-hand (unsold) inventory count for turnover.
    const onHand = (
      db
        .prepare("SELECT COALESCE(SUM(quantity), 0) AS c FROM inventory WHERE user_id = ? AND status <> 'Sold'")
        .get(userId) as { c: number }
    ).c;
    const avgInventory = (onHand + cardsSold) / 2;
    const inventoryTurnover = avgInventory > 0 ? round2(cardsSold / avgInventory) : 0;

    // Average days-to-sale from linked inventory acquisition -> sold date.
    const dts = db
      .prepare(
        `SELECT AVG(julianday(sa.sold_at) - julianday(i.date_acquired)) AS d
         FROM sales sa
         JOIN inventory i ON i.id = sa.inventory_id
         WHERE sa.user_id = ? AND i.date_acquired IS NOT NULL AND sa.sold_at IS NOT NULL`,
      )
      .get(userId) as { d: number | null };
    const avgDaysToSale = dts.d != null && Number.isFinite(dts.d) ? round2(Math.max(0, dts.d)) : 0;

    const summary: AnalyticsSummary = {
      revenue,
      profit,
      cardsSold,
      avgSalePrice,
      avgProfitPerCard,
      inventoryTurnover,
      avgDaysToSale,
      totalFees: round2(agg.fees),
      totalShipping: round2(agg.shipping),
      totalCostBasis: round2(agg.costBasis),
    };

    // Revenue + profit over time, grouped by month (YYYY-MM).
    const timeRows = db
      .prepare(
        `SELECT substr(sold_at, 1, 7) AS period,
                COALESCE(SUM(sale_price), 0) AS revenue,
                COALESCE(SUM(net_profit), 0) AS profit,
                COUNT(*) AS count
         FROM sales WHERE user_id = ? AND sold_at IS NOT NULL
         GROUP BY period ORDER BY period ASC`,
      )
      .all(userId) as Array<{ period: string; revenue: number; profit: number; count: number }>;
    const revenueOverTime: TimePoint[] = timeRows.map((r) => ({
      period: r.period,
      revenue: round2(r.revenue),
      profit: round2(r.profit),
      count: r.count,
    }));

    const bestSets = this.bestBy(userId, 's.name');
    const bestPokemon = this.bestBy(userId, "COALESCE(c.pokemon_name, c.name)");
    const bestRarities = this.bestBy(userId, 'c.rarity');

    // Singles vs bulk revenue: classify each sold row by the linked inventory's
    // classification (bulk vs single); unknown defaults to single.
    const bvs = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(i.classification, 'single')) = 'bulk' THEN sa.sale_price ELSE 0 END), 0) AS bulk,
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(i.classification, 'single')) <> 'bulk' THEN sa.sale_price ELSE 0 END), 0) AS singles
         FROM sales sa LEFT JOIN inventory i ON i.id = sa.inventory_id
         WHERE sa.user_id = ?`,
      )
      .get(userId) as { bulk: number; singles: number };
    const bulkVsSingles: NamedValue[] = [
      { label: 'Singles', value: round2(bvs.singles) },
      { label: 'Bulk', value: round2(bvs.bulk) },
    ];

    return { summary, revenueOverTime, bestSets, bestPokemon, bestRarities, bulkVsSingles };
  },

  /**
   * Best-performing group by revenue. `groupExpr` is a trusted SQL expression
   * (never user input) selecting the grouping label from the sales/cards join.
   */
  bestBy(userId: string, groupExpr: string, limit = 6): NamedValue[] {
    const rows = getDb()
      .prepare(
        `SELECT ${groupExpr} AS label, COALESCE(SUM(sa.sale_price), 0) AS value
         FROM sales sa
         LEFT JOIN cards c ON c.id = sa.card_id
         LEFT JOIN sets s ON s.id = c.set_id
         WHERE sa.user_id = ?
         GROUP BY label
         HAVING label IS NOT NULL AND label <> ''
         ORDER BY value DESC
         LIMIT ?`,
      )
      .all(userId, limit) as Array<{ label: string; value: number }>;
    return rows.map((r) => ({ label: r.label, value: round2(r.value) }));
  },
};
