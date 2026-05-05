import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const PROMETHEUS = `http://${TRUENAS_IP}:30104`;

const FS_EXCLUDE = `fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"`;

async function query(q: string): Promise<number | null> {
  try {
    const url = `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`;
    const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.data?.result?.[0]?.value?.[1];
    return result != null ? parseFloat(result) : null;
  } catch {
    return null;
  }
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

export async function GET() {
  const [
    cpuIdle,
    memTotal,
    memAvailable,
    memSReclaimable,
    uptime,
    diskSizeResults,
    diskAvailResults,
    netRxResults,
    netTxResults,
    gpuUtilRatio,
    gpuMemUsed,
    gpuMemTotal,
    gpuTemp,
    gpuPower,
    gpuPowerLimit,
    gpuInfoResults,
    netRxTotal,
    netTxTotal,
    unameResults,
    cpuCoreCount,
  ] = await Promise.all([
    query(`avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100`),
    query(`node_memory_MemTotal_bytes`),
    query(`node_memory_MemAvailable_bytes`),
    query(`node_memory_SReclaimable_bytes`),
    query(`time() - node_boot_time_seconds`),
    queryAll(`node_filesystem_size_bytes{${FS_EXCLUDE}}`),
    queryAll(`node_filesystem_avail_bytes{${FS_EXCLUDE}}`),
    queryAll(`rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br.*"}[2m])`),
    queryAll(`rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br.*"}[2m])`),
    query(`nvidia_smi_utilization_gpu_ratio`),
    query(`nvidia_smi_memory_used_bytes`),
    query(`nvidia_smi_memory_total_bytes`),
    query(`nvidia_smi_temperature_gpu`),
    query(`nvidia_smi_power_draw_watts`),
    query(`nvidia_smi_power_limit_watts`),
    queryAll(`nvidia_smi_gpu_info`),
    query(`sum(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br.*"})`),
    query(`sum(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br.*"})`),
    queryAll(`node_uname_info`),
    query(`count(node_cpu_seconds_total{mode="idle"})`),
  ]);

  const cpuUsed = cpuIdle != null ? 100 - cpuIdle : null;
  const memUsed = memTotal != null && memAvailable != null ? memTotal - memAvailable : null;
  const gpuUtil = gpuUtilRatio != null ? gpuUtilRatio * 100 : null;
  const gpuName = gpuInfoResults[0]?.metric?.modelName ?? gpuInfoResults[0]?.metric?.name ?? null;

  const uname = unameResults[0]?.metric ?? {};
  const sysInfo = {
    os:       uname.pretty_name ?? uname.sysname ?? null,
    kernel:   uname.release     ?? null,
    arch:     uname.machine     ?? null,
    hostname: uname.nodename    ?? null,
    cpuCores: cpuCoreCount != null ? Math.round(cpuCoreCount) : null,
  };

  const availMap = new Map(diskAvailResults.map((r) => [r.metric.mountpoint, r.value]));
  const disks = diskSizeResults
    .filter((r) => r.metric.mountpoint != null && r.metric.mountpoint.startsWith("/mnt/Pool/Media/"))
    .map((r) => {
      const total = r.value;
      const avail = availMap.get(r.metric.mountpoint) ?? 0;
      const used = total - avail;
      return {
        mountpoint: r.metric.mountpoint,
        device: r.metric.device ?? "",
        fstype: r.metric.fstype ?? "",
        total,
        avail,
        used,
        usedPct: total > 0 ? Math.min(100, (used / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));

  const netRx = netRxResults.reduce((s, r) => s + (isNaN(r.value) ? 0 : r.value), 0);
  const netTx = netTxResults.reduce((s, r) => s + (isNaN(r.value) ? 0 : r.value), 0);
  const primaryIface = netRxResults.length > 0
    ? (netRxResults.reduce((a, b) => (a.value > b.value ? a : b)).metric.device ?? null)
    : null;

  return NextResponse.json({
    cpu: cpuUsed,
    memory: { total: memTotal, used: memUsed, available: memAvailable, sReclaimable: memSReclaimable },
    uptime,
    disks,
    network: { rxBytesPerSec: netRx, txBytesPerSec: netTx, rxBytesTotal: netRxTotal, txBytesTotal: netTxTotal, interfaceName: primaryIface },
    gpu: {
      name: gpuName,
      utilization: gpuUtil,
      memUsed: gpuMemUsed,
      memTotal: gpuMemTotal,
      temperature: gpuTemp,
      powerDraw: gpuPower,
      powerLimit: gpuPowerLimit,
    },
    sysInfo,
    timestamp: Date.now(),
  });
}
