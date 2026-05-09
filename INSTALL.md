# Installation

Three install paths, in order from "easiest" to "most flexible":

1. **TrueNAS Scale Custom App** — point-and-click via the TrueNAS web UI
2. **Docker Compose** — for any homelab Docker host
3. **Plain `docker run`** — for the command-line type

The image is published to **`ghcr.io/syedhashmi-bit/homelab-dashboard:latest`** by GitHub Actions on every push to `main`. Pull, configure with env vars, run.

---

## Before you start

Gather the credentials for whichever services you want to monitor — you don't need all of them. The dashboard simply shows `—` (or hides the card via Settings) for any service it can't reach.

| Service | What you need |
|---|---|
| Radarr / Sonarr / Bazarr / Tautulli / Prowlarr / Overseerr | API key (Settings → General / Security in each app) |
| qBittorrent | username + password |
| Pi-hole | the admin password (or app password if you've enabled 2FA) |
| Nginx Proxy Manager | login email + password |
| Uptime Kuma | API key (Settings → API Keys) |
| MikroTik | a *read-only* RouterOS user — don't reuse your admin login |
| SpeedTracker | bearer token (Settings → API Tokens) |

The full env-var list is in [`.env.local.example`](.env.local.example). Most of it is optional with sensible defaults.

---

## Path 1 — TrueNAS Scale Custom App (UI)

Works on TrueNAS Scale 24.10 (Electric Eel) and later.

1. **Apps** → **Discover Apps** → top-right click **Custom App**
2. **Application Name**: `homelab-dashboard`
3. **Image repository**: `ghcr.io/syedhashmi-bit/homelab-dashboard`
4. **Image tag**: `latest`
5. **Container Environment Variables** — click **Add** for each one you need. Required minimum:
   - `TRUENAS_IP` = your TrueNAS LAN IP (e.g. `192.168.88.196`)
   - The API keys / passwords for whichever services you use
6. **Networking** → set **Network mode** to `host`. (Or use a bridge network with port `3000` mapped, if you prefer.)
7. **Storage** (optional, for custom bookmarks):
   - Type: `Host Path`
   - Host Path: path to your `bookmarks.json` (e.g. `/mnt/Pool/Configs/bookmarks.json`)
   - Mount Path: `/app/bookmarks.json`
   - Read Only: yes
8. **Save**. TrueNAS pulls the image and starts the container.

Visit **http://&lt;truenas-ip&gt;:3000** to see the dashboard.

---

## Path 2 — Docker Compose

For Docker hosts that aren't TrueNAS, or for users who prefer compose.

```bash
# 1. Get the example files
curl -O https://raw.githubusercontent.com/syedhashmi-bit/homelab-dashboard/main/docker-compose.example.yml
curl -O https://raw.githubusercontent.com/syedhashmi-bit/homelab-dashboard/main/bookmarks.example.json

# 2. Rename and edit
mv docker-compose.example.yml docker-compose.yml
mv bookmarks.example.json     bookmarks.json
nano docker-compose.yml       # fill in your env vars
nano bookmarks.json           # customize your bookmarks

# 3. Start
docker compose up -d
docker compose logs -f homelab-dashboard
```

---

## Path 3 — Plain `docker run`

For the script-friendly. Save as `update-dashboard.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

NAME=homelab-dashboard
IMAGE=ghcr.io/syedhashmi-bit/homelab-dashboard:latest

log() { echo "[$(date +'%H:%M:%S')] $*"; }

log "pulling latest image"
docker pull "$IMAGE"

log "stopping old container"
docker stop "$NAME" 2>/dev/null || true
docker rm   "$NAME" 2>/dev/null || true

log "starting new container"
docker run -d \
  --name "$NAME" \
  --network host \
  --restart unless-stopped \
  -v /root/bookmarks.json:/app/bookmarks.json:ro \
  -e TRUENAS_IP=192.168.88.196 \
  -e RADARR_API_KEY='<your-key>' \
  -e SONARR_API_KEY='<your-key>' \
  -e BAZARR_API_KEY='<your-key>' \
  -e TAUTULLI_API_KEY='<your-key>' \
  -e PROWLARR_API_KEY='<your-key>' \
  -e OVERSEERR_API_KEY='<your-key>' \
  -e QBIT_USERNAME='admin' \
  -e QBIT_PASSWORD='<your-password>' \
  -e PIHOLE_PASSWORD='<your-password>' \
  -e NGINX_USERNAME='<your-email>' \
  -e NGINX_PASSWORD='<your-password>' \
  -e UPTIME_KUMA_API_KEY='<your-token>' \
  -e MIKROTIK_USERNAME='monitor-only' \
  -e MIKROTIK_PASSWORD='<your-password>' \
  -e SPEEDTEST_API_KEY='<your-token>' \
  "$IMAGE"

log "tailing logs (Ctrl+C to exit)"
sleep 2
docker logs -f --tail 30 "$NAME"
```

Make it executable + run:

```bash
chmod +x update-dashboard.sh
./update-dashboard.sh
```

To update later, just re-run the script. It pulls the latest image and restarts.

> **Tip:** single-quote any password that contains `$`, `!`, `&`, or `#` so bash doesn't try to interpret them.

---

## Customizing bookmarks

The right-hand "Bookmarks" section is driven by a JSON file mounted at `/app/bookmarks.json` inside the container. Without a mount it shows a small generic default set.

Schema is the same as [`bookmarks.example.json`](bookmarks.example.json). Each top-level entry is a column, with a title, an accent color, and a list of items.

```json
[
  {
    "title": "Productivity",
    "accentColor": "#10b981",
    "items": [
      { "name": "ChatGPT", "url": "https://chatgpt.com", "icon": "https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" }
    ]
  }
]
```

After editing, the change is picked up within ~60 seconds (config cache TTL) — no container restart needed.

---

## Customizing the Grafana embed (optional)

Without `GRAFANA_DASHBOARD_UID` and `GRAFANA_DATASOURCE_UID` set, the Grafana card shows a "not configured" hint. To enable the embed:

1. Open your Grafana dashboard. The URL contains the dashboard UID:
   `http://grafana:3000/d/<DASHBOARD_UID>/<slug>`
2. **Configuration** → **Data sources** → click your Prometheus → URL contains the datasource UID:
   `/datasources/edit/<DATASOURCE_UID>`
3. Set the env vars on the container:

```yaml
environment:
  GRAFANA_BASE_URL:       http://grafana:3000
  GRAFANA_DASHBOARD_UID:  <DASHBOARD_UID>
  GRAFANA_DATASOURCE_UID: <DATASOURCE_UID>
  GRAFANA_PANEL_ID:       panel-77    # or whichever panel ID you want
  GRAFANA_DASHBOARD_SLUG: node-exporter-full
```

4. In Grafana itself, you'll also need:
   - **Configuration** → **Settings** → **Security** → set `allow_embedding` to `true` (or env var `GF_SECURITY_ALLOW_EMBEDDING=true`)
   - For unauthenticated viewing: `GF_AUTH_ANONYMOUS_ENABLED=true` and `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer`

---

## Adapting Prometheus filters

The Filesystems card only shows mountpoints under `/mnt/Pool/Media/` by default — that's the original deployment's path. Override:

```yaml
environment:
  FS_PATH_PREFIX:         /mnt/yourpool/yourpath/
  POOL_PATH:              /mnt/yourpool
  NETWORK_DEVICE_EXCLUDE:  lo|veth.*|docker.*|br.*    # default; tune for unusual interface naming
```

---

## Updating

Pull the latest image and re-run:

```bash
docker pull ghcr.io/syedhashmi-bit/homelab-dashboard:latest
docker compose up -d         # or run your update-dashboard.sh script
```

GitHub Actions builds a new `:latest` image on every push to the repo's `main` branch. You can also pin to a specific version (`:v1.2.3`) or short SHA (`:sha-abc1234`) for stability.

---

## Troubleshooting

### Cards stuck on "—"

The card renders that placeholder when the upstream service is reachable but the auth/data fetch failed. Run `docker logs homelab-dashboard` and look for the offending request. Most common causes:
- Wrong API key / password env var
- Wrong service URL (set `RADARR_URL=...` etc. if your service is on a non-default port)
- Service is up but auth was rotated and the env var still has the old value

### "Health pill" appearing on Radarr / Sonarr / Prowlarr

That's pulling the live `/api/v3/health` endpoint of the *arr — meaning the *arr itself reports an issue (e.g. an indexer is unavailable). Click into the *arr's UI to see the actual warnings.

### Activity ticker is empty

The ticker shows recent grabs/imports/streams from Sonarr, Radarr, and Tautulli. Empty just means none of those have new history — not a bug. If it stays empty after activity has happened, check the API keys for those three services.

### Bookmarks show defaults instead of mine

Volume isn't mounted. Confirm the file exists and the path inside the container:

```bash
docker exec homelab-dashboard ls -la /app/bookmarks.json
docker exec homelab-dashboard cat   /app/bookmarks.json | head
```

### Container can't reach services

If you're using `network_mode: host`, services on the same host work directly. If you're using a bridge network, the container can't see `127.0.0.1` on the host — use the host's LAN IP for `TRUENAS_IP`, `MIKROTIK_URL`, etc.

---

## Security notes

- All credentials are read **server-side only**. Nothing in the env-var list above is ever exposed to the browser bundle.
- `/api/config` exposes only non-secret runtime config (URLs, panel IDs, bookmarks). The dashboard isn't designed for the public internet — keep it behind a reverse proxy with auth, or only expose it on your LAN.
- Default behavior allows anonymous read-only access to the dashboard itself. There's no login flow.
