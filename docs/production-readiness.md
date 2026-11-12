# DataForge — Production Readiness & Deployment Guide

This document defines the deployment architecture, configuration parameters, security controls, operational procedures, and release blockers for promoting DataForge from a local development environment to an enterprise production environment.

---

## 1. Local Development Architecture Overview

The current local development setup consists of three decoupled layers:

```
[ Browser / Client ]
       │
       │ HTTP / JSON (Port 5173 - Vite Dev Server / Static SPA)
       ▼
[ DataForge API Server ] (Port 4000 - Express 4 on Node.js 20/22)
  ├── Security Headers Middleware (CSP, HSTS, X-Frame-Options, Sniffing prevention)
  ├── Configurable CORS Whitelist
  ├── In-Memory Sliding-Window Rate Limiter
  ├── Ingestion & Analytics Pipeline Handlers (/api/ingest, /api/p1, /api/p2, /api/p3, /api/stats, /api/events)
  └── Graceful Shutdown Handlers (SIGINT, SIGTERM, Uncaught/Unhandled)
       │
       │ Native MongoDB Driver (Connection Pool maxPoolSize: 20)
       ▼
[ MongoDB Database ] (Port 27017 - Database: `dataforge`, Collection: `events`)
  ├── 150,000+ Clickstream Event Documents
  └── Compound Indexes: (ts, type), (userId, type, price), eventId (unique)
```

---

## 2. Configuration & Environment Variables

All runtime settings are driven through environment variables.

| Variable | Type | Default | Production Requirement | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | String | `development` | `production` | Enables production optimizations, strict warnings, and HTTPS HSTS enforcement. |
| `PORT` | Integer | `4000` | As allocated | HTTP listening port for the Express application. |
| `MONGODB_URI` | String | `mongodb://127.0.0.1:27017` | Required | Standard MongoDB connection URI. Must include credentials, replica set, and TLS parameters in production. |
| `DB_NAME` | String | `dataforge` | Required | Target database name. |
| `COLLECTION_NAME` | String | `events` | Required | Target collection name for events. |
| `CORS_ORIGIN` | String | `localhost:5173` | Explicit FQDNs | Comma-separated list of trusted client origins (e.g. `https://dataforge.myorg.com`). |
| `TRUST_PROXY` | Boolean / String / Integer | `false` | Required behind proxy | Configures Express `trust proxy`. **Warning:** Setting `true` trusts all upstream hops indiscriminately, exposing client IP resolution to spoofing. In production, configure trusted CIDR subnets (e.g. `10.0.0.0/8`) or a validated integer hop count (e.g. `1`). |
| `RATE_LIMIT_WINDOW_MS`| Integer | `60000` (1m) | Tunable | Time window in milliseconds for the sliding rate limiter. |
| `RATE_LIMIT_MAX` | Integer | `300` | Tunable | Maximum allowed requests per IP per window. |
| `SEED_COUNT` | Integer | `150000` | N/A | Number of synthetic documents generated during initial seeding (dev/test only). |

---

## 3. MongoDB Network & Security Requirements

In production, running a standalone local MongoDB instance without authentication or replication is strictly prohibited.

1. **High Availability & Replicas:**
   - Deploy MongoDB as a Replica Set (minimum 3 nodes: Primary, Secondary, Arbiter/Secondary) or managed service (MongoDB Atlas, AWS DocumentDB).
   - Connection strings must specify replica set names (`?replicaSet=rs0`).

2. **Authentication & Authorization (Least Privilege):**
   - Enable SCRAM-SHA-256 authentication.
   - Create a dedicated application user with restricted privileges:
     ```javascript
     db.createUser({
       user: "dataforge_app",
       pwd: "<STRONG_PASSWORD>",
       roles: [
         { role: "readWrite", db: "dataforge" }
       ]
     });
     ```
   - Never use the `root` or `admin` account for application traffic.

3. **Network Isolation:**
   - Database instances must reside within private subnets or dedicated Virtual Private Clouds (VPCs).
   - Bind MongoDB strictly to internal interfaces. Do not expose port 27017 to public subnets.
   - Enforce security group / firewall ingress rules permitting traffic only from API server security groups.

4. **Encryption in Transit & at Rest:**
   - Enforce TLS 1.3 encryption on all connections (`tls=true`, `tlsCAFile=...`).
   - Enable encrypted storage engines (WiredTiger encryption-at-rest or cloud volume encryption).

5. **Index Pre-Flight Verification:**
   - Ensure mandatory indexes are verified before handling live traffic:
     - `{ eventId: 1 }` (unique)
     - `{ ts: -1, type: 1 }` (compound)
     - `{ userId: 1, type: 1, price: 1 }` (compound)

---

## 4. Authentication & Authorization (Production Release Blocker)

> [!CAUTION]
> **CRITICAL RELEASE BLOCKER:**
> The current DataForge API is unauthenticated. Anyone with network access to the API can submit event batches to `/api/ingest`, trigger database aggregations, and query customer clickstream data.
>
> Prior to exposing DataForge to any non-isolated network or public URL, the repository owner must implement or front the service with an authentication and authorization layer.

### Recommended Implementation Paths
1. **API Gateway / Ingress Authentication (Recommended for Phase 1):**
   - Front the API with Cloudflare Access, AWS API Gateway, Kong, or Traefik with OIDC/OAuth 2.0 plugins.
   - The Gateway validates bearer JWTs before routing traffic to the Node.js backend.
2. **Application-Level Middleware (Phase 2):**
   - Integrate an industry-standard OAuth 2.0 / JWT validation middleware (e.g., `express-oauth2-jwt-bearer` or `@auth0/express-openid-connect`).
   - Define role-based access control (RBAC):
     - `ingest:write`: Machine service accounts submitting clickstream events.
     - `analytics:read`: Dashboard users reading aggregations and event logs.

---

## 5. CORS & Rate Limiting Architecture

1. **CORS Hardening:**
   - Specify explicit, fully qualified domain names in `CORS_ORIGIN`.
   - Never configure `CORS_ORIGIN=*` in production environments.
   - Pre-flight `OPTIONS` requests are handled automatically with strict method (`GET, POST, OPTIONS`) and header restrictions.

2. **Rate Limiting Architecture:**
   - **Instance-Local Safeguard:** The built-in in-memory rate limiter (`server/src/middleware/rateLimiter.js`) provides immediate node-level protection against accidental client loops or single-host denial-of-service attempts.
   - **Distributed Production Limitation:** In-memory rate limiting does not share state across multiple container instances or autoscaled Kubernetes pods.
   - **Enterprise Requirement:** In multi-pod deployments, place rate limiting at the ingress layer (e.g. AWS WAF, Nginx `limit_req`, or a shared Redis token-bucket via `rate-limiter-flexible`).

---

## 6. TLS Termination & Secret Management

1. **TLS Termination & Reverse Proxy Configuration:**
   - Terminate TLS 1.3 at the reverse proxy / cloud load balancer (ALB, Nginx, Cloudflare).
   - Forward traffic to the API container with `X-Forwarded-Proto: https`.
   - **Proxy Trust Configuration (`TRUST_PROXY`):**
     > [!WARNING]
     > Setting `TRUST_PROXY=true` trusts **all upstream hops indiscriminately**. A malicious client can forge `X-Forwarded-For: 1.2.3.4` headers, which Express will trust, spoofing client IP resolution and bypassing rate limiting.
     >
     > **Recommended Production Configuration:**
     > - **Specific Subnet / CIDR:** Set `TRUST_PROXY=10.0.0.0/8` (or `loopback, 172.16.0.0/12`) to trust only your VPC / ingress reverse proxy IP range.
     > - **Hop Count:** If deployed behind a single known reverse proxy hop (e.g., AWS ALB or Nginx), set `TRUST_PROXY=1` so only the immediate preceding hop is trusted.
     > - **Direct Internet Exposure:** If running directly exposed without a reverse proxy, leave `TRUST_PROXY=false` (the default).

2. **Secret Management:**
   - Never store production credentials in `.env` files or commit them to Git.
   - Inject secrets as container environment variables dynamically from:
     - AWS Secrets Manager / Parameter Store
     - GCP Secret Manager
     - HashiCorp Vault
     - Kubernetes Secrets (sealed or CSI driver)

---

## 7. Logging, Monitoring & Health Probes

1. **Structured Logging:**
   - Standard HTTP request logging outputs method, path, HTTP status, and response latency in milliseconds to `stdout`.
   - In production, pipe container logs to an aggregator (Datadog, Loki, CloudWatch) for anomaly alerting.

2. **Health & Readiness Endpoints:**
   - `GET /api/health` performs an active `db.runCommand({ ping: 1 })` check against the MongoDB connection.
   - **Response Format:**
     - Success (200 OK): `{"status":"healthy","ok":true,"db":"connected","timestamp":"2026-11-11T..."}`
     - Failure (503 Service Unavailable): `{"status":"unhealthy","ok":false,"db":"disconnected","timestamp":"..."}`
   - The endpoint emits zero internal system paths, hostnames, or credentials, making it safe for public or internal load balancer health checks.

3. **Backup Expectations:**
   - Daily automated logical dumps (`mongodump`) or continuous Point-in-Time Recovery (PITR) via MongoDB oplog replication.
   - Test disaster recovery restoration procedures into an isolated staging database on a quarterly cadence.

---

## 8. Deployment & Rollback Procedures

### Current Application Runtime Deployment
The repository currently supports direct Node.js runtime deployment (no `Dockerfile` is present in the repository):

1. **Dependency Installation & Build:**
   ```bash
   # Install server production dependencies using verified lockfile
   npm ci --prefix server --omit=dev

   # Build client static distribution bundle
   npm ci --prefix client
   npm run build --prefix client
   ```

2. **Server Execution:**
   ```bash
   # Start the Express API server in production mode
   NODE_ENV=production PORT=4000 npm start --prefix server
   ```

3. **Client Static Asset Serving:**
   - Host `client/dist/` behind a production HTTP reverse proxy (Nginx, Caddy, Cloudflare Pages, or AWS S3 + CloudFront).
   - Configure client SPA fallback routing (`try_files $uri $uri/ /index.html`).

4. **Health Check Verification:**
   ```bash
   curl -f http://localhost:4000/api/health || exit 1
   ```

### Rollback Procedure
1. If the newly deployed version fails health checks or reports elevated HTTP 5xx errors:
   - Roll back to the previous stable Git commit on `main`.
   - Re-run `npm ci --prefix server --omit=dev`.
   - Restart the server process and verify health via `GET /api/health`.
2. Document incident telemetry and post-mortem logs.

---

## 9. Outstanding Production Blockers Summary

Prior to final public release approval, the following items remain open blockers:

| Item | Category | Severity | Description & Required Owner Action |
| :--- | :--- | :--- | :--- |
| **PB-1** | Authentication & AuthZ | **CRITICAL** | API is unauthenticated. Owner must select and configure an identity provider (OAuth/JWT/Gateway). |
| **PB-2** | Database High Availability | **HIGH** | Standalone MongoDB instance must be upgraded to a managed Replica Set with TLS and SCRAM authentication. |
| **PB-3** | Edge Rate Limiting | **MEDIUM** | In-memory rate limiting must be supplemented with edge rate limiting (Cloudflare/WAF/Redis) for multi-pod scale. |
| **PB-4** | Container Definition | **MEDIUM** | No `Dockerfile` currently exists in the repository. A multi-stage container build definition is required for Kubernetes/ECS deployment. |
| **PB-5** | Dev-Dependency CVEs | **LOW** | Vulnerabilities in `@faker-js/faker` and `vite` exist in devDependencies. Remediate with future non-breaking major release updates. |
| **PB-6** | Production Domain DNS & TLS | **MEDIUM** | Configure production FQDN, DNS records, and TLS certificate termination on reverse proxy/load balancer. |
