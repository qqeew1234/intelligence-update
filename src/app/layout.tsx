import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ai.yunyun.page"),
  title: "Intelligence Update — Real-Time AI Releases & Rumor Radar",
  description:
    "Signal-first tracker for official AI updates, SDK releases, and Gemini-evaluated industry rumors.",
  icons: {
    icon: "/favicon.svg",
  },
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("intelligence-update:theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 selection:bg-indigo-100 selection:text-indigo-900 dark:bg-slate-950 dark:text-slate-100 dark:selection:bg-indigo-900/60 dark:selection:text-indigo-100">
        {children}
      </body>
    </html>
  );
}
