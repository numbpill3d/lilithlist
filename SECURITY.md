# Security policy

LilithList serves a vulnerable audience. Please report security issues privately —
do not open a public issue for a vulnerability, abuse vector, or PII leak.

- **How to report:** email the node operator directly (see repo owner profile). Include steps to reproduce, impact, and affected version/commit. Allow reasonable time to fix before disclosure.
- **Scope:** `server/` validation, PII scanner bypass, auth (receipt / moderator), federation signature verification, rate limits, XSS/CSP, data retention/deletion.
- **Out of scope:** the intentional demo limitations in the README production boundary (no E2E encryption, no network anonymity) — those are documented, not bugs.
- **Abuse / takedown:** contact the operator running the node you used. Each node is independently operated; there is no central moderation. Include bulletin ID, reason, and jurisdiction context.
- **Data handling:** reports contain sensitive safety data. Do not include real personal data in bug reports, screenshots, or PoCs. Use the fictional seed data.
