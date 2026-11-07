import express from 'express';
import config from '../config.js';
import { getDatabase } from '../db.js';
import { parseIsoTimestamp } from './topProducts.js';

const router = express.Router();

const ALLOWED_EVENT_TYPES = new Set(['view', 'add_to_cart', 'purchase']);

export function normalizeTimestampString(value) {
    if (typeof value !== 'string') {
        return value;
    }

    let normalized = value;

    if (normalized.includes('%2B') || normalized.includes('%2b')) {
        try {
            normalized = decodeURIComponent(normalized);
        } catch {
            // retain value if decodeURIComponent fails
        }
    }

    if (/T\d{2}:\d{2}:\d{2}(?:\.\d+)?\s\d{2}:\d{2}$/.test(normalized)) {
        normalized = normalized.replace(/\s(\d{2}:\d{2})$/, '+$1');
    }

    return normalized;
}

export function validateEventsQuery(query) {
    if (!query || typeof query !== 'object') {
        return {
            ok: false,
            status: 400,
            error: {
                code: 'INVALID_QUERY',
                message: 'Invalid query parameters'
            }
        };
    }

    let types = null;
    let from = null;
    let to = null;
    let page = 1;
    let limit = 25;

    if (query.type !== undefined) {
        if (typeof query.type !== 'string') {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_EVENT_TYPE',
                    message: 'The type parameter must be a single string of comma-separated event types'
                }
            };
        }

        const rawTokens = query.type.split(',');
        const parsedTypes = [];

        for (const rawToken of rawTokens) {
            const token = rawToken.trim();

            if (!token || !ALLOWED_EVENT_TYPES.has(token)) {
                return {
                    ok: false,
                    status: 400,
                    error: {
                        code: 'INVALID_EVENT_TYPE',
                        message: 'Allowed event types are view, add_to_cart, purchase'
                    }
                };
            }

            if (!parsedTypes.includes(token)) {
                parsedTypes.push(token);
            }
        }

        types = parsedTypes;
    }

    if (query.from !== undefined) {
        if (typeof query.from !== 'string') {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_TIMESTAMP',
                    message: 'The from parameter must be a single ISO-8601 timestamp with timezone'
                }
            };
        }

        from = parseIsoTimestamp(normalizeTimestampString(query.from));

        if (!from) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_TIMESTAMP',
                    message: 'The from parameter must be a valid ISO-8601 timestamp with timezone'
                }
            };
        }
    }

    if (query.to !== undefined) {
        if (typeof query.to !== 'string') {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_TIMESTAMP',
                    message: 'The to parameter must be a single ISO-8601 timestamp with timezone'
                }
            };
        }

        to = parseIsoTimestamp(normalizeTimestampString(query.to));

        if (!to) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_TIMESTAMP',
                    message: 'The to parameter must be a valid ISO-8601 timestamp with timezone'
                }
            };
        }
    }

    if (from && to && from.getTime() > to.getTime()) {
        return {
            ok: false,
            status: 400,
            error: {
                code: 'INVALID_DATE_RANGE',
                message: 'The from timestamp must be earlier than or equal to the to timestamp'
            }
        };
    }

    if (query.page !== undefined) {
        if (typeof query.page !== 'string' || !/^\d+$/.test(query.page)) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_PAGE',
                    message: 'The page parameter must be a positive integer'
                }
            };
        }

        const pageNum = Number(query.page);

        if (pageNum < 1 || !Number.isSafeInteger(pageNum)) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_PAGE',
                    message: 'The page parameter must be a positive integer'
                }
            };
        }

        page = pageNum;
    }

    if (query.limit !== undefined) {
        if (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_LIMIT',
                    message: 'The limit parameter must be an integer between 1 and 100'
                }
            };
        }

        const limitNum = Number(query.limit);

        if (limitNum < 1 || limitNum > 100 || !Number.isSafeInteger(limitNum)) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_LIMIT',
                    message: 'The limit parameter must be an integer between 1 and 100'
                }
            };
        }

        limit = limitNum;
    }

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
        return {
            ok: false,
            status: 400,
            error: {
                code: 'INVALID_PAGE',
                message: 'The calculated pagination offset is invalid or too large'
            }
        };
    }

    return {
        ok: true,
        params: {
            types,
            from,
            to,
            page,
            limit,
            skip
        }
    };
}

export function buildEventsFilter({ types, from, to }) {
    const filter = {};

    if (types && types.length > 0) {
        filter.type = types.length === 1 ? types[0] : { $in: types };
    }

    if (from || to) {
        filter.ts = {};

        if (from) {
            filter.ts.$gte = from;
        }

        if (to) {
            filter.ts.$lte = to;
        }
    }

    return filter;
}

export function createEventsHandler(
    getCollection = () => getDatabase().collection(config.collectionName)
) {
    return async (req, res) => {
        try {
            const validation = validateEventsQuery(req.query);

            if (!validation.ok) {
                return res.status(validation.status).json({
                    error: validation.error
                });
            }

            const { types, from, to, page, limit } = validation.params;
            const filter = buildEventsFilter({ types, from, to });
            const skip = (page - 1) * limit;

            if (!Number.isSafeInteger(skip)) {
                return res.status(400).json({
                    error: {
                        code: 'INVALID_PAGE',
                        message: 'The calculated pagination offset is invalid or too large'
                    }
                });
            }

            const collection = getCollection();

            const total = await collection.countDocuments(filter);
            const data = await collection
                .find(filter, { projection: { _id: 0 } })
                .sort({ ts: -1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .toArray();

            const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

            return res.status(200).json({
                data,
                page,
                limit,
                total,
                totalPages,
                filters: {
                    type: types,
                    from: from ? from.toISOString() : null,
                    to: to ? to.toISOString() : null
                }
            });
        } catch (error) {
            console.error('Events retrieval failed:', error);

            return res.status(500).json({
                error: {
                    code: 'QUERY_FAILED',
                    message: 'Unable to retrieve events'
                }
            });
        }
    };
}

router.get('/events', createEventsHandler());

export default router;
