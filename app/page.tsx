"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

const MAX_HISTORY = 60;

// ── types ─────────────────────────────────────────────────────────────────────

type AlertLevel   = "warning" | "critical" | null;
type HealthStatus = "healthy" | "warning" | "critical";
type TempUnit     = "C" | "F";
type DataUnit     = "decimal" | "binary";

interface HealthResult { status: HealthStatus; reason: string }

interface DiskEntry {
  mountpoint: string; device: string; fstype: string;
  total: number; avail: number; used: number; usedPct: number;
}

interface Metrics {
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

type SearchEngine = "google" | "bing" | "duckduckgo" | "kagi";
type ThemeKey = "midnight" | "forge" | "forest" | "plum" | "paper";

const THEMES: { key: ThemeKey; label: string; bg: string; brand: string }[] = [
  { key: "midnight", label: "Midnight",  bg: "#0a0c12", brand: "#06b6d4" },
  { key: "forge",    label: "Forge",     bg: "#12100a", brand: "#f59e0b" },
  { key: "forest",   label: "Forest",    bg: "#080f0a", brand: "#10b981" },
  { key: "plum",     label: "Plum",      bg: "#10081a", brand: "#d946ef" },
  { key: "paper",    label: "Paper",     bg: "#f8fafc", brand: "#0284c7" },
];

interface Settings {
  refreshInterval: number;
  tempUnit: TempUnit;
  dataUnit: DataUnit;
  visibleCards: Record<string, boolean>;
  searchEngine: SearchEngine;
  timezone: string; // IANA timezone, "" = browser local
  theme: ThemeKey;
}

interface SpeedtestResult {
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

interface ServiceQueueItem { title: string; pct: number; etaSec?: number | null }
interface ServiceStream    { title: string; user: string; progress: number; posStr: string }
interface ServiceHealth    { warning: number; error: number }
interface ServiceWeekly    { plays?: number; topShow?: string; topUser?: string }
interface ServiceResult {
  name: string;
  up: boolean;
  configured?: boolean;          // false ⇒ required env var(s) missing — card hidden, listed in Connections panel
  envVar?:     string[];         // names of missing env vars
  url?:        string;           // resolved upstream URL (for the Connections panel)
  lines: string[];
  pct?:        number;
  downCount?:  number;
  queueItem?:  ServiceQueueItem | null;
  queueItems?: ServiceQueueItem[];
  streams?:    ServiceStream[];
  health?:     ServiceHealth;
  weekly?:     ServiceWeekly;
}

interface ActivityEvent {
  source: "sonarr" | "radarr" | "tautulli";
  type: "grabbed" | "imported" | "watched";
  title: string;
  subtitle?: string;
  timestamp: number;
}

// Mirrors the shape from /api/config (intentionally NOT imported to keep page.tsx
// independent of server-only modules). Anything in here is safe for the client.
interface BookmarkColumn {
  title: string;
  accentColor: string;
  items: { name: string; url: string; icon: string }[];
}
interface ForecastDay {
  date:      string;
  high:      number;
  low:       number;
  code:      number;
  condition: string;
  emoji:     string;
}

interface ClientConfig {
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
}

// ── module constants ──────────────────────────────────────────────────────────

const SVC_COLORS: Record<string, string> = {
  radarr: "#f5c518", sonarr: "#35c5f4", bazarr: "#4a90d9",
  tautulli: "#e5a00d", qbittorrent: "#2196f3", overseerr: "#e5a00d",
  pihole: "#f60d1a", prowlarr: "#ff8c00", nginx: "#2ecc71",
  uptimekuma: "#5cdd8b",
};
const SVC_ICONS: Record<string, string> = {
  radarr:      "https://www.google.com/s2/favicons?domain=radarr.video&sz=32",
  sonarr:      "https://www.google.com/s2/favicons?domain=sonarr.tv&sz=32",
  bazarr:      "https://www.google.com/s2/favicons?domain=bazarr.media&sz=32",
  tautulli:    "https://www.google.com/s2/favicons?domain=tautulli.com&sz=32",
  qbittorrent: "https://www.google.com/s2/favicons?domain=qbittorrent.org&sz=32",
  overseerr:   "https://www.google.com/s2/favicons?domain=overseerr.dev&sz=32",
  nginx:       "https://www.google.com/s2/favicons?domain=nginxproxymanager.com&sz=32",
  pihole:      "https://www.google.com/s2/favicons?domain=pi-hole.net&sz=32",
  prowlarr:    "https://www.google.com/s2/favicons?domain=prowlarr.com&sz=32",
  uptimekuma:  "https://www.google.com/s2/favicons?domain=uptime.kuma.pet&sz=32",
};
const SVC_URLS: Record<string, string> = {
  radarr:      "http://192.168.88.196:30025",
  sonarr:      "http://192.168.88.196:33027",
  bazarr:      "http://192.168.88.196:30046",
  tautulli:    "http://192.168.88.196:30047",
  qbittorrent: "http://192.168.88.196:30024",
  overseerr:   "http://192.168.88.196:30002",
  nginx:       "http://192.168.88.196:30020",
  pihole:      "http://192.168.88.196:20720",
  prowlarr:    "http://192.168.88.196:30050",
  uptimekuma:  "http://192.168.88.196:31050",
};
const SVC_LABELS: Record<string, string> = {
  qbittorrent: "qBittorrent",
  nginx:       "Nginx Proxy",
  uptimekuma:  "Uptime Kuma",
};

// Service grouping for the services panel. Order within each list = render order.
const SVC_CATEGORIES: { id: string; label: string; accent: string; services: string[] }[] = [
  { id: "media", label: "media stack",   accent: "var(--warn)", services: ["radarr", "sonarr", "bazarr", "tautulli", "qbittorrent", "overseerr", "prowlarr"] },
  { id: "infra", label: "infrastructure", accent: "var(--brand)", services: ["pihole", "nginx", "uptimekuma"] },
];

// Fallback only — used briefly while /api/config is fetching, or if the fetch
// fails. The real bookmark set is loaded at runtime from bookmarks.json (mounted
// at /app/bookmarks.json in Docker, or BOOKMARKS_PATH env var). See
// bookmarks.example.json for the schema.
const BOOKMARKS_FALLBACK: BookmarkColumn[] = [];

// ── client-side data fetching ─────────────────────────────────────────────────

const PROMETHEUS    = "http://192.168.88.196:30104";
const SPEEDTEST_BASE = "http://192.168.88.196:30220";
const WEATHER_URL   = "https://api.open-meteo.com/v1/forecast?latitude=-41.4419&longitude=147.1450&current=temperature_2m,weather_code";
const FS_EXCLUDE    = `fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"`;

const WEATHER_CODES: Record<number, string> = {
  0: "sunny", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "foggy", 48: "foggy",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "showers", 81: "rain showers", 82: "heavy showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm", 99: "heavy thunderstorm",
};

async function queryProm(q: string): Promise<number | null> {
  try {
    const res = await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.data?.result?.[0]?.value?.[1];
    return result != null ? parseFloat(result) : null;
  } catch {
    return null;
  }
}

async function queryPromAll(q: string): Promise<{ metric: Record<string, string>; value: number }[]> {
  try {
    const res = await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.result ?? []).map((r: { metric: Record<string, string>; value: [number, string] }) => ({
      metric: r.metric,
      value:  parseFloat(r.value[1]),
    }));
  } catch {
    return [];
  }
}

interface SpeedtestRaw {
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

function normalizeSpeedResult(r: SpeedtestRaw): SpeedtestResult {
  return {
    ping:           r.ping           ?? null,
    download:       r.download       ?? null,
    upload:         r.upload         ?? null,
    created_at:     r.created_at     ?? r.timestamp ?? null,
    timestamp:      r.timestamp      ?? r.created_at ?? null,
    jitter:         r.jitter         ?? null,
    isp:            r.isp            ?? r.server_name ?? null,
    serverName:     r.server_name    ?? r.isp ?? null,
    serverLocation: r.serverLocation ?? r.server_host ?? null,
    serverHost:     r.serverHost     ?? null,
  };
}

// ── formatters ────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number | null, decimals = 1, unit: DataUnit = "decimal"): string {
  if (bytes === null || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = unit === "binary" ? 1024 : 1000;
  const sizes = unit === "binary" ? ["B","KiB","MiB","GiB","TiB"] : ["B","KB","MB","GB","TB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

function fmtTemp(c: number | null, unit: TempUnit = "C"): string {
  if (c === null) return "—";
  if (unit === "F") return `${((c * 9 / 5) + 32).toFixed(0)}°F`;
  return `${c.toFixed(0)}°C`;
}

function fmtUptime(s: number | null): string {
  if (s === null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSince(s: number | null): string {
  if (s === null) return "—";
  const b = new Date(Date.now() - s * 1000);
  const mo = b.toLocaleDateString(undefined, { month: "short" });
  return `${mo} ${b.getDate()} · ${String(b.getHours()).padStart(2, "0")}:${String(b.getMinutes()).padStart(2, "0")}`;
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

// Compact "time remaining" for queue items. qBit reports 8640000s (~100d)
// to mean "unknown", so we suppress anything that big.
function fmtEtaShort(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec) || sec <= 0 || sec >= 8_640_000) return null;
  if (sec < 60)    return `${Math.round(sec)}s`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function cleanTitle(s: string): string {
  return s
    .replace(/\s*[\(\[]?(2160p|1080p|1080i|720p|480p|4K|UHD).*$/i, "")
    .replace(/\s*[\(\[]?(BluRay|BDRip|BRRip|WEB[\-\.]?DL|WEBRip|HDTV|DVDRip|HDRip|REMUX|PROPER|REPACK).*$/i, "")
    .replace(/\s*[\(\[]?(x264|x265|H\.26[45]|HEVC|AVC|AAC|AC3|DTS|Atmos|TrueHD).*$/i, "")
    .replace(/\.\w{2,4}$/, "")
    .replace(/\./g, " ")
    .trim();
}

function pct(used: number | null, total: number | null): number {
  if (used === null || total === null || total === 0) return 0;
  return Math.min(100, (used / total) * 100);
}

// ── color helpers ─────────────────────────────────────────────────────────────

function barColor(p: number): string {
  if (p >= 90) return "var(--critical)";
  if (p >= 75) return "var(--warn)";
  if (p >= 50) return "var(--brand)";
  return "var(--ok)";
}
function gpuUtilColor(p: number): string {
  if (p >= 90) return "var(--critical)";
  if (p >= 70) return "var(--warn)";
  return "var(--ok)";
}
function tempColor(c: number): string {
  if (c >= 85) return "var(--critical)";
  if (c >= 70) return "var(--warn)";
  return "var(--ok)";
}

// ── alert helpers ─────────────────────────────────────────────────────────────

function cpuAlertLevel(cpu: number | null): AlertLevel {
  if (cpu == null) return null;
  if (cpu > 95) return "critical";
  if (cpu > 80) return "warning";
  return null;
}

function memAlertLevel(total: number | null, available: number | null, sReclaimable: number | null): AlertLevel {
  if (total === null || available === null || total === 0) return null;
  const realUsed = total - available - (sReclaimable ?? 0);
  const realPct  = (Math.max(0, realUsed) / total) * 100;
  if (realPct > 97) return "critical";
  if (realPct > 93) return "warning";
  return null;
}

function diskAlertLevel(usedPct: number): AlertLevel {
  if (usedPct > 95) return "critical";
  if (usedPct > 85) return "warning";
  return null;
}

function gpuTempAlertLevel(temp: number | null): AlertLevel {
  if (temp == null) return null;
  if (temp > 90) return "critical";
  if (temp > 80) return "warning";
  return null;
}

function worstAlert(levels: AlertLevel[]): AlertLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("warning"))  return "warning";
  return null;
}

function computeHealth(m: Metrics | null): HealthResult {
  if (!m) return { status: "healthy", reason: "" };
  const issues: { level: AlertLevel; msg: string }[] = [];
  if (m.cpu != null) {
    const l = cpuAlertLevel(m.cpu);
    if (l) issues.push({ level: l, msg: `cpu ${m.cpu.toFixed(0)}%` });
  }
  {
    const l = memAlertLevel(m.memory.total, m.memory.available, m.memory.sReclaimable);
    if (l && m.memory.total && m.memory.available) {
      const rp = (Math.max(0, m.memory.total - m.memory.available - (m.memory.sReclaimable ?? 0)) / m.memory.total) * 100;
      issues.push({ level: l, msg: `ram ${rp.toFixed(0)}%` });
    }
  }
  if (m.gpu.temperature != null) {
    const l = gpuTempAlertLevel(m.gpu.temperature);
    if (l) issues.push({ level: l, msg: `gpu ${m.gpu.temperature.toFixed(0)}°C` });
  }
  for (const d of m.disks) {
    const l = diskAlertLevel(d.usedPct);
    if (l) issues.push({ level: l, msg: `disk ${d.mountpoint} ${d.usedPct.toFixed(0)}%` });
  }
  const crits = issues.filter(i => i.level === "critical");
  const warns = issues.filter(i => i.level === "warning");
  if (crits.length) return { status: "critical", reason: crits.map(i => i.msg).join("  ·  ") };
  if (warns.length) return { status: "warning",  reason: warns.map(i => i.msg).join("  ·  ") };
  return { status: "healthy", reason: "" };
}

// ── icons ─────────────────────────────────────────────────────────────────────

function IconCPU() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  );
}
function IconMemory() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="10" rx="2"/>
      <line x1="6" y1="7" x2="6" y2="17"/><line x1="10" y1="7" x2="10" y2="17"/>
      <line x1="14" y1="7" x2="14" y2="17"/><line x1="18" y1="7" x2="18" y2="17"/>
      <line x1="6" y1="4" x2="6" y2="7"/><line x1="10" y1="4" x2="10" y2="7"/>
      <line x1="14" y1="4" x2="14" y2="7"/><line x1="18" y1="4" x2="18" y2="7"/>
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
function IconDisk() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  );
}
function IconNetwork() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="6" height="6" rx="1"/><rect x="16" y="2" width="6" height="6" rx="1"/>
      <rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/>
      <line x1="5" y1="8" x2="5" y2="16"/><line x1="19" y1="8" x2="19" y2="16"/>
      <line x1="8" y1="5" x2="16" y2="5"/><line x1="8" y1="19" x2="16" y2="19"/>
    </svg>
  );
}
function IconGPU() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="22" height="12" rx="2"/>
      <rect x="5" y="10" width="4" height="4" rx="1"/><rect x="11" y="10" width="4" height="4" rx="1"/>
      <line x1="5" y1="18" x2="5" y2="21"/><line x1="10" y1="18" x2="10" y2="21"/>
      <line x1="14" y1="18" x2="14" y2="21"/><line x1="19" y1="18" x2="19" y2="21"/>
    </svg>
  );
}
function IconRouter() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="9" width="22" height="7" rx="2"/>
      <line x1="5" y1="9" x2="5" y2="16"/>
      <line x1="9" y1="9" x2="9" y2="16"/>
      <circle cx="16.5" cy="12.5" r="1" fill="currentColor" stroke="none"/>
      <circle cx="19.5" cy="12.5" r="1" fill="currentColor" stroke="none"/>
      <line x1="7" y1="5" x2="7" y2="9"/>
      <line x1="12" y1="3" x2="12" y2="9"/>
      <line x1="17" y1="5" x2="17" y2="9"/>
    </svg>
  );
}

function IconServices() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5"  cy="5"  r="2.2"/><circle cx="12" cy="5"  r="2.2"/><circle cx="19" cy="5"  r="2.2"/>
      <circle cx="5"  cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/>
      <circle cx="5"  cy="19" r="2.2"/><circle cx="12" cy="19" r="2.2"/>
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function IconTrueNAS() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="4" rx="1"/>
      <rect x="2" y="10" width="20" height="4" rx="1"/>
      <rect x="2" y="17" width="20" height="4" rx="1"/>
      <circle cx="18" cy="5" r="0.8" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="12" r="0.8" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="19" r="0.8" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function IconSpeedtest() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 0 1 10 10"/>
      <path d="M12 2a10 10 0 0 0-10 10"/>
      <circle cx="12" cy="12" r="2"/>
      <path d="M12 12 L17 7"/>
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function IconGrafana() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
    </svg>
  );
}

function ServiceIcon({ src, label, color }: { src: string; label: string; color: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
        style={{ background: `${color}22`, color }}>
        {label[0].toUpperCase()}
      </span>
    );
  }
  return (
    <img src={src} alt={label} width={32} height={32}
      className="w-8 h-8 rounded-lg object-contain shrink-0"
      style={{ background: "var(--settings-input)" }}
      onError={() => setErr(true)}
    />
  );
}

function BookmarkItem({ name, url, icon }: { name: string; url: string; icon: string }) {
  const [imgErr, setImgErr] = useState(false);
  const fallback = `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(url).hostname; } catch { return "example.com"; } })()}&sz=32`;
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-2 rounded-lg"
      style={{
        textDecoration: "none", height: 36, flexShrink: 0,
        transition: "background 0.15s ease, transform 0.15s ease",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--card-hover)"; e.currentTarget.style.transform = "translateX(4px)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; }}
    >
      {!imgErr ? (
        <img
          src={icon.startsWith("http") ? icon : fallback}
          alt="" width={18} height={18}
          className="rounded shrink-0" style={{ objectFit: "contain", width: 18, height: 18, borderRadius: 4 }}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== fallback) { img.src = fallback; }
            else { setImgErr(true); }
          }}
        />
      ) : (
        <span className="rounded flex items-center justify-center font-bold shrink-0"
          style={{ background: "var(--card-hover)", color: "var(--text-label)", width: 18, height: 18, fontSize: 9 }}>
          {name[0].toUpperCase()}
        </span>
      )}
      <span className="truncate" style={{ color: "var(--text-secondary)", fontSize: 13 }}>{name}</span>
    </a>
  );
}

// ── primitive components ──────────────────────────────────────────────────────

// Animates between value changes with an ease-out cubic, ~600ms. Preserves the
// formatting of the source string (commas, decimals) by parsing the literal
// matched in animatedLine() below.
function AnimatedNumber({ value, decimals = 0, useCommas = true }: { value: number; decimals?: number; useCommas?: boolean }) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const start = prevRef.current;
    const end   = value;
    if (start === end) return;
    const duration = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(start + (end - start) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const out = decimals > 0 ? displayed.toFixed(decimals) : Math.round(displayed).toString();
  if (!useCommas) return <>{out}</>;
  // Add thousand separators if the original had them
  const [whole, frac] = out.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return <>{frac ? `${withCommas}.${frac}` : withCommas}</>;
}

// Tiny up/down indicator next to a hero metric. Compares `current` against the
// value `lookback` samples ago in `history`. Renders nothing when the change is
// negligible. Caller picks `goodDirection` so red/green coloring matches intent
// (e.g. CPU rising = bad → "down", free RAM rising = good → "up").
function TrendDelta({
  history, current, goodDirection = "down", lookback = 6, suffix = "", precision = 1, threshold = 0.1,
}: {
  history: (number | null | undefined)[]; current: number | null | undefined;
  goodDirection?: "up" | "down"; lookback?: number;
  suffix?: string; precision?: number; threshold?: number;
}) {
  if (current == null || history.length < lookback) return null;
  const past = history[history.length - lookback];
  if (past == null) return null;
  const delta = current - past;
  if (Math.abs(delta) < threshold) return null;
  // Sanity guard: if the magnitude of change is wildly larger than the current
  // value, we're almost certainly comparing samples with different units (e.g.
  // SpeedTracker's `download` field is Mbps from /latest but bits/s from
  // /v1/results). Suppress rather than render nonsense.
  if (current !== 0 && Math.abs(delta) / Math.abs(current) > 5) return null;
  const isUp = delta > 0;
  const isGood = (isUp && goodDirection === "up") || (!isUp && goodDirection === "down");
  const color = isGood ? "#10b981" : "#ef4444";
  return (
    <span style={{
      fontSize: 11, color, opacity: 0.9, fontWeight: 600,
      fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      letterSpacing: "0.01em",
    }}>
      {isUp ? "↑" : "↓"} {Math.abs(delta).toFixed(precision)}{suffix}
    </span>
  );
}

// Splits a stat line into "first number" + "rest of line", rendering the
// number as a hero-sized AnimatedNumber and the rest as small muted text.
// Falls back to the regular animatedLine() rendering if the line has no
// leading numeric value.
function HeroStat({ line, keyPrefix }: { line: string; keyPrefix: string }) {
  const m = line.match(/^(.*?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(.*)$/);
  if (!m) {
    return <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{line}</span>;
  }
  const [, prefix, numStr, rest] = m;
  const useCommas = numStr.includes(",");
  const decimals  = numStr.includes(".") ? numStr.split(".")[1].length : 0;
  const value     = parseFloat(numStr.replace(/,/g, ""));
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap">
      {prefix && <span style={{ fontSize: 11, color: "var(--text-label)" }}>{prefix.trim()}</span>}
      <span style={{
        fontSize: 19, fontWeight: 700, color: "var(--text)",
        fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", lineHeight: 1.1,
      }}>
        <AnimatedNumber value={value} decimals={decimals} useCommas={useCommas} />
      </span>
      {rest && <span style={{
        fontSize: 11, color: "var(--text-dim)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{animatedLine(rest, `${keyPrefix}-rest`)}</span>}
    </div>
  );
}

// Replaces every numeric literal in `line` with an <AnimatedNumber>. Preserves
// the surrounding text and the original formatting (commas, decimals).
function animatedLine(line: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match: 1,234,567 | 1234567 | 33.1
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g;
  let lastIdx = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index));
    const literal  = m[0];
    const useCommas = literal.includes(",");
    const decimals  = literal.includes(".") ? (literal.split(".")[1].length) : 0;
    const value     = parseFloat(literal.replace(/,/g, ""));
    parts.push(<AnimatedNumber key={`${keyPrefix}-n${i++}`} value={value} decimals={decimals} useCommas={useCommas} />);
    lastIdx = m.index + literal.length;
  }
  if (lastIdx < line.length) parts.push(line.slice(lastIdx));
  return parts;
}

function GaugeBar({ percent, color, thin = false, gradient }: { percent: number; color: string; thin?: boolean; gradient?: string }) {
  return (
    <div className="relative w-full rounded-full overflow-hidden" style={{ background: "var(--surface)", height: thin ? 3 : 5 }}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${percent}%`, background: gradient ?? color, boxShadow: `0 0 ${thin ? 3 : 6}px ${color}55` }}
      />
    </div>
  );
}

function Sparkline({ data, color, autoMax = false, height = 32 }: {
  data: number[]; color: string; autoMax?: boolean; height?: number;
}) {
  const uid = useId();
  if (data.length < 2) return <div style={{ height }} />;
  const W = 100, H = height, PAD = 1;
  const maxVal = autoMax ? Math.max(...data, 0.001) : 100;
  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - Math.min(Math.max(v, 0), maxVal) / maxVal) * (H - PAD * 2);
    return [x.toFixed(2), y.toFixed(2)];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const gid  = `sg${uid.replace(/:/g, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.5" />
          <stop offset="60%"  stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      {/* soft glow under the line */}
      <path d={line} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" opacity="0.18" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" opacity="1" />
    </svg>
  );
}

function MiniBarChart({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  const last20 = data.slice(-20);
  const maxVal = Math.max(...last20, 0.001);
  return (
    <div className="flex items-end gap-px w-full" style={{ height }}>
      {Array.from({ length: 20 }, (_, i) => {
        const val = last20[i] ?? 0;
        const h = Math.max(2, (val / maxVal) * height);
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all duration-500"
            style={{
              height: h,
              background: color,
              opacity: i < last20.length ? 0.75 : 0.1,
              boxShadow: val > maxVal * 0.7 ? `0 0 4px ${color}55` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function DonutChart({ used, total, color, size = 72 }: { used: number; total: number; color: string; size?: number }) {
  const pctVal = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const r = 28, circ = 2 * Math.PI * r;
  const filled = (pctVal / 100) * circ;
  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--donut-track)" strokeWidth="8" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}55)`, transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-[11px] font-medium tabular-nums" style={{ color: "var(--text)" }}>{pctVal.toFixed(0)}%</div>
      </div>
    </div>
  );
}

function RadialGauge({ percent, color, size = 88 }: { percent: number; color: string; size?: number }) {
  const r = 32, circ = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circ;
  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--gauge-track)" strokeWidth="6" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${filled.toFixed(2)} ${(circ - filled).toFixed(2)}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${color}66)`, transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
    </div>
  );
}

function ThreeSegmentDonut({ usedBytes, cacheBytes, freeBytes, totalBytes, du }: {
  usedBytes: number; cacheBytes: number; freeBytes: number; totalBytes: number; du: DataUnit;
}) {
  const r = 36, circ = 2 * Math.PI * r;
  const safe = (v: number) => (isNaN(v) ? 0 : Math.max(0, v));
  const total = safe(totalBytes);
  const used  = safe(usedBytes);
  const cache = safe(cacheBytes);
  const free  = safe(freeBytes);
  const usedLen  = total > 0 ? (used  / total) * circ : 0;
  const cacheLen = total > 0 ? (cache / total) * circ : 0;
  const freeLen  = total > 0 ? (free  / total) * circ : 0;
  const usedPct  = total > 0 ? (used  / total) * 100  : 0;
  const size = 100;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--donut-bg)" strokeWidth="9" />
          {usedLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="var(--critical)" strokeWidth="9"
              strokeDasharray={`${usedLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={0}
              style={{ filter: "drop-shadow(0 0 3px var(--critical)44)", transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
          {cacheLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="var(--settings-label)" strokeWidth="9"
              strokeDasharray={`${cacheLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={(-usedLen).toFixed(2)}
              style={{ transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
          {freeLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="var(--ok)" strokeWidth="9"
              strokeDasharray={`${freeLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={(-(usedLen + cacheLen)).toFixed(2)}
              style={{ filter: "drop-shadow(0 0 3px #00c85333)", transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {total > 0 ? `${usedPct.toFixed(0)}%` : "—"}
          </span>
          <span className="text-[9px]" style={{ color: "var(--settings-text-dim)" }}>used</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 w-full">
        {[
          { label: "used",      color: "var(--critical)", bytes: used  },
          { label: "zfs cache", color: "var(--settings-label)", bytes: cache },
          { label: "free",      color: "var(--ok)", bytes: free  },
        ].map(({ label, color, bytes }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-label)" }}>{label}</span>
            </div>
            <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--text-muted)" }}>
              {fmtBytes(bytes, 1, du)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LabeledBar({ label, right, percent, color, gradient }: {
  label: string; right: string; percent: number; color: string; gradient?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-label)" }}>{label}</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>{right}</span>
      </div>
      <GaugeBar percent={percent} color={color} gradient={gradient} />
    </div>
  );
}

const CARD_INFO: Record<string, string> = {
  cpu:         "CPU utilization across all cores from Prometheus node_exporter. Warn at 85%, critical at 95%.",
  memory:      "Real memory usage = Total - Available - SReclaimable. ZFS ARC inflates raw MemAvailable on TrueNAS.",
  filesystems: "Disk usage for mounts under the configured FS_PATH_PREFIX. Sorted by fullest first.",
  network:     "Network throughput (rx/tx bytes per second) for the primary NIC, excluding virtual interfaces.",
  gpu:         "NVIDIA GPU metrics from nvidia_smi_exporter. Temp warn at 80°C, critical at 90°C.",
  speedtest:   "Recent speedtest results from SpeedTracker. Tests are scheduled automatically — never triggered by the dashboard.",
  system:      "Basic system info: OS, kernel version, architecture, hostname, and uptime from node_exporter.",
  grafana:     "Embedded Grafana panel. Configure GRAFANA_DASHBOARD_UID and GRAFANA_DATASOURCE_UID to enable.",
};

function Card({
  label, subtitle, children, accent = "#06b6d4", alertLevel = null,
  icon, expanded = false, onToggle, externalLink, animDelay = 0, info,
}: {
  label: string; subtitle?: string; children: React.ReactNode; accent?: string;
  alertLevel?: AlertLevel; icon?: React.ReactNode; expanded?: boolean; onToggle?: () => void;
  externalLink?: string; animDelay?: number; info?: string;
}) {
  const [hov, setHov] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const borderColor =
    alertLevel === "critical" ? "rgba(239,68,68,0.45)"
    : alertLevel === "warning" ? "rgba(245,158,11,0.4)"
    : hov ? `${accent}55` : "rgba(255,255,255,0.08)";

  const topColor =
    alertLevel === "critical" ? "#ef4444"
    : alertLevel === "warning" ? "#f59e0b"
    : accent;

  const infoText = info ?? CARD_INFO[label.toLowerCase()] ?? null;

  return (
    <div
      className="flex flex-col cursor-pointer h-full relative overflow-hidden"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={externalLink ? () => window.open(externalLink, "_blank") : onToggle}
      style={{
        background: `radial-gradient(ellipse at top, ${topColor}14 0%, transparent 55%), rgba(255,255,255,0.04)`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        transform: hov ? "translateY(-3px)" : "translateY(0)",
        boxShadow: hov
          ? `0 12px 36px ${topColor}33, 0 0 0 1px ${topColor}33 inset, 0 8px 32px rgba(0,0,0,0.35)`
          : "none",
        transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
        animation: "fadeSlideIn 0.45s ease both",
        animationDelay: `${animDelay}ms`,
      }}
    >
      {/* Brand accent stripe with glow */}
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${topColor} 0%, ${topColor}aa 60%, ${topColor}33 100%)`,
        boxShadow: alertLevel ? `0 0 12px ${topColor}aa` : `0 0 8px ${topColor}66`,
      }} />
      <div className="flex items-center gap-2 overflow-hidden px-[18px] pt-[18px] pb-0">
        {icon && <span style={{ color: accent, opacity: 0.7 }}>{icon}</span>}
        <span className="text-[10px] uppercase shrink-0" style={{ color: "var(--text-label)", letterSpacing: "0.12em" }}>{label}</span>
        {subtitle && <span className="text-[10px] truncate" style={{ color: "var(--text-faint)" }}>{subtitle}</span>}
        {infoText && (
          <span className="relative shrink-0" style={{ lineHeight: 1 }}
            onMouseEnter={e => { e.stopPropagation(); setShowInfo(true); }}
            onMouseLeave={() => setShowInfo(false)}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 14, height: 14, borderRadius: 7,
              border: "1px solid var(--border)",
              fontSize: 8, color: "var(--text-ghost)", cursor: "help",
              transition: "color 0.15s, border-color 0.15s",
              ...(showInfo ? { color: accent, borderColor: accent } : {}),
            }}>i</span>
            {showInfo && (
              <div style={{
                position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                marginTop: 6, width: 220, padding: "8px 10px",
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                fontSize: 10, lineHeight: 1.5, color: "var(--text-secondary)",
                zIndex: 50, pointerEvents: "none",
              }}>{infoText}</div>
            )}
          </span>
        )}
        {/* live status dot, color reflects alertLevel */}
        <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0" style={{
          background: alertLevel === "critical" ? "#ef4444" : alertLevel === "warning" ? "#f59e0b" : "#10b981",
          boxShadow: alertLevel === "critical" ? "0 0 7px #ef4444aa"
                   : alertLevel === "warning"  ? "0 0 6px #f59e0baa"
                                               : "0 0 5px #10b98166",
          animation: "pulseDot 2s ease-in-out infinite",
        }} />
        <span className="text-[9px]" style={{ color: "var(--text-hidden)" }}>{externalLink ? "↗" : expanded ? "▲" : "▼"}</span>
      </div>
      <div className="px-[18px] pt-3 pb-[18px] flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function StatusBanner({ result, visible }: { result: HealthResult; visible: boolean }) {
  const { status, reason } = result;

  if (status === "warning") {
    return (
      <div className="flex items-center gap-3 px-4 rounded-lg"
        style={{
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)",
          height: 36, opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
        }}>
        <span className="block shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--warn)", boxShadow: "0 0 6px #f59e0b66", animation: "pulseDot 2s ease-in-out infinite" }} />
        <span className="text-[10px] tracking-[0.2em] font-semibold uppercase" style={{ color: "var(--warn)" }}>WARNING</span>
        {reason && <span className="text-[10px]" style={{ color: "rgba(245,158,11,0.7)" }}>· {reason}</span>}
      </div>
    );
  }

  if (status === "critical") {
    return (
      <div className="flex items-center gap-3 px-4 rounded-lg"
        style={{
          background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
          height: 48, opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
        }}>
        <span className="text-sm font-bold leading-none" style={{ color: "var(--critical)" }}>✕</span>
        <span className="block shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--critical)", boxShadow: "0 0 8px #ef444466", animation: "pulseDot 2s ease-in-out infinite" }} />
        <span className="text-[10px] tracking-[0.2em] font-semibold uppercase" style={{ color: "var(--critical)" }}>CRITICAL</span>
        {reason && <span className="text-[10px]" style={{ color: "rgba(239,68,68,0.7)" }}>· {reason}</span>}
      </div>
    );
  }

  return null;
}

function Skeleton() {
  return <div className="skeleton h-8 w-24 rounded" />;
}

function BigValue({ value, loading }: { value: string; loading?: boolean }) {
  const [renderKey, setRenderKey] = useState(0);
  const prevRef = useRef(value);
  useEffect(() => {
    if (!loading && value !== prevRef.current) {
      const wasReal = prevRef.current !== "—";
      prevRef.current = value;
      if (wasReal && value !== "—") setRenderKey(k => k + 1);
    }
  }, [value, loading]);
  if (loading) return <Skeleton />;
  return (
    <span
      key={renderKey}
      className="text-3xl font-medium tracking-tight"
      style={{ color: "var(--text)", display: "inline-block", animation: renderKey > 0 ? "valueIn 0.35s ease-out forwards" : "none" }}
    >
      {value}
    </span>
  );
}

function SubRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs" style={{ color: "var(--text-label)" }}>{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color: valueColor ?? "rgba(255,255,255,0.65)" }}>{value}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-label)" }}>{label}</span>
      <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--text-muted)" }}>{value}</span>
    </div>
  );
}

// ── search bar ────────────────────────────────────────────────────────────────

const SEARCH_ENGINES: Record<SearchEngine, { label: string; url: string; placeholder: string }> = {
  google:      { label: "Google",      url: "https://www.google.com/search?q=",   placeholder: "Search Google…" },
  bing:        { label: "Bing",        url: "https://www.bing.com/search?q=",     placeholder: "Search Bing…" },
  duckduckgo:  { label: "DuckDuckGo",  url: "https://duckduckgo.com/?q=",         placeholder: "Search DuckDuckGo…" },
  kagi:        { label: "Kagi",        url: "https://kagi.com/search?q=",         placeholder: "Search Kagi…" },
};

function SearchEngineIcon({ engine, size = 16 }: { engine: SearchEngine; size?: number }) {
  if (engine === "google") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
  if (engine === "bing") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M5 3v16.5l4.67 2.5 8.33-4.5v-5L11.33 9l-2.33.83V5.5L5 3zm4.67 11.17l4.33 2.33-4.33 2.33v-4.66z" fill="#00809D"/>
    </svg>
  );
  if (engine === "duckduckgo") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill="#DE5833"/>
      <circle cx="12" cy="12" r="7" fill="#fff"/>
      <circle cx="12" cy="12" r="3.5" fill="#DE5833"/>
    </svg>
  );
  // kagi
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#FFBE2E"/>
      <path d="M8 7h8v2H8zm0 4h8v2H8zm0 4h5v2H8z" fill="#1a1a1a"/>
    </svg>
  );
}

function SearchBar({ inputRef, engine }: { inputRef: React.RefObject<HTMLInputElement | null>; engine: SearchEngine }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const cfg = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google;

  function doSearch() {
    const q = query.trim();
    if (q) window.open(`${cfg.url}${encodeURIComponent(q)}`, "_blank");
  }

  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--surface-bright)",
          border: `1px solid ${focused ? "var(--brand-glow)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: 999, padding: "10px 20px",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          boxShadow: focused ? "0 0 0 3px var(--brand-glow)" : "none",
          transform: focused ? "scale(1.01)" : "scale(1)",
          transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
        }}
      >
        <SearchEngineIcon engine={engine} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={cfg.placeholder}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(); if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            fontSize: 14, color: "var(--text)", fontFamily: "inherit",
            caretColor: "var(--brand)",
          }}
        />
        <button onClick={doSearch}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-faint)", display: "flex", transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── settings panel ─────────────────────────────────────────────────────────────

const CARD_KEYS = ["cpu", "memory", "filesystems", "network", "gpu", "speedtest", "system", "grafana", "services", "activity"] as const;

function SettingsPanel({ settings, onUpdate, onClose, services }: {
  settings: Settings;
  onUpdate: (s: Settings) => void;
  onClose: () => void;
  services?: ServiceResult[] | null;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col gap-5 p-6 overflow-y-auto"
        style={{ width: 272, background: "var(--settings-bg)", borderLeft: "1px solid var(--settings-border)", boxShadow: "-12px 0 40px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] tracking-widest uppercase" style={{ color: "var(--settings-text)" }}>Settings</span>
          <button onClick={onClose} style={{ color: "var(--settings-text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>

        {[
          { title: "Refresh", options: [3, 5, 10, 30], key: "refreshInterval" as const, fmt: (v: number) => `${v}s` },
        ].map(({ title, options, key, fmt }) => (
          <div key={key} className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>{title}</span>
            <div className="flex gap-1.5">
              {options.map(o => (
                <button key={o} onClick={() => onUpdate({ ...settings, [key]: o })}
                  className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                  style={{
                    background: settings[key] === o ? "var(--settings-active-bg)" : "#161616",
                    border: `1px solid ${settings[key] === o ? "var(--settings-active-border)" : "#1e1e1e"}`,
                    color: settings[key] === o ? "var(--settings-active)" : "#444", cursor: "pointer",
                  }}
                >{fmt(o)}</button>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Temperature</span>
          <div className="flex gap-1.5">
            {(["C", "F"] as TempUnit[]).map(u => (
              <button key={u} onClick={() => onUpdate({ ...settings, tempUnit: u })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                style={{
                  background: settings.tempUnit === u ? "var(--settings-active-bg)" : "#161616",
                  border: `1px solid ${settings.tempUnit === u ? "var(--settings-active-border)" : "#1e1e1e"}`,
                  color: settings.tempUnit === u ? "var(--settings-active)" : "#444", cursor: "pointer",
                }}
              >°{u}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Data Units</span>
          <div className="flex gap-1.5">
            {(["decimal", "binary"] as DataUnit[]).map(u => (
              <button key={u} onClick={() => onUpdate({ ...settings, dataUnit: u })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                style={{
                  background: settings.dataUnit === u ? "var(--settings-active-bg)" : "#161616",
                  border: `1px solid ${settings.dataUnit === u ? "var(--settings-active-border)" : "#1e1e1e"}`,
                  color: settings.dataUnit === u ? "var(--settings-active)" : "#444", cursor: "pointer",
                }}
              >{u === "decimal" ? "GB" : "GiB"}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Search Engine</span>
          <div className="flex gap-1.5 flex-wrap">
            {(["google", "bing", "duckduckgo", "kagi"] as SearchEngine[]).map(e => (
              <button key={e} onClick={() => onUpdate({ ...settings, searchEngine: e })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150 flex items-center justify-center gap-1"
                style={{
                  background: settings.searchEngine === e ? "var(--settings-active-bg)" : "#161616",
                  border: `1px solid ${settings.searchEngine === e ? "var(--settings-active-border)" : "#1e1e1e"}`,
                  color: settings.searchEngine === e ? "var(--settings-active)" : "#444", cursor: "pointer",
                  minWidth: 0, padding: "6px 4px",
                }}
              >
                <SearchEngineIcon engine={e} size={10} />
                <span style={{ fontSize: 9 }}>{e === "duckduckgo" ? "DDG" : e.charAt(0).toUpperCase() + e.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Timezone</span>
          <select
            value={settings.timezone}
            onChange={e => onUpdate({ ...settings, timezone: e.target.value })}
            style={{
              background: "var(--settings-input)", border: "1px solid var(--settings-input-border)", borderRadius: 6,
              padding: "6px 8px", fontSize: 10, color: settings.timezone ? "var(--settings-active)" : "#444",
              cursor: "pointer", outline: "none", width: "100%",
            }}
          >
            <option value="">Browser local</option>
            {[
              "Pacific/Auckland", "Pacific/Fiji",
              "Australia/Sydney", "Australia/Adelaide", "Australia/Perth", "Australia/Hobart", "Australia/Brisbane",
              "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore",
              "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi",
              "Europe/Moscow", "Europe/Istanbul", "Europe/Athens", "Europe/Helsinki",
              "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Zurich",
              "Europe/London",
              "Atlantic/Reykjavik",
              "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
              "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
              "America/Anchorage", "Pacific/Honolulu",
              "America/Toronto", "America/Vancouver",
            ].map(tz => (
              <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Theme</span>
          <div className="flex gap-1.5">
            {THEMES.map(t => {
              const active = settings.theme === t.key;
              return (
                <button key={t.key} onClick={() => onUpdate({ ...settings, theme: t.key })}
                  className="flex-1 flex flex-col items-center gap-1 py-2 rounded transition-all duration-150"
                  style={{
                    background: active ? "var(--settings-active-bg)" : "#161616",
                    border: `1px solid ${active ? "var(--settings-active-border)" : "#1e1e1e"}`,
                    cursor: "pointer", minWidth: 0,
                  }}
                >
                  <div className="flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 9, background: t.bg, border: `2px solid ${t.brand}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: t.brand }} />
                  </div>
                  <span style={{ fontSize: 8, color: active ? "var(--settings-active)" : "#444" }}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Visible Cards</span>
          {CARD_KEYS.map(c => {
            const on = settings.visibleCards[c] !== false;
            return (
              <label key={c} className="flex items-center gap-3 cursor-pointer" onClick={() => onUpdate({ ...settings, visibleCards: { ...settings.visibleCards, [c]: !on } })}>
                <div className="relative w-7 h-4 rounded-full transition-all duration-200"
                  style={{ background: on ? "var(--settings-active-bg-dim)" : "#161616", border: `1px solid ${on ? "var(--settings-active-border)" : "#1e1e1e"}` }}>
                  <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200"
                    style={{ left: on ? "calc(100% - 14px)" : "2px", background: on ? "var(--settings-active)" : "#2a2a2a" }} />
                </div>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: on ? "#555" : "#2e2e2e" }}>{c}</span>
              </label>
            );
          })}
        </div>

        {/* Connections — per-service status. Helpful for first-run users seeing
            which env vars they still need to set, and for debugging when a
            configured service shows "—". */}
        {services && services.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Connections</span>
            <div className="flex flex-col gap-1">
              {services.map(s => {
                const configured = s.configured !== false;
                const ok         = configured && s.up;
                const dotColor   = !configured ? "#444" : ok ? "#10b981" : "#ef4444";
                const dotShadow  = !configured ? "none" : ok ? "0 0 4px #10b98166" : "0 0 4px #ef444466";
                const statusText = !configured ? "not configured" : ok ? "connected" : "unreachable";
                const statusColor = !configured ? "#555"     : ok ? "#10b981"      : "#ef4444";
                return (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: dotColor, boxShadow: dotShadow }} />
                    <span className="text-[10px] flex-1" style={{ color: configured ? "#888" : "#444" }}>
                      {SVC_LABELS[s.name] ?? s.name}
                    </span>
                    <span className="text-[9px] tabular-nums font-mono" style={{ color: statusColor }}>
                      {statusText}
                    </span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const missing = services.filter(s => s.configured === false);
              if (missing.length === 0) return null;
              const envVars = Array.from(new Set(missing.flatMap(s => s.envVar ?? [])));
              return (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "var(--settings-bg)", borderRadius: 6, border: "1px solid var(--settings-border)" }}>
                  <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--settings-label)", marginBottom: 4 }}>
                    Missing env vars
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {envVars.map(v => (
                      <code key={v} className="text-[10px] font-mono" style={{ color: "var(--brand)" }}>{v}</code>
                    ))}
                  </div>
                  <div className="text-[9px]" style={{ color: "var(--settings-label)", marginTop: 6, lineHeight: 1.5 }}>
                    Set these via <code style={{ color: "var(--settings-text)" }}>docker run -e</code> or in your{" "}
                    <code style={{ color: "var(--settings-text)" }}>docker-compose.yml</code>.
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <div style={{ height: 1, background: "var(--settings-input)", marginTop: "auto" }} />
        <span className="text-[9px] text-center" style={{ color: "var(--settings-input-border)" }}>resets on page reload</span>
      </div>
    </>
  );
}

// ── mikrotik tab ─────────────────────────────────────────────────────────────

interface MtData {
  board: string | null;
  version: string | null;
  cpu: number | null;
  ramUsed: string | null;
  ramTotal: string | null;
  ramPct: number | null;
  hddUsed: number | null;
  hddTotal: number | null;
  uptime: string | null;
  temp: number | null;
}

function MikrotikTab({ mikrotikUrl }: { mikrotikUrl: string }) {
  const [data, setData] = useState<MtData | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  // Friendly host shown on the static pill — strip protocol so it reads as just an IP/hostname.
  const mikrotikHost = mikrotikUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/mikrotik", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const d = await res.json() as MtData & { error?: string };
        if (d.error) throw new Error(d.error);
        setData({
          board:    d.board,
          version:  d.version,
          cpu:      d.cpu,
          ramUsed:  d.ramUsed,
          ramTotal: d.ramTotal,
          ramPct:   d.ramPct,
          hddUsed:  d.hddUsed,
          hddTotal: d.hddTotal,
          uptime:   d.uptime,
          temp:     d.temp,
        });
        setCorsBlocked(false);
      } catch {
        setCorsBlocked(true);
      }
    }
    load();
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, []);

  const pill = (label: string, value: string, pctVal?: number, tempVal?: number | null) => {
    const tempColor = tempVal == null ? null : tempVal > 80 ? "var(--critical)" : tempVal > 60 ? "var(--warn)" : "var(--ok)";
    return (
      <div key={label} className="flex items-center gap-2 shrink-0">
        <span style={{ color: "var(--text-label)", fontSize: 10 }}>{label}</span>
        <span style={{ color: tempColor ?? "rgba(255,255,255,0.9)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {pctVal != null && (
          <div style={{ width: 36, height: 3, background: "var(--border-mid)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${pctVal}%`, height: "100%", background: pctVal > 85 ? "var(--critical)" : pctVal > 65 ? "var(--warn)" : "var(--settings-active)", borderRadius: 2 }} />
          </div>
        )}
      </div>
    );
  };

  const sep = () => <span style={{ color: "var(--text-hidden)", fontSize: 14, userSelect: "none" }}>|</span>;

  const fmtMtBytes = (b: number | null) => {
    if (b == null) return "—";
    if (b < 1e6) return `${(b / 1e3).toFixed(0)} KB`;
    if (b < 1e9) return `${(b / 1e6).toFixed(0)} MB`;
    return `${(b / 1e9).toFixed(1)} GB`;
  };

  const staticSep = () => <span style={{ color: "var(--text-hidden)", fontSize: 14, userSelect: "none", flexShrink: 0 }}>|</span>;
  const staticPill = (label: string, value: string) => (
    <div className="flex items-center gap-1.5 shrink-0">
      <span style={{ color: "var(--text-label)", fontSize: 10 }}>{label}</span>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  if (corsBlocked || !data) {
    return (
      <a href={mikrotikUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-4 w-full overflow-x-auto"
        style={{
          background: "var(--mt-bg)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 20px",
          textDecoration: "none", cursor: "pointer",
          transition: "border-color 0.2s, background 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.background = "var(--mt-bg-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--mt-bg)"; }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--brand)" }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="9" width="22" height="7" rx="2"/>
            <line x1="5" y1="9" x2="5" y2="16"/><line x1="9" y1="9" x2="9" y2="16"/>
            <circle cx="16.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
            <circle cx="19.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
            <line x1="7" y1="5" x2="7" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="17" y1="5" x2="17" y2="9"/>
          </svg>
          <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 14 }}>MikroTik</span>
          <span style={{ color: "var(--text-label)", fontSize: 11 }}>hAP ax³</span>
        </div>
        {staticSep()}
        {staticPill("RouterOS", "7.22.1")}
        {staticSep()}
        {staticPill("IP", mikrotikHost)}
        {staticSep()}
        {staticPill("CPU", "—")}
        {staticSep()}
        {staticPill("RAM", "—")}
        {staticSep()}
        {staticPill("Uptime", "13d 4h")}
        <span style={{ color: "var(--text-ghost)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
      </a>
    );
  }

  const cpuPct = data.cpu ?? 0;
  const memPct = data.ramPct ?? 0;
  const hddPct = data.hddTotal && data.hddUsed ? (data.hddUsed / data.hddTotal) * 100 : 0;

  return (
    <a href={mikrotikUrl} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-4 w-full overflow-x-auto"
      style={{
        background: "var(--mt-bg)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "12px 20px", textDecoration: "none", cursor: "pointer",
        transition: "border-color 0.2s, background 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.background = "var(--mt-bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--mt-bg)"; }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--brand)" }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="9" width="22" height="7" rx="2"/>
          <line x1="5" y1="9" x2="5" y2="16"/><line x1="9" y1="9" x2="9" y2="16"/>
          <circle cx="16.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
          <circle cx="19.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
          <line x1="7" y1="5" x2="7" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="17" y1="5" x2="17" y2="9"/>
        </svg>
        <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 14 }}>MikroTik</span>
      </div>
      {sep()}
      {data.board && pill("Model", data.board)}
      {data.version && <>{sep()}{pill("RouterOS", data.version)}</>}
      {data.cpu != null && <>{sep()}{pill("CPU", `${data.cpu}%`, cpuPct)}</>}
      {data.ramTotal != null && <>{sep()}{pill("RAM", `${data.ramUsed ?? "—"} / ${data.ramTotal}`, memPct)}</>}
      {data.hddTotal != null && <>{sep()}{pill("Storage", `${fmtMtBytes(data.hddUsed)} / ${fmtMtBytes(data.hddTotal)}`, hddPct)}</>}
      {data.uptime && <>{sep()}{pill("Uptime", data.uptime)}</>}
      {data.temp != null && <>{sep()}{pill("Temp", `${data.temp}°C`, undefined, data.temp)}</>}
      <span style={{ color: "var(--text-ghost)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
    </a>
  );
}

// ── GrafanaCard ───────────────────────────────────────────────────────────────

function GrafanaPanel({ url, label, height }: { url: string; label?: string; height: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ position: "relative", height }}>
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 8,
          background: "var(--card-alt)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span className="text-[11px]" style={{ color: "var(--text-ghost)" }}>loading{label ? ` ${label}` : " panel"}…</span>
        </div>
      )}
      <iframe
        src={url}
        width="100%"
        height={height}
        frameBorder={0}
        style={{
          borderRadius: 8, border: "none", display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.4s",
        }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function GrafanaCard({ baseUrl, panelUrl, panels }: {
  baseUrl: string;
  panelUrl: string | null;
  panels?: { panelId: string; label: string; size: "sm" | "md" | "lg"; url: string }[];
}) {
  const allPanels = panels && panels.length > 0 ? panels : panelUrl ? [{ panelId: "default", label: "Panel", size: "lg" as const, url: panelUrl }] : [];
  const hasAnyPanel = allPanels.length > 0;

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 14, padding: 18, backdropFilter: "blur(6px)",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent-grafana)" }}><IconGrafana /></span>
          <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-label)", letterSpacing: "0.15em" }}>grafana</span>
          {hasAnyPanel && (
            <span className="text-[9px]" style={{ color: "var(--text-ghost)" }}>{allPanels.length} panel{allPanels.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        <a href={baseUrl} target="_blank" rel="noopener noreferrer"
          className="text-[10px]"
          style={{ color: "var(--text-faint)", textDecoration: "none", transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--accent-grafana)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
          open grafana ↗
        </a>
      </div>

      {/* Setup-required state when no panels configured. */}
      {!hasAnyPanel ? (
        <div style={{
          position: "relative", height: 220, borderRadius: 8,
          background: "var(--surface-dim)",
          border: "1px dashed var(--border)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
          padding: 18, textAlign: "center",
        }}>
          <span className="text-[11px]" style={{ color: "var(--text-label)" }}>
            Grafana embed not configured.
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-ghost)", maxWidth: 360, lineHeight: 1.5 }}>
            Set <code style={{ color: "var(--accent-grafana)" }}>GRAFANA_DASHBOARD_UID</code> and <code style={{ color: "var(--accent-grafana)" }}>GRAFANA_DATASOURCE_UID</code> env vars to render a panel here. Use the <a href="/setup" style={{ color: "var(--accent-grafana)" }}>setup wizard</a> to add multiple panels.
          </span>
        </div>
      ) : allPanels.length === 1 ? (
        <GrafanaPanel url={allPanels[0].url} label={allPanels[0].label} height={220} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {allPanels.map((p, i) => {
            const colSpan = p.size === "lg" ? 3 : p.size === "md" ? 2 : 1;
            const h = p.size === "lg" ? 220 : p.size === "md" ? 180 : 150;
            return (
              <div key={p.panelId + i} style={{ gridColumn: `span ${colSpan}` }}>
                {allPanels.length > 1 && (
                  <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-ghost)" }}>{p.label}</div>
                )}
                <GrafanaPanel url={p.url} label={p.label} height={h} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ActivityFeed ──────────────────────────────────────────────────────────────
// Horizontal scrolling ticker of recent grabs/imports/streams from Sonarr,
// Radarr, and Tautulli. Hover pauses the scroll. Empty state renders nothing.

function relativeAgo(unixMs: number): string {
  const sec = Math.max(0, Math.round((Date.now() - unixMs) / 1000));
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function ActivityEventPill({ ev }: { ev: ActivityEvent }) {
  const color = SVC_COLORS[ev.source] ?? "#888";
  const verb  = ev.type === "grabbed"  ? "grabbed"
              : ev.type === "imported" ? "imported"
                                       : "watched";
  return (
    <span className="flex items-center gap-1.5 shrink-0" style={{ paddingInline: 14 }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 5px ${color}aa` }} />
      <span style={{
        color, fontSize: 9, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
      }}>{ev.source}</span>
      <span style={{ color: "var(--text-faint)", fontSize: 10 }}>{verb}</span>
      <span style={{
        color: "var(--text-secondary)", fontSize: 11, fontWeight: 500,
        maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{ev.title}</span>
      {ev.subtitle && (
        <span style={{
          color: "var(--text-faint)", fontSize: 10,
          maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>· {ev.subtitle}</span>
      )}
      <span style={{
        color: "var(--text-ghost)", fontSize: 9,
        fontVariantNumeric: "tabular-nums",
      }}>· {relativeAgo(ev.timestamp)}</span>
    </span>
  );
}

function ActivityFeed({ events, loading }: { events: ActivityEvent[]; loading: boolean }) {
  const [hov, setHov] = useState(false);
  // Re-render every 30s so the relative timestamps refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading && events.length === 0) {
    return (
      <div style={{
        height: 36, background: "var(--surface-dim)",
        border: "1px solid var(--border-dim)", borderRadius: 10,
        display: "flex", alignItems: "center", padding: "0 14px",
      }}>
        <span className="text-[10px] uppercase" style={{ color: "var(--text-ghost)", letterSpacing: "0.18em" }}>
          loading activity…
        </span>
      </div>
    );
  }
  if (events.length === 0) return null;

  // Doubled list = seamless loop with the -50% keyframe end position.
  const looped = [...events, ...events];
  // Pace: ~6 seconds per unique event, min 30s total.
  const duration = Math.max(30, events.length * 6);

  return (
    <div className="relative overflow-hidden"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 36,
        background: "var(--surface-dim)",
        border: "1px solid var(--border-dim)",
        borderRadius: 10,
      }}>
      {/* Section label, pinned left, sits above the scrolling content */}
      <div className="absolute inset-y-0 left-0 z-10 flex items-center pointer-events-none"
        style={{
          paddingLeft: 12, paddingRight: 18,
          background: "linear-gradient(to right, var(--fade-to) 60%, transparent)",
        }}>
        <span className="text-[9px] uppercase" style={{
          color: "var(--text-label)", letterSpacing: "0.22em", fontWeight: 700,
        }}>
          activity
        </span>
      </div>
      {/* Scrolling content */}
      <div className="absolute inset-y-0 flex items-center" style={{
        left: 80,
        animation: `tickerScroll ${duration}s linear infinite`,
        animationPlayState: hov ? "paused" : "running",
        willChange: "transform",
      }}>
        {looped.map((ev, i) => (
          <ActivityEventPill key={`${ev.source}-${ev.timestamp}-${i}`} ev={ev} />
        ))}
      </div>
      {/* Right-edge fade so titles don't hard-cut */}
      <div className="absolute inset-y-0 right-0 pointer-events-none"
        style={{ width: 40, background: "linear-gradient(to left, var(--fade-to), transparent)" }} />
    </div>
  );
}

// ── dashboard ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = { refreshInterval: 3, tempUnit: "C", dataUnit: "decimal", visibleCards: {}, searchEngine: "google", timezone: "", theme: "midnight" };
const SETTINGS_KEY = "comexe:settings";

// ── Demo mode ────────────────────────────────────────────────────────────
// ?demo=1 renders the dashboard with realistic fake data so new users can
// preview what a fully configured dashboard looks like before wiring up
// any services.

function buildDemoMetrics(): Metrics {
  return {
    cpu: 42.3,
    memory: { total: 68719476736, used: null, available: 27917287424, sReclaimable: 4294967296 },
    disks: [
      { mountpoint: "/mnt/Pool/Media/Movies", device: "/dev/sda1", fstype: "zfs", total: 8e12, avail: 2.8e12, used: 5.2e12, usedPct: 65 },
      { mountpoint: "/mnt/Pool/Media/TV",     device: "/dev/sdb1", fstype: "zfs", total: 8e12, avail: 4.2e12, used: 3.8e12, usedPct: 47.5 },
      { mountpoint: "/mnt/Pool/Media/Music",  device: "/dev/sdc1", fstype: "zfs", total: 2e12, avail: 1.4e12, used: 0.6e12, usedPct: 30 },
    ],
    pool: { total: 18e12, used: 9.6e12, avail: 8.4e12 },
    network: { rxBytesPerSec: 24500000, txBytesPerSec: 3200000, rxBytesTotal: 14e12, txBytesTotal: 2.1e12, interfaceName: "enp4s0" },
    gpu: {
      name: "NVIDIA GeForce RTX 3060", utilization: 28, memUsed: 3.2e9, memTotal: 12e9,
      temperature: 52, powerDraw: 85, powerLimit: 170, fanSpeed: 42, coreClock: 1807, memClock: 7501,
      encUtil: 0, decUtil: 15,
    },
    uptime: 1728000,
    sysInfo: {
      os: "TrueNAS-SCALE-24.10.2", kernel: "6.6.44-production+truenas", arch: "x86_64", hostname: "truenas",
      cpuCores: 12, cpuModel: "AMD Ryzen 5 5600X", cpuFreqGhz: 3.7,
      load1: 1.2, load5: 0.8, load15: 0.6, tcpEstab: 142,
    },
    timestamp: Date.now(),
  };
}

function buildDemoServices(): ServiceResult[] {
  return [
    { name: "radarr",      up: true, configured: true, lines: ["1,247 movies (8.2 TB)", "12 missing cutoff", "2 in queue"], pct: 94, queueItems: [{ title: "Dune: Part Three", pct: 67, etaSec: 1200 }] },
    { name: "sonarr",      up: true, configured: true, lines: ["186 series (4.1 TB)", "3 missing episodes"], pct: 98, queueItems: [{ title: "The Bear S04E08", pct: 23, etaSec: 3600 }] },
    { name: "bazarr",      up: true, configured: true, lines: ["1,198 synced", "8 wanted"] },
    { name: "tautulli",    up: true, configured: true, lines: ["1 stream active", "47 plays this week"], streams: [{ title: "Shogun S02E04", progress: 0.45, user: "nauman" }], weekly: { plays: 47, topShow: "Shogun", topUser: "nauman" } },
    { name: "qbittorrent", up: true, configured: true, lines: ["2.4 ratio overall", "↓ 12.3 MB/s · ↑ 4.1 MB/s"], pct: 78, queueItems: [{ title: "ubuntu-24.04.iso", pct: 78, etaSec: 900 }, { title: "archlinux-2024.iso", pct: 34, etaSec: 2400 }] },
    { name: "overseerr",   up: true, configured: true, lines: ["12 pending requests", "3 processing"] },
    { name: "prowlarr",    up: true, configured: true, lines: ["8 indexers active", "23,411 grabs total"] },
    { name: "pihole",      up: true, configured: true, lines: ["16,173 queries today", "22% blocked", "Top: ads.tracker.com"], pct: 22 },
    { name: "nginx",       up: true, configured: true, lines: ["14 proxy hosts", "SSL certs: 14 valid"] },
    { name: "uptimekuma",  up: true, configured: true, lines: ["24 monitors", "All up"], downCount: 0 },
  ] as ServiceResult[];
}

export default function Dashboard() {
  const [metrics,      setMetrics]      = useState<Metrics | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [lastUpdated,  setLastUpdated]  = useState<string>("");
  const [mounted,      setMounted]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [settings,     setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings,   setShowSettings]   = useState(false);
  const [expandedCard,   setExpandedCard]   = useState<string | null>(null);
  const [showHealth,     setShowHealth]     = useState(true);
  const [showBookmarks,  setShowBookmarks]  = useState(true);
  const [editBookmarks,  setEditBookmarks]  = useState(false);
  const [bookmarkDraft,  setBookmarkDraft]  = useState<BookmarkColumn[] | null>(null);
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cpuHistory,     setCpuHistory]     = useState<number[]>([]);
  const [memHistory,     setMemHistory]     = useState<number[]>([]);
  const [gpuHistory,     setGpuHistory]     = useState<number[]>([]);
  const [gpuTempHistory, setGpuTempHistory] = useState<number[]>([]);
  const [rxHistory,      setRxHistory]      = useState<number[]>([]);
  const [txHistory,      setTxHistory]      = useState<number[]>([]);


  const [weather,            setWeather]            = useState<{ temp: number | null; condition: string | null; forecast?: ForecastDay[] } | null>(null);
  const [services,           setServices]           = useState<ServiceResult[] | null>(null);
  const [servicesLoading,    setServicesLoading]    = useState(true);
  const [servicesUpdatedAt,  setServicesUpdatedAt]  = useState<number | null>(null);
  const [activityEvents,     setActivityEvents]     = useState<ActivityEvent[]>([]);
  const [activityLoading,    setActivityLoading]    = useState(true);
  const [clientConfig,       setClientConfig]       = useState<ClientConfig | null>(null);
  const [speedtestResults,    setSpeedtestResults]    = useState<SpeedtestResult[]>([]);
  const [speedtestLoading,    setSpeedtestLoading]    = useState(true);
  const [speedtestHistory,    setSpeedtestHistory]    = useState<number[]>([]);
  const [speedtestTotalTests, setSpeedtestTotalTests] = useState<number | null>(null);
  const [clockDate,        setClockDate]        = useState("");
  const [clockTime,        setClockTime]        = useState("");

  const demoMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";

  useEffect(() => { setMounted(true); }, []);

  // Demo mode — seed with fake data so users can preview the dashboard
  useEffect(() => {
    if (!demoMode) return;
    setMetrics(buildDemoMetrics());
    setLoading(false);
    setServices(buildDemoServices());
    setServicesLoading(false);
    setCpuHistory([38, 41, 35, 42, 44, 39, 40, 43, 42, 38, 36, 42]);
    setMemHistory([52, 53, 51, 54, 53, 55, 54, 52, 53, 55, 54, 53]);
    setGpuHistory([22, 25, 28, 30, 26, 24, 28, 31, 27, 25, 28, 28]);
    setGpuTempHistory([48, 49, 50, 51, 52, 51, 50, 52, 53, 52, 51, 52]);
    setRxHistory([20e6, 22e6, 18e6, 24e6, 21e6, 25e6, 23e6, 24e6, 22e6, 24e6]);
    setTxHistory([2.5e6, 3e6, 2.8e6, 3.2e6, 2.9e6, 3.5e6, 3.1e6, 3.2e6, 2.7e6, 3.2e6]);
    setWeather({ temp: 18, condition: "Partly cloudy", forecast: [
      { date: "2026-05-13", high: 20, low: 12, code: 2, condition: "Partly cloudy", emoji: "⛅" },
      { date: "2026-05-14", high: 17, low: 10, code: 61, condition: "Light rain", emoji: "🌧️" },
      { date: "2026-05-15", high: 22, low: 13, code: 0, condition: "Clear sky", emoji: "☀️" },
    ] });
    setSpeedtestResults([
      { ping: 8.2, download: 450, upload: 42, created_at: new Date().toISOString(), timestamp: null, isp: "Telstra", jitter: 1.2, serverName: "Sydney", serverLocation: "Sydney, AU", serverHost: "speedtest.syd.example.com" },
      { ping: 9.1, download: 440, upload: 40, created_at: new Date(Date.now() - 3600000).toISOString(), timestamp: null, isp: "Telstra", jitter: 1.5, serverName: "Sydney", serverLocation: "Sydney, AU", serverHost: "speedtest.syd.example.com" },
    ]);
    setSpeedtestLoading(false);
    setSpeedtestHistory([430, 445, 450, 440, 455, 448, 450]);
    setSpeedtestTotalTests(142);
    setActivityEvents([
      { type: "grabbed", title: "The Bear S04E08", source: "sonarr", timestamp: Date.now() - 300000, subtitle: "WEBDL-1080p" },
      { type: "imported", title: "Dune: Part Two", source: "radarr", timestamp: Date.now() - 1200000, subtitle: "Bluray-2160p" },
      { type: "watched", title: "Shogun S02E04", source: "tautulli", timestamp: Date.now() - 60000, subtitle: "nauman" },
    ]);
    setActivityLoading(false);
  }, [demoMode]);

  // Persist settings to localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettings(s => ({ ...s, ...parsed }));
      }
    } catch { /* corrupt or empty — use defaults */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota exceeded — ignore */ }
  }, [settings]);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    THEMES.forEach(t => root.classList.remove(`theme-${t.key}`));
    if (settings.theme && settings.theme !== "midnight") {
      root.classList.add(`theme-${settings.theme}`);
    }
  }, [settings.theme]);

  const fetchMetrics = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Metrics = await res.json();
      setMetrics(data);
      if (data.cpu != null) setCpuHistory(h => [...h, data.cpu!].slice(-MAX_HISTORY));
      const realUsed = data.memory.total != null && data.memory.available != null
        ? Math.max(0, data.memory.total - data.memory.available - (data.memory.sReclaimable ?? 0)) : null;
      setMemHistory(h => [...h, pct(realUsed, data.memory.total)].slice(-MAX_HISTORY));
      if (data.gpu?.utilization != null) setGpuHistory(h => [...h, data.gpu.utilization!].slice(-MAX_HISTORY));
      if (data.gpu?.temperature != null) setGpuTempHistory(h => [...h, data.gpu.temperature!].slice(-MAX_HISTORY));
      setRxHistory(h => [...h, data.network.rxBytesPerSec ?? 0].slice(-MAX_HISTORY));
      setTxHistory(h => [...h, data.network.txBytesPerSec ?? 0].slice(-MAX_HISTORY));
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
      setTimeout(() => setRefreshing(false), 800);
    }
  }, []);


  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch("/api/services", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(data.services ?? null);
      setServicesUpdatedAt(Date.now());
    } catch {
      setServices(null);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const events: ActivityEvent[] = Array.isArray(data.events) ? data.events : [];
      setActivityEvents(events);
    } catch {
      // leave previous events in place — empty only on first failure
      setActivityEvents(prev => prev);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const fetchSpeedtest = useCallback(async () => {
    try {
      const res = await fetch("/api/speedtest", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw: SpeedtestRaw[] = data.results ?? [];
      setSpeedtestResults(raw.map(normalizeSpeedResult));
      if (Array.isArray(data.history))    setSpeedtestHistory(data.history);
      if (data.totalTests != null)        setSpeedtestTotalTests(data.totalTests);
    } catch {
      setSpeedtestResults([]);
    } finally {
      setSpeedtestLoading(false);
    }
  }, []);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.error) setWeather({ temp: data.temp, condition: data.condition, forecast: data.forecast ?? [] });
    } catch {
      // weather is non-critical; fail silently
    }
  }, []);

  // Clock — updates every second, respects timezone setting
  useEffect(() => {
    function tick() {
      const now = new Date();
      const tz = settings.timezone || undefined; // "" → undefined = browser local
      const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
      const days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      // When a custom timezone is set, get the shifted day/date/month via Intl
      const parts  = new Intl.DateTimeFormat("en-US", { ...opts, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
      const get    = (t: string) => parts.find(p => p.type === t)?.value ?? "";
      if (tz) {
        setClockDate(`${get("weekday")} · ${get("day")} ${get("month")}`);
        setClockTime(`${get("hour")}:${get("minute")}:${get("second")}`);
      } else {
        const h = String(now.getHours()).padStart(2, "0");
        const m = String(now.getMinutes()).padStart(2, "0");
        const s = String(now.getSeconds()).padStart(2, "0");
        setClockDate(`${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]}`);
        setClockTime(`${h}:${m}:${s}`);
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [settings.timezone]);

  // Weather — fetch once on mount, refresh every 10 minutes
  useEffect(() => {
    if (demoMode) return;
    fetchWeather();
    const id = setInterval(fetchWeather, 600_000);
    return () => clearInterval(id);
  }, [fetchWeather, demoMode]);

  // Services — refresh every 3 seconds
  useEffect(() => {
    if (demoMode) return;
    fetchServices();
    const id = setInterval(fetchServices, 3_000);
    return () => clearInterval(id);
  }, [fetchServices, demoMode]);

  // Speedtest — refresh every 5 minutes
  useEffect(() => {
    if (demoMode) return;
    fetchSpeedtest();
    const id = setInterval(fetchSpeedtest, 300_000);
    return () => clearInterval(id);
  }, [fetchSpeedtest, demoMode]);

  // Activity feed — refresh every 60s (matches the route's cache TTL)
  useEffect(() => {
    if (demoMode) return;
    fetchActivity();
    const id = setInterval(fetchActivity, 60_000);
    return () => clearInterval(id);
  }, [fetchActivity, demoMode]);

  // Client config — fetched once on mount. Provides runtime values for the
  // bookmarks list, service URLs, mikrotik URL, and Grafana embed config so
  // the same image works for any user with their own env vars / bookmarks.json.
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((cfg: ClientConfig | null) => {
        if (!cfg) return;
        setClientConfig(cfg);
        // Seed preferences from server config if user hasn't customized locally yet
        if (cfg.preferences) {
          setSettings(prev => {
            const saved = localStorage.getItem(SETTINGS_KEY);
            const hasSavedEngine = saved && JSON.parse(saved).searchEngine;
            const hasSavedTz     = saved && JSON.parse(saved).timezone !== undefined;
            const hasSavedTheme  = saved && JSON.parse(saved).theme;
            return {
              ...prev,
              searchEngine: hasSavedEngine ? prev.searchEngine : (cfg.preferences!.searchEngine as SearchEngine) || prev.searchEngine,
              timezone:     hasSavedTz     ? prev.timezone     : cfg.preferences!.timezone ?? prev.timezone,
              theme:        hasSavedTheme  ? prev.theme        : (cfg.preferences!.theme as ThemeKey) || prev.theme,
            };
          });
        }
      })
      .catch(() => { /* keep clientConfig null; UI uses hardcoded fallbacks */ });
  }, []);

  // First-run redirect — send to /welcome when zero services are configured
  // and the user hasn't dismissed the welcome flow yet.
  useEffect(() => {
    if (demoMode) return;
    if (!services || servicesLoading) return;
    const configured = services.filter(s => s.configured !== false).length;
    if (configured === 0 && !localStorage.getItem("comexe:welcome-done")) {
      window.location.href = "/welcome";
    }
  }, [services, servicesLoading, demoMode]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (demoMode) return;
    fetchMetrics();
    intervalRef.current = setInterval(() => { fetchMetrics(); }, settings.refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMetrics, settings.refreshInterval, demoMode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") { setShowSettings(false); setExpandedCard(null); (e.target as HTMLElement)?.blur?.(); return; }
      if (isTyping) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); fetchMetrics(); }
      if (e.key === "g" || e.key === "G") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "h" || e.key === "H") setShowBookmarks(v => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fetchMetrics]);

  // derived
  const cpuPct      = pct(metrics?.cpu ?? null, 100);
  const memTotal    = metrics?.memory.total ?? null;
  const realMemUsed = memTotal != null && metrics?.memory.available != null
    ? Math.max(0, memTotal - metrics.memory.available - (metrics.memory.sReclaimable ?? 0)) : null;
  const realMemPct  = pct(realMemUsed, memTotal);
  const gpuUtil     = metrics?.gpu?.utilization ?? null;
  const gpuMemPct   = pct(metrics?.gpu?.memUsed ?? null, metrics?.gpu?.memTotal ?? null);
  const gpuPwrPct   = pct(metrics?.gpu?.powerDraw ?? null, metrics?.gpu?.powerLimit ?? null);
  const gpuColor    = gpuUtil != null ? gpuUtilColor(gpuUtil) : "#ef4444";

  const cpuAlert     = cpuAlertLevel(metrics?.cpu ?? null);
  const memAlert     = memAlertLevel(metrics?.memory.total ?? null, metrics?.memory.available ?? null, metrics?.memory.sReclaimable ?? null);
  const gpuTempAlert = gpuTempAlertLevel(metrics?.gpu?.temperature ?? null);
  const maxDiskAlert = worstAlert(metrics?.disks.map(d => diskAlertLevel(d.usedPct)) ?? []);
  const health       = computeHealth(metrics);

  function histStats(h: number[]) {
    if (!h.length) return { min: null as number | null, max: null as number | null, avg: null as number | null };
    return { min: Math.min(...h), max: Math.max(...h), avg: h.reduce((a, b) => a + b, 0) / h.length };
  }

  const isVisible  = (k: string) => settings.visibleCards[k] !== false;
  const toggleCard = (k: string) => setExpandedCard(e => e === k ? null : k);
  const du = settings.dataUnit;
  const tu = settings.tempUnit;

  return (
    <>
      {/* top loading bar */}
      <div className="fixed top-0 left-0 right-0 z-50" style={{ height: 2 }}>
        <div style={{
          height: "100%",
          background: "linear-gradient(90deg, var(--settings-active), var(--ok))",
          boxShadow: "0 0 8px var(--settings-active)66",
          transition: refreshing ? "width 0.5s ease" : "width 0.8s ease, opacity 0.5s ease 0.3s",
          width: refreshing ? "80%" : loading ? "35%" : "100%",
          opacity: (refreshing || loading) ? 1 : 0,
        }} />
      </div>
      {/* healthy state line — 2px cyan at very top */}
      {!loading && showHealth && health.status === "healthy" && mounted && (
        <div className="fixed top-0 left-0 right-0 z-40" style={{
          height: 2, background: "var(--brand)", boxShadow: "0 0 8px rgba(6,182,212,0.5)",
        }} />
      )}

      {/* Demo mode banner */}
      {demoMode && mounted && (
        <div className="fixed top-0 left-0 right-0 z-50 text-center" style={{
          background: "linear-gradient(90deg, #f59e0b, #f97316)",
          padding: "4px 0", fontSize: 11, fontWeight: 600, color: "#0a0c12",
          letterSpacing: "0.02em",
        }}>
          Demo mode — showing sample data.{" "}
          <span style={{ textDecoration: "underline", fontWeight: 700, cursor: "pointer" }}
            onClick={() => { window.location.href = "/"; }}>Exit demo</span>
        </div>
      )}

      {/* ── sticky frosted header ── */}
      <header className="fixed top-0 left-0 right-0 z-30" style={{
        background: "var(--header-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div className="max-w-5xl mx-auto px-6 py-2.5 flex items-center justify-between gap-4">
          {/* Left */}
          <div className="flex items-center gap-3 min-w-0">
            <span className="block w-2 h-2 rounded-full shrink-0"
              style={{ background: "var(--ok)", boxShadow: "0 0 6px #10b98166", animation: "pulseDot 2s ease-in-out infinite", "--dot-color": "#10b981" } as React.CSSProperties} />
            <Link href="/" className="flex items-center gap-2 shrink-0" style={{ textDecoration: "none" }}>
              {/* Minimalist ComExe brand mark — bare "CE" monogram, single-weight strokes, no fills. */}
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                <path d="M14 8 A 8 8 0 1 0 14 24" style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 8 L25 8"   style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 8 L19 24"  style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 16 L24 16" style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 24 L25 24" style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
              </svg>
              <h1 className="font-mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
                Com<span style={{ color: "var(--brand)" }}>Exe</span>
              </h1>
            </Link>
            <span className="shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--border-bright)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.04em" }}>
              truenas · :30104
            </span>
            {metrics?.uptime != null && (
              <span className="flex items-center gap-1.5 shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--border-bright)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--text-secondary)" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {fmtUptime(metrics.uptime)}
                <span style={{ color: "var(--text-faint)" }}>·</span>
                <span style={{ color: "var(--text-label)", fontSize: 10 }}>{fmtSince(metrics.uptime)}</span>
              </span>
            )}
            {weather && (
              <span className="shrink-0 hidden sm:inline" style={{ position: "relative" }}>
                <span
                  className="peer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "var(--surface)", border: "1px solid var(--border-bright)",
                    borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--text-secondary)",
                    cursor: weather.forecast?.length ? "default" : undefined,
                  }}
                >
                  {weather.temp != null ? `${tu === "F" ? `${(weather.temp * 9/5 + 32).toFixed(0)}°F` : `${weather.temp.toFixed(0)}°C`}` : ""}
                  {weather.condition ? ` · ${weather.condition}` : ""}
                  {weather.forecast?.length ? (
                    <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.4 }}><path d="M2 3l2 2.5L6 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : null}
                </span>
                {/* 3-day forecast popup on hover */}
                {weather.forecast && weather.forecast.length > 0 && (
                  <div
                    className="absolute left-0 opacity-0 pointer-events-none peer-hover:opacity-100 peer-hover:pointer-events-auto hover:opacity-100 hover:pointer-events-auto"
                    style={{
                      top: "calc(100% + 6px)", zIndex: 50, minWidth: 200,
                      background: "var(--settings-bg)", border: "1px solid var(--border-mid)",
                      borderRadius: 10, padding: "10px 12px",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--text-label)", marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>3-Day Forecast</div>
                    <div className="flex flex-col gap-1.5">
                      {weather.forecast.map((d, i) => (
                        <div key={i} className="flex items-center justify-between gap-4" style={{ fontSize: 12 }}>
                          <span style={{ color: "var(--text-muted)", minWidth: 28 }}>{d.date}</span>
                          <span style={{ fontSize: 14 }}>{d.emoji}</span>
                          <span className="flex-1" style={{ color: "var(--text-label)", fontSize: 10 }}>{d.condition}</span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {tu === "F" ? `${Math.round(d.high * 9/5 + 32)}°` : `${d.high}°`}
                          </span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--text-faint)" }}>
                            {tu === "F" ? `${Math.round(d.low * 9/5 + 32)}°` : `${d.low}°`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </span>
            )}
          </div>
          {/* Right */}
          <div className="flex items-center gap-3 shrink-0">
            {clockDate && (
              <div className="flex flex-col items-end leading-tight">
                <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "inherit" }}>{clockDate}</span>
                <span className="font-mono tabular-nums" style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{clockTime}</span>
              </div>
            )}
            {error && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.1)", color: "var(--critical)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </span>
            )}
            <span className="block w-1.5 h-1.5 rounded-full"
              style={{
                background: error ? "#ef4444" : loading ? "rgba(255,255,255,0.2)" : "#10b981",
                boxShadow: error ? "0 0 6px #ef444466" : !loading ? "0 0 6px #10b98166" : "none",
                animation: !error && !loading ? "pulseDot 2s ease-in-out infinite" : "none",
              }} />
            <button
              title="Open TrueNAS"
              onClick={() => window.open("http://192.168.88.196", "_blank")}
              style={{ color: "var(--text-ghost)", background: "none", border: "none", cursor: "pointer", padding: 2, transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#06b6d4")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
            ><IconTrueNAS /></button>
            <button
              onClick={() => setShowSettings(v => !v)}
              style={{ color: showSettings ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 2, transition: "color 0.2s" }}
            ><IconGear /></button>
          </div>
        </div>
      </header>

      <main
        className="w-full min-h-screen"
        style={{
          background: "var(--bg)",
          backgroundImage: "radial-gradient(ellipse at 50% 0%, var(--bg-gradient) 0%, transparent 65%)",
          fontFamily: "'Inter', system-ui, sans-serif",
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s ease-out",
        }}
      >
        <div className="max-w-5xl mx-auto px-6 pb-10 flex flex-col gap-6" style={{ paddingTop: 80 }}>


          {/* ── search bar ── */}
          <SearchBar inputRef={searchInputRef} engine={settings.searchEngine} />

          {/* ── mikrotik tab ── */}
          <MikrotikTab mikrotikUrl={clientConfig?.mikrotikUrl ?? "http://192.168.88.1"} />

          {/* ── status banner ── */}
          {!loading && showHealth && health.status !== "healthy" && (
            <StatusBanner result={health} visible={mounted} />
          )}

          {/* ── first-run setup banner — only when very few services are configured ── */}
          {services && (() => {
            const configuredCount = services.filter(s => s.configured !== false).length;
            const totalCount      = services.length;
            if (configuredCount >= 3 || configuredCount === totalCount) return null;
            const missingCount = totalCount - configuredCount;
            return (
              <div className="flex items-center gap-3 flex-wrap" style={{
                background: "rgba(6,182,212,0.05)",
                border: "1px solid rgba(6,182,212,0.2)",
                borderRadius: 10,
                padding: "10px 14px",
              }}>
                <span style={{ color: "var(--brand)", fontSize: 14 }}>👋</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
                  Welcome — {configuredCount === 0 ? "no services configured yet" : `only ${configuredCount} of ${totalCount} services configured`}.
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {missingCount === 1 ? "1 service is" : `${missingCount} services are`} missing config. Try the{" "}
                  <a href="/setup" style={{ color: "var(--brand)", textDecoration: "underline", fontWeight: 600 }}>
                    setup wizard
                  </a>{" "}
                  to fill in URLs / API keys with live connection-testing, or check{" "}
                  <a href="https://github.com/syedhashmi-bit/ComExe/blob/main/INSTALL.md" target="_blank" rel="noopener noreferrer"
                    style={{ color: "rgba(6,182,212,0.7)", textDecoration: "underline" }}>
                    INSTALL.md
                  </a>.
                </span>
              </div>
            );
          })()}

          {/* ── grid ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">

            {/* CPU */}
            {isVisible("cpu") && (
              <Card label="cpu" accent="var(--accent-cpu)"
                subtitle={!loading ? (metrics?.sysInfo?.cpuModel ?? undefined) : undefined}
                alertLevel={cpuAlert} icon={<IconCPU />}
                animDelay={0} expanded={expandedCard === "cpu"} onToggle={() => toggleCard("cpu")}>
                <div className="flex items-end justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <BigValue value={fmtPct(metrics?.cpu ?? null)} loading={loading} />
                    {!loading && metrics?.cpu != null && (
                      <TrendDelta history={cpuHistory} current={metrics.cpu} goodDirection="down" suffix="%" />
                    )}
                  </div>
                  {!loading && (
                    <div className="flex flex-wrap gap-1 mb-1 justify-end">
                      {metrics?.sysInfo?.cpuCores != null && (
                        <span className="tabular-nums" style={{
                          background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)",
                          borderRadius: 5, padding: "2px 7px", fontSize: 10, color: "var(--brand)",
                        }}>{metrics.sysInfo.cpuCores} cores</span>
                      )}
                      {metrics?.sysInfo?.cpuFreqGhz != null && (
                        <span className="tabular-nums font-mono" style={{
                          background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.18)",
                          borderRadius: 5, padding: "2px 7px", fontSize: 10, color: "rgba(6,182,212,0.8)",
                        }}>@ {metrics.sysInfo.cpuFreqGhz.toFixed(2)} GHz</span>
                      )}
                    </div>
                  )}
                </div>
                <Sparkline data={cpuHistory} color={barColor(cpuPct)} height={48} />
                <GaugeBar percent={cpuPct} color={barColor(cpuPct)}
                  gradient={`linear-gradient(90deg, #0891b2, #06b6d4 60%, ${barColor(cpuPct)})`} />
                {!loading && (metrics?.sysInfo?.load1 != null) && (
                  <span className="text-[10px] tabular-nums font-mono" style={{ color: "var(--text-faint)" }}>
                    Load: {metrics.sysInfo.load1?.toFixed(2)} · {metrics.sysInfo.load5?.toFixed(2)} · {metrics.sysInfo.load15?.toFixed(2)}
                  </span>
                )}
                {expandedCard === "cpu" && (() => {
                  const s = histStats(cpuHistory);
                  return (
                    <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                      <StatRow label="min" value={s.min != null ? fmtPct(s.min) : "—"} />
                      <StatRow label="max" value={s.max != null ? fmtPct(s.max) : "—"} />
                      <StatRow label="avg" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                    </div>
                  );
                })()}
              </Card>
            )}

            {/* Memory */}
            {isVisible("memory") && (
              <Card label="memory" accent="var(--accent-memory)" alertLevel={memAlert} icon={<IconMemory />}
                animDelay={50} expanded={expandedCard === "memory"} onToggle={() => toggleCard("memory")}>
                {loading ? <Skeleton /> : (
                  <>
                    <ThreeSegmentDonut
                      usedBytes={realMemUsed ?? 0}
                      cacheBytes={metrics?.memory.sReclaimable ?? 0}
                      freeBytes={metrics?.memory.available ?? 0}
                      totalBytes={memTotal ?? 0}
                      du={du}
                    />
                    {realMemPct > 0 && (
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                          actual pressure: {realMemPct.toFixed(1)}%
                        </span>
                        <TrendDelta history={memHistory} current={realMemPct} goodDirection="down" suffix="%" />
                      </div>
                    )}
                    {expandedCard === "memory" && (() => {
                      const s = histStats(memHistory);
                      return (
                        <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                          <StatRow label="total"    value={fmtBytes(memTotal, 1, du)} />
                          <StatRow label="min used" value={s.min != null ? fmtPct(s.min) : "—"} />
                          <StatRow label="max used" value={s.max != null ? fmtPct(s.max) : "—"} />
                          <StatRow label="avg used" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                        </div>
                      );
                    })()}
                  </>
                )}
              </Card>
            )}

            {/* Filesystems */}
            {isVisible("filesystems") && (
              <Card label="filesystems" accent="var(--accent-fs)" alertLevel={maxDiskAlert} icon={<IconDisk />}
                animDelay={100} expanded={expandedCard === "filesystems"} onToggle={() => toggleCard("filesystems")}>
                {loading ? <Skeleton /> : !metrics?.disks.length ? (
                  <span className="text-xs" style={{ color: "var(--settings-text)" }}>no filesystems found</span>
                ) : (() => {
                  const PREFIX = "/mnt/Pool/Media/";
                  const folderName = (mp: string) => mp.startsWith(PREFIX) ? mp.slice(PREFIX.length) : (mp.split("/").pop() ?? mp);
                  const fsBarColor = (p: number) => p > 85 ? "#ef4444" : p > 70 ? "#f59e0b" : "#10b981";
                  const sorted = [...metrics.disks].sort((a, b) => b.usedPct - a.usedPct);
                  const poolUsed  = metrics.pool?.used  ?? null;
                  const poolTotal = metrics.pool?.total ?? null;
                  const poolPct   = poolTotal != null && poolUsed != null && poolTotal > 0
                    ? (poolUsed / poolTotal) * 100 : null;
                  const poolColor = poolPct == null ? "#666" : fsBarColor(poolPct);
                  return (
                    <div className="flex flex-col gap-3">
                      {/* Pool hero — overall fullness */}
                      {poolTotal != null && poolUsed != null && (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono tabular-nums" style={{ fontSize: 26, fontWeight: 600, color: "var(--text)", lineHeight: 1.1, letterSpacing: "-0.01em" }}>
                                {fmtBytes(poolUsed, 1, du)}
                              </span>
                              <span className="text-[10px]" style={{ color: "var(--text-label)" }}>
                                of {fmtBytes(poolTotal, 1, du)}
                              </span>
                            </div>
                            {poolPct != null && (
                              <span className="font-mono tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: poolColor }}>
                                {poolPct.toFixed(0)}%
                              </span>
                            )}
                          </div>
                          <div className="rounded-full overflow-hidden" style={{ background: "var(--card-hover)", height: 6 }}>
                            <div className="h-full rounded-full transition-all duration-700" style={{
                              width: `${poolPct ?? 0}%`,
                              background: `linear-gradient(90deg, ${poolColor}99, ${poolColor})`,
                              boxShadow: `0 0 8px ${poolColor}55`,
                            }} />
                          </div>
                        </div>
                      )}

                      {/* Per-mount list — tighter rows, sorted by % so the fullest is on top */}
                      <div className="flex flex-col" style={{
                        overflowY: sorted.length > 4 ? "auto" : "visible",
                        maxHeight: sorted.length > 4 ? 220 : undefined,
                      }}>
                        {sorted.map((disk, idx) => {
                          const name = folderName(disk.mountpoint);
                          const barC = fsBarColor(disk.usedPct);
                          return (
                            <div key={disk.mountpoint} className="flex flex-col gap-1"
                              style={{ padding: "5px 0", borderTop: idx > 0 ? "1px solid var(--border-dim)" : "none" }}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span style={{ color: "var(--warn)", opacity: 0.55, flexShrink: 0 }}><IconFolder /></span>
                                  <span className="text-[11px] font-medium truncate" style={{ color: "var(--text-mid)" }}>{name}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[9px] tabular-nums font-mono" style={{ color: "var(--text-faint)" }}>
                                    {fmtBytes(disk.used, 1, du)}
                                  </span>
                                  <span className="tabular-nums font-mono font-semibold" style={{ fontSize: 10, color: barC, minWidth: "2.5ch", textAlign: "right" }}>
                                    {disk.usedPct.toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                              <div className="rounded-full overflow-hidden" style={{ background: "var(--card-hover)", height: 4 }}>
                                <div className="h-full rounded-full transition-all duration-700"
                                  style={{ width: `${disk.usedPct}%`, background: barC, boxShadow: `0 0 4px ${barC}55` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </Card>
            )}

            {/* Network */}
            {isVisible("network") && (
              <Card label="network" accent="var(--accent-network)" icon={<IconNetwork />}
                animDelay={150} expanded={expandedCard === "network"} onToggle={() => toggleCard("network")}>
                {!loading && metrics?.network?.interfaceName && (
                  <span className="self-start font-mono" style={{
                    background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
                    borderRadius: 4, padding: "2px 7px", fontSize: 9, color: "var(--accent-network)",
                  }}>{metrics.network.interfaceName}</span>
                )}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold" style={{ color: "var(--accent-network)" }}>↓</span>
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>rx</span>
                    <span className="text-xs font-medium tabular-nums ml-auto font-mono" style={{ color: "var(--text-secondary)" }}>
                      {loading ? "—" : `${fmtBytes(metrics?.network.rxBytesPerSec ?? null, 1, du)}/s`}
                    </span>
                  </div>
                  <Sparkline data={rxHistory} color="#3b82f6" autoMax height={50} />
                  <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--text-faint)" }}>
                    ↓ {fmtBytes(metrics?.network.rxBytesTotal ?? null, 1, du)} total
                  </span>
                </div>
                <div style={{ height: 1, background: "var(--surface-bright)" }} />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold" style={{ color: "var(--warn)" }}>↑</span>
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>tx</span>
                    <span className="text-xs font-medium tabular-nums ml-auto font-mono" style={{ color: "var(--text-secondary)" }}>
                      {loading ? "—" : `${fmtBytes(metrics?.network.txBytesPerSec ?? null, 1, du)}/s`}
                    </span>
                  </div>
                  <Sparkline data={txHistory} color="#f59e0b" autoMax height={50} />
                  <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--text-faint)" }}>
                    ↑ {fmtBytes(metrics?.network.txBytesTotal ?? null, 1, du)} total
                  </span>
                </div>
                {!loading && metrics?.sysInfo?.tcpEstab != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>tcp</span>
                    <span className="text-[11px] tabular-nums font-mono font-medium" style={{ color: "var(--text-muted)" }}>
                      {metrics.sysInfo.tcpEstab} established
                    </span>
                  </div>
                )}
                {expandedCard === "network" && rxHistory.length > 0 && (
                  <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                    <StatRow label="peak rx" value={`${fmtBytes(Math.max(...rxHistory), 1, du)}/s`} />
                    <StatRow label="peak tx" value={`${fmtBytes(Math.max(...txHistory), 1, du)}/s`} />
                  </div>
                )}
              </Card>
            )}

            {/* GPU */}
            {isVisible("gpu") && (
              <Card label="gpu" accent={gpuColor} alertLevel={gpuTempAlert} icon={<IconGPU />}
                animDelay={200} expanded={expandedCard === "gpu"} onToggle={() => toggleCard("gpu")}>
                {loading ? <Skeleton /> : (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="relative flex items-center justify-center shrink-0" style={{ width: 88, height: 88 }}>
                        <RadialGauge percent={gpuUtil ?? 0} color={gpuColor} size={88} />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="font-medium tabular-nums font-mono" style={{ fontSize: 22, lineHeight: 1, color: "var(--text)" }}>
                            {gpuUtil != null ? gpuUtil.toFixed(0) : "—"}
                          </span>
                          <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>%</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                        {metrics?.gpu?.name && (
                          <span className="text-[10px] font-medium truncate" style={{ color: "var(--brand)" }}>{metrics.gpu.name}</span>
                        )}
                        {metrics?.gpu?.temperature != null && (
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium tabular-nums font-mono"
                              style={{ fontSize: 22, lineHeight: 1, color: tempColor(metrics.gpu.temperature), transition: "color 0.3s ease" }}>
                              {fmtTemp(metrics.gpu.temperature, tu)}
                            </span>
                            <TrendDelta history={gpuTempHistory} current={metrics.gpu.temperature} goodDirection="down" suffix="°" precision={0} threshold={1} />
                          </div>
                        )}
                        {metrics?.gpu?.powerDraw != null && (
                          <span className="text-[10px] tabular-nums" style={{ color: "var(--text-label)" }}>
                            {metrics.gpu.powerDraw.toFixed(1)} W
                          </span>
                        )}
                      </div>
                    </div>
                    <LabeledBar
                      label="vram"
                      right={`${fmtBytes(metrics?.gpu?.memUsed ?? null, 1, du)} / ${fmtBytes(metrics?.gpu?.memTotal ?? null, 1, du)}`}
                      percent={gpuMemPct}
                      color="#a855f7"
                      gradient="linear-gradient(90deg, var(--accent-speedtest), #a855f7)"
                    />
                    {metrics?.gpu?.powerDraw != null && metrics?.gpu?.powerLimit != null && (
                      <LabeledBar
                        label="power"
                        right={`${metrics.gpu.powerDraw.toFixed(1)} / ${metrics.gpu.powerLimit.toFixed(0)} W`}
                        percent={gpuPwrPct}
                        color="#f59e0b"
                        gradient="linear-gradient(90deg, #ea580c, var(--warn))"
                      />
                    )}
                    {/* Tertiary tier: clocks + fan + ENC/DEC, all in one dim row.
                        ENC/DEC hidden when both are 0 (encode/decode idle). Pills
                        share a uniform muted style so the row doesn't look like a
                        fruit salad of brand colors. */}
                    {(() => {
                      const tertiaryItems: { label: string; value: string }[] = [];
                      if (metrics?.gpu?.coreClock != null) tertiaryItems.push({ label: "core", value: `${metrics.gpu.coreClock} MHz` });
                      if (metrics?.gpu?.memClock  != null) tertiaryItems.push({ label: "mem",  value: `${metrics.gpu.memClock} MHz`  });
                      if (metrics?.gpu?.fanSpeed  != null) tertiaryItems.push({ label: "fan",  value: `${metrics.gpu.fanSpeed}%`    });
                      const enc = metrics?.gpu?.encUtil ?? 0;
                      const dec = metrics?.gpu?.decUtil ?? 0;
                      if (enc > 0 || dec > 0) {
                        if (metrics?.gpu?.encUtil != null) tertiaryItems.push({ label: "enc", value: `${enc}%` });
                        if (metrics?.gpu?.decUtil != null) tertiaryItems.push({ label: "dec", value: `${dec}%` });
                      }
                      if (tertiaryItems.length === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1.5 pt-1" style={{ borderTop: "1px solid var(--border-dim)" }}>
                          {tertiaryItems.map(item => (
                            <span key={item.label} className="tabular-nums font-mono" style={{
                              background: "var(--card)",
                              border: "1px solid var(--border)",
                              borderRadius: 4, padding: "2px 7px", fontSize: 9,
                              color: "var(--text-dim)",
                              letterSpacing: "0.01em",
                            }}>
                              <span style={{ color: "var(--text-faint)", marginRight: 4 }}>{item.label}</span>
                              {item.value}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    {gpuTempHistory.length >= 2 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>temp history</span>
                        </div>
                        <Sparkline data={gpuTempHistory}
                          color={metrics?.gpu?.temperature != null ? tempColor(metrics.gpu.temperature) : "#555"}
                          autoMax height={28} />
                      </div>
                    )}
                    {expandedCard === "gpu" && (() => {
                      const s  = histStats(gpuHistory);
                      const ts = histStats(gpuTempHistory);
                      return (
                        <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                          <StatRow label="util min" value={s.min != null ? fmtPct(s.min) : "—"} />
                          <StatRow label="util max" value={s.max != null ? fmtPct(s.max) : "—"} />
                          <StatRow label="util avg" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                          <StatRow label="temp min" value={fmtTemp(ts.min ?? null, tu)} />
                          <StatRow label="temp max" value={fmtTemp(ts.max ?? null, tu)} />
                        </div>
                      );
                    })()}
                  </>
                )}
              </Card>
            )}

            {/* Speedtest — compact card, row 2 col 3 */}
            {isVisible("speedtest") && (
              <Card label="speedtest" accent="var(--accent-speedtest)" icon={<IconSpeedtest />}
                animDelay={250} externalLink="http://192.168.88.196:30220">
                {speedtestLoading ? <Skeleton /> : !speedtestResults.length ? (
                  <span className="text-xs" style={{ color: "var(--text-label)" }}>no data</span>
                ) : (() => {
                  const latest = speedtestResults[0];
                  const ts   = latest.timestamp ?? latest.created_at;
                  const diff = ts ? (Date.now() - new Date(ts).getTime()) / 1000 : null;
                  const rel  = diff == null ? null
                    : diff < 60    ? "just now"
                    : diff < 3600  ? `${Math.round(diff / 60)}m ago`
                    : diff < 86400 ? `${Math.round(diff / 3600)}h ago`
                    : `${Math.round(diff / 86400)}d ago`;
                  const dl = latest.download;
                  const quality = dl == null ? null
                    : dl >= 500 ? { label: "Excellent", color: "var(--ok)", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.3)" }
                    : dl >= 200 ? { label: "Good",      color: "var(--brand)", bg: "rgba(6,182,212,0.12)",  border: "rgba(6,182,212,0.3)"  }
                    : dl >= 50  ? { label: "Fair",      color: "var(--warn)", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)" }
                    :             { label: "Poor",      color: "var(--critical)", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)"  };
                  return (
                    <div className="flex flex-col gap-2.5">

                      {/* ISP / location / quality badge row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-0.5">
                          {latest.isp && (
                            <span className="text-[12px] font-semibold" style={{ color: "var(--text-mid)" }}>{latest.isp}</span>
                          )}
                          {latest.serverLocation && (
                            <span className="text-[10px]" style={{ color: "var(--text-label)" }}>{latest.serverLocation}</span>
                          )}
                          {latest.serverHost && (
                            <span className="text-[9px] font-mono truncate" style={{ color: "var(--text-ghost)", maxWidth: 160 }}>{latest.serverHost}</span>
                          )}
                        </div>
                        {quality && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0 mt-0.5"
                            style={{ color: quality.color, background: quality.bg, border: `1px solid ${quality.border}`, borderRadius: 5, padding: "2px 7px" }}>
                            {quality.label}
                          </span>
                        )}
                      </div>

                      {/* Big numbers: download + upload */}
                      <div className="flex items-end gap-4">
                        <div className="flex flex-col">
                          <span className="font-medium tabular-nums font-mono" style={{ fontSize: 44, lineHeight: 1, color: "var(--brand)" }}>
                            {dl != null ? dl.toFixed(0) : "—"}
                          </span>
                          <span className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-faint)" }}>Mbps ↓</span>
                        </div>
                        <div className="flex flex-col mb-[4px]">
                          <span className="font-medium tabular-nums font-mono" style={{ fontSize: 28, lineHeight: 1, color: "var(--warn)" }}>
                            {latest.upload != null ? latest.upload.toFixed(0) : "—"}
                          </span>
                          <span className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-faint)" }}>Mbps ↑</span>
                        </div>
                      </div>

                      {/* Ping · jitter on one line */}
                      {(latest.ping != null || latest.jitter != null) && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: "var(--ok)", boxShadow: "0 0 4px #10b98166" }} />
                          {latest.ping != null && (
                            <>
                              <span className="text-[11px] tabular-nums font-medium font-mono" style={{ color: "var(--ok)" }}>
                                {latest.ping < 10 ? latest.ping.toFixed(1) : latest.ping.toFixed(0)} ms
                              </span>
                              <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>ping</span>
                            </>
                          )}
                          {latest.jitter != null && (
                            <>
                              <span style={{ color: "var(--text-ghost)", fontSize: 9 }}>·</span>
                              <span className="text-[11px] tabular-nums font-medium font-mono" style={{ color: "var(--text-label)" }}>
                                {latest.jitter < 10 ? latest.jitter.toFixed(1) : latest.jitter.toFixed(0)} ms
                              </span>
                              <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>jitter</span>
                            </>
                          )}
                        </div>
                      )}

                      {/* Download history sparkline */}
                      {speedtestHistory.length >= 2 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>download history</span>
                          <Sparkline data={speedtestHistory} color="#8b5cf6" height={40} />
                        </div>
                      )}

                      {/* Footer: last tested + total count */}
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        {rel && (
                          <span className="text-[9px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                            auto-tested · {rel}
                          </span>
                        )}
                        {speedtestTotalTests != null && (
                          <span className="text-[9px] tabular-nums" style={{ color: "var(--text-ghost)" }}>
                            {speedtestTotalTests.toLocaleString()} tests recorded
                          </span>
                        )}
                      </div>

                    </div>
                  );
                })()}
              </Card>
            )}

            {/* Row 3: System + Grafana — each takes half of the 3-col width */}
            {(isVisible("system") || isVisible("grafana")) && (
              <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                {isVisible("system") && (
                  <Card label="system" accent="var(--accent-system)" icon={<IconTerminal />}
                    expanded={expandedCard === "system"} onToggle={() => toggleCard("system")}>
                    {loading ? <Skeleton /> : (
                      <div className="flex flex-col gap-0">
                        {([
                          { emoji: "🐧", label: "os",       value: metrics?.sysInfo?.os       ?? "—", mono: false },
                          { emoji: "⚙️", label: "kernel",   value: metrics?.sysInfo?.kernel   ?? "—", mono: true  },
                          { emoji: "🖥️", label: "arch",     value: metrics?.sysInfo?.arch     ?? "—", mono: false },
                          { emoji: "🌐", label: "host",     value: metrics?.sysInfo?.hostname ?? "—", mono: false },
                          { emoji: "⚡", label: "cores",    value: metrics?.sysInfo?.cpuCores != null ? `${metrics.sysInfo.cpuCores} cores` : "—", mono: false },
                          { emoji: "🕐", label: "up since", value: fmtSince(metrics?.uptime ?? null), mono: true  },
                        ] as { emoji: string; label: string; value: string; mono: boolean }[]).map(({ emoji, label, value, mono }, i, arr) => (
                          <div key={label}>
                            <div className="flex items-center gap-2 py-2">
                              <span style={{ fontSize: 13, width: 18, textAlign: "center", flexShrink: 0 }}>{emoji}</span>
                              <span className="text-[10px] uppercase tracking-widest shrink-0" style={{ color: "var(--text-faint)", minWidth: 46 }}>{label}</span>
                              <span className={`text-[11px] font-medium ml-auto truncate${mono ? " font-mono" : ""}`}
                                style={{ color: "var(--text-mid)" }}>{value}</span>
                            </div>
                            {i < arr.length - 1 && <div style={{ height: 1, background: "var(--surface-bright)" }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                {isVisible("grafana") && (
                  <GrafanaCard
                    baseUrl={clientConfig?.grafana.baseUrl ?? `http://${clientConfig?.truenasIp ?? "localhost"}:30037`}
                    panelUrl={clientConfig?.grafana.panelUrl ?? null}
                    panels={clientConfig?.grafana.panels}
                  />
                )}
              </div>
            )}

          </div>

          {/* ── NOW PLAYING banner ── */}
          {(() => {
            const tautulliSvc = services?.find(s => s.name === "tautulli");
            const streams = tautulliSvc?.streams ?? [];
            if (!streams.length) return null;
            return (
              <div style={{
                background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)",
                borderRadius: 14, padding: "14px 20px",
              }}>
                <div className="flex items-center gap-3 mb-3">
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", background: "var(--critical)", flexShrink: 0,
                    boxShadow: "0 0 6px #ef4444",
                    animation: "pulseDot 1.5s ease-in-out infinite",
                  }} />
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent-speedtest)" }}>
                    Now Playing · {streams.length} stream{streams.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {streams.map((st, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      {/* Title row */}
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-medium truncate" style={{ color: "var(--text-secondary)" }}>{st.title}</span>
                        {st.posStr && (
                          <span className="text-[10px] tabular-nums font-mono shrink-0" style={{ color: "var(--text-faint)" }}>{st.posStr}</span>
                        )}
                      </div>
                      {/* User row */}
                      <div className="flex items-center gap-1">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-faint)", flexShrink: 0 }}>
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span style={{ fontSize: 11, color: "var(--text-label)" }}>{st.user}</span>
                      </div>
                      {/* Progress bar */}
                      <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2 }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          width: `${Math.min(100, st.progress)}%`,
                          background: "linear-gradient(90deg, var(--accent-speedtest), #a78bfa)",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── activity feed (rolling ticker of recent grabs / streams) ── */}
          {isVisible("activity") && (
            <ActivityFeed events={activityEvents} loading={activityLoading} />
          )}

          {/* ── services (full width) ── */}
          {isVisible("services") && (
            <div className="flex flex-col gap-4" style={{ background: "var(--surface-dim)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20 }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ color: "var(--accent-speedtest)", opacity: 0.8 }}><IconServices /></span>
                <span className="text-[10px] uppercase" style={{ color: "var(--text-label)", letterSpacing: "0.15em" }}>services</span>
                {services && (() => {
                  // Only count services the user has actually configured. Unconfigured ones
                  // are listed in Settings → Connections, not in the visible card grid.
                  const configured = services.filter(s => s.configured !== false);
                  if (configured.length === 0) return null;
                  return (
                    <span style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--ok)", fontWeight: 600 }}>
                      {configured.filter(s => s.up).length} / {configured.length} online
                    </span>
                  );
                })()}
                {servicesUpdatedAt != null && (() => {
                  const sec = Math.round((Date.now() - servicesUpdatedAt) / 1000);
                  const rel = sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)}m ago`;
                  return <span className="text-[9px] ml-auto" style={{ color: "var(--text-ghost)" }}>updated {rel}</span>;
                })()}
              </div>
              {servicesLoading ? <Skeleton /> : !services ? (
                <span style={{ fontSize: 12, color: "var(--text-label)" }}>unavailable</span>
              ) : (
                <div className="flex flex-col gap-5">
                  {SVC_CATEGORIES.map(cat => {
                    const catCards = cat.services
                      .map(svcName => services.find(s => s.name === svcName))
                      .filter((s): s is NonNullable<typeof s> => Boolean(s))
                      // Hide cards for services whose required env var(s) aren't set.
                      // Those still show up in the Connections section of Settings,
                      // so the user can find them and configure them.
                      .filter(s => s.configured !== false);
                    if (catCards.length === 0) return null;
                    const upCount = catCards.filter(s => s.up).length;
                    const allUp = upCount === catCards.length;
                    return (
                      <div key={cat.id} className="flex flex-col gap-3">
                        {/* Category header with accent dot + brighter divider */}
                        <div className="flex items-center gap-3">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: cat.accent, boxShadow: `0 0 6px ${cat.accent}88` }} />
                          <span className="text-[10px] uppercase" style={{ color: "var(--text-dim)", letterSpacing: "0.22em", fontWeight: 700 }}>
                            {cat.label}
                          </span>
                          <span style={{ flex: 1, height: 1, background: `linear-gradient(to right, ${cat.accent}33, transparent 70%)` }} />
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            color: allUp ? "#10b981" : "rgba(255,255,255,0.45)",
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {upCount}/{catCards.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                          {[...catCards].sort((a, b) => {
                            // Health-priority sort within each category. Stable: services
                            // with the same priority preserve route-array order.
                            // Tier:  0 = down  •  1 = error  •  2 = warning
                            //        3 = active (queue/stream/<100%)  •  4 = idle
                            const tier = (s: ServiceResult) => {
                              if (!s.up)                         return 0;
                              if ((s.health?.error   ?? 0) > 0)  return 1;
                              if ((s.health?.warning ?? 0) > 0)  return 2;
                              const hasQ = (s.queueItems?.length ?? 0) > 0 || s.queueItem;
                              const hasS = (s.streams?.length    ?? 0) > 0;
                              if (hasQ || hasS)                  return 3;
                              return 4;
                            };
                            return tier(a) - tier(b);
                          }).map(({ name, up, lines, pct: svcPct, downCount, queueItem, queueItems, streams: svcStreams, health }) => {
                            const color = SVC_COLORS[name] ?? "#666";
                            const icon  = SVC_ICONS[name]  ?? "";
                            const label = SVC_LABELS[name]  ?? name;
                            const url   = clientConfig?.serviceUrls?.[name] ?? SVC_URLS[name];
                            const stripeColor = up ? color : "rgba(255,255,255,0.12)";
                            return (
                              <div key={name}
                                className="flex flex-col cursor-pointer relative overflow-hidden"
                                onClick={() => url && window.open(url, "_blank")}
                                onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                                onMouseUp={e => (e.currentTarget.style.transform = "translateY(-3px)")}
                                style={{
                                  background: up
                                    ? `radial-gradient(ellipse at top, ${color}1a 0%, transparent 55%), rgba(255,255,255,0.03)`
                                    : "rgba(255,255,255,0.03)",
                                  border: "1px solid var(--border-subtle)",
                                  borderRadius: 12, padding: 0,
                                  minHeight: 140,
                                  transition: "transform 0.15s, border-color 0.15s, box-shadow 0.2s",
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.transform = "translateY(-3px)";
                                  e.currentTarget.style.borderColor = up ? `${color}55` : "rgba(255,255,255,0.18)";
                                  if (up) e.currentTarget.style.boxShadow = `0 10px 30px ${color}33, 0 0 0 1px ${color}33 inset`;
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.transform = "translateY(0)";
                                  e.currentTarget.style.borderColor = "var(--border-subtle)";
                                  e.currentTarget.style.boxShadow = "none";
                                }}
                              >
                                {/* Brand accent stripe — gradient bar with glow */}
                                <div style={{
                                  height: 3,
                                  background: `linear-gradient(90deg, ${stripeColor} 0%, ${stripeColor}88 60%, ${stripeColor}33 100%)`,
                                  boxShadow: up ? `0 0 8px ${color}77` : "none",
                                }} />

                                {/* Card body */}
                                <div className="flex flex-col gap-2" style={{ padding: "13px 14px 14px" }}>
                                  <div className="flex items-center justify-between gap-2">
                                    <ServiceIcon src={icon} label={label} color={color} />
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {/* Health pill — only shown when /api/v3/health reported anything */}
                                      {up && health && (health.error > 0 || health.warning > 0) && (() => {
                                        const isError = health.error > 0;
                                        const accent  = isError ? "#ef4444" : "#f59e0b";
                                        const total   = health.error + health.warning;
                                        const label   = isError
                                          ? `${total} ${total === 1 ? "err" : "errs"}`
                                          : `${total} ${total === 1 ? "warn" : "warns"}`;
                                        return (
                                          <span style={{
                                            background: `${accent}1a`,
                                            border: `1px solid ${accent}55`,
                                            color: accent,
                                            borderRadius: 4, padding: "1px 5px",
                                            fontSize: 9, fontWeight: 700,
                                            textTransform: "uppercase", letterSpacing: "0.05em",
                                            fontVariantNumeric: "tabular-nums",
                                          }}>{label}</span>
                                        );
                                      })()}
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                        style={{
                                          background: up ? "#10b981" : "#ef4444",
                                          boxShadow: up ? "0 0 6px #10b981aa" : "0 0 4px #ef444455",
                                          animation: up ? "pulseDot 2s ease-in-out infinite" : "none",
                                        }} />
                                    </div>
                                  </div>
                                  <span style={{
                                    fontSize: 14, fontWeight: 700,
                                    color: up ? "#ffffff" : "rgba(255,255,255,0.3)",
                                    letterSpacing: "0.01em",
                                  }}>{label}</span>

                                  {/* Hero stat — first line gets headline treatment */}
                                  {up && lines[0] && <HeroStat line={lines[0]} keyPrefix={`${name}-h`} />}

                                  {/* Remaining lines — small muted */}
                                  {up && lines.slice(1).map((line, i) => (
                                    <span key={i} style={{
                                      color: name === "uptimekuma"
                                        ? ((downCount ?? 0) > 0 ? "#ef4444" : "#10b981")
                                        : name === "qbittorrent" && i === 0
                                        ? "#06b6d4"
                                        : "rgba(255,255,255,0.5)",
                                      fontSize: 11, lineHeight: 1.5, fontVariantNumeric: "tabular-nums",
                                    }}>{animatedLine(line, `${name}-${i + 1}`)}</span>
                                  ))}
                                  {!up && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                      <span style={{ fontSize: 10, color: "#ef4444" }}>offline</span>
                                      {url && (
                                        <span style={{ fontSize: 9, color: "var(--text-ghost)", lineHeight: 1.4 }}>
                                          Can&apos;t reach <code style={{ fontSize: 8, color: "var(--text-dim)" }}>{url.replace(/^https?:\/\//, "")}</code> — is the container running?
                                        </span>
                                      )}
                                    </div>
                                  )}
                                {/* Radarr: library completion + active download */}
                                {name === "radarr" && svcPct != null && up && (
                                  <GaugeBar percent={svcPct} color={svcPct > 90 ? "#10b981" : svcPct > 70 ? "#f59e0b" : "#ef4444"} thin />
                                )}
                                {(name === "radarr" || name === "sonarr" || name === "qbittorrent") && up && (queueItems?.length ?? 0) > 0 && (
                                  <div className="flex flex-col gap-1.5 mt-0.5">
                                    {queueItems!.slice(0, 3).map((q, qi) => {
                                      const c = name === "radarr" ? "#f59e0b" : name === "sonarr" ? "#3b82f6" : "#06b6d4";
                                      return (
                                        <div key={qi} className="flex flex-col gap-1">
                                          <div className="flex items-center gap-1.5">
                                            <span style={{
                                              fontSize: 10, fontWeight: 500, color: c,
                                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
                                            }}>↓ {cleanTitle(q.title)}</span>
                                            {fmtEtaShort(q.etaSec) && (
                                              <span style={{
                                                fontSize: 9, color: "var(--text-label)",
                                                fontVariantNumeric: "tabular-nums", flexShrink: 0,
                                              }}>{fmtEtaShort(q.etaSec)}</span>
                                            )}
                                          </div>
                                          <GaugeBar percent={q.pct} color={c} thin />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {/* Tautulli: active streams inline */}
                                {name === "tautulli" && svcStreams && svcStreams.length > 0 && up && (
                                  <div className="flex flex-col gap-2 mt-0.5">
                                    {svcStreams.slice(0, 3).map((st, si) => (
                                      <div key={si} className="flex flex-col gap-1">
                                        <span style={{
                                          fontSize: 12, color: "var(--text-muted)",
                                          fontStyle: "italic",
                                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>{st.title}</span>
                                        <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2 }}>
                                          <div style={{
                                            height: "100%", borderRadius: 2,
                                            width: `${Math.min(100, st.progress)}%`,
                                            background: "#8b5cf6",
                                            transition: "width 0.6s ease-out",
                                          }} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── bookmarks ── */}
          {showBookmarks && (() => {
            const columns = editBookmarks && bookmarkDraft ? bookmarkDraft : (clientConfig?.bookmarks ?? BOOKMARKS_FALLBACK);
            const updateDraft = (next: BookmarkColumn[]) => setBookmarkDraft(next);
            const startEdit = () => { setBookmarkDraft(JSON.parse(JSON.stringify(columns))); setEditBookmarks(true); };
            const cancelEdit = () => { setBookmarkDraft(null); setEditBookmarks(false); };
            const saveBookmarks = async () => {
              if (!bookmarkDraft) return;
              setBookmarkSaving(true);
              try {
                const res = await fetch("/api/bookmarks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookmarks: bookmarkDraft }) });
                if (res.ok) {
                  // Update client config with new bookmarks
                  if (clientConfig) setClientConfig({ ...clientConfig, bookmarks: bookmarkDraft });
                  setEditBookmarks(false); setBookmarkDraft(null);
                }
              } catch { /* ignore */ }
              setBookmarkSaving(false);
            };
            const addColumn = () => { if (!bookmarkDraft) return; updateDraft([...bookmarkDraft, { title: "New Section", accentColor: "#06b6d4", items: [] }]); };
            const removeColumn = (ci: number) => { if (!bookmarkDraft) return; updateDraft(bookmarkDraft.filter((_, i) => i !== ci)); };
            const addItem = (ci: number) => { if (!bookmarkDraft) return; const d = [...bookmarkDraft]; d[ci] = { ...d[ci], items: [...d[ci].items, { name: "", url: "", icon: "" }] }; updateDraft(d); };
            const removeItem = (ci: number, ii: number) => { if (!bookmarkDraft) return; const d = [...bookmarkDraft]; d[ci] = { ...d[ci], items: d[ci].items.filter((_, i) => i !== ii) }; updateDraft(d); };
            const updateItem = (ci: number, ii: number, field: string, val: string) => {
              if (!bookmarkDraft) return;
              const d = [...bookmarkDraft];
              d[ci] = { ...d[ci], items: d[ci].items.map((item, i) => i === ii ? { ...item, [field]: val } : item) };
              updateDraft(d);
            };
            const updateColumn = (ci: number, field: string, val: string) => {
              if (!bookmarkDraft) return;
              const d = [...bookmarkDraft]; d[ci] = { ...d[ci], [field]: val }; updateDraft(d);
            };
            const moveItem = (ci: number, ii: number, dir: -1 | 1) => {
              if (!bookmarkDraft) return;
              const d = [...bookmarkDraft]; const items = [...d[ci].items];
              const ni = ii + dir; if (ni < 0 || ni >= items.length) return;
              [items[ii], items[ni]] = [items[ni], items[ii]];
              d[ci] = { ...d[ci], items }; updateDraft(d);
            };

            return (
              <div className="flex flex-col gap-4" style={{ background: "var(--surface-dim)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "20px 24px" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)", letterSpacing: "0.15em" }}>bookmarks</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {editBookmarks ? (
                      <>
                        <button onClick={addColumn} style={{ fontSize: 9, color: "var(--brand)", background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>+ Section</button>
                        <button onClick={cancelEdit} style={{ fontSize: 9, color: "var(--text-dim)", background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Cancel</button>
                        <button onClick={saveBookmarks} disabled={bookmarkSaving} style={{ fontSize: 9, color: "#0a0c12", background: "var(--brand)", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                          {bookmarkSaving ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={startEdit} style={{ fontSize: 9, color: "var(--text-dim)", background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Edit</button>
                        <span style={{ fontSize: 9, color: "var(--text-ghost)" }}>H to toggle</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {columns.map((col, ci) => (
                    <div key={ci} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
                        {editBookmarks ? (
                          <>
                            <input type="color" value={col.accentColor} onChange={e => updateColumn(ci, "accentColor", e.target.value)}
                              style={{ width: 16, height: 16, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
                            <input value={col.title} onChange={e => updateColumn(ci, "title", e.target.value)}
                              className="text-[9px] uppercase tracking-[0.18em]" placeholder="Section name"
                              style={{ background: "transparent", border: "none", borderBottom: "1px solid var(--border)", color: col.accentColor, opacity: 0.8, outline: "none", width: "100%", padding: "2px 0" }} />
                            <button onClick={() => removeColumn(ci)} title="Remove section"
                              style={{ color: "var(--critical)", background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
                          </>
                        ) : (
                          <>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.accentColor }} />
                            <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: col.accentColor, opacity: 0.8 }}>{col.title}</span>
                          </>
                        )}
                      </div>
                      {editBookmarks ? (
                        <>
                          {col.items.map((item, ii) => (
                            <div key={ii} className="flex items-center gap-1.5 py-1" style={{ borderBottom: "1px solid var(--border-dim)" }}>
                              <div className="flex flex-col gap-0.5" style={{ flexShrink: 0 }}>
                                <button onClick={() => moveItem(ci, ii, -1)} disabled={ii === 0} style={{ fontSize: 8, color: ii > 0 ? "var(--text-dim)" : "var(--text-ghost)", background: "none", border: "none", cursor: ii > 0 ? "pointer" : "default", padding: 0, lineHeight: 1 }}>▲</button>
                                <button onClick={() => moveItem(ci, ii, 1)} disabled={ii === col.items.length - 1} style={{ fontSize: 8, color: ii < col.items.length - 1 ? "var(--text-dim)" : "var(--text-ghost)", background: "none", border: "none", cursor: ii < col.items.length - 1 ? "pointer" : "default", padding: 0, lineHeight: 1 }}>▼</button>
                              </div>
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <input value={item.name} onChange={e => updateItem(ci, ii, "name", e.target.value)} placeholder="Name"
                                  style={{ fontSize: 10, background: "transparent", border: "none", borderBottom: "1px solid var(--border-dim)", color: "var(--text)", outline: "none", padding: "1px 0", width: "100%" }} />
                                <input value={item.url} onChange={e => updateItem(ci, ii, "url", e.target.value)} placeholder="https://..."
                                  style={{ fontSize: 9, background: "transparent", border: "none", borderBottom: "1px solid var(--border-dim)", color: "var(--text-dim)", outline: "none", padding: "1px 0", width: "100%", fontFamily: "monospace" }} />
                                <input value={item.icon} onChange={e => updateItem(ci, ii, "icon", e.target.value)} placeholder="Icon URL (or leave blank for auto)"
                                  style={{ fontSize: 9, background: "transparent", border: "none", borderBottom: "1px solid var(--border-dim)", color: "var(--text-dim)", outline: "none", padding: "1px 0", width: "100%", fontFamily: "monospace" }} />
                              </div>
                              <button onClick={() => removeItem(ci, ii)} title="Remove" style={{ color: "var(--critical)", background: "none", border: "none", cursor: "pointer", fontSize: 10, padding: "0 2px", flexShrink: 0 }}>×</button>
                            </div>
                          ))}
                          <button onClick={() => addItem(ci)}
                            style={{ fontSize: 9, color: "var(--brand)", background: "none", border: "1px dashed var(--border)", borderRadius: 5, padding: "4px 8px", cursor: "pointer", marginTop: 4, textAlign: "center" }}>
                            + Add bookmark
                          </button>
                        </>
                      ) : (
                        col.items.map(item => (
                          <BookmarkItem key={item.url + item.name} {...item} />
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── footer ── */}
          <div className="flex items-center justify-between flex-wrap gap-3" style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 12 }}>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center rounded" style={{ width: 16, height: 16, background: "rgba(251,146,60,0.2)", border: "1px solid rgba(251,146,60,0.3)", fontSize: 9, fontWeight: 700, color: "#fb923c" }}>C</span>
              <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>built with claude code</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>
              tracking {services?.length ?? 0} services · G search · R refresh · H bookmarks
            </span>
            <a href="http://192.168.88.196:30104" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: "var(--text-ghost)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}>
              prometheus ↗
            </a>
          </div>

        </div>
      </main>

      {showSettings && (
        <SettingsPanel settings={settings} onUpdate={setSettings} onClose={() => setShowSettings(false)} services={services} />
      )}
    </>
  );
}
