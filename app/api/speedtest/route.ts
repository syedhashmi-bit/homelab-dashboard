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
    download:       r.download    ?? null,  // already Mbps
    upload:         r.upload      ?? null,  // already Mbps
    created_at:     r.created_at  ?? null,
    jitter:         null,
    isp:            r.server_name ?? null,
    serverName:     r.server_name ?? null,
    serverLocation: r.server_host ?? null,
  };
}

export async function GET() {
  // History: up to 20 results
  try {
    const res = await fetch(`${BASE}/api/speedtest/results?limit=20`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as { message: string; data: RawResult[] };
      if (Array.isArray(json.data) && json.data.length > 0) {
        return NextResponse.json({ results: json.data.map(normalize), timestamp: Date.now() });
      }
    }
  } catch { /* fall through */ }

  // Fallback: latest single result
  try {
    const res = await fetch(`${BASE}/api/speedtest/latest`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as { message: string; data: RawResult };
      if (json.data) {
        return NextResponse.json({ results: [normalize(json.data)], timestamp: Date.now() });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ results: [], timestamp: Date.now() });
}
