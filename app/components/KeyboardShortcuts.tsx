"use client";

const SHORTCUTS: { key: string; desc: string }[] = [
  { key: "R",     desc: "Refresh metrics" },
  { key: "G",     desc: "Focus search bar" },
  { key: "H",     desc: "Toggle bookmarks" },
  { key: "/",     desc: "Focus service filter" },
  { key: "Esc",   desc: "Close panel / unfocus" },
  { key: "?",     desc: "Toggle this overlay" },
  { key: "Ctrl+K", desc: "Open command palette" },
];

export function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div className="fixed z-50" style={{
        top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: "var(--card)", border: "1px solid var(--border-bright)",
        borderRadius: 14, padding: "24px 28px", minWidth: 320, maxWidth: 400,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Keyboard Shortcuts</span>
          <button onClick={onClose} style={{ color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
            &times;
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {SHORTCUTS.map(s => (
            <div key={s.key} className="flex items-center justify-between gap-4" style={{ padding: "4px 0" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.desc}</span>
              <kbd style={{
                fontSize: 10, fontFamily: "monospace", fontWeight: 600,
                background: "var(--surface)", border: "1px solid var(--border-mid)",
                borderRadius: 4, padding: "2px 8px", color: "var(--text-bright)",
                whiteSpace: "nowrap",
              }}>{s.key}</kbd>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 9, color: "var(--text-ghost)", textAlign: "center" }}>
          Press <kbd style={{ fontFamily: "monospace", fontSize: 9 }}>?</kbd> or <kbd style={{ fontFamily: "monospace", fontSize: 9 }}>Esc</kbd> to close
        </div>
      </div>
    </>
  );
}
