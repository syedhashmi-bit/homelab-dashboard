import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const PROMETHEUS = process.env.PROMETHEUS_URL ?? `http://${TRUENAS_IP}:30104`;

let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 30_000;

interface SmartDisk {
  device: string;
  model: string;
  serial: string;
  temperature: number | null;
  powerOnHours: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  uncorrectableSectors: number | null;
  healthy: boolean;
}

async function queryAll(q: string): Promise<{ metric: Record<string, string>; value: number }[]> {
  try {
    const url = `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`;
    const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.result ?? []).map((r: { metric: Record<string, string>; value: [number, string] }) => ({
      metric: r.metric,
      value: parseFloat(r.value[1]),
    }));
  } catch {
    return [];
  }
}

function buildDiskMap(results: { metric: Record<string, string>; value: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    const dev = r.metric.disk ?? r.metric.device ?? r.metric.name ?? "";
    if (dev) map.set(dev, r.value);
  }
  return map;
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const [tempResults, powerOnResults, reallocResults, pendingResults, uncorrResults, healthResults, modelResults, serialResults] = await Promise.all([
      queryAll('smartmon_temperature_celsius_value{smart_id="194"}'),
      queryAll('smartmon_power_on_hours_value{smart_id="9"}'),
      queryAll('smartmon_reallocated_sector_ct_value{smart_id="5"}'),
      queryAll('smartmon_current_pending_sector_value{smart_id="197"}'),
      queryAll('smartmon_offline_uncorrectable_value{smart_id="198"}'),
      queryAll('smartmon_device_smart_healthy'),
      queryAll('smartmon_device_info{smart_id="device_model"}'),
      queryAll('smartmon_device_info{smart_id="serial_number"}'),
    ]);

    const temps = buildDiskMap(tempResults);
    const powerOn = buildDiskMap(powerOnResults);
    const realloc = buildDiskMap(reallocResults);
    const pending = buildDiskMap(pendingResults);
    const uncorr = buildDiskMap(uncorrResults);
    const healthMap = buildDiskMap(healthResults);

    const modelMap = new Map<string, string>();
    for (const r of modelResults) {
      const dev = r.metric.disk ?? r.metric.device ?? r.metric.name ?? "";
      modelMap.set(dev, r.metric.model_name ?? r.metric.model ?? "Unknown");
    }

    const serialMap = new Map<string, string>();
    for (const r of serialResults) {
      const dev = r.metric.disk ?? r.metric.device ?? r.metric.name ?? "";
      serialMap.set(dev, r.metric.serial_number ?? r.metric.serial ?? "");
    }

    const allDevices = new Set([...temps.keys(), ...powerOn.keys(), ...realloc.keys(), ...healthMap.keys()]);

    const disks: SmartDisk[] = Array.from(allDevices).map(dev => {
      const reallocVal = realloc.get(dev) ?? null;
      const pendingVal = pending.get(dev) ?? null;
      const uncorrVal = uncorr.get(dev) ?? null;
      const h = healthMap.get(dev);
      const healthy = h != null ? h === 1 : (
        (reallocVal === null || reallocVal === 0) &&
        (pendingVal === null || pendingVal === 0) &&
        (uncorrVal === null || uncorrVal === 0)
      );

      return {
        device: dev,
        model: modelMap.get(dev) ?? "Unknown",
        serial: serialMap.get(dev) ?? "",
        temperature: temps.get(dev) ?? null,
        powerOnHours: powerOn.get(dev) ?? null,
        reallocatedSectors: reallocVal,
        pendingSectors: pendingVal,
        uncorrectableSectors: uncorrVal,
        healthy,
      };
    }).sort((a, b) => a.device.localeCompare(b.device));

    const response = { disks, timestamp: Date.now() };
    cache = { data: response, ts: Date.now() };
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ disks: [], error: (e as Error).message }, { status: 500 });
  }
}
