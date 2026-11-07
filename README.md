<div align="center">

# DataForge

### MongoDB-powered e-commerce clickstream analytics

**Generate realistic event data. Ingest it safely. Turn raw activity into useful product and funnel insights.**

[![GitHub stars](https://img.shields.io/github/stars/Gagann-09/DataForge?style=for-the-badge)](https://github.com/Gagann-09/DataForge/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Gagann-09/DataForge?style=for-the-badge)](https://github.com/Gagann-09/DataForge/network/members)
[![Last commit](https://img.shields.io/github/last-commit/Gagann-09/DataForge?style=for-the-badge)](https://github.com/Gagann-09/DataForge/commits/main)
[![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)

[Overview](#-overview) · [Features](#-implemented-features) · [Architecture](#-architecture) · [Quick start](#-quick-start) · [API](#-api-reference) · [Data model](#-event-data-model) · [Tests](#-tests)

</div>

---

## 🚀 Overview

DataForge is a MongoDB-based e-commerce clickstream analytics project. It generates synthetic user activity, stores events in MongoDB, accepts event batches through an API, and calculates product and conversion-funnel analytics.

The supplied backend snapshot includes a session-oriented event generator, a batched database seeder, six indexes, an ingestion endpoint, two aggregation endpoints, and focused unit-test files.

> **Project scope:** This README describes only functionality present in the supplied repository snapshot. It does not claim a completed dashboard, explorer, segment analytics, production deployment, or benchmark results.

## ✨ Implemented features

| Area | Included capability |
|---|---|
| Synthetic data | Session-based e-commerce clickstream generation |
| Dataset size | 150,000 events by default; configurable with `SEED_COUNT` |
| Event types | `view`, `add_to_cart`, `purchase` |
| Product catalog | 80 fixed products across 8 categories |
| Event ingestion | `POST /api/ingest`, batches up to 5,000 events |
| Data integrity | Schema validation and unique `eventId` index |
| Bulk writes | Unordered MongoDB inserts with duplicate/error accounting |
| Product analytics | Top 10 products by event count, with purchase revenue |
| Funnel analytics | UTC hourly views, carts, purchases, and conversion rates |
| Event exploration | `GET /api/events` with pagination, event-type, and date-range filters |
| Live statistics | `GET /api/stats` with total event count, events/min, and top category insight |
| Query support | Optional ISO-8601 end timestamp for analytics windows |
| Tests | Unit-test files for timestamp parsing, aggregation helpers, and events explorer |

### Analytics currently available

- **Top products:** ranks products by total events in the selected 24-hour window.
- **Purchase revenue:** sums `price × quantity` for purchase events only.
- **Hourly funnel:** reports views, add-to-carts, and purchases in UTC hourly buckets.
- **Conversion rates:** calculates cart/view, purchase/cart, and purchase/view ratios.
- **Empty periods:** fills missing hourly buckets with zero counts; undefined rates are returned as `null`.

## 🧱 Architecture

```mermaid
flowchart TD
    A["Synthetic event generator"] --> B["Batch seeder"]
    C["External event producer"] --> D["Express ingestion API"]
    B --> E[("MongoDB · dataforge.events")]
    D --> E
    E --> F["Top-products aggregation"]
    E --> G["Hourly-funnel aggregation"]
    F --> H["JSON API responses"]
    G --> H
```

### Repository layout

```text
DataForge/
├── client/
│   └── package.json
├── server/
│   ├── scripts/
│   │   ├── generate.js
│   │   ├── indexes.js
│   │   └── seed.js
│   ├── src/
│   │   ├── config.js
│   │   ├── db.js
│   │   ├── index.js
│   │   ├── ingest.js
│   │   └── pipelines/
│   │       ├── topProducts.js
│   │       ├── funnel.js
│   │       └── events.js
│   ├── tests/
│   │   ├── topProducts.test.js
│   │   ├── funnel.test.js
│   │   ├── events.test.js
│   │   └── events.integration.test.js
│   └── .env.example
├── package.json
└── README.md
```

### Technology

- **Database:** MongoDB, using the official Node.js driver.
- **Backend:** Node.js and Express.
- **Configuration:** dotenv.
- **Frontend dependencies declared:** React, Vite, and Recharts.

**Frontend snapshot limitation:** the uploaded archive contains the client package manifest, but no `client/src/`, `client/index.html`, or Vite configuration. A working frontend cannot be verified from this archive. The backend and API documentation below are grounded in the supplied source files.

## ⚡ Quick start

### 1. Prerequisites

- Node.js 18 or later.
- MongoDB 6 or later, running locally or reachable through a MongoDB URI.
- npm.

The default database connection is:

```text
mongodb://127.0.0.1:27017
```

### 2. Install dependencies

Run from the repository root:

```bash
npm run install:all
```

### 3. Configure the server

Copy the example environment file:

**macOS / Linux**

```bash
cp server/.env.example server/.env
```

**Windows PowerShell**

```powershell
Copy-Item server/.env.example server/.env
```

Edit `server/.env` when your MongoDB connection or database settings differ.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Express API port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `DB_NAME` | `dataforge` | Database name |
| `COLLECTION_NAME` | `events` | Event collection |
| `SEED_COUNT` | `150000` | Number of successful inserts targeted by a seed run |

### 4. Start MongoDB

Make sure your MongoDB server is running before starting the API or seeder.

### 5. Generate and seed events

From the repository root:

```bash
npm run seed
```

The default target is **150,000 successfully inserted events**. Override it in `server/.env`:

```env
SEED_COUNT=100000
```

The seeder writes in batches of 5,000, preserves existing records, and creates the configured indexes after insertion. It does not automatically clear the collection.

### 6. Start the API

```bash
npm run dev:server
```

The API starts at:

```text
http://localhost:4000
```

Health check:

```bash
curl http://localhost:4000/api/health
```

Expected connected response:

```json
{
  "ok": true,
  "db": "connected"
}
```

> `npm run dev` starts both the API and the Vite client. The supplied archive is missing the client application entry files, so use `npm run dev:server` for the verifiable backend workflow.

## 🗃️ Event data model

Each event contains the following fields:

| Field | Type | Description |
|---|---|---|
| `eventId` | String | Unique event identifier |
| `userId` | String | User identifier |
| `sessionId` | String | Session identifier |
| `type` | String | `view`, `add_to_cart`, or `purchase` |
| `productId` | String | Product identifier |
| `category` | String | Product category |
| `price` | Number | Unit price |
| `quantity` | Integer | Positive event quantity |
| `device` | String | `mobile`, `desktop`, or `tablet` |
| `country` | String | `IN` in the supplied generator |
| `ts` | Date | Event timestamp stored as a BSON Date |

The generator uses an 80-product catalog and eight categories: `electronics`, `clothing`, `home`, `books`, `sports`, `toys`, `food`, and `beauty`.

Generated timestamps are distributed across a seven-day window, with a higher concentration in the latest 24 hours. Session events follow a view → add-to-cart → purchase progression with probabilistic transitions.

## 🧭 MongoDB index strategy

The index script creates these six indexes on the configured events collection:

| Index | Definition | Purpose |
|---|---|---|
| `eventId_1` | `{ eventId: 1 }`, unique | Prevent duplicate event identifiers |
| `type_ts_1_minus_1` | `{ type: 1, ts: -1 }` | Event-type and time filtering |
| `productId_ts_1_minus_1` | `{ productId: 1, ts: -1 }` | Product-centric time queries |
| `userId_ts_1_minus_1` | `{ userId: 1, ts: -1 }` | User-centric time queries |
| `category_ts_1_minus_1` | `{ category: 1, ts: -1 }` | Category and time filtering |
| `ts_minus_1` | `{ ts: -1 }` | Timestamp-range and latest-event queries |

Create indexes:

```bash
npm run indexes --prefix server -- create
```

Verify indexes:

```bash
npm run indexes --prefix server -- verify
```

The seeder also invokes index creation after its insertion phase.

## 🔌 API reference

All routes use the `/api` prefix. The API accepts JSON request bodies and limits them to 5 MB.

### `GET /api/health`

Checks MongoDB connectivity.

```bash
curl http://localhost:4000/api/health
```

### `POST /api/ingest`

Ingests a batch of events.

**Request body**

```json
{
  "events": [
    {
      "eventId": "evt_demo_0001",
      "userId": "user_0001",
      "sessionId": "session_0001",
      "type": "purchase",
      "productId": "p_1001",
      "category": "electronics",
      "price": 699.99,
      "quantity": 1,
      "device": "mobile",
      "country": "IN",
      "ts": "2026-11-07T09:20:00.000Z"
    }
  ]
}
```

**Example**

```bash
curl -X POST http://localhost:4000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"events":[{"eventId":"evt_demo_0001","userId":"user_0001","sessionId":"session_0001","type":"purchase","productId":"p_1001","category":"electronics","price":699.99,"quantity":1,"device":"mobile","country":"IN","ts":"2026-11-07T09:20:00.000Z"}]}'
```

**Ingestion rules**

- A request must contain a non-empty `events` array.
- A batch can contain at most 5,000 events.
- Each event must satisfy the project event schema.
- Timestamps must be ISO-8601 date-times with a timezone and are converted to JavaScript `Date` values before insertion.
- If any event fails request validation, the batch is rejected with validation details.
- MongoDB writes use `ordered: false`, allowing valid documents to be inserted despite individual write errors.
- Duplicate-key write errors are counted separately from other write failures.

| HTTP status | Meaning |
|---|---|
| `201` | Batch inserted successfully |
| `400` | Invalid request, empty batch, or event validation failure |
| `413` | Batch exceeds 5,000 events or request body exceeds 5 MB |
| `207` | MongoDB bulk write completed with duplicate and/or other write errors |
| `500` | Unexpected server error |

Successful response example:

```json
{
  "ok": true,
  "received": 1,
  "inserted": 1,
  "duplicates": 0,
  "failed": 0
}
```

### `GET /api/p1/top-products`

Returns the top 10 products by total event count over an inclusive 24-hour window.

```bash
curl http://localhost:4000/api/p1/top-products
```

To provide the window end explicitly:

```bash
curl "http://localhost:4000/api/p1/top-products?to=2026-11-07T09:20:00Z"
```

**Response shape**

```json
{
  "window": {
    "from": "2026-11-06T09:20:00.000Z",
    "to": "2026-11-07T09:20:00.000Z"
  },
  "data": [
    {
      "productId": "p_1001",
      "category": "electronics",
      "events": 120,
      "views": 70,
      "addToCarts": 30,
      "purchases": 20,
      "revenue": 13999.8
    }
  ]
}
```

The values above illustrate the response structure; they are not benchmark or live database results. Revenue includes purchase events only and is calculated as `price × quantity`. Products are sorted by event count descending, then product ID ascending.

### `GET /api/p2/funnel`

Returns hourly event counts and conversion rates for an inclusive 24-hour window.

```bash
curl http://localhost:4000/api/p2/funnel
```

With an explicit window end:

```bash
curl "http://localhost:4000/api/p2/funnel?to=2026-11-07T09:20:00Z"
```

**Response shape**

```json
{
  "window": {
    "from": "2026-11-06T09:20:00.000Z",
    "to": "2026-11-07T09:20:00.000Z"
  },
  "buckets": [
    {
      "hour": "2026-11-06T09:00:00.000Z",
      "views": 100,
      "addToCarts": 40,
      "purchases": 12,
      "cartRate": 0.4,
      "purchaseRate": 0.3,
      "overallRate": 0.12
    }
  ],
  "totals": {
    "views": 100,
    "addToCarts": 40,
    "purchases": 12
  }
}
```

The values above illustrate the response structure; they are not benchmark or live database results.

| Metric | Calculation |
|---|---|
| `cartRate` | `addToCarts / views` |
| `purchaseRate` | `purchases / addToCarts` |
| `overallRate` | `purchases / views` |

Rates are returned as `null` when their denominator is zero. Buckets use UTC hour boundaries and missing hours are zero-filled. Because both endpoint hours are included, a 24-hour window can produce 25 hourly buckets.

### `GET /api/events`

Retrieves a paginated list of stored events. Supports filtering by event type and inclusive date ranges.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | String | None | Optional comma-separated event types (`view`, `add_to_cart`, `purchase`). Whitespace-trimmed, deduplicated, case-sensitive. Unknown or empty tokens return HTTP 400. |
| `from` | String | None | Optional start ISO-8601 timestamp with timezone (inclusive). |
| `to` | String | None | Optional end ISO-8601 timestamp with timezone (inclusive). `from > to` returns HTTP 400. |
| `page` | Integer | `1` | 1-based page number. Non-positive or non-integer values return HTTP 400. |
| `limit` | Integer | `25` | Events per page (1 to 100). Exceeding 100 returns HTTP 400. |

**Example request**

```bash
curl "http://localhost:4000/api/events?type=view,purchase&limit=2"
```

**Response shape**

```json
{
  "data": [
    {
      "type": "view",
      "price": 699.99,
      "sessionId": "s_step2_test",
      "category": "electronics",
      "ts": "2026-11-07T09:20:00.000Z",
      "productId": "p_1001",
      "quantity": 1,
      "device": "desktop",
      "userId": "u_step2_test",
      "eventId": "step2-valid-http-001",
      "country": "IN"
    },
    {
      "eventId": "286c3589-8e44-4af8-9e48-a5e56bb4479c",
      "userId": "u_000215",
      "sessionId": "s_000721",
      "type": "purchase",
      "productId": "p_1001",
      "category": "electronics",
      "price": 699.99,
      "quantity": 2,
      "device": "mobile",
      "country": "IN",
      "ts": "2026-11-07T08:26:31.338Z"
    }
  ],
  "page": 1,
  "limit": 2,
  "total": 150002,
  "totalPages": 75001,
  "filters": {
    "type": null,
    "from": null,
    "to": null
  }
}
```

Events are sorted by timestamp descending (`ts: -1`), breaking ties by document identifier ascending (`_id: 1`). The internal MongoDB `_id` is excluded from returned documents. Requests past the last page return HTTP 200 with an empty `data` array and accurate pagination metadata.

**Error responses**

All error responses return an error envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| HTTP status | Code | Condition |
|---|---|---|
| `400` | `INVALID_EVENT_TYPE` | Unknown, empty, or non-string `type` values |
| `400` | `INVALID_TIMESTAMP` | Malformed, date-only, missing timezone, or non-string `from`/`to` values |
| `400` | `INVALID_DATE_RANGE` | `from` timestamp is after `to` timestamp |
| `400` | `INVALID_PAGE` | Non-integer, non-positive, or non-string `page` values |
| `400` | `INVALID_LIMIT` | `limit` not in 1–100, non-integer, or non-string |
| `500` | `QUERY_FAILED` | Database read or cursor failure |

### `GET /api/stats`

Returns live system metrics optimized for low-latency dashboard polling (5-second intervals). Computes total document count, throughput (events/min), and the dominant product category in the active window.

**Query parameters**

- `to` *(optional)*: ISO-8601 timestamp with timezone. Anchors the sliding window (defaults to latest recorded event timestamp).
- `windowMinutes` *(optional)*: Duration in minutes (1–60, default: 5).

```bash
curl http://localhost:4000/api/stats
curl "http://localhost:4000/api/stats?windowMinutes=15"
```

**Success response (HTTP 200)**

```json
{
  "totalEvents": 150002,
  "eventsPerMinute": 0.2,
  "window": {
    "from": "2026-11-07T09:15:00.000Z",
    "to": "2026-11-07T09:20:00.000Z",
    "durationMinutes": 5
  },
  "eventsInWindow": 1,
  "topInsight": {
    "type": "top_category",
    "category": "electronics",
    "events": 1,
    "share": 100,
    "description": "electronics is leading current activity with 1 events (100% of window traffic)"
  }
}
```

If no events exist in the selected window, `topInsight` is returned as `null`.

**Error responses**

| HTTP status | Code | Condition |
|---|---|---|
| `400` | `INVALID_TIMESTAMP` | Malformed, date-only, missing timezone, or non-string `to` value |
| `400` | `INVALID_WINDOW` | `windowMinutes` not an integer between 1 and 60 |
| `500` | `QUERY_FAILED` | Database execution failure |

### Analytics window behavior

For both analytics endpoints:

- Without `to`, the API finds the latest stored event and anchors the window to that timestamp.
- With `to`, the API validates the supplied ISO-8601 timestamp.
- The window starts exactly 24 hours before `to`.
- Both ends of the timestamp range are inclusive.
- If the collection is empty, the endpoints return empty analytics structures.

## 🧪 Tests

The repository includes focused Node.js test files covering:

- ISO-8601 timestamp parsing, invalid timestamp rejection, and URL-encoded timezone offset normalization.
- Inclusive 24-hour aggregation windows.
- Event-type counting and purchase-only revenue.
- Deterministic top-product sorting and result limits.
- UTC hourly bucket generation and zero-filling.
- Conversion-rate handling when denominators are zero.
- Events explorer validation, filter construction, pagination boundaries, unsafe offset protection, and NoSQL injection resistance.
- Live statistics computation, sliding time windows, events per minute, and top category insight extraction.
- Router handler execution with in-memory collection fixtures, stable tie-breaking, and database failure recovery.

Run the unit and mocked-router test suite:

```bash
npm test --prefix server
```

Run the read-only live MongoDB verification:

```bash
npm run test:integration --prefix server
```

The unit test suite contains 53 test cases across four test files (`topProducts.test.js`, `funnel.test.js`, `events.test.js`, and `stats.test.js`). The live integration suite (`events.integration.test.js` and `stats.integration.test.js`) runs non-mutating assertions against the configured MongoDB collection.

## 🔐 Operational notes

- The default configuration is intended for local development.
- The API's CORS allowlist contains the two local Vite origins: `localhost:5173` and `127.0.0.1:5173`.
- No authentication layer is present in the supplied API routes.
- Do not expose this development API publicly without adding appropriate authentication, authorization, rate limiting, and deployment configuration.
- Keep `server/.env` and credentials out of version control.
- The seeder does not clear existing records; review the target database before running large seed jobs.

## 🗺️ Current implementation boundary

**Present in the supplied archive**

- Synthetic event generator and MongoDB seeder.
- Six MongoDB indexes.
- Health, ingestion, event explorer, and live statistics endpoints.
- Top-products aggregation endpoint.
- Hourly-funnel aggregation endpoint.
- Unit-test source files for all endpoints and pipelines (53 test cases).
- Integration test suite for live database verification (2 suites).

**Not verifiable or not included in the supplied archive**

- A runnable React/Vite frontend.
- Dashboard charts and user-facing analytics screens.
- Segment analytics endpoint.
- P3 analytics pipeline.
- Performance benchmarks or production deployment configuration.

This boundary is intentional: documented features should match the code, not an aspirational roadmap.

## 🤝 Contributing

Issues and pull requests are welcome. Please include reproduction steps, expected behavior, and test coverage when proposing a change.

Before contributing, check the current implementation boundary and avoid committing secrets, local environment files, generated build output, or database dumps.

## 📄 License

No `LICENSE` file was present in the supplied archive. Add a license file before presenting the project as open source under a specific license.

---

<div align="center">

**If DataForge is useful, consider giving the repository a ⭐**

[Star DataForge](https://github.com/Gagann-09/DataForge) · [Report an issue](https://github.com/Gagann-09/DataForge/issues) · [Explore the source](https://github.com/Gagann-09/DataForge)

</div>
