"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ── Setup wizard ──────────────────────────────────────────────────────────────
// Single-page form. The user picks which services they have, fills in URLs and
// credentials, hits "Test" per row to verify the upstream auth, and the page
// generates a copy-paste docker-compose.yml fragment + `docker run` command at
// the bottom. Nothing is persisted server-side — output goes to the user's
// clipboard so they can apply it via their own deploy method.
//
// State persists in localStorage as the user types so a refresh doesn't lose
// progress. PASSWORDS / API KEYS LIVE IN LOCALSTORAGE while the user is on
// this page — we clear them on "I'm done" or via the explicit clear button.

type AuthShape = "apikey" | "userpass" | "password" | "bearer";

interface ServiceSpec {
  id:           string;
  label:        string;
  defaultPort:  number;
  authShape:    AuthShape;
  envKeys:      { url: string; apiKey?: string; username?: string; password?: string; };
  category:     "media" | "infra";
  description:  string;
}

const SERVICES: ServiceSpec[] = [
  { id: "radarr",      label: "Radarr",            defaultPort: 30025, authShape: "apikey",   category: "media", envKeys: { url: "RADARR_URL",      apiKey: "RADARR_API_KEY"      }, description: "Movies library + queue" },
  { id: "sonarr",      label: "Sonarr",            defaultPort: 33027, authShape: "apikey",   category: "media", envKeys: { url: "SONARR_URL",      apiKey: "SONARR_API_KEY"      }, description: "TV series library + queue" },
  { id: "bazarr",      label: "Bazarr",            defaultPort: 30046, authShape: "apikey",   category: "media", envKeys: { url: "BAZARR_URL",      apiKey: "BAZARR_API_KEY"      }, description: "Subtitle downloader" },
  { id: "tautulli",    label: "Tautulli",          defaultPort: 30047, authShape: "apikey",   category: "media", envKeys: { url: "TAUTULLI_URL",    apiKey: "TAUTULLI_API_KEY"    }, description: "Plex stream / history stats" },
  { id: "qbittorrent", label: "qBittorrent",       defaultPort: 30024, authShape: "userpass", category: "media", envKeys: { url: "QBIT_URL",        username: "QBIT_USERNAME", password: "QBIT_PASSWORD" }, description: "Torrent client" },
  { id: "overseerr",   label: "Overseerr",         defaultPort: 30002, authShape: "apikey",   category: "media", envKeys: { url: "OVERSEERR_URL",   apiKey: "OVERSEERR_API_KEY"   }, description: "Request management" },
  { id: "prowlarr",    label: "Prowlarr",          defaultPort: 30050, authShape: "apikey",   category: "media", envKeys: { url: "PROWLARR_URL",    apiKey: "PROWLARR_API_KEY"    }, description: "Indexer manager" },
  { id: "pihole",      label: "Pi-hole",           defaultPort: 20720, authShape: "password", category: "infra", envKeys: { url: "PIHOLE_URL",      password: "PIHOLE_PASSWORD"   }, description: "DNS-level ad/tracker blocking" },
  { id: "nginx",       label: "Nginx Proxy Mgr",   defaultPort: 30020, authShape: "userpass", category: "infra", envKeys: { url: "NGINX_URL",       username: "NGINX_USERNAME", password: "NGINX_PASSWORD" }, description: "Reverse proxy admin" },
  { id: "uptimekuma",  label: "Uptime Kuma",       defaultPort: 31050, authShape: "bearer",   category: "infra", envKeys: { url: "UPTIME_KUMA_URL", apiKey: "UPTIME_KUMA_API_KEY" }, description: "External monitor (optional auth — /metrics works without)" },
  { id: "speedtest",   label: "SpeedTracker",      defaultPort: 30220, authShape: "bearer",   category: "infra", envKeys: { url: "SPEEDTEST_URL",   apiKey: "SPEEDTEST_API_KEY"   }, description: "Speedtest history (display only)" },
];

type TestStatus = { state: "idle" } | { state: "testing" } | { state: "ok"; msg: string } | { state: "err"; msg: string };

interface ServiceRow {
  enabled:    boolean;
  url:        string;
  apiKey:     string;
  username:   string;
  password:   string;
  testStatus: TestStatus;
}

interface WizardState {
  truenasIp: string;
  rows:      Record<string, ServiceRow>;
  mikrotik:  { enabled: boolean; url: string; username: string; password: string; testStatus: TestStatus };
  grafana:   { enabled: boolean; baseUrl: string; dashboardUid: string; datasourceUid: string; panelId: string };
  preferences: { searchEngine: string; timezone: string };
}

const LS_KEY = "comexe:setup-wizard";

function defaultState(): WizardState {
  return {
    truenasIp: "192.168.88.196",
    rows: Object.fromEntries(SERVICES.map(s => [s.id, {
      enabled: false, url: "", apiKey: "", username: s.id === "qbittorrent" ? "admin" : "",
      password: "", testStatus: { state: "idle" } as TestStatus,
    }])),
    mikrotik: { enabled: false, url: "http://192.168.88.1", username: "monitor-only", password: "", testStatus: { state: "idle" } },
    grafana:  { enabled: false, baseUrl: "", dashboardUid: "", datasourceUid: "", panelId: "panel-77" },
    preferences: { searchEngine: "google", timezone: "" },
  };
}

function loadState(): WizardState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as WizardState;
    // Make sure every service id has a row (handles schema drift)
    const def = defaultState();
    return {
      ...def, ...parsed,
      rows: { ...def.rows, ...parsed.rows },
      mikrotik:    { ...def.mikrotik,    ...parsed.mikrotik, testStatus: { state: "idle" } },
      grafana:     { ...def.grafana,     ...parsed.grafana },
      preferences: { ...def.preferences, ...parsed.preferences },
    };
  } catch {
    return defaultState();
  }
}

function saveState(s: WizardState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* over-quota etc. */ }
}

function deriveDefaultUrl(ip: string, port: number): string {
  return `http://${ip || "192.168.88.196"}:${port}`;
}

// ── tiny UI primitives ──────────────────────────────────────────────────────

function StatusPill({ status }: { status: TestStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "testing") {
    return <span className="text-[11px]" style={{ color: "#06b6d4" }}>testing…</span>;
  }
  if (status.state === "ok") {
    return <span className="text-[11px]" style={{ color: "#10b981" }}>✓ {status.msg}</span>;
  }
  return <span className="text-[11px]" style={{ color: "#ef4444" }}>✗ {status.msg}</span>;
}

function Field({ label, value, onChange, type = "text", placeholder, mono = false }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: "text" | "password"; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 12,
          color: "#fff",
          fontFamily: mono ? "monospace" : undefined,
          fontVariantNumeric: mono ? "tabular-nums" : undefined,
          outline: "none",
        }}
      />
    </label>
  );
}

function Btn({ children, onClick, variant = "secondary", disabled }: {
  children: React.ReactNode; onClick: () => void;
  variant?: "primary" | "secondary" | "danger"; disabled?: boolean;
}) {
  const palette = variant === "primary" ? { bg: "#06b6d4", fg: "#0a0c12" }
                : variant === "danger"  ? { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" }
                                        : { bg: "rgba(255,255,255,0.06)", fg: "rgba(255,255,255,0.7)" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: variant === "primary" ? "none" : `1px solid ${variant === "danger" ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.12)"}`,
        borderRadius: 6,
        padding: "6px 12px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ── main wizard ─────────────────────────────────────────────────────────────

type SaveStatus = { state: "idle" } | { state: "saving" } | { state: "ok"; msg: string } | { state: "err"; msg: string };

export default function SetupWizard() {
  const [state, setState] = useState<WizardState>(defaultState());
  const [hydrated, setHydrated] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [outputTab, setOutputTab] = useState<"compose" | "run" | "env">("compose");
  const [writable, setWritable] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load from localStorage on mount (post-hydration to avoid SSR mismatch)
  useEffect(() => { setState(loadState()); setHydrated(true); }, []);
  useEffect(() => { if (hydrated) saveState(state); }, [state, hydrated]);

  // Check whether the writable volume is mounted — disables the Save button
  // with a friendly message if not.
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((cfg: { writable?: boolean } | null) => { if (cfg) setWritable(cfg.writable ?? false); })
      .catch(() => setWritable(false));
  }, []);

  function updateRow(id: string, patch: Partial<ServiceRow>) {
    setState(s => ({ ...s, rows: { ...s.rows, [id]: { ...s.rows[id], ...patch } } }));
  }

  // When the user changes the TrueNAS IP, auto-update any URL field that's
  // still using the previous default. Don't clobber URLs the user typed manually.
  function updateTruenasIp(newIp: string) {
    setState(s => {
      const prevDefaults = new Set(SERVICES.map(svc => deriveDefaultUrl(s.truenasIp, svc.defaultPort)));
      const newRows = { ...s.rows };
      for (const svc of SERVICES) {
        const row = newRows[svc.id];
        if (!row.url || prevDefaults.has(row.url)) {
          newRows[svc.id] = { ...row, url: deriveDefaultUrl(newIp, svc.defaultPort) };
        }
      }
      return { ...s, truenasIp: newIp, rows: newRows };
    });
  }

  async function testService(id: string) {
    const svc = SERVICES.find(s => s.id === id);
    if (!svc) return;
    const row = state.rows[id];
    const url = row.url || deriveDefaultUrl(state.truenasIp, svc.defaultPort);
    updateRow(id, { testStatus: { state: "testing" } });
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: id, url,
          apiKey:   row.apiKey   || undefined,
          username: row.username || undefined,
          password: row.password || undefined,
        }),
      });
      const data = await res.json() as { ok: boolean; message: string };
      updateRow(id, { testStatus: data.ok ? { state: "ok", msg: data.message } : { state: "err", msg: data.message } });
    } catch (e) {
      updateRow(id, { testStatus: { state: "err", msg: (e as Error).message } });
    }
  }

  async function testMikrotik() {
    setState(s => ({ ...s, mikrotik: { ...s.mikrotik, testStatus: { state: "testing" } } }));
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: "mikrotik", url: state.mikrotik.url,
          username: state.mikrotik.username, password: state.mikrotik.password,
        }),
      });
      const data = await res.json() as { ok: boolean; message: string };
      setState(s => ({ ...s, mikrotik: { ...s.mikrotik, testStatus: data.ok ? { state: "ok", msg: data.message } : { state: "err", msg: data.message } } }));
    } catch (e) {
      setState(s => ({ ...s, mikrotik: { ...s.mikrotik, testStatus: { state: "err", msg: (e as Error).message } } }));
    }
  }

  async function testAll() {
    const enabled = SERVICES.filter(s => state.rows[s.id]?.enabled);
    await Promise.all([
      ...enabled.map(s => testService(s.id)),
      ...(state.mikrotik.enabled ? [testMikrotik()] : []),
    ]);
  }

  function clearEverything() {
    if (typeof window === "undefined") return;
    if (!window.confirm("This wipes the form, including any credentials you typed. Continue?")) return;
    localStorage.removeItem(LS_KEY);
    setState(defaultState());
  }

  // Convert the wizard's ServiceRow shape into the PartialFileConfig shape
  // POST /api/config expects, then save. On success the dashboard's next poll
  // (within 3s) picks up the new credentials and the cards go green.
  async function saveAndApply() {
    setSaveStatus({ state: "saving" });
    const body: {
      truenasIp: string;
      mikrotik?: { url: string; username: string; password: string };
      services:  Record<string, { url?: string; apiKey?: string; username?: string; password?: string }>;
      grafana?:  { baseUrl?: string; dashboardUid?: string; datasourceUid?: string; panelId?: string };
      preferences?: { searchEngine?: string; timezone?: string };
    } = {
      truenasIp: state.truenasIp,
      services:  {},
    };

    for (const svc of SERVICES) {
      const row = state.rows[svc.id];
      if (!row?.enabled) continue;
      const entry: Record<string, string> = {};
      if (row.url)      entry.url      = row.url;
      if (svc.authShape === "apikey" || svc.authShape === "bearer") {
        if (row.apiKey) entry.apiKey = row.apiKey;
      }
      if (svc.authShape === "userpass") {
        if (row.username) entry.username = row.username;
        if (row.password) entry.password = row.password;
      }
      if (svc.authShape === "password") {
        if (row.password) entry.password = row.password;
      }
      if (Object.keys(entry).length > 0) body.services[svc.id] = entry;
    }

    if (state.mikrotik.enabled) {
      body.mikrotik = {
        url:      state.mikrotik.url,
        username: state.mikrotik.username,
        password: state.mikrotik.password,
      };
    }

    if (state.grafana.enabled) {
      body.grafana = {
        baseUrl:       state.grafana.baseUrl       || undefined,
        dashboardUid:  state.grafana.dashboardUid  || undefined,
        datasourceUid: state.grafana.datasourceUid || undefined,
        panelId:       state.grafana.panelId       || undefined,
      };
    }

    // Always include preferences
    body.preferences = {
      searchEngine: state.preferences.searchEngine || undefined,
      timezone:     state.preferences.timezone     || undefined,
    };

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok: boolean; message: string };
      setSaveStatus(data.ok ? { state: "ok", msg: data.message } : { state: "err", msg: data.message });
      if (!data.ok && res.status === 503) setWritable(false);
    } catch (e) {
      setSaveStatus({ state: "err", msg: (e as Error).message });
    }
  }

  // ── output generation ─────────────────────────────────────────────────────

  const generated = useMemo(() => generateConfig(state), [state]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#fff", marginBottom: 8 }}>Setup</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, maxWidth: 720 }}>
          Fill in the URL + credentials for each service you want to monitor, click <b style={{ color: "#06b6d4" }}>Test</b> to confirm
          the dashboard can reach it, then copy the generated config at the bottom into your <code style={{ color: "rgba(6,182,212,0.85)" }}>docker-compose.yml</code> or <code style={{ color: "rgba(6,182,212,0.85)" }}>docker run</code> command and redeploy.
        </p>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 8 }}>
          Form state (including credentials) is stored in your browser&apos;s localStorage so a refresh doesn&apos;t lose progress. Click{" "}
          <span style={{ color: "#ef4444", cursor: "pointer", textDecoration: "underline" }} onClick={clearEverything}>Clear everything</span>{" "}
          when you&apos;re done.
        </p>
      </header>

      {/* ── 1. TrueNAS IP ── */}
      <Section title="1 · Where is your TrueNAS?" subtitle="Sets the default URL for every service below.">
        <div style={{ maxWidth: 320 }}>
          <Field
            label="TrueNAS IP / hostname"
            value={state.truenasIp}
            onChange={updateTruenasIp}
            placeholder="192.168.88.196"
            mono
          />
        </div>
      </Section>

      {/* ── 2. Services ── */}
      <Section title="2 · Which services do you have?" subtitle="Tick the ones you use. Default URLs are derived from your TrueNAS IP — override if a service is on a different host or non-standard port.">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {SERVICES.map(svc => {
            const row = state.rows[svc.id];
            return (
              <div key={svc.id}
                style={{
                  background: row.enabled ? "rgba(6,182,212,0.05)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${row.enabled ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 8,
                  padding: 14,
                  transition: "all 0.15s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={e => updateRow(svc.id, { enabled: e.target.checked, url: row.url || deriveDefaultUrl(state.truenasIp, svc.defaultPort) })}
                    style={{ width: 14, height: 14, accentColor: "#06b6d4", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: row.enabled ? "#fff" : "rgba(255,255,255,0.5)" }}>{svc.label}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{svc.description}</span>
                  <div style={{ marginLeft: "auto" }}><StatusPill status={row.testStatus} /></div>
                </div>
                {row.enabled && (
                  <div style={{ marginTop: 12, marginLeft: 26, display: "grid", gridTemplateColumns: "minmax(280px, 2fr) 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                    <Field label="URL" value={row.url} onChange={v => updateRow(svc.id, { url: v })} mono />
                    {svc.authShape === "apikey" && (
                      <Field label="API key" value={row.apiKey} onChange={v => updateRow(svc.id, { apiKey: v })} type={showPasswords ? "text" : "password"} mono />
                    )}
                    {svc.authShape === "bearer" && (
                      <Field label="Bearer token (optional)" value={row.apiKey} onChange={v => updateRow(svc.id, { apiKey: v })} type={showPasswords ? "text" : "password"} mono />
                    )}
                    {svc.authShape === "userpass" && <>
                      <Field label="Username" value={row.username} onChange={v => updateRow(svc.id, { username: v })} mono />
                      <Field label="Password" value={row.password} onChange={v => updateRow(svc.id, { password: v })} type={showPasswords ? "text" : "password"} mono />
                    </>}
                    {svc.authShape === "password" && (
                      <Field label="Password" value={row.password} onChange={v => updateRow(svc.id, { password: v })} type={showPasswords ? "text" : "password"} mono />
                    )}
                    {(svc.authShape === "apikey" || svc.authShape === "bearer") && (
                      <div /> // spacer to fill the 3rd column
                    )}
                    <Btn onClick={() => testService(svc.id)} disabled={row.testStatus.state === "testing"}>
                      {row.testStatus.state === "testing" ? "…" : "Test"}
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── 3. MikroTik ── */}
      <Section title="3 · MikroTik router (optional)" subtitle="If you've got a MikroTik router, set up a read-only RouterOS user and put its credentials here. The dashboard never writes anything to the router.">
        <div style={{
          background: state.mikrotik.enabled ? "rgba(6,182,212,0.05)" : "rgba(255,255,255,0.02)",
          border: `1px solid ${state.mikrotik.enabled ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 8, padding: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="checkbox"
              checked={state.mikrotik.enabled}
              onChange={e => setState(s => ({ ...s, mikrotik: { ...s.mikrotik, enabled: e.target.checked } }))}
              style={{ width: 14, height: 14, accentColor: "#06b6d4", cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: state.mikrotik.enabled ? "#fff" : "rgba(255,255,255,0.5)" }}>MikroTik router</span>
            <div style={{ marginLeft: "auto" }}><StatusPill status={state.mikrotik.testStatus} /></div>
          </div>
          {state.mikrotik.enabled && (
            <div style={{ marginTop: 12, marginLeft: 26, display: "grid", gridTemplateColumns: "minmax(220px, 1.5fr) 1fr 1fr auto", gap: 10, alignItems: "end" }}>
              <Field label="URL" value={state.mikrotik.url} onChange={v => setState(s => ({ ...s, mikrotik: { ...s.mikrotik, url: v } }))} mono />
              <Field label="Username" value={state.mikrotik.username} onChange={v => setState(s => ({ ...s, mikrotik: { ...s.mikrotik, username: v } }))} mono />
              <Field label="Password" value={state.mikrotik.password} onChange={v => setState(s => ({ ...s, mikrotik: { ...s.mikrotik, password: v } }))} type={showPasswords ? "text" : "password"} mono />
              <Btn onClick={testMikrotik} disabled={state.mikrotik.testStatus.state === "testing"}>
                {state.mikrotik.testStatus.state === "testing" ? "…" : "Test"}
              </Btn>
            </div>
          )}
        </div>
      </Section>

      {/* ── 4. Grafana embed ── */}
      <Section title="4 · Grafana embed (optional)" subtitle="If you want a Grafana panel embedded in the dashboard, paste the dashboard's UID and your Prometheus datasource UID. Both are visible in Grafana's URLs.">
        <div style={{
          background: state.grafana.enabled ? "rgba(249,115,22,0.05)" : "rgba(255,255,255,0.02)",
          border: `1px solid ${state.grafana.enabled ? "rgba(249,115,22,0.2)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 8, padding: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="checkbox"
              checked={state.grafana.enabled}
              onChange={e => setState(s => ({ ...s, grafana: { ...s.grafana, enabled: e.target.checked, baseUrl: s.grafana.baseUrl || `http://${s.truenasIp}:30037` } }))}
              style={{ width: 14, height: 14, accentColor: "#f97316", cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: state.grafana.enabled ? "#fff" : "rgba(255,255,255,0.5)" }}>Grafana panel</span>
          </div>
          {state.grafana.enabled && (
            <div style={{ marginTop: 12, marginLeft: 26, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              <Field label="Grafana URL" value={state.grafana.baseUrl} onChange={v => setState(s => ({ ...s, grafana: { ...s.grafana, baseUrl: v } }))} mono />
              <Field label="Dashboard UID" value={state.grafana.dashboardUid} onChange={v => setState(s => ({ ...s, grafana: { ...s.grafana, dashboardUid: v } }))} placeholder="rYdddlPWk" mono />
              <Field label="Datasource UID" value={state.grafana.datasourceUid} onChange={v => setState(s => ({ ...s, grafana: { ...s.grafana, datasourceUid: v } }))} placeholder="cflfv1hjeg9vka" mono />
              <Field label="Panel ID" value={state.grafana.panelId} onChange={v => setState(s => ({ ...s, grafana: { ...s.grafana, panelId: v } }))} placeholder="panel-77" mono />
            </div>
          )}
        </div>
      </Section>

      {/* ── Action bar ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "32px 0 16px", flexWrap: "wrap" }}>
        <Btn variant="primary" onClick={testAll}>Test every enabled service</Btn>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
          <input type="checkbox" checked={showPasswords} onChange={e => setShowPasswords(e.target.checked)} />
          show passwords
        </label>
        <div style={{ marginLeft: "auto" }}>
          <Btn variant="danger" onClick={clearEverything}>Clear everything</Btn>
        </div>
      </div>

      {/* ── 5. Preferences ── */}
      <Section title="5 · Preferences" subtitle="Search engine, timezone, and display defaults. These are optional — the dashboard works with sensible defaults.">
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10, padding: 16,
        }}>
          <div>
            <label style={{ display: "block", fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Search Engine</label>
            <select
              value={state.preferences.searchEngine}
              onChange={e => { const s = { ...state, preferences: { ...state.preferences, searchEngine: e.target.value } }; setState(s); saveState(s); }}
              style={{ width: "100%", background: "#111", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#fff", outline: "none" }}
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="duckduckgo">DuckDuckGo</option>
              <option value="kagi">Kagi</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Timezone</label>
            <select
              value={state.preferences.timezone}
              onChange={e => { const s = { ...state, preferences: { ...state.preferences, timezone: e.target.value } }; setState(s); saveState(s); }}
              style={{ width: "100%", background: "#111", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#fff", outline: "none" }}
            >
              <option value="">Browser local (auto)</option>
              {[
                "Pacific/Auckland", "Pacific/Fiji",
                "Australia/Sydney", "Australia/Adelaide", "Australia/Perth", "Australia/Hobart", "Australia/Brisbane",
                "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore",
                "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi",
                "Europe/Moscow", "Europe/Istanbul", "Europe/Athens", "Europe/Helsinki",
                "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Zurich",
                "Europe/London",
                "Atlantic/Reykjavik",
                "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
                "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
                "America/Anchorage", "Pacific/Honolulu",
                "America/Toronto", "America/Vancouver",
              ].map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      {/* ── 6. Save & apply ── */}
      <Section title="6 · Save & apply" subtitle="Writes your config to the container's data volume. The dashboard picks up the change within ~3 seconds — no redeploy needed.">
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10, padding: 16,
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {writable === false && (
            <div style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 6, padding: "10px 12px",
              fontSize: 11, color: "#f59e0b", lineHeight: 1.6,
            }}>
              <strong>Writable data volume not mounted.</strong> Save & apply needs a writable directory at <code style={{ color: "#fde68a" }}>/app/data</code>. Add this to your <code style={{ color: "#fde68a" }}>docker-compose.yml</code>:
              <pre style={{ marginTop: 8, padding: 8, background: "#1a1300", borderRadius: 4, fontSize: 10, color: "#fcd34d", whiteSpace: "pre-wrap" }}>{`services:
  comexe:
    volumes:
      - ./dashboard-data:/app/data`}</pre>
              Or for plain <code style={{ color: "#fde68a" }}>docker run</code>: <code style={{ color: "#fde68a" }}>-v /root/dashboard-data:/app/data</code>. Restart the container, then come back here. Until then, use the manual config below.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="primary" onClick={saveAndApply} disabled={writable === false || saveStatus.state === "saving"}>
              {saveStatus.state === "saving" ? "Saving…" : "Save & apply"}
            </Btn>
            {saveStatus.state === "ok" && (
              <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>
                ✓ {saveStatus.msg} · <Link href="/" style={{ color: "#06b6d4", textDecoration: "underline" }}>Back to dashboard</Link>
              </span>
            )}
            {saveStatus.state === "err" && (
              <span style={{ fontSize: 12, color: "#ef4444", maxWidth: 600 }}>
                ✗ {saveStatus.msg}
              </span>
            )}
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
            <button
              onClick={() => setShowAdvanced(s => !s)}
              style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.5)",
                fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 500,
              }}>
              {showAdvanced ? "▾" : "▸"} Or copy the generated config manually (for env-var-based deployments)
            </button>
          </div>

          {showAdvanced && (
            <div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                {(["compose", "run", "env"] as const).map(t => (
                  <button key={t} onClick={() => setOutputTab(t)}
                    style={{
                      background: outputTab === t ? "rgba(6,182,212,0.15)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${outputTab === t ? "rgba(6,182,212,0.4)" : "rgba(255,255,255,0.08)"}`,
                      color: outputTab === t ? "#06b6d4" : "rgba(255,255,255,0.6)",
                      padding: "6px 14px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600,
                    }}>
                    {t === "compose" ? "docker-compose.yml" : t === "run" ? "docker run" : ".env"}
                  </button>
                ))}
                <div style={{ marginLeft: "auto" }}>
                  <Btn onClick={() => copy(generated[outputTab])}>Copy to clipboard</Btn>
                </div>
              </div>
              <pre style={{
                background: "#0a0d12",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, padding: 16,
                fontSize: 11, fontFamily: "monospace",
                color: "rgba(255,255,255,0.85)",
                overflow: "auto",
                maxHeight: 480,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {generated[outputTab]}
              </pre>
            </div>
          )}
        </div>
      </Section>

      <footer style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
          After applying the config and restarting the container, head back to{" "}
          <Link href="/" style={{ color: "#06b6d4" }}>the dashboard</Link> and check Settings → Connections to confirm everything&apos;s green.
        </p>
      </footer>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4, letterSpacing: "0.02em" }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14, lineHeight: 1.6 }}>{subtitle}</p>}
      {children}
    </section>
  );
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* user can select/copy manually */ }
}

// ── output generation ────────────────────────────────────────────────────────

interface GeneratedConfig {
  compose: string;
  run: string;
  env: string;
}

function generateConfig(state: WizardState): GeneratedConfig {
  const envPairs: [string, string][] = [];

  envPairs.push(["TRUENAS_IP", state.truenasIp || "192.168.88.196"]);

  for (const svc of SERVICES) {
    const row = state.rows[svc.id];
    if (!row?.enabled) continue;
    // Only emit a *_URL override if the user changed it from the default.
    const defaultUrl = deriveDefaultUrl(state.truenasIp, svc.defaultPort);
    if (row.url && row.url !== defaultUrl) {
      envPairs.push([svc.envKeys.url, row.url]);
    }
    if (svc.authShape === "apikey" && svc.envKeys.apiKey) {
      envPairs.push([svc.envKeys.apiKey, row.apiKey]);
    }
    if (svc.authShape === "bearer" && svc.envKeys.apiKey && row.apiKey) {
      envPairs.push([svc.envKeys.apiKey, row.apiKey]);
    }
    if (svc.authShape === "userpass") {
      if (svc.envKeys.username) envPairs.push([svc.envKeys.username, row.username]);
      if (svc.envKeys.password) envPairs.push([svc.envKeys.password, row.password]);
    }
    if (svc.authShape === "password" && svc.envKeys.password) {
      envPairs.push([svc.envKeys.password, row.password]);
    }
  }

  if (state.mikrotik.enabled) {
    envPairs.push(["MIKROTIK_URL",      state.mikrotik.url]);
    envPairs.push(["MIKROTIK_USERNAME", state.mikrotik.username]);
    envPairs.push(["MIKROTIK_PASSWORD", state.mikrotik.password]);
  }

  if (state.grafana.enabled) {
    if (state.grafana.baseUrl)       envPairs.push(["GRAFANA_BASE_URL",       state.grafana.baseUrl]);
    if (state.grafana.dashboardUid)  envPairs.push(["GRAFANA_DASHBOARD_UID",  state.grafana.dashboardUid]);
    if (state.grafana.datasourceUid) envPairs.push(["GRAFANA_DATASOURCE_UID", state.grafana.datasourceUid]);
    if (state.grafana.panelId)       envPairs.push(["GRAFANA_PANEL_ID",       state.grafana.panelId]);
  }

  // ── docker-compose.yml ─────────────────────────────────────────────────────
  const composeLines = [
    "services:",
    "  comexe:",
    "    image: ghcr.io/syedhashmi-bit/comexe:latest",
    "    container_name: comexe",
    "    restart: unless-stopped",
    "    network_mode: host",
    "    # Mount your bookmarks file for the right-hand quick-links section:",
    "    # volumes:",
    "    #   - ./bookmarks.json:/app/bookmarks.json:ro",
    "    environment:",
    ...envPairs.map(([k, v]) => `      ${k}: ${quoteYaml(v)}`),
  ];

  // ── docker run command ─────────────────────────────────────────────────────
  const runLines = [
    "docker run -d \\",
    "  --name comexe \\",
    "  --network host \\",
    "  --restart unless-stopped \\",
    ...envPairs.map(([k, v]) => `  -e ${k}=${shellQuote(v)} \\`),
    "  ghcr.io/syedhashmi-bit/comexe:latest",
  ];

  // ── plain .env file ────────────────────────────────────────────────────────
  const envLines = envPairs.map(([k, v]) => `${k}=${v}`);

  return {
    compose: composeLines.join("\n"),
    run:     runLines.join("\n"),
    env:     envLines.join("\n"),
  };
}

// YAML-quote a value if it contains characters that would confuse the parser.
function quoteYaml(v: string): string {
  if (v === "") return '""';
  if (/^[\w./:@-]+$/.test(v)) return v;
  // Use single quotes; escape any embedded single quotes by doubling.
  return `'${v.replace(/'/g, "''")}'`;
}

// Bash-quote a value for `docker run -e` lines.
function shellQuote(v: string): string {
  if (v === "") return "''";
  if (/^[\w./:@-]+$/.test(v)) return v;
  return `'${v.replace(/'/g, "'\\''")}'`;
}
