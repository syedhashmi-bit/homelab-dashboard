import { NextResponse } from "next/server";

interface QueueItem { title: string; pct: number }
interface Stream    { title: string; user: string; progress: number; posStr: string }

interface ServiceResult {
  name: string;
  up: boolean;
  lines: string[];
  pct?: number;
  downCount?: number;
  queueItem?: QueueItem | null;
  streams?: Stream[];
}

let servicesCache: { data: { services: ServiceResult[]; timestamp: number }; ts: number } | null = null;
const CACHE_TTL = 10_000;

let piholeSession: { sid: string; expiry: number } | null = null;

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";

function fmtMB(b: number): string {
  if (b === 0) return "0 B";
  if (b < 1e6) return `${(b/1e3).toFixed(0)} KB`;
  if (b < 1e9) return `${(b/1e6).toFixed(0)} MB`;
  return `${(b/1e9).toFixed(1)} GB`;
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

// Returns true if the server at baseUrl responds to any HTTP request (even 4xx/5xx)
async function checkReachable(baseUrl: string): Promise<boolean> {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(3000), next: { revalidate: 0 } });
    return true;
  } catch {
    return false;
  }
}

async function radarr(): Promise<ServiceResult> {
  const KEY = process.env.RADARR_API_KEY ?? "";
  const BASE = `http://${TRUENAS_IP}:30025`;
  try {
    const [moviesData, queueData] = await Promise.all([
      apiFetch(`${BASE}/api/v3/movie?apiKey=${KEY}`) as Promise<{ hasFile: boolean; monitored: boolean }[]>,
      apiFetch(`${BASE}/api/v3/queue?apiKey=${KEY}&pageSize=1`) as Promise<{
        totalRecords: number;
        records: { title: string; size: number; sizeleft: number }[];
      }>,
    ]);
    const total   = moviesData.length;
    const missing = moviesData.filter(m => !m.hasFile && m.monitored).length;
    const pct     = total > 0 ? Math.round(((total - missing) / total) * 100) : 100;
    const qFirst  = queueData.records?.[0];
    const queueItem: QueueItem | null = qFirst
      ? { title: qFirst.title, pct: qFirst.size > 0 ? Math.round(((qFirst.size - qFirst.sizeleft) / qFirst.size) * 100) : 0 }
      : null;
    const lines = [`${total} movies · ${missing} missing`];
    if ((queueData.totalRecords ?? 0) > 0) lines.push(`${queueData.totalRecords} in queue`);
    return { name: "radarr", up: true, pct, queueItem, lines };
  } catch {
    const up = await checkReachable(BASE);
    return { name: "radarr", up, lines: up ? ["—"] : [] };
  }
}

async function sonarr(): Promise<ServiceResult> {
  const KEY = process.env.SONARR_API_KEY ?? "";
  const BASE = `http://${TRUENAS_IP}:33027`;
  try {
    const [seriesData, wantedData, queueData] = await Promise.all([
      apiFetch(`${BASE}/api/v3/series?apiKey=${KEY}`) as Promise<{ monitored: boolean }[]>,
      apiFetch(`${BASE}/api/v3/wanted/missing?apiKey=${KEY}&pageSize=1`) as Promise<{ totalRecords: number }>,
      apiFetch(`${BASE}/api/v3/queue?apiKey=${KEY}&pageSize=1`) as Promise<{
        totalRecords: number;
        records: { title: string; size: number; sizeleft: number }[];
      }>,
    ]);
    const total   = seriesData.length;
    const missing = wantedData.totalRecords ?? 0;
    const qFirst  = queueData.records?.[0];
    const queueItem: QueueItem | null = qFirst
      ? { title: qFirst.title, pct: qFirst.size > 0 ? Math.round(((qFirst.size - qFirst.sizeleft) / qFirst.size) * 100) : 0 }
      : null;
    const lines = [`${total} series · ${missing} missing eps`];
    if ((queueData.totalRecords ?? 0) > 0) lines.push(`${queueData.totalRecords} in queue`);
    return { name: "sonarr", up: true, lines, queueItem };
  } catch {
    const up = await checkReachable(BASE);
    return { name: "sonarr", up, lines: up ? ["—"] : [] };
  }
}

async function bazarr(): Promise<ServiceResult> {
  const KEY = process.env.BAZARR_API_KEY ?? "";
  const BASE_URL = `http://${TRUENAS_IP}:30046`;
  const HEADERS = { "X-API-KEY": KEY };

  try {
    const [epData, mvData] = await Promise.all([
      apiFetch(`${BASE_URL}/api/episodes/wanted?start=0&length=1`, HEADERS) as Promise<{ total?: number }>,
      apiFetch(`${BASE_URL}/api/movies/wanted?start=0&length=1`, HEADERS) as Promise<{ total?: number }>,
    ]);
    const epMissing = epData.total ?? 0;
    const mvMissing = mvData.total ?? 0;
    return { name: "bazarr", up: true, lines: [`${epMissing} missing ep subs · ${mvMissing} missing movie subs`] };
  } catch {
    const up = await checkReachable(BASE_URL);
    return { name: "bazarr", up, lines: up ? ["—"] : [] };
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

async function tautulli(): Promise<ServiceResult> {
  const KEY = process.env.TAUTULLI_API_KEY ?? "";
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:30047/api/v2?apikey=${KEY}&cmd=get_activity`
    ) as { response: { data: { stream_count: string; sessions?: TautulliSession[] } } };
    const count    = parseInt(data?.response?.data?.stream_count ?? "0", 10);
    const sessions = data?.response?.data?.sessions ?? [];
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
    return {
      name: "tautulli", up: true,
      lines: [count > 0 ? `${count} active stream${count !== 1 ? "s" : ""}` : "no active streams"],
      streams,
    };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:30047`);
    return { name: "tautulli", up, lines: up ? ["—"] : [] };
  }
}

async function qbittorrent(): Promise<ServiceResult> {
  const BASE = `http://${TRUENAS_IP}:30024`;

  function buildResult(data: { state: string; dlspeed?: number; size?: number }[]): ServiceResult {
    const downloading  = data.filter(t =>
      t.state === "downloading" || t.state === "forcedDL" || t.state === "stalledDL"
    ).length;
    const seeding      = data.filter(t =>
      t.state === "uploading" || t.state === "forcedUP" || t.state === "stalledUP"
    ).length;
    const totalDlSpeed = data.reduce((s, t) => s + (t.dlspeed ?? 0), 0);
    const lines = [`${downloading} downloading · ${seeding} seeding`];
    if (totalDlSpeed > 1000) lines.push(`↓ ${fmtMB(totalDlSpeed)}/s`);
    return { name: "qbittorrent", up: true, lines };
  }

  try {
    const loginRes = await fetch(`${BASE}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": BASE,
      },
      body: new URLSearchParams({
        username: process.env.QBIT_USERNAME ?? "",
        password: process.env.QBIT_PASSWORD ?? "",
      }).toString(),
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 0 },
    });
    const setCookie = loginRes.headers.get("set-cookie");
    const sid = setCookie?.match(/SID=([^;]+)/)?.[1];
    console.log("qbit SID:", sid);
    if (!sid) throw new Error("no SID cookie in login response");

    const torrentsRes = await fetch(`${BASE}/api/v2/torrents/info`, {
      headers: {
        "Cookie": `SID=${sid}`,
        "Referer": BASE,
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 0 },
    });
    console.log("qbit torrents status:", torrentsRes.status);
    if (!torrentsRes.ok) throw new Error(`torrents HTTP ${torrentsRes.status}`);
    const torrents = await torrentsRes.json() as { state: string; dlspeed?: number; size?: number }[];
    return buildResult(torrents);
  } catch {
    const up = await checkReachable(`${BASE}/api/v2/app/version`);
    return { name: "qbittorrent", up, lines: up ? ["—"] : [] };
  }
}

async function overseerr(): Promise<ServiceResult> {
  const KEY = process.env.OVERSEERR_API_KEY ?? "";
  try {
    const [pendingData, approvedData, availableData] = await Promise.all([
      apiFetch(`http://${TRUENAS_IP}:30002/api/v1/request?take=1&skip=0&filter=pending`, { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
      apiFetch(`http://${TRUENAS_IP}:30002/api/v1/request?take=1&skip=0&filter=approved`, { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
      apiFetch(`http://${TRUENAS_IP}:30002/api/v1/request?take=1&skip=0&filter=available`, { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
    ]);
    const pending   = pendingData.pageInfo?.results ?? 0;
    const approved  = approvedData.pageInfo?.results ?? 0;
    const available = availableData.pageInfo?.results ?? 0;
    const lines = [`${pending} pending · ${approved} approved`];
    if (available > 0) lines.push(`${available} available`);
    return { name: "overseerr", up: true, lines };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:30002`);
    return { name: "overseerr", up, lines: up ? ["—"] : [] };
  }
}

async function pihole(): Promise<ServiceResult> {
  const BASE = `http://${TRUENAS_IP}:20720`;

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
    return {
      name: "pihole", up: true, lines: [
        `${total.toLocaleString()} queries today`,
        `${blocked.toLocaleString()} blocked (${pct}%)`,
        `${gravity.toLocaleString()} domains in gravity`,
      ],
    };
  } catch {
    piholeSession = null;
    const up = await checkReachable(BASE);
    return { name: "pihole", up, lines: up ? ["—"] : [] };
  }
}

async function prowlarr(): Promise<ServiceResult> {
  const KEY = process.env.PROWLARR_API_KEY ?? "";
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:30050/api/v1/indexerstats?apikey=${KEY}`
    ) as { indexers?: { numberOfGrabs?: number; numberOfQueries?: number }[] };
    const indexers = data.indexers ?? [];
    const grabs    = indexers.reduce((s, i) => s + (i.numberOfGrabs   ?? 0), 0);
    const queries  = indexers.reduce((s, i) => s + (i.numberOfQueries ?? 0), 0);
    return { name: "prowlarr", up: true, lines: [`${indexers.length} indexers · ${grabs} grabs · ${queries} queries`] };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:30050`);
    return { name: "prowlarr", up, lines: up ? ["—"] : [] };
  }
}

async function uptimeKuma(): Promise<ServiceResult> {
  const BASE = `http://${TRUENAS_IP}:31050`;

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
    return { name: "uptimekuma", up: true, lines: [line], downCount };
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
        return { name: "uptimekuma", up: true, lines: [line], downCount };
      }
    }
  } catch { /* fall through */ }

  const up = await checkReachable(BASE);
  return { name: "uptimekuma", up, lines: up ? ["online"] : [] };
}

async function nginxProxy(): Promise<ServiceResult> {
  const BASE = `http://${TRUENAS_IP}:30020`;
  try {
    const tokenRes = await fetch(`${BASE}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: process.env.NGINX_USERNAME ?? "",
        secret:   process.env.NGINX_PASSWORD ?? "",
      }),
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
    return { name: "nginx", up: true, lines };
  } catch {
    const up = await checkReachable(BASE);
    return { name: "nginx", up, lines: up ? ["—"] : [] };
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
    r.status === "fulfilled" ? r.value : { name: names[i], up: false, lines: [] }
  );

  const data = { services: results, timestamp: Date.now() };
  servicesCache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
