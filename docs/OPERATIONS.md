# Node operations: backup, restore, key rotation

## Backup

SQLite with WAL. Preferred online backup:

```bash
sqlite3 "$LILITH_DB" ".backup '/var/backups/lilithlist/backup-$(date +%F).db'"
```

Or stop the service first, then copy the `.db` file plus its `-wal`/`-shm` siblings.
Test restores quarterly: copy backup to a scratch host, `npm start`, check `/api/health` and bulletin count.

Off-site: encrypt backups at rest (e.g. age/gpg) and keep them separate from `LILITH_SECRET_KEY`.

## Key management

- `LILITH_SECRET_KEY` (32 bytes, hex): back up separately from the DB (password manager + offline copy). Losing it makes `enc:1:` rows unrecoverable.
- `MOD_BOOTSTRAP_KEY`: store in password manager; rotate by inserting a new moderator row and deleting the old session/key hash (no CLI yet — track in `moderators` table).
- `data/node_identity.json` (Ed25519 private key, mode 0600): back up with the DB. If lost, the node gets a new identity and peers must re-pin.

## Rotation

No in-place re-encryption yet. To rotate `LILITH_SECRET_KEY`: schedule downtime, dump decrypted data with the old key, switch env, re-import (rows re-encrypt on write). Verify by reading a bulletin before reopening.
