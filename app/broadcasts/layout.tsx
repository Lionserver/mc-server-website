import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "마인크래프트 실시간 방송",
  description:
    "치지직과 SOOP에서 지금 방송 중인 한국 마인크래프트 스트리머를 확인하세요.",
  alternates: {
    canonical: "/broadcasts",
  },
  openGraph: {
    title: "마인크래프트 실시간 방송 — Minecraft.kr",
    description:
      "치지직과 SOOP에서 지금 방송 중인 한국 마인크래프트 스트리머를 확인하세요.",
    url: "/broadcasts",
  },
};

export default function BroadcastsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
