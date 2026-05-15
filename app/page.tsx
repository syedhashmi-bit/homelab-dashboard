"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// ── lib imports ──────────────────────────────────────────────────────────────
import { THEMES, SVC_PORTS, type ThemeKey } from "@/app/lib/constants";
import type {
  Metrics, Settings, SpeedtestResult, SpeedtestRaw,
  ServiceResult, ActivityEvent, ForecastDay, ClientConfig, SearchEngine,
} from "@/app/lib/types";
import {
  fmtBytes, fmtTemp, fmtUptime, fmtSince, fmtPct,
  pct, barColor, gpuUtilColor, tempColor,
  normalizeSpeedResult, histStats,
} from "@/app/lib/formatters";
import {
  cpuAlertLevel, memAlertLevel, diskAlertLevel, gpuTempAlertLevel,
  worstAlert, computeHealth,
} from "@/app/lib/alerts";
import { buildDemoMetrics, buildDemoServices } from "@/app/lib/demo-data";

// ── component imports ────────────────────────────────────────────────────────
import {
  IconCPU, IconMemory, IconDisk, IconNetwork, IconGPU,
  IconSpeedtest, IconTerminal, IconFolder,
  IconGear, IconTrueNAS,
} from "@/app/components/icons";
import {
  AnimatedNumber, animatedLine, TrendDelta, HeroStat,
  GaugeBar, Sparkline, RadialGauge, ThreeSegmentDonut, LabeledBar,
  Card, StatusBanner, Skeleton, BigValue, StatRow,
} from "@/app/components/primitives";
import { SearchBar } from "@/app/components/SearchBar";
import { SettingsPanel } from "@/app/components/SettingsPanel";
import { MikrotikTab } from "@/app/components/MikrotikTab";
import { GrafanaCard } from "@/app/components/GrafanaCard";
import { ActivityFeed } from "@/app/components/ActivityFeed";
import { DraggableCard } from "@/app/components/DraggableCard";
import { DevicesPanel } from "@/app/components/DevicesPanel";
import { ContainerLogsSheet } from "@/app/components/ContainerLogsSheet";
import { CustomCardsGrid } from "@/app/components/CustomCards";
import { CustomCardEditor } from "@/app/components/CustomCardEditor";
import { ServicesPanel } from "@/app/components/ServicesPanel";
import { BookmarksPanel } from "@/app/components/BookmarksPanel";
import { KeyboardShortcuts } from "@/app/components/KeyboardShortcuts";
import { NotificationCenter } from "@/app/components/NotificationCenter";
import { HeaderSparklines } from "@/app/components/HeaderSparklines";
import { UptimeTimeline } from "@/app/components/UptimeTimeline";
import { CommandPalette, type CommandAction } from "@/app/components/CommandPalette";
import { DiskHealthPanel } from "@/app/components/DiskHealthPanel";
import { NetworkTopology } from "@/app/components/NetworkTopology";
import { ServerFleetPanel } from "@/app/components/ServerFleetPanel";
import { loadCardOrder, saveCardOrder, reorder } from "@/app/lib/card-order";
import { useEventStream } from "@/app/hooks/useEventStream";

// ── module constants ─────────────────────────────────────────────────────────

const MAX_HISTORY = 60;


const DEFAULT_SETTINGS: Settings = { refreshInterval: 3, tempUnit: "C", dataUnit: "decimal", visibleCards: {}, searchEngine: "google", timezone: "", theme: "midnight" };
const SETTINGS_KEY = "comexe:settings";

// ── Dashboard ────────────────────────────────────────────────────────────────

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
  const [offline,        setOffline]        = useState(false);
  const [showHealth,     setShowHealth]     = useState(true);
  const [showBookmarks,  setShowBookmarks]  = useState(true);
  const [alertsEnabled,  setAlertsEnabled]  = useState(false);
  const [alertCount,     setAlertCount]     = useState(0);   // session-level fire counter for the header pill
  const [alertsBrowserNotif, setAlertsBrowserNotif] = useState(true);
  const [showShortcuts,      setShowShortcuts]      = useState(false);
  const [showNotifications,  setShowNotifications]  = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTopology,       setShowTopology]       = useState(false);
  const [showServerFleet,    setShowServerFleet]    = useState(false);
  const [serviceFilter,  setServiceFilter]  = useState("");
  const serviceFilterRef = useRef<HTMLInputElement>(null);
  const [versionInfo,    setVersionInfo]    = useState<{ current: string; latest: string | null; hasUpdate: boolean; repoUrl: string } | null>(null);
  const [updateDismissed,setUpdateDismissed]= useState(false);
  const [logsContainer,  setLogsContainer]  = useState<string | null>(null);
  const [restartingSvc,  setRestartingSvc]  = useState<string | null>(null);
  const [restartMsg,     setRestartMsg]     = useState<{ name: string; ok: boolean; text: string } | null>(null);

  // Hit /api/docker/restart and surface the result inline for a few seconds.
  const restartService = useCallback(async (containerName: string) => {
    setRestartingSvc(containerName);
    setRestartMsg(null);
    try {
      const res = await fetch("/api/docker/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: containerName }),
      });
      const body = await res.json();
      setRestartMsg({ name: containerName, ok: !!body.ok, text: body.message ?? (body.ok ? "Restarted" : "Failed") });
    } catch (e) {
      setRestartMsg({ name: containerName, ok: false, text: (e as Error).message });
    } finally {
      setRestartingSvc(null);
      setTimeout(() => setRestartMsg(null), 4000);
    }
  }, []);
  const [cardOrder,      setCardOrder]      = useState<string[]>(() => loadCardOrder());
  const reorderCards = useCallback((draggedKey: string, targetKey: string) => {
    setCardOrder(prev => {
      const next = reorder(prev, draggedKey, targetKey);
      saveCardOrder(next);
      return next;
    });
  }, []);
  const orderIndex = useCallback((key: string) => {
    const i = cardOrder.indexOf(key);
    return i < 0 ? 999 : i;
  }, [cardOrder]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cpuHistory,     setCpuHistory]     = useState<number[]>([]);
  const [memHistory,     setMemHistory]     = useState<number[]>([]);
  const [gpuHistory,     setGpuHistory]     = useState<number[]>([]);
  const [gpuTempHistory, setGpuTempHistory] = useState<number[]>([]);
  const [rxHistory,      setRxHistory]      = useState<number[]>([]);
  const [txHistory,      setTxHistory]      = useState<number[]>([]);
  const [uptimeHistory,  setUptimeHistory]  = useState<{ ts: number; up: boolean }[]>([]);

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

  // Register service worker for offline PWA shell + offline detection
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const goOffline = () => setOffline(true);
    const goOnline  = () => setOffline(false);
    setOffline(!navigator.onLine);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  // Demo mode — seed with fake data
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
      setUptimeHistory(h => [...h, { ts: Date.now(), up: true }].slice(-300));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
      setUptimeHistory(h => [...h, { ts: Date.now(), up: false }].slice(-300));
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
    } catch { /* weather is non-critical */ }
  }, []);

  // ── SSE live updates ──────────────────────────────────────────────────────
  const handleSSE = useCallback((event: string, data: unknown) => {
    switch (event) {
      case "metrics": {
        const m = data as Metrics;
        setMetrics(m);
        if (m.cpu != null) setCpuHistory(h => [...h, m.cpu!].slice(-MAX_HISTORY));
        const realUsed = m.memory.total != null && m.memory.available != null
          ? Math.max(0, m.memory.total - m.memory.available - (m.memory.sReclaimable ?? 0)) : null;
        setMemHistory(h => [...h, pct(realUsed, m.memory.total)].slice(-MAX_HISTORY));
        if (m.gpu?.utilization != null) setGpuHistory(h => [...h, m.gpu.utilization!].slice(-MAX_HISTORY));
        if (m.gpu?.temperature != null) setGpuTempHistory(h => [...h, m.gpu.temperature!].slice(-MAX_HISTORY));
        setRxHistory(h => [...h, m.network.rxBytesPerSec ?? 0].slice(-MAX_HISTORY));
        setTxHistory(h => [...h, m.network.txBytesPerSec ?? 0].slice(-MAX_HISTORY));
        setError(null); setLoading(false); setLastUpdated(new Date().toLocaleTimeString());
        setRefreshing(true); setTimeout(() => setRefreshing(false), 800);
        setUptimeHistory(h => [...h, { ts: Date.now(), up: true }].slice(-300));
        break;
      }
      case "services": {
        const d = data as { services?: ServiceResult[] | null };
        setServices(d.services ?? null);
        setServicesUpdatedAt(Date.now());
        setServicesLoading(false);
        break;
      }
      case "activity": {
        const d = data as { events?: ActivityEvent[] };
        setActivityEvents(Array.isArray(d.events) ? d.events : []);
        setActivityLoading(false);
        break;
      }
      case "speedtest": {
        const d = data as { results?: SpeedtestRaw[]; history?: number[]; totalTests?: number };
        const raw: SpeedtestRaw[] = d.results ?? [];
        setSpeedtestResults(raw.map(normalizeSpeedResult));
        if (Array.isArray(d.history)) setSpeedtestHistory(d.history);
        if (d.totalTests != null) setSpeedtestTotalTests(d.totalTests);
        setSpeedtestLoading(false);
        break;
      }
      case "weather": {
        const d = data as { error?: boolean; temp?: number; condition?: string; forecast?: ForecastDay[] };
        if (!d.error) setWeather({ temp: d.temp ?? null, condition: d.condition ?? null, forecast: d.forecast ?? [] });
        break;
      }
    }
  }, []);

  const sseIntervals = {
    metrics:  (settings.refreshOverrides?.metrics || settings.refreshInterval) * 1000,
    services: (settings.refreshOverrides?.services || 3) * 1000,
    mikrotik: (settings.refreshOverrides?.mikrotik || 5) * 1000,
    activity: (settings.refreshOverrides?.activity || 60) * 1000,
    speedtest: 300000,
    weather:   600000,
  };

  const { fallback: usePolling } = useEventStream({
    enabled: !demoMode,
    intervals: sseIntervals,
    onMessage: handleSSE,
  });

  // Clock — updates every second, respects timezone setting
  useEffect(() => {
    function tick() {
      const now = new Date();
      const tz = settings.timezone || undefined;
      const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
      const days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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

  // Polling effects — only active when SSE is unavailable (fallback mode)
  useEffect(() => { if (demoMode || !usePolling) return; fetchWeather(); const id = setInterval(fetchWeather, 600_000); return () => clearInterval(id); }, [fetchWeather, demoMode, usePolling]);
  useEffect(() => {
    if (demoMode || !usePolling) return;
    const sec = settings.refreshOverrides?.services || 3;
    fetchServices();
    const id = setInterval(fetchServices, sec * 1000);
    return () => clearInterval(id);
  }, [fetchServices, demoMode, settings.refreshOverrides?.services, usePolling]);
  useEffect(() => { if (demoMode || !usePolling) return; fetchSpeedtest(); const id = setInterval(fetchSpeedtest, 300_000); return () => clearInterval(id); }, [fetchSpeedtest, demoMode, usePolling]);
  useEffect(() => {
    if (demoMode || !usePolling) return;
    const sec = settings.refreshOverrides?.activity || 60;
    fetchActivity();
    const id = setInterval(fetchActivity, sec * 1000);
    return () => clearInterval(id);
  }, [fetchActivity, demoMode, settings.refreshOverrides?.activity, usePolling]);

  // Load alert config on mount so we know whether to dispatch (server is the
  // source of truth — POST /api/alerts is a cheap no-op if disabled).
  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.json())
      .then(d => { setAlertsEnabled(!!d.config?.enabled); setAlertsBrowserNotif(d.config?.browserNotifications !== false); })
      .catch(() => {});
  }, []);

  // Check for new image release once on mount + every 30 min. Dismissable per
  // session via the X — comes back on next page reload (not localStorage)
  // since we want a nudge per session, not forever.
  useEffect(() => {
    let cancelled = false;
    function check() {
      fetch("/api/version")
        .then(r => r.json())
        .then(d => { if (!cancelled) setVersionInfo({ current: d.current, latest: d.latest, hasUpdate: !!d.hasUpdate, repoUrl: d.repoUrl }); })
        .catch(() => {});
    }
    check();
    const id = setInterval(check, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // After every metric+services update, send to /api/alerts. Server evaluates
  // thresholds, throttles, dispatches webhook. Returns the new fires for us
  // to push as browser notifications. Server-side throttle handles dedupe.
  useEffect(() => {
    if (demoMode || !alertsEnabled) return;
    if (!metrics && !services) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alerts", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ metrics, services }),
        });
        if (cancelled) return;
        const data = await res.json();
        const fires: { key: string; level: "warning" | "critical"; msg: string }[] = data.fires ?? [];
        if (fires.length === 0) return;
        setAlertCount(c => c + fires.length);

        // Browser notifications — only if permission granted and not in tab focus
        if (alertsBrowserNotif && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          for (const f of fires) {
            try {
              new Notification(`ComExe · ${f.level === "critical" ? "critical" : "warning"}`, { body: f.msg, tag: f.key, icon: "/icon.svg" });
            } catch { /* some browsers reject if not in user gesture; ignore */ }
          }
        }
      } catch { /* ignore — alerts shouldn't break the dashboard */ }
    })();
    return () => { cancelled = true; };
  }, [metrics, services, demoMode, alertsEnabled, alertsBrowserNotif]);

  // Client config — fetched once on mount
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((cfg: ClientConfig | null) => {
        if (!cfg) return;
        setClientConfig(cfg);
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
      .catch(() => {});
  }, []);

  // First-run redirect
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
    if (demoMode || !usePolling) return;
    const sec = settings.refreshOverrides?.metrics || settings.refreshInterval;
    fetchMetrics();
    intervalRef.current = setInterval(() => { fetchMetrics(); }, sec * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMetrics, settings.refreshInterval, settings.refreshOverrides?.metrics, demoMode, usePolling]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") { setShowSettings(false); setShowShortcuts(false); setShowNotifications(false); setShowCommandPalette(false); setExpandedCard(null); (e.target as HTMLElement)?.blur?.(); return; }
      if (isTyping) return;
      if (e.key === "?")                  { e.preventDefault(); setShowShortcuts(v => !v); }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); fetchMetrics(); }
      if (e.key === "g" || e.key === "G") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "h" || e.key === "H") setShowBookmarks(v => !v);
      if (e.key === "/")                  { e.preventDefault(); serviceFilterRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowCommandPalette(v => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fetchMetrics]);

  // ── derived state ──────────────────────────────────────────────────────────
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

  const isVisible  = (k: string) => settings.visibleCards[k] !== false;
  const toggleCard = (k: string) => setExpandedCard(e => e === k ? null : k);
  const du = settings.dataUnit;
  const tu = settings.tempUnit;

  const commandActions = useMemo<CommandAction[]>(() => [
    { id: "refresh", label: "Refresh metrics", shortcut: "R", section: "Actions", icon: "🔄", action: () => fetchMetrics() },
    { id: "search", label: "Focus search bar", shortcut: "G", section: "Actions", icon: "🔍", action: () => searchInputRef.current?.focus() },
    { id: "filter", label: "Focus service filter", shortcut: "/", section: "Actions", icon: "🏷️", action: () => serviceFilterRef.current?.focus() },
    { id: "bookmarks", label: "Toggle bookmarks", shortcut: "H", section: "Actions", icon: "📌", action: () => setShowBookmarks(v => !v) },
    { id: "settings", label: "Open settings", section: "Panels", icon: "⚙️", action: () => setShowSettings(true) },
    { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "?", section: "Panels", icon: "⌨️", action: () => setShowShortcuts(true) },
    { id: "notifications", label: "Notifications", section: "Panels", icon: "🔔", action: () => setShowNotifications(true) },
    { id: "topology", label: "Network topology", section: "Panels", icon: "🕸️", action: () => setShowTopology(true) },
    { id: "fleet", label: "Server fleet", section: "Panels", icon: "🖥️", action: () => setShowServerFleet(true) },
    { id: "analytics", label: "Open analytics", section: "Navigate", icon: "📊", action: () => { window.location.href = "/analytics"; } },
    { id: "setup", label: "Setup wizard", section: "Navigate", icon: "🧙", action: () => { window.location.href = "/setup"; } },
    { id: "truenas", label: "Open TrueNAS UI", section: "Navigate", icon: "🖥️", action: () => window.open(`http://${clientConfig?.truenasIp ?? "192.168.88.196"}`, "_blank") },
    { id: "prometheus", label: "Open Prometheus", section: "Navigate", icon: "📈", action: () => window.open(`http://${clientConfig?.truenasIp ?? "192.168.88.196"}:30104`, "_blank") },
  ], [fetchMetrics, clientConfig?.truenasIp]);

  // ── render ─────────────────────────────────────────────────────────────────
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
      {/* healthy state line */}
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

      {/* Update-available banner — only shows when image SHA differs from
          main HEAD on GitHub. Hidden during demo to avoid confusing the
          showcase flow. */}
      {!demoMode && mounted && versionInfo?.hasUpdate && !updateDismissed && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3" style={{
          background: "linear-gradient(90deg, #06b6d4, #0ea5e9)",
          padding: "4px 12px", fontSize: 11, fontWeight: 600, color: "#0a0c12",
          letterSpacing: "0.02em",
        }}>
          <span>
            ComExe update available — running <code style={{ fontFamily: "monospace" }}>{versionInfo.current.slice(0, 7)}</code>, latest{" "}
            <a href={`${versionInfo.repoUrl}/commits/main`} target="_blank" rel="noopener noreferrer"
              style={{ color: "#0a0c12", textDecoration: "underline", fontWeight: 700 }}>
              {versionInfo.latest?.slice(0, 7)}
            </a>. Run <code style={{ fontFamily: "monospace" }}>update-dashboard.sh</code> to pull.
          </span>
          <button onClick={() => setUpdateDismissed(true)}
            style={{ background: "transparent", border: "none", color: "#0a0c12", fontSize: 14, cursor: "pointer", padding: "0 6px", lineHeight: 1, fontWeight: 700 }}
            aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── sticky frosted header ── */}
      <header className="fixed top-0 left-0 right-0 z-30" style={{
        background: "var(--header-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div className="header-inner max-w-5xl mx-auto px-6 sm:px-6 py-2.5 flex items-center justify-between gap-4">
          {/* Left */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="block w-2 h-2 rounded-full shrink-0"
              style={{ background: "var(--ok)", boxShadow: "0 0 6px #10b98166", animation: "pulseDot 2s ease-in-out infinite", "--dot-color": "#10b981" } as React.CSSProperties} />
            <Link href="/" className="flex items-center gap-2 shrink-0" style={{ textDecoration: "none" }}>
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
            <span className="shrink-0 hidden sm:inline" style={{ background: "var(--surface)", border: "1px solid var(--border-bright)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.04em" }}>
              truenas · :30104
            </span>
            {metrics?.uptime != null && (
              <span className="hidden md:flex items-center gap-1.5 shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--border-bright)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "var(--text-secondary)" }}>
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
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <HeaderSparklines cpuHistory={cpuHistory} memHistory={memHistory} rxHistory={rxHistory} />
            {clockDate && (
              <div className="flex flex-col items-end leading-tight">
                <span className="hidden sm:block" style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "inherit" }}>{clockDate}</span>
                <span className="font-mono tabular-nums" style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{clockTime}</span>
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
            {alertsEnabled && alertCount > 0 && (
              <button
                title={`${alertCount} alert${alertCount === 1 ? "" : "s"} this session — open notifications`}
                onClick={() => { setShowNotifications(true); setAlertCount(0); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 10, fontWeight: 600,
                  color: "#fff",
                  background: alertCount > 0 ? "var(--critical)" : "transparent",
                  border: "none", borderRadius: 999,
                  padding: "2px 8px", cursor: "pointer",
                  boxShadow: `0 0 8px ${alertCount > 0 ? "var(--critical)" : "transparent"}55`,
                  transition: "background 0.2s",
                }}
              >🔔 {alertCount}</button>
            )}
            <Link href="/analytics" title="Analytics"
              style={{ color: "var(--text-ghost)", textDecoration: "none", fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: 4, transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--brand)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-ghost)")}
            >&#x1f4ca;</Link>
            <button
              title="Open TrueNAS"
              onClick={() => window.open(`http://${clientConfig?.truenasIp ?? "192.168.88.196"}`, "_blank")}
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
        <div className="main-content max-w-5xl mx-auto px-3 sm:px-6 pb-10 flex flex-col gap-4 sm:gap-6" style={{ paddingTop: 72 }}>

          <SearchBar inputRef={searchInputRef} engine={settings.searchEngine} />
          <MikrotikTab mikrotikUrl={clientConfig?.mikrotikUrl ?? "http://192.168.88.1"} refreshSec={settings.refreshOverrides?.mikrotik} />
          {!demoMode && <DevicesPanel />}

          {offline && (
            <div className="flex items-center gap-2" style={{
              background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "#f59e0b",
            }}>
              <span style={{ fontSize: 14 }}>&#9888;</span>
              <span>You are offline — showing cached data. Updates will resume when connectivity returns.</span>
            </div>
          )}
          {!loading && showHealth && health.status !== "healthy" && (
            <StatusBanner result={health} visible={mounted} />
          )}

          {/* First-run setup banner */}
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

          {/* ── metric grid ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">

            {/* CPU */}
            {isVisible("cpu") && (
              <div style={{ order: orderIndex("cpu") }}><DraggableCard cardKey="cpu" onReorder={reorderCards}>
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
              </DraggableCard></div>
            )}

            {/* Memory */}
            {isVisible("memory") && (
              <div style={{ order: orderIndex("memory") }}><DraggableCard cardKey="memory" onReorder={reorderCards}>
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
              </DraggableCard></div>
            )}

            {/* Filesystems */}
            {isVisible("filesystems") && (
              <div style={{ order: orderIndex("filesystems") }}><DraggableCard cardKey="filesystems" onReorder={reorderCards}>
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
              </DraggableCard></div>
            )}

            {/* Network */}
            {isVisible("network") && (
              <div style={{ order: orderIndex("network") }}><DraggableCard cardKey="network" onReorder={reorderCards}>
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
              </DraggableCard></div>
            )}

            {/* GPU */}
            {isVisible("gpu") && (
              <div style={{ order: orderIndex("gpu") }}><DraggableCard cardKey="gpu" onReorder={reorderCards}>
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
                    <LabeledBar label="vram" right={`${fmtBytes(metrics?.gpu?.memUsed ?? null, 1, du)} / ${fmtBytes(metrics?.gpu?.memTotal ?? null, 1, du)}`}
                      percent={gpuMemPct} color="#a855f7" gradient="linear-gradient(90deg, var(--accent-speedtest), #a855f7)" />
                    {metrics?.gpu?.powerDraw != null && metrics?.gpu?.powerLimit != null && (
                      <LabeledBar label="power" right={`${metrics.gpu.powerDraw.toFixed(1)} / ${metrics.gpu.powerLimit.toFixed(0)} W`}
                        percent={gpuPwrPct} color="#f59e0b" gradient="linear-gradient(90deg, #ea580c, var(--warn))" />
                    )}
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
                              background: "var(--card)", border: "1px solid var(--border)",
                              borderRadius: 4, padding: "2px 7px", fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.01em",
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
                        <Sparkline data={gpuTempHistory} color={metrics?.gpu?.temperature != null ? tempColor(metrics.gpu.temperature) : "#555"} autoMax height={28} />
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
              </DraggableCard></div>
            )}

            {/* Speedtest */}
            {isVisible("speedtest") && (
              <div style={{ order: orderIndex("speedtest") }}><DraggableCard cardKey="speedtest" onReorder={reorderCards}>
              <Card label="speedtest" accent="var(--accent-speedtest)" icon={<IconSpeedtest />}
                animDelay={250} externalLink={`http://${clientConfig?.truenasIp ?? "192.168.88.196"}:${SVC_PORTS.speedtest}`}>
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
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-0.5">
                          {latest.isp && <span className="text-[12px] font-semibold" style={{ color: "var(--text-mid)" }}>{latest.isp}</span>}
                          {latest.serverLocation && <span className="text-[10px]" style={{ color: "var(--text-label)" }}>{latest.serverLocation}</span>}
                          {latest.serverHost && <span className="text-[9px] font-mono truncate" style={{ color: "var(--text-ghost)", maxWidth: 160 }}>{latest.serverHost}</span>}
                        </div>
                        {quality && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0 mt-0.5"
                            style={{ color: quality.color, background: quality.bg, border: `1px solid ${quality.border}`, borderRadius: 5, padding: "2px 7px" }}>
                            {quality.label}
                          </span>
                        )}
                      </div>
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
                      {(latest.ping != null || latest.jitter != null) && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--ok)", boxShadow: "0 0 4px #10b98166" }} />
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
                      {speedtestHistory.length >= 2 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-ghost)" }}>download history</span>
                          <Sparkline data={speedtestHistory} color="#8b5cf6" height={40} />
                        </div>
                      )}
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        {rel && <span className="text-[9px] tabular-nums" style={{ color: "var(--text-faint)" }}>auto-tested · {rel}</span>}
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
              </DraggableCard></div>
            )}

            {/* System + Grafana — pinned to the end regardless of card reorder */}
            {(isVisible("system") || isVisible("grafana")) && (
              <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch" style={{ order: 9999 }}>
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
                        {uptimeHistory.length > 1 && (
                          <div style={{ marginTop: 8 }}>
                            <UptimeTimeline history={uptimeHistory} height={20} />
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                )}
                {isVisible("grafana") && (
                  <GrafanaCard
                    baseUrl={clientConfig?.grafana.baseUrl ?? `http://${clientConfig?.truenasIp ?? "localhost"}:30037`}
                    panelUrl={clientConfig?.grafana.panelUrl ?? null}
                    panels={clientConfig?.grafana.panels}
                    tokenSet={clientConfig?.grafanaTokenSet}
                  />
                )}
              </div>
            )}
          </div>

          {/* ── Disk health (SMART) ── */}
          {isVisible("system") && (
            <div style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "14px 18px" }}>
              <DiskHealthPanel />
            </div>
          )}

          {/* ── Custom cards (user-defined PromQL) ── */}
          <CustomCardsGrid refreshInterval={settings.refreshInterval} />

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
                    boxShadow: "0 0 6px #ef4444", animation: "pulseDot 1.5s ease-in-out infinite",
                  }} />
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent-speedtest)" }}>
                    Now Playing · {streams.length} stream{streams.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {streams.map((st, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-medium truncate" style={{ color: "var(--text-secondary)" }}>{st.title}</span>
                        {st.posStr && <span className="text-[10px] tabular-nums font-mono shrink-0" style={{ color: "var(--text-faint)" }}>{st.posStr}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-faint)", flexShrink: 0 }}>
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span style={{ fontSize: 11, color: "var(--text-label)" }}>{st.user}</span>
                      </div>
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

          {/* ── activity feed ── */}
          {isVisible("activity") && (
            <ActivityFeed events={activityEvents} loading={activityLoading} />
          )}

          {/* ── services ── */}
          {isVisible("services") && (
            <ServicesPanel
              services={services}
              servicesLoading={servicesLoading}
              servicesUpdatedAt={servicesUpdatedAt}
              serviceFilter={serviceFilter}
              setServiceFilter={setServiceFilter}
              serviceFilterRef={serviceFilterRef}
              clientConfig={clientConfig}
              setLogsContainer={setLogsContainer}
              restartingSvc={restartingSvc}
              restartService={restartService}
            />
          )}

          {/* ── bookmarks ── */}
          {showBookmarks && (
            <BookmarksPanel
              clientConfig={clientConfig}
              setClientConfig={setClientConfig}
            />
          )}

          {/* ── footer ── */}
          <div className="flex items-center justify-between flex-wrap gap-3" style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 12 }}>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center rounded" style={{ width: 16, height: 16, background: "rgba(251,146,60,0.2)", border: "1px solid rgba(251,146,60,0.3)", fontSize: 9, fontWeight: 700, color: "#fb923c" }}>C</span>
              <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>built with claude code</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>
              tracking {services?.length ?? 0} services · G search · R refresh · H bookmarks · ? shortcuts
            </span>
            <a href={`http://${clientConfig?.truenasIp ?? "192.168.88.196"}:${SVC_PORTS.prometheus}`} target="_blank" rel="noopener noreferrer"
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

      {showShortcuts && (
        <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
      )}

      {showNotifications && (
        <NotificationCenter onClose={() => setShowNotifications(false)} />
      )}

      {showCommandPalette && (
        <CommandPalette onClose={() => setShowCommandPalette(false)} actions={commandActions} />
      )}

      {showTopology && (
        <NetworkTopology onClose={() => setShowTopology(false)} />
      )}

      {showServerFleet && (
        <ServerFleetPanel onClose={() => setShowServerFleet(false)} />
      )}

      {logsContainer && (
        <ContainerLogsSheet containerName={logsContainer} onClose={() => setLogsContainer(null)} />
      )}

      {restartMsg && (
        <div className="fixed bottom-6 right-6 z-50" style={{
          background: restartMsg.ok ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
          color: "#0a0c12", fontSize: 11, fontWeight: 600,
          padding: "8px 14px", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {restartMsg.text}
        </div>
      )}
    </>
  );
}
