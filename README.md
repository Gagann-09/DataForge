# DATAFORGE — MongoDB Big Data: Store → Process → Analyse

E-commerce clickstream analytics on 100k+ synthetic events.

Stack: MongoDB · Node/Express · React/Vite · Recharts.

## 1. Prerequisites

- Node.js 18+
- MongoDB 6+ running locally
- MongoDB URI: mongodb://127.0.0.1:27017

## 2. Setup

- npm run install:all
- Copy server/.env.example to server/.env
- Configure local MongoDB connection if necessary.

## 3. Seed data

- npm run seed
- Default target: 150,000 documents.
- Configurable using SEED_COUNT.
- Indexes will be created automatically during the seeding phase.

## 4. Run

- npm run dev
- API: http://localhost:4000
- Web: http://localhost:5173

## 5. Architecture

Document the exact supplied architecture.

## 6. Index strategy

Reserved for Phase 2 implementation.

## 7. Aggregation pipelines (P1 / P2 / P3)

Reserved for Phase 3 implementation.

## 8. API reference + sample curl

Reserved for Phase 6 implementation.

## 9. Demo script

Reserved for Phase 6 implementation.