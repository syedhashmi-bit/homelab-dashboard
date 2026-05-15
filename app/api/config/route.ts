import { NextResponse } from "next/server";
import { loadConfig, writeConfigFile, probeWritable, invalidateConfigCache, type PartialFileConfig } from "@/app/lib/server-config";
import { loadBookmarks } from "@/app/lib/bookmarks";
import type { BookmarkColumn } from "@/app/lib/types";

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
    panels:         { panelId: string; label: string; size: "sm" | "md" | "lg"; url: string }[];
  };
  serviceUrls:  Record<string, string>;
  bookmarks:    BookmarkColumn[];
  fsPathPrefix: string;
  preferences: {
    searchEngine: string;
    timezone:     string;
    theme:        string;
  };
  // True when the data/ volume is writable, i.e. POST will succeed. The wizard
  // shows different copy if false.
  writable: boolean;
  // OS error explaining why /app/data is not writable (only set when writable=false).
  // Surfaced in the UI to help users debug missing volume mounts or wrong uid.
  writableReason?: string;
  writablePath?:   string;
  // True when COMEXE_DOCKER_ENABLED=1. The dashboard renders restart/logs
  // buttons on service cards when this is on.
  dockerEnabled?:  boolean;
  // True when GRAFANA_API_TOKEN is set. Tells the GrafanaCard to use the
  // server-side /render proxy instead of an iframe.
  grafanaTokenSet?: boolean;
}

export async function GET() {
  const config = await loadConfig();
  const writableProbe = await probeWritable();

  // Helper: build a Grafana panel iframe URL for a given panelId.
  function buildPanelUrl(panelId: string): string | null {
    if (!config.grafana.dashboardUid || !config.grafana.datasourceUid) return null;
    const params = new URLSearchParams({
      orgId:               "1",
      from:                "now-24h",
      to:                  "now",
      timezone:            "browser",
      "var-ds_prometheus": config.grafana.datasourceUid!,
      "var-job":           "node",
      "var-nodename":      "truenas",
      "var-node":          "truenas",
      refresh:             "1m",
      panelId,
      theme:               "dark",
    });
    return `${config.grafana.baseUrl}/d-solo/${config.grafana.dashboardUid}/${config.grafana.dashboardSlug}?${params}`;
  }

  const panelUrl = buildPanelUrl(config.grafana.panelId);

  // Build multi-panel URLs from the panels array in config
  const panels: ClientConfig["grafana"]["panels"] = (config.grafana.panels ?? [])
    .map(p => {
      const url = buildPanelUrl(p.panelId);
      if (!url) return null;
      return { panelId: p.panelId, label: p.label, size: p.size, url };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

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
      panels,
    },
    serviceUrls,
    bookmarks:    await loadBookmarks(),
    fsPathPrefix: config.fsPathPrefix,
    preferences:  config.preferences,
    writable:     writableProbe.ok,
    writableReason: writableProbe.ok ? undefined : writableProbe.reason,
    writablePath:   writableProbe.ok ? undefined : writableProbe.path,
    dockerEnabled: process.env.COMEXE_DOCKER_ENABLED === "1" || process.env.COMEXE_DOCKER_ENABLED === "true",
    grafanaTokenSet: !!process.env.GRAFANA_API_TOKEN?.trim(),
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
  preferences?: { searchEngine?: string; timezone?: string; theme?: string };
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
    const panels = (obj.grafana as Record<string, unknown>).panels;
    if (panels !== undefined) {
      if (!Array.isArray(panels)) return { ok: false, message: "grafana.panels must be an array" };
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i] as Record<string, unknown>;
        if (typeof p.panelId !== "string") return { ok: false, message: `grafana.panels[${i}].panelId must be a string` };
        if (typeof p.label !== "string")   return { ok: false, message: `grafana.panels[${i}].label must be a string` };
        if (!["sm", "md", "lg"].includes(p.size as string)) return { ok: false, message: `grafana.panels[${i}].size must be "sm", "md", or "lg"` };
      }
    }
  }

  if (obj.preferences !== undefined) {
    if (typeof obj.preferences !== "object" || obj.preferences === null) return { ok: false, message: "preferences must be an object" };
    if (!isStringOrUndef((obj.preferences as Record<string, unknown>).searchEngine)) return { ok: false, message: "preferences.searchEngine must be a string" };
    if (!isStringOrUndef((obj.preferences as Record<string, unknown>).timezone))     return { ok: false, message: "preferences.timezone must be a string" };
    if (!isStringOrUndef((obj.preferences as Record<string, unknown>).theme))        return { ok: false, message: "preferences.theme must be a string" };
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

  const writable = (await probeWritable()).ok;
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
