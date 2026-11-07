import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizeTimestampString,
    validateEventsQuery,
    buildEventsFilter,
    createEventsHandler
} from '../src/pipelines/events.js';

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

function createFakeCollection(documents = []) {
    function matchesFilter(doc, filter) {
        if (!filter) return true;

        if (filter.type !== undefined) {
            if (typeof filter.type === 'string') {
                if (doc.type !== filter.type) return false;
            } else if (filter.type && Array.isArray(filter.type.$in)) {
                if (!filter.type.$in.includes(doc.type)) return false;
            }
        }

        if (filter.ts) {
            const docTime = new Date(doc.ts).getTime();

            if (filter.ts.$gte && docTime < filter.ts.$gte.getTime()) {
                return false;
            }

            if (filter.ts.$lte && docTime > filter.ts.$lte.getTime()) {
                return false;
            }
        }

        return true;
    }

    return {
        async countDocuments(filter = {}) {
            return documents.filter((doc) => matchesFilter(doc, filter)).length;
        },
        find(filter = {}, options = {}) {
            let filtered = documents.filter((doc) => matchesFilter(doc, filter));
            let sortApplied = false;
            let skipCount = 0;
            let limitCount = Infinity;

            const cursor = {
                sort(sortObj) {
                    if (sortObj?.ts === -1 && sortObj?._id === 1) {
                        filtered = [...filtered].sort((a, b) => {
                            const diff = new Date(b.ts).getTime() - new Date(a.ts).getTime();
                            if (diff !== 0) return diff;
                            return String(a._id).localeCompare(String(b._id));
                        });
                        sortApplied = true;
                    }
                    return cursor;
                },
                skip(count) {
                    skipCount = count;
                    return cursor;
                },
                limit(count) {
                    limitCount = count;
                    return cursor;
                },
                async toArray() {
                    const sliced = filtered.slice(skipCount, skipCount + limitCount);
                    if (options.projection?._id === 0) {
                        return sliced.map(({ _id, ...rest }) => ({ ...rest }));
                    }
                    return sliced.map((doc) => ({ ...doc }));
                }
            };

            return cursor;
        }
    };
}

// ============================================================================
// LAYER 1: Pure Validation & Filter-Builder Tests
// ============================================================================

test('Layer 1: validates default query parameters', () => {
    const result = validateEventsQuery({});

    assert.equal(result.ok, true);
    assert.deepEqual(result.params, {
        types: null,
        from: null,
        to: null,
        page: 1,
        limit: 25,
        skip: 0
    });
});

test('Layer 1: accepts all three supported event types individually', () => {
    for (const eventType of ['view', 'add_to_cart', 'purchase']) {
        const result = validateEventsQuery({ type: eventType });
        assert.equal(result.ok, true);
        assert.deepEqual(result.params.types, [eventType]);
    }
});

test('Layer 1: parses, trims, and deduplicates multiple event types', () => {
    const result = validateEventsQuery({ type: ' view , purchase , view ' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.params.types, ['view', 'purchase']);
});

test('Layer 1: rejects unknown event types with INVALID_EVENT_TYPE', () => {
    const result = validateEventsQuery({ type: 'unknown' });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error.code, 'INVALID_EVENT_TYPE');
});

test('Layer 1: rejects empty type tokens with INVALID_EVENT_TYPE', () => {
    for (const invalidType of ['', 'view,', 'view,,purchase', ',view']) {
        const result = validateEventsQuery({ type: invalidType });
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.equal(result.error.code, 'INVALID_EVENT_TYPE');
    }
});

test('Layer 1: rejects case mismatches in event types', () => {
    for (const invalidCase of ['View', 'PURCHASE', 'Add_to_cart']) {
        const result = validateEventsQuery({ type: invalidCase });
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.equal(result.error.code, 'INVALID_EVENT_TYPE');
    }
});

test('Layer 1: rejects repeated or object/array type parameters (NoSQL injection guard)', () => {
    assert.equal(validateEventsQuery({ type: ['view', 'purchase'] }).error.code, 'INVALID_EVENT_TYPE');
    assert.equal(validateEventsQuery({ type: { $ne: null } }).error.code, 'INVALID_EVENT_TYPE');
});

test('Layer 1: accepts valid ISO-8601 timestamps with Z or timezone offset', () => {
    const result = validateEventsQuery({
        from: '2026-11-06T09:20:00Z',
        to: '2026-11-07T14:50:00+05:30'
    });

    assert.equal(result.ok, true);
    assert.equal(result.params.from.toISOString(), '2026-11-06T09:20:00.000Z');
    assert.equal(result.params.to.toISOString(), '2026-11-07T09:20:00.000Z');
});

test('Layer 1: handles URL-encoded and space-delimited timezone offsets', () => {
    const encoded = normalizeTimestampString('2026-11-07T09:20:00%2B05:30');
    assert.equal(encoded, '2026-11-07T09:20:00+05:30');

    const spaceOffset = normalizeTimestampString('2026-11-07T09:20:00 05:30');
    assert.equal(spaceOffset, '2026-11-07T09:20:00+05:30');

    const result = validateEventsQuery({ from: '2026-11-07T09:20:00%2B05:30' });
    assert.equal(result.ok, true);
    assert.equal(result.params.from.toISOString(), '2026-11-07T03:50:00.000Z');
});

test('Layer 1: supports independent date boundaries', () => {
    const fromOnly = validateEventsQuery({ from: '2026-11-06T09:20:00Z' });
    assert.equal(fromOnly.ok, true);
    assert.ok(fromOnly.params.from instanceof Date);
    assert.equal(fromOnly.params.to, null);

    const toOnly = validateEventsQuery({ to: '2026-11-07T09:20:00Z' });
    assert.equal(toOnly.ok, true);
    assert.equal(toOnly.params.from, null);
    assert.ok(toOnly.params.to instanceof Date);
});

test('Layer 1: rejects date-only, missing-tz, or malformed timestamps with INVALID_TIMESTAMP', () => {
    for (const badTs of ['2026-11-07', '2026-11-07T09:20:00', '2026-02-30T12:00:00Z', 'invalid', '']) {
        const result = validateEventsQuery({ from: badTs });
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.equal(result.error.code, 'INVALID_TIMESTAMP');
    }
});

test('Layer 1: rejects non-string timestamp values (arrays, objects)', () => {
    assert.equal(validateEventsQuery({ from: ['2026-11-07T00:00:00Z'] }).error.code, 'INVALID_TIMESTAMP');
    assert.equal(validateEventsQuery({ from: { $gt: '2026-11-07' } }).error.code, 'INVALID_TIMESTAMP');
    assert.equal(validateEventsQuery({ to: ['2026-11-07T00:00:00Z'] }).error.code, 'INVALID_TIMESTAMP');
    assert.equal(validateEventsQuery({ to: { $gt: '2026-11-07' } }).error.code, 'INVALID_TIMESTAMP');
});

test('Layer 1: validates date boundaries (from > to returns INVALID_DATE_RANGE)', () => {
    const inverted = validateEventsQuery({
        from: '2026-11-07T10:00:00Z',
        to: '2026-11-06T10:00:00Z'
    });
    assert.equal(inverted.ok, false);
    assert.equal(inverted.status, 400);
    assert.equal(inverted.error.code, 'INVALID_DATE_RANGE');

    const equalBoundaries = validateEventsQuery({
        from: '2026-11-07T10:00:00Z',
        to: '2026-11-07T10:00:00Z'
    });
    assert.equal(equalBoundaries.ok, true);
});

test('Layer 1: validates page parameter (positive integers only)', () => {
    assert.equal(validateEventsQuery({ page: '1' }).params.page, 1);
    assert.equal(validateEventsQuery({ page: '42' }).params.page, 42);

    for (const badPage of ['0', '-1', '1.5', 'abc', '', ['1'], { page: 1 }]) {
        const result = validateEventsQuery({ page: badPage });
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.equal(result.error.code, 'INVALID_PAGE');
    }
});

test('Layer 1: validates limit parameter (1 to 100, never silently clamped)', () => {
    assert.equal(validateEventsQuery({ limit: '1' }).params.limit, 1);
    assert.equal(validateEventsQuery({ limit: '25' }).params.limit, 25);
    assert.equal(validateEventsQuery({ limit: '100' }).params.limit, 100);

    for (const badLimit of ['0', '101', '1000', '-5', '50.5', 'abc', '', ['25'], { limit: 25 }]) {
        const result = validateEventsQuery({ limit: badLimit });
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.equal(result.error.code, 'INVALID_LIMIT');
    }
});

test('Layer 1: rejects unsafe calculated pagination offset with INVALID_PAGE (regression test)', () => {
    // page 10^15 is a safe integer, but (page - 1) * limit = 99999999999999900 > Number.MAX_SAFE_INTEGER
    const unsafeQuery = { page: '1000000000000000', limit: '100' };
    const result = validateEventsQuery(unsafeQuery);

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error.code, 'INVALID_PAGE');
    assert.equal(result.error.message, 'The calculated pagination offset is invalid or too large');
});

test('Layer 1: ignores unknown query parameters safely', () => {
    const result = validateEventsQuery({
        unknownField: 'malicious',
        page: '2',
        limit: '50'
    });
    assert.equal(result.ok, true);
    assert.equal(result.params.page, 2);
    assert.equal(result.params.limit, 50);
});

test('Layer 1: builds correct MongoDB filter objects', () => {
    const emptyFilter = buildEventsFilter({ types: null, from: null, to: null });
    assert.deepEqual(emptyFilter, {});

    const singleTypeFilter = buildEventsFilter({ types: ['view'], from: null, to: null });
    assert.deepEqual(singleTypeFilter, { type: 'view' });

    const multiTypeFilter = buildEventsFilter({ types: ['view', 'purchase'], from: null, to: null });
    assert.deepEqual(multiTypeFilter, { type: { $in: ['view', 'purchase'] } });

    const fromDate = new Date('2026-11-06T00:00:00Z');
    const toDate = new Date('2026-11-07T00:00:00Z');

    const dateRangeFilter = buildEventsFilter({ types: null, from: fromDate, to: toDate });
    assert.deepEqual(dateRangeFilter, {
        ts: {
            $gte: fromDate,
            $lte: toDate
        }
    });

    const combinedFilter = buildEventsFilter({ types: ['add_to_cart'], from: fromDate, to: toDate });
    assert.deepEqual(combinedFilter, {
        type: 'add_to_cart',
        ts: {
            $gte: fromDate,
            $lte: toDate
        }
    });
});

// ============================================================================
// LAYER 2: Router Handler Tests Using Injected Fake Collection
// ============================================================================

test('Layer 2: returns default pagination and response envelope on populated dataset', async () => {
    const fixtures = Array.from({ length: 30 }, (_, index) => ({
        _id: `id_${String(index + 1).padStart(3, '0')}`,
        eventId: `evt_${index + 1}`,
        type: index % 2 === 0 ? 'view' : 'purchase',
        ts: new Date(Date.UTC(2026, 10, 7, 0, index, 0))
    }));

    const handler = createEventsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, {});

    assert.equal(response.status, 200);
    assert.equal(response.body.page, 1);
    assert.equal(response.body.limit, 25);
    assert.equal(response.body.total, 30);
    assert.equal(response.body.totalPages, 2);
    assert.equal(response.body.data.length, 25);
    assert.deepEqual(response.body.filters, {
        type: null,
        from: null,
        to: null
    });
    // Ensure projection excluded _id
    assert.equal('_id' in response.body.data[0], false);
});

test('Layer 2: filters by single and multiple event types with accurate counts', async () => {
    const fixtures = [
        { _id: '1', eventId: 'e1', type: 'view', ts: new Date('2026-11-07T01:00:00Z') },
        { _id: '2', eventId: 'e2', type: 'add_to_cart', ts: new Date('2026-11-07T02:00:00Z') },
        { _id: '3', eventId: 'e3', type: 'purchase', ts: new Date('2026-11-07T03:00:00Z') }
    ];

    const handler = createEventsHandler(() => createFakeCollection(fixtures));

    const singleResponse = await invokeHandler(handler, { type: 'view' });
    assert.equal(singleResponse.status, 200);
    assert.equal(singleResponse.body.total, 1);
    assert.equal(singleResponse.body.data[0].type, 'view');
    assert.deepEqual(singleResponse.body.filters.type, ['view']);

    const multiResponse = await invokeHandler(handler, { type: 'view,purchase' });
    assert.equal(multiResponse.status, 200);
    assert.equal(multiResponse.body.total, 2);
    assert.deepEqual(multiResponse.body.filters.type, ['view', 'purchase']);
});

test('Layer 2: filters by date range with inclusive boundaries', async () => {
    const fixtures = [
        { _id: '1', eventId: 'e1', type: 'view', ts: new Date('2026-11-06T10:00:00Z') },
        { _id: '2', eventId: 'e2', type: 'view', ts: new Date('2026-11-06T12:00:00Z') },
        { _id: '3', eventId: 'e3', type: 'view', ts: new Date('2026-11-06T14:00:00Z') }
    ];

    const handler = createEventsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, {
        from: '2026-11-06T11:00:00Z',
        to: '2026-11-06T13:00:00Z'
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.data[0].eventId, 'e2');
});

test('Layer 2: handles empty dataset gracefully', async () => {
    const handler = createEventsHandler(() => createFakeCollection([]));
    const response = await invokeHandler(handler, {});

    assert.equal(response.status, 200);
    assert.equal(response.body.total, 0);
    assert.equal(response.body.totalPages, 0);
    assert.deepEqual(response.body.data, []);
});

test('Layer 2: handles past-last-page requests with HTTP 200 and accurate metadata', async () => {
    const fixtures = [
        { _id: '1', eventId: 'e1', type: 'view', ts: new Date('2026-11-07T01:00:00Z') },
        { _id: '2', eventId: 'e2', type: 'view', ts: new Date('2026-11-07T02:00:00Z') }
    ];

    const handler = createEventsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, { page: '5', limit: '25' });

    assert.equal(response.status, 200);
    assert.equal(response.body.page, 5);
    assert.equal(response.body.limit, 25);
    assert.equal(response.body.total, 2);
    assert.equal(response.body.totalPages, 1);
    assert.deepEqual(response.body.data, []);
});

test('Layer 2: sorts deterministically by ts DESC and breaks ties with _id ASC', async () => {
    const sameTimestamp = new Date('2026-11-07T12:00:00Z');
    const earlierTimestamp = new Date('2026-11-07T11:00:00Z');

    const fixtures = [
        { _id: 'doc_z', eventId: 'e_z', type: 'view', ts: sameTimestamp },
        { _id: 'doc_a', eventId: 'e_a', type: 'view', ts: sameTimestamp },
        { _id: 'doc_m', eventId: 'e_m', type: 'view', ts: sameTimestamp },
        { _id: 'doc_earlier', eventId: 'e_early', type: 'view', ts: earlierTimestamp }
    ];

    const handler = createEventsHandler(() => createFakeCollection(fixtures));
    const response = await invokeHandler(handler, { limit: '10' });

    assert.equal(response.status, 200);
    const eventIds = response.body.data.map((doc) => doc.eventId);
    // Highest ts first; among same ts, _id ASC ('doc_a', 'doc_m', 'doc_z')
    assert.deepEqual(eventIds, ['e_a', 'e_m', 'e_z', 'e_early']);
});

test('Layer 2: returns HTTP 400 with INVALID_PAGE for unsafe calculated offset (regression test)', async () => {
    const handler = createEventsHandler(() => createFakeCollection([]));
    const response = await invokeHandler(handler, { page: '1000000000000000', limit: '100' });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
        error: {
            code: 'INVALID_PAGE',
            message: 'The calculated pagination offset is invalid or too large'
        }
    });
});

test('Layer 2: handles database query failures with HTTP 500 and QUERY_FAILED', async () => {
    const failingCountCollection = {
        async countDocuments() {
            throw new Error('Connection lost');
        },
        find() {
            return {
                sort() { return this; },
                skip() { return this; },
                limit() { return this; },
                async toArray() { return []; }
            };
        }
    };

    const countFailHandler = createEventsHandler(() => failingCountCollection);
    const countFailResponse = await invokeHandler(countFailHandler, {});

    assert.equal(countFailResponse.status, 500);
    assert.deepEqual(countFailResponse.body, {
        error: {
            code: 'QUERY_FAILED',
            message: 'Unable to retrieve events'
        }
    });

    const failingFindCollection = {
        async countDocuments() {
            return 5;
        },
        find() {
            return {
                sort() { return this; },
                skip() { return this; },
                limit() { return this; },
                async toArray() {
                    throw new Error('Find cursor error');
                }
            };
        }
    };

    const findFailHandler = createEventsHandler(() => failingFindCollection);
    const findFailResponse = await invokeHandler(findFailHandler, {});

    assert.equal(findFailResponse.status, 500);
    assert.deepEqual(findFailResponse.body, {
        error: {
            code: 'QUERY_FAILED',
            message: 'Unable to retrieve events'
        }
    });
});
