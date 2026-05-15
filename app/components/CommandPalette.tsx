"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  section: string;
  icon?: string;
  action: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
  actions: CommandAction[];
}

export type { CommandAction };

export function CommandPalette({ onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(a =>
      a.label.toLowerCase().includes(q) ||
      a.section.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }, [query, actions]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    for (const a of filtered) {
      const existing = map.get(a.section) ?? [];
      existing.push(a);
      map.set(a.section, existing);
    }
    return map;
  }, [filtered]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = useCallback((action: CommandAction) => {
    onClose();
    setTimeout(() => action.action(), 50);
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        execute(filtered[selectedIndex]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, filtered, selectedIndex, execute]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div className="fixed z-50" style={{
        top: "20%", left: "50%", transform: "translateX(-50%)",
        width: "min(520px, calc(100vw - 32px))",
        background: "var(--card)", border: "1px solid var(--border-bright)",
        borderRadius: 14, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-dim)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command..."
            style={{
              width: "100%", background: "transparent", border: "none", outline: "none",
              fontSize: 14, color: "var(--text)", fontFamily: "inherit",
            }}
          />
        </div>

        <div ref={listRef} style={{ maxHeight: 340, overflowY: "auto", padding: "4px 0" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: "var(--text-ghost)" }}>
              No matching commands
            </div>
          ) : (
            (() => {
              let flatIndex = -1;
              return Array.from(grouped.entries()).map(([section, items]) => (
                <div key={section}>
                  <div style={{
                    padding: "8px 16px 4px", fontSize: 9, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    color: "var(--text-ghost)",
                  }}>
                    {section}
                  </div>
                  {items.map(item => {
                    flatIndex++;
                    const idx = flatIndex;
                    const isSelected = idx === selectedIndex;
                    return (
                      <div
                        key={item.id}
                        onClick={() => execute(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 16px", cursor: "pointer",
                          background: isSelected ? "var(--surface-bright)" : "transparent",
                          transition: "background 0.1s",
                        }}
                      >
                        {item.icon && <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{item.icon}</span>}
                        <span style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>{item.label}</span>
                        {item.shortcut && (
                          <kbd style={{
                            fontSize: 10, fontFamily: "monospace", fontWeight: 600,
                            background: "var(--surface)", border: "1px solid var(--border-mid)",
                            borderRadius: 4, padding: "2px 6px", color: "var(--text-dim)",
                          }}>{item.shortcut}</kbd>
                        )}
                      </div>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>

        <div style={{
          padding: "8px 16px", borderTop: "1px solid var(--border-dim)",
          fontSize: 9, color: "var(--text-ghost)", display: "flex", gap: 12,
        }}>
          <span><kbd style={{ fontFamily: "monospace" }}>↑↓</kbd> navigate</span>
          <span><kbd style={{ fontFamily: "monospace" }}>↵</kbd> select</span>
          <span><kbd style={{ fontFamily: "monospace" }}>esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}
