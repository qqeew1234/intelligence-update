import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ai.yunyun.page"),
  title: "지능 업데이트 | Intelligence Update — 실시간 AI 변경점 피드",
  description:
    "개발자와 일반 직장인을 위한 노이즈 제로 실시간 AI 공식 업데이트·패치노트 트래커",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
        {children}
      </body>
    </html>
  );
}
