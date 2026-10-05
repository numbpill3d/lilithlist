# Go-live checklist: deploying LilithList for real

This is the "not a demo" path. Work through every item; each exists because
real safety data is at stake. See also `docs/ANONYMITY.md` and
`docs/OPERATIONS.md`.

## 1. Secrets (do this first)

```bash
export LILITH_SECRET_KEY=$(openssl rand -hex 32)   # encryption at rest — REQUIRED in production
export MOD_BOOTSTRAP_KEY=$(openssl rand -base64 24) # first moderator key — REQUIRED in production
```

- Store both in a password manager + one offline copy. Losing
  `LILITH_SECRET_KEY` makes encrypted bulletins **unrecoverable**.
- Never commit them, never print them into logs. The server refuses to start
  in production without them.

## 2. Machine + TLS

Follow README Path A (VPS + Caddy) or B (Docker). Then verify:

- `https://your-domain/api/health` → `{"ok":true}`
- `https://your-domain/api/meta` → `{"version":"1.0.0",…,"demo":false}`
  (`demo:false` hides all demo chrome in the UI — confirm the top banner is gone.)
- No fictional seed bulletins present (production never seeds).

## 3. Localize crisis resources

```bash
cp docs/resources.json.example data/resources.json
# edit: replace with verified LOCAL resources, keep YYYY-MM verified dates
export LILITH_RESOURCES=data/resources.json
```

Check the guide's "Urgent support" section renders your entries.

## 4. Moderation team

- Sign in at the moderation tab with `MOD_BOOTSTRAP_KEY`.
- Add every teammate in the "moderation team" panel; each copies their
  one-time key immediately. Agree who is on call and the review SLA.
- Test the loop: file a test bulletin, emergency-unpublish it, resolve it,
  then revoke it.

## 5. Backups (automate before inviting anyone)

Nightly online backup + off-site encrypted copy:

```bash
# /etc/cron.daily/lilithlist-backup
#!/bin/sh
set -e
sqlite3 /var/lib/lilithlist/lilithlist.db ".backup /var/backups/lilithlist/nightly.db"
# + your off-site sync here (encrypted, separate from LILITH_SECRET_KEY)
```

Restore-test quarterly on a scratch host.

## 6. Anonymity posture

- Decide: clearnet-only or onion-first. For sensitive communities, set up the
  onion service per `docs/ANONYMITY.md` and set `LILITH_ONION_URL`.
- `TRUST_PROXY=1` only behind a proxy you control.
- Publish your community's honest statement: anonymous over Tor,
  pseudonymous at best over clearnet.

## 7. Ongoing

- Updates: `git pull`, `npm test`, restart service. Watch releases.
- Review the mod queue daily; expiry (90 days) is automatic.
- Re-verify crisis resources at least yearly; keep the `verified` dates fresh.
