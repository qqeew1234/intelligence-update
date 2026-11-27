import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://intel.yunyun.page"),
  title: "Intelligence Update — Real-Time AI Releases & Rumor Radar",
  description:
    "Signal-first tracker for official AI updates, SDK releases, and Gemini-evaluated industry rumors.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png?v=2", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("intelligence-update:theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",d?"#202124":"#f5f5f7");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#f5f5f7" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="matte-canvas min-h-screen text-neutral-900 antialiased selection:bg-indigo-500/20 selection:text-indigo-900 dark:text-neutral-100 dark:selection:bg-indigo-400/25 dark:selection:text-indigo-100">
        {children}
      </body>
    </html>
  );
}
