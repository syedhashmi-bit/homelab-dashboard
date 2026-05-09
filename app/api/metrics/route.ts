import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const PROMETHEUS = process.env.PROMETHEUS_URL ?? `http://${TRUENAS_IP}:30104`;

// Per-deployment paths and filters. Defaults match the original homelab setup;
// override at deploy time for a different ZFS pool or non-standard mountpoints.
const FS_PATH_PREFIX = process.env.FS_PATH_PREFIX ?? "/mnt/Pool/Media/";
const POOL_PATH      = process.env.POOL_PATH      ?? "/mnt/Pool";

// PromQL fragments. Keep the network-exclude in sync with whatever virtual
// interfaces should NOT count as "real" traffic on the host.
const NET_EXCLUDE = process.env.NETWORK_DEVICE_EXCLUDE ?? "lo|veth.*|docker.*|br.*";

let metricsCache: { data: unknown; ts: number } | null = null;
// Slightly under the client poll interval (3s) so each poll gets fresh data
// without forcing all ~30 PromQL queries through duplicate work on adjacent ticks.
const CACHE_TTL = 2_500;

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
  if (metricsCache && Date.now() - metricsCache.ts < CACHE_TTL) {
    return NextResponse.json(metricsCache.data);
  }

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
    // new queries — appended at end to preserve positional order
    load1,
    load5,
    load15,
    cpuFreqAvg,
    tcpEstab,
    gpuCoreClock,
    gpuMemClock,
    gpuFanRatio,
    gpuEncRatio,
    gpuDecRatio,
    cpuInfoResults,
  ] = await Promise.all([
    query(`avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100`),
    query(`node_memory_MemTotal_bytes`),
    query(`node_memory_MemAvailable_bytes`),
    query(`node_memory_SReclaimable_bytes`),
    query(`time() - node_boot_time_seconds`),
    queryAll(`node_filesystem_size_bytes{${FS_EXCLUDE}}`),
    queryAll(`node_filesystem_avail_bytes{${FS_EXCLUDE}}`),
    queryAll(`rate(node_network_receive_bytes_total{device!~"${NET_EXCLUDE}"}[2m])`),
    queryAll(`rate(node_network_transmit_bytes_total{device!~"${NET_EXCLUDE}"}[2m])`),
    query(`nvidia_smi_utilization_gpu_ratio`),
    query(`nvidia_smi_memory_used_bytes`),
    query(`nvidia_smi_memory_total_bytes`),
    query(`nvidia_smi_temperature_gpu`),
    query(`nvidia_smi_power_draw_watts`),
    query(`nvidia_smi_power_limit_watts`),
    queryAll(`nvidia_smi_gpu_info`),
    query(`sum(node_network_receive_bytes_total{device!~"${NET_EXCLUDE}"})`),
    query(`sum(node_network_transmit_bytes_total{device!~"${NET_EXCLUDE}"})`),
    queryAll(`node_uname_info`),
    query(`count(node_cpu_seconds_total{mode="idle"})`),
    // new
    query(`node_load1`),
    query(`node_load5`),
    query(`node_load15`),
    query(`avg(node_cpu_scaling_frequency_hertz)`),
    query(`node_netstat_Tcp_CurrEstab`),
    query(`nvidia_smi_clocks_current_graphics_clock_hz`),
    query(`nvidia_smi_clocks_current_memory_clock_hz`),
    query(`nvidia_smi_fan_speed_ratio`),
    query(`nvidia_smi_utilization_encoder_ratio`),
    query(`nvidia_smi_utilization_decoder_ratio`),
    queryAll(`node_cpu_info{cpu="0"}`),
  ]);

  const cpuUsed = cpuIdle != null ? 100 - cpuIdle : null;
  const memUsed = memTotal != null && memAvailable != null ? memTotal - memAvailable : null;
  const gpuUtil = gpuUtilRatio != null ? gpuUtilRatio * 100 : null;
  const gpuName = gpuInfoResults[0]?.metric?.modelName ?? gpuInfoResults[0]?.metric?.name ?? null;

  const uname = unameResults[0]?.metric ?? {};
  const cpuModelRaw = cpuInfoResults[0]?.metric?.model_name ?? null;

  // CPU frequency: metric may be Hz or already MHz — normalise to GHz
  let cpuFreqGhz: number | null = null;
  if (cpuFreqAvg != null) {
    if (cpuFreqAvg > 1e8) cpuFreqGhz = parseFloat((cpuFreqAvg / 1e9).toFixed(2));        // Hz
    else if (cpuFreqAvg > 1e5) cpuFreqGhz = parseFloat((cpuFreqAvg / 1e6).toFixed(2));   // kHz
    else if (cpuFreqAvg > 100) cpuFreqGhz = parseFloat((cpuFreqAvg / 1000).toFixed(2));  // MHz
    else cpuFreqGhz = parseFloat(cpuFreqAvg.toFixed(2));                                  // GHz
  }

  // GPU clock: metric may be Hz or MHz — normalise to MHz for display
  const toMhz = (v: number | null): number | null => {
    if (v == null) return null;
    if (v > 1e8) return Math.round(v / 1e6);   // Hz → MHz
    if (v > 10)  return Math.round(v);           // already MHz
    return null;
  };

  const sysInfo = {
    os:         uname.pretty_name ?? uname.sysname ?? null,
    kernel:     uname.release     ?? null,
    arch:       uname.machine     ?? null,
    hostname:   uname.nodename    ?? null,
    cpuCores:   cpuCoreCount != null ? Math.round(cpuCoreCount) : null,
    cpuModel:   cpuModelRaw,
    cpuFreqGhz,
    load1:      load1  ?? null,
    load5:      load5  ?? null,
    load15:     load15 ?? null,
    tcpEstab:   tcpEstab != null ? Math.round(tcpEstab) : null,
  };

  const availMap = new Map(diskAvailResults.map((r) => [r.metric.mountpoint, r.value]));
  const disks = diskSizeResults
    .filter((r) => r.metric.mountpoint != null && r.metric.mountpoint.startsWith(FS_PATH_PREFIX))
    .map((r) => {
      const total = r.value;
      const avail = availMap.get(r.metric.mountpoint) ?? 0;
      const used  = total - avail;
      return {
        mountpoint: r.metric.mountpoint,
        device:  r.metric.device  ?? "",
        fstype:  r.metric.fstype  ?? "",
        total, avail, used,
        usedPct: total > 0 ? Math.min(100, (used / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));

  // Also grab total pool size from the configured pool root (non-dataset path).
  const poolEntry = diskSizeResults.find(r => r.metric.mountpoint === POOL_PATH);
  const poolAvail  = poolEntry ? (availMap.get(POOL_PATH) ?? 0) : null;
  const poolSize   = poolEntry?.value ?? null;
  const poolUsed   = poolSize != null && poolAvail != null ? poolSize - poolAvail : null;

  const netRx = netRxResults.reduce((s, r) => s + (isNaN(r.value) ? 0 : r.value), 0);
  const netTx = netTxResults.reduce((s, r) => s + (isNaN(r.value) ? 0 : r.value), 0);
  const primaryIface = netRxResults.length > 0
    ? (netRxResults.reduce((a, b) => (a.value > b.value ? a : b)).metric.device ?? null)
    : null;

  const responseData = {
    cpu: cpuUsed,
    memory: { total: memTotal, used: memUsed, available: memAvailable, sReclaimable: memSReclaimable },
    uptime,
    disks,
    pool: { total: poolSize, used: poolUsed, avail: poolAvail },
    network: {
      rxBytesPerSec: netRx, txBytesPerSec: netTx,
      rxBytesTotal: netRxTotal, txBytesTotal: netTxTotal,
      interfaceName: primaryIface,
    },
    gpu: {
      name:        gpuName,
      utilization: gpuUtil,
      memUsed:     gpuMemUsed,
      memTotal:    gpuMemTotal,
      temperature: gpuTemp,
      powerDraw:   gpuPower,
      powerLimit:  gpuPowerLimit,
      coreClock:   toMhz(gpuCoreClock),
      memClock:    toMhz(gpuMemClock),
      fanSpeed:    gpuFanRatio != null ? Math.round(gpuFanRatio * 100) : null,
      encUtil:     gpuEncRatio != null ? Math.round(gpuEncRatio * 100) : null,
      decUtil:     gpuDecRatio != null ? Math.round(gpuDecRatio * 100) : null,
    },
    sysInfo,
    timestamp: Date.now(),
  };
  metricsCache = { data: responseData, ts: Date.now() };
  return NextResponse.json(responseData);
}
