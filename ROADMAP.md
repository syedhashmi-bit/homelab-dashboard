# ComExe Roadmap

Next features, ordered by lift. Goal across all of them: make the dashboard
beginner-friendly enough that someone who's never touched Docker can spin it up,
follow a guided welcome flow, and end up with a working dashboard without ever
opening a terminal past `docker run`.

---

## Tier 1 — quick wins ✅ shipped

### ✅ Search engine picker
Shipped in `73173d8`. `GoogleSearch` → generic `SearchBar` with per-engine SVG
icons. Options: **Google · Bing · DuckDuckGo · Kagi**. Persisted via
localStorage + server config (`preferences.searchEngine`). Configurable in both
Settings panel and `/setup` wizard.

### ✅ Timezone setting
Shipped in `73173d8`. Header clock uses `Intl.DateTimeFormat` with an IANA
timezone. ~30 major timezones in the selector, "" = browser local. Persisted
same as search engine (`preferences.timezone`).

### ✅ 3-day weather forecast
Shipped in `73173d8`. Weather pill now shows a hover popup with the next 3 days
— emoji, condition, high/low. Uses open-meteo `daily` endpoint (no new API, no
key). `ForecastDay` type exported from weather route.

---

## Tier 2 — medium lift ✅ shipped

### ✅ Editable bookmarks in the UI
Shipped. Inline editing directly on the dashboard — add/remove sections, add/remove
items, reorder via up/down buttons. New `/api/bookmarks` POST endpoint writes to
`data/bookmarks.json`. Icons use favicon URL field (base64 capped at ~15kb).
Existing `bookmarks.json` mount keeps working as read-only fallback.

### ✅ Multi-Grafana with size picker
Shipped. `grafana.panels` array in config, each with `panelId`, `label`, and
`size` (`sm`=1col, `md`=2col, `lg`=3col/full-width). Setup wizard has "+ Add
panel" UI with size radio. `GrafanaCard` refactored into `GrafanaPanel` (single
iframe) + `GrafanaCard` (multi-panel grid layout).

---

## Tier 3 — big lift ✅ shipped

### ✅ First-run welcome flow + 5 themes
Shipped. CSS-variable refactor replaced ~250 hardcoded colors with custom
properties (`--bg`, `--card`, `--text`, `--brand`, etc.). Five theme classes
in `globals.css`: **Midnight** (cyan), **Forge** (amber), **Forest** (emerald),
**Plum** (magenta), **Paper** (light). Theme flash prevention via inline
`<script>` in `layout.tsx` reading localStorage before React hydrates.

Welcome flow at `/welcome` — 4-step wizard:
1. Welcome — logo, what ComExe does, overview of next steps
2. Pick a theme — 5 tiles with live preview
3. Connect services — links to `/setup` wizard
4. Done — confirmation + "Go to dashboard" button

Auto-redirect from `/` to `/welcome` when zero services configured and
welcome-done flag not set. Theme persisted to localStorage + server config.

### ✅ Beginner-friendliness pass
Shipped. All items except the YouTube walkthrough (separate non-code task):

- **API-key help tooltips** — every service in `/setup` has a "Where to find
  it:" hint with the exact UI path (e.g. Radarr → Settings → General → API Key).
- **Info modals on metric cards** — ⓘ icon on Card component, hover shows
  plain-English explainer for CPU, Memory, Filesystems, Network, GPU,
  Speedtest, System, Grafana.
- **Inline service-down hints** — "Can't reach {url} — is the container
  running?" instead of a bare red dot.
- **Demo mode** — `?demo=1` bypasses all API polling, seeds realistic fake
  data for every card. Orange banner with dismiss link.

---

## Sequencing (completed)

All tiers shipped. Order was:

1. ✅ Search engine picker + timezone + forecast
2. ✅ CSS-variable refactor (standalone commit `8cca9b2`)
3. ✅ 5 themes + theme picker UI
4. ✅ Welcome flow
5. ✅ Editable bookmarks
6. ✅ Multi-Grafana with size picker
7. ✅ Beginner-friendliness pass (tooltips, info modals, demo mode, service hints)

---

## Resolved decisions

- **Weather provider** — stayed on open-meteo (free, keyless). Added 3-day forecast.
- **Icon upload format** — base64 inline with ~15kb cap. Favicon URL fallback for simplicity.
- **Theme persistence** — both: server-side `config.json` seeds new browsers, localStorage
  overrides per-browser. Welcome wizard and settings panel write both.
- **Demo mode data** — generated at request time in `buildDemoMetrics()` / `buildDemoServices()`
  with realistic values. Deterministic enough for visual testing.

---

## Tier 4 — shipped ✅

All P0/P1/P2 items below are now in main. See commits 84b2a17 (Grafana
troubleshooter), 49a1f56 (alerts), 59e0fec (drag/refresh/search),
eb0f199 (PWA + update banner), 8b2f18c (MikroTik devices + WoL),
724aecc (Docker actions), b18ca57 (native Grafana panels).

### ✅ Alerts & notifications (P0)
Right now metric and service thresholds change a colour pill and nothing else.
Add real alerting:

- **Browser Notifications API** — opt-in toast/native notification on critical
  events (service down, CPU >95%, disk >90%, GPU temp >85°C). Bound to a
  visible "Enable alerts" button in Settings, debounced so a flapping
  service doesn't spam.
- **Webhook delivery** — POST to user-supplied URL on the same events.
  Templates for Discord, ntfy, Slack, Gotify, generic JSON. Per-event throttle
  (default 5 min) so a stuck-down service doesn't fire 20 times an hour.
- **Quiet hours** — local-time window where webhooks suppress (default
  22:00–07:00, user-configurable). Browser notifications respect OS DND.
- **Alert history pill** — small dot in the header showing last 24h alert
  count; click opens a sidesheet with timestamps.

Server side: a new `app/api/alerts` route that evaluates thresholds on each
metric poll, dedupes, and dispatches. Persist last-fire timestamp per
`(event, target)` in `data/alerts.json` so a container restart doesn't
re-fire stale alerts.

### ✅ Grafana embed troubleshooter (P0)
Current production shows "Forbidden" in the Grafana iframe because anonymous
access isn't enabled on Grafana, and iframes don't carry session cookies. The
card should explain *why* and offer fixes:

- Detect iframe load failure (timeout + dimensions check) and replace with an
  inline help card.
- Surface three options the user can pick from:
  1. Enable Grafana anonymous viewer (one-liner for `grafana.ini` + the env
     vars to set on the Grafana container)
  2. Use a service account API token with `Viewer` role (paste here →
     stored as `GRAFANA_API_TOKEN`, server-side proxy fetches panel PNGs)
  3. Disable the Grafana card entirely (Settings → hide card)
- Pre-flight check on `/setup` — when user enters Grafana URL, test
  `?orgId=1` *and* `/render/d-solo/...` to detect anon vs token setup.

### ✅ Native Grafana panels (no iframe) (P1)
Longer fix: replace the iframe with a server-side proxy that fetches the
panel as PNG via Grafana's `/render` API, or queries the underlying
datasource via the `/api/ds/query` endpoint and renders with our own Canvas
chart code. Removes the auth / X-Frame issue entirely and respects our theme.

### ✅ Drag-to-rearrange cards (P1)
The 3-column metric grid is hardcoded. Users want different priorities.

- HTML5 drag-drop on every Card top-stripe (cursor change on hover).
- Persist order in localStorage as `comexe:card-order` (per-browser, not
  per-server — each device can have its own layout).
- "Reset layout" button in Settings.
- Same treatment for the services panel grid (within a category).

### ✅ Per-card refresh override (P1)
Single `settings.refreshInterval` applies everywhere. Some users want metrics
at 1s but services at 30s. Add a sub-config:

- `settings.refreshOverrides: { metrics?: number; services?: number; mikrotik?: number; activity?: number }`
- UI in Settings → "Polling intervals" section with sliders per endpoint.
- Default-on toggle: "pause polling when tab not visible" (uses `document.hidden`).

### ✅ Container actions (P1)
Wire up the Docker socket (`-v /var/run/docker.sock:/var/run/docker.sock:ro`)
to expose:

- **Restart** button on each service card (asks for confirm, calls Docker API).
- **Logs** button — sidesheet with last 200 lines, tail-follow toggle.
- **Pull & restart** button on the ComExe card itself for one-click updates.

Behind a `--cap-add` and an explicit env-var opt-in (`ENABLE_DOCKER_CONTROL=1`)
since the Docker socket grants root-equivalent on the host.

### ✅ MikroTik device list + WoL (P1) · ⏸ per-IP bandwidth deferred
Mikrotik tab currently shows only router-level stats. Add:

- DHCP leases table (host, MAC, IP, last-seen, vendor lookup).
- Per-IP traffic counters from `/queue/simple` or `/ip/firewall/connection`.
- Wake-on-LAN button per offline device (sends magic packet from the
  ComExe container; requires `--network host` which we already use).
- Block/unblock toggle (writes to firewall rule). Behind same Docker-control
  env opt-in for safety.

### ✅ Service-search (P1)
Press `/` to focus a fuzzy filter that highlights matching service cards and
scrolls them into view. Useful once the services panel grows past 10–15
cards.

### ✅ PWA manifest (P2) · ⏸ offline shell deferred (needs service worker)
Add `manifest.json` + a minimal service worker so the dashboard can be
installed as an app icon on phones/tablets/desktops. Offline shell falls back
to the last cached metrics with a "stale since {ts}" banner — useful when
the wifi blips but the user just wants to glance at the dashboard.

### ✅ Update-available banner (P2)
On every page load, compare `process.env.IMAGE_DIGEST` (baked at build time
via Dockerfile `ARG`) with the digest of `:latest` on GHCR. If newer, show a
dismissable banner: "v1.4 available — release notes". Click-through links to
the GitHub release page.

---

## Tier 5 — bigger initiatives ✅ shipped

### ✅ Authentication & HTTPS
Shipped. Two auth modes, controlled by env vars:

- **Reverse-proxy mode** — `AUTH_PROXY_HEADER` env var (e.g.
  `X-Authenticated-User`). Trusts the upstream auth proxy (Authelia, Authentik,
  Cloudflare Access) to set the header. No login page needed.
- **Native basic auth** — `DASHBOARD_PASSWORD` env var. Single shared
  password, cookie-based session (7-day expiry), rate-limited login endpoint
  (10 attempts/min per IP). Branded `/login` page with theme support.

Next.js `middleware.ts` guards all routes. Public paths: `/login`,
`/api/auth/*`, `/_next`, static assets. API routes return 401 JSON;
page routes redirect to `/login?from=<path>`.

### ✅ Multi-arch image (arm64)
Shipped. CI workflow updated with `docker/setup-qemu-action@v3` and
`platforms: linux/amd64,linux/arm64` on the build step. Raspberry Pi /
Apple Silicon users can now pull the same `:latest` tag.

### ✅ Historical persistence
Shipped. `data/history.jsonl` — append-only ring buffer rotated at 7d / 50MB.
Each metrics poll writes a slim data point (cpu, mem%, net_rx/tx, gpu%,
worst disk%). Exposed via `/api/history?metric=cpu&range=24h` with
auto-downsampling. POST endpoint for manual recording.

### ✅ Custom card builder
Shipped. Users define ad-hoc PromQL cards in Settings → Custom Cards:

- Pick a PromQL query (with live "Test query" button)
- Pick a viz type (sparkline / gauge / number / bar chart)
- Pick a color from 8 presets
- Optional unit suffix (%, °C, MB/s)
- Stored in `data/custom-cards.json`, rendered after the built-in grid.

### ✅ Automated tests
Shipped. Test infrastructure:

- **Vitest** — 22 unit tests covering `server-config.ts` (config resolution,
  service manifest, defaults), `auth.ts` (sessions, rate limiting, password
  verification), and `history.ts` (downsampling).
- **Playwright** — 8 E2E smoke tests: page loads (dashboard, setup, welcome,
  login), API endpoint responses (config, auth status, history), theme
  switching via localStorage.
- CI: `.github/workflows/test.yml` runs `npm test` on push to main and PRs.
- Scripts: `npm test`, `npm run test:watch`, `npm run test:e2e`.

### ✅ Storybook for primitives
Shipped. Storybook 10 with `@storybook/react-vite` and `addon-essentials`.
16 stories covering all major primitives: AnimatedNumber, GaugeBar, Sparkline,
RadialGauge, BigValue, Card (default/warning/critical), Skeleton, LabeledBar,
SubRow/StatRow, TrendDelta, HeroStat, StatusBanner. Dark dashboard background
by default. Run via `npm run storybook` (port 6006).

---

## Tier 6 — production polish ✅ shipped

### ✅ Mobile/tablet responsive layout
Shipped. Custom `xs: 480px` breakpoint in Tailwind config. Header collapses
pill elements at mobile widths. Services grid adapts from 5-col down to 1-col.
Main content padding tightens on small screens. Settings panel goes full-width
on mobile. `viewport` meta tag prevents zoom-bounce.

### ✅ Decompose page.tsx into feature components
Shipped. Extracted ~430 lines from page.tsx into standalone components:

- **`ServicesPanel.tsx`** — service card grid with category headers, filter,
  health pills, queue progress, stream progress, Docker actions (logs/restart).
  Moved `SVC_COLORS`, `SVC_ICONS`, `SVC_LABELS`, `SVC_CATEGORIES`,
  `buildSvcUrls` into the component file.
- **`BookmarksPanel.tsx`** — bookmarks grid with inline editing, section
  management, save/cancel, read-only install warning. All bookmark state
  (draft, saving, error) is now self-contained.

page.tsx went from ~1650 lines to ~1230 lines.

### ✅ SSE live updates (replace polling)
Shipped. New `/api/stream` SSE endpoint pushes metrics, services, mikrotik,
activity, speedtest, and weather data at configurable intervals. Single
persistent connection replaces 6 independent pollers. 30s heartbeat keeps
the connection alive.

Client-side `useEventStream` hook in `app/hooks/useEventStream.ts`:
- Automatic reconnect with exponential backoff (3 retries)
- Falls back to traditional polling if SSE unavailable
- Named events dispatched to the appropriate state setters
- Interval overrides from settings passed as query params

### ✅ Import/export config backup
Shipped. New `/api/backup` endpoint:

- **GET** — exports `config.json`, `custom-cards.json`, `alerts.json`, and
  `bookmarks.json` as a single JSON bundle with metadata.
- **POST** — imports a backup bundle, restoring all files. Auto-reloads the
  page on success.

UI in Settings panel → Backup section: "Export config" button downloads the
bundle, "Import" button opens a file picker and restores.

### ✅ Offline PWA shell
Shipped. Service worker (`public/sw.js`) with three strategies:

- **Navigation**: network-first, falls back to cached shell when offline
- **Static assets** (`/_next/static/`, icons, SVGs): stale-while-revalidate
- **API calls**: always network (never cached — stale metrics are worse than
  no metrics)

Offline banner appears when `navigator.onLine` goes false, showing
"You are offline — showing cached data." The banner auto-dismisses when
connectivity returns.

---

## Tier 7 — analytics & UX polish ✅ shipped

### ✅ Historical analytics page
Shipped. Full `/analytics` route with interactive SVG area charts for all
6 core metrics (CPU, Memory, GPU, Disk, Network RX, Network TX). Time range
selector (1h / 6h / 24h / 7d) fetches from `/api/history`. Summary cards
show current, avg, and max values. Back link to dashboard.

Custom `AreaChart` component — interactive SVG with hover crosshair, gradient
fill, Y-axis labels, X-axis time labels. No chart library.

### ✅ Keyboard shortcuts overlay
Shipped. Press `?` anywhere to toggle a centered modal listing all shortcuts:
R (refresh), G (search), H (bookmarks), / (service filter), Esc (close),
? (this overlay), Ctrl+K (command palette). Modal renders via
`KeyboardShortcuts` component with `onClose` prop.

### ✅ Notification center
Shipped. Slide-out panel triggered from the alert pill in the header. Fetches
from `/api/alerts` history endpoint. Displays alert events with colored dots
(critical = red, warning = amber), relative timestamps, event keys. Rendered
via `NotificationCenter` component.

### ✅ Header sparklines
Shipped. Tiny inline CPU/MEM/NET sparklines in the sticky header bar, visible
on `lg:` breakpoint and above. `MiniSpark` sub-component renders SVG polyline
from the last 20 data points. `HeaderSparklines` component receives history
arrays as props.

### ✅ System uptime timeline
Shipped. Visual horizontal bar showing uptime/downtime segments inside the
System card. Green bar = up, red segments = down periods. Shows uptime
percentage (e.g. 99.97%), outage count, and time range. Built from a
session-level `uptimeHistory` array that records each poll result.

---

## Tier 8 — power features ✅ shipped

### ✅ Command palette (Ctrl+K)
Shipped. `Ctrl+K` opens a centered search modal listing all dashboard actions
grouped by section (Actions, Panels, Navigate). Arrow keys navigate, Enter
selects, Esc closes. Fuzzy-filters by label, section, or ID. Actions include:
refresh metrics, focus search, toggle bookmarks, open settings, keyboard
shortcuts, notifications, network topology, server fleet, analytics,
setup wizard, open TrueNAS, open Prometheus.

### ✅ Dashboard layout presets
Shipped. Settings → Layout Presets section. Save the current card visibility
+ card order as a named preset. Load a preset to restore both. Delete presets
with confirm. Persisted in `localStorage` key `comexe:layouts`. Works
alongside the existing "Reset card layout" button.

### ✅ Disk health SMART monitoring
Shipped. New `/api/smart` route queries Prometheus for `smartmon_*` metrics:
temperature, power-on hours, reallocated sectors, pending sectors,
uncorrectable sectors, device health. Renders a `DiskHealthPanel` component
below the metric grid showing per-disk status cards with colored indicators.
Falls back gracefully when smartmon exporter is not present.

### ✅ Network topology map
Shipped. New `/api/topology` route fetches ARP table + DHCP leases from
MikroTik REST API. `NetworkTopology` component renders an interactive SVG
visualization with:
- Router node at center top, connected to all devices
- Device icons differ by type (router / server / device)
- Hover highlights individual device and dims others
- Active/inactive status via green dot + dashed/solid lines
- Legend at bottom
- Accessible via command palette → "Network topology"

### ✅ Multi-server support
Shipped. New `/api/servers` route with full CRUD (GET/POST/PATCH/DELETE)
backed by `data/servers.json`. Each entry has a name + Prometheus URL. GET
queries all servers in parallel for CPU, memory, and uptime via standard
`node_exporter` PromQL. `ServerFleetPanel` component shows:
- Add/remove servers with name + Prometheus URL
- Enable/disable toggle per server
- Live CPU + memory mini-bars + uptime display
- Online/offline status indicator
- Accessible via command palette → "Server fleet"

---

## Sequencing (completed)

All tiers shipped. Full build order:

**Tier 1** — Search engine picker + timezone + forecast
**Tier 2** — Editable bookmarks + multi-Grafana
**Tier 3** — CSS variable refactor + themes + welcome flow + beginner pass
**Tier 4** — Alerts, Grafana troubleshooter/native panels, drag reorder,
  per-card refresh, Docker actions, MikroTik devices/WoL, service search,
  PWA manifest, update banner
**Tier 5** — Auth/HTTPS, arm64, historical persistence, custom card builder,
  automated tests, Storybook
**Tier 6** — Responsive layout, page.tsx decomposition, SSE live updates,
  config backup/restore, offline PWA shell
**Tier 7** — Analytics page, keyboard shortcuts, notification center,
  header sparklines, uptime timeline
**Tier 8** — Command palette, layout presets, SMART monitoring, network
  topology map, multi-server support

---

## Tier 9 — observability & insights (planned)

### Log aggregation viewer
Centralized log viewer pulling from Docker container logs, syslog, and
journal. Full-text search with regex, severity filtering (debug → critical),
timestamp range picker. Tail mode streams new lines via SSE. Syntax
highlighting for JSON log lines. Accessible from each service card's
context menu as "View logs → aggregated".

### Anomaly detection & predictive alerts
ML-lite anomaly detection on historical metrics: compute rolling mean + stddev
over 7d and flag data points >3σ. Surface anomalies on the analytics page as
highlighted regions. Predictive disk-full alert: linear extrapolation on
`disk_pct` trend → "Pool will be full in ~14 days" warning. CPU/memory
baseline profiles per time-of-day to distinguish "Tuesday 2am backup spike"
from genuine overload.

### SLA & uptime reports
Monthly/weekly uptime reports generated from `history.jsonl`. Per-service
availability percentage, incident timeline, MTTR (mean time to recover),
longest outage. Exportable as PDF or Markdown. Email digest option via
webhook (compose the report server-side, POST to a mail relay or ntfy).

### Resource forecasting dashboard
Dedicated `/forecast` page. Takes 30d of historical data and projects
storage consumption, memory pressure, and network bandwidth growth.
Visualized as dashed trend lines extending past the current data on the
area charts. Configurable confidence intervals (68% / 95%).

### Dependency health map
Service-to-service dependency graph — e.g. Sonarr depends on Prowlarr and
qBittorrent. If a dependency goes down, highlight the upstream impact chain.
Config stored in `data/dependencies.json` with a visual editor. Overlay on
the existing services panel: "Prowlarr down → Sonarr/Radarr search degraded."

---

## Tier 10 — platform & ecosystem (planned)

### Plugin system
Extension API for third-party dashboard cards. Plugins are single `.js`
bundles loaded from `data/plugins/` at runtime. Each plugin exports a React
component + a manifest (`name`, `icon`, `defaultSize`, `refreshInterval`,
`configSchema`). Plugin marketplace page listing community-contributed cards
(fetched from a GitHub repo index). Sandboxed via iframe with postMessage
bridge for metric access.

### Mobile companion app (React Native)
Lightweight mobile app that connects to the ComExe instance via its API.
Push notifications via Firebase/APNs (replaces browser notifications for
mobile). Glanceable widget showing CPU/MEM/GPU at-a-glance. Biometric
auth (Face ID / fingerprint) for the dashboard password flow.

### Prometheus recording rules generator
Analyze the user's PromQL usage patterns from custom cards + built-in
queries. Suggest Prometheus recording rules that would pre-compute expensive
queries. One-click export as a `rules.yml` snippet the user can drop into
their Prometheus config. Reduces query latency and Prometheus CPU load for
heavy dashboards.

### Multi-user with roles
Upgrade from single shared password to per-user accounts. Roles: **admin**
(full access, settings, Docker control), **operator** (view + restart
services, acknowledge alerts), **viewer** (read-only dashboard). User
management page in settings. Backed by `data/users.json` with bcrypt-hashed
passwords. Session tokens in signed cookies.

### Webhook integrations marketplace
Pre-built webhook templates beyond Discord/Slack/ntfy: PagerDuty, Opsgenie,
Telegram, Pushover, Email (SMTP), Microsoft Teams, Gotify, Matrix.
Each template has a config form (API key, channel, priority mapping) and
a "Send test" button. Community-contributed templates loaded from a
registry.

### Container orchestration dashboard
Expand Docker control into a mini-Portainer: list all containers (not just
monitored services), show resource usage per container (CPU/mem/net from
Docker stats API), bulk actions (stop/start/restart/pull), compose file
viewer, image cleanup (dangling images, unused volumes). Behind the
existing `ENABLE_DOCKER_CONTROL` opt-in.

---

## Tier 11 — advanced networking (planned)

### Bandwidth monitoring per client
Per-IP traffic accounting from MikroTik `/queue/simple` or firewall
mangle rules. Historical bandwidth usage per device with daily/weekly
rollups. Top talkers leaderboard. Alert when a device exceeds a
configurable bandwidth threshold.

### VPN status panel
Monitor WireGuard / OpenVPN tunnels via MikroTik REST API or Prometheus
`wireguard_*` metrics. Show connected peers, handshake age, transfer
stats, endpoint IPs. Alert on tunnel down or handshake stale >5min.

### Firewall rule viewer
Read-only view of MikroTik firewall filter/nat/mangle rules. Highlight
active rules (packet counters >0 in last hour). Search/filter by chain,
action, comment. Useful for debugging connectivity issues without opening
Winbox.

### DNS analytics
PiHole query log visualization: top queried domains, top blocked domains,
query volume over time, per-client breakdown. Complements the existing
PiHole card stats with a dedicated drilldown view.
