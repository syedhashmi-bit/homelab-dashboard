import { NextResponse } from "next/server";

export async function GET() {
  try {
    const creds = Buffer.from("monitor-only:L03m1Tv0@3").toString("base64");
    const res = await fetch("http://192.168.88.1/rest/system/resource", {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as Record<string, unknown>;
    // MikroTik REST API returns all values as strings, not numbers
    const num = (k: string): number | null => {
      const v = d[k];
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") { const n = parseFloat(v); return isNaN(n) ? null : n; }
      return null;
    };
    const str = (k: string): string | null => {
      const v = d[k];
      return typeof v === "string" ? v : (typeof v === "number" ? String(v) : null);
    };
    const memTotal = num("total-memory");
    const freeMem  = num("free-memory");
    const hddTotal = num("total-hdd-space");
    const freeHdd  = num("free-hdd-space");
    return NextResponse.json({
      board:    str("board-name"),
      version:  str("version"),
      cpu:      num("cpu-load"),
      memUsed:  memTotal !== null && freeMem  !== null ? memTotal - freeMem  : null,
      memTotal,
      hddUsed:  hddTotal !== null && freeHdd  !== null ? hddTotal - freeHdd  : null,
      hddTotal,
      uptime:   str("uptime"),
      temp:     num("temperature"),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
