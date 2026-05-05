import { NextResponse } from "next/server";

interface ServiceResult {
  name: string;
  up: boolean;
  lines: string[];
  pct?: number;
  downCount?: number;
}

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
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:30025/api/v3/movie?apiKey=***REMOVED***`
    ) as { hasFile: boolean; monitored: boolean }[];
    const total   = data.length;
    const missing = data.filter(m => !m.hasFile && m.monitored).length;
    const pct = total > 0 ? Math.round(((total - missing) / total) * 100) : 100;
    return { name: "radarr", up: true, pct, lines: [`${total} movies · ${missing} missing`, `${pct}% complete`] };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:30025`);
    return { name: "radarr", up, lines: up ? ["—"] : [] };
  }
}

async function sonarr(): Promise<ServiceResult> {
  try {
    const [seriesData, wantedData, queueData] = await Promise.all([
      apiFetch(`http://${TRUENAS_IP}:33027/api/v3/series?apiKey=***REMOVED***`) as Promise<{ monitored: boolean }[]>,
      apiFetch(`http://${TRUENAS_IP}:33027/api/v3/wanted/missing?apiKey=***REMOVED***&pageSize=1`) as Promise<{ totalRecords: number }>,
      apiFetch(`http://${TRUENAS_IP}:33027/api/v3/queue?apiKey=***REMOVED***&pageSize=1`) as Promise<{ totalRecords: number }>,
    ]);
    const total   = seriesData.length;
    const missing = wantedData.totalRecords ?? 0;
    const queue   = queueData.totalRecords ?? 0;
    const lines = [`${total} series · ${missing} missing eps`];
    if (queue > 0) lines.push(`+${queue} downloading`);
    return { name: "sonarr", up: true, lines };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:33027`);
    return { name: "sonarr", up, lines: up ? ["—"] : [] };
  }
}

async function bazarr(): Promise<ServiceResult> {
  try {
    const [epData, mvData] = await Promise.all([
      apiFetch(`http://${TRUENAS_IP}:30046/api/episodes/wanted?apiKey=***REMOVED***&start=0&length=1`) as Promise<{ data: { total: number } }>,
      apiFetch(`http://${TRUENAS_IP}:30046/api/movies/wanted?apiKey=***REMOVED***&start=0&length=1`) as Promise<{ data: { total: number } }>,
    ]);
    const epMissing = epData?.data?.total ?? 0;
    const mvMissing = mvData?.data?.total ?? 0;
    return { name: "bazarr", up: true, lines: [`${epMissing} ep subs · ${mvMissing} movie subs`] };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:30046`);
    return { name: "bazarr", up, lines: up ? ["—"] : [] };
  }
}

async function tautulli(): Promise<ServiceResult> {
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:30047/api/v2?apikey=***REMOVED***&cmd=get_activity`
    ) as { response: { data: { stream_count: string } } };
    const count = parseInt(data?.response?.data?.stream_count ?? "0", 10);
    return { name: "tautulli", up: true, lines: [count > 0 ? `${count} active stream${count !== 1 ? "s" : ""}` : "no active streams"] };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:30047`);
    return { name: "tautulli", up, lines: up ? ["—"] : [] };
  }
}

async function qbittorrent(): Promise<ServiceResult> {
  try {
    const data = await apiFetch(`http://${TRUENAS_IP}:30024/api/v2/torrents/info`) as { state: string; dlspeed?: number; size?: number }[];
    const total      = data.length;
    const dlStates   = new Set(["downloading", "stalledDL", "checkingDL", "pausedDL", "forcedDL", "metaDL"]);
    const seedStates = new Set(["uploading", "stalledUP", "checkingUP", "pausedUP", "forcedUP", "seeding"]);
    const downloading = data.filter(t => dlStates.has(t.state)).length;
    const seeding     = data.filter(t => seedStates.has(t.state)).length;
    const totalSize   = data.reduce((s, t) => s + (t.size ?? 0), 0);
    const totalDlSpeed = data.reduce((s, t) => s + (t.dlspeed ?? 0), 0);
    const lines = [`${total} total · ${downloading} dl · ${seeding} seed`];
    if (totalSize > 0) lines.push(`${fmtMB(totalSize)} total`);
    if (totalDlSpeed > 0) lines.push(`${fmtMB(totalDlSpeed)}/s`);
    return { name: "qbittorrent", up: true, lines };
  } catch {
    // qBittorrent may require auth cookie; check if server responds at all
    const up = await checkReachable(`http://${TRUENAS_IP}:30024/api/v2/app/version`);
    return { name: "qbittorrent", up, lines: up ? ["—"] : [] };
  }
}

async function overseerr(): Promise<ServiceResult> {
  const KEY = "***REMOVED***";
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
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:20720/api/stats/summary`,
      { Authorization: "Bearer ***REMOVED***" }
    ) as {
      queries?: { total?: number; percent_blocked?: number };
      gravity?: { domains_being_blocked?: number };
    };
    const total    = data.queries?.total ?? 0;
    const blocked  = (data.queries?.percent_blocked ?? 0).toFixed(1);
    return { name: "pihole", up: true, lines: [`${total.toLocaleString()} queries · ${blocked}% blocked`] };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:20720`);
    return { name: "pihole", up, lines: up ? ["—"] : [] };
  }
}

async function prowlarr(): Promise<ServiceResult> {
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:30050/api/v1/indexerstats?apikey=***REMOVED***`
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
  try {
    const data = await apiFetch(
      `http://${TRUENAS_IP}:31050/api/status-page/services`,
      { Authorization: "Bearer ***REMOVED***" }
    ) as { monitors?: { status?: number }[] };
    const monitors  = data.monitors ?? [];
    const upCount   = monitors.filter(m => m.status === 1).length;
    const downCount = monitors.filter(m => m.status === 0).length;
    const line      = downCount > 0 ? `${upCount} up · ${downCount} down` : `${upCount} sites up`;
    return { name: "uptimekuma", up: true, lines: [line], downCount };
  } catch {
    const up = await checkReachable(`http://${TRUENAS_IP}:31050`);
    return { name: "uptimekuma", up, lines: up ? ["—"] : [] };
  }
}

async function nginxProxy(): Promise<ServiceResult> {
  const BASE = `http://${TRUENAS_IP}:30020`;
  try {
    const tokenRes = await fetch(`${BASE}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "***REMOVED***", secret: "***REMOVED***" }),
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
  const results = await Promise.all([
    radarr(), sonarr(), bazarr(), tautulli(),
    qbittorrent(), overseerr(), pihole(), prowlarr(), nginxProxy(), uptimeKuma(),
  ]);
  return NextResponse.json({ services: results, timestamp: Date.now() });
}
