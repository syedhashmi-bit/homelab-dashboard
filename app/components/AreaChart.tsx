"use client";

import { useId, useMemo, useState, useRef, useCallback } from "react";

export interface AreaChartProps {
  data: { ts: number; value: number | null }[];
  color: string;
  height?: number;
  label?: string;
  unit?: string;
  formatValue?: (v: number) => string;
  yMax?: number;
}

function defaultFormat(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}G`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function AreaChart({ data, color, height = 180, label, unit = "", formatValue, yMax: yMaxProp }: AreaChartProps) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  const fmt = formatValue ?? defaultFormat;

  const filtered = useMemo(() => data.filter(d => d.value !== null) as { ts: number; value: number }[], [data]);

  const { points, yMax, yMin, xLabels } = useMemo(() => {
    if (filtered.length < 2) return { points: "", yMax: 100, yMin: 0, xLabels: [] as { x: number; label: string }[] };

    const vals = filtered.map(d => d.value);
    const max = yMaxProp ?? Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const W = 1000, H = height;
    const PAD_Y = 10, PAD_X = 0;

    const pts = filtered.map((d, i) => {
      const x = PAD_X + (i / (filtered.length - 1)) * (W - PAD_X * 2);
      const y = PAD_Y + (1 - (d.value - min) / (max - min || 1)) * (H - PAD_Y * 2);
      return { x, y };
    });

    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    const tsMin = filtered[0].ts;
    const tsMax = filtered[filtered.length - 1].ts;
    const spanH = (tsMax - tsMin) / 3_600_000;
    const labelCount = Math.min(8, Math.max(3, Math.floor(spanH)));
    const labels: { x: number; label: string }[] = [];
    for (let i = 0; i <= labelCount; i++) {
      const frac = i / labelCount;
      const ts = tsMin + frac * (tsMax - tsMin);
      const x = PAD_X + frac * (W - PAD_X * 2);
      labels.push({ x, label: spanH > 48 ? fmtDate(ts) : fmtTime(ts) });
    }

    return { points: line, yMax: max, yMin: min, xLabels: labels };
  }, [filtered, height, yMaxProp]);

  const area = useMemo(() => {
    if (!points) return "";
    const lastX = 1000, firstX = 0;
    return `${points} L${lastX},${height} L${firstX},${height} Z`;
  }, [points, height]);

  const handleMouse = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || filtered.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (filtered.length - 1));
    const clamped = Math.max(0, Math.min(filtered.length - 1, idx));
    setHover({ x: frac * 1000, idx: clamped });
  }, [filtered]);

  const hoveredPoint = hover && filtered[hover.idx];

  if (filtered.length < 2) {
    return (
      <div className="flex flex-col gap-2" style={{ height }}>
        <div className="flex items-center justify-center h-full" style={{ color: "var(--text-ghost)", fontSize: 12 }}>
          No data available
        </div>
      </div>
    );
  }

  const yLabels = [yMax, (yMax + (yMin ?? 0)) / 2, yMin ?? 0];

  return (
    <div className="flex flex-col gap-1 relative">
      {label && (
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 11, color: color, fontWeight: 600, letterSpacing: "0.02em" }}>{label}</span>
          {hoveredPoint && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>
              {fmt(hoveredPoint.value)}{unit} at {fmtTime(hoveredPoint.ts)}
            </span>
          )}
        </div>
      )}
      <div className="relative" style={{ height }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 1000 ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height, display: "block", cursor: "crosshair" }}
          onMouseMove={handleMouse}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`ag${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.4" />
              <stop offset="60%" stopColor={color} stopOpacity="0.12" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* grid lines */}
          {[0.25, 0.5, 0.75].map(frac => (
            <line key={frac} x1="0" y1={10 + frac * (height - 20)} x2="1000" y2={10 + frac * (height - 20)}
              stroke="var(--border-dim)" strokeWidth="1" strokeDasharray="4 6" />
          ))}

          {/* area + line */}
          <path d={area} fill={`url(#ag${uid})`} />
          <path d={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" opacity="0.15" />
          <path d={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* hover crosshair */}
          {hover && (
            <>
              <line x1={hover.x} y1="0" x2={hover.x} y2={height} stroke={color} strokeWidth="1" opacity="0.5" strokeDasharray="3 3" />
              {hoveredPoint && (() => {
                const hY = 10 + (1 - (hoveredPoint.value - (yMin ?? 0)) / (yMax - (yMin ?? 0) || 1)) * (height - 20);
                return <circle cx={hover.x} cy={hY} r="4" fill={color} stroke="var(--bg)" strokeWidth="2" />;
              })()}
            </>
          )}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-1 top-0 bottom-0 flex flex-col justify-between pointer-events-none" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {yLabels.map((v, i) => (
            <span key={i} style={{ fontSize: 9, color: "var(--text-ghost)", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
              {fmt(v)}{unit}
            </span>
          ))}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between" style={{ paddingLeft: 4, paddingRight: 4 }}>
        {xLabels.map((l, i) => (
          <span key={i} style={{ fontSize: 9, color: "var(--text-ghost)", fontFamily: "monospace" }}>{l.label}</span>
        ))}
      </div>
    </div>
  );
}
