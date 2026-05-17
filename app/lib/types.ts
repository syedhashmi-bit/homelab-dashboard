// ── Shared types ─────────────────────────────────────────────────────────────
// Central type definitions used across components, hooks, and utilities.
// Keep this file free of runtime code — types and interfaces only.

import type { ThemeKey } from "@/app/lib/constants";

export type AlertLevel   = "warning" | "critical" | null;
export type HealthStatus = "healthy" | "warning" | "critical";
export type TempUnit     = "C" | "F";
export type DataUnit     = "decimal" | "binary";
export type SearchEngine = "google" | "bing" | "duckduckgo" | "kagi";

export interface HealthResult { status: HealthStatus; reason: string }

export interface DiskEntry {
  mountpoint: string; device: string; fstype: string;
  total: number; avail: number; used: number; usedPct: number;
}

export interface Metrics {
  cpu: number | null;
  memory: { total: number | null; used: number | null; available: number | null; sReclaimable: number | null };
  uptime: number | null;
  disks: DiskEntry[];
  pool?: { total: number | null; used: number | null; avail: number | null };
  network: {
    rxBytesPerSec: number | null; txBytesPerSec: number | null;
    rxBytesTotal:  number | null; txBytesTotal:  number | null;
    interfaceName?: string | null;
  };
  gpu: {
    name: string | null;
    utilization: number | null;
    memUsed: number | null; memTotal: number | null;
    temperature: number | null;
    powerDraw: number | null; powerLimit: number | null;
    coreClock: number | null;
    memClock:  number | null;
    fanSpeed:  number | null;
    encUtil:   number | null;
    decUtil:   number | null;
  };
  sysInfo?: {
    os: string | null;
    kernel: string | null;
    arch: string | null;
    hostname: string | null;
    cpuCores: number | null;
    cpuModel: string | null;
    cpuFreqGhz: number | null;
    load1: number | null;
    load5: number | null;
    load15: number | null;
    tcpEstab: number | null;
  };
  timestamp: number;
}

export interface Settings {
  refreshInterval: number;       // global default poll interval in seconds
  tempUnit: TempUnit;
  dataUnit: DataUnit;
  visibleCards: Record<string, boolean>;
  searchEngine: SearchEngine;
  timezone: string;              // IANA timezone, "" = browser local
  theme: ThemeKey;
  // Per-endpoint override of refreshInterval. Each key is a number of seconds;
  // omitted/0 means "use refreshInterval". Keeps the single-slider default
  // working while letting power users tune individual endpoints.
  refreshOverrides?: {
    metrics?:  number;
    services?: number;
    mikrotik?: number;
    activity?: number;
  };
}

export interface SpeedtestResult {
  ping:           number | null;
  download:       number | null;
  upload:         number | null;
  created_at:     string | null;
  timestamp:      string | null;
  isp:            string | null;
  jitter:         number | null;
  serverName:     string | null;
  serverLocation: string | null;
  serverHost:     string | null;
}

export interface SpeedtestRaw {
  ping?:           number | null;
  download?:       number | null;
  upload?:         number | null;
  jitter?:         number | null;
  server_name?:    string | null;
  server_host?:    string | null;
  created_at?:     string | null;
  timestamp?:      string | null;
  isp?:            string | null;
  serverLocation?: string | null;
  serverHost?:     string | null;
}

export interface ServiceQueueItem { title: string; pct: number; etaSec?: number | null }
export interface ServiceStream    { title: string; user: string; progress: number; posStr: string }
export interface ServiceHealth    { warning: number; error: number }
export interface ServiceWeekly    { plays?: number; topShow?: string; topUser?: string }
export interface ServiceResult {
  name: string;
  up: boolean;
  configured?: boolean;          // false => required env var(s) missing
  envVar?:     string[];         // names of missing env vars
  url?:        string;           // resolved upstream URL
  lines: string[];
  pct?:        number;
  downCount?:  number;
  queueItem?:  ServiceQueueItem | null;
  queueItems?: ServiceQueueItem[];
  streams?:    ServiceStream[];
  health?:     ServiceHealth;
  weekly?:     ServiceWeekly;
  stale?:      boolean;          // true => cached data from a previous good poll (server-side last-known-good fallback)
  staleSince?: number;           // ms epoch of the last successful fetch when stale=true
  authError?:  boolean;          // true => service responded with 401/403 (wrong/missing API key)
}

export interface ActivityEvent {
  source: "sonarr" | "radarr" | "tautulli";
  type: "grabbed" | "imported" | "watched";
  title: string;
  subtitle?: string;
  timestamp: number;
}

export interface BookmarkColumn {
  title: string;
  accentColor: string;
  items: { name: string; url: string; icon: string }[];
}

export interface ForecastDay {
  date:      string;
  high:      number;
  low:       number;
  code:      number;
  condition: string;
  emoji:     string;
}

export interface ClientConfig {
  truenasIp:    string;
  mikrotikUrl:  string;
  weather: { lat: string; lon: string };
  grafana: {
    baseUrl:        string;
    panelUrl:       string | null;
    dashboardUid?:  string;
    datasourceUid?: string;
    panelId?:       string;
    panels?:        { panelId: string; label: string; size: "sm" | "md" | "lg"; url: string }[];
  };
  serviceUrls:  Record<string, string>;
  bookmarks:    BookmarkColumn[];
  fsPathPrefix: string;
  preferences?: {
    searchEngine: string;
    timezone:     string;
    theme:        string;
  };
  // True when /app/data is writable (POST /api/bookmarks and /api/config will
  // succeed). False on read-only installs — the UI disables save and explains.
  writable?:       boolean;
  writableReason?: string;
  writablePath?:   string;
  dockerEnabled?:    boolean;
  grafanaTokenSet?:  boolean;
}
