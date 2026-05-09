import { NextResponse } from "next/server";

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
}

// Helper: build a "needs configuration" placeholder result.
function unconfigured(name: string, envVar: string[]): ServiceResult {
  return { name, up: false, configured: false, envVar, lines: [] };
}

let servicesCache: { data: { services: ServiceResult[]; timestamp: number }; ts: number } | null = null;
// Slightly under the client poll interval (3s) so each poll gets fresh data
// without forcing the upstream services through duplicate work on adjacent ticks.
const CACHE_TTL = 2_500;

let piholeSession: { sid: string; expiry: number } | null = null;

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";

// Per-service base URLs. Default to ${TRUENAS_IP}:<standard-port> for back-compat
// with the original deployment. Override any of these at deploy time if your
// services live elsewhere or use non-standard ports.
const RADARR_URL      = process.env.RADARR_URL      ?? `http://${TRUENAS_IP}:30025`;
const SONARR_URL      = process.env.SONARR_URL      ?? `http://${TRUENAS_IP}:33027`;
const BAZARR_URL      = process.env.BAZARR_URL      ?? `http://${TRUENAS_IP}:30046`;
const TAUTULLI_URL    = process.env.TAUTULLI_URL    ?? `http://${TRUENAS_IP}:30047`;
const QBIT_URL        = process.env.QBIT_URL        ?? `http://${TRUENAS_IP}:30024`;
const OVERSEERR_URL   = process.env.OVERSEERR_URL   ?? `http://${TRUENAS_IP}:30002`;
const PIHOLE_URL      = process.env.PIHOLE_URL      ?? `http://${TRUENAS_IP}:20720`;
const PROWLARR_URL    = process.env.PROWLARR_URL    ?? `http://${TRUENAS_IP}:30050`;
const NGINX_URL       = process.env.NGINX_URL       ?? `http://${TRUENAS_IP}:30020`;
const UPTIME_KUMA_URL = process.env.UPTIME_KUMA_URL ?? `http://${TRUENAS_IP}:31050`;

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

async function apiFetch(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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

// Returns true if the server at baseUrl responds to any HTTP request (even 4xx/5xx)
async function checkReachable(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(3000), next: { revalidate: 0 } });
    return true;
  } catch {
    return false;
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

async function radarr(): Promise<ServiceResult> {
  const KEY = process.env.RADARR_API_KEY ?? "";
  const BASE = RADARR_URL;
  if (!KEY) return unconfigured("radarr", ["RADARR_API_KEY"]);
  try {
    // Primary call (movies) is required. The rest are enrichment — failures don't sink the card.
    const moviesData = await apiFetch(`${BASE}/api/v3/movie?apiKey=${KEY}`) as RadarrMovie[];
    const [queueData, cutoffData, healthData] = await Promise.all([
      apiFetchOpt(`${BASE}/api/v3/queue?apiKey=${KEY}&pageSize=3&sortKey=timeleft&includeUnknownMovieItems=false`) as Promise<{
        totalRecords: number;
        records: ArrQueueRecord[];
      } | null>,
      apiFetchOpt(`${BASE}/api/v3/wanted/cutoff?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords?: number } | null>,
      apiFetchOpt(`${BASE}/api/v3/health?apiKey=${KEY}`) as Promise<ArrHealthRecord[] | null>,
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
  } catch {
    const up = await checkReachable(BASE);
    return { name: "radarr", up, configured: true, url: BASE, lines: up ? ["—"] : [] };
  }
}

interface SonarrSeries {
  monitored: boolean;
  statistics?: { sizeOnDisk?: number; episodeFileCount?: number; episodeCount?: number };
}
async function sonarr(): Promise<ServiceResult> {
  const KEY = process.env.SONARR_API_KEY ?? "";
  const BASE = SONARR_URL;
  if (!KEY) return unconfigured("sonarr", ["SONARR_API_KEY"]);
  try {
    // Series request must succeed; rest are enrichment.
    const seriesData = await apiFetch(
      `${BASE}/api/v3/series?apiKey=${KEY}&includeSeasonImages=false`
    ) as SonarrSeries[];
    const [wantedData, queueData, cutoffData, healthData] = await Promise.all([
      apiFetchOpt(`${BASE}/api/v3/wanted/missing?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords?: number } | null>,
      apiFetchOpt(`${BASE}/api/v3/queue?apiKey=${KEY}&pageSize=3&sortKey=timeleft&includeUnknownSeriesItems=false`) as Promise<{
        totalRecords: number;
        records: ArrQueueRecord[];
      } | null>,
      apiFetchOpt(`${BASE}/api/v3/wanted/cutoff?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords?: number } | null>,
      apiFetchOpt(`${BASE}/api/v3/health?apiKey=${KEY}`) as Promise<ArrHealthRecord[] | null>,
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
  } catch {
    const up = await checkReachable(BASE);
    return { name: "sonarr", up, configured: true, url: BASE, lines: up ? ["—"] : [] };
  }
}

async function bazarr(): Promise<ServiceResult> {
  const KEY = process.env.BAZARR_API_KEY ?? "";
  const BASE_URL = BAZARR_URL;
  if (!KEY) return unconfigured("bazarr", ["BAZARR_API_KEY"]);
  const HEADERS = { "X-API-KEY": KEY };

  try {
    const [epData, mvData] = await Promise.all([
      apiFetch(`${BASE_URL}/api/episodes/wanted?start=0&length=1`, HEADERS) as Promise<{ total?: number }>,
      apiFetch(`${BASE_URL}/api/movies/wanted?start=0&length=1`, HEADERS) as Promise<{ total?: number }>,
    ]);
    const epMissing = epData.total ?? 0;
    const mvMissing = mvData.total ?? 0;
    return { name: "bazarr", up: true, configured: true, url: BASE_URL, lines: [`${epMissing} missing ep subs · ${mvMissing} missing movie subs`] };
  } catch {
    const up = await checkReachable(BASE_URL);
    return { name: "bazarr", up, configured: true, url: BASE_URL, lines: up ? ["—"] : [] };
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
async function tautulli(): Promise<ServiceResult> {
  const KEY = process.env.TAUTULLI_API_KEY ?? "";
  const BASE = `${TAUTULLI_URL}/api/v2`;
  if (!KEY) return unconfigured("tautulli", ["TAUTULLI_API_KEY"]);
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
        name: "tautulli", up: true, configured: true, url: TAUTULLI_URL,
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
      name: "tautulli", up: true, configured: true, url: TAUTULLI_URL, lines, streams,
      weekly: (playsWk != null || topShow || topUser)
        ? { plays: typeof playsWk === "number" ? playsWk : undefined, topShow, topUser }
        : undefined,
    };
  } catch {
    const up = await checkReachable(TAUTULLI_URL);
    return { name: "tautulli", up, configured: true, url: TAUTULLI_URL, lines: up ? ["—"] : [] };
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

async function qbittorrent(): Promise<ServiceResult> {
  const BASE = QBIT_URL;
  const USER = process.env.QBIT_USERNAME ?? "";
  const PASS = process.env.QBIT_PASSWORD ?? "";
  if (!USER || !PASS) return unconfigured("qbittorrent", ["QBIT_USERNAME", "QBIT_PASSWORD"]);
  try {
    const loginRes = await fetch(`${BASE}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": BASE,
      },
      body: new URLSearchParams({ username: USER, password: PASS }).toString(),
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 0 },
    });
    const setCookie = loginRes.headers.get("set-cookie");
    const sid = setCookie?.match(/SID=([^;]+)/)?.[1];
    if (!sid) throw new Error("no SID cookie in login response");

    const torrentsRes = await fetch(`${BASE}/api/v2/torrents/info`, {
      headers: { "Cookie": `SID=${sid}`, "Referer": BASE },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 0 },
    });
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
  } catch {
    const up = await checkReachable(`${BASE}/api/v2/app/version`);
    return { name: "qbittorrent", up, configured: true, url: BASE, lines: up ? ["—"] : [] };
  }
}

async function overseerr(): Promise<ServiceResult> {
  const KEY = process.env.OVERSEERR_API_KEY ?? "";
  if (!KEY) return unconfigured("overseerr", ["OVERSEERR_API_KEY"]);
  try {
    const [pendingData, approvedData, availableData] = await Promise.all([
      apiFetch(`${OVERSEERR_URL}/api/v1/request?take=1&skip=0&filter=pending`,   { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
      apiFetch(`${OVERSEERR_URL}/api/v1/request?take=1&skip=0&filter=approved`,  { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
      apiFetch(`${OVERSEERR_URL}/api/v1/request?take=1&skip=0&filter=available`, { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
    ]);
    const pending   = pendingData.pageInfo?.results ?? 0;
    const approved  = approvedData.pageInfo?.results ?? 0;
    const available = availableData.pageInfo?.results ?? 0;
    const lines = [`${pending} pending · ${approved} approved`];
    if (available > 0) lines.push(`${available} available`);
    return { name: "overseerr", up: true, configured: true, url: OVERSEERR_URL, lines };
  } catch {
    const up = await checkReachable(OVERSEERR_URL);
    return { name: "overseerr", up, configured: true, url: OVERSEERR_URL, lines: up ? ["—"] : [] };
  }
}

async function pihole(): Promise<ServiceResult> {
  const BASE = PIHOLE_URL;
  if (!process.env.PIHOLE_PASSWORD) return unconfigured("pihole", ["PIHOLE_PASSWORD"]);

  async function getSid(): Promise<string> {
    const now = Date.now();
    if (piholeSession && now < piholeSession.expiry) return piholeSession.sid;
    const authRes = await fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.PIHOLE_PASSWORD ?? "" }),
      signal: AbortSignal.timeout(5000),
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
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return null;
      return await r.json() as T;
    } catch { return null; }
  }

  try {
    const sid = await getSid();
    const statsRes = await fetch(`${BASE}/api/stats/summary`, {
      headers: { sid },
      signal: AbortSignal.timeout(5000),
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

async function prowlarr(): Promise<ServiceResult> {
  const KEY  = process.env.PROWLARR_API_KEY ?? "";
  const BASE = PROWLARR_URL;
  if (!KEY) return unconfigured("prowlarr", ["PROWLARR_API_KEY"]);
  try {
    const [stats, healthData] = await Promise.all([
      apiFetch(`${BASE}/api/v1/indexerstats?apikey=${KEY}`) as Promise<{
        indexers?: { numberOfGrabs?: number; numberOfQueries?: number }[];
      }>,
      apiFetchOpt(`${BASE}/api/v1/health?apikey=${KEY}`) as Promise<ArrHealthRecord[] | null>,
    ]);
    const indexers = stats.indexers ?? [];
    const grabs    = indexers.reduce((s, i) => s + (i.numberOfGrabs   ?? 0), 0);
    const queries  = indexers.reduce((s, i) => s + (i.numberOfQueries ?? 0), 0);
    return {
      name: "prowlarr", up: true, configured: true, url: BASE,
      lines: [`${indexers.length} indexers · ${grabs} grabs · ${queries} queries`],
      health: summarizeHealth(healthData),
    };
  } catch {
    const up = await checkReachable(BASE);
    return { name: "prowlarr", up, configured: true, url: BASE, lines: up ? ["—"] : [] };
  }
}

async function uptimeKuma(): Promise<ServiceResult> {
  const BASE = UPTIME_KUMA_URL;

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

  const AUTH = { Authorization: `Bearer ${process.env.UPTIME_KUMA_API_KEY ?? ""}` };

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

async function nginxProxy(): Promise<ServiceResult> {
  const BASE = NGINX_URL;
  const USER = process.env.NGINX_USERNAME ?? "";
  const PASS = process.env.NGINX_PASSWORD ?? "";
  if (!USER || !PASS) return unconfigured("nginx", ["NGINX_USERNAME", "NGINX_PASSWORD"]);
  try {
    const tokenRes = await fetch(`${BASE}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: USER, secret: PASS }),
      signal: AbortSignal.timeout(5000),
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

export async function GET() {
  if (servicesCache && Date.now() - servicesCache.ts < CACHE_TTL) {
    return NextResponse.json(servicesCache.data);
  }

  const names = ["radarr","sonarr","bazarr","tautulli","qbittorrent","overseerr","pihole","prowlarr","nginx","uptimekuma"];
  const settled = await Promise.allSettled([
    radarr(), sonarr(), bazarr(), tautulli(),
    qbittorrent(), overseerr(), pihole(), prowlarr(), nginxProxy(), uptimeKuma(),
  ]);
  const results: ServiceResult[] = settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : { name: names[i], up: false, configured: true, lines: [] }
  );

  const data = { services: results, timestamp: Date.now() };
  servicesCache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
