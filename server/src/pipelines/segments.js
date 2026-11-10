import express from 'express';
import config from '../config.js';
import { getDatabase } from '../db.js';

const router = express.Router();

export const ORDERED_SEGMENTS = ['no_purchase', 'low', 'mid', 'high', 'top'];

export function classifyUserSpend(spend) {
    if (spend === 0) return 'no_purchase';
    if (spend < 3500) return 'low';
    if (spend < 6000) return 'mid';
    if (spend < 10000) return 'high';
    return 'top';
}

export function buildSegmentsPipeline() {
    return [
        {
            $group: {
                _id: '$userId',
                totalEvents: { $sum: 1 },
                totalSpend: {
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
                totalEvents: 1,
                totalSpend: 1,
                segment: {
                    $switch: {
                        branches: [
                            { case: { $eq: ['$totalSpend', 0] }, then: 'no_purchase' },
                            { case: { $lt: ['$totalSpend', 3500] }, then: 'low' },
                            { case: { $lt: ['$totalSpend', 6000] }, then: 'mid' },
                            { case: { $lt: ['$totalSpend', 10000] }, then: 'high' }
                        ],
                        default: 'top'
                    }
                }
            }
        },
        {
            $group: {
                _id: '$segment',
                users: { $sum: 1 },
                totalSpend: { $sum: '$totalSpend' },
                totalEvents: { $sum: '$totalEvents' }
            }
        }
    ];
}

export function formatSegments(rawGroups = []) {
    const groupMap = new Map();

    for (const group of rawGroups) {
        if (group && group._id) {
            groupMap.set(group._id, group);
        }
    }

    return ORDERED_SEGMENTS.map((segment) => {
        const item = groupMap.get(segment);

        if (!item || !item.users) {
            return {
                segment,
                users: 0,
                totalSpend: 0,
                avgSpend: 0,
                avgEvents: 0
            };
        }

        const users = item.users;
        const totalSpend = Number(item.totalSpend.toFixed(2));
        const avgSpend = Number((item.totalSpend / users).toFixed(2));
        const avgEvents = Number((item.totalEvents / users).toFixed(2));

        return {
            segment,
            users,
            totalSpend,
            avgSpend,
            avgEvents
        };
    });
}

export function createSegmentsHandler(
    getCollection = () => getDatabase().collection(config.collectionName)
) {
    return async (req, res) => {
        try {
            const collection = getCollection();
            const pipeline = buildSegmentsPipeline();
            const rawGroups = await collection.aggregate(pipeline).toArray();
            const data = formatSegments(rawGroups);

            return res.status(200).json({ data });
        } catch (error) {
            console.error('P3 segments aggregation failed:', error);

            return res.status(500).json({
                error: {
                    code: 'AGGREGATION_FAILED',
                    message: 'Unable to retrieve user segmentation'
                }
            });
        }
    };
}

router.get('/p3/segments', createSegmentsHandler());

export default router;

