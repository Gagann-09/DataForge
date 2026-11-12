// server/scripts/seed.js
// Database seeder for dataforge — generates and inserts synthetic clickstream events
// Uses the MongoDB native driver and the event generator from generate.js

import { MongoClient, MongoBulkWriteError } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { generateWithStats } from './generate.js';
import { createIndexes } from './indexes.js';

// Load environment variables from server/.env (if available) or process env
dotenv.config();

// Configuration from environment
const SEED_COUNT = parseInt(process.env.SEED_COUNT, 10) || 150000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'dataforge';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'events';

// Batching control for memory management
const BATCH_SIZE = 5000; // Insert in batches of 5000 documents
const MAX_CONSECUTIVE_ZERO_INSERT_BATCHES = 5;

/**
 * Sanitize a MongoDB URI by redacting username and password credentials.
 * Handles standard and SRV formats, URL-encoded characters, and edge cases.
 *
 * @param {string} uri - Raw connection string
 * @returns {string} Sanitized connection string safe for logging
 */
function sanitizeUri(uri) {
  if (!uri || typeof uri !== 'string') {
    return '';
  }
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)(?:[^\/\s?]*@)/gi, '$1***:***@');
}

/**
 * Sanitize an error or message so credentials cannot appear in terminal or CI output.
 * Redacts credentials from error messages, stack traces, and strings while preserving diagnostic context.
 *
 * @param {Error|string|unknown} error - Error object or string
 * @returns {Error|string} Sanitized error object or string
 */
function sanitizeError(error) {
  if (!error) return error;

  const redact = (str) => {
    if (typeof str !== 'string') return str;
    return str
      // 1. Redact MongoDB URIs (standard & SRV, including encoded chars and edge cases)
      .replace(/(mongodb(?:\+srv)?:\/\/)(?:[^\/\s?]*@)/gi, '$1***:***@')
      // 2. Redact Authorization headers and credentials (Bearer / Basic / Token)
      .replace(/(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s,;]+/gi, '$1***')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
      // 3. Redact common secret-bearing key-value assignments (quoted or unquoted values)
      .replace(
        /(\b(?:password|passwd|pwd|access_token|refresh_token|auth_token|api_key|apikey|client_secret|api_secret|secret_key|secret|token)\s*[:=]\s*)(?:(['"])([^\r\n]*?)\2|([^\s&,;'"<>#]+))/gi,
        (match, prefix, quote) => (quote ? `${prefix}${quote}***${quote}` : `${prefix}***`)
      )
      // 4. Redact sensitive query parameters in arbitrary HTTP/HTTPS URLs
      .replace(
        /([?&](?:token|access_token|refresh_token|auth_token|api_key|apikey|secret|client_secret|password|pwd)=)([^&\s"'`<>#]+)/gi,
        '$1***'
      );
  };

  if (typeof error === 'string') {
    return redact(error);
  }

  if (error instanceof Error) {
    const cleanError = new Error(redact(error.message));
    cleanError.name = error.name;
    if (error.code !== undefined) cleanError.code = error.code;
    if (error.stack) {
      cleanError.stack = redact(error.stack);
    }
    return cleanError;
  }

  if (typeof error === 'object') {
    try {
      return JSON.parse(redact(JSON.stringify(error)));
    } catch {
      return redact(String(error));
    }
  }

  return redact(String(error));
}

/**
 * Seed the database with synthetic clickstream events.
 *
 * Requirements met:
 * - Loads environment variables using dotenv
 * - Reads SEED_COUNT from environment
 * - Connects using the MongoDB native driver (no deprecated options)
 * - Generates the requested dataset using generate.js
 * - Inserts documents using insertMany with ordered: false
 * - Handles MongoBulkWriteError appropriately (preserves partial successes)
 * - Distinguishes duplicate key errors from permanent write errors
 * - Accurately tracks successfully inserted documents
 * - Prevents infinite retry loops under permanent errors
 * - Reports successful insertion and failure counts
 * - Creates indexes automatically via createIndexes from ./indexes.js
 * - Closes MongoDB connections in finally blocks
 * - Uses batching to control memory consumption
 * - Enforces unique eventId constraint
 * - Does not delete existing collections or existing records
 * - Does not automatically clear the database
 */
async function seedDatabase() {
  let client;

  try {
    console.log('Seed configuration:');
    console.log(`  SEED_COUNT: ${SEED_COUNT}`);
    console.log(`  MONGODB_URI: ${sanitizeUri(MONGODB_URI)}`);
    console.log(`  DB_NAME: ${DB_NAME}`);
    console.log(`  COLLECTION_NAME: ${COLLECTION_NAME}`);
    console.log('');

    // Connect to MongoDB using native driver (deprecated options removed)
    client = await MongoClient.connect(MONGODB_URI);

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Check if collection already has data — do not clear existing records
    const existingCount = await collection.countDocuments({});
    console.log(`Existing documents in ${COLLECTION_NAME}: ${existingCount}`);

    if (existingCount > 0) {
      console.log('⚠️  Collection already contains data. Seed will not clear existing records.');
      console.log('Proceeding to generate additional events up to SEED_COUNT...');
    }

    // Generate the dataset in batches to control memory
    let totalInserted = 0;
    let totalDuplicates = 0;
    let totalOtherErrors = 0;
    let batchNum = 0;
    let consecutiveZeroInsertBatches = 0;

    while (totalInserted < SEED_COUNT) {
      batchNum++;
      const remaining = SEED_COUNT - totalInserted;
      const currentBatchSize = Math.min(BATCH_SIZE, remaining);

      console.log(`Generating batch ${batchNum}: ${currentBatchSize} events...`);

      // Generate batch of events
      const { events } = generateWithStats(currentBatchSize);

      let batchInserted = 0;
      let batchDuplicates = 0;
      let batchOtherErrors = 0;

      try {
        // Attempt insertion with unordered batch for best error handling
        // ordered: false means continue inserting even if some documents fail
        const result = await collection.insertMany(events, {
          ordered: false,
        });
        batchInserted = result.insertedCount || 0;
      } catch (err) {
        // Handle MongoBulkWriteError / BulkWriteError to preserve partial successes
        if (err instanceof MongoBulkWriteError || err.name === 'MongoBulkWriteError' || err.name === 'BulkWriteError' || err.result) {
          const bulkResult = err.result;
          batchInserted = bulkResult?.insertedCount ?? err.insertedCount ?? 0;
          const writeErrors = err.writeErrors || (bulkResult && typeof bulkResult.getWriteErrors === 'function' ? bulkResult.getWriteErrors() : []);

          for (const writeErr of writeErrors) {
            // Error code 11000 / 11001 indicates duplicate key constraint violation
            if (writeErr.code === 11000 || writeErr.code === 11001) {
              batchDuplicates++;
            } else {
              batchOtherErrors++;
              const cleanWriteMsg = sanitizeError(writeErr.errmsg || writeErr.message);
              console.error(`    Write error in batch ${batchNum} [code ${writeErr.code}]: ${cleanWriteMsg}`);
            }
          }
        } else {
          // Fatal non-bulk error (connection dropped, auth failure, etc.)
          const cleanErr = sanitizeError(err);
          console.error(`Fatal database error during batch ${batchNum}:`, cleanErr?.message || cleanErr);
          throw cleanErr;
        }
      }

      totalInserted += batchInserted;
      totalDuplicates += batchDuplicates;
      totalOtherErrors += batchOtherErrors;

      if (batchDuplicates > 0) {
        console.log(`  Batch ${batchNum}: ${batchDuplicates} duplicate eventId(s) skipped`);
      }
      if (batchOtherErrors > 0) {
        console.log(`  Batch ${batchNum}: ${batchOtherErrors} non-duplicate write error(s) encountered`);
      }

      const completionPct = ((totalInserted / SEED_COUNT) * 100);
      console.log(`  Batch ${batchNum}: inserted=${batchInserted}, running total: ${totalInserted}/${SEED_COUNT} (${completionPct.toFixed(1)}%)`);

      // Termination safeguard under permanent errors / zero-progress batches
      if (batchInserted === 0) {
        consecutiveZeroInsertBatches++;
        if (batchOtherErrors > 0 && consecutiveZeroInsertBatches >= 3) {
          console.error(`Aborting seed: ${consecutiveZeroInsertBatches} consecutive batches failed with non-duplicate write errors.`);
          break;
        }
        if (consecutiveZeroInsertBatches >= MAX_CONSECUTIVE_ZERO_INSERT_BATCHES) {
          console.warn(`Aborting seed: ${consecutiveZeroInsertBatches} consecutive batches produced 0 insertions.`);
          break;
        }
      } else {
        consecutiveZeroInsertBatches = 0;
      }
    }

    // Create indexes automatically after insertion
    console.log('\nCreating indexes...');
    await createIndexes();

    const finalCount = await collection.countDocuments({});
    const totalFailed = totalDuplicates + totalOtherErrors;

    // Check whether the requested seed count was fully satisfied
    if (totalInserted < SEED_COUNT) {
      console.error('\n❌ Seed incomplete!');
      console.error(`  Total documents in collection: ${finalCount}`);
      console.error(`  Successfully inserted this run: ${totalInserted}`);
      console.error(`  Skipped duplicate eventIds: ${totalDuplicates}`);
      console.error(`  Failed (other errors): ${totalOtherErrors}`);
      console.error(`  Target seed count: ${SEED_COUNT}`);
      console.error(`  Shortfall: ${SEED_COUNT - totalInserted} event(s) missing`);

      throw new Error(
        `Seeding incomplete: successfully inserted ${totalInserted} of ${SEED_COUNT} target events (${SEED_COUNT - totalInserted} missing).`
      );
    }

    console.log('\nSeed complete!');
    console.log(`  Total documents in collection: ${finalCount}`);
    console.log(`  Successfully inserted this run: ${totalInserted}`);
    console.log(`  Skipped duplicate eventIds: ${totalDuplicates}`);
    console.log(`  Failed (other errors): ${totalOtherErrors}`);
    console.log(`  Target seed count: ${SEED_COUNT}`);

    return {
      totalInserted,
      totalFailed,
      totalDuplicates,
      totalOtherErrors,
      finalCount,
      seedCount: SEED_COUNT,
    };

  } catch (error) {
    const cleanError = sanitizeError(error);
    console.error('Fatal error during seeding:', cleanError.stack || cleanError.message || cleanError);
    throw cleanError;
  } finally {
    // Always close connection in finally block
    if (client) {
      await client.close();
      console.log('MongoDB connection closed.');
    }
  }
}

/**
 * Validate generator output without database connection.
 * Useful for testing when MongoDB is unavailable.
 */
function validateGenerator() {
  console.log('Validating event generator...');

  const result = generateWithStats(100);
  const { stats } = result;

  // Schema validation
  const requiredFields = [
    'eventId', 'userId', 'sessionId', 'type', 'productId',
    'category', 'price', 'quantity', 'device', 'country', 'ts',
  ];

  let schemaValid = true;
  result.events.forEach((event, i) => {
    const missingFields = requiredFields.filter((field) => event[field] === undefined);
    if (missingFields.length > 0) {
      console.log(`  Event ${i}: missing fields ${missingFields.join(', ')}`);
      schemaValid = false;
    }
  });

  if (schemaValid) {
    console.log(`  Schema validation: PASSED (all ${requiredFields.length} required fields present)`);
  } else {
    console.log('  Schema validation: FAILED');
  }

  // Event type distribution
  const validTypes = ['view', 'add_to_cart', 'purchase'];
  const allTypesValid = stats.typeDistribution &&
    Object.keys(stats.typeDistribution).every(
      (k) => validTypes.includes(k)
    );

  console.log(`  Event type distribution: ${Object.keys(
    stats.typeDistribution
  ).length} types detected, all valid: ${allTypesValid}`);

  // Device distribution
  const validDevices = ['mobile', 'desktop', 'tablet'];
  const allDevicesValid = stats.deviceDistribution &&
    Object.keys(stats.deviceDistribution).every(
      (k) => validDevices.includes(k)
    );

  console.log(`  Device distribution: ${Object.keys(
    stats.deviceDistribution
  ).length} devices detected, all valid: ${allDevicesValid}`);

  // Country validation (always IN per schema)
  const allCountriesValid = result.events.every((e) => e.country === 'IN');

  console.log(`  Country: IN (valid: ${allCountriesValid})`);

  // Price and quantity validation
  const hasValidPrices = stats.avgPrice > 0;
  const hasValidQuantity = stats.avgQuantity > 0;

  console.log(`  Prices: avg=$${stats.avgPrice.toFixed(2)} (positive: ${hasValidPrices})`);
  console.log(`  Quantities: avg=${stats.avgQuantity.toFixed(1)} (positive: ${hasValidQuantity})`);

  // Timestamp validation
  const timestamps = result.events.map((e) => e.ts.getTime());
  const minTs = new Date(Math.min(...timestamps));
  const maxTs = new Date(Math.max(...timestamps));
  const now = new Date();
  // Allow a small future buffer (5 minutes) for session timestamp offsets within multi-event sessions
  const maxAllowedTs = new Date(now.getTime() + 5 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const timestampsInRange = timestamps.every(
    (ts) => new Date(ts) <= maxAllowedTs && new Date(ts) >= sevenDaysAgo
  );

  console.log(
    `  Timestamps: range [${minTs.toISOString()}, ${maxTs.toISOString()}]`,
    `within last 7 days: ${timestampsInRange}`
  );

  // Summary
  console.log('\nGenerator validation summary:');
  console.log(`  - Event count: ${result.stats.count}`);
  console.log(`  - Type distribution: ${JSON.stringify(stats.typeDistribution)}`);
  console.log(`  - Device distribution: ${JSON.stringify(stats.deviceDistribution)}`);
  console.log(`  - Category distribution: ${JSON.stringify(stats.categoryDistribution)}`);
  console.log(`  - Avg price: $${stats.avgPrice.toFixed(2)}`);
  console.log(`  - Avg quantity: ${stats.avgQuantity.toFixed(1)}`);

  return {
    schemaValid,
    allTypesValid,
    allDevicesValid,
    timestampsInRange,
    hasValidPrices,
    hasValidQuantity,
  };
}

// CLI support (Node.js ESM-compatible entrypoint check)
const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || '') === __filename) {
  const action = process.argv[2];

  switch (action) {
    case 'validate':
      validateGenerator();
      break;
    case 'seed':
      seedDatabase().then(() => process.exit(0)).catch((err) => {
        const cleanErr = sanitizeError(err);
        console.error('Seed failed:', cleanErr.stack || cleanErr.message || cleanErr);
        process.exit(1);
      });
      break;
    default:
      console.log('Usage: node seed.js <validate|seed>');
      process.exit(1);
  }
}

// Export for programmatic use
export { seedDatabase, validateGenerator, SEED_COUNT, sanitizeUri, sanitizeError };
