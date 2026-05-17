"use client";

import { useEffect, useState } from "react";
import type { Settings, ServiceResult, SearchEngine, TempUnit, DataUnit } from "@/app/lib/types";
import { THEMES, TIMEZONES } from "@/app/lib/constants";
import { SearchEngineIcon } from "@/app/components/SearchBar";
import { loadCardOrder, resetCardOrder, saveCardOrder } from "@/app/lib/card-order";
import { CustomCardEditor } from "@/app/components/CustomCardEditor";

export const CARD_KEYS = ["cpu", "memory", "filesystems", "network", "gpu", "speedtest", "system", "grafana", "services", "activity"] as const;

const SVC_LABELS: Record<string, string> = {
  qbittorrent: "qBittorrent",
  nginx:       "Nginx Proxy",
  uptimekuma:  "Uptime Kuma",
};

export function SettingsPanel({ settings, onUpdate, onClose, services }: {
  settings: Settings;
  onUpdate: (s: Settings) => void;
  onClose: () => void;
  services?: ServiceResult[] | null;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col gap-5 p-4 sm:p-6 overflow-y-auto w-full sm:w-[272px]"
        style={{ maxWidth: 320, background: "var(--settings-bg)", borderLeft: "1px solid var(--settings-border)", boxShadow: "-12px 0 40px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] tracking-widest uppercase" style={{ color: "var(--settings-text)" }}>Settings</span>
          <button onClick={onClose} style={{ color: "var(--settings-text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>

        {[
          { title: "Refresh", options: [10, 15, 30, 60], key: "refreshInterval" as const, fmt: (v: number) => `${v}s` },
        ].map(({ title, options, key, fmt }) => (
          <div key={key} className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>{title}</span>
            <div className="flex gap-1.5">
              {options.map(o => (
                <button key={o} onClick={() => onUpdate({ ...settings, [key]: o })}
                  className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                  style={{
                    background: settings[key] === o ? "var(--settings-active-bg)" : "var(--settings-input)",
                    border: `1px solid ${settings[key] === o ? "var(--settings-active-border)" : "var(--settings-input-border)"}`,
                    color: settings[key] === o ? "var(--settings-active)" : "var(--settings-text)", cursor: "pointer",
                  }}
                >{fmt(o)}</button>
              ))}
            </div>
          </div>
        ))}

        <RefreshOverrides settings={settings} onUpdate={onUpdate} />

        <button
          onClick={() => { resetCardOrder(); window.location.reload(); }}
          style={{
            fontSize: 10, padding: "4px 8px", borderRadius: 4,
            background: "var(--settings-input)", color: "var(--settings-text)",
            border: "1px solid var(--settings-input-border)", cursor: "pointer",
            alignSelf: "flex-start",
          }}
          title="Reset the dashboard card order to defaults (this browser only)"
        >Reset card layout</button>

        <CustomCardSection />

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Temperature</span>
          <div className="flex gap-1.5">
            {(["C", "F"] as TempUnit[]).map(u => (
              <button key={u} onClick={() => onUpdate({ ...settings, tempUnit: u })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                style={{
                  background: settings.tempUnit === u ? "var(--settings-active-bg)" : "var(--settings-input)",
                  border: `1px solid ${settings.tempUnit === u ? "var(--settings-active-border)" : "var(--settings-input-border)"}`,
                  color: settings.tempUnit === u ? "var(--settings-active)" : "var(--settings-text)", cursor: "pointer",
                }}
              >°{u}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Data Units</span>
          <div className="flex gap-1.5">
            {(["decimal", "binary"] as DataUnit[]).map(u => (
              <button key={u} onClick={() => onUpdate({ ...settings, dataUnit: u })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                style={{
                  background: settings.dataUnit === u ? "var(--settings-active-bg)" : "var(--settings-input)",
                  border: `1px solid ${settings.dataUnit === u ? "var(--settings-active-border)" : "var(--settings-input-border)"}`,
                  color: settings.dataUnit === u ? "var(--settings-active)" : "var(--settings-text)", cursor: "pointer",
                }}
              >{u === "decimal" ? "GB" : "GiB"}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Search Engine</span>
          <div className="flex gap-1.5 flex-wrap">
            {(["google", "bing", "duckduckgo", "kagi"] as SearchEngine[]).map(e => (
              <button key={e} onClick={() => onUpdate({ ...settings, searchEngine: e })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150 flex items-center justify-center gap-1"
                style={{
                  background: settings.searchEngine === e ? "var(--settings-active-bg)" : "var(--settings-input)",
                  border: `1px solid ${settings.searchEngine === e ? "var(--settings-active-border)" : "var(--settings-input-border)"}`,
                  color: settings.searchEngine === e ? "var(--settings-active)" : "var(--settings-text)", cursor: "pointer",
                  minWidth: 0, padding: "6px 4px",
                }}
              >
                <SearchEngineIcon engine={e} size={10} />
                <span style={{ fontSize: 9 }}>{e === "duckduckgo" ? "DDG" : e.charAt(0).toUpperCase() + e.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Timezone</span>
          <select
            value={settings.timezone}
            onChange={e => onUpdate({ ...settings, timezone: e.target.value })}
            style={{
              background: "var(--settings-input)", border: "1px solid var(--settings-input-border)", borderRadius: 6,
              padding: "6px 8px", fontSize: 10, color: settings.timezone ? "var(--settings-active)" : "#444",
              cursor: "pointer", outline: "none", width: "100%",
            }}
          >
            <option value="">Browser local</option>
            {TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Theme</span>
          <div className="flex gap-1.5">
            {THEMES.map(t => {
              const active = settings.theme === t.key;
              return (
                <button key={t.key} onClick={() => onUpdate({ ...settings, theme: t.key })}
                  className="flex-1 flex flex-col items-center gap-1 py-2 rounded transition-all duration-150"
                  style={{
                    background: active ? "var(--settings-active-bg)" : "var(--settings-input)",
                    border: `1px solid ${active ? "var(--settings-active-border)" : "var(--settings-input-border)"}`,
                    cursor: "pointer", minWidth: 0,
                  }}
                >
                  <div className="flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 9, background: t.bg, border: `2px solid ${t.brand}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: t.brand }} />
                  </div>
                  <span style={{ fontSize: 8, color: active ? "var(--settings-active)" : "#444" }}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Visible Cards</span>
          {CARD_KEYS.map(c => {
            const on = settings.visibleCards[c] !== false;
            return (
              <label key={c} className="flex items-center gap-3 cursor-pointer" onClick={() => onUpdate({ ...settings, visibleCards: { ...settings.visibleCards, [c]: !on } })}>
                <div className="relative w-7 h-4 rounded-full transition-all duration-200"
                  style={{ background: on ? "var(--settings-active-bg-dim)" : "var(--settings-input)", border: `1px solid ${on ? "var(--settings-active-border)" : "var(--settings-input-border)"}` }}>
                  <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200"
                    style={{ left: on ? "calc(100% - 14px)" : "2px", background: on ? "var(--settings-active)" : "var(--settings-label)" }} />
                </div>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: on ? "#555" : "#2e2e2e" }}>{c}</span>
              </label>
            );
          })}
        </div>

        {services && services.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Connections</span>
            <div className="flex flex-col gap-1">
              {services.map(s => {
                const configured = s.configured !== false;
                const ok         = configured && s.up;
                const dotColor   = !configured ? "#444" : ok ? "#10b981" : "#ef4444";
                const dotShadow  = !configured ? "none" : ok ? "0 0 4px #10b98166" : "0 0 4px #ef444466";
                const statusText = !configured ? "not configured" : ok ? "connected" : "unreachable";
                const statusColor = !configured ? "#555"     : ok ? "#10b981"      : "#ef4444";
                return (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: dotColor, boxShadow: dotShadow }} />
                    <span className="text-[10px] flex-1" style={{ color: configured ? "#888" : "#444" }}>
                      {SVC_LABELS[s.name] ?? s.name}
                    </span>
                    <span className="text-[9px] tabular-nums font-mono" style={{ color: statusColor }}>
                      {statusText}
                    </span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const missing = services.filter(s => s.configured === false);
              if (missing.length === 0) return null;
              const envVars = Array.from(new Set(missing.flatMap(s => s.envVar ?? [])));
              return (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "var(--settings-bg)", borderRadius: 6, border: "1px solid var(--settings-border)" }}>
                  <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--settings-label)", marginBottom: 4 }}>
                    Missing env vars
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {envVars.map(v => (
                      <code key={v} className="text-[10px] font-mono" style={{ color: "var(--brand)" }}>{v}</code>
                    ))}
                  </div>
                  <div className="text-[9px]" style={{ color: "var(--settings-label)", marginTop: 6, lineHeight: 1.5 }}>
                    Set these via <code style={{ color: "var(--settings-text)" }}>docker run -e</code> or in your{" "}
                    <code style={{ color: "var(--settings-text)" }}>docker-compose.yml</code>.
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <LayoutPresetsSection settings={settings} onUpdate={onUpdate} />
        <AlertsSection />
        <BackupSection />

        <div style={{ height: 1, background: "var(--settings-input)", marginTop: "auto" }} />
        <span className="text-[9px] text-center" style={{ color: "var(--settings-input-border)" }}>resets on page reload</span>
      </div>
    </>
  );
}

// ── RefreshOverrides ─────────────────────────────────────────────────────────
function CustomCardSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 10, padding: "4px 8px", borderRadius: 4,
          background: "var(--settings-input)", color: "var(--settings-text)",
          border: "1px solid var(--settings-input-border)", cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >{open ? "Close card editor" : "Custom cards…"}</button>
      {open && <CustomCardEditor onClose={() => setOpen(false)} />}
    </div>
  );
}

// Expandable details block letting power users override the global poll
// interval for individual endpoints. Omitted/0 = use the global value.

function RefreshOverrides({ settings, onUpdate }: { settings: Settings; onUpdate: (s: Settings) => void }) {
  const fallback = settings.refreshInterval;
  const rows: { key: keyof NonNullable<Settings["refreshOverrides"]>; label: string }[] = [
    { key: "metrics",  label: "Metrics" },
    { key: "services", label: "Services" },
    { key: "mikrotik", label: "MikroTik" },
    { key: "activity", label: "Activity feed" },
  ];

  function setOverride(key: keyof NonNullable<Settings["refreshOverrides"]>, value: number) {
    const next = { ...(settings.refreshOverrides ?? {}) };
    if (!value) delete next[key]; else next[key] = value;
    onUpdate({ ...settings, refreshOverrides: next });
  }

  return (
    <details style={{ background: "var(--settings-input)", border: "1px solid var(--settings-input-border)", borderRadius: 6, padding: "6px 10px" }}>
      <summary style={{ fontSize: 10, cursor: "pointer", color: "var(--settings-text)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Per-endpoint overrides</summary>
      <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
        {rows.map(({ key, label }) => {
          const v = settings.refreshOverrides?.[key];
          const using = v ?? 0;
          return (
            <div key={key} className="flex items-center gap-2" style={{ fontSize: 10, color: "var(--settings-text)" }}>
              <span style={{ width: 78 }}>{label}</span>
              <select value={using} onChange={e => setOverride(key, Number(e.target.value))}
                style={{ fontSize: 10, background: "var(--settings-bg)", color: "var(--settings-text)", border: "1px solid var(--settings-input-border)", borderRadius: 4, padding: "2px 4px", flex: 1, outline: "none" }}>
                <option value={0}>default ({fallback}s)</option>
                <option value={1}>1s</option>
                <option value={3}>3s</option>
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={300}>5m</option>
                <option value={600}>10m</option>
              </select>
            </div>
          );
        })}
      </div>
    </details>
  );
}

// ── AlertsSection ────────────────────────────────────────────────────────────
// Self-contained: loads alert config from /api/alerts on mount, PATCHes on
// change with a debounce on the webhook URL so we don't spam the server on
// every keystroke.

interface AlertConfig {
  enabled:              boolean;
  webhookUrl:           string;
  webhookFormat:        "generic" | "discord" | "slack" | "ntfy";
  throttleMs:           number;
  browserNotifications: boolean;
  quietHoursEnabled:    boolean;
  quietHoursStart:      number;
  quietHoursEnd:        number;
}

function AlertsSection() {
  const [cfg, setCfg]       = useState<AlertConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.json())
      .then(d => setCfg(d.config))
      .catch(() => setError("Could not load alert config"));
  }, []);

  async function patch(partial: Partial<AlertConfig>) {
    if (!cfg) return;
    const next = { ...cfg, ...partial };
    setCfg(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) setError(body.message ?? `Save failed (HTTP ${res.status})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function requestNotificationPermission() {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  }

  if (!cfg) return null;

  const inputStyle: React.CSSProperties = {
    fontSize: 10, background: "var(--settings-input)", color: "var(--settings-text)",
    border: "1px solid var(--settings-input-border)", borderRadius: 4, padding: "4px 8px",
    width: "100%", fontFamily: "monospace", outline: "none",
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Alerts</span>

      {/* Master toggle */}
      <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 10, color: "var(--settings-text)" }}>
        <input type="checkbox" checked={cfg.enabled} onChange={e => patch({ enabled: e.target.checked })} />
        <span>Enabled</span>
        {saving && <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--settings-label)" }}>saving…</span>}
      </label>

      {cfg.enabled && (
        <>
          {/* Browser notifications */}
          <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 10, color: "var(--settings-text)" }}>
            <input type="checkbox" checked={cfg.browserNotifications} onChange={e => patch({ browserNotifications: e.target.checked })} />
            <span>Browser notifications</span>
          </label>
          {cfg.browserNotifications && notifPerm !== "granted" && notifPerm !== "unsupported" && (
            <button onClick={requestNotificationPermission}
              style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, background: "var(--brand)", color: "#0a0c12", border: "none", cursor: "pointer", alignSelf: "flex-start", fontWeight: 600 }}>
              {notifPerm === "denied" ? "Permission denied — check browser site settings" : "Grant browser permission"}
            </button>
          )}

          {/* Webhook URL */}
          <input
            type="url"
            placeholder="https://discord.com/api/webhooks/… (optional)"
            value={cfg.webhookUrl}
            onChange={e => setCfg({ ...cfg, webhookUrl: e.target.value })}
            onBlur={e => patch({ webhookUrl: e.target.value })}
            style={inputStyle}
          />

          {/* Webhook format */}
          {cfg.webhookUrl && (
            <select value={cfg.webhookFormat} onChange={e => patch({ webhookFormat: e.target.value as AlertConfig["webhookFormat"] })}
              style={{ ...inputStyle, fontFamily: "inherit" }}>
              <option value="generic">Generic JSON</option>
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
              <option value="ntfy">ntfy</option>
            </select>
          )}

          {/* Throttle */}
          <div className="flex flex-col gap-1" style={{ fontSize: 9, color: "var(--settings-label)" }}>
            Throttle per event
            <select value={cfg.throttleMs} onChange={e => patch({ throttleMs: Number(e.target.value) })}
              style={{ ...inputStyle, fontFamily: "inherit" }}>
              <option value={60_000}>1 minute</option>
              <option value={5 * 60_000}>5 minutes</option>
              <option value={15 * 60_000}>15 minutes</option>
              <option value={60 * 60_000}>1 hour</option>
            </select>
          </div>

          {/* Quiet hours */}
          <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 10, color: "var(--settings-text)" }}>
            <input type="checkbox" checked={cfg.quietHoursEnabled} onChange={e => patch({ quietHoursEnabled: e.target.checked })} />
            <span>Quiet hours (suppress webhook)</span>
          </label>
          {cfg.quietHoursEnabled && (
            <div className="flex gap-2 items-center" style={{ fontSize: 9, color: "var(--settings-label)" }}>
              From
              <select value={cfg.quietHoursStart} onChange={e => patch({ quietHoursStart: Number(e.target.value) })}
                style={{ ...inputStyle, width: "auto", fontFamily: "inherit" }}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
              to
              <select value={cfg.quietHoursEnd} onChange={e => patch({ quietHoursEnd: Number(e.target.value) })}
                style={{ ...inputStyle, width: "auto", fontFamily: "inherit" }}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 9, color: "var(--critical)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, padding: "4px 8px" }}>{error}</div>
          )}
        </>
      )}
    </div>
  );
}

// ── LayoutPresetsSection ────────────────────────────────────────────────────
const LAYOUTS_KEY = "comexe:layouts";

interface LayoutPreset {
  name: string;
  visibleCards: Record<string, boolean>;
  cardOrder: string[];
}

function LayoutPresetsSection({ settings, onUpdate }: { settings: Settings; onUpdate: (s: Settings) => void }) {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUTS_KEY);
      if (saved) setPresets(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  function persist(next: LayoutPreset[]) {
    setPresets(next);
    try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }

  function saveLayout() {
    const name = newName.trim();
    if (!name) return;
    const preset: LayoutPreset = {
      name,
      visibleCards: { ...settings.visibleCards },
      cardOrder: loadCardOrder(),
    };
    const next = presets.filter(p => p.name !== name).concat(preset);
    persist(next);
    setNewName("");
  }

  function loadLayout(preset: LayoutPreset) {
    onUpdate({ ...settings, visibleCards: { ...preset.visibleCards } });
    saveCardOrder(preset.cardOrder);
  }

  function deleteLayout(name: string) {
    persist(presets.filter(p => p.name !== name));
    setConfirmDelete(null);
  }

  const btnStyle: React.CSSProperties = {
    fontSize: 9, padding: "3px 8px", borderRadius: 4,
    background: "var(--settings-input)", color: "var(--settings-text)",
    border: "1px solid var(--settings-input-border)", cursor: "pointer",
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Layout Presets</span>

      {presets.length > 0 && (
        <div className="flex flex-col gap-1">
          {presets.map(p => (
            <div key={p.name} className="flex items-center gap-2">
              <button onClick={() => loadLayout(p)} style={{ ...btnStyle, flex: 1, textAlign: "left" }}
                title="Load this layout">
                {p.name}
              </button>
              {confirmDelete === p.name ? (
                <>
                  <button onClick={() => deleteLayout(p.name)}
                    style={{ ...btnStyle, color: "var(--critical)", borderColor: "rgba(239,68,68,0.3)" }}>Yes</button>
                  <button onClick={() => setConfirmDelete(null)} style={btnStyle}>No</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(p.name)}
                  style={{ ...btnStyle, color: "var(--settings-label)", fontSize: 11, padding: "2px 6px" }}
                  title="Delete preset">&times;</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveLayout(); }}
          placeholder="Preset name…"
          style={{
            flex: 1, fontSize: 10, background: "var(--settings-input)", color: "var(--settings-text)",
            border: "1px solid var(--settings-input-border)", borderRadius: 4, padding: "4px 8px",
            outline: "none",
          }}
        />
        <button onClick={saveLayout} disabled={!newName.trim()} style={{ ...btnStyle, opacity: newName.trim() ? 1 : 0.4 }}>
          Save
        </button>
      </div>

      {presets.length === 0 && (
        <span style={{ fontSize: 9, color: "var(--settings-label)" }}>
          Save the current card visibility + order as a named preset.
        </span>
      )}
    </div>
  );
}

// ── BackupSection ───────────────────────────────────────────────────────────
function BackupSection() {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function exportBackup() {
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) { setMsg({ ok: false, text: `Export failed (HTTP ${res.status})` }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comexe-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Exported" });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  async function importBackup(file: File) {
    setImporting(true); setMsg(null);
    try {
      const text = await file.text();
      const body = JSON.parse(text);
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMsg({ ok: !!data.ok, text: data.message ?? (data.ok ? "Imported" : "Failed") });
      if (data.ok) setTimeout(() => window.location.reload(), 1500);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setImporting(false);
  }

  const btnStyle: React.CSSProperties = {
    fontSize: 9, padding: "4px 10px", borderRadius: 4,
    background: "var(--settings-input)", color: "var(--settings-text)",
    border: "1px solid var(--settings-input-border)", cursor: "pointer",
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-label)" }}>Backup</span>
      <div className="flex gap-2">
        <button onClick={exportBackup} style={btnStyle}>Export config</button>
        <label style={{ ...btnStyle, display: "inline-flex", alignItems: "center", gap: 4, cursor: importing ? "wait" : "pointer", opacity: importing ? 0.6 : 1 }}>
          {importing ? "Importing…" : "Import"}
          <input type="file" accept=".json" style={{ display: "none" }} disabled={importing}
            onChange={e => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ""; }} />
        </label>
      </div>
      {msg && (
        <div style={{ fontSize: 9, color: msg.ok ? "var(--ok)" : "var(--critical)", padding: "2px 0" }}>{msg.text}</div>
      )}
    </div>
  );
}
