import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ORDERED_SEGMENTS,
    classifyUserSpend,
    buildSegmentsPipeline,
    formatSegments,
    createSegmentsHandler
} from '../src/pipelines/segments.js';

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

// ---------------------------------------------------------------------------
// Unit Tests: Threshold Classification
// ---------------------------------------------------------------------------

test('Segments: classifies zero spend as no_purchase', () => {
    assert.equal(classifyUserSpend(0), 'no_purchase');
});

test('Segments: classifies spend in (0, 3500) as low', () => {
    assert.equal(classifyUserSpend(0.01), 'low');
    assert.equal(classifyUserSpend(1500), 'low');
    assert.equal(classifyUserSpend(3499.99), 'low');
});

test('Segments: boundary test at exactly 3500 classifies as mid', () => {
    assert.equal(classifyUserSpend(3500), 'mid');
    assert.equal(classifyUserSpend(5999.99), 'mid');
});

test('Segments: boundary test at exactly 6000 classifies as high', () => {
    assert.equal(classifyUserSpend(6000), 'high');
    assert.equal(classifyUserSpend(9999.99), 'high');
});

test('Segments: boundary test at exactly 10000 classifies as top', () => {
    assert.equal(classifyUserSpend(10000), 'top');
    assert.equal(classifyUserSpend(25000), 'top');
});

// ---------------------------------------------------------------------------
// Unit Tests: Pipeline Construction
// ---------------------------------------------------------------------------

test('Segments: pipeline correctly groups by userId and calculates spend', () => {
    const pipeline = buildSegmentsPipeline();
    assert.equal(Array.isArray(pipeline), true);
    assert.equal(pipeline.length, 3);

    // Stage 1: Group by userId
    const groupUser = pipeline[0].$group;
    assert.equal(groupUser._id, '$userId');
    assert.deepEqual(groupUser.totalEvents, { $sum: 1 });
    assert.deepEqual(groupUser.totalSpend, {
        $sum: {
            $cond: [
                { $eq: ['$type', 'purchase'] },
                { $multiply: ['$price', '$quantity'] },
                0
            ]
        }
    });

    // Stage 2: Project segment classification
    const project = pipeline[1].$project;
    assert.equal(project.totalEvents, 1);
    assert.equal(project.totalSpend, 1);
    assert.equal(project.segment.$switch.default, 'top');
    assert.equal(project.segment.$switch.branches.length, 4);

    // Stage 3: Group by segment
    const groupSeg = pipeline[2].$group;
    assert.equal(groupSeg._id, '$segment');
    assert.deepEqual(groupSeg.users, { $sum: 1 });
    assert.deepEqual(groupSeg.totalSpend, { $sum: '$totalSpend' });
    assert.deepEqual(groupSeg.totalEvents, { $sum: '$totalEvents' });
});

// ---------------------------------------------------------------------------
// Unit Tests: Formatting & Zero-Filling
// ---------------------------------------------------------------------------

test('Segments: always returns all five approved segments in exact order', () => {
    const rawGroups = [
        { _id: 'high', users: 10, totalSpend: 80000, totalEvents: 3000 },
        { _id: 'no_purchase', users: 5, totalSpend: 0, totalEvents: 20 }
    ];

    const result = formatSegments(rawGroups);
    assert.equal(result.length, 5);

    const names = result.map((s) => s.segment);
    assert.deepEqual(names, ORDERED_SEGMENTS);
    assert.deepEqual(names, ['no_purchase', 'low', 'mid', 'high', 'top']);
});

test('Segments: zero-fills empty segments correctly', () => {
    const result = formatSegments([]);
    assert.equal(result.length, 5);

    for (const seg of result) {
        assert.equal(seg.users, 0);
        assert.equal(seg.totalSpend, 0);
        assert.equal(seg.avgSpend, 0);
        assert.equal(seg.avgEvents, 0);
    }
});

test('Segments: computes avgSpend and avgEvents with 2-decimal precision', () => {
    const rawGroups = [
        { _id: 'low', users: 3, totalSpend: 3000.123, totalEvents: 10 }
    ];

    const result = formatSegments(rawGroups);
    const low = result.find((s) => s.segment === 'low');

    assert.equal(low.users, 3);
    assert.equal(low.totalSpend, 3000.12);
    assert.equal(low.avgSpend, 1000.04);
    assert.equal(low.avgEvents, 3.33);
});

// ---------------------------------------------------------------------------
// Unit Tests: Handler Execution (Mock Collection)
// ---------------------------------------------------------------------------

test('Segments: handler executes pipeline and returns { data } envelope', async () => {
    const fakeRaw = [
        { _id: 'no_purchase', users: 2, totalSpend: 0, totalEvents: 10 },
        { _id: 'low', users: 1, totalSpend: 1500, totalEvents: 50 },
        { _id: 'mid', users: 1, totalSpend: 4500, totalEvents: 80 },
        { _id: 'high', users: 1, totalSpend: 8000, totalEvents: 120 },
        { _id: 'top', users: 1, totalSpend: 15000, totalEvents: 200 }
    ];

    const fakeCollection = {
        aggregate() {
            return {
                async toArray() {
                    return fakeRaw;
                }
            };
        }
    };

    const handler = createSegmentsHandler(() => fakeCollection);
    const response = await invokeHandler(handler);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
    assert.equal(response.body.data.length, 5);
    assert.equal(response.body.data[0].segment, 'no_purchase');
    assert.equal(response.body.data[0].users, 2);
    assert.equal(response.body.data[4].segment, 'top');
    assert.equal(response.body.data[4].users, 1);
});

test('Segments: handler recovers from database failure with HTTP 500', async () => {
    const failingCollection = {
        aggregate() {
            return {
                async toArray() {
                    throw new Error('Database aggregate failed');
                }
            };
        }
    };

    const handler = createSegmentsHandler(() => failingCollection);
    const response = await invokeHandler(handler);

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
        error: {
            code: 'AGGREGATION_FAILED',
            message: 'Unable to retrieve user segmentation'
        }
    });
});

