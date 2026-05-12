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
