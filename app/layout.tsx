import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComExe · live",
  description: "ComExe — homelab metrics dashboard",
};

// Inline script that applies the saved theme class before React hydrates,
// preventing a flash of the default Midnight Cyan theme.
const themeScript = `
(function(){
  try {
    var s = localStorage.getItem("comexe:settings");
    if (s) {
      var t = JSON.parse(s).theme;
      if (t && t !== "midnight") document.documentElement.classList.add("theme-" + t);
    }
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
