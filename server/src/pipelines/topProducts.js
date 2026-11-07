import express from 'express';
import config from '../config.js';
import { getDatabase } from '../db.js';

const router = express.Router();

const ISO_TIMESTAMP =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function parseIsoTimestamp(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const match = ISO_TIMESTAMP.exec(value);

    if (!match) {
        return null;
    }

    const [
        ,
        year,
        month,
        day,
        hour,
        minute,
        second,
        ,
        timezone,
        ,
        offsetHour,
        offsetMinute
    ] = match;

    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const h = Number(hour);
    const min = Number(minute);
    const sec = Number(second);

    const calendarDate = new Date(Date.UTC(y, m - 1, d));

    if (
        calendarDate.getUTCFullYear() !== y ||
        calendarDate.getUTCMonth() !== m - 1 ||
        calendarDate.getUTCDate() !== d ||
        h > 23 ||
        min > 59 ||
        sec > 59
    ) {
        return null;
    }

    if (timezone !== 'Z') {
        const oh = Number(offsetHour);
        const om = Number(offsetMinute);

        if (
            oh > 14 ||
            om > 59 ||
            (oh === 14 && om !== 0)
        ) {
            return null;
        }
    }

    const timestamp = new Date(value);

    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

export function buildTopProductsPipeline(from, to) {
    return [
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
                _id: '$productId',
                category: { $first: '$category' },
                events: { $sum: 1 },
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
                },
                revenue: {
                    $sum: {
                        $cond: [
                            { $eq: ['$type', 'purchase'] },
                            { $multiply: ['$price', '$quantity'] },
                            0
                        ]
                    }
                }
            }
        },
        {
            $project: {
                _id: 0,
                productId: '$_id',
                category: 1,
                events: 1,
                views: 1,
                addToCarts: 1,
                purchases: 1,
                revenue: 1
            }
        },
        {
            $sort: {
                events: -1,
                productId: 1
            }
        },
        {
            $limit: 10
        }
    ];
}

router.get('/p1/top-products', async (req, res) => {
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
                    data: []
                });
            }

            to = latestEvent.ts;
        }

        const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

        const data = await getDatabase()
            .collection(config.collectionName)
            .aggregate(buildTopProductsPipeline(from, to))
            .toArray();

        return res.status(200).json({
            window: {
                from: from.toISOString(),
                to: to.toISOString()
            },
            data
        });
    } catch (error) {
        console.error('P1 top-products aggregation failed:', error);

        return res.status(500).json({
            error: {
                code: 'AGGREGATION_FAILED',
                message: 'Unable to retrieve top products'
            }
        });
    }
});

export default router;