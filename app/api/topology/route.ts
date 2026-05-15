import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";

interface TopoDevice {
  ip: string;
  mac: string;
  hostname: string;
  interface: string;
  type: "router" | "server" | "device";
  active: boolean;
}

let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 30_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  const cfg = await loadConfig();
  if (!cfg.mikrotik.configured) {
    return NextResponse.json({ devices: [], error: "MikroTik not configured" }, { status: 503 });
  }

  try {
    const auth = Buffer.from(`${cfg.mikrotik.username}:${cfg.mikrotik.password}`, "utf8").toString("base64");
    const headers = { Authorization: "Basic " + auth, Accept: "application/json" };
    const opts = { headers, cache: "no-store" as const, signal: AbortSignal.timeout(8000) };

    const [arpRes, dhcpRes, ifRes] = await Promise.allSettled([
      fetch(`${cfg.mikrotik.url}/rest/ip/arp`, opts),
      fetch(`${cfg.mikrotik.url}/rest/ip/dhcp-server/lease`, opts),
      fetch(`${cfg.mikrotik.url}/rest/interface`, opts),
    ]);

    const arpData: Record<string, unknown>[] = arpRes.status === "fulfilled" && arpRes.value.ok
      ? await arpRes.value.json() : [];
    const dhcpData: Record<string, unknown>[] = dhcpRes.status === "fulfilled" && dhcpRes.value.ok
      ? await dhcpRes.value.json() : [];
    const ifData: Record<string, unknown>[] = ifRes.status === "fulfilled" && ifRes.value.ok
      ? await ifRes.value.json() : [];

    const dhcpMap = new Map<string, string>();
    for (const lease of dhcpData) {
      const mac = String(lease["mac-address"] ?? "").toUpperCase();
      const hostname = String(lease["host-name"] ?? lease["comment"] ?? "");
      if (mac && hostname) dhcpMap.set(mac, hostname);
    }

    const interfaces = ifData.map(i => ({
      name: String(i.name ?? ""),
      type: String(i.type ?? ""),
      running: i.running === "true" || i.running === true,
    }));

    const routerIp = cfg.mikrotik.url?.replace(/^https?:\/\//, "").replace(/:\d+$/, "") ?? "192.168.88.1";

    const devices: TopoDevice[] = [
      { ip: routerIp, mac: "", hostname: "MikroTik Router", interface: "", type: "router", active: true },
    ];

    const seenMacs = new Set<string>();
    for (const entry of arpData) {
      const ip = String(entry.address ?? "");
      const mac = String(entry["mac-address"] ?? "").toUpperCase();
      if (!ip || !mac || mac === "FF:FF:FF:FF:FF:FF") continue;
      if (seenMacs.has(mac)) continue;
      seenMacs.add(mac);

      const iface = String(entry.interface ?? "");
      const hostname = dhcpMap.get(mac) ?? "";
      const isServer = hostname.toLowerCase().includes("truenas") ||
                       hostname.toLowerCase().includes("server") ||
                       ip === (process.env.TRUENAS_IP || "192.168.88.196");

      devices.push({
        ip,
        mac,
        hostname,
        interface: iface,
        type: isServer ? "server" : "device",
        active: entry.dynamic === "true" || entry.dynamic === true || !entry.invalid,
      });
    }

    const response = {
      devices,
      interfaces,
      routerIp,
      timestamp: Date.now(),
    };
    cache = { data: response, ts: Date.now() };
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ devices: [], error: (e as Error).message }, { status: 502 });
  }
}
