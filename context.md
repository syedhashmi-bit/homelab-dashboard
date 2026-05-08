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
| Plex | `32400` | `$PLEX_TOKEN` |
| Radarr | `30025` | `$RADARR_API_KEY` |
| Sonarr | `33027` | `$SONARR_API_KEY` |
| Bazarr | `30046` | `$BAZARR_API_KEY` (header `X-API-KEY`) |
| Tautulli | `30047` | `$TAUTULLI_API_KEY` |
| Prowlarr | `30050` | `$PROWLARR_API_KEY` |
| qBittorrent | `30024` | `$QBIT_USER` / `$QBIT_PASSWORD` (cookie SID auth) |
| Overseerr | `30002` | `$OVERSEERR_API_KEY` |

## Network / infra — `192.168.88.196`

| Service | Port | Auth env var |
|---------|------|--------------|
| Pi-hole | `20720` | `$PIHOLE_PASSWORD` (v6 two-step: password → SID) |
| Nginx Proxy Manager | `30020` | `$NPM_USER` / `$NPM_PASSWORD` |
| Homepage | (separate) | none |

## MikroTik — `192.168.88.1`

| Field | Value |
|-------|-------|
| Web UI | `http://192.168.88.1` |
| REST | `http://192.168.88.1/rest/...` (CORS-blocked from browser, expected) |
| Read-only user | `monitor-only` |
| Password env var | `$MIKROTIK_PASSWORD` |

## Build-time / runtime env vars consumed by the code

Currently the code reads:
- `process.env.TRUENAS_IP` (default `"192.168.88.196"`) — used by `metrics`, `services`, `speedtest` routes

The remaining secrets in the table above are **still hardcoded in `app/api/services/route.ts`** (see `memory.md` → tech debt). Migration plan: replace each hardcoded literal with `process.env.<NAME>` and document in `.env.local.example`.

## CORS rules

These services must be called via server-side proxy. Direct browser calls fail:
- Pi-hole (`:20720`)
- Bazarr (`:30046`)
- qBittorrent (`:30024`)
- MikroTik REST (`192.168.88.1`) — **client-side fallback only**, hardcoded values rendered on CORS

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
