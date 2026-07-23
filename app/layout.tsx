import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://minecraft.kr";
const themeBootstrapScript = `
(() => {
  const storageKey = "minecraft-kr-theme";
  let storedTheme = null;
  try {
    storedTheme = window.localStorage.getItem(storageKey);
  } catch {}
  let systemTheme = "light";
  try {
    systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {}
  document.documentElement.dataset.theme =
    storedTheme === "dark" || storedTheme === "light" ? storedTheme : systemTheme;
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Minecraft.kr — 한국 마인크래프트 서버리스트",
  description: "접속자, 응답속도, 업타임, 운영자 인증을 함께 보는 대한민국 마인크래프트 서버 인덱스.",
  openGraph: {
    title: "Minecraft.kr — 한국 마인크래프트 서버리스트",
    description: "실시간 상태와 신뢰 지표로 지금 좋은 마인크래프트 서버를 찾으세요.",
    url: "/",
    siteName: "Minecraft.kr",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "밝은 편집형 디자인의 Minecraft.kr 실시간 서버 인덱스" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Minecraft.kr — 한국 마인크래프트 서버리스트",
    description: "실시간 상태와 신뢰 지표로 한국 마인크래프트 서버를 비교하세요.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
