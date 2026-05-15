import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

interface ServerEntry {
  id: string;
  name: string;
  prometheusUrl: string;
  enabled: boolean;
}

interface ServerStatus extends ServerEntry {
  reachable: boolean;
  cpu: number | null;
  memPct: number | null;
  uptime: number | null;
  lastChecked: number;
}

const SERVERS_PATH = path.join(process.cwd(), "data", "servers.json");

async function loadServers(): Promise<ServerEntry[]> {
  try {
    const raw = await readFile(SERVERS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveServers(servers: ServerEntry[]): Promise<void> {
  await mkdir(path.dirname(SERVERS_PATH), { recursive: true });
  await writeFile(SERVERS_PATH, JSON.stringify(servers, null, 2), "utf-8");
}

async function queryPrometheus(baseUrl: string, query: string): Promise<number | null> {
  try {
    const url = `${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.data?.result?.[0]?.value?.[1];
    return result != null ? parseFloat(result) : null;
  } catch {
    return null;
  }
}

async function checkServer(server: ServerEntry): Promise<ServerStatus> {
  if (!server.enabled) {
    return { ...server, reachable: false, cpu: null, memPct: null, uptime: null, lastChecked: Date.now() };
  }

  try {
    const [cpu, memTotal, memAvail, uptime] = await Promise.all([
      queryPrometheus(server.prometheusUrl, '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'),
      queryPrometheus(server.prometheusUrl, 'node_memory_MemTotal_bytes'),
      queryPrometheus(server.prometheusUrl, 'node_memory_MemAvailable_bytes'),
      queryPrometheus(server.prometheusUrl, 'node_time_seconds - node_boot_time_seconds'),
    ]);

    const memPct = memTotal != null && memAvail != null
      ? Math.round(((memTotal - memAvail) / memTotal) * 100)
      : null;

    return {
      ...server,
      reachable: true,
      cpu: cpu != null ? Math.round(cpu * 10) / 10 : null,
      memPct,
      uptime: uptime != null ? Math.round(uptime) : null,
      lastChecked: Date.now(),
    };
  } catch {
    return { ...server, reachable: false, cpu: null, memPct: null, uptime: null, lastChecked: Date.now() };
  }
}

export async function GET() {
  const servers = await loadServers();
  const statuses = await Promise.all(servers.map(checkServer));
  return NextResponse.json({ servers: statuses });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, prometheusUrl } = body;
    if (!name || !prometheusUrl) {
      return NextResponse.json({ ok: false, message: "name and prometheusUrl required" }, { status: 400 });
    }

    const servers = await loadServers();
    const id = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    servers.push({ id, name, prometheusUrl, enabled: true });
    await saveServers(servers);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "id required" }, { status: 400 });

    const servers = await loadServers();
    const filtered = servers.filter(s => s.id !== id);
    await saveServers(filtered);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ ok: false, message: "id required" }, { status: 400 });

    const servers = await loadServers();
    const idx = servers.findIndex(s => s.id === id);
    if (idx < 0) return NextResponse.json({ ok: false, message: "not found" }, { status: 404 });

    servers[idx] = { ...servers[idx], ...updates };
    await saveServers(servers);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}
