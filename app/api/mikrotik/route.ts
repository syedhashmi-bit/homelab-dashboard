import { NextResponse } from "next/server";

export async function GET() {
  try {
    const username = "monitor-only";
    const password = "***REMOVED***";
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const res = await fetch("http://192.168.88.1/rest/system/resource", {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    console.log("mikrotik status:", res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as Record<string, unknown>;

    const str = (k: string): string | null => typeof d[k] === "string" ? d[k] as string : null;
    const num = (k: string): number | null => {
      const v = d[k];
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") { const n = parseFloat(v); return isNaN(n) ? null : n; }
      return null;
    };

    const memTotal = num("total-memory");
    const freeMem  = num("free-memory");
    const hddTotal = num("total-hdd-space");
    const freeHdd  = num("free-hdd-space");
    const cpuLoad  = d["cpu-load"];
    const cpu      = cpuLoad != null ? parseInt(String(cpuLoad), 10) : null;

    const ramUsed  = memTotal !== null && freeMem !== null
      ? `${((memTotal - freeMem) / 1073741824).toFixed(1)} GB` : null;
    const ramTotal = memTotal !== null
      ? `${(memTotal / 1073741824).toFixed(1)} GB` : null;
    const ramPct   = memTotal && freeMem != null
      ? Math.round(((memTotal - freeMem) / memTotal) * 100) : null;

    return NextResponse.json({
      board:    str("board-name"),
      version:  str("version"),
      cpu,
      ramUsed,
      ramTotal,
      ramPct,
      hddUsed:  hddTotal !== null && freeHdd !== null ? hddTotal - freeHdd : null,
      hddTotal,
      uptime:   str("uptime"),
      temp:     num("temperature"),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
