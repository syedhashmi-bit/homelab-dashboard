import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ComExe · live",
  description: "ComExe — homelab metrics dashboard",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

// Inline script that applies the saved theme class before React hydrates,
// preventing a flash of the default Midnight Cyan theme. Also auto-detects
// prefers-color-scheme for first-time visitors who haven't chosen a theme.
const themeScript = `
(function(){
  try {
    var s = localStorage.getItem("comexe:settings");
    if (s) {
      var t = JSON.parse(s).theme;
      if (t && t !== "midnight") document.documentElement.classList.add("theme-" + t);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      document.documentElement.classList.add("theme-paper");
    }
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
