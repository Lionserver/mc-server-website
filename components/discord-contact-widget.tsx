import Image from "next/image";

const DISCORD_INVITE = "https://discord.gg/TgCYTVjBsv";

export function DiscordContactWidget() {
  return <a className="discord-contact-widget" href={DISCORD_INVITE} target="_blank" rel="noreferrer" aria-label="Minecraft.kr 문의 Discord 새 창에서 열기">
    <span className="discord-contact-bubble"><small>문의</small><b>Discord</b></span>
    <span className="discord-contact-symbol"><Image src="/discord-symbol.svg" alt="" width={32} height={24} priority /></span>
  </a>;
}
