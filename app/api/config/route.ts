import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

// ── /api/config ───────────────────────────────────────────────────────────────
// Runtime client-side config. The client fetches this once on mount, so the
// same Docker image works for any user with the right env vars + an optional
// mounted bookmarks.json — no rebuild required to change service URLs, panel
// IDs, weather coordinates, etc.
//
// Nothing returned here is a secret. Never include API keys / passwords in
// this response — they stay server-side only in app/api/services/route.ts etc.

export interface ClientConfig {
  truenasIp:    string;
  mikrotikUrl:  string;
  weather: { lat: string; lon: string };
  grafana: {
    baseUrl:       string;
    panelUrl:      string | null;   // pre-composed iframe src (null when unconfigured)
    dashboardUid?: string;
    datasourceUid?: string;
    panelId?:      string;
  };
  // URL each service card opens when clicked. Same shape as the old SVC_URLS
  // map. Override per-service via the matching env var.
  serviceUrls: Record<string, string>;
  // Bookmarks list. Loaded from /app/config/bookmarks.json at runtime if that
  // file exists; otherwise the baked-in default ships through.
  bookmarks: BookmarkColumn[];
  // Filesystem prefix the metrics card uses to clean mount labels.
  fsPathPrefix: string;
}

export interface BookmarkColumn {
  title:       string;
  accentColor: string;
  items:       { name: string; url: string; icon: string }[];
}

const TRUENAS_IP    = process.env.TRUENAS_IP   ?? "192.168.88.196";
const MIKROTIK_URL  = process.env.MIKROTIK_URL ?? "http://192.168.88.1";

// Grafana embed config. If GRAFANA_BASE_URL is unset we still return a baseUrl
// (so "open grafana" links at least click somewhere) but panelUrl is null and
// the client renders the empty-state instead of a broken iframe.
const GRAFANA_BASE_URL       = process.env.GRAFANA_BASE_URL       ?? `http://${TRUENAS_IP}:30037`;
const GRAFANA_DASHBOARD_UID  = process.env.GRAFANA_DASHBOARD_UID;
const GRAFANA_DATASOURCE_UID = process.env.GRAFANA_DATASOURCE_UID;
const GRAFANA_PANEL_ID       = process.env.GRAFANA_PANEL_ID       ?? "panel-77";
const GRAFANA_DASHBOARD_SLUG = process.env.GRAFANA_DASHBOARD_SLUG ?? "node-exporter-full";

const FS_PATH_PREFIX = process.env.FS_PATH_PREFIX ?? "/mnt/Pool/Media/";

const SERVICE_URLS: Record<string, string> = {
  radarr:      process.env.RADARR_URL      ?? `http://${TRUENAS_IP}:30025`,
  sonarr:      process.env.SONARR_URL      ?? `http://${TRUENAS_IP}:33027`,
  bazarr:      process.env.BAZARR_URL      ?? `http://${TRUENAS_IP}:30046`,
  tautulli:    process.env.TAUTULLI_URL    ?? `http://${TRUENAS_IP}:30047`,
  qbittorrent: process.env.QBIT_URL        ?? `http://${TRUENAS_IP}:30024`,
  overseerr:   process.env.OVERSEERR_URL   ?? `http://${TRUENAS_IP}:30002`,
  pihole:      process.env.PIHOLE_URL      ?? `http://${TRUENAS_IP}:20720`,
  prowlarr:    process.env.PROWLARR_URL    ?? `http://${TRUENAS_IP}:30050`,
  nginx:       process.env.NGINX_URL       ?? `http://${TRUENAS_IP}:30020`,
  uptimekuma:  process.env.UPTIME_KUMA_URL ?? `http://${TRUENAS_IP}:31050`,
};

// Default bookmarks shipped with the image. Overridden by mounting a JSON file
// at the path in BOOKMARKS_PATH (default /app/config/bookmarks.json).
const DEFAULT_BOOKMARKS: BookmarkColumn[] = [
  {
    title: "Social",
    accentColor: "#06b6d4",
    items: [
      { name: "YouTube",   url: "https://www.youtube.com",   icon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=32"  },
      { name: "Reddit",    url: "https://www.reddit.com",    icon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32"   },
    ],
  },
  {
    title: "Productivity",
    accentColor: "#10b981",
    items: [
      { name: "ChatGPT",   url: "https://chat.openai.com",   icon: "https://www.google.com/s2/favicons?domain=openai.com&sz=32"   },
      { name: "Gmail",     url: "https://mail.google.com",   icon: "https://www.google.com/s2/favicons?domain=gmail.com&sz=32"    },
    ],
  },
];

let bookmarksCache: { data: BookmarkColumn[]; ts: number } | null = null;
const BOOKMARKS_TTL = 60_000; // re-read the file at most once per minute

async function loadBookmarks(): Promise<BookmarkColumn[]> {
  if (bookmarksCache && Date.now() - bookmarksCache.ts < BOOKMARKS_TTL) {
    return bookmarksCache.data;
  }
  const filePath = process.env.BOOKMARKS_PATH ?? path.join(process.cwd(), "bookmarks.json");
  try {
    const raw    = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      bookmarksCache = { data: parsed as BookmarkColumn[], ts: Date.now() };
      return parsed as BookmarkColumn[];
    }
  } catch { /* fall through to default — file missing or malformed */ }
  bookmarksCache = { data: DEFAULT_BOOKMARKS, ts: Date.now() };
  return DEFAULT_BOOKMARKS;
}

export async function GET() {
  // Compose the Grafana iframe URL only if we have enough config to make a
  // meaningful one. Missing UIDs ⇒ panelUrl is null and the client shows a
  // setup hint instead of a broken iframe.
  let panelUrl: string | null = null;
  if (GRAFANA_DASHBOARD_UID && GRAFANA_DATASOURCE_UID) {
    const params = new URLSearchParams({
      orgId:               "1",
      from:                "now-24h",
      to:                  "now",
      timezone:            "browser",
      "var-ds_prometheus": GRAFANA_DATASOURCE_UID,
      "var-job":           "node",
      "var-nodename":      "truenas",
      "var-node":          "truenas",
      refresh:             "1m",
      panelId:             GRAFANA_PANEL_ID,
      theme:               "dark",
    });
    panelUrl = `${GRAFANA_BASE_URL}/d-solo/${GRAFANA_DASHBOARD_UID}/${GRAFANA_DASHBOARD_SLUG}?${params}`;
  }

  const config: ClientConfig = {
    truenasIp:    TRUENAS_IP,
    mikrotikUrl:  MIKROTIK_URL,
    weather: {
      lat: process.env.WEATHER_LAT ?? "-41.4419",
      lon: process.env.WEATHER_LON ?? "147.1450",
    },
    grafana: {
      baseUrl:       GRAFANA_BASE_URL,
      panelUrl,
      dashboardUid:  GRAFANA_DASHBOARD_UID,
      datasourceUid: GRAFANA_DATASOURCE_UID,
      panelId:       GRAFANA_PANEL_ID,
    },
    serviceUrls:  SERVICE_URLS,
    bookmarks:    await loadBookmarks(),
    fsPathPrefix: FS_PATH_PREFIX,
  };

  return NextResponse.json(config);
}
