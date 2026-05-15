"use client";

import { useEffect, useState } from "react";

interface AlertEvent {
  key: string;
  level: "warning" | "critical";
  msg: string;
  ts: number;
  fired?: boolean;
}

function relativeTime(ts: number): string {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.json())
      .then(data => {
        const history: AlertEvent[] = Array.isArray(data.history) ? data.history : [];
        setEvents(history.sort((a, b) => b.ts - a.ts).slice(0, 50));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="fixed top-0 right-0 h-full z-50 flex flex-col overflow-y-auto"
        style={{
          width: 340, maxWidth: "100vw",
          background: "var(--settings-bg)", borderLeft: "1px solid var(--settings-border)",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.7)",
        }}
      >
        <div className="flex items-center justify-between p-4 pb-2">
          <span className="text-[11px] tracking-widest uppercase" style={{ color: "var(--text-dim)", fontWeight: 600 }}>
            Notifications
          </span>
          <button onClick={onClose} style={{ color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
            &times;
          </button>
        </div>

        <div className="flex flex-col gap-0 flex-1 p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12" style={{ color: "var(--text-ghost)", fontSize: 11 }}>
              Loading...
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: "var(--text-ghost)" }}>
              <span style={{ fontSize: 24 }}>&#x2705;</span>
              <span style={{ fontSize: 11 }}>No alerts — all clear</span>
            </div>
          ) : (
            events.map((evt, i) => {
              const isCritical = evt.level === "critical";
              const accentColor = isCritical ? "#ef4444" : "#f59e0b";
              return (
                <div key={`${evt.key}-${evt.ts}-${i}`} className="flex gap-3 items-start"
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border-dim)",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--card-alt)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <span className="shrink-0 mt-0.5" style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: accentColor,
                    boxShadow: `0 0 6px ${accentColor}88`,
                  }} />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                        color: accentColor, letterSpacing: "0.05em",
                      }}>
                        {evt.level}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--text-ghost)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                        {relativeTime(evt.ts)}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{evt.msg}</span>
                    <span style={{ fontSize: 9, color: "var(--text-ghost)", fontFamily: "monospace" }}>{evt.key}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
