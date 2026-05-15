"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface TopoDevice {
  ip: string;
  mac: string;
  hostname: string;
  interface: string;
  type: "router" | "server" | "device";
  active: boolean;
}

function DeviceIcon({ type, size = 24 }: { type: TopoDevice["type"]; size?: number }) {
  if (type === "router") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="8" width="20" height="8" rx="2" />
        <line x1="6" y1="12" x2="6.01" y2="12" />
        <line x1="10" y1="12" x2="10.01" y2="12" />
        <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
        <path d="M6 16v2" /><path d="M18 16v2" />
      </svg>
    );
  }
  if (type === "server") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="16" rx="2" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

const NODE_COLORS: Record<string, string> = {
  router: "var(--brand)",
  server: "var(--accent-cpu)",
  device: "var(--text-ghost)",
};

export function NetworkTopology({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<TopoDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredDevice, setHoveredDevice] = useState<string | null>(null);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await fetch("/api/topology");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDevices(data.devices ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  const { nodePositions, svgWidth, svgHeight } = useMemo(() => {
    const router = devices.find(d => d.type === "router");
    const others = devices.filter(d => d.type !== "router");

    const groupedByInterface = new Map<string, TopoDevice[]>();
    for (const d of others) {
      const iface = d.interface || "default";
      const existing = groupedByInterface.get(iface) ?? [];
      existing.push(d);
      groupedByInterface.set(iface, existing);
    }

    const groups = Array.from(groupedByInterface.entries());
    const maxPerGroup = Math.max(...groups.map(([, devs]) => devs.length), 1);
    const totalDevices = others.length;

    const cols = Math.min(Math.ceil(Math.sqrt(totalDevices)), 8);
    const rows = Math.ceil(totalDevices / cols);

    const nodeSpaceX = 120;
    const nodeSpaceY = 100;
    const w = Math.max(cols * nodeSpaceX + 100, 400);
    const h = rows * nodeSpaceY + 200;

    const positions: { device: TopoDevice; x: number; y: number }[] = [];

    if (router) {
      positions.push({ device: router, x: w / 2, y: 50 });
    }

    let idx = 0;
    for (const d of others) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = (col + 0.5) * nodeSpaceX + 50;
      const y = row * nodeSpaceY + 160;
      positions.push({ device: d, x, y });
      idx++;
    }

    return { nodePositions: positions, svgWidth: w, svgHeight: h };
  }, [devices]);

  const routerPos = nodePositions.find(n => n.device.type === "router");

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div className="fixed z-50" style={{
        top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "min(900px, calc(100vw - 40px))", maxHeight: "calc(100vh - 80px)",
        background: "var(--card)", border: "1px solid var(--border-bright)",
        borderRadius: 14, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column",
      }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-dim)" }}>
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
              <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Network Topology</span>
            <span style={{ fontSize: 10, color: "var(--text-ghost)" }}>
              {devices.length} device{devices.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
            &times;
          </button>
        </div>

        <div style={{ overflow: "auto", flex: 1, padding: 16 }}>
          {loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-ghost)", fontSize: 12 }}>
              Discovering network...
            </div>
          ) : error ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--critical)", fontSize: 12 }}>
              {error}
            </div>
          ) : devices.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-ghost)", fontSize: 12 }}>
              No devices found — MikroTik may not be configured
            </div>
          ) : (
            <svg
              width="100%"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{ display: "block", maxHeight: "calc(100vh - 200px)" }}
            >
              {routerPos && nodePositions.filter(n => n.device.type !== "router").map((n, i) => (
                <line
                  key={`link-${i}`}
                  x1={routerPos.x} y1={routerPos.y + 20}
                  x2={n.x} y2={n.y - 20}
                  stroke={n.device.active ? "var(--border-mid)" : "var(--border-dim)"}
                  strokeWidth={hoveredDevice === n.device.ip ? 2 : 1}
                  strokeDasharray={n.device.active ? "none" : "4 4"}
                  opacity={hoveredDevice && hoveredDevice !== n.device.ip ? 0.2 : 0.6}
                  style={{ transition: "opacity 0.2s" }}
                />
              ))}

              {nodePositions.map((n, i) => {
                const isHovered = hoveredDevice === n.device.ip;
                const color = NODE_COLORS[n.device.type] ?? "var(--text-ghost)";
                const dimmed = hoveredDevice !== null && !isHovered;
                return (
                  <g
                    key={`node-${i}`}
                    transform={`translate(${n.x}, ${n.y})`}
                    style={{ cursor: "pointer", opacity: dimmed ? 0.3 : 1, transition: "opacity 0.2s" }}
                    onMouseEnter={() => setHoveredDevice(n.device.ip)}
                    onMouseLeave={() => setHoveredDevice(null)}
                  >
                    <circle
                      r={n.device.type === "router" ? 28 : 22}
                      fill={isHovered ? color : "var(--surface)"}
                      stroke={color}
                      strokeWidth={isHovered ? 2.5 : 1.5}
                      opacity={0.9}
                    />
                    {n.device.active && (
                      <circle r={3} cx={n.device.type === "router" ? 20 : 16} cy={n.device.type === "router" ? -20 : -16}
                        fill="var(--ok)" />
                    )}
                    <g transform="translate(-12, -12)" style={{ color: isHovered ? "var(--bg)" : color }}>
                      <DeviceIcon type={n.device.type} />
                    </g>
                    <text
                      y={n.device.type === "router" ? 42 : 36}
                      textAnchor="middle"
                      style={{
                        fontSize: 9, fontWeight: 600,
                        fill: "var(--text-muted)",
                        fontFamily: "monospace",
                      }}
                    >
                      {n.device.hostname || n.device.ip}
                    </text>
                    {n.device.hostname && (
                      <text
                        y={n.device.type === "router" ? 52 : 46}
                        textAnchor="middle"
                        style={{ fontSize: 8, fill: "var(--text-ghost)", fontFamily: "monospace" }}
                      >
                        {n.device.ip}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: "1px solid var(--border-dim)", fontSize: 9, color: "var(--text-ghost)" }}>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }} />
              Router
            </span>
            <span className="flex items-center gap-1">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-cpu)" }} />
              Server
            </span>
            <span className="flex items-center gap-1">
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-ghost)" }} />
              Device
            </span>
          </div>
          <span>via MikroTik ARP + DHCP</span>
        </div>
      </div>
    </>
  );
}
