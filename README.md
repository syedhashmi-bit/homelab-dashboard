# Homelab Dashboard

A real-time monitoring dashboard for a TrueNAS Scale homelab server. Built with Next.js 15, it aggregates Prometheus metrics, service health checks, speedtest history, and live weather into a single dark-themed UI — no database, no auth, no external state management.

![Dashboard](https://img.shields.io/badge/Next.js-15-black?logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss) ![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker)

---

## Features

- **System metrics** — CPU usage, memory (ZFS-aware, subtracts reclaimable ARC), filesystem utilisation per-mountpoint, network throughput (rx/tx), GPU utilisation / VRAM / temperature / power draw
- **Sparkline history** — 30-point rolling graphs for CPU, memory, and network
- **Service health panel** — live status for Radarr, Sonarr, Bazarr, Tautulli, qBittorrent, Overseerr, PiHole, Prowlarr, Nginx Proxy Manager, and Uptime Kuma
- **Speedtest history** — dual-chart view (SVG line + Canvas grouped bar) of historical download / upload / ping results from SpeedTracker; never triggers a test itself
- **Router info bar** — MikroTik REST API with graceful CORS fallback to a static summary
- **Weather pill** — current temperature + condition via open-meteo.com (no API key required)
- **Google Search bar** — keyboard-accessible, opens results in a new tab
- **Bookmarks** — curated quick-links to all homelab services, colour-coded by category
- **Settings panel** — per-card visibility toggles, refresh interval (5 / 10 / 30 s), temperature unit (°C / °F), data unit (decimal / binary)
- **Keyboard shortcuts** — `G` focus search · `R` force-refresh · `H` toggle bookmarks · `Esc` close/blur
- **Alert system** — 2 px cyan line (healthy) → 36 px amber bar (warning) → 48 px red bar (critical), driven by real thresholds

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, `"use client"` SPA) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + inline `style` props for dynamic colours |
| Charts | Canvas API (bar chart) + inline SVG (line chart, sparklines, donuts) — zero chart libraries |
| Fonts | Inter (UI) + JetBrains Mono (numeric values) via Google Fonts |
| Runtime | Node.js 20 |
| Container | Docker multi-stage build (Alpine, standalone Next.js output) |

---

## Architecture

```
browser
  │
  ├── /api/metrics    →  Prometheus @ 192.168.88.196:30104   (PromQL × 20 queries)
  ├── /api/services   →  Per-service health checks           (parallel fetch + fallbacks)
  ├── /api/speedtest  →  SpeedTracker @ 192.168.88.196:30220 (read-only history)
  └── /api/weather    →  open-meteo.com                      (lat/lon)
```

All four API routes are **server-side proxies** — the browser never calls internal IPs directly, which avoids CORS issues and keeps any credentials server-side. The single exception is the MikroTik bar, which attempts a client-side fetch (always CORS-blocked in browsers) and falls back to a hardcoded static summary.

The entire UI lives in **`app/page.tsx`** (~2 100 lines). There are no separate component files or pages.

### Poll intervals

| Data | Interval |
|---|---|
| Prometheus metrics | configurable (default 10 s) |
| Service health | 10 s |
| Speedtest history | 300 s |
| Weather | 600 s |
| Clock | 1 s |

---

## Hardware (reference setup)

| Component | Spec |
|---|---|
| CPU | Intel Xeon E5-2680 v4 — 28 cores |
| RAM | 63 GB ECC |
| GPU | NVIDIA GeForce GTX 1660 SUPER (6 GB) |
| Storage | 4.4 TB ZFS pool (`/mnt/Pool`) |
| OS | TrueNAS Scale |
| Router | MikroTik hAP ax³ — RouterOS 7.22.1 |

---

## Prerequisites

- **Prometheus** with `node_exporter` and `nvidia-smi-exporter` running on the target host
- **SpeedTracker** (or compatible) exposing a speedtest history API
- Node.js 20+ (local dev) or Docker (deployment)

---

## Getting Started

### Local development

```powershell
# Install dependencies
npm install

# Start dev server (localhost:3000, falls back to :3001)
npm run dev

# Production build — run to verify no TypeScript errors
npm run build
npm run start

# Lint
npm run lint
```

### Adapt to your own setup

All backend addresses are hardcoded in the API routes. Edit the following to point at your infrastructure:

| File | What to change |
|---|---|
| `app/api/metrics/route.ts` | Prometheus base URL · network interface name (`enp4s0`) |
| `app/api/services/route.ts` | Service hostnames, ports, and API keys |
| `app/api/speedtest/route.ts` | SpeedTracker base URL |
| `app/api/weather/route.ts` | `lat` / `lon` coordinates |
| `app/page.tsx` | `BOOKMARKS` constant · MikroTik fallback text · `MikrotikTab` fetch URL |

Filesystem cards only show mountpoints under `/mnt/Pool/Media/` — update `FS_EXCLUDE` and the mountpoint filter in `app/api/metrics/route.ts` for your pool layout.

---

## Docker

```bash
# Build
docker build -t homelab-dashboard .

# Run
docker run -p 3000:3000 homelab-dashboard
```

The image uses a three-stage build (deps → builder → runner) with a non-root `nextjs` user and the Next.js standalone output for minimal image size.

### TrueNAS Scale / k3s deployment

Build and push the image to your local registry, then deploy as a k3s workload on your TrueNAS Scale node. Expose port 3000 via a NodePort or Ingress service. The dashboard needs outbound access to Prometheus, SpeedTracker, and open-meteo.com from within the cluster network.

---

## Alert Thresholds

| Metric | Warning | Critical |
|---|---|---|
| Memory usage | > 85 % | > 95 % |
| GPU temperature | > 80 °C | > 90 °C |
| Disk usage | > 80 % | > 90 % |
| Service down count | ≥ 1 | ≥ 3 |

Memory is calculated as `MemTotal − MemAvailable − SReclaimable` to account for ZFS ARC being reported as used but being fully reclaimable under pressure.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `G` | Focus the Google Search bar |
| `R` | Force-refresh all metrics immediately |
| `H` | Toggle the Bookmarks section |
| `Esc` | Blur search input / close Settings panel |

---

## Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── metrics/route.ts      # Prometheus proxy (PromQL)
│   │   ├── services/route.ts     # Service health checks
│   │   ├── speedtest/route.ts    # SpeedTracker history
│   │   └── weather/route.ts      # open-meteo proxy
│   ├── globals.css               # Keyframe animations, font imports
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Entire dashboard UI (~2 100 lines)
├── Dockerfile
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Design Notes

- **No chart libraries** — all visualisations are Canvas API or inline SVG written from scratch to keep the bundle minimal and maintain full control over rendering.
- **Sparkline gradient IDs** use `useId()` to avoid SVG gradient collisions when multiple instances render on the same page.
- **Canvas bar chart** uses a `ResizeObserver` to defer drawing until the container has non-zero dimensions, fixing a race condition on first mount.
- **Tooltip state** on the bar chart is mutated via a `ref` rather than React state to avoid triggering re-renders on every mouse-move event.
- **ZFS memory correction** — raw `MemAvailable` reads artificially low on TrueNAS because ZFS ARC occupies RAM that the kernel will reclaim on demand. The dashboard subtracts `SReclaimable` from used memory to show the true footprint.

---

## License

MIT
