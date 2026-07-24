import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Minecraft.kr 한국 마인크래프트 서버리스트",
    short_name: "Minecraft.kr",
    description:
      "실시간 상태와 신뢰 지표로 한국 마인크래프트 서버를 비교하는 서버 디렉터리",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ee",
    theme_color: "#06245c",
    lang: "ko-KR",
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
