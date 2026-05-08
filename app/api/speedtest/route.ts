import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const BASE        = `http://${TRUENAS_IP}:30220`;
const BEARER      = process.env.SPEEDTEST_API_KEY ?? "";

interface HistoryRecord {
  id?:         number;
  download?:   number | null;
  upload?:     number | null;
  ping?:       number | null;
  jitter?:     number | null;
  created_at?: string | null;
  server?: {
    name?:     string | null;
    location?: string | null;
    host?:     string | null;
  } | null;
}

async function fetchHistory(): Promise<{ records: HistoryRecord[]; total: number | null }> {
  try {
    const res = await fetch(`${BASE}/api/v1/results?take=5`, {
      headers: { Authorization: `Bearer ${BEARER}`, Accept: "application/json" },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { records: [], total: null };
    const json = await res.json() as { data?: HistoryRecord[]; meta?: { total?: number } };
    return {
      records: json.data ?? [],
      total:   json.meta?.total ?? null,
    };
  } catch {
    return { records: [], total: null };
  }
}

export async function GET() {
  const [latestRes, historyData] = await Promise.all([
    fetch(`${BASE}/api/speedtest/latest`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null),
    fetchHistory(),
  ]);

  // Build the primary result — prefer the richer /api/v1/results record[0] for jitter/location/host
  const richRecord = historyData.records[0] ?? null;

  let primary: Record<string, unknown> | null = null;
  try {
    if (latestRes && latestRes.ok) {
      const json = await latestRes.json() as {
        data?: {
          download?: number; upload?: number; ping?: number;
          created_at?: string; server_name?: string;
        }
      };
      const d = json.data;
      if (d) {
        primary = {
          download:       d.download    ?? richRecord?.download   ?? null,
          upload:         d.upload      ?? richRecord?.upload     ?? null,
          ping:           d.ping        ?? richRecord?.ping       ?? null,
          jitter:         richRecord?.jitter ?? null,
          timestamp:      d.created_at  ?? richRecord?.created_at ?? null,
          isp:            d.server_name ?? richRecord?.server?.name ?? null,
          serverLocation: richRecord?.server?.location ?? null,
          serverHost:     richRecord?.server?.host     ?? null,
        };
      }
    }
  } catch {
    /* fall through to richRecord below */
  }

  // If /api/speedtest/latest failed, use first history record as primary
  if (!primary && richRecord) {
    primary = {
      download:       richRecord.download   ?? null,
      upload:         richRecord.upload     ?? null,
      ping:           richRecord.ping       ?? null,
      jitter:         richRecord.jitter     ?? null,
      timestamp:      richRecord.created_at ?? null,
      isp:            richRecord.server?.name     ?? null,
      serverLocation: richRecord.server?.location ?? null,
      serverHost:     richRecord.server?.host     ?? null,
    };
  }

  const history = historyData.records
    .map(r => r.download ?? null)
    .filter((v): v is number => v !== null)
    .reverse(); // oldest → newest for sparkline left-to-right

  return NextResponse.json({
    results:    primary ? [primary] : [],
    history,
    totalTests: historyData.total,
    timestamp:  Date.now(),
  });
}
