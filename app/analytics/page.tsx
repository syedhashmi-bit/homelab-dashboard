"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AreaChart } from "@/app/components/AreaChart";
import { fmtBytes } from "@/app/lib/formatters";

interface HistoryPoint {
  ts: number;
  cpu?: number | null;
  mem?: number | null;
  net_rx?: number | null;
  net_tx?: number | null;
  gpu?: number | null;
  disk_pct?: number | null;
}

type RangeKey = "1h" | "6h" | "24h" | "7d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "1h",  label: "1 hour" },
  { key: "6h",  label: "6 hours" },
  { key: "24h", label: "24 hours" },
  { key: "7d",  label: "7 days" },
];

const METRICS: { key: keyof Omit<HistoryPoint, "ts">; label: string; color: string; unit: string; yMax?: number; fmt?: (v: number) => string }[] = [
  { key: "cpu",      label: "CPU Usage",       color: "var(--accent-cpu)",      unit: "%",  yMax: 100 },
  { key: "mem",      label: "Memory Usage",     color: "var(--accent-memory)",   unit: "%",  yMax: 100 },
  { key: "gpu",      label: "GPU Utilization",  color: "var(--accent-gpu)",      unit: "%",  yMax: 100 },
  { key: "disk_pct", label: "Disk Usage (worst)", color: "var(--accent-fs)",    unit: "%",  yMax: 100 },
  { key: "net_rx",   label: "Network RX",       color: "var(--accent-network)", unit: "",   fmt: (v: number) => fmtBytes(v) + "/s" },
  { key: "net_tx",   label: "Network TX",       color: "#8b5cf6",               unit: "",   fmt: (v: number) => fmtBytes(v) + "/s" },
];

function computeStats(data: { value: number | null }[]): { avg: number | null; min: number | null; max: number | null; current: number | null } {
  const vals = data.map(d => d.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return { avg: null, min: null, max: null, current: null };
  return {
    avg: vals.reduce((s, v) => s + v, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    current: vals[vals.length - 1],
  };
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?range=${r}&limit=800`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPoints(data.points ?? []);
    } catch (e) {
      setError((e as Error).message);
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const changeRange = (r: RangeKey) => {
    setRange(r);
  };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      {/* Header */}
      <div className="sticky top-0 z-30" style={{ background: "var(--header-bg)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border-dim)" }}>
        <div className="flex items-center gap-4 px-6 py-3" style={{ maxWidth: 1400, margin: "0 auto" }}>
          <Link href="/" style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>
            &larr; Dashboard
          </Link>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>Analytics</span>
          <div className="flex gap-1 ml-auto">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => changeRange(r.key)}
                style={{
                  fontSize: 10, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                  background: range === r.key ? "var(--brand)" : "var(--card)",
                  color: range === r.key ? "var(--bg)" : "var(--text-dim)",
                  border: `1px solid ${range === r.key ? "var(--brand)" : "var(--border)"}`,
                  fontWeight: range === r.key ? 700 : 400,
                  transition: "all 0.15s",
                }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 sm:px-6 py-6" style={{ maxWidth: 1400, margin: "0 auto" }}>
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: 400, color: "var(--text-ghost)" }}>
            <div className="flex flex-col items-center gap-3">
              <div className="skeleton" style={{ width: 200, height: 16, borderRadius: 4 }} />
              <span style={{ fontSize: 12 }}>Loading history...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center" style={{ height: 400 }}>
            <div style={{ color: "var(--critical)", fontSize: 13 }}>Failed to load: {error}</div>
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ height: 400, color: "var(--text-ghost)" }}>
            <span style={{ fontSize: 32 }}>&#x1f4ca;</span>
            <span style={{ fontSize: 13 }}>No historical data yet</span>
            <span style={{ fontSize: 11, maxWidth: 360, textAlign: "center", lineHeight: 1.6 }}>
              Metrics are recorded every poll cycle. Data will appear here after a few minutes of dashboard operation.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {METRICS.map(m => {
                const chartData = points.map(p => ({ ts: p.ts, value: (p[m.key] as number | null) ?? null }));
                const stats = computeStats(chartData);
                const fmtVal = m.fmt ?? ((v: number) => `${v.toFixed(1)}${m.unit}`);
                return (
                  <div key={m.key} style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 9, color: m.color, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 8 }}>
                      {m.label}
                    </div>
                    <div className="flex flex-col gap-1">
                      {stats.current !== null ? (
                        <>
                          <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: "var(--text)" }}>
                            {fmtVal(stats.current)}
                          </div>
                          <div className="flex gap-3" style={{ fontSize: 9, color: "var(--text-ghost)" }}>
                            <span>avg {fmtVal(stats.avg!)}</span>
                            <span>max {fmtVal(stats.max!)}</span>
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>&mdash;</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {METRICS.map(m => {
                const chartData = points.map(p => ({ ts: p.ts, value: (p[m.key] as number | null) ?? null }));
                return (
                  <div key={m.key} style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "16px 18px" }}>
                    <AreaChart
                      data={chartData}
                      color={m.color}
                      height={200}
                      label={m.label}
                      unit={m.unit}
                      formatValue={m.fmt}
                      yMax={m.yMax}
                    />
                  </div>
                );
              })}
            </div>

            {/* Data info footer */}
            <div className="flex items-center justify-between" style={{ fontSize: 10, color: "var(--text-ghost)", padding: "4px 0" }}>
              <span>{points.length} data points over {range}</span>
              {points.length > 0 && (
                <span>
                  {new Date(points[0].ts).toLocaleString()} — {new Date(points[points.length - 1].ts).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
