# Legacy design artifacts

These files are from **SISTERNET**, the earlier design iteration of this project
(React + Express + PostgreSQL, uploaded 2026-02). They are preserved for reference
only and do **not** describe the current implementation.

The shipping node uses a **zero-dependency Node + SQLite** backend. The authoritative
schema is the migration in [`server/db.mjs`](../../server/db.mjs), not
`sisternet-postgres-schema.sql`.
