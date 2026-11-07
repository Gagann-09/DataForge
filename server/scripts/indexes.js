// server/scripts/indexes.js
// MongoDB index creation for the dataforge events collection
// Uses the native MongoDB driver

import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'dataforge';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'events';

/**
 * Create indexes on the events collection.
 * Safe to rerun — createIndex is idempotent and will not fail if indexes already exist.
 *
 * Required indexes:
 *  1. eventId — unique constraint on event identifiers
 *  2. type + timestamp — efficient filtering by event type and time range
 *  3. productId + timestamp — efficient product-centric queries with time filtering
 *  4. userId + timestamp — efficient user-centric queries with time filtering
 *  5. category + timestamp — efficient category-based time-series queries
 *  6. timestamp (standalone) — efficient date-range queries and live statistics
 *
 * Index order matters for query performance. All compound indexes include
 * timestamp second for range queries on time-series data. The standalone
 * timestamp index supports pure date-range scans that cannot use compound
 * indexes efficiently (e.g., live dashboard, explorer date-range filters).
 *
 * @returns {Promise<Array>} Array of created index specifications
 */
async function createIndexes() {
  let client;

  try {
    client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const createdIndexes = [];

    // 1. Unique index on eventId — ensures no duplicate event IDs
    await collection.createIndex(
      { eventId: 1 },
      { unique: true, name: 'eventId_1' }
    );
    createdIndexes.push({ eventId: 1, unique: true, name: 'eventId_1' });

    // 2. Index on type + timestamp — supports queries filtering by event type and time range
    await collection.createIndex(
      { type: 1, ts: -1 },
      { name: 'type_ts_1_minus_1' }
    );
    createdIndexes.push({ type: 1, ts: -1, name: 'type_ts_1_minus_1' });

    // 3. Index on productId + timestamp — supports product-centric time queries
    await collection.createIndex(
      { productId: 1, ts: -1 },
      { name: 'productId_ts_1_minus_1' }
    );
    createdIndexes.push({ productId: 1, ts: -1, name: 'productId_ts_1_minus_1' });

    // 4. Index on userId + timestamp — supports user-centric time queries
    await collection.createIndex(
      { userId: 1, ts: -1 },
      { name: 'userId_ts_1_minus_1' }
    );
    createdIndexes.push({ userId: 1, ts: -1, name: 'userId_ts_1_minus_1' });

    // 5. Index on category + timestamp — supports category-based time queries
    await collection.createIndex(
      { category: 1, ts: -1 },
      { name: 'category_ts_1_minus_1' }
    );
    createdIndexes.push({ category: 1, ts: -1, name: 'category_ts_1_minus_1' });

    // 6. Standalone timestamp index — supports pure date-range scans,
    //    live statistics dashboards, and explorer date-range filters
    await collection.createIndex(
      { ts: -1 },
      { name: 'ts_minus_1' }
    );
    createdIndexes.push({ ts: -1, name: 'ts_minus_1' });

    console.log('Indexes created successfully:');
    createdIndexes.forEach((idx) => {
      const details = idx.unique ? ' (unique)' : '';
      console.log(`  - ${idx.name}${details}`);
    });

    // Print index keys for verification
    const indexInfo = await collection.listIndexes().toArray();
    console.log('\nVerified indexes:');
    indexInfo.forEach((idx) => {
      console.log(`  - ${idx.name}: key=${JSON.stringify(idx.key)}`);
    });

    return createdIndexes;

  } catch (error) {
    console.error('Error creating indexes:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Verify existing indexes on the collection.
 * Safe to call without creating duplicate indexes.
 *
 * @returns {Promise<Array>} Array of existing index specifications
 */
async function verifyIndexes() {
  let client;

  try {
    client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const indexes = await collection.listIndexes().toArray();
    console.log('Existing indexes:');
    indexes.forEach((idx) => {
      console.log(`  - ${idx.name}: key=${JSON.stringify(idx.key)}, unique=${idx.unique || false}`);
    });

    return indexes;
  } catch (error) {
    console.error('Error verifying indexes:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// CLI support
const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || '') === __filename) {
  const action = process.argv[2];

  switch (action) {
    case 'create':
      createIndexes().then(() => process.exit(0)).catch((err) => {
        console.error('Index creation failed:', err);
        process.exit(1);
      });
      break;
    case 'verify':
      verifyIndexes().then(() => process.exit(0)).catch((err) => {
        console.error('Index verification failed:', err);
        process.exit(1);
      });
      break;
    default:
      console.log('Usage: node indexes.js <create|verify>');
      process.exit(1);
  }
}

export { createIndexes, verifyIndexes };
