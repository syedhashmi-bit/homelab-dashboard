import { NextResponse } from "next/server";
import { loadConfig, type ServiceCreds } from "@/app/lib/server-config";
// Side-effect import: installs a process-wide undici Agent capped at 2
// connections per origin. Defense-in-depth against connection-storm
// regressions.
import "@/app/lib/fetch-agent";

interface QueueItem { title: string; pct: number; etaSec?: number | null }
interface Stream    { title: string; user: string; progress: number; posStr: string }
interface HealthSummary { warning: number; error: number }
interface WeeklyStats {
  plays?:        number;
  topShow?:      string;
  topUser?:      string;
}

interface ServiceResult {
  name: string;
  up: boolean;
  configured: boolean;                 // false ⇒ required credential env var missing; client hides the card
  envVar?: string[];                   // names of the env vars the user needs to set when configured=false
  url?: string;                        // resolved URL the service was tried at (for debug / Connections panel)
  lines: string[];
  pct?: number;
  downCount?: number;
  queueItem?:  QueueItem | null;     // legacy single item — keep for back-compat
  queueItems?: QueueItem[];           // top-N (Radarr / Sonarr / qBit) when multiple
  streams?:    Stream[];
  health?:     HealthSummary;
  weekly?:     WeeklyStats;
  stale?:      boolean;                // true ⇒ this is cached data from a previous successful poll
  staleSince?: number;                 // timestamp of the last successful fetch when stale=true
  authError?:  boolean;                // true ⇒ service is reachable but API key is wrong (401/403)
}

// Helper: build a "needs configuration" placeholder result.
function unconfigured(name: string, envVar: string[]): ServiceResult {
  return { name, up: false, configured: false, envVar, lines: [] };
}

let servicesCache: { data: { services: ServiceResult[]; timestamp: number }; ts: number } | null = null;
// 30s — combined with per-endpoint memoization of heavy library calls
// (5 min) and slow-changing enrichment (3 min), each upstream service
// now sees ~2-3 light requests/minute from this dashboard instead of
// the original 30+ calls/minute that was crashing *arr containers.
const CACHE_TTL = 30_000;
// Stale-while-revalidate window. Serve cached data immediately even after
// expiry as long as it's <5 min old, while a background refresh runs. Makes
// the API consistently fast even when upstream services are timing out at
// 8s each — the dashboard never hangs on a service call.
const STALE_WHILE_REVALIDATE_MS = 300_000;
let backgroundRefresh: Promise<void> | null = null;

// Per-service last-known-good results. If a service was up in the last
// STALE_WINDOW_MS but a fresh poll fails, we surface the cached good result
// flagged as stale rather than a blank "down" card — much smoother UX when
// the homelab is under load and services briefly stop responding.
const lastGoodResults = new Map<string, { result: ServiceResult; ts: number }>();
const STALE_WINDOW_MS = 60_000;

let piholeSession: { sid: string; expiry: number } | null = null;

// Per-service URL + credential resolution moved to app/lib/server-config.ts.
// Each service function below takes its resolved creds as a parameter, so the
// route is a pure function of its input — `loadConfig()` is called exactly once
// in the GET handler.

function fmtMB(b: number): string {
  if (b === 0) return "0 B";
  if (b < 1e6) return `${(b/1e3).toFixed(0)} KB`;
  if (b < 1e9) return `${(b/1e6).toFixed(0)} MB`;
  return `${(b/1e9).toFixed(1)} GB`;
}

// TB-aware version for library sizes which can run into multi-TB territory.
function fmtSize(b: number): string {
  if (b === 0) return "0 B";
  if (b < 1e6) return `${(b/1e3).toFixed(0)} KB`;
  if (b < 1e9) return `${(b/1e6).toFixed(0)} MB`;
  if (b < 1e12) return `${(b/1e9).toFixed(1)} GB`;
  return `${(b/1e12).toFixed(2)} TB`;
}

function fmtEta(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec) || sec <= 0 || sec >= 8_640_000) return null; // qBit uses huge values for "unknown"
  if (sec < 60)    return `${Math.round(sec)}s`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

// Custom error class so callers can distinguish auth failures (401/403) from
// other HTTP errors and network errors. Auth failures surface as a clearer
// "API key" message rather than a generic "container down" hint.
class AuthError extends Error {
  constructor(public status: number) { super(`Auth failed: HTTP ${status}`); }
}

// Thrown when an upstream returns 5xx but the body is a structured error
// object (e.g. Servarr apps returning {message, description} on a SQLite
// failure). Callers can inspect `.body.message` to show a useful message.
class UpstreamServerError extends Error {
  constructor(public status: number, public body: { message?: string; description?: string }) {
    super(`HTTP ${status}: ${body.message ?? "upstream error"}`);
  }
}

async function apiFetch(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(6000),
    next: { revalidate: 0 },
  });
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  if (!res.ok) {
    // On 5xx, try to read the body — Servarr / linuxserver apps return
    // a structured {message, description} on internal errors. Surfacing
    // the message in the UI is much more useful than "HTTP 500".
    if (res.status >= 500 && res.status < 600) {
      try {
        const body = await res.json() as { message?: string; description?: string };
        if (body && typeof body.message === "string") {
          throw new UpstreamServerError(res.status, body);
        }
      } catch (e) {
        if (e instanceof UpstreamServerError) throw e;
        // body was not JSON — fall through to the generic error
      }
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// Long-lived memoize for "library" data that barely changes minute-to-minute
// (e.g. radarr's full /movie list, sonarr's /series list, cutoff/health probes).
// These are the heaviest calls in the services route — caching them for several
// minutes means each upstream gets hit a handful of times per hour instead of
// hundreds, which is the difference between "homelab stable" and "*arr crash".
const memoCache = new Map<string, { value: unknown; ts: number }>();
// Belt-and-suspenders cap on the memo cache. Keys include the upstream URL so
// /setup writes (which can change URLs at runtime) won't grow the map forever.
// Prune anything older than 10 min on each call, and hard-cap at 100 entries.
function pruneMemoCache(): void {
  const cutoff = Date.now() - 600_000;
  for (const [k, v] of memoCache) {
    if (v.ts < cutoff) memoCache.delete(k);
  }
  if (memoCache.size > 100) {
    // Drop the oldest entries until we're back under cap.
    const sorted = Array.from(memoCache.entries()).sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < sorted.length - 100; i++) memoCache.delete(sorted[i][0]);
  }
}
async function apiFetchMemo<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = memoCache.get(key);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.value as T;
  const value = await fetcher();
  memoCache.set(key, { value, ts: Date.now() });
  return value;
}
// Forgiving memo variant — caches null values too so a failing endpoint
// doesn't get re-probed every cycle.
async function apiFetchMemoOpt<T>(key: string, ttlMs: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  const cached = memoCache.get(key);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.value as T | null;
  try {
    const value = await fetcher();
    memoCache.set(key, { value, ts: Date.now() });
    return value;
  } catch {
    memoCache.set(key, { value: null, ts: Date.now() });
    return null;
  }
}

// Forgiving variant — returns null on any error instead of throwing.
// Use for "nice-to-have" enrichment fetches whose failure shouldn't take
// down the whole service result.
async function apiFetchOpt(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    return await apiFetch(url, headers);
  } catch {
    return null;
  }
}

// Returns true if the server at baseUrl responds to any HTTP request (even 4xx/5xx).
// Uses HEAD to keep the probe lightweight — falls back to GET if the server
// doesn't support HEAD. 4s timeout: long enough for a slow homelab, short
// enough that 10 of these in a cold-start storm don't pile up to 60s.
async function checkReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 0 },
    });
    // Any HTTP response (even 4xx/5xx) means the server is alive. 405 means
    // HEAD isn't supported but the server itself responded.
    if (res.status < 500 || res.status === 405) return true;
    return true;
  } catch {
    // HEAD failed — try a cheap GET in case the server rejected HEAD entirely.
    try {
      await fetch(baseUrl, {
        signal: AbortSignal.timeout(3000),
        next: { revalidate: 0 },
      });
      return true;
    } catch {
      return false;
    }
  }
}

interface ArrHealthRecord { type?: string; source?: string; message?: string }
interface RadarrMovie     { hasFile: boolean; monitored: boolean; sizeOnDisk?: number }
interface ArrQueueRecord  { title: string; size: number; sizeleft: number; timeleft?: string }
function parseTimeleft(t?: string): number | null {
  // Sonarr/Radarr return "00:14:32" or "1.10:30:00" (days.h:m:s). Convert to seconds.
  if (!t || typeof t !== "string") return null;
  const m = t.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const days = parseInt(m[1] ?? "0", 10);
  const hr   = parseInt(m[2], 10);
  const min  = parseInt(m[3], 10);
  const sec  = parseInt(m[4], 10);
  return days * 86400 + hr * 3600 + min * 60 + sec;
}
function summarizeHealth(records: ArrHealthRecord[] | null): HealthSummary | undefined {
  if (!records || records.length === 0) return undefined;
  const warning = records.filter(r => (r.type ?? "").toLowerCase() === "warning").length;
  const error   = records.filter(r => (r.type ?? "").toLowerCase() === "error"  ).length;
  if (warning === 0 && error === 0) return undefined;
  return { warning, error };
}

async function radarr(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("radarr", creds.envVar ?? ["RADARR_API_KEY"]);
  const KEY  = creds.apiKey ?? "";
  const BASE = creds.url;
  try {
    // Movies list = whole library, memoized 5 min. Library size changes
    // hourly at best — fetching it every 15s burned hundreds of req/hour.
    // Cutoff + health also memoized (3 min) since they're slow-changing.
    // Only the queue endpoint is fetched fresh every poll (active downloads).
    const moviesData = await apiFetchMemo(`radarr:movies:${BASE}`, 300_000, () =>
      apiFetch(`${BASE}/api/v3/movie?apiKey=${KEY}`) as Promise<RadarrMovie[]>
    );
    const [queueData, cutoffData, healthData] = await Promise.all([
      apiFetchOpt(`${BASE}/api/v3/queue?apiKey=${KEY}&pageSize=3&sortKey=timeleft&includeUnknownMovieItems=false`) as Promise<{
        totalRecords: number;
        records: ArrQueueRecord[];
      } | null>,
      apiFetchMemoOpt(`radarr:cutoff:${BASE}`, 300_000, () =>
        apiFetchOpt(`${BASE}/api/v3/wanted/cutoff?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords?: number } | null>
      ),
      apiFetchMemoOpt(`radarr:health:${BASE}`, 180_000, () =>
        apiFetchOpt(`${BASE}/api/v3/health?apiKey=${KEY}`) as Promise<ArrHealthRecord[] | null>
      ),
    ]);
    const total       = moviesData.length;
    const missing     = moviesData.filter(m => !m.hasFile && m.monitored).length;
    const pct         = total > 0 ? Math.round(((total - missing) / total) * 100) : 100;
    const sizeBytes   = moviesData.reduce((s, m) => s + (m.sizeOnDisk ?? 0), 0);
    const cutoffUnmet = cutoffData?.totalRecords ?? 0;
    const records     = queueData?.records ?? [];
    const queueItems: QueueItem[] = records.slice(0, 3).map(r => ({
      title: r.title,
      pct:   r.size > 0 ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0,
      etaSec: parseTimeleft(r.timeleft),
    }));
    const lines = [`${total} movies · ${fmtSize(sizeBytes)}`];
    const summaryBits: string[] = [];
    if (missing     > 0) summaryBits.push(`${missing} missing`);
    if (cutoffUnmet > 0) summaryBits.push(`${cutoffUnmet} cutoff unmet`);
    if (summaryBits.length > 0) lines.push(summaryBits.join(" · "));
    if ((queueData?.totalRecords ?? 0) > 0) lines.push(`${queueData!.totalRecords} in queue`);
    return {
      name: "radarr", up: true, configured: true, url: BASE, pct, lines,
      queueItem:  queueItems[0] ?? null,
      queueItems: queueItems.length > 0 ? queueItems : undefined,
      health:     summarizeHealth(healthData),
    };
  } catch (e) {
    const isAuth = e instanceof AuthError;
    const up = await checkReachable(BASE);
    return { name: "radarr", up: up || isAuth, configured: true, url: BASE, authError: isAuth, lines: isAuth ? ["check api key"] : up ? ["—"] : [] };
  }
}

interface SonarrSeries {
  monitored: boolean;
  statistics?: { sizeOnDisk?: number; episodeFileCount?: number; episodeCount?: number };
}
async function sonarr(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("sonarr", creds.envVar ?? ["SONARR_API_KEY"]);
  const KEY  = creds.apiKey ?? "";
  const BASE = creds.url;
  try {
    // Series list is the heaviest call (whole library). Memoized 5 min.
    // missing/cutoff/health also memoized — only the queue is fetched fresh.
    const seriesData = await apiFetchMemo(`sonarr:series:${BASE}`, 300_000, () =>
      apiFetch(`${BASE}/api/v3/series?apiKey=${KEY}&includeSeasonImages=false`) as Promise<SonarrSeries[]>
    );
    const [wantedData, queueData, cutoffData, healthData] = await Promise.all([
      apiFetchMemoOpt(`sonarr:missing:${BASE}`, 180_000, () =>
        apiFetchOpt(`${BASE}/api/v3/wanted/missing?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords?: number } | null>
      ),
      apiFetchOpt(`${BASE}/api/v3/queue?apiKey=${KEY}&pageSize=3&sortKey=timeleft&includeUnknownSeriesItems=false`) as Promise<{
        totalRecords: number;
        records: ArrQueueRecord[];
      } | null>,
      apiFetchMemoOpt(`sonarr:cutoff:${BASE}`, 300_000, () =>
        apiFetchOpt(`${BASE}/api/v3/wanted/cutoff?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords?: number } | null>
      ),
      apiFetchMemoOpt(`sonarr:health:${BASE}`, 180_000, () =>
        apiFetchOpt(`${BASE}/api/v3/health?apiKey=${KEY}`) as Promise<ArrHealthRecord[] | null>
      ),
    ]);
    const total       = seriesData.length;
    const sizeBytes   = seriesData.reduce((s, x) => s + (x.statistics?.sizeOnDisk ?? 0), 0);
    const missing     = wantedData?.totalRecords ?? 0;
    const cutoffUnmet = cutoffData?.totalRecords ?? 0;
    const records     = queueData?.records ?? [];
    const queueItems: QueueItem[] = records.slice(0, 3).map(r => ({
      title: r.title,
      pct:   r.size > 0 ? Math.round(((r.size - r.sizeleft) / r.size) * 100) : 0,
      etaSec: parseTimeleft(r.timeleft),
    }));
    const lines = [`${total} series · ${fmtSize(sizeBytes)}`];
    const summaryBits: string[] = [];
    if (missing     > 0) summaryBits.push(`${missing} missing eps`);
    if (cutoffUnmet > 0) summaryBits.push(`${cutoffUnmet} cutoff unmet`);
    if (summaryBits.length > 0) lines.push(summaryBits.join(" · "));
    if ((queueData?.totalRecords ?? 0) > 0) lines.push(`${queueData!.totalRecords} in queue`);
    return {
      name: "sonarr", up: true, configured: true, url: BASE, lines,
      queueItem:  queueItems[0] ?? null,
      queueItems: queueItems.length > 0 ? queueItems : undefined,
      health:     summarizeHealth(healthData),
    };
  } catch (e) {
    const isAuth = e instanceof AuthError;
    const up = await checkReachable(BASE);
    return { name: "sonarr", up: up || isAuth, configured: true, url: BASE, authError: isAuth, lines: isAuth ? ["check api key"] : up ? ["—"] : [] };
  }
}

async function bazarr(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("bazarr", creds.envVar ?? ["BAZARR_API_KEY"]);
  const KEY      = creds.apiKey ?? "";
  const BASE_URL = creds.url;
  const HEADERS = { "X-API-KEY": KEY };

  try {
    // Missing-subs counts barely change minute-to-minute; memoize 3 min so
    // Bazarr (notoriously CPU-heavy under polling) doesn't get hammered.
    const [epData, mvData] = await Promise.all([
      apiFetchMemo(`bazarr:eps:${BASE_URL}`, 180_000, () =>
        apiFetch(`${BASE_URL}/api/episodes/wanted?start=0&length=1`, HEADERS) as Promise<{ total?: number }>
      ),
      apiFetchMemo(`bazarr:movies:${BASE_URL}`, 180_000, () =>
        apiFetch(`${BASE_URL}/api/movies/wanted?start=0&length=1`, HEADERS) as Promise<{ total?: number }>
      ),
    ]);
    const epMissing = epData.total ?? 0;
    const mvMissing = mvData.total ?? 0;
    return { name: "bazarr", up: true, configured: true, url: BASE_URL, lines: [`${epMissing} missing ep subs · ${mvMissing} missing movie subs`] };
  } catch (e) {
    const isAuth = e instanceof AuthError;
    const up = await checkReachable(BASE_URL);
    return { name: "bazarr", up: up || isAuth, configured: true, url: BASE_URL, authError: isAuth, lines: isAuth ? ["check api key"] : up ? ["—"] : [] };
  }
}

interface TautulliSession {
  title?: string;
  grandparent_title?: string;
  parent_media_index?: string;
  media_index?: string;
  user?: string;
  progress_percent?: string;
  duration?: number;
  view_offset?: number;
  media_type?: string;
}

function fmtMs(ms: number): string {
  const totalMins = Math.floor(ms / 1000 / 60);
  const hours     = Math.floor(totalMins / 60);
  const mins      = totalMins % 60;
  const secs      = Math.floor((ms / 1000) % 60);
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

interface TautulliHomeRow {
  title?:     string;
  user?:      string;
  friendly_name?: string;
  total_plays?: number | string;
}
interface TautulliHomeStat {
  stat_id?: string;
  rows?:    TautulliHomeRow[];
}
async function tautulli(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("tautulli", creds.envVar ?? ["TAUTULLI_API_KEY"]);
  const KEY  = creds.apiKey ?? "";
  const BASE = `${creds.url}/api/v2`;
  try {
    const activity = await apiFetch(
      `${BASE}?apikey=${KEY}&cmd=get_activity`
    ) as { response: { data: { stream_count: string; sessions?: TautulliSession[] } } };
    const count    = parseInt(activity?.response?.data?.stream_count ?? "0", 10);
    const sessions = activity?.response?.data?.sessions ?? [];
    const streams: Stream[] = sessions.map(s => {
      let title = s.title ?? "Unknown";
      if (s.media_type === "episode" && s.grandparent_title) {
        const se = `S${String(s.parent_media_index ?? "0").padStart(2, "0")}E${String(s.media_index ?? "0").padStart(2, "0")}`;
        title = `${s.grandparent_title} ${se}`;
      }
      const progress = parseInt(s.progress_percent ?? "0", 10);
      const durMs    = s.duration   ?? 0;   // Tautulli duration is milliseconds
      const offMs    = s.view_offset ?? 0;  // view_offset is milliseconds
      const posStr   = durMs > 0 ? `${fmtMs(offMs)} / ${fmtMs(durMs)}` : "";
      return { title, user: s.user ?? "—", progress, posStr };
    });

    // When something IS streaming, the streams panel is the headline; skip the
    // weekly recap fetch (no point doing extra work and the card already has
    // plenty to show).
    if (count > 0) {
      return {
        name: "tautulli", up: true, configured: true, url: creds.url,
        lines: [`${count} active stream${count !== 1 ? "s" : ""}`],
        streams,
      };
    }

    // Otherwise fetch a 7-day recap so the card isn't blank.
    // get_home_stats returns multiple stat groups in one call.
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 86400 * 1000) / 1000);
    const [homeData, historyData] = await Promise.all([
      apiFetchOpt(`${BASE}?apikey=${KEY}&cmd=get_home_stats&time_range=7&stats_count=1&stats_type=plays`) as Promise<{
        response?: { data?: TautulliHomeStat[] };
      } | null>,
      apiFetchOpt(`${BASE}?apikey=${KEY}&cmd=get_history&after=${sevenDaysAgo}&length=1`) as Promise<{
        response?: { data?: { recordsTotal?: number; recordsFiltered?: number } };
      } | null>,
    ]);
    const homeStats = homeData?.response?.data ?? [];
    const findStat  = (id: string) => homeStats.find(s => s.stat_id === id);
    const topShow   = findStat("top_tv")?.rows?.[0]?.title ?? findStat("popular_tv")?.rows?.[0]?.title;
    const topUser   = findStat("top_users")?.rows?.[0]?.friendly_name
                   ?? findStat("top_users")?.rows?.[0]?.user;
    const playsWk   = historyData?.response?.data?.recordsTotal
                  ?? historyData?.response?.data?.recordsFiltered;

    const lines: string[] = [];
    if (playsWk != null && playsWk > 0) {
      lines.push(`${playsWk} plays this week`);
    } else {
      lines.push("no active streams");
    }
    if (topShow) lines.push(`top: ${topShow}`);
    if (topUser) lines.push(`top user: ${topUser}`);

    return {
      name: "tautulli", up: true, configured: true, url: creds.url, lines, streams,
      weekly: (playsWk != null || topShow || topUser)
        ? { plays: typeof playsWk === "number" ? playsWk : undefined, topShow, topUser }
        : undefined,
    };
  } catch {
    const up = await checkReachable(creds.url);
    return { name: "tautulli", up, configured: true, url: creds.url, lines: up ? ["—"] : [] };
  }
}

interface QbitTorrent {
  name?:      string;
  state?:     string;
  dlspeed?:   number;
  upspeed?:   number;
  size?:      number;
  progress?:  number;     // 0-1
  uploaded?:  number;
  downloaded?: number;
  ratio?:     number;
  eta?:       number;     // seconds; qBit uses 8640000 for "unknown"
}
const QBIT_DL_STATES   = new Set(["downloading","forcedDL","stalledDL","metaDL","queuedDL","checkingDL","allocating"]);
const QBIT_SEED_STATES = new Set(["uploading","forcedUP","stalledUP","queuedUP","checkingUP"]);

async function qbittorrent(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("qbittorrent", creds.envVar ?? ["QBIT_API_KEY", "QBIT_USERNAME", "QBIT_PASSWORD"]);
  const BASE = creds.url;
  const USER = creds.username ?? "";
  const PASS = creds.password ?? "";
  const KEY  = creds.apiKey  ?? "";
  try {
    // qBittorrent 5.1+ accepts a native API key (Settings → WebUI → API Key,
    // format `qbt_...`) via the Authorization: Bearer header. Prefer the
    // key if set; fall back to the cookie/session login flow for older
    // qBit versions (and for users who don't want to bother with the key).
    let requestHeaders: Record<string, string>;
    if (KEY) {
      requestHeaders = { Authorization: `Bearer ${KEY}`, Referer: BASE };
    } else {
      const loginRes = await fetch(`${BASE}/api/v2/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": BASE,
        },
        body: new URLSearchParams({ username: USER, password: PASS }).toString(),
        signal: AbortSignal.timeout(6000),
        next: { revalidate: 0 },
      });
      if (loginRes.status === 401 || loginRes.status === 403) throw new AuthError(loginRes.status);
      const setCookie = loginRes.headers.get("set-cookie");
      const sid = setCookie?.match(/SID=([^;]+)/)?.[1];
      // If login succeeds but no SID is returned, qBit's "Bypass auth for
      // localhost" is enabled — subsequent calls work without a cookie.
      requestHeaders = sid
        ? { Cookie: `SID=${sid}`, Referer: BASE }
        : { Referer: BASE };
    }

    const torrentsRes = await fetch(`${BASE}/api/v2/torrents/info`, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 0 },
    });
    if (torrentsRes.status === 401 || torrentsRes.status === 403) throw new AuthError(torrentsRes.status);
    if (!torrentsRes.ok) throw new Error(`torrents HTTP ${torrentsRes.status}`);
    const torrents = await torrentsRes.json() as QbitTorrent[];

    const downloading = torrents.filter(t => t.state && QBIT_DL_STATES.has(t.state));
    const seeding     = torrents.filter(t => t.state && QBIT_SEED_STATES.has(t.state));
    const totalDl     = torrents.reduce((s, t) => s + (t.dlspeed ?? 0), 0);
    const totalUp     = torrents.reduce((s, t) => s + (t.upspeed ?? 0), 0);
    // Aggregate ratio across all torrents — bytes-weighted, not the average of ratios.
    const totUp     = torrents.reduce((s, t) => s + (t.uploaded   ?? 0), 0);
    const totDown   = torrents.reduce((s, t) => s + (t.downloaded ?? 0), 0);
    const ratio     = totDown > 0 ? totUp / totDown : null;

    const queueItems: QueueItem[] = downloading
      .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))   // closest to done first
      .slice(0, 3)
      .map(t => ({
        title: t.name ?? "(unnamed)",
        pct:   Math.round((t.progress ?? 0) * 100),
        etaSec: t.eta ?? null,
      }));

    const lines: string[] = [
      ratio != null
        ? `${downloading.length} dl · ${seeding.length} seed · ratio ${ratio.toFixed(2)}`
        : `${downloading.length} dl · ${seeding.length} seed`,
      `↓ ${fmtMB(totalDl)}/s · ↑ ${fmtMB(totalUp)}/s`,
    ];

    return {
      name: "qbittorrent", up: true, configured: true, url: BASE, lines,
      queueItem:  queueItems[0] ?? null,
      queueItems: queueItems.length > 0 ? queueItems : undefined,
    };
  } catch (e) {
    const isAuth = e instanceof AuthError;
    const up = await checkReachable(`${BASE}/api/v2/app/version`);
    const authMsg = KEY ? "check api key" : "check user/pass";
    return { name: "qbittorrent", up: up || isAuth, configured: true, url: BASE, authError: isAuth, lines: isAuth ? [authMsg] : up ? ["—"] : [] };
  }
}

async function overseerr(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("overseerr", creds.envVar ?? ["OVERSEERR_API_KEY"]);
  const KEY = creds.apiKey ?? "";
  try {
    // Overseerr request counts change when users submit/approve — minutes,
    // not seconds. Memoize 3 min so we're hitting it ~20×/hour total, not
    // 60+ calls/hour across 3 endpoints from a 15s poll cycle.
    const [pendingData, approvedData, availableData] = await Promise.all([
      apiFetchMemo(`overseerr:pending:${creds.url}`, 180_000, () =>
        apiFetch(`${creds.url}/api/v1/request?take=1&skip=0&filter=pending`,   { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>
      ),
      apiFetchMemo(`overseerr:approved:${creds.url}`, 180_000, () =>
        apiFetch(`${creds.url}/api/v1/request?take=1&skip=0&filter=approved`,  { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>
      ),
      apiFetchMemo(`overseerr:available:${creds.url}`, 180_000, () =>
        apiFetch(`${creds.url}/api/v1/request?take=1&skip=0&filter=available`, { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>
      ),
    ]);
    const pending   = pendingData.pageInfo?.results ?? 0;
    const approved  = approvedData.pageInfo?.results ?? 0;
    const available = availableData.pageInfo?.results ?? 0;
    const lines = [`${pending} pending · ${approved} approved`];
    if (available > 0) lines.push(`${available} available`);
    return { name: "overseerr", up: true, configured: true, url: creds.url, lines };
  } catch (e) {
    const isAuth = e instanceof AuthError;
    const up = await checkReachable(creds.url);
    return { name: "overseerr", up: up || isAuth, configured: true, url: creds.url, authError: isAuth, lines: isAuth ? ["check api key"] : up ? ["—"] : [] };
  }
}

async function pihole(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("pihole", creds.envVar ?? ["PIHOLE_PASSWORD"]);
  const BASE = creds.url;
  const PASSWORD = creds.password ?? "";

  async function getSid(): Promise<string> {
    const now = Date.now();
    if (piholeSession && now < piholeSession.expiry) return piholeSession.sid;
    const authRes = await fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
      signal: AbortSignal.timeout(6000),
    });
    const authData = await authRes.json() as { session?: { sid?: string; validity?: number } };
    const sid = authData?.session?.sid;
    if (!sid) throw new Error("no sid in auth response");
    const validity = authData.session?.validity ?? 1800;
    piholeSession = { sid, expiry: now + validity * 1000 };
    return sid;
  }

  // Optional fetch wrapper that uses the SID header. Returns null on failure
  // so a missing endpoint on the user's PiHole version doesn't sink the card.
  async function piFetchOpt<T>(path: string, sid: string): Promise<T | null> {
    try {
      const r = await fetch(`${BASE}${path}`, {
        headers: { sid },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return null;
      return await r.json() as T;
    } catch { return null; }
  }

  try {
    const sid = await getSid();
    const statsRes = await fetch(`${BASE}/api/stats/summary`, {
      headers: { sid },
      signal: AbortSignal.timeout(6000),
    });
    if (!statsRes.ok) throw new Error(`stats HTTP ${statsRes.status}`);
    const stats = await statsRes.json() as {
      queries?: { total?: number; blocked?: number; percent_blocked?: number };
      gravity?: { domains_being_blocked?: number };
    };
    const total   = stats.queries?.total ?? 0;
    const blocked = stats.queries?.blocked ?? 0;
    const pct     = (stats.queries?.percent_blocked ?? 0).toFixed(1);
    const gravity = stats.gravity?.domains_being_blocked ?? 0;

    // Enrichment: top blocked domain + count of active (querying) clients.
    // Both endpoints are PiHole v6; return null on any failure.
    const [topBlocked, topClients] = await Promise.all([
      piFetchOpt<{ domains?: { domain?: string; count?: number }[]; top_domains?: { domain?: string }[] }>(
        "/api/stats/top_domains?blocked=true&count=1", sid),
      piFetchOpt<{ clients?: { name?: string; ip?: string; count?: number }[] }>(
        "/api/stats/top_clients?count=99", sid),
    ]);

    const topBlockedDomain = topBlocked?.domains?.[0]?.domain ?? topBlocked?.top_domains?.[0]?.domain;
    const activeClients    = topClients?.clients?.length;

    const lines = [
      `${total.toLocaleString()} queries today`,
      `${blocked.toLocaleString()} blocked (${pct}%)`,
    ];
    if (topBlockedDomain) {
      const domainShort = topBlockedDomain.length > 32 ? topBlockedDomain.slice(0, 32) + "…" : topBlockedDomain;
      lines.push(`top blocked: ${domainShort}`);
    }
    if (activeClients != null && activeClients > 0) {
      lines.push(`${activeClients} active client${activeClients !== 1 ? "s" : ""}`);
    }
    lines.push(`${gravity.toLocaleString()} domains in gravity`);

    return { name: "pihole", up: true, configured: true, url: BASE, lines };
  } catch {
    piholeSession = null;
    const up = await checkReachable(BASE);
    return { name: "pihole", up, configured: true, url: BASE, lines: up ? ["—"] : [] };
  }
}

// Prowlarr/Radarr/Sonarr (Servarr) return error responses as 200 OK with a
// JSON body shaped { message, description? } when something blows up inside
// the app (e.g. a corrupt date in the SQLite history table will produce
// "Error parsing column ... was not recognized as a valid DateTime").
// Detect this shape and treat it as a recoverable upstream error so the
// card surfaces it instead of silently showing "0 indexers".
interface ServarrError { message?: string; description?: string }
function isServarrError(o: unknown): o is ServarrError {
  return typeof o === "object" && o !== null && typeof (o as ServarrError).message === "string";
}

async function prowlarr(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("prowlarr", creds.envVar ?? ["PROWLARR_API_KEY"]);
  const KEY  = creds.apiKey ?? "";
  const BASE = creds.url;
  try {
    // Prowlarr is fragile under polling load — this is what was crashing on
    // TrueNAS. indexerstats is a heavy SQL aggregation; cache 5 min. Health
    // is cached 3 min. Per-poll cost on prowlarr now near zero.
    const [stats, healthData] = await Promise.all([
      apiFetchMemo(`prowlarr:stats:${BASE}`, 300_000, () =>
        apiFetch(`${BASE}/api/v1/indexerstats?apikey=${KEY}`) as Promise<{
          indexers?: { numberOfGrabs?: number; numberOfQueries?: number }[];
        } | ServarrError>
      ),
      apiFetchMemoOpt(`prowlarr:health:${BASE}`, 180_000, () =>
        apiFetchOpt(`${BASE}/api/v1/health?apikey=${KEY}`) as Promise<ArrHealthRecord[] | null>
      ),
    ]);

    // 200 OK with an error body — Prowlarr's SQLite history table has a row
    // it can't parse (commonly: corrupted timestamp from a clock-skew event).
    // Surface this clearly instead of pretending we have 0 indexers.
    if (isServarrError(stats)) {
      return {
        name: "prowlarr", up: true, configured: true, url: BASE,
        lines: ["indexer stats unavailable", "restart prowlarr to refresh"],
        health: summarizeHealth(healthData),
      };
    }

    const indexers = stats.indexers ?? [];
    const grabs    = indexers.reduce((s, i) => s + (i.numberOfGrabs   ?? 0), 0);
    const queries  = indexers.reduce((s, i) => s + (i.numberOfQueries ?? 0), 0);
    return {
      name: "prowlarr", up: true, configured: true, url: BASE,
      lines: [`${indexers.length} indexers · ${grabs} grabs · ${queries} queries`],
      health: summarizeHealth(healthData),
    };
  } catch (e) {
    const isAuth = e instanceof AuthError;
    // Prowlarr's SQLite history table has a row it can't parse — typically
    // a corrupted timestamp from a clock-skew event. The app itself is up,
    // but indexerstats query crashes. Surface this clearly.
    if (e instanceof UpstreamServerError) {
      return {
        name: "prowlarr", up: true, configured: true, url: BASE,
        lines: ["indexer stats unavailable", "restart prowlarr to refresh"],
      };
    }
    const up = await checkReachable(BASE);
    return { name: "prowlarr", up: up || isAuth, configured: true, url: BASE, authError: isAuth, lines: isAuth ? ["check api key"] : up ? ["—"] : [] };
  }
}

async function uptimeKuma(creds: ServiceCreds): Promise<ServiceResult> {
  const BASE = creds.url;

  function parseHeartbeats(data: unknown): ServiceResult | null {
    const obj = data as { monitors?: { status?: number }[]; heartbeatList?: Record<string, { status?: number }[]> };
    let monitors: { status?: number }[] = [];
    if (Array.isArray(obj.monitors)) {
      monitors = obj.monitors;
    } else if (obj.heartbeatList && Object.keys(obj.heartbeatList).length > 0) {
      monitors = Object.values(obj.heartbeatList).map(beats => beats[beats.length - 1] ?? {});
    }
    if (monitors.length === 0) return null;
    const upCount   = monitors.filter(m => m.status === 1).length;
    const downCount = monitors.filter(m => m.status === 0).length;
    const line      = downCount > 0 ? `${upCount} up · ${downCount} down` : `${upCount} sites up`;
    return { name: "uptimekuma", up: true, configured: true, url: BASE, lines: [line], downCount };
  }

  const AUTH = { Authorization: `Bearer ${creds.apiKey ?? ""}` };

  // Try the known "services" slug heartbeat endpoint
  try {
    const data = await apiFetch(`${BASE}/api/status-page/heartbeat/services`, AUTH);
    const result = parseHeartbeats(data);
    if (result) return result;
  } catch { /* fall through */ }

  // Try the status-page/services endpoint directly
  try {
    const data = await apiFetch(`${BASE}/api/status-page/services`, AUTH);
    const result = parseHeartbeats(data);
    if (result) return result;
  } catch { /* fall through */ }

  // Parse Prometheus metrics endpoint
  try {
    const res = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(5000), next: { revalidate: 0 } });
    if (res.ok) {
      const text = await res.text();
      const upCount   = (text.match(/monitor_status\{[^}]*\}\s+1/g) ?? []).length;
      const downCount = (text.match(/monitor_status\{[^}]*\}\s+0/g) ?? []).length;
      if (upCount + downCount > 0) {
        const line = downCount > 0 ? `${upCount} up · ${downCount} down` : `${upCount} sites up`;
        return { name: "uptimekuma", up: true, configured: true, url: BASE, lines: [line], downCount };
      }
    }
  } catch { /* fall through */ }

  const up = await checkReachable(BASE);
  return { name: "uptimekuma", up, configured: true, url: BASE, lines: up ? ["online"] : [] };
}

async function nginxProxy(creds: ServiceCreds): Promise<ServiceResult> {
  if (!creds.configured) return unconfigured("nginx", creds.envVar ?? ["NGINX_USERNAME", "NGINX_PASSWORD"]);
  const BASE = creds.url;
  const USER = creds.username ?? "";
  const PASS = creds.password ?? "";
  try {
    const tokenRes = await fetch(`${BASE}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: USER, secret: PASS }),
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 0 },
    });
    if (!tokenRes.ok) throw new Error("auth");
    const { token } = await tokenRes.json() as { token: string };
    const data = await apiFetch(`${BASE}/api/nginx/proxy-hosts`, { Authorization: `Bearer ${token}` }) as { enabled: number | boolean; domain_names?: string[] }[];
    const enabled  = data.filter(h => h.enabled === 1 || h.enabled === true).length;
    const disabled = data.length - enabled;
    const domains = data
      .filter(h => h.enabled === 1 || h.enabled === true)
      .flatMap(h => h.domain_names ?? [])
      .slice(0, 3);
    const lines: string[] = [`${enabled} enabled · ${disabled} disabled`];
    if (domains.length > 0) lines.push(...domains);
    return { name: "nginx", up: true, configured: true, url: BASE, lines };
  } catch {
    const up = await checkReachable(BASE);
    return { name: "nginx", up, configured: true, url: BASE, lines: up ? ["—"] : [] };
  }
}

// Hits all 10 upstream services (in 2 batches to avoid a thundering herd)
// and produces the cached payload shape. Per-service stale fallback applied.
async function fetchAllServicesData(cfg: Awaited<ReturnType<typeof loadConfig>>) {
  const names = ["radarr","sonarr","bazarr","tautulli","qbittorrent","overseerr","pihole","prowlarr","nginx","uptimekuma"];
  const batch1 = await Promise.allSettled([
    radarr(cfg.services.radarr),
    sonarr(cfg.services.sonarr),
    bazarr(cfg.services.bazarr),
    tautulli(cfg.services.tautulli),
    qbittorrent(cfg.services.qbittorrent),
  ]);
  await new Promise(r => setTimeout(r, 250));
  const batch2 = await Promise.allSettled([
    overseerr(cfg.services.overseerr),
    pihole(cfg.services.pihole),
    prowlarr(cfg.services.prowlarr),
    nginxProxy(cfg.services.nginx),
    uptimeKuma(cfg.services.uptimekuma),
  ]);
  const settled = [...batch1, ...batch2];
  const now = Date.now();
  const results: ServiceResult[] = settled.map((r, i) => {
    const name = names[i];
    const fresh: ServiceResult = r.status === "fulfilled"
      ? r.value
      : { name, up: false, configured: true, lines: [] };

    const hasRealData = fresh.up && fresh.lines.length > 0 && fresh.lines[0] !== "—";
    if (hasRealData) {
      lastGoodResults.set(name, { result: fresh, ts: now });
      return fresh;
    }
    const cached = lastGoodResults.get(name);
    if (cached && now - cached.ts < STALE_WINDOW_MS) {
      return { ...cached.result, stale: true, staleSince: cached.ts };
    }
    return fresh;
  });

  return { services: results, timestamp: now };
}

// Actual upstream-fetch worker. Called from GET directly on cold start, or
// in the background from the stale-while-revalidate path.
async function refreshServicesCache(): Promise<void> {
  pruneMemoCache();
  const cfg = await loadConfig();
  const data = await fetchAllServicesData(cfg);
  servicesCache = { data, ts: Date.now() };
}

// Warm the cache on module load (container startup) so the very first user
// request doesn't pay the full ~16s cold-start cost. Fire-and-forget; the
// background refresh will populate `servicesCache` and `lastGoodResults`.
// Subsequent GETs hit SWR and respond instantly.
if (typeof window === "undefined") {
  // Small delay so we don't compete with Next.js's own startup work.
  setTimeout(() => {
    refreshServicesCache().catch(() => { /* upstream may be down at boot */ });
  }, 500);
}

// Skeleton placeholder used while the first real fetch is still in flight.
// 10 cards in a loading state — the UI shows the chrome and a skeleton row
// instead of blocking on a ~16s cold-start service fetch. The next poll or
// SSE event (within seconds) will replace this with real data.
function buildLoadingPlaceholder() {
  const names = ["radarr","sonarr","bazarr","tautulli","qbittorrent","overseerr","pihole","prowlarr","nginx","uptimekuma"];
  return {
    services: names.map(name => ({
      name, up: true, configured: true, lines: ["loading…"],
    })),
    timestamp: Date.now(),
    loading: true,
  };
}

export async function GET() {
  const now = Date.now();

  if (servicesCache) {
    const age = now - servicesCache.ts;
    // Fresh: serve cached data, no upstream work.
    if (age < CACHE_TTL) {
      return NextResponse.json(servicesCache.data);
    }
    // Stale but within SWR window: serve cached data immediately, kick off
    // a background refresh (deduped via the backgroundRefresh promise).
    if (age < STALE_WHILE_REVALIDATE_MS) {
      if (!backgroundRefresh) {
        backgroundRefresh = refreshServicesCache()
          .catch(() => { /* leave existing cache untouched */ })
          .finally(() => { backgroundRefresh = null; });
      }
      return NextResponse.json(servicesCache.data);
    }
  }

  // Cold start with no cache at all — return a loading placeholder
  // immediately so the UI renders fast, and kick off a real fetch in the
  // background. The next poll (3-30s later) will see populated data.
  if (!backgroundRefresh) {
    backgroundRefresh = refreshServicesCache()
      .catch(() => { /* ignore */ })
      .finally(() => { backgroundRefresh = null; });
  }
  return NextResponse.json(buildLoadingPlaceholder());
}
