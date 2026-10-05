# Free hosting: Oracle Cloud Always Free VM

Oracle's Always Free tier includes real VMs that cost $0 forever — enough to
run a LilithList node. This guide uses an Ampere ARM VM (1 OCPU / 6 GB RAM is
plenty; you can claim up to 4 OCPUs / 24 GB free).

## 1. Create the account and VM

1. Sign up at cloud.oracle.com (requires a credit card for verification, but
   Always Free resources are not charged).
2. Console → Compute → Instances → Create instance.
   - Image: **Ubuntu 22.04 or 24.04**
   - Shape: **Ampere A1** (or AMD E2.1.Micro) — keep within Always Free limits.
   - Networking: keep the default VCN. **Check "Assign a public IPv4 address".**
   - Add your SSH public key (generate one: `ssh-keygen -t ed25519`).
3. After creation, note the **public IP**.

## 2. Open ports 80/443 (Oracle blocks them twice)

**a) VCN security list** (Console → Networking → Virtual cloud networks →
your VCN → Security lists → Default security list → Add ingress rules):

| Source | Protocol | Port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**b) Instance firewall** — Oracle's Ubuntu images ship with iptables
dropping everything but SSH. SSH in and run:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

## 3. Point your domain at the VM

In your DNS provider, create an `A` record → the instance's public IP.
(A free subdomain works too. Wait a few minutes for propagation.)

## 4. Install LilithList

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git caddy sqlite3
sudo git clone https://github.com/numbpill3d/lilithlist.git /opt/lilithlist
sudo useradd --system --home /opt/lilithlist lilith
sudo mkdir -p /var/lib/lilithlist /var/backups/lilithlist
sudo chown lilith:lilith /var/lib/lilithlist

# secrets ( filling these in is mandatory )
openssl rand -hex 32      # → LILITH_SECRET_KEY
openssl rand -base64 24   # → MOD_BOOTSTRAP_KEY
sudo cp /opt/lilithlist/deploy/lilithlist.env.example /etc/lilithlist.env
sudo chmod 600 /etc/lilithlist.env
sudo nano /etc/lilithlist.env   # paste both secrets

sudo cp /opt/lilithlist/deploy/lilithlist.service /etc/systemd/system/
sudo systemctl enable --now lilithlist
systemctl status lilithlist   # should show active (running)
```

On ARM (Ampere) everything above works unchanged — Node 22 ships arm64
builds and the app has zero native dependencies.

## 5. HTTPS with Caddy

```bash
sudo nano /etc/caddy/Caddyfile   # or copy deploy/Caddyfile, replace the domain
```

```
your-domain.org {
	reverse_proxy 127.0.0.1:4173
}
```

```bash
sudo systemctl reload caddy
```

Caddy fetches a Let's Encrypt certificate automatically.

## 6. Verify go-live

- `https://your-domain.org/api/meta` → `{"version":"1.0.0",…,"demo":false}`
- No demo banner, empty board (production never seeds).
- Install the nightly backup: `sudo cp /opt/lilithlist/deploy/backup-nightly.sh /etc/cron.daily/lilithlist-backup && sudo chmod +x /etc/cron.daily/lilithlist-backup`
- Work through `docs/DEPLOY.md` (moderation team, crisis resources, anonymity posture).

## Notes

- Always Free VMs are reclaimed if idle? No — idle *paid-shape* resources can
  be reclaimed, but Always Free VMs persist as long as the account is active.
  Still: keep the automated backups from step 6 — they are your safety net.
- Outbound email is blocked by Oracle (port 25) — irrelevant here; the node
  sends no email.
