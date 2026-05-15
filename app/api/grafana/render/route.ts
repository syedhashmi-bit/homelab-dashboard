// ── /api/grafana/render ──────────────────────────────────────────────────────
// Server-side proxy that fetches a Grafana panel as PNG via the /render/d-solo/
// endpoint. Lets the dashboard embed panels even when Grafana's anonymous
// viewer is disabled — we authenticate with GRAFANA_API_TOKEN (Bearer) and
// serve the PNG to the browser. Avoids the iframe cookie-cross-origin problem
// entirely.
//
// Requirements on the Grafana side:
//   1. The grafana-image-renderer plugin must be installed and configured.
//      Install on the Grafana container:
//        docker exec grafana grafana-cli plugins install grafana-image-renderer
//        docker restart grafana
//      Or use the separate grafana-image-renderer container with
//        GF_RENDERING_SERVER_URL=http://renderer:8081/render set on grafana.
//   2. A service-account API token with Viewer role (or higher) provided as
//      GRAFANA_API_TOKEN env var on the ComExe container.
//
// The browser sees a plain image, refreshed every poll interval via a cache-
// busting query string.

import { NextResponse } from "next/server";

function rewriteToRender(url: string, width: number, height: number): string {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/^\/d(?:-solo)?\//, "/render/d-solo/");
  u.searchParams.set("width",  String(width));
  u.searchParams.set("height", String(height));
  // Force a specific timezone since /render's UA is headless and gets the
  // server's locale — most users want the dashboard's panel times.
  if (!u.searchParams.has("tz")) u.searchParams.set("tz", "browser");
  return u.toString();
}

export async function GET(req: Request) {
  const url    = new URL(req.url).searchParams.get("url");
  const width  = Math.min(2000, Math.max(200, parseInt(new URL(req.url).searchParams.get("width")  ?? "800", 10)));
  const height = Math.min(2000, Math.max(150, parseInt(new URL(req.url).searchParams.get("height") ?? "300", 10)));
  if (!url) return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });

  const token = process.env.GRAFANA_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "GRAFANA_API_TOKEN not set. See INSTALL.md for service-account token setup." }, { status: 503 });
  }

  let renderUrl: string;
  try { renderUrl = rewriteToRender(url, width, height); }
  catch { return NextResponse.json({ error: "Invalid Grafana URL" }, { status: 400 }); }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(renderUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "image/png" },
      signal:  controller.signal,
      cache:   "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // Grafana returns 401 when the token is wrong, 404 when /render isn't
      // available (plugin missing), 500 with rendering error in body.
      const text = await res.text().catch(() => "");
      const isRendererMissing = /grafana-image-renderer|rendering is not available/i.test(text);
      const reason = isRendererMissing
        ? "Grafana's image-renderer plugin is not installed. Install it with: docker exec grafana grafana-cli plugins install grafana-image-renderer && docker restart grafana"
        : `Grafana returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":  res.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Render fetch failed: ${(e as Error).message}` }, { status: 502 });
  }
}
