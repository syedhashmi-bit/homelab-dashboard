# Project Context

Infrastructure inventory. **Env var names only — no plaintext secrets.** Real values live in `.env.local` (gitignored) on the PC and in `/root/update-dashboard.sh` on TrueNAS.

## Always read first
- `CLAUDE.md` — architecture + hard rules (authoritative)
- `context.md` — this file: infrastructure, ports, env var names
- `memory.md` — past decisions and bug fixes
- `skills.md` — coding patterns
- `.claude/skills/Hashmi-homelab/SKILL.md` — workflow + style conventions

## What this is
Custom homelab monitoring dashboard. Next.js 15 App Router. Renders real-time metrics from TrueNAS via Prometheus + per-service API proxies. Single-page UI in `app/page.tsx`.

## Hosts

| Host | IP | Role |
|------|-----|------|
| TrueNAS Scale | `192.168.88.196` | Primary server, all services in Docker |
| MikroTik hAP ax³ | `192.168.88.1` | Router, RouterOS 7.22.1 |
| Dev PC | LAN DHCP | Windows, Claude Code, repo source of truth |

## TrueNAS hardware
- CPU: Intel Xeon E5-2680 v4 (28 cores)
- RAM: 63 GB ECC
- GPU: NVIDIA GeForce GTX 1660 SUPER (6 GB)
- Storage: ZFS pool at `/mnt/Pool` (4.4 TB), media at `/mnt/Pool/Media/`
- Primary network device: `enp4s0` (used in all `node_network_*` PromQL queries)

## Location
Launceston, Tasmania, Australia.
Open-Meteo coords: `lat=-41.4419, lon=147.1450`.

## Monitoring services — `192.168.88.196`

| Service | Port | Auth env var | Notes |
|---------|------|--------------|-------|
| Prometheus | `30104` | none | All node + GPU metrics |
| Grafana | `30037` | none | Embedded card |
| node-exporter | `9100` | none | Scraped by Prometheus |
| nvidia_gpu_exporter | `9835` | none | `utkuozdemir/nvidia_gpu_exporter:1.2.0` |
| SpeedTracker | `30220` | none | **Read-only — never trigger tests** |
| Uptime Kuma | `31050` | none | Slug-based monitor lookup |

## Media stack — `192.168.88.196`

| Service | Port | Auth env var |
|---------|------|--------------|
| Radarr | `30025` | `$RADARR_API_KEY` |
| Sonarr | `33027` | `$SONARR_API_KEY` |
| Bazarr | `30046` | `$BAZARR_API_KEY` (header `X-API-KEY`) |
| Tautulli | `30047` | `$TAUTULLI_API_KEY` |
| Prowlarr | `30050` | `$PROWLARR_API_KEY` |
| qBittorrent | `30024` | `$QBIT_USERNAME` / `$QBIT_PASSWORD` (cookie SID auth) |
| Overseerr | `30357` | `$OVERSEERR_API_KEY` |
| Plex | `32400` | not currently read by dashboard (Tautulli covers Plex sessions) |

## Network / infra — `192.168.88.196`

| Service | Port | Auth env var |
|---------|------|--------------|
| Pi-hole | `20720` | `$PIHOLE_PASSWORD` (v6 two-step: password → SID) |
| Nginx Proxy Manager | `30020` | `$NGINX_USERNAME` / `$NGINX_PASSWORD` |
| Uptime Kuma | `31050` | `$UPTIME_KUMA_API_KEY` (Bearer) |
| SpeedTracker | `30220` | `$SPEEDTEST_API_KEY` (Bearer, history endpoint) |
| Homepage | (separate) | none |

## MikroTik — `192.168.88.1`

| Field | Value |
|-------|-------|
| Web UI | `http://192.168.88.1` |
| REST | `http://192.168.88.1/rest/...` (called via `/api/mikrotik` server-side route — direct browser calls are CORS-blocked) |
| User env var | `$MIKROTIK_USERNAME` (typically `monitor-only`) |
| Password env var | `$MIKROTIK_PASSWORD` |

## Env vars consumed by the code

All credentials are server-side `process.env.*`. None hardcoded. As of the externalization PR, all infrastructure values (per-service URLs, paths, weather coords, Grafana UIDs) are also env-driven so the same Docker image works for any installation.

### Credentials
| Env var | Used by |
|---------|---------|
| `RADARR_API_KEY` | `services/route.ts` → `radarr()` |
| `SONARR_API_KEY` | `services/route.ts` → `sonarr()` |
| `BAZARR_API_KEY` | `services/route.ts` → `bazarr()` |
| `TAUTULLI_API_KEY` | `services/route.ts` → `tautulli()` |
| `PROWLARR_API_KEY` | `services/route.ts` → `prowlarr()` |
| `OVERSEERR_API_KEY` | `services/route.ts` → `overseerr()` |
| `QBIT_USERNAME` / `QBIT_PASSWORD` | `services/route.ts` → `qbittorrent()` |
| `PIHOLE_PASSWORD` | `services/route.ts` → `pihole()` |
| `NGINX_USERNAME` / `NGINX_PASSWORD` | `services/route.ts` → `nginxProxy()` |
| `UPTIME_KUMA_API_KEY` | `services/route.ts` → `uptimeKuma()` |
| `MIKROTIK_USERNAME` / `MIKROTIK_PASSWORD` | `mikrotik/route.ts` |
| `SPEEDTEST_API_KEY` | `speedtest/route.ts` |

### URLs (default to `${TRUENAS_IP}:<standard-port>` when unset)
| Env var | Default | Used by |
|---------|---------|---------|
| `TRUENAS_IP` | `192.168.88.196` | base for all per-service URL fallbacks |
| `PROMETHEUS_URL` | `${TRUENAS_IP}:30104` | metrics route |
| `RADARR_URL` | `${TRUENAS_IP}:30025` | services + activity routes + client SVC_URLS |
| `SONARR_URL` | `${TRUENAS_IP}:33027` | services + activity + client |
| `BAZARR_URL` | `${TRUENAS_IP}:30046` | services + client |
| `TAUTULLI_URL` | `${TRUENAS_IP}:30047` | services + activity + client |
| `QBIT_URL` | `${TRUENAS_IP}:30024` | services + client |
| `OVERSEERR_URL` | `${TRUENAS_IP}:30002` | services + client |
| `PIHOLE_URL` | `${TRUENAS_IP}:20720` | services + client |
| `PROWLARR_URL` | `${TRUENAS_IP}:30050` | services + client |
| `NGINX_URL` | `${TRUENAS_IP}:30020` | services + client |
| `UPTIME_KUMA_URL` | `${TRUENAS_IP}:31050` | services + client |
| `MIKROTIK_URL` | `http://192.168.88.1` | mikrotik route + client (header pill / link) |

### Infrastructure / filters
| Env var | Default | Used by |
|---------|---------|---------|
| `FS_PATH_PREFIX` | `/mnt/Pool/Media/` | metrics route filesystem filter |
| `POOL_PATH` | `/mnt/Pool` | metrics route pool-total lookup |
| `NETWORK_DEVICE_EXCLUDE` | `lo\|veth.*\|docker.*\|br.*` | metrics route net-throughput PromQL |
| `WEATHER_LAT` | `-41.4419` | weather route + `/api/config` |
| `WEATHER_LON` | `147.1450` | weather route + `/api/config` |

### Grafana embed (no defaults — when missing, the card renders a setup hint)
| Env var | Used by |
|---------|---------|
| `GRAFANA_BASE_URL` | `/api/config` (default `${TRUENAS_IP}:30037`) |
| `GRAFANA_DASHBOARD_UID` | `/api/config` — required for embed |
| `GRAFANA_DATASOURCE_UID` | `/api/config` — required for embed |
| `GRAFANA_PANEL_ID` | `/api/config` (default `panel-77`) |
| `GRAFANA_DASHBOARD_SLUG` | `/api/config` (default `node-exporter-full`) |

### Bookmarks
| Env var | Default |
|---------|---------|
| `BOOKMARKS_PATH` | `<cwd>/bookmarks.json` (i.e. `/app/bookmarks.json` in the Docker image) |

See `.env.local.example` for the full template with placeholder values, and `bookmarks.example.json` for the bookmark file schema.

## CORS rules

These services must be called via server-side proxy. Direct browser calls fail:
- Pi-hole (`:20720`)
- Bazarr (`:30046`)
- qBittorrent (`:30024`)
- MikroTik REST (`192.168.88.1`) — proxied via `/api/mikrotik`. The client-side `MikrotikTab` fetches the local route, not the router directly. Falls back to a static-info row on error.

## Filesystem filter (Prometheus)

Only mounts under `/mnt/Pool/Media/` displayed. Excluded fstypes (filtered at PromQL via `FS_EXCLUDE`): `tmpfs`, `devtmpfs`, `overlay`, `squashfs`, `ramfs`.

## Where secrets actually live

| Location | Role |
|----------|------|
| `.env.local` (PC, gitignored) | Local dev — Next.js loads automatically |
| `/root/update-dashboard.sh` (TrueNAS) | Production — passes `-e VAR=value` to `docker run` |
| Repo / Dockerfile | **Never.** No `COPY .env*`, no `ENV` for secret values |
| `.env.local.example` (PC, tracked) | Template — env var names + placeholder values, no real secrets |

When adding a new secret:
1. Add env var name to the appropriate table above.
2. Add a row to `.env.local.example` with a placeholder.
3. Add to `.env.local` on PC with the real value.
4. Add `-e NEW_VAR=value` to `/root/update-dashboard.sh` on TrueNAS.
5. Read it server-side only via `process.env.NEW_VAR` in an API route — never in a client component, never via `NEXT_PUBLIC_*`.
