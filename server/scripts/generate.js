// server/scripts/generate.js
// Synthetic e-commerce clickstream event generator
// Session-based generation with realistic conversion funnel,
// fixed product catalog, popularity-skewed product selection,
// heavy-tailed user activity, and weighted device distribution
// Uses built-in Node.js capabilities — no external dependencies required

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_TYPES = ['view', 'add_to_cart', 'purchase'];
const DEVICES = ['mobile', 'desktop', 'tablet'];
const DEVICE_WEIGHTS = [0.65, 0.25, 0.10]; // India mobile-first distribution
const COUNTRIES = ['IN']; // Only IN as specified
const CATEGORIES = [
  'electronics', 'clothing', 'home', 'books',
  'sports', 'toys', 'food', 'beauty',
];

// ─── Product Catalog ─────────────────────────────────────────────────────────
// 80 products with fixed productId, category, and price.
// Ordered in category-interleaved rounds so Zipf popularity ranks
// distribute evenly across all categories (round 1 = most popular
// product per category, round 2 = second most popular, etc.).

const PRODUCT_CATALOG = [
  // ── Round 1 (ranks 1-8, most popular per category) ──
  { productId: 'p_1001', category: 'electronics', price: 699.99 },
  { productId: 'p_2001', category: 'clothing',    price: 19.99  },
  { productId: 'p_3001', category: 'home',        price: 24.99  },
  { productId: 'p_4001', category: 'books',       price: 14.99  },
  { productId: 'p_5001', category: 'sports',      price: 24.99  },
  { productId: 'p_6001', category: 'toys',        price: 29.99  },
  { productId: 'p_7001', category: 'food',        price: 12.99  },
  { productId: 'p_8001', category: 'beauty',      price: 34.99  },
  // ── Round 2 (ranks 9-16) ──
  { productId: 'p_1002', category: 'electronics', price: 999.99 },
  { productId: 'p_2002', category: 'clothing',    price: 39.99  },
  { productId: 'p_3002', category: 'home',        price: 34.99  },
  { productId: 'p_4002', category: 'books',       price: 24.99  },
  { productId: 'p_5002', category: 'sports',      price: 34.99  },
  { productId: 'p_6002', category: 'toys',        price: 24.99  },
  { productId: 'p_7002', category: 'food',        price: 14.99  },
  { productId: 'p_8002', category: 'beauty',      price: 12.99  },
  // ── Round 3 (ranks 17-24) ──
  { productId: 'p_1003', category: 'electronics', price: 149.99 },
  { productId: 'p_2003', category: 'clothing',    price: 59.99  },
  { productId: 'p_3003', category: 'home',        price: 14.99  },
  { productId: 'p_4003', category: 'books',       price: 49.99  },
  { productId: 'p_5003', category: 'sports',      price: 89.99  },
  { productId: 'p_6003', category: 'toys',        price: 19.99  },
  { productId: 'p_7003', category: 'food',        price: 8.99   },
  { productId: 'p_8003', category: 'beauty',      price: 14.99  },
  // ── Round 4 (ranks 25-32) ──
  { productId: 'p_1004', category: 'electronics', price: 449.99 },
  { productId: 'p_2004', category: 'clothing',    price: 79.99  },
  { productId: 'p_3004', category: 'home',        price: 29.99  },
  { productId: 'p_4004', category: 'books',       price: 18.99  },
  { productId: 'p_5004', category: 'sports',      price: 44.99  },
  { productId: 'p_6004', category: 'toys',        price: 49.99  },
  { productId: 'p_7004', category: 'food',        price: 6.99   },
  { productId: 'p_8004', category: 'beauty',      price: 79.99  },
  // ── Round 5 (ranks 33-40) ──
  { productId: 'p_1005', category: 'electronics', price: 549.99 },
  { productId: 'p_2005', category: 'clothing',    price: 99.99  },
  { productId: 'p_3005', category: 'home',        price: 49.99  },
  { productId: 'p_4005', category: 'books',       price: 12.99  },
  { productId: 'p_5005', category: 'sports',      price: 19.99  },
  { productId: 'p_6005', category: 'toys',        price: 14.99  },
  { productId: 'p_7005', category: 'food',        price: 11.99  },
  { productId: 'p_8005', category: 'beauty',      price: 19.99  },
  // ── Round 6 (ranks 41-48) ──
  { productId: 'p_1006', category: 'electronics', price: 399.99 },
  { productId: 'p_2006', category: 'clothing',    price: 9.99   },
  { productId: 'p_3006', category: 'home',        price: 19.99  },
  { productId: 'p_4006', category: 'books',       price: 8.99   },
  { productId: 'p_5006', category: 'sports',      price: 29.99  },
  { productId: 'p_6006', category: 'toys',        price: 16.99  },
  { productId: 'p_7006', category: 'food',        price: 9.99   },
  { productId: 'p_8006', category: 'beauty',      price: 9.99   },
  // ── Round 7 (ranks 49-56) ──
  { productId: 'p_1007', category: 'electronics', price: 249.99 },
  { productId: 'p_2007', category: 'clothing',    price: 34.99  },
  { productId: 'p_3007', category: 'home',        price: 12.99  },
  { productId: 'p_4007', category: 'books',       price: 9.99   },
  { productId: 'p_5007', category: 'sports',      price: 14.99  },
  { productId: 'p_6007', category: 'toys',        price: 12.99  },
  { productId: 'p_7007', category: 'food',        price: 7.99   },
  { productId: 'p_8007', category: 'beauty',      price: 11.99  },
  // ── Round 8 (ranks 57-64) ──
  { productId: 'p_1008', category: 'electronics', price: 29.99  },
  { productId: 'p_2008', category: 'clothing',    price: 24.99  },
  { productId: 'p_3008', category: 'home',        price: 22.99  },
  { productId: 'p_4008', category: 'books',       price: 16.99  },
  { productId: 'p_5008', category: 'sports',      price: 39.99  },
  { productId: 'p_6008', category: 'toys',        price: 9.99   },
  { productId: 'p_7008', category: 'food',        price: 5.99   },
  { productId: 'p_8008', category: 'beauty',      price: 7.99   },
  // ── Round 9 (ranks 65-71, no toys — toys has 8 products) ──
  { productId: 'p_1009', category: 'electronics', price: 79.99  },
  { productId: 'p_2009', category: 'clothing',    price: 44.99  },
  { productId: 'p_3009', category: 'home',        price: 15.99  },
  { productId: 'p_4009', category: 'books',       price: 11.99  },
  { productId: 'p_5009', category: 'sports',      price: 16.99  },
  { productId: 'p_7009', category: 'food',        price: 8.99   },
  { productId: 'p_8009', category: 'beauty',      price: 29.99  },
  // ── Round 10 (ranks 72-78) ──
  { productId: 'p_1010', category: 'electronics', price: 59.99  },
  { productId: 'p_2010', category: 'clothing',    price: 54.99  },
  { productId: 'p_3010', category: 'home',        price: 39.99  },
  { productId: 'p_4010', category: 'books',       price: 29.99  },
  { productId: 'p_5010', category: 'sports',      price: 7.99   },
  { productId: 'p_7010', category: 'food',        price: 24.99  },
  { productId: 'p_8010', category: 'beauty',      price: 16.99  },
  // ── Round 11-12 (ranks 79-80, electronics only) ──
  { productId: 'p_1011', category: 'electronics', price: 329.99 },
  { productId: 'p_1012', category: 'electronics', price: 49.99  },
];

// ─── Weighted Selection ──────────────────────────────────────────────────────

/**
 * Build a cumulative distribution function from raw weights.
 * @param {number[]} weights - Non-negative weights (need not sum to 1)
 * @returns {number[]} Cumulative probabilities [0..1]
 */
function buildCDF(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  const cdf = [];
  let cumulative = 0;
  for (const w of weights) {
    cumulative += w / total;
    cdf.push(cumulative);
  }
  return cdf;
}

/**
 * Select an item using pre-computed CDF (binary search).
 * @param {Array} items - Items to select from
 * @param {number[]} cdf - Cumulative distribution function
 * @returns {*} Selected item
 */
function weightedSelect(items, cdf) {
  const r = Math.random();
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < r) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return items[lo];
}

// Pre-computed CDFs for weighted selection
// Zipf(s=0.8): weight for rank r = 1 / r^0.8
const PRODUCT_CDF = buildCDF(PRODUCT_CATALOG.map((_, i) => 1 / Math.pow(i + 1, 0.8)));
const DEVICE_CDF = buildCDF(DEVICE_WEIGHTS);
const EVENT_TYPE_CDF = buildCDF([0.60, 0.25, 0.15]); // view, add_to_cart, purchase

function selectProduct() { return weightedSelect(PRODUCT_CATALOG, PRODUCT_CDF); }
function selectDevice() { return weightedSelect(DEVICES, DEVICE_CDF); }

// ─── Timestamp Generation ────────────────────────────────────────────────────

/**
 * Generate a base timestamp within the 7-day window.
 * 70% of timestamps fall within the last 24 hours,
 * 30% spread across the prior 6 days.
 * @returns {Date}
 */
function generateBaseTimestamp() {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sixDaysMs = 6 * 24 * 60 * 60 * 1000;

  let offset;
  if (Math.random() < 0.7) {
    offset = Math.random() * oneDayMs;
  } else {
    offset = oneDayMs + Math.random() * sixDaysMs;
  }
  return new Date(now - offset);
}

// ─── User Activity Distribution ──────────────────────────────────────────────

/**
 * Generate a user's total event budget using a heavy-tailed distribution.
 * Produces a mix of light users (1-3 events), moderate users (4-25),
 * and heavy users (26-150).
 *
 * Expected ~11 events/user → ~13,600 users for 150,000 events.
 *
 * @returns {number} Event count for one user
 */
function generateActivityCount() {
  const r = Math.random();
  if (r < 0.55) return 1 + Math.floor(Math.random() * 3);   // 1–3   (55% of users)
  if (r < 0.78) return 4 + Math.floor(Math.random() * 7);   // 4–10  (23% of users)
  if (r < 0.90) return 11 + Math.floor(Math.random() * 15); // 11–25 (12% of users)
  if (r < 0.97) return 26 + Math.floor(Math.random() * 35); // 26–60 (7% of users)
  return 61 + Math.floor(Math.random() * 90);                // 61–150 (3% of users)
}

// ─── Session Funnel Generation ───────────────────────────────────────────────

/**
 * Generate events for a single session following funnel progression.
 *
 * Funnel: view (1-4 products) → add_to_cart (40% per viewed) → purchase (40% per carted)
 * Expected per unconstrained session: ~2.5 views, ~1.0 carts, ~0.4 purchases = 3.9 total
 * Expected type distribution: ~64% view, ~26% add_to_cart, ~10% purchase
 *
 * @param {string} userId - User ID for all events in this session
 * @param {string} sessionId - Session ID
 * @param {string} device - Device for this session
 * @param {number} maxEvents - Maximum events allowed in this session
 * @returns {object[]} Array of event objects (ts is null, assigned by caller)
 */
function generateSessionEvents(userId, sessionId, device, maxEvents) {
  const events = [];

  // 1. Views: browse 1-4 products
  const numViews = Math.min(1 + Math.floor(Math.random() * 4), maxEvents);
  const viewedProducts = [];
  for (let i = 0; i < numViews; i++) {
    const product = selectProduct();
    viewedProducts.push(product);
    events.push({
      eventId: randomUUID(),
      userId,
      sessionId,
      type: 'view',
      productId: product.productId,
      category: product.category,
      price: product.price,
      quantity: 1,
      device,
      country: 'IN',
      ts: null,
    });
  }

  if (events.length >= maxEvents) return events;

  // 2. Add to cart: 40% probability per viewed product
  const cartedProducts = [];
  for (const product of viewedProducts) {
    if (events.length >= maxEvents) break;
    if (Math.random() < 0.4) {
      cartedProducts.push(product);
      events.push({
        eventId: randomUUID(),
        userId,
        sessionId,
        type: 'add_to_cart',
        productId: product.productId,
        category: product.category,
        price: product.price,
        quantity: 1,
        device,
        country: 'IN',
        ts: null,
      });
    }
  }

  if (events.length >= maxEvents) return events;

  // 3. Purchase: 40% probability per carted product
  for (const product of cartedProducts) {
    if (events.length >= maxEvents) break;
    if (Math.random() < 0.4) {
      events.push({
        eventId: randomUUID(),
        userId,
        sessionId,
        type: 'purchase',
        productId: product.productId,
        category: product.category,
        price: product.price,
        quantity: 1 + Math.floor(Math.random() * 3), // 1-3 for purchases
        device,
        country: 'IN',
        ts: null,
      });
    }
  }

  return events;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a single synthetic clickstream event (standalone).
 * Uses the product catalog for fixed prices/categories and weighted
 * distributions for product popularity, device, and event type.
 * Does not participate in session-based generation.
 *
 * @param {number} index - Kept for API compatibility (unused)
 * @returns {object} Generated event document
 */
function generateEvent(index = 0) {
  const product = selectProduct();
  const type = weightedSelect(EVENT_TYPES, EVENT_TYPE_CDF);
  const device = selectDevice();

  return {
    eventId: randomUUID(),
    userId: `u_${String(Math.floor(100000 + Math.random() * 900000)).padStart(6, '0')}`,
    sessionId: `s_${String(Math.floor(100000 + Math.random() * 900000)).padStart(6, '0')}`,
    type,
    productId: product.productId,
    category: product.category,
    price: product.price,
    quantity: type === 'purchase' ? 1 + Math.floor(Math.random() * 3) : 1,
    device,
    country: 'IN',
    ts: generateBaseTimestamp(),
  };
}

/**
 * Generate a batch of synthetic events using session-based generation.
 * Creates a user pool with heavy-tailed activity distribution, then
 * generates sessions with realistic funnel progression for each user.
 * Returns exactly `count` events.
 *
 * @param {number} count - Number of events to generate
 * @param {number} startIndex - Kept for API compatibility (unused)
 * @returns {object[]} Array of event documents
 */
function generateBatch(count, startIndex = 0) {
  if (count <= 0) return [];

  const allEvents = [];
  let userCounter = 0;
  let sessionCounter = 0;

  while (allEvents.length < count) {
    userCounter++;
    const userId = `u_${String(userCounter).padStart(6, '0')}`;
    const activityBudget = generateActivityCount();
    const device = selectDevice();

    let userEventCount = 0;
    while (userEventCount < activityBudget && allEvents.length < count) {
      sessionCounter++;
      const sessionId = `s_${String(sessionCounter).padStart(6, '0')}`;
      const remaining = Math.min(
        activityBudget - userEventCount,
        count - allEvents.length
      );

      const sessionEvents = generateSessionEvents(userId, sessionId, device, remaining);

      // Assign timestamps: session events are 5-60 seconds apart
      const baseTs = generateBaseTimestamp();
      let offset = 0;
      for (const event of sessionEvents) {
        event.ts = new Date(baseTs.getTime() + offset);
        offset += 5000 + Math.random() * 55000;
      }

      allEvents.push(...sessionEvents);
      userEventCount += sessionEvents.length;
    }
  }

  return allEvents;
}

/**
 * Generate events with distribution analysis.
 * @param {number} count - Number of events to generate
 * @returns {object} Object with events array and stats
 */
function generateWithStats(count) {
  const events = generateBatch(count);

  // Distribution analysis
  const typeDist = {};
  const deviceDist = {};
  const categoryDist = {};
  let totalPrice = 0;
  let totalQuantity = 0;

  events.forEach((event) => {
    typeDist[event.type] = (typeDist[event.type] || 0) + 1;
    deviceDist[event.device] = (deviceDist[event.device] || 0) + 1;
    categoryDist[event.category] = (categoryDist[event.category] || 0) + 1;
    totalPrice += event.price;
    totalQuantity += event.quantity;
  });

  return {
    events,
    stats: {
      count,
      typeDistribution: typeDist,
      deviceDistribution: deviceDist,
      categoryDistribution: categoryDist,
      avgPrice: totalPrice / count,
      avgQuantity: totalQuantity / count,
    },
  };
}

/**
 * Validate a single event against the expected schema.
 * @param {object} event - Event to validate
 * @returns {boolean} True if valid
 */
function validateEvent(event) {
  const requiredFields = [
    'eventId', 'userId', 'sessionId', 'type', 'productId',
    'category', 'price', 'quantity', 'device', 'country', 'ts',
  ];

  // Check all required fields present
  for (const field of requiredFields) {
    if (event[field] === undefined || event[field] === null) {
      return false;
    }
  }

  // Validate event type
  if (!EVENT_TYPES.includes(event.type)) {
    return false;
  }

  // Validate device
  if (!DEVICES.includes(event.device)) {
    return false;
  }

  // Validate country
  if (event.country !== 'IN') {
    return false;
  }

  // Validate quantity is positive integer
  if (!Number.isInteger(event.quantity) || event.quantity < 1) {
    return false;
  }

  // Validate price is positive
  if (event.price <= 0 || typeof event.price !== 'number') {
    return false;
  }

  // Validate eventId is a non-empty string
  if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
    return false;
  }

  // Validate ts is a Date object
  if (!(event.ts instanceof Date) || isNaN(event.ts)) {
    return false;
  }

  return true;
}

// ─── CLI support ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || '') === __filename) {
  const count = parseInt(process.argv[2]) || 150000;
  const result = generateWithStats(count);

  console.log(`Generated ${result.stats.count} synthetic events`);
  console.log('Type distribution:', JSON.stringify(result.stats.typeDistribution));
  console.log('Device distribution:', JSON.stringify(result.stats.deviceDistribution));
  console.log('Category distribution:', JSON.stringify(result.stats.categoryDistribution));
  console.log('Avg price: $' + result.stats.avgPrice.toFixed(2));
  console.log('Avg quantity: ' + result.stats.avgQuantity.toFixed(2));

  // Validation
  let allValid = true;
  result.events.slice(0, 10).forEach((event, i) => {
    const valid = validateEvent(event);
    if (!valid) {
      console.log(`  Event ${i}: FAILED validation`);
      allValid = false;
    }
  });
  if (allValid) {
    console.log('  First 10 events: all pass schema validation');
  }
}

export { generateEvent, generateBatch, generateWithStats, validateEvent };

// When CommonJS require is used (for compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateEvent, generateBatch, generateWithStats, validateEvent };
}
