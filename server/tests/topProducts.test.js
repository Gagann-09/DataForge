import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildTopProductsPipeline,
    parseIsoTimestamp
} from '../src/pipelines/topProducts.js';

test('accepts a valid UTC ISO timestamp', () => {
    const result = parseIsoTimestamp('2026-11-07T09:20:00Z');

    assert.ok(result instanceof Date);
    assert.equal(result.toISOString(), '2026-11-07T09:20:00.000Z');
});

test('accepts an ISO timestamp with timezone offset', () => {
    const result = parseIsoTimestamp('2026-11-07T14:50:00+05:30');

    assert.equal(result.toISOString(), '2026-11-07T09:20:00.000Z');
});

test('rejects impossible calendar dates', () => {
    assert.equal(parseIsoTimestamp('2026-02-30T12:00:00Z'), null);
});

test('rejects timestamps without timezone information', () => {
    assert.equal(parseIsoTimestamp('2026-11-07T09:20:00'), null);
});

test('rejects malformed timestamps', () => {
    assert.equal(parseIsoTimestamp('not-a-date'), null);
    assert.equal(parseIsoTimestamp(''), null);
    assert.equal(parseIsoTimestamp(null), null);
    assert.equal(
        parseIsoTimestamp('2026-11-07T09:20:00+14:30'),
        null
    );
    assert.equal(
        parseIsoTimestamp('2026-11-07T09:20:00+15:00'),
        null
    );
    assert.equal(
        parseIsoTimestamp('2026-11-07T09:20:00+23:59'),
        null
    );
    assert.ok(
        parseIsoTimestamp('2026-11-07T09:20:00+14:00') instanceof Date
    );
});

test('builds an inclusive 24-hour aggregation pipeline', () => {
    const from = new Date('2026-11-06T09:20:00.000Z');
    const to = new Date('2026-11-07T09:20:00.000Z');

    const pipeline = buildTopProductsPipeline(from, to);

    assert.deepEqual(pipeline[0], {
        $match: {
            ts: {
                $gte: from,
                $lte: to
            }
        }
    });
});

test('counts all event types and calculates purchase-only revenue', () => {
    const pipeline = buildTopProductsPipeline(
        new Date('2026-11-06T00:00:00Z'),
        new Date('2026-11-07T00:00:00Z')
    );

    const group = pipeline.find((stage) => stage.$group).$group;

    assert.deepEqual(group.events, { $sum: 1 });
    assert.deepEqual(group.views.$sum.$cond, [
        { $eq: ['$type', 'view'] },
        1,
        0
    ]);
    assert.deepEqual(group.addToCarts.$sum.$cond, [
        { $eq: ['$type', 'add_to_cart'] },
        1,
        0
    ]);
    assert.deepEqual(group.purchases.$sum.$cond, [
        { $eq: ['$type', 'purchase'] },
        1,
        0
    ]);
    assert.deepEqual(group.revenue.$sum.$cond, [
        { $eq: ['$type', 'purchase'] },
        { $multiply: ['$price', '$quantity'] },
        0
    ]);
});

test('sorts deterministically and limits results to ten products', () => {
    const pipeline = buildTopProductsPipeline(
        new Date('2026-11-06T00:00:00Z'),
        new Date('2026-11-07T00:00:00Z')
    );

    assert.deepEqual(pipeline.at(-2), {
        $sort: {
            events: -1,
            productId: 1
        }
    });

    assert.deepEqual(pipeline.at(-1), {
        $limit: 10
    });
});