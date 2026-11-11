import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { createStatsHandler } from '../src/pipelines/stats.js';

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

test('Integration: live read-only verification of /api/stats against existing dataset', async () => {
    let client = null;

    try {
        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const initialCount = await collection.countDocuments();
        assert.ok(initialCount >= 150000, 'Database should contain baseline dataset with at least 150000 events');

        const handler = createStatsHandler(() => collection);

        // 1. Default request without query parameters
        const resDefault = await invokeHandler(handler, {});
        assert.equal(resDefault.status, 200);
        assert.equal(resDefault.body.totalEvents, initialCount);
        assert.equal(typeof resDefault.body.eventsPerMinute, 'number');
        assert.ok(resDefault.body.eventsPerMinute >= 0);
        assert.equal(resDefault.body.window.durationMinutes, 5);
        assert.ok(typeof resDefault.body.window.to === 'string');
        assert.ok(typeof resDefault.body.window.from === 'string');

        // 2. Custom window request
        const resWindow = await invokeHandler(handler, { windowMinutes: '30' });
        assert.equal(resWindow.status, 200);
        assert.equal(resWindow.body.totalEvents, initialCount);
        assert.equal(resWindow.body.window.durationMinutes, 30);

        // Verify dataset integrity after execution
        const finalCount = await collection.countDocuments();
        assert.equal(finalCount, initialCount, 'Database document count must remain strictly unchanged');
    } finally {
        if (client) {
            await client.close();
        }
    }
});

