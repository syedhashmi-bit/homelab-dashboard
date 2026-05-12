import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig, writeConfigFile, isConfigWritable, invalidateConfigCache, type PartialFileConfig } from "@/app/lib/server-config";

// ── /api/config ───────────────────────────────────────────────────────────────
// GET  → runtime client-side config (URLs, bookmarks, Grafana embed, etc.).
//        Nothing returned here is a secret — credentials never leave the server.
// POST → save config to data/config.json (the writable mount). Lets the /setup
//        wizard apply config without a redeploy. Body is a PartialFileConfig.
//
// The same image works for any user. Layers (high precedence first):
//   1. data/config.json (written by POST)
//   2. process.env.*    (set via docker run -e)
//   3. baked-in defaults

export interface ClientConfig {
  truenasIp:   string;
  mikrotikUrl: string;
  weather: { lat: string; lon: string };
  grafana: {
    baseUrl:        string;
    panelUrl:       string | null;
    dashboardUid?:  string;
    datasourceUid?: string;
    panelId?:       string;
  };
  serviceUrls:  Record<string, string>;
  bookmarks:    BookmarkColumn[];
  fsPathPrefix: string;
  preferences: {
    searchEngine: string;
    timezone:     string;
  };
  // True when the data/ volume is writable, i.e. POST will succeed. The wizard
  // shows different copy if false.
  writable: boolean;
}

export interface BookmarkColumn {
  title:       string;
  accentColor: string;
  items:       { name: string; url: string; icon: string }[];
}

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
const BOOKMARKS_TTL = 60_000;

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
  const config = await loadConfig();
  const writable = await isConfigWritable();

  // Compose the Grafana iframe URL only when both UIDs are set.
  let panelUrl: string | null = null;
  if (config.grafana.dashboardUid && config.grafana.datasourceUid) {
    const params = new URLSearchParams({
      orgId:               "1",
      from:                "now-24h",
      to:                  "now",
      timezone:            "browser",
      "var-ds_prometheus": config.grafana.datasourceUid,
      "var-job":           "node",
      "var-nodename":      "truenas",
      "var-node":          "truenas",
      refresh:             "1m",
      panelId:             config.grafana.panelId,
      theme:               "dark",
    });
    panelUrl = `${config.grafana.baseUrl}/d-solo/${config.grafana.dashboardUid}/${config.grafana.dashboardSlug}?${params}`;
  }

  const serviceUrls: Record<string, string> = Object.fromEntries(
    Object.entries(config.services).map(([name, creds]) => [name, creds.url])
  );

  const response: ClientConfig = {
    truenasIp:    config.truenasIp,
    mikrotikUrl:  config.mikrotik.url,
    weather:      config.weather,
    grafana: {
      baseUrl:       config.grafana.baseUrl,
      panelUrl,
      dashboardUid:  config.grafana.dashboardUid,
      datasourceUid: config.grafana.datasourceUid,
      panelId:       config.grafana.panelId,
    },
    serviceUrls,
    bookmarks:    await loadBookmarks(),
    fsPathPrefix: config.fsPathPrefix,
    preferences:  config.preferences,
    writable,
  };

  return NextResponse.json(response);
}

// ── POST /api/config ────────────────────────────────────────────────────────
// Validates body shape, writes to data/config.json (the writable mount),
// invalidates the resolver's cache so the next read sees fresh values.
//
// SECURITY: this endpoint has no auth. Anyone who can hit it from the network
// can set credentials. That's an acceptable assumption for a LAN-only homelab
// dashboard, but DO NOT expose this without a reverse proxy + auth layer if
// you're putting the dashboard on the internet. See INSTALL.md → "Security
// notes" for the explicit warning.

interface PostBody {
  truenasIp?: string;
  mikrotik?:  { url?: string; username?: string; password?: string };
  services?:  PartialFileConfig["services"];
  grafana?:   PartialFileConfig["grafana"];
  preferences?: { searchEngine?: string; timezone?: string };
}

function isStringOrUndef(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function validateBody(b: unknown): { ok: true; cfg: PartialFileConfig } | { ok: false; message: string } {
  if (typeof b !== "object" || b === null) return { ok: false, message: "Body must be a JSON object" };
  const obj = b as PostBody;

  if (!isStringOrUndef(obj.truenasIp)) return { ok: false, message: "truenasIp must be a string" };

  if (obj.mikrotik !== undefined) {
    if (typeof obj.mikrotik !== "object" || obj.mikrotik === null) return { ok: false, message: "mikrotik must be an object" };
    if (!isStringOrUndef(obj.mikrotik.url))      return { ok: false, message: "mikrotik.url must be a string" };
    if (!isStringOrUndef(obj.mikrotik.username)) return { ok: false, message: "mikrotik.username must be a string" };
    if (!isStringOrUndef(obj.mikrotik.password)) return { ok: false, message: "mikrotik.password must be a string" };
  }

  if (obj.services !== undefined) {
    if (typeof obj.services !== "object" || obj.services === null) return { ok: false, message: "services must be an object" };
    for (const [name, svc] of Object.entries(obj.services)) {
      if (typeof svc !== "object" || svc === null) return { ok: false, message: `services.${name} must be an object` };
      const s = svc as Record<string, unknown>;
      for (const k of ["url", "apiKey", "username", "password"]) {
        if (!isStringOrUndef(s[k])) return { ok: false, message: `services.${name}.${k} must be a string` };
      }
    }
  }

  if (obj.grafana !== undefined) {
    if (typeof obj.grafana !== "object" || obj.grafana === null) return { ok: false, message: "grafana must be an object" };
    for (const k of ["baseUrl", "dashboardUid", "datasourceUid", "panelId", "dashboardSlug"]) {
      if (!isStringOrUndef((obj.grafana as Record<string, unknown>)[k])) return { ok: false, message: `grafana.${k} must be a string` };
    }
  }

  if (obj.preferences !== undefined) {
    if (typeof obj.preferences !== "object" || obj.preferences === null) return { ok: false, message: "preferences must be an object" };
    if (!isStringOrUndef((obj.preferences as Record<string, unknown>).searchEngine)) return { ok: false, message: "preferences.searchEngine must be a string" };
    if (!isStringOrUndef((obj.preferences as Record<string, unknown>).timezone))     return { ok: false, message: "preferences.timezone must be a string" };
  }

  return { ok: true, cfg: obj as PartialFileConfig };
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON body" }, { status: 400 }); }

  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, message: validated.message }, { status: 400 });
  }

  const writable = await isConfigWritable();
  if (!writable) {
    return NextResponse.json({
      ok: false,
      message: "Config volume is not writable. Mount a writable directory at /app/data — e.g. add `volumes: - ./dashboard-data:/app/data` to your docker-compose.yml or `-v /root/dashboard-data:/app/data` to docker run. Then redeploy and try Save & apply again.",
    }, { status: 503 });
  }

  const result = await writeConfigFile(validated.cfg);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  invalidateConfigCache();
  return NextResponse.json({ ok: true, message: result.message });
}
