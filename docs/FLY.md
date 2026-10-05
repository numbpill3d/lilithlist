# Free hosting: Fly.io (simplest $0 path)

Fly gives every account enough free allowance (~$5/mo credit) to run one
small LilithList node with a 1 GB persistent volume. No console maze: one CLI,
three commands. Your `Dockerfile` and `fly.toml` are already configured.

## 1. Install the CLI and sign up

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup   # or: fly auth login
```

## 2. Create the app + persistent volume

```bash
cd lilithlist
fly apps create lilithlist   # pick your own name if taken
fly volumes create lilithlist_data --region iad --size 1
```

The volume is the important part: without it, redeploys would wipe the
SQLite database. It is mounted at `/data`, matching `LILITH_DB`.

## 3. Set the two mandatory secrets

```bash
fly secrets set LILITH_SECRET_KEY=$(openssl rand -hex 32)
fly secrets set MOD_BOOTSTRAP_KEY=$(openssl rand -base64 24)
```

Save both in your password manager — losing `LILITH_SECRET_KEY` makes
encrypted bulletins unrecoverable.

## 4. Deploy

```bash
fly deploy
fly open   # opens https://lilithlist.fly.dev
```

HTTPS is automatic. Then verify:

- `https://<your-app>.fly.dev/api/meta` → `"demo":false`
- No demo banner, empty board (production never seeds).

## 5. Finish go-live in the app

Work through `docs/DEPLOY.md` steps 3–7 (crisis resources, moderation team,
backups, anonymity posture).

Backups on Fly: the volume persists across deploys, but still take your own
copies — `fly ssh console`, then:

```bash
sqlite3 /data/lilithlist.db ".backup /data/backup-$(date +%F).db"
```

and `fly sftp get /data/backup-XXXX-XX-XX.db .` to pull it home.

## Notes

- Machine: shared-cpu-1x with 256 MB RAM is enough and fits the free
  allowance. If Fly prompts for a larger size, choose the smallest.
- `auto_stop_machines = "off"` in `fly.toml` keeps the node awake so the
  moderation queue and federation timers behave. Sleeping machines would
  make the board intermittently unreachable.
- Custom domain: `fly certs add your-domain.org`, then point DNS at Fly.
