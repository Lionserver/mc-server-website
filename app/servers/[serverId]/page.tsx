import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  indexablePublicServer,
  type PublicServerSeoRecord,
} from "@/lib/public-server-seo";
import { requestSiteOrigin } from "@/lib/site-url";
import styles from "./page.module.css";

type ServerPageProps = {
  params: Promise<{ serverId: string }> | { serverId: string };
};

export const revalidate = 60;

const readServer = cache((serverId: string) => indexablePublicServer(serverId));

export async function generateMetadata({
  params,
}: ServerPageProps): Promise<Metadata> {
  const { serverId } = await params;
  try {
    const [server, origin] = await Promise.all([
      readServer(serverId),
      requestSiteOrigin(),
    ]);
    if (!server) return unavailableMetadata();
    const canonical = `${origin}/servers/${server.id}`;
    const description = serverMetaDescription(server);
    return {
      title: `${server.name} 마인크래프트 서버`,
      description,
      alternates: { canonical },
      keywords: [
        server.name,
        "마인크래프트 서버",
        "한국 마인크래프트 서버",
        server.edition,
        server.version,
        ...server.tags,
      ],
      openGraph: {
        title: `${server.name} — Minecraft.kr`,
        description,
        type: "website",
        url: canonical,
        images: [
          {
            url: `${origin}/og.png`,
            width: 1200,
            height: 630,
            alt: `${server.name} 마인크래프트 서버 정보`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: `${server.name} — Minecraft.kr`,
        description,
        images: [`${origin}/og.png`],
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
    };
  } catch {
    return unavailableMetadata();
  }
}

export default async function PublicServerPage({ params }: ServerPageProps) {
  const { serverId } = await params;
  const [server, origin] = await Promise.all([
    readServer(serverId),
    requestSiteOrigin(),
  ]);
  if (!server) notFound();

  const canonical = `${origin}/servers/${server.id}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "GameServer",
        "@id": `${canonical}#server`,
        name: server.name,
        description: serverMetaDescription(server),
        identifier: server.id,
        url: canonical,
        mainEntityOfPage: canonical,
        playersOnline: server.players,
        serverStatus: server.online
          ? "https://schema.org/Online"
          : "https://schema.org/Offline",
        game: {
          "@type": "VideoGame",
          name: "Minecraft",
          gamePlatform:
            server.edition === "JE + BE"
              ? ["Minecraft: Java Edition", "Minecraft: Bedrock Edition"]
              : server.edition === "BE"
                ? "Minecraft: Bedrock Edition"
                : "Minecraft: Java Edition",
        },
        sameAs: [
          server.websiteUrl,
          server.discordUrl,
          server.kakaoUrl,
        ].filter(Boolean),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "마인크래프트 서버리스트",
            item: `${origin}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: server.name,
            item: canonical,
          },
        ],
      },
    ],
  };

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <nav className={styles.nav} aria-label="사이트 경로">
        <Link href="/">Minecraft.kr 서버리스트</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{server.name}</span>
      </nav>

      <article className={styles.card}>
        <header className={styles.hero}>
          <div className={styles.eyebrow}>
            <span className={server.online ? styles.online : styles.offline}>
              {server.online ? "현재 온라인" : "현재 오프라인"}
            </span>
            <span>{server.edition} SERVER</span>
            {server.verified ? <span>운영자 인증 완료</span> : null}
          </div>
          <h1>{server.name}</h1>
          <p>{server.summary}</p>
          <div className={styles.tags} aria-label="서버 태그">
            {server.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </header>

        <section className={styles.connection} aria-labelledby="connection-title">
          <div>
            <span id="connection-title">SERVER ADDRESS</span>
            <strong>{server.address}</strong>
          </div>
          <dl>
            <div>
              <dt>지원 에디션</dt>
              <dd>{server.edition}</dd>
            </div>
            <div>
              <dt>지원 버전</dt>
              <dd>{server.version}</dd>
            </div>
            <div>
              <dt>접속자</dt>
              <dd>
                {server.online
                  ? `${server.players.toLocaleString("ko-KR")} / ${server.capacity.toLocaleString("ko-KR")}`
                  : "오프라인"}
              </dd>
            </div>
            <div>
              <dt>누적 추천</dt>
              <dd>{server.votes.toLocaleString("ko-KR")}회</dd>
            </div>
          </dl>
        </section>

        <section className={styles.description} aria-labelledby="description-title">
          <span>SERVER INTRODUCTION</span>
          <h2 id="description-title">서버 소개</h2>
          <p>{server.description}</p>
        </section>

        {server.websiteUrl || server.discordUrl || server.kakaoUrl ? (
          <section className={styles.links} aria-labelledby="links-title">
            <span>OFFICIAL LINKS</span>
            <h2 id="links-title">서버 공식 채널</h2>
            <div>
              {server.websiteUrl ? (
                <a href={server.websiteUrl} target="_blank" rel="noreferrer">
                  공식 웹사이트
                </a>
              ) : null}
              {server.discordUrl ? (
                <a href={server.discordUrl} target="_blank" rel="noreferrer">
                  Discord
                </a>
              ) : null}
              {server.kakaoUrl ? (
                <a href={server.kakaoUrl} target="_blank" rel="noreferrer">
                  카카오톡
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        <footer className={styles.footer}>
          <p>
            상태와 접속자 수는 마지막 수집 기록을 기준으로 표시됩니다.
            접속 전 서버 버전과 주소를 다시 확인해 주세요.
          </p>
          <time dateTime={new Date(server.updatedAt * 1_000).toISOString()}>
            최근 정보 갱신{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              dateStyle: "long",
              timeStyle: "short",
            }).format(new Date(server.updatedAt * 1_000))}
          </time>
          <Link href="/">전체 서버 비교하기</Link>
        </footer>
      </article>
    </main>
  );
}

function serverMetaDescription(server: PublicServerSeoRecord) {
  const status = server.online
    ? `현재 ${server.players.toLocaleString("ko-KR")}명 접속`
    : "현재 오프라인";
  const value = `${server.summary} ${server.edition} · ${server.version} · ${status}. 서버 주소와 상세 소개를 확인하세요.`;
  return value.length > 160 ? `${value.slice(0, 157).trimEnd()}…` : value;
}

function unavailableMetadata(): Metadata {
  return {
    title: "서버를 찾을 수 없습니다",
    robots: {
      index: false,
      follow: false,
    },
  };
}

function safeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
