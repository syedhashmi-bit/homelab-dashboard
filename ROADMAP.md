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

## Tier 2 — medium lift (1-2 days each)

### Editable bookmarks in the UI
Today: bookmarks live in `bookmarks.json` mounted into the container, edited
on the host. Goal: edit from inside the dashboard — add/remove sections, add
items, upload custom icons.

- New panel in `/setup` (or a separate `/bookmarks` editor route).
- Icon upload: store as base64 inline in the bookmark item so we don't need a
  static file server. Cap at ~10kb each to keep `config.json` reasonable.
  Fallback URL field for when the user just wants a favicon link.
- Reorder via drag-and-drop (use HTML5 native DnD, no library).
- Migration: existing `bookmarks.json` mount keeps working as a read-only
  override (env-var deploys don't lose anything).

### Multi-Grafana with size picker
Today: one Grafana panel, fixed slot in the grid. Goal: arbitrary number of
panels with size choice.

- Sizes: `sm` (1 grid col), `md` (2 cols), `lg` (3 cols / full width).
- Config shape: `grafana.panels: [{ baseUrl, dashboardUid, datasourceUid,
  panelId, size, label }]`.
- UI in `/setup`: "+ Add panel" button, per-panel form, size radio.
- Frontend: render the panels array inline at the end of the metric grid; size
  controls `col-span-{1,2,3}`. The existing single `GrafanaCard` becomes the
  per-panel renderer.

---

## Tier 3 — big lift (multi-day)

### First-run welcome flow + 5 themes
The single biggest UX upgrade. Goal: first-time visitor (no `data/config.json`
on disk) is redirected to a guided multi-step wizard instead of dropped onto
an empty dashboard.

**Steps:**
1. **Welcome** — what ComExe does, what the next steps will look like (~30s).
2. **Pick a theme** — preview tiles for 5 themes (see below). Selection writes
   `config.theme`.
3. **Connect services** — the existing `/setup` form, broken into smaller
   chunks (one category per step instead of one giant page).
4. **Done** — confirmation page with the line "you can change any of this
   anytime at `http://<your-host>:3000/setup`" and a "Go to dashboard" button.

**5 themes** — this is the non-trivial part. Codebase currently has
hardcoded brand colors (`#06b6d4` cyan, `#0a0c12` bg) sprinkled across inline
`style` props in `app/page.tsx`. Need to refactor to **CSS variables** first:

- `--bg`, `--card`, `--text`, `--text-muted`, `--brand`, `--brand-dim`,
  `--ok`, `--warn`, `--critical`, plus per-card accents.
- Themes (suggested):
  1. **Midnight Cyan** (current) — `#0a0c12` + `#06b6d4`
  2. **Forge** — warm dark, amber accents (`#1a1410` + `#f59e0b`)
  3. **Forest** — deep green-black, emerald accents (`#0a1410` + `#10b981`)
  4. **Plum** — purple-black, magenta accents (`#120a18` + `#d946ef`)
  5. **Paper** — light theme, slate accents (`#f8fafc` + `#0f172a`)
- Per-card accent assignments (CPU, Memory, etc.) stay theme-relative — each
  theme picks its own mapping of "5 distinct accent hues".

**Why this is multi-day:** the CSS-variable refactor alone touches every
component. Maybe 200+ inline `style={{ color: "#..." }}` props to replace
with `style={{ color: "var(--text)" }}`. Worth scoping its own commit.

### Beginner-friendliness pass
Cross-cutting theme tying everything above together. Concrete asks:

- **Tooltips on every API-key field** — "Where do I find this?" with the
  exact path inside each service's UI (e.g. Radarr → Settings → General →
  Security → API Key).
- **"What is this?" links** — small ⓘ next to every metric card that opens
  a short Markdown explainer in a modal. Especially useful for things like
  "Memory pressure (real)" or "ZFS ARC".
- **Inline service-down hints** — instead of just a red dot when Radarr is
  unreachable, show a one-line hint: "Can't reach `192.168.88.196:30025` —
  is the container running?".
- **Sample-data demo mode** — `?demo=1` query param that bypasses all API
  routes and renders the dashboard with realistic fake data, so new users
  can see what they're aiming at before configuring anything.
- **A 2-minute YouTube walkthrough** linked from INSTALL.md (separate task,
  not code).

---

## Sequencing recommendation

Tier 1 is done. Suggested order for the remaining work:

1. ~~Search engine picker + timezone + forecast~~ — **done.**
2. **CSS-variable refactor** as a standalone commit — no functional change,
   prepares the ground for themes. Has to land before themes can ship.
4. **5 themes + theme picker UI** — sits on top of (3).
5. **Welcome flow** — once themes exist, wire them into the first-run wizard.
6. **Editable bookmarks** — independent of all the above; can slot in anywhere.
7. **Multi-Grafana** — independent. Slot it in when you've got a need for it.
8. **Beginner-friendliness pass** — ongoing, tackle in small PRs alongside
   the bigger features.

---

## Open questions

- **Weather provider** — open-meteo (current, free, keyless) vs switchable to
  OpenWeatherMap (paid, more features)? Recommend: stay on open-meteo,
  add forecast. Switching providers is rarely worth the API-key tax for a
  homelab dashboard.
- **Icon upload format** — base64 inline (simpler) vs a `data/icons/` dir
  served via a new route (cleaner, scales)? Lean toward base64 unless someone
  wants hundreds of bookmarks.
- **Theme persistence** — server-side (`config.json`, syncs across devices)
  or `localStorage` (per-browser)? Server-side matches the rest of ComExe.
- **Demo mode data** — generate at request time vs ship a fixed JSON fixture?
  Fixture is simpler and lets you test deterministically.
