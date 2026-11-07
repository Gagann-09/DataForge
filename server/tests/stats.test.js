import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateStatsQuery,
    createStatsHandler
} from '../src/pipelines/stats.js';

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

function createFakeCollection(documents = []) {
    return {
        async estimatedDocumentCount() {
            return documents.length;
        },
        async countDocuments(filter = {}) {
            return documents.filter((doc) => {
                if (filter.ts) {
                    if (filter.ts.$gte && doc.ts < filter.ts.$gte) return false;
                    if (filter.ts.$lte && doc.ts > filter.ts.$lte) return false;
                }
                return true;
            }).length;
        },
        async findOne(query, options = {}) {
            if (documents.length === 0) return null;
            const sorted = [...documents].sort((a, b) => b.ts.getTime() - a.ts.getTime());
            return sorted[0];
        },
        aggregate(pipeline = []) {
            let workingDocs = [...documents];

            for (const stage of pipeline) {
                if (stage.$match) {
                    const match = stage.$match;
                    workingDocs = workingDocs.filter((doc) => {
                        if (match.ts) {
                            if (match.ts.$gte && doc.ts < match.ts.$gte) return false;
                            if (match.ts.$lte && doc.ts > match.ts.$lte) return false;
                        }
                        return true;
                    });
                } else if (stage.$group) {
                    const groups = new Map();
                    for (const doc of workingDocs) {
                        const key = doc.category;
                        groups.set(key, (groups.get(key) || 0) + 1);
                    }
                    workingDocs = Array.from(groups.entries()).map(([k, count]) => ({
                        _id: k,
                        count
                    }));
                } else if (stage.$sort) {
                    workingDocs.sort((a, b) => b.count - a.count);
                } else if (stage.$limit) {
                    workingDocs = workingDocs.slice(0, stage.$limit);
                }
            }

            return {
                async toArray() {
                    return workingDocs;
                }
            };
        }
    };
}

// ---------------------------------------------------------------------------
// Layer 1: Query Validation Tests
// ---------------------------------------------------------------------------

test('Stats Layer 1: validates default query parameters', () => {
    const result = validateStatsQuery({});
    assert.equal(result.ok, true);
    assert.equal(result.params.to, null);
    assert.equal(result.params.windowMinutes, 5);
});

test('Stats Layer 1: accepts valid ISO timestamp with UTC Z', () => {
    const result = validateStatsQuery({ to: '2026-11-07T09:20:00Z' });
    assert.equal(result.ok, true);
    assert.ok(result.params.to instanceof Date);
    assert.equal(result.params.to.toISOString(), '2026-11-07T09:20:00.000Z');
});

test('Stats Layer 1: accepts valid ISO timestamp with timezone offset', () => {
    const result = validateStatsQuery({ to: '2026-11-07T09:20:00+05:30' });
    assert.equal(result.ok, true);
    assert.ok(result.params.to instanceof Date);
});

test('Stats Layer 1: accepts valid custom windowMinutes', () => {
    const result1 = validateStatsQuery({ windowMinutes: '1' });
    assert.equal(result1.ok, true);
    assert.equal(result1.params.windowMinutes, 1);

    const result60 = validateStatsQuery({ windowMinutes: '60' });
    assert.equal(result60.ok, true);
    assert.equal(result60.params.windowMinutes, 60);
});

test('Stats Layer 1: rejects malformed or date-only timestamp with INVALID_TIMESTAMP', () => {
    const malformed = validateStatsQuery({ to: 'not-a-date' });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error.code, 'INVALID_TIMESTAMP');

    const dateOnly = validateStatsQuery({ to: '2026-11-07' });
    assert.equal(dateOnly.ok, false);
    assert.equal(dateOnly.error.code, 'INVALID_TIMESTAMP');

    const missingTz = validateStatsQuery({ to: '2026-11-07T09:20:00' });
    assert.equal(missingTz.ok, false);
    assert.equal(missingTz.error.code, 'INVALID_TIMESTAMP');
});

test('Stats Layer 1: rejects non-string timestamp with INVALID_TIMESTAMP', () => {
    const arrayTz = validateStatsQuery({ to: ['2026-11-07T09:20:00Z'] });
    assert.equal(arrayTz.ok, false);
    assert.equal(arrayTz.error.code, 'INVALID_TIMESTAMP');
});

test('Stats Layer 1: rejects invalid windowMinutes with INVALID_WINDOW', () => {
    for (const invalid of ['0', '-5', '61', 'abc', '2.5', '99999999999999999999']) {
        const result = validateStatsQuery({ windowMinutes: invalid });
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'INVALID_WINDOW');
    }
});

test('Stats Layer 1: ignores unknown query parameters safely', () => {
    const result = validateStatsQuery({ extra: 'ignored', windowMinutes: '10' });
    assert.equal(result.ok, true);
    assert.equal(result.params.windowMinutes, 10);
    assert.equal(result.params.extra, undefined);
});

// ---------------------------------------------------------------------------
// Layer 2: Handler Logic Tests
// ---------------------------------------------------------------------------

test('Stats Layer 2: handles empty dataset gracefully', async () => {
    const handler = createStatsHandler(() => createFakeCollection([]));
    const response = await invokeHandler(handler, {});

    assert.equal(response.status, 200);
    assert.equal(response.body.totalEvents, 0);
    assert.equal(response.body.eventsPerMinute, 0);
    assert.equal(response.body.eventsInWindow, 0);
    assert.equal(response.body.window.from, null);
    assert.equal(response.body.window.to, null);
    assert.equal(response.body.window.durationMinutes, 5);
    assert.equal(response.body.topInsight, null);
});

test('Stats Layer 2: computes metrics from latest document when to is omitted', async () => {
    const tLatest = new Date('2026-11-07T12:00:00Z');
    const tInWindow = new Date('2026-11-07T11:58:00Z');
    const tOutWindow = new Date('2026-11-07T11:50:00Z');

    const fixtures = [
        { _id: '1', ts: tLatest, category: 'electronics' },
        { _id: '2', ts: tInWindow, category: 'electronics' },
        { _id: '3', ts: tInWindow, category: 'books' },
        { _id: '4', ts: tOutWindow, category: 'electronics' }
    ];

    const handler = createStatsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, { windowMinutes: '5' });

    assert.equal(response.status, 200);
    assert.equal(response.body.totalEvents, 4);
    assert.equal(response.body.eventsInWindow, 3);
    assert.equal(response.body.window.durationMinutes, 5);
    assert.equal(response.body.window.to, tLatest.toISOString());
    assert.equal(response.body.window.from, new Date('2026-11-07T11:55:00Z').toISOString());
    assert.equal(response.body.eventsPerMinute, 0.6); // 3 events / 5 min = 0.60
    assert.ok(response.body.topInsight);
    assert.equal(response.body.topInsight.type, 'top_category');
    assert.equal(response.body.topInsight.category, 'electronics');
    assert.equal(response.body.topInsight.events, 2);
    assert.equal(response.body.topInsight.share, 66.7);
});

test('Stats Layer 2: respects explicit to timestamp', async () => {
    const t1 = new Date('2026-11-07T10:00:00Z');
    const t2 = new Date('2026-11-07T10:03:00Z');
    const t3 = new Date('2026-11-07T12:00:00Z');

    const fixtures = [
        { _id: '1', ts: t1, category: 'clothing' },
        { _id: '2', ts: t2, category: 'clothing' },
        { _id: '3', ts: t3, category: 'electronics' }
    ];

    const handler = createStatsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, {
        to: '2026-11-07T10:05:00Z',
        windowMinutes: '10'
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.totalEvents, 3);
    assert.equal(response.body.eventsInWindow, 2);
    assert.equal(response.body.eventsPerMinute, 0.2); // 2 events / 10 min = 0.20
    assert.equal(response.body.topInsight.category, 'clothing');
});

test('Stats Layer 2: returns topInsight null when 0 events fall into window', async () => {
    const fixtures = [
        { _id: '1', ts: new Date('2026-11-07T08:00:00Z'), category: 'home' }
    ];

    const handler = createStatsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, {
        to: '2026-11-07T12:00:00Z',
        windowMinutes: '5'
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.totalEvents, 1);
    assert.equal(response.body.eventsInWindow, 0);
    assert.equal(response.body.eventsPerMinute, 0);
    assert.equal(response.body.topInsight, null);
});

test('Stats Layer 2: handles database query failure with HTTP 500 and QUERY_FAILED', async () => {
    const failingCollection = {
        async findOne() {
            throw new Error('Database connection failed');
        }
    };

    const handler = createStatsHandler(() => failingCollection);
    const response = await invokeHandler(handler, {});

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
        error: {
            code: 'QUERY_FAILED',
            message: 'Unable to retrieve system statistics'
        }
    });
});

