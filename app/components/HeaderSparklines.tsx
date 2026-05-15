"use client";

function MiniSpark({ data, color, width = 48, height = 16 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = (1 - Math.min(v, max) / max) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

export interface HeaderSparklinesProps {
  cpuHistory: number[];
  memHistory: number[];
  rxHistory: number[];
}

export function HeaderSparklines({ cpuHistory, memHistory, rxHistory }: HeaderSparklinesProps) {
  const recent = (arr: number[]) => arr.slice(-20);
  const last = (arr: number[]) => arr.length > 0 ? arr[arr.length - 1] : null;

  return (
    <div className="hidden lg:flex items-center gap-3" style={{ opacity: 0.85 }}>
      {cpuHistory.length > 1 && (
        <div className="flex items-center gap-1.5" title="CPU">
          <span style={{ fontSize: 8, color: "var(--accent-cpu)", fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 28, textAlign: "right" }}>
            {last(cpuHistory)?.toFixed(0)}%
          </span>
          <MiniSpark data={recent(cpuHistory)} color="var(--accent-cpu)" />
        </div>
      )}
      {memHistory.length > 1 && (
        <div className="flex items-center gap-1.5" title="Memory">
          <span style={{ fontSize: 8, color: "var(--accent-memory)", fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 28, textAlign: "right" }}>
            {last(memHistory)?.toFixed(0)}%
          </span>
          <MiniSpark data={recent(memHistory)} color="var(--accent-memory)" />
        </div>
      )}
      {rxHistory.length > 1 && (
        <div className="flex items-center gap-1.5" title="Network RX">
          <MiniSpark data={recent(rxHistory)} color="var(--accent-network)" />
        </div>
      )}
    </div>
  );
}
