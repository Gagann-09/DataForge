import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFunnelPipeline,
    buildHourlyBuckets,
    calculateRate
} from '../src/pipelines/funnel.js';

test('matches the exact inclusive 24-hour window', () => {
    const from = new Date('2026-11-06T09:20:00Z');
    const to = new Date('2026-11-07T09:20:00Z');

    const pipeline = buildFunnelPipeline(from, to);

    assert.deepEqual(pipeline[0].$match.ts, {
        $gte: from,
        $lte: to
    });
});


test('groups events into UTC hourly buckets', () => {
    const pipeline = buildFunnelPipeline(
        new Date('2026-11-06T00:00:00Z'),
        new Date('2026-11-07T00:00:00Z')
    );

    assert.deepEqual(
        pipeline[1].$group._id.$dateTrunc,
        {
            date: '$ts',
            unit: 'hour',
            timezone: 'UTC'
        }
    );
});

test('counts all three funnel event types', () => {
    const group = buildFunnelPipeline(
        new Date('2026-11-06T00:00:00Z'),
        new Date('2026-11-07T00:00:00Z')
    )[1].$group;

    assert.deepEqual(group.views.$sum.$cond, [
        { $eq: ['$type', 'view'] }, 1, 0
    ]);

    assert.deepEqual(group.addToCarts.$sum.$cond, [
        { $eq: ['$type', 'add_to_cart'] }, 1, 0
    ]);

    assert.deepEqual(group.purchases.$sum.$cond, [
        { $eq: ['$type', 'purchase'] }, 1, 0
    ]);
});

test('returns null for zero-denominator conversion rates', () => {
    assert.equal(calculateRate(0, 0), null);
    assert.equal(calculateRate(5, 0), null);
    assert.equal(calculateRate(3, 10), 0.3);
});

test('zero-fills missing hours and preserves chronological order', () => {
    const from = new Date('2026-11-06T09:20:00Z');
    const to = new Date('2026-11-07T09:20:00Z');

    const buckets = buildHourlyBuckets(from, to, [
        {
            _id: new Date('2026-11-06T10:00:00Z'),
            views: 10,
            addToCarts: 4,
            purchases: 2
        }
    ]);

    assert.equal(buckets.length, 25);
    assert.equal(buckets[0].hour, '2026-11-06T09:00:00.000Z');
    assert.equal(buckets[1].hour, '2026-11-06T10:00:00.000Z');
    assert.equal(buckets[1].cartRate, 0.4);
    assert.equal(buckets[1].purchaseRate, 0.5);
    assert.equal(buckets[1].overallRate, 0.2);
    assert.equal(buckets[2].views, 0);
    assert.equal(buckets[2].cartRate, null);
    assert.equal(buckets[2].purchaseRate, null);
    assert.equal(buckets[2].overallRate, null);
    assert.equal(buckets[24].hour, '2026-11-07T09:00:00.000Z');
});

test('handles an entirely empty aggregation result', () => {
    const from = new Date('2026-11-06T09:20:00Z');
    const to = new Date('2026-11-07T09:20:00Z');

    const buckets = buildHourlyBuckets(from, to, []);

    assert.equal(buckets.length, 25);
    assert.ok(buckets.every((bucket) =>
        bucket.views === 0 &&
        bucket.addToCarts === 0 &&
        bucket.purchases === 0 &&
        bucket.cartRate === null &&
        bucket.purchaseRate === null &&
        bucket.overallRate === null
    ));
});
