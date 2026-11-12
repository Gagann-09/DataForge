import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ORDERED_SEGMENTS, createSegmentsHandler } from '../src/pipelines/segments.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'dataforge';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'events';

function createMockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

async function invokeHandler(handler, query = {}) {
    const req = { query };
    const res = createMockResponse();
    await handler(req, res);
    return {
        status: res.statusCode,
        body: res.body
    };
}

test('Integration: live read-only verification of /api/p3/segments against existing dataset', async () => {
    let client = null;

    try {
        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // 1. Assert initial document count
        const initialCount = await collection.countDocuments();
        assert.ok(initialCount >= 150000, 'Database should contain baseline dataset with at least 150000 events');

        // 2. Independently calculate ground truths
        const distinctUsers = await collection.distinct('userId');
        const totalDistinctUsers = distinctUsers.length;
        assert.ok(totalDistinctUsers >= 500, 'Total distinct users should be at least 500');

        const purchasers = await collection.distinct('userId', { type: 'purchase' });
        const independentNonPurchaserCount = totalDistinctUsers - purchasers.length;

        const revenueAgg = await collection.aggregate([
            { $match: { type: 'purchase' } },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $multiply: ['$price', '$quantity'] } }
                }
            }
        ]).toArray();
        const independentRevenue = Number((revenueAgg[0]?.totalRevenue ?? 0).toFixed(2));

        // 3. Invoke P3 handler
        const handler = createSegmentsHandler(() => collection);
        const response = await invokeHandler(handler, {});

        assert.equal(response.status, 200);
        assert.ok(response.body && Array.isArray(response.body.data));
        assert.equal(response.body.data.length, 5);

        const segments = response.body.data;
        const segmentNames = segments.map((s) => s.segment);
        assert.deepEqual(segmentNames, ORDERED_SEGMENTS, 'Must return all five approved segments in order');

        // 4. Verify each segment shape and numeric types
        for (const seg of segments) {
            assert.ok(typeof seg.segment === 'string');
            assert.ok(typeof seg.users === 'number' && seg.users >= 0);
            assert.ok(typeof seg.totalSpend === 'number' && seg.totalSpend >= 0);
            assert.ok(typeof seg.avgSpend === 'number' && seg.avgSpend >= 0);
            assert.ok(typeof seg.avgEvents === 'number' && seg.avgEvents >= 0);
        }

        // 5. Reconciliation: Sum of segment users equals distinct userId count
        const sumUsers = segments.reduce((sum, s) => sum + s.users, 0);
        assert.equal(sumUsers, totalDistinctUsers, 'Sum of segment users must equal distinct user count');

        // 6. Reconciliation: Sum of segment totalSpend equals independently calculated purchase revenue
        const sumSpend = Number(segments.reduce((sum, s) => sum + s.totalSpend, 0).toFixed(2));
        assert.equal(sumSpend, independentRevenue, 'Sum of segment totalSpend must equal independent purchase revenue');

        // 7. Non-purchaser segment verification
        const noPurchase = segments.find((s) => s.segment === 'no_purchase');
        assert.ok(noPurchase);
        assert.equal(noPurchase.users, independentNonPurchaserCount, 'Must match ground truth non-purchaser count');
        assert.equal(noPurchase.totalSpend, 0, 'Non-purchasers must have 0 total spend');
        assert.equal(noPurchase.avgSpend, 0, 'Non-purchasers must have 0 avg spend');

        // 8. Assert final document count is strictly unchanged
        const finalCount = await collection.countDocuments();
        assert.equal(finalCount, initialCount, 'Database count must remain strictly unchanged');
    } finally {
        if (client) {
            await client.close();
        }
    }
});

