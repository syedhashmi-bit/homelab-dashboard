import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const BASE = `http://${TRUENAS_IP}:30220`;

type RawResult = {
  id?: number;
  ping?: number | null;
  download?: number | null;
  upload?: number | null;
  server_name?: string | null;
  server_host?: string | null;
  scheduled?: boolean;
  failed?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalize(r: RawResult) {
  return {
    ping:           r.ping        ?? null,
    download:       r.download    ?? null,
    upload:         r.upload      ?? null,
    created_at:     r.created_at  ?? null,
    jitter:         null,
    isp:            r.server_name ?? null,
    serverName:     r.server_name ?? null,
    serverLocation: r.server_host ?? null,
  };
}

// Handles all response shapes SpeedTracker might return
function extractArray(json: unknown): RawResult[] {
  if (Array.isArray(json)) return json as RawResult[];
  const j = json as Record<string, unknown>;
  // { data: [...] }
  if (Array.isArray(j.data)) return j.data as RawResult[];
  // { data: { data: [...] } } or { data: { results: [...] } }
  if (j.data && typeof j.data === "object") {
    const inner = j.data as Record<string, unknown>;
    if (Array.isArray(inner.data)) return inner.data as RawResult[];
    if (Array.isArray(inner.results)) return inner.results as RawResult[];
    // { data: { id, download, ... } } — single result object
    if (inner.id != null || inner.download != null) return [inner as RawResult];
  }
  // { results: [...] }
  if (Array.isArray(j.results)) return j.results as RawResult[];
  // { message: "ok", data: { ... } } already handled above; last resort
  return [];
}

const HISTORY_ENDPOINTS = [
  `${BASE}/api/speedtest/results?limit=20`,
  `${BASE}/api/speedtest?limit=20`,
  `${BASE}/api/results?limit=20`,
];

export async function GET() {
  // Try history endpoints in order
  for (const url of HISTORY_ENDPOINTS) {
    try {
      const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      console.log("speedtest history:", res.status, JSON.stringify(data).slice(0, 300));
      if (res.ok) {
        const results = extractArray(data).filter(r => !r.failed);
        if (results.length > 0) {
          return NextResponse.json({ results: results.map(normalize), timestamp: Date.now() });
        }
      }
    } catch { /* try next endpoint */ }
  }

  // Fallback: confirmed-working latest single result
  try {
    const res = await fetch(`${BASE}/api/speedtest/latest`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as Record<string, unknown>;
      const arr = extractArray(json);
      const single = arr.length > 0 ? arr[0] : json.data as RawResult | undefined;
      if (single) {
        return NextResponse.json({ results: [normalize(single)], timestamp: Date.now() });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ results: [], timestamp: Date.now() });
}
