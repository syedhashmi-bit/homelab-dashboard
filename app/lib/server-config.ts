// ── server-side config resolver ─────────────────────────────────────────────
// Single source of truth for "what URL / API key / password should we use for
// service X right now?". Merges three layers:
//
//   1. data/config.json  ← written by the /setup wizard via POST /api/config
//   2. process.env.*     ← set via docker run -e
//   3. baked-in defaults
//
// Higher tiers override lower. The wizard's "Save & apply" path writes layer 1
// without restarting the container; the next request through any of the routes
// picks up the change because we re-read the file every CACHE_TTL ms.
//
// IMPORTANT: this file is server-only. Never import it from page.tsx or any
// "use client" module — it touches Node fs and would break the bundle.

import { promises as fs } from "node:fs";
import path from "node:path";

const CONFIG_PATH = process.env.CONFIG_PATH ?? path.join(process.cwd(), "data", "config.json");
const CACHE_TTL   = 5_000;

// ── public types ──────────────────────────────────────────────────────────

export interface ServiceCreds {
  url:        string;
  apiKey?:    string;
  username?:  string;
  password?:  string;
  configured: boolean;
  envVar?:    string[];   // names of missing env vars when configured=false
}

export interface ResolvedConfig {
  truenasIp: string;
  mikrotik: {
    url:        string;
    username:   string;
    password:   string;
    configured: boolean;
    envVar?:    string[];
  };
  services: {
    radarr:      ServiceCreds;
    sonarr:      ServiceCreds;
    bazarr:      ServiceCreds;
    tautulli:    ServiceCreds;
    qbittorrent: ServiceCreds;
    overseerr:   ServiceCreds;
    pihole:      ServiceCreds;
    prowlarr:    ServiceCreds;
    nginx:       ServiceCreds;
    uptimekuma:  ServiceCreds;
    speedtest:   ServiceCreds;
  };
  grafana: {
    baseUrl:        string;
    dashboardUid?:  string;
    datasourceUid?: string;
    panelId:        string;
    dashboardSlug:  string;
  };
  prometheusUrl: string;
  fsPathPrefix:  string;
  poolPath:      string;
  netExclude:    string;
  weather:       { lat: string; lon: string };
  preferences: {
    searchEngine: string;   // "google" | "bing" | "duckduckgo" | "kagi"
    timezone:     string;   // IANA timezone (e.g. "Australia/Hobart"), "" = browser local
  };
}

export type ServiceName = keyof ResolvedConfig["services"];

export interface PartialFileConfig {
  truenasIp?: string;
  mikrotik?: { url?: string; username?: string; password?: string };
  services?: Partial<Record<ServiceName, { url?: string; apiKey?: string; username?: string; password?: string }>>;
  grafana?:  { baseUrl?: string; dashboardUid?: string; datasourceUid?: string; panelId?: string; dashboardSlug?: string };
  preferences?: { searchEngine?: string; timezone?: string };
}

// ── service manifest ──────────────────────────────────────────────────────

interface ServiceManifest {
  name:        ServiceName;
  defaultPort: number;
  envUrl:      string;
  authShape:   "apikey" | "userpass" | "password" | "bearer";
  envApiKey?:  string;
  envUsername?: string;
  envPassword?: string;
  // For bearer auth (e.g. uptimekuma) the API key is optional — the route
  // has a no-auth fallback. Mark these as always-configured.
  optionalAuth?: boolean;
}

const MANIFEST: ServiceManifest[] = [
  { name: "radarr",      defaultPort: 30025, envUrl: "RADARR_URL",      authShape: "apikey",   envApiKey:   "RADARR_API_KEY" },
  { name: "sonarr",      defaultPort: 33027, envUrl: "SONARR_URL",      authShape: "apikey",   envApiKey:   "SONARR_API_KEY" },
  { name: "bazarr",      defaultPort: 30046, envUrl: "BAZARR_URL",      authShape: "apikey",   envApiKey:   "BAZARR_API_KEY" },
  { name: "tautulli",    defaultPort: 30047, envUrl: "TAUTULLI_URL",    authShape: "apikey",   envApiKey:   "TAUTULLI_API_KEY" },
  { name: "qbittorrent", defaultPort: 30024, envUrl: "QBIT_URL",        authShape: "userpass", envUsername: "QBIT_USERNAME", envPassword: "QBIT_PASSWORD" },
  { name: "overseerr",   defaultPort: 30002, envUrl: "OVERSEERR_URL",   authShape: "apikey",   envApiKey:   "OVERSEERR_API_KEY" },
  { name: "pihole",      defaultPort: 20720, envUrl: "PIHOLE_URL",      authShape: "password", envPassword: "PIHOLE_PASSWORD" },
  { name: "prowlarr",    defaultPort: 30050, envUrl: "PROWLARR_URL",    authShape: "apikey",   envApiKey:   "PROWLARR_API_KEY" },
  { name: "nginx",       defaultPort: 30020, envUrl: "NGINX_URL",       authShape: "userpass", envUsername: "NGINX_USERNAME", envPassword: "NGINX_PASSWORD" },
  { name: "uptimekuma",  defaultPort: 31050, envUrl: "UPTIME_KUMA_URL", authShape: "bearer",   envApiKey:   "UPTIME_KUMA_API_KEY", optionalAuth: true },
  { name: "speedtest",   defaultPort: 30220, envUrl: "SPEEDTEST_URL",   authShape: "bearer",   envApiKey:   "SPEEDTEST_API_KEY" },
];

// ── file IO ──────────────────────────────────────────────────────────────

let fileCache: { data: PartialFileConfig | null; ts: number } | null = null;

async function readConfigFile(): Promise<PartialFileConfig | null> {
  if (fileCache && Date.now() - fileCache.ts < CACHE_TTL) return fileCache.data;
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as PartialFileConfig;
    fileCache = { data: parsed, ts: Date.now() };
    return parsed;
  } catch {
    fileCache = { data: null, ts: Date.now() };
    return null;
  }
}

export async function writeConfigFile(config: PartialFileConfig): Promise<{ ok: boolean; message: string }> {
  // Ensure target dir exists, atomic write via temp file.
  const dir = path.dirname(CONFIG_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    return { ok: false, message: `Could not create ${dir}: ${(e as Error).message}` };
  }
  const tmp = `${CONFIG_PATH}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, CONFIG_PATH);
    fileCache = null; // invalidate read cache so next request sees the new values
    return { ok: true, message: `Saved to ${CONFIG_PATH}` };
  } catch (e) {
    return { ok: false, message: `Could not write ${CONFIG_PATH}: ${(e as Error).message}. Mount a writable volume at ${dir} to enable Save & apply.` };
  }
}

// ── resolver ─────────────────────────────────────────────────────────────

function pick<T>(file: T | undefined, env: T | undefined, fallback: T): T {
  if (file !== undefined && file !== null && file !== "") return file;
  if (env  !== undefined && env  !== null && env  !== "") return env;
  return fallback;
}

function resolveService(m: ServiceManifest, file: PartialFileConfig | null, truenasIp: string): ServiceCreds {
  const fromFile = file?.services?.[m.name] ?? {};
  const url      = pick(fromFile.url,      process.env[m.envUrl], `http://${truenasIp}:${m.defaultPort}`);
  const apiKey   = m.envApiKey   ? pick(fromFile.apiKey,   process.env[m.envApiKey],   "") : undefined;
  const username = m.envUsername ? pick(fromFile.username, process.env[m.envUsername], "") : undefined;
  const password = m.envPassword ? pick(fromFile.password, process.env[m.envPassword], "") : undefined;

  // Determine "configured" — every required credential must have a non-empty value.
  // Bearer-auth services (uptimekuma) are marked optional — they have no-auth fallbacks.
  const required: string[] = [];
  if (m.authShape === "apikey" || (m.authShape === "bearer" && !m.optionalAuth)) {
    if (!apiKey) required.push(m.envApiKey!);
  } else if (m.authShape === "userpass") {
    if (!username) required.push(m.envUsername!);
    if (!password) required.push(m.envPassword!);
  } else if (m.authShape === "password") {
    if (!password) required.push(m.envPassword!);
  }
  return {
    url,
    apiKey, username, password,
    configured: m.optionalAuth ? true : required.length === 0,
    envVar: required.length > 0 ? required : undefined,
  };
}

let resolvedCache: { data: ResolvedConfig; ts: number } | null = null;

export async function loadConfig(): Promise<ResolvedConfig> {
  if (resolvedCache && Date.now() - resolvedCache.ts < CACHE_TTL) return resolvedCache.data;

  const file      = await readConfigFile();
  const truenasIp = pick(file?.truenasIp, process.env.TRUENAS_IP, "192.168.88.196");

  const services = Object.fromEntries(
    MANIFEST.map(m => [m.name, resolveService(m, file, truenasIp)])
  ) as ResolvedConfig["services"];

  const mikrotikUrl      = pick(file?.mikrotik?.url,      process.env.MIKROTIK_URL,      "http://192.168.88.1");
  const mikrotikUsername = pick(file?.mikrotik?.username, process.env.MIKROTIK_USERNAME, "");
  const mikrotikPassword = pick(file?.mikrotik?.password, process.env.MIKROTIK_PASSWORD, "");
  const mikrotikRequired: string[] = [];
  if (!mikrotikUsername) mikrotikRequired.push("MIKROTIK_USERNAME");
  if (!mikrotikPassword) mikrotikRequired.push("MIKROTIK_PASSWORD");

  const config: ResolvedConfig = {
    truenasIp,
    mikrotik: {
      url:      mikrotikUrl,
      username: mikrotikUsername,
      password: mikrotikPassword,
      configured: mikrotikRequired.length === 0,
      envVar: mikrotikRequired.length > 0 ? mikrotikRequired : undefined,
    },
    services,
    grafana: {
      baseUrl:        pick(file?.grafana?.baseUrl,        process.env.GRAFANA_BASE_URL,        `http://${truenasIp}:30037`),
      dashboardUid:   pick(file?.grafana?.dashboardUid,   process.env.GRAFANA_DASHBOARD_UID,   "") || undefined,
      datasourceUid:  pick(file?.grafana?.datasourceUid,  process.env.GRAFANA_DATASOURCE_UID,  "") || undefined,
      panelId:        pick(file?.grafana?.panelId,        process.env.GRAFANA_PANEL_ID,        "panel-77"),
      dashboardSlug:  pick(file?.grafana?.dashboardSlug,  process.env.GRAFANA_DASHBOARD_SLUG,  "node-exporter-full"),
    },
    prometheusUrl: pick(undefined, process.env.PROMETHEUS_URL, `http://${truenasIp}:30104`),
    fsPathPrefix:  pick(undefined, process.env.FS_PATH_PREFIX, "/mnt/Pool/Media/"),
    poolPath:      pick(undefined, process.env.POOL_PATH,      "/mnt/Pool"),
    netExclude:    pick(undefined, process.env.NETWORK_DEVICE_EXCLUDE, "lo|veth.*|docker.*|br.*"),
    weather: {
      lat: pick(undefined, process.env.WEATHER_LAT, "-41.4419"),
      lon: pick(undefined, process.env.WEATHER_LON, "147.1450"),
    },
    preferences: {
      searchEngine: pick(file?.preferences?.searchEngine, process.env.SEARCH_ENGINE, "google"),
      timezone:     pick(file?.preferences?.timezone,     process.env.TIMEZONE,       ""),
    },
  };

  resolvedCache = { data: config, ts: Date.now() };
  return config;
}

// Force a fresh resolve on the next call — used by POST /api/config after a write.
export function invalidateConfigCache(): void {
  resolvedCache = null;
  fileCache = null;
}

// Helper for /api/config GET to know whether the file is writable, so the
// wizard can disable "Save & apply" with a friendly message.
export async function isConfigWritable(): Promise<boolean> {
  const dir = path.dirname(CONFIG_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
    // Touch a probe file
    const probe = path.join(dir, ".write-probe");
    await fs.writeFile(probe, "");
    await fs.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

export const CONFIG_FILE_PATH = CONFIG_PATH;
