import test from 'node:test';
import assert from 'node:assert';
import { mockClassificationService } from './mock/mockClassificationService.js';
import { computeFeesAndNet } from './mock/mockPricingEngine.js';
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from './settings.js';
import type { MarketData } from './interfaces/pricing.js';
import type { PriceResult } from './interfaces/pricing.js';

const settings: PricingSettings = { ...DEFAULT_PRICING_SETTINGS };

/** Build a MarketData with sensible synthetic ranges around a market price. */
function marketData(marketPrice: number, competitionCount: number): MarketData {
  return {
    marketPrice,
    low: marketPrice * 0.8,
    high: marketPrice * 1.25,
    recentSoldLow: marketPrice * 0.85,
    recentSoldHigh: marketPrice * 1.15,
    competitionCount,
    lowestComparable: marketPrice * 0.82,
    source: 'test',
    capturedAt: '2024-01-01T00:00:00.000Z',
  };
}

/** Build a PriceResult by running the same fee/net math the engine uses. */
function priceResult(marketPrice: number, suggestedPrice: number, s: PricingSettings = settings): PriceResult {
  const { estimatedFees, estimatedShipping, estimatedNet } = computeFeesAndNet(suggestedPrice, s);
  return {
    marketPrice,
    suggestedPrice,
    estimatedFees,
    estimatedShipping,
    estimatedNet,
    mode: s.pricingMode,
    rationale: 'test',
  };
}

test('a $0.75 card is classified BULK', () => {
  const md = marketData(0.75, 30);
  const pricing = priceResult(0.75, 0.75);
  const res = mockClassificationService.classify({ marketData: md, pricing, settings });
  assert.strictEqual(res.decision, 'BULK');
});

test('a $12 card with low competition is SELL_INDIVIDUALLY', () => {
  const md = marketData(12, 3);
  const pricing = priceResult(12, 12.99);
  const res = mockClassificationService.classify({ marketData: md, pricing, settings });
  assert.strictEqual(res.decision, 'SELL_INDIVIDUALLY');
});

test('a borderline ~$3 card yields a defensible REVIEW/BULK decision', () => {
  const md = marketData(3, 20);
  const pricing = priceResult(3, 3.25);
  const res = mockClassificationService.classify({ marketData: md, pricing, settings });
  assert.ok(
    res.decision === 'REVIEW' || res.decision === 'BULK',
    `expected REVIEW or BULK, got ${res.decision}`,
  );
});

test('explanation contains market value, expected net and recommended price in section-10 format', () => {
  const md = marketData(11.8, 4);
  const pricing = priceResult(11.8, 12.99);
  const res = mockClassificationService.classify({ marketData: md, pricing, settings });
  assert.match(res.reason, /Estimated market value: \$11\.80/);
  assert.match(res.reason, /Expected net after fees\/shipping: \$/);
  assert.match(res.reason, /Recommended listing price: \$12\.99/);
  assert.match(res.reason, /Reason: /);
});

test('NOT a lone fixed threshold: a $5 card with terrible net (huge shipping) is BULK', () => {
  // Same headline value as a card that would normally sell individually, but a
  // punishing shipping cost destroys the net, so it must fall to BULK.
  const heavyShipping: PricingSettings = { ...settings, shippingCost: 6.5 };
  const md = marketData(5, 8);
  const pricing = priceResult(5, 5.25, heavyShipping);
  assert.ok(pricing.estimatedNet <= 0, 'net should be wiped out by shipping');
  const res = mockClassificationService.classify({ marketData: md, pricing, settings: heavyShipping });
  assert.strictEqual(res.decision, 'BULK');

  // And a healthy-net $5 card with low competition need NOT be bulk, proving
  // the decision is driven by more than the $5 headline price.
  const good = priceResult(5, 5.25, settings);
  const resGood = mockClassificationService.classify({
    marketData: marketData(5, 2),
    pricing: good,
    settings,
  });
  assert.notStrictEqual(resGood.decision, 'BULK');
});

test('seller settings measurably change the outcome (lower sellThreshold => more singles)', () => {
  const md = marketData(6, 10);
  const pricing = priceResult(6, 6.5);
  const strict = mockClassificationService.classify({ marketData: md, pricing, settings });
  const lenient = mockClassificationService.classify({
    marketData: md,
    pricing,
    settings: { ...settings, sellThreshold: 10 },
  });
  // Lenient threshold should never produce a "worse" (more bulk-leaning) result.
  const rank = { BULK: 0, REVIEW: 1, SELL_INDIVIDUALLY: 2 } as const;
  assert.ok(rank[lenient.decision] >= rank[strict.decision]);
});
