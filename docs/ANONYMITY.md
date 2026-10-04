# Anonymity model

LilithList is designed so the node operator holds as little linkable data as
possible — but "as little as possible" is not "anonymous". This page states
exactly what is and isn't protected, and how to run the node so Tor users get
real network-level anonymity.

## What the software guarantees

- **No accounts, ever.** Reporters are identified only by a one-time revocation
  receipt. The server stores `SHA-256(receipt)`; the plaintext lives in the
  reporter's browser. There is no email, no password, nothing to subpoena into
  an identity.
- **No access logs.** The node writes no request log — no IPs, no user agents,
  no query strings on disk. (Check `server/*.mjs`: there is no logging call on
  the request path.)
- **Rate limits are memory-only and salted.** Client IPs are hashed with a
  per-boot random salt (`clientKey` in `server/app.mjs`), kept in a Map, pruned
  hourly, and forgotten on restart. A database dump contains zero network
  identifiers.
- **No third-party network.** Zero dependencies, zero CDN fonts/scripts, no
  analytics, no external fetches except explicit peer sync you configured. A
  fresh profile in Tor Browser loads the whole page without leaving the Tor
  circuit for anything but your node.
- **Onion-first headers.** `Referrer-Policy: no-referrer`, and when
  `LILITH_ONION_URL` is set the node sends `Onion-Location` so Tor Browser
  offers the onion address. The UI shows "tor onion service" in the node card
  when visited over `.onion`.

## What the software does NOT give you

- **Clearnet visits are visible to the operator's network path.** Without Tor,
  the reverse proxy and the node see the visitor's IP in memory (never stored,
  but visible live). IP-hash rate limiting is abuse resistance, not anonymity.
- **TLS terminates at your proxy.** The node sees plaintext in memory. With an
  onion service there is no exit node and no clearnet metadata at all — this is
  the recommended configuration for sensitive communities.
- **No protection against a malicious operator.** Whoever runs the node can
  modify the code. Trust the operator, or run your own node.

## Running an onion service (recommended)

On the node machine, install Tor and add to `/etc/tor/torrc`:

```
HiddenServiceDir /var/lib/tor/lilithlist/
HiddenServicePort 80 127.0.0.1:4173
```

Then:

```bash
sudo systemctl restart tor
sudo cat /var/lib/tor/lilithlist/hostname   # your xxx.onion address
LILITH_ONION_URL=http://xxx.onion npm start
```

Tor Browser users visiting the clearnet domain will be offered the onion
address automatically via the `Onion-Location` header. Never log the onion
hostname alongside anything else, and keep the node's clearnet domain
registration private (WHOIS-guarded) if operator anonymity matters.

## Operator checklist

1. `NODE_ENV=production`, `MOD_BOOTSTRAP_KEY` set, `LILITH_SECRET_KEY` set.
2. Confirm `data/` and backups contain no logs (there are none by design).
3. `TRUST_PROXY=1` only behind a proxy you control; otherwise rate limits can
   be spoofed with `X-Forwarded-For`.
4. Onion service up, `LILITH_ONION_URL` set, tested in Tor Browser.
5. Tell your community honestly: anonymous *over Tor*, pseudonymous at best
   over clearnet.
