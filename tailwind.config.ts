import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      xs: "480px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
      colors: {
        surface: {
          DEFAULT: "#0a0c12",
          card: "rgba(255,255,255,0.04)",
          border: "rgba(255,255,255,0.08)",
        },
        accent: {
          cyan:   "#06b6d4",
          green:  "#10b981",
          amber:  "#f59e0b",
          blue:   "#3b82f6",
          red:    "#ef4444",
          violet: "#8b5cf6",
        },
      },
      animation: {
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
      },
      keyframes: {
        fadeSlideIn: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      borderRadius: {
        "2xl": "14px",
      },
    },
  },
  plugins: [],
};

export default config;
