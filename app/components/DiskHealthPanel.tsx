"use client";

import { useCallback, useEffect, useState } from "react";

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

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 24) return `${h}h`;
  if (h < 8760) return `${(h / 24).toFixed(0)}d`;
  return `${(h / 8760).toFixed(1)}y`;
}

function tempColor(t: number): string {
  if (t >= 55) return "var(--critical)";
  if (t >= 45) return "var(--warn)";
  return "var(--ok)";
}

export function DiskHealthPanel() {
  const [disks, setDisks] = useState<SmartDisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/smart");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDisks(data.disks ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 60_000);
    return () => clearInterval(id);
  }, [fetch_]);

  if (loading) {
    return (
      <div style={{ padding: 16, color: "var(--text-ghost)", fontSize: 11 }}>
        Loading SMART data...
      </div>
    );
  }

  if (error || disks.length === 0) {
    return (
      <div className="flex flex-col gap-1" style={{ padding: "8px 0" }}>
        <div className="flex items-center gap-2" style={{ fontSize: 10, color: "var(--text-ghost)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span>{error ? "SMART unavailable" : "No SMART data — smartmon exporter not detected"}</span>
        </div>
      </div>
    );
  }

  const allHealthy = disks.every(d => d.healthy);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-fs)" }}>
            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)" }}>
            Disk Health
          </span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: allHealthy ? "var(--ok)" : "var(--critical)",
        }}>
          {allHealthy ? "All healthy" : "Issues detected"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {disks.map(disk => (
          <div key={disk.device} style={{
            background: "var(--surface)", border: "1px solid var(--border-subtle)",
            borderRadius: 8, padding: "10px 12px",
          }}>
            <div className="flex items-center gap-2 mb-2">
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: disk.healthy ? "var(--ok)" : "var(--critical)",
                boxShadow: `0 0 4px ${disk.healthy ? "var(--ok)" : "var(--critical)"}66`,
              }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>
                {disk.device}
              </span>
              <span style={{ fontSize: 9, color: "var(--text-ghost)", marginLeft: "auto", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {disk.model}
              </span>
            </div>

            <div className="flex gap-3 flex-wrap" style={{ fontSize: 10 }}>
              {disk.temperature != null && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Temp</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: tempColor(disk.temperature) }}>
                    {disk.temperature}°C
                  </span>
                </div>
              )}
              {disk.powerOnHours != null && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Age</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", color: "var(--text-mid)" }}>
                    {fmtHours(disk.powerOnHours)}
                  </span>
                </div>
              )}
              {disk.reallocatedSectors != null && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Realloc</span>
                  <span style={{
                    fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600,
                    color: disk.reallocatedSectors > 0 ? "var(--critical)" : "var(--text-mid)",
                  }}>
                    {disk.reallocatedSectors}
                  </span>
                </div>
              )}
              {disk.pendingSectors != null && disk.pendingSectors > 0 && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Pending</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--critical)" }}>
                    {disk.pendingSectors}
                  </span>
                </div>
              )}
              {disk.uncorrectableSectors != null && disk.uncorrectableSectors > 0 && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Uncorr</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--critical)" }}>
                    {disk.uncorrectableSectors}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
