# Security Policy

## Supported Versions

DataForge is currently in active pre-release development. No tagged semver releases have been published to date (`git tag` is currently empty).

Security updates are evaluated and applied directly to active development branches:

| Branch / Target | Supported          | Description |
| --------------- | ------------------ | ----------- |
| `main`          | :white_check_mark: | Primary development branch |
| `m5/*`          | :white_check_mark: | Active release-readiness feature branch |
| Tagged Releases | None yet           | Semver release tags will be established upon initial production deployment |

---

## Reporting a Vulnerability

The DataForge team takes security seriously. If you discover a security vulnerability or weakness within this repository or application, please follow responsible disclosure guidelines.

**Do NOT report security vulnerabilities through public GitHub issues.**

Instead, report vulnerabilities privately by:
1. Submitting a confidential report via GitHub's [Private Vulnerability Reporting](https://github.com/Gagann-09/DataForge/security/advisories/new) feature on the repository.
2. Or contacting the repository maintainer directly via GitHub profile communications.

### What to Include in Your Report
To help us triage and resolve the issue quickly, please provide:
- A detailed description of the vulnerability.
- Steps to reproduce or proof-of-concept (PoC) code.
- Potential impact and affected components (e.g., API routes, ingestion pipeline, client dashboard).
- Any proposed remediation or mitigation steps.

### Response Timeline
- **Initial Acknowledgement:** Within 48 hours of receipt.
- **Triage & Assessment:** Within 5 business days.
- **Fix & Advisory Release:** Handled collaboratively before public disclosure.

---

## Known Security Architecture & Deployment Requirements

DataForge is currently engineered as an internal clickstream analytics and visualization engine. Before public Internet exposure, the following critical security controls must be met:

1. **Authentication & Authorization (Release Blocker):**
   The DataForge HTTP API does not currently incorporate an authentication layer (e.g., OAuth 2.0, JWT, API Keys). Deployments exposed beyond a trusted VPC / internal network boundary must front the API with an API gateway or authentication proxy.

2. **Network Isolation:**
   The MongoDB cluster must reside within a private subnet or VPC with strict network access control lists (NACLs) and TLS encryption in transit. Never expose MongoDB directly to the public Internet without credentials and IP whitelisting.

3. **Rate Limiting:**
   The built-in in-memory rate limiter protects single-instance processes from accidental request storms. Distributed production workloads require edge rate-limiting (e.g., Cloudflare, AWS WAF, or Redis-backed rate limiting).

4. **Environment Variables & Secrets:**
   Never commit `.env` files, production credentials, or connection strings into version control. Use a secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault) in production environments.
