# Homelab Dashboard

Real-time single-page dashboard for a TrueNAS Scale homelab. Aggregates Prometheus metrics, service-health checks, speedtest history, weather, and an embedded Grafana panel into a dark, minimal UI. No database, no auth, no external state library.

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss)
![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker)

---

## Features

### Metrics

- **CPU** — usage %, load 1/5/15, core count, frequency, sparkline history
- **Memory** — segmented donut (used / ZFS cache / free) with ZFS-aware accounting (`MemTotal − MemAvailable − SReclaimable`)
- **Filesystems** — pool fullness as the headline, per-mount rows sorted by % full, color-coded by severity
- **Network** — RX / TX throughput with sparklines, totals, primary interface, established TCP count
- **GPU** — radial utilisation gauge, temperature (color-coded), power draw, VRAM, power limit, clocks, fan, encoder/decoder utilisation, temp-history sparkline
- **Speedtest** — download / upload / ping / jitter from SpeedTracker, plus 5-test download-history graph (read-only — never triggers a test)
- **System** — OS, kernel, arch, hostname, core count, uptime
- **Grafana** — embedded panel (Node Exporter Full, configurable)

### Service health

Live status pills for **Radarr · Sonarr · Bazarr · Tautulli · qBittorrent · Overseerr · Pi-hole · Prowlarr · Nginx Proxy Manager · Uptime Kuma**. Each card:

- Brand-color gradient accent stripe + brand-color hover glow
- Hero stat (e.g. `1,369 movies`) with the leading number visually emphasised
- Numbers smoothly animate between updates (~600 ms ease-out)
- Live status dot in the header — green / amber / red
- Click anywhere on the card to open the underlying service in a new tab
- Cards grouped into *Media stack* and *Infrastructure* categories with live up-counts

### Other

- **Router bar** — MikroTik live stats via a server-side proxy, with graceful fallback to a static info row
- **Weather** — temperature + condition pill in the header (open-meteo, no API key)
- **Search** — Google search bar; `G` to focus, opens results in a new tab
- **Bookmarks** — quick-links section, color-coded by category, toggle with `H`
- **Settings** — per-card visibility, refresh interval (5/10/30 s), °C/°F, decimal/binary units
- **Trend deltas** — small `↑X` / `↓X` next to hero numbers when a metric changes meaningfully (CPU %, memory pressure, GPU temp)
- **Alert system** — 2 px cyan healthy line → 36 px amber warning bar → 48 px red critical bar across the top of the page
- **Keyboard shortcuts** — `G` focus search · `R` force-refresh · `H` toggle bookmarks · `Esc` blur input / close panels

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, single `"use client"` SPA) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + inline `style` for dynamic colours |
| Charts | Canvas API + inline SVG, **zero chart libraries** |
| Runtime | Node 20 |
| Container | Single-stage Docker image, runtime-only |

---

## Architecture

```
browser
  │
  ├── /api/metrics    →  Prometheus              (Promise.all over ~30 PromQL queries)
  ├── /api/services   →  10 homelab services     (Promise.allSettled fan-out)
  ├── /api/speedtest  →  SpeedTracker            (read-only history)
  ├── /api/weather    →  open-meteo              (no auth)
  └── /api/mikrotik   →  MikroTik REST           (Basic auth)
```

Five **server-side proxy routes**. The browser never calls internal IPs directly — all credentials stay on the server, all CORS is sidestepped. Every route has a 10 s in-memory cache and per-fetch `AbortSignal.timeout`.

The entire frontend is one file: **`app/page.tsx`** (~2 200 lines). All primitives, feature components, and the `Dashboard` orchestrator live there.

### Polling

| Route | Interval |
|---|---|
| `/api/metrics` | 10 s (configurable) |
| `/api/services` | 10 s |
| `/api/mikrotik` | 30 s |
| `/api/speedtest` | 300 s |
| `/api/weather` | 600 s |

---

## Setup

### Prerequisites

- Node 20+ on your dev machine
- A Prometheus instance with `node_exporter` and `nvidia_gpu_exporter` (optional)
- The homelab services you want to monitor reachable on the same LAN
- Docker on the deploy host

### 1. Configure env vars

Copy the template and fill in your real values:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your service API keys / credentials. **Server-side only — never prefix with `NEXT_PUBLIC_`.** Full env-var inventory is in [`context.md`](./context.md).

### 2. Adapt to your own infrastructure

Most addresses are env-var driven (via `TRUENAS_IP`), but the following are hardcoded — edit them for your setup:

| File | What to change |
|---|---|
| `app/api/metrics/route.ts` | Network interface name (`enp4s0`), ZFS pool path |
| `app/api/services/route.ts` | Service ports if yours differ from the defaults |
| `app/api/speedtest/route.ts` | SpeedTracker base URL if not on `${TRUENAS_IP}:30220` |
| `app/api/weather/route.ts` | `lat` / `lon` (currently Launceston, TAS) |
| `app/api/mikrotik/route.ts` | Router IP if not `192.168.88.1` |
| `app/page.tsx` | `BOOKMARKS` constant · `GRAFANA_PANEL` URL · service categories |

Only filesystems under `/mnt/Pool/Media/` are shown by default — update the filter in `app/api/metrics/route.ts` for your pool layout.

### 3. Run locally

```powershell
# PC (PowerShell)
npm install
npm run dev      # localhost:3000
npm run build    # production build (always run before deploying — see below)
npm run lint
```

---

## Build & deploy

> **Note:** This repo uses a slightly unusual workflow — the production build happens on the PC and the prebuilt `.next/` ships via git. The Dockerfile is **runtime-only**.
>
> Why: `next build` SIGSEGVs non-deterministically inside Docker on certain hosts (intermittent SWC/cgroup interaction). Building on the PC fully sidesteps it. Full diagnostic trail in [`memory.md`](./memory.md) → "Build moved off Docker".

```powershell
# PC (PowerShell) — every code change
npm run build                    # produces .next/ (which is git-tracked)
git add .next app/<changed>
git commit -m "..."
git push
```

```bash
# Server (bash)
./update-dashboard.sh            # git pull + docker build + docker run
```

A reference `update-dashboard.sh` is included in the deploy notes — it `git fetch && git reset --hard origin/main`s the repo, rebuilds the runtime image, and starts the container with all required env vars passed via `-e` flags. **No secret values ever live in the image.**

### Docker manually

```bash
docker build -t homelab-dashboard .
docker run -d \
  --name homelab-dashboard \
  --network host \
  --restart unless-stopped \
  -e TRUENAS_IP=192.168.88.196 \
  -e RADARR_API_KEY=... \
  # ... rest of env vars (see .env.local.example)
  homelab-dashboard
```

---

## Reference hardware

| Component | Spec |
|---|---|
| CPU | Intel Xeon E5-2680 v4 (28 cores) |
| RAM | 63 GB ECC |
| GPU | NVIDIA GeForce GTX 1660 SUPER (6 GB) |
| Storage | 4.4 TB ZFS pool |
| OS | TrueNAS Scale (Electric Eel 24.10+, runs apps on plain Docker) |
| Router | MikroTik hAP ax³ — RouterOS 7.22.x |
| Network | `192.168.88.0/24` flat LAN |

---

## Alert thresholds

| Metric | Warning | Critical |
|---|---|---|
| CPU usage | > 70 % | > 90 % |
| Memory usage (real) | > 85 % | > 95 % |
| Filesystem usage | > 70 % | > 85 % |
| GPU temperature | > 80 °C | > 90 °C |
| Service down count | ≥ 1 | ≥ 3 |

Memory uses `MemTotal − MemAvailable − SReclaimable` so ZFS ARC (which is reclaimable under pressure) doesn't trigger false alarms.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `G` | Focus the Google search bar |
| `R` | Force-refresh all metrics immediately |
| `H` | Toggle the Bookmarks section |
| `Esc` | Blur search input / close Settings panel |

---

## Design notes

- **No chart libraries.** Every visualisation (sparklines, donuts, radial gauges, bar charts, segmented bars) is hand-rolled with Canvas or inline SVG.
- **Sparkline gradient IDs** use `useId()` to avoid SVG `<linearGradient>` collisions across instances. Don't remove this.
- **Canvas bar chart** uses a `ResizeObserver` to defer drawing until the container has non-zero dimensions — fixes a "only one bar drawn" race on first mount. Tooltip state mutated via a `ref` to avoid React re-renders on every mouse-move.
- **Card visual contract** — every metric card has a 3 px gradient accent stripe with a colored glow, a subtle radial brand-color background, and a brand-tinted hover state. The shared `<Card>` primitive enforces it.
- **Animated numbers** — `<AnimatedNumber>` interpolates between updates over 600 ms with ease-out cubic. The `animatedLine()` helper parses any pre-formatted stat string and wraps each numeric literal in an `<AnimatedNumber>` automatically.
- **Trend deltas** ship a sanity guard — they suppress output when `|delta|/|current| > 5`, catching unit-mismatch bugs (e.g. one endpoint returning Mbps while another returns bits/sec).

---

## Project structure

```
.
├── app/
│   ├── api/
│   │   ├── metrics/route.ts      Prometheus proxy
│   │   ├── services/route.ts     10-service health checks
│   │   ├── mikrotik/route.ts     Router stats
│   │   ├── speedtest/route.ts    SpeedTracker history
│   │   └── weather/route.ts      open-meteo proxy
│   ├── globals.css               Keyframes, font imports
│   ├── layout.tsx                Root layout
│   └── page.tsx                  Entire dashboard UI (~2 200 lines)
├── .next/                        Prebuilt artifacts (tracked — see "Build & deploy")
├── .env.local.example            Env var template
├── CLAUDE.md                     Authoritative architecture / conventions doc
├── context.md                    Infra inventory, env var names, ports
├── memory.md                     Past decisions, bug fixes, gotchas
├── skills.md                     Reusable code patterns
├── Dockerfile                    Runtime-only image
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## License

MIT
