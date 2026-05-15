"use client";

import { useMemo } from "react";

interface UptimeSegment {
  start: number;
  end: number;
  up: boolean;
}

interface UptimeTimelineProps {
  history: { ts: number; up: boolean }[];
  height?: number;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function UptimeTimeline({ history, height = 32 }: UptimeTimelineProps) {
  const segments = useMemo<UptimeSegment[]>(() => {
    if (history.length === 0) return [];
    const sorted = [...history].sort((a, b) => a.ts - b.ts);
    const segs: UptimeSegment[] = [];
    let cur: UptimeSegment = { start: sorted[0].ts, end: sorted[0].ts, up: sorted[0].up };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].up === cur.up) {
        cur.end = sorted[i].ts;
      } else {
        segs.push(cur);
        cur = { start: sorted[i].ts, end: sorted[i].ts, up: sorted[i].up };
      }
    }
    segs.push(cur);
    return segs;
  }, [history]);

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height, color: "var(--text-ghost)", fontSize: 11 }}>
        No uptime data available
      </div>
    );
  }

  const totalStart = segments[0].start;
  const totalEnd = segments[segments.length - 1].end;
  const totalSpan = Math.max(totalEnd - totalStart, 1);

  const uptimeMs = segments.filter(s => s.up).reduce((acc, s) => acc + (s.end - s.start), 0);
  const uptimePct = totalSpan > 0 ? (uptimeMs / totalSpan) * 100 : 100;

  const downSegments = segments.filter(s => !s.up);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Uptime Timeline
        </span>
        <div className="flex items-center gap-3">
          {downSegments.length > 0 && (
            <span style={{ fontSize: 10, color: "var(--critical)", fontVariantNumeric: "tabular-nums" }}>
              {downSegments.length} outage{downSegments.length > 1 ? "s" : ""}
            </span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "monospace",
            color: uptimePct >= 99.9 ? "var(--ok)" : uptimePct >= 99 ? "var(--warn)" : "var(--critical)",
          }}>
            {uptimePct.toFixed(2)}%
          </span>
        </div>
      </div>

      <div style={{
        position: "relative", height, borderRadius: 6, overflow: "hidden",
        background: "var(--ok)", opacity: 0.9,
      }}>
        {segments.filter(s => !s.up).map((seg, i) => {
          const left = ((seg.start - totalStart) / totalSpan) * 100;
          const width = Math.max(((seg.end - seg.start) / totalSpan) * 100, 0.5);
          return (
            <div
              key={i}
              title={`Down: ${fmtTime(seg.start)} — ${fmtTime(seg.end)} (${fmtDuration(seg.end - seg.start)})`}
              style={{
                position: "absolute", top: 0, bottom: 0,
                left: `${left}%`, width: `${width}%`,
                background: "var(--critical)",
                boxShadow: "0 0 6px var(--critical)",
                zIndex: 1,
              }}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between" style={{ fontSize: 9, color: "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>
        <span>{fmtTime(totalStart)}</span>
        <span>last {fmtDuration(totalSpan)}</span>
        <span>{fmtTime(totalEnd)}</span>
      </div>
    </div>
  );
}
