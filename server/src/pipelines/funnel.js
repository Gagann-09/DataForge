import express from 'express';
import config from '../config.js';
import { getDatabase } from '../db.js';
import { parseIsoTimestamp } from './topProducts.js';

const router = express.Router();

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 24 * HOUR_MS;

export function buildFunnelPipeline(from, to) {
    return [
        {
            $match: {
                ts: {
                    $gte: from,
                    $lte: to
                },
                type: {
                    $in: ['view', 'add_to_cart', 'purchase']
                }
            }
        },
        {
            $group: {
                _id: {
                    $dateTrunc: {
                        date: '$ts',
                        unit: 'hour',
                        timezone: 'UTC'
                    }
                },
                views: {
                    $sum: {
                        $cond: [{ $eq: ['$type', 'view'] }, 1, 0]
                    }
                },
                addToCarts: {
                    $sum: {
                        $cond: [{ $eq: ['$type', 'add_to_cart'] }, 1, 0]
                    }
                },
                purchases: {
                    $sum: {
                        $cond: [{ $eq: ['$type', 'purchase'] }, 1, 0]
                    }
                }
            }
        },
        {
            $sort: {
                _id: 1
            }
        }
    ];
}

export function calculateRate(numerator, denominator) {
    return denominator === 0 ? null : numerator / denominator;
}

export function buildHourlyBuckets(from, to, aggregatedRows) {
    const rowsByHour = new Map(
        aggregatedRows.map((row) => [
            row._id.toISOString(),
            row
        ])
    );

    const buckets = [];
    const firstHour = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS;
    const lastHour = Math.floor(to.getTime() / HOUR_MS) * HOUR_MS;

    for (
        let hourTime = firstHour;
        hourTime <= lastHour;
        hourTime += HOUR_MS
    ) {
        const hour = new Date(hourTime).toISOString();
        const row = rowsByHour.get(hour);

        const views = row?.views ?? 0;
        const addToCarts = row?.addToCarts ?? 0;
        const purchases = row?.purchases ?? 0;

        buckets.push({
            hour,
            views,
            addToCarts,
            purchases,
            cartRate: calculateRate(addToCarts, views),
            purchaseRate: calculateRate(purchases, addToCarts),
            overallRate: calculateRate(purchases, views)
        });
    }

    return buckets;
}

router.get('/p2/funnel', async (req, res) => {
    try {
        let to;

        if (req.query.to !== undefined) {
            if (Array.isArray(req.query.to)) {
                return res.status(400).json({
                    error: {
                        code: 'INVALID_TIMESTAMP',
                        message: 'The to parameter must be a single ISO timestamp'
                    }
                });
            }

            to = parseIsoTimestamp(req.query.to);

            if (!to) {
                return res.status(400).json({
                    error: {
                        code: 'INVALID_TIMESTAMP',
                        message: 'The to parameter must be a valid ISO-8601 timestamp'
                    }
                });
            }
        } else {
            const latestEvent = await getDatabase()
                .collection(config.collectionName)
                .findOne(
                    {},
                    {
                        projection: { ts: 1 },
                        sort: { ts: -1 }
                    }
                );

            if (!latestEvent) {
                return res.status(200).json({
                    window: {
                        from: null,
                        to: null
                    },
                    buckets: [],
                    totals: {
                        views: 0,
                        addToCarts: 0,
                        purchases: 0
                    }
                });
            }

            to = latestEvent.ts;
        }

        const from = new Date(to.getTime() - WINDOW_MS);

        const rows = await getDatabase()
            .collection(config.collectionName)
            .aggregate(buildFunnelPipeline(from, to))
            .toArray();

        const buckets = buildHourlyBuckets(from, to, rows);

        const totals = buckets.reduce(
            (result, bucket) => ({
                views: result.views + bucket.views,
                addToCarts: result.addToCarts + bucket.addToCarts,
                purchases: result.purchases + bucket.purchases
            }),
            {
                views: 0,
                addToCarts: 0,
                purchases: 0
            }
        );

        return res.status(200).json({
            window: {
                from: from.toISOString(),
                to: to.toISOString()
            },
            buckets,
            totals
        });
    } catch (error) {
        console.error('P2 funnel aggregation failed:', error);

        return res.status(500).json({
            error: {
                code: 'AGGREGATION_FAILED',
                message: 'Unable to retrieve funnel analytics'
            }
        });
    }
});

export default router;

