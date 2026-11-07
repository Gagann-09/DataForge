import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventsHandler } from '../src/pipelines/events.js';
import { connectToDatabase, closeDatabase } from '../src/db.js';

function invokeHandler(handler, query = {}) {
    return new Promise((resolve) => {
        const req = {
            method: 'GET',
            url: '/events',
            query
        };

        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(body) {
                resolve({
                    status: this.statusCode,
                    body
                });
            }
        };

        handler(req, res).catch((error) => {
            resolve({
                status: 500,
                body: { error: error.message }
            });
        });
    });
}

test('Integration: live read-only verification against existing dataset', async () => {
    await connectToDatabase();

    try {
        const handler = createEventsHandler();

        // 1. Unfiltered page 1
        const defaultRes = await invokeHandler(handler, {});
        assert.equal(defaultRes.status, 200);
        assert.equal(defaultRes.body.page, 1);
        assert.equal(defaultRes.body.limit, 25);
        assert.equal(defaultRes.body.total, 150002);
        assert.equal(defaultRes.body.totalPages, 6001);
        assert.equal(defaultRes.body.data.length, 25);
        assert.equal('_id' in defaultRes.body.data[0], false);
        assert.deepEqual(defaultRes.body.filters, {
            type: null,
            from: null,
            to: null
        });

        // 2. Filter by single event type
        const typeRes = await invokeHandler(handler, { type: 'purchase', limit: '10' });
        assert.equal(typeRes.status, 200);
        assert.equal(typeRes.body.limit, 10);
        assert.equal(typeRes.body.data.length, 10);
        assert.ok(typeRes.body.data.every((doc) => doc.type === 'purchase'));
        assert.deepEqual(typeRes.body.filters.type, ['purchase']);

        // 3. Filter by multiple event types
        const multiTypeRes = await invokeHandler(handler, { type: 'view,add_to_cart', limit: '10' });
        assert.equal(multiTypeRes.status, 200);
        assert.ok(multiTypeRes.body.data.every((doc) => doc.type === 'view' || doc.type === 'add_to_cart'));
        assert.deepEqual(multiTypeRes.body.filters.type, ['view', 'add_to_cart']);

        // 4. Filter by date range (inclusive)
        const dateRes = await invokeHandler(handler, {
            from: '2026-11-06T09:20:00.000Z',
            to: '2026-11-07T09:20:00.000Z',
            limit: '10'
        });
        assert.equal(dateRes.status, 200);
        assert.ok(dateRes.body.total > 0);
        assert.ok(dateRes.body.data.every((doc) => {
            const time = new Date(doc.ts).getTime();
            return time >= new Date('2026-11-06T09:20:00.000Z').getTime() &&
                   time <= new Date('2026-11-07T09:20:00.000Z').getTime();
        }));

        // 5. Past last page request
        const pastRes = await invokeHandler(handler, { page: '7000' });
        assert.equal(pastRes.status, 200);
        assert.equal(pastRes.body.page, 7000);
        assert.equal(pastRes.body.total, 150002);
        assert.equal(pastRes.body.totalPages, 6001);
        assert.deepEqual(pastRes.body.data, []);
    } finally {
        await closeDatabase();
    }
});

