import type { Metadata } from "next";
import { SiteAnnouncementBanner } from "@/components/site-announcement-banner";
import { SiteTrafficProvider } from "@/components/site-traffic-provider";
import { directoryEnv } from "@/lib/server-directory";
import { publicAnnouncementState } from "@/lib/site-announcements";
import { requestSiteOrigin } from "@/lib/site-url";
import "./globals.css";

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

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestSiteOrigin();
  return {
    metadataBase: new URL(origin),
    applicationName: "Minecraft.kr",
    title: {
      default: "Minecraft.kr — 한국 마인크래프트 서버리스트",
      template: "%s | Minecraft.kr",
    },
    description:
      "접속자, 응답속도, 업타임, 운영자 인증을 함께 보는 대한민국 마인크래프트 서버 인덱스.",
    keywords: [
      "마인크래프트 서버",
      "마인크래프트 서버리스트",
      "한국 마인크래프트 서버",
      "Minecraft 서버",
      "소규모 마인크래프트 서버",
    ],
    creator: "Minecraft.kr",
    publisher: "Minecraft.kr",
    category: "games",
    alternates: {
      canonical: `${origin}/`,
    },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
    },
    formatDetection: {
      telephone: false,
      email: false,
      address: false,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title: "Minecraft.kr — 한국 마인크래프트 서버리스트",
      description:
        "실시간 상태와 신뢰 지표로 지금 좋은 마인크래프트 서버를 찾으세요.",
      url: `${origin}/`,
      siteName: "Minecraft.kr",
      locale: "ko_KR",
      type: "website",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1200,
          height: 630,
          alt: "Minecraft.kr 한국 마인크래프트 서버 인덱스",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Minecraft.kr — 한국 마인크래프트 서버리스트",
      description:
        "실시간 상태와 신뢰 지표로 한국 마인크래프트 서버를 비교하세요.",
      images: [`${origin}/og.png`],
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [initialAnnouncements, origin] = await Promise.all([
    initialSiteAnnouncements(),
    requestSiteOrigin(),
  ]);
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: `${origin}/`,
        name: "Minecraft.kr",
        alternateName: "한국 마인크래프트 서버리스트",
        description:
          "실시간 상태와 신뢰 지표로 한국 마인크래프트 서버를 비교하는 서버 디렉터리",
        inLanguage: "ko-KR",
        publisher: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "Minecraft.kr",
        url: `${origin}/`,
      },
    ],
  };
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteJsonLd) }}
        />
      </head>
      <body>
        <SiteAnnouncementBanner initialPayload={initialAnnouncements} />
        <SiteTrafficProvider>{children}</SiteTrafficProvider>
      </body>
    </html>
  );
}

async function initialSiteAnnouncements() {
  try {
    const environment = await directoryEnv();
    return await publicAnnouncementState(environment.DB);
  } catch {
    return { announcements: [], nextTransitionAt: null, serverTime: 0 };
  }
}

function safeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
