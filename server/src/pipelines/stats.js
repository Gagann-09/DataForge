import express from 'express';
import config from '../config.js';
import { getDatabase } from '../db.js';
import { parseIsoTimestamp } from './topProducts.js';
import { normalizeTimestampString } from './events.js';

const router = express.Router();

export function validateStatsQuery(query) {
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

    let to = null;
    let windowMinutes = 5;

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

    if (query.windowMinutes !== undefined) {
        if (typeof query.windowMinutes !== 'string' || !/^\d+$/.test(query.windowMinutes)) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_WINDOW',
                    message: 'The windowMinutes parameter must be an integer between 1 and 60'
                }
            };
        }

        const parsedWindow = Number(query.windowMinutes);

        if (parsedWindow < 1 || parsedWindow > 60 || !Number.isSafeInteger(parsedWindow)) {
            return {
                ok: false,
                status: 400,
                error: {
                    code: 'INVALID_WINDOW',
                    message: 'The windowMinutes parameter must be an integer between 1 and 60'
                }
            };
        }

        windowMinutes = parsedWindow;
    }

    return {
        ok: true,
        params: {
            to,
            windowMinutes
        }
    };
}

export function createStatsHandler(
    getCollection = () => getDatabase().collection(config.collectionName)
) {
    return async (req, res) => {
        try {
            const validation = validateStatsQuery(req.query);

            if (!validation.ok) {
                return res.status(validation.status).json({
                    error: validation.error
                });
            }

            const { windowMinutes } = validation.params;
            let { to } = validation.params;

            const collection = getCollection();

            if (!to) {
                const latestEvent = await collection.findOne(
                    {},
                    {
                        projection: { ts: 1 },
                        sort: { ts: -1 }
                    }
                );

                if (!latestEvent) {
                    return res.status(200).json({
                        totalEvents: 0,
                        eventsPerMinute: 0,
                        window: {
                            from: null,
                            to: null,
                            durationMinutes: windowMinutes
                        },
                        eventsInWindow: 0,
                        topInsight: null
                    });
                }

                to = latestEvent.ts;
            }

            const from = new Date(to.getTime() - windowMinutes * 60 * 1000);

            const [totalEvents, eventsInWindow, topCategories] = await Promise.all([
                collection.estimatedDocumentCount ? collection.estimatedDocumentCount() : collection.countDocuments(),
                collection.countDocuments({
                    ts: {
                        $gte: from,
                        $lte: to
                    }
                }),
                collection
                    .aggregate([
                        {
                            $match: {
                                ts: {
                                    $gte: from,
                                    $lte: to
                                }
                            }
                        },
                        {
                            $group: {
                                _id: '$category',
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $sort: {
                                count: -1
                            }
                        },
                        {
                            $limit: 1
                        }
                    ])
                    .toArray()
            ]);

            const eventsPerMinute = Number((eventsInWindow / windowMinutes).toFixed(2));

            let topInsight = null;

            if (eventsInWindow > 0 && topCategories.length > 0) {
                const topCategory = topCategories[0];
                const sharePercentage = Number(
                    ((topCategory.count / eventsInWindow) * 100).toFixed(1)
                );

                topInsight = {
                    type: 'top_category',
                    category: topCategory._id,
                    events: topCategory.count,
                    share: sharePercentage,
                    description: `${topCategory._id} is leading current activity with ${topCategory.count} events (${sharePercentage}% of window traffic)`
                };
            }

            return res.status(200).json({
                totalEvents,
                eventsPerMinute,
                window: {
                    from: from.toISOString(),
                    to: to.toISOString(),
                    durationMinutes: windowMinutes
                },
                eventsInWindow,
                topInsight
            });
        } catch (error) {
            console.error('Stats computation failed:', error);

            return res.status(500).json({
                error: {
                    code: 'QUERY_FAILED',
                    message: 'Unable to retrieve system statistics'
                }
            });
        }
    };
}

router.get('/stats', createStatsHandler());

export default router;

