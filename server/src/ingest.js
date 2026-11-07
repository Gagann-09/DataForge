
import { Router } from 'express';
import { MongoBulkWriteError } from 'mongodb';

import { getCollection } from './db.js';
import { validateEvent } from '../scripts/generate.js';

const router = Router();

const MAX_BATCH_SIZE = 5000;

const VALID_CATEGORIES = new Set([
    'electronics',
    'clothing',
    'home',
    'books',
    'sports',
    'toys',
    'food',
    'beauty'
]);

const REQUIRED_STRING_FIELDS = [
    'eventId',
    'userId',
    'sessionId',
    'productId'
];

function validateTimestamp(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  const leapYear =
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

  const daysInMonth = [
    31, leapYear ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31
  ];

  if (
    m < 1 || m > 12 ||
    d < 1 || d > daysInMonth[m - 1] ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    return null;
  }

  const timestamp = new Date(value);

  return Number.isNaN(timestamp.getTime())
    ? null
    : timestamp;
}

function validateIncomingEvent(event, index) {
    if (
        !event ||
        typeof event !== 'object' ||
        Array.isArray(event)
    ) {
        return {
            index,
            message: 'Event must be a JSON object'
        };
    }

    for (const field of REQUIRED_STRING_FIELDS) {
        if (
            typeof event[field] !== 'string' ||
            event[field].trim().length === 0
        ) {
            return {
                index,
                field,
                message: `${field} must be a non-empty string`
            };
        }
    }

    if (!VALID_CATEGORIES.has(event.category)) {
        return {
            index,
            field: 'category',
            message: 'Invalid product category'
        };
    }

    if (
        typeof event.price !== 'number' ||
        !Number.isFinite(event.price) ||
        event.price <= 0
    ) {
        return {
            index,
            field: 'price',
            message: 'Price must be a positive finite number'
        };
    }

    if (
        !Number.isInteger(event.quantity) ||
        event.quantity < 1
    ) {
        return {
            index,
            field: 'quantity',
            message: 'Quantity must be a positive integer'
        };
    }

    const timestamp = validateTimestamp(event.ts);

    if (!timestamp) {
        return {
            index,
            field: 'ts',
            message: 'Timestamp must be a valid ISO-8601 date-time'
        };
    }

    const normalizedEvent = {
        ...event,
        ts: timestamp
    };

    if (!validateEvent(normalizedEvent)) {
        return {
            index,
            message: 'Event does not satisfy the DataForge event schema'
        };
    }

    return {
        event: normalizedEvent
    };
}

router.post('/ingest', async (req, res, next) => {
    try {
        if (
            !req.body ||
            typeof req.body !== 'object' ||
            Array.isArray(req.body) ||
            !Array.isArray(req.body.events)
        ) {
            return res.status(400).json({
                ok: false,
                error: {
                    code: 'INVALID_REQUEST',
                    message: 'Request body must contain an events array'
                }
            });
        }

        const { events } = req.body;

        if (events.length === 0) {
            return res.status(400).json({
                ok: false,
                error: {
                    code: 'EMPTY_BATCH',
                    message: 'At least one event is required'
                }
            });
        }

        if (events.length > MAX_BATCH_SIZE) {
            return res.status(413).json({
                ok: false,
                error: {
                    code: 'BATCH_TOO_LARGE',
                    message: `Maximum batch size is ${MAX_BATCH_SIZE}`
                }
            });
        }

        const validEvents = [];
        const validationErrors = [];

        events.forEach((event, index) => {
            const result = validateIncomingEvent(event, index);

            if (result.event) {
                validEvents.push(result.event);
            } else {
                validationErrors.push(result);
            }
        });

        if (validationErrors.length > 0) {
            return res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'One or more events failed validation'
                },
                received: events.length,
                valid: validEvents.length,
                invalid: validationErrors.length,
                errors: validationErrors.slice(0, 100)
            });
        }

        const collection = getCollection();

        try {
            const result = await collection.insertMany(validEvents, {
                ordered: false
            });

            return res.status(201).json({
                ok: true,
                received: events.length,
                inserted: result.insertedCount,
                duplicates: 0,
                failed: 0
            });
        } catch (error) {
            if (
                error instanceof MongoBulkWriteError ||
                error?.name === 'MongoBulkWriteError' ||
                error?.name === 'BulkWriteError'
            ) {
                const rawWriteErrors =
                  error.writeErrors ??
                  error.result?.getWriteErrors?.() ??
                  [];

                const writeErrors = rawWriteErrors instanceof Map
                  ? [...rawWriteErrors.values()]
                  : Array.isArray(rawWriteErrors)
                    ? rawWriteErrors
                    : Object.values(rawWriteErrors);

                const inserted =
                  error.result?.insertedCount ??
                  error.insertedCount ??
                  0;

                let duplicates = 0;
                let otherFailures = 0;

                const details = [];

                for (const writeError of writeErrors) {
                  const code =
                    writeError.code ??
                    writeError.err?.code ??
                    writeError.errInfo?.code;

                  const isDuplicate = code === 11000 || code === 11001;

                  if (isDuplicate) {
                    duplicates++;
                  } else {
                    otherFailures++;
                  }

                  if (details.length < 100) {
                    details.push({
                      index: writeError.index,
                      code,
                      type: isDuplicate ? 'duplicate' : 'write_error'
                    });
                  }
                }

                return res.status(207).json({
                    ok: otherFailures === 0,
                    received: events.length,
                    inserted,
                    duplicates,
                    failed: otherFailures,
                    errors: details
                });
            }

            throw error;
        }
    } catch (error) {
        next(error);
    }
});

export default router;