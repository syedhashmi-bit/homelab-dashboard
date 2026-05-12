"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ── Welcome flow ────────────────────────────────────────────────────────────
// Four-step first-run wizard shown when the user has no config.json on disk.
// Steps: 1) Welcome  2) Pick a theme  3) Connect services  4) Done
//
// The main dashboard (page.tsx) auto-redirects here when zero services are
// configured and localStorage hasn't seen the welcome flag yet.

type ThemeKey = "midnight" | "forge" | "forest" | "plum" | "paper";

const THEMES: { key: ThemeKey; label: string; desc: string; bg: string; brand: string; card: string; text: string }[] = [
  { key: "midnight", label: "Midnight Cyan", desc: "Dark blue-black with cyan accents",    bg: "#0a0c12", brand: "#06b6d4", card: "#0e1117", text: "#e2e8f0" },
  { key: "forge",    label: "Forge",         desc: "Warm dark with amber accents",         bg: "#12100a", brand: "#f59e0b", card: "#1a1610", text: "#e2d9c5" },
  { key: "forest",   label: "Forest",        desc: "Deep green-black with emerald accents", bg: "#080f0a", brand: "#10b981", card: "#0e1610", text: "#c5e2d0" },
  { key: "plum",     label: "Plum",          desc: "Purple-black with magenta accents",    bg: "#10081a", brand: "#d946ef", card: "#160e1e", text: "#d9c5e2" },
  { key: "paper",    label: "Paper",         desc: "Light theme with slate accents",       bg: "#f8fafc", brand: "#0284c7", card: "#ffffff", text: "#1e293b" },
];

const SETTINGS_KEY = "comexe:settings";
const WELCOME_KEY = "comexe:welcome-done";

export default function WelcomePage() {
  const [step, setStep] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<ThemeKey>("midnight");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Apply theme preview live
  useEffect(() => {
    const root = document.documentElement;
    THEMES.forEach(t => root.classList.remove(`theme-${t.key}`));
    if (selectedTheme !== "midnight") {
      root.classList.add(`theme-${selectedTheme}`);
    }
  }, [selectedTheme]);

  function applyTheme() {
    // Save theme to localStorage settings so the main dashboard picks it up
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const settings = raw ? JSON.parse(raw) : {};
      settings.theme = selectedTheme;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
  }

  function markDone() {
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* ignore */ }
  }

  if (!mounted) return null;

  const isPaper = selectedTheme === "paper";

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      transition: "background 0.4s ease",
    }}>
      {/* Progress dots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            width: i === step ? 24 : 8,
            height: 8,
            borderRadius: 4,
            background: i === step ? "var(--brand)" : (isPaper ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)"),
            transition: "all 0.3s ease",
          }} />
        ))}
      </div>

      {/* ── Step 0: Welcome ── */}
      {step === 0 && (
        <div style={{
          maxWidth: 520,
          textAlign: "center",
          animation: "fadeSlideIn 0.4s ease both",
        }}>
          {/* Logo */}
          <div style={{
            width: 64, height: 64,
            borderRadius: 16,
            background: "var(--brand)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 24px",
            boxShadow: `0 0 40px ${isPaper ? "rgba(2,132,199,0.2)" : "rgba(6,182,212,0.3)"}`,
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={isPaper ? "#fff" : "#0a0c12"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="M7 8h2" /><path d="M7 11h4" />
            </svg>
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
            Welcome to ComExe
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 24px", lineHeight: 1.7 }}>
            Your homelab metrics dashboard. We&apos;ll help you pick a theme and connect your services in about 2 minutes.
          </p>

          <div style={{
            display: "flex", flexDirection: "column", gap: 10,
            background: "var(--card)",
            border: `1px solid ${isPaper ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
            borderRadius: 12,
            padding: "16px 20px",
            textAlign: "left",
            marginBottom: 28,
          }}>
            {[
              { icon: "1", text: "Choose a visual theme" },
              { icon: "2", text: "Connect your homelab services" },
              { icon: "3", text: "Start monitoring" },
            ].map(item => (
              <div key={item.icon} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 12,
                  background: `${isPaper ? "rgba(2,132,199,0.1)" : "rgba(6,182,212,0.12)"}`,
                  color: "var(--brand)",
                  fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>{item.icon}</span>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{item.text}</span>
              </div>
            ))}
          </div>

          <button onClick={() => setStep(1)} style={{
            background: "var(--brand)",
            color: isPaper ? "#fff" : "#0a0c12",
            border: "none",
            borderRadius: 10,
            padding: "12px 32px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "transform 0.15s, box-shadow 0.15s",
            boxShadow: `0 4px 20px ${isPaper ? "rgba(2,132,199,0.25)" : "rgba(6,182,212,0.3)"}`,
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            Get started
          </button>

          <div style={{ marginTop: 16 }}>
            <Link href="/" onClick={markDone} style={{ fontSize: 11, color: "var(--text-dim)", textDecoration: "none" }}>
              Skip — I&apos;ll configure later
            </Link>
          </div>
        </div>
      )}

      {/* ── Step 1: Pick a theme ── */}
      {step === 1 && (
        <div style={{
          maxWidth: 640,
          width: "100%",
          textAlign: "center",
          animation: "fadeSlideIn 0.4s ease both",
        }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
            Pick your theme
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 28px" }}>
            You can change this anytime in Settings.
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            marginBottom: 32,
          }}>
            {THEMES.map(t => {
              const active = selectedTheme === t.key;
              return (
                <button key={t.key} onClick={() => setSelectedTheme(t.key)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                    padding: "16px 8px",
                    borderRadius: 12,
                    cursor: "pointer",
                    background: active ? (isPaper ? "rgba(2,132,199,0.06)" : "rgba(255,255,255,0.06)") : "transparent",
                    border: `2px solid ${active ? t.brand : (isPaper ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)")}`,
                    transition: "all 0.2s ease",
                    outline: "none",
                  }}
                >
                  {/* Theme preview chip */}
                  <div style={{
                    width: 56, height: 40, borderRadius: 8,
                    background: t.bg,
                    border: `1.5px solid ${isPaper && t.key !== "paper" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}`,
                    position: "relative",
                    overflow: "hidden",
                  }}>
                    {/* Mini card preview */}
                    <div style={{
                      position: "absolute", top: 6, left: 6, right: 6, bottom: 6,
                      borderRadius: 4,
                      background: t.card,
                      borderTop: `2px solid ${t.brand}`,
                    }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: active ? t.brand : "var(--text-secondary)" }}>
                      {t.label}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>
                      {t.desc}
                    </div>
                  </div>
                  {active && (
                    <div style={{
                      width: 18, height: 18, borderRadius: 9,
                      background: t.brand,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke={t.key === "paper" ? "#fff" : t.bg} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button onClick={() => setStep(0)} style={{
              background: "transparent",
              color: "var(--text-secondary)",
              border: `1px solid ${isPaper ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 10, padding: "10px 24px",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}>
              Back
            </button>
            <button onClick={() => { applyTheme(); setStep(2); }} style={{
              background: "var(--brand)",
              color: isPaper ? "#fff" : "#0a0c12",
              border: "none",
              borderRadius: 10, padding: "10px 32px",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              boxShadow: `0 4px 20px ${isPaper ? "rgba(2,132,199,0.25)" : "rgba(6,182,212,0.3)"}`,
            }}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Connect services ── */}
      {step === 2 && (
        <div style={{
          maxWidth: 520,
          textAlign: "center",
          animation: "fadeSlideIn 0.4s ease both",
        }}>
          <div style={{
            width: 56, height: 56,
            borderRadius: 14,
            background: isPaper ? "rgba(2,132,199,0.08)" : "rgba(6,182,212,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
            Connect your services
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px", lineHeight: 1.7 }}>
            The setup wizard lets you connect Radarr, Sonarr, Pi-hole, and more with live connection testing. Takes about a minute.
          </p>
          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 28px" }}>
            You can also skip this and add services later from the dashboard settings or by setting environment variables.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => setStep(1)} style={{
              background: "transparent",
              color: "var(--text-secondary)",
              border: `1px solid ${isPaper ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 10, padding: "10px 24px",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}>
              Back
            </button>
            <Link href="/setup" onClick={() => { markDone(); }} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "var(--brand)",
              color: isPaper ? "#fff" : "#0a0c12",
              border: "none",
              borderRadius: 10, padding: "10px 28px",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              textDecoration: "none",
              boxShadow: `0 4px 20px ${isPaper ? "rgba(2,132,199,0.25)" : "rgba(6,182,212,0.3)"}`,
            }}>
              Open setup wizard
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
              </svg>
            </Link>
            <button onClick={() => { markDone(); setStep(3); }} style={{
              background: "transparent",
              color: "var(--text-dim)",
              border: "none",
              borderRadius: 10, padding: "10px 20px",
              fontSize: 12, cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}>
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ── */}
      {step === 3 && (
        <div style={{
          maxWidth: 480,
          textAlign: "center",
          animation: "fadeSlideIn 0.4s ease both",
        }}>
          <div style={{
            width: 56, height: 56,
            borderRadius: 28,
            background: isPaper ? "rgba(16,185,129,0.1)" : "rgba(16,185,129,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
            You&apos;re all set!
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 24px", lineHeight: 1.7 }}>
            Your theme is saved. You can change any of this anytime — open Settings from the gear icon in the dashboard header, or visit{" "}
            <code style={{
              fontSize: 12,
              color: "var(--brand)",
              background: isPaper ? "rgba(2,132,199,0.06)" : "rgba(6,182,212,0.08)",
              padding: "2px 6px",
              borderRadius: 4,
            }}>
              /setup
            </code>{" "}
            to reconfigure services.
          </p>

          <Link href="/" onClick={markDone} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--brand)",
            color: isPaper ? "#fff" : "#0a0c12",
            border: "none",
            borderRadius: 10, padding: "12px 32px",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            textDecoration: "none",
            boxShadow: `0 4px 20px ${isPaper ? "rgba(2,132,199,0.25)" : "rgba(6,182,212,0.3)"}`,
          }}>
            Go to dashboard
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
