"use client";

import { useState } from "react";
import type { BookmarkColumn, ClientConfig } from "@/app/lib/types";
import { BookmarkItem } from "@/app/components/primitives";

export interface BookmarksPanelProps {
  clientConfig: ClientConfig | null;
  setClientConfig: (config: ClientConfig) => void;
}

export function BookmarksPanel({ clientConfig, setClientConfig }: BookmarksPanelProps) {
  const [editBookmarks,  setEditBookmarks]  = useState(false);
  const [bookmarkDraft,  setBookmarkDraft]  = useState<BookmarkColumn[] | null>(null);
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [bookmarkError,  setBookmarkError]  = useState<string | null>(null);

  const columns = editBookmarks && bookmarkDraft ? bookmarkDraft : (clientConfig?.bookmarks ?? []);
  const updateDraft = (next: BookmarkColumn[]) => setBookmarkDraft(next);
  const startEdit = () => { setBookmarkDraft(JSON.parse(JSON.stringify(columns))); setEditBookmarks(true); setBookmarkError(null); };
  const cancelEdit = () => { setBookmarkDraft(null); setEditBookmarks(false); setBookmarkError(null); };
  const saveBookmarks = async () => {
    if (!bookmarkDraft) return;
    setBookmarkSaving(true);
    setBookmarkError(null);
    try {
      const res = await fetch("/api/bookmarks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookmarks: bookmarkDraft }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        if (clientConfig) setClientConfig({ ...clientConfig, bookmarks: bookmarkDraft });
        setEditBookmarks(false); setBookmarkDraft(null);
      } else {
        setBookmarkError(body?.message ?? `Save failed (HTTP ${res.status})`);
      }
    } catch (e) {
      setBookmarkError(`Save failed: ${(e as Error).message}`);
    }
    setBookmarkSaving(false);
  };
  const addColumn = () => { if (!bookmarkDraft) return; updateDraft([...bookmarkDraft, { title: "New Section", accentColor: "#06b6d4", items: [] }]); };
  const removeColumn = (ci: number) => { if (!bookmarkDraft) return; updateDraft(bookmarkDraft.filter((_, i) => i !== ci)); };
  const addItem = (ci: number) => { if (!bookmarkDraft) return; const d = [...bookmarkDraft]; d[ci] = { ...d[ci], items: [...d[ci].items, { name: "", url: "", icon: "" }] }; updateDraft(d); };
  const removeItem = (ci: number, ii: number) => { if (!bookmarkDraft) return; const d = [...bookmarkDraft]; d[ci] = { ...d[ci], items: d[ci].items.filter((_, i) => i !== ii) }; updateDraft(d); };
  const updateItem = (ci: number, ii: number, field: string, val: string) => {
    if (!bookmarkDraft) return;
    const d = [...bookmarkDraft];
    d[ci] = { ...d[ci], items: d[ci].items.map((item, i) => i === ii ? { ...item, [field]: val } : item) };
    updateDraft(d);
  };
  const updateColumn = (ci: number, field: string, val: string) => {
    if (!bookmarkDraft) return;
    const d = [...bookmarkDraft]; d[ci] = { ...d[ci], [field]: val }; updateDraft(d);
  };
  const moveItem = (ci: number, ii: number, dir: -1 | 1) => {
    if (!bookmarkDraft) return;
    const d = [...bookmarkDraft]; const items = [...d[ci].items];
    const ni = ii + dir; if (ni < 0 || ni >= items.length) return;
    [items[ii], items[ni]] = [items[ni], items[ii]];
    d[ci] = { ...d[ci], items }; updateDraft(d);
  };

  const readonly = editBookmarks && clientConfig?.writable === false;
  return (
    <div className="flex flex-col gap-4" style={{ background: "var(--surface-dim)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "20px 24px" }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)", letterSpacing: "0.15em" }}>bookmarks</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {editBookmarks ? (
            <>
              <button onClick={addColumn} style={{ fontSize: 9, color: "var(--brand)", background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>+ Section</button>
              <button onClick={cancelEdit} style={{ fontSize: 9, color: "var(--text-dim)", background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Cancel</button>
              <button onClick={saveBookmarks} disabled={bookmarkSaving || readonly} title={readonly ? "Mount /app/data to enable saves" : undefined} style={{ fontSize: 9, color: "#0a0c12", background: readonly ? "var(--text-ghost)" : "var(--brand)", border: "none", borderRadius: 5, padding: "3px 10px", cursor: (bookmarkSaving || readonly) ? "not-allowed" : "pointer", fontWeight: 600, opacity: readonly ? 0.6 : 1 }}>
                {bookmarkSaving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button onClick={startEdit} style={{ fontSize: 9, color: "var(--text-dim)", background: "none", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Edit</button>
              <span style={{ fontSize: 9, color: "var(--text-ghost)" }}>H to toggle</span>
            </>
          )}
        </div>
      </div>

      {editBookmarks && readonly && (
        <div style={{ fontSize: 11, color: "var(--warning)", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, padding: "8px 10px", lineHeight: 1.5 }}>
          <strong>Read-only install.</strong> <code style={{ fontFamily: "monospace" }}>{clientConfig?.writablePath ?? "/app/data"}</code> is not writable, so saves will fail. Add <code style={{ fontFamily: "monospace" }}>-v /host/path/data:/app/data</code> to your <code>docker run</code> command (host dir must be writable by uid 1001) and restart the container.
          {clientConfig?.writableReason && (
            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 10, opacity: 0.85 }}>OS error: {clientConfig.writableReason}</div>
          )}
        </div>
      )}
      {editBookmarks && bookmarkError && (
        <div style={{ fontSize: 11, color: "var(--critical)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 10px", lineHeight: 1.5 }}>
          <strong>Save failed:</strong> {bookmarkError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
              {editBookmarks ? (
                <>
                  <input type="color" value={col.accentColor} onChange={e => updateColumn(ci, "accentColor", e.target.value)}
                    style={{ width: 16, height: 16, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
                  <input value={col.title} onChange={e => updateColumn(ci, "title", e.target.value)}
                    className="text-[9px] uppercase tracking-[0.18em]" placeholder="Section name"
                    style={{ background: "transparent", border: "none", borderBottom: "1px solid var(--border)", color: col.accentColor, opacity: 0.8, outline: "none", width: "100%", padding: "2px 0" }} />
                  <button onClick={() => removeColumn(ci)} title="Remove section"
                    style={{ color: "var(--critical)", background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.accentColor }} />
                  <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: col.accentColor, opacity: 0.8 }}>{col.title}</span>
                </>
              )}
            </div>
            {editBookmarks ? (
              <>
                {col.items.map((item, ii) => (
                  <div key={ii} className="flex items-center gap-1.5 py-1" style={{ borderBottom: "1px solid var(--border-dim)" }}>
                    <div className="flex flex-col gap-0.5" style={{ flexShrink: 0 }}>
                      <button onClick={() => moveItem(ci, ii, -1)} disabled={ii === 0} style={{ fontSize: 8, color: ii > 0 ? "var(--text-dim)" : "var(--text-ghost)", background: "none", border: "none", cursor: ii > 0 ? "pointer" : "default", padding: 0, lineHeight: 1 }}>▲</button>
                      <button onClick={() => moveItem(ci, ii, 1)} disabled={ii === col.items.length - 1} style={{ fontSize: 8, color: ii < col.items.length - 1 ? "var(--text-dim)" : "var(--text-ghost)", background: "none", border: "none", cursor: ii < col.items.length - 1 ? "pointer" : "default", padding: 0, lineHeight: 1 }}>▼</button>
                    </div>
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <input value={item.name} onChange={e => updateItem(ci, ii, "name", e.target.value)} placeholder="Name"
                        style={{ fontSize: 10, background: "transparent", border: "none", borderBottom: "1px solid var(--border-dim)", color: "var(--text)", outline: "none", padding: "1px 0", width: "100%" }} />
                      <input value={item.url} onChange={e => updateItem(ci, ii, "url", e.target.value)} placeholder="https://..."
                        style={{ fontSize: 9, background: "transparent", border: "none", borderBottom: "1px solid var(--border-dim)", color: "var(--text-dim)", outline: "none", padding: "1px 0", width: "100%", fontFamily: "monospace" }} />
                      <input value={item.icon} onChange={e => updateItem(ci, ii, "icon", e.target.value)} placeholder="Icon URL (or leave blank for auto)"
                        style={{ fontSize: 9, background: "transparent", border: "none", borderBottom: "1px solid var(--border-dim)", color: "var(--text-dim)", outline: "none", padding: "1px 0", width: "100%", fontFamily: "monospace" }} />
                    </div>
                    <button onClick={() => removeItem(ci, ii)} title="Remove" style={{ color: "var(--critical)", background: "none", border: "none", cursor: "pointer", fontSize: 10, padding: "0 2px", flexShrink: 0 }}>×</button>
                  </div>
                ))}
                <button onClick={() => addItem(ci)}
                  style={{ fontSize: 9, color: "var(--brand)", background: "none", border: "1px dashed var(--border)", borderRadius: 5, padding: "4px 8px", cursor: "pointer", marginTop: 4, textAlign: "center" }}>
                  + Add bookmark
                </button>
              </>
            ) : (
              col.items.map(item => (
                <BookmarkItem key={item.url + item.name} {...item} />
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
